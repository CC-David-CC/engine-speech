import { pipeline, env } from './vendor/transformers.min.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('./models/', import.meta.url).href;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

let transcriber;
let loading;
const progress = value => {
  if (value.status === 'progress') postMessage({ type: 'progress', progress: value.progress });
};
async function createTranscriber() {
  // Use the verified CPU path on phones too. An available GPU adapter does
  // not establish that this model can decode accurately on that driver.
  const options = { device: 'wasm', dtype: 'q8', local_files_only: true, progress_callback: progress };
  return pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', options);
}
async function load() {
  if (transcriber) return transcriber;
  if (loading) return loading;
  loading = (async () => {
    transcriber = await createTranscriber();
    return transcriber;
  })();
  try { return await loading; } finally { loading = null; }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load();
      postMessage({ type: 'ready', device: 'wasm' });
    } else if (data.type === 'transcribe') {
      if (!(data.audio instanceof Float32Array) || data.audio.length > 16 * 16000 || !transcriber) throw Error('Invalid audio buffer');
      const result = await transcriber(data.audio, { max_new_tokens: 128, no_repeat_ngram_size: 4 });
      postMessage({ type: 'result', text: result.text, device: 'wasm' });
    }
  } catch (error) {
    postMessage({ type: 'error', message: 'Speech recognition could not run on this device. Please try again.' });
    console.error('Local speech recognition:', error);
  }
};
