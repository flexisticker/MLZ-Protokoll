// Beweiskette: jeder Eintrag wird nur angehängt, nie geändert oder gelöscht.
//
// hash = SHA-256( prev_hash | seq | id | kind | ref | event_at | captured_at | received_at | payload_hash | device )
// payload_hash = SHA-256( kanonisches JSON des Inhalts )
//
// Weil die Kette über payload_hash läuft, bleibt sie auch prüfbar, wenn ein Inhalt nach Ablauf der
// Aufbewahrungsfrist gelöscht wurde (Löschvermerk „erase“ – nur dann lässt der Datenbank-Trigger das zu).
import crypto from 'node:crypto';
import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS evidence (
  seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, ref TEXT,
  event_at TEXT, captured_at TEXT, received_at TEXT NOT NULL, device TEXT,
  payload TEXT, payload_hash TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_kind ON evidence (kind);
CREATE INDEX IF NOT EXISTS evidence_ref ON evidence (ref);
CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'Beweiskette ist unveränderbar'); END;
CREATE TRIGGER IF NOT EXISTS evidence_no_update BEFORE UPDATE ON evidence
WHEN NOT (
  NEW.payload IS NULL AND OLD.payload IS NOT NULL
  AND NEW.seq = OLD.seq AND NEW.id = OLD.id AND NEW.kind = OLD.kind AND NEW.ref IS OLD.ref
  AND NEW.event_at IS OLD.event_at AND NEW.captured_at IS OLD.captured_at AND NEW.received_at = OLD.received_at
  AND NEW.device IS OLD.device AND NEW.payload_hash = OLD.payload_hash AND NEW.prev_hash = OLD.prev_hash AND NEW.hash = OLD.hash
  AND EXISTS (SELECT 1 FROM evidence e WHERE e.kind = 'erase' AND e.ref = OLD.id)
)
BEGIN SELECT RAISE(ABORT, 'Beweiskette ist unveränderbar'); END;
`);

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Schlüssel sortiert serialisieren, damit der Hash unabhängig von der Reihenfolge ist. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export const GENESIS = 'GENESIS';
export const rowHash = (r) => sha256([r.prev_hash, r.seq, r.id, r.kind, r.ref || '', r.event_at || '', r.captured_at || '', r.received_at, r.payload_hash, r.device || ''].join('|'));

const listeners = new Set();
export const onAppend = (fn) => listeners.add(fn);

/**
 * Eintrag anhängen. Gleiche id (vom Handy vergeben) = schon vorhanden → vorhandenen Eintrag zurückgeben
 * (doppelte Übertragung aus der Warteschlange).
 */
export function append({ id = crypto.randomUUID(), kind, ref = null, eventAt = null, capturedAt = null, device = '', payload }) {
  const existing = db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
  if (existing) return { row: existing, duplicate: true };
  db.exec('BEGIN IMMEDIATE');
  try {
    const last = db.prepare('SELECT seq, hash FROM evidence ORDER BY seq DESC LIMIT 1').get();
    const text = canonical(payload ?? null);
    const r = {
      seq: (last?.seq || 0) + 1, id: String(id), kind, ref: ref ? String(ref) : null,
      event_at: eventAt || null, captured_at: capturedAt || null, received_at: new Date().toISOString(),
      device: String(device || '').slice(0, 160), payload: text, payload_hash: sha256(text), prev_hash: last?.hash || GENESIS,
    };
    r.hash = rowHash(r);
    db.prepare(`INSERT INTO evidence (seq, id, kind, ref, event_at, captured_at, received_at, device, payload, payload_hash, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.seq, r.id, r.kind, r.ref, r.event_at, r.captured_at, r.received_at, r.device, r.payload, r.payload_hash, r.prev_hash, r.hash);
    db.exec('COMMIT');
    for (const fn of listeners) { try { fn(r); } catch (e) { console.error(e); } }
    return { row: r, duplicate: false };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Inhalt löschen (nur nach Löschvermerk). Die Kette bleibt intakt. */
export function erasePayload(targetId, reason, device) {
  const t = db.prepare('SELECT * FROM evidence WHERE id = ?').get(targetId);
  if (!t || t.payload == null) return null;
  const mark = append({ kind: 'erase', ref: targetId, device, payload: { reason: String(reason || '').slice(0, 500), targetSeq: t.seq, targetKind: t.kind } });
  db.prepare('UPDATE evidence SET payload = NULL WHERE id = ?').run(targetId);
  for (const fn of listeners) { try { fn(mark.row); } catch {} }
  return mark.row;
}

export const head = () => db.prepare('SELECT seq, hash, received_at FROM evidence ORDER BY seq DESC LIMIT 1').get() || { seq: 0, hash: GENESIS };
export const allRows = () => db.prepare('SELECT * FROM evidence ORDER BY seq').all();
export const getRow = (id) => db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);

export const parsePayload = (r) => (r.payload == null ? null : JSON.parse(r.payload));

/** Kette vollständig nachrechnen. */
export function verifyChain() {
  let prev = GENESIS, n = 0, erased = 0;
  for (const r of db.prepare('SELECT * FROM evidence ORDER BY seq').iterate()) {
    n++;
    if (r.seq !== n) return { ok: false, entries: n - 1, brokenAt: r.seq, reason: `Lücke in der Nummerierung vor Nr. ${r.seq}` };
    if (r.prev_hash !== prev) return { ok: false, entries: n - 1, brokenAt: r.seq, reason: `Verkettung bei Nr. ${r.seq} unterbrochen` };
    if (r.hash !== rowHash(r)) return { ok: false, entries: n - 1, brokenAt: r.seq, reason: `Prüfsumme von Nr. ${r.seq} stimmt nicht` };
    if (r.payload == null) erased++;
    else if (sha256(r.payload) !== r.payload_hash) return { ok: false, entries: n - 1, brokenAt: r.seq, reason: `Inhalt von Nr. ${r.seq} wurde verändert` };
    prev = r.hash;
  }
  return { ok: true, entries: n, erased, head: prev, checkedAt: new Date().toISOString() };
}
