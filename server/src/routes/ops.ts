// Running the game (Phase 6 Step 5; docs/OPERATIONS.md, docs/SUPPORT.md):
//   GET  /status                          public: up or not, maintenance and its message, the API's compatibility
//                                         number (the status page and the game's start-up check read it)
//   GET  /admin/settings · PUT /admin/settings/:key     the switches: features, maintenance, closedBeta, client
//   GET  /admin/invites · POST /admin/invites · POST /admin/invites/:code/revoke     the closed beta's codes
//   POST /support · POST /feedback        a player's message to the team, with the game's version and device
//   GET  /admin/support · POST /admin/support/:id · POST /admin/support/:id/reply
//   GET  /admin/players/:id/history       everything about a player in one place: the ledger, results, reports by and
//                                         about them, flags, support, the admins' actions
// Every admin change is in the audit log.

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { CLIENT_PROTOCOL, z } from '@kr/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import type { Guards, RequestSession } from '../session.ts';
import type { Mailer } from '../mail.ts';
import { AppError, notFound } from '../errors.ts';
import { auditLog } from '../db/schema.ts';
import { FEATURES, type SiteSettingsStore } from '../ops/settings.ts';
import { maskIp } from '../abuse/detect.ts';
import { runRetention } from '../ops/retention.ts';
import type { Metrics } from '../ops/metrics.ts';
import type { Health } from '../ops/alerts.ts';
import { sessionOf } from '../session.ts';
import type { Auth } from '../auth.ts';

const Reason = z.string().trim().min(3, 'Say why (it goes in the log).').max(500);
const Feature = z.object({ on: z.boolean(), message: z.string().max(300).default(''), percent: z.number().int().min(0).max(100).default(100) }).strict();
const SettingBody = z.discriminatedUnion('key', [
  z.object({ key: z.literal('features'), value: z.partialRecord(z.enum(Object.keys(FEATURES) as [keyof typeof FEATURES, ...(keyof typeof FEATURES)[]]), Feature), reason: Reason }).strict(),
  z.object({ key: z.literal('maintenance'), value: z.object({ on: z.boolean(), message: z.string().max(500).default(''), until: z.string().max(40).nullable().default(null) }).strict(), reason: Reason }).strict(),
  z.object({ key: z.literal('closedBeta'), value: z.object({ on: z.boolean() }).strict(), reason: Reason }).strict(),
  z.object({ key: z.literal('client'), value: z.object({ minProtocol: z.number().int().min(1).max(1_000_000) }).strict(), reason: Reason }).strict(),
]);
// the game's version and basic device info, as the support and feedback forms send them (nothing else is kept)
export const ClientInfo = z.object({
  version: z.string().max(80), protocol: z.number().int().optional(), url: z.string().max(300).optional(),
  userAgent: z.string().max(400).optional(), platform: z.string().max(80).optional(), language: z.string().max(40).optional(),
  screen: z.string().max(40).optional(), gpu: z.string().max(200).optional(), memoryGb: z.number().max(1024).optional(), fps: z.number().max(1000).optional(),
}).strict();
const SupportBody = z.object({
  category: z.enum(['account', 'payment', 'bug', 'cheating', 'progress', 'other']), message: z.string().trim().min(10, 'Tell us a little more (10 characters at least).').max(4000),
  contactEmail: z.email().max(254).optional(), client: ClientInfo,
}).strict();
const FeedbackBody = z.object({ message: z.string().trim().min(3).max(4000), mood: z.enum(['love', 'like', 'meh', 'dislike']).optional(), client: ClientInfo }).strict();
const TICKETS_PER_DAY = 5;

export async function opsRoutes(app0: FastifyInstance, { config, db, auth, G, mailer, settings, metrics, health }: { config: Config; db: Db; auth: Auth; G: Guards; mailer: Mailer; settings: SiteSettingsStore; metrics: Metrics; health: () => Promise<Health> }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const admin = G.requireRole('admin');
  const log = (s: NonNullable<RequestSession>, action: string, targetId: string | null, reason: string | null, details: object = {}) => db.insert(auditLog).values({ actorId: s.user.id, action, targetId, reason, details });
  const iso = (d: unknown) => d ? new Date(d as string).toISOString() : null;

  // ---------- the public status ----------
  app.get('/status', async (_req, reply) => {
    let db_ = true;
    try { await db.execute(sql`select 1`); } catch { db_ = false; }
    const S = await settings.get();
    reply.header('cache-control', 'no-store');
    return reply.status(db_ ? 200 : 503).send({
      ok: db_ && !S.maintenance.on, api: 'up', database: db_ ? 'up' : 'down', maintenance: S.maintenance, protocol: CLIENT_PROTOCOL, minProtocol: S.client.minProtocol,
      features: Object.fromEntries(Object.entries(S.features).map(([k, v]) => [k, v.on])), version: config.version, at: new Date().toISOString(),
    });
  });

  // ---------- the switches ----------
  app.get('/admin/settings', { config: { role: 'admin' } }, async req => {
    await admin(req);
    const rows = (await db.execute(sql`select s.key, s.updated_at, u.name as by from site_settings s left join users u on u.id = s.updated_by`)).rows as any[];
    return { settings: await settings.get(), features: FEATURES, protocol: CLIENT_PROTOCOL, changed: Object.fromEntries(rows.map(r => [r.key, { at: iso(r.updated_at), by: r.by ?? null }])) };
  });
  app.put('/admin/settings/:key', { config: { role: 'admin' }, schema: { params: z.object({ key: z.enum(['features', 'maintenance', 'closedBeta', 'client']) }), body: SettingBody } }, async req => {
    const s = await admin(req), b = req.body;
    if (b.key !== req.params.key) throw new AppError(400, 'BAD_REQUEST', 'The setting in the address and the body differ.');
    const now = await settings.get();
    const value = b.key === 'features' ? { ...now.features, ...b.value } : b.value;
    const after = await settings.set(b.key, value as any, s.user.id);
    await log(s, `setting-${b.key}`, null, b.reason, { from: now[b.key], to: after[b.key] });
    return { ok: true as const, settings: after };
  });

  // ---------- monitoring: the dashboard's numbers, and an external monitor's scrape ----------
  app.get('/admin/monitoring', { config: { role: 'admin' }, schema: { querystring: z.object({ minutes: z.coerce.number().int().min(10).max(360).default(120) }) } }, async req => {
    await admin(req);
    const one = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as any;
    const [h, players, money, queue, alerts, abuse] = await Promise.all([
      health(),
      one(sql`select (select count(*) from users)::int as accounts, (select count(*) from users where is_anonymous)::int as guests,
        (select count(distinct user_id) from sessions where updated_at > now() - interval '24 hours')::int as day, (select count(*) from users where created_at > now() - interval '24 hours')::int as new_today`),
      one(sql`select coalesce(sum(amount) filter (where amount > 0 and kind in ('reward', 'grant', 'start')), 0)::bigint as made, coalesce(sum(-amount) filter (where amount < 0), 0)::bigint as spent, count(*)::int as changes from ledger where at > now() - interval '24 hours'`),
      one(sql`select (select count(*) from track_results where at > now() - interval '1 hour')::int as results_hour, (select count(*) from track_results where at > now() - interval '1 hour' and not accepted)::int as refused_hour,
        (select count(*) from economy_sessions where state = 'active')::int as runs_active`),
      db.execute(sql`select key, state, message, first_at, last_at, count from alerts order by (state = 'firing') desc, last_at desc limit 20`).then(r => r.rows),
      one(sql`select (select count(*) from reports where status = 'open')::int as reports, (select count(*) from abuse_flags where status = 'open')::int as flags, (select count(*) from support_tickets where status = 'open')::int as support`),
    ]);
    return {
      now: metrics.window(5), hour: metrics.window(60), series: metrics.series(req.query.minutes), uptimeSec: metrics.uptimeSec(), version: config.version, env: config.env,
      database: h.db, verification: { ...h.queue, resultsLastHour: queue.results_hour, refusedLastHour: queue.refused_hour, runsActive: queue.runs_active },
      players: { accounts: players.accounts, guests: players.guests, activeDay: players.day, newToday: players.new_today },
      economy: { madeDay: Number(money.made), spentDay: Number(money.spent), changesDay: money.changes, madeLastHour: h.money.lastHour, normalHour: Math.round(h.money.weekHourly) },
      queues: abuse, alerts: (alerts as any[]).map(a => ({ key: a.key, state: a.state, message: a.message, since: iso(a.first_at), last: iso(a.last_at), count: a.count })),
      alertTo: { email: !!config.alertEmail, phone: !!config.alertWebhook },
    };
  });
  app.get('/metrics', async (req, reply) => {
    const token = config.metricsToken, given = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw notFound('That');
    if (given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) throw new AppError(401, 'UNAUTHENTICATED', 'A metrics token is needed.');
    const h = await health();
    reply.header('content-type', 'text/plain; version=0.0.4').header('cache-control', 'no-store');
    return metrics.prometheus({ kr_db_up: h.db.ok ? 1 : 0, kr_db_ms: h.db.ms, kr_db_waiting: h.db.waiting, kr_queue_waiting: h.queue.waiting, kr_queue_oldest_ms: h.queue.oldestMs, kr_money_made_hour: h.money.lastHour });
  });

  // ---------- keeping personal data only as long as needed (ops/retention.ts; it runs daily by itself) ----------
  app.post('/admin/retention', { config: { role: 'admin' }, schema: { body: z.object({ dryRun: z.boolean().default(true) }).strict() } }, async req => {
    const s = await admin(req), r = await runRetention(db, config.retention, { dryRun: req.body.dryRun });
    if (!req.body.dryRun) await log(s, 'retention-run', null, null, r.deleted);
    return { ok: true as const, ...r, rules: config.retention };
  });

  // ---------- the closed beta's invite codes ----------
  const newCode = () => Array.from(crypto.randomBytes(10), b => 'ABCDEFGHJKMNPQRSTVWXYZ23456789'[b % 30]).join('').replace(/(.{5})(?=.)/g, '$1-');
  app.get('/admin/invites', { config: { role: 'admin' } }, async req => {
    await admin(req);
    const rows = (await db.execute(sql`select c.*, u.name as by, (select json_agg(json_build_object('userId', i.user_id, 'name', x.name, 'at', i.used_at) order by i.used_at) from invite_uses i left join users x on x.id = i.user_id where i.code = c.code) as used_by
      from invite_codes c left join users u on u.id = c.created_by order by c.created_at desc limit 500`)).rows as any[];
    return { invites: rows.map(r => ({ code: r.code, note: r.note, maxUses: r.max_uses, uses: r.uses, expiresAt: iso(r.expires_at), revoked: r.revoked, createdAt: iso(r.created_at), createdBy: r.by, usedBy: r.used_by ?? [] })) };
  });
  app.post('/admin/invites', { config: { role: 'admin' }, schema: { body: z.object({ count: z.number().int().min(1).max(200).default(1), maxUses: z.number().int().min(1).max(1000).default(1), days: z.number().int().min(1).max(365).nullable().default(30), note: z.string().trim().max(200).default('') }).strict() } }, async req => {
    const s = await admin(req), b = req.body, codes: string[] = [];
    for (let i = 0; i < b.count; i++) {
      const code = newCode();
      await db.execute(sql`insert into invite_codes (code, note, max_uses, expires_at, created_by) values (${code}, ${b.note || null}, ${b.maxUses}, ${b.days ? sql`now() + make_interval(days => ${b.days})` : null}, ${s.user.id})`);
      codes.push(code);
    }
    await log(s, 'invites-created', null, b.note || null, { count: b.count, maxUses: b.maxUses, days: b.days });
    return { ok: true as const, codes };
  });
  app.post('/admin/invites/:code/revoke', { config: { role: 'admin' }, schema: { params: z.object({ code: z.string().max(40) }), body: z.object({ reason: Reason }).strict() } }, async req => {
    const s = await admin(req);
    const r = (await db.execute(sql`update invite_codes set revoked = true where code = ${req.params.code} returning code`)).rows[0];
    if (!r) throw notFound('That code');
    await log(s, 'invite-revoked', null, req.body.reason, { code: req.params.code });
    return { ok: true as const };
  });

  // ---------- support and feedback ----------
  const ticket = async (req: any, kind: 'support' | 'feedback', b: { category?: string; message: string; contactEmail?: string; client: object; mood?: string }) => {
    const s = await G.requireUser(req);
    const today = Number(((await db.execute(sql`select count(*) as n from support_tickets where user_id = ${s.user.id} and created_at > now() - interval '24 hours'`)).rows[0] as any).n);
    if (today >= TICKETS_PER_DAY) throw new AppError(429, 'RATE_LIMITED', 'You\'ve sent several messages today: we\'ll answer those first.');
    const contact = s.user.isAnonymous ? (b.contactEmail ?? null) : null;
    const r = (await db.execute(sql`insert into support_tickets (user_id, kind, category, message, contact_email, client) values (${s.user.id}, ${kind}, ${b.category ?? b.mood ?? null}, ${b.message}, ${contact}, ${JSON.stringify(b.client)}::jsonb) returning id`)).rows[0] as any;
    return { ok: true as const, id: Number(r.id) };
  };
  app.post('/support', { schema: { body: SupportBody } }, async req => ticket(req, 'support', req.body));
  app.post('/feedback', { schema: { body: FeedbackBody } }, async req => ticket(req, 'feedback', req.body));
  app.get('/admin/support', { config: { role: 'admin' }, schema: { querystring: z.object({ kind: z.enum(['support', 'feedback', 'all']).default('all'), status: z.enum(['open', 'closed', 'all']).default('open'), limit: z.coerce.number().int().min(1).max(500).default(100) }) } }, async req => {
    await admin(req);
    const q = req.query;
    const rows = (await db.execute(sql`select t.*, u.name, u.email, u.is_anonymous from support_tickets t left join users u on u.id = t.user_id
      where (${q.kind} = 'all' or t.kind = ${q.kind}) and (${q.status} = 'all' or t.status = ${q.status}) order by t.created_at desc limit ${q.limit}`)).rows as any[];
    return { tickets: rows.map(r => ({ id: Number(r.id), kind: r.kind, category: r.category, message: r.message, client: r.client, status: r.status, createdAt: iso(r.created_at), note: r.note,
      player: r.user_id ? { id: r.user_id, name: r.name, email: r.is_anonymous ? r.contact_email : r.email, guest: !!r.is_anonymous } : null })) };
  });
  app.post('/admin/support/:id', { config: { role: 'admin' }, schema: { params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ status: z.enum(['open', 'closed']), note: z.string().trim().max(2000).default('') }).strict() } }, async req => {
    const s = await admin(req);
    const r = (await db.execute(sql`update support_tickets set status = ${req.body.status}, note = ${req.body.note || null}, handled_by = ${s.user.id}, handled_at = now() where id = ${req.params.id} returning user_id`)).rows[0] as any;
    if (!r) throw notFound('That message');
    await log(s, `support-${req.body.status}`, r.user_id, req.body.note || null, { ticket: req.params.id });
    return { ok: true as const };
  });
  app.post('/admin/support/:id/reply', { config: { role: 'admin' }, schema: { params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ message: z.string().trim().min(3).max(4000), close: z.boolean().default(true) }).strict() } }, async req => {
    const s = await admin(req);
    const t = (await db.execute(sql`select t.*, u.email, u.is_anonymous, u.name from support_tickets t left join users u on u.id = t.user_id where t.id = ${req.params.id}`)).rows[0] as any;
    if (!t) throw notFound('That message');
    const to = t.is_anonymous ? t.contact_email : t.email;
    if (!to) throw new AppError(400, 'BAD_REQUEST', 'This player left no email address to answer (a guest who didn\'t give one).');
    const esc = (x: string) => x.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    await mailer.send({ kind: 'support-reply', to, subject: `Re: your message to Kugelsack Racing (#${t.id})`,
      text: `Hi ${t.name ?? ''},\n\n${req.body.message}\n\n— The Kugelsack Racing team\n\n(You wrote: ${t.message.slice(0, 500)})`,
      html: `<p>Hi ${esc(t.name ?? '')},</p><p>${esc(req.body.message).replace(/\n/g, '<br>')}</p><p>— The Kugelsack Racing team</p><blockquote>${esc(t.message.slice(0, 500))}</blockquote>` });
    await db.execute(sql`update support_tickets set status = ${req.body.close ? 'closed' : 'open'}, note = concat_ws(E'\n', note, ${`Replied ${new Date().toISOString().slice(0, 16)}: ${req.body.message.slice(0, 500)}`}::text), handled_by = ${s.user.id}, handled_at = now() where id = ${req.params.id}`);
    await log(s, 'support-reply', t.user_id, null, { ticket: req.params.id });
    return { ok: true as const };
  });

  // ---------- one player's whole history (support, abuse review) ----------
  app.get('/admin/players/:id/history', { config: { role: 'admin' }, schema: { params: z.object({ id: z.string().min(1).max(80) }) } }, async req => {
    const s = await admin(req), id = req.params.id;
    const one = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as any[];
    const [u] = await one(sql`select id, name, email, is_anonymous, role, banned, ban_reason, ban_expires, created_at, two_factor_enabled, terms_version from users where id = ${id}`);
    if (!u) throw notFound('That player');
    await log(s, 'view-history', id, null);
    const [money] = await one(sql`select balance, xp, level from player_economy where user_id = ${id}`);
    return {
      player: { id: u.id, name: u.name, email: u.is_anonymous ? null : u.email, guest: !!u.is_anonymous, role: u.role, banned: !!u.banned, banReason: u.ban_reason, banExpires: iso(u.ban_expires), createdAt: iso(u.created_at), twoFactor: !!u.two_factor_enabled, money: money ? Number(money.balance) : null, xp: money ? Number(money.xp) : null, level: money?.level ?? null },
      ledger: (await one(sql`select id, amount, balance_after, kind, reason, actor_id, at from ledger where user_id = ${id} order by id desc limit 200`)).map(r => ({ id: Number(r.id), amount: Number(r.amount), balanceAfter: Number(r.balance_after), kind: r.kind, reason: r.reason, byAdmin: !!r.actor_id, at: iso(r.at) })),
      results: (await one(sql`select id, event_id, code, car_class, time, rank, score, accepted, problems, at from track_results where user_id = ${id} order by at desc limit 100`)).map(r => ({ id: Number(r.id), eventId: r.event_id, code: r.code, carClass: r.car_class, time: r.time, place: r.rank, score: r.score, accepted: r.accepted, problems: r.problems, at: iso(r.at) })),
      reportsAbout: (await one(sql`select r.id, r.kind, r.details, r.status, r.resolution, r.created_at, x.name as reporter from reports r left join users x on x.id = r.reporter_id where r.target_id = ${id} order by r.created_at desc limit 100`)).map(r => ({ id: Number(r.id), kind: r.kind, details: r.details, status: r.status, resolution: r.resolution, reporter: r.reporter, at: iso(r.created_at) })),
      reportsBy: (await one(sql`select id, kind, target_name, status, created_at from reports where reporter_id = ${id} order by created_at desc limit 100`)).map(r => ({ id: Number(r.id), kind: r.kind, target: r.target_name, status: r.status, at: iso(r.created_at) })),
      flags: (await one(sql`select id, kind, score, status, evidence, created_at, note from abuse_flags where ${id} = any(user_ids) order by created_at desc limit 50`)).map(r => ({ id: Number(r.id), kind: r.kind, score: r.score, status: r.status, evidence: r.evidence, note: r.note, at: iso(r.created_at) })),
      support: (await one(sql`select id, kind, category, message, status, note, created_at from support_tickets where user_id = ${id} order by created_at desc limit 100`)).map(r => ({ id: Number(r.id), kind: r.kind, category: r.category, message: r.message, status: r.status, note: r.note, at: iso(r.created_at) })),
      adminActions: (await one(sql`select a.id, a.action, a.reason, a.details, a.at, x.name as by from audit_log a left join users x on x.id = a.actor_id where a.target_id = ${id} order by a.id desc limit 200`)).map(r => ({ id: Number(r.id), action: r.action, reason: r.reason, details: r.details, by: r.by, at: iso(r.at) })),
      linkedAccounts: (await one(sql`select distinct o.user_id, x.name, s.kind from account_signals s join account_signals o on o.kind = s.kind and o.value = s.value and o.user_id <> s.user_id join users x on x.id = o.user_id where s.user_id = ${id} limit 50`)).map(r => ({ id: r.user_id, name: r.name, via: r.kind })),
      addresses: (await one(sql`select value, first_seen, last_seen from account_signals where user_id = ${id} and kind = 'ip' order by last_seen desc limit 20`)).map(r => ({ address: maskIp(r.value), firstSeen: iso(r.first_seen), lastSeen: iso(r.last_seen) })),
    };
  });
  void sessionOf; void auth;
}
