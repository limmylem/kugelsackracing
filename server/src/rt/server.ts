// The real-time server (Phase 7 Step 1; docs/MULTIPLAYER.md): Colyseus over WebSockets, its rooms' presence and the
// list of rooms in Redis, so rooms can run in several processes (and later several machines) and a player joining
// through any of them is sent to the one with their room. Its own process and address (rt.<domain>), apart from the
// API; it has no database — players arrive with a join ticket the API signed (tickets.ts).
// Redis is optional (Phase 7 Step 2): without redisUrl everything runs in this one process, its presence and list of
// rooms in memory — lobbies, the matchmaking queue, parties, friends' status and invites all work the same.
//
//   const rt = await startRt({ port, publicAddress, redisUrl?, secret, rt: config.rt, api, log })
//   rt.port · rt.rooms() → the rooms in this process · rt.stop()

import { Server, matchMaker, LocalPresence, LocalDriver } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { RedisPresence } from '@colyseus/redis-presence';
import { RedisDriver } from '@colyseus/redis-driver';
import { NET } from '../../../net/settings.js';
import { TestRoom, setRtEnv } from './room.ts';

export type RtOptions = {
  port: number; host?: string; publicAddress?: string; redisUrl?: string | null; secret: string;
  rt: { allowGuests: boolean; maxPlayers: number; roomMaxClients: number; netsim: boolean };
  log?: (msg: string, extra?: object) => void;
};

export async function startRt(o: RtOptions) {
  setRtEnv({ secret: o.secret, allowGuests: o.rt.allowGuests, maxPlayers: o.rt.maxPlayers, roomMaxClients: o.rt.roomMaxClients, netsim: o.rt.netsim, log: o.log ?? (() => {}) });
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
  await server.listen(o.port, o.host ?? '0.0.0.0');
  o.log?.('rt listening', { port: o.port, process: matchMaker.processId, tickHz: NET.tickHz, redis: !!o.redisUrl });
  return {
    port: o.port,
    processId: matchMaker.processId,
    // (the rooms running here: their metrics, for tests and the logs)
    rooms: () => [...TestRoom.live],
    async stop() { await server.gracefullyShutdown(false).catch(() => {}); },
  };
}
