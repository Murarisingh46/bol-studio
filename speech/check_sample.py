"""Send the continuous synthetic fixture to the running loopback recognizer."""
import json
import os
import time
import wave
from pathlib import Path
from urllib.request import Request, urlopen

audio = Path(__file__).resolve().parents[1] / "test/fixtures/continuous-hinglish.wav"
with wave.open(str(audio), "rb") as sample:
    assert (sample.getframerate(), sample.getnchannels(), sample.getsampwidth()) == (16000, 1, 2)
    pcm = sample.readframes(sample.getnframes())
port = int(os.getenv("BOL_SPEECH_PORT", "8766"))
request = Request(f"http://127.0.0.1:{port}/transcribe", data=pcm,
                  headers={"Content-Type": "application/octet-stream"})
started = time.monotonic()
with urlopen(request, timeout=120) as response:
    text = json.load(response)["text"]
print("Reference   अगर समय मिले तो please review the project plan.")
print("Recognized ", text)
print(f"Audio {len(pcm) / 32000:.2f}s · elapsed {time.monotonic() - started:.2f}s")
