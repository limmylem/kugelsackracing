// The real-time server's process (Phase 7 Step 1; docs/MULTIPLAYER.md):
//   npm run rt -w @kr/server                 one process on RT_PORT (2567)
//   npm run rt -w @kr/server -- --processes 3   three, on RT_PORT, RT_PORT+1, RT_PORT+2 (rooms spread across them
//                                             through Redis; a player can join through any of them)
// Settings: REDIS_URL (optional: without it, one process with everything in memory; several processes need it), RT_SECRET (in development made from BETTER_AUTH_SECRET, like the API),
// RT_PORT, RT_HOST, RT_PUBLIC_ADDRESS (how browsers reach this process: host:port), APP_ENV (server/config/<env>.json "rt"),
// API_INTERNAL_URL (Phase 7 Step 2: the API, for lobbies and races — default http://localhost:8787), RT_MAX_PLAYERS (the
// config's rt.maxPlayers: connections across every process before "server full" — a free-roam player holds 1–4).
// (Phase 7 Step 5) GIT_COMMIT (GET /health says it), SENTRY_DSN (crashes and nothing personal: ../sentry.ts), RT_DRAIN_SEC
// (default 600). SIGTERM — a deploy — drains: nobody new joins, races under way finish (up to RT_DRAIN_SEC) and their
// results reach the API, then it stops; with nothing under way that's at once (Ctrl-C). A second SIGTERM or SIGINT stops it
// there and then. A crash: one JSON line, to Sentry, and out with 1 — Docker starts it again.

import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SERVER_DIR, rtSecretOf } from '../config.ts';
import { startSentry, exitOnCrash, flushSentry } from '../sentry.ts';
import { startRt } from './server.ts';

const env = process.env.APP_ENV ?? 'development';
const file = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'config', `${env}.json`), 'utf8'));
const port = Number(process.env.RT_PORT ?? 2567), host = process.env.RT_HOST ?? '0.0.0.0';
const i = process.argv.indexOf('--processes'), n = i > 0 ? Math.max(1, Number(process.argv[i + 1]) || 1) : 1;
const drainSec = Math.max(0, Number(process.env.RT_DRAIN_SEC ?? 600) || 0);

if (n > 1 && !process.env.REDIS_URL) throw new Error('--processes needs REDIS_URL (the processes share their rooms through Redis); without it, run one process');
if (n > 1 && !process.env.RT_CHILD) {
  const kids = Array.from({ length: n }, (_, k) => fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, RT_CHILD: '1', RT_PORT: String(port + k), RT_PUBLIC_ADDRESS: process.env.RT_PUBLIC_ADDRESS_PATTERN?.replace('{port}', String(port + k)) ?? `localhost:${port + k}` } }));
  // (stopping this stops them all — each drains, and this waits for them; again: at once. One that dies takes the rest
  // down, for the host to restart cleanly)
  let stopping = 0;
  const stop = () => {
    if (stopping++) { for (const c of kids) c.kill('SIGKILL'); process.exit(0); }
    for (const c of kids) c.kill('SIGTERM');
    setTimeout(() => process.exit(0), (drainSec + 30) * 1000).unref();
  };
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, stop);
  for (const c of kids) c.on('exit', code => {
    if (code && !stopping) { console.error(`a real-time server process stopped (${code})`); stop(); }
    if (kids.every(k => k.exitCode !== null || k.signalCode !== null)) process.exit(0);
  });
} else {
  // (a child process: it goes when its parent does)
  if (process.env.RT_CHILD) process.on('disconnect', () => process.exit(0));
  const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), msg, ...extra }));
  exitOnCrash('the real-time server', startSentry({ dsn: process.env.SENTRY_DSN, env, release: process.env.GIT_COMMIT ?? null }));
  if ((env === 'staging' || env === 'production') && !process.env.RT_SECRET) throw new Error('RT_SECRET is needed in staging and production');
  const secret = rtSecretOf(process.env.RT_SECRET, process.env.BETTER_AUTH_SECRET ?? 'local-development-only-secret-change-me-0123');
  const rt = await startRt({ port, host, publicAddress: process.env.RT_PUBLIC_ADDRESS ?? `localhost:${port}`, redisUrl: process.env.REDIS_URL || null, secret, rt: { ...file.rt, ...(process.env.RT_MAX_PLAYERS ? { maxPlayers: Number(process.env.RT_MAX_PLAYERS) } : {}) }, api: { url: process.env.API_INTERNAL_URL ?? 'http://localhost:8787' }, log, version: process.env.GIT_COMMIT ?? 'dev' });
  setInterval(() => { for (const r of rt.rooms()) { const m = r.metrics(); log('rt room', { room: r.roomId, world: r.world, players: m.players, tickMsP95: +m.tickMsP95.toFixed(2) }); } }, 60000).unref();
  let signals = 0;
  const stop = async (sig: string) => {
    if (signals++) { log('rt stopping now', { sig }); process.exit(0); }
    if (rt.busy()) log('rt waiting for what\'s under way (the same again stops it now)', { sig, maxSec: drainSec });
    const finished = await rt.drain(drainSec);
    log('rt stopping', { sig, finished });
    setTimeout(() => process.exit(0), 10000).unref();
    await rt.stop(); await flushSentry();
    process.exit(0);
  };
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { void stop(s); });
}
