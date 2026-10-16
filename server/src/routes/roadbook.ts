// The ROADBOOK (docs/ROADBOOK.md; roadbook/service.ts): the season, its challenges, Expeditions, Season Tokens and shop,
// and the Personal History. The game shows them and sends where the car has been; the server decides the rest.
//   GET  /roadbook                              the season and the player's progress in it, the shop, the history
//   POST /roadbook/ping                         { samples: [[lat, lon, clientMs] …], carInstanceId } → what it found
//   POST /roadbook/expeditions/:id/start        start an Expedition
//   POST /roadbook/shop/buy                     { itemId } → bought (once; tokens enough)
//   GET  /roadbook/history                      the Personal History alone
// Testing it without playing it (a development server: anyone signed in; the live one: admins):
//   POST /roadbook/dev/event { type, data } · /roadbook/dev/tokens { amount } · /roadbook/dev/end-season · GET /roadbook/dev/next-target
//   POST /roadbook/dev/arrive { lat, lon }  (arriving as if driven there: the debug teleport's other half)
// The admin page's ROADBOOK tab:
//   GET  /admin/roadbook                        the season's clock and numbers, the settings, their versions
//   POST /admin/roadbook/config                 { data, reason, basedOn } a new version (checked first; live at once)
//   POST /admin/roadbook/rollback               { version, reason }
//   POST /admin/roadbook/season/start · /end    { reason } start the current season now, or end it (its tokens turned into cash)
//   POST /admin/players/:id/tokens              { amount, reason } tokens given or taken away

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from '@kr/shared';
import type { Db } from '../db/index.ts';
import type { Guards } from '../session.ts';
import { auditLog } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import type { Roadbook } from '../roadbook/service.ts';
import type { RoadbookConfig } from '../roadbook/config.ts';
import { EVENTS } from '../../../roadbook/engine.js';

const Reason = z.string().trim().min(3).max(500);
const admin = { config: { role: 'admin' as const } };

export async function roadbookRoutes(app0: FastifyInstance, { db, roadbook, config: rbConfig, G, env }: { db: Db; roadbook: Roadbook; config: RoadbookConfig; G: Guards; env: string }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const who = async (req: FastifyRequest) => { const s: any = await G.requireTerms(req); return { id: s.user.id as string, name: s.user.name as string, role: (s.user.role ?? null) as string | null }; };
  const log = (actorId: string, action: string, targetId: string | null, reason: string | null, details: object = {}) => db.insert(auditLog).values({ actorId, action, targetId, reason, details });

  app.get('/roadbook', async (req, reply) => { reply.header('cache-control', 'private, no-store'); return roadbook.view(await who(req)); });
  app.get('/roadbook/history', async (req, reply) => { reply.header('cache-control', 'private, no-store'); return roadbook.history((await who(req)).id); });
  // (a ping sent twice counts once by its samples' times — no stored answer needed: roadbook/geo.js)
  app.post('/roadbook/ping', { config: { idempotent: false }, schema: { body: z.object({ samples: z.array(z.tuple([z.number(), z.number(), z.number()])).min(1).max(40), carInstanceId: z.string().max(80).nullish() }).strict() } }, async req => {
    return roadbook.ping(await who(req), req.body as any);
  });
  app.post('/roadbook/expeditions/:id/start', { schema: { params: z.object({ id: z.string().min(1).max(80) }) } }, async req => roadbook.beginExpedition(await who(req), req.params.id));
  app.post('/roadbook/shop/buy', { schema: { body: z.object({ itemId: z.string().min(1).max(80) }).strict() } }, async req => roadbook.buy(await who(req), req.body.itemId));

  // ---------- testing it without playing it ----------
  const dev = async (req: FastifyRequest) => {
    if (env === 'production') { const s: any = await G.requireRole('admin')(req); return { id: s.user.id as string, name: s.user.name as string, role: 'admin' }; }
    return who(req);
  };
  const key = (req: FastifyRequest) => String(req.headers['idempotency-key'] ?? crypto.randomUUID());
  app.post('/roadbook/dev/event', { schema: { body: z.object({ type: z.enum(EVENTS as [string, ...string[]]), data: z.record(z.string(), z.any()).default({}) }).strict() } }, async req => {
    const u = await dev(req), b = req.body as any;
    const paid = await roadbook.devEvent(u, { type: b.type, data: b.data }, key(req));
    return { ok: true as const, awards: paid ?? [], roadbook: await roadbook.view(u) };
  });
  app.post('/roadbook/dev/tokens', { schema: { body: z.object({ amount: z.number().int().min(-100000).max(100000).refine(n => n !== 0) }).strict() } }, async req => {
    const u = await dev(req);
    return roadbook.grantTokens(u, u.id, req.body.amount, `Development: ${req.body.amount > 0 ? 'given' : 'taken away'} for testing`, key(req));
  });
  app.post('/roadbook/dev/end-season', async req => {
    const u = await dev(req), S = await roadbook.seasonFor({ ...u, role: 'admin' });
    if (!S) throw new AppError(409, 'CONFLICT', 'There\'s no season to end.');
    if (S.status === 'testing') await roadbook.start(S.id, { by: u.id });
    const r = await roadbook.end(S.id, { by: u.id });
    if (env === 'production') await log(u.id, 'roadbook-end-season', null, 'Ended early from the game (development command)', { season: S.id });
    return r;
  });
  app.post('/roadbook/dev/arrive', { schema: { body: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict() } }, async req => roadbook.devArrive(await dev(req), req.body.lat, req.body.lon));
  app.get('/roadbook/dev/next-target', async req => ({ target: await roadbook.nextTarget(await dev(req)) }));

  // ---------- the admin page ----------
  const me = async (req: FastifyRequest) => { const s: any = await G.requireRole('admin')(req); return { id: s.user.id as string, name: s.user.name as string }; };
  app.get('/admin/roadbook', admin, async req => {
    await me(req);
    const active = await rbConfig.active();
    const versions = await rbConfig.history(30), ids = [...new Set(versions.map(v => v.actorId).filter(Boolean))] as string[];
    // (who made each version: their name — staff, not looked up as a player, so nothing to log)
    const names = ids.length ? Object.fromEntries(((await db.execute(sql`select id, name from users where id = any(${`{${ids.map(i => `"${i.replace(/"/g, '')}"`).join(',')}}`}::text[])`)).rows as any[]).map(r => [r.id, r.name])) : {};
    return { status: await roadbook.status(), version: active.version, data: active.data, versions: versions.map(v => ({ version: v.version, reason: v.reason, actorId: v.actorId, actor: v.actorId ? names[v.actorId] ?? null : null, basedOn: v.basedOn, createdAt: v.createdAt, active: v.active })) };
  });
  app.get('/admin/roadbook/versions/:version', { ...admin, schema: { params: z.object({ version: z.coerce.number().int().positive() }) } }, async req => { await me(req); return rbConfig.get(req.params.version); });
  app.post('/admin/roadbook/config', { ...admin, bodyLimit: 2_000_000, schema: { body: z.object({ data: z.record(z.string(), z.any()), reason: Reason, basedOn: z.number().int().nullable() }).strict() } }, async req => {
    const a = await me(req), b = req.body;
    const now = await rbConfig.active();
    if (b.basedOn !== null && b.basedOn !== now.version) throw new AppError(409, 'CONFLICT', `Someone changed the ROADBOOK while you were editing (version ${now.version} is live now): look at theirs first.`);
    const version = await rbConfig.change(b.data, { actorId: a.id, reason: b.reason, basedOn: b.basedOn });
    await log(a.id, 'roadbook-config', null, b.reason, { version, basedOn: b.basedOn });
    return { ok: true as const, version };
  });
  app.post('/admin/roadbook/rollback', { ...admin, schema: { body: z.object({ version: z.number().int().positive(), reason: Reason }).strict() } }, async req => {
    const a = await me(req), version = await rbConfig.rollback(req.body.version, { actorId: a.id, reason: req.body.reason });
    await log(a.id, 'roadbook-rollback', null, req.body.reason, { to: req.body.version, version });
    return { ok: true as const, version };
  });
  app.post('/admin/roadbook/season/:what', { ...admin, schema: { params: z.object({ what: z.enum(['start', 'end']) }), body: z.object({ reason: Reason }).strict() } }, async req => {
    const a = await me(req), st = await roadbook.status();
    const r = req.params.what === 'start' ? await roadbook.start(st.current, { by: a.id }) : await roadbook.end(st.current, { by: a.id });
    await log(a.id, `roadbook-season-${req.params.what}`, null, req.body.reason, { season: st.current, result: r });
    return { ...r, status: await roadbook.status() };
  });
  app.post('/admin/players/:id/tokens', { ...admin, schema: { params: z.object({ id: z.string().min(1).max(80) }), body: z.object({ amount: z.number().int().min(-100000).max(100000).refine(n => n !== 0), reason: Reason }).strict() } }, async req => {
    const a = await me(req), r = await roadbook.grantTokens(a, req.params.id, req.body.amount, req.body.reason, key(req));
    await log(a.id, req.body.amount > 0 ? 'grant-tokens' : 'remove-tokens', req.params.id, req.body.reason, { amount: req.body.amount });
    return r;
  });
}
