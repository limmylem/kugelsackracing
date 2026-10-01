// Where a profile is kept. Every store has the same three methods, all async:
//   load() → the saved profile (any version: the service brings it up to date) or null
//   save(profile) · clear()
//
// IdbStorage: this browser's IndexedDB (database "drive-world", store "saves": the profile, and the
// one before it as a backup). The first time, it picks up the garage kept in localStorage before the
// shop existed (a version 1 save), which is moved aside once the new save is written.
// MemoryStorage: in memory, as JSON (the tests; "closing the browser" is making a new service on it).

export class MemoryStorage {
  constructor(saved = null) { this.json = saved ? JSON.stringify(saved) : null; this.saves = 0; }
  async load() { return this.json ? JSON.parse(this.json) : null; }
  async save(profile) { this.json = JSON.stringify(profile); this.saves++; }
  async clear() { this.json = null; }
}

const LEGACY_KEY = 'driveWorld.garage.v1';

export class IdbStorage {
  constructor({ database = 'drive-world', store = 'saves', key = 'profile' } = {}) {
    this.database = database; this.store = store; this.key = key; this.db = null; this.legacy = false;
  }
  #open() {
    return this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.database, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(this.store)) req.result.createObjectStore(this.store); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('the save is open in another tab that needs to close first'));
    });
  }
  async #tx(mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.store, mode), store = tx.objectStore(this.store);
      let result;
      fn(store, r => { result = r; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('the save was interrupted'));
    });
  }
  async load() {
    const saved = await this.#tx('readonly', (store, done) => { const r = store.get(this.key); r.onsuccess = () => done(r.result ?? null); });
    if (saved) return saved;
    try {
      const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
      if (old) { this.legacy = true; return old; }
    } catch { /* none */ }
    return null;
  }
  async save(profile) {
    await this.#tx('readwrite', (store) => {
      const prev = store.get(this.key);
      prev.onsuccess = () => { if (prev.result) store.put(prev.result, `${this.key}.previous`); store.put(JSON.parse(JSON.stringify(profile)), this.key); };
    });
    if (this.legacy) {
      try { localStorage.setItem(`${LEGACY_KEY}.migrated`, localStorage.getItem(LEGACY_KEY)); localStorage.removeItem(LEGACY_KEY); } catch { /* left */ }
      this.legacy = false;
    }
  }
  async clear() { await this.#tx('readwrite', store => { store.delete(this.key); }); }
}
