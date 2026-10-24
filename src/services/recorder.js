// Sprachaufnahme mit MediaRecorder. Android/Chrome: WebM/Opus, iPhone/Safari: MP4/AAC.
// Das Original wird nie umgewandelt.
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export const recordingSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const secureOk = () => window.isSecureContext;

export async function startRecording({ onLevel } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
  const chunks = [];
  const startedAt = new Date();
  let wake = null;
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* egal */ }
  let ctx, raf;
  if (onLevel && window.AudioContext) {
    ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); onLevel(m / 128); raf = requestAnimationFrame(loop); };
    loop();
  }
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.start(1000);
  const stop = () => new Promise((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(raf); ctx?.close(); wake?.release?.().catch(() => {});
      const type = (rec.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0];
      resolve({ blob: new Blob(chunks, { type }), startedAt: startedAt.toISOString(), durationSec: Math.round((Date.now() - startedAt) / 1000) });
    };
    rec.stop();
  });
  const cancel = () => { rec.onstop = null; try { rec.stop(); } catch {} stream.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(raf); ctx?.close(); wake?.release?.().catch(() => {}); };
  return { stop, cancel, startedAt };
}

/** Live-Erkennung im Browser (Google/Apple) – nur wenn ausdrücklich eingeschaltet. */
export function webSpeechAvailable() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
export function webSpeech(onText, onEnd) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new R();
  r.lang = 'de-DE'; r.interimResults = true; r.continuous = true;
  let final = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) final += `${e.results[i][0].transcript} `; else interim += e.results[i][0].transcript; }
    onText(final + interim);
  };
  r.onend = () => onEnd?.(final.trim());
  r.onerror = () => onEnd?.(final.trim());
  r.start();
  return () => r.stop();
}
