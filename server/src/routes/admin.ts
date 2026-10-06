// The admins' API (the admin page, admin/index.html): find a player, see their account, change their role,
// suspend (for some days), ban, lift a ban, sign them out everywhere — each through Better Auth's admin plugin
// (it checks the caller is an admin too), and each written to the audit log with who, whom, why and what
// changed. Every route here rejects anyone who isn't an admin.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { fromNodeHeaders } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { AdminSearchQuery, AuditEntry, BanBody, Ok, PlayerDetail, PlayerSummary, SetRoleBody, SuspendBody, UnbanBody, z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { Auth } from '../auth.ts';
import type { Guards, RequestSession } from '../session.ts';
import { AppError, notFound } from '../errors.ts';
import { auditLog } from '../db/schema.ts';

const Id = z.object({ id: z.string().min(1).max(80) });
const iso = (d: unknown) => d ? new Date(d as string).toISOString() : null;
const summary = (r: any) => ({
  id: r.id, email: r.is_anonymous ? null : r.email, displayName: r.name, role: r.role, isGuest: !!r.is_anonymous, emailVerified: !!r.email_verified,
  banned: !!r.banned && (!r.ban_expires || new Date(r.ban_expires) > new Date()), banReason: r.ban_reason ?? null, banExpires: iso(r.ban_expires), createdAt: iso(r.created_at)!,
});

export async function adminRoutes(app0: FastifyInstance, { db, auth, G }: { config: Config; db: Db; auth: Auth; G: Guards }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const admin = G.requireRole('admin');
  const userRow = async (id: string) => (await db.execute(sql`select * from users where id = ${id}`)).rows[0] as any;
  const log = async (s: NonNullable<RequestSession>, action: string, targetId: string | null, reason: string | null, details: object = {}) =>
    db.insert(auditLog).values({ actorId: s.user.id, action, targetId, reason, details });
  const call = async (req: FastifyRequest, fn: (h: Headers) => Promise<unknown>) => {
    try { return await fn(fromNodeHeaders(req.headers)); }
    catch (e: any) { throw new AppError(e?.statusCode === 403 ? 403 : 400, e?.statusCode === 403 ? 'FORBIDDEN' : 'BAD_REQUEST', e?.body?.message ?? e?.message ?? 'That didn\'t work.'); }
  };

  app.get('/admin/players', { config: { role: 'admin' }, schema: { querystring: AdminSearchQuery, response: { 200: z.object({ players: z.array(PlayerSummary) }) } } }, async req => {
    await admin(req);
    const q = req.query.q, like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    const rows = (await db.execute(sql`select * from users where id = ${q} or email ilike ${like} or name ilike ${like} order by (id = ${q}) desc, created_at desc limit ${req.query.limit}`)).rows;
    return { players: rows.map(summary) };
  });

  app.get('/admin/players/:id', { config: { role: 'admin' }, schema: { params: Id, response: { 200: PlayerDetail } } }, async req => {
    const s = await admin(req);
    const u = await userRow(req.params.id);
    if (!u) throw notFound('That player');
    const count = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)).rows[0] as any).n);
    const providers = (await db.execute(sql`select provider_id from accounts where user_id = ${u.id}`)).rows.map((r: any) => r.provider_id);
    const lastSeen = (await db.execute(sql`select max(updated_at) as t from sessions where user_id = ${u.id}`)).rows[0] as any;
    await log(s, 'view-player', u.id, null);
    return {
      ...summary(u), providers, termsVersion: u.terms_version ?? null, lastSeen: iso(lastSeen?.t),
      sessions: await count(sql`select count(*) as n from sessions where user_id = ${u.id} and expires_at > now()`),
      records: await count(sql`select count(*) as n from track_records where user_id = ${u.id}`),
      replays: await count(sql`select count(*) as n from replays where owner_id = ${u.id}`),
      content: await count(sql`select count(*) as n from content_items where author_id = ${u.id}`),
    };
  });

  app.post('/admin/players/:id/role', { config: { role: 'admin' }, schema: { params: Id, body: SetRoleBody, response: { 200: Ok } } }, async req => {
    const s = await admin(req);
    const u = await userRow(req.params.id);
    if (!u) throw notFound('That player');
    if (u.is_anonymous) throw new AppError(400, 'BAD_REQUEST', 'A guest can\'t have a role: they need a full account first.');
    if (u.id === s.user.id && req.body.role !== 'admin') {
      const admins = Number(((await db.execute(sql`select count(*) as n from users where role = 'admin'`)).rows[0] as any).n);
      if (admins <= 1) throw new AppError(409, 'CONFLICT', 'You\'re the only admin: make someone else an admin first.');
    }
    await call(req, h => auth.api.setRole({ body: { userId: u.id, role: req.body.role as any }, headers: h }));
    await log(s, 'set-role', u.id, req.body.reason, { from: u.role, to: req.body.role });
    return { ok: true as const };
  });

  const noSelf = (s: NonNullable<RequestSession>, id: string) => { if (s.user.id === id) throw new AppError(400, 'BAD_REQUEST', 'You can\'t do that to your own account.'); };
  app.post('/admin/players/:id/suspend', { config: { role: 'admin' }, schema: { params: Id, body: SuspendBody, response: { 200: Ok } } }, async req => {
    const s = await admin(req); noSelf(s, req.params.id);
    const u = await userRow(req.params.id);
    if (!u) throw notFound('That player');
    await call(req, h => auth.api.banUser({ body: { userId: u.id, banReason: req.body.reason, banExpiresIn: req.body.days * 86400 }, headers: h }));
    await log(s, 'suspend', u.id, req.body.reason, { days: req.body.days });
    return { ok: true as const };
  });
  app.post('/admin/players/:id/ban', { config: { role: 'admin' }, schema: { params: Id, body: BanBody, response: { 200: Ok } } }, async req => {
    const s = await admin(req); noSelf(s, req.params.id);
    const u = await userRow(req.params.id);
    if (!u) throw notFound('That player');
    await call(req, h => auth.api.banUser({ body: { userId: u.id, banReason: req.body.reason }, headers: h }));
    await log(s, 'ban', u.id, req.body.reason);
    return { ok: true as const };
  });
  app.post('/admin/players/:id/unban', { config: { role: 'admin' }, schema: { params: Id, body: UnbanBody, response: { 200: Ok } } }, async req => {
    const s = await admin(req);
    const u = await userRow(req.params.id);
    if (!u) throw notFound('That player');
    await call(req, h => auth.api.unbanUser({ body: { userId: u.id }, headers: h }));
    await log(s, 'unban', u.id, req.body.reason);
    return { ok: true as const };
  });
  app.post('/admin/players/:id/sign-out', { config: { role: 'admin' }, schema: { params: Id, body: UnbanBody, response: { 200: Ok } } }, async req => {
    const s = await admin(req);
    const u = await userRow(req.params.id);
    if (!u) throw notFound('That player');
    await call(req, h => auth.api.revokeUserSessions({ body: { userId: u.id }, headers: h }));
    await log(s, 'sign-out-everywhere', u.id, req.body.reason);
    return { ok: true as const };
  });

  app.get('/admin/audit', { config: { role: 'admin' }, schema: { querystring: z.object({ targetId: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), response: { 200: z.object({ entries: z.array(AuditEntry) }) } } }, async req => {
    await admin(req);
    const rows = (await db.execute(sql`select a.*, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id
      where (${req.query.targetId ?? null}::text is null or a.target_id = ${req.query.targetId ?? null}) order by a.id desc limit ${req.query.limit}`)).rows as any[];
    return { entries: rows.map(r => ({ id: Number(r.id), at: iso(r.at)!, actorId: r.actor_id, actorName: r.actor_name ?? null, action: r.action, targetId: r.target_id, reason: r.reason, details: r.details })) };
  });
}
