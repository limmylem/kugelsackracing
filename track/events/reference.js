// A generated track's AI reference times (Phase 5 Step 3): a headless lap at each skill level (data/npc.json
// skill.levels: low, medium, high) by the class's reference car (race/setup.js: the first rival's build for
// that class), alone, in the physics on the track's own world (race/aiTest.js, its solo laps) — when a track
// is first made or loaded, then kept by its code. On a circuit two laps: the first from the grid (a standing
// lap), the second a flying one, so a race of any length has its targets (the standing lap + the flying
// ones) and a hot lap its one lap's. The medal targets (quest/rules.js medalTargets: gold the high skill's
// time, silver the medium's, bronze the low's) and the stars (quest/difficulty.js) use them.
//
//   const R = await referenceTimes({ data, carClass, makeSim, socketsOf, db, npcCfg, qcfg, sessionRules, cache, seed })
//     → { key, perLap, flying: { low, medium, high }, standing: {…}, finished, resets, ms, cached }
//     makeSim(spec) → Promise<{ sim, frame, free() }>     a physics world of the track (trackSim below, in Node)
//   aiTimesOf(R) → a course's aiTimes entry: { low, medium, high, perLap, flying }
//   withAiTimes(course, carClass, R) → the course with them (what the quest session and the rules read)
//   referenceKey(code, carClass, cfg)        createMemoryRefCache() / createIdbRefCache()

import { createAiTest } from '../../race/aiTest.js';
import { viewCourse } from '../../route/model.js';
import { trackProjection } from '../build.js';

export const referenceKey = (code, carClass, cfg) => `${code}|${carClass ?? 'open'}|ref${cfg?.reference?.cacheVersion ?? 1}`;

export async function referenceTimes({ data, course = null, carClass = 'open', makeSim, socketsOf, db, npcCfg, qcfg, sessionRules = null, cache = null, cfg = null, seed = null, onProgress = () => {}, budgetMs = 40 }) {
  const key = referenceKey(data.code, carClass, cfg);
  const hit = await cache?.get(key);
  if (hit) return { ...hit, cached: true };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  course ??= viewCourse(data.course, trackProjection);
  const laps = course.loop ? 2 : 1;
  // (the quest the reference car is picked for: its class; no rivals race, only the solo laps)
  const quest = { id: `ref_${data.code}`, type: 'sprint', entry: { classes: carClass && carClass !== 'open' ? carClass.split('') : [] }, npc: { count: 1, skill: [0.5, 0.5], drivers: 'random' }, params: { laps: 1 } };
  const test = createAiTest({ makeSim, socketsOf, course, quest, db, cfg: npcCfg, qcfg, sessionRules, seed: seed ?? cfg?.reference?.seed ?? 9001, count: 1, race: false, soloLaps: laps });
  await test.start();
  const levels = Object.keys(npcCfg.skill.levels);
  while (!test.done) {
    await test.step(0, { fast: true, budgetMs });
    const rep = test.report();
    onProgress(Object.keys(rep.aiTimes).length / levels.length);
    if (typeof setTimeout !== 'undefined' && typeof window !== 'undefined') await new Promise(r => setTimeout(r, 0));     // (the page keeps drawing its loading screen)
  }
  const rep = test.report();
  test.dispose();
  const standing = {}, flying = {};
  for (const L of levels) {
    const lapsDone = rep.aiLaps[L];
    if (!lapsDone?.length) continue;
    standing[L] = Math.round(lapsDone[0] * 10) / 10;
    flying[L] = Math.round((lapsDone[1] ?? lapsDone[0]) * 10) / 10;
  }
  const finished = levels.every(L => standing[L] != null);
  const out = { key, code: data.code, carClass, perLap: !!course.loop, standing, flying, finished, resets: rep.soloResets ?? {}, ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) };
  if (finished) await cache?.put(key, out);
  return { ...out, cached: false };
}

// a course's aiTimes entry from the reference laps: the standing lap's times, and the flying lap's
export function aiTimesOf(R) {
  if (!R?.finished) return null;
  return { ...R.standing, perLap: R.perLap, ...(R.perLap ? { flying: { ...R.flying } } : {}) };
}
export function withAiTimes(course, carClass, R) {
  const t = aiTimesOf(R);
  if (!t) return course;
  course.aiTimes = { ...(course.aiTimes ?? {}), [carClass ?? 'open']: t };
  return course;
}

// ---------- where they're kept ----------
export function createMemoryRefCache() { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, get size() { return m.size; } }; }
export function createIdbRefCache({ database = 'driveWorld.trackRefs', store = 'refs' } = {}) {
  let db = null;
  const open = () => db ??= new Promise((res, rej) => { const r = indexedDB.open(database, 1); r.onupgradeneeded = () => r.result.createObjectStore(store); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode), out = fn(t.objectStore(store)); t.oncomplete = () => res(out?.result ?? null); t.onerror = () => rej(t.error); }); };
  return { get: k => tx('readonly', s => s.get(k)).catch(() => null), put: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => null) };
}
