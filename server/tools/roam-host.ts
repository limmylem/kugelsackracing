// @ts-nocheck — (the bots are the game's own client code: not this program's)
// Free roam for a benchmark (Phase 8 Step 2; docs/PERFORMANCE.md — tools/bench.mjs's `roam` scene): the API serving
// the game, a real-time server with free roam, and other players — headless ones (mp/roamBot.js: the game's own network
// code, a scripted car) driving road loops round a point. The browser that's measured joins as one more player
// (?mp&player=…, a development player).
//
//   const H = await startRoamHost({ region: 'sf' })     (needs PostgreSQL with PostGIS: TEST_DATABASE_URL)
//   H.base                        the game's address (the API serves it)
//   await H.addBots(n, [x, z], radiusM)   n players driving the roads within radiusM of (x, z) (the region's map frame)
//   H.bots.length · await H.stop()

import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { startRt } from '../src/rt/server.ts';
import { ROAM } from '../src/rt/mpData.ts';
import { networkOf } from '../src/rt/roam.ts';
import { transport } from './rt-bots.ts';
import { createRoamBot } from '../../mp/roamBot.js';
import { sprintRoute } from '../../mp/challenge.js';

export async function startRoamHost({ region = 'sf', port = 8795, rtPort = 2795 } = {}) {
  const SECRET = 'roam-bench-secret-roam-bench-secret-0123456789', BASE = `http://localhost:${port}`;
  const rt = await startRt({ port: rtPort, secret: SECRET, redisUrl: null, rt: { allowGuests: true, maxPlayers: 500, roomMaxClients: 64, netsim: false }, api: { url: BASE }, log: process.env.ROAM_HOST_DEBUG ? (m: string, e: any) => console.log('rt:', m, JSON.stringify(e)) : undefined });
  const database = await freshDatabase('roambench');
  const app: any = await buildApp({ config: testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, RT_URL: `ws://localhost:${rtPort}`, RT_SECRET: SECRET }) });
  await app.listen({ port, host: '127.0.0.1' });
  const N = networkOf(region);
  const ticketOf = (letter: string) => async () => {
    const r = await fetch(`${BASE}/api/v1/rt/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ player: letter }) });
    const j: any = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? r.status);
    return { ticket: j.ticket, url: `http://localhost:${rtPort}` };
  };
  // a road from near (x, z), there and back (closed), 300–900 m long
  function roadLoop(x: number, z: number, seed: number) {
    let k = seed; const rng = () => (k = (k * 16807) % 2147483647) / 2147483647;
    const at = N.nearest(x, z, undefined, 400);
    const r = sprintRoute(N, [at.x, at.z], { ...ROAM, challenges: { ...ROAM.challenges, routeM: { min: 300, max: 900 } } }, { rng });
    if (!r.ok) return [[at.x, at.h ?? 0, at.z], [at.x + 120, at.h ?? 0, at.z]];
    const pts = r.line.map((p: any) => [p.x, p.h ?? 0, p.z]);
    return [...pts, ...[...pts].reverse().slice(1, -1)];
  }
  const bots: any[] = [];
  let loop: NodeJS.Timeout | null = null, made = 0;
  const H = {
    base: BASE, bots,
    // the zones' instances now: [{ zone, group, players }]
    rooms: () => rt.roams().map((r: any) => ({ zone: r.zone, group: r.group, players: r.players?.size, clients: r.clients?.length, roam: r.roam?.size })),
    async addBots(n: number, [x, z]: [number, number], radiusM = 350) {
      if (!N) throw new Error(`no road graph for ${region}`);
      const starting = [];
      for (let i = 0; i < n; i++) {
        const k = ++made, letter = `Bot${k}`, a = k * 2.399963, d = radiusM * Math.sqrt((k % 10 + 0.5) / 10);
        await app.mp.devPlayer(letter);
        const b: any = createRoamBot({ transport, getTicket: ticketOf(letter), region, cfg: ROAM, points: roadLoop(x + Math.cos(a) * d, z + Math.sin(a) * d, k * 7919 + 13), drive: { topSpeed: 10 + (k * 37 % 15), accel: 4, startAt: (k * 131) % 400 }, look: { carId: 'starter_car', paint: { colour: `hsl(${k * 47 % 360} 70% 50%)` }, parts: {}, bot: true }, endpoint: `http://localhost:${rtPort}`, settings: { location: 'everyone' }, log: process.env.ROAM_HOST_DEBUG ? (k: string, v: any) => console.log(letter, k, JSON.stringify(v)?.slice(0, 200)) : undefined });
        starting.push(b.start().then(() => bots.push(b)));
        // (a few at a time: the hub places each)
        if (starting.length === 5) await Promise.all(starting.splice(0));
      }
      await Promise.all(starting);
      if (!loop) {
        let last = performance.now();
        loop = setInterval(() => { const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t; for (const b of bots) { try { b.step(dt, t); } catch { /* the next frame */ } } }, 1000 / 60);
      }
      return bots.length;
    },
    async stop() {
      if (loop) clearInterval(loop);
      for (const b of bots) await b.leave().catch(() => {});
      await app.close(); await database.drop(); await rt.stop();
    },
  };
  return H;
}
