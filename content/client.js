// The page's world content service (one for the editor and the game alike): the local backend in this
// browser's IndexedDB, checking items against the content schema and the economy's rules — or, when the
// page comes from the game's server (Phase 6), content/remote.js answering the same requests from it. The local
// backend runs in a Web Worker where it can (content/worker.js).
//
//   const { service, check, economy, classes, cars, quests } = await worldContent()

import { createLocalContentService } from './service.js';
import { IdbContentStorage, MemoryContentStorage } from './storage.js';
import { contentChecker } from './schema.js';
import { makeRater } from './rating.js';
import { createRemoteContentService } from './remote.js';
import { createWorkerContentService } from './workerService.js';
import { account } from '../account/session.js';

let made = null;
const readJson = async p => { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };

export function worldContent({ author = null } = {}) {
  return made ??= (async () => {
    const [schema, economy, classesFile, carIndex, quests] = await Promise.all(['data/schemas/content-item.schema.json', 'data/economy.json', 'data/classes.json', 'data/cars/index.json', 'data/quests.json'].map(readJson));
    // (the cars, by id, with their names: for a pink slip's rival)
    const cars = Object.fromEntries(await Promise.all(carIndex.cars.map(async f => { const c = await readJson(`data/cars/${f}`); return [c.id ?? f.split('/')[0], { name: c.name ?? f.split('/')[0], class: c.class ?? null }]; })));
    const check = contentChecker(schema, { economy, classes: classesFile.classes, cars });
    const rate = makeRater({ config: quests, classes: classesFile.classes });
    // (Phase 6: the game's server keeps the world's content — content/remote.js — and checks every write;
    // a page served without a server keeps it in this browser, as before)
    const A = await account().catch(() => null);
    if (A?.server) return { service: createRemoteContentService({ api: A.api }), check, rate, economy, quests, classes: classesFile.classes, cars, persistent: true, remote: true };
    // (in a Web Worker where there are workers — content/workerService.js: its queries and cell loads off the page's
    // main thread, where thousands of quests nearby would cost frames; else here, as before. ?contentWorker=0: here)
    const who = author ?? localStorageGet('kugelsack.editor.author') ?? 'editor';
    const off = new URLSearchParams(globalThis.location?.search ?? '').get('contentWorker') === '0';
    const inWorker = off ? null : await createWorkerContentService({ author: who }).catch(() => null);
    let service, persistent;
    if (inWorker) { service = inWorker; persistent = inWorker.persistent; }
    else {
      let storage;
      try { storage = typeof indexedDB !== 'undefined' ? new IdbContentStorage() : new MemoryContentStorage(); await storage.getIndex(); }
      catch { storage = new MemoryContentStorage(); }
      service = createLocalContentService({ storage, check, rate, author: who });
      persistent = storage instanceof IdbContentStorage;
    }
    if (!persistent) console.warn('World content: no IndexedDB here, so nothing is kept after this page closes.');
    // (the starting garages — data/world/garages.json, as the server publishes them — once in this browser: removed
    // or moved after, that's kept)
    if (!localStorageGet(GARAGES_SEEDED)) await seedGarages(service).then(() => localStorageSet(GARAGES_SEEDED, '1')).catch(e => console.warn(`The starting garages: ${e.message}`));
    return { service, check, rate, economy, quests, classes: classesFile.classes, cars, persistent };
  })();
}

const GARAGES_SEEDED = 'kugelsack.content.garages.v3';
async function seedGarages(service) {
  const { newItem } = await import('./quests.js'), at = new Date().toISOString();
  const file = await readJson('data/world/garages.json');
  // (earlier starting garages, since replaced: archived if they're as they were made)
  for (const id of file.retired ?? []) {
    const st = (await service.getState(id)).state;
    if (st?.published && st.published.author === 'Ogni Strada' && JSON.stringify(st.draft) === JSON.stringify(st.published)) await service.setState(id, { draft: null, published: null, archived: { ...st.published, status: 'archived', updated: at } });
  }
  for (const g of file.garages ?? []) {
    const st = (await service.getState(g.id)).state;
    if (st?.draft || st?.published || st?.archived) continue;
    const item = { ...newItem('garage', { id: g.id, location: g.location, name: g.name, author: 'Ogni Strada', now: at }), road: g.road ?? null, description: 'A drive-through garage: drive in under the canopy for your cars, parts and repairs.' };
    await service.setState(g.id, { draft: { ...item, status: 'published', publishedAt: at }, published: { ...item, status: 'published', publishedAt: at }, archived: null });
  }
}

export function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function localStorageSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* not kept */ } }
