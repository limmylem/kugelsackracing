// Players reporting players, and the admins' review queues (Phase 6 Step 5; docs/ABUSE.md):
//   POST /reports                         { targetName | targetId, kind, details, ref? } a player reports another
//                                         (cheating, an offensive name, behaviour, other); 10 a day each
//   GET  /admin/reports?status            the reports, grouped view: each with its target and how often they're reported
//   POST /admin/reports/:id/resolve       { action: dismiss | warn | rename | suspend | ban, days?, note } — every open
//                                         report of that player and kind closed with it; logged
//   GET  /admin/flags?status              accounts flagged by the abuse scan (abuse/detect.ts), highest score first
//   POST /admin/flags/:id                 { status: dismissed | actioned, note } — logged
//   POST /admin/abuse/scan                the scan now (it runs every hour by itself)
// The real-time server's (RT_SECRET in x-kr-internal; Phase 7 Step 5):
//   POST /internal/mp/flags               { key, kind: live-checks, uid, reasons, strikes, room, world, raceId?, phase? } a
//                                         player whose game kept sending car movement it couldn't accept: flagged, not kicked
// Nothing here bans anyone by itself: an admin decides, and says why.

import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { fromNodeHeaders } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { z } from '@kr/shared';
import type { Db } from '../db/index.ts';
import type { Auth } from '../auth.ts';
import type { Guards, RequestSession } from '../session.ts';
import { AppError, notFound } from '../errors.ts';
import { auditLog } from '../db/schema.ts';
import { randomTag } from '../names.ts';
import { scanForAbuse, maskIp, flagForReview, type AbuseRules } from '../abuse/detect.ts';
import { fileReport, REPORT_KINDS } from '../abuse/reports.ts';

export { REPORT_KINDS };
const ReportBody = z.object({
  targetName: z.string().trim().min(1).max(40).optional(), targetId: z.string().min(1).max(80).optional(),
  kind: z.enum(REPORT_KINDS), details: z.string().trim().min(5, 'Say what happened (a few words at least).').max(1000),
  ref: z.object({ eventId: z.string().max(80).optional(), replayId: z.string().max(80).optional(), resultId: z.coerce.string().max(40).optional(), place: z.string().max(80).optional() }).strict().optional(),
}).strict().refine(b => b.targetName || b.targetId, 'Say who: their name.');
const Reason = z.string().trim().min(3, 'Say why (it goes in the log).').max(500);
const Resolve = z.object({ action: z.enum(['dismiss', 'warn', 'rename', 'suspend', 'ban']), days: z.number().int().min(1).max(365).optional(), note: Reason }).strict();
const Review = z.object({ status: z.enum(['dismissed', 'actioned']), note: Reason }).strict();
const Status = z.object({ status: z.enum(['open', 'resolved', 'dismissed', 'actioned', 'all']).default('open'), limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function abuseRoutes(app0: FastifyInstance, { db, auth, G, rules, rtSecret }: { db: Db; auth: Auth; G: Guards; rules: AbuseRules; rtSecret: string }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const admin = G.requireRole('admin');
  const log = (s: NonNullable<RequestSession>, action: string, targetId: string | null, reason: string | null, details: object = {}) => db.insert(auditLog).values({ actorId: s.user.id, action, targetId, reason, details });
  const iso = (d: unknown) => d ? new Date(d as string).toISOString() : null;

  // ---------- a player's report ----------
  app.post('/reports', { schema: { body: ReportBody } }, async req => {
    const s = await G.requireTerms(req);
    return fileReport(db, s.user.id, req.body);
  });

  // ---------- the admins' queue: reports ----------
  app.get('/admin/reports', { config: { role: 'admin' }, schema: { querystring: Status } }, async req => {
    await admin(req);
    const st = req.query.status;
    const rows = (await db.execute(sql`select r.*, rep.name as reporter_name, u.name as current_name, u.email as target_email, u.banned, u.role,
        (select count(*) from reports x where x.target_id = r.target_id)::int as target_reports,
        (select count(distinct x.reporter_id) from reports x where x.target_id = r.target_id and x.status = 'open')::int as open_reporters
      from reports r join users u on u.id = r.target_id left join users rep on rep.id = r.reporter_id
      where (${st} = 'all' or r.status = ${st}) order by (r.status = 'open') desc, open_reporters desc, r.created_at desc limit ${req.query.limit}`)).rows as any[];
    return { reports: rows.map(r => ({ id: Number(r.id), kind: r.kind, details: r.details, ref: r.ref, status: r.status, createdAt: iso(r.created_at), reporter: r.reporter_id ? { id: r.reporter_id, name: r.reporter_name } : null,
      target: { id: r.target_id, nameReported: r.target_name, name: r.current_name, email: r.target_email, banned: !!r.banned, role: r.role, reports: r.target_reports, openReporters: r.open_reporters },
      resolution: r.resolution, note: r.note, resolvedAt: iso(r.resolved_at) })) };
  });
  app.post('/admin/reports/:id/resolve', { config: { role: 'admin' }, schema: { params: z.object({ id: z.coerce.number().int().positive() }), body: Resolve } }, async req => {
    const s = await admin(req), b = req.body;
    const rep = (await db.execute(sql`select * from reports where id = ${req.params.id}`)).rows[0] as any;
    if (!rep) throw notFound('That report');
    const target = (await db.execute(sql`select id, name, role from users where id = ${rep.target_id}`)).rows[0] as any;
    if (['rename', 'suspend', 'ban'].includes(b.action) && target.id === s.user.id) throw new AppError(400, 'BAD_REQUEST', 'You can\'t do that to your own account.');
    const call = async (fn: (h: Headers) => Promise<unknown>) => { try { await fn(fromNodeHeaders(req.headers)); } catch (e: any) { throw new AppError(400, 'BAD_REQUEST', e?.body?.message ?? e?.message ?? 'That didn\'t work.'); } };
    let details: object = {};
    if (b.action === 'rename') {
      // (an offensive name: replaced by a generated one; the player can choose a new one at once)
      const name = `Racer-${randomTag(5)}`;
      await db.execute(sql`update users set name = ${name}, name_changed_at = null, updated_at = now() where id = ${target.id}`);
      details = { from: target.name, to: name };
    } else if (b.action === 'suspend') {
      const days = b.days ?? 7;
      await call(h => auth.api.banUser({ body: { userId: target.id, banReason: b.note, banExpiresIn: days * 86400 }, headers: h }));
      details = { days };
    } else if (b.action === 'ban') {
      await call(h => auth.api.banUser({ body: { userId: target.id, banReason: b.note }, headers: h }));
    }
    const closed = (await db.execute(sql`update reports set status = 'resolved', resolution = ${b.action}, note = ${b.note}, resolved_by = ${s.user.id}, resolved_at = now()
      where target_id = ${target.id} and kind = ${rep.kind} and status = 'open' returning id`)).rows.length;
    await log(s, `report-${b.action}`, target.id, b.note, { report: Number(rep.id), kind: rep.kind, closed, ...details });
    return { ok: true as const, closed };
  });

  // ---------- the admins' queue: flags ----------
  app.get('/admin/flags', { config: { role: 'admin' }, schema: { querystring: Status } }, async req => {
    await admin(req);
    const st = req.query.status;
    const rows = (await db.execute(sql`select * from abuse_flags where (${st} = 'all' or status = ${st}) order by (status = 'open') desc, score desc, updated_at desc limit ${req.query.limit}`)).rows as any[];
    const ids = [...new Set(rows.flatMap(r => r.user_ids as string[]))];
    const users = ids.length ? (await db.execute(sql`select u.id, u.name, u.email, u.is_anonymous, u.created_at, u.banned, u.role,
        (select coalesce(sum(amount), 0) from ledger l where l.user_id = u.id and l.kind = 'reward')::bigint as earned,
        (select string_agg(distinct value, ', ') from account_signals s where s.user_id = u.id and s.kind = 'ip') as ips
      from users u where u.id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`)).rows as any[] : [];
    const byId = new Map(users.map(u => [u.id, { id: u.id, name: u.name, email: u.is_anonymous ? null : u.email, guest: !!u.is_anonymous, createdAt: iso(u.created_at), banned: !!u.banned, role: u.role, earned: Number(u.earned),
      addresses: String(u.ips ?? '').split(', ').filter(Boolean).slice(0, 5).map(maskIp) }]));
    return { flags: rows.map(r => ({ id: Number(r.id), kind: r.kind, score: r.score, status: r.status, evidence: r.evidence, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), note: r.note,
      accounts: (r.user_ids as string[]).map(id => byId.get(id) ?? { id, name: '(deleted)' }) })) };
  });
  app.post('/admin/flags/:id', { config: { role: 'admin' }, schema: { params: z.object({ id: z.coerce.number().int().positive() }), body: Review } }, async req => {
    const s = await admin(req);
    const r = (await db.execute(sql`update abuse_flags set status = ${req.body.status}, note = ${req.body.note}, reviewed_by = ${s.user.id}, reviewed_at = now(), updated_at = now() where id = ${req.params.id} returning user_ids, kind`)).rows[0] as any;
    if (!r) throw notFound('That flag');
    await log(s, `flag-${req.body.status}`, r.user_ids[0] ?? null, req.body.note, { flag: req.params.id, kind: r.kind, accounts: r.user_ids });
    return { ok: true as const };
  });
  app.post('/admin/abuse/scan', { config: { role: 'admin' } }, async req => {
    await admin(req);
    return { ok: true as const, ...(await scanForAbuse(db, rules)) };
  });

  // ---------- the real-time server's flags ----------
  const secret = Buffer.from(rtSecret);
  const LiveFlag = z.object({
    key: z.string().min(1).max(200), kind: z.literal('live-checks'), uid: z.string().min(1).max(80), reasons: z.record(z.string().max(60), z.number()).default({}),
    strikes: z.number().int().min(0).max(1e6).optional(), room: z.string().max(80).optional(), world: z.string().max(80).optional(), raceId: z.string().max(120).nullable().optional(), phase: z.string().max(20).nullable().optional(),
  });
  // (its key checked before the body is: nobody else learns what it takes)
  const internal = async (req: { headers: Record<string, unknown> }) => {
    const got = Buffer.from(String(req.headers['x-kr-internal'] ?? ''));
    if (got.length !== secret.length || !timingSafeEqual(got, secret)) throw new AppError(403, 'FORBIDDEN', 'Not for you.');
  };
  app.post('/internal/mp/flags', { config: { csrf: false, idempotent: false } as any, preValidation: internal, schema: { body: LiveFlag } }, async req => {
    const b = req.body, n = Object.values(b.reasons).reduce((a, x) => a + x, 0);
    // (more dropped states, a higher score: a bug in the game's physics shows as a few; a modified game as many)
    return flagForReview(db, { kind: 'live-checks', key: b.key, userIds: [b.uid], score: Math.min(80, 30 + Math.round(n / 10)),
      evidence: { reasons: b.reasons, strikes: n, room: b.room ?? null, world: b.world ?? null, raceId: b.raceId ?? null, phase: b.phase ?? null } });
  });
}
