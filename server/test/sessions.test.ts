// Runs and drives on the server (Phase 6 Step 2): a quest's entry fee charged once, with a session; a refund
// only for a run that never got going; a quit, a wreck, a run gone quiet (the timeout): nothing paid; a
// finished run paid at most once, however many times it's handed in; the pink slip's car only for a win the
// server believes; crash damage only inside a session, about the car being driven, and never mending
// anything — and repairs priced by the server from the damage it keeps.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp } from './helpers.ts';
import { newItem, feeOf } from '../../content/quests.js';
import { offset } from '../../content/geo.js';
import { questVersionOf } from '../../quest/result.js';
import { repairCost } from '../../garage/player/profile.js';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const SF = { lat: 37.7936, lon: -122.3965 };
let T: Awaited<ReturnType<typeof testApp>>, cat: Player, ed: Player;
const act = (p: Player, action: string, args: object) => p.post(`/api/v1/player/actions/${action}`, { args });
const profile = async (p: Player) => (await p.get('/api/v1/player')).body.profile;
const ledger = async (p: Player) => (await p.get('/api/v1/player/ledger')).body.entries;
const uid = async (email: string) => ((await T.app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any).id as string;

// a run as the game would hand it in, on a course the server built (as tests/tracks.test.ts makes them)
function run(event: any, course: any, attemptId: string, { speed = 45 } = {}) {
  const loop = course.loop, L = course.length, startS = course.grid.startS, lapLength = loop ? L : course.grid.finishS - startS;
  const laps = loop ? Math.max(1, event.params?.laps ?? 1) : 1, rel = (s: number) => loop ? (((s - startS) % L) + L) % L : s - startS;
  const gates = course.gates.filter((g: any) => g.required).map((g: any) => ({ id: g.id, r: rel(g.s) })).sort((a: any, b: any) => a.r - b.r);
  const checkpoints: any[] = [];
  for (let lap = 1; lap <= laps; lap++) for (const g of gates) checkpoints.push({ id: g.id, lap, time: r3(((lap - 1) * lapLength + g.r) / speed + 0.001 * (checkpoints.length + 1)) });
  const lapTimes = Array.from({ length: laps }, (_, k) => r3(lapLength / speed + (k === 0 ? 0.5 : 0))), raw = r3(lapTimes.reduce((a, b) => a + b, 0));
  return { format: 1, attemptId, at: new Date().toISOString(), questId: event.id, questVersion: questVersionOf(event), type: event.type, routeId: null, routeVersion: course.version, status: 'finished', reason: null,
    car: { carId: 'starter_car', instanceId: 'x', fingerprint: 'f', className: 'D', kw: 90, kg: 1100, topSpeed: 60 }, start: { mode: 'rolling', jump: false }, checkpoints, laps: lapTimes, rawTime: raw, time: raw,
    penalties: [], score: null, medal: null, damage: { taken: 0, events: [] }, resets: 0, track: { code: event.track.code, kind: event.track.kind, hash: course.trackHash, version: event.track.version ?? null }, recording: null };
}

let feeQuest = '';
before(async () => {
  T = await testApp('sessions');
  [cat, ed] = await Promise.all([signUp(T.app, T.outbox, { email: 'cat@example.com', name: 'Cat Curb', ip: '10.7.0.1' }), signUp(T.app, T.outbox, { email: 'ed@example.com', name: 'Ed Itor', ip: '10.7.0.2' })]);
  await T.app.deps.db.execute(sql`update users set role = 'editor' where email = 'ed@example.com'`);
  // (a published 4-star quest: a fee to enter; the player at a level that may)
  const q: any = { ...newItem('quest', { location: { ...SF, alt: 3, heading: 0 }, type: 'sprint' } as any), name: 'Embarcadero dash', rating: { stars: 4, km: 3 } };
  q.params.finish = { ...offset(SF, 1, 90), alt: 3, heading: 90 };
  const made = await ed.post('/api/v1/content/items', q);
  feeQuest = made.body.item.id;
  assert.equal((await ed.post(`/api/v1/content/items/${feeQuest}/publish`)).status, 200);
  await profile(cat);
  await T.app.economy.withPlayer(await uid('cat@example.com'), async tx => { await tx.execute(sql`update player_economy set xp = 200000, rev = rev + 1 where user_id = ${await uid('cat@example.com')}`); });
});
after(async () => { await T?.close(); });

test('a quest\'s entry fee: charged once, with a session; refunded only for a run that never got going', async () => {
  const m0 = (await profile(cat)).money;
  // (the fee by the game's own rule, from the quest as published and the server's settings)
  const item = (await cat.get(`/api/v1/content/items/${feeQuest}`)).body.item, fee = feeOf(item, (await T.app.economyConfig.gameDb()).db.economy);
  assert.ok(fee > 0);
  const s = await act(cat, 'startQuest', { questId: feeQuest });
  assert.equal(s.status, 200, s.text);
  assert.equal(s.body.fee, fee); assert.match(s.body.sessionId, /^ses_/);
  assert.equal(s.body.updatedState.money, m0 - fee);
  const L = await ledger(cat);
  assert.equal(L[0].kind, 'entry_fee'); assert.equal(L[0].amount, -fee); assert.equal(L[0].sessionId, s.body.sessionId); assert.match(L[0].reason, /Embarcadero dash/);
  // (the database won't take a second fee for one session)
  await assert.rejects(T.app.deps.db.execute(sql`insert into ledger (user_id, amount, balance_after, kind, reason, session_id) values (${await uid('cat@example.com')}, ${-fee}, ${m0 - 2 * fee}, 'entry_fee', 'again', ${s.body.sessionId})`));
  // the refund: once
  const back = await act(cat, 'refundQuest', { sessionId: s.body.sessionId });
  assert.equal(back.status, 200, back.text);
  assert.equal((await profile(cat)).money, m0);
  assert.equal((await act(cat, 'refundQuest', { sessionId: s.body.sessionId })).status, 409);
  // a run under way (crash damage reported): no refund
  const s2 = (await act(cat, 'startQuest', { questId: feeQuest })).body;
  const p = await profile(cat), part = Object.values<any>(p.parts).find(x => x.installedOn?.car === p.currentCar)!;
  assert.equal((await act(cat, 'damageCar', { sessionId: s2.sessionId, carInstanceId: p.currentCar, report: { parts: { [part.instanceId]: { condition: part.condition - 5 } } } })).status, 200);
  const late = await act(cat, 'refundQuest', { sessionId: s2.sessionId });
  assert.equal(late.status, 409); assert.match(late.body.error.message, /got under way/);
  // a wreck: counted, nothing paid
  assert.equal((await act(cat, 'failQuest', { sessionId: s2.sessionId, status: 'wrecked' })).status, 200);
  assert.equal((await act(cat, 'failQuest', { sessionId: s2.sessionId, status: 'wrecked' })).status, 409, 'it ended');
  const st = (await T.app.deps.db.execute(sql`select state, end_reason from economy_sessions where id = ${s2.sessionId}`)).rows[0] as any;
  assert.deepEqual([st.state, st.end_reason], ['failed', 'wrecked']);
  // a quest the server doesn't know, or a made-up session
  assert.equal((await act(cat, 'startQuest', { questId: 'quest_made_up' })).status, 404);
  assert.equal((await act(cat, 'finishQuest', { sessionId: 'ses_00000000-0000-0000-0000-000000000000', result: run({ id: 'x', type: 'sprint', track: { code: 'A', kind: 'daily' } }, { loop: false, length: 100, grid: { startS: 0, finishS: 100 }, gates: [], version: 'v' }, 'att_x') })).status, 400);
  assert.deepEqual(await T.app.economy.ledgerCheck(), []);
});

test('a finished run: paid once, however many times it\'s handed in at once', async () => {
  const today = (await cat.get('/api/v1/tracks/today')).body, ev = today.daily.events.find((e: any) => !e.npc?.count) ?? today.daily.events[0];
  const s = await act(cat, 'startQuest', { questId: ev.id, trackCode: today.daily.code });
  assert.equal(s.status, 200, s.text);
  const b = await T.app.tracks.built(today.daily.code), m0 = (await profile(cat)).money;
  const result = run(ev, b.view, (await T.app.deps.db.execute(sql`select attempt_id from economy_sessions where id = ${s.body.sessionId}`)).rows[0].attempt_id as string);
  // (another run's result: refused)
  assert.equal((await act(cat, 'finishQuest', { sessionId: s.body.sessionId, result: { ...result, attemptId: 'att_someone' } })).status, 400);
  const all = await Promise.all(Array.from({ length: 10 }, () => act(cat, 'finishQuest', { sessionId: s.body.sessionId, result })));
  const ok = all.filter(x => x.status === 200);
  assert.equal(ok.length, 1, all.map(x => `${x.status} ${x.body?.error?.message ?? ''}`).join(' | '));
  assert.equal(ok[0].body.valid, true, JSON.stringify(ok[0].body.problems));
  assert.ok(ok[0].body.money > 0 && ok[0].body.xp > 0);
  const p = await profile(cat);
  assert.equal(p.money, m0 + ok[0].body.money);
  const rewards = (await ledger(cat)).filter((e: any) => e.kind === 'reward' && e.sessionId === s.body.sessionId);
  assert.equal(rewards.length, 1);
  assert.equal(p.quests[ev.id].finishes, 1);
  assert.deepEqual(await T.app.economy.ledgerCheck(), []);
});

test('a run gone quiet (the game closed): ended by the server as a quit — the fee spent, nothing paid', async () => {
  const s = (await act(cat, 'startQuest', { questId: feeQuest })).body, m = (await profile(cat)).money;
  await T.app.deps.db.execute(sql`update economy_sessions set last_seen = now() - interval '11 minutes' where id = ${s.sessionId}`);
  assert.ok(await T.app.economy.sweep() >= 1);
  const st = (await T.app.deps.db.execute(sql`select state from economy_sessions where id = ${s.sessionId}`)).rows[0] as any;
  assert.equal(st.state, 'expired');
  assert.equal((await profile(cat)).money, m);
  assert.equal((await act(cat, 'finishQuest', { sessionId: s.sessionId, result: { format: 1 } })).status, 400);
  // (a heartbeat keeps one alive)
  const s2 = (await act(cat, 'startQuest', { questId: feeQuest })).body;
  await T.app.deps.db.execute(sql`update economy_sessions set last_seen = now() - interval '9 minutes' where id = ${s2.sessionId}`);
  assert.equal((await cat.post(`/api/v1/player/sessions/${s2.sessionId}/heartbeat`)).status, 200);
  await T.app.deps.db.execute(sql`update economy_sessions set last_seen = last_seen - interval '9 minutes' where id <> ${s2.sessionId}`);
  await T.app.economy.sweep();
  assert.equal(((await T.app.deps.db.execute(sql`select state from economy_sessions where id = ${s2.sessionId}`)).rows[0] as any).state, 'active');
  await act(cat, 'failQuest', { sessionId: s2.sessionId, status: 'quit' });
});

test('pink slips: no car for a run that isn\'t a won pink slip; a car only staked in one', async () => {
  const s = (await act(cat, 'startQuest', { questId: feeQuest })).body;
  const p = await profile(cat);
  const award = await act(cat, 'awardCar', { sessionId: s.sessionId, result: { format: 1, attemptId: 'att', at: 'x', questId: feeQuest, questVersion: 'v', type: 'pink_slip', routeId: null, routeVersion: null, status: 'finished', reason: null,
    car: { carId: null, instanceId: null, fingerprint: null, className: null, kw: null, kg: null, topSpeed: null }, start: { jump: false }, checkpoints: [], laps: [], rawTime: 1, time: 1, penalties: [], score: null, medal: null, damage: { taken: 0, events: [] }, resets: 0, place: 1, recording: null } });
  assert.equal(award.status, 409); assert.match(award.body.error.message, /pink-slip race/);
  const forfeit = await act(cat, 'forfeitCar', { sessionId: s.sessionId, carInstanceId: p.currentCar });
  assert.equal(forfeit.status, 409);
  assert.equal(Object.keys((await profile(cat)).cars).length, Object.keys(p.cars).length, 'still their car');
  await act(cat, 'failQuest', { sessionId: s.sessionId, status: 'quit' });
});

test('crash damage: only in a session, about the car being driven, never mending; repairs priced by the server', async () => {
  const p = await profile(cat), car = p.currentCar, part = Object.values<any>(p.parts).find(x => x.installedOn?.car === car && x.condition === 100) ?? Object.values<any>(p.parts).find(x => x.installedOn?.car === car)!;
  // no session: refused
  assert.equal((await act(cat, 'damageCar', { carInstanceId: car, report: { parts: { [part.instanceId]: { condition: 50 } } } })).status, 400);
  const d = (await cat.post('/api/v1/player/drives', { carInstanceId: car, mode: 'free' })).body;
  assert.match(d.sessionId, /^drv_/);
  const hit = await act(cat, 'damageCar', { sessionId: d.sessionId, carInstanceId: car, report: { parts: { [part.instanceId]: { condition: 60, damage: { bent: 0.4 } } }, shell: { condition: 80 } }, cause: 'wall' });
  assert.equal(hit.status, 200, hit.text);
  let now = (await profile(cat)).parts[part.instanceId];
  assert.equal(now.condition, Math.min(part.condition, 60)); assert.equal(now.damage?.bent, 0.4);
  // "mending" reports: a higher condition, mechanical damage cleared, a dent list replaced — none of it takes
  await act(cat, 'damageCar', { sessionId: d.sessionId, carInstanceId: car, report: { parts: { [part.instanceId]: { condition: 100, damage: {} } } } });
  now = (await profile(cat)).parts[part.instanceId];
  assert.equal(now.condition, Math.min(part.condition, 60)); assert.equal(now.damage?.bent, 0.4);
  assert.equal((await act(cat, 'damageCar', { sessionId: d.sessionId, carInstanceId: car, report: { parts: { [part.instanceId]: { dents: [] } } } })).status, 400);
  // another car's part, or another car: refused
  const other = Object.values<any>(p.parts).find(x => !x.installedOn || x.installedOn.car !== car);
  if (other) assert.equal((await act(cat, 'damageCar', { sessionId: d.sessionId, carInstanceId: car, report: { parts: { [other.instanceId]: { condition: 1 } } } })).status, 400);
  // too much in one report
  assert.equal((await act(cat, 'damageCar', { sessionId: d.sessionId, carInstanceId: car, report: { parts: { [part.instanceId]: { hits: Array.from({ length: 33 }, () => ({ p: [0, 0, 0], d: [0, 0, 1], s: 0.1 })) } } } })).status, 400);
  // the repair: what the server's rules say it costs, from the damage the server keeps
  const { db: game } = await T.app.economyConfig.gameDb();
  const cost = repairCost(game, (await profile(cat)).parts[part.instanceId], 'full'), m0 = (await profile(cat)).money;
  const fix = await act(cat, 'repairPart', { instanceId: part.instanceId });
  assert.equal(fix.status, 200, fix.text);
  assert.equal(fix.body.updatedState.money, m0 - cost);
  assert.equal(fix.body.updatedState.parts[part.instanceId].condition, 100);
  // the drive ended: no more damage in it
  await cat.post(`/api/v1/player/drives/${d.sessionId}/end`);
  assert.equal((await act(cat, 'damageCar', { sessionId: d.sessionId, carInstanceId: car, report: { parts: { [part.instanceId]: { condition: 10 } } } })).status, 409);
  assert.deepEqual(await T.app.economy.ledgerCheck(), []);
});
