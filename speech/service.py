"""Loopback-only speech worker. One preloaded model, bounded PCM, no audio files."""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from faster_whisper import WhisperModel

MODEL = os.getenv("BOL_MODEL", "turbo")
model = WhisperModel(MODEL, device="cpu", compute_type="int8",
                     cpu_threads=int(os.getenv("BOL_THREADS", "4")),
                     revision="0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf" if MODEL == "turbo" else None)
slot = threading.BoundedSemaphore(1)


class SpeechHandler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/transcribe":
            return self.reply(404, {"error": "Unknown route."})
        try:
            size = int(self.headers.get("Content-Length", 0))
        except ValueError:
            size = 0
        if not 2 <= size <= 16_000 * 2 * 15 or size % 2:
            return self.reply(422, {"error": "Send up to 15 seconds of 16 kHz mono PCM16."})
        if not slot.acquire(timeout=5):
            return self.reply(503, {"error": "The speech worker is busy. Retry this phrase."})
        try:
            pcm = np.frombuffer(self.rfile.read(size), dtype="<i2").astype(np.float32) / 32768
            settings = dict(task="transcribe", beam_size=3, condition_on_previous_text=False,
                            vad_filter=True, initial_prompt="हिंदी और English दोनों में बातचीत। English terms stay in English.")
            segments, info = model.transcribe(pcm, **settings)
            if info.language not in ("hi", "en") and info.all_language_probs:
                probs = dict(info.all_language_probs)
                language = max(("hi", "en"), key=lambda lang: probs.get(lang, 0))
                segments, _ = model.transcribe(pcm, language=language, **settings)
            self.reply(200, {"text": " ".join(s.text.strip() for s in segments).strip()})
        except Exception:
            self.reply(500, {"error": "Whisper could not decode this phrase."})
        finally:
            slot.release()


if __name__ == "__main__":
    port = int(os.getenv("BOL_SPEECH_PORT", "8766"))
    print(f"Loaded {MODEL} on CPU. Speech service ready on 127.0.0.1:{port}.", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), SpeechHandler).serve_forever()
