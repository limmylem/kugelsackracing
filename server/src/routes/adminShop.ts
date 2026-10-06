// The shop on the admin page (Phase 6 Step 4): the catalogue — every part's and car's price, maker, whether it's
// for sale, its unlock rule, a limited-time window — kits, scheduled sales, the level locks and the used car lot's
// settings. Each change is one new version of the economy's settings (economy/config.ts: who made it and why, in
// the admins' log too; any version can be rolled back to from Economy settings). Plus a preview of a day's used
// lot (tomorrow's, by default — with settings not saved yet, to try them) and the shop's dashboard: what sells,
// what's spent where, what nobody buys.
//
//   GET  /admin/shop/catalogue                every item as the shop has it now, the kits, the sales, the settings
//   POST /admin/shop/catalogue                { change, reason, basedOn } → a new version
//   POST /admin/shop/used-lot/preview         { day?, settings? } → that day's lot
//   GET  /admin/shop/dashboard?days=30        top sellers, spend by category, items nobody bought

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { ShopChange, z } from '@kr/shared';
import type { Db } from '../db/index.ts';
import type { Guards } from '../session.ts';
import type { EconomyConfig } from '../economy/config.ts';
import { auditLog } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { activeSales, bundles as quoteBundles, dayOf, listPrice, makerOf, offer, usedLot } from '../../../garage/shop.js';

const admin = { config: { role: 'admin' as const } };
const DAY = 86_400_000;

export async function adminShopRoutes(app0: FastifyInstance, { db, config: econ, G, clock = () => Date.now() }: { db: Db; config: EconomyConfig; G: Guards; clock?: () => number }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const me = async (req: FastifyRequest) => { const s = await G.requireRole('admin')(req); return { id: s.user.id, name: s.user.name }; };
  const log = (actorId: string, action: string, reason: string | null, details: object = {}) => db.insert(auditLog).values({ actorId, action, targetId: null, reason, details });

  app.get('/admin/shop/catalogue', admin, async req => {
    await me(req);
    const g = await econ.gameDb(), game = g.db, now = clock(), shop = game.economy.shop ?? {};
    const item = (kind: 'part' | 'car', id: string, def: any) => {
      const o = offer(game, kind, id, now), e = shop.catalogue?.[kind === 'car' ? 'cars' : 'parts']?.[id] ?? {};
      return { id, name: def.name, ...(kind === 'part' ? { category: def.category, slot: def.slot, tier: def.tier ?? null, maker: makerOf(game, def), base: def.price } : { class: def.class ?? null, type: def.type ?? null, base: listPrice({ ...game, economy: { ...game.economy, shop: { ...shop, catalogue: {} } } }, 'car', id) }),
        list: o.list, price: o.price, forSale: o.forSale, why: o.why, sale: o.sale, unlock: o.unlock, own: e };
    };
    return {
      version: g.version, now: new Date(now).toISOString(),
      parts: Object.values(game.parts).map((p: any) => item('part', p.id, p)).sort((a: any, b: any) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
      cars: Object.values(game.cars).map((c: any) => item('car', c.id, c)),
      bundles: (shop.bundles ?? []).map((b: any) => ({ ...b, quote: quoteBundles(game, null, now).find((q: any) => q.id === b.id) ?? null })),
      sales: (shop.sales ?? []).map((s: any) => ({ ...s, on: activeSales(game, now).some((x: any) => x.id === s.id), over: !!s.ends && Date.parse(s.ends) <= now })),
      unlock: shop.unlock ?? {}, usedLot: shop.usedLot ?? {},
    };
  });

  // one change to the shop's settings, as a new version of the economy's settings
  app.post('/admin/shop/catalogue', { ...admin, schema: { body: ShopChange } }, async req => {
    const a = await me(req), active = await econ.active();
    if (req.body.basedOn !== active.version) throw new AppError(409, 'CONFLICT', `The settings changed while you were editing (now version ${active.version}): reload and make the change again.`);
    const data = JSON.parse(JSON.stringify(active.data)), shop = (data.economy.shop ??= {}), c: any = req.body.change, g = await econ.gameDb();
    let what = '';
    switch (c.op) {
      case 'item': {
        const def = c.kind === 'car' ? g.db.cars[c.id] : g.db.parts[c.id];
        if (!def) throw new AppError(404, 'NOT_FOUND', `There's no ${c.kind} "${c.id}".`);
        const book = ((shop.catalogue ??= {})[c.kind === 'car' ? 'cars' : 'parts'] ??= {}), entry = { ...(book[c.id] ?? {}) };
        for (const [k, v] of Object.entries(c.set)) { if (v === null || v === undefined) delete entry[k]; else entry[k] = v; }
        if (entry.from && entry.until && Date.parse(entry.until) <= Date.parse(entry.from)) throw new AppError(400, 'VALIDATION', 'A limited-time item has to end after it starts.');
        if (Object.keys(entry).length) book[c.id] = entry; else delete book[c.id];
        what = `${def.name}: ${Object.entries(c.set).map(([k, v]) => `${k} ${v === null ? 'back to its own' : JSON.stringify(v)}`).join(', ')}`;
        break;
      }
      case 'bundle': {
        for (const id of c.bundle.parts) if (!g.db.parts[id]) throw new AppError(400, 'VALIDATION', `There's no part "${id}".`);
        if (c.bundle.car && !g.db.cars[c.bundle.car]) throw new AppError(400, 'VALIDATION', `There's no car "${c.bundle.car}".`);
        const list = (shop.bundles ??= []), i = list.findIndex((b: any) => b.id === c.bundle.id);
        if (i >= 0) list[i] = c.bundle; else list.push(c.bundle);
        what = `Kit ${c.bundle.name} ${i >= 0 ? 'changed' : 'added'}`;
        break;
      }
      case 'bundle-remove': shop.bundles = (shop.bundles ?? []).filter((b: any) => b.id !== c.id); what = `Kit ${c.id} removed`; break;
      case 'sale': {
        const list = (shop.sales ??= []), i = list.findIndex((x: any) => x.id === c.sale.id);
        for (const id of c.sale.parts ?? []) if (!g.db.parts[id]) throw new AppError(400, 'VALIDATION', `There's no part "${id}".`);
        for (const id of c.sale.cars ?? []) if (!g.db.cars[id]) throw new AppError(400, 'VALIDATION', `There's no car "${id}".`);
        if (i >= 0) list[i] = c.sale; else list.push(c.sale);
        what = `Sale ${c.sale.name} (${Math.round(c.sale.discount * 100)}% off, ${c.sale.starts} to ${c.sale.ends}) ${i >= 0 ? 'changed' : 'scheduled'}`;
        break;
      }
      case 'sale-remove': shop.sales = (shop.sales ?? []).filter((x: any) => x.id !== c.id); what = `Sale ${c.id} removed`; break;
      case 'usedLot': shop.usedLot = c.settings; what = 'Used lot settings changed'; break;
      case 'unlock': shop.unlock = c.settings; what = 'Level locks changed'; break;
    }
    const version = await econ.change(data, { actorId: a.id, reason: `Shop: ${what}. ${req.body.reason}`, basedOn: active.version });
    await log(a.id, 'shop-change', req.body.reason, { version, change: c.op, what });
    return { ok: true, version };
  });

  // a day's used lot (tomorrow's unless another day is asked for), with the settings as they are or as they'd be
  app.post('/admin/shop/used-lot/preview', { ...admin, schema: { body: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), settings: z.record(z.string(), z.unknown()).optional() }).strict() } }, async req => {
    await me(req);
    const g = await econ.gameDb(), day = req.body.day ?? dayOf(clock() + DAY);
    const game = req.body.settings ? { ...g.db, economy: { ...g.db.economy, shop: { ...(g.db.economy.shop ?? {}), usedLot: req.body.settings } } } : g.db;
    if (req.body.settings) {
      const problems = (await import('../economy/config.ts')).gameData().then(d => d.validator.validate('economy.schema.json', game.economy));
      const p = await problems;
      if (p.length) throw new AppError(400, 'VALIDATION', `Those settings aren't right: ${p[0].path}: ${p[0].message}`);
    }
    return { day, listings: usedLot(game, day) };
  });

  // what sells, where money goes, what nobody buys
  app.get('/admin/shop/dashboard', { ...admin, schema: { querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) } }, async req => {
    await me(req);
    const days = req.query.days, g = await econ.gameDb(), game = g.db;
    const rows = (await db.execute(sql`select kind, amount, ref from ledger where kind in ('purchase', 'sale', 'refund') and at > now() - make_interval(days => ${days})`)).rows as any[];
    const bought = new Map<string, { kind: string; id: string; name: string; count: number; money: number }>(), byCategory = new Map<string, number>();
    let spent = 0, sold = 0, refunded = 0, refunds = 0;
    const add = (kind: string, id: string, name: string, money: number, n = 1) => { const k = `${kind}:${id}`, x = bought.get(k) ?? bought.set(k, { kind, id, name, count: 0, money: 0 }).get(k)!; x.count += n; x.money += money; };
    for (const r of rows) {
      const amount = Number(r.amount), ref = r.ref ?? {};
      if (r.kind === 'sale') { sold += amount; continue; }
      if (r.kind === 'refund') { refunded += amount; refunds++; continue; }
      spent -= amount;
      if (ref.bundleId) { add('kit', ref.bundleId, (game.economy.shop?.bundles ?? []).find((b: any) => b.id === ref.bundleId)?.name ?? ref.bundleId, -amount); byCategory.set('kits', (byCategory.get('kits') ?? 0) - amount); }
      else if (ref.listingId) { add('used car', ref.carId ?? '?', `${game.cars[ref.carId]?.name ?? ref.carId} (used)`, -amount); byCategory.set('used cars', (byCategory.get('used cars') ?? 0) - amount); }
      else if (ref.carId) { add('car', ref.carId, game.cars[ref.carId]?.name ?? ref.carId, -amount); byCategory.set('cars', (byCategory.get('cars') ?? 0) - amount); }
      else if (ref.partId) { const p = game.parts[ref.partId]; add('part', ref.partId, p?.name ?? ref.partId, -amount, Math.max(1, ref.instanceIds?.length ?? 1)); byCategory.set(p?.category ?? 'other', (byCategory.get(p?.category ?? 'other') ?? 0) - amount); }
      else if (ref.capacity) byCategory.set('garage space', (byCategory.get('garage space') ?? 0) - amount);
      else byCategory.set('other', (byCategory.get('other') ?? 0) - amount);
    }
    const now = clock(), forSale = Object.values(game.parts).filter((p: any) => offer(game, 'part', p.id, now).forSale);
    const never = forSale.filter((p: any) => !bought.has(`part:${p.id}`)).map((p: any) => ({ id: p.id, name: p.name, category: p.category, tier: p.tier ?? null, price: offer(game, 'part', p.id, now).price }));
    return {
      days, spent, sold, refunded, refunds,
      top: [...bought.values()].sort((a, b) => b.count - a.count || b.money - a.money).slice(0, 25),
      byCategory: [...byCategory].map(([category, money]) => ({ category, money })).sort((a, b) => b.money - a.money),
      neverBought: { count: never.length, of: forSale.length, items: never.sort((a: any, b: any) => b.price - a.price).slice(0, 60) },
      carsNeverBought: Object.values(game.cars).filter((c: any) => offer(game, 'car', c.id, now).forSale && !bought.has(`car:${c.id}`)).map((c: any) => ({ id: c.id, name: c.name })),
    };
  });
}
