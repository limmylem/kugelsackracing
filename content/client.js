// The page's world content service (one for the editor and the game alike): the local backend in this
// browser's IndexedDB, checking items against the content schema and the economy's rules — or, when the
// page comes from the game's server (Phase 6), content/remote.js answering the same requests from it.
//
//   const { service, check, economy, classes, cars, quests } = await worldContent()

import { createLocalContentService } from './service.js';
import { IdbContentStorage, MemoryContentStorage } from './storage.js';
import { contentChecker } from './schema.js';
import { makeRater } from './rating.js';
import { createRemoteContentService } from './remote.js';
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
    let storage;
    try { storage = typeof indexedDB !== 'undefined' ? new IdbContentStorage() : new MemoryContentStorage(); await storage.getIndex(); }
    catch { storage = new MemoryContentStorage(); console.warn('World content: no IndexedDB here, so nothing is kept after this page closes.'); }
    const service = createLocalContentService({ storage, check, rate, author: author ?? localStorageGet('kugelsack.editor.author') ?? 'editor' });
    return { service, check, rate, economy, quests, classes: classesFile.classes, cars, persistent: storage instanceof IdbContentStorage };
  })();
}

export function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function localStorageSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* not kept */ } }
