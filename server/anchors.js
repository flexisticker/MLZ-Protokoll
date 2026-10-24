// Tägliche Zeitstempel (RFC 3161) auf den aktuellen Stand der Beweiskette.
// Ein fremder Zeitstempeldienst bestätigt mit seiner Signatur: „Dieser Prüfwert existierte zu dieser Zeit.“
// Damit lässt sich nicht behaupten, die Einträge seien nachträglich erzeugt worden.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ANCHOR_DIR, db } from './db.js';
import { head } from './evidence.js';

const run = promisify(execFile);

db.exec(`
CREATE TRIGGER IF NOT EXISTS anchors_no_delete BEFORE DELETE ON anchors BEGIN SELECT RAISE(ABORT, 'Zeitstempel sind unveränderbar'); END;
CREATE TRIGGER IF NOT EXISTS anchors_no_update BEFORE UPDATE ON anchors
WHEN NEW.day IS NOT OLD.day OR NEW.seq IS NOT OLD.seq OR NEW.head_hash IS NOT OLD.head_hash OR NEW.results IS NOT OLD.results OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'Zeitstempel sind unveränderbar'); END;
`);
export const TSAS = (process.env.TSA_URLS || 'https://freetsa.org/tsr,http://timestamp.digicert.com')
  .split(',').map((u) => u.trim()).filter(Boolean)
  .map((url) => ({ url, name: new URL(url).hostname.replace(/^(www|timestamp)\./, '') }));
const CA_BUNDLE = process.env.TSA_CA_FILE || '/etc/ssl/certs/ca-certificates.crt';
const FREETSA_CA = 'https://freetsa.org/files/cacert.pem';

async function queryFile(digest, file) {
  await run('openssl', ['ts', '-query', '-digest', digest, '-sha256', '-cert', '-no_nonce', '-out', file]);
}

async function replyTime(tsr) {
  const { stdout } = await run('openssl', ['ts', '-reply', '-in', tsr, '-text']);
  const status = /Status: Granted/i.test(stdout) || /Status: granted/i.test(stdout);
  const m = stdout.match(/Time stamp: (.+)/);
  const dig = stdout.match(/Message data:\s*([\s\S]*?)\n\s*(Serial|Policy)/);
  return { granted: status, time: m ? m[1].trim() : '', text: stdout.slice(0, 4000), hasDigest: !!dig };
}

/** CA-Datei für einen Dienst (FreeTSA hat eine eigene Wurzel, die einmalig geladen wird). */
async function caFor(name) {
  if (name.includes('freetsa')) {
    const f = path.join(ANCHOR_DIR, 'freetsa-cacert.pem');
    if (!fs.existsSync(f)) {
      try { const r = await fetch(FREETSA_CA, { signal: AbortSignal.timeout(15000) }); if (r.ok) fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } catch { /* später erneut */ }
    }
    return fs.existsSync(f) ? f : null;
  }
  const own = path.join(ANCHOR_DIR, `${name}-ca.pem`);
  if (fs.existsSync(own)) return own;
  return fs.existsSync(CA_BUNDLE) ? CA_BUNDLE : null;
}

export async function verifyToken(tsrFile, digest, name) {
  const ca = await caFor(name);
  if (!ca) return { ok: false, error: 'Zertifikat des Dienstes nicht verfügbar' };
  try {
    await run('openssl', ['ts', '-verify', '-digest', digest, '-in', tsrFile, '-CAfile', ca]);
    return { ok: true, ca: path.basename(ca) };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).trim().split('\n').slice(-2).join(' ').slice(0, 300) };
  }
}

/** Zeitstempel für den aktuellen Kopf der Kette holen (bei allen Diensten). */
export async function anchorNow(day = new Date().toISOString().slice(0, 10)) {
  const h = head();
  if (!h.seq) return { skipped: 'Noch keine Einträge' };
  const last = db.prepare('SELECT * FROM anchors ORDER BY id DESC LIMIT 1').get();
  if (last && last.seq === h.seq && JSON.parse(last.results).some((r) => r.ok)) return { skipped: 'Kein neuer Eintrag seit dem letzten Zeitstempel', anchor: last };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tsq = path.join(ANCHOR_DIR, `${stamp}.tsq`);
  await queryFile(h.hash, tsq);
  const body = fs.readFileSync(tsq);
  const results = [];
  for (const tsa of TSAS) {
    const file = `${stamp}-${tsa.name}.tsr`;
    try {
      const r = await fetch(tsa.url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(path.join(ANCHOR_DIR, file), buf);
      const info = await replyTime(path.join(ANCHOR_DIR, file));
      if (!info.granted) throw new Error('Dienst hat den Zeitstempel verweigert');
      const v = await verifyToken(path.join(ANCHOR_DIR, file), h.hash, tsa.name);
      results.push({ tsa: tsa.name, url: tsa.url, file, ok: true, time: info.time, verified: v.ok, verifyError: v.error || '' });
    } catch (e) {
      results.push({ tsa: tsa.name, url: tsa.url, ok: false, error: e.cause?.code || e.message });
    }
  }
  fs.rmSync(tsq, { force: true });
  db.prepare('INSERT INTO anchors (day, seq, head_hash, created_at, results) VALUES (?, ?, ?, ?, ?)')
    .run(day, h.seq, h.hash, new Date().toISOString(), JSON.stringify(results));
  return { anchor: db.prepare('SELECT * FROM anchors ORDER BY id DESC LIMIT 1').get() };
}

export const listAnchors = (limit = 400) => db.prepare('SELECT * FROM anchors ORDER BY id DESC LIMIT ?').all(limit)
  .map((a) => ({ ...a, results: JSON.parse(a.results) }));

/** Erster erfolgreicher Zeitstempel, der Eintrag Nr. seq abdeckt. */
export function anchorFor(seq) {
  const rows = db.prepare('SELECT * FROM anchors WHERE seq >= ? ORDER BY id').all(seq);
  for (const a of rows) {
    const res = JSON.parse(a.results).filter((r) => r.ok);
    if (res.length) return { ...a, results: res };
  }
  return null;
}

export const anchorFile = (name) => {
  if (!/^[\w.-]+\.(tsr|pem)$/.test(name)) return null;
  const f = path.join(ANCHOR_DIR, name);
  return fs.existsSync(f) ? f : null;
};
export { caFor };
