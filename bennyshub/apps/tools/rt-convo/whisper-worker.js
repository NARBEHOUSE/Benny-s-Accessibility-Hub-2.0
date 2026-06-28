// Whisper speech recognition worker — loaded as a same-origin ES module
// so Chromium's cross-origin module restrictions don't apply.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels  = false;
env.allowRemoteModels = true;
env.backends.onnx.wasm.proxy = false;

let asr = null;

self.addEventListener('message', async (e) => {
  const { type, audio, sampleRate } = e.data;

  if (type === 'load') {
    try {
      asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', {
        quantized: true,
        progress_callback: (p) => {
          if ((p.status === 'downloading' || p.status === 'progress') && p.progress != null)
            self.postMessage({ type: 'progress', pct: Math.round(p.progress), file: p.file || '' });
        }
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', msg: err.message });
    }

  } else if (type === 'transcribe' && asr) {
    try {
      const fa  = new Float32Array(audio);
      const out = await asr(fa, { sampling_rate: sampleRate, language: 'english', task: 'transcribe' });
      const text = (out.text || '').trim().replace(/^[\s,\.!?\[\]()]+|[\s,\.!?\[\]()]+$/g, '');
      if (text && text.length > 1) self.postMessage({ type: 'result', text });
    } catch (_) {}
  }
});
