// The real-time server's process (Phase 7 Step 1; docs/MULTIPLAYER.md):
//   npm run rt -w @kr/server                 one process on RT_PORT (2567)
//   npm run rt -w @kr/server -- --processes 3   three, on RT_PORT, RT_PORT+1, RT_PORT+2 (rooms spread across them
//                                             through Redis; a player can join through any of them)
// Settings: REDIS_URL (optional: without it, one process with everything in memory; several processes need it), RT_SECRET (in development made from BETTER_AUTH_SECRET, like the API),
// RT_PORT, RT_HOST, RT_PUBLIC_ADDRESS (how browsers reach this process: host:port), APP_ENV (server/config/<env>.json "rt"),
// API_INTERNAL_URL (Phase 7 Step 2: the API, for lobbies and races — default http://localhost:8787).

import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SERVER_DIR, rtSecretOf } from '../config.ts';
import { startRt } from './server.ts';

const env = process.env.APP_ENV ?? 'development';
const file = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'config', `${env}.json`), 'utf8'));
const port = Number(process.env.RT_PORT ?? 2567), host = process.env.RT_HOST ?? '0.0.0.0';
const i = process.argv.indexOf('--processes'), n = i > 0 ? Math.max(1, Number(process.argv[i + 1]) || 1) : 1;

if (n > 1 && !process.env.REDIS_URL) throw new Error('--processes needs REDIS_URL (the processes share their rooms through Redis); without it, run one process');
if (n > 1 && !process.env.RT_CHILD) {
  const kids = Array.from({ length: n }, (_, k) => fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, RT_CHILD: '1', RT_PORT: String(port + k), RT_PUBLIC_ADDRESS: process.env.RT_PUBLIC_ADDRESS_PATTERN?.replace('{port}', String(port + k)) ?? `localhost:${port + k}` } }));
  // (stopping this stops them all; one that dies takes the rest down, for the host to restart cleanly)
  const stop = () => { for (const c of kids) c.kill('SIGTERM'); setTimeout(() => process.exit(0), 3000).unref(); };
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, stop);
  for (const c of kids) c.on('exit', code => { if (code) { console.error(`a real-time server process stopped (${code})`); stop(); } });
} else {
  // (a child process: it goes when its parent does)
  if (process.env.RT_CHILD) process.on('disconnect', () => process.exit(0));
  if ((env === 'staging' || env === 'production') && !process.env.RT_SECRET) throw new Error('RT_SECRET is needed in staging and production');
  const secret = rtSecretOf(process.env.RT_SECRET, process.env.BETTER_AUTH_SECRET ?? 'local-development-only-secret-change-me-0123');
  const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...extra }));
  const rt = await startRt({ port, host, publicAddress: process.env.RT_PUBLIC_ADDRESS ?? `localhost:${port}`, redisUrl: process.env.REDIS_URL || null, secret, rt: file.rt, api: { url: process.env.API_INTERNAL_URL ?? 'http://localhost:8787' }, log });
  setInterval(() => { for (const r of rt.rooms()) { const m = r.metrics(); log('rt room', { room: r.roomId, world: r.world, players: m.players, tickMsP95: +m.tickMsP95.toFixed(2) }); } }, 60000).unref();
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { void rt.stop().then(() => process.exit(0)); });
}
