// The local world content service, run in a Web Worker (content/worker.js): the same requests and answers as
// content/service.js (METHODS) and the same change events, but its work — queries over thousands of quests, a packed
// cell's load — happens off the page's main thread. content/client.js uses it where workers are available.
//
//   const S = await createWorkerContentService({ author })   → the service (S.persistent: kept in IndexedDB) or null
//                                                              (no worker here, or it didn't start: use the service itself)

import { METHODS } from './service.js';

const START_MS = 15000;

export async function createWorkerContentService({ author = 'editor', url = new URL('./worker.js', import.meta.url), base = globalThis.location?.href } = {}) {
  if (typeof Worker === 'undefined') return null;
  let w;
  try { w = new Worker(url, { type: 'module' }); } catch { return null; }
  const calls = new Map(), listeners = new Set();
  let next = 1, pending = false, started = null;
  const ready = new Promise(resolve => { started = resolve; });
  w.onmessage = ({ data: d }) => {
    if (d.t === 'ready' || d.t === 'failed') return started(d);
    if (d.t === 'event') { for (const f of listeners) try { f(d.ev); } catch (e) { console.error(e); } return; }
    if (d.t === 'pending') { pending = d.pending; return; }
    const c = calls.get(d.id);
    if (!c) return;
    calls.delete(d.id);
    if (d.t === 'result') { pending = d.pending; c.resolve(d.r); } else c.reject(new Error(d.error));
  };
  w.onerror = e => { started({ t: 'failed', error: e?.message ?? 'the worker failed' }); for (const c of calls.values()) c.reject(new Error('The content worker stopped.')); calls.clear(); };
  w.postMessage({ t: 'init', base, author });
  const r = await Promise.race([ready, new Promise(res => setTimeout(() => res({ t: 'failed', error: 'no answer' }), START_MS))]);
  if (r.t !== 'ready') { w.terminate(); console.warn(`World content: the worker didn't start (${r.error}); working on the page instead.`); return null; }
  const READS = new Set(['query', 'inCell', 'inTile', 'get', 'getState', 'exportContent', 'stats']);
  const call = (m, args) => new Promise((resolve, reject) => {
    const id = next++;
    calls.set(id, { resolve, reject });
    if (!READS.has(m)) pending = true;
    w.postMessage({ t: 'call', id, m, args });
  });
  const S = {
    METHODS, worker: true, persistent: r.persistent,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get pending() { return pending; },
    _forget: () => call('_forget', []),
    terminate() { w.terminate(); },
  };
  for (const m of Object.keys(METHODS)) S[m] = (...args) => call(m, args);
  return S;
}
