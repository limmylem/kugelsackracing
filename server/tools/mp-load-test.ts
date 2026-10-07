// @ts-nocheck — (bots: not this program's types)
// The matchmaking load test (Phase 7 Step 2; docs/MULTIPLAYER.md "Tests"): 2,000 bots queue for quick races at once,
// against ONE real-time process with no Redis. Each bot is a real client (its own WebSocket, a signed ticket with a
// rating, a car — class and performance rating — and a ping, spread the way players would be), run in worker processes
// so they don't share the server's CPU. When matched, each takes its seat in the race room made for it (the reservation
// the queue sent), then leaves. Measured: how long each waited, each race's spread in skill, car and ping, against
// data/multiplayer.json queue.targets — and what it cost the server (the queue's cycle, its memory, its CPU).
// Writes reports/mp-matchmaking-load.md.
//
//   node server/tools/mp-load-test.ts [--bots 2000] [--workers 4] [--redis]     (TEST_DATABASE_URL; --redis: REDIS_URL)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SECRET = 'mp-load-secret-mp-load-secret-mp-load-0123456789';

// ---------- a worker: its share of the bots ----------
if (process.env.MP_LOAD_WORKER) {
  const { signTicket } = await import('../src/rt/tickets.ts');
  const { transport } = await import('./rt-bots.ts');
  const { PROTOCOL } = await import('../../net/protocol.js');
  const { from, count, endpoint, seed } = JSON.parse(process.env.MP_LOAD_WORKER);
  let a = seed >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  // (players as they'd be: most cars cheap, a few fast; ratings spread round the start; pings near and far)
  const CLASSES = [['D', 0.4, 150, 459], ['C', 0.3, 460, 579], ['B', 0.18, 580, 679], ['A', 0.08, 680, 739], ['S', 0.04, 740, 849]];
  const pickClass = () => { let x = rnd(); for (const c of CLASSES) { if ((x -= c[1]) <= 0) return c; } return CLASSES[0]; };
  const out = [];
  const one = async i => {
    const [cls, , lo, hi] = pickClass(), pr = Math.round(lo + (hi - lo) * rnd());
    const races = Math.floor(rnd() * 60), sigma = Math.max(1.5, 25 / 3 - races * 0.1), mu = 25 + normal() * 4 + Math.min(10, races * 0.08) * normal();
    const ping = Math.round(15 + Math.abs(normal()) * 50 + (rnd() < 0.08 ? 120 : 0));
    const mp = { rating: { mu, sigma, races }, cars: [{ instanceId: 'c1', carId: 'starter_car', name: 'A car', cls, pr, current: true }], blocked: [], cooldownUntil: null };
    const ticket = signTicket(SECRET, { uid: `load-${i}`, name: `Load ${i}`, role: 'player', guest: false, mp }, 600);
    const t0 = Date.now();
    const r: any = { i, cls, pr, ping, ordinal: mu - 3 * sigma, joinedAt: t0 };
    try {
      const q = await transport.join(endpoint, 'queue', { ticket, protocol: PROTOCOL, region: 'local', pings: { local: ping } });
      r.queuedMs = Date.now() - t0;
      await new Promise(res => {
        const timer = setTimeout(() => { r.timedOut = true; void q.leave(); res(); }, 240000);
        q.onJson(async m => {
          // (offered NPCs for the empty slots — the last few of a rare class, say: yes, as a player waiting would)
          if (m.t === 'npc-offer') { r.offered = true; q.sendJson({ t: 'npc', yes: true }); }
          if (m.t !== 'matched') return;
          clearTimeout(timer); r.waitMs = Date.now() - t0; r.quality = m.quality;
          try { const race = await transport.join(endpoint, 'race', { how: 'reservation', reservation: m.reservation }); r.seated = true; void q.leave(); setTimeout(() => { void race.leave(); }, 1500); }
          catch (e) { r.seatError = e.message; }
          res();
        });
      });
    } catch (e) { r.joinError = e.message; }
    out.push(r);
  };
  await Promise.all(Array.from({ length: count }, (_, k) => one(from + k)));
  process.send!({ results: out });
  setTimeout(() => process.exit(0), 3000);
} else {
  // ---------- the test ----------
  const { freshDatabase, testConfig } = await import('../test/helpers.ts');
  const { buildApp } = await import('../src/app.ts');
  const { REPO_DIR } = await import('../src/config.ts');
  const { startRt } = await import('../src/rt/server.ts');
  const { seedMpRoutes } = await import('./seed-mp-routes.ts');
  const { percentile } = await import('../../mp/match.js');
  const N = Number(arg('bots', '2000')), W = Number(arg('workers', '4')), PORT = 8793, RT_PORT = 2793;
  const MP = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/multiplayer.json'), 'utf8')), T = MP.queue.targets;
  const database = await freshDatabase('mpload');
  const app: any = await buildApp({ config: testConfig(database.url, { serveClient: false, logLevel: 'warn' }, { PUBLIC_URL: 'http://localhost:8787', RT_SECRET: SECRET }) });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  await seedMpRoutes(app.content, { regions: ['sf'] });
  const redisUrl = args.includes('--redis') ? (process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\d+$/, '') + '/14' : null;
  if (redisUrl) { const { Redis } = await import('ioredis'); const r = new Redis(redisUrl); await r.flushdb(); r.disconnect(); }
  const rt = await startRt({ port: RT_PORT, secret: SECRET, redisUrl, rt: { allowGuests: true, maxPlayers: 100000, roomMaxClients: 64, netsim: false }, api: { url: `http://localhost:${PORT}` }, quickVenue: { '*': { kind: 'route', id: 'route_mpsf' } }, log: () => {} });
  console.log(`${N} bots in ${W} worker processes → one real-time process${redisUrl ? ' (Redis)' : ', no Redis'}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB`);
  const cpu0 = process.cpuUsage(), mem: number[] = [], t0 = Date.now();
  const sampler = setInterval(() => mem.push(process.memoryUsage().rss), 1000);
  const per = Math.ceil(N / W), self = fileURLToPath(import.meta.url);
  const all = (await Promise.all(Array.from({ length: W }, (_, w) => new Promise<any[]>(res => {
    const kid = fork(self, [], { env: { ...process.env, MP_LOAD_WORKER: JSON.stringify({ from: w * per, count: Math.min(per, N - w * per), endpoint: `http://localhost:${RT_PORT}`, seed: 1000 + w }) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    kid.on('message', (m: any) => res(m.results));
    kid.on('exit', () => res([]));
  })))).flat();
  clearInterval(sampler);
  const wall = (Date.now() - t0) / 1000, cpu = process.cpuUsage(cpu0);
  const { QueueRoom } = await import('../src/rt/queue.ts');
  const made = QueueRoom.made, cycles = QueueRoom.cycles;
  const waits = all.filter(r => r.waitMs != null).map(r => r.waitMs / 1000);
  const matched = waits.length, seated = all.filter(r => r.seated).length, errors = all.filter(r => r.joinError || r.seatError || r.timedOut);
  const res = {
    bots: N, matched, seated, errors: errors.length, errorSample: errors.slice(0, 3).map(e => e.joinError ?? e.seatError ?? 'timed out'),
    waitP50: percentile(waits, 0.5), waitP95: percentile(waits, 0.95), waitMax: Math.max(...waits),
    races: made.length, humansPerRace: made.length ? made.reduce((a, m) => a + m.humans, 0) / made.length : 0, full: made.filter(m => m.humans === MP.grid.maxPlayers).length,
    skillP95: percentile(made.map(m => m.skillSpread), 0.95), prP95: percentile(made.map(m => m.performanceSpread), 0.95), pingOverP95: percentile(made.map(m => m.pingOver), 0.95),
    sameClass: made.length ? made.filter(m => m.sameClass).length / made.length : 0, npcOffers: all.filter(r => r.offered).length, npcRaces: made.filter(m => m.npcFill).length,
    cycleMsP95: percentile(cycles, 0.95), cycleMsMax: Math.max(0, ...cycles),
    rssPeakMB: Math.round(Math.max(...mem) / 2 ** 20), cpuSec: Math.round((cpu.user + cpu.system) / 1e6), wallSec: Math.round(wall),
  };
  const lines: string[] = [], results: boolean[] = [];
  const check = (name: string, ok: boolean, detail = '') => { results.push(ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`; console.log(l); lines.push(l); };
  check(`all ${N} bots queued and matched, and took their seats`, matched === N && seated === N && !errors.length, `${matched} matched, ${seated} seated, ${errors.length} errors${errors.length ? ` (${res.errorSample.join('; ')})` : ''}`);
  check(`queue time within target (p50 ≤ ${T.waitP50Sec} s, p95 ≤ ${T.waitP95Sec} s)`, res.waitP50 <= T.waitP50Sec && res.waitP95 <= T.waitP95Sec, `p50 ${res.waitP50.toFixed(1)} s, p95 ${res.waitP95.toFixed(1)} s, longest ${res.waitMax.toFixed(1)} s`);
  check(`match quality within target (skill spread p95 ≤ ${T.skillSpreadP95}, performance p95 ≤ ${T.performanceSpreadP95}, one class a race)`, res.skillP95 <= T.skillSpreadP95 && res.prP95 <= T.performanceSpreadP95 && res.sameClass >= T.sameClassShare, `skill ${res.skillP95.toFixed(1)}, performance ${res.prP95.toFixed(0)}, ping over best ${res.pingOverP95} ms, one class ${(res.sameClass * 100).toFixed(0)}%`);
  check('races made', res.races > 0, `${res.races} races, ${res.humansPerRace.toFixed(1)} players a race (${res.full} full grids); ${res.npcOffers} offered NPCs, ${res.npcRaces} races with NPC fill`);
  check('the server keeps up: the matchmaker\'s cycle well inside its interval', res.cycleMsP95 < MP.queue.cycleMs / 2, `p95 ${res.cycleMsP95.toFixed(1)} ms, at worst ${res.cycleMsMax.toFixed(1)} ms (every ${MP.queue.cycleMs} ms)`);
  lines.push('', `The server's process (the API and the real-time server together): peak memory ${res.rssPeakMB} MB, ${res.cpuSec} s of CPU in ${res.wallSec} s.`);
  const failed = results.filter(r => !r).length, summary = `${results.length - failed} of ${results.length} ok`;
  fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(REPO_DIR, 'reports/mp-matchmaking-load.md'), `# Matchmaking load test\n\n${new Date().toISOString()}. ${N} bots, one real-time process${redisUrl ? ' with Redis' : ', no Redis'}; this computer: ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB. ${summary}.\n\n${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(REPO_DIR, 'reports/mp-matchmaking-load.json'), JSON.stringify(res, null, 2));
  console.log(`\n${summary}`);
  await rt.stop(); await app.close(); await database.drop();
  process.exit(failed ? 1 : 0);
}
