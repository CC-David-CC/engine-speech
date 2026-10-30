// Audio is recorded and transcribed in this tab. Only static model/runtime
// files are fetched; no microphone recording is sent to any server.
let worker;
let modelReady = false;
let pending;
let current;
let warming;
let preloadStatus = () => {};
export function preloadVoice(status = () => {}) {
  preloadStatus = status;
  if (modelReady) return Promise.resolve();
  if (!warming) {
    status('Loading voice model…');
    warming = request({ type: 'load' }).finally(() => { warming = null; });
  }
  return warming;
}
export function stopVoice() {
  if (!current) return;
  if (current.phase === 'recording') current.recorder.stop();
  else cancel(current);
}
export function cancelVoice() { if (current) cancel(current); }
export function cleanTranscript(value) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim();
  const compact = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let repetitive = false;
  if (compact.length >= 32) {
    for (let size = 1; size <= Math.min(64, Math.floor(compact.length / 4)); size++) {
      const repeated = compact.slice(0, size).repeat(Math.ceil(compact.length / size));
      if (repeated.startsWith(compact)) { repetitive = true; break; }
    }
    const counts = new Map();
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) counts.set(word, (counts.get(word) || 0) + 1);
    for (const [word, count] of counts) if (word.length >= 3 && count >= 5 && word.length * count >= compact.length * .6) repetitive = true;
  }
  if (repetitive) throw Error('Speech repeated unexpectedly. Nothing was inserted; try a shorter recording.');
  return text;
}
function resetEngine() {
  worker?.terminate(); worker = null; modelReady = false;
}
function engine() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      preloadStatus('Loading voice… ' + Math.round(data.progress || 0) + '%');
      if (current?.phase === 'loading') current.status('Loading speech… ' + Math.round(data.progress || 0) + '%');
      return;
    }
    if (data.type === 'ready') modelReady = true;
    const job = pending; pending = null;
    clearTimeout(job?.timer);
    if (data.type === 'error') job?.reject(Error(data.message));
    else job?.resolve(data);
  };
  worker.onerror = event => {
    console.error('Speech worker failed:', event.message);
    clearTimeout(pending?.timer);
    pending?.reject(Error('Could not start local speech recognition.'));
    pending = null; resetEngine();
  };
  return worker;
}
function request(message, transfer = []) {
  if (pending) return Promise.reject(Error('Speech recognition is already busy.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null; resetEngine();
      reject(Error('Local speech recognition took too long. Please try a shorter recording.'));
    }, message.type === 'load' ? 240000 : 120000);
    pending = { resolve, reject, timer };
    try { engine().postMessage(message, transfer); }
    catch (error) { clearTimeout(timer); pending = null; resetEngine(); reject(error); }
  });
}
function finish(job) {
  clearTimeout(job.timer);
  job.observer?.disconnect();
  job.stream?.getTracks().forEach(track => track.stop());
  if (current === job) { current = null; job.status(''); }
}
function cancel(job) {
  job.cancelled = true;
  if (job.recorder?.state === 'recording') job.recorder.stop();
  if (job.phase === 'transcribing' || job.phase === 'loading' && !modelReady) {
    resetEngine();
    clearTimeout(pending?.timer);
    pending?.reject(Error('Voice cancelled.')); pending = null;
  }
  finish(job);
}
export async function toggleVoice({ terminal, status, insert, sessionValid }) {
  if (current) {
    if (current.phase === 'recording' && current.terminal === terminal) current.recorder.stop();
    else cancel(current);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder || !globalThis.OfflineAudioContext) throw Error('Voice input is unavailable in this browser.');
  const job = { terminal, status, phase: 'loading', cancelled: false };
  current = job;
  const valid = () => !job.cancelled && terminal.isConnected && sessionValid();
  job.observer = new MutationObserver(() => { if (!terminal.isConnected) cancel(job); });
  job.observer.observe(document.querySelector('#previews'), { childList: true, subtree: true });
  try {
    status(modelReady ? 'Opening microphone…' : 'Loading speech model…');
    if (!modelReady) {
      await preloadVoice();
    }
    if (!valid()) return;
    job.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (!valid()) return;
    const chunks = [];
    job.recorder = new MediaRecorder(job.stream);
    job.recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const recorded = new Promise((resolve, reject) => {
      job.recorder.onstop = resolve;
      job.recorder.onerror = () => reject(Error('Microphone recording failed.'));
    });
    job.phase = 'recording';
    status('Listening…');
    job.recorder.start();
    job.timer = setTimeout(() => { if (job.recorder.state === 'recording') job.recorder.stop(); }, 15000);
    await recorded;
    clearTimeout(job.timer);
    job.stream.getTracks().forEach(track => track.stop());
    if (!valid()) return;
    job.phase = 'transcribing'; status('Transcribing on this device…');
    const blob = new Blob(chunks, { type: job.recorder.mimeType });
    if (blob.size > 2 * 1024 * 1024) throw Error('Voice clip is too long.');
    const decoder = new OfflineAudioContext(1, 1, 16000);
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    const audio = new Float32Array(Math.min(decoded.length, 16 * 16000));
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const input = decoded.getChannelData(channel);
      for (let i = 0; i < audio.length; i++) audio[i] += input[i] / decoded.numberOfChannels;
    }
    const rms = Math.sqrt(audio.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, audio.length));
    if (rms < .001) { status('No speech detected. Try speaking closer to the microphone.'); return; }
    const result = await request({ type: 'transcribe', audio }, [audio.buffer]);
    if (!valid()) return;
    const text = cleanTranscript(result.text);
    if (text) insert(text);
    status(text ? 'Voice text added.' : 'No speech detected.');
  } catch (error) {
    if (!job.cancelled) throw error;
  } finally { finish(job); }
}
