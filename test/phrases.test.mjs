import test from "node:test";
import assert from "node:assert/strict";
import { Phrases, RATE } from "../public/phrases.js";
const frame = (v) => new Float32Array(512).fill(v);
test("Silence is ignored, a pause emits once, and stopping flushes a final phrase", () => {
  const chunks = [],
    s = new Phrases((c) => chunks.push(c));
  for (let i = 0; i < 80; i++) s.push(frame(0));
  s.flush();
  assert.equal(chunks.length, 0);
  for (let i = 0; i < 15; i++) s.push(frame(0.25));
  for (let i = 0; i < 20; i++) s.push(frame(0));
  assert.equal(chunks.length, 1);
  for (let i = 0; i < 10; i++) s.push(frame(0.2));
  s.flush();
  s.flush();
  assert.equal(chunks.length, 2);
});
test("Continuous speech yields live phrases before stop with no dropped samples", () => {
  const chunks = [],
    s = new Phrases((c) => chunks.push(c));
  for (let i = 0; i < 465; i++) s.push(frame(0.2));
  assert.equal(chunks.length, 2);
  s.flush();
  assert.equal(
    chunks.reduce((n, c) => n + c.length, 0),
    465 * 512,
  );
  assert(chunks.every((c) => c.length <= RATE * 7 + 512));
});
