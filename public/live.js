// The browser speech service owns microphone capture. Interim hypotheses can be
// replaced by the service; only final results enter the saved transcript.
export const browserSpeech =
  globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export class LiveRecording {
  constructor(events) {
    this.events = events;
    this.preparing = true;
  }
  start() {
    const r = (this.recognition = new browserSpeech());
    r.lang = "hi-IN";
    r.continuous = true;
    r.interimResults = true;
    this.events.status(
      "Permission",
      "Allow microphone access. Browser Live uses your browser’s speech service.",
    );
    const finish = () => {
      if (this.finished) return;
      this.finished = true;
      clearTimeout(this.deadline);
      clearInterval(this.clock);
      this.events.partial("");
      this.events.done(this.error, false);
    };
    this.finish = finish;
    this.deadline = setTimeout(
      () =>
        this.fail(
          "The browser did not start listening. Check microphone access or select Browser Whisper.",
        ),
      25000,
    );
    r.onstart = () => {
      if (this.finished || this.stopping) return;
      clearTimeout(this.deadline);
      this.preparing = false;
      const start = performance.now();
      this.events.status(
        "Recording",
        "Speak now. Words in italics are provisional.",
      );
      this.events.tick(0);
      this.clock = setInterval(
        () => this.events.tick((performance.now() - start) / 1000),
        250,
      );
    };
    r.onresult = ({ results, resultIndex }) => {
      if (this.finished) return;
      for (let i = resultIndex; i < results.length; i++) {
        if (results[i].isFinal && i >= (this.finalCount || 0)) {
          this.finalCount = i + 1;
          const text = results[i][0].transcript.trim();
          if (text) this.events.text(text);
        }
      }
      const interim = Array.from(results)
        .filter((x) => !x.isFinal)
        .map((x) => x[0].transcript.trim())
        .join(" ");
      this.events.partial(interim);
    };
    r.onerror = (e) => {
      const messages = {
        "not-allowed":
          "Microphone permission was denied. Allow access in browser settings and try again.",
        "audio-capture":
          "No microphone is available. Connect one or play the example.",
        "no-speech": "No speech detected. Try again or play the example.",
        network:
          "Your browser’s speech service is unreachable. Select Browser Whisper to process audio on this device.",
        "service-not-allowed":
          "This browser cannot use its speech service here. Select Browser Whisper or open the demo in Chrome.",
      };
      if (e.error !== "aborted" || !this.stopping)
        this.error =
          messages[e.error] ||
          "The browser speech service stopped. Try Browser Whisper.";
      finish();
    };
    r.onend = finish;
    try {
      r.start();
    } catch {
      this.fail(
        "Browser Live could not start. Select Browser Whisper and try again.",
      );
    }
  }
  fail(message) {
    this.error = message;
    this.recognition.abort();
    this.finish();
  }
  stop() {
    if (this.finished || this.stopping) return;
    this.stopping = true;
    clearTimeout(this.deadline);
    this.events.status("Finishing", "Waiting for the browser’s final words…");
    this.deadline = setTimeout(() => {
      this.recognition.abort();
      this.finish();
    }, 2500);
    try {
      this.recognition.stop();
    } catch {
      this.finish();
    }
  }
}

// Fixed audio can be replayed with the previously verified Whisper output.
// This path never requests microphone permission or starts an inference worker.
export class ExamplePlayback {
  constructor(events) {
    this.events = events;
  }
  async start() {
    const a = (this.audio = new Audio("/sample.wav"));
    let shown = 0;
    const cues = [
      [1.65, "अगर समय मिले तो"],
      [4, "Please review the project plan."],
    ];
    const update = () => {
      this.events.tick(a.currentTime);
      while (shown < cues.length && a.currentTime >= cues[shown][0])
        this.events.text(cues[shown++][1]);
    };
    a.ontimeupdate = update;
    a.onended = () => {
      update();
      this.stop();
    };
    a.onerror = () => this.stop("The audio example could not load. Try again.");
    this.events.status(
      "Playing example",
      "Replaying a saved Whisper transcript with its original audio.",
    );
    try {
      await a.play();
    } catch {
      this.stop("Playback did not start. Try the example again.");
    }
  }
  stop(error) {
    if (this.finished) return;
    this.finished = true;
    this.audio.pause();
    this.audio.ontimeupdate = null;
    this.events.done(error, false);
  }
}
