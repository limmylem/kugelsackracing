// World content (Phase 4 Step 1): the quest format and its plain-word checks, the local world content
// service (cells, spatial queries, drafts and published copies, archiving, surviving a restart), export and
// import (round trip, version checks, migrating version 1), and undo / redo of every editor action.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encode, decode, cellsAround, distanceKm, parseLatLon, offset, tileBox } from '../../content/geo.js';
import { newItem, rewardsOf, problems, withType, TYPE_IDS, entryCheck } from '../../content/quests.js';
import { contentChecker } from '../../content/schema.js';
import { migrate } from '../../content/migrations.js';
import { createLocalContentService } from '../../content/service.js';
import { MemoryContentStorage } from '../../content/storage.js';
import { createHistory } from '../../content/history.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const economy = json('data/economy.json'), classes = json('data/classes.json').classes, schema = json('data/schemas/content-item.schema.json');
const cars = Object.fromEntries(json('data/cars/index.json').cars.map(c => [c.id ?? c, true]));
const check = contentChecker(schema, { economy, classes, cars });
const SF = { lat: 37.7936, lon: -122.3965 };
let n = 0;
const service = (storage = new MemoryContentStorage()) => createLocalContentService({ storage, check, autosaveMs: null, newId: kind => `${kind}_${String(++n).padStart(6, '0')}`, now: () => '2026-10-04T12:00:00.000Z' });
const sprint = (loc = SF, extra = {}) => ({ ...newItem('quest', { id: 'quest_tmp000', location: { ...loc, alt: 3, heading: 45 }, type: 'sprint' }), ...extra });
const finished = (loc = SF) => { const q = sprint(loc); q.params.finish = { ...offset(loc, 1, 90), alt: 4, heading: 90 }; return q; };

test('geohash cells: encode/decode round trip, cells round a point, lat/lon parsing', () => {
  const h = encode(SF.lat, SF.lon, 5);
  assert.equal(h, '9q8zn');
  assert.equal(encode(57.64911, 10.40744, 11), 'u4pruydqqvj', 'the reference point');
  const d = decode(h);
  assert.ok(d.box[0] <= SF.lat && d.box[2] >= SF.lat && d.box[1] <= SF.lon && d.box[3] >= SF.lon);
  const cells = cellsAround(SF.lat, SF.lon, 3);
  assert.ok(cells.includes(h) && cells.length >= 4 && cells.length < 20, `${cells.length}`);
  assert.ok(Math.abs(distanceKm(SF, offset(SF, 12.5, 33)) - 12.5) < 1e-6);
  assert.deepEqual(parseLatLon('37.7936, -122.3965'), SF);
  const dms = parseLatLon(`37°47'37"N 122°23'47"W`);
  assert.ok(Math.abs(dms.lat - 37.7936) < 1e-3 && Math.abs(dms.lon + 122.3964) < 1e-3);
  assert.equal(parseLatLon('Market Street'), null);
  assert.ok(cellsAround(0, 179.99, 5).some(c => decode(c).lon < 0), 'a circle over the antimeridian takes cells on both sides');
  const [s, w, n_, e] = tileBox(1, 0, 0);
  assert.ok(Math.abs(w + 180) < 1e-9 && Math.abs(e) < 1e-9 && s === 0 && n_ > 85);
});

test('the quest format: every type is valid in shape, and says in plain words what it still needs', () => {
  for (const type of TYPE_IDS) {
    const q = newItem('quest', { id: 'quest_abcd0001', location: { ...SF }, type });
    assert.deepEqual(check.shape(q), [], type);
    const errors = problems(q, { economy, classes, cars }).filter(p => p.level === 'error');
    assert.ok(errors.length >= 1, `a new ${type} isn't complete yet`);
    for (const e of errors) assert.match(e.message, /^[A-Z].*[.)]$/, 'a sentence');
  }
  assert.ok(problems(sprint(), { economy }).some(p => p.message === 'Sprint needs a finish line.'));
  const q = finished(); q.fee = 5000;
  assert.ok(problems(q, { economy }).some(p => /Entry fee \(\$5,000\) is higher than the reward \(\$800\)/.test(p.message)));
  q.fee = 600;
  assert.ok(problems(q, { economy }).some(p => /more than 50% of the reward/.test(p.message)));
  q.fee = 300;
  assert.deepEqual(problems(q, { economy }).filter(p => p.level === 'error'), []);
  // the shape: bad fields are caught
  assert.ok(check.shape({ ...q, fee: -1 }).length && check.shape({ ...q, extra: 1 }).length && check.shape({ ...q, location: { lat: 99, lon: 0, alt: 0, heading: 0 } }).length);
  assert.ok(check.shape({ ...newItem('poi', { id: 'poi_abcd0001', location: SF }), rewards: { tier: 'easy' } }).length, 'a point of interest has no rewards');
  // a type switched keeps what both have
  assert.deepEqual(withType(finished(), 'pink_slip').params.finish, finished().params.finish);
});

test('rewards come from the economy\'s rules, never from the quest', () => {
  const q = finished();
  assert.equal(rewardsOf(q, economy).money, 800);
  q.rewards.tier = 'hard'; q.entry.classes = ['B', 'A'];
  assert.equal(rewardsOf(q, economy).money, Math.round(800 * 1.6 * 2.4 / 50) * 50, 'the lowest class let in sets it');
  const drift = withType(q, 'drift');
  assert.equal(rewardsOf(drift, economy).money, Math.round(800 * 1.6 * 1.1 * 2.4 / 50) * 50);
  assert.equal(rewardsOf(withType(q, 'pink_slip'), economy).money, 0);
  const richer = { ...economy, quests: { ...economy.quests, base: { ...economy.quests.base, money: 1000 } } };
  assert.ok(rewardsOf(q, richer).money > rewardsOf(q, economy).money, 'changing the rules changes every quest');
  q.rewards.tier = 'legendary';
  assert.ok(problems(q, { economy }).some(p => /There's no reward tier "legendary"/.test(p.message)));
  assert.deepEqual(entryCheck(finished(), { className: 'D', kw: 80, kg: 1100 }), []);
  const e = entryCheck({ entry: { classes: ['C'], maxPowerKw: 100 } }, { className: 'D', kw: 120, kg: 1100 });
  assert.deepEqual(e.map(x => x.ok), [false, false]);
});

test('the service: drafts, publishing, the game sees only what is published (and switched on)', async () => {
  const S = service();
  const r = await S.create(sprint());
  assert.ok(r.ok, r.error);
  const id = r.item.id;
  assert.equal((await S.query({ ...SF, km: 1 })).items.length, 1);
  assert.equal((await S.query({ ...SF, km: 1, view: 'published' })).items.length, 0, 'the game sees nothing yet');
  const bad = await S.publish(id);
  assert.ok(!bad.ok && /Sprint needs a finish line/.test(bad.error), bad.error);
  await S.update(id, { params: finished().params });
  const pub = await S.publish(id);
  assert.ok(pub.ok, pub.error);
  assert.equal((await S.query({ ...SF, km: 1, view: 'published' })).items[0].item.name, 'New sprint');
  // edits after publishing are a draft: the game keeps the published copy until it's published again
  await S.update(id, { name: 'Embarcadero dash' });
  assert.equal((await S.get(id, { view: 'published' })).item.name, 'New sprint');
  assert.equal((await S.get(id)).item.name, 'Embarcadero dash');
  await S.publish(id);
  assert.equal((await S.get(id, { view: 'published' })).item.name, 'Embarcadero dash');
  // switched off: kept published, not offered
  await S.update(id, { enabled: false }); await S.publish(id);
  assert.equal((await S.query({ ...SF, km: 1, view: 'published', offered: true })).items.length, 0);
});

test('deleting: a draft is gone; a published item asks first, then is archived (kept) and can be restored', async () => {
  const S = service();
  const d = (await S.create(sprint())).item.id;
  assert.ok((await S.remove(d)).ok);
  assert.equal((await S.get(d)).item, null);
  const p = (await S.create(finished())).item.id;
  await S.publish(p);
  const ask = await S.remove(p);
  assert.ok(!ask.ok && ask.needsConfirm && /Archive it\?/.test(ask.error));
  assert.ok((await S.get(p, { view: 'published' })).item, 'still published until confirmed');
  const done = await S.remove(p, { confirm: true });
  assert.ok(done.ok && done.archived);
  assert.equal((await S.query({ ...SF, km: 5, view: 'published' })).items.length, 0);
  assert.equal((await S.get(p, { view: 'archived' })).item.status, 'archived');
  const back = await S.restore(p);
  assert.ok(back.ok && back.item.status === 'draft');
});

test('spatial queries: within X km (nearest first), in a cell, in a map tile, and moving between cells', async () => {
  const S = service(), ids = [];
  for (const [km, b] of [[0.2, 0], [2, 90], [8, 180], [30, 270], [3000, 45]]) ids.push((await S.create(sprint({ ...offset(SF, km, b) }))).item.id);
  const near = await S.query({ ...SF, km: 10 });
  assert.deepEqual(near.items.map(x => Math.round(x.km * 10) / 10), [0.2, 2, 8]);
  assert.equal((await S.query({ ...SF, km: 5000 })).items.length, 5);
  assert.equal((await S.inCell(encode(SF.lat, SF.lon, 5))).items.length, 1);
  // the z14 tile under the first one
  const n14 = 2 ** 14, p0 = offset(SF, 0.2, 0), x = Math.floor((p0.lon + 180) / 360 * n14), y = Math.floor((1 - Math.log(Math.tan(p0.lat * Math.PI / 180) + 1 / Math.cos(p0.lat * Math.PI / 180)) / Math.PI) / 2 * n14);
  assert.deepEqual((await S.inTile(14, x, y)).items.map(i => i.id), [ids[0]]);
  // moved 30 km: found there, not here
  await S.update(ids[0], { location: { ...offset(SF, 40, 0), alt: 0, heading: 0 } });
  assert.equal((await S.query({ ...SF, km: 1 })).items.length, 0);
  assert.equal((await S.query({ ...offset(SF, 40, 0), km: 1 })).items.length, 1);
});

test('everything survives a restart (the storage is all there is)', async () => {
  const storage = new MemoryContentStorage(), S = service(storage);
  const id = (await S.create(finished())).item.id;
  await S.publish(id);
  await S.update(id, { name: 'Changed after publishing' });
  await S.flush();
  const S2 = service(storage);
  assert.equal((await S2.get(id)).item.name, 'Changed after publishing');
  assert.equal((await S2.get(id, { view: 'published' })).item.name, 'New sprint');
  assert.equal((await S2.query({ ...SF, km: 1, view: 'published' })).items.length, 1);
});

test('export and import: a round trip, one area or everything, version checks, version 1 migrated', async () => {
  const A = service();
  const ids = [];
  for (let k = 0; k < 6; k++) { const r = await A.create(finished(offset(SF, k * 2, 30 * k))); ids.push(r.item.id); if (k % 2) await A.publish(r.item.id); }
  await A.remove(ids[1], { confirm: true });            // (archived)
  const all = await A.exportContent();
  assert.equal(all.count, 6);
  const B = service(); const r = await B.importContent(all.json);
  assert.ok(r.ok && r.imported === 6 && r.skipped.length === 0, JSON.stringify(r));
  for (const id of ids) assert.deepEqual((await B.getState(id)).state, (await A.getState(id)).state, `${id} came back the same`);
  const area = await A.exportContent({ area: { ...SF, km: 3 } });
  assert.equal(area.count, 2);
  // version checks
  const doc = JSON.parse(all.json);
  assert.match((await B.importContent({ ...doc, version: 9 })).error, /newer version of the game/);
  assert.match((await B.importContent({ format: 'something-else' })).error, /isn't a world content file/);
  assert.match((await B.importContent('{ not json')).error, /isn't a world content file/);
  // an older file (version 1: flat places, money set by hand) comes in as version 2, on a tier
  const v1 = { format: 'world-content', version: 1, entries: [{ draft: { id: 'quest_old00001', version: 1, kind: 'quest', title: 'Old drift', lat: SF.lat, lon: SF.lon, heading: -90, questType: 'drift', reward: 1500, fee: 100, author: 'early', created: '2025-01-01T00:00:00Z' } }] };
  const m = await B.importContent(v1);
  assert.ok(m.ok && m.imported === 1 && m.migrated === 1, JSON.stringify(m));
  const old = (await B.get('quest_old00001')).item;
  assert.equal(old.version, 2); assert.equal(old.name, 'Old drift'); assert.equal(old.type, 'drift'); assert.deepEqual(old.rewards, { tier: 'hard' }); assert.equal(old.location.heading, 270);
  assert.equal(migrate({ version: 3 }).error.includes('newer version'), true);
  // a broken entry is skipped with its reason, the rest come in
  const mixed = await B.importContent({ ...doc, entries: [{ draft: { ...doc.entries[0].draft, location: { lat: 200, lon: 0, alt: 0, heading: 0 } } }, doc.entries[2]] });
  assert.equal(mixed.imported, 1); assert.equal(mixed.skipped.length, 1);
});

test('undo and redo every editor action: place, move, turn, edit, duplicate, delete, archive, restore, publish', async () => {
  const S = service(), H = createHistory(S);
  const snap = async () => JSON.stringify((await S.exportContent()).json && JSON.parse((await S.exportContent()).json).entries);
  const states = [await snap()];
  const place = await H.run('Place', [], () => S.create(finished())), id = place.item.id; states.push(await snap());
  await H.run('Move', [id], () => S.update(id, { location: { ...offset(SF, 6, 10), alt: 3, heading: 45 } })); states.push(await snap());
  await H.run('Turn', [id], () => S.update(id, { location: { ...offset(SF, 6, 10), alt: 3, heading: 180 } })); states.push(await snap());
  await H.run('Edit', [id], () => S.update(id, { name: 'Edited', fee: 100 })); states.push(await snap());
  const dup = await H.run('Duplicate', [], async () => { const it = (await S.get(id)).item; return S.create({ ...it, id: undefined, name: 'Copy' }); }); states.push(await snap());
  await H.run('Publish', [id], () => S.publish(id)); states.push(await snap());
  await H.run('Archive', [id], () => S.remove(id, { confirm: true })); states.push(await snap());
  await H.run('Restore', [id], () => S.restore(id)); states.push(await snap());
  await H.run('Delete', [dup.item.id], () => S.remove(dup.item.id)); states.push(await snap());
  // all the way back, checking each step, then all the way forward
  for (let k = states.length - 1; k > 0; k--) { assert.ok((await H.undo()).ok); assert.equal(await snap(), states[k - 1], `undo to step ${k - 1}`); }
  assert.ok(!(await H.undo()).ok, 'nothing left to undo');
  for (let k = 1; k < states.length; k++) { assert.ok((await H.redo()).ok); assert.equal(await snap(), states[k], `redo to step ${k}`); }
  // a drag is one step
  const before = await snap();
  for (let k = 0; k < 10; k++) await H.run('Move', [id], () => S.update(id, { location: { ...offset(SF, k * 0.01, 0), alt: 3, heading: 45 } }), { merge: `move:${id}` });
  await H.undo();
  assert.equal(await snap(), before, 'ten drag moves undone in one');
});
