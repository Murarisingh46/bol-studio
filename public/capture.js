// AudioContext runs at 16 kHz. Batch render quanta into 32 ms messages.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(512);
    this.used = 0;
    this.port.onmessage = () => {
      if (this.used) this.port.postMessage(this.block.slice(0, this.used));
      this.port.postMessage("flushed");
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.block[this.used++] = sample;
      if (this.used === this.block.length) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(512);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("bol-capture", Capture);
