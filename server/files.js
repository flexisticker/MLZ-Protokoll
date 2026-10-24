// Originaldateien (Sprachaufnahmen, Fotos, Anlagen): werden beim Empfang geprüft (SHA-256 vom Handy
// = SHA-256 auf dem Server), schreibgeschützt abgelegt und in die Beweiskette eingetragen.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FILES_DIR, WORK_DIR } from './db.js';
import { append, getRow, parsePayload } from './evidence.js';

const EXT = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif',
  'application/pdf': 'pdf',
};
const LIMIT = { audio: 150e6, photo: 60e6, attachment: 200e6 };
export const PURPOSES = ['audio', 'time-audio', 'photo', 'attachment'];

const baseMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();
const safeId = (s) => /^[A-Za-z0-9-]{8,64}$/.test(String(s || ''));

export function storedPath(p) {
  const full = path.resolve(FILES_DIR, p.path);
  if (!full.startsWith(FILES_DIR + path.sep)) throw new Error('Ungültiger Pfad');
  return full;
}

/** Upload als Datenstrom empfangen. */
export async function receiveUpload(req, device) {
  const id = String(req.get('x-file-id') || '');
  const purpose = String(req.get('x-purpose') || '');
  const clientSha = String(req.get('x-sha256') || '').toLowerCase();
  const mime = baseMime(req.get('content-type'));
  if (!safeId(id)) throw Object.assign(new Error('Ungültige Datei-Kennung'), { status: 400 });
  if (!PURPOSES.includes(purpose)) throw Object.assign(new Error('Unbekannte Dateiart'), { status: 400 });
  const ext = EXT[mime];
  if (!ext) throw Object.assign(new Error(`Dateityp ${mime || '?'} wird nicht angenommen`), { status: 415 });
  if (purpose.includes('audio') && !mime.startsWith('audio/')) throw Object.assign(new Error('Keine Tondatei'), { status: 415 });
  if (purpose === 'photo' && !mime.startsWith('image/')) throw Object.assign(new Error('Kein Bild'), { status: 415 });

  const existing = getRow(id);
  if (existing) { req.resume(); return { row: existing, duplicate: true }; }

  const limit = LIMIT[purpose === 'time-audio' ? 'audio' : purpose];
  const tmp = path.join(WORK_DIR, `upload-${crypto.randomUUID()}`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); out.destroy(); reject(Object.assign(new Error('Datei zu groß'), { status: 413 })); return; }
      hash.update(c);
    });
    req.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    req.pipe(out);
  }).catch((e) => { fs.rmSync(tmp, { force: true }); throw e; });

  const sha = hash.digest('hex');
  if (!size) { fs.rmSync(tmp, { force: true }); throw Object.assign(new Error('Leere Datei'), { status: 400 }); }
  if (clientSha && clientSha !== sha) {
    fs.rmSync(tmp, { force: true });
    throw Object.assign(new Error('Prüfsumme stimmt nicht – Übertragung fehlerhaft, wird erneut gesendet'), { status: 422 });
  }
  const year = new Date().getFullYear();
  const rel = `${year}/${id}.${ext}`;
  fs.mkdirSync(path.join(FILES_DIR, String(year)), { recursive: true });
  const dest = path.join(FILES_DIR, rel);
  fs.renameSync(tmp, dest);
  fs.chmodSync(dest, 0o444);

  const capturedAt = String(req.get('x-captured-at') || '').slice(0, 40) || null;
  const name = decodeURIComponent(String(req.get('x-name') || '')).replace(/[\\/\0]/g, '_').slice(0, 120);
  const payload = {
    purpose, mime, size, sha256: sha, clientSha256: clientSha || null, path: rel, name,
    draftId: String(req.get('x-draft') || '').slice(0, 64) || null,
    durationSec: Number(req.get('x-duration')) || null,
  };
  return append({ id, kind: 'file', capturedAt, device, payload });
}

export function fileInfo(id) {
  const r = getRow(id);
  if (!r || r.kind !== 'file') return null;
  const p = parsePayload(r);
  return p ? { ...p, id: r.id, seq: r.seq, receivedAt: r.received_at, capturedAt: r.captured_at } : { id: r.id, erased: true };
}

/** Prüft, ob alle Originaldateien noch unverändert vorhanden sind. */
export function verifyFiles(rows) {
  const problems = [];
  let n = 0;
  for (const r of rows) {
    if (r.kind !== 'file' || r.payload == null) continue;
    const p = JSON.parse(r.payload);
    n++;
    let full;
    try { full = storedPath(p); } catch { problems.push({ id: r.id, seq: r.seq, problem: 'Pfad ungültig' }); continue; }
    if (!fs.existsSync(full)) { problems.push({ id: r.id, seq: r.seq, problem: 'Datei fehlt' }); continue; }
    const h = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    if (h !== p.sha256) problems.push({ id: r.id, seq: r.seq, problem: 'Datei verändert' });
  }
  return { ok: !problems.length, files: n, problems };
}

export function removeStored(p) {
  try {
    const full = storedPath(p);
    fs.chmodSync(full, 0o644);
    fs.rmSync(full, { force: true });
  } catch { /* schon weg */ }
}
