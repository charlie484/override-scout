// Minimal promise wrapper around IndexedDB.
// Stores: cache (API responses), docs (scouting data, synced), blobs (photos/videos, device only).

const DB_NAME = 'override-scout';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      if (!db.objectStoreNames.contains('docs')) {
        const s = db.createObjectStore('docs', { keyPath: 'id' });
        s.createIndex('type', 'type');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    console.warn('IndexedDB unavailable, using memory store', err);
    dbPromise = null;
    return null;
  });
  return dbPromise;
}

// In-memory fallback for private browsing modes that block IndexedDB.
const mem = { cache: new Map(), docs: new Map(), blobs: new Map() };

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function get(store, key) {
  const db = await open();
  if (!db) return store === 'docs' ? mem.docs.get(key) : mem[store].get(key);
  return tx(db, store, 'readonly', (s) => reqP(s.get(key)));
}

export async function put(store, value, key) {
  const db = await open();
  if (!db) { mem[store].set(store === 'docs' ? value.id : key, value); return; }
  return tx(db, store, 'readwrite', (s) => reqP(key === undefined ? s.put(value) : s.put(value, key)));
}

export async function putMany(store, values) {
  const db = await open();
  if (!db) { values.forEach((v) => mem[store].set(v.id, v)); return; }
  return tx(db, store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); });
}

export async function del(store, key) {
  const db = await open();
  if (!db) { mem[store].delete(key); return; }
  return tx(db, store, 'readwrite', (s) => reqP(s.delete(key)));
}

export async function all(store) {
  const db = await open();
  if (!db) return [...mem[store].values()];
  return tx(db, store, 'readonly', (s) => reqP(s.getAll()));
}

export async function keys(store) {
  const db = await open();
  if (!db) return [...mem[store].keys()];
  return tx(db, store, 'readonly', (s) => reqP(s.getAllKeys()));
}

export async function clear(store) {
  const db = await open();
  if (!db) { mem[store].clear(); return; }
  return tx(db, store, 'readwrite', (s) => reqP(s.clear()));
}

export async function estimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (e) { /* ignore */ }
  return null;
}
