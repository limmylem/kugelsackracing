// The server's settings: what isn't secret from config/<environment>.json, every secret from the environment
// (never in code, never sent to the client). Checked with Zod on start: a missing or malformed setting stops
// the server with a plain message, rather than failing later.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = path.resolve(SERVER_DIR, '..');

const Limit = z.object({ max: z.number().int().positive(), windowSec: z.number().int().positive() });
const FileConfig = z.object({
  minAge: z.number().int().min(0).max(21),
  termsVersion: z.string().min(1),
  privacyVersion: z.string().min(1),
  requireEmailVerification: z.boolean(),
  serveClient: z.boolean(),
  cookieSecure: z.boolean(),
  rateLimits: z.object({ global: Limit, auth: Limit, signUp: Limit, write: Limit }),
  cache: z.object({ publishedSeconds: z.number().int().min(0), cdnSeconds: z.number().int().min(0), serverMB: z.number().min(0).max(1024) }),
  replays: z.object({ keepPerPlayer: z.number().int().min(1) }),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
});

const optional = z.string().optional().transform(v => v?.trim() ? v.trim() : null);
const Env = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.url(),
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
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  GIT_COMMIT: z.string().default('dev'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env, overrides: Partial<z.infer<typeof FileConfig>> = {}) {
  const e = Env.safeParse(env);
  if (!e.success) throw new Error(`The server's settings aren't right:\n${e.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  const E = e.data;
  const file = path.join(SERVER_DIR, 'config', `${E.APP_ENV}.json`);
  const f = FileConfig.safeParse({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...overrides });
  if (!f.success) throw new Error(`${file} isn't right:\n${f.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  const publicUrl = E.PUBLIC_URL.replace(/\/$/, '');
  if ((E.APP_ENV === 'staging' || E.APP_ENV === 'production') && !publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must be https:// in staging and production');
  const origins = [new URL(publicUrl).origin, ...(E.TRUSTED_ORIGINS ? E.TRUSTED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : [])];
  const social = {
    google: E.GOOGLE_CLIENT_ID && E.GOOGLE_CLIENT_SECRET ? { clientId: E.GOOGLE_CLIENT_ID, clientSecret: E.GOOGLE_CLIENT_SECRET } : null,
    discord: E.DISCORD_CLIENT_ID && E.DISCORD_CLIENT_SECRET ? { clientId: E.DISCORD_CLIENT_ID, clientSecret: E.DISCORD_CLIENT_SECRET } : null,
  };
  return {
    env: E.APP_ENV, port: E.PORT, host: E.HOST, publicUrl, trustedOrigins: [...new Set(origins)], databaseUrl: E.DATABASE_URL, poolMax: E.DATABASE_POOL_MAX,
    authSecret: E.BETTER_AUTH_SECRET, smtpUrl: E.SMTP_URL, mailFrom: E.MAIL_FROM, social, sentryDsn: E.SENTRY_DSN, sentryClientDsn: E.SENTRY_CLIENT_DSN,
    adminEmail: E.ADMIN_EMAIL?.toLowerCase() ?? null, version: E.GIT_COMMIT,
    ...f.data,
  };
}
