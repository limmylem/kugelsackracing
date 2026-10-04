// Where the local world content service keeps its data: one record per geohash cell per view (drafts, the
// published copies, the archive), and an index (which cells have anything, which cell each item is in).
// Every store has the same methods, all async:
//
//   getIndex() → index | null      setIndex(index)
//   getCells([key]) → Map(key → { items: [item] } | null)      putCells(Map(key → record | null))   (null: gone)
//   clear()
//
// MemoryContentStorage: for the tests (and a page with no IndexedDB). IdbContentStorage: this browser's
// IndexedDB (database 'world-content'), so content survives restarting the game.

export class MemoryContentStorage {
  constructor() { this.index = null; this.cells = new Map(); this.reads = 0; this.writes = 0; }
  async getIndex() { return this.index ? JSON.parse(this.index) : null; }
  async setIndex(index) { this.index = JSON.stringify(index); }
  async getCells(keys) { this.reads += keys.length; return new Map(keys.map(k => [k, this.cells.has(k) ? JSON.parse(this.cells.get(k)) : null])); }
  async putCells(map) { for (const [k, v] of map) { this.writes++; if (v) this.cells.set(k, JSON.stringify(v)); else this.cells.delete(k); } }
  async clear() { this.index = null; this.cells.clear(); }
}

export class IdbContentStorage {
  constructor(name = 'world-content') { this.name = name; this.db = null; }
  #open() {
    return this.db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('cells'); r.result.createObjectStore('meta'); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async #tx(stores, mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let out;
      tx.oncomplete = () => resolve(out);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: the write was abandoned'));
      out = fn(...stores.map(s => tx.objectStore(s)));
    });
  }
  async getIndex() {
    let req;
    await this.#tx(['meta'], 'readonly', m => { req = m.get('index'); });
    return req.result ?? null;
  }
  async setIndex(index) { await this.#tx(['meta'], 'readwrite', m => { m.put(index, 'index'); }); }
  async getCells(keys) {
    const reqs = [];
    await this.#tx(['cells'], 'readonly', c => { for (const k of keys) reqs.push([k, c.get(k)]); });
    return new Map(reqs.map(([k, r]) => [k, r.result ?? null]));
  }
  async putCells(map) { await this.#tx(['cells'], 'readwrite', c => { for (const [k, v] of map) { if (v) c.put(v, k); else c.delete(k); } }); }
  async clear() { await this.#tx(['cells', 'meta'], 'readwrite', (c, m) => { c.clear(); m.clear(); }); }
}
