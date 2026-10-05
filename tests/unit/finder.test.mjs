// Phase 4 Step 5: finding quests — the map's filters, "Recommended for you", the free-roam notice, and
// which baked region a quest is in (fast travel).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newItem } from '../../content/quests.js';
import { offset } from '../../content/geo.js';
import { filterQuests, recommend, createNotifier, suitsCar, regionOf, defaultFilters } from '../../quest/finder.js';
import { xpForLevel } from '../../quest/rules.js';

const json = p => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url)));
const config = json('data/quests.json'), economy = json('data/economy.json'), baked = json('data/map/baked.json');
const HOME = { lat: 37.7936, lon: -122.3965 };
let n = 0;
const quest = (km, bearing, extra = {}) => ({ ...newItem('quest', { id: `quest_find${String(++n).padStart(4, '0')}`, location: offset(HOME, km, bearing), type: 'sprint' }), status: 'published', rating: { stars: 2, km: 3, recommended: 360 }, ...extra });

test('filters: type, difficulty, distance, completed or not, medal, and what suits my car', () => {
  const A = quest(0.5, 0), B = quest(3, 90, { type: 'drift', rating: { stars: 4, km: 5, recommended: 520 } }), Cq = quest(10, 180, { entry: { classes: ['A'], minLevel: 1 } }), D = quest(1, 270);
  const profile = { xp: 0, money: 1e5, quests: { [A.id]: { attempts: 2, completed: true, medal: 'silver' }, [D.id]: { attempts: 1, completed: false, medal: null } } };
  const ctx = { profile, car: { className: 'D', rating: 380, kw: 80, kg: 1100 }, economy, config, at: HOME }, all = [A, B, Cq, D];
  const ids = f => filterQuests(all, f, ctx).map(x => x.item.id);
  assert.deepEqual(ids(defaultFilters()), [A.id, D.id, B.id, Cq.id], 'nearest first');
  assert.deepEqual(ids({ type: 'drift' }), [B.id]);
  assert.deepEqual(ids({ stars: '4' }), [B.id]);
  assert.deepEqual(ids({ distance: '5' }), [A.id, D.id, B.id]);
  assert.deepEqual(ids({ status: 'new' }), [B.id, Cq.id]);
  assert.deepEqual(ids({ status: 'not completed' }), [D.id, B.id, Cq.id]);
  assert.deepEqual(ids({ status: 'completed' }), [A.id]);
  assert.deepEqual(ids({ medal: 'silver' }), [A.id]);
  assert.deepEqual(ids({ medal: 'not gold' }), [A.id, D.id, B.id, Cq.id]);
  assert.deepEqual(ids({ car: 'suits my car' }), [A.id, D.id], 'not the class A one, not the one far above my car');
  assert.equal(suitsCar(B, { className: 'D', rating: 500, kw: 80, kg: 1100 }, ctx), true);
});

test('recommended for you: quests I can enter now, near my level and car, not done yet', () => {
  const easy = quest(1, 0, { rating: { stars: 1, km: 2, recommended: 300 } }), mid = quest(2, 0, { rating: { stars: 2, km: 3, recommended: 360 } });
  const hard = quest(1, 90, { rating: { stars: 5, km: 8, recommended: 580 } }), gold = quest(0.5, 0), locked = quest(1, 0, { rating: { stars: 4, km: 6, recommended: 300 }, entry: { classes: ['B'], minLevel: 1 } });
  const profile = { xp: 0, money: 5000, quests: { [gold.id]: { attempts: 1, completed: true, medal: 'gold' } } };
  const car = { className: 'D', rating: 360, kw: 80, kg: 1100 }, ctx = { profile, car, economy, config, at: HOME };
  const rec = recommend([easy, mid, hard, gold, locked], ctx).map(x => x.item.id);
  assert.ok(rec.includes(easy.id) && rec.includes(mid.id));
  assert.ok(!rec.includes(hard.id), 'far above my car'); assert.ok(!rec.includes(gold.id), 'already gold'); assert.ok(!rec.includes(locked.id), 'not my class');
  assert.equal(rec[0], easy.id, 'a new player: the easiest first');
  // higher up, harder ones come first
  const vet = { ...ctx, profile: { ...profile, xp: xpForLevel(10, config) }, car: { ...car, rating: 700, className: 'D' } };
  assert.equal(recommend([easy, mid, hard], vet)[0].item.id, hard.id);
});

test('the free-roam notice: an unplayed quest close by, now and then, never twice, never during a quest', () => {
  const near = quest(0.1, 0), far = quest(2, 0), played = quest(0.05, 180);
  const N = createNotifier({ profile: { quests: { [played.id]: { attempts: 1 } } }, config });
  assert.equal(N.check([near, far, played], HOME, 0, true), null, 'not during a quest');
  assert.equal(N.check([near, far, played], HOME, 1).item.id, near.id);
  const near2 = quest(0.15, 90);
  assert.equal(N.check([near, near2], HOME, 2), null, 'not again so soon');
  assert.equal(N.check([near, near2], HOME, 2 + config.finding.notice.everySeconds).item.id, near2.id, 'the next one, later');
  assert.equal(N.check([near, near2], HOME, 1000), null, 'each quest once');
});

test('fast travel: every baked region is known, and a quest\'s region is found from its place', () => {
  for (const r of baked.regions) {
    const m = json(r.manifest);
    assert.deepEqual(r.bbox, m.bbox, `${r.id}: its bbox as baked`);
  }
  assert.equal(regionOf(HOME, baked.regions).id, 'sf');
  assert.equal(regionOf({ lat: 43.7384, lon: 7.4246 }, baked.regions).id, 'monaco');
  assert.equal(regionOf({ lat: 0, lon: 0 }, baked.regions), null);
});
