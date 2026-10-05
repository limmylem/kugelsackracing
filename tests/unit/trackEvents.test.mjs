// Gameplay on generated tracks (Phase 5 Step 3), the quick checks (npm run test:unit; the big run with the
// physics: npm run test:track-events): the day's and the week's tracks from the date; a shared code's hash;
// the baked track sent to a player whose hash differs; track events as quests (their checks, rewards by kind
// of track, medal targets from the reference laps); a result on a generated track — paid, its record per
// code / version / class, the leaderboard, farming per code, the quick races' hourly cap, and a mismatched
// hash paying nothing; the best lap's ghost; the trip there and back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { harness } from '../harness.mjs';
import { dailyTrack, weeklyTrack, quickTrack, sharedTrack, eventsFor, dayKey, weekKey, recordKey } from '../../track/events/model.js';
import { trackHash, packTrack, unpackTrack, syncPlan, joinRace } from '../../track/events/hash.js';
import { eventCourse, readyEvent } from '../../track/events/prepare.js';
import { lapGhost, ghostFrames, ghostAt } from '../../track/events/ghost.js';
import { trackChecks } from '../../track/events/checks.js';
import { generateTrack } from '../../track/generate.js';
import { buildTrack } from '../../track/build.js';
import { problems, rewardsOf, newItem, TRACK_TYPES } from '../../content/quests.js';
import { medalTargets, rankedTime } from '../../quest/rules.js';
import { buildResult } from '../../quest/result.js';
import { validateResult } from '../../quest/validate.js';
import { createRecorder } from '../../quest/recording.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { MemoryRecordStore } from '../../quest/recordStore.js';
import { createTrackTrip } from '../../play/trackTrip.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const E = json('data/trackEvents.json'), TC = json('data/tracks.json'), config = json('data/quests.json');
const H = await harness(), economy = H.db.economy;

// one track built, shared by the tests below (a short club circuit)
const T0 = sharedTrack(quickTrack('club_circuit', 77, TC).code), data0 = buildTrack(T0.gen, TC);

test('the day\'s and the week\'s tracks: the same date the same track, another date another', () => {
  assert.equal(dayKey('2026-10-05T00:00:01Z'), '2026-10-05'); assert.equal(weekKey('2026-10-05'), '2026-W41'); assert.equal(weekKey('2027-01-01'), '2026-W53'); assert.equal(weekKey('2027-01-04'), '2027-W01');
  const a = dailyTrack('2026-10-05T03:00:00Z', E, TC), b = dailyTrack('2026-10-05T22:59:59Z', E, TC), c = dailyTrack('2026-10-06T00:00:00Z', E, TC);
  assert.equal(a.code, b.code); assert.equal(a.name, b.name); assert.equal(a.gen.hash, b.gen.hash);
  assert.notEqual(a.code, c.code);
  const days = new Set(); for (let d = 0; d < 40; d++) days.add(dailyTrack(Date.UTC(2026, 9, 1) + d * 864e5, E, TC).code);
  assert.equal(days.size, 40, 'forty days, forty tracks');
  const w1 = weeklyTrack('2026-10-05', E, TC), w2 = weeklyTrack('2026-10-11T23:00:00Z', E, TC), w3 = weeklyTrack('2026-10-12', E, TC);
  assert.equal(w1.code, w2.code, 'Monday to Sunday: one track'); assert.notEqual(w1.code, w3.code);
  // its events: the config's, by layout, each with an id of its own and the track on it
  const ev = eventsFor(a, E);
  assert.ok(ev.length >= 2 && new Set(ev.map(e => e.id)).size === ev.length && ev.every(e => e.track.code === a.code && e.track.kind === 'daily'));
});

test('a shared code: the identical track and hash; a player whose track differs gets the baked one', async () => {
  const again = buildTrack(generateTrack({ code: T0.code }), TC), h = trackHash(data0);
  assert.match(h, /^th1-[0-9a-f]{8}$/);
  assert.equal(trackHash(again), h);
  const packed = packTrack(data0), back = unpackTrack(packed);
  assert.equal(trackHash(back), h);
  assert.throws(() => unpackTrack(packed.replace(/"hash":"th1-[0-9a-f]{8}"/, '"hash":"th1-00000000"')), /doesn't match/);
  assert.deepEqual(syncPlan(h, [{ id: 'a', hash: h }, { id: 'b', hash: 'th1-deadbeef' }]), { same: ['a'], download: ['b'] });
  // a player whose build made something else: downloads the host's, and races the same track
  const bent = { ...again, centre: { ...again.centre, x: Float32Array.from(again.centre.x, (v, i) => i === 10 ? v + 0.5 : v) } };
  assert.notEqual(trackHash(bent), h);
  const j = await joinRace({ hash: h, local: async () => bent, fetchBaked: async () => packed });
  assert.ok(j.ok && j.downloaded && j.hash === h);
  const same = await joinRace({ hash: h, local: async () => again, fetchBaked: async () => { throw new Error('not needed'); } });
  assert.ok(same.ok && !same.downloaded);
});

test('track events are quests: their checks, their rewards by kind of track, their medals from the reference laps', () => {
  const [race, hot] = eventsFor(T0, E);
  assert.equal(race.type, 'circuit_race'); assert.equal(hot.type, 'hot_lap');
  // (no check yet: can't be published; a type for a point-to-point on a circuit: wrong)
  const loc = { location: { lat: 37.8, lon: -122.4, alt: 0, heading: 0 } };
  const p = problems({ ...race, ...loc, track: { ...race.track, kind: 'official' } }, { economy });
  assert.ok(p.some(x => x.level === 'error' && /AI test race/.test(x.message)));
  assert.ok(problems({ ...race, ...loc, type: 'hillclimb', track: { ...race.track, kind: 'official', check: { trackOk: true, aiFinished: true } } }, { economy }).some(x => x.level === 'error' && /point-to-point/.test(x.message)));
  assert.deepEqual(problems({ ...race, ...loc, track: { ...race.track, kind: 'official', check: { trackOk: true, aiFinished: true, spots: [] } } }, { economy }).filter(x => x.level === 'error'), []);
  assert.ok(problems({ ...race, ...loc, track: { ...race.track, kind: 'official', check: { trackOk: true, aiFinished: false } } }, { economy }).some(x => /couldn't finish/.test(x.message)));
  // every new type of quest: one that needs a track
  for (const t of TRACK_TYPES) assert.ok(problems(newItem('quest', { id: 'quest_abcd0001', location: { lat: 1, lon: 1 }, type: t }), { economy }).some(x => x.level === 'error' && x.field === 'track'));
  // rewards: a quick race less than a daily one, the same event otherwise; an event's own fee
  const rated = e => ({ ...e, rating: { stars: 3, km: 6 } });
  const q = rewardsOf(rated({ ...race, track: { ...race.track, kind: 'quick' } }), economy), d = rewardsOf(rated({ ...race, track: { ...race.track, kind: 'daily' } }), economy), o = rewardsOf(rated({ ...race, track: { ...race.track, kind: 'official' } }), economy);
  assert.ok(q.money < o.money && o.money < d.money);
  assert.equal(rewardsOf(rated({ ...race, params: { ...race.params, entryFee: 123 } }), economy).fee, 123);
  // medals from the reference laps: a standing start's first lap, then flying ones; a hot lap's best lap one flying lap
  const R = { finished: true, perLap: true, standing: { high: 60, medium: 66, low: 74 }, flying: { high: 55, medium: 61, low: 68 } };
  const { event, course } = readyEvent(race, data0, R, { config });
  const laps = race.params.laps, M = medalTargets(event, course, config);
  assert.deepEqual([M.gold, M.silver, M.bronze], [60 + 55 * (laps - 1), 66 + 61 * (laps - 1), 74 + 68 * (laps - 1)]);
  const H2 = medalTargets(readyEvent(hot, data0, R, { config }).event, eventCourse(data0, R), config);
  assert.deepEqual([H2.gold, H2.silver, H2.bronze], [55, 61, 68]);
  assert.ok(event.rating.stars >= 1 && event.rating.stars <= 5 && event.track.hash === trackHash(data0));
  assert.equal(rankedTime(hot, { laps: [70, 64, 66], time: 200 }), 64);
});

// a finished run on the track, made up but as the session would hand it in: every gate in order, at 40 m/s
function runOf(event, course, { speed = 40, hash = course.trackHash, className = 'C' } = {}) {
  const laps = course.loop ? event.params.laps ?? 1 : 1, L = course.loop ? course.length : course.grid.finishS - course.grid.startS;
  const rel = s => course.loop ? (((s - course.grid.startS) % course.length) + course.length) % course.length : s - course.grid.startS;
  const req = course.gates.filter(g => g.required).map(g => ({ id: g.id, r: rel(g.s) })).sort((a, b) => a.r - b.r);
  const splits = [];
  for (let l = 0; l < laps; l++) for (const [n, g] of req.entries()) splits.push({ id: g.id, number: n + 1, lap: l + 1, time: (l * L + g.r) / speed });
  const lapT = Array.from({ length: laps }, (_, k) => L / speed + (k === 1 ? -0.5 : 0)), total = lapT.reduce((a, b) => a + b, 0);
  const outcome = { status: 'finished', startMode: 'standing', rawTime: total, time: total, laps: lapT, splits, penalties: [], damage: { taken: 0, events: [] } };
  return buildResult({ quest: event, course: { ...course, trackHash: hash }, outcome, car: { carId: 'starter_car', className, topSpeed: 70 }, attemptId: null });
}

test('a run on a generated track: paid, the record per code / version / class and the leaderboard kept; farming by code; quick races capped; a mismatched hash pays nothing', async () => {
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 9, 5) + (clock += 60e3)).toISOString();
  const player = new LocalPlayerService({ db: H.db, storage: new MemoryStorage(), now, quests: { config, recordings: new MemoryRecordStore(), tracks: E } });
  await player.init(); await player.addMoney(1e6);
  const [hot0] = eventsFor(T0, E).filter(e => e.type === 'hot_lap'), R = null;
  const daily = { ...hot0, id: 'trk_daily_test_hot_lap', track: { ...hot0.track, kind: 'daily' } };
  const { event, course } = readyEvent(daily, data0, R, { config });
  const run = async (ev, opts = {}) => {
    const st = await player.startQuest(ev, { car: { className: 'C', kw: 100, kg: 1100 } });
    assert.ok(st.ok, st.error);
    const r = runOf(ev, course, opts); r.attemptId = st.attemptId;
    const rec = createRecorder({ hz: 20 }); for (let t = 0; t <= r.time; t += 0.05) rec.sample(t, { x: t * 40, y: 0, z: 0, q: [0, 0, 0, 1] });
    return player.finishQuest(r, { quest: ev, course, recording: rec.finish({ questId: ev.id }) });
  };
  const first = await run(event);
  assert.ok(first.ok && first.valid && first.money > 0, JSON.stringify(first.problems));
  const key = recordKey(T0.code, T0.version, 'C'), rec = player.profile.trackRecords[key];
  assert.ok(rec && rec.bestTime === rankedTime(event, runOf(event, course)) && rec.recording, 'the record: the best lap of a hot lap');
  assert.equal(player.profile.trackBoards[event.id].length, 1, 'the daily event\'s leaderboard');
  assert.deepEqual(player.profile.trackRecent[0].code, T0.code);
  // its best lap's ghost: a recording of that lap alone, its clock from the lap's start
  const got = await player.getRecording(rec.recording), lap = lapGhost(got.recording, rec.bestLaps);
  assert.equal(lap.meta.lap.n, 2);
  const F = ghostFrames(lap), p0 = ghostAt(F, 0), p1 = ghostAt(F, 1);
  assert.ok(Math.abs(p0.x - rec.bestLaps[0] * 40) < 3 && Math.abs(p1.x - p0.x - 40) < 1, 'the ghost starts where the lap did');
  // farming: by the track's code — another event on the same track counts
  for (let k = 0; k < 4; k++) await run(event);
  const other = await run({ ...event, id: 'trk_daily_test_other', type: 'circuit_race' });
  assert.ok(other.farming < 1, `farmed (×${other.farming})`);
  // a mismatched hash: nothing paid, logged as invalid
  const bad = await run(event, { hash: 'th1-00000000' });
  assert.ok(!bad.valid && bad.money === 0 && bad.problems.some(p => /hash/.test(p)));
  // quick races: capped each hour
  const quick = { ...event, id: 'trk_quick_test_hot_lap', track: { ...event.track, kind: 'quick' } };
  let paid = 0, capped = false;
  for (let k = 0; k < 8; k++) { const r = await run({ ...quick, id: `${quick.id}${k}`, track: { ...quick.track, code: `${quick.track.code}${k}` } }); paid += r.money; capped ||= !!r.capped; }     // (a new track each time: no farming by code)
  assert.ok(capped && paid <= economy.trackEvents.hourlyCap.goldRuns * rewardsOf(quick, economy).money, `paid ${paid}`);
  // favourites
  await player.favouriteTrack({ code: T0.code, kind: 'shared', name: T0.name }, true);
  assert.equal(player.profile.trackFavs[0].code, T0.code);
  await player.favouriteTrack({ code: T0.code }, false);
  assert.equal(player.profile.trackFavs, undefined);
});

test('the track checks: a generated track passes; the trip there and back keeps the spot', async () => {
  assert.deepEqual(trackChecks(T0.gen, TC).problems, []);
  const log = [];
  const trip = createTrackTrip({ config, adapters: {
    spot: () => ({ file: 'real', x: 12.5, y: 3, z: -40, heading: 33 }),
    load: async code => { log.push(`load ${code}`); return { data: data0 }; },
    reference: async () => null,
    enter: async (h, prepared) => { log.push(`enter ${prepared.event.track.code}`); },
    back: async spot => { log.push(`back ${spot.x},${spot.z},${spot.heading}`); },
  } });
  const [race] = eventsFor(T0, E);
  const r = await trip.go(race);
  assert.ok(r.ok && trip.state === 'track' && r.prepared.hashOk);
  const l = await trip.leave();
  assert.ok(l.ok && trip.state === 'roam');
  assert.deepEqual(log, [`load ${T0.code}`, `enter ${T0.code}`, 'back 12.5,-40,33']);
  // a track that can't be made: back where it was
  const t2 = createTrackTrip({ config, adapters: { spot: () => ({ x: 1, z: 2, heading: 3 }), load: async () => { throw new Error('nope'); }, reference: async () => null, enter: async () => {}, back: async s => log.push(`back ${s.x}`) } });
  const f = await t2.go(race);
  assert.ok(!f.ok && /nope/.test(f.error) && t2.state === 'roam' && log.at(-1) === 'back 1');
});

test('the editor: a venue and the designer\'s track event are valid content; it publishes only once tested', async () => {
  const { contentChecker } = await import('../../content/schema.js');
  const { newDesigner, rollSeed, previewTrack, newEventFrom } = await import('../../editor/trackEvent.js');
  const check = contentChecker(json('data/schemas/content-item.schema.json'), { economy, classes: json('data/classes.json').classes, cars: {} });
  const SF = { lat: 37.79, lon: -122.4, alt: 0, heading: 0 };
  const venue = { ...newItem('venue', { id: 'venue_abcd0001', location: SF }), name: 'Bay Raceway' };
  assert.deepEqual(check.shape(venue), []);
  assert.ok(problems(venue, { economy }).some(p => p.level === 'warning' && /No track events/.test(p.message)));
  // rolling seeds: each a track (its code, map and checks), the same seed the same track
  const td = newDesigner(TC.presets); td.preset = 'club_circuit'; td.seed = 1234;
  previewTrack(td, TC);
  const code = td.code;
  assert.ok(code && td.svg && td.problems.length === 0 && td.info.layout === 'loop' && td.name);
  rollSeed(td); previewTrack(td, TC);
  assert.notEqual(td.code, code);
  td.seed = 1234; previewTrack(td, TC); assert.equal(td.code, code);
  const ev = { ...newEventFrom(td, { venue }), id: 'quest_abcd0002', author: 'editor' };     // (the service names and signs it)
  assert.deepEqual(check.shape(ev), []);
  assert.equal(ev.venue, venue.id); assert.equal(ev.track.kind, 'official'); assert.equal(ev.type, 'circuit_race');
  assert.ok(problems(ev, { economy }).some(p => p.level === 'error' && /AI test race/.test(p.message)), 'not before its AI test race');
  const tested = { ...ev, rating: { stars: 2, km: 4 }, track: { ...ev.track, hash: 'th1-00000001', check: { trackOk: true, aiFinished: true, spots: [{ message: 'Turn 3: AIs off route ×2' }], hash: 'th1-00000001' } } };
  const p = problems(tested, { economy });
  assert.deepEqual(p.filter(x => x.level === 'error'), []);
  assert.ok(p.some(x => x.level === 'warning' && /Turn 3/.test(x.message)), 'problem corners: a warning');
  assert.ok(problems({ ...tested, track: { ...tested.track, hash: 'th1-00000002' } }, { economy }).some(x => /changed since its test race/.test(x.message)));
  assert.deepEqual(check.shape({ ...venue, events: [ev.id] }), []);
});
