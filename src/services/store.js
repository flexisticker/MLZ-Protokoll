// Zentraler Zustand: Serverstand, Entwürfe, Warteschlange (offline), Abgleich.
import { reactive } from 'vue';
import { api, ApiError } from './api.js';
import { idbAll, idbDel, idbGet, idbPut } from './idb.js';
import { sha256Blob } from './hash.js';
import { debounce, localNow, uuid } from './util.js';
import { withDefaults } from '../../shared/worktime.js';
import { aiSummary, mergeAssist } from '../../shared/assist.js';

export async function loadAssist() {
  try { store.assist = await api('/assist/status'); } catch { /* offline: letzter Stand bleibt */ }
}

export const store = reactive({
  ready: false,
  session: null, // { setup, user, version }
  data: null, // Serverstand (Lesesicht der Beweiskette)
  drafts: [],
  assist: { engine: 'off' }, // KI-Ausfüllhilfe (Stand vom Server)
  outbox: [], // { id, type, label, error, tries, createdAt }
  online: navigator.onLine,
  syncing: false,
  lastSync: null,
  error: '',
  toast: '',
});

export const settings = () => withDefaults(store.data?.settings);

let toastTimer;
export function toast(msg) {
  store.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { store.toast = ''; }, 3500);
}

const device = () => {
  const ua = navigator.userAgent;
  return /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : 'Browser';
};

// ------------------------------------------------------------ Warteschlange
async function loadOutbox() {
  const items = await idbAll('outbox');
  store.outbox = items.sort((a, b) => a.seq - b.seq).map(({ blob, ...rest }) => rest);
}
let outSeq = Date.now();

/** Datei aufnehmen: Prüfsumme sofort bilden, in die Warteschlange, dann senden. */
export async function queueFile(blob, { purpose, name = '', draftId = '', capturedAt = new Date().toISOString(), durationSec = null, assist = false }) {
  const id = uuid();
  const sha256 = await sha256Blob(blob);
  const mime = (blob.type || 'application/octet-stream').split(';')[0];
  const item = { id, seq: outSeq++, type: 'file', purpose, mime, name, draftId, capturedAt, durationSec, sha256, assist, size: blob.size, blob, createdAt: new Date().toISOString(), label: purpose === 'photo' ? 'Foto' : purpose.includes('audio') ? 'Sprachaufnahme' : 'Datei', tries: 0 };
  await idbPut('outbox', item);
  await loadOutbox();
  sync();
  return { id, sha256, mime, size: blob.size, capturedAt };
}

/** Eintrag in die Beweiskette (über die Warteschlange). */
export async function queueEvidence(kind, payload, { ref = null, id = null, label = '' } = {}) {
  // Vue-Objekte (reaktiv) lassen sich nicht in IndexedDB speichern → als einfache Kopie ablegen
  const item = { id: id || uuid(), seq: outSeq++, type: 'evidence', kind, ref, payload: JSON.parse(JSON.stringify(payload ?? null)), capturedAt: new Date().toISOString(), device: device(), createdAt: new Date().toISOString(), label: label || kind, tries: 0 };
  await idbPut('outbox', item);
  await loadOutbox();
  await sync();
  return item.id;
}

/** Lokal noch nicht gesendete Datei (zum Abspielen/Anzeigen). */
export async function pendingBlob(id) {
  const it = await idbGet('outbox', id);
  return it?.blob || null;
}

let syncPromise = null;
let again = null;
/** Abgleich; läuft schon einer, wird danach genau ein weiterer angehängt (neue Einträge gehen nicht verloren). */
export function sync() {
  if (syncPromise) {
    if (!again) again = syncPromise.then(() => { again = null; return sync(); });
    return again;
  }
  syncPromise = doSync().finally(() => { syncPromise = null; });
  return syncPromise;
}
async function doSync() {
  if (!store.session?.user) return;
  store.syncing = true;
  try {
    const items = (await idbAll('outbox')).sort((a, b) => a.seq - b.seq);
    for (const it of items) {
      try {
        if (it.type === 'file') {
          await api('/files', {
            method: 'POST', body: it.blob,
            headers: { 'Content-Type': it.mime, 'x-file-id': it.id, 'x-purpose': it.purpose, 'x-sha256': it.sha256, 'x-captured-at': it.capturedAt, 'x-name': encodeURIComponent(it.name || ''), 'x-draft': it.draftId || '', 'x-duration': String(it.durationSec || ''), ...(it.assist ? { 'x-assist': '1' } : {}) },
          });
        } else {
          await api('/evidence', { method: 'POST', body: { id: it.id, kind: it.kind, ref: it.ref, capturedAt: it.capturedAt, payload: it.payload } });
        }
        await idbDel('outbox', it.id);
      } catch (e) {
        if (e.status === 0) { store.online = false; break; } // offline – später erneut
        if (e.status === 401) break;
        it.tries = (it.tries || 0) + 1;
        it.error = e.message;
        await idbPut('outbox', it);
        if (e.status === 422 && it.tries < 5) continue; // Übertragungsfehler → nächster Versuch beim nächsten Abgleich
        break; // Reihenfolge einhalten (Einträge brauchen ihre Dateien)
      }
    }
    store.online = true;
    await loadOutbox();
    await refresh();
    await pushDrafts();
    await loadDrafts().catch(() => {});
    store.lastSync = new Date().toISOString();
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) store.online = false;
    else store.error = e.message;
  } finally {
    store.syncing = false;
    await loadOutbox().catch(() => {});
  }
}

export async function removeOutboxItem(id) { await idbDel('outbox', id); await loadOutbox(); }

export async function refresh() {
  const d = await api('/state');
  store.data = d;
  idbPut('cache', { k: 'state', v: d }).catch(() => {}); // letzter Stand für die Nutzung ohne Netz
}

// Offline weiterarbeiten: letzte Anmeldung merken (nur Name/Kennung – kein Geheimnis; der Server prüft beim Senden)
const USER_KEY = 'mlz-user';
const rememberUser = (u) => { try { if (u) localStorage.setItem(USER_KEY, JSON.stringify({ id: u.id, username: u.username })); else localStorage.removeItem(USER_KEY); } catch { /* egal */ } };
async function offlineStart() {
  let u = null;
  try { u = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { u = null; }
  if (!u) return false;
  store.session = { setup: false, user: { ...u, offlineOnly: true }, offline: true };
  store.data = (await idbGet('cache', 'state').catch(() => null))?.v || null;
  store.drafts = await idbAll('drafts').catch(() => []);
  return true;
}

// ------------------------------------------------------------ Entwürfe (lokal + Server)
export function newDraft(section = 'incident', extra = {}) {
  const now = localNow();
  return { id: uuid(), entryId: uuid(), section, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), eventAt: now, eventAtAuto: true, eventEnd: '', title: '', category: '', location: '', persons: '', witnesses: '', facts: '', quotes: '', consequences: '', reaction: '', assessment: '', delayReason: '', caseId: '', fileIds: [], files: {}, applied: [], ...extra };
}

export async function loadDrafts() {
  const local = await idbAll('drafts');
  let remote = [];
  try { remote = await api('/drafts'); } catch { /* offline */ }
  const map = new Map(local.map((d) => [d.id, d]));
  for (const r of remote) {
    const l = map.get(r.id);
    let next = null;
    if (!l) next = r;
    else if ((r.assist?.updatedAt || '') > (l.assist?.updatedAt || '')) next = mergeAssist(l, r); // neues KI-Ergebnis, eigene Änderungen bleiben
    else if ((r.updatedAt || '') > (l.updatedAt || '')) next = r; // an einem anderen Gerät bearbeitet
    if (next) { map.set(r.id, next); await idbPut('drafts', JSON.parse(JSON.stringify(next))); }
  }
  // festgeschriebene Entwürfe entfernen
  for (const d of map.values()) if (store.data?.entries?.[d.entryId]) { map.delete(d.id); await idbDel('drafts', d.id); }
  store.drafts = [...map.values()].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

const dirty = new Set();
export async function saveDraft(d) {
  d.updatedAt = new Date().toISOString();
  const plain = JSON.parse(JSON.stringify(d));
  await idbPut('drafts', plain);
  const i = store.drafts.findIndex((x) => x.id === d.id);
  if (i >= 0) store.drafts[i] = plain; else store.drafts.unshift(plain);
  dirty.add(d.id);
  pushDraftsSoon();
}
const pushDraftsSoon = debounce(() => pushDrafts(), 1500);
async function pushDrafts() {
  for (const id of [...dirty]) {
    const d = await idbGet('drafts', id);
    if (!d) { dirty.delete(id); continue; }
    try { await api(`/drafts/${id}?force=1`, { method: 'PUT', body: d }); dirty.delete(id); } catch (e) { if (e.status === 0) return; dirty.delete(id); }
  }
}
export async function deleteDraft(id) {
  await idbDel('drafts', id);
  store.drafts = store.drafts.filter((d) => d.id !== id);
  dirty.delete(id);
  try { await api(`/drafts/${id}`, { method: 'DELETE' }); } catch { /* offline: Server löscht beim Festschreiben bzw. beim nächsten Mal */ }
}

/** Entwurf festschreiben → Eintrag in der Beweiskette. */
export async function finalizeDraft(d) {
  const fields = ['section', 'eventAt', 'eventEnd', 'title', 'category', 'location', 'persons', 'witnesses', 'facts', 'quotes', 'consequences', 'reaction', 'assessment', 'delayReason', 'caseId', 'fileIds'];
  const payload = Object.fromEntries(fields.map((k) => [k, d[k]]));
  payload.id = d.entryId;
  payload.draftId = d.id;
  payload.draftCreatedAt = d.createdAt;
  if (d.assist?.evidenceId) payload.ai = { evidenceId: d.assist.evidenceId, engine: d.assist.engine, model: d.assist.model, ...aiSummary(d) };
  await idbDel('drafts', d.id);
  store.drafts = store.drafts.filter((x) => x.id !== d.id);
  dirty.delete(d.id);
  await queueEvidence('entry', payload, { id: d.entryId, label: 'Logbuch-Eintrag' });
  return d.entryId;
}

// ------------------------------------------------------------ Start
export async function init() {
  try {
    store.session = await api('/session');
    rememberUser(store.session.user);
  } catch (e) {
    store.online = false;
    if (await offlineStart()) { await loadOutbox().catch(() => {}); store.ready = true; return; }
    store.session = { setup: false, user: null, offline: true };
  }
  await loadOutbox().catch(() => {});
  if (store.session.user && !store.session.user.mustChange) {
    await refresh().catch(() => { store.online = false; });
    await loadDrafts().catch(() => {});
    loadAssist();
    sync();
  } else {
    store.drafts = await idbAll('drafts').catch(() => []);
  }
  store.ready = true;
}

export async function afterLogin(user) {
  store.session = { ...(store.session || {}), setup: false, offline: false, user };
  rememberUser(user);
  if (!user.mustChange) {
    await refresh();
    await loadDrafts();
    loadAssist();
    sync();
  }
}

window.addEventListener('online', async () => {
  store.online = true;
  if (store.session?.offline) { // offline gestartet → jetzt Anmeldung beim Server prüfen
    try { store.session = await api('/session'); rememberUser(store.session.user); } catch { return; }
    if (!store.session.user) return;
    await loadDrafts().catch(() => {});
  }
  sync();
});
window.addEventListener('offline', () => { store.online = false; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
window.addEventListener('mlz-logout', () => { rememberUser(null); if (store.session) store.session.user = null; });
setInterval(() => { if (store.session?.user && (store.outbox.length || document.visibilityState === 'visible')) sync(); }, 60000);

if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
