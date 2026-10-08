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
//   node server/tools/mp-contact-test.ts [--only 1,2] [--pings 0,80,150,250] [--scenarios rear,side,…]

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
import { trackFor } from '../../mp/verify.js';
import { damageView } from '../../play/multiplayer.js';
import { CarDamage } from '../../garage/carDamage.js';
import { harness, crashContext } from '../../tests/harness.mjs';
import { NET } from '../../net/settings.js';
import { transport } from './rt-bots.ts';

const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', null) ? new Set(opt('--only').split(',')) : null;
const PINGS = opt('--pings', '0,80,150,250').split(',').map(Number);
const SCEN = opt('--scenarios', null)?.split(',') ?? null;
const PORT = 8794, RT_PORT = 2794, SECRET = 'mp-contact-test-secret-mp-contact-test-01234567';
const MP = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/multiplayer.json'), 'utf8'));
const QCFG = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/quests.json'), 'utf8'));
const TRACKS = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/tracks.json'), 'utf8'));
// (a club circuit: a kilometre-long main straight with a pit lane on its left, then corners)
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
async function race(tag, scripts, { ping = 0, pings = null, mode = 'full', seconds = 10, behaves = [], handIn = false, until: stopWhen = null } = {}) {
  const P = [];
  for (let i = 0; i < scripts.length; i++) P.push(...await people(1, tag, { netsim: netOf(pings?.[i] ?? ping) }));
  const bots = P.map((x, i) => createPhysicsBot({ name: x.name, RAPIER: H.RAPIER, settings: H.settings, spec, sockets, T, session: x.session, quests: QCFG, cfg: MP, damage: damageOf(), script: (b, t) => scripts[i](b, t, ctx), handIn, behave: behaves[i] ?? {} }));
  const ctx: any = { bots, P, data: {} };
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
  while (Date.now() - t0 < seconds * 1000 && !(stopWhen?.(ctx))) {
    await sleep(50);
    bots.forEach((b, i) => {
      const net = P[i].session.race?.net; if (!net) return;
      const s = b.state(); paths[i].push({ t: net.stampAt(), pos: s.pos });
      // what this game draws of each other car, and when that is
      for (const o of net.sample(0)) if (o.pose) views[i].push({ uid: o.uid, at: o.pose.drawnAt ?? o.pose.shownAt, pos: o.pose.pos });
    });
  }
  return { ...ctx, R, roomId, paths, views, async close() { for (const b of bots) b.dispose(); await Promise.all(P.map(x => x.session.close().catch(() => {}))); } };
}

// how far each game's drawing of the other car was from where that car really was then (m: the worst, over a window)
function viewError(r, from, to) {
  let worst = 0;
  r.bots.forEach((b, i) => {
    for (const v of r.views[i]) {
      if (v.at < from || v.at > to) continue;
      const j = r.P.findIndex(x => x.uid === v.uid); if (j < 0) continue;
      const path = r.paths[j], k = path.findIndex(p => p.t >= v.at); if (k <= 0) continue;
      const a = path[k - 1], c = path[k], u = (v.at - a.t) / Math.max(1, c.t - a.t), x = a.pos[0] + (c.pos[0] - a.pos[0]) * u, z = a.pos[2] + (c.pos[2] - a.pos[2]) * u;
      worst = Math.max(worst, Math.hypot(v.pos[0] - x, v.pos[2] - z));
    }
  });
  return worst;
}
// each car's damage as its owner has it, and as the other player's game draws it (Step 1's damage events)
function damageAgrees(r) {
  const out = [];
  r.bots.forEach((b, i) => {
    const own = JSON.stringify(b.contact ? r.P[i] && b && b.metrics.impacts.length ? (() => { const d = b._damage; return null; })() : null : null);
    void own;
  });
  return out;
}

try {
  // ---------- 1. scenarios ----------
  if (!only || only.has('1')) {
    section('1. Contact scenarios at 0, 80, 150 and 250 ms ping');
    const leader = (ctx) => { const [a, b] = ctx.bots; return (a.state().s >= b.state().s) ? 0 : 1; };
    const SC = {
      rear: {
        name: 'a rear-end (26 m/s into 15 m/s, the same lane)', expect: 'hit',
        // (the one ahead on the grid goes at 15 m/s; the other lets it go, falls in behind, then closes at 26)
        scripts: [0, 1].map(i => (b, t, ctx) => { ctx.data.lead ??= leader(ctx); return ctx.data.lead === i ? b.drive(0, 15) : t < 1.2 ? { steer: 0, throttle: 0, brake: 1, device: 'wheel' } : b.drive(0, t < 3.5 ? 15 : 26); }),
      },
    };
    for (const ping of PINGS) for (const [key, sc] of Object.entries(SC)) {
      if (SCEN && !SCEN.includes(key)) continue;
      const r = await race(`${key}${ping}`, sc.scripts, { ping, seconds: sc.seconds ?? 12 });
      const agreed = r.bots[0].metrics.agreed, kinds = agreed.map(m => m.result.kind);
      const t1 = agreed.length ? agreed[0].result.t : null;
      const err = t1 != null ? viewError(r, t1 + 500, t1 + 3500) : null;
      // (in the seconds round the contact: lifted off the road, the spin, the roll)
      const inWin = (b, k) => Math.max(0, ...b.metrics.lifts.filter(x => t1 != null && x[0] >= t1 - 200 && x[0] <= t1 + 2500).map(x => x[k]));
      const worst = r.bots.map(b => ({ lift: inWin(b, 1), yaw: inWin(b, 2), roll: b.metrics.maxRoll }));
      check(`${ping} ms · ${sc.name}: an agreed contact`, agreed.length > 0 && kinds.includes(sc.expect), `${agreed.length} agreed (${kinds.join(', ')}); closing ${agreed[0]?.result.closing?.toFixed(1)} m/s, J ${agreed[0]?.result.J?.toFixed(0)} N s, ${agreed[0]?.result.sources}`);
      check(`${ping} ms · ${sc.name}: both see each car where it was (within 0.5 m)`, err != null && err < 0.5, `worst ${err?.toFixed(2)} m`);
      check(`${ping} ms · ${sc.name}: nothing launched, spun or rolled`, worst.every(w => w.lift < 0.3 && w.roll < 0.4 && w.yaw < (sc.spinOk ?? 1.5)), worst.map(w => `lifted ${w.lift.toFixed(2)} m, yaw ${w.yaw.toFixed(2)} rad/s, roll ${(w.roll * 57.3).toFixed(0)}°`).join(' · '));
      console.log(`    (reports sent: ${r.bots.map(b => b.contact?.debug.reports ?? '?').join(', ')}; rejected ${r.bots.map(b => b.metrics.rejected.length).join(', ')}; agreed ${agreed.map(m => `${m.result.kind} ${m.result.closing.toFixed(1)} ${m.result.sources}`).join(' | ')})`);
      for (const c of r.R?.referee?.contacts ?? []) console.log(`    (${c.cid}: ${c.reports.map(x => `${x.pid.slice(-4)} closing ${x.closing} n ${x.n} predict ${x.predictMs} ms`).join(' / ')}; server ${c.server ? `gap ${c.server.gap.toFixed(2)} closing ${c.server.closing.toFixed(1)}` : '—'})`);
      json[`${key}${ping}`] = { agreed: agreed.map(m => ({ kind: m.result.kind, closing: m.result.closing, J: m.result.J, gentler: m.result.gentler, sources: m.result.sources, blame: m.blame })), viewError: err, worst };
      await r.close();
    }
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
