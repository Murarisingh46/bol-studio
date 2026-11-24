export const RATE = 16000;
export function rms(samples) {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}
// Keep a short lead-in so a low-energy initial consonant survives the gate.
export class Phrases {
  constructor(emit) {
    this.emit = emit;
    this.lead = [];
    this.reset();
  }
  reset() {
    this.frames = [];
    this.length = 0;
    this.quiet = 0;
    this.voiced = 0;
  }
  push(frame, level = rms(frame)) {
    const voice = level > 0.008;
    if (!this.length && !voice) {
      this.lead.push(frame);
      if (this.lead.length > 6) this.lead.shift();
      return;
    }
    if (!this.length) {
      this.frames = this.lead;
      this.lead = [];
      this.length = this.frames.reduce((sum, x) => sum + x.length, 0);
    }
    this.frames.push(frame);
    this.length += frame.length;
    if (voice) {
      this.quiet = 0;
      this.voiced += frame.length;
    } else this.quiet += frame.length;
    if (this.quiet >= RATE * 0.46 || this.length >= RATE * 7) this.flush();
  }
  flush() {
    const frames = this.frames,
      length = this.length,
      voiced = this.voiced;
    this.reset();
    this.lead = [];
    if (voiced < RATE * 0.12) return;
    const audio = new Float32Array(length);
    let offset = 0;
    for (const f of frames) {
      audio.set(f, offset);
      offset += f.length;
    }
    this.emit(audio);
  }
}
