// The server's settings: what isn't secret from config/<environment>.json, every secret from the environment
// (never in code, never sent to the client). Checked with Zod on start: a missing or malformed setting stops
// the server with a plain message, rather than failing later.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { z } from 'zod';

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = path.resolve(SERVER_DIR, '..');

const Limit = z.object({ max: z.number().int().positive(), windowSec: z.number().int().positive() });
const FileConfig = z.object({
  minAge: z.number().int().min(0).max(21),
  termsVersion: z.string().min(1),
  privacyVersion: z.string().min(1),
  requireEmailVerification: z.boolean(),
  // the game's files: all of them (one address for everything: development, tests), 'tools' (the API's own
  // address in staging and production: only the admin and editor pages and the modules they load, each
  // page for its role — the game itself is on GAME_URL), or none
  serveClient: z.union([z.boolean(), z.literal('tools')]),
  cookieSecure: z.boolean(),
  rateLimits: z.object({ global: Limit, auth: Limit, signUp: Limit, write: Limit }),
  cache: z.object({ publishedSeconds: z.number().int().min(0), cdnSeconds: z.number().int().min(0), serverMB: z.number().min(0).max(1024) }),
  replays: z.object({ keepPerPlayer: z.number().int().min(1) }),
  tracks: z.object({ precompute: z.boolean(), graceMinutes: z.number().min(0).max(120), workerTimeoutSec: z.number().min(5).max(600) }),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  // (Phase 6 Step 5) editors and admins: their tools need a session that passed two-factor sign-in, at most this
  // many hours ago (then the authenticator's code again: the admin page asks)
  staffMfa: z.object({ required: z.boolean(), maxAgeHours: z.number().min(0.1).max(720) }),
  // the bot check (Cloudflare Turnstile) on signing up, signing in and becoming a guest: required → the server won't
  // start without its keys (production); otherwise on when the keys are set
  botCheck: z.object({ required: z.boolean() }),
  // the abuse scan's thresholds (abuse/detect.ts) and how long what links accounts is kept
  abuse: z.object({ maxRewardPerHour: z.number().positive(), burstAccounts: z.number().int().min(2), farmGroup: z.number().int().min(2), keepDays: z.number().int().min(1).max(365) }),
  // signing up needs an invite code, until an admin turns it off (the admin page's Launch settings)
  closedBeta: z.boolean(),
  // the alerts' thresholds (ops/alerts.ts, docs/OPERATIONS.md)
  alerts: z.object({ errorRate: z.number().min(0).max(1), minRequests: z.number().int().min(1), slowP95Ms: z.number().positive(), dbSlowMs: z.number().positive(), queueWaiting: z.number().int().min(1),
    queueOldestSec: z.number().positive(), moneyPerHour: z.number().positive(), moneySpike: z.number().min(1), repeatMinutes: z.number().min(1) }),
  // multiplayer (Phase 7 Step 1; docs/MULTIPLAYER.md): who may join the real-time server, how long a join ticket
  // lasts, how many players (in all its processes) and a room take, and whether the network simulator may be used
  rt: z.object({ allowGuests: z.boolean(), ticketSec: z.number().int().min(10).max(600), maxPlayers: z.number().int().min(1), roomMaxClients: z.number().int().min(2).max(1000), netsim: z.boolean() }),
  // how long personal data is kept (ops/retention.ts, docs/PRIVACY_DATA.md): days
  retention: z.object({ guestInactiveDays: z.number().int().min(1), sessionsExpiredDays: z.number().int().min(0), signalsDays: z.number().int().min(1), supportDays: z.number().int().min(1),
    reportsDays: z.number().int().min(1), flagsDays: z.number().int().min(1), inviteUsesDays: z.number().int().min(1), auditDays: z.number().int().min(1), alertsDays: z.number().int().min(1) }),
});

const optional = z.string().optional().transform(v => v?.trim() ? v.trim() : null);
const Env = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.url(),
  // (docs/DEPLOYMENT.md: the game, its map files and the real-time server on addresses of their own)
  GAME_URL: optional,
  TILES_URL: optional,
  RT_URL: optional,
  // (Cloudflare adds this header to every request it passes on: only then is its CF-Connecting-IP believed)
  EDGE_SECRET: optional,
  // (HTTP Strict Transport Security: on once every address works over HTTPS — docs/DEPLOYMENT.md)
  HSTS: z.enum(['on', 'off']).default('off'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// URL'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)'),
  TRUSTED_ORIGINS: optional,
  SMTP_URL: optional,
  MAIL_FROM: z.string().default('Kugelsack Racing <no-reply@localhost>'),
  GOOGLE_CLIENT_ID: optional, GOOGLE_CLIENT_SECRET: optional,
  DISCORD_CLIENT_ID: optional, DISCORD_CLIENT_SECRET: optional,
  SENTRY_DSN: optional,
  SENTRY_CLIENT_DSN: optional,
  ADMIN_EMAIL: optional,
  // (Phase 6 Step 5) Cloudflare Turnstile, the bot check: its site key (public, for the pages) and secret
  TURNSTILE_SITE_KEY: optional,
  TURNSTILE_SECRET_KEY: optional,
  // where alerts go (docs/OPERATIONS.md): an email address (and a phone's, through an email-to-SMS or push address)
  ALERT_EMAIL: optional,
  // a phone's alerts: a webhook that takes plain text (an ntfy.sh topic URL — free, the ntfy app on the phone)
  ALERT_WEBHOOK_URL: optional,
  // an external monitor reading /api/v1/metrics sends this as a bearer token (empty: that endpoint is off)
  METRICS_TOKEN: optional,
  // (Phase 7) the real-time server: the secret its join tickets are signed with (shared by the API and it; in
  // development and tests made from BETTER_AUTH_SECRET), and Redis (its presence; bans reach it through Redis)
  RT_SECRET: optional,
  REDIS_URL: optional,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  // (Render says which commit it deployed in RENDER_GIT_COMMIT: the health check reports it, and the deploy waits for it)
  GIT_COMMIT: z.string().default(process.env.RENDER_GIT_COMMIT ?? 'dev'),
});

export type Config = ReturnType<typeof loadConfig>;

// The join tickets' secret: RT_SECRET, or (development and tests, where it isn't set) one made from the auth secret
export function rtSecretOf(rtSecret: string | null | undefined, authSecret: string) {
  return rtSecret ?? createHmac('sha256', authSecret).update('kugelsack rt tickets').digest('base64');
}

export function loadConfig(env: Record<string, string | undefined> = process.env, overrides: Partial<z.infer<typeof FileConfig>> = {}) {
  const e = Env.safeParse(env);
  if (!e.success) throw new Error(`The server's settings aren't right:\n${e.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  const E = e.data;
  const file = path.join(SERVER_DIR, 'config', `${E.APP_ENV}.json`);
  const f = FileConfig.safeParse({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...overrides });
  if (!f.success) throw new Error(`${file} isn't right:\n${f.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  const publicUrl = E.PUBLIC_URL.replace(/\/$/, '');
  if ((E.APP_ENV === 'staging' || E.APP_ENV === 'production') && !publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must be https:// in staging and production');
  const url = (name: string, v: string | null) => {
    if (!v) return null;
    let u: URL;
    try { u = new URL(v); } catch { throw new Error(`${name} must be a URL`); }
    if ((E.APP_ENV === 'staging' || E.APP_ENV === 'production') && !/^(https|wss):$/.test(u.protocol)) throw new Error(`${name} must be https:// (wss:// for RT_URL) in staging and production`);
    return v.replace(/\/$/, '');
  };
  const gameUrl = url('GAME_URL', E.GAME_URL) ?? publicUrl, tilesUrl = url('TILES_URL', E.TILES_URL), rtUrl = url('RT_URL', E.RT_URL);
  if (f.data.botCheck.required && !(E.TURNSTILE_SITE_KEY && E.TURNSTILE_SECRET_KEY)) throw new Error('The bot check is required here: set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY (docs/ABUSE.md)');
  if (E.EDGE_SECRET && E.EDGE_SECRET.length < 24) throw new Error('EDGE_SECRET must be at least 24 characters (openssl rand -hex 24)');
  if (E.RT_SECRET && E.RT_SECRET.length < 32) throw new Error('RT_SECRET must be at least 32 characters (openssl rand -base64 32)');
  if ((E.APP_ENV === 'staging' || E.APP_ENV === 'production') && rtUrl && !E.RT_SECRET) throw new Error('RT_SECRET is needed with RT_URL in staging and production (the real-time server\'s join tickets)');
  const origins = [new URL(publicUrl).origin, new URL(gameUrl).origin, ...(E.TRUSTED_ORIGINS ? E.TRUSTED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : [])];
  const social = {
    google: E.GOOGLE_CLIENT_ID && E.GOOGLE_CLIENT_SECRET ? { clientId: E.GOOGLE_CLIENT_ID, clientSecret: E.GOOGLE_CLIENT_SECRET } : null,
    discord: E.DISCORD_CLIENT_ID && E.DISCORD_CLIENT_SECRET ? { clientId: E.DISCORD_CLIENT_ID, clientSecret: E.DISCORD_CLIENT_SECRET } : null,
  };
  return {
    env: E.APP_ENV, port: E.PORT, host: E.HOST, publicUrl, trustedOrigins: [...new Set(origins)], databaseUrl: E.DATABASE_URL, poolMax: E.DATABASE_POOL_MAX,
    authSecret: E.BETTER_AUTH_SECRET, smtpUrl: E.SMTP_URL, mailFrom: E.MAIL_FROM, social, sentryDsn: E.SENTRY_DSN, sentryClientDsn: E.SENTRY_CLIENT_DSN,
    adminEmail: E.ADMIN_EMAIL?.toLowerCase() ?? null, version: E.GIT_COMMIT,
    gameUrl, tilesUrl, rtUrl, edgeSecret: E.EDGE_SECRET, hsts: E.HSTS === 'on',
    turnstile: E.TURNSTILE_SITE_KEY && E.TURNSTILE_SECRET_KEY ? { siteKey: E.TURNSTILE_SITE_KEY, secret: E.TURNSTILE_SECRET_KEY } : null,
    rtSecret: rtSecretOf(E.RT_SECRET, E.BETTER_AUTH_SECRET), redisUrl: E.REDIS_URL,
    alertEmail: E.ALERT_EMAIL, alertWebhook: E.ALERT_WEBHOOK_URL, metricsToken: E.METRICS_TOKEN,
    ...f.data,
  };
}
