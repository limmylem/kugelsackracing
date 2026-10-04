// Where best-run recordings (quest/recording.js) are kept, apart from the save so it stays small: the
// profile keeps only each quest's recording id. Same three async methods for every store:
//   put(id, recording) · get(id) → recording | null · delete(id)
// MemoryRecordStore (tests, and the fallback when IndexedDB isn't there); IdbRecordStore (database
// "drive-world-ghosts").

export class MemoryRecordStore {
  constructor() { this.map = new Map(); }
  async put(id, rec) { this.map.set(id, JSON.stringify(rec)); }
  async get(id) { const j = this.map.get(id); return j ? JSON.parse(j) : null; }
  async delete(id) { this.map.delete(id); }
  get size() { return this.map.size; }
}

export class IdbRecordStore {
  constructor({ database = 'drive-world-ghosts', store = 'recordings' } = {}) { this.database = database; this.store = store; this.db = null; }
  #open() {
    return this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.database, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async #tx(mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.store, mode);
      let out = null;
      fn(tx.objectStore(this.store), r => { out = r; });
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    });
  }
  put(id, rec) { return this.#tx('readwrite', s => s.put(rec, id)); }
  get(id) { return this.#tx('readonly', (s, done) => { const r = s.get(id); r.onsuccess = () => done(r.result ?? null); }); }
  delete(id) { return this.#tx('readwrite', s => s.delete(id)); }
}

export const recordStore = () => typeof indexedDB !== 'undefined' ? new IdbRecordStore() : new MemoryRecordStore();
