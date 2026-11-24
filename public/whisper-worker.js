// Runs off the UI thread. Fixed revisions make the browser model reproducible.
let pipe;
// Whisper chooses a language token before emitting words. Restrict just that
// decision to the supported pair; both scripts remain available at every word.
function bilingualLanguageStep(history, logits) {
  if (history.length !== 1) return;
  const ids = ["hindi", "english"].map(
    (language) => pipe.tokenizer.get_decoder_prompt_ids({ language })[0][1],
  );
  const best = logits.data[ids[0]] >= logits.data[ids[1]] ? ids[0] : ids[1];
  logits.data.fill(-Infinity);
  logits.data[best] = 0;
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      const { pipeline, env } = await import(
        "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js"
      );
      env.allowLocalModels = false;
      env.backends.onnx.wasm.numThreads = 1;
      pipe = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-small",
        {
          revision: "2d67713f236afa48a18992566e7647f6ca848e13",
          quantized: true,
          progress_callback: (p) => {
            if (p.status === "progress" && p.file.endsWith(".onnx"))
              self.postMessage({
                progress: `Downloading ${p.file.includes("encoder") ? "encoder" : "decoder"} · ${Math.round(p.progress)}%`,
              });
          },
        },
      );
      self.postMessage({ ready: true });
    } else {
      const { input_features } = await pipe.processor(data.audio);
      const config = {
        forced_decoder_ids: pipe.tokenizer.get_decoder_prompt_ids({
          task: "transcribe",
        }),
        max_new_tokens: 96,
      };
      const [tokens] = await pipe.model.generate(input_features, config, [
        bilingualLanguageStep,
      ]);
      self.postMessage({
        text: pipe.tokenizer
          .decode(tokens, { skip_special_tokens: true })
          .trim(),
      });
    }
  } catch (err) {
    self.postMessage({
      error: err.message || "Browser Whisper could not load.",
    });
  }
};
