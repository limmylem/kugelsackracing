// The API server, put together (buildApp: the tests build it with their own settings and call it with
// app.inject; main.ts listens). Everything a request passes through, in order:
//   request id → logging (tokens and passwords never written) → security headers (helmet) → CORS (only our
//   origins) → rate limits (per address; stricter on sign-in and sign-up; per account on writes) → body limits
//   (1 MiB; JSON only) → the session (Better Auth's cookie) → CSRF (writes with a cookie session carry the
//   token) → idempotency (writes) → the route: Zod-validated request and response → one error format.

import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import csrf from '@fastify/csrf-protection';
import fastifyStatic from '@fastify/static';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { fromNodeHeaders } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { API_PREFIX, AUTH_PREFIX, CSRF_HEADER, ClientConfig, Health, LIMITS, REQUEST_ID_HEADER, z } from '@kr/shared';
import { REPO_DIR, type Config } from './config.ts';
import { openDb, type Db } from './db/index.ts';
import { createAuth, type Auth } from './auth.ts';
import { createMailer, type Mailer } from './mail.ts';
import { installErrors, AppError, sendError } from './errors.ts';
import { installIdempotency } from './idempotency.ts';
import { guards, sessionOf } from './session.ts';
import { meRoutes } from './routes/me.ts';
import { adminRoutes } from './routes/admin.ts';
import { contentRoutes } from './routes/content.ts';
import { loadRules } from './content/rules.ts';
import { promoteOwner } from './owner.ts';
import { createContentService } from './content/service.ts';
import { trackRoutes } from './routes/tracks.ts';
import { moveGuestData, deleteUserData } from './data.ts';

// what of the repository is the game (served to browsers): nothing else — not the server, tests, tools or docs
export const CLIENT_DIRS = ['ai', 'assets', 'content', 'data', 'dev', 'editor', 'effects', 'garage', 'map', 'physics', 'play', 'quest', 'race', 'realworld', 'route', 'scenes', 'testtrack', 'track', 'ui', 'world', 'admin', 'account'];
export const CLIENT_FILES = ['index.html', 'lowpoly.html', 'roadster.glb', 'favicon.ico'];

// (a URL's query values that are secrets — verification and reset tokens, OAuth codes — never logged)
const SECRET_PARAM = /token|code|state|password|secret|key/i;
export const scrubUrl = (url: string) => {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  for (const k of [...params.keys()]) if (SECRET_PARAM.test(k)) params.set(k, '[redacted]');
  return `${url.slice(0, q)}?${params}`;
};

export type AppDeps = { config: Config; db?: Db; pool?: { end(): Promise<void> }; mailer?: Mailer; mockOAuth?: { discoveryUrl: string; clientId: string; clientSecret: string } | null; onUnexpected?: (err: unknown, req?: { id?: string; method?: string; url?: string }) => void };

export async function buildApp(deps: AppDeps) {
  const { config } = deps;
  const opened = deps.db ? null : openDb(config.databaseUrl, { max: config.poolMax });
  const db = deps.db ?? opened!.db;
  const app = Fastify({
    trustProxy: true,                      // (behind the host's proxy: the client's address from X-Forwarded-For)
    bodyLimit: LIMITS.bodyBytes,
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => crypto.randomUUID(),
    logger: {
      level: config.logLevel,
      redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]', '*.password', '*.token', '*.newPassword', '*.currentPassword'], censor: '[redacted]' },
      serializers: {
        req: r => ({ method: r.method, url: scrubUrl(r.url), ip: r.ip, id: r.id }),
        res: r => ({ statusCode: r.statusCode }),
      },
    },
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installErrors(app, { onUnexpected: deps.onUnexpected ? (e, req) => deps.onUnexpected!(e, req) : undefined });
  app.addHook('onSend', async (req, reply, payload) => { reply.header(REQUEST_ID_HEADER, req.id); return payload; });

  const log = { info: (o: object, m: string) => app.log.info(o, m), error: (o: object, m: string) => app.log.error(o, m) };
  const mailer = deps.mailer ?? createMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom, log });
  const auth = createAuth({ config, db, mailer, mockOAuth: deps.mockOAuth ?? null, onGuestLinked: (from, to) => moveGuestData(db, from, to), onUserDeleted: id => deleteUserData(db, id), onUserChanged: async id => { await promoteOwner(db, config, id); } });
  const G = guards(auth, config);

  // ---------- security headers, CORS, cookies, CSRF ----------
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // (the game's pages: their own modules, inline module scripts and import maps, three.js and Rapier from
        // the jsDelivr CDN, Rapier's WebAssembly)
        scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net', 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        // (map tiles and the world's data come from several hosts)
        connectSrc: ["'self'", 'https:', 'data:', 'blob:'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || config.trustedOrigins.includes(origin)), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'idempotency-key', CSRF_HEADER, REQUEST_ID_HEADER], maxAge: 600 });
  await app.register(cookie, { secret: config.authSecret });
  await app.register(csrf, { sessionPlugin: '@fastify/cookie', cookieKey: 'kr_csrf', cookieOpts: { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, signed: true }, getToken: req => req.headers[CSRF_HEADER] as string | undefined });

  // ---------- rate limits ----------
  await app.register(rateLimit, { global: false });
  const ipLimit = app.rateLimit({ max: config.rateLimits.global.max, timeWindow: config.rateLimits.global.windowSec * 1000, keyGenerator: r => `ip:${r.ip}` });
  const authLimit = app.rateLimit({ max: config.rateLimits.auth.max, timeWindow: config.rateLimits.auth.windowSec * 1000, keyGenerator: r => `auth:${r.ip}` });
  const signUpLimit = app.rateLimit({ max: config.rateLimits.signUp.max, timeWindow: config.rateLimits.signUp.windowSec * 1000, keyGenerator: r => `signup:${r.ip}` });
  const writeLimit = app.rateLimit({ max: config.rateLimits.write.max, timeWindow: config.rateLimits.write.windowSec * 1000, keyGenerator: async r => { const s = await sessionOf(auth, r); return s ? `acct:${s.user.id}` : `ip:${r.ip}`; } });
  app.addHook('onRequest', ipLimit);
  const STRICT = /^\/api\/auth\/(sign-in|sign-up|request-password-reset|reset-password|send-verification-email|sign-in\/anonymous)/;
  app.addHook('onRequest', async (req, reply) => {
    if (STRICT.test(req.url)) await authLimit.call(app, req, reply);
    if (req.url.startsWith('/api/auth/sign-up') || req.url.startsWith('/api/auth/sign-in/anonymous')) await signUpLimit.call(app, req, reply);
  });
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith(API_PREFIX) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) await writeLimit.call(app, req, reply);
  });

  // ---------- CSRF: a write with a cookie session carries the token (GET /api/v1/csrf) ----------
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith(API_PREFIX) || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.routeOptions.config?.csrf === false) return;
    if (!req.headers.cookie) return;     // (no cookie, no session to ride on)
    await new Promise<void>((resolve, reject) => app.csrfProtection(req, reply, (e?: Error) => e ? reject(e) : resolve()));
  });
  // ---------- roles: a route that says it's for editors or admins checks it here, before anything else runs ----------
  const routes: { method: string; url: string; role?: string }[] = [];
  app.addHook('onRoute', r => { for (const m of [r.method].flat()) routes.push({ method: String(m), url: r.url, role: (r.config as any)?.role }); });
  app.decorate('routeList', routes);
  // (as the request arrives: before its body is read or checked — a player's upload is refused unread)
  app.addHook('onRequest', async req => {
    const role = req.routeOptions.config?.role;
    if (role) await G.requireRole(role)(req);
  });
  installIdempotency(app, { db, auth });

  // ---------- Better Auth's own endpoints, under /api/auth ----------
  // (its admin and impersonation endpoints are never called from a browser: only our admin API uses them,
  // checked and logged — routes/admin.ts)
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_PREFIX}/*`,
    config: { rawAuth: true },
    async handler(req, reply) {
      const url = new URL(req.url, config.publicUrl);
      // (however the path is written: escaped, doubled slashes)
      let p = url.pathname;
      try { p = decodeURIComponent(p); } catch { return sendError(reply, req, 400, 'BAD_REQUEST', 'That address isn\'t right.'); }
      if (/^\/api\/auth\/+(admin|impersonate)/i.test(p.replace(/\/{2,}/g, '/')) || /\/admin\//i.test(p)) return sendError(reply, req, 403, 'FORBIDDEN', 'Use the admin page.');
      const body = req.method === 'POST' && req.body !== undefined ? JSON.stringify(req.body) : undefined;
      const res = await auth.handler(new Request(url, { method: req.method, headers: fromNodeHeaders(req.headers), body }));
      reply.status(res.status);
      res.headers.forEach((v, k) => { if (k !== 'set-cookie' && k !== 'content-length') reply.header(k, v); });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      const text = await res.text();
      // (its errors in our format too, so the client reads one shape)
      if (res.status >= 400 && text) {
        try {
          const e = JSON.parse(text);
          if (!e.error?.code) return sendError(reply, req, res.status, authCode(res.status, e.code), e.message ?? 'That didn\'t work.', e.code ? { authCode: e.code } : undefined);
        } catch { /* not JSON */ }
      }
      return reply.send(text || null);
    },
  });

  // ---------- the API ----------
  app.get(`${API_PREFIX}/health`, { schema: { response: { 200: Health, 503: Health } } }, async (_req, reply) => {
    let ok = true;
    try { await db.execute(sql`select 1`); } catch { ok = false; }
    return reply.status(ok ? 200 : 503).send({ ok, version: config.version, env: config.env, db: ok ? 'ok' : 'down', uptime: Math.round(process.uptime()) });
  });
  app.get('/health', async (_req, reply) => reply.redirect(`${API_PREFIX}/health`));
  app.get(`${API_PREFIX}/client-config`, { schema: { response: { 200: ClientConfig } } }, async () => ({
    apiBase: '', env: config.env, sentryDsn: config.sentryClientDsn, social: (['google', 'discord'] as const).filter(k => config.social[k]),
    termsVersion: config.termsVersion, privacyVersion: config.privacyVersion, minAge: config.minAge,
  }));
  app.get(`${API_PREFIX}/csrf`, { schema: { response: { 200: z.object({ token: z.string() }) } } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { token: reply.generateCsrf() };
  });
  const content = createContentService({ db, rules: loadRules() });
  app.decorate('content', content);
  await app.register(async api => {
    await meRoutes(api, { config, db, auth, G, mailer });
    await adminRoutes(api, { config, db, auth, G });
    await contentRoutes(api, { config, content, G });
    await trackRoutes(api, { config, db, G });
  }, { prefix: API_PREFIX });

  // ---------- the game itself (same origin as the API: the session cookie stays first-party) ----------
  if (config.serveClient) {
    const roots = new Set(CLIENT_DIRS.map(d => `/${d}/`));
    await app.register(fastifyStatic, {
      root: REPO_DIR, serve: false, dotfiles: 'deny', index: false, etag: true, lastModified: true,
    });
    const shared = path.join(REPO_DIR, 'packages/shared/dist/shared.browser.js');
    app.get('/packages/shared/dist/shared.browser.js', (_req, reply) => fs.existsSync(shared) ? reply.header('cache-control', 'public, max-age=300').sendFile('packages/shared/dist/shared.browser.js') : sendError(reply, _req, 404, 'NOT_FOUND', 'Build it: npm run build:shared'));
    app.get('/*', (req, reply) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' ) return reply.header('cache-control', 'no-cache').sendFile('index.html');
      const top = `/${p.split('/')[1]}/`;
      if (p === top.slice(0, -1) && roots.has(top)) return reply.redirect(top);         // (/admin → /admin/)
      const file = p.endsWith('/') ? `${p.slice(1)}index.html` : p.slice(1);
      if (p.includes('..') || p.split('/').some(s => s.startsWith('.'))) return sendError(reply, req, 404, 'NOT_FOUND', 'There\'s nothing here.');
      if (!(roots.has(top) || CLIENT_FILES.includes(file))) return sendError(reply, req, 404, 'NOT_FOUND', 'There\'s nothing here.');
      if (config.env === 'production' && top === '/dev/') return sendError(reply, req, 404, 'NOT_FOUND', 'There\'s nothing here.');
      reply.header('cache-control', /\.(html|json)$/.test(p) ? 'no-cache' : 'public, max-age=3600');
      return reply.sendFile(file);
    });
  }

  // (the owner's account may be there already: an admin once its email is verified)
  app.addHook('onReady', async () => { await promoteOwner(db, config); });
  app.decorate('deps', { db, auth, config, mailer });
  app.addHook('onClose', async () => { if (opened) await opened.pool.end(); });
  return app;
}

function authCode(status: number, code?: string) {
  if (status === 401) return 'UNAUTHENTICATED' as const;
  if (status === 403) return code === 'BANNED_USER' ? 'BANNED' as const : 'FORBIDDEN' as const;
  if (status === 429) return 'RATE_LIMITED' as const;
  if (code === 'NAME_TAKEN') return 'NAME_TAKEN' as const;
  if (code === 'NAME_NOT_ALLOWED') return 'NAME_NOT_ALLOWED' as const;
  if (code === 'TERMS_REQUIRED') return 'TERMS_REQUIRED' as const;
  if (status === 422 || status === 400) return 'BAD_REQUEST' as const;
  return status >= 500 ? 'INTERNAL' as const : 'BAD_REQUEST' as const;
}

declare module 'fastify' {
  interface FastifyInstance { deps: { db: Db; auth: Auth; config: Config; mailer: Mailer } }
  interface FastifyContextConfig { csrf?: boolean; rawAuth?: boolean; role?: 'editor' | 'admin' }
  interface FastifyInstance { routeList: { method: string; url: string; role?: string }[] }
}
export type App = Awaited<ReturnType<typeof buildApp>>;
export { AppError };
