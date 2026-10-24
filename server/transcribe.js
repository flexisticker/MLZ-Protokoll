// Spracherkennung mit whisper.cpp – dieselbe Technik wie die Video-Zentrale, läuft im eigenen Container (keine Cloud).
// Modelle: zuerst im eingehängten Ordner der Video-Zentrale (/models, nur lesend), sonst im eigenen Datenordner.
// Ablauf: Original bleibt unverändert → ffmpeg erzeugt eine Arbeitskopie (16 kHz, mono) → whisper-cli →
// Transkript wird als eigener Eintrag „transcript“ in die Beweiskette geschrieben (Bezug: Tondatei).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, kvGet, kvSet, WORK_DIR } from './db.js';
import { allRows, append, parsePayload } from './evidence.js';
import { storedPath } from './files.js';

const BIN = process.env.WHISPER_BIN || 'whisper-cli';
const SHARED_DIR = process.env.MODEL_DIR || '/models';
const OWN_DIR = path.join(DATA_DIR, 'whisper');
const MODEL_URL = process.env.WHISPER_MODEL_URL || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}';
export const MODELS = {
  small: { file: 'ggml-small.bin', size: '≈ 470 MB', info: 'gut und schnell (auch von der Video-Zentrale genutzt)' },
  'large-v3-turbo-q5_0': { file: 'ggml-large-v3-turbo-q5_0.bin', size: '≈ 550 MB', info: 'sehr genau, etwa 2–3 × langsamer als small' },
  medium: { file: 'ggml-medium.bin', size: '≈ 1,5 GB', info: 'sehr genau, deutlich langsamer' },
};

export const config = () => ({ model: 'small', modelFast: 'small', threads: 4, ...kvGet('whisper', {}) });
export function setConfig(c) {
  const cur = config();
  const next = {
    model: MODELS[c.model] ? c.model : cur.model,
    modelFast: MODELS[c.modelFast] ? c.modelFast : cur.modelFast,
    threads: Math.max(1, Math.min(16, Number(c.threads) || cur.threads)),
  };
  kvSet('whisper', next);
  if (download?.error) download = null; // alte Fehlermeldung nach Modellwechsel nicht mehr anzeigen
  return next;
}

let promptWords = '';
export const setPromptWords = (w) => { promptWords = String(w || '').replace(/\s+/g, ' ').slice(0, 600); };

// ------------------------------------------------------------ Modelle
function findModel(name) {
  const file = MODELS[name]?.file;
  if (!file) return null;
  for (const dir of [SHARED_DIR, OWN_DIR]) { const f = path.join(dir, file); if (fs.existsSync(f)) return f; }
  return null;
}
function writableDir() {
  try { if (fs.existsSync(SHARED_DIR)) { fs.accessSync(SHARED_DIR, fs.constants.W_OK); return SHARED_DIR; } } catch { /* nur lesend */ }
  fs.mkdirSync(OWN_DIR, { recursive: true });
  return OWN_DIR;
}
let download = null; // { model, done, total, error }
async function ensureModel(name) {
  const found = findModel(name);
  if (found) return found;
  if (download?.model === name && !download.error) {
    while (download && download.model === name && !download.error) await new Promise((r) => setTimeout(r, 2000));
    if (findModel(name)) return findModel(name);
  }
  const dir = writableDir();
  const file = path.join(dir, MODELS[name].file);
  const part = `${file}.mlz-part`;
  download = { model: name, done: 0, total: 0, error: '' };
  try {
    const r = await fetch(MODEL_URL.replace('{file}', MODELS[name].file));
    if (!r.ok || !r.body) throw new Error(`Download fehlgeschlagen (${r.status})`);
    download.total = Number(r.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(part);
    for await (const chunk of r.body) {
      download.done += chunk.length;
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    fs.renameSync(part, file);
    download = null;
    return file;
  } catch (e) {
    fs.rmSync(part, { force: true });
    download = { ...download, error: `Modell ${name} konnte nicht geladen werden: ${e.message}` };
    throw new Error(download.error);
  }
}

// ------------------------------------------------------------ Warteschlange
const state = new Map(); // fileId → { status: queued|running|error, error, fast }
const queue = [];
let busy = false;

let transcripts = null; // fileId → { text, model, seconds }
export function transcriptOf(fileId) {
  if (!transcripts) {
    transcripts = new Map();
    for (const r of allRows()) if (r.kind === 'transcript' && r.payload) transcripts.set(r.ref, { ...parsePayload(r), seq: r.seq, receivedAt: r.received_at });
  }
  return transcripts.get(fileId) || null;
}
export const resetCache = () => { transcripts = null; };

export function status(fileId) {
  const t = transcriptOf(fileId);
  if (t) return { status: 'done', ...t };
  const s = state.get(fileId);
  if (s) return { ...s, position: s.status === 'queued' ? queue.indexOf(fileId) + 1 : 0, download: download && { ...download } };
  return { status: 'none' };
}

export function enqueue(fileId, { fast = false, front = false } = {}) {
  if (transcriptOf(fileId) || (state.get(fileId) && state.get(fileId).status !== 'error')) return;
  state.set(fileId, { status: 'queued', fast });
  if (front) queue.unshift(fileId); else queue.push(fileId);
  setImmediate(work);
}

function run(cmd, args) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn('nice', ['-n', '10', cmd, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
    p.on('close', (code) => resolve({ code, err }));
  });
}

async function whisper(wav, model, threads) {
  const base = wav.replace(/\.wav$/, '');
  const args = ['-m', model, '-f', wav, '-l', 'de', '-t', String(threads), '-oj', '-of', base, '-np'];
  if (promptWords) args.push('--prompt', promptWords);
  try {
    const r = await run(BIN, args);
    if (r.code !== 0) throw new Error(r.code === -1 ? 'whisper.cpp fehlt im Container' : `whisper.cpp: ${r.err.trim().split('\n').pop() || r.code}`);
    const j = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    return (j.transcription || []).map((x) => String(x.text || '')).join('').replace(/\s+/g, ' ').trim();
  } finally {
    fs.rmSync(`${base}.json`, { force: true });
  }
}

async function work() {
  if (busy) return;
  const fileId = queue.shift();
  if (!fileId) return;
  busy = true;
  const s = state.get(fileId);
  s.status = 'running'; s.startedAt = new Date().toISOString();
  const wav = path.join(WORK_DIR, `${fileId}.wav`);
  try {
    const row = allRows().find((r) => r.id === fileId);
    const p = row && parsePayload(row);
    if (!p) throw new Error('Datei nicht gefunden');
    const c = config();
    const name = s.fast ? c.modelFast : c.model;
    s.status = findModel(name) ? 'running' : 'download';
    const model = await ensureModel(name);
    s.status = 'running';
    const conv = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', storedPath(p), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    if (conv.code !== 0) throw new Error(`ffmpeg: ${conv.err.trim().split('\n').pop() || conv.code}`);
    const t0 = Date.now();
    let text = await whisper(wav, model, c.threads);
    if (!text || /^\[(blank_audio|stille|musik)\]$/i.test(text)) text = '(keine Sprache erkannt)';
    const seconds = Math.round((Date.now() - t0) / 1000);
    append({ id: `tr-${fileId}`, kind: 'transcript', ref: fileId, device: 'Server', payload: { text, model: name, engine: 'whisper.cpp (lokal)', language: 'de', seconds, automatic: true } });
    state.delete(fileId);
    kvSet('whisperLast', { at: new Date().toISOString(), ok: true, model: name, seconds, audioSec: p.durationSec });
  } catch (e) {
    s.status = 'error'; s.error = e.message;
    kvSet('whisperLast', { at: new Date().toISOString(), ok: false, error: e.message });
  } finally {
    fs.rmSync(wav, { force: true });
    busy = false;
    setImmediate(work);
  }
}

/** Nach dem Start: alle Tonaufnahmen ohne Transkript einreihen. */
export function resumePending() {
  for (const r of allRows()) {
    if (r.kind !== 'file' || !r.payload) continue;
    const p = parsePayload(r);
    if (p.purpose?.includes('audio') && !transcriptOf(r.id)) enqueue(r.id, { fast: p.purpose === 'time-audio' });
  }
}

export function retry(fileId) {
  const s = state.get(fileId);
  if (s?.status === 'error') { state.delete(fileId); enqueue(fileId, { fast: s.fast, front: true }); }
}

let binOk = null;
async function binaryOk() {
  if (binOk === null) { const r = await run(BIN, ['--help']); binOk = r.code === 0 || /usage/i.test(r.err); }
  return binOk;
}

export async function serviceStatus() {
  const c = config();
  return {
    engine: 'whisper.cpp', ready: await binaryOk(), ...c,
    models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => {
      const f = findModel(k);
      return [k, { ...m, installed: !!f, shared: !!f && f.startsWith(SHARED_DIR) }];
    })),
    sharedDir: fs.existsSync(SHARED_DIR) ? SHARED_DIR : '', download: download && { ...download },
    queue: queue.length, busy, last: kvGet('whisperLast'),
  };
}

/** Gewählte Modelle vorab laden (im Hintergrund). */
export async function preloadModels() {
  const c = config();
  for (const m of new Set([c.modelFast, c.model])) { try { await ensureModel(m); } catch (e) { console.warn(e.message); } }
}
