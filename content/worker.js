// The world content service in a Web Worker (docs/KNOWN_ISSUES.md "At 50,000 quests"): the local backend (content/service.js,
// this browser's IndexedDB) run off the page's main thread, so its queries and cell loads never hold up a frame. The page
// talks to it through content/workerService.js, which answers the same requests (METHODS) as the service itself.
//
// Messages in: { t: 'init', base, author } · { t: 'call', id, m, args }
// out: { t: 'ready' } | { t: 'failed', error } · { t: 'result', id, r, pending } | { t: 'error', id, error } ·
//      { t: 'event', ev } (every change, as service.on hears it) · { t: 'pending', pending } (whether changes wait to be saved)

import { createLocalContentService } from './service.js';
import { IdbContentStorage, MemoryContentStorage } from './storage.js';
import { contentChecker } from './schema.js';
import { makeRater } from './rating.js';

let service = null, base = null, pendingWas = false;
const readJson = async p => { const r = await fetch(new URL(p, base), { cache: 'no-cache' }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };
const tellPending = () => { const p = !!service?.pending; if (p !== pendingWas) { pendingWas = p; postMessage({ t: 'pending', pending: p }); } };

async function init({ author }) {
  const [schema, economy, classesFile, carIndex, quests] = await Promise.all(['data/schemas/content-item.schema.json', 'data/economy.json', 'data/classes.json', 'data/cars/index.json', 'data/quests.json'].map(readJson));
  const cars = Object.fromEntries(await Promise.all(carIndex.cars.map(async f => { const c = await readJson(`data/cars/${f}`); return [c.id ?? f.split('/')[0], { name: c.name ?? f.split('/')[0], class: c.class ?? null }]; })));
  const check = contentChecker(schema, { economy, classes: classesFile.classes, cars });
  const rate = makeRater({ config: quests, classes: classesFile.classes });
  let storage, persistent = true;
  try { storage = typeof indexedDB !== 'undefined' ? new IdbContentStorage() : new MemoryContentStorage(); await storage.getIndex(); persistent = storage instanceof IdbContentStorage; }
  catch { storage = new MemoryContentStorage(); persistent = false; }
  service = createLocalContentService({ storage, check, rate, author });
  service.on(ev => postMessage({ t: 'event', ev }));
  setInterval(tellPending, 200);
  return { persistent };
}

self.onmessage = async ({ data: d }) => {
  if (d?.t === 'init') {
    base = d.base;
    try { const r = await init(d); postMessage({ t: 'ready', ...r }); }
    catch (e) { postMessage({ t: 'failed', error: e?.message ?? String(e) }); }
    return;
  }
  if (d?.t !== 'call') return;
  try {
    if (!service || typeof service[d.m] !== 'function') throw new Error(`The content service has no ${d.m}.`);
    const r = await service[d.m](...(d.args ?? []));
    postMessage({ t: 'result', id: d.id, r, pending: !!service.pending });
    pendingWas = !!service.pending;
  } catch (e) { postMessage({ t: 'error', id: d.id, error: e?.message ?? String(e) }); }
};
