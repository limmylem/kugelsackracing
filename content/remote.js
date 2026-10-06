// World content from the game's server (Phase 6 Step 1): the same requests and answers as the local service
// (content/service.js METHODS), asked of /api/v1/content (server/src/routes/content.ts). The editor and the
// game don't change. The server checks every write and the editor's role; what fails comes back as
// { ok: false, error } in plain words, as the local service answers.
//
//   const S = createRemoteContentService({ api })   (api: account/api.js)

import { METHODS, VIEWS } from './service.js';
import { ApiError } from '../account/api.js';

const QUERY_KM = 50, QUERY_LIMIT = 5000;

export function createRemoteContentService({ api }) {
  const listeners = new Set();
  const emit = ev => { for (const f of listeners) try { f(ev); } catch (e) { console.error(e); } };
  // (the server's no as the local service's: { ok: false, error, needsConfirm, problems })
  const call = async fn => {
    try { return await fn(); }
    catch (e) {
      if (!(e instanceof ApiError)) throw e;
      return { ok: false, error: e.message, code: e.code, ...(e.code === 'NEEDS_CONFIRM' ? { needsConfirm: true } : {}), ...(Array.isArray(e.details) ? { problems: e.details } : {}) };
    }
  };
  const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== Infinity && v !== '').map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])).toString();
  const write = (type, fn) => call(async () => { const r = await fn(); if (r?.ok !== false) emit({ type, ...r.event }); return r; });
  const enc = encodeURIComponent;

  return {
    METHODS, remote: true,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get pending() { return false; },
    query: ({ lat, lon, km, view = 'draft', kinds = null, offered = false, limit = Infinity }) =>
      call(() => api.get(`/content?${qs({ lat, lon, km: Math.min(km, QUERY_KM), view, kinds, offered, limit: Number.isFinite(limit) ? Math.min(limit, QUERY_LIMIT) : null })}`)),
    inCell: (cell, { view = 'draft', offered = false } = {}) => call(() => api.get(`/content/cells/${enc(cell)}?${qs({ view, offered })}`)),
    inTile: (z, x, y, { view = 'draft', offered = false } = {}) => call(() => api.get(`/content/tiles/${z}/${x}/${y}?${qs({ view, offered })}`)),
    get: (id, { view = 'draft' } = {}) => call(() => api.get(`/content/items/${enc(id)}?${qs({ view })}`)),
    getState: id => call(() => api.get(`/content/items/${enc(id)}/state`)),

    create: input => write('create', async () => { const r = await api.post('/content/items', input); return { ...r, event: { id: r.item.id, item: r.item } }; }),
    update: (id, input) => write('update', async () => { const r = await api.put(`/content/items/${enc(id)}`, input); return { ...r, event: { id, item: r.item } }; }),
    publish: id => call(async () => {
      const r = await api.post(`/content/items/${enc(id)}/publish`);
      if (r.route) emit({ type: 'publish', id: r.route.id, item: r.route });
      emit({ type: 'publish', id, item: r.item });
      return r;
    }),
    unpublish: id => write('unpublish', async () => { const r = await api.post(`/content/items/${enc(id)}/unpublish`); return { ...r, event: { id, item: r.item } }; }),
    remove: (id, { confirm = false } = {}) => call(async () => {
      const r = await api.del(`/content/items/${enc(id)}?confirm=${confirm}`);
      emit(r.archived ? { type: 'archive', id } : { type: 'delete', id });
      return r;
    }),
    restore: id => write('restore', async () => { const r = await api.post(`/content/items/${enc(id)}/restore`); return { ...r, event: { id, item: r.item } }; }),
    setState: (id, state) => write('state', async () => { const r = await api.put(`/content/items/${enc(id)}/state`, state); return { ...r, event: { id, item: state.draft ?? state.published ?? state.archived ?? null } }; }),

    exportContent: ({ area = null, views = VIEWS, as = 'json' } = {}) => call(async () => {
      const doc = await api.get(`/content/export?${qs({ ...(area?.cell ? { cell: area.cell } : area ? { lat: area.lat, lon: area.lon, km: area.km } : {}), views })}`);
      if (as === 'entries') return { ok: true, entries: doc.entries, count: doc.count };
      return { ok: true, json: JSON.stringify(doc, null, doc.count > 2000 ? 0 : 1), count: doc.count };
    }),
    importContent: (json, { onConflict = 'replace' } = {}) => call(async () => {
      let doc;
      try { doc = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return { ok: false, error: `That isn't a world content file: ${e.message}` }; }
      const r = await api.post(`/content/import?onConflict=${onConflict}`, doc);
      emit({ type: 'import', count: r.imported });
      return r;
    }),
    stats: () => call(async () => ({ ...(await api.get('/content/stats')), cells: null, loadedCells: 0, loadedWeight: 0 })),
    flush: async () => ({ ok: true }),
  };
}
