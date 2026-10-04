// World content (quest starts, points of interest, spawn points, routes) changes here and nowhere else, as the
// player's profile does through PlayerService. The editor and the game only ever ask a world content
// service; it checks each request, makes the change, saves (drafts are kept as they're edited), and answers
// { ok, error, … } — error: plain words. Listeners (on) hear of every change.
//
// LocalWorldContentService keeps everything in this browser (content/storage.js), organised by geohash
// cell (content/geo.js) so only the cells near the camera or the player are loaded. A server backend
// (docs/WORLD_CONTENT.md: PostGIS tables and endpoints that answer these same requests) can replace it
// with nothing else changing.
//
// Drafts and published copies: an item is edited as a draft; publish() copies it to what players see
// (the game asks for view 'published'); edits after that are a new draft until published again. Deleting
// a published item archives it (it's kept: restore() brings it back as a draft); a draft never published
// is just gone (the editor's undo can put it back).

import { CELL_PRECISION, encode, decode, cellsAround, boxAround, cellsInBox, tileBox, distanceKm, inBox } from './geo.js';
import { CONTENT_VERSION, blocking } from './quests.js';
import { migrate } from './migrations.js';

// Every request a world content service answers (all async):
export const METHODS = {
  query: '({ lat, lon, km, view, kinds, offered, limit }) → { items: [{ item, km }] } nearest first (view: \'draft\' — the editor — or \'published\' — the game; offered: only quests switched on)',
  inCell: '(cell, { view }) → { items } everything in a geohash cell',
  inTile: '(z, x, y, { view }) → { items } everything in a web map tile',
  get: '(id, { view }) → { item } (null: none)',
  create: '(item) → { item } a new draft (its id, author and times are the service\'s)',
  update: '(id, item) → { item } the draft changed (moved, turned, edited)',
  publish: '(id) → { item, route } the draft as players see it (not while it has errors: { problems }); a quest\'s route is checked with it and published with it',
  unpublish: '(id) → { item } players no longer see it; the draft stays',
  remove: '(id, { confirm }) a draft that was never published: gone. A published one: archived (kept), only with confirm: true ({ needsConfirm } otherwise)',
  restore: '(id) an archived item back as a draft',
  getState: '(id) → { state: { draft, published, archived } } everything kept for an item (for undo)',
  setState: '(id, state) put an item\'s whole state back (undo / redo)',
  exportContent: '({ area: { lat, lon, km } | { cell } | null, views }) → { json, count } (null area: everything)',
  importContent: '(json, { onConflict: \'replace\' | \'skip\' }) → { imported, migrated, skipped: [{ id, why }] }',
  stats: '() → { draft, published, archived, cells, loadedCells }',
  flush: '() save now (changes are saved anyway, a moment after they\'re made)',
};

export const VIEWS = ['draft', 'published', 'archived'];
export const EXPORT_FORMAT = 'world-content';
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const boxesMeet = (a, b) => a[0] <= b[2] && a[2] >= b[0] && (b[1] <= b[3] ? a[1] <= b[3] && a[3] >= b[1] : a[3] >= b[1] || a[1] <= b[3]);
const cellOf = loc => encode(loc.lat, loc.lon, CELL_PRECISION);
const randomId = kind => `${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function createLocalContentService({ storage, check, author = 'editor', now = () => new Date().toISOString(), newId = randomId, maxCells = 3000, autosaveMs = 300 } = {}) {
  let index = null;                       // { layout, ids: { id: cell }, cells: { view: { cell: count } } }
  const nonEmpty = {};                    // view → how many cells have anything (kept as they change)
  const coarse = {};                      // view → Map(3-letter prefix → Set of its cells with anything): wide areas found fast
  const P3 = 3;
  const coarseAdd = (view, cell) => { const k = cell.slice(0, P3); (coarse[view].get(k) ?? coarse[view].set(k, new Set()).get(k)).add(cell); };
  const coarseDrop = (view, cell) => { const k = cell.slice(0, P3), set = coarse[view].get(k); if (set) { set.delete(cell); if (!set.size) coarse[view].delete(k); } };
  const cache = new Map();                // `${view}/${cell}` → { items: Map(id → item), dirty, used }
  let tick = 0, queue = Promise.resolve(), saveTimer = null, indexDirty = false, saving = null;
  const listeners = new Set();

  // one request at a time (a move between cells is several reads and writes)
  const serial = fn => { const r = queue.then(fn, fn); queue = r.catch(() => {}); return r; };
  const ready = async () => {
    if (index) return;
    index = await storage.getIndex() ?? { layout: 1, ids: {}, cells: Object.fromEntries(VIEWS.map(v => [v, {}])) };
    for (const v of VIEWS) { index.cells[v] ??= {}; nonEmpty[v] = Object.keys(index.cells[v]).length; coarse[v] = new Map(); for (const c of Object.keys(index.cells[v])) coarseAdd(v, c); }
  };

  async function cells(view, list) {
    const missing = list.filter(c => !cache.has(`${view}/${c}`) && index.cells[view][c]);
    if (missing.length) {
      const got = await storage.getCells(missing.map(c => `${view}/${c}`));
      for (const [k, rec] of got) cache.set(k, { items: new Map((rec?.items ?? []).map(i => [i.id, i])), dirty: false, used: 0 });
    }
    const out = [];
    for (const c of list) {
      const e = cache.get(`${view}/${c}`);
      if (e) { e.used = ++tick; out.push(e); }
    }
    evict();
    return out;
  }
  async function cellFor(view, cell) {
    const key = `${view}/${cell}`;
    if (!cache.has(key)) {
      if (index.cells[view][cell]) await cells(view, [cell]);
      if (!cache.has(key)) cache.set(key, { items: new Map(), dirty: false, used: 0 });
    }
    const e = cache.get(key); e.used = ++tick; return e;
  }
  // (cells not used lately, and saved, leave memory: only what's near is kept)
  function evict() {
    if (cache.size <= maxCells) return;
    // (down to three quarters at a time, so it isn't sorting on every request)
    const clean = [...cache.entries()].filter(([, e]) => !e.dirty).sort((a, b) => a[1].used - b[1].used);
    for (const [k] of clean.slice(0, cache.size - Math.floor(maxCells * 0.75))) cache.delete(k);
  }

  async function readItem(id, view) {
    const cell = index.ids[id];
    if (!cell || !index.cells[view][cell]) return null;
    return (await cellFor(view, cell)).items.get(id) ?? null;
  }
  async function writeItem(view, item, oldCell = null) {
    const cell = cellOf(item.location);
    if (oldCell && oldCell !== cell) await dropItem(view, item.id, oldCell);
    const e = await cellFor(view, cell), had = e.items.has(item.id);
    e.items.set(item.id, item); e.dirty = true;
    if (!had) { if (!index.cells[view][cell]) { nonEmpty[view]++; coarseAdd(view, cell); } index.cells[view][cell] = (index.cells[view][cell] ?? 0) + 1; }
    indexDirty = true;
    return cell;
  }
  async function dropItem(view, id, cell) {
    if (!cell || !index.cells[view][cell]) return;
    const e = await cellFor(view, cell);
    if (!e.items.delete(id)) return;
    e.dirty = true; indexDirty = true;
    if (--index.cells[view][cell] <= 0) { delete index.cells[view][cell]; nonEmpty[view]--; coarseDrop(view, cell); }
  }
  async function stateOf(id) {
    const out = {};
    for (const v of VIEWS) out[v] = clone(await readItem(id, v));
    return out;
  }
  // an item's whole state written: each view's copy (or none), the index following it
  async function putState(id, state) {
    const oldCell = index.ids[id];
    for (const v of VIEWS) {
      if (oldCell) await dropItem(v, id, oldCell);
      if (state[v]) await writeItem(v, clone(state[v]));
    }
    const any = VIEWS.map(v => state[v]).find(Boolean);
    if (any) index.ids[id] = cellOf(any.location); else delete index.ids[id];
    indexDirty = true;
    schedule();
  }

  function schedule() { if (autosaveMs != null && !saveTimer) saveTimer = setTimeout(() => { saveTimer = null; save(); }, autosaveMs); }
  async function save() {
    if (saving) await saving;
    const dirty = new Map();
    for (const [k, e] of cache) if (e.dirty) { dirty.set(k, e.items.size ? { items: [...e.items.values()] } : null); e.dirty = false; }
    const writeIndex = indexDirty; indexDirty = false;
    if (!dirty.size && !writeIndex) return;
    saving = (async () => {
      if (dirty.size) await storage.putCells(dirty);
      if (writeIndex) await storage.setIndex(index);
    })();
    try { await saving; } finally { saving = null; evict(); }
  }
  const emit = ev => { for (const fn of listeners) try { fn(ev); } catch (e) { console.error(e); } };

  // the cells a circle (or a box) needs: the ones with anything in them (when there are fewer of those
  // than the circle's cells, the circle's are found among them)
  function cellsFor(view, box) {
    const have = index.cells[view];
    const want = cellsInBox(box, CELL_PRECISION, 1024);
    if (want) return want.filter(c => have[c]);
    // (a wide area: its coarse cells, and the content cells under them that meet it)
    const wide = cellsInBox(box, P3, 4096) ?? [...coarse[view].keys()], out = [];
    for (const k of wide) for (const c of coarse[view].get(k) ?? []) if (boxesMeet(decode(c).box, box)) out.push(c);
    return out;
  }
  const offeredOnly = (it, offered) => !offered || it.kind !== 'quest' || it.enabled !== false;

  const api = {
    METHODS,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get pending() { return !!(saveTimer || saving || indexDirty || [...cache.values()].some(e => e.dirty)); },

    query: ({ lat, lon, km, view = 'draft', kinds = null, offered = false, limit = Infinity }) => serial(async () => {
      await ready();
      const box = boxAround(lat, lon, km), out = [], at = { lat, lon };
      for (const e of await cells(view, cellsFor(view, box)))
        for (const it of e.items.values()) {
          if (kinds && !kinds.includes(it.kind)) continue;
          if (!offeredOnly(it, offered)) continue;
          const d = distanceKm(at, it.location);
          if (d <= km) out.push({ item: it, km: d });
        }
      out.sort((a, b) => a.km - b.km);
      return { ok: true, items: out.length > limit ? out.slice(0, limit) : out };
    }),
    inCell: (cell, { view = 'draft', offered = false } = {}) => serial(async () => {
      await ready();
      const list = cell.length >= CELL_PRECISION ? (index.cells[view][cell.slice(0, CELL_PRECISION)] ? [cell.slice(0, CELL_PRECISION)] : []) : cellsFor(view, decode(cell).box).filter(c => c.startsWith(cell));
      const box = decode(cell).box, items = [];
      for (const e of await cells(view, list)) for (const it of e.items.values()) if (offeredOnly(it, offered) && inBox(box, it.location.lat, it.location.lon)) items.push(it);
      return { ok: true, items };
    }),
    inTile: (z, x, y, { view = 'draft', offered = false } = {}) => serial(async () => {
      await ready();
      const box = tileBox(z, x, y), items = [];
      for (const e of await cells(view, cellsFor(view, box))) for (const it of e.items.values()) if (offeredOnly(it, offered) && inBox(box, it.location.lat, it.location.lon)) items.push(it);
      return { ok: true, items };
    }),
    get: (id, { view = 'draft' } = {}) => serial(async () => { await ready(); return { ok: true, item: clone(await readItem(id, view)) }; }),

    create: input => serial(async () => {
      await ready();
      const t = now(), item = { ...clone(input), id: input.id && !index.ids[input.id] ? input.id : newId(input.kind), version: CONTENT_VERSION, status: 'draft', author: input.author ?? author, created: t, updated: t, publishedAt: null };
      const shape = check.shape(item);
      if (shape.length) return { ok: false, error: shape[0].message, problems: shape };
      await putState(item.id, { draft: item, published: null, archived: null });
      emit({ type: 'create', id: item.id, item: clone(item) });
      return { ok: true, item: clone(item) };
    }),
    update: (id, input) => serial(async () => {
      await ready();
      const old = await readItem(id, 'draft');
      if (!old) return { ok: false, error: (await readItem(id, 'archived')) ? 'It\'s archived: restore it to edit it.' : 'There\'s no such item.' };
      const item = { ...old, ...clone(input), id, version: CONTENT_VERSION, created: old.created, author: old.author, status: old.status, publishedAt: old.publishedAt, updated: now() };
      const shape = check.shape(item);
      if (shape.length) return { ok: false, error: shape[0].message, problems: shape };
      const state = await stateOf(id);
      await putState(id, { ...state, draft: item });
      emit({ type: 'update', id, item: clone(item) });
      return { ok: true, item: clone(item) };
    }),
    publish: id => serial(async () => {
      await ready();
      const draft = await readItem(id, 'draft');
      if (!draft) return { ok: false, error: 'There\'s no such draft.' };
      // (a quest's route: checked with it, and published with it)
      const routeId = draft.kind === 'quest' ? draft.route : null;
      const route = routeId ? (await readItem(routeId, 'draft')) ?? (await readItem(routeId, 'published')) ?? null : undefined;
      const errors = blocking(check(draft, routeId ? { route } : {}));
      if (errors.length) return { ok: false, error: `Can't publish "${draft.name || 'it'}" yet: ${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''}`, problems: errors };
      const t = now(), item = { ...draft, status: 'published', publishedAt: t };
      const state = await stateOf(id);
      await putState(id, { ...state, draft: item, published: clone(item) });
      let routeItem = null;
      if (route) {
        const rs = await stateOf(routeId), bare = x => x && { ...x, status: null, publishedAt: null, updated: null };
        if (rs.draft && (!rs.published || !same(bare(rs.draft), bare(rs.published)))) {
          routeItem = { ...rs.draft, status: 'published', publishedAt: t };
          await putState(routeId, { ...rs, draft: routeItem, published: clone(routeItem) });
        }
      }
      await save();                                   // (what players see is saved at once, not in a moment)
      if (routeItem) emit({ type: 'publish', id: routeId, item: clone(routeItem) });
      emit({ type: 'publish', id, item: clone(item) });
      return { ok: true, item: clone(item), route: routeItem ? clone(routeItem) : null };
    }),
    unpublish: id => serial(async () => {
      await ready();
      const state = await stateOf(id);
      if (!state.published) return { ok: false, error: 'It isn\'t published.' };
      const draft = { ...(state.draft ?? state.published), status: 'draft', publishedAt: null };
      await putState(id, { ...state, draft, published: null });
      await save();
      emit({ type: 'unpublish', id, item: clone(draft) });
      return { ok: true, item: clone(draft) };
    }),
    remove: (id, { confirm = false } = {}) => serial(async () => {
      await ready();
      const state = await stateOf(id);
      if (!state.draft && !state.published) return { ok: false, error: state.archived ? 'It\'s already archived.' : 'There\'s no such item.' };
      if (state.published) {
        if (!confirm) return { ok: false, needsConfirm: true, error: `"${state.published.name}" is published: players can see it. Archive it? (It's kept and can be restored, not destroyed.)` };
        const archived = { ...(state.draft ?? state.published), status: 'archived', updated: now() };
        await putState(id, { draft: null, published: null, archived });
        await save();
        emit({ type: 'archive', id, item: clone(archived) });
        return { ok: true, archived: true };
      }
      await putState(id, { draft: null, published: null, archived: state.archived });
      emit({ type: 'delete', id });
      return { ok: true, archived: false };
    }),
    restore: id => serial(async () => {
      await ready();
      const state = await stateOf(id);
      if (!state.archived) return { ok: false, error: 'It isn\'t archived.' };
      const draft = { ...state.archived, status: 'draft', publishedAt: null, updated: now() };
      await putState(id, { draft, published: null, archived: null });
      await save();
      emit({ type: 'restore', id, item: clone(draft) });
      return { ok: true, item: clone(draft) };
    }),
    getState: id => serial(async () => { await ready(); return { ok: true, state: await stateOf(id) }; }),
    setState: (id, state) => serial(async () => {
      await ready();
      await putState(id, { draft: state.draft ?? null, published: state.published ?? null, archived: state.archived ?? null });
      emit({ type: 'state', id, item: clone(state.draft ?? state.published ?? state.archived ?? null) });
      return { ok: true };
    }),

    exportContent: ({ area = null, views = VIEWS } = {}) => serial(async () => {
      await ready();
      const box = area?.cell ? decode(area.cell).box : area ? boxAround(area.lat, area.lon, area.km) : null;
      const ids = new Set();
      for (const v of views) {
        const list = box ? cellsFor(v, box) : Object.keys(index.cells[v]);
        for (const c of list) for (const it of (await cellFor(v, c)).items.values()) {
          if (area?.cell ? !inBox(box, it.location.lat, it.location.lon) : area ? distanceKm(area, it.location) > area.km : false) continue;
          ids.add(it.id);
        }
        evict();
      }
      const entries = [];
      for (const id of [...ids].sort()) { const s = await stateOf(id); entries.push(Object.fromEntries(views.filter(v => s[v]).map(v => [v, s[v]]))); }
      const doc = { format: EXPORT_FORMAT, version: CONTENT_VERSION, exported: now(), area: area ?? 'everything', views, count: entries.length, entries };
      return { ok: true, json: JSON.stringify(doc, null, 1), count: entries.length };
    }),
    importContent: (json, { onConflict = 'replace' } = {}) => serial(async () => {
      await ready();
      let doc;
      try { doc = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return { ok: false, error: `That isn't a world content file: ${e.message}` }; }
      if (doc?.format !== EXPORT_FORMAT) return { ok: false, error: `That isn't a world content file (its format is "${doc?.format ?? 'missing'}").` };
      if (!(doc.version >= 1)) return { ok: false, error: 'The file doesn\'t say which version of the format it is.' };
      if (doc.version > CONTENT_VERSION) return { ok: false, error: `The file was made by a newer version of the game (content version ${doc.version}; this one reads up to ${CONTENT_VERSION}).` };
      let imported = 0, migrated = 0; const skipped = [];
      for (const entry of doc.entries ?? []) {
        const state = {}, id = (entry.draft ?? entry.published ?? entry.archived)?.id ?? '?';
        let bad = null;
        for (const v of VIEWS) {
          if (!entry[v]) { state[v] = null; continue; }
          const m = migrate(entry[v]);
          if (m.error) { bad = m.error; break; }
          if (m.migrated && v !== 'archived') migrated++;
          const shape = check.shape(m.item);
          if (shape.length) { bad = shape[0].message; break; }
          state[v] = m.item;
        }
        if (!bad && state.published && !state.draft) state.draft = clone(state.published);
        if (!bad && state.published && blocking(check(state.published)).length) bad = `its published copy has errors: ${blocking(check(state.published))[0].message}`;
        if (bad) { skipped.push({ id, why: bad }); continue; }
        if (index.ids[id] && onConflict === 'skip') { skipped.push({ id, why: 'already here (kept as it is)' }); continue; }
        await putState(id, state);
        imported++;
      }
      await save();
      emit({ type: 'import', count: imported });
      return { ok: true, imported, migrated, skipped };
    }),

    stats: () => serial(async () => {
      await ready();
      const count = v => Object.values(index.cells[v]).reduce((a, n) => a + n, 0);
      return { ok: true, draft: count('draft'), published: count('published'), archived: count('archived'), cells: Object.keys(index.cells.draft).length, loadedCells: cache.size, ids: Object.keys(index.ids).length };
    }),
    flush: () => serial(async () => { await ready(); clearTimeout(saveTimer); saveTimer = null; await save(); return { ok: true }; }),
    // (for the tests: forget what's in memory, as a restarted game would)
    _forget: () => serial(async () => { await save(); cache.clear(); index = null; return { ok: true }; }),
    get loadedCells() { return cache.size; },
  };
  return api;
}
