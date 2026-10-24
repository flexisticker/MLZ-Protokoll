// Spracherkennung über den lokalen Whisper-Dienst (speaches, OpenAI-kompatibel). Keine Cloud.
// Ablauf: Original bleibt unverändert → ffmpeg erzeugt eine Arbeitskopie (16 kHz, mono) → Whisper →
// Transkript wird als eigener Eintrag „transcript“ in die Beweiskette geschrieben (Bezug: Tondatei).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { kvGet, kvSet, WORK_DIR } from './db.js';
import { allRows, append, parsePayload } from './evidence.js';
import { storedPath } from './files.js';

export const WHISPER_URL = (process.env.WHISPER_URL || 'http://speaches:8000').replace(/\/$/, '');
export const MODEL = process.env.WHISPER_MODEL || 'deepdml/faster-whisper-large-v3-turbo-ct2';
export const MODEL_FAST = process.env.WHISPER_MODEL_FAST || 'Systran/faster-whisper-small';

const state = new Map(); // fileId → { status: queued|running|error, error, startedAt }
const queue = [];
let busy = false;
let promptWords = '';
export const setPromptWords = (w) => { promptWords = String(w || '').slice(0, 600); };

export function status(fileId) {
  if (transcriptOf(fileId)) return { status: 'done', ...transcriptOf(fileId) };
  const s = state.get(fileId);
  if (s) return { ...s, position: s.status === 'queued' ? queue.indexOf(fileId) + 1 : 0 };
  return { status: 'none' };
}

let transcripts = null; // fileId → { text, model, seconds }
export function transcriptOf(fileId) {
  if (!transcripts) {
    transcripts = new Map();
    for (const r of allRows()) if (r.kind === 'transcript' && r.payload) transcripts.set(r.ref, { ...parsePayload(r), seq: r.seq, receivedAt: r.received_at });
  }
  return transcripts.get(fileId) || null;
}
export const resetCache = () => { transcripts = null; };

export function enqueue(fileId, { fast = false, front = false } = {}) {
  if (transcriptOf(fileId) || (state.get(fileId) && state.get(fileId).status !== 'error')) return;
  state.set(fileId, { status: 'queued', fast });
  if (front) queue.unshift(fileId); else queue.push(fileId);
  setImmediate(work);
}

function ffmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.trim().slice(0, 300) || code}`))));
  });
}

async function ensureModel(model) {
  // speaches lädt Modelle erst nach ausdrücklicher Anforderung herunter (einmalig, ~1,6 GB für large-v3-turbo)
  const r = await fetch(`${WHISPER_URL}/v1/models/${model}`, { method: 'POST', signal: AbortSignal.timeout(30 * 60000) });
  if (!r.ok && r.status !== 409) throw new Error(`Modell ${model} konnte nicht geladen werden (${r.status})`);
}

async function callWhisper(wav, model) {
  const send = async () => {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), 'aufnahme.wav');
    form.append('model', model);
    form.append('language', 'de');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (promptWords) form.append('prompt', promptWords);
    return fetch(`${WHISPER_URL}/v1/audio/transcriptions`, { method: 'POST', body: form, signal: AbortSignal.timeout(30 * 60000) });
  };
  let r = await send();
  if (r.status === 404 || r.status === 400) {
    const body = await r.text();
    if (/model|not found|download|installed/i.test(body)) { await ensureModel(model); r = await send(); }
    else throw new Error(`Whisper ${r.status}: ${body.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return String(j.text || '').trim();
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
    await ffmpeg(storedPath(p), wav);
    const t0 = Date.now();
    const model = s.fast ? MODEL_FAST : MODEL;
    let text = await callWhisper(wav, model);
    if (text === '') text = '(keine Sprache erkannt)';
    append({ id: `tr-${fileId}`, kind: 'transcript', ref: fileId, device: 'Server', payload: { text, model, engine: 'whisper (lokal)', language: 'de', seconds: Math.round((Date.now() - t0) / 1000), automatic: true } });
    state.delete(fileId);
    kvSet('whisperLast', { at: new Date().toISOString(), ok: true, model, seconds: Math.round((Date.now() - t0) / 1000), audioSec: p.durationSec });
  } catch (e) {
    s.status = 'error'; s.error = e.cause?.code === 'ECONNREFUSED' || /fetch failed/.test(e.message) ? 'Spracherkennung nicht erreichbar' : e.message;
    kvSet('whisperLast', { at: new Date().toISOString(), ok: false, error: s.error });
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

export async function serviceStatus() {
  try {
    const r = await fetch(`${WHISPER_URL}/v1/models`, { signal: AbortSignal.timeout(4000) });
    const j = r.ok ? await r.json() : null;
    return { reachable: r.ok, url: WHISPER_URL, model: MODEL, modelFast: MODEL_FAST, installed: (j?.data || []).map((m) => m.id), queue: queue.length, busy, last: kvGet('whisperLast') };
  } catch (e) {
    return { reachable: false, url: WHISPER_URL, model: MODEL, modelFast: MODEL_FAST, error: e.message, queue: queue.length, busy, last: kvGet('whisperLast') };
  }
}

export async function preloadModels() {
  for (const m of [MODEL_FAST, MODEL]) { try { await ensureModel(m); } catch (e) { console.warn(e.message); } }
}

export function retry(fileId) {
  const s = state.get(fileId);
  if (s?.status === 'error') { state.delete(fileId); enqueue(fileId, { fast: s.fast, front: true }); }
}
