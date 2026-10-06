// The API server, put together (buildApp: the tests build it with their own settings and call it with
// app.inject; main.ts listens). Everything a request passes through, in order:
//   request id → logging (tokens and passwords never written) → security headers (helmet) → CORS (only our
//   origins) → rate limits (per address; stricter on sign-in and sign-up; per account on writes) → body limits
//   (1 MiB; JSON only) → the session (Better Auth's cookie) → CSRF (writes with a cookie session carry the
//   token) → idempotency (writes) → the route: Zod-validated request and response → one error format.

import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
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
import { createTrackService } from './tracks/service.ts';
import { createEconomyConfig } from './economy/config.ts';
import { createEconomy } from './economy/service.ts';
import { playerRoutes } from './routes/player.ts';
import { adminEconomyRoutes } from './routes/adminEconomy.ts';
import { createContentService } from './content/service.ts';
import { trackRoutes } from './routes/tracks.ts';
import { moveGuestData, deleteUserData } from './data.ts';
import { rtHealth } from './rt/health.ts';

import { CLIENT_DIRS, CLIENT_FILES } from './clientFiles.ts';
export { CLIENT_DIRS, CLIENT_FILES };
// (on the API's own address in staging and production — serveClient 'tools' — only these pages, each for its
// role; the rest of the game's pages are on GAME_URL, and its map files on TILES_URL)
const TOOL_PAGES: Record<string, 'admin' | 'editor'> = { '/admin/': 'admin', '/editor/': 'editor' };
const GAME_PAGES = new Set(['/account/', '/dev/', '/testtrack/']);

// (a URL's secrets — verification and reset tokens, OAuth codes, in its query or its path — never logged)
const SECRET_PARAM = /token|code|state|password|secret|key/i;
const SECRET_PATH = /(\/(?:reset-password|verify-email|magic-link)\/)[^/?]+/gi;
export const scrubUrl = (url: string) => {
  const q = url.indexOf('?'), p = (q < 0 ? url : url.slice(0, q)).replace(SECRET_PATH, '$1[redacted]');
  if (q < 0) return p;
  const params = new URLSearchParams(url.slice(q + 1));
  for (const k of [...params.keys()]) if (SECRET_PARAM.test(k)) params.set(k, '[redacted]');
  return `${p}?${params}`;
};

export type AppDeps = { config: Config; db?: Db; pool?: { end(): Promise<void> }; mailer?: Mailer; mockOAuth?: { discoveryUrl: string; clientId: string; clientSecret: string } | null; onUnexpected?: (err: unknown, req?: { id?: string; method?: string; url?: string }) => void; logStream?: { write(msg: string): void }; clock?: () => number };

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
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]', '*.password', '*.token', '*.newPassword', '*.currentPassword'], censor: '[redacted]' },
      serializers: {
        req: r => ({ method: r.method, url: scrubUrl(r.url), ip: r.ip, id: r.id }),
        res: r => ({ statusCode: r.statusCode }),
      },
    },
    ajv: { customOptions: { removeAdditional: false } },
    // (an address the router can't read, or a parameter too long: the one error format too)
    frameworkErrors: (err, req, reply) => { sendError(reply, req, 400, 'BAD_REQUEST', `That address isn't right (${err.code === 'FST_ERR_MAX_PARAM_LENGTH' ? 'a part of it is too long' : 'it can\'t be read'}).`); },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installErrors(app, { onUnexpected: deps.onUnexpected ? (e, req) => deps.onUnexpected!(e, req) : undefined });
  // (behind Cloudflare — docs/DEPLOYMENT.md: the player's address is its CF-Connecting-IP, believed only when the
  // request carries the edge's secret; one that didn't come through Cloudflare is taken at the address the host's
  // own proxy saw, the last in X-Forwarded-For — what a client writes there itself doesn't count)
  if (config.edgeSecret) {
    const secret = Buffer.from(config.edgeSecret);
    app.addHook('onRequest', async req => {
      const given = req.headers['x-kr-edge'], cf = req.headers['cf-connecting-ip'];
      const viaEdge = typeof given === 'string' && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), secret);
      const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(x => x.trim()).filter(Boolean);
      req.headers['x-forwarded-for'] = viaEdge && typeof cf === 'string' && cf ? cf : (hops.at(-1) ?? req.socket.remoteAddress ?? '');
      delete req.headers['x-kr-edge'];
    });
  }
  app.addHook('onSend', async (req, reply, payload) => { reply.header(REQUEST_ID_HEADER, req.id); return payload; });

  const log = { info: (o: object, m: string) => app.log.info(o, m), error: (o: object, m: string) => app.log.error(o, m) };
  const mailer = deps.mailer ?? createMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom, log });
  const auth = createAuth({ config, db, mailer, mockOAuth: deps.mockOAuth ?? null, onGuestLinked: (from, to) => moveGuestData(db, from, to), onUserDeleted: id => deleteUserData(db, id), onUserChanged: async id => { await promoteOwner(db, config, id); } });
  const G = guards(auth, config);

  // ---------- security headers, CORS, cookies, CSRF ----------
  // (the map files' and the real-time server's own addresses, when they're elsewhere — on this computer they're
  // http:// and ws://, which 'https:' doesn't cover)
  const elsewhere = [config.tilesUrl, config.rtUrl].filter((u): u is string => !!u).map(u => new URL(u).origin);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // (the game's pages: their own modules, inline module scripts and import maps, three.js and Rapier from
        // the jsDelivr CDN, Rapier's WebAssembly)
        scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net', 'blob:'],
        workerSrc: ["'self'", 'blob:', 'https://cdn.jsdelivr.net'],   // (MapLibre's worker, for the maps)
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        // (map tiles and the world's data come from several hosts)
        connectSrc: ["'self'", 'https:', 'data:', 'blob:', ...elsewhere],
        mediaSrc: ["'self'", 'data:', 'blob:', ...elsewhere],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.cookieSecure && config.hsts ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || config.trustedOrigins.includes(origin)), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'idempotency-key', CSRF_HEADER, REQUEST_ID_HEADER], exposedHeaders: [REQUEST_ID_HEADER, 'idempotent-replayed'], maxAge: 600 });
  await app.register(cookie, { secret: config.authSecret });
  await app.register(csrf, { sessionPlugin: '@fastify/cookie', cookieKey: 'kr_csrf', cookieOpts: { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, signed: true }, getToken: req => req.headers[CSRF_HEADER] as string | undefined });

  // ---------- rate limits ----------
  // (each its own count, all of them checked: per address for everything; stricter per address on signing
  // in, signing up and the emails; per account for writes. createRateLimit, not rateLimit(): the plugin's
  // hooks stop at the first that runs on a request)
  await app.register(rateLimit, { global: false });
  const limiter = (max: number, windowSec: number, keyOf: (r: FastifyRequest) => string | Promise<string>) => {
    const check = app.createRateLimit({ max, timeWindow: windowSec * 1000, keyGenerator: keyOf });
    return async (req: FastifyRequest) => {
      const r: any = await check(req);
      if (!r.isAllowed && r.isExceeded) throw new AppError(429, 'RATE_LIMITED', 'Too many requests: wait a moment and try again.', undefined, { 'retry-after': String(Math.max(1, r.ttlInSeconds)) });
    };
  };
  const RL = config.rateLimits;
  const ipLimit = limiter(RL.global.max, RL.global.windowSec, r => `ip:${r.ip}`);
  const authLimit = limiter(RL.auth.max, RL.auth.windowSec, r => `auth:${r.ip}`);
  const signUpLimit = limiter(RL.signUp.max, RL.signUp.windowSec, r => `signup:${r.ip}`);
  const writeLimit = limiter(RL.write.max, RL.write.windowSec, async r => { const s = await sessionOf(auth, r); return s ? `acct:${s.user.id}` : `ip:${r.ip}`; });
  const STRICT = /^\/api\/auth\/+(sign-in|sign-up|request-password-reset|reset-password|send-verification-email|forget-password)/;
  app.addHook('onRequest', async req => {
    // (the API and real time only: the game's own files are hundreds of small modules, fetched every time the game
    // loads — counting them, two page loads used up a minute's allowance)
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/rt/')) return;
    await ipLimit(req);
    if (req.method !== 'POST') return;
    if (STRICT.test(req.url)) await authLimit(req);
    if (/^\/api\/auth\/+(sign-up|sign-in\/anonymous)/.test(req.url)) await signUpLimit(req);
  });
  app.addHook('preHandler', async req => {
    if (req.url.startsWith(API_PREFIX) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) await writeLimit(req);
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
  // (which database, as a short fingerprint of its host and name — nothing secret: staging's and production's
  // must differ, docs/DEPLOYMENT.md's checks compare them)
  const dbId = (() => { try { const u = new URL(config.databaseUrl); return crypto.createHash('sha256').update(`${u.hostname}/${u.pathname}`).digest('hex').slice(0, 10); } catch { return 'unknown'; } })();
  app.get(`${API_PREFIX}/health`, { schema: { response: { 200: Health, 503: Health } } }, async (_req, reply) => {
    let ok = true;
    try { await db.execute(sql`select 1`); } catch { ok = false; }
    return reply.status(ok ? 200 : 503).send({ ok, version: config.version, env: config.env, db: ok ? 'ok' : 'down', dbId, uptime: Math.round(process.uptime()) });
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
  const tracks = createTrackService({ db, config, log: (o, m) => app.log.info(o, m) });
  app.decorate('tracks', tracks);
  app.addHook('onClose', async () => { await tracks.close(); });
  // (the economy: the server's — Phase 6 Step 2; runs gone quiet ended every minute)
  const economyConfig = createEconomyConfig(db);
  const economy = createEconomy({ db, config: economyConfig, tracks, log: (o, m) => app.log.warn(o, m), ...(deps.clock ? { clock: deps.clock } : {}) });
  app.decorate('economy', economy);
  app.decorate('economyConfig', economyConfig);
  app.addHook('onReady', async () => { await economyConfig.ensure(); });
  const sweeper = setInterval(() => { void economy.sweep().catch(e => app.log.warn({ err: e }, 'session sweep failed')); }, 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => clearInterval(sweeper));
  // (the coming days' tracks made ahead of time: now, then every hour)
  if (config.tracks.precompute) {
    app.addHook('onReady', async () => { void tracks.prepare(); });
    const timer = setInterval(() => { void tracks.prepare(); }, 3600e3);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }
  await app.register(async api => {
    await meRoutes(api, { config, db, auth, G, mailer });
    await adminRoutes(api, { config, db, auth, G });
    await contentRoutes(api, { config, content, G });
    await trackRoutes(api, { config, tracks, G, auth });
    await playerRoutes(api, { economy, config: economyConfig, G });
    await adminEconomyRoutes(api, { db, economy, config: economyConfig, G });
  }, { prefix: API_PREFIX });

  // ---------- the real-time server's stand-in (rt.<domain>; Phase 7 Step 1 replaces it) ----------
  await rtHealth(app, { origins: config.trustedOrigins });

  // ---------- the game itself (development and tests: the same address as the API; staging and production:
  // only the admin and editor pages here, the game on GAME_URL — docs/DEPLOYMENT.md) ----------
  // (where the game's other parts are, for its pages: window.KR_SITE — site/config.js has the same for a
  // page served without this server, and the site build writes one for each environment)
  const tools = config.serveClient === 'tools';
  const site = { env: config.env, api: '', game: tools ? config.gameUrl : '', tiles: config.tilesUrl ?? '', rt: config.rtUrl ?? '' };
  if (config.serveClient) app.get('/site/config.js', (_req, reply) => reply.header('content-type', 'text/javascript; charset=utf-8').header('cache-control', 'no-cache').send(`globalThis.KR_SITE = Object.freeze(${JSON.stringify(site)});\n`));
  if (config.serveClient) {
    const roots = new Set(CLIENT_DIRS.map(d => `/${d}/`));
    await app.register(fastifyStatic, {
      root: REPO_DIR, serve: false, dotfiles: 'deny', index: false, etag: true, lastModified: true,
    });
    const shared = path.join(REPO_DIR, 'packages/shared/dist/shared.browser.js');
    app.get('/packages/shared/dist/shared.browser.js', (_req, reply) => fs.existsSync(shared) ? reply.header('cache-control', 'public, max-age=300').sendFile('packages/shared/dist/shared.browser.js') : sendError(reply, _req, 404, 'NOT_FOUND', 'Build it: npm run build:shared'));
    app.get('/*', async (req, reply) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const top = `/${p.split('/')[1]}/`;
      if (tools) {
        // the map files: from TILES_URL; the game's own pages: on GAME_URL
        if (top === '/assets/' && config.tilesUrl) return reply.redirect(`${config.tilesUrl}${req.url}`, 302);
        if (p === '/' || p === '/index.html' || p === '/lowpoly.html' || (GAME_PAGES.has(top) && (p.endsWith('/') || p.endsWith('.html')))) return reply.redirect(`${config.gameUrl}${req.url}`, 302);
        // the admin and editor pages: only for their roles (signed out: to sign in, then back here)
        const role = TOOL_PAGES[top];
        if (role && p !== top.slice(0, -1)) {
          try { await G.requireRole(role)(req); }
          catch (e: any) {
            if (e?.status === 401 || e?.code === 'TERMS_REQUIRED') return reply.redirect(`${config.gameUrl}/account/?${new URLSearchParams({ next: `${config.publicUrl}${top}`, ...(e?.code === 'TERMS_REQUIRED' ? { mode: 'terms' } : {}) })}`, 302);
            return reply.status(403).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(`<!doctype html><meta charset="utf-8"><title>Not for this account</title><p style="font:16px system-ui;margin:3em">This page is for ${role === 'admin' ? 'admins' : 'editors'}. <a href="${config.gameUrl}/">Back to the game</a></p>`);
          }
          reply.header('cache-control', 'no-store');
        }
      }
      if (p === '/' ) return reply.header('cache-control', 'no-cache').sendFile('index.html');
      if (p === top.slice(0, -1) && roots.has(top)) return reply.redirect(top);         // (/admin → /admin/)
      const file = p.endsWith('/') ? `${p.slice(1)}index.html` : p.slice(1);
      if (p.includes('..') || p.split('/').some(s => s.startsWith('.'))) return sendError(reply, req, 404, 'NOT_FOUND', 'There\'s nothing here.');
      if (!(roots.has(top) || CLIENT_FILES.includes(file))) return sendError(reply, req, 404, 'NOT_FOUND', 'There\'s nothing here.');
      if (config.env === 'production' && top === '/dev/') return sendError(reply, req, 404, 'NOT_FOUND', 'There\'s nothing here.');
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', /\.(html|json)$/.test(p) ? 'no-cache' : 'public, max-age=3600');
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
  interface FastifyInstance { routeList: { method: string; url: string; role?: string }[]; tracks: import('./tracks/service.ts').TrackService; economy: import('./economy/service.ts').Economy; economyConfig: import('./economy/config.ts').EconomyConfig }
}
export type App = Awaited<ReturnType<typeof buildApp>>;
export { AppError };
