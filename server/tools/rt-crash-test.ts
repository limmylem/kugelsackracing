// @ts-nocheck — (bots and the browser-side modules: not this program's types)
// The real-time server crashing (Phase 7 Step 5; docs/MULTIPLAYER.md, docs/OPERATIONS.md): "races on a crashed server end
// with nothing lost or duplicated". The API in this process; the real-time server in a process of its own (server/src/rt/
// main.ts, as in production: one process, no Redis), killed with SIGKILL — no draining, no goodbye — and started again.
//
//   A. a race under way: the server killed mid-race. The players are told (the race called off) and the hub joins again by
//      itself; nothing reached the API for that race — no race, no pay, no cooldown for leaving early, no money moved (a
//      multiplayer race has no entry fee: data/economy.json multiplayer, nothing staked) — and every balance still its
//      ledger's sum; the same players queue again and race, and that race is paid once (the sweep after it pays nothing more)
//   B. free roam mid-session: two players parked side by side, their places saved; the server killed. Each zone joined again
//      by itself (a fresh ticket, waiting longer each time — mp/roamClient.js), the two in the same instance and seeing each
//      other again; their saved places as they were
//
//   node server/tools/rt-crash-test.ts [--only A,B]     (TEST_DATABASE_URL; no Redis)

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR, SERVER_DIR } from '../src/config.ts';
import { verifyTicket } from '../src/rt/tickets.ts';
import { courseOf } from '../src/rt/mp.ts';
import { networkOf } from '../src/rt/roam.ts';
import { seedMpRoutes } from './seed-mp-routes.ts';
import { createMpSession } from '../../mp/client.js';
import { createRaceBot } from '../../mp/bot.js';
import { createRoamBot } from '../../mp/roamBot.js';
import { transport } from './rt-bots.ts';

const args = process.argv.slice(2), only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const PORT = 8797, RT_PORT = 2797, SECRET = 'rt-crash-test-secret-rt-crash-test-0123456789';
const MP = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/multiplayer.json'), 'utf8'));
const ROAM = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/roam.json'), 'utf8'));
const QCFG = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/quests.json'), 'utf8'));
const FAST = { ...MP.npc, corneringG: 1.6, accelG: 0.8, brakeG: 1.2 };
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const section = (s: string) => console.log(`\n== ${s}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => any, ms: number, every = 250) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await f(); if (v) return v; } return null; };

const database = await freshDatabase('rtcrash');
const app: any = await buildApp({ config: testConfig(database.url, { serveClient: false, logLevel: 'warn' }, { PUBLIC_URL: 'http://localhost:8787', RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });
await seedMpRoutes(app.content, { regions: ['mk', 'sf'] });
const db = app.deps.db, q = async (s: any) => (await db.execute(s)).rows as any[];

// ---------- the real-time server: a process of its own ----------
const rtSaid: string[] = [];
let rtProc: any = null;
async function startRtProcess() {
  rtProc = spawn(process.execPath, [path.join(SERVER_DIR, 'src/rt/main.ts')], { env: { ...process.env, APP_ENV: 'test', RT_PORT: String(RT_PORT), RT_SECRET: SECRET, API_INTERNAL_URL: `http://localhost:${PORT}`, REDIS_URL: '', GIT_COMMIT: 'crash-test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const s of [rtProc.stdout, rtProc.stderr]) s.on('data', (b: Buffer) => { for (const l of b.toString().split('\n')) if (l.trim()) { rtSaid.push(l); if (process.env.RT_DEBUG) console.log(`[rt] ${l.slice(0, 240)}`); } });
  const up = await until(async () => { try { const r = await fetch(`http://localhost:${RT_PORT}/health`); return r.ok && (await r.json()).ok; } catch { return false; } }, 30000, 200);
  if (!up) throw new Error(`the real-time server didn't start: ${rtSaid.slice(-5).join(' | ')}`);
}
async function killRt() {
  const p = rtProc, gone = new Promise(r => p.once('exit', r));
  p.kill('SIGKILL');
  await gone;
}

let made = 0;
async function people(n: number, tag: string) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = ++made, p = await signUp(app, app.deps.mailer.outbox, { email: `${tag}${k}@example.com`, name: `${tag.toUpperCase()} Racer ${k}`, ip: `10.${40 + (k >> 8)}.${k & 255}.1` });
    const ticket = async () => { const r = await p.post('/api/v1/rt/ticket', {}); if (r.status !== 200) throw new Error(r.text); return r.body; };
    const uid = verifyTicket(SECRET, (await ticket()).ticket).uid;
    out.push({ p, uid, ticket, session: createMpSession({ transport, getTicket: ticket }), name: `${tag.toUpperCase()} Racer ${k}` });
  }
  return out;
}
const courses = new Map();
const courseFor = async v => { const k = JSON.stringify(v.venue); if (!courses.has(k)) courses.set(k, courseOf(await app.mp.venue(v.venue))); return courses.get(k); };
const botFor = (x, i) => createRaceBot({ session: x.session, courseFor, quests: QCFG, cfg: FAST, skill: 0.88 + i * 0.02 });
// a custom lobby on the San Francisco route, one lap: its host and the rest join, all ready, the host starts
async function raceOf(list) {
  const [host, ...rest] = list;
  await host.session.createLobby({ kind: 'custom', settings: { venue: { kind: 'route', id: 'route_mpsf' }, laps: 1, name: 'Crash' } });
  for (const x of rest) await x.session.joinLobby(host.session.race.id);
  await until(() => host.session.lobby?.players.length === list.length, 10000);
  for (const x of list) x.session.send({ t: 'ready', v: true });
  await sleep(300); host.session.send({ t: 'start' });
  return until(() => list.every(x => x.session.phase === 'racing') && host.session.race.id, 90000);
}
const ledgerOf = async (uid: string) => q(sql`select id, amount, kind, ref from ledger where user_id = ${uid} order by id`);
const sumOf = (rows: any[]) => rows.reduce((a, r) => a + Number(r.amount), 0);

await startRtProcess();
try {
  // ---------- A ----------
  if (!only || only.has('A')) {
    section('A. The real-time server killed mid-race (SIGKILL)');
    const A = await people(2, 'a');
    const before = await Promise.all(A.map(x => ledgerOf(x.uid)));
    const said: string[][] = A.map(() => []), hubBack = A.map(() => false);
    A.forEach((x, i) => { x.session.on('notice', t => said[i].push(String(t))); x.session.on('hub-back', () => { hubBack[i] = true; }); });
    for (const x of A) await x.session.hub();
    A.forEach((x, i) => botFor(x, i));
    const roomId = await raceOf(A);
    check('a race under way (two players, one lap)', !!roomId, roomId ?? A.map(x => x.session.phase).join(', '));
    await sleep(4000);
    const t0 = Date.now();
    await killRt();
    const told = await until(() => said.every(l => l.some(t => /restarted|called off/.test(t))), 60000, 250);
    check('the players are told the race server restarted and the race is called off', !!told, said.map(l => l.at(-1) ?? 'nothing').join(' · '));
    await startRtProcess();
    const back = await until(() => hubBack.every(Boolean), 60000, 250);
    check('started again: each player\'s hub joins it again by itself', !!back, `${((Date.now() - t0) / 1000).toFixed(1)} s after the crash`);
    const races = await q(sql`select id, state from mp_races where id like ${`${roomId}%`}`), rp = await q(sql`select race_id from mp_race_players where user_id = any(${`{${A.map(x => x.uid).join(',')}}`}::text[])`);
    const after = await Promise.all(A.map(x => ledgerOf(x.uid)));
    check('nothing of that race reached the API: no race, no results, no pay, no money moved', !races.length && !rp.length && after.every((l, i) => l.length === before[i].length && sumOf(l) === sumOf(before[i])), `${races.length} races, ${rp.length} results; balances ${after.map(sumOf).join(', ')} (were ${before.map(sumOf).join(', ')})`);
    const cds = await Promise.all(A.map(x => app.mp.cooldown(x.uid)));
    check('no cooldown for leaving a race early: the server went, not the player', cds.every(c => !c.until), JSON.stringify(cds));
    // queuing again: the queue takes them (and they leave it), then the two race again — to the end, paid once
    for (const x of A) await x.session.leaveRace();
    const queued = await Promise.all(A.map(x => new Promise(res => { const off = x.session.on('queued', m => { off(); res(m); }); x.session.queue({ region: 'local', pings: { local: 20 } }).catch(e => { off(); res(null); }); setTimeout(() => res(null), 10000); })));
    check('they can queue again', queued.every(Boolean), queued.map(m => m ? `queued (${m.waiting} waiting)` : 'refused').join(' · '));
    for (const x of A) await x.session.leaveQueue();
    const again = await raceOf(A);
    const done = again && await until(() => A.every(x => x.session.confirmed), 420000, 500);
    const conf = A[0].session.confirmed?.confirmed ?? [];
    check('and race again, to the end: confirmed, each paid', !!done && conf.filter(r => !r.npc).every(r => r.status === 'finished' && r.pay?.paid), conf.map(r => `P${r.place} ${r.status} ${r.pay?.money}`).join(', '));
    await app.mp.sweep(); await app.mp.sweep();
    const paid = await Promise.all(A.map(async x => (await ledgerOf(x.uid)).filter(r => r.kind === 'reward' && r.ref?.mpRace)));
    check('paid exactly once (the sweep pays nothing more); every balance its ledger\'s sum', paid.every(l => l.length === 1) && !(await app.economy.ledgerCheck()).length, paid.map(l => `${l.length} payment of ${l[0]?.amount}`).join(' · '));
    for (const x of A) await x.session.close();
  }

  // ---------- B ----------
  if (!only || only.has('B')) {
    section('B. The real-time server killed mid-session in free roam (SIGKILL)');
    const N = networkOf('mk'), at = N.nearest(300, 300, undefined, 2000);
    const parked = (x: number) => (s: any) => ({ ...s, pos: [x, s.pos?.[1] ?? 0, at.z], vel: [0, 0, 0], ang: [0, 0, 0], rot: [0, 0.7071, 0, 0.7071], wheels: s.wheels.map((w: any) => ({ ...w, omega: 0, slip: 0 })), throttle: 0 });
    const bots: any[] = [];
    for (const [k, letter] of ['CrashA', 'CrashB'].entries()) {
      await app.mp.devPlayer(letter);
      const getTicket = async () => {
        const r = await fetch(`http://localhost:${PORT}/api/v1/rt/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:8787', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ player: letter }) });
        const j: any = await r.json(); if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? r.status), { code: j?.error?.code });
        return { ticket: j.ticket, url: `http://localhost:${RT_PORT}` };
      };
      const b: any = createRoamBot({ transport, getTicket, region: 'mk', cfg: ROAM, points: [[at.x, 0, at.z], [at.x + 200, 0, at.z]], look: { carId: 'starter_car', paint: { colour: k ? '#36f' : '#f63' }, parts: {}, bot: true }, endpoint: `http://localhost:${RT_PORT}` });
      b.uid = `dev-player-${letter.toLowerCase()}`;
      b.override(parked(at.x + k * 6));
      await b.start();
      bots.push(b);
    }
    let last = performance.now();
    const loop = setInterval(() => { const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t; for (const b of bots) { try { b.step(dt, t); b.sample(dt); } catch (e) { console.warn(e); } } }, 1000 / 30);
    const sees = (b: any, o: any) => b.sample(0).some((c: any) => c.uid === o.uid && c.pose);
    const together = await until(() => sees(bots[0], bots[1]) && sees(bots[1], bots[0]), 20000);
    check('two players in free roam, side by side, seeing each other', !!together, bots.map(b => `${b.uid} zone ${b.RC.home}`).join(' · '));
    const saved = await until(async () => { const r = await q(sql`select user_id, region, pos from roam_players where user_id = any(${`{${bots.map(b => b.uid).join(',')}}`}::text[]) and pos is not null`); return r.length === 2 ? r : null; }, (ROAM.persistence.saveEverySec + 15) * 1000, 1000);
    check('their places saved as they drive', !!saved, saved ? saved.map(r => `${r.user_id} ${r.region} ${r.pos.map(Math.round).join(',')}`).join(' · ') : 'not saved');
    const statuses: string[][] = bots.map(() => []);
    bots.forEach((b, i) => b.RC.on('status', s => { if (s.zone === b.RC.home) statuses[i].push(`${s.status}${s.message ? `: ${s.message}` : ''}`); }));
    const t0 = Date.now();
    await killRt();
    await sleep(1500);
    await startRtProcess();
    const rejoined = await until(() => bots.every(b => b.RC.homeNet?.status === 'online') && sees(bots[0], bots[1]) && sees(bots[1], bots[0]), 90000, 250);
    check('each joins its zone again by itself, and the two see each other again', !!rejoined, `${((Date.now() - t0) / 1000).toFixed(1)} s after the crash; ${statuses.map(l => l.join(' → ')).join(' · ')}`);
    check('told the server was restarting while it was gone, then the notice put away', statuses.every(l => l.some(s => /restarting/.test(s)) && l.at(-1) === 'online'), statuses.map(l => l.join(' → ')).join(' · '));
    const same = bots[0].RC.home === bots[1].RC.home && bots[0].RC.connOf(bots[0].RC.home)?.roomId === bots[1].RC.connOf(bots[1].RC.home)?.roomId;
    check('in the same zone\'s instance again', same, bots.map(b => b.RC.connOf(b.RC.home)?.roomId).join(' · '));
    const now = await q(sql`select user_id, region, pos from roam_players where user_id = any(${`{${bots.map(b => b.uid).join(',')}}`}::text[])`);
    const kept = saved && now.every(r => { const s = saved.find(x => x.user_id === r.user_id); return s && r.region === s.region && Math.hypot(r.pos[0] - s.pos[0], r.pos[2] - s.pos[2]) < 1; });
    check('nothing lost: their saved places as they were', !!kept, now.map(r => `${r.user_id} ${r.region} ${r.pos.map(Math.round).join(',')}`).join(' · '));
    clearInterval(loop);
    for (const b of bots) await b.leave().catch(() => {});
  }
} catch (e: any) {
  check('ran to the end', false, e.stack ?? e.message);
} finally {
  try { rtProc?.kill('SIGKILL'); } catch { /* gone */ }
  await app.close(); await database.drop();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exit(failed ? 1 : 0);
