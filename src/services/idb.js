// IndexedDB: Warteschlange (Dateien + Einträge, die noch nicht beim Server sind) und Entwürfe.
const DB = 'mlz-protokoll';
let dbp = null;
function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('drafts')) d.createObjectStore('drafts', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'k' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const res = fn(s);
    t.oncomplete = () => resolve(res?.result ?? res);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const idbAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const idbGet = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const idbPut = (store, v) => tx(store, 'readwrite', (s) => { s.put(v); });
export const idbDel = (store, id) => tx(store, 'readwrite', (s) => { s.delete(id); });
