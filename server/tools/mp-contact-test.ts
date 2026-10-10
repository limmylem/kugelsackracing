// @ts-nocheck — (bots and the browser-side modules: not this program's types)
// Car-to-car contact end to end (Phase 7 Step 3's tests; docs/CONTACT.md "Tests"): the API and the real-time server in
// this process (one real-time process, no Redis), and PHYSICS bots (mp/physicsBot.js) — each its own simulated car on
// a generated track, its own network client through a simulated network, contact exactly as the game does it. Writes
// reports/mp-contact.md.
//
//   1. scenarios at 0, 80, 150 and 250 ms ping: a rear-end, a side-swipe, rubbing side by side through a corner, door
//      to door at high speed, a T-bone, a spin into another car, a squeeze against the pit wall — each: an agreed
//      contact; both players see the same outcome (each car where it was, in the other's game) and the same damage; no
//      car launched, spun wildly or pushed through the wall
//   2. automatic ghosting: high lag, a reset, the wrong way, the pit lane
//   3. blame: a rear-end, a brake test, a swerve
//   4. faked contacts fail the check: a push the server never heard of, a refused contact not undone, a push applied
//      but not recorded; an honest run with contact passes (driven again from its inputs, exactly)
//   5. an 8-car race with lots of contact: the frame and bandwidth targets
//
//   node server/tools/mp-contact-test.ts [--only 1,2] [--pings 0,80,150,250] [--scenarios rear,side,…] [--trace]

import fs from 'node:fs';
import path from 'node:path';
import { installDetMath } from '../../physics/detmath.js';
installDetMath();
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';
import { verifyTicket } from '../src/rt/tickets.ts';
import { createMpSession } from '../../mp/client.js';
import { createPhysicsBot } from '../../mp/physicsBot.js';
import { trackFor, checkContacts, checkTrail, replayRun, compareTrails } from '../../mp/verify.js';
import pg from 'pg';
import zlib from 'node:zlib';
import { damageView } from '../../play/multiplayer.js';
import { CarDamage } from '../../garage/carDamage.js';
import { harness, crashContext } from '../../tests/harness.mjs';
import { NET } from '../../net/settings.js';
import { transport } from './rt-bots.ts';

const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', null) ? new Set(opt('--only').split(',')) : null;
const PINGS = opt('--pings', '0,80,150,250').split(',').map(Number);
const SCEN = opt('--scenarios', null)?.split(',') ?? null;
const TRACE = args.includes('--trace');
const PORT = 8794, RT_PORT = 2794, SECRET = 'mp-contact-test-secret-mp-contact-test-01234567';
const MP = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/multiplayer.json'), 'utf8'));
const QCFG = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/quests.json'), 'utf8'));
const TRACKS = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/tracks.json'), 'utf8'));
// (a club circuit, Wexcombe Park: the grid 300 m before a tight first corner, the pit lane beside it on the left behind a
// wall 7.5 m from the centre; rails 12 m out)
const CODE = '0C318-A081G-A0X00-06000-0009E-4';
const lines: string[] = [], results: boolean[] = [], json: any = { at: new Date().toISOString() };
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`; console.log(l); lines.push(l); };
const section = (s: string) => { console.log(`\n== ${s}`); lines.push('', `## ${s}`, ''); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => any, ms: number, every = 100) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await f(); if (v) return v; } return null; };

const database = await freshDatabase('mpcontact');
const app: any = await buildApp({ config: testConfig(database.url, { serveClient: false, logLevel: 'warn' }, { PUBLIC_URL: 'http://localhost:8787', RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });
const rtLog: string[] = [];
const rt = await startRt({ port: RT_PORT, secret: SECRET, redisUrl: null, rt: { allowGuests: true, maxPlayers: 5000, roomMaxClients: 64, netsim: true }, api: { url: `http://localhost:${PORT}` }, log: (m, e) => { if (/fail/.test(m)) rtLog.push(`${m} ${JSON.stringify(e)}`); } });
// (a shorter countdown: the scenarios start sooner)
MP.race.countdownSec = 4; MP.race.lightsSec = 3;
const H: any = await harness(), CC: any = await crashContext();
const T = trackFor(CODE, TRACKS);
const spec = H.garage(null, 'starter_car').stats().spec, sockets = H.socketsOf(spec), starter = CC.db.cars.starter_car;
const W = T.data.width ?? 10;

let made = 0;
async function people(n: number, tag: string, { netsim = null } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = ++made, p = await signUp(app, app.deps.mailer.outbox, { email: `${tag}${k}@example.com`, name: `${tag.toUpperCase()}${k}`, ip: `10.${40 + (k >> 8)}.${k & 255}.1` });
    const ticket = async () => { const r = await p.post('/api/v1/rt/ticket', {}); if (r.status !== 200) throw new Error(r.text); return r.body; };
    const uid = verifyTicket(SECRET, (await ticket()).ticket).uid;
    const session = createMpSession({ transport, getTicket: ticket, netsim });
    out.push({ p, uid, session, name: `${tag.toUpperCase()}${k}` });
  }
  return out;
}
const raceOf = roomId => rt.races().find(r => r.roomId === roomId);
const damageOf = () => { const g = CC.garage('starter_car'); return new CarDamage({ car: starter, build: g.build, view: g.view, boxes: CC.boxesOf(starter), rules: CC.db.damage }); };
// a network of so much ping (round trip): half of it each way
const netOf = ping => ping > 0 ? { latencyMs: ping / 2, jitterMs: Math.round(ping / 20), loss: 0 } : null;

// A race of bots on the track: a private lobby, collisions as asked, everyone ready, started; the scripts drive from GO
async function race(tag, scripts, { ping = 0, pings = null, mode = 'full', seconds = 10, behaves = [], handIn = false, until: stopWhen = null, setup = null, measure = false, progress = false } = {}) {
  const P = [];
  for (let i = 0; i < scripts.length; i++) P.push(...await people(1, tag, { netsim: netOf(pings?.[i] ?? ping) }));
  const bots = P.map((x, i) => createPhysicsBot({ name: x.name, RAPIER: H.RAPIER, settings: H.settings, spec, sockets, T, session: x.session, quests: QCFG, cfg: MP, damage: damageOf(), script: (b, t) => scripts[i](b, t, ctx), handIn, behave: behaves[i] ?? {} }));
  const ctx: any = { bots, P, data: {} };
  setup?.(ctx);
  await P[0].session.createLobby({ kind: 'private', settings: { venue: { kind: 'track', code: CODE }, laps: 1, collisions: mode } });
  const roomId = await until(() => P[0].session.lobby?.roomId, 10000);
  for (const x of P.slice(1)) await x.session.joinLobby(roomId);
  await until(() => P.every(x => x.session.lobby?.players?.length === P.length), 10000);
  for (const x of P) x.session.send({ t: 'ready', v: true });
  await sleep(300);
  P[0].session.send({ t: 'start' });
  const R = raceOf(roomId);
  ctx.R = R;
  const going = await until(() => bots.every(b => b.released), 30000);
  if (!going) console.log(`  (${tag}: not started: ${R?.race.phase} ${bots.map(b => b.log.slice(-2).join(' | ')).join(' ‖ ')})`);
  // (each car's own path, by room time: what the other's game should show)
  const paths = bots.map(() => []), views = bots.map(() => []);
  const t0 = Date.now();
  // (each player's bytes up and down, from here: the bandwidth)
  const bw = () => P.map(x => ({ up: x.session.race?.net?.stats.upTotal ?? 0, down: x.session.race?.net?.stats.downTotal ?? 0 }));
  const measured: any = measure ? { start: bw() } : null;
  let said = 0;
  while (Date.now() - t0 < seconds * 1000 && !(stopWhen?.(ctx))) {
    await sleep(50);
    if (progress && Date.now() - said > 10000) { said = Date.now(); console.log(`    (${((Date.now() - t0) / 1000).toFixed(0)} s: ${bots.map(b => { const st = b.state(); return `${b.name} at ${st.s.toFixed(0)} m (${st.d.toFixed(1)}), ${st.speed.toFixed(0)} m/s, ${b.quest?.state ?? '?'}${b.quest?.lap != null ? ` lap ${b.quest.lap}` : ''}${b.handed ? ', handed in' : ''}`; }).join(' · ')}; ${R?.race.phase})`); }
    bots.forEach((b, i) => {
      const net = P[i].session.race?.net; if (!net) return;
      const s = b.state(); paths[i].push({ t: b.roomT() ?? net.stampAt(), pos: s.pos, s: s.s, d: s.d });
      if (TRACE && paths[i].length % 40 === 0 && paths[i].length > 20) {
        // (the server's record of this car, against the car's own path: same time, how far apart)
        const back = paths[i][paths[i].length - 15], sv = R.referee?.stateAt(P[i].uid, back.t);
        if (sv) console.log(`      ${b.name} server record ${Math.hypot(sv.pos[0] - back.pos[0], sv.pos[2] - back.pos[2]).toFixed(2)} m off at ${back.t.toFixed(0)} (its own ${back.pos[0].toFixed(2)}, the server's ${sv.pos[0].toFixed(2)})`);
      }
      if (TRACE && paths[i].length % 40 === 0) console.log(`      ${b.name} clock: stamp ${(net.stampAt() - R.roomNow()).toFixed(0)} ms, room ${(net.roomNow() - R.roomNow()).toFixed(0)} ms, sim ${((b.sim.time) * 1000 - net.stampAt()).toFixed(0)} ms vs stamp`);
      if (TRACE && paths[i].length % 10 === 0) console.log(`      ${b.name} t ${((Date.now() - t0) / 1000).toFixed(1)} s ${s.s.toFixed(1)} d ${s.d.toFixed(2)} v ${s.speed.toFixed(1)} yaw ${(s.yaw * 57.3).toFixed(0)} pos ${s.pos[0].toFixed(1)},${s.pos[2].toFixed(1)} proxies ${[...(b.contact?.debug.proxies ?? [])].map(([u, x]) => `${x.x.toFixed(1)},${x.z.toFixed(1)} yaw ${(x.yaw * 57.3).toFixed(0)} ${x.solid ? 'solid' : 'ghost'} near ${b.contact.nearness(u).toFixed(2)}`).join(' ')} ghosts ${JSON.stringify(b.metrics.ghosts.at(-1)?.list ?? {})}`);
      // what this game draws of each other car, and when that is
      for (const o of net.sample(0)) if (o.pose) views[i].push({ uid: o.uid, at: o.pose.drawnAt ?? o.pose.shownAt, pos: o.pose.pos, ahead: o.pose.aheadMs, near: o.pose.near, nudge: o.pose.nudge });
    });
  }
  if (measured) { measured.end = bw(); measured.secs = (Date.now() - t0) / 1000; }
  return { ...ctx, R, roomId, paths, views, measured, async close() { for (const b of bots) b.dispose(); await Promise.all(P.map(x => x.session.close().catch(() => {}))); } };
}

// how far each game's drawing of the other car was from where that car really was then (m: the worst, over a window)
function viewError(r, from, to, where = null) {
  let worst = 0;
  r.bots.forEach((b, i) => {
    for (const v of r.views[i]) {
      if (v.at < from || v.at > to) continue;
      const j = r.P.findIndex(x => x.uid === v.uid); if (j < 0) continue;
      const path = r.paths[j], k = path.findIndex(p => p.t >= v.at); if (k <= 0) continue;
      const a = path[k - 1], c = path[k], u = (v.at - a.t) / Math.max(1, c.t - a.t), x = a.pos[0] + (c.pos[0] - a.pos[0]) * u, z = a.pos[2] + (c.pos[2] - a.pos[2]) * u;
      const e = Math.hypot(v.pos[0] - x, v.pos[2] - z);
      if (e > worst && where) Object.assign(where, { at: v.at, viewer: b.name, of: r.P[j].name, ahead: v.ahead, near: v.near, gap: c.t - a.t });
      worst = Math.max(worst, e);
    }
  });
  return worst;
}
// each car's damage as its owner has it, and as the other player's game draws it (Step 1's damage events): the same
// events, in the same order, and the same dents and parts off once folded together
function damageAgrees(r) {
  const out = [];
  r.bots.forEach((b, i) => r.bots.forEach((o, j) => {
    if (i === j) return;
    const net = r.P[j].session.race?.net, seen = net ? [...net.players.values()].find(x => x.uid === r.P[i].uid) : null;
    const got = (seen?.events ?? []).filter(e => e.kind === 'damage'), sent = b.metrics.sent;
    const crashes = l => JSON.stringify(l.map(e => e.crash)), same = got.length >= sent.length && crashes(got.slice(got.length - sent.length)) === crashes(sent);
    const theirs = damageView(null, got, CC.db.damage), own = b.damage?.view3d;
    const count = v => Object.values(v?.parts ?? {}).reduce((n, d) => n + (d?.length ?? 0), 0);
    const loose = b.damage ? Object.entries(b.damage.attach ?? {}).filter(([, a]) => a?.state && a.state !== 'attached').map(([k, a]) => `${k} ${a.state}`).sort().join(', ') : '';
    const sentLoose = [...new Map(sent.flatMap(e => e.crash.attach ?? []).map(([k, x]) => [k, x])).entries()].filter(([, x]) => x !== 'a').map(([k, x]) => `${k} ${x === 'l' ? 'loose' : 'detached'}`).sort().join(', ');
    out.push({ car: r.P[i].name, in: r.P[j].name, events: sent.length, got: got.length, same, dents: [count(own), count(theirs)], loose, sentLoose, ok: same && count(own) === count(theirs) && loose === sentLoose });
  }));
  return out;
}
// where the walls are, along the course: the pit wall on the left of the main straight, the rails further out
const wallAt = (s, d) => d > 0 ? (s >= 61 && s <= 389 ? 7.5 : s > 437 && s < 600 ? 12 : 12) : 12;
const throughWall = (r) => r.paths.flatMap((path, i) => path.filter(p => p.d != null && Math.abs(p.d) > wallAt(p.s, p.d) - 0.5).map(p => ({ i, s: p.s, d: p.d })));

// (the moment the race server first ghosted a car for a reason, as one player's game heard it; when it lifted)
const ghosted = (b, uid, re, after = 0) => b.metrics.ghosts.find(g => g.t >= after && g.list?.[uid]?.ghost && g.list[uid].reasons.some(x => re.test(x)));
const lifted = (b, uid, after) => b.metrics.ghosts.find(g => g.t > after && g.list?.[uid] && !g.list[uid].ghost);
const everGhost = (b, uid) => b.metrics.ghosts.some(g => g.list?.[uid]?.ghost);
// stopping, and staying stopped (the brake held at a standstill would engage reverse: the handbrake instead)
const stop = (b) => b.state().speed > 0.6 ? { steer: 0, throttle: 0, brake: 1, device: 'wheel' } : { steer: 0, throttle: 0, brake: 0, handbrake: true, device: 'wheel' };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// (which car is which: the one ahead on the grid, the one on the left)
const leader = (ctx) => { const [a, b] = ctx.bots; return (a.state().s >= b.state().s) ? 0 : 1; };
const lefter = (ctx) => { const [a, b] = ctx.bots; return (a.state().d >= b.state().d) ? 0 : 1; };
// side by side: each car at a lane, paced to the other's distance along the course (this one `ahead` metres in front),
// at a speed the track allows there
// (both at a common speed a little above the slower one's — so they speed up together — each corrected by the gap)
const pace = (b, ctx, i, lane, v, ahead = 0) => {
  const m = b.state(), o = ctx.bots[1 - i].state(), err = o.s + ahead - m.s, common = Math.min(v, Math.min(m.speed, o.speed) + 3);
  return b.drive(lane, Math.min(b.safe(m.s), clamp(common + 0.8 * err, 0, v + 6)));
};
const yawFrom = (y, y0) => { let e = y - y0; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; return e; };

try {
  // ---------- 1. scenarios ----------
  if (!only || only.has('1')) {
    section('1. Contact scenarios at 0, 80, 150 and 250 ms ping');
    const SC = {
      rear: {
        name: 'a rear-end (26 m/s into 15 m/s, the same lane)', expect: ['hit'],
        // (the one ahead on the grid goes at 15 m/s; the other lets it go, falls in behind, then closes at 26)
        scripts: [0, 1].map(i => (b, t, ctx) => { ctx.data.lead ??= leader(ctx); return ctx.data.lead === i ? b.drive(0, 15) : t < 1.2 ? stop(b) : b.drive(0, t < 3.5 ? 15 : 26); }),
      },
      side: {
        name: 'a side-swipe (side by side at 20 m/s, one moves across into the other)', expect: ['hit', 'rub'],
        scripts: [0, 1].map(i => (b, t, ctx) => { ctx.data.left ??= lefter(ctx); const L = ctx.data.left === i; return pace(b, ctx, i, L ? (t > 6 && t < 8 ? -1.2 : 2.2) : -2.2, 20, L ? -1.2 : 1.2); }),
      },
      corner: {
        name: 'rubbing side by side through a corner (leaning on each other, Church Corner)', expect: ['rub'], seconds: 40, rub: true,
        scripts: [0, 1].map(i => (b, t, ctx) => { ctx.data.left ??= lefter(ctx); const s = b.state().s, lean = s > 470 && s < 620, L = ctx.data.left === i; return pace(b, ctx, i, (L ? 1 : -1) * (lean ? 0.8 : 2.2), 22); }),
      },
      door: {
        name: 'door to door at high speed (leaning in at full speed down the straight)', expect: ['rub', 'hit'], rub: true, seconds: 18,
        scripts: [0, 1].map(i => (b, t, ctx) => {
          ctx.data.left ??= lefter(ctx); const L = ctx.data.left === i, m = b.state();
          const [x, y] = ctx.bots.map(o => o.state());
          if (ctx.data.leanAt == null && x.speed > 24 && y.speed > 24 && Math.abs(x.s - y.s) < 1.5) ctx.data.leanAt = t;
          const lean = ctx.data.leanAt != null && t - ctx.data.leanAt < 2.5;
          return pace(b, ctx, i, (L ? 1 : -1) * (lean ? 0.85 : 2.2), 31);
        }),
        speedNote: ctx => `${Math.min(...ctx.bots.map(b => b.metrics.peak ?? 0)).toFixed(0)} m/s`,
      },
      tbone: {
        name: 'a T-bone (one car turns across the track and stops, the other drives into its side at 14 m/s)', expect: ['hit'],
        scripts: [0, 1].map(i => (b, t, ctx) => {
          ctx.data.lead ??= leader(ctx);
          if (ctx.data.lead === i) {
            const y = b.state().yaw; ctx.data.yaw0 ??= y;
            if (t < 3) return b.drive(-3, 6);
            if (ctx.data.across || Math.abs(yawFrom(y, ctx.data.yaw0)) > 1.35) { ctx.data.across = true; return stop(b); }
            return { steer: 1, throttle: b.state().speed < 5 ? 0.15 : 0, brake: 0, device: 'wheel' };
          }
          if (t < 2.5 || b.metrics.agreed.length) return stop(b);
          return b.drive(clamp(ctx.bots[1 - i].state().d, -4, 4), 14, { look: 6 });
        }),
      },
      spin: {
        name: 'a spin into another car (handbrake turn alongside it, sliding into its path)', expect: ['hit', 'rub'], spinner: true,
        scripts: [0, 1].map(i => (b, t, ctx) => {
          ctx.data.left ??= lefter(ctx); const L = ctx.data.left === i;
          if (!L) return t < 6 ? pace(b, ctx, i, -1.5, 20, -4) : b.drive(-1.5, Math.min(20, b.safe(b.state().s)));
          if (t < 6) return pace(b, ctx, i, 2, 20, 4);
          if (t < 6.5) return { steer: -1, throttle: 0, brake: 0, handbrake: true, device: 'wheel' };
          return t < 10 ? { steer: 0, throttle: 0, brake: 1, handbrake: true, device: 'wheel' } : stop(b);
        }),
      },
      wall: {
        name: 'a squeeze against the pit wall (leaned on towards it at 16 m/s, a car\'s width from the wall)', expect: ['rub', 'hit'], rub: true, seconds: 14,
        // (one car runs by the pit wall, its side 0.6 m from it; the other comes alongside and leans on it for 3 s)
        scripts: [0, 1].map(i => (b, t, ctx) => { ctx.data.left ??= lefter(ctx); const L = ctx.data.left === i; return L ? b.drive(6.0, Math.min(16, b.safe(b.state().s))) : pace(b, ctx, i, t > 6 && t < 9 ? 4.5 : 2.5, 16); }),
      },
    };
    // (each scenario ends with both cars braking to a stop, a while after its contact: the outcome compared at rest)
    const STOP_AT = { rear: 8, side: 9.5, corner: null, door: 13, tbone: 9, spin: 11, wall: 10.5 };
    const atRest = ctx => ctx.bots.every(b => b.state().speed < 0.3) ? (ctx.data.restSince ??= Date.now(), Date.now() - ctx.data.restSince > 1500) : (ctx.data.restSince = null, false);
    for (const ping of PINGS) for (const [key, sc] of Object.entries(SC)) {
      if (SCEN && !SCEN.includes(key)) continue;
      const stopAt = STOP_AT[key], stopping = (b, t, ctx) => stopAt != null ? t > stopAt : b.state().s > 690;
      const scripts = sc.scripts.map(f => (b, t, ctx) => (ctx.data.stopping ||= ctx.bots.every(x => stopping(x, t, ctx))) ? stop(b) : f(b, t, ctx));
      const r = await race(`${key}${ping}`, scripts, { ping, seconds: (sc.seconds ?? 12) + 10, until: ctx => ctx.data.stopping && atRest(ctx) });
      const agreed = r.bots[0].metrics.agreed, kinds = agreed.map(m => m.result.kind);
      const t1 = agreed.length ? agreed[0].result.t : null;
      // (where each game draws the other car, against where it really was: at the end, once it's all settled — the
      // outcome both players see — and at worst through the contact itself)
      const tEnd = Math.min(...r.paths.map(p => p.at(-1)?.t ?? 0));
      const where: any = {}, err = t1 != null ? viewError(r, tEnd - 1200, tEnd - 100, where) : null;
      const during: any = {}, errDuring = t1 != null ? viewError(r, t1, tEnd, during) : null;
      // (in the seconds round the contact: lifted off the road, the spin, the roll — a spinner's own spin aside)
      const inWin = (b, k) => Math.max(0, ...b.metrics.lifts.filter(x => t1 != null && x[0] >= t1 - 200 && x[0] <= t1 + 2500).map(x => x[k]));
      const spinner = sc.spinner ? r.data.left : null;
      const worst = r.bots.map((b, i) => ({ lift: inWin(b, 1), yaw: i === spinner ? 0 : inWin(b, 2), roll: b.metrics.maxRoll }));
      const walls = throughWall(r), dmg = damageAgrees(r);
      // (rubbing: one steady lean, not a string of bounces — the contacts each game began)
      const starts = r.bots.map(b => b.contact?.debug.started ?? 0);
      const fx = r.bots.map(b => b.metrics.effects.length);
      check(`${ping} ms · ${sc.name}: an agreed contact`, agreed.length > 0 && kinds.some(k => sc.expect.includes(k)), `${agreed.length} agreed (${kinds.join(', ')}); closing ${agreed[0]?.result.closing?.toFixed(1)} m/s, J ${agreed[0]?.result.J?.toFixed(0)} N s, ${agreed[0]?.result.sources}${sc.speedNote ? `; at ${sc.speedNote(r)}` : ''}`);
      if (TRACE && during.of) {
        // (the worst moment through the contact: what was drawn, the nudge, where the car really was)
        const vi = r.bots.findIndex(b => b.name === during.viewer), oj = r.bots.findIndex(b => b.name === during.of);
        for (const v of r.views[vi].filter(v => v.uid === r.P[oj].uid && v.at >= during.at - 600 && v.at <= during.at + 600)) {
          const path = r.paths[oj], k = path.findIndex(p => p.t >= v.at); if (k <= 0) continue;
          const a = path[k - 1], c = path[k], u = (v.at - a.t) / Math.max(1, c.t - a.t), x = a.pos[0] + (c.pos[0] - a.pos[0]) * u, z = a.pos[2] + (c.pos[2] - a.pos[2]) * u;
          console.log(`      ${(v.at - t1).toFixed(0)} ms: drawn ${v.pos[0].toFixed(2)},${v.pos[2].toFixed(2)} nudge ${v.nudge?.map(q => q.toFixed(2)).join(',') ?? '-'} ahead ${v.ahead?.toFixed(0)} · really ${x.toFixed(2)},${z.toFixed(2)} · off ${Math.hypot(v.pos[0] - x, v.pos[2] - z).toFixed(2)}`);
        }
      }
      const off = (e, w) => `${e?.toFixed(2)} m${w.of ? ` (${w.of} in ${w.viewer}'s game, ${((w.at - t1) / 1000).toFixed(2)} s after the contact, drawn ${w.ahead?.toFixed(0)} ms ahead${w.gap > 60 ? `; its path then ${w.gap.toFixed(0)} ms between frames: a pause` : ''})` : ''}`;
      check(`${ping} ms · ${sc.name}: the same outcome on both screens (each car where it came to rest, within 0.5 m)`, err != null && err < 0.5, `worst ${off(err, where)}`);
      // (through the knock itself each game is blind to the other's reaction for a round trip — 6 mm a ms of ping —
      // and a car braking hard into a hairpin is predicted a little wide at any ping: 1.5 m)
      const tolDuring = 1.5 + 0.006 * ping;
      check(`${ping} ms · ${sc.name}: never far off through the contact (within ${tolDuring.toFixed(1)} m)`, errDuring != null && errDuring < tolDuring, `worst ${off(errDuring, during)}`);
      check(`${ping} ms · ${sc.name}: nothing launched, spun or rolled`, worst.every(w => w.lift < 0.3 && w.roll < 0.4 && w.yaw < 2), worst.map(w => `lifted ${w.lift.toFixed(2)} m, yaw ${w.yaw.toFixed(2)} rad/s, roll ${(w.roll * 57.3).toFixed(0)}°`).join(' · '));
      check(`${ping} ms · ${sc.name}: nobody through a wall`, walls.length === 0, walls.length ? `car ${walls[0].i + 1} at ${walls[0].s.toFixed(0)} m, ${walls[0].d.toFixed(2)} m off the centre` : `furthest out ${Math.max(...r.paths.flat().map(p => Math.abs(p.d ?? 0))).toFixed(2)} m`);
      check(`${ping} ms · ${sc.name}: the same damage on both screens`, dmg.every(x => x.ok), dmg.map(x => `${x.car} in ${x.in}'s game: ${x.got}/${x.events} events${x.same ? '' : ' (different)'}, dents ${x.dents.join('/')}${x.loose ? `, ${x.loose}` : ''}${x.loose !== x.sentLoose ? ` (sent: ${x.sentLoose})` : ''}`).join(' · '));
      check(`${ping} ms · ${sc.name}: sparks and sounds on both`, fx.every(n => n >= 1 && n <= 2 * Math.max(1, agreed.length) + 2), `effects ${fx.join(', ')} for ${agreed.length} contacts`);
      if (sc.rub) check(`${ping} ms · ${sc.name}: a steady lean, not bouncing`, starts.every(n => n <= 4), `contacts begun ${starts.join(', ')}`);
      console.log(`    (reports sent: ${r.bots.map(b => b.contact?.debug.reports ?? '?').join(', ')}; rejected ${r.bots.map(b => b.metrics.rejected.length).join(', ')}; agreed ${agreed.map(m => `${m.result.kind} ${m.result.closing.toFixed(1)} ${m.result.sources}`).join(' | ')})`);
      for (const c of (r.R?.referee?.contacts ?? []).slice(0, 4)) console.log(`    (${c.cid}: ${c.reports.map(x => `${x.pid.slice(-4)} closing ${x.closing} predict ${x.predictMs} ms`).join(' / ')}; server ${c.server ? `gap ${c.server.gap.toFixed(2)} closing ${c.server.closing.toFixed(1)}` : '—'}; blame ${c.blame?.fault?.slice(-4) ?? 'none'} ${JSON.stringify(c.blame?.reasons ?? [])})`);
      if (TRACE) for (const x of (r.R?.referee?.forRecord([]).rejected ?? []).slice(0, 1)) {
        const i = r.P.findIndex(p => p.uid === x.uid), path = r.paths[i];
        for (let dt = -400; dt <= 400; dt += 50) {
          const t = x.t + dt, sv = r.R.referee.stateAt(x.uid, t), k = path.findIndex(p => p.t >= t), own = k > 0 ? path[k - 1].pos[0] + (path[k].pos[0] - path[k - 1].pos[0]) * (t - path[k - 1].t) / (path[k].t - path[k - 1].t) : null;
          console.log(`      ${dt} ms: own ${own?.toFixed(2)} server ${sv?.pos[0].toFixed(2)}`);
        }
      }
      for (const x of (r.R?.referee?.forRecord([]).rejected ?? []).slice(0, 4)) console.log(`    (refused: ${x.uid.slice(-4)} episode ${x.ep} at ${x.t}: ${x.why}; it saw itself at ${x.me?.x?.toFixed(2)},${x.me?.z?.toFixed(2)} and the other at ${x.them?.x?.toFixed(2)},${x.them?.z?.toFixed(2)}; the server ${JSON.stringify(x.server)})`);
      json[`${key}${ping}`] = { agreed: agreed.map(m => ({ kind: m.result.kind, closing: m.result.closing, J: m.result.J, gentler: m.result.gentler, sources: m.result.sources, blame: m.blame })), viewError: err, viewErrorDuring: errDuring, worst, starts, damage: dmg, effects: fx };
      await r.close();
    }
  }

  // ---------- 2. automatic ghosting ----------
  if (!only || only.has('2')) {
    section('2. Automatic ghosting: high lag, a reset, the wrong way, the pit lane');
    const G = MP.contact.ghost;
    const rearScripts = [0, 1].map(i => (b, t, ctx) => { ctx.data.lead ??= leader(ctx); return ctx.data.lead === i ? b.drive(0, 15) : t < 1.2 ? stop(b) : b.drive(0, t < 3.5 ? 15 : 26); });

    // high lag: one player at 400 ms ping; the other drives into it from behind — and through it
    {
      const r = await race('lag', rearScripts, { pings: [400, 0], seconds: 12 });
      const [laggy, fine] = r.P, g = ghosted(r.bots[1], laggy.uid, /ping/), lead = r.data.lead, back = 1 - lead;
      const through = r.bots[back].state().s > r.bots[lead].state().s;
      const op = [r.bots[1].contact.opacity(laggy.uid), r.bots[0].contact.opacity(laggy.uid)];
      check('a player on 400 ms ping is ghosted', !!g, g ? g.list[laggy.uid].reasons.join(', ') : 'not ghosted');
      check('… the player on a good connection isn\'t', !everGhost(r.bots[0], fine.uid));
      check('… and nobody touches the ghost: the car behind drives through it', r.bots.every(b => b.metrics.agreed.length === 0) && through, `${r.bots[0].metrics.agreed.length} contacts agreed; the car behind ${through ? 'came out in front' : 'stayed behind'}`);
      check('… drawn see-through, in the others\' games and its own', op.every(x => x < 0.5), `opacity ${op.map(x => x.toFixed(2)).join(', ')} (ghosts ${G.opacity})`);
      await r.close();
    }
    // a reset: the car ahead resets onto the road and stops; the car behind drives through it while it's a ghost
    {
      const r = await race('reset', [0, 1].map(i => (b, t, ctx) => {
        ctx.data.lead ??= leader(ctx);
        if (ctx.data.lead === i) {
          if (t >= 5 && ctx.data.resetAt == null) { ctx.data.resetAt = Date.now(); b.reset(); }
          return ctx.data.resetAt != null && t < 7 ? stop(b) : b.drive(0, 12);
        }
        return t < 0.6 ? stop(b) : b.drive(0, 12);
      }), { seconds: 14 });
      const lead = r.P[r.data.lead], seen = r.bots[1 - r.data.lead], at = r.data.resetAt ?? Infinity;
      const g = ghosted(seen, lead.uid, /reset/, at - 200), up = g ? lifted(seen, lead.uid, g.t) : null;
      const touched = r.bots.flatMap(b => b.metrics.agreed).filter(m => m.result.t >= (g ? at - 2000 : 0));
      check('a car that has just reset is ghosted', !!g, g ? `${g.list[lead.uid].reasons.join(', ')}, ${g.t - at} ms after the reset` : 'not ghosted');
      check(`… for resetSec (${G.resetSec} s), then solid again`, !!up && Math.abs((up.t - at) / 1000 - G.resetSec) < 1, up ? `lifted ${((up.t - at) / 1000).toFixed(1)} s after the reset` : 'never lifted');
      check('… and the car behind drives through it without a contact', touched.length === 0, `${touched.length} contacts`);
      check('… drawn solid again once it\'s clear', seen.contact.opacity(lead.uid) > 0.99, `opacity at the end ${seen.contact.opacity(lead.uid).toFixed(2)}`);
      await r.close();
    }
    // the wrong way: a car turns round, drives against the race for a few seconds — past the other car, waiting on the
    // grid — then turns back
    {
      const r = await race('wrong', [0, 1].map(i => (b, t, ctx) => {
        ctx.data.lead ??= leader(ctx);
        if (ctx.data.lead !== i) return stop(b);
        const D = ctx.data, st = b.state(); D.yaw0 ??= st.yaw;
        if (t < 2.5) return b.drive(3, 8);
        if (!D.turned) { if (Math.abs(yawFrom(st.yaw, D.yaw0)) > 2.9) D.turned = Date.now(); else return { steer: -1, throttle: 0.35, brake: 0, device: 'wheel' }; }
        if (!D.back && Date.now() - D.turned < 4000) return { steer: clamp(yawFrom(D.yaw0 + Math.PI, st.yaw) * 2.2, -1, 1), throttle: st.speed < 10 ? 0.5 : 0, brake: 0, device: 'wheel' };
        // (going the right way again from the moment it moves along the race at over wrongWaySpeed)
        if (D.turned && !D.rightSince && Date.now() - D.turned > 4000 && Math.cos(st.yaw - D.yaw0) * st.speed > G.wrongWaySpeed) D.rightSince = Date.now();
        if (!D.back) { if (Math.abs(yawFrom(st.yaw, D.yaw0)) < 0.3) D.back = Date.now(); else return { steer: -1, throttle: 0.35, brake: 0, device: 'wheel' }; }
        return b.drive(0, 12);
      }), { seconds: 24 });
      const wrong = r.P[r.data.lead], seen = r.bots[1 - r.data.lead], D = r.data;
      const g = D.turned ? ghosted(seen, wrong.uid, /wrong way/, D.turned - 3000) : null, up = g && D.rightSince ? lifted(seen, wrong.uid, D.rightSince - 500) : null;
      check('a car going the wrong way is ghosted', !!g, g ? `${g.list[wrong.uid].reasons.join(', ')}, ${((g.t - D.turned) / 1000).toFixed(1)} s after it turned round` : `not ghosted (turned ${!!D.turned})`);
      check(`… until it's gone the right way for rightWaySec (${G.rightWaySec} s)`, !!up && Math.abs((up.t - D.rightSince) / 1000 - G.rightWaySec) < 1, up ? `lifted ${((up.t - D.rightSince) / 1000).toFixed(1)} s after it was going the right way again` : `never lifted (going the right way ${!!D.rightSince})`);
      check('… and it touched nobody on its way', r.bots.every(b => b.metrics.agreed.length === 0), `${r.bots[0].metrics.agreed.length} contacts`);
      await r.close();
    }
    // the pit lane: one car starts from it (behind the pit wall), the other on the track beside it
    {
      const r = await race('pit', [0, 1].map(i => (b, t) => {
        const s = b.state().s;
        return i === 0 ? b.drive(s < 392 ? 11 : 2.5, Math.min(12, b.safe(s))) : b.drive(-2.5, Math.min(12, b.safe(s)));
      }), { seconds: 30, behaves: [{ place: () => ({ s: 150, d: 11 }) }, {}], until: ctx => ctx.bots[0].state().s > 470 });
      const pit = r.P[0], seen = r.bots[1], g = ghosted(seen, pit.uid, /pit lane/), out = r.paths[0].find(p => p.s > 440);
      const up = g ? lifted(seen, pit.uid, g.t) : null;
      check('a car in the pit lane is ghosted', !!g, g ? g.list[pit.uid].reasons.join(', ') : 'not ghosted');
      check('… solid again once it\'s out on the track', !!up, up ? `lifted as it left (${out ? 'out at ' + out.s.toFixed(0) + ' m' : ''})` : 'never lifted');
      check('… the car on the track never ghosted', !everGhost(seen, r.P[1].uid));
      await r.close();
    }
  }

  // ---------- 3. blame ----------
  if (!only || only.has('3')) {
    section('3. Who caused it: scripted contacts with a known cause; penalties, repeat offenders, ramming');
    const blamed = r => (r.R?.referee?.contacts ?? []).filter(c => c.kind === 'hit' || c.blame?.fault);
    const show = (r, c) => c ? `${c.kind} at ${c.closing.toFixed(1)} m/s: ${c.blame?.fault ? r.P.find(p => p.uid === c.blame.fault)?.name : 'nobody'} (${Object.entries(c.blame?.shares ?? {}).map(([u, x]) => `${r.P.find(p => p.uid === u)?.name} ${(x * 100).toFixed(0)}%`).join(', ')}; ${(c.blame?.reasons ?? []).join('; ')})` : 'no contact';
    // the rear-end: the car behind
    {
      const r = await race('blamerear', [0, 1].map(i => (b, t, ctx) => { ctx.data.lead ??= leader(ctx); return ctx.data.lead === i ? b.drive(0, 15) : t < 1.2 ? stop(b) : b.drive(0, t < 3.5 ? 15 : 26); }), { seconds: 9 });
      const c = blamed(r)[0], want = r.P[1 - r.data.lead].uid;
      check('a rear-end: the car behind is blamed', c?.blame?.fault === want, show(r, c));
      await r.close();
    }
    // a brake test: the car ahead brakes hard for nothing; the one behind (following at 22 m/s) doesn't react in time
    {
      const r = await race('braketest', [0, 1].map(i => (b, t, ctx) => {
        ctx.data.lead ??= leader(ctx);
        const m = b.state(), o = ctx.bots[1 - i].state();
        if (ctx.data.lead === i) return t < 7 ? b.drive(0, Math.min(22, b.safe(m.s))) : t < 9 ? { steer: 0, throttle: 0, brake: 1, device: 'wheel' } : b.drive(0, 12);
        if (t < 1) return stop(b);
        if (b.metrics.agreed.length) return b.drive(0, 8);
        return t < 6.5 ? b.drive(0, clamp(Math.min(o.speed, 22) + 0.8 * (o.s - m.s - 9), 0, 28)) : b.drive(0, 22);
      }), { seconds: 12 });
      const c = blamed(r)[0], want = r.P[r.data.lead].uid;
      check('a brake test: the car that braked is blamed, though it was hit from behind', c?.blame?.fault === want, show(r, c));
      await r.close();
    }
    // a swerve: side by side, one car leaves its lane into the other
    {
      const r = await race('swerve', [0, 1].map(i => (b, t, ctx) => { ctx.data.left ??= lefter(ctx); const L = ctx.data.left === i; return pace(b, ctx, i, L ? 2.2 : (t > 6 && t < 8 ? 1.2 : -2.2), 20); }), { seconds: 11 });
      const c = (r.R?.referee?.contacts ?? [])[0], want = r.P[1 - r.data.left].uid;
      check('a swerve into a car alongside: the swerver is blamed', c?.blame?.fault === want, show(r, c));
      await r.close();
    }
    // ramming: three hard hits from behind within half a minute — penalties, ghosted as a repeat offender, the victim
    // offered a one-tap report with the race server's replay
    {
      const r = await race('ram', [0, 1].map(i => (b, t, ctx) => {
        ctx.data.lead ??= leader(ctx);
        const m = b.state();
        if (ctx.data.lead === i) return b.drive(0, Math.min(6, b.safe(m.s)));
        if (t < 1.5) return stop(b);
        const D = ctx.data, hits = b.metrics.agreed.filter(x => x.result.kind === 'hit').length;
        if (D.hits !== hits) { D.hits = hits; D.backOff = t; }
        // (backing off after each hit; a long run-up for the third: a hard one)
        // (backing off after each hit; for the third, stopping for a long run-up: a hard one)
        if (D.backOff != null && t - D.backOff < (hits >= 2 ? 6 : 2.2)) return hits >= 2 ? stop(b) : b.drive(0, 3);
        return b.drive(0, hits >= 2 ? 30 : 17);
      }), { seconds: 32, until: ctx => ctx.bots.some(b => b.metrics.ramming.length) && ctx.data.hits >= 3 });
      const rammer = r.P[1 - r.data.lead], victim = r.bots[r.data.lead], ram = victim.metrics.ramming[0];
      const inc = r.R?.referee?.incidents.of(rammer.uid) ?? [];
      const pens = r.bots[1 - r.data.lead].metrics.penalties, off = ghosted(victim, rammer.uid, /incidents/);
      check('ramming: the rammer is at fault each time', inc.length >= 3, `${inc.length} incidents: ${inc.map(x => `${(x.share * 100).toFixed(0)}% at ${x.strength.toFixed(1)}`).join(', ')}`);
      check('… a time penalty for causing a crash', pens.length > 0, pens.map(p => `+${p.penaltySec} s: ${p.why}`).join('; ') || 'none');
      check('… ghosted for the rest of the race as a repeat offender', !!off, off ? off.list[rammer.uid].reasons.join(', ') : 'not ghosted');
      check('… and the victim is offered a one-tap report, with the replay', !!ram?.evidenceId, ram ? `${ram.name}: ${ram.why}` : 'nothing offered');
      if (ram?.evidenceId) {
        // (the one tap: the report goes in with the evidence attached — the API keeps both)
        r.P[r.data.lead].session.send({ t: 'report-ramming', evidenceId: ram.evidenceId, by: rammer.uid });
        await sleep(1500);
        const db = new pg.Client({ connectionString: database.url }); await db.connect();
        let ev = null, rep = null;
        try {
          ev = (await db.query('select id, kind, fault_id, victim_id, data from mp_evidence where id = $1', [ram.evidenceId])).rows[0] ?? null;
          if (ev) ev.data = JSON.parse(zlib.gunzipSync(ev.data).toString());
          rep = (await db.query(`select kind, details, ref from reports where ref->>'evidenceId' = $1`, [ram.evidenceId])).rows[0] ?? null;
        } finally { await db.end(); }
        const cars = ev ? Object.values(ev.data?.cars ?? {}) as any[] : [];
        check('… the replay kept: both cars, the seconds before', !!ev && cars.length === 2 && cars.every(c => c.length > 20), ev ? `${cars.map(c => c.length).join(' and ')} poses, ${ev.data?.hits?.length} hits` : 'not kept');
        check('… the report made, with the replay attached', !!rep && JSON.stringify(rep).includes(ram.evidenceId), rep ? 'reported' : 'no report');
      }
      await r.close();
    }
  }

  // ---------- 4. faked contacts ----------
  if (!only || only.has('4')) {
    section('4. Nobody can fake contact: each run checked against the race server\'s log, and driven again');
    const V = MP.contact.verify;
    const honest = [0, 1].map(i => (b, t, ctx) => {
      ctx.data.lead ??= leader(ctx);
      if (ctx.data.lead === i) return b.drive(0, 15);
      if (t < 1.2) return stop(b);
      // (the car behind: into the one ahead, then back off — and, if this is the cheat, fake a push and take another)
      const D = ctx.data, m = b.state(), o = ctx.bots[1 - i].state();
      if (ctx.cheat && t > 9 && !D.faked && o.s - m.s > 8) {
        D.faked = true;
        // a contact that never was: reported to the race server, and the car pushed forward for it
        const p = b.sim.vehicle.body.translation(), f = [Math.sin(m.yaw), Math.cos(m.yaw)], at = Math.round(b.roomT());
        b.recorder.push([f[0] * 2500, f[1] * 2500], [p.x, p.z], { c: 'L', ep: 900, h: 1, o: ctx.P[1 - i].uid, at, f: [o.pos[0], o.pos[2], o.yaw, 0, 0, 0] });
        ctx.P[i].session.send({ t: 'contact-report', other: ctx.P[1 - i].uid, ep: 900, at, kind: 'hit', closing: 9, n: [-f[0], -f[1]], point: [p.x, p.z], me: { x: p.x, z: p.z, vx: 0, vz: 0, yaw: m.yaw, w: 0 }, them: { x: o.pos[0], z: o.pos[2], vx: 0, vz: 0, yaw: o.yaw, w: 0 }, J: [f[0] * 2500, f[1] * 2500], predictMs: 0, track: [] });
      }
      if (ctx.cheat && t > 10.5 && !D.shoved) { D.shoved = true; const f = [Math.sin(m.yaw), Math.cos(m.yaw)]; b.sim.vehicle.body.applyImpulse({ x: f[0] * 2000, y: 0, z: f[1] * 2000 }, true); }
      // (the cheat, once it's time for its fake, drops right back: the claim must be made from well clear of the other car,
      // and on a slow machine the bump comes late, so backing off at 12 might not open the gap before the race ends)
      if (ctx.cheat && t > 8 && !D.faked) return b.drive(0, 6);
      return b.metrics.agreed.length ? b.drive(0, 12) : b.drive(0, t < 3.5 ? 15 : 26);
    });
    const verifyRun = (uid, run, log) => {
      const c = checkContacts({ uid, run, log, cfg: MP.contact }), tr = checkTrail({ run, serverTrail: log.trails?.[uid], cfg: MP.contact });
      const rep = replayRun({ RAPIER: H.RAPIER, settings: H.settings, spec, sockets, track: T.track, run }), cmp = compareTrails(run.trail, rep.trail, V.replayTolM);
      return { c, tr, cmp, problems: [...c.problems, ...tr, ...cmp], steps: rep.steps };
    };
    const want = k => !SCEN || SCEN.includes(k);
    // an honest race: both runs pass — their pushes add up to the agreed impulses, and driven again they land exactly
    // where they said
    if (want('honest')) {
      const r = await race('honest', honest, { seconds: 12 });
      const log = r.R.referee.forRecord(r.P.map(p => p.uid)), runs = r.bots.map(b => b.takeRecord());
      runs.forEach((run, i) => {
        const v = verifyRun(r.P[i].uid, run, log);
        check(`an honest run with contact passes (${r.P[i].name})`, v.problems.length === 0 && v.c.contacts.length > 0, v.problems.length ? v.problems.join(' ') : `${v.c.contacts.length} contacts, each within ${Math.max(...v.c.contacts.map(x => x.off)).toFixed(1)} N s of the agreed impulse; driven again from its ${v.steps} steps, exactly where it said`);
      });
      // and the same run, edited afterwards: each kind of fake fails
      const i = 1 - r.data.lead, uid = r.P[i].uid, run = runs[i], J = run.events.filter(e => e.k === 'J');
      const fake = (name, edit) => { const x = JSON.parse(JSON.stringify(run)); edit(x); const v = checkContacts({ uid, run: x, log, cfg: MP.contact }); check(`a faked record fails: ${name}`, !v.ok, v.problems[0] ?? 'passed'); };
      fake('a push the race server never heard of', x => { const e = J.find(e => e.c === 'L'); x.events.push({ ...e, s: e.s + 300, ep: 777, j: [1500, 0] }); });
      fake('a bigger push than agreed', x => { for (const e of x.events) if (e.k === 'J' && e.h) e.j = e.j.map(v => v * 2); });
      fake('rubbing harder than the cap', x => { const e = J.find(e => e.c === 'L'); x.events.push({ ...e, s: e.s + 1, h: undefined, j: e.j.map(v => v * 0 + Math.sign(v || 1) * 900) }); });
      fake('the hit that pushed it back, left out', x => { x.events = x.events.filter(e => !(e.k === 'J' && e.h)); });
      await r.close();
    }
    // a cheat in the game itself: it reports a contact that never was and pushes its car forward for it (the race
    // server refuses it; the push isn't undone), then shoves its car forward without recording it
    if (want('cheat')) {
      const r = await race('cheat', honest, { seconds: 13, setup: ctx => { ctx.cheat = true; } });
      const i = 1 - r.data.lead, uid = r.P[i].uid, log = r.R.referee.forRecord(r.P.map(p => p.uid)), run = r.bots[i].takeRecord();
      const refused = log.rejected.find(x => x.uid === uid && x.ep === 900);
      check('a contact claimed that never was: the race server refuses it', !!refused, refused ? refused.why : 'not refused');
      const v = verifyRun(uid, run, log);
      check('… and the run that kept its push fails the check', v.c.problems.some(x => /refused|never heard/.test(x)), v.c.problems[0] ?? 'passed');
      check('… and a push it never recorded fails being driven again', v.cmp.length > 0, v.cmp[0] ?? 'passed');
      await r.close();
    }
    // the whole way: a race to the finish, both runs handed in; one edited to claim a push — the API's verdicts, and
    // the safety ratings it moves
    if (want('e2e')) {
      const lap = [0, 1].map(i => (b, t, ctx) => {
        ctx.data.lead ??= leader(ctx);
        const m = b.state(), v = b.safe(m.s), D = (ctx.data[i] ??= {});
        // (stuck — off into the gravel, nose in the tyres — a reset, as a player would: it's in the run's record too)
        if (m.speed < 1 && t > 6) { D.slow ??= t; if (t - D.slow > 2.5) { D.slow = null; b.reset(); } } else D.slow = null;
        // (one bump early on, then each keeps to its own side of the road for the lap)
        if (ctx.data.lead === i) return b.drive(b.metrics.agreed.length ? 2.2 : 0, Math.min(t < 9 ? 15 : 30, v));
        if (t < 1.2) return stop(b);
        return b.metrics.agreed.length ? b.drive(-2.2, Math.min(29, v)) : b.drive(0, Math.min(t < 3.5 ? 15 : 26, v));
      });
      const before = await Promise.all([0, 1].map(() => null));
      const tamper = run => { const x = JSON.parse(JSON.stringify(run)); const e = x.events.find(e => e.k === 'J' && e.c === 'L'); if (e) x.events.push({ ...e, s: e.s + 600, ep: 777, j: [2000, 0] }); return x; };
      const r = await race('e2e', lap, { seconds: 420, handIn: true, progress: true, behaves: [{}, { tamper }], until: ctx => ctx.data.done >= 2, setup: ctx => { ctx.data.done = 0; ctx.bots.forEach(b => b.done.then(() => ctx.data.done++)); } });
      const done = await Promise.all(r.bots.map(b => Promise.race([b.done, sleep(30000).then(() => null)])));
      const [h, c] = done;
      const hv = h?.verdict, cv = c?.verdict;
      check('to the finish: the honest run is confirmed, with its contact checked and driven again', !!hv?.ok && !!hv?.contact, hv ? `${hv.ok ? 'ok' : hv.problems.join(' ')}; ${JSON.stringify(hv.contact)}` : 'no verdict');
      check('… the run claiming a push it never had is refused', cv != null && !cv.ok && cv.problems.some(x => /never heard/.test(x)), cv ? cv.problems.slice(0, 2).join(' ') : 'no verdict');
      const me = await Promise.all(r.P.map(x => x.p.get('/api/v1/mp/me').then(x => x.body).catch(() => null)));
      const fault = r.R?.referee?.contacts?.[0]?.blame?.fault, sf = r.P.map((x, k) => ({ name: x.name, safety: me[k]?.safety, fault: x.uid === fault }));
      check('… safety ratings moved: down for the one at fault, up for the clean one', sf.every(x => x.safety) && sf.every(x => x.fault ? x.safety.value < MP.contact.safety.start : x.safety.value >= MP.contact.safety.start), sf.map(x => `${x.name}${x.fault ? ' (at fault)' : ''}: ${x.safety?.value} (${x.safety?.tier?.name ?? x.safety?.tier})`).join(', '));
      void before;
      await r.close();
    }
  }

  // ---------- 5. eight cars ----------
  if (!only || only.has('5')) {
    section('5. An 8-car race with lots of contact: frame and bandwidth targets');
    const n = 8, budget = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'physics/settings.json'), 'utf8')).budget ?? {};
    const scripts = Array.from({ length: n }, (_, i) => (b, t) => {
      // (a tight pack weaving across the road, so cars touch all the time)
      const m = b.state();
      return t < 0.3 * (i >> 1) ? stop(b) : b.drive(2.8 * Math.sin(t * 0.9 + i * 1.7), Math.min(18 + 3 * Math.sin(t * 0.5 + i), b.safe(m.s)));
    });
    const bytes = Array.from({ length: n }, () => ({ up: 0, down: 0 }));
    const r = await race('pack', scripts, { ping: 80, seconds: 25, setup: ctx => ctx.P.forEach((x, i) => {
      const send = x.session.send.bind(x.session);
      x.session.send = m => { if (m?.t === 'contact-report') bytes[i].up += JSON.stringify(m).length + 8; return send(m); };
      for (const k of ['contact', 'contact-rejected', 'ghosts', 'ramming']) x.session.on(k, m => { bytes[i].down += JSON.stringify(m).length + 4; });
    }), measure: true });
    const secs = r.measured.secs, net = r.P.map((x, i) => ({ up: (r.measured.end[i].up - r.measured.start[i].up + bytes[i].up) / 1024 / secs, down: (r.measured.end[i].down - r.measured.start[i].down + bytes[i].down) / 1024 / secs }));
    const pct = (l, q) => { const s = [...l].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };
    const frames = r.bots.map(b => ({ avg: b.metrics.frameMs.reduce((a, x) => a + x, 0) / Math.max(1, b.metrics.frameMs.length), p95: pct(b.metrics.frameMs, 0.95), step: b.contact?.debug.stepMs ?? 0, stepMax: b.contact?.debug.stepMaxMs ?? 0, frame: b.contact?.debug.frameMs ?? 0 }));
    const agreed = r.R?.referee?.contacts ?? [], lifts = r.bots.map(b => Math.max(0, ...b.metrics.lifts.map(x => x[1]))), spins = r.bots.map(b => Math.max(0, ...b.metrics.lifts.map(x => x[2])));
    const walls = throughWall(r), fb = budget.frameMs ?? 4, sb = budget.carStepMs ?? 0.25, T8 = NET.targets;
    check(`plenty of contact: ${agreed.length} agreed in ${secs.toFixed(0)} s`, agreed.length >= 8, `${agreed.filter(c => c.kind === 'hit').length} hits, ${agreed.filter(c => c.kind === 'rub').length} rubbing; ${r.bots.reduce((a, b) => a + b.metrics.rejected.length, 0)} refused`);
    check(`each game's physics a frame within ${fb} ms (95th percentile, as 60 fps frames), its own car and seven others' proxies`, frames.every(f => f.p95 <= fb), frames.map(f => `${f.avg.toFixed(2)}/${f.p95.toFixed(2)}`).join(', ') + ' ms (average/95th)');
    check(`… the contact's share of each physics step within one car's (${sb} ms)`, frames.every(f => f.step <= sb), frames.map(f => f.step.toFixed(3)).join(', ') + ` ms a step (worst single step ${Math.max(...frames.map(f => f.stepMax)).toFixed(2)} ms); ${frames.map(f => f.frame.toFixed(3)).join(', ')} ms a frame for nearness and proxies`);
    check(`each player's upload within ${T8.upKBs} kB/s, contact reports included`, net.every(x => x.up <= T8.upKBs), net.map(x => x.up.toFixed(1)).join(', ') + ' kB/s');
    check(`each player's download within ${T8.downKBs[8]} kB/s with ${n - 1} cars near, the agreed contacts included`, net.every(x => x.down <= T8.downKBs[8]), net.map(x => x.down.toFixed(1)).join(', ') + ' kB/s');
    check('nothing launched or spun wildly, nobody through a wall', lifts.every(x => x < 0.3) && spins.every(x => x < 2.5) && walls.length === 0, `lifted at most ${Math.max(...lifts).toFixed(2)} m, spun at most ${Math.max(...spins).toFixed(2)} rad/s${walls.length ? `; car ${walls[0].i + 1} through a wall` : ''}`);
    json.pack = { secs, net, frames, contacts: agreed.length, lifts, spins };
    await r.close();
  }
} catch (e: any) {
  check('ran to the end', false, e.stack ?? e.message);
} finally {
  await rt.stop(); await app.close(); await database.drop();
}
if (rtLog.length) console.log(`\n(the real-time server's warnings:\n${rtLog.slice(-20).join('\n')})`);
const failed = results.filter(r => !r).length, summary = failed ? `${failed} of ${results.length} failed` : `${results.length} of ${results.length} ok`;
fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
fs.writeFileSync(path.join(REPO_DIR, 'reports/mp-contact.md'), `# Car-to-car contact\n\n${json.at}. ${summary}. One real-time process, no Redis; physics bots.\n${lines.join('\n')}\n\n\`\`\`json\n${JSON.stringify(json, null, 1).slice(0, 200000)}\n\`\`\`\n`);
console.log(`\n${summary}`);
process.exit(failed ? 1 : 0);
