// The real-time server's stand-in (docs/DEPLOYMENT.md): one WebSocket endpoint that answers a ping with a pong,
// so a deploy can show that WebSockets reach the server through Cloudflare and the host — and how long a round
// trip takes. Nothing else: Phase 7 Step 1's multiplayer server replaces this whole file (and rt.<domain> moves
// to it). Kept apart from the API on purpose.
//
//   wss://rt.<domain>/rt/health      send {"type":"ping","t":<any number>} → {"type":"pong","t":<the same>,"at":<server ms>}
//                                    (or the text "ping" → "pong"); a connection lasts at most 2 minutes
//   a browser may connect only from our own addresses (Origin checked); tools without an Origin may too

import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

const MAX_SECONDS = 120, MAX_MESSAGES = 200, PER_ADDRESS = 4;

export async function rtHealth(app: FastifyInstance, { origins }: { origins: string[] }) {
  await app.register(websocket, { options: { maxPayload: 1024 } });
  const open = new Map<string, number>();
  app.get('/rt/health', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) { socket.close(1008, 'not from our game'); return; }
    const ip = req.ip, n = (open.get(ip) ?? 0) + 1;
    if (n > PER_ADDRESS) { socket.close(1013, 'too many connections'); return; }
    open.set(ip, n);
    let count = 0;
    const timer = setTimeout(() => socket.close(1000, 'time is up'), MAX_SECONDS * 1000);
    socket.on('message', (data: Buffer, binary: boolean) => {
      if (binary || ++count > MAX_MESSAGES) { socket.close(1008, binary ? 'text only' : 'enough pings'); return; }
      const text = data.toString('utf8');
      if (text === 'ping') { socket.send('pong'); return; }
      let m: any = null;
      try { m = JSON.parse(text); } catch { /* not JSON */ }
      if (m?.type === 'ping') socket.send(JSON.stringify({ type: 'pong', t: typeof m.t === 'number' ? m.t : null, at: Date.now() }));
      else socket.close(1003, 'ping only');
    });
    socket.on('close', () => { clearTimeout(timer); const k = (open.get(ip) ?? 1) - 1; if (k > 0) open.set(ip, k); else open.delete(ip); });
  });
}
