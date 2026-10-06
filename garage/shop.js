// The shop's rules (Phase 6 Step 4): what's for sale, at what price, to whom; kits; what things sell for; the
// garage's capacity; the refund window; and the used car lot. Pure data, like profile.js: the same code prices
// things in the browser (to show them), in the player service (to charge for them) and on the server (where it
// counts). Every value comes from the economy settings (data/economy.json shop, sell; on the server the active
// version), so the server's admins can change them: the game never says what something costs.
//
//   offer(db, 'part' | 'car', id, now)        → { list, price, sale, until, forSale, why, unlock }
//   lockOf(db, profile, rule, levels)         → null, or { text, level?, series? } (why it's locked)
//   bundles(db, carId, now)                   → kits for a car, each quoted: { id, name, items, list, price }
//   sellValue(db, instance, now)              a part's sell value; carSellValue(db, profile, car, { keep }, now)
//   capacity(db, profile), slotPrice(db, profile)
//   refundable(db, instance, now)             → null, or why it can't be refunded
//   usedLot(db, day)                          → the day's used cars (the same for everyone that day)
//
// now: ms since 1970 (or an ISO time). Prices are whole money units.

import { carPrice, curve, setSize } from './player/profile.js';
import { Garage } from './data.js';
import { fingerprint } from './fingerprint.js';
import { partWork, shellWork, workCost } from './repair.js';
import { takes } from './validate.js';
import { levelOf } from '../quest/rules.js';
import { rng, hashSeed } from '../ai/rng.js';

const DAY = 86_400_000;
export const ms = now => typeof now === 'number' ? now : now ? Date.parse(now) : Date.now();
export const shopOf = db => db.economy?.shop ?? {};
const within = (from, until, now) => (!from || Date.parse(from) <= now) && (!until || now < Date.parse(until));
const round = (x, to = 1) => Math.round(x / to) * to;

// ---------- the catalogue ----------
// An item's own entry (prices, hidden, unlock rules, when it's on sale): shop.catalogue.parts / .cars
export const entryOf = (db, kind, id) => shopOf(db).catalogue?.[kind === 'car' ? 'cars' : 'parts']?.[id] ?? {};
// The list price: the catalogue's, else the part's own (its file) or the car's (its class: carPrice)
export function listPrice(db, kind, id) {
  const e = entryOf(db, kind, id);
  if (Number.isFinite(e.price)) return e.price;
  return kind === 'car' ? carPrice(db, db.cars[id]) : db.parts[id]?.price ?? 0;
}
// The sales on now (shop.sales: { id, name, starts, ends, discount, parts?, cars?, categories?, tiers?, classes?, all? })
export const activeSales = (db, now = Date.now()) => (shopOf(db).sales ?? []).filter(s => !s.disabled && within(s.starts, s.ends, ms(now)));
function saleCovers(db, s, kind, id) {
  if (kind === 'car') { const c = db.cars[id]; return !!(s.all || s.cars?.includes(id) || (c?.class && s.classes?.includes(c.class))); }
  const p = db.parts[id];
  return !!(s.all || s.parts?.includes(id) || (p && (s.categories?.includes(p.category) || s.tiers?.includes(p.tier))));
}
// Who makes a part (the shop's filter): the catalogue's, shop.makers' own list, Factory for stock parts and a car's
// own, the racing maker for race parts, else by its category
export function makerOf(db, part) {
  if (!part) return null;
  const M = shopOf(db).makers ?? {}, own = entryOf(db, 'part', part.id).maker ?? M.parts?.[part.id];
  if (own) return own;
  if (part.tier === 'stock' || part.tier == null || Object.keys(db.cars).some(c => part.id.startsWith(`${c}_`))) return M.factory ?? 'Factory';
  if (part.tier === 'race' && M.racing) return M.racing;
  return M.byCategory?.[part.category] ?? null;
}
// The best sale on an item now (they don't add up)
export function saleOn(db, kind, id, now = Date.now()) {
  let best = null;
  for (const s of activeSales(db, now)) if (saleCovers(db, s, kind, id) && s.discount > (best?.discount ?? 0)) best = s;
  return best;
}
// An item's unlock rule: its own, else its tier's (a part) or class's (a car) — shop.unlock
export function unlockRule(db, kind, id) {
  const own = entryOf(db, kind, id).unlock;
  if (own) return own;
  const U = shopOf(db).unlock ?? {};
  return kind === 'car' ? U.carClasses?.[db.cars[id]?.class] ?? null : U.partTiers?.[db.parts[id]?.tier] ?? null;
}
// Whether a player has what the rule asks: a level (from their xp), a quest series finished — null if they do
// (levels: the quest settings, data/quests.json — their levels block; without them, its usual one)
const LEVELS = { levels: { base: 400, growth: 0.25, max: 50 } };
export function lockOf(db, profile, rule, levels) {
  if (!rule) return null;
  const level = levelOf(profile?.xp ?? 0, levels?.levels ? levels : LEVELS), out = [];
  if (rule.level && level < rule.level) out.push(`reach level ${rule.level} (you're level ${level})`);
  if (rule.series && !profile?.series?.[rule.series]?.completed) out.push(`finish the ${rule.seriesName ? `"${rule.seriesName}" series` : 'quest series'}`);
  return out.length ? { text: `Unlocks when you ${out.join(' and ')}.`, level: rule.level ?? null, series: rule.series ?? null } : null;
}

// What an item costs now and whether it's for sale: { list, price, sale: { id, name, discount, ends }, from,
// until (a limited-time item's window), forSale, why (not for sale: plain words), unlock (its rule) }
export function offer(db, kind, id, now = Date.now()) {
  const t = ms(now), def = kind === 'car' ? db.cars[id] : db.parts[id], e = entryOf(db, kind, id);
  if (!def) return { list: 0, price: 0, sale: null, forSale: false, why: `There's no ${kind} "${id}".`, unlock: null };
  const list = listPrice(db, kind, id), s = saleOn(db, kind, id, t);
  const price = s ? Math.max(1, round(list * (1 - s.discount))) : list;
  let why = null;
  if (e.hidden) why = `${def.name} isn't for sale.`;
  else if (kind === 'part' && def.retired) why = `${def.name} isn't sold any more.`;
  else if (kind === 'part' && def.todo?.length) why = `${def.name} isn't for sale yet: its ${def.todo.join(', ')} ${def.todo.length > 1 ? 'are' : 'is'} still to be filled in.`;
  else if (e.from && t < Date.parse(e.from)) why = `${def.name} goes on sale ${new Date(e.from).toUTCString().slice(0, 22)}.`;
  else if (e.until && t >= Date.parse(e.until)) why = `${def.name} was only on sale until ${new Date(e.until).toUTCString().slice(0, 22)}.`;
  return { list, price, sale: s ? { id: s.id, name: s.name, discount: s.discount, ends: s.ends ?? null } : null, from: e.from ?? null, until: e.until ?? null, forSale: !why, why, unlock: unlockRule(db, kind, id) };
}

// ---------- kits ----------
// A kit (shop.bundles: { id, name, car?, parts: [partId], discount, unlock? }) for a car: each part as a set
// for it (wheels: four), each at its price now, the whole for discount less. Each part's share of the price is
// what was paid for it (its sell value and refund follow from that).
export function quoteBundle(db, b, carId, now = Date.now()) {
  const items = [];
  let list = 0, sum = 0, why = null;
  for (const partId of b.parts ?? []) {
    const o = offer(db, 'part', partId, now), part = db.parts[partId];
    if (!o.forSale) { why = o.why; continue; }
    const n = setSize(db, part, carId ?? b.car ?? null);
    items.push({ partId, n, each: o.price });
    list += o.list * n; sum += o.price * n;
  }
  const price = round(sum * (1 - (b.discount ?? 0)));
  // (each copy's share: its price now × what the kit takes off, the pennies on the last)
  let left = price;
  const copies = items.flatMap(it => Array.from({ length: it.n }, () => it.partId)), paid = copies.map(() => 0);
  copies.forEach((pid, i) => { const each = items.find(x => x.partId === pid).each; paid[i] = i === copies.length - 1 ? left : Math.floor(each * (sum ? price / sum : 0)); left -= paid[i]; });
  return { id: b.id, name: b.name, car: b.car ?? null, discount: b.discount ?? 0, items, copies: copies.map((partId, i) => ({ partId, paid: paid[i] })), list, sum, price, saving: sum - price, forSale: !why && !!items.length && !b.hidden && within(b.from, b.until, ms(now)), why: b.hidden ? `${b.name} isn't for sale.` : why, unlock: b.unlock ?? null, until: b.until ?? null };
}
export const bundles = (db, carId = null, now = Date.now()) => (shopOf(db).bundles ?? []).filter(b => !carId || !b.car || b.car === carId).map(b => quoteBundle(db, b, carId, now));

// ---------- selling ----------
// What a copy sells for: what it's worth (the least of what was paid for it, its list price and its price
// now) × sell.ratio, less sell.repairShare of what it would cost to put right (its condition, dents,
// mechanical damage; scaled to what it's worth) — never below sell.floor of that, never as much as it costs
// new. Repairing something only to sell it never pays (it gets back repairShare of the repair at most).
export function worth(db, instance, now = Date.now()) {
  const list = listPrice(db, 'part', instance.partId) || instance.price || 0, o = db.parts[instance.partId] ? offer(db, 'part', instance.partId, now) : null;
  return Math.max(0, Math.min(list, Number.isFinite(instance.price) ? instance.price : list, o?.forSale ? o.price : list));
}
export function sellValue(db, instance, now = Date.now()) {
  const S = db.economy.sell, base = worth(db, instance, now), list = listPrice(db, 'part', instance.partId) || base || 1;
  if (S.repairShare === undefined) return round(base * S.ratio * curve(S.conditionCurve, instance.condition));     // (an older economy file)
  const repair = workCost(partWork(db, instance), 'full') * base / list;
  return Math.max(round(base * S.ratio * (S.floor ?? 0)), round(base * S.ratio - S.repairShare * repair));
}
// A car's body (everything that isn't a part): its list price less its factory parts', at least nothing
export function bodyList(db, carId) {
  const def = db.cars[carId];
  if (!def) return 0;
  const parts = def.sockets.reduce((a, s) => a + (s.stock?.[0] && db.parts[s.stock[0]] ? listPrice(db, 'part', s.stock[0]) : 0), 0);
  return Math.max(0, listPrice(db, 'car', carId) - parts);
}
export function bodySellValue(db, car, now = Date.now()) {
  const S = db.economy.sell, list = bodyList(db, car.carId), o = offer(db, 'car', car.carId, now);
  const base = Math.max(0, Math.min(list, Number.isFinite(car.bodyPrice) ? car.bodyPrice : list, o.forSale ? list * o.price / (o.list || 1) : list));
  const repair = workCost(shellWork(db, car), 'full') * (list ? base / list : 0);
  return Math.max(round(base * S.ratio * (S.floor ?? 0)), round(base * S.ratio - (S.repairShare ?? 1) * repair));
}
// A car sold: its body and every part on it, bar those kept (they go to the inventory) — { total, body, parts: [{ instanceId, value }] }
export function carSellValue(db, profile, carInstanceId, { keep = [] } = {}, now = Date.now()) {
  const car = profile.cars[carInstanceId], kept = new Set(keep);
  if (!car) return null;
  const parts = Object.values(profile.parts).filter(x => x.installedOn?.car === carInstanceId && !kept.has(x.instanceId)).map(x => ({ instanceId: x.instanceId, partId: x.partId, value: sellValue(db, x, now) }));
  const body = bodySellValue(db, car, now);
  return { total: body + parts.reduce((a, x) => a + x.value, 0), body, parts };
}
// A sale that needs a second "are you sure?": worth at least shop.confirmAbove, or a car
export const needsConfirm = (db, value) => value >= (shopOf(db).confirmAbove ?? 5000);

// ---------- the garage's space; refunds ----------
export const capacity = (db, profile) => (shopOf(db).garage?.slots ?? 3) + (profile?.garageSlots ?? 0);
export function slotPrice(db, profile) {
  const G = shopOf(db).garage ?? {}, bought = profile?.garageSlots ?? 0;
  if (bought >= (G.maxExtra ?? 0)) return null;
  return round((G.slotPrice ?? 10000) * (G.growth ?? 1.5) ** bought, 100);
}
// null if a copy may go back for what was paid, else why not: bought new within shop.refund.minutes, never
// fitted, still as it came
export function refundable(db, x, now = Date.now()) {
  const R = shopOf(db).refund;
  if (!R?.minutes) return 'Refunds are off.';
  if (!x?.boughtAt) return 'Only something bought new from the shop can go back.';
  if (x.installedOn || x.used) return 'It\'s been fitted to a car: it can be sold, not refunded.';
  if (x.condition < 100 || x.damage || x.dents?.length || x.dentLog || x.tuning) return 'It isn\'t as it came any more.';
  if (ms(now) - Date.parse(x.boughtAt) > R.minutes * 60_000) return `The refund window (${R.minutes} minutes) has closed: it can be sold instead.`;
  return null;
}

// ---------- the used car lot ----------
// The day (UTC) a time is in, and when its lot changes
export const dayOf = (now = Date.now()) => new Date(ms(now)).toISOString().slice(0, 10);
export const lotEnds = (now = Date.now()) => new Date((Math.floor(ms(now) / DAY) + 1) * DAY).toISOString();
const ZONES = ['front', 'rear', 'left', 'right'];
// (which way a socket faces, for an accident's zone: by its name)
const zoneOf = s => /front|bonnet|headl|grille|radiator|lip|splitter|bull/.test(s) ? 'front' : /rear|boot|tail|spoiler|wing|exhaust|diffuser/.test(s) ? 'rear' : /left|_l\b|_fl|_rl/.test(s) ? 'left' : /right|_r\b|_fr|_rr/.test(s) ? 'right' : null;
const lotCache = new Map();
// Every listing on a day: generated from the day and shop.usedLot.seed (the same for everyone), each
// { id, carId, name, year, mileage, owners, price, condition (body), parts: { socket: { partId, condition } },
//   aftermarket: [partId], damage: { condition, broken }, history: [{ year, text }], rating }
export function usedLot(db, day = dayOf()) {
  const L = shopOf(db).usedLot;
  if (!L?.count) return [];
  const key = `${day}|${JSON.stringify(L)}|${JSON.stringify(shopOf(db).catalogue?.cars ?? {})}`;
  if (lotCache.has(key)) return lotCache.get(key);
  const r = rng(hashSeed(L.seed ?? 'used', day)), out = [];
  const cars = Object.keys(db.cars).filter(id => offer(db, 'car', id, Date.parse(day)).forSale && (L.classes?.[db.cars[id].class] ?? 1) > 0).sort();
  const weights = Object.fromEntries(cars.map(id => [id, L.classes?.[db.cars[id].class] ?? 1]));
  const year = +day.slice(0, 4);
  for (let i = 0; i < L.count && cars.length; i++) {
    const carId = r.weighted(weights), def = db.cars[carId];
    const [m0, m1] = L.mileage ?? [5000, 200000], mileage = round(m0 + (m1 - m0) * r() ** 1.4, 100);
    const age = Math.max(1, Math.round(mileage / (L.kmPerYear ?? 15000) + r() * 2)), owners = 1 + Math.floor(mileage / (L.kmPerOwner ?? 70000) + r() * 1.5);
    const g = new Garage(db, Garage.freshState(db, carId), carId), history = [{ year: year - age, text: 'First registered' }];
    // aftermarket parts a previous owner fitted (street, sport or race, by weight), on if they fit the build
    const aftermarket = [];
    if (r() < (L.aftermarket?.chance ?? 0.5)) {
      const want = 1 + Math.floor(r() * (L.aftermarket?.max ?? 4));
      const pool = Object.values(db.parts).filter(p => p.tier && p.tier !== 'stock' && !p.todo?.length && !p.retired && (L.aftermarket?.tiers?.[p.tier] ?? 0) > 0 && def.sockets.some(s => takes(def, s, p))).sort((a, b) => a.id < b.id ? -1 : 1);
      for (let k = 0; k < want * 3 && aftermarket.length < want && pool.length; k++) {
        const tier = r.weighted(L.aftermarket.tiers), from = pool.filter(p => p.tier === tier && !aftermarket.includes(p.id));
        if (!from.length) continue;
        const p = r.pick(from), before = JSON.stringify(g.state);
        const res = g.install(p.id, { auto: true });
        if (res.ok && g.drivable().ok) { aftermarket.push(p.id); history.push({ year: year - Math.max(0, Math.floor(age * r())), text: `${p.name} fitted` }); }
        else g.state = JSON.parse(before);
      }
    }
    // wear with the miles; an accident or two (a zone's parts and the body knocked down, maybe glass broken)
    const W = L.wear ?? { perKm: 0.00012, spread: 12, min: 35 };
    const wear = Math.min(60, mileage * W.perKm);
    const parts = {};
    for (const [socket, id] of Object.entries(g.build.sockets)) {
      if (!id) continue;
      const fitted = aftermarket.includes(g.state.parts[id].partId);
      parts[socket] = { partId: g.state.parts[id].partId, condition: Math.max(W.min ?? 30, Math.min(100, Math.round(100 - wear * (fitted ? 0.5 : 1) - r() * (W.spread ?? 10)))) };
    }
    let body = Math.max(W.min ?? 30, Math.round(100 - wear * 0.6 - r() * 6));
    const broken = [];
    if (r() < (L.damage?.chance ?? 0.3)) {
      const zone = r.pick(ZONES), hit = Math.round((L.damage?.maxLoss ?? 30) * (0.3 + 0.7 * r()));
      body = Math.max(W.min ?? 30, body - hit);
      for (const [socket, x] of Object.entries(parts)) if (zoneOf(socket.replace(/^socket_/, '')) === zone) x.condition = Math.max(W.min ?? 30, x.condition - Math.round(hit * (0.5 + r() * 0.5)));
      const glass = (def.model?.breakables ?? []).filter(b => zoneOf(b.node) === zone);
      if (glass.length && r() < 0.5) broken.push(r.pick(glass).node);
      history.push({ year: year - Math.floor(age * r()), text: `Accident: ${zone === 'left' || zone === 'right' ? `the ${zone} side` : `the ${zone}`} hit${broken.length ? ', glass broken' : ''}` });
    }
    // services every so many km, some missed
    for (let km = L.serviceKm ?? 20000; km <= mileage; km += L.serviceKm ?? 20000) if (r() < 0.8) history.push({ year: year - age + Math.floor(km / (L.kmPerYear ?? 15000)), text: `Serviced at ${km.toLocaleString('en-GB')} km` });
    history.sort((a, b) => a.year - b.year);
    // the price: the body and each part by its condition, × the lot's factor
    const P = L.price ?? { factor: 0.85, conditionCurve: [[0, 0.3], [100, 1]] };
    const value = bodyList(db, carId) * curve(P.conditionCurve, body) + Object.values(parts).reduce((a, x) => a + listPrice(db, 'part', x.partId) * curve(P.conditionCurve, x.condition), 0);
    const price = Math.max(100, round(value * (P.factor ?? 0.85), 100));
    const worn = JSON.parse(JSON.stringify(g.state));
    for (const [socket, id] of Object.entries(g.build.sockets)) if (id && parts[socket]) worn.parts[id].condition = parts[socket].condition;
    const rated = new Garage(db, worn, carId).stats().totals?.rating;
    out.push({ id: `used_${day.replace(/-/g, '')}_${String(i + 1).padStart(2, '0')}`, day, carId, name: def.name, class: def.class ?? rated?.class ?? '', year: year - age, mileage, owners,
      price, condition: body, damage: { condition: body, ...(broken.length ? { broken } : {}) }, parts, aftermarket, history, rating: rated ? { class: rated.class, index: rated.index } : null, newPrice: listPrice(db, 'car', carId) });
  }
  if (lotCache.size > 20) lotCache.delete(lotCache.keys().next().value);
  lotCache.set(key, out);
  return out;
}
// A used car as a garage state (garage/data.js), to look at or test drive: its parts at their conditions
export function listingState(db, listing) {
  const state = Garage.freshState(db, listing.carId), car = state.cars[state.current], sockets = {};
  state.parts = {};
  for (const [socket, x] of Object.entries(listing.parts)) { const id = `lot_${socket}`; state.parts[id] = { instanceId: id, partId: x.partId, condition: x.condition }; sockets[socket] = id; }
  car.build.sockets = { ...Object.fromEntries(Object.keys(car.build.sockets).map(k => [k, null])), ...sockets };
  car.build.fingerprint = fingerprint(car.build, state.parts);
  return state;
}
// What each thing on a used car was bought for: the price shared by list value (the body's and each part's)
export function usedShares(db, listing) {
  const items = [['body', bodyList(db, listing.carId)], ...Object.entries(listing.parts).map(([s, x]) => [s, listPrice(db, 'part', x.partId)])];
  const total = items.reduce((a, [, v]) => a + v, 0) || 1, out = {};
  let left = listing.price;
  items.forEach(([k, v], i) => { out[k] = i === items.length - 1 ? left : Math.floor(listing.price * v / total); left -= out[k]; });
  return out;
}

// ---------- the history of buying and selling ----------
export const LOG_MAX = 200;
export function logShop(profile, entry) {
  (profile.shopLog ??= []).unshift(entry);
  if (profile.shopLog.length > LOG_MAX) profile.shopLog.length = LOG_MAX;
}
