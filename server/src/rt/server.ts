// The real-time server (Phase 7 Step 1; docs/MULTIPLAYER.md): Colyseus over WebSockets, its rooms' presence and the
// list of rooms in Redis, so rooms can run in several processes (and later several machines) and a player joining
// through any of them is sent to the one with their room. Its own process and address (rt.<domain>), apart from the
// API; it has no database — players arrive with a join ticket the API signed (tickets.ts).
// Redis is optional (Phase 7 Step 2): without redisUrl everything runs in this one process, its presence and list of
// rooms in memory — lobbies, the matchmaking queue, parties, friends' status and invites all work the same.
//
//   const rt = await startRt({ port, publicAddress, redisUrl?, secret, rt: config.rt, api, log, version })
//   rt.port · rt.rooms() → the rooms in this process (races() and queues(): the race and queue rooms) · rt.stop()
//   rt.health() → GET /health's answer · rt.busy() · await rt.drain(maxSec) (Phase 7 Step 5: stopping for an update)
// GET /health (beside Colyseus's matchmaking routes — what Docker's healthcheck, the deploy's wait and the uptime monitor
// read: keyword "ok":true) → { ok, version, process, uptimeSec, rooms, players, races (under way), draining }

import { Server, matchMaker, LocalPresence, LocalDriver, createRouter, createEndpoint } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { RedisPresence } from '@colyseus/redis-presence';
import { RedisDriver } from '@colyseus/redis-driver';
import { NET } from '../../../net/settings.js';
import { CODES } from '../../../net/protocol.js';
import { TestRoom, setRtEnv, resetKicks, drain } from './room.ts';
import { pending } from './outbox.ts';
import { RaceRoom } from './race.ts';
import { QueueRoom } from './queue.ts';
import { HubRoom } from './hub.ts';
import { RoamRoom, subscribeRoamGhosts, resetRoamGhosts, roamCounters } from './roam.ts';
import { createRtApi } from './mp.ts';

export type RtOptions = {
  port: number; host?: string; publicAddress?: string; redisUrl?: string | null; secret: string;
  rt: { allowGuests: boolean; maxPlayers: number; roomMaxClients: number; netsim: boolean };
  // (Phase 7 Step 2: the API's address for the races' internal calls — venues, results, friends; none: free roam only)
  api?: { url: string } | null;
  // (the tests: quick races in a region on this venue, not a random one — { region | '*': venue })
  quickVenue?: Record<string, any>;
  log?: (msg: string, extra?: object) => void;
  version?: string;          // (GIT_COMMIT: /health says it)
};

export async function startRt(o: RtOptions) {
  resetKicks(); resetRoamGhosts();                // (a new server, a new presence: subscribed afresh)
  drain.on = false; drain.since = 0;
  const started = Date.now();
  setRtEnv({ secret: o.secret, allowGuests: o.rt.allowGuests, maxPlayers: o.rt.maxPlayers, roomMaxClients: o.rt.roomMaxClients, netsim: o.rt.netsim, log: o.log ?? (() => {}), api: o.api ? createRtApi({ url: o.api.url, secret: o.secret }) : null, quickVenue: o.quickVenue ?? null });
  const server = new Server({
    // (dead connections: a WebSocket ping every 3 s, closed after 2 unanswered — a dropped player then gets
    // NET.reconnectSec to come back)
    transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 2, maxPayload: 64 * 1024 }),
    presence: o.redisUrl ? new RedisPresence(o.redisUrl) : new LocalPresence(),
    driver: o.redisUrl ? new RedisDriver(o.redisUrl) : new LocalDriver(),
    publicAddress: o.publicAddress ?? `localhost:${o.port}`,
    greet: false,
    gracefullyShutdown: false,
  });
  server.define('test', TestRoom).filterBy(['world']);
  // (Phase 7 Step 2: lobbies and races, the quick-race queue per region, the hub — friends, invites, parties)
  server.define('race', RaceRoom);
  server.define('queue', QueueRoom).filterBy(['region']);
  server.define('hub', HubRoom);
  // (Phase 7 Step 4: free roam — a room per instance of a zone of a region; docs/FREE_ROAM.md)
  server.define('roam', RoamRoom).filterBy(['region', 'zone', 'group']);
  const running = () => [...RaceRoom.races].filter(r => ['loading', 'countdown', 'racing'].includes(r.race?.phase)).length;
  const health = () => ({ ok: true, version: o.version ?? 'dev', process: matchMaker.processId, uptimeSec: Math.round((Date.now() - started) / 1000),
    rooms: matchMaker.stats.local.roomCount, players: matchMaker.stats.local.ccu, races: running(), draining: drain.on });
  server.router = createRouter({ health: createEndpoint('/health', { method: 'GET' }, async () => Response.json(health(), { headers: { 'cache-control': 'no-store' } })) });
  await server.listen(o.port, o.host ?? '0.0.0.0');
  subscribeRoamGhosts();
  // (the zones' numbers to the API every few seconds: the admin page's live dashboard)
  const api = o.api ? createRtApi({ url: o.api.url, secret: o.secret }) : null;
  const statsTimer = api ? setInterval(() => { void api.roamStats(roamStats(matchMaker.processId)).catch(() => {}); }, 5000) : null;
  statsTimer?.unref();
  o.log?.('rt listening', { port: o.port, process: matchMaker.processId, tickHz: NET.tickHz, redis: !!o.redisUrl, version: o.version ?? 'dev' });
  // (what an update waits for: a race under way or its runs coming in, a free-roam challenge, results still to reach the API)
  const challenges = () => [...RoamRoom.live].reduce((a, r) => a + r.runs.size, 0);
  const busy = () => [...RaceRoom.races].some(r => r.busy()) || challenges() > 0 || pending() > 0;
  return {
    port: o.port,
    processId: matchMaker.processId,
    // (the rooms running here: their metrics, for tests and the logs)
    rooms: () => [...TestRoom.live],
    races: () => [...RaceRoom.races],
    queues: () => [...QueueRoom.queues],
    roams: () => [...RoamRoom.live],
    roamStats: () => roamStats(matchMaker.processId),
    health, busy,
    // stopping for an update: no new joins, lobbies, races or challenges (CODES.CLOSED, DRAINING); the queue closed (its
    // players told why), lobbies and free roam told; then wait — at most maxSec — for what's under way and the results
    // still to reach the API. → whether it all finished
    async drain(maxSec: number) {
      if (!drain.on) {
        drain.on = true; drain.since = Date.now();
        o.log?.('rt draining', { races: running(), challenges: challenges(), results: pending(), maxSec });
        for (const q of QueueRoom.queues) { try { void q.disconnect(CODES.CLOSED).catch(() => {}); } catch { /* still being made */ } }
        for (const r of RaceRoom.races) r.draining();
        for (const r of RoamRoom.live) r.draining();
      }
      let said = Date.now();
      while (busy() && Date.now() < drain.since + maxSec * 1000) {
        if (Date.now() - said >= 30000) { said = Date.now(); o.log?.('rt still draining', { races: running(), challenges: challenges(), results: pending(), sec: Math.round((Date.now() - drain.since) / 1000) }); }
        await new Promise(r => setTimeout(r, 500));
      }
      return !busy();
    },
    async stop() { drain.on = true; if (statsTimer) clearInterval(statsTimer); await server.gracefullyShutdown(false).catch(() => {}); },
  };
}

// this process's free-roam numbers: each zone instance's players, tick and bytes, handoffs and the rest so far, memory and CPU
let cpuAt = process.cpuUsage(), cpuT = performance.now();
export function roamStats(processId: string) {
  const c = process.cpuUsage(cpuAt), t = performance.now(), cpu = (c.user + c.system) / 1000 / Math.max(1, t - cpuT);
  cpuAt = process.cpuUsage(); cpuT = t;
  return { process: processId, at: Date.now(), rooms: [...RoamRoom.live].map(r => r.summaryRoam()), counters: { ...roamCounters }, cpu: +cpu.toFixed(3), rssMB: Math.round(process.memoryUsage().rss / 1048576) };
}
