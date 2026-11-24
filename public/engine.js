let worker, ready, pending;
function reset(msg) {
  worker?.terminate();
  worker = undefined;
  ready = undefined;
  const active = pending;
  pending = undefined;
  if (active) {
    clearTimeout(active.timer);
    active.reject(new Error(msg));
  }
}
export function cancelEngine() {
  reset("Model loading cancelled.");
}
function job(message, progress, timeout) {
  return new Promise((resolve, reject) => {
    const expire = () =>
      reset("The model timed out. Check your connection and retry.");
    const timer = setTimeout(expire, timeout);
    pending = { resolve, reject, progress, timer, expire, timeout };
    worker.postMessage(message);
  });
}
export async function prepare(engine, progress) {
  if (engine !== "Browser Whisper") return;
  if (!ready) {
    worker = new Worker("/whisper-worker.js", { type: "module" });
    worker.onerror = () =>
      reset(
        "Browser Whisper could not start. Check network access to the model host and retry.",
      );
    worker.onmessage = ({ data }) => {
      if (!pending) return;
      if (data.progress) {
        clearTimeout(pending.timer);
        pending.timer = setTimeout(pending.expire, pending.timeout);
        pending.progress?.(data.progress);
        return;
      }
      if (data.error) {
        reset(data.error);
        return;
      }
      clearTimeout(pending.timer);
      pending.resolve(data.text ?? true);
      pending = undefined;
    };
    ready = job({ type: "load" }, progress, 240000);
  }
  await ready;
}
export async function decode(engine, audio) {
  if (engine === "Browser Whisper")
    return job({ type: "decode", audio }, null, 120000);
  const pcm = new Int16Array(audio.length);
  for (let i = 0; i < audio.length; i++)
    pcm[i] = Math.round(Math.max(-1, Math.min(1, audio[i])) * 32767);
  const res = await fetch("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: pcm,
    signal: AbortSignal.timeout(125000),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Speech worker unavailable.");
  return result.text;
}
