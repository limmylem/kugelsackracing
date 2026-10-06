// The admins' economy tools (Phase 6 Step 2; the admin page): a player's ledger, cars, parts and builds,
// with each item's history; money granted or taken away, items given or removed, a transaction reversed —
// always with a written reason, each in the admins' log; the economy's settings (every version, who changed
// what and why, a change, a rollback); the dashboard (money earned and spent a day by where it came from,
// all the money in the game, the average balance by level, players earning far more than normal).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { AdminItem, AdminMoney, AdminReverse, EconomyChange, z } from '@kr/shared';
import type { Db } from '../db/index.ts';
import type { Guards } from '../session.ts';
import type { Economy } from '../economy/service.ts';
import type { EconomyConfig } from '../economy/config.ts';
import { auditLog } from '../db/schema.ts';
import { AppError, notFound } from '../errors.ts';

const Id = z.object({ id: z.string().min(1).max(80) });
const admin = { config: { role: 'admin' as const } };

export async function adminEconomyRoutes(app0: FastifyInstance, { db, economy, config: econ, G }: { db: Db; economy: Economy; config: EconomyConfig; G: Guards }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const me = async (req: FastifyRequest) => { const s = await G.requireRole('admin')(req); return { id: s.user.id, name: s.user.name }; };
  const log = (actorId: string, action: string, targetId: string | null, reason: string | null, details: object = {}) => db.insert(auditLog).values({ actorId, action, targetId, reason, details });
  const user = async (id: string) => { const u = (await db.execute(sql`select id, name from users where id = ${id}`)).rows[0]; if (!u) throw notFound('That player'); return u as any; };

  // ---------- a player's economy ----------
  app.get('/admin/players/:id/economy', { ...admin, schema: { params: Id, querystring: z.object({ ledgerBefore: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }) } }, async req => {
    const a = await me(req), u = await user(req.params.id);
    const e = (await db.execute(sql`select balance, xp, level, rev, current_car, updated_at from player_economy where user_id = ${u.id}`)).rows[0] as any;
    const ledger = (await db.execute(sql`select l.*, x.name as actor_name from ledger l left join users x on x.id = l.actor_id where l.user_id = ${u.id} ${req.query.ledgerBefore ? sql`and l.id < ${req.query.ledgerBefore}` : sql``} order by l.id desc limit ${req.query.limit}`)).rows as any[];
    const cars = (await db.execute(sql`select * from owned_cars where user_id = ${u.id} order by created_at`)).rows as any[];
    const parts = (await db.execute(sql`select p.*, s.car_instance_id, s.socket from owned_parts p left join car_build_slots s on s.user_id = p.user_id and s.part_instance_id = p.instance_id where p.user_id = ${u.id} order by p.created_at`)).rows as any[];
    const sessions = (await db.execute(sql`select id, kind, quest_id, fee, state, end_reason, paid, damage_reports, started_at, ended_at from economy_sessions where user_id = ${u.id} order by started_at desc limit 50`)).rows;
    const reversed = new Set(((await db.execute(sql`select reverses from ledger where user_id = ${u.id} and reverses is not null`)).rows as any[]).map(r => Number(r.reverses)));
    await log(a.id, 'view-economy', u.id, null);
    return {
      player: { id: u.id, name: u.name }, economy: e ? { balance: Number(e.balance), xp: Number(e.xp), level: e.level, rev: Number(e.rev), currentCar: e.current_car, updatedAt: e.updated_at } : null,
      ledger: ledger.map(r => ({ id: Number(r.id), amount: Number(r.amount), balanceAfter: Number(r.balance_after), kind: r.kind, reason: r.reason, ref: r.ref, sessionId: r.session_id, actor: r.actor_name ?? null, reverses: r.reverses ? Number(r.reverses) : null, reversed: reversed.has(Number(r.id)), at: new Date(r.at).toISOString() })),
      cars: cars.map(c => ({ instanceId: c.instance_id, carId: c.car_id, price: Number(c.price), damage: c.damage ? { condition: c.damage.condition ?? 100, broken: c.damage.broken ?? [] } : null, setups: Object.keys(c.setups ?? {}).length, acquiredAt: c.created_at })),
      parts: parts.map(p => ({ instanceId: p.instance_id, partId: p.part_id, condition: Number(p.condition), attach: p.attach, mechanical: !!p.damage, car: p.car_instance_id ?? null, socket: p.socket ?? null, acquiredAt: p.created_at })),
      sessions,
    };
  });
  app.get('/admin/players/:id/items/:item/history', { ...admin, schema: { params: z.object({ id: z.string().max(80), item: z.string().max(80) }) } }, async req => {
    await me(req);
    const rows = (await db.execute(sql`select event, details, ledger_id, at from item_history where user_id = ${req.params.id} and instance_id = ${req.params.item} order by id`)).rows as any[];
    return { history: rows.map(r => ({ event: r.event, details: r.details, ledgerId: r.ledger_id ? Number(r.ledger_id) : null, at: new Date(r.at).toISOString() })) };
  });

  // ---------- putting things right by hand ----------
  app.post('/admin/players/:id/money', { ...admin, schema: { params: Id, body: AdminMoney } }, async req => {
    const a = await me(req), u = await user(req.params.id);
    const r = await economy.adminMoney(a, u.id, req.body.amount, req.body.reason);
    await log(a.id, req.body.amount > 0 ? 'grant-money' : 'remove-money', u.id, req.body.reason, { amount: req.body.amount, ledgerId: r.ledgerId });
    return r;
  });
  app.post('/admin/players/:id/items', { ...admin, schema: { params: Id, body: AdminItem } }, async req => {
    const a = await me(req), u = await user(req.params.id), { reason, ...op } = req.body;
    const r = await economy.adminItem(a, u.id, op, reason);
    await log(a.id, op.give ? 'give-item' : 'remove-item', u.id, reason, op);
    return r;
  });
  app.post('/admin/ledger/:id/reverse', { ...admin, schema: { params: z.object({ id: z.coerce.number().int().positive() }), body: AdminReverse } }, async req => {
    const a = await me(req);
    const r = await economy.adminReverse(a, req.params.id, req.body.reason);
    await log(a.id, 'reverse-transaction', r.userId, req.body.reason, { ledgerId: req.params.id, reversal: r.ledgerId });
    return r;
  });

  // ---------- the economy's settings ----------
  app.get('/admin/economy/config', { ...admin, schema: { querystring: z.object({ version: z.coerce.number().int().positive().optional() }) } }, async req => {
    await me(req);
    const active = await econ.active();
    const history = (await econ.history()).map(h => ({ ...h, data: undefined }));
    return { active: active.version, current: req.query.version ? await econ.get(req.query.version) : await econ.get(active.version), history };
  });
  app.post('/admin/economy/config', { ...admin, schema: { body: EconomyChange } }, async req => {
    const a = await me(req), active = await econ.active();
    if (req.body.basedOn !== active.version) throw new AppError(409, 'CONFLICT', `The settings changed while you were editing (now version ${active.version}): reload them and make the change again.`);
    const version = await econ.change(req.body.data as any, { actorId: a.id, reason: req.body.reason, basedOn: req.body.basedOn });
    await log(a.id, 'economy-config', null, req.body.reason, { version, basedOn: req.body.basedOn, changed: changedPaths(active.data, req.body.data).slice(0, 50) });
    return { ok: true, version };
  });
  app.post('/admin/economy/config/:version/rollback', { ...admin, schema: { params: z.object({ version: z.coerce.number().int().positive() }), body: AdminReverse } }, async req => {
    const a = await me(req);
    const version = await econ.rollback(req.params.version, { actorId: a.id, reason: req.body.reason });
    await log(a.id, 'economy-rollback', null, req.body.reason, { to: req.params.version, version });
    return { ok: true, version };
  });

  // ---------- the dashboard ----------
  app.get('/admin/economy/dashboard', { ...admin, schema: { querystring: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }) } }, async req => {
    await me(req);
    const days = req.query.days;
    const daily = (await db.execute(sql`select date_trunc('day', at) as day, kind, sum(case when amount > 0 then amount else 0 end)::bigint as earned, sum(case when amount < 0 then -amount else 0 end)::bigint as spent, count(*)::int as n
      from ledger where at > now() - make_interval(days => ${days}) group by 1, 2 order by 1, 2`)).rows as any[];
    const totals = (await db.execute(sql`select coalesce(sum(balance), 0)::bigint as money, count(*)::int as players, coalesce(avg(balance), 0)::float as average from player_economy`)).rows[0] as any;
    const byLevel = (await db.execute(sql`select level, count(*)::int as players, avg(balance)::float as average from player_economy group by level order by level`)).rows as any[];
    // (unusual: earned in the last day far more than players normally do — over five times the 95th percentile, and over the economy's own floor)
    const unusual = (await db.execute(sql`with earned as (select user_id, sum(amount)::bigint as earned, count(*)::int as n from ledger where amount > 0 and kind not in ('start', 'grant', 'reversal') and at > now() - interval '1 day' group by user_id),
      p as (select coalesce(percentile_cont(0.95) within group (order by earned), 0) as p95 from earned)
      select e.user_id, u.name, e.earned, e.n, p.p95 from earned e, p join lateral (select name from users where id = e.user_id) u on true
      where e.earned > greatest(p.p95 * 5, 50000) order by e.earned desc limit 50`)).rows as any[];
    const bigGrants = (await db.execute(sql`select l.user_id, u.name, l.amount, l.reason, l.at, a.name as actor from ledger l join users u on u.id = l.user_id left join users a on a.id = l.actor_id where l.kind in ('grant', 'removal', 'reversal') and l.at > now() - interval '7 days' order by l.at desc limit 20`)).rows as any[];
    return {
      days: daily.map(r => ({ day: new Date(r.day).toISOString().slice(0, 10), source: r.kind, earned: Number(r.earned), spent: Number(r.spent), count: r.n })),
      totalMoney: Number(totals.money), players: totals.players, averageBalance: Math.round(totals.average),
      byLevel: byLevel.map(r => ({ level: r.level, players: r.players, averageBalance: Math.round(r.average) })),
      alerts: [
        ...unusual.map(r => ({ kind: 'earning', playerId: r.user_id, name: r.name, text: `${r.name} earned ${Number(r.earned).toLocaleString('en-GB')} in the last day (${r.n} payments; most players earn under ${Math.round(r.p95).toLocaleString('en-GB')})` })),
        ...bigGrants.map(r => ({ kind: 'admin', playerId: r.user_id, name: r.name, text: `${r.actor ?? 'An admin'} ${Number(r.amount) > 0 ? 'gave' : 'took'} ${Math.abs(Number(r.amount)).toLocaleString('en-GB')} ${Number(r.amount) > 0 ? 'to' : 'from'} ${r.name}: ${r.reason}` })),
      ],
      ledgerMismatches: (await economy.ledgerCheck()).length,
    };
  });
}

// (what a settings change touched: the paths whose values differ)
function changedPaths(a: any, b: any, at = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return [at || '(all)'];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => changedPaths(a[k], b[k], at ? `${at}.${k}` : k));
}
