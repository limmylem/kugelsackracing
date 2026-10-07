// Multiplayer on the API (Phase 7 Step 2; docs/MULTIPLAYER.md): friends and blocks, what a join ticket carries, the
// leaving cooldown, development players, and a race's results — each run checked (the Phase 6 Step 3 rules, and the
// race server's own time), a failed one disqualified and the others moved up, ratings moved (ranked races only), each
// player paid by place. The race server is played by the test here (its internal calls); the bot races
// (server/tools/mp-race-test.ts) run the whole thing through the real-time server.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { testApp, signUp, makeStaff, Player } from './helpers.ts';
import { verifyTicket } from '../src/rt/tickets.ts';
import { seedMpRoutes } from '../tools/seed-mp-routes.ts';
import { raceQuest } from '../../mp/quest.js';
import { driveRun } from '../../mp/bot.js';

const MP = JSON.parse(fs.readFileSync(new URL('../../data/multiplayer.json', import.meta.url), 'utf8'));
const QCFG = JSON.parse(fs.readFileSync(new URL('../../data/quests.json', import.meta.url), 'utf8'));
const FAST = { ...MP.npc, corneringG: 1.6, accelG: 0.8, brakeG: 1.2 };
let T: Awaited<ReturnType<typeof testApp>>;
before(async () => { T = await testApp('mp'); await seedMpRoutes((T.app as any).content, { regions: ['mk'] }); });
after(async () => { await T.close(); });
const mp = () => (T.app as any).mp;
let n = 0;
const player = (name: string) => signUp(T.app, T.outbox, { email: `${name.toLowerCase().replace(/\W/g, '')}${++n}@example.com`, name, ip: `10.80.${n}.1` });
const internal = (method: string, url: string, body?: unknown) => T.app.inject({ method: method as any, url: `/api/v1/internal/mp${url}`, headers: { 'x-kr-internal': T.config.rtSecret, 'content-type': 'application/json' }, payload: body === undefined ? undefined : JSON.stringify(body) });

test('friends: a request, accepted by the other; a block ends it and keeps them apart; guests can\'t add friends', async () => {
  const a = await player('Ada Apex'), b = await player('Bo Brake'), c = await player('Cy Clutch');
  assert.equal((await a.post('/api/v1/friends', { name: 'bo brake' })).body.status, 'outgoing');
  assert.deepEqual((await b.get('/api/v1/friends')).body.friends.map((f: any) => [f.name, f.status]), [['Ada Apex', 'incoming']]);
  const aMe = (await b.get('/api/v1/friends')).body.friends[0].id;
  assert.equal((await b.post(`/api/v1/friends/${aMe}/accept`, {})).status, 200);
  assert.equal((await a.get('/api/v1/friends')).body.friends[0].status, 'friend');
  // (Cy asks Ada; Ada blocks Cy: the request's gone and Cy can't ask again)
  await c.post('/api/v1/friends', { name: 'Ada Apex' });
  const cId = (await a.get('/api/v1/friends')).body.friends.find((f: any) => f.name === 'Cy Clutch').id;
  assert.equal((await a.post('/api/v1/blocks', { id: cId })).status, 200);
  assert.ok(!(await a.get('/api/v1/friends')).body.friends.some((f: any) => f.name === 'Cy Clutch'));
  assert.deepEqual((await a.get('/api/v1/friends')).body.blocked.map((x: any) => x.name), ['Cy Clutch']);
  assert.equal((await c.post('/api/v1/friends', { name: 'Ada Apex' })).status, 403);
  const rel = await mp().relations(cId);
  assert.ok(rel.blockedBy.length === 1 && rel.friends.length === 0, 'the race server sees the block both ways');
  const g = new Player(T.app, '10.80.200.1');
  if ((await g.post('/api/auth/sign-in/anonymous', {})).status === 200) {
    await g.post('/api/v1/me/terms', { termsVersion: T.config.termsVersion, birthDate: '1990-01-01' }).catch(() => null);
    assert.equal((await g.post('/api/v1/friends', { name: 'Ada Apex' })).status, 403);
  }
});

test('a join ticket carries the rating, the cars (class and performance rating, worked out here) and the blocks; development players are guests of their own', async () => {
  const p = await player('Tess Ticket');
  const r = await p.post('/api/v1/rt/ticket', {});
  assert.equal(r.status, 200, r.text);
  const t = verifyTicket(T.config.rtSecret, r.body.ticket)!;
  assert.equal(t.mp!.rating.races, 0);
  assert.ok(t.mp!.cars.length >= 1 && t.mp!.cars.every(c => /^[DCBASX]$/.test(c.cls) && c.pr >= 100), JSON.stringify(t.mp!.cars));
  assert.equal(t.mp!.cooldownUntil, null);
  const anon = new Player(T.app, '10.80.201.1');
  const d = await anon.post('/api/v1/rt/ticket', { player: 'Q' });
  const dt = verifyTicket(T.config.rtSecret, d.body.ticket)!;
  assert.equal(dt.name, 'Player Q'); assert.ok(dt.mp!.cars.length >= 1, 'a garage of its own');
  assert.equal(verifyTicket(T.config.rtSecret, (await anon.post('/api/v1/rt/ticket', { player: 'Q' })).body.ticket)!.uid, dt.uid, 'the same player each time');
});

test('the race server\'s calls need its key', async () => {
  const r = await T.app.inject({ method: 'POST', url: '/api/v1/internal/mp/venue', headers: { 'content-type': 'application/json', 'x-kr-internal': 'nope' }, payload: '{}' });
  assert.equal(r.statusCode, 403);
  const v = await internal('POST', '/venue', { venue: { kind: 'route', id: 'route_mpmk' } });
  assert.equal(v.statusCode, 200, v.body);
  const j = JSON.parse(v.body);
  assert.equal(j.frame.kind, 'region'); assert.equal(j.frame.region, 'mk'); assert.ok(j.course.path, 'the course as stored');
});

test('a ranked race: runs checked, a failed one disqualified (the others move up), ratings moved, pay by place, a leaver counted', async () => {
  const ps = [await player('Rae One'), await player('Sid Two'), await player('Tom Three'), await player('Uma Four'), await player('Vic Five')];
  const ids: string[] = [];
  for (const p of ps) ids.push(verifyTicket(T.config.rtSecret, (await p.post('/api/v1/rt/ticket', {})).body.ticket)!.uid);
  const v = await mp().venue({ kind: 'route', id: 'route_mpmk' }), course = v.check, raceId = `test-${Date.now()}`;
  const quest = raceQuest({ raceId, venue: v.venue, laps: 1, loop: course.loop });
  // (each one's run as their game would hand it in)
  const runs: any[] = [0.97, 0.94, 0.91, 0.88].map((skill, i) => driveRun({ course, quest, quests: QCFG, cfg: FAST, skill, slot: i }));
  assert.ok(runs.every(r => r.result?.status === 'finished'), 'the runs finish');
  const results = runs.map((r, i) => ({ pid: ids[i], uid: ids[i], name: `P${i}`, place: i + 1, status: 'finished', timeMs: r.timeMs, penaltyMs: 0, flags: [], car: { cls: 'D' } }));
  results.push({ pid: ids[4], uid: ids[4], name: 'P4', place: 5, status: 'dnf', why: 'left', leftEarly: true, timeMs: null, penaltyMs: 0, flags: [], car: { cls: 'D' } } as any);
  results.push({ pid: 'npc:x', uid: 'npc:x', name: 'An NPC', npc: true, place: 6, status: 'finished', timeMs: 999999, penaltyMs: 0, flags: [], car: null } as any);
  const rec = { id: raceId, kind: 'quick', ranked: true, venue: v.venue, settings: { laps: 1 }, courseVersion: course.version, km: course.length / 1000, results };
  assert.equal((await internal('POST', '/races', rec)).statusCode, 200);
  // the winner's run: changed (a checkpoint taken out) — it won't pass the check
  const bad = { ...runs[0].result, checkpoints: runs[0].result.checkpoints.slice(1) };
  const sub = async (i: number, result: any) => JSON.parse((await internal('POST', `/races/${raceId}/runs`, { uid: ids[i], result, recording: null })).body);
  assert.equal((await sub(0, bad)).verdict.ok, false);
  assert.equal((await sub(1, runs[1].result)).verdict.ok, true);
  // (the third: a run 5 s faster than the race server saw)
  const fast = { ...runs[2].result, rawTime: runs[2].result.rawTime - 5, time: runs[2].result.time - 5, laps: [runs[2].result.laps[0] - 5], checkpoints: runs[2].result.checkpoints.map((c: any) => ({ ...c, time: c.time - 5 })) };
  assert.equal((await sub(2, fast)).verdict.ok, true, 'it passes the rules on its own…');
  // (the fourth hands nothing in: confirmed when the wait is over — here, now)
  const view = await mp().finalize(raceId);
  assert.equal(view.state, 'confirmed');
  const by = Object.fromEntries(view.confirmed.map((r: any) => [r.uid, r]));
  assert.equal(by[ids[0]].status, 'dsq'); assert.match(by[ids[0]].problems.join(' '), /checkpoint/i);
  assert.equal(by[ids[2]].status, 'dsq', '…but not against what the race server saw'); assert.match(by[ids[2]].problems.join(' '), /race server saw/);
  assert.equal(by[ids[3]].status, 'dsq'); assert.match(by[ids[3]].problems.join(' '), /handed in/);
  assert.equal(by[ids[1]].place, 1, 'second over the line, first once the results are confirmed');
  assert.equal(by['npc:x'].place, 2);
  assert.ok(by[ids[1]].pay.money > 0 && by[ids[1]].pay.paid, 'paid');
  assert.equal(by[ids[0]].pay.money, 0);
  const again = await mp().finalize(raceId);
  assert.equal(again.confirmed.length, view.confirmed.length, 'confirmed once');
  // ratings: the winner up, the disqualified and the leaver down; a race each
  const rWin = await mp().ratingOf(ids[1]), rBad = await mp().ratingOf(ids[0]), rLeft = await mp().ratingOf(ids[4]);
  assert.ok(rWin.mu > 25 && rBad.mu < 25 && rLeft.mu < 25, JSON.stringify([rWin, rBad, rLeft]));
  assert.equal(rWin.races, 1); assert.equal(rWin.wins, 1);
  assert.ok(by[ids[1]].rank.ranked && by[ids[1]].rank.after.id === 'unranked', 'a tier once placed: Unranked for now');
  // (players see it too)
  const pv = await ps[1].get(`/api/v1/mp/races/${raceId}`);
  assert.equal(pv.status, 200); assert.equal(pv.body.state, 'confirmed');
});

test('leaving ranked races early: a cooldown after the free ones, longer each time', async () => {
  const p = await player('Lea Leaver');
  const uid = verifyTicket(T.config.rtSecret, (await p.post('/api/v1/rt/ticket', {})).body.ticket)!.uid;
  for (let i = 0; i <= MP.leaving.freeLeaves; i++) {
    const id = `leave-${i}-${Date.now()}`;
    await internal('POST', '/races', { id, kind: 'quick', ranked: true, venue: { kind: 'route', id: 'route_mpmk' }, settings: {}, km: 5, results: [{ pid: uid, uid, name: 'L', place: 1, status: 'dnf', why: 'left', leftEarly: true, flags: [] }] });
  }
  const me = (await p.get('/api/v1/mp/me')).body;
  assert.ok(me.cooldownUntil && new Date(me.cooldownUntil).getTime() > Date.now(), JSON.stringify(me));
  const t = verifyTicket(T.config.rtSecret, (await p.post('/api/v1/rt/ticket', {})).body.ticket)!;
  assert.ok(t.mp!.cooldownUntil! > Date.now(), 'the ticket says so: the queue refuses it');
  // (an unranked race left early doesn't count)
  const q = await player('Uli Unranked');
  const quid = verifyTicket(T.config.rtSecret, (await q.post('/api/v1/rt/ticket', {})).body.ticket)!.uid;
  for (let i = 0; i < 5; i++) await internal('POST', '/races', { id: `cust-${i}-${Date.now()}`, kind: 'custom', ranked: false, venue: { kind: 'route', id: 'route_mpmk' }, settings: {}, km: 5, results: [{ pid: quid, uid: quid, name: 'U', place: 1, status: 'dnf', why: 'left', leftEarly: true, flags: [] }] });
  assert.equal((await q.get('/api/v1/mp/me')).body.cooldownUntil, null);
});

test('the queue\'s dashboard: admins only, its numbers against the targets', async () => {
  mp().queueStats({ waiting: 3, waitNowP95Sec: 4, matches: [{ skillSpread: 3, performanceSpread: 40, sameClass: true, waitSec: [2, 5], humans: 8, npcFill: false }] });
  const p = await player('Pat Player');
  assert.equal((await p.get('/api/v1/admin/mp/dashboard')).status, 403);
  const boss = await makeStaff(T.app, await player('Bea Boss'), `beaboss${n}@example.com`, 'admin');
  const d = await boss.get('/api/v1/admin/mp/dashboard');
  assert.equal(d.status, 200, d.text);
  assert.equal(d.body.hour.matches, 1); assert.deepEqual(d.body.targets, MP.queue.targets);
});
