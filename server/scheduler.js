// Nächtliche Aufgaben: Zeitstempel, Prüfsummen-Mail, Sicherung, Kettenprüfung.
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR, db, kvGet, kvSet } from './db.js';
import { anchorNow } from './anchors.js';
import { mailAnchor } from './mail.js';
import { allRows, verifyChain } from './evidence.js';
import { verifyFiles } from './files.js';
import { build } from './state.js';
import { purgeSessions } from './auth.js';

const KEEP_BACKUPS = Number(process.env.KEEP_BACKUPS || 30);

export function backupNow() {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `mlz-${day}.sqlite`);
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const list = fs.readdirSync(BACKUP_DIR).filter((f) => /^mlz-\d{4}-\d\d-\d\d\.sqlite$/.test(f)).sort();
  for (const f of list.slice(0, Math.max(0, list.length - KEEP_BACKUPS))) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  kvSet('lastBackup', { at: new Date().toISOString(), file: path.basename(file), size: fs.statSync(file).size });
  return kvGet('lastBackup');
}

export function fullCheck() {
  const chain = verifyChain();
  const files = verifyFiles(allRows());
  const res = { at: new Date().toISOString(), chain, files, ok: chain.ok && files.ok };
  kvSet('lastCheck', res);
  return res;
}

let running = false;
async function nightly(day = localDay()) {
  if (running) return;
  running = true;
  try {
    const r = await anchorNow(day).catch((e) => ({ error: e.message }));
    kvSet('lastAnchorRun', { at: new Date().toISOString(), ...(r.error ? { error: r.error } : r.skipped ? { skipped: r.skipped } : { ok: true }) });
    if (r.anchor) await mailAnchor(r.anchor, build().settings).catch((e) => kvSet('lastMailError', { at: new Date().toISOString(), error: e.message }));
    backupNow();
    fullCheck();
    purgeSessions();
    kvSet('lastNightly', day);
  } catch (e) {
    console.error('Nachtlauf:', e);
  } finally {
    running = false;
  }
}

/** Jede Viertelstunde prüfen; nachts ab 23:30 (Ortszeit) bzw. nachholen, wenn der Server aus war. */
export function startScheduler() {
  const tick = () => {
    const now = new Date();
    const local = now.toLocaleString('sv-SE', { timeZone: process.env.TZ || 'Europe/Berlin' });
    const [d, t] = local.split(' ');
    const last = kvGet('lastNightly');
    if ((t >= '23:30' && last !== d) || (last && last < addDay(d, -1))) nightly(t >= '23:30' ? d : addDay(d, -1));
  };
  setInterval(tick, 15 * 60000).unref();
  setTimeout(tick, 20000).unref();
}
export const localDay = () => new Date().toLocaleString('sv-SE', { timeZone: process.env.TZ || 'Europe/Berlin' }).slice(0, 10);

/** Kurz nach neuen Einträgen zusätzlich stempeln (gebündelt), damit der Zeitstempel nah am Ereignis liegt. */
let soon = null;
export function anchorSoon(delayMs = 10 * 60000) {
  if (soon) return;
  soon = setTimeout(async () => { soon = null; try { const r = await anchorNow(localDay()); kvSet('lastAnchorRun', { at: new Date().toISOString(), ...(r.skipped ? { skipped: r.skipped } : { ok: true }) }); } catch (e) { kvSet('lastAnchorRun', { at: new Date().toISOString(), error: e.message }); } }, delayMs);
  soon.unref?.();
}
const addDay = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export { nightly };
