import test from "node:test";
import assert from "node:assert/strict";

test("Browser Live replaces interim words and commits each final result once", async () => {
  let service;
  globalThis.SpeechRecognition = class {
    constructor() {
      service = this;
    }
    start() {
      this.onstart();
    }
    stop() {
      this.onend();
    }
  };
  try {
    const { LiveRecording } = await import("../public/live.js");
    const finals = [],
      partials = [];
    let ended = 0;
    const recording = new LiveRecording({
      status() {},
      tick() {},
      text: (t) => finals.push(t),
      partial: (t) => partials.push(t),
      done() {
        ended++;
      },
    });
    recording.start();
    const result = (text, isFinal) => ({ 0: { transcript: text }, isFinal });
    service.onresult({ resultIndex: 0, results: [result("आज", false)] });
    service.onresult({
      resultIndex: 0,
      results: [result("आज meeting", false)],
    });
    assert.deepEqual(finals, []);
    assert.deepEqual(partials, ["आज", "आज meeting"]);
    service.onresult({
      resultIndex: 0,
      results: [result("आज meeting है", true)],
    });
    service.onresult({
      resultIndex: 0,
      results: [result("आज meeting है", true)],
    });
    recording.stop();
    assert.deepEqual(finals, ["आज meeting है"]);
    assert.equal(partials.at(-1), "");
    assert.equal(ended, 1);
  } finally {
    delete globalThis.SpeechRecognition;
  }
});
