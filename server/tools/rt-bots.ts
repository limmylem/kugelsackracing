// Bot clients (Phase 7 Step 1; docs/MULTIPLAYER.md "Bots"): headless players that join a room through the real
// protocol and drive a real route on their own (net/bot.js), so a room can be filled for testing without people.
// Each also watches the others the way the game does (net/remote.js) and measures how smoothly they move
// (net/measure.js) — what the multiplayer tests check.
//
// From the command line, against a real-time server already running (npm run rt -w @kr/server):
//   node server/tools/rt-bots.ts [--n 8] [--world mk] [--route mk] [--seconds 120] [--endpoint http://localhost:2567]
//        [--netsim 150,30,0.05] [--server-netsim 150,30,0.05]
// (they sign their own join tickets with the development secret: development only)
//
// As a library: runBots({ endpoint, ticket, n, route, seconds, netsim, serverNetsim, … }) → per bot what it saw.

import { createNetClient } from '../../net/client.js';
import { createColyseusTransport } from '../../net/transport.js';
import { createRouteDriver, testLoop } from '../../net/bot.js';
import { createSmoothness } from '../../net/measure.js';
import { parseConditions } from '../../net/netsim.js';
import { NET } from '../../net/settings.js';
// (the SDK on the ws package, not Node's own WebSocket: Node 22's never closes after a failed connection — no close event,
// stuck connecting — so a bot's reconnecting stopped at its first try when the server had gone (a crash: rt-crash-test.ts);
// ws closes as browsers do. The SDK picks its WebSocket when it's loaded)
const nodeWebSocket = (globalThis as any).WebSocket;
delete (globalThis as any).WebSocket;
const Colyseus = await import('@colyseus/sdk');
(globalThis as any).WebSocket = nodeWebSocket;

export const transport = createColyseusTransport(Colyseus);

// A real route's line, in the world frame ([x, y, z]): one of the baked regions' test routes (tests/map/realRoutes.ts)
export async function realRoute(region = 'mk') {
  // (the map's own TypeScript, loaded at run time: it isn't part of the server's typecheck)
  const harness = '../../tests/map/harness.ts';
  const { mapHarness } = await import(harness);
  const { createNetwork } = await import('../../route/network.js');
  const { compileRoute, newRoute } = await import('../../route/model.js');
  const { REAL_ROUTES } = await import('../../tests/map/realRoutes.ts');
  const R = REAL_ROUTES[region], M = await mapHarness(region), N = createNetwork(M.graph(), { P: M.P, region, version: M.manifest.version } as any);
  const c = compileRoute(N, { ...newRoute(region, R.kind), waypoints: R.waypoints.map(([lat, lon]: number[]) => ({ lat, lon })) });
  return { region, loop: !!c.loop, length: c.length, points: c.line.map((p: any) => [p.x, p.h, p.z]) as number[][] };
}

export type BotOptions = {
  endpoint: string; ticket: (i: number) => Promise<{ ticket: string; url: string }> | { ticket: string; url: string };
  n: number; seconds: number; route?: { points: number[][]; loop: boolean }; world?: string;
  netsim?: any; serverNetsim?: string | null; spacing?: number; fps?: number; settings?: typeof NET;
  look?: (i: number) => any; onFrame?: (t: number, bots: Bot[]) => void; measure?: boolean; warmupMs?: number;
};
export type Bot = { i: number; client: ReturnType<typeof createNetClient>; driver: ReturnType<typeof createRouteDriver>; truth: [number, number[]][]; seen: Map<number, ReturnType<typeof createSmoothness>>; firstSeen: Map<number, number>; moved: Map<number, number> };

export async function runBots(o: BotOptions) {
  const route = o.route ?? { points: testLoop(), loop: true }, fps = o.fps ?? 60, S = o.settings ?? NET;
  const bots: Bot[] = [];
  for (let i = 0; i < o.n; i++) {
    const client = createNetClient({ transport, endpoint: o.endpoint as any, getTicket: async () => o.ticket(i), world: o.world ?? 'bots', look: o.look?.(i) ?? { carId: 'starter_car', paint: { colour: `hsl(${i * 47 % 360} 70% 50%)` }, bot: true }, netsim: (o.netsim ?? null) as any, serverNetsim: (o.serverNetsim ?? null) as any, settings: S });
    // (spread out along the line, alternately left and right of it)
    const driver = createRouteDriver(route.points, { closed: route.loop, startAt: i * (o.spacing ?? 40), offset: (i % 2 ? 1 : -1) * 1.6, topSpeed: 30 + (i % 4) * 3 });
    bots.push({ i, client, driver, truth: [], seen: new Map(), firstSeen: new Map(), moved: new Map() });
  }
  await Promise.all(bots.map(b => b.client.connect()));
  const byNetId = () => new Map(bots.map(b => [b.client.id, b]));
  const ids = byNetId();
  const truthAt = (b: Bot, t: number) => {
    const T = b.truth; let lo = 0, hi = T.length - 1;
    if (hi < 1 || t < T[0][0] || t > T[hi][0]) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m][0] <= t) lo = m; else hi = m; }
    const [ta, a] = T[lo], [tb, c] = T[hi], u = (t - ta) / ((tb - ta) || 1);
    return [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u];
  };
  const t0 = performance.now(), frameMs = 1000 / fps;
  let last = t0, next = t0;
  while (performance.now() - t0 < o.seconds * 1000) {
    next += frameMs;
    await new Promise(r => setTimeout(r, Math.max(0, next - performance.now())));
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    for (const b of bots) {
      // the car: two physics steps a frame at 60 fps (120 Hz), the newest state sent
      let s: any = null; const steps = Math.max(1, Math.round(dt * 120));
      for (let k = 0; k < steps; k++) s = b.driver.step(dt / steps);
      // (stamped with the moment its position is for, as the game does: a state stamped late, by however long the
      // event loop took to get to sending it, doesn't match its position)
      // (its position is for the frame's start — `now` — however long the bots before it took this frame)
      const rt = b.client.roomNow() - (performance.now() - now);
      b.client.update(dt, () => ({ ...s, ageMs: performance.now() - now }));
      b.truth.push([rt, s.pos]); if (b.truth.length > 2000) b.truth.splice(0, 500);
      if (o.measure === false) { b.client.sample(dt); continue; }
      for (const c of b.client.sample(dt)) {
        const other = ids.get(c.id);
        if (!other || !c.pose) continue;
        if (!b.firstSeen.has(c.id)) b.firstSeen.set(c.id, now - t0);
        let m = b.seen.get(c.id); if (!m) b.seen.set(c.id, m = createSmoothness({ snapCm: S.interp.snapCm }));
        // (how far from its true path: measured once the buffer has settled, after the first few seconds)
        m.frame(c.pose, dt, (now - t0 > (o.warmupMs ?? 5000) ? (at: number) => truthAt(other, at) : null) as any);
        b.moved.set(c.id, (b.moved.get(c.id) ?? 0) + Math.hypot(...c.pose.vel) * dt);
      }
    }
    o.onFrame?.(now - t0, bots);
  }
  return {
    bots,
    async leave() { await Promise.all(bots.map(b => b.client.leave())); },
    results() {
      return bots.map(b => ({ i: b.i, id: b.client.id, stats: b.client.stats, saw: [...b.seen.entries()].map(([id, m]) => ({ id, ...m.result(), movedM: Math.round(b.moved.get(id) ?? 0), firstSeenMs: Math.round(b.firstSeen.get(id) ?? -1) })) }));
    },
  };
}

// ---------- from the command line ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const { signTicket } = await import('../src/rt/tickets.ts');
  const { rtSecretOf } = await import('../src/config.ts');
  const secret = rtSecretOf(process.env.RT_SECRET, process.env.BETTER_AUTH_SECRET ?? 'local-development-only-secret-change-me-0123');
  const n = Number(arg('n', '8')), seconds = Number(arg('seconds', '120')), region = arg('route', 'mk');
  const route = region === 'loop' ? { points: testLoop(), loop: true } : await realRoute(region);
  console.log(`${n} bots on the ${region} route (${route.points.length} points), ${seconds} s, into world "${arg('world', region)}"`);
  const run = await runBots({
    endpoint: arg('endpoint', 'http://localhost:2567'), n, seconds, route, world: arg('world', region),
    ticket: i => ({ ticket: signTicket(secret, { uid: `bot-${i}`, name: `Bot ${i + 1}`, role: 'player', guest: false }, 60), url: '' }),
    netsim: parseConditions(arg('netsim', '')) as any, serverNetsim: (arg('server-netsim', '') || null) as any,
    onFrame: (t, bots) => { if (Math.floor(t / 5000) !== Math.floor((t - 17) / 5000)) { const s = bots[0].client.stats; console.log(`${(t / 1000).toFixed(0)} s: bot 1 sees ${bots[0].seen.size} cars · ping ${s.ping.toFixed(0)} ms · up ${s.upKBs.toFixed(2)} kB/s · down ${s.downKBs.toFixed(2)} kB/s · buffer ${s.bufferMs.toFixed(0)} ms`); } },
  });
  for (const r of run.results()) console.log(`bot ${r.i + 1}: ${r.saw.map(s => `#${s.id} ${s.snaps} snaps, ${s.movedM} m`).join(' · ')}`);
  await run.leave();
  process.exit(0);
}
