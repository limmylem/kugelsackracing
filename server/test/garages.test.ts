// The starting garages (data/world/garages.json → server/src/content/garages.ts): published once, each a valid garage
// in its region; a second start changes nothing; one an editor has archived (or deleted) stays that way.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { testApp } from './helpers.ts';
import { ensureStartingGarages, startingGarages } from '../src/content/garages.ts';

let T: Awaited<ReturnType<typeof testApp>>;
before(async () => { T = await testApp('garages'); });
after(async () => { await T?.close(); });

test('the starting garages: two or three in every baked region, published once, an editor\'s archiving kept', async () => {
  const list = startingGarages(), regions = JSON.parse(fs.readFileSync(new URL('../../data/map/baked.json', import.meta.url), 'utf8')).regions;
  for (const r of regions) {
    const here = list.filter(g => g.region === r.id);
    assert.ok(here.length >= 2 && here.length <= 3, `${r.id}: ${here.length} garages`);
    for (const g of here) assert.ok(g.location.lon >= r.bbox[0] && g.location.lon <= r.bbox[2] && g.location.lat >= r.bbox[1] && g.location.lat <= r.bbox[3], `${g.id} in ${r.id}`);
  }
  const C = T.app.content as any, db = T.app.deps.db as any;
  const made = await ensureStartingGarages(db, C);
  assert.equal(made.length, list.length, 'every one published (the test server doesn\'t at start)');
  for (const g of list) {
    const it = (await C.get(g.id, 'published')).item;
    assert.equal(it?.kind, 'garage', g.id); assert.equal(it.name, g.name); assert.equal(it.location.heading, g.location.heading);
  }
  // (found by a player near one)
  const g0 = list[0], near = await C.query({ lat: g0.location.lat, lon: g0.location.lon, km: 2, view: 'published', offered: true, kinds: ['garage'], limit: 50 });
  assert.ok(near.items.some((x: any) => x.item.id === g0.id));
  // again: nothing new
  assert.deepEqual(await ensureStartingGarages(db, C), []);
  // an editor archives one: the next start leaves it archived
  const editor = { id: null, name: 'Ed' };
  await C.remove(list[1].id, true, editor);
  assert.deepEqual(await ensureStartingGarages(db, C), []);
  const st = (await C.getState(list[1].id)).state;
  assert.ok(!st.published, 'still not published');
});
