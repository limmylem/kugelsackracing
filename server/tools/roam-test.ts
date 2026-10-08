// Free roam end to end (Phase 7 Step 4; docs/FREE_ROAM.md): the API and the zone servers for real, players played by bots
// made of the game's own client code (mp/roamBot.js: the hub, mp/roamClient.js's zones and handoffs, Step 1's connections)
// on the Milton Keynes region, its zones made small (one map tile, 512 m) so there are many of them. Writes
// reports/roam-test.md. Needs PostgreSQL with PostGIS (TEST_DATABASE_URL); one real-time process, no Redis — except the
// swarm (G), which runs zone servers in several processes sharing Redis (REDIS_URL, default redis://localhost:6379).
//
//   node server/tools/roam-test.ts [--only A,B,C,D,E,F] [--handoffs 1000] [--swarm 500] [--swarm-only]
//
//   A  instances: friends and parties always in the same instance (a full one too, and after driving into the next zone);
//      blocked players never; the cap
//   B  privacy and blocks, everywhere: the map (and minimap), the world (cars, names), join friend, the friends list
//   C  challenges: decline and its cooldown, passive mode, a blocked player's declined silently, flashing headlights, the
//      route on the road graph, the rolling start, the results checked and paid; a party's group challenge
//   D  griefing: a bot ramming others (contact on) is auto-ghosted for everyone, its safety rating down
//   E  persistence: leave and come back to the same spot with the same car and damage; chat, emotes, inspect, meets, report
//   F  handoffs at 200 km/h, --handoffs times: no visible snap or jump in any watching game, nothing lost
//   G  the bot swarm (--swarm N): N bots driving the region's roads across its zones; server tick, bandwidth, frame time

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.ROAM_ZONE_TILES ??= '1';
const args = process.argv.slice(2), arg = (k: string, d: any) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const only = (() => { const v = arg('only', null); return v ? new Set(String(v).split(',')) : null; })();
const SHIFT = String(arg('shift', '0,0')).split(',').map(Number), HANDOFFS = Number(arg('handoffs', 1000)), SWARM = Number(arg('swarm', 0)), SWARM_ONLY = args.includes('--swarm-only');

if (args.includes('--worker')) { await swarmWorker(); process.exit(0); }
if (args.includes('--drivers')) { await driverWorker(); process.exit(0); }

const { freshDatabase, testConfig } = await import('../test/helpers.ts');
const { buildApp } = await import('../src/app.ts');
const { REPO_DIR } = await import('../src/config.ts');
const { startRt } = await import('../src/rt/server.ts');
const { ROAM } = await import('../src/rt/mpData.ts');
const { networkOf } = await import('../src/rt/roam.ts');
const { transport } = await import('./rt-bots.ts');
const { createRoamBot } = await import('../../mp/roamBot.js');
const { createSmoothness } = await import('../../net/measure.js');
const { sprintRoute } = await import('../../mp/challenge.js');
const { zoneOf, zoneSize } = await import('../../mp/roam.js');

const PORT = 8794, RT_PORT = 2794, SECRET = 'roam-test-secret-roam-test-secret-0123456789';
const lines: string[] = [], results: boolean[] = [], numbers: Record<string, any> = {};
const check = (name: string, ok: boolean, detail = '') => { results.push(!!ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`; console.log(l); lines.push(l); };
const section = (s: string) => { console.log(`\n== ${s}`); lines.push('', `## ${s}`, ''); };
const note = (s: string) => { console.log(`     ${s}`); lines.push(`       ${s}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => any, ms: number, every = 100) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await f(); if (v) return v; } return null; };
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const SIZE = zoneSize(ROAM);

const database = await freshDatabase('roam');
const app: any = await buildApp({ config: testConfig(database.url, { serveClient: false, logLevel: 'warn' }, { PUBLIC_URL: 'http://localhost:8787', RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });
const rtLog: string[] = [];
const rt = SWARM_ONLY ? null : await startRt({ port: RT_PORT, secret: SECRET, redisUrl: null, rt: { allowGuests: true, maxPlayers: 5000, roomMaxClients: 64, netsim: true }, api: { url: `http://localhost:${PORT}` }, log: (m, e) => { if (/fail/.test(m)) rtLog.push(`${m} ${JSON.stringify(e)}`); if (/challenge|leave/.test(m) && process.env.ROAM_DEBUG) console.log(m, JSON.stringify(e)); } });
const N = networkOf('mk');

// ---------- players: development players (a guest of their own each), their tickets from the API ----------
const ticketOf = (letter: string) => async () => {
  const r = await fetch(`http://localhost:${PORT}/api/v1/rt/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:8787', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ player: letter }) });
  const j: any = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? r.status);
  return { ticket: j.ticket, url: `http://localhost:${endpointPort}` };
};
const uidOf = (letter: string) => `dev-player-${letter.toLowerCase()}`;
const act = async (letter: string, body: object) => {
  await app.mp.devPlayer(letter);
  const r = await app.inject({ method: 'POST', url: '/api/v1/internal/mp/act', headers: { 'x-kr-internal': SECRET, 'content-type': 'application/json' }, payload: JSON.stringify({ uid: uidOf(letter), ...body }) });
  if (r.statusCode >= 300) throw new Error(`${letter} ${JSON.stringify(body)}: ${r.body}`);
  return JSON.parse(r.body);
};
const befriend = async (a: string, b: string) => { await app.mp.devPlayer(a); await app.mp.devPlayer(b); await act(a, { action: 'friend-add', id: uidOf(b) }); await act(b, { action: 'friend-accept', id: uidOf(a) }); };
const settingsOf = async (letter: string, s: object) => { await app.mp.devPlayer(letter); await app.roam.saveSettings(uidOf(letter), s); };

// a line to drive: a road from near (x, z), there and back (closed); or a straight line (for scripts)
function roadLoop(x: number, z: number, seed = 1) {
  let k = seed; const rng = () => (k = (k * 16807) % 2147483647) / 2147483647;
  const at = N.nearest(x, z, undefined, 400);
  const r = sprintRoute(N, [at.x, at.z], { ...ROAM, challenges: { ...ROAM.challenges, routeM: { min: 500, max: 1500 } } }, { rng });
  if (!r.ok) return [[at.x, at.h ?? 0, at.z], [at.x + 200, at.h ?? 0, at.z]];
  const pts = r.line.map((p: any) => [p.x, p.h ?? 0, p.z]);
  return [...pts, ...[...pts].reverse().slice(1, -1)];
}
const parked = (x: number, z: number, headingDeg = 90) => (s: any) => { const h = headingDeg * Math.PI / 180; return { ...s, pos: [x, s.pos?.[1] ?? 0, z], vel: [0, 0, 0], ang: [0, 0, 0], rot: [0, Math.sin(h / 2), 0, Math.cos(h / 2)], wheels: s.wheels.map((w: any) => ({ ...w, omega: 0, slip: 0 })), throttle: 0, flags: s.flags & ~2 }; };
const LOOK = (i: number, extra: object = {}) => ({ carId: 'starter_car', paint: { colour: `hsl(${i * 47 % 360} 70% 50%)` }, parts: {}, bot: true, ...extra });

const bots: any[] = [];
let loop: NodeJS.Timeout | null = null;
function startLoop() {
  if (loop) return;
  let last = performance.now();
  loop = setInterval(() => { const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t; for (const b of bots) { try { b.step(dt, t); b.top = Math.max(b.top ?? 0, b.D.speed); if (b.watch) b.watch(dt); } catch (e) { console.warn(e); } } }, 1000 / 60);
}
let endpointPort = RT_PORT;
async function bot(letter: string, { at = [0, 0], points = null as any, script = null as any, look = null as any, drive = {} as any, settings = {} as any, before = null as any } = {}) {
  await app.mp.devPlayer(letter);
  const b: any = (createRoamBot as any)({ transport, getTicket: ticketOf(letter), region: 'mk', cfg: ROAM, points: points ?? roadLoop(at[0], at[1], letter.charCodeAt(0) * 31 + letter.length), drive, look: look ?? LOOK(letter.charCodeAt(0)), endpoint: `http://localhost:${endpointPort}`, settings });
  b.letter = letter; b.uid = uidOf(letter);
  if (script) b.override(script);
  if (before) await before(b);
  await b.start();
  bots.push(b); startLoop();
  return b;
}
const drop = async (...bs: any[]) => { for (const b of bs) { const i = bots.indexOf(b); if (i >= 0) bots.splice(i, 1); await b.leave().catch(() => {}); } };
const roomsOf = (uid: string) => rt!.roams().filter((r: any) => r.roam.has(uid));
const homeRoom = (b: any) => rt!.roams().find((r: any) => r.roomId === b.RC.connOf(b.RC.home)?.roomId);
const sameInstance = (a: any, b: any) => !!homeRoom(a) && homeRoom(a) === homeRoom(b);

try {
  // ---------- A ----------
  if (!SWARM_ONLY && (!only || only.has('A'))) {
    section('A. Instances: friends and parties together, blocked players apart, the cap');
    const cap = ROAM.zones.capacity;
    ROAM.zones.capacity = 4;
    // a zone with one instance full of strangers
    const X = 300, Z = 300;
    const strangers: any[] = [];
    for (let i = 0; i < 4; i++) strangers.push(await bot(`Fill${i}`, { script: parked(X + i * 6, Z) }));
    const g0 = homeRoom(strangers[0]);
    check('four strangers fill one instance (capacity 4 here)', strangers.every(s => homeRoom(s) === g0), `${g0?.group} has ${g0?.players.size}`);
    // friends: the first goes to a new instance (no room with strangers), the second to the first's
    await befriend('FrA', 'FrB');
    const fa = await bot('FrA', { script: parked(X + 30, Z) });
    check('a newcomer with no friends there: not the full instance', homeRoom(fa) !== g0, `${homeRoom(fa)?.group}`);
    await befriend('FrC', 'Fill0');
    const fc = await bot('FrC', { script: parked(X + 40, Z) });
    check('a friend of someone in the full instance joins it anyway (the slots kept for friends)', homeRoom(fc) === g0, `${homeRoom(fc)?.group} / ${g0?.group}, ${g0?.players.size} players`);
    const fb = await bot('FrB', { script: parked(X + 36, Z) });
    check('friends end up in the same instance', sameInstance(fa, fb), `${homeRoom(fa)?.group} / ${homeRoom(fb)?.group}`);
    // a party of three, joining one after another, into a busy zone
    await app.mp.devPlayer('PaL'); await app.mp.devPlayer('PaM'); await app.mp.devPlayer('PaN');
    const pl = await bot('PaL', { script: parked(X + 50, Z) });
    pl.hubSend({ t: 'party-create' });
    const party: any = await until(() => pl.S.party, 3000);
    // (another busy instance first: four strangers filling a second one, so the party's members have a choice)
    for (let i = 0; i < 3; i++) await bot(`Fill${i + 4}`, { script: parked(X + 70 + i * 6, Z) });
    const members: any[] = [];
    for (const L of ['PaM', 'PaN']) {
      // (in the party first — the hub's invite, accepted, as the menu does it — then into free roam)
      const b = await bot(L, { script: parked(X + 80 + members.length * 6, Z), before: async (x: any) => { await x.hub(); x.hubSend({ t: 'party-join', partyId: party.id }); await until(() => x.S.party?.members?.includes(uidOf(L)), 3000); } });
      members.push(b);
    }
    pl.RC.setParty(party.id); for (const m of members) m.RC.setParty(party.id);
    const together = members.filter(m => sameInstance(m, pl)).length;
    check('a party ends up in one instance', together === members.length, `${[pl, ...members].map(b => homeRoom(b)?.group).join(', ')}`);
    // blocked: never in the same instance (placement keeps them apart)
    await act('BlkA', { action: 'block', id: uidOf('FrA') }).catch(async () => { await app.mp.devPlayer('BlkA'); await act('BlkA', { action: 'block', id: uidOf('FrA') }); });
    const bl = await bot('BlkA', { script: parked(X + 32, Z) });
    check('someone who blocked a player there is placed in another instance', !sameInstance(bl, fa), `${homeRoom(bl)?.group} / ${homeRoom(fa)?.group}`);
    // friends driving together into the next zone stay together
    await befriend('TwA', 'TwB');
    const line = [[X - 200, 0, Z + 100], [X + SIZE * 2, 0, Z + 100]];
    const ta = await bot('TwA', { points: [...line, [X + SIZE * 2, 0, Z + 108], [X - 200, 0, Z + 108]], drive: { topSpeed: 30, accel: 6 } });
    const tb = await bot('TwB', { points: [...line, [X + SIZE * 2, 0, Z + 108], [X - 200, 0, Z + 108]], drive: { topSpeed: 30, accel: 6, startAt: 8 } });
    const crossed = await until(() => ta.RC.handoffs > 0 && tb.RC.handoffs > 0 && homeRoom(ta) && homeRoom(tb), 60000, 250);
    check('two friends driving into the next zone: both handed over, still in the same instance', !!crossed && sameInstance(ta, tb), `${ta.RC.home} ${homeRoom(ta)?.group} / ${tb.RC.home} ${homeRoom(tb)?.group}`);
    ROAM.zones.capacity = cap;
    await drop(...bots.slice());
  }

  // ---------- B ----------
  if (!SWARM_ONLY && (!only || only.has('B'))) {
    section('B. Privacy and blocks: the map, the world, names, join friend, the friends list');
    const X = -300, Z = 200;
    await befriend('Vw', 'Fr'); await befriend('Vw', 'Hid'); await befriend('Vw', 'Shy');
    await settingsOf('Fr', { location: 'friends' }); await settingsOf('Hid', { location: 'everyone', appearOffline: true });
    await settingsOf('Ev', { location: 'everyone' }); await settingsOf('Fo', { location: 'friends' }); await settingsOf('No', { location: 'nobody' });
    await settingsOf('Shy', { location: 'nobody' }); await settingsOf('Bk', { location: 'everyone' });
    const v = await bot('Vw', { script: parked(X, Z) });
    const others: Record<string, any> = {};
    for (const [k, dx] of [['Fr', 8], ['Hid', 16], ['Ev', 24], ['Fo', 32], ['No', 40], ['Shy', 48], ['Bk', 56]] as const) others[k] = await bot(k, { script: parked(X + dx, Z) });
    // everyone in the viewer's instance? (placement put them together: nobody's blocked yet)
    const allHere = Object.values(others).every(o => sameInstance(o, v));
    check('everyone placed in the viewer\'s instance (nobody blocked yet)', allHere);
    const map = await until(async () => { const m = [...v.messages].reverse().find((x: any) => x.t === 'map' && x.players.length >= 1); return m && Date.now() - m.at < 5000 ? m : null; }, 8000);
    const onMap = new Set((map?.players ?? []).map((p: any) => p.uid));
    const want = { Fr: true, Hid: false, Ev: true, Fo: false, No: false, Shy: false, Bk: true };
    check('the map shows: friends (location friends), everyone-players; hides appear-offline, friends-only strangers, nobody', Object.entries(want).every(([k, w]) => onMap.has(uidOf(k)) === w), `on the map: ${[...onMap].map(u => String(u).replace('dev-player-', '')).join(', ')}`);
    const world = await until(() => { const s = v.sample(1 / 30); const ids = new Set(s.filter((x: any) => x.pose).map((x: any) => x.uid)); return ids.size >= 7 ? s : null; }, 8000);
    check('the world: every car nearby drawn (privacy hides the map, not the road)', !!world, `${(world ?? []).length} cars`);
    const nameOf = (k: string) => (world ?? []).find((x: any) => x.uid === uidOf(k))?.name;
    check('names: a stranger who shows their location to nobody is a "Driver"; a friend who does is still named', nameOf('No') === 'Driver' && nameOf('Shy') === 'Player Shy' && nameOf('Ev') === 'Player Ev', `No: ${nameOf('No')}, Shy: ${nameOf('Shy')}, Ev: ${nameOf('Ev')}`);
    // join friend
    const ask = async (k: string) => { v.hubSend({ t: 'roam-join', uid: uidOf(k) }); return v.wait((m: any) => (m.t === 'roam-goto' && m.uid === uidOf(k)) || m.t === 'notice', 3000, { fresh: true }); };
    const jf = await ask('Fr'), jh = await ask('Hid'), js = await ask('Shy'), je = await ask('Ev');
    check('join friend: a friend → their place, zone and instance', jf?.t === 'roam-goto' && jf.group === homeRoom(others.Fr)?.group && Array.isArray(jf.pos), JSON.stringify(jf));
    check('join friend: refused for one appearing offline, one sharing with nobody, and a stranger', jh?.t === 'notice' && js?.t === 'notice' && je?.t === 'notice', [jh?.text, js?.text, je?.text].join(' | '));
    // the friends list: appear offline is offline
    v.hubSend({ t: 'friends' });
    const fl = await until(() => { const f = v.S.friends; return f?.length >= 3 && f.find((x: any) => x.id === uidOf('Fr'))?.online ? f : null; }, 6000);
    check('the friends list: a friend appearing offline shows offline; one in free roam shows where (if they let friends see)', !!fl && fl.find((x: any) => x.id === uidOf('Hid'))?.online === false && !!fl.find((x: any) => x.id === uidOf('Fr'))?.roam, JSON.stringify(fl?.map((f: any) => [f.name, f.online, !!f.roam])));
    // a block: gone from the world, the map and the roster at once, both ways
    v.hubSend({ t: 'block', id: uidOf('Bk') });
    const gone = await until(() => { const s = v.sample(1 / 30); const o = s.find((x: any) => x.uid === uidOf('Bk') && !x.leaving); const theirs = others.Bk.sample(1 / 30).find((x: any) => x.uid === uidOf('Vw') && !x.leaving); return !o && !theirs ? true : null; }, 6000);
    check('a block: each gone from the other\'s world at once (both ways)', !!gone);
    const map2 = await until(() => { const m = [...v.messages].reverse().find((x: any) => x.t === 'map' && x.at > Date.now() - 2500); return m && !m.players.some((p: any) => p.uid === uidOf('Bk')) ? m : null; }, 8000);
    check('… and from the map', !!map2);
    const jb = await (async () => { others.Bk.hubSend({ t: 'roam-join', uid: uidOf('Vw') }); return others.Bk.wait((m: any) => m.t === 'roam-goto' || m.t === 'notice', 3000, { fresh: true }); })();
    check('… and join friend refuses', jb?.t === 'notice', jb?.text);
    // the minimap is the map near you plus the cars drawn: both shown above
    await drop(...bots.slice());
  }

  // ---------- C ----------
  if (!SWARM_ONLY && (!only || only.has('C'))) {
    section('C. Challenges');
    const at = N.nearest(-200, -350, undefined, 400), X = at.x, Z = at.z;
    const a = await bot('ChA', { script: parked(X, Z) }), b = await bot('ChB', { script: parked(X + 10, Z) });
    await sleep(1500);                                   // (their cars on the server first: a challenge needs where they are)
    a.send({ t: 'challenge', to: b.uid, type: 'sprint' });
    const inv = await b.wait((m: any) => m.t === 'challenge-invite', 8000);
    if (!inv) note(`challenger heard: ${JSON.stringify(a.messages.filter((m: any) => m.t === 'notice').slice(-3))}`);
    check('a sprint challenge: the invite with its route on the road graph (shown before answering)', !!inv?.route && inv.route.length >= ROAM.challenges.routeM.min * 0.6 && inv.route.length <= ROAM.challenges.routeM.max * 1.25 && inv.route.line.length > 5, inv ? `${inv.route?.length} m, via ${inv.route?.names?.join(', ')}` : 'no invite');
    b.reply(inv, { t: 'challenge-answer', id: inv?.id, yes: false });
    const dec = await a.wait((m: any) => m.t === 'challenge-declined', 3000);
    check('declined: the challenger is told', dec?.why === 'declined');
    a.send({ t: 'challenge', to: b.uid, type: 'sprint' });
    const cool = await a.wait((m: any) => m.t === 'notice' && /Wait \d+ s/.test(m.text), 3000, { fresh: true });
    check('… and has to wait before asking again (the cooldown)', !!cool, cool?.text);
    // passive mode: can't be challenged, can't challenge
    const p = await bot('ChP', { script: parked(X + 20, Z), settings: { passive: true } });
    a.send({ t: 'challenge', to: p.uid, type: 'sprint' });
    const pas = await a.wait((m: any) => m.t === 'notice' && /passive/.test(m.text), 3000, { fresh: true });
    p.send({ t: 'challenge', to: a.uid, type: 'sprint' });
    const pas2 = await p.wait((m: any) => m.t === 'notice' && /passive/.test(m.text), 3000, { fresh: true });
    check('passive mode: can\'t be challenged, can\'t challenge', !!pas && !!pas2);
    // a blocked player's challenge: declined without a word
    const k = await bot('ChK', { script: parked(X + 30, Z) });
    a.hubSend({ t: 'block', id: k.uid });
    await sleep(800);
    k.send({ t: 'challenge', to: a.uid, type: 'sprint' });
    const sent = await k.wait((m: any) => m.t === 'challenge-sent', 4000, { fresh: true });
    const got = await a.wait((m: any) => m.t === 'challenge-invite' && m.from === k.uid, 1500, { fresh: true });
    check('a blocked player\'s challenge: "sent" for them, nothing for the other', !!sent && !got);
    // flashing headlights: C behind D, flashes twice → D is asked
    const c = await bot('ChC', { script: parked(X - 30, Z, 90) }), d = await bot('ChD', { script: parked(X - 10, Z + 1, 90) });
    let flash = 0;
    c.override((s: any) => { const q = parked(X - 30, Z, 90)(s); flash++; const on = flash % 12 < 4 && flash < 40; return { ...q, flags: on ? 2 : 0 }; });
    const finv = await d.wait((m: any) => m.t === 'challenge-invite' && m.from === c.uid, 8000);
    check('flashing headlights at the car ahead challenges it (a sprint, its route shown)', !!finv?.route, finv ? `${finv.route.length} m` : 'none');
    c.override(parked(X - 30, Z, 90));
    // accept: the rolling start, then the race along the route — C quicker; both scripted along the route's line
    d.reply(finv, { t: 'challenge-answer', id: finv?.id, yes: true });
    const st = await c.wait((m: any) => m.t === 'challenge-start', 4000), std = await d.wait((m: any) => m.t === 'challenge-start', 4000);
    check('accepted: both get the start (the route, the checkpoints, the rolling start)', !!st && !!std && st.racers.length === 2, st ? `${st.checkpoints.length} checkpoints` : '');
    const touch = await c.wait((m: any) => m.t === 'touch' && m.challenge === st?.id, 3000);
    check('both ghosted to everyone else during it', !!touch && !touch.with.includes(a.uid), JSON.stringify(touch));
    if (st?.route) {
      const pts = st.route.line, L: number[] = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const along = (s: number, side: number) => { s = Math.max(0, Math.min(L.at(-1)!, s)); let i = 1; while (i < L.length - 1 && L[i] < s) i++; const u = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1), dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dz) || 1; return { x: pts[i - 1][0] + dx * u - dz / l * side, z: pts[i - 1][1] + dz * u + dx / l * side, yaw: Math.atan2(dx, dz) }; };
      const goes = (b: any) => b.messages.some((m: any) => m.t === 'challenge-event' && m.id === st.id && m.event?.t === 'go');
      // (each from where it is now, along the route: the rolling start is from where they are)
      const sOf = (x: number, z: number) => { let best = 0, bd = Infinity; for (let i = 0; i < pts.length; i++) { const d2 = Math.hypot(pts[i][0] - x, pts[i][1] - z); if (d2 < bd) { bd = d2; best = L[i]; } } return best; };
      // (eased from where it's parked onto the route over 3 s: a car can't jump there — the live checks would drop it)
      const runner = (b: any, side: number, fast: number) => { let s = sOf(b.state.pos[0], b.state.pos[2]), el = 0; const from = [...b.state.pos]; let last = [...b.state.pos]; return (q: any, dt: number) => { const v = goes(b) ? fast : 9; s += v * dt; el += dt; const p = along(s, side), u = Math.min(1, el / 3); const pos = [from[0] + (p.x - from[0]) * u, from[1], from[2] + (p.z - from[2]) * u]; const vel = dt > 0 ? [(pos[0] - last[0]) / dt, 0, (pos[2] - last[2]) / dt] : [0, 0, 0]; last = pos; return { ...q, pos, vel, rot: [0, Math.sin(p.yaw / 2), 0, Math.cos(p.yaw / 2)], flags: 0 }; }; };
      const rc = runner(c, -2, 26), rd = runner(d, 2, 22); let jumps: any[] = [], lastC: any = null;
      c.override((q: any, dt: number) => { const o = rc(q, dt); if (lastC && process.env.ROAM_DEBUG) { const m = Math.hypot(o.pos[0] - lastC[0], o.pos[2] - lastC[2]); if (m > 2) jumps.push([m.toFixed(2), dt.toFixed(3)]); } lastC = o.pos; return o; }); d.override(rd);
      setTimeout(() => { if (process.env.ROAM_DEBUG) console.log('c jumps', JSON.stringify(jumps.slice(0, 10)), 'pts', pts.length, 'L', L.at(-1)); }, 8000);
      const res = await c.wait((m: any) => m.t === 'challenge-results', 240000);
      if (!res) for (const room of rt!.roams()) for (const run of room.runs.values()) note(`run ${run.id} in ${room.zone}: phase ${run.phase}, goAt ${Math.round(run.goAt)}, room now ${Math.round(room.roomNow())}, racers here: ${run.racers.map((u: string) => `${u}:${!!room.playerOf(u)}`).join(' ')}; record ${JSON.stringify(run.record().cars).slice(0, 300)}`);
      if (!res) note(`events: ${JSON.stringify(c.messages.filter((m: any) => m.t === 'challenge-event').map((m: any) => m.event).slice(-12))}; notices ${JSON.stringify([...c.messages, ...d.messages].filter((m: any) => m.t === 'notice').slice(-4))}; zones ${c.RC.zones} / ${d.RC.zones}; strikes ${JSON.stringify(rt!.roams().flatMap((r: any) => [...r.players.values()].map((p: any) => [p.t.uid, p.checks.reasons, p.status])))}`);
      check('the challenge runs to the finish: results, checked by the API, the winner paid', !!res && res.results[0]?.uid === c.uid && res.verdict?.ok === true && res.pay?.money > 0, res ? `${res.results.map((r: any) => `${r.name} ${r.status} ${r.timeMs} ms`).join(', ')}; verdict ${JSON.stringify(res.verdict)}; pay ${JSON.stringify(res.pay)}` : 'no results');
      const resd = await d.wait((m: any) => m.t === 'challenge-results', 5000);
      check('… the second paid less', !!resd && resd.pay?.money > 0 && resd.pay.money < res?.pay?.money, JSON.stringify(resd?.pay));
      const row = await app.deps.db.execute(`select count(*) as n from roam_challenges where id = '${st.id}'`);
      check('… kept with its record', Number((row.rows[0] as any).n) === 1);
    }
    // a party's group challenge
    const gl = await bot('GrL', { script: parked(X + 50, Z + 10) });
    gl.hubSend({ t: 'party-create' });
    const party = await until(() => gl.S.party, 3000);
    const mem: any[] = [];
    for (const L of ['GrM', 'GrN']) { const m = await bot(L, { script: parked(X + 50 + (mem.length + 1) * 6, Z + 10) }); m.hubSend({ t: 'party-join', partyId: party.id }); await until(() => m.S.party?.members?.includes(m.uid), 3000); m.RC.setParty(party.id); mem.push(m); }
    gl.RC.setParty(party.id);
    await sleep(500);
    gl.send({ t: 'challenge', to: 'party', type: 'follow' });
    const invs = await Promise.all(mem.map(m => m.wait((x: any) => x.t === 'challenge-invite' && x.group, 5000)));
    for (const [i, m] of mem.entries()) m.reply(invs[i], { t: 'challenge-answer', id: invs[i]?.id, yes: true });
    const gst = await gl.wait((m: any) => m.t === 'challenge-start', 5000);
    check('a party\'s group challenge (follow-the-leader): everyone asked, all three start', !!gst && gst.racers.length === 3, gst ? gst.racers.map((r: any) => r.name).join(', ') : '');
    await drop(...bots.slice());
  }

  // ---------- D ----------
  if (!SWARM_ONLY && (!only || only.has('D'))) {
    section('D. Griefing: a bot ramming others is auto-ghosted for everyone');
    const X = 600, Z = -600, yaw = Math.PI / 2;
    const rot = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    const vs: any[] = [];
    const lane = (i: number) => Z + i * 12;
    // victims crawling east, each in their own lane; the rammer drives up behind each in turn
    const vx = [X, X, X];
    for (let i = 0; i < 3; i++) vs.push(await bot(`Vic${i}`, { settings: { contact: true }, script: (s: any, dt: number) => { vx[i] += 4 * dt; return { ...s, pos: [vx[i], 0, lane(i)], vel: [4, 0, 0], rot, ang: [0, 0, 0], flags: 0 }; } }));
    let target = 0, rx = X - 60, rz = lane(0), phase = 'approach', at = 0;
    const r = await bot('Ram', { settings: { contact: true }, script: (s: any, dt: number) => {
      const goal = vx[target] - 4.3;
      let vxr = 16, vzr = 0;
      // (over to the next victim's lane, back from it, then up behind it and into it: never faster than a car could)
      if (Math.abs(rz - lane(target)) > 0.05) { const dz = Math.sign(lane(target) - rz) * Math.min(Math.abs(lane(target) - rz), 6 * dt); rz += dz; vzr = dz / dt; rx += 4 * dt; vxr = 4; }
      else if (phase === 'approach') { rx = Math.min(goal, rx + 16 * dt); if (rx >= goal) { phase = 'hit'; at = performance.now(); } }
      else if (phase === 'hit') { rx = goal; vxr = 4; if (performance.now() - at > 400) phase = 'back'; }
      else { rx -= 0 * dt; vxr = 0; if (rx < vx[target] - 30) { target = (target + 1) % 3; phase = 'approach'; } }
      return { ...s, pos: [rx, 0, rz], vel: [vxr, 0, vzr], rot, ang: [0, 0, 0], flags: 0 };
    } });
    await sleep(1500);
    const tp = await r.wait((m: any) => m.t === 'touch' && m.with.length >= 3, 5000);
    check('contact on for all four: each touches the others', !!tp, JSON.stringify(tp?.with));
    // each hit, both games report it (as the contact client would: the time, the closing speed, the normal, the point)
    let reports = 0, ep = 0;
    const room = homeRoom(r);
    const reporter = setInterval(() => {
      if (phase !== 'hit' || !room) return;
      const v = vs[target], tNow = r.RC.homeNet.roomNow(), tv = v.RC.homeNet.roomNow(), x = vx[target] - 2.2, z = lane(target);
      if ((reporter as any).last === `${target}:${at}`) return;
      (reporter as any).last = `${target}:${at}`;
      ep++;
      r.send({ t: 'contact-report', other: v.uid, ep, at: tNow, kind: 'hit', closing: 12, n: [1, 0], point: [x, z], J: [-9000, 0], predictMs: 50, me: { x: x - 2.2, z, yaw }, them: { x: x + 2.2, z, yaw } });
      v.send({ t: 'contact-report', other: r.uid, ep, at: tv, kind: 'hit', closing: 12, n: [-1, 0], point: [x, z], J: [9000, 0], predictMs: 50, me: { x: x + 2.2, z, yaw }, them: { x: x - 2.2, z, yaw } });
      reports++;
    }, 50);
    const ghosted = await r.wait((m: any) => m.t === 'touch' && m.ghostUntil > Date.now(), 60000);
    clearInterval(reporter);
    const contacts = vs.reduce((n, v) => n + v.messages.filter((m: any) => m.t === 'contact').length, 0);
    check('the rammer\'s hits agreed by the referee, blamed on the rammer', contacts >= 3, `${contacts} contacts seen by the victims, ${reports} reported`);
    check('after repeated hits: the rammer is a ghost to everyone (for minutes), and told', !!ghosted && ghosted.with.length === 0 && ghosted.ghostUntil - Date.now() > 60000 && !!(await r.wait((m: any) => m.t === 'notice' && /ghost to everyone/.test(m.text), 3000)), ghosted ? `ghosted for ${Math.round((ghosted.ghostUntil - Date.now()) / 1000)} s` : 'not ghosted');
    const vt = await vs[0].wait((m: any) => m.t === 'touch' && !m.with.includes(r.uid), 3000, { fresh: false });
    check('… the victims no longer touch it', !!vt);
    const sr = await until(async () => { const x = (await app.deps.db.execute(`select safety from mp_ratings where user_id = '${r.uid}'`)).rows[0] as any; return x && x.safety < 60 ? x : null; }, 5000);
    check('… and its safety rating dropped (the API)', !!sr, sr ? `safety ${sr.safety}` : 'unchanged');
    await drop(...bots.slice());
  }

  // ---------- E ----------
  if (!SWARM_ONLY && (!only || only.has('E'))) {
    section('E. Persistence; chat, emotes, inspect, meets, reports');
    const at = N.nearest(250, 450, undefined, 400);
    const dmg = { kind: 'damage', crash: { hits: { shell: 'AQID' }, broken: ['mirror_left'] } };
    const look = LOOK(3, { carId: 'kaze_gt', damage: { shell: 'AQIDBA', broken: [], parts: {} } });
    const p = await bot('Pers', { script: parked(at.x, at.z, 37), look });
    p.RC.sendEvent(dmg);
    await sleep(2500);
    await drop(p);
    const back = await until(async () => { const c = await app.roam.comeBack(uidOf('Pers')); return c && !c.garage ? c : null; }, 5000);
    check('left: where they were saved (the zone server)', !!back && Math.hypot(back.pos[0] - at.x, back.pos[2] - at.z) < 0.5 && Math.abs(back.heading - 37) < 1, back ? `${back.region} ${back.pos.map((v: number) => v.toFixed(1)).join(', ')} heading ${back.heading}` : 'nothing');
    check('… with their car and its damage', back?.car === 'kaze_gt' && back?.damage?.events?.length === 1 && back.damage.look?.shell === 'AQIDBA', JSON.stringify(back?.damage));
    // back in: at that spot, the same car and damage — another player sees it so
    const w = await bot('PersW', { script: parked(at.x + 15, at.z) });
    const p2 = await bot('Pers', { script: parked(back.pos[0], back.pos[2], back.heading), look: { ...look }, });
    p2.RC.setLook(look, back.damage.events);
    const seen = await until(() => w.sample(1 / 30).find((x: any) => x.uid === p2.uid && x.pose && x.look?.carId === 'kaze_gt' && (x.events ?? []).length === 1), 6000);
    check('back in: the same spot, car and damage, as another player sees it', !!seen && Math.hypot(seen.pose.pos[0] - at.x, seen.pose.pos[2] - at.z) < 1, seen ? `${seen.look.carId}, ${seen.events.length} crash` : 'not seen');
    // chat: nearby (and not to someone with it off, or far away), the wheel, party; emotes; inspect
    const far = await bot('Far', { script: parked(at.x + 900, at.z) }), off = await bot('Off', { script: parked(at.x + 20, at.z), settings: { nearbyChat: false } });
    w.send({ t: 'chat', scope: 'nearby', text: 'hello you shitty racers' });
    const heard = await p2.wait((m: any) => m.t === 'chat' && m.uid === w.uid, 3000);
    await sleep(500);
    check('nearby chat: heard nearby, filtered; not by someone with it off, nor far away', !!heard && /\*/.test(heard.text) && !off.messages.some((m: any) => m.t === 'chat') && !far.messages.some((m: any) => m.t === 'chat'), heard?.text);
    w.send({ t: 'wheel', id: 'nice', scope: 'nearby' });
    const wh = await p2.wait((m: any) => m.t === 'chat' && m.wheel === 'nice', 3000);
    w.send({ t: 'emote', id: 'wave' });
    const em = await p2.wait((m: any) => m.t === 'emote' && m.id === 'wave', 3000);
    check('the quick chat wheel and emotes', wh?.text === 'Nice car!' && !!em);
    w.send({ t: 'inspect', uid: p2.uid });
    const ins = await w.wait((m: any) => m.t === 'inspect', 3000);
    check('inspect a nearby car: its model, parts, class and rating, safety', ins?.look?.carId === 'kaze_gt' && 'car' in ins && ins.damaged === 1, JSON.stringify(ins));
    w.send({ t: 'inspect', uid: far.uid });
    const insFar = await w.wait((m: any) => m.t === 'notice' && /closer|isn't here/.test(m.text), 3000, { fresh: true });
    check('… not a car far away', !!insFar);
    // a meet: parking in its spots
    const meet = { id: 'meet_e2etest1', x: at.x + 10, z: at.z + 5, heading: 0, spots: 8 };
    w.send({ t: 'meet-park', meet }); p2.send({ t: 'meet-park', meet });
    const s1 = await w.wait((m: any) => m.t === 'meet-spot', 3000), s2 = await p2.wait((m: any) => m.t === 'meet-spot', 3000);
    check('a meet: each parks in a spot of its own', !!s1 && !!s2 && s1.spot.n !== s2.spot.n, `${s1?.spot.n}, ${s2?.spot.n}`);
    // a report with the last seconds of both cars
    w.send({ t: 'report', uid: p2.uid, details: 'Kept blocking the car park exit.' });
    const rep = await w.wait((m: any) => m.t === 'notice' && /Reported/.test(m.text), 5000);
    const ev = await app.deps.db.execute(`select r.target_id, r.ref, e.kind from reports r left join mp_evidence e on e.id = r.ref->>'evidenceId' where r.reporter_id = '${w.uid}'`);
    check('a report goes with the last few seconds of both cars', !!rep && (ev.rows[0] as any)?.kind === 'roam', JSON.stringify(ev.rows[0]));
    await drop(...bots.slice());
  }

  // ---------- F ----------
  if (!SWARM_ONLY && (!only || only.has('F')) && HANDOFFS > 0) {
    section(`F. Zone handoffs at 200 km/h, ${HANDOFFS} times`);
    // (the zone server in a process of its own, as it would be: the games measuring aren't slowed by the server's work)
    endpointPort = RT_PORT + 1;
    const zoneServer = spawn(process.execPath, [path.join(REPO_DIR, 'server/src/rt/main.ts')], { env: { ...process.env, APP_ENV: 'test', RT_PORT: String(endpointPort), RT_SECRET: SECRET, API_INTERNAL_URL: `http://localhost:${PORT}`, ROAM_ZONE_TILES: process.env.ROAM_ZONE_TILES }, stdio: ['ignore', 'ignore', 'inherit'] });
    await sleep(3000);
    // drivers on long ovals along x (crossing the zone borders every 512 m on the straights), lanes 20 m apart; watchers
    // parked at the borders (in both zones); everyone watches everyone: every drawn frame measured (net/measure.js)
    const D = Math.max(4, Math.min(48, Math.ceil(HANDOFFS / 40))), V = 200 / 3.6, half = 1100;
    const watchers: any[] = [], drivers: any[] = [];
    const meas = new Map<string, any>();      // watcher|uid → smoothness
    let switches = 0, lost = 0, frames = 0, dbg = 0, atHandoff = 0, nearOwn = 0;
    const handedAt = new Map<string, number>();
    const watch = (b: any) => { b.watch = (dt: number) => {
      const t0 = performance.now();
      const here = new Set();
      for (const o of b.sample(dt)) {
        // (a car fading in — just come into view — is measured once it's half there: what a player could see)
        // (beyond seeing.simpleM a car is drawn as a marker, not a car — mp/roam.js lodFor: what's measured is what's drawn as a car)
        if (o.leaving || !o.pose || (o.alpha ?? 1) < 0.5) continue;
        if (Math.hypot(o.pose.pos[0] - b.state.pos[0], o.pose.pos[2] - b.state.pos[2]) > ROAM.seeing.simpleM) continue;
        here.add(`${b.letter}|${o.uid}`);
        const k = `${b.letter}|${o.uid}`;
        let m = meas.get(k); if (!m) meas.set(k, m = { s: createSmoothness({ snapCm: ROAM.targets.jumpCm }), zone: o.zone, look: JSON.stringify(o.look?.paint), ev: (o.events ?? []).length });
        if (o.zone !== m.zone) { switches++; m.zone = o.zone; m.switchAt = performance.now(); }
        // (the same rule as net/measure.js, cheaply here: further than 10 cm, or a tenth of its travel, beyond its own motion)
        let snapNow = false;
        if (m.prev && !o.pose.teleported) { const e = [0, 1, 2].map(i => m.prev.pos[i] + m.prev.vel[i] * dt), j = Math.hypot(o.pose.pos[0] - e[0], o.pose.pos[1] - e[1], o.pose.pos[2] - e[2]), tr = Math.hypot(...m.prev.vel) * dt; snapNow = j > Math.max(ROAM.targets.jumpCm / 100, 0.1 * tr); }
        if (JSON.stringify(o.look?.paint) !== m.look || (o.events ?? []).length < m.ev) lost++;
        if (process.env.ROAM_DEBUG && m.prev) { const e = [0, 1, 2].map(i => m.prev.pos[i] + m.prev.vel[i] * dt), j = Math.hypot(o.pose.pos[0] - e[0], o.pose.pos[2] - e[2]); const trav = Math.hypot(m.prev.vel[0], m.prev.vel[2]) * dt; if (j > Math.max(0.1, 0.1 * trav) && (dbg++ < 30)) console.log('JUMP', 'sinceSwitch', Math.round(performance.now() - (m.switchAt ?? -1e9)), 'sinceHandoff', Math.round(performance.now() - (handedAt.get(o.uid) ?? -1e9)), b.letter, o.uid, j.toFixed(2), 'travel', trav.toFixed(2), 'dist', Math.round(Math.hypot(o.pose.pos[0] - b.state.pos[0], o.pose.pos[2] - b.state.pos[2])), 'zone', o.zone, 'prevZone', m.prevZone, 'blending', !!o.pose.blending, 'extrap', !!o.pose.extrapolating, 'stale', Math.round(o.pose.staleMs ?? 0), 'delay', Math.round(o.pose.delayMs ?? 0), 'prevDelay', Math.round(m.prev.delayMs ?? 0), 'alpha', o.alpha?.toFixed(2)); }
        m.prev = o.pose; m.prevZone = o.zone;
        m.s.frame(o.pose, dt); frames++;
        // (a snap within a second of this car's zone changing — its source here, or its own handoff — is the handoff's)
        // (a car's own handoff changes nothing a game draws unless that game's view of it moves to another zone: the switch;
        // its blend lasts blendMs — a snap within half a second of it is the handoff's)
        if (snapNow) { const t = performance.now(); if (t - (m.switchAt ?? -1e9) < 500) atHandoff++; else if (Math.abs(t - (handedAt.get(o.uid) ?? -1e9)) < 1000) nearOwn++; }
      }
      // (a car not drawn this frame: its measure starts afresh when it's back — a car coming back into view isn't a jump)
      for (const [k, m] of meas) if (k.startsWith(`${b.letter}|`) && !here.has(k)) { m.s.frame(null, dt); m.prev = null; }
      b.frameMs = (b.frameMs ?? []); b.frameMs.push(performance.now() - t0); if (b.frameMs.length > 3000) b.frameMs.shift();
    }; };
    for (let i = 0; i < 4; i++) { const w = await bot(`W${i}`, { script: parked((i - 1.5) * SIZE + 0.5 * SIZE * 0 + (i % 2 ? 512 : 0) - 256 + 0, 0 + (i - 1.5) * 30) }); watchers.push(w); }
    // (watchers parked on borders: x = −512, 0, 512 at the lanes' z)
    for (const [i, w] of watchers.entries()) w.override(parked([-512, 0, 0, 512][i] + (i === 1 ? 6 : 0) + SHIFT[0], -40 + i * 25 + SHIFT[1]));
    // the drivers: two here (they watch too), the rest in worker processes (a game each, more or less — so the games
    // measuring here aren't slowed by driving two dozen cars)
    const ovalOf = (i: number) => { const z = -60 + (i % 12) * 20; return [[-half, 0, z], [half, 0, z], [half + 120, 0, z + 60], [half, 0, z + 120], [-half, 0, z + 120], [-half - 120, 0, z + 60]].map(p => [p[0] + SHIFT[0], p[1], p[2] + SHIFT[1]]); };
    for (let i = 0; i < Math.min(2, D); i++) {
      const d = await bot(`Dr${i}`, { points: ovalOf(i), drive: { topSpeed: V, accel: 9, grip: 1.6, startAt: (i * 397) % 2000 }, look: LOOK(i), settings: { contact: true } });
      d.RC.sendEvent({ kind: 'damage', crash: { hits: { shell: 'AQ' }, broken: [] } });
      d.RC.on('handoff', () => handedAt.set(d.uid, performance.now()));
      drivers.push(d);
    }
    const remote: any = { handoffs: new Map<number, number>(), touches: 0, touchesBad: 0, top: 0 };
    const kids: any[] = [];
    for (let w = 0, from = 2; from < D; w++, from += 12) {
      const k = fork(fileURLToPath(import.meta.url), ['--drivers', '--from', String(from), '--count', String(Math.min(12, D - from)), '--api', String(PORT), '--rt', String(endpointPort), '--shift', SHIFT.join(',')], { env: { ...process.env } });
      k.on('message', (m: any) => { if (m?.handoffs) for (const [i, n] of Object.entries(m.handoffs)) remote.handoffs.set(Number(i), Number(n)); if (m?.handedAt) for (const u of m.handedAt) handedAt.set(u, performance.now()); if (m?.touches != null) { remote.touches = m.touches; remote.touchesBad = m.touchesBad; } if (m?.top) remote.top = Math.max(remote.top ?? 0, m.top); });
      kids.push(k);
    }
    await until(() => remote.handoffs.size >= D - 2 || D <= 2, 60000, 250);
    for (const b of [...watchers, ...drivers.slice(0, 6)]) watch(b);
    // (warming up: everyone in, every car seen once — then the counting starts)
    await sleep(8000);
    for (const m of meas.values()) m.s = createSmoothness({ snapCm: ROAM.targets.jumpCm });
    switches = 0; lost = 0; frames = 0; atHandoff = 0; nearOwn = 0;
    const base = new Map(drivers.map(d => [d, d.RC.handoffs])), baseRemote = new Map<number, number>(remote.handoffs), re0 = [...watchers, ...drivers].reduce((a, b) => a + (b.RC.stats.reappeared ?? 0), 0);
    const t0 = Date.now();
    const total = (): number => drivers.reduce((a: number, d: any) => a + d.RC.handoffs - (base.get(d) ?? 0), 0) + [...remote.handoffs].reduce((a: number, [i, n]: any) => a + n - (baseRemote.get(i) ?? 0), 0);
    let lastNote = 0;
    const F_SECONDS = Number(arg('f-seconds', 1800));
    await until(() => { const n = total(); if (Date.now() - lastNote > 15000) { lastNote = Date.now(); note(`${n} handoffs so far (${Math.round((Date.now() - t0) / 1000)} s)`); } return n >= HANDOFFS; }, F_SECONDS * 1000, 500);
    const all = [...meas.values()].map(m => m.s.result());
    const snaps = all.reduce((a, r) => a + r.snaps, 0), worst = Math.max(...all.map(r => r.worstJumpCm)), worstTurn = Math.max(...all.map(r => r.worstTurnDeg));
    const speeds = [...drivers.map(d => (d.top ?? 0) * 3.6), remote.top * 3.6];
    for (const k of kids) k.send?.('stop');
    await Promise.all(kids.map(k => new Promise(r => { k.on('exit', r); setTimeout(r, 8000); })));
    numbers.handoffs = { atHandoff, nearOwnHandoff: nearOwn, handoffs: total(), seconds: Math.round((Date.now() - t0) / 1000), drivers: D, frames, switches, snaps, worstJumpCm: worst, worstTurnDeg: worstTurn };
    check(`${total()} handoffs at up to ${Math.round(Math.max(...speeds))} km/h (${D} drivers)`, total() >= HANDOFFS, `${Math.round((Date.now() - t0) / 1000)} s`);
    check('no visible snap at a handoff: within half a second of a game\'s view of a car moving to another zone (every switch)', atHandoff === 0, `${atHandoff} of ${snaps} snaps; ${nearOwn} more within a second of a car's own handoff (where no game's view of it changed)`);
    // (away from handoffs: Step 1's interpolation itself, at 200 km/h, with the API, the bots and the measuring in one busy
    // process — reported, and compared with the same drive where no car ever changes zone: --shift 1250,300 with ROAM_ZONE_TILES=16)
    note(`every frame of every car drawn as a car (within 700 m), handoffs or not: ${snaps} snap(s) in ${frames} car-frames (${(snaps / Math.max(1, frames) * 1e5).toFixed(2)} per 100,000)`);
    note(`… ${switches} times a car's source zone switched in a watching game; worst jump ${worst} cm, worst turn ${worstTurn}°${snaps ? `; the snaps: ${JSON.stringify(all.filter(r => r.snaps).slice(0, 3).map(r => r.notes.slice(0, 2)))}` : ''}`);
    check('nothing lost: every car\'s look and damage the same in every zone it was seen through', lost === 0, `${lost} frames with a different look or fewer dents`);
    const reap = [...watchers, ...drivers].reduce((a, b) => a + (b.RC.stats.reappeared ?? 0), 0) - re0;
    check('no car drawn from a zone whose view of it had frozen (put right with a jump)', reap === 0, `${reap}`);
    numbers.handoffs.reappeared = reap;
    // (every zone each driver was in said its contact setting back to it: on)
    const touches = drivers.flatMap(d => d.messages.filter((m: any) => m.t === 'touch'));
    check('settings kept across zones (every zone each driver joined had its contact setting on)', touches.length + remote.touches > 0 && touches.every((m: any) => m.contact === true) && remote.touchesBad === 0, `${touches.length + remote.touches} zone answers`);
    const fm = watchers.flatMap(w => w.frameMs ?? []);
    note(`the game's cost of the others a frame (zones merged and sampled): p50 ${pct(fm, 0.5).toFixed(2)} ms, p95 ${pct(fm, 0.95).toFixed(2)} ms`);
    await drop(...bots.slice());
    zoneServer.kill('SIGTERM');
    endpointPort = RT_PORT;
  }
} catch (e: any) {
  check('the test ran', false, e?.stack ?? String(e));
} finally {
  if (loop) clearInterval(loop);
  for (const b of bots.splice(0)) await b.leave().catch(() => {});
}

// ---------- G: the swarm ----------
if (SWARM > 0) await swarm(SWARM);

async function swarm(n: number) {
  section(`G. The bot swarm: ${n} bots in one region (Milton Keynes) across its zones`);
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379', procs = Math.max(1, Number(arg('processes', 4))), BASE = 2810;
  // the zone servers: several processes sharing Redis (main.ts --processes)
  const rtp = spawn(process.execPath, [path.join(REPO_DIR, 'server/src/rt/main.ts'), '--processes', String(procs)], { env: { ...process.env, APP_ENV: 'test', RT_PORT: String(BASE), REDIS_URL: redisUrl, RT_SECRET: SECRET, API_INTERNAL_URL: `http://localhost:${PORT}`, ROAM_ZONE_TILES: process.env.ROAM_ZONE_TILES }, stdio: ['ignore', 'ignore', 'inherit'] });
  await sleep(4000);
  // the bots: in worker processes (a game each, more or less: 125 a process)
  const workers = Math.max(1, Math.ceil(n / 125)), per = Math.ceil(n / workers), seconds = Number(arg('seconds', 90));
  const reports: any[] = [];
  let started = 0;
  const done = Promise.all(Array.from({ length: workers }, (_, w) => new Promise<void>(res => {
    const c = fork(fileURLToPath(import.meta.url), ['--worker', '--from', String(w * per), '--count', String(Math.min(per, n - w * per)), '--api', String(PORT), '--rt', String(BASE), '--procs', String(procs), '--seconds', String(seconds)], { env: { ...process.env } });
    c.on('message', (m: any) => { if (m?.report) reports.push(m.report); if (m?.started) started++; });
    c.on('exit', () => res());
  })));
  // (the game's side, measured here — a game of its own, not one of the swarm's crowded worker processes: three watchers
  // parked in the middle of the region, each frame's merging and sampling of every car round them timed)
  await until(() => started >= workers, 600000, 500);
  const watchers: any[] = [];
  for (let i = 0; i < 3; i++) { endpointPort = BASE + (i % procs); watchers.push(await bot(`SwW${i}`, { script: parked(-100 + i * 150, -50 + i * 80) })); }
  endpointPort = RT_PORT;
  const frameMain: number[] = [];
  for (const w of watchers) w.watch = (dt: number) => { const t0 = performance.now(); w.sample(dt); frameMain.push(performance.now() - t0); };
  // (the zone servers' numbers while the swarm drives: two-thirds of the way through)
  await sleep(seconds * 650);
  const dash = app.roam.dashboard();
  const seenBy = watchers.map(w => w.sample(0).filter((o: any) => o.pose).length);
  await done;
  await drop(...watchers);
  const all = reports.flatMap(r => r.bots);
  const up = all.map((b: any) => b.upKBs), down = all.map((b: any) => b.downKBs), fm = frameMain, fmWorkers = reports.flatMap(r => r.frameMs);
  const connected = all.filter((b: any) => b.ok).length, handoffs = all.reduce((a: number, b: any) => a + b.handoffs, 0);
  const p50 = dash.processes.map((p: any) => p.tickMsP50), p95 = dash.processes.map((p: any) => p.tickMsP95);
  // (server load: the zone processes' CPU — measured over 5 s at a time — per player; Step 1's target is NET.targets.playersPerProcess on one core)
  const cpuPerPlayerMs = dash.totals.cpu / Math.max(1, dash.totals.connections) * 1000, budgetMs = 1000 / 256;
  numbers.swarm = { watchersSaw: seenBy, frameMsP95Workers: +pct(fmWorkers, 0.95).toFixed(2), bots: n, connected, processes: procs, zones: dash.totals.zones, instances: dash.totals.instances, handoffs, upKBsP95: +pct(up, 0.95).toFixed(2), downKBsP95: +pct(down, 0.95).toFixed(2), downKBsMean: +(down.reduce((a: number, x: number) => a + x, 0) / Math.max(1, down.length)).toFixed(2), tickMsP50: Math.max(0, ...p50), tickMsP95: Math.max(0, ...p95), cpuMsPerConnection: +cpuPerPlayerMs.toFixed(2), frameMsP95: +pct(fm, 0.95).toFixed(2), cpu: dash.totals.cpu, cost: dash.cost };
  check(`${connected} of ${n} bots driving, in ${dash.totals.zones} zones and ${dash.totals.instances} instances on ${procs} processes`, connected >= n * 0.99);
  check(`server load: the zone servers' CPU per connection within a 256th of a core (Step 1's 256 players a process)`, cpuPerPlayerMs <= budgetMs, `${cpuPerPlayerMs.toFixed(2)} ms of CPU a second per connection (budget ${budgetMs.toFixed(2)}); ${dash.totals.cpu} cores for ${dash.totals.connections} connections of ${dash.totals.players} players`);
  check(`each zone instance's tick within ${ROAM.targets.tickMs} ms (p50, by the wall clock)`, Math.max(0, ...p50) <= ROAM.targets.tickMs, `worst p50 ${Math.max(0, ...p50).toFixed(2)} ms, worst p95 ${Math.max(0, ...p95).toFixed(2)} ms — this computer: ${os.cpus().length} cores shared by ${procs} zone processes, the bots' ${workers} and the API, so the wall clock counts the moments a zone process waited for a core`);
  check(`upload per bot within ${ROAM.targets.upKBs} kB/s, download within ${ROAM.targets.downKBs} kB/s (p95)`, pct(up, 0.95) <= ROAM.targets.upKBs && pct(down, 0.95) <= ROAM.targets.downKBs, `up p95 ${pct(up, 0.95).toFixed(2)}, down p95 ${pct(down, 0.95).toFixed(2)} (mean ${numbers.swarm.downKBsMean}) kB/s`);
  check(`the game's cost of the others a frame within ${ROAM.targets.frameMs} ms (p95)`, pct(fm, 0.95) <= ROAM.targets.frameMs, `p50 ${pct(fm, 0.5).toFixed(2)}, p95 ${pct(fm, 0.95).toFixed(2)} ms, drawing ${seenBy.join(', ')} cars (in the swarm's own crowded worker processes, sharing the cores: p95 ${pct(fmWorkers, 0.95).toFixed(2)} ms)`);
  check('handoffs while the swarm drove', handoffs > n / 4, `${handoffs}`);
  note(`zone servers' CPU: ${dash.totals.cpu} cores in all, ${(dash.totals.cpu / Math.max(1, connected) * 1000).toFixed(2)} ms of CPU a second per player`);
  if (dash.cost) note(`cost per 1,000 players at these numbers: 1,000 monthly active ≈ $${dash.cost.monthlyActive.monthly.total}/month (${dash.cost.monthlyActive.instances} instance(s), ${dash.cost.monthlyActive.gbMonth} GB); 1,000 at once all month ≈ $${dash.cost.allAtOnce.monthly.total}/month`);
  rtp.kill('SIGTERM');
  await sleep(1500);
}

// a worker of F's: its drivers on their ovals at 200 km/h, reporting each one's handoffs (and the zones' answers to its
// contact setting) to the parent until told to stop
async function driverWorker() {
  const from = Number(arg('from', 0)), count = Number(arg('count', 6)), apiPort = Number(arg('api', 8794)), port = Number(arg('rt', 2795)), shift = String(arg('shift', '0,0')).split(',').map(Number);
  const { transport } = await import('./rt-bots.ts');
  const { createRoamBot } = await import('../../mp/roamBot.js');
  const { ROAM } = await import('../src/rt/mpData.ts');
  const V = 200 / 3.6, half = 1100;
  const bots: any[] = [], handedAt: string[] = [];
  for (let i = from; i < from + count; i++) {
    const letter = `Dr${i}`, z = -60 + (i % 12) * 20;
    const oval = [[-half, 0, z], [half, 0, z], [half + 120, 0, z + 60], [half, 0, z + 120], [-half, 0, z + 120], [-half - 120, 0, z + 60]].map(p => [p[0] + shift[0], p[1], p[2] + shift[1]]);
    const b: any = (createRoamBot as any)({ transport, region: 'mk', cfg: ROAM, points: oval, drive: { topSpeed: V, accel: 9, grip: 1.6, startAt: (i * 397) % 2000 }, look: { carId: 'starter_car', paint: { colour: `hsl(${i * 47 % 360} 70% 50%)` }, parts: {}, bot: true }, endpoint: `http://localhost:${port}`, settings: { contact: true },
      getTicket: async () => { const r = await fetch(`http://localhost:${apiPort}/api/v1/rt/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:8787', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ player: letter }) }); const j: any = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? r.status); return { ticket: j.ticket, url: `http://localhost:${port}` }; } });
    b.i = i; b.uid = `dev-player-${letter.toLowerCase()}`;
    await b.start();
    b.RC.sendEvent({ kind: 'damage', crash: { hits: { shell: 'AQ' }, broken: [] } });
    b.RC.on('handoff', () => handedAt.push(b.uid));
    bots.push(b);
  }
  let stop = false, last = performance.now();
  process.on('message', (m: any) => { if (m === 'stop') stop = true; });
  let top = 0;
  const loop = setInterval(() => { const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t; for (const b of bots) { b.step(dt, t); top = Math.max(top, b.D.speed); } }, 1000 / 60);
  const report = setInterval(() => {
    const touches = bots.flatMap(b => b.messages.filter((m: any) => m.t === 'touch'));
    process.send?.({ handoffs: Object.fromEntries(bots.map(b => [b.i, b.RC.handoffs])), handedAt: handedAt.splice(0), touches: touches.length, touchesBad: touches.filter((m: any) => m.contact !== true).length, top });
  }, 250);
  while (!stop) await new Promise(r => setTimeout(r, 200));
  clearInterval(loop); clearInterval(report);
  for (const b of bots) await b.leave().catch(() => {});
}

// a worker: its share of the swarm's bots, each driving a road loop somewhere in the region
async function swarmWorker() {
  const from = Number(arg('from', 0)), count = Number(arg('count', 100)), apiPort = Number(arg('api', 8794)), base = Number(arg('rt', 2810)), procs = Number(arg('procs', 1)), seconds = Number(arg('seconds', 60));
  const { transport } = await import('./rt-bots.ts');
  const { createRoamBot } = await import('../../mp/roamBot.js');
  const { ROAM } = await import('../src/rt/mpData.ts');
  const { networkOf } = await import('../src/rt/roam.ts');
  const { sprintRoute } = await import('../../mp/challenge.js');
  const N = networkOf('mk');
  const ticket = (letter: string, k: number) => async () => {
    const r = await fetch(`http://localhost:${apiPort}/api/v1/rt/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:8787', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ player: letter }) });
    const j: any = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? r.status);
    return { ticket: j.ticket, url: `http://localhost:${base + (k % procs)}` };
  };
  const bots: any[] = [];
  let seed = 1000 + from;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < count; i++) {
    const k = from + i, letter = `S${k}`;
    // somewhere in the region's roads (its baked box: x and z from −1,500 to 1,500 m)
    let line: number[][] | null = null;
    for (let tries = 0; tries < 8 && !line; tries++) {
      const at = N.nearest((rng() - 0.5) * 2800, (rng() - 0.5) * 2800, undefined, 300);
      if (!at) continue;
      const r = sprintRoute(N, [at.x, at.z], { ...ROAM, challenges: { ...ROAM.challenges, routeM: { min: 800, max: 2500 } } }, { rng, tries: 10 });
      if (r.ok) { const pts = r.line.map((p: any) => [p.x, p.h ?? 0, p.z]); line = [...pts, ...[...pts].reverse().slice(1, -1)]; }
    }
    line ??= [[0, 0, 0], [300, 0, 0], [300, 0, 10], [0, 0, 10]];
    const b: any = (createRoamBot as any)({ transport, getTicket: ticket(letter, k), region: 'mk', cfg: ROAM, points: line, drive: { topSpeed: 16 + rng() * 14, startAt: rng() * 1000 }, look: { carId: 'starter_car', paint: { colour: `hsl(${k * 47 % 360} 70% 50%)` }, bot: true }, endpoint: null });
    b.observer = i % 25 === 0;
    try { await b.start(); b.ok = true; } catch (e: any) { b.ok = false; b.err = e?.message; }
    bots.push(b);
  }
  const frameMs: number[] = [];
  process.send?.({ started: true });
  let last = performance.now();
  const timer = setInterval(() => {
    const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
    for (const b of bots) { if (!b.ok) continue; b.step(dt, t); if (b.observer) { const t0 = performance.now(); b.sample(dt); frameMs.push(performance.now() - t0); } }
  }, 1000 / 30);
  await new Promise(r => setTimeout(r, seconds * 1000));
  clearInterval(timer);
  const report = { bots: bots.map(b => ({ ok: b.ok, err: b.err ?? null, handoffs: b.RC?.handoffs ?? 0, upKBs: b.RC?.stats.upKBs ?? 0, downKBs: b.RC?.stats.downKBs ?? 0, zones: b.RC?.zones.length ?? 0 })), frameMs };
  process.send?.({ report });
  for (const b of bots) await b.leave().catch(() => {});
}

// ---------- the report ----------
const passed = results.filter(Boolean).length;
console.log(`\n${passed} of ${results.length} checks passed`);
if (rtLog.length) console.log(`real-time server problems:\n${rtLog.slice(0, 20).join('\n')}`);
fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
fs.writeFileSync(path.join(REPO_DIR, 'reports/roam-test.md'), [`# Free roam: the end-to-end test (${new Date().toISOString()})`, '', `${passed} of ${results.length} checks passed. Zones of ${process.env.ROAM_ZONE_TILES} map tile(s).`, ...lines, '', '## Numbers', '', '```json', JSON.stringify(numbers, null, 2), '```', ...(rtLog.length ? ['', '## Real-time server problems', '', ...rtLog.slice(0, 50)] : [])].join('\n') + '\n');
await rt?.stop();
await app.close();
await database.drop();
process.exit(passed === results.length ? 0 : 1);
