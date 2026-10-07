// Multiplayer's long tests (Phase 7 Step 1; docs/MULTIPLAYER.md "Tests"), against real real-time server processes
// and Redis, with bots driving a real route (Milton Keynes' loop of roundabouts, from the baked map). Writes
// reports/multiplayer-test.md and .json; exits 1 if any check fails.
//   1. 8 bots in one room on the real route: every car visible to every other, moving, smooth
//   2. bad networks (the simulator on every player's link): the target (150 ms, 30 ms jitter, 5% loss) over
//      WebSockets and over datagrams — no visible snap; much worse (400 ms, 120 ms, 20%) — handled gracefully
//   3. time sync: every client's clock against the server's, on clean and bad links
//   4. reconnecting: one player dropped and back 100 times — the same car, its damage, the others told; no memory growth
//   5. bandwidth: up and down with 8 and with 30 cars nearby, against the targets
//   6. several processes: players joining through two processes meet in one room
//   7. the tick: a full room's tick time; players one process carries
//
//   REDIS_URL=redis://localhost:6379 node --expose-gc server/tools/rt-test.ts [--quick]

import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { Redis } from 'ioredis';
import { REPO_DIR, SERVER_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';
import { signTicket } from '../src/rt/tickets.ts';
import { runBots, realRoute, transport } from './rt-bots.ts';
import { createNetClient } from '../../net/client.js';
import { NET } from '../../net/settings.js';

const QUICK = process.argv.includes('--quick'), SECS = QUICK ? 15 : 40;
const BASE_REDIS = (process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\d+$/, '');
const SECRET = 'rt-load-test-secret-rt-load-test-secret-0123';
const lines: string[] = [], results: boolean[] = [], json: Record<string, unknown> = { at: new Date().toISOString(), quick: QUICK };
const check = (name: string, ok: boolean, detail: string) => { results.push(ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(58)} ${detail}`; lines.push(l); console.log(l); };
const section = (t: string) => { lines.push('', `## ${t}`, ''); console.log(`\n== ${t}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ticket = (uid: string) => ({ ticket: signTicket(SECRET, { uid, name: uid, role: 'player', guest: false }, 120), url: '' });
const flush = async (db: number) => { const r = new Redis(`${BASE_REDIS}/${db}`); await r.flushdb(); r.disconnect(); };

// real-time server processes (npm run rt), each on its own port, sharing a Redis database
const procs: ChildProcess[] = [];
async function serverProcesses(db: number, port: number, n = 1) {
  await flush(db);
  const p = spawn(process.execPath, [path.join(SERVER_DIR, 'src/rt/main.ts'), '--processes', String(n)], { env: { ...process.env, APP_ENV: 'test', RT_PORT: String(port), REDIS_URL: `${BASE_REDIS}/${db}`, RT_SECRET: SECRET }, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(p);
  let up = 0;
  p.stdout!.on('data', (b: Buffer) => { up += (b.toString().match(/rt listening/g) ?? []).length; });
  const t0 = performance.now();
  while (up < n) { if (performance.now() - t0 > 20000) throw new Error('the real-time server didn\'t start'); await sleep(50); }
  return { endpoints: Array.from({ length: n }, (_, k) => `http://localhost:${port + k}`), stop: () => p.kill('SIGTERM'), redis: `${BASE_REDIS}/${db}` };
}
async function roomStats(redisUrl: string) {
  const r = new Redis(redisUrl), all = await r.hgetall('rt:rooms'); r.disconnect();
  return Object.values(all).map(v => JSON.parse(v));
}
const summarise = (res: ReturnType<Awaited<ReturnType<typeof runBots>>['results']>) => {
  const all = res.flatMap(r => r.saw);
  return {
    pairs: all.length, snaps: all.reduce((a, s) => a + s.snaps, 0), frames: all.reduce((a, s) => a + s.frames, 0),
    worstJumpCm: Math.max(0, ...all.map(s => s.worstJumpCm)), worstTurnDeg: Math.max(0, ...all.map(s => s.worstTurnDeg)),
    errorP95Cm: Math.max(0, ...all.map(s => s.errorP95Cm)), errorP50Cm: Math.max(0, ...all.map(s => s.errorP50Cm)),
    minMovedM: Math.min(...all.map(s => s.movedM)), maxFirstSeenMs: Math.max(...all.map(s => s.firstSeenMs)),
    bufferMs: Math.round(res.reduce((a, r) => a + r.stats.bufferMs, 0) / res.length),
  };
};

const route = await realRoute('mk');
lines.push(`# Multiplayer tests`, '', `${new Date().toISOString()} · server/tools/rt-test.ts${QUICK ? ' (quick)' : ''} · bots on the real ${route.region} route (${(route.length / 1000).toFixed(1)} km loop, roundabouts), real-time server processes and Redis on this computer (${(await import('node:os')).cpus().length} cores)`);
try {
  // ---------- 1 & 2: 8 bots, clean and bad networks ----------
  const S = await serverProcesses(8, 2671);
  const eight = async (name: string, netsim: any, opts: { worse?: boolean } = {}) => {
    // (accuracy measured once the buffer has settled: it adapts to the network over the first several seconds)
    const run = await runBots({ endpoint: S.endpoints[0], n: 8, seconds: SECS, route, world: `${name}-${Date.now()}`, netsim, warmupMs: netsim ? Math.min(15000, SECS * 500) : 5000, ticket: i => ticket(`${name}-${i}`) });
    const res = run.results(), s = summarise(res);
    const up = res.map(r => r.stats.upTotal / 1024 / SECS), down = res.map(r => r.stats.downTotal / 1024 / SECS);
    await run.leave();
    return { ...s, upKBs: +Math.max(...up).toFixed(2), downKBs: +Math.max(...down).toFixed(2) };
  };
  section('8 bots in one room, on a real route');
  const clean = await eight('clean', null);
  json.clean = clean;
  check('every car visible to every other, and moving', clean.pairs === 56 && clean.minMovedM > SECS * 10, `${clean.pairs} of 56 pairs; each saw every other move at least ${clean.minMovedM} m; all seen within ${clean.maxFirstSeenMs} ms of joining`);
  check('smooth: no visible snap', clean.snaps === 0, `${clean.snaps} snaps in ${clean.frames} car-frames; worst frame-to-frame jump ${clean.worstJumpCm} cm, turn ${clean.worstTurnDeg}°; shown within ${clean.errorP95Cm} cm of the true path (95%, once settled)`);

  section(`Bad networks (the simulator on every player's own link to the server)`);
  const T = NET.targets.smooth;
  for (const mode of ['stream', 'datagram']) {
    const r = await eight(`bad-${mode}`, { latencyMs: T.latencyMs, jitterMs: T.jitterMs, loss: T.loss, mode });
    json[`bad_${mode}`] = r;
    check(`${T.latencyMs} ms, ${T.jitterMs} ms jitter, ${T.loss * 100}% loss, ${mode === 'stream' ? 'WebSockets' : 'datagrams (WebTransport, later)'}: no visible snap`, r.snaps === 0 && r.pairs === 56,
      `${r.snaps} snaps in ${r.frames} car-frames (worst jump ${r.worstJumpCm} cm); ${r.pairs}/56 pairs; shown ${r.bufferMs} ms behind the usual delay; within ${r.errorP95Cm} cm of the true path (95%, once settled)`);
  }
  const worse = await eight('awful', { latencyMs: 400, jitterMs: 120, loss: 0.2 });
  json.awful = worse;
  check('much worse (400 ms, 120 ms jitter, 20% loss): handled gracefully', worse.pairs === 56 && worse.snaps / worse.frames < 0.05 && worse.minMovedM > SECS * 5,
    `still connected, every car shown and moving (at least ${worse.minMovedM} m); ${(worse.snaps / worse.frames * 100).toFixed(2)}% of car-frames with a visible correction (worst ${worse.worstJumpCm} cm)`);

  // ---------- 3: time sync ----------
  section('Time sync');
  {
    const links: [string, any][] = [['localhost', null], ['50 ms, 5 ms jitter', { latencyMs: 50, jitterMs: 5, loss: 0 }], ['150 ms, 30 ms jitter, 5% loss', { latencyMs: 150, jitterMs: 30, loss: 0.05 }]];
    const cs = links.map(([n, c], i) => ({ n, c: createNetClient({ transport, endpoint: S.endpoints[0] as any, world: `clock-${Date.now()}`, netsim: c, getTicket: async () => ticket(`clock-${i}`) }) }));
    for (const x of cs) await x.c.connect();
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) { for (const x of cs) x.c.update(1 / 60, null); await sleep(16); }
    // the server's own clock, read the same way: a client on localhost with no delay is the reference (its error is
    // bounded by half its sub-millisecond round trip)
    const ref = cs[0].c.roomNow(), out: Record<string, number> = {};
    for (const x of cs) out[x.n] = +Math.abs(x.c.roomNow() - ref).toFixed(2);
    json.timeSync = out;
    check('every client within a few ms of the server', out['50 ms, 5 ms jitter'] <= NET.targets.timeSyncMs && out['150 ms, 30 ms jitter, 5% loss'] <= NET.targets.timeSyncMs * 2,
      Object.entries(out).map(([k, v]) => `${k}: ${v} ms`).join(' · ') + ` (localhost's round trip ${cs[0].c.stats.ping.toFixed(2)} ms)`);
    for (const x of cs) await x.c.leave();
  }

  // ---------- 5: bandwidth ----------
  section('Bandwidth (kB a second, WebSocket frames included)');
  for (const n of [8, 30]) {
    const run = await runBots({ endpoint: S.endpoints[0], n, seconds: QUICK ? 10 : 25, route, world: `bw${n}-${Date.now()}`, spacing: n === 30 ? 12 : 40, measure: n === 8, ticket: i => ticket(`bw${n}-${i}`) });
    const res = run.results(), secs = QUICK ? 10 : 25;
    const up = Math.max(...res.map(r => r.stats.upTotal / 1024 / secs)), down = Math.max(...res.map(r => r.stats.downTotal / 1024 / secs));
    const nearMax = n - 1, perCar = down / nearMax;
    await run.leave();
    json[`bandwidth${n}`] = { upKBs: +up.toFixed(2), downKBs: +down.toFixed(2), perCarKBs: +perCar.toFixed(2) };
    check(`${n} cars nearby: up under ${NET.targets.upKBs} kB/s, down within target`, up < NET.targets.upKBs && down <= (NET.targets.downKBs as any)[n] && perCar <= NET.targets.downPerCarKBs,
      `up ${up.toFixed(2)} kB/s · down ${down.toFixed(2)} kB/s (${perCar.toFixed(2)} a car; targets: ${NET.targets.upKBs} up, ${(NET.targets.downKBs as any)[n]} down, ${NET.targets.downPerCarKBs} a car)`);
  }

  // ---------- 6 & 7: several processes, the tick, players a process ----------
  section('Processes and the tick');
  S.stop();
  {
    const M = await serverProcesses(9, 2681, 2);
    const a = createNetClient({ transport, endpoint: M.endpoints[0] as any, world: 'shared', getTicket: async () => ticket('via-a') });
    const b = createNetClient({ transport, endpoint: M.endpoints[1] as any, world: 'shared', getTicket: async () => ticket('via-b') });
    await a.connect(); await b.connect();
    const t0 = performance.now(); let tick = 0;
    while (performance.now() - t0 < 2000) { const s = () => ({ tick: ++tick, pos: [tick / 10, 0.5, 0], rot: [0, 0, 0, 1], vel: [6, 0, 0], ang: [0, 0, 0], wheels: [] }); a.update(1 / 60, s); b.update(1 / 60, s); a.sample(1 / 60); b.sample(1 / 60); await sleep(16); }
    const same = a.conn.roomId === b.conn.roomId, sees = !!b.sample(0).find(c => c.id === a.id)?.pose && !!a.sample(0).find(c => c.id === b.id)?.pose;
    check('players joining through two processes meet in one room', same && sees, `room ${a.conn.roomId} / ${b.conn.roomId}; each sees the other: ${sees}`);
    await a.leave(); await b.leave();
    M.stop();
  }
  {
    const L = await serverProcesses(10, 2691, 1), rooms = 8, per = 32;
    const runs = await Promise.all(Array.from({ length: rooms }, (_, k) => runBots({ endpoint: L.endpoints[0], n: per, seconds: QUICK ? 12 : 25, fps: 30, route, world: `load-${k}`, spacing: 15, measure: false, ticket: i => ticket(`load-${k}-${i}`) })));
    await sleep(500);
    const st = (await roomStats(L.redis)).filter(r => /^load-/.test(r.world));
    const p95 = Math.max(...st.map(r => r.tickMsP95)), players = st.reduce((a, r) => a + r.players, 0);
    json.load = { rooms: st.length, players, tickMsP95: p95, perRoom: st.map(r => ({ world: r.world, players: r.players, tickMsP95: r.tickMsP95 })) };
    check(`a full room's tick (${per} players): p95 under ${NET.targets.tickMs} ms`, st.length === rooms && p95 <= NET.targets.tickMs, `${st.length} rooms of ${per} in one process: tick p95 ${p95.toFixed(2)} ms at worst (${NET.tickHz} a second: ${(1000 / NET.tickHz).toFixed(0)} ms available)`);
    check(`players one process carries: ${NET.targets.playersPerProcess}`, players >= NET.targets.playersPerProcess && p95 <= NET.targets.tickMs, `${players} players in one process, every room within its tick target`);
    for (const r of runs) await r.leave();
    L.stop();
  }

  // ---------- 4: reconnecting 100 times (the server in this process, to watch its memory) ----------
  section('Reconnecting');
  {
    await flush(11);
    const rt = await startRt({ port: 2701, redisUrl: `${BASE_REDIS}/11`, secret: SECRET, rt: { allowGuests: true, maxPlayers: 1000, roomMaxClients: 64, netsim: true } });
    const ep = 'http://localhost:2701' as any;
    const a = createNetClient({ transport, endpoint: ep, world: 'reconnect', getTicket: async () => ticket('dropper') });
    const b = createNetClient({ transport, endpoint: ep, world: 'reconnect', getTicket: async () => ticket('watcher') });
    await a.connect(); await b.connect();
    const id = a.id;
    a.sendEvent({ kind: 'damage', hits: { shell: 'kept' }, at: 1 });
    let aways = 0, backs = 0, tick = 0;
    b.on('roster', m => { if (m.status?.id === id) m.status.status === 'away' ? aways++ : backs++; });
    const pump = async (ms: number) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { a.update(1 / 60, () => ({ tick: ++tick, pos: [tick / 20, 0.5, 0], rot: [0, 0, 0, 1], vel: [3, 0, 0], ang: [0, 0, 0], wheels: [] })); b.update(1 / 60, null); b.sample(1 / 60); await sleep(16); } };
    const heap = () => { (globalThis as any).gc?.(); (globalThis as any).gc?.(); return process.memoryUsage().heapUsed / 1e6; };
    await pump(500);
    let heap10 = 0, ok = 0, worstMs = 0;
    const N = QUICK ? 30 : 100;
    for (let i = 1; i <= N; i++) {
      const t0 = performance.now();
      a.conn.breakConnection();
      const tw = performance.now(); while (a.status !== 'reconnecting' && performance.now() - tw < 3000) await pump(16);
      while (a.status !== 'online' && performance.now() - t0 < 15000) await pump(20);
      worstMs = Math.max(worstMs, performance.now() - t0);
      await pump(150);
      const seen = b.players.get(id);
      if (a.status === 'online' && a.id === id && seen?.events?.[0]?.hits?.shell === 'kept' && seen.status === 'here') ok++;
      if (i === 10) heap10 = heap();
    }
    const heapEnd = heap(), room = rt.rooms()[0], players = room?.players.size;
    json.reconnect = { n: N, ok, aways, backs, worstMs: Math.round(worstMs), heap10MB: +heap10.toFixed(1), heapEndMB: +heapEnd.toFixed(1), players };
    check(`dropped and back ${N} times: the same car, its damage, the others told`, ok === N && aways >= N && backs >= N && players === 2, `${ok}/${N} back as the same car with its damage; the other player saw it away ${aways} and back ${backs} times; ${players} players in the room; the slowest back in ${(worstMs / 1000).toFixed(1)} s`);
    check('no memory growth over the reconnects', !(globalThis as any).gc || heapEnd - heap10 < 15, (globalThis as any).gc ? `heap ${heap10.toFixed(1)} MB after 10, ${heapEnd.toFixed(1)} MB after ${N} (server and both clients, this process)` : 'not measured (run with --expose-gc)');
    await a.leave(); await b.leave(); await rt.stop();
  }
} catch (e: any) {
  check('ran to the end', false, e?.stack ?? String(e));
} finally {
  for (const p of procs) p.kill('SIGTERM');
}

const failed = results.filter(r => !r).length;
json.ok = !failed;
fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
fs.writeFileSync(path.join(REPO_DIR, 'reports/multiplayer-test.json'), JSON.stringify(json, null, 1) + '\n');
fs.writeFileSync(path.join(REPO_DIR, 'reports/multiplayer-test.md'), `${lines.join('\n')}\n\n${failed ? `**${failed} FAILED**` : '**All passed.**'}\n\nTargets: net/settings.js \`targets\`; how it all works: docs/MULTIPLAYER.md.\n`);
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exit(failed ? 1 : 0);
