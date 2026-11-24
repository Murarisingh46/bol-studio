import { RATE, rms, Phrases } from "./phrases.js";
import { prepare, decode, cancelEngine } from "./engine.js";

// A session accepts PCM in order, then drains its queue before enabling save.
export class Recording {
  constructor(engine, source, events) {
    Object.assign(this, { engine, source, events });
    this.queue = [];
    this.samples = 0;
    this.closed = false;
    this.preparing = true;
    this.segmenter = new Phrases((chunk) => {
      this.queue.push(chunk);
      void this.drain();
      if (this.queue.length >= 8 && !this.closed) {
        this.backlog = true;
        void this.stop();
      }
    });
  }
  async start() {
    try {
      this.ctx = new AudioContext({ sampleRate: RATE });
      await this.ctx.resume();
      this.events.status(
        "Preparing",
        this.engine === "Browser Whisper"
          ? "Loading Whisper Small. First use downloads about 250 MB."
          : "Preparing audio input…",
      );
      await prepare(this.engine, (msg) => this.events.status("Preparing", msg));
      if (this.closed) return;
      if (this.source === "sample") {
        const res = await fetch("/sample.wav");
        if (!res.ok) throw new Error("Sample unavailable. Please retry.");
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        if (this.closed) return;
        this.input = this.ctx.createBufferSource();
        this.input.buffer = buffer;
      } else {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Microphone access needs HTTPS or localhost.");
        this.events.status(
          "Permission",
          "Allow the microphone in your browser to begin.",
        );
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        if (this.closed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        this.stream = stream;
        this.input = this.ctx.createMediaStreamSource(stream);
        stream.getAudioTracks()[0].onended = () => {
          this.disconnected = true;
          void this.stop();
        };
      }
      await this.ctx.audioWorklet.addModule("/capture.js");
      if (this.closed) return;
      this.node = new AudioWorkletNode(this.ctx, "bol-capture");
      this.node.port.onmessage = ({ data }) => {
        if (data === "flushed") {
          this.flushed?.();
          return;
        }
        if (this.finished) return;
        this.samples += data.length;
        const level = rms(data);
        this.events.level(level, this.samples / RATE);
        this.segmenter.push(data, level);
      };
      this.input.connect(this.node);
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.node.connect(mute).connect(this.ctx.destination);
      this.preparing = false;
      if (this.source === "sample") {
        this.input.connect(this.ctx.destination);
        this.input.onended = () => void this.stop();
        this.input.start();
      }
      this.events.status(
        this.source === "sample" ? "Playing sample" : "Recording",
        "Phrases appear after a pause or seven seconds of speech.",
      );
    } catch (err) {
      if (this.closed) return;
      const messages = {
        NotAllowedError:
          "Microphone access was denied. Allow it in browser settings or try the sample.",
        NotFoundError: "No microphone found. Connect one or try the sample.",
      };
      this.failure = messages[err.name] || err.message;
      await this.stop();
    }
  }
  async drain() {
    if (this.busy || this.failedChunk) return;
    this.busy = true;
    while (this.queue.length) {
      const chunk = this.queue[0];
      try {
        const text = await decode(this.engine, chunk);
        if (text) this.events.text(text);
        this.queue.shift();
      } catch (err) {
        this.failedChunk = true;
        this.failure = "Phrase decoding failed. " + err.message;
        if (!this.closed) void this.stop();
        break;
      }
    }
    this.busy = false;
    this.complete();
  }
  async retry() {
    this.events.status("Retrying", "Recovering the remaining audio…");
    try {
      await prepare(this.engine, (msg) => this.events.status("Retrying", msg));
      this.failedChunk = false;
      this.failure = "";
      await this.drain();
    } catch (err) {
      this.events.done(err.message, true);
    }
  }
  async stop() {
    if (this.closed) return;
    this.closed = true;
    if (this.preparing && this.engine === "Browser Whisper" && !this.node)
      cancelEngine();
    this.events.status("Finishing", "Finishing the current phrase…");
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.source === "sample" && this.input) {
      try {
        this.input.stop();
      } catch {}
    }
    this.input?.disconnect();
    if (this.node) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 300);
        this.flushed = () => {
          clearTimeout(timer);
          resolve();
        };
        this.node.port.postMessage("flush");
      });
      this.node.disconnect();
      this.node.port.close();
    }
    this.finished = true;
    this.segmenter.flush();
    if (this.ctx && this.ctx.state !== "closed")
      await this.ctx.close().catch(() => {});
    this.released = true;
    this.complete();
  }
  complete() {
    if (!this.released || this.busy || (this.queue.length && !this.failedChunk))
      return;
    this.events.done(
      this.failure ||
        (this.backlog
          ? "Capture paused to let the engine catch up."
          : this.disconnected
            ? "Microphone disconnected."
            : ""),
      !!this.failedChunk,
    );
  }
}
