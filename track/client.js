// Getting a track in the page (Phase 5 Step 1): from this browser's cache (IndexedDB, by track code: a
// track made before loads at once), else made in a Web Worker (track/worker.js) with progress as it
// goes, then kept. Where there's no worker (or it fails to start), made on the page instead.
//
//   const T = await loadTrack({ code } | { seed, params }, { onProgress(step, share) }) → world data (track/build.js)
//   codeOf({ seed, params }) → the code that spec makes      forgetTracks() (the cache emptied)

import { encode, normalise, seedOf, LATEST } from './generate.js';
import { BUILD_VERSION } from './build.js';

const DB = 'driveWorld.tracks', STORE = 'tracks', KEEP = 30;
export const codeOf = spec => spec.code ?? encode({ version: spec.version ?? LATEST, seed: seedOf(spec.seed), params: normalise(spec.params) });

function idb() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s); t.oncomplete = () => res(out.result ?? out); t.onerror = () => rej(t.error); });
}
async function cached(code) {
  try { const v = await tx('readonly', s => s.get(code)); return v && v.build === BUILD_VERSION ? v.data : null; } catch { return null; }
}
async function keep(code, data) {
  try {
    await tx('readwrite', s => s.put({ code, build: BUILD_VERSION, at: Date.now(), data }, code));
    // (only the latest few kept)
    const all = await tx('readonly', s => s.getAll());
    const old = (all ?? []).sort((a, b) => b.at - a.at).slice(KEEP);
    if (old.length) await tx('readwrite', s => { for (const o of old) s.delete(o.code); return {}; });
  } catch { /* not kept: made again next time */ }
}
export async function forgetTracks() { try { await tx('readwrite', s => s.clear()); } catch { /* none */ } }

let worker = null, nextId = 1;
const waiting = new Map();
function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; if (e.data.progress) { w.onProgress?.(e.data.progress.step, e.data.progress.share); return; } waiting.delete(e.data.id); e.data.ok ? w.res(e.data.data) : w.rej(Object.assign(new Error(e.data.error), { attempts: e.data.attempts })); };
    worker.onerror = e => { for (const w of waiting.values()) w.rej(new Error(e.message ?? 'the track worker failed')); waiting.clear(); worker = false; };
  } catch { worker = false; }
  return worker;
}

async function makeHere(spec, onProgress) {
  const [{ generateTrack }, { buildTrack }] = await Promise.all([import('./generate.js'), import('./build.js')]);
  const cfg = await (await fetch(new URL('../data/tracks.json', import.meta.url), { cache: 'no-cache' })).json();
  const gen = generateTrack(spec);
  if (!gen.ok) throw Object.assign(new Error(gen.error), { attempts: gen.attempts });
  return buildTrack(gen, cfg, { progress: onProgress });
}

export async function loadTrack(spec, { onProgress = () => {}, cache = true } = {}) {
  const code = codeOf(spec), t0 = performance.now();
  if (cache) { const hit = await cached(code); if (hit) { onProgress('cached', 1); return Object.assign(hit, { fromCache: true, loadMs: performance.now() - t0 }); } }
  const W = getWorker();
  const data = W ? await new Promise((res, rej) => { const id = nextId++; waiting.set(id, { res, rej, onProgress }); W.postMessage({ id, spec: { code } }); }).catch(e => { if (/worker/.test(e.message)) return makeHere({ code }, onProgress); throw e; })
    : await makeHere({ code }, onProgress);
  data.loadMs = performance.now() - t0;
  if (cache) keep(code, data);
  return data;
}
