// A player's economy as tables, and as the game's profile (garage/player/profile.js) — both ways. The
// server's player service works on the profile (the game's own rules, unchanged); what it changed is
// written back to the tables, and the money it moved goes in the ledger as one row with what it was for.
//
//   loadProfile(tx, userId) → the profile as saved (packed: garage/player/profile.js packProfile) or null
//   saveProfile(tx, userId, before, after, { kind, reason, ref, sessionId, idemKey, actorId, action })
//     → { ledgerId, delta, rev }
//
// Money: profile.money is the ledger's balance; a change to it is a ledger row (the database's trigger moves
// the balance — never the app). The rest of the save that isn't cars, parts, builds or quests (hints, the
// quest log, the track library and its farming counts) is the state column.

import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { levelOf } from '../../../quest/rules.js';

type Tx = Pick<Db, 'execute'>;
const CORE = new Set(['version', 'money', 'nextId', 'currentCar', 'xp', 'quests', 'cars', 'parts']);
// (a car's or part's own columns; anything else it carries — bodyPrice, boughtAt, used — is its extra)
const CAR_COLS = new Set(['carInstanceId', 'carId', 'price', 'paint', 'damage', 'activeSetup', 'setups']);
const PART_COLS = new Set(['instanceId', 'partId', 'condition', 'price', 'tuning', 'paint', 'damage', 'dentLog', 'dents', 'attach', 'installedOn']);
const extraOf = (x: any, cols: Set<string>) => { const e = Object.fromEntries(Object.entries(x ?? {}).filter(([k, v]) => !cols.has(k) && v !== undefined)); return Object.keys(e).length ? e : null; };
const j = (x: unknown) => x === undefined || x === null ? null : JSON.stringify(x);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function loadProfile(tx: Tx, userId: string): Promise<any | null> {
  const e = (await tx.execute(sql`select * from player_economy where user_id = ${userId}`)).rows[0] as any;
  if (!e) return null;
  const [cars, parts, slots, quests] = await Promise.all([
    tx.execute(sql`select * from owned_cars where user_id = ${userId}`),
    tx.execute(sql`select * from owned_parts where user_id = ${userId}`),
    tx.execute(sql`select * from car_build_slots where user_id = ${userId}`),
    tx.execute(sql`select quest_id, data from quest_progress where user_id = ${userId}`),
  ]);
  const on = new Map((slots.rows as any[]).map(s => [s.part_instance_id, { car: s.car_instance_id, socket: s.socket }]));
  const profile: any = {
    ...(e.state ?? {}), version: e.profile_version, money: Number(e.balance), nextId: e.next_id, currentCar: e.current_car, ...(Number(e.xp) ? { xp: Number(e.xp) } : {}),
    cars: Object.fromEntries((cars.rows as any[]).map(c => [c.instance_id, {
      carInstanceId: c.instance_id, carId: c.car_id, price: Number(c.price), ...(c.paint ? { paint: c.paint } : {}), ...(c.damage ? { damage: c.damage } : {}),
      activeSetup: c.active_setup, setups: c.setups ?? {}, ...(c.extra ?? {}),
    }])),
    parts: Object.fromEntries((parts.rows as any[]).map(p => [p.instance_id, {
      instanceId: p.instance_id, partId: p.part_id, condition: Number(p.condition), price: Number(p.price),
      ...(p.tuning ? { tuning: p.tuning } : {}), ...(p.paint ? { paint: p.paint } : {}), ...(p.damage ? { damage: p.damage } : {}),
      ...(p.dent_log ? { dentLog: p.dent_log } : {}), ...(p.attach ? { attach: p.attach } : {}), installedOn: on.get(p.instance_id) ?? null, ...(p.extra ?? {}),
    }])),
  };
  if ((quests.rows as any[]).length) profile.quests = Object.fromEntries((quests.rows as any[]).map(q => [q.quest_id, q.data]));
  profile.__rev = Number(e.rev);
  return profile;
}

export type SaveMeta = { kind: string; reason: string; ref?: Record<string, unknown>; sessionId?: string | null; idemKey?: string | null; actorId?: string | null; action: string; questsConfig?: any };

export async function saveProfile(tx: Tx, userId: string, before: any | null, after: any, meta: SaveMeta) {
  const rev = (before?.__rev ?? 0) + 1;
  const state = Object.fromEntries(Object.entries(after).filter(([k]) => !CORE.has(k) && k !== '__rev'));
  const level = meta.questsConfig ? levelOf(after.xp ?? 0, meta.questsConfig) : 1;
  if (!before) {
    await tx.execute(sql`insert into player_economy (user_id, balance, xp, level, rev, profile_version, next_id, current_car, state)
      values (${userId}, 0, ${after.xp ?? 0}, ${level}, ${rev}, ${after.version}, ${after.nextId}, ${after.currentCar}, ${JSON.stringify(state)}::jsonb)`);
  } else {
    await tx.execute(sql`update player_economy set xp = ${after.xp ?? 0}, level = ${level}, rev = ${rev}, profile_version = ${after.version}, next_id = ${after.nextId},
      current_car = ${after.currentCar}, state = ${JSON.stringify(state)}::jsonb, updated_at = now() where user_id = ${userId}`);
  }
  const history: { type: string; id: string; event: string; details: object }[] = [];

  // ---------- cars ----------
  const bc = before?.cars ?? {}, ac = after.cars ?? {};
  for (const id of Object.keys(bc)) if (!ac[id]) { await tx.execute(sql`delete from owned_cars where user_id = ${userId} and instance_id = ${id}`); history.push({ type: 'car', id, event: `${meta.action}: gone`, details: { carId: bc[id].carId } }); }
  for (const [id, c] of Object.entries<any>(ac)) {
    const was = bc[id];
    if (was && same(was, c)) continue;
    await tx.execute(sql`insert into owned_cars (user_id, instance_id, car_id, price, paint, damage, active_setup, setups, extra)
      values (${userId}, ${id}, ${c.carId}, ${Math.round(c.price ?? 0)}, ${j(c.paint)}::jsonb, ${j(c.damage)}::jsonb, ${c.activeSetup ?? null}, ${JSON.stringify(c.setups ?? {})}::jsonb, ${j(extraOf(c, CAR_COLS))}::jsonb)
      on conflict (user_id, instance_id) do update set car_id = excluded.car_id, price = excluded.price, paint = excluded.paint, damage = excluded.damage, active_setup = excluded.active_setup, setups = excluded.setups, extra = excluded.extra`);
    history.push({ type: 'car', id, event: was ? meta.action : `${meta.action}: new`, details: was ? changedKeys(was, c) : { carId: c.carId } });
  }
  // ---------- parts (and where each is: the build) ----------
  const bp = before?.parts ?? {}, ap = after.parts ?? {};
  // (slots first out of the way: a part moving between cars — the unique index holds at every statement)
  const slotOf = (p: any) => p?.installedOn ? `${p.installedOn.car}|${p.installedOn.socket}` : null;
  for (const [id, p] of Object.entries<any>(bp)) if (slotOf(p) && slotOf(p) !== slotOf(ap[id])) await tx.execute(sql`delete from car_build_slots where user_id = ${userId} and part_instance_id = ${id}`);
  for (const id of Object.keys(bp)) if (!ap[id]) { await tx.execute(sql`delete from owned_parts where user_id = ${userId} and instance_id = ${id}`); history.push({ type: 'part', id, event: `${meta.action}: gone`, details: { partId: bp[id].partId } }); }
  for (const [id, p] of Object.entries<any>(ap)) {
    const was = bp[id], strip = (x: any) => x && { ...x, installedOn: null };
    if (!was || !same(strip(was), strip(p))) {
      await tx.execute(sql`insert into owned_parts (user_id, instance_id, part_id, condition, price, tuning, paint, damage, dent_log, attach, extra)
        values (${userId}, ${id}, ${p.partId}, ${Math.max(0, Math.min(100, Number(p.condition)))}, ${Math.round(p.price ?? 0)}, ${j(p.tuning)}::jsonb, ${j(p.paint)}::jsonb, ${j(p.damage)}::jsonb, ${j(p.dentLog)}::jsonb, ${p.attach ?? null}, ${j(extraOf(p, PART_COLS))}::jsonb)
        on conflict (user_id, instance_id) do update set part_id = excluded.part_id, condition = excluded.condition, price = excluded.price, tuning = excluded.tuning, paint = excluded.paint, damage = excluded.damage, dent_log = excluded.dent_log, attach = excluded.attach, extra = excluded.extra`);
      history.push({ type: 'part', id, event: was ? meta.action : `${meta.action}: new`, details: was ? changedKeys(strip(was), strip(p)) : { partId: p.partId, condition: p.condition } });
    }
    if (slotOf(p) && slotOf(p) !== slotOf(was)) {
      await tx.execute(sql`insert into car_build_slots (user_id, car_instance_id, socket, part_instance_id) values (${userId}, ${p.installedOn.car}, ${p.installedOn.socket}, ${id})`);
      history.push({ type: 'part', id, event: `${meta.action}: fitted`, details: { car: p.installedOn.car, socket: p.installedOn.socket } });
    } else if (was && slotOf(was) && !slotOf(p)) history.push({ type: 'part', id, event: `${meta.action}: taken off`, details: { car: was.installedOn.car, socket: was.installedOn.socket } });
  }
  // ---------- quests ----------
  const bq = before?.quests ?? {}, aq = after.quests ?? {};
  for (const id of Object.keys(bq)) if (!aq[id]) await tx.execute(sql`delete from quest_progress where user_id = ${userId} and quest_id = ${id}`);
  for (const [id, q] of Object.entries<any>(aq)) if (!same(bq[id], q)) await tx.execute(sql`insert into quest_progress (user_id, quest_id, medal, data) values (${userId}, ${id}, ${q.medal ?? null}, ${JSON.stringify(q)}::jsonb)
    on conflict (user_id, quest_id) do update set medal = excluded.medal, data = excluded.data`);

  // ---------- money: the ledger ----------
  const delta = Math.round(after.money) - Math.round(before?.money ?? 0);
  let ledgerId: number | null = null;
  if (delta !== 0) {
    const r = (await tx.execute(sql`insert into ledger (user_id, amount, balance_after, kind, reason, ref, session_id, idem_key, actor_id)
      values (${userId}, ${delta}, ${Math.round(after.money)}, ${meta.kind}, ${meta.reason}, ${JSON.stringify(meta.ref ?? {})}::jsonb, ${meta.sessionId ?? null}, ${meta.idemKey ?? null}, ${meta.actorId ?? null}) returning id`)).rows[0] as any;
    ledgerId = Number(r.id);
  }
  for (const h of history) await tx.execute(sql`insert into item_history (user_id, item_type, instance_id, event, details, ledger_id) values (${userId}, ${h.type}, ${h.id}, ${h.event}, ${JSON.stringify(h.details)}::jsonb, ${ledgerId})`);
  return { ledgerId, delta, rev };
}

// (what changed on a car or part, for its history: the keys, and the condition before and after)
function changedKeys(a: any, b: any) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter(k => !same(a?.[k], b?.[k]));
  return { changed: keys, ...(keys.includes('condition') ? { condition: [a.condition, b.condition] } : {}) };
}
