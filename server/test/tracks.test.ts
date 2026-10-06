// Generated tracks on the server (Phase 6 Step 1): the day's and the week's tracks worked out here (the
// game's own search — the same tracks the game makes — kept, and the same for everyone), runs handed in and
// checked by the game's own rules against the course as built here, records, leaderboards (best first, one
// place a player, the banned left out), a quick race's record, an official event's board, and replays kept
// (decoded to check, compressed, the newest kept, anyone with the id can watch, only the owner deletes).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, makeStaff } from './helpers.ts';
import { dailyTrack, weeklyTrack, sharedTrack, eventsFor } from '../../track/events/model.js';
import { questVersionOf } from '../../quest/result.js';
import { createRaceRecording } from '../../race/raceReplay.js';
import { newTrackEvent } from '../../track/events/model.js';

const read = (f: string) => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const E = read('data/trackEvents.json'), TC = read('data/tracks.json');
const r3 = (x: number) => Math.round(x * 1000) / 1000;

let T: Awaited<ReturnType<typeof testApp>>, ana: Player, bob: Player, cat: Player, ed: Player, anon: Player;
before(async () => {
  T = await testApp('tracks', { overrides: { replays: { keepPerPlayer: 3 } } });
  [ana, bob, cat, ed] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'ana@example.com', name: 'Ana Apex', ip: '10.3.0.1' }),
    signUp(T.app, T.outbox, { email: 'bob@example.com', name: 'Bob Brake', ip: '10.3.0.2' }),
    signUp(T.app, T.outbox, { email: 'cat@example.com', name: 'Cat Curb', ip: '10.3.0.3' }),
    signUp(T.app, T.outbox, { email: 'ed@example.com', name: 'Ed Itor', ip: '10.3.0.4' }),
  ]);
  anon = new Player(T.app, '10.3.0.9');
  await makeStaff(T.app, ed, 'ed@example.com', 'editor');
});
after(async () => { await T?.close(); });

// a run as the game would hand it in (quest/result.js): every required checkpoint in order on every lap, at
// a steady speed (m/s) — or impossibly fast
function run(event: any, course: any, { speed = 45, topSpeed = 60, hash = course.trackHash, className = 'D' } = {}) {
  const loop = course.loop, L = course.length, startS = course.grid.startS, lapLength = loop ? L : course.grid.finishS - startS;
  const laps = loop ? Math.max(1, event.params?.laps ?? 1) : 1;
  const rel = (s: number) => loop ? (((s - startS) % L) + L) % L : s - startS;
  const gates = course.gates.filter((g: any) => g.required).map((g: any) => ({ id: g.id, r: rel(g.s) })).sort((a: any, b: any) => a.r - b.r);
  const checkpoints: any[] = [];
  for (let lap = 1; lap <= laps; lap++) for (const g of gates) checkpoints.push({ id: g.id, lap, time: r3(((lap - 1) * lapLength + g.r) / speed + 0.001 * (checkpoints.length + 1)) });
  const lapTimes = Array.from({ length: laps }, (_, k) => r3(lapLength / speed + (k === 0 ? 0.5 : 0)));
  const raw = r3(lapTimes.reduce((a, b) => a + b, 0));
  return {
    format: 1, attemptId: `at_${Math.random().toString(36).slice(2)}`, at: new Date().toISOString(),
    questId: event.id, questVersion: questVersionOf(event), type: event.type, routeId: null, routeVersion: course.version,
    status: 'finished', reason: null,
    car: { carId: 'starter_car', instanceId: 'c1', fingerprint: 'fp', className, kw: 90, kg: 1100, topSpeed },
    start: { mode: event.params?.start ?? 'standing', jump: false },
    checkpoints, laps: lapTimes, rawTime: raw, time: raw, penalties: [], score: null, medal: null,
    damage: { taken: 0, events: [] }, resets: 0,
    track: { code: event.track.code, kind: event.track.kind, hash, version: event.track.version ?? null },
    recording: null,
  };
}
// a timed event of a track's (not a race with rivals: its place would need a field)
const timed = (events: any[]) => events.find(e => ['hot_lap', 'hillclimb', 'time_trial', 'sprint'].includes(e.type) && !e.npc?.count) ?? events[0];

let today: any;
test('the day\'s and the week\'s tracks are worked out here: the game\'s own, kept, the same for everyone', async () => {
  const r = await anon.get('/api/v1/tracks/today');
  assert.equal(r.status, 200, r.text);
  today = r.body;
  const d = dailyTrack(new Date(), E, TC), w = weeklyTrack(new Date(), E, TC);
  assert.equal(today.daily.code, d.code); assert.equal(today.daily.name, d.name); assert.equal(today.daily.key, d.key);
  assert.equal(today.weekly.code, w.code); assert.equal(today.weekly.key, w.key);
  assert.match(today.daily.hash, /^th\d-/);
  // its events: the game's, with the hash of the track built here
  assert.deepEqual(today.daily.events.map((e: any) => e.id), eventsFor(d, E).map((e: any) => e.id));
  for (const e of today.daily.events) assert.equal(e.track.hash, today.daily.hash);
  assert.ok(Date.parse(today.daily.endsAt) > Date.now() && Date.parse(today.daily.endsAt) - Date.now() <= 864e5);
  assert.match(String(r.headers['cache-control']), /public, max-age=\d+/);
  // kept: a second server asks the database, not the worker
  const rows = (await T.app.deps.db.execute(sql`select kind, key from track_days order by kind`)).rows;
  assert.deepEqual(rows.map((x: any) => `${x.kind}:${x.key}`), [`daily:${d.key}`, `weekly:${w.key}`]);
  assert.equal((await T.app.deps.db.execute(sql`select count(*)::int as n from track_courses`)).rows[0].n, 2);
  const t0 = performance.now();
  assert.equal((await anon.get('/api/v1/tracks/today')).status, 200);
  assert.ok(performance.now() - t0 < 200, 'from what was kept');
});

test('a run handed in: checked against the course built here; the record; the leaderboard, best first, one place a player', async () => {
  const ev = timed(today.daily.events), b = await T.app.tracks.built(today.daily.code);
  const r = await ana.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view, { speed: 40 }) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.accepted, true, JSON.stringify(r.body.problems));
  assert.equal(r.body.pb, true); assert.equal(r.body.record.code, today.daily.code); assert.equal(r.body.record.carClass, 'D'); assert.equal(r.body.record.runs, 1);
  assert.deepEqual(r.body.board, { place: 1, of: 1 });
  // a faster player: first; the first, second
  const fast = await bob.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view, { speed: 50 }) });
  assert.deepEqual(fast.body.board, { place: 1, of: 2 });
  // slower again: not a best, no new place; then faster than Bob: first, still one place each
  const slow = await ana.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view, { speed: 30 }) });
  assert.equal(slow.body.accepted, true); assert.equal(slow.body.pb, false); assert.equal(slow.body.record.runs, 2);
  assert.deepEqual(slow.body.board, { place: 2, of: 2 });
  const best = await ana.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view, { speed: 55 }) });
  assert.equal(best.body.pb, true); assert.deepEqual(best.body.board, { place: 1, of: 2 });
  // the board: as anyone sees it, and as Ana does
  const board = await anon.get(`/api/v1/tracks/leaderboard?eventId=${ev.id}`);
  assert.equal(board.status, 200, board.text);
  assert.deepEqual(board.body.entries.map((e: any) => [e.place, e.displayName]), [[1, 'Ana Apex'], [2, 'Bob Brake']]);
  assert.ok(board.body.entries[0].value < board.body.entries[1].value);
  assert.equal(board.body.mine, null); assert.ok(board.body.entries.every((e: any) => !e.you));
  assert.ok(!JSON.stringify(board.body).includes('@'), 'no emails');
  const mine = await ana.get(`/api/v1/tracks/leaderboard?eventId=${ev.id}`);
  assert.equal(mine.body.mine.place, 1); assert.equal(mine.body.entries[0].you, true);
  // records
  const recs = await ana.get('/api/v1/tracks/records');
  assert.equal(recs.status, 200); assert.equal(recs.body.records.length, 1);
  assert.equal(recs.body.records[0].bestTime, board.body.entries[0].value);
  assert.equal((await anon.get('/api/v1/tracks/records')).status, 401);
});

test('runs the game\'s rules refuse: another track\'s hash, impossible speed, another track, an event that\'s over or never was', async () => {
  const ev = timed(today.daily.events), b = await T.app.tracks.built(today.daily.code);
  const wrongHash = await cat.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view, { hash: 'th1-deadbeef' }) });
  assert.equal(wrongHash.status, 200); assert.equal(wrongHash.body.accepted, false);
  assert.match(wrongHash.body.problems.join(' '), /hash/);
  assert.equal(wrongHash.body.board, null);
  const tooFast = await cat.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view, { speed: 400, topSpeed: 60 }) });
  assert.equal(tooFast.body.accepted, false); assert.match(tooFast.body.problems.join(' '), /Impossible time/);
  // (kept, with why: an admin can look)
  const kept = (await T.app.deps.db.execute(sql`select accepted, problems from track_results r join users u on u.id = r.user_id where u.name = 'Cat Curb'`)).rows as any[];
  assert.equal(kept.length, 2); assert.ok(kept.every(k => !k.accepted && k.problems.length));
  assert.ok(!(await anon.get(`/api/v1/tracks/leaderboard?eventId=${ev.id}`)).body.entries.some((e: any) => e.displayName === 'Cat Curb'));
  // another track's result for this event; a day that's over; an event that was never
  const other = run(ev, b.view); other.track.code = today.weekly.code;
  assert.equal((await cat.post('/api/v1/tracks/results', { eventId: ev.id, result: other })).status, 400);
  const old = dailyTrack(Date.now() - 3 * 864e5, E, TC), oldEv = timed(eventsFor(old, E));
  const gone = await cat.post('/api/v1/tracks/results', { eventId: oldEv.id, result: { ...run(ev, b.view), track: { ...run(ev, b.view).track, code: old.code } } });
  assert.equal(gone.status, 410, gone.text); assert.equal(gone.body.error.code, 'GONE');
  assert.equal((await cat.post('/api/v1/tracks/results', { eventId: 'quest_nope', result: run(ev, b.view) })).status, 404);
  assert.equal((await cat.post('/api/v1/tracks/results', { eventId: ev.id.replace(/_[a-z_]+$/, '_nope'), result: run(ev, b.view) })).status, 404);
  // (signed in, and the terms accepted: a visitor can't hand a run in)
  assert.equal((await anon.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view) })).status, 401);
  // malformed: rejected cleanly
  const bad = await cat.post('/api/v1/tracks/results', { eventId: ev.id, result: { ...run(ev, b.view), laps: 'fast' } });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'VALIDATION');
});

test('a banned player leaves the boards; a suspension that\'s over brings them back', async () => {
  const ev = timed(today.daily.events);
  await T.app.deps.db.execute(sql`update users set banned = true where name = 'Ana Apex'`);
  const b1 = await anon.get(`/api/v1/tracks/leaderboard?eventId=${ev.id}`);
  assert.deepEqual(b1.body.entries.map((e: any) => e.displayName), ['Bob Brake']);
  await T.app.deps.db.execute(sql`update users set ban_expires = now() - interval '1 day' where name = 'Ana Apex'`);
  const b2 = await anon.get(`/api/v1/tracks/leaderboard?eventId=${ev.id}`);
  assert.deepEqual(b2.body.entries.map((e: any) => e.displayName), ['Ana Apex', 'Bob Brake']);
  await T.app.deps.db.execute(sql`update users set banned = false, ban_expires = null where name = 'Ana Apex'`);
});

test('a quick race\'s run: a record, no leaderboard; an official event (published content): its board', async () => {
  // (a code a friend gave: the quick race's events made here from the code, as the game makes them)
  const code = today.weekly.code, t = { ...sharedTrack(code), kind: 'quick' }, ev = timed(eventsFor(t, E));
  const b = await T.app.tracks.built(code);
  const q = await bob.post('/api/v1/tracks/results', { eventId: ev.id, result: run({ ...ev, track: { ...ev.track, hash: b.hash } }, b.view, { className: 'C' }) });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.body.accepted, true, JSON.stringify(q.body.problems));
  assert.equal(q.body.board, null); assert.equal(q.body.record.carClass, 'C');
  // an official event: made in the editor, published — its own board
  // (its AI test race run in the editor: the check it keeps)
  const official = newTrackEvent({ id: 'quest_official1', track: { ...t, kind: 'official', hash: b.hash, check: { trackOk: true, aiFinished: true, hash: b.hash, spots: [] } }, type: ev.type, params: ev.params, location: { lat: 37.79, lon: -122.39 } });
  const made = await ed.post('/api/v1/content/items', { ...official, id: 'quest_official1' });
  assert.equal(made.status, 200, made.text);
  const id = made.body.item.id;
  const pub = await ed.post(`/api/v1/content/items/${id}/publish`);
  assert.equal(pub.status, 200, pub.text);
  const item = (await anon.get(`/api/v1/content/items/${id}`)).body.item;
  const o = await cat.post('/api/v1/tracks/results', { eventId: id, result: run(item, b.view) });
  assert.equal(o.body.accepted, true, JSON.stringify(o.body.problems));
  assert.deepEqual(o.body.board, { place: 1, of: 1 });
  // (not published: no results)
  await ed.post(`/api/v1/content/items/${id}/unpublish`);
  assert.equal((await cat.post('/api/v1/tracks/results', { eventId: id, result: run(item, b.view) })).status, 404);
});

// a race replay as the game records one: a few cars, a few seconds
function replay(cars = 3, seconds = 4) {
  const R = createRaceRecording({ hz: 20 });
  for (let k = 0; k <= seconds * 60; k++) {
    const t = k / 60;
    R.sample(t, Array.from({ length: cars }, (_, i) => ({ id: `c${i}`, name: i ? `Rival ${i}` : 'You', colour: '#e8433a', player: i === 0, x: t * 30 + i * 3, y: 0.5, z: i * 4, q: [0, 0, 0, 1], vx: 30, vy: 0, vz: 0 })));
    if (k === 90) R.note(t, 'overtake', { car: 'c1' });
  }
  return R.finish();
}
test('replays are kept: checked, compressed, the newest kept (and a record\'s), anyone with the id watches, only the owner deletes', async () => {
  const up = await ana.post('/api/v1/replays', { eventId: timed(today.daily.events).id, code: today.daily.code, title: 'Daily hot lap', recording: replay() });
  assert.equal(up.status, 200, up.text);
  const id = up.body.id;
  assert.match(id, /^rp_/); assert.equal(up.body.cars, 3); assert.equal(up.body.mine, true);
  assert.ok(up.body.bytes > 0 && up.body.bytes < JSON.stringify(replay()).length, 'compressed');
  // anyone with the id: the same recording back
  const got = await anon.get(`/api/v1/replays/${id}`);
  assert.equal(got.status, 200, got.text);
  assert.deepEqual(got.body.recording, JSON.parse(JSON.stringify(replay())));
  assert.equal(got.body.meta.mine, false);
  // a record that points to it (handed in with the run): kept however many come after
  const ev = timed(today.daily.events), b = await T.app.tracks.built(today.daily.code);
  const pb = await ana.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view, { speed: 58 }), replayId: id });
  assert.equal(pb.body.pb, true); assert.equal(pb.body.record.replayId, id);
  assert.equal((await anon.get(`/api/v1/tracks/leaderboard?eventId=${ev.id}`)).body.entries[0].replayId, id);
  // (someone else's replay can't be named with a run)
  const theirs = await bob.post('/api/v1/tracks/results', { eventId: ev.id, result: run(ev, b.view, { speed: 59 }), replayId: id });
  assert.equal(theirs.body.record.replayId, null);
  for (let k = 0; k < 4; k++) assert.equal((await ana.post('/api/v1/replays', { eventId: null, code: null, title: `Run ${k}`, recording: replay(2, 2) })).status, 200);
  const list = await ana.get('/api/v1/replays');
  assert.equal(list.body.replays.length, 4, 'the newest 3, and the record\'s');
  assert.ok(list.body.replays.some((r: any) => r.id === id));
  assert.deepEqual(list.body.replays.filter((r: any) => r.id !== id).map((r: any) => r.title), ['Run 3', 'Run 2', 'Run 1']);
  // only the owner deletes (the record's link goes with it)
  assert.equal((await bob.del(`/api/v1/replays/${id}`)).status, 404);
  assert.equal((await ana.del(`/api/v1/replays/${id}`)).status, 200);
  assert.equal((await anon.get(`/api/v1/replays/${id}`)).status, 404);
  assert.equal((await ana.get('/api/v1/tracks/records')).body.records[0].replayId, null);
  // a recording that doesn't decode; one too big; a bad id
  const broken = replay(); broken.cars[0].rec.data = 'not base64 at all!!';
  assert.equal((await ana.post('/api/v1/replays', { eventId: null, code: null, title: 'x', recording: broken })).status, 400);
  assert.equal((await anon.get('/api/v1/replays/..%2F..%2Fetc')).status, 400);
  assert.equal((await anon.post('/api/v1/replays', { eventId: null, code: null, title: 'x', recording: replay() })).status, 401);
});
