// Phase 4 Step 5: saves from older versions of the game load — the player's profile (versions 1–3), world
// content (an export and a browser's store from version 1–3), and ghost recordings (version 1) — from frozen
// files in tests/fixtures/saves (made by those versions' formats; never regenerate them: they're the old
// saves). Each is brought up to date one version at a time, kept what it had, and passes today's checks.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { harness } from '../harness.mjs';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { CURRENT_VERSION } from '../../garage/player/migrations.js';
import { PROFILE_VERSION, buildOf, packProfile } from '../../garage/player/profile.js';
import { bestOf } from '../../garage/player/quests.js';
import { createValidator } from '../../garage/jsonSchema.js';
import { MemoryRecordStore } from '../../quest/recordStore.js';
import { createRecorder, decodeRecording, migrateRecording, recordingFits, FORMAT, RECORDING_VERSION } from '../../quest/recording.js';
import { createLocalContentService } from '../../content/service.js';
import { MemoryContentStorage } from '../../content/storage.js';
import { contentChecker } from '../../content/schema.js';
import { makeRater } from '../../content/rating.js';
import { CONTENT_VERSION, rewardsOf } from '../../content/quests.js';

const H = await harness(), db = H.db;
const json = p => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const fixture = f => json(`tests/fixtures/saves/${f}`);
const validator = createValidator({ 'profile.schema.json': json('data/schemas/profile.schema.json') });
const now = () => '2026-10-05T12:00:00.000Z';
async function load(save, extra = {}) {
  const storage = new MemoryStorage(save), service = new LocalPlayerService({ db, storage, now, ...extra });
  const r = await service.init();
  return { service, storage, profile: r.updatedState, notices: r.notices };
}

test('profile saves of every older version load, keep what they had, and pass today\'s schema', async () => {
  assert.equal(CURRENT_VERSION, PROFILE_VERSION);
  for (const v of [1, 2, 3]) {
    const old = fixture(`profile-v${v}.json`);
    assert.equal(old.version ?? 1, v, `the fixture is a version ${v} save`);
    const { profile, notices, storage, service } = await load(old);
    assert.equal(profile.version, CURRENT_VERSION, `v${v}`);
    assert.deepEqual(validator.validate('profile.schema.json', packProfile(profile)), [], `v${v} passes the schema`);
    assert.deepEqual(notices, [], `v${v}: nothing lost`);
    assert.ok(profile.cars[profile.currentCar], `v${v}: a car to drive`);
    // saved again and reopened: the same
    await service.addMoney(1);
    const again = await load(await storage.load());
    assert.equal(again.profile.money, profile.money + 1, `v${v}: saves and loads again`);
  }
  // version 1: the garage before the shop — its fitted intake kept, money given
  const v1 = (await load(fixture('profile-v1.json'))).profile;
  assert.equal(v1.money, db.economy.startingMoney);
  assert.equal(v1.parts[buildOf(v1, db, v1.currentCar).socket_intake].partId, 'cold_air_intake');
  // version 2: dents as a list become a dent log (the same dents)
  const old2 = fixture('profile-v2.json'), dented = Object.values(old2.parts).find(p => p.dents);
  const v2 = (await load(old2)).profile, now2 = v2.parts[dented.instanceId];
  assert.equal(v2.money, old2.money);
  assert.equal(now2.condition, dented.condition);
  assert.equal(now2.dentLog.base.length, dented.dents.length);
  assert.equal(now2.dents.length, dented.dents.length);
  // version 3: quest progress as Steps 3–4 kept it — records, medals and what was paid kept; the new fields
  // filled in (no recent finishes, the route version of each best not known)
  const old3 = fixture('profile-v3.json'), v3 = (await load(old3)).profile;
  assert.equal(v3.xp, old3.xp); assert.equal(v3.money, old3.money);
  for (const [id, q] of Object.entries(old3.quests)) {
    const n = v3.quests[id];
    for (const k of ['attempts', 'finishes', 'dnfs', 'completed', 'medal', 'bestTime', 'paidShare', 'recording']) assert.deepEqual(n[k], q[k], `${id} ${k}`);
    assert.deepEqual(n.recent, []); assert.equal(n.routeVersion, null); assert.equal(n.oldRecord, false); assert.equal(n.oldBest, null);
    assert.equal(n.bestPlace, q.bestPlace ?? null);
  }
  assert.ok(Object.values(v3.parts).some(p => p.dentLog?.hits?.length === 1 && p.dents?.length), 'the packed dent log unpacked');
  // an old best whose route version isn't known: still the record, splits to race against kept
  const B = bestOf(v3.quests.quest_old00001, 'a-new-version');
  assert.equal(B.old, false); assert.deepEqual(B.splits, old3.quests.quest_old00001.bestSplits);
  // a save from a newer version of the game: not read, said so (and not overwritten)
  const future = new MemoryStorage({ ...old3, version: CURRENT_VERSION + 1 });
  await assert.rejects(new LocalPlayerService({ db, storage: future, now }).init(), /newer version of the game/);
  assert.equal((await future.load()).version, CURRENT_VERSION + 1); assert.equal(future.saves, 0);
});

test('ghost recordings: version 1 still reads, the same samples; version 2 says what it\'s a run of', async () => {
  const v1 = fixture('recording-v1.json');
  assert.equal(v1.format, 'kr-ghost-1');
  const m = migrateRecording(v1);
  assert.equal(m.format, FORMAT); assert.equal(m.version, RECORDING_VERSION);
  assert.equal(m.meta.routeVersion, null);
  const frames = decodeRecording(v1);
  assert.equal(frames.length, v1.frames);
  assert.deepEqual(decodeRecording(m), frames, 'the same samples either way');
  assert.ok(Math.abs(frames[100].x - 200) < 0.01 && Math.abs(frames[100].t - 5) < 1e-9);
  // a version 1 recording races on any version of its route (which one it was isn't known)
  assert.equal(recordingFits(m, 'abc'), true);
  // version 2: what it's a run of
  const R = createRecorder({ hz: 10 });
  for (let k = 0; k < 20; k++) R.sample(k / 10, { x: k, y: 0, z: 0, q: [0, 0, 0, 1], vx: 10, vy: 0, vz: 0 });
  const v2 = R.finish({ questId: 'quest_x0000001', routeVersion: 'rv1' });
  assert.equal(v2.version, 2); assert.equal(v2.meta.questId, 'quest_x0000001');
  assert.equal(recordingFits(v2, 'rv1'), true); assert.equal(recordingFits(v2, 'rv2'), false, 'not raced on a changed route');
  assert.throws(() => decodeRecording({ format: 'kr-ghost-9' }), /not a recording this game reads/);
  // through the player service: a version 1 recording in the store comes back up to date
  const recordings = new MemoryRecordStore();
  await recordings.put('rec_quest_old00001_a3', v1);
  const { service } = await load(fixture('profile-v3.json'), { quests: { config: json('data/quests.json'), recordings } });
  const got = await service.getRecording('rec_quest_old00001_a3');
  assert.ok(got.ok, got.error); assert.equal(got.recording.format, FORMAT);
});

const economy = json('data/economy.json'), classes = json('data/classes.json').classes, config = json('data/quests.json');
const check = contentChecker(json('data/schemas/content-item.schema.json'), { economy, classes, cars: Object.fromEntries(json('data/cars/index.json').cars.map(c => [c.id ?? c.split('/')[0], true])) });
const rate = makeRater({ config, classes });
const contentService = storage => createLocalContentService({ storage, check, rate, autosaveMs: null, now });

test('world content: an older export and an older browser store come in as today\'s, quests rated from their routes', async () => {
  // an export from version 3 (and a version 2 and a version 1 item in it)
  const doc = fixture('content-v3-export.json');
  assert.equal(doc.version, 3);
  const S = contentService(new MemoryContentStorage());
  const r = await S.importContent(doc);
  assert.ok(r.ok && r.imported === 4 && r.skipped.length === 0, JSON.stringify(r));
  assert.equal(r.migrated, 6, 'every copy of every item (drafts and published)');
  const quest = (await S.get('quest_old00001', { view: 'published' })).item;
  assert.equal(quest.version, CONTENT_VERSION);
  assert.equal(quest.fee, undefined); assert.equal(quest.rewards, undefined);
  assert.ok(quest.rating?.stars >= 1 && Math.abs(quest.rating.km - 3) < 0.1, `rated from its route: ${JSON.stringify(quest.rating)}`);
  assert.equal(rewardsOf(quest, economy).rated, true);
  assert.equal((await S.get('route_old00001')).item.version, CONTENT_VERSION);
  assert.equal((await S.get('poi_old00001')).item.name, 'Old lookout');
  assert.equal((await S.get('quest_old00002')).item.name, 'Old drift');
  // what an older build left in this browser: brought up to date as it loads, rated, and saved so
  const old = fixture('content-v3-store.json'), storage = new MemoryContentStorage();
  await storage.setIndex(old.index);
  await storage.putCells(new Map(Object.entries(old.cells)));
  const B = contentService(storage);
  const q = (await B.get('quest_old00001', { view: 'published' })).item;
  assert.equal(q.version, CONTENT_VERSION); assert.equal(q.fee, undefined); assert.ok(q.rating?.stars >= 1);
  assert.equal(q.rating.routeVersion, quest.rating.routeVersion, 'the same rating as imported');
  assert.equal((await B.query({ lat: 37.7936, lon: -122.3965, km: 2, view: 'draft' })).items.length, 3);
  await B.flush();
  const stored = (await storage.getCells(['published/9q8zn'])).get('published/9q8zn').items;
  assert.ok(stored.every(it => it.version === CONTENT_VERSION), 'written back as today\'s');
});
