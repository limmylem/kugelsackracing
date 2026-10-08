// Free roam on the API (Phase 7 Step 4; docs/FREE_ROAM.md): settings (privacy, contact, passive) kept and carried in the
// join ticket with friends; where a player was saved by the zone servers and where they come back to (or the garage, and
// why); a challenge's record checked, then paid — capped against farming (the same pair, a player's day), an edited
// record paying nothing, paid once; an auto-ghost dropping the safety rating; scheduled meets at a published meet spot;
// the zone servers' numbers on the admin dashboard with the cost estimate; the internal key on every zone-server call.
// The zone servers are played by the test (their internal calls); server/tools/roam-test.ts runs it all through them.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { testApp, signUp, makeStaff } from './helpers.ts';
import { verifyTicket } from '../src/rt/tickets.ts';
import { createChallengeRun } from '../../mp/challenge.js';
import { costPer1000 } from '../src/roam/service.ts';

const ROAM = JSON.parse(fs.readFileSync(new URL('../../data/roam.json', import.meta.url), 'utf8'));
let T: Awaited<ReturnType<typeof testApp>>;
before(async () => { T = await testApp('roam'); });
after(async () => { await T.close(); });
let n = 0;
const player = (name: string) => signUp(T.app, T.outbox, { email: `${name.toLowerCase().replace(/\W/g, '')}${++n}@example.com`, name, ip: `10.81.${n}.1` });
const internal = async (url: string, body?: unknown, secret = T.config.rtSecret) => { const r = await T.app.inject({ method: 'POST', url: `/api/v1/internal/mp${url}`, headers: { 'x-kr-internal': secret, 'content-type': 'application/json' }, payload: JSON.stringify(body ?? {}) }); return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null }; };
const idOf = async (p: any) => (await p.get('/api/v1/me')).body.user.id as string;

test('settings: defaults, saved, validated; carried in the join ticket with friends and an auto-ghost', async () => {
  const a = await player('Rhea Roam'), b = await player('Sid Side');
  assert.deepEqual((await a.get('/api/v1/roam/me')).body.settings, ROAM.privacy.default);
  const s = await a.put('/api/v1/roam/settings', { settings: { location: 'nobody', appearOffline: true, contact: true } });
  assert.equal(s.status, 200, s.text);
  assert.equal(s.body.settings.location, 'nobody'); assert.equal(s.body.settings.contact, true); assert.equal(s.body.settings.passive, false);
  assert.equal((await a.put('/api/v1/roam/settings', { settings: { location: 'the moon' } })).status, 400);
  assert.equal((await a.put('/api/v1/roam/settings', { settings: { evil: true } })).status, 400);
  // friends, then the ticket
  await a.post('/api/v1/friends', { name: 'Sid Side' });
  const aId = await idOf(a);
  await b.post(`/api/v1/friends/${aId}/accept`, {});
  const t = verifyTicket(T.config.rtSecret, (await a.post('/api/v1/rt/ticket', {})).body.ticket)!;
  assert.deepEqual(t.mp!.friends, [await idOf(b)]);
  assert.equal(t.mp!.roam!.settings.location, 'nobody'); assert.equal(t.mp!.roam!.settings.appearOffline, true);
  // (the zone server can change them too, for the player)
  assert.equal((await internal('/roam/settings', { uid: aId, settings: { location: 'friends', appearOffline: false } })).body.settings.location, 'friends');
  assert.equal((await a.get('/api/v1/roam/me')).body.settings.location, 'friends');
});

test('coming back: where you left, with your car and its damage; the garage when the region is gone or the spot is off the road', async () => {
  const p = await player('Pia Park'), uid = await idOf(p);
  assert.equal((await p.get('/api/v1/roam/me')).body.garage, true, 'nothing saved: the garage');
  // (Milton Keynes: a point on its roads, from the road graph)
  const { networkOf } = await import('../src/rt/roam.ts');
  const N = networkOf('mk'), at = N.nearest(120, -340, undefined, 300);
  const damage = { shell: 'AbCd', broken: ['mirror_left'], parts: {} }, events = [{ kind: 'damage', crash: { hits: { shell: 'xyz' } } }];
  assert.equal((await internal('/roam/save', { rows: [{ uid, region: 'mk', pos: [at.x, 31.5, at.z], heading: 92.5, carId: 'kaze_gt', instanceId: 'car_1', damage, events }] })).body.saved, 1);
  const back = (await p.get('/api/v1/roam/me')).body;
  assert.equal(back.garage, false, back.why);
  assert.equal(back.region, 'mk'); assert.deepEqual(back.pos, [Math.round(at.x * 100) / 100, 31.5, Math.round(at.z * 100) / 100]); assert.equal(back.heading, 92.5);
  assert.equal(back.car, 'kaze_gt'); assert.equal(back.instanceId, 'car_1');
  assert.deepEqual(back.damage.look, damage); assert.deepEqual(back.damage.events, events);
  // off any road: the garage (the region's spawn), the car kept
  await internal('/roam/save', { rows: [{ uid, region: 'mk', pos: [90000, 0, 90000], heading: 0, carId: 'kaze_gt' }] });
  const off = (await p.get('/api/v1/roam/me')).body;
  assert.equal(off.garage, true); assert.match(off.why, /road/); assert.equal(off.car, 'kaze_gt');
  // a region that isn't baked
  await internal('/roam/save', { rows: [{ uid, region: 'atlantis', pos: [0, 0, 0], heading: 0, carId: 'kaze_gt' }] });
  assert.match((await p.get('/api/v1/roam/me')).body.why, /isn't in the game/);
  // bad rows ignored
  assert.equal((await internal('/roam/save', { rows: [{ uid, region: 'mk', pos: [NaN, 0, 0] }, { nope: 1 }] })).body.saved, 0);
});

// a challenge's record, as a zone server makes it: two cars along a straight route, b behind
function recordOf(id: string, racers: string[], { lengthM = 1600, va = 30, vb = 25 } = {}) {
  const line = Array.from({ length: Math.round(lengthM / 4) + 1 }, (_, k) => ({ x: k * 4, z: 0, h: 0, w: 8, s: k * 4 }));
  const route = { ok: true, line, length: lengthM, dest: [lengthM, 0] };
  const R = (createChallengeRun as any)({ cfg: ROAM, id, type: 'sprint', racers, route, now: 0 });
  let sa = 0, sb = -3;
  for (let t = 0; t < 400000 && R.phase !== 'done'; t += 100) {
    const go = R.phase === 'racing', v1 = go ? va : 10, v2 = go ? vb : 10;
    sa = Math.min(lengthM, sa + v1 * 0.1); sb = Math.min(lengthM, sb + v2 * 0.1);
    R.state(racers[0], { pos: [sa, 0, 0], vel: [v1, 0, 0], time: t }, t);
    R.state(racers[1], { pos: [Math.max(0, sb), 0, 3], vel: [v2, 0, 0], time: t }, t);
    R.tick(t);
  }
  return { ...R.record(), region: 'mk' };
}

test('challenges: checked, then paid by place; an edited record pays nothing; paid once; the same pair capped a day; a player\'s day capped', async () => {
  const a = await player('Cara Chase'), b = await player('Dev Duel');
  const A = await idOf(a), B = await idOf(b);
  const before = async (p: any) => (await p.get('/api/v1/player')).body?.profile?.money ?? (await p.get('/api/v1/player')).body?.money;
  await a.get('/api/v1/player'); await b.get('/api/v1/player');
  const m0 = await before(a);
  const r1 = await internal('/roam/challenges', recordOf('rc_t1', [A, B]));
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.verdict.ok, true, JSON.stringify(r1.body.verdict));
  assert.ok(r1.body.pay[A].money > r1.body.pay[B].money && r1.body.pay[B].money > 0, JSON.stringify(r1.body.pay));
  assert.equal(await before(a), m0 + r1.body.pay[A].money, 'paid through the ledger');
  // the same again (a retry): the same answer, not paid twice
  const again = await internal('/roam/challenges', recordOf('rc_t1', [A, B]));
  assert.deepEqual(again.body.pay, r1.body.pay);
  assert.equal(await before(a), m0 + r1.body.pay[A].money);
  // an edited record: a checkpoint skipped — checked, failed, nothing paid
  const bad = recordOf('rc_t2', [A, B]); bad.cars[A].passed.splice(1, 1);
  const r2 = await internal('/roam/challenges', bad);
  assert.equal(r2.body.verdict.ok, false); assert.equal(r2.body.pay[A].money, 0);
  // the same pair: paid pairPerDay times in a day, then nothing (trading wins doesn't farm money)
  let paid = 1;
  for (let k = 3; k < 3 + ROAM.challenges.caps.pairPerDay + 1; k++) { const r = await internal('/roam/challenges', recordOf(`rc_t${k}`, k % 2 ? [B, A] : [A, B])); if (r.body.pay[A].money > 0 || r.body.pay[B].money > 0) paid++; else assert.match(r.body.pay[A].why, /same players/); }
  assert.equal(paid, ROAM.challenges.caps.pairPerDay);
  // a player's day: dailyPaid paid challenges against anyone, then nothing
  const others = await Promise.all(Array.from({ length: 3 }, (_, i) => player(`Foe ${i} Fast`)));
  const ids = await Promise.all(others.map(idOf));
  await others[0].get('/api/v1/player');           // (a garage: the economy pays into it)
  await T.app.deps.db.execute(sql`update roam_challenge_players set money = 1 where user_id = ${A}`);
  const have = Number(((await T.app.deps.db.execute(sql`select count(*) as n from roam_challenge_players where user_id = ${A} and money > 0`)).rows[0] as any).n);
  for (let k = have; k < ROAM.challenges.caps.dailyPaid; k++) await T.app.deps.db.execute(sql`insert into roam_challenges (id, type, players, group_key, record) values (${`rc_fill${k}`}, 'sprint', ARRAY[${A}]::text[], ${`fill${k}`}, '{}'::jsonb); insert into roam_challenge_players (challenge_id, user_id, status, money) values (${`rc_fill${k}`}, ${A}, 'finished', 1)`).catch(async () => {
    await T.app.deps.db.execute(sql`insert into roam_challenges (id, type, players, group_key, record) values (${`rc_fill${k}`}, 'sprint', ARRAY[${A}]::text[], ${`fill${k}`}, '{}'::jsonb)`);
    await T.app.deps.db.execute(sql`insert into roam_challenge_players (challenge_id, user_id, status, money) values (${`rc_fill${k}`}, ${A}, 'finished', 1)`);
  });
  const capped = await internal('/roam/challenges', recordOf('rc_new', [A, ids[0]]));
  assert.equal(capped.body.pay[A].money, 0); assert.match(capped.body.pay[A].why, /day's/);
  assert.ok(capped.body.pay[ids[0]].money > 0, `the other player is still paid: ${JSON.stringify(capped.body.pay[ids[0]])}`);
  // a player's list
  const mine = (await b.get('/api/v1/roam/challenges')).body.challenges;
  assert.ok(mine.length >= 3 && mine.some((c: any) => c.money > 0));
});

test('auto-ghosted for ramming: the safety rating drops, the ghost is carried in the next ticket', async () => {
  const p = await player('Ram Rod'), uid = await idOf(p);
  const until = new Date(Date.now() + 300000).toISOString();
  assert.equal((await internal('/roam/incident', { uid, hits: 3, drop: 6, until })).status, 200);
  const r = (await T.app.deps.db.execute(sql`select safety from mp_ratings where user_id = ${uid}`)).rows[0] as any;
  assert.equal(r.safety, 60 - 6);
  await internal('/roam/incident', { uid, hits: 3, drop: 6, until });
  assert.equal(((await T.app.deps.db.execute(sql`select safety from mp_ratings where user_id = ${uid}`)).rows[0] as any).safety, 60 - 12);
  const t = verifyTicket(T.config.rtSecret, (await p.post('/api/v1/rt/ticket', {})).body.ticket)!;
  assert.ok(t.mp!.roam!.ghostUntil > Date.now());
  assert.equal(((await T.app.deps.db.execute(sql`select auto_ghosts from roam_players where user_id = ${uid}`)).rows[0] as any).auto_ghosts, 2);
});

test('meets: scheduled at a published meet spot from the admin page, listed with a countdown; cancelled; admins only', async () => {
  const admin = await player('Meg Meet'), pl = await player('Pat Plain');
  await makeStaff(T.app, admin, (await admin.get('/api/v1/me')).body.user.email, 'admin');
  // a meet spot, published (the editor's: content of kind 'meet')
  const { newItem } = await import('../../content/quests.js');
  const item: any = (newItem as any)('meet', { id: undefined, location: { lat: 52.04, lon: -0.76, heading: 90 }, name: 'The Hub car park' });
  delete item.id;
  const made = await admin.post('/api/v1/content/items', item);
  assert.equal(made.status, 200, made.text);
  const id = made.body.item.id;
  assert.match(id, /^meet_/);
  const pub = await admin.post(`/api/v1/content/items/${id}/publish`, {});
  assert.equal(pub.status, 200, pub.text);
  const startsAt = new Date(Date.now() + 3 * 3600e3).toISOString();
  assert.equal((await pl.post('/api/v1/admin/roam/meets', { meetId: id, title: 'Sunday meet', startsAt })).status, 403);
  assert.equal((await admin.post('/api/v1/admin/roam/meets', { meetId: 'meet_nothere1', title: 'Nope', startsAt })).status, 404);
  const ev = await admin.post('/api/v1/admin/roam/meets', { meetId: id, title: 'Sunday meet', startsAt, hours: 2 });
  assert.equal(ev.status, 200, ev.text);
  const list = (await pl.get('/api/v1/roam/meets')).body.events;
  const e = list.find((x: any) => x.id === ev.body.id);
  assert.equal(e.state, 'announced'); assert.ok(Math.abs(e.startsInSec - 3 * 3600) < 60); assert.equal(e.place.name, 'The Hub car park');
  assert.equal((await admin.del(`/api/v1/admin/roam/meets/${ev.body.id}`)).status, 200);
  assert.ok(!(await pl.get('/api/v1/roam/meets')).body.events.some((x: any) => x.id === ev.body.id));
});

test('the live dashboard: zones, instances, handoffs, bandwidth, load, and the cost per 1,000 players; the internal key', async () => {
  const admin = await player('Dash Board');
  await makeStaff(T.app, admin, (await admin.get('/api/v1/me')).body.user.email, 'admin');
  const at = Date.now();
  const rooms = [{ region: 'mk', zone: '0,0', group: 'g1', players: 40, tickMsP95: 1.2, bytesIn: 1000, bytesOut: 50000, challenges: 1 }, { region: 'mk', zone: '0,0', group: 'g2', players: 12, tickMsP95: 0.6, bytesIn: 200, bytesOut: 9000 }, { region: 'mk', zone: '1,0', group: 'g1', players: 30, tickMsP95: 0.9, bytesIn: 800, bytesOut: 30000 }];
  await internal('/roam/stats', { process: 'p1', at: at - 5000, rooms, counters: { handoffs: 10 }, cpu: 0.1, rssMB: 200 });
  await internal('/roam/stats', { process: 'p1', at, rooms: rooms.map(r => ({ ...r, bytesIn: r.bytesIn + 50 * 1024, bytesOut: r.bytesOut + 1000 * 1024 })), counters: { handoffs: 22 }, cpu: 0.25, rssMB: 210 });
  const d = (await admin.get('/api/v1/admin/roam/dashboard')).body;
  assert.equal(d.totals.connections, 82); assert.equal(d.totals.instances, 3); assert.equal(d.totals.zones, 2);
  assert.equal(d.zones[0].zone, '0,0'); assert.equal(d.zones[0].instances.length, 2);
  assert.equal(d.totals.handoffsPerMin, Math.round(12 / 5 * 60));
  assert.ok(d.totals.downKBs > 500, String(d.totals.downKBs));
  assert.ok(d.cost.monthlyActive.monthly.total > 0 && d.cost.allAtOnce.monthly.total >= d.cost.monthlyActive.monthly.total);
  const c = costPer1000({ players: 500, downKBs: 500 * 15, cpu: 1.5 });
  assert.equal(c!.perPlayer.downKBs, 15); assert.equal(c!.perPlayer.measured, true);
  assert.equal((await internal('/roam/stats', {}, 'wrong-secret-wrong-secret-wrong-secret-0')).status, 403);
  assert.equal((await internal('/roam/save', { rows: [] }, 'x'.repeat(44))).status, 403);
});
