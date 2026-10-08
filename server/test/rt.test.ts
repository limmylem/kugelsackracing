// Multiplayer's real-time server (Phase 7 Step 1; docs/MULTIPLAYER.md), with real sockets and Redis: join tickets
// from the API, joins refused with clear reasons (version, ticket, ban, guests, full), bans and second logins reaching
// players already in a room, the live checks, interest management, reconnecting, and the clock.
// The longer runs — 8 bots on a real route, bad networks, 100 reconnects, bandwidth with 30 cars, several processes —
// are server/tools/rt-test.ts.
//
//   REDIS_URL: a Redis for the tests (default redis://localhost:6379/6; its database is emptied first)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Redis } from 'ioredis';
import { testApp, signUp, makeStaff, Player } from './helpers.ts';
import { startRt } from '../src/rt/server.ts';
import { setRtEnv, TestRoom } from '../src/rt/room.ts';
import { signTicket, verifyTicket } from '../src/rt/tickets.ts';
import { createChecks } from '../src/rt/checks.ts';
import { loadConfig } from '../src/config.ts';
import { NET } from '../../net/settings.js';
import { transport } from '../tools/rt-bots.ts';
import { createNetClient } from '../../net/client.js';
import { PROTOCOL, CODES, MESSAGES } from '../../net/protocol.js';
import { encodeStateMessage, quantise } from '../../net/codec.js';
import { C2S, ALL } from '../../net/protocol.js';

const REDIS = process.env.REDIS_URL ?? 'redis://localhost:6379/6', PORT = 2641, ENDPOINT = `http://localhost:${PORT}`;
const SECRET = 'rt-test-secret-rt-test-secret-0123456789';
const RT = { allowGuests: true, maxPlayers: 1000, roomMaxClients: 64, netsim: true, devPlayers: true };
let rt: Awaited<ReturnType<typeof startRt>>;
const logs: { msg: string; extra?: object }[] = [];
const env = (over: Partial<typeof RT> = {}) => setRtEnv({ secret: SECRET, ...RT, ...over, log: (msg, extra) => logs.push({ msg, extra }) });

before(async () => {
  const r = new Redis(REDIS); await r.flushdb(); r.disconnect();
  rt = await startRt({ port: PORT, redisUrl: REDIS, secret: SECRET, rt: RT, log: (msg, extra) => logs.push({ msg, extra }) });
});
after(async () => { await rt.stop(); setTimeout(() => process.exit(0), 200).unref(); });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000, what = 'it') => { const t = performance.now(); while (!f()) { if (performance.now() - t > ms) throw new Error(`timed out waiting for ${what}`); await sleep(10); } };
const ticket = (uid: string, over: object = {}) => signTicket(SECRET, { uid, name: uid, role: 'player', guest: false, ...over }, 60);
const client = (uid: string, o: { world?: string; ticket?: () => any; protocol?: number; netsim?: any } = {}) => {
  const c = createNetClient({ transport: o.protocol ? { ...transport, join: (e: string, r: string, opts: any) => transport.join(e, r, { ...opts, protocol: o.protocol }) } as any : transport, endpoint: ENDPOINT as any, world: o.world ?? 'rt-test', netsim: o.netsim ?? null, getTicket: async () => o.ticket ? o.ticket() : { ticket: ticket(uid), url: '' } });
  return c;
};
const refused = async (c: ReturnType<typeof createNetClient>) => { try { await c.connect(); await c.leave(); return null; } catch (e: any) { return e; } };
// a car parked (or creeping) somewhere: what a client sends each frame
const at = (x: number, z: number, v = 0) => { let tick = 0; return () => ({ tick: ++tick, pos: [x + (v * tick) / 60, 0.5, z], rot: [0, 0, 0, 1], vel: [v, 0, 0], ang: [0, 0, 0], steer: 0, throttle: 0.2, brake: 0, gear: 2, rpm: 2500, wheels: [], flags: 0 }); };
const drive = async (clients: [ReturnType<typeof createNetClient>, (() => any) | null][], ms: number) => {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { for (const [c, f] of clients) { c.update(1 / 60, f ? (() => f()) : null); c.sample(1 / 60); } await sleep(16); }
};

test('join tickets: the API gives one to a signed-in player (a minute, theirs); none signed out or banned; guests as set', async () => {
  const T = await testApp('rtticket');
  try {
    const anon = new Player(T.app);
    assert.equal((await anon.post('/api/v1/rt/ticket', {})).status, 401);
    const p = await signUp(T.app, T.outbox, { email: 'rider@example.com', name: 'Rita Rider', ip: '10.70.0.1' });
    const r = await p.post('/api/v1/rt/ticket', {});
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.protocol, PROTOCOL);
    const t = verifyTicket(T.config.rtSecret, r.body.ticket)!;
    assert.equal(t.name, 'Rita Rider'); assert.equal(t.guest, false);
    assert.ok(t.exp * 1000 - Date.now() <= T.config.rt.ticketSec * 1000 + 1000);
    assert.equal(verifyTicket('another-secret-another-secret-0123456789', r.body.ticket), null, 'signed with our secret only');
    assert.equal(verifyTicket(T.config.rtSecret, r.body.ticket.replace(/^./, c => c === 'A' ? 'B' : 'A')), null, 'changed: refused');
    const boss = await makeStaff(T.app, await signUp(T.app, T.outbox, { email: 'boss@example.com', name: 'Bea Boss', ip: '10.70.0.2' }), 'boss@example.com', 'admin');
    await boss.post(`/api/v1/admin/players/${t.uid}/suspend`, { days: 2, reason: 'Testing a suspension' });
    assert.equal((await p.post('/api/v1/rt/ticket', {})).status === 403 || (await p.get('/api/v1/me')).status === 401, true, 'a suspended player gets no ticket');
  } finally { await T.close(); }
  const G = await testApp('rtguest', { overrides: { rt: { ...RT, ticketSec: 60, allowGuests: false } } });
  try {
    const g = new Player(G.app, '10.70.1.1');
    const made = await g.post('/api/auth/sign-in/anonymous', {});
    if (made.status === 200) {
      await g.post('/api/v1/me/terms', { termsVersion: G.config.termsVersion, birthDate: '1990-01-01' }).catch(() => null);
      assert.notEqual((await g.post('/api/v1/rt/ticket', {})).status, 200, 'guests refused where they may not play');
    }
  } finally { await G.close(); }
});

test('development: two windows of one browser play as players of their own (?player=A: a guest each); refused anywhere else', async () => {
  const T = await testApp('rtdevplayer');
  try {
    // (signed in or not: the browser's sign-in is shared by its windows, so the window says which player it is)
    const anon = new Player(T.app, '10.70.2.1');
    const a = await anon.post('/api/v1/rt/ticket', { player: 'A' }), b = await anon.post('/api/v1/rt/ticket', { player: 'B' });
    assert.equal(a.status, 200, a.text); assert.equal(b.status, 200, b.text);
    const ta = verifyTicket(T.config.rtSecret, a.body.ticket)!, tb = verifyTicket(T.config.rtSecret, b.body.ticket)!;
    assert.deepEqual([ta.uid, ta.name, ta.guest], ['dev-player-a', 'Player A', true], 'a guest account of its own (its cars and rating kept, for the races)');
    assert.notEqual(ta.uid, tb.uid, 'each window its own player: neither replaces the other');
    assert.equal((await anon.post('/api/v1/rt/ticket', { player: 'A B<script>' })).status, 400, 'a short name of letters and digits only');
  } finally { await T.close(); }
  const P = await testApp('rtdevplayeroff', { overrides: { rt: { ...RT, ticketSec: 60, devPlayers: false } } });
  try { assert.equal((await new Player(P.app, '10.70.2.2').post('/api/v1/rt/ticket', { player: 'A' })).status, 403, 'not where it is switched off'); }
  finally { await P.close(); }
  // (and it can't be switched on online)
  assert.throws(() => loadConfig({ APP_ENV: 'production', PUBLIC_URL: 'https://example.com', DATABASE_URL: 'postgres://x@localhost/x', BETTER_AUTH_SECRET: 'production-like-secret-production-like-0123456789' }, { rt: { ...RT, ticketSec: 60, devPlayers: true } } as any), /devPlayers/);
});

test('a paused game (the settings open, or its window in the background) still says where its car is: the same physics step again is fine, an older one is out of order', () => {
  const C = createChecks(NET.checks), now = 100000;
  const s = (tick: number, time: number) => ({ tick, time, pos: [10, 0.5, 10], vel: [0, 0, 0] });
  assert.equal(C.state(s(50, now - 400), s(50, now - 200), now), null, 'paused: the same step, later');
  assert.equal(C.state(s(50, now - 200), s(49, now - 100), now), 'stale', 'an older step');
  assert.equal(C.state(s(50, now - 200), s(51, now - 300), now), 'stale', 'an earlier time');
});

test('joining is refused cleanly: an old game, no ticket, a used or forged ticket, a ban, guests, a full server', async () => {
  env();
  let e = await refused(client('v', { protocol: PROTOCOL + 1 }));
  assert.equal(e.code, CODES.VERSION); assert.match(e.message, /refresh/);
  e = await refused(client('f', { ticket: () => ({ ticket: signTicket('not-our-secret-not-our-secret-012345', { uid: 'f', name: 'f', role: 'player', guest: false }, 60), url: '' }) }));
  assert.equal(e.code, CODES.TICKET); assert.equal(e.message, MESSAGES[CODES.TICKET]);
  e = await refused(client('x', { ticket: () => ({ ticket: signTicket(SECRET, { uid: 'x', name: 'x', role: 'player', guest: false }, -5), url: '' }) }));
  assert.equal(e.code, CODES.TICKET, 'expired');
  const once = ticket('once'), a = client('once', { ticket: () => ({ ticket: once, url: '' }) });
  await a.connect();
  e = await refused(client('once', { ticket: () => ({ ticket: once, url: '' }) }));
  assert.equal(e.code, CODES.TICKET, 'a ticket works once');
  await a.leave();
  const r = new Redis(REDIS); await r.set('rt:banned:villain', '1', 'EX', 60); r.disconnect();
  e = await refused(client('villain'));
  assert.equal(e.code, CODES.BANNED); assert.match(e.message, /banned/);
  env({ allowGuests: false });
  e = await refused(client('guest1', { ticket: () => ({ ticket: ticket('guest1', { guest: true }), url: '' }) }));
  assert.equal(e.code, CODES.GUESTS);
  env({ maxPlayers: 1 });
  const first = client('first'); await first.connect();
  e = await refused(client('second'));
  assert.equal(e.code, CODES.FULL); assert.match(e.message, /full/);
  await first.leave();
  env();
});

test('a ban reaches a player already in a room (through Redis), and the same account joining again replaces the first (a race\'s room doesn\'t)', async () => {
  env();
  const T = await testApp('rtban', { env: { REDIS_URL: REDIS, RT_SECRET: SECRET } });
  try {
    const p = await signUp(T.app, T.outbox, { email: 'kick@example.com', name: 'Kip Kicked', ip: '10.71.0.1' });
    const boss = await makeStaff(T.app, await signUp(T.app, T.outbox, { email: 'boss2@example.com', name: 'Bob Boss', ip: '10.71.0.2' }), 'boss2@example.com', 'admin');
    const getTicket = async () => { const r = await p.post('/api/v1/rt/ticket', {}); return { ticket: r.body.ticket, url: '' }; };
    const a = createNetClient({ transport, endpoint: ENDPOINT as any, world: 'rt-ban', getTicket });
    await a.connect();
    const notices: any[] = []; a.on('notice', n => notices.push(n));
    // the same account again (another tab): the first is told and closed
    const b = createNetClient({ transport, endpoint: ENDPOINT as any, world: 'rt-ban', getTicket });
    await b.connect();
    await until(() => a.status === 'offline', 5000, 'the first tab to be closed');
    assert.equal(notices[0]?.code, CODES.ELSEWHERE); assert.match(a.message, /another tab/);
    const me = (await p.get('/api/v1/me')).body.user.id;
    const bn: any[] = []; b.on('notice', n => bn.push(n));
    // (but the same account joining a race's room isn't another tab: free roam stays on under its lobby)
    const r = new Redis(REDIS); await r.publish('rt:kick', JSON.stringify({ uid: me, code: CODES.ELSEWHERE, scope: 'race' })); r.disconnect();
    await sleep(300);
    assert.equal(b.status, 'online', 'a race room\'s join doesn\'t close free roam'); assert.equal(bn.length, 0);
    assert.equal((await boss.post(`/api/v1/admin/players/${me}/ban`, { reason: 'Testing a ban reaching the game' })).status, 200);
    await until(() => b.status === 'offline', 5000, 'the banned player to be removed');
    assert.equal(bn[0]?.code, CODES.BANNED); assert.match(b.message, /banned/);
    // and can't come back
    const e = await refused(createNetClient({ transport, endpoint: ENDPOINT as any, world: 'rt-ban', getTicket: async () => ({ ticket: ticket(me), url: '' }) }));
    assert.equal(e.code, CODES.BANNED);
  } finally { await T.close(); }
});

test('the live checks: impossible movement is never passed on, and a client that keeps sending it is removed', async () => {
  env();
  const cheat = client('cheat', { world: 'rt-checks' }), watch = client('watch', { world: 'rt-checks' });
  await cheat.connect(); await watch.connect();
  const fair = at(0, 0, 5);
  await drive([[cheat, fair], [watch, null]], 600);
  // then teleporting about, 100 m at a time
  let k = 0, tick = 1000;
  const teleport = () => ({ ...fair(), tick: ++tick, pos: [(++k % 2) * 100, 0.5, 0] });
  const seen: number[] = [];
  const t0 = performance.now();
  while (cheat.status === 'online' && performance.now() - t0 < 8000) {
    cheat.update(1 / 60, teleport); watch.update(1 / 60, null);
    for (const c of watch.sample(1 / 60)) if (c.pose) seen.push(c.pose.pos[0]);
    await sleep(16);
  }
  assert.equal(cheat.status, 'offline', 'removed'); assert.match(cheat.message, /can't accept/);
  assert.ok(seen.every(x => x < 20), `the other player never saw a teleport (furthest ${Math.max(...seen).toFixed(1)} m)`);
  assert.ok(logs.some(l => l.msg === 'rt kicked by the live checks'), 'logged');
  await watch.leave();
});

test('interest management: near cars every tick, far ones less often, the furthest not at all; only what changed is sent', async () => {
  env();
  const W = 'rt-interest', me = client('me', { world: W }), near = client('near', { world: W }), far = client('far', { world: W }), gone = client('gone', { world: W });
  for (const c of [me, near, far, gone]) await c.connect();
  await drive([[me, at(0, 0, 2)], [near, at(60, 0, 2)], [far, at(1000, 0, 2)], [gone, at(3000, 0, 2)]], 3000);
  const states = (c: any) => me.players.get(c.id)?.remote.stats.states ?? 0;
  const n = states(near), f = states(far), g = states(gone);
  assert.ok(n > 60, `the near car about 30 a second (${n} in 3 s)`);
  assert.ok(f >= 4 && f < n / 4, `the far one much less often (${f})`);
  assert.equal(g, 0, 'the one 3 km away: nothing');
  // bytes: a moving car's states, only what changed — well under a full state each
  const perState = me.stats.downTotal / Math.max(1, n + f);
  assert.ok(perState < 63, `about ${perState.toFixed(0)} bytes a car-state received`);
  for (const c of [me, near, far, gone]) await c.leave();
});

test('a dropped connection comes back to the same room and car; the others see it pause, then carry on; its damage is kept', async () => {
  env();
  const W = 'rt-reconnect', a = client('drop', { world: W }), b = client('stay', { world: W });
  await a.connect(); await b.connect();
  const id = a.id;
  a.sendEvent({ kind: 'damage', hits: { shell: 'abcd' }, at: 1 });
  await drive([[a, at(0, 0, 3)], [b, null]], 800);
  for (let i = 0; i < 3; i++) {
    const seenAway = new Promise<void>(r => { const off = b.on('roster', m => { if (m.status?.status === 'away') { off(); r(); } }); });
    a.conn.breakConnection();
    await until(() => a.status === 'reconnecting', 3000, 'the drop to be noticed');
    await seenAway;
    await until(() => a.status === 'online', 10000, 'the reconnection');
    await drive([[a, at(0, 0, 3)], [b, null]], 600);
    assert.equal(a.id, id, 'the same car');
    const other = b.players.get(id);
    assert.equal(other?.status, 'here'); assert.equal(other?.events?.[0]?.hits?.shell, 'abcd', 'its damage kept');
    assert.ok(b.sample(1 / 60).find(c => c.id === id)?.pose, 'shown again');
  }
  await a.leave(); await b.leave();
});

test('the clock: every client knows the server\'s time within a few ms', async () => {
  env();
  const cs = [client('c1', { world: 'rt-clock' }), client('c2', { world: 'rt-clock' }), client('c3', { world: 'rt-clock', netsim: { latencyMs: 80, jitterMs: 3, loss: 0 } })];
  for (const c of cs) await c.connect();
  await drive(cs.map(c => [c, null] as [any, null]), 4000);
  const room = [...TestRoom.live].find(r => r.world === 'rt-clock')!;
  for (const c of cs) {
    const err = Math.abs(c.roomNow() - room.roomNow());
    assert.ok(err <= 5, `off by ${err.toFixed(2)} ms (ping ${c.stats.ping.toFixed(1)} ms)`);
  }
  for (const c of cs) await c.leave();
});

test('messages it can\'t read count against the sender; a state without its first full one is ignored', async () => {
  env();
  const c = client('junk', { world: 'rt-junk' });
  await c.connect();
  const q = quantise(at(0, 0)());
  c.conn.send(C2S.STATE, encodeStateMessage(q, 1), {});     // (only a position: no full state yet — ignored)
  c.conn.send(C2S.STATE, new Uint8Array([1, 2, 3]), {});
  c.conn.send(C2S.EVENT, new Uint8Array([99]), {});
  c.conn.send(C2S.STATE, encodeStateMessage(q, ALL), {});
  await sleep(300);
  const room = [...TestRoom.live].find(r => r.world === 'rt-junk')!, m = room.metrics().perPlayer[0];
  assert.equal(m.statesIn, 1, 'only the complete state taken');
  assert.ok((m.strikes as any)['unreadable message'] >= 2);
  await c.leave();
});
