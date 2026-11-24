# Explaining Bol Studio

## A two-minute walkthrough

Start with what the listener can check. Read “अगर समय मिले तो please review the project plan” aloud or use **Try sample**. Watch the input level while the app captures audio. Wait for the phrase to appear, then stop. Explain the difference between hearing input immediately and having to wait for enough speech to decode a phrase.

Save the result as **Project review**, fix one word, reload, search for the corrected word, and delete the session. Cancel the first delete to demonstrate the confirmation. A second browser profile has its own empty library. For the strongest mixed-language demonstration, use the self-hosted Turbo configuration in the README.

## Decisions worth explaining

**Why phrase-based updates?** Whisper processes audio windows. The browser collects 16 kHz mono frames, retains a short lead-in, and emits a phrase after about 460 ms of quiet. Continuous speech forces an update at seven seconds. Stop flushes the remaining frame and phrase. Inference and network time add to that latency. A forced cut can split a word. An overlapping window with stable-prefix reconciliation would address that in a later version.

**What makes it bilingual?** The pretrained model can emit Devanagari and Latin tokens in one output. The browser limits the first language-token choice to Hindi or English and then allows ordinary word generation. The server uses multilingual Turbo, transcription mode and a general bilingual prompt. If its detected language is outside the supported pair, it selects the more likely of Hindi and English. Neither engine runs a translation or dictionary replacement after decoding.

**Why two engines?** Turbo produced a better uninterrupted mixed-sentence result in the local checks. Browser Whisper Small lets the hosted demo run without a paid inference API, and microphone audio stays on the visitor’s device. Its encoder and decoder downloads total about 249 MB. Cold start and CPU speed affect the experience. A warm, dedicated inference host would make latency more predictable.

**What if inference is slow or fails?** Each session has one ordered queue. Capture stops when eight phrases are waiting, then queued work drains. Failed decoding preserves the unsent or failed phrase in memory for retry. Successfully decoded text remains available for review. Audio buffers and unsaved drafts are lost when the tab closes. A noisy room or very quiet speaker can fool the simple energy gate.

**Why SQL?** Every saved session has a primary key, an owner hash, text, engine, input source, duration, creation time, and revision. The library’s main access pattern is an owner-scoped query ordered by creation time. A composite index supports that query. A repeated create with the same client-generated ID returns the existing row. Updates and deletes match the last observed revision so stale tabs receive a conflict instead of silently overwriting someone’s edit.

**What would you measure next?** Collect consented human recordings with different accents, microphones, noise levels and speaking rates. Evaluate normalized word error rate alongside script preservation for English terms. Measure time to first phrase and finalization latency on named devices. The synthetic checks below establish specific behavior, without establishing a population accuracy rate.

## Verification record

| Check | Observed result |
| --- | --- |
| Self-hosted Turbo, uninterrupted synthetic speech | The 3.59 s fixture took 9.94 s in one warm CPU endpoint run and yielded “अगर समय मिले तो, please review the project plan.” |
| Second synthetic utterance, another installed Hindi voice | Turbo yielded “आज हमारी team meeting है. Please share the update.” The smaller self-hosted model transliterated and garbled several English words. |
| Browser Whisper Small | The complete browser UI yielded “अगर समय मिले तो Please review the project plan.” on the bundled sample with a pause. On the joined clip without the pause it omitted the Hindi lead-in. |
| Browser microphone pipeline | Chrome’s simulated microphone produced mixed-script text before Stop. One run spelled अगर as आगर. This exercised Web Audio capture and real inference. Human microphone acoustics were outside this check. |
| History | Browser tests created, opened, edited, searched, reloaded, and deleted a session. Cancelling deletion preserved it. |
| Error and concurrency handling | Five automated tests cover Unicode storage, owner isolation, idempotence, stale writes, invalid input, silence and segmentation. |
| Hosting | The cloud deployment reported success. Its D1 binding contained the transcripts table. The packaged Worker passed CRUD against local D1. Anonymous cloud access returned HTTP 401 under owner-only sharing. |

To reproduce the continuous-utterance check with the self-hosted service running:

```sh
python speech/check_sample.py
```

The bundled demonstration combines two synthesized voice segments with a natural pause. The continuous fixture shortens that transition. These are controlled samples, and the app executes the recognizer each time. Talk through both the successful output and the missed Hindi lead-in when explaining model choice.

## What Codex contributed

Codex designed the UI and architecture, implemented the code, compared speech models, ran the checks, and drafted this guide. Before presenting, run the two demo paths, trace a request from the capture worklet to the database, and describe which parts you have personally reviewed or modified. Use your own experience when answering the employer’s screening questions.
