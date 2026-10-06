// The server's tests: each file gets a database of its own (made from scratch and migrated: the migrations are
// tested every run), the app built on it with test settings (mail into an in-memory outbox), and players —
// clients with their own cookie jars that send the CSRF token and an Idempotency-Key with every write, as the
// game does.
//
//   TEST_DATABASE_URL: an admin connection to a Postgres with PostGIS (CI: the service container; locally
//   postgres://postgres:devpass@127.0.0.1:54329/postgres — docs/SERVER.md)

import crypto from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../src/config.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { buildApp, type App } from '../src/app.ts';
import type { Mail } from '../src/mail.ts';

export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:devpass@127.0.0.1:54329/postgres';
export const PUBLIC_URL = 'http://localhost:8787';

export async function freshDatabase(tag: string) {
  const name = `kr_t_${tag}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
  await migrateDb(url);
  return {
    url, name,
    async drop() { const c = new pg.Client({ connectionString: ADMIN_URL }); await c.connect(); await c.query(`drop database if exists ${name} with (force)`); await c.end(); },
  };
}

export function testConfig(databaseUrl: string, overrides: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  return loadConfig({ APP_ENV: 'test', PUBLIC_URL, DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789', SMTP_URL: 'memory://', ...env }, overrides as any);
}

export async function testApp(tag: string, { overrides = {}, env = {}, mockOAuth = null }: { overrides?: Record<string, unknown>; env?: Record<string, string>; mockOAuth?: any } = {}) {
  const database = await freshDatabase(tag);
  const config = testConfig(database.url, overrides, env);
  const app = await buildApp({ config, mockOAuth });
  await app.ready();
  const outbox = app.deps.mailer.outbox as Mail[];
  return { app, config, outbox, database, async close() { await app.close(); await database.drop(); } };
}

export type Res = { status: number; body: any; headers: Record<string, any>; text: string };

// a browser: its cookies, the CSRF token, an Idempotency-Key per write (or the one given)
export class Player {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  app: App; ip: string;
  constructor(app: App, ip = '10.0.0.1') { this.app = app; this.ip = ip; }
  private absorb(headers: Record<string, any>) {
    const set = headers['set-cookie'];
    for (const c of (Array.isArray(set) ? set : set ? [set] : []) as string[]) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('='), name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
      const expired = attrs.some(a => /max-age=0/i.test(a.trim())) || value === '';
      if (expired) this.cookies.delete(name); else this.cookies.set(name, value);
    }
  }
  get cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method: string, url: string, { body, headers = {}, key, csrf = true, raw }: { body?: unknown; headers?: Record<string, string>; key?: string | null; csrf?: boolean; raw?: string } = {}): Promise<Res> {
    const write = !['GET', 'HEAD'].includes(method);
    const h: Record<string, string> = { origin: PUBLIC_URL, 'x-forwarded-for': this.ip, ...headers };
    if (this.cookies.size) h.cookie = this.cookieHeader;
    if (write && url.startsWith('/api/v1')) {
      if (csrf && this.cookies.size) { if (!this.csrf) await this.refreshCsrf(); h['x-csrf-token'] = this.csrf!; if (this.cookies.size) h.cookie = this.cookieHeader; }
      if (key !== null && !('idempotency-key' in h)) h['idempotency-key'] = key ?? crypto.randomUUID();
    }
    let payload: string | undefined = raw;
    if (payload === undefined && body !== undefined) { payload = JSON.stringify(body); h['content-type'] ??= 'application/json'; }
    else if (payload === undefined && write) { payload = '{}'; h['content-type'] ??= 'application/json'; }
    const r = await this.app.inject({ method: method as any, url, headers: h, payload });
    this.absorb(r.headers);
    let parsed: any = null;
    try { parsed = r.body ? JSON.parse(r.body) : null; } catch { parsed = null; }
    return { status: r.statusCode, body: parsed, headers: r.headers, text: r.body };
  }
  async refreshCsrf() { const r = await this.req('GET', '/api/v1/csrf'); this.csrf = r.body.token; }
  get = (url: string, o = {}) => this.req('GET', url, o);
  post = (url: string, body?: unknown, o = {}) => this.req('POST', url, { body, ...o });
  patch = (url: string, body?: unknown, o = {}) => this.req('PATCH', url, { body, ...o });
  put = (url: string, body?: unknown, o = {}) => this.req('PUT', url, { body, ...o });
  del = (url: string, body?: unknown, o = {}) => this.req('DELETE', url, { body, ...o });
}

export const linkIn = (mail: Mail) => mail.text.match(/https?:\/\/\S+/)![0];
export const path = (url: string) => { const u = new URL(url); return u.pathname + u.search; };
export const birth = (years: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); d.setUTCDate(d.getUTCDate() - 2); return d.toISOString().slice(0, 10); };

// a full account: signed up, verified, signed in
export async function signUp(app: App, outbox: Mail[], { email, name, password = 'correct horse battery', ip = '10.0.0.1', termsVersion = '2026-10-06' }: { email: string; name: string; password?: string; ip?: string; termsVersion?: string }) {
  const p = new Player(app, ip);
  const r = await p.post('/api/auth/sign-up/email', { email, password, name, acceptTerms: termsVersion, birthDate: birth(25) });
  if (r.status !== 200) throw new Error(`sign-up ${email}: ${r.status} ${r.text}`);
  const mail = [...outbox].reverse().find(m => m.to === email && m.kind === 'verify-email');
  if (!mail) throw new Error(`no verification mail for ${email}`);
  const v = await p.get(path(linkIn(mail)));
  if (v.status >= 400) throw new Error(`verify ${email}: ${v.status} ${v.text}`);
  if (!p.cookies.size) { const s = await p.post('/api/auth/sign-in/email', { email, password }); if (s.status !== 200) throw new Error(`sign-in ${email}: ${s.status} ${s.text}`); }
  return p;
}
