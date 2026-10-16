// Engines from their settings (Phase 8 Step 3; data/engines/<id>.json, data/content/formulas.json engines;
// docs/CONTENT_PIPELINE.md): an engine's layout, cylinders, displacement, aspiration, revs and character → its
// torque curve, mass, inertia and size (with the engine's own overrides in place of any of them), the smallest
// engine bay it goes in (data/content/standards.json bays), and the crate engine part the shop sells
// (data/parts/engine/crate_<id>.json): it fits any car with a matching engine mount and a bay its size or bigger,
// needs the clutch, gearbox and cooling its torque and power call for, and changes the car's weight and balance as
// its own mass at the engine's socket (garage/stats.js).
//
//   engineDesign(def, F, S) → { stats, curve, size, bay, power, problems }
//   cratePart(def, { formulas, standards, tiers }) → { part, design, problems }
//
// No browser or Node APIs.

import { evalStats, evaluate, rangeProblem, said } from './formulas.js';

const CYL_WORDS = { 2: 'twin', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 8: 'eight', 10: 'ten', 12: 'twelve' };
const r50 = x => Math.round(x / 50) * 50;
const listOf = v => v == null ? [] : Array.isArray(v) ? v : [v];
const named = (o = {}) => Object.keys(o).filter(k => !k.startsWith('_'));

// "3.0 L V6", "2.0 L turbo inline-four", "1.3 L twin-rotor", "2.5 L supercharged flat-six"
export function engineWords(def) {
  const n = def.cylinders, w = CYL_WORDS[n] ?? `${n}-cylinder`, d = `${(+def.displacement).toFixed(1)} L`;
  const shape = def.layout === 'v' ? `V${n}` : def.layout === 'rotary' ? `${w}-rotor` : def.layout === 'flat' ? `flat-${w}` : `inline-${w}`;
  const asp = def.aspiration === 'turbo' ? 'turbo ' : def.aspiration === 'supercharged' ? 'supercharged ' : '';
  return `${d} ${asp}${shape}`;
}

// The full-throttle torque curve: from idle up to the peak (a forced engine's boost building to spoolRpm, then
// holding to holdRpm), down to redlineShare at the redline and overRevShare 400 rpm past it — at idle, eight steps
// to the redline, the peak, and past the redline
export function makeCurve(def, st) {
  const idle = def.idle, red = def.redline, peak = Math.min(Math.max(st.peakRpm, idle + 200), red - 200), forced = (def.boost ?? 0) > 0;
  const hold = forced ? Math.min(Math.max(st.holdRpm, peak), red - 100) : peak;
  const share = rpm => {
    if (rpm <= peak) {
      const x = (rpm - idle) / (peak - idle);
      return forced ? st.idleShare + (1 - st.idleShare) * x * x * (3 - 2 * x) : st.idleShare + (1 - st.idleShare) * (1 - (1 - x) ** 2);
    }
    if (rpm <= hold) return 1;
    if (rpm <= red) return 1 - (1 - st.redlineShare) * ((rpm - hold) / (red - hold)) ** (forced ? 1.3 : 1.6);
    return st.redlineShare + (st.overRevShare - st.redlineShare) * Math.min(1, (rpm - red) / 400);
  };
  const rpms = new Set([idle, peak, ...(forced ? [hold] : []), red, red + 400]);
  for (let k = 1; k < 8; k++) rpms.add(r50(idle + (red - idle) * k / 8));
  return [...rpms].sort((a, b) => a - b).filter((r, i, a) => i === 0 || r - a[i - 1] >= 100 || r === red || r === peak)
    .map(rpm => [rpm, Math.round(st.peakTorque * share(rpm))]);
}
// a curve's peak power (hp) and torque (N·m)
export function curvePeaks(curve) {
  let hp = 0, nm = 0;
  for (let i = 0; i < curve.length; i++) {
    nm = Math.max(nm, curve[i][1]);
    // (between points too: the curve is straight lines, power isn't)
    const [r0, t0] = curve[i], [r1, t1] = curve[i + 1] ?? curve[i];
    for (let k = 0; k <= 4; k++) { const r = r0 + (r1 - r0) * k / 4, t = t0 + (t1 - t0) * k / 4; hp = Math.max(hp, t * r / 7121); }
  }
  return { hp: Math.round(hp), nm };
}

// The smallest bay class (standards.bays) an engine of this size (length, width, height: m) fits in, or null
export function bayFor(size, S) {
  return S.bays.order.find(b => S.bays.sizes[b].box.every((m, i) => size[i] <= m + 1e-9)) ?? null;
}

// An engine's settings checked, and what they come to
export function engineDesign(def, F, S) {
  const E = F.engines, problems = [], what = def.name ?? def.id;
  const layout = E.layouts[def.layout], asp = E.aspirations[def.aspiration ?? 'natural'];
  if (!layout) problems.push(`${what}: layout "${def.layout}" isn't one there is (${named(E.layouts).join(', ')})`);
  if (!asp) problems.push(`${what}: aspiration "${def.aspiration}" isn't one there is (${named(E.aspirations).join(', ')})`);
  for (const m of listOf(def.mount)) if (!named(S.engineMounts).includes(m)) problems.push(`${what}: engine mount "${m}" isn't a standard (${named(S.engineMounts).join(', ')})`);
  if (!listOf(def.mount).length) problems.push(`${what}: it needs an engine mount (mount: ${named(S.engineMounts).join(', ')})`);
  if (listOf(def.mount).length > 1) problems.push(`${what}: one engine mount per engine (its model sits one way in the car): make another engine file for ${listOf(def.mount).slice(1).join(', ')}`);
  if ((def.aspiration ?? 'natural') === 'natural' && def.boost) problems.push(`${what}: a naturally aspirated engine has no boost (boost: 0, or aspiration turbo or supercharged)`);
  if ((def.aspiration ?? 'natural') !== 'natural' && !(def.boost > 0)) problems.push(`${what}: a ${def.aspiration} engine needs its boost (bar)`);
  for (const [k, range] of Object.entries(E.ranges)) {
    if (k.startsWith('_') || k === 'peakPower') continue;
    const v = k === 'boost' ? def.boost ?? 0 : def[k];
    if (v == null) { problems.push(`${what}: it needs its ${k}`); continue; }
    const p = rangeProblem({ range: range, label: k }, v);
    if (p) problems.push(`${what}: ${p}`);
  }
  if (def.idle != null && def.redline != null && def.redline < def.idle + 2500) problems.push(`${what}: the redline (${def.redline} rpm) should be at least 2,500 rpm over idle (${def.idle} rpm)`);
  if (problems.length) return { problems };
  const ctx = { ...def, boost: def.boost ?? 0, layout, aspiration: asp };
  const { stats, problems: p2 } = evalStats(E.stats, ctx, { what });
  problems.push(...p2);
  if (problems.length) return { problems };
  const O = def.overrides ?? {};
  const curve = O.torqueCurve ?? makeCurve(def, stats);
  if (O.torqueCurve) {
    for (let i = 1; i < curve.length; i++) if (!(curve[i][0] > curve[i - 1][0])) problems.push(`${what}: its torque curve's rpm should rise point by point (${curve[i - 1][0]} then ${curve[i][0]})`);
    if (curve[0][0] > def.idle || curve.at(-1)[0] < def.redline) problems.push(`${what}: its torque curve should run from idle (${def.idle} rpm) to at least the redline (${def.redline} rpm)`);
  }
  const size = O.size ?? ['length', 'width', 'height'].map(k => +evaluate(layout[k], ctx).toFixed(3));
  const mass = O.mass ?? stats.mass, peaks = curvePeaks(curve);
  const pp = rangeProblem({ range: E.ranges.peakPower, label: 'peak power', unit: 'hp' }, peaks.hp);
  if (pp) problems.push(`${what}: ${pp}`);
  const bay = bayFor(size, S);
  if (!bay) { const big = S.bays.order.at(-1); problems.push(`${what}: at ${size.map(v => `${v} m`).join(' × ')} it's too big for any engine bay (the biggest, ${big}, takes ${S.bays.sizes[big].box.join(' × ')} m)`); }
  return { stats: { ...stats, mass, peakTorque: peaks.nm, peakPower: peaks.hp }, curve, size, bay, power: peaks.hp, problems };
}

// What it needs fitted with it (formulas engines.requires): [{ tag, why }]
export function engineNeeds(stats, F) {
  const out = [];
  for (const [k, rule] of Object.entries(F.engines.requires)) {
    if (k.startsWith('_')) continue;
    const step = rule.steps.find(([over]) => stats[rule.by] > over);
    if (step) out.push({ tag: step[1], why: rule.why });
  }
  return out;
}

// Tier, price and unlock level from where a number (an engine's power) sits in its tier: tierBy [[tier, upTo], …];
// price within the tier's band of the slot's street price (tiers.json); unlock levels the same way
export function pricing({ value, tierBy, unlock, slot, tiers, factor = 1 }) {
  let lo = 0, tier = null;
  for (const [t, upTo] of tierBy) { if (value < upTo) { tier = t; break; } lo = upTo; }
  if (!tier) return { problem: `${value} is over the top of the last tier (${tierBy.at(-1)[0]}: under ${tierBy.at(-1)[1]})` };
  // (a tier named again further on — race past 900 hp: the top of the first's)
  const hi = tierBy.find(([t]) => t === tier)[1], t = value >= hi ? 1 : Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  const band = tiers.tiers[tier].price, street = tiers.slots[slot]?.street;
  if (!street) return { problem: `data/content/tiers.json has no street price for the ${slot} slot` };
  const raw = street * (band[0] + (band[1] - band[0]) * t) * factor, price = Math.round(Math.min(street * band[1], Math.max(street * band[0], raw)) / 10) * 10;
  const U = unlock?.[tier], level = U ? Math.round(U[0] + (U[1] - U[0]) * t) : null;
  return { tier, price, level, t };
}

// The crate engine part for the shop
export function cratePart(def, { formulas: F, standards: S, tiers }) {
  const d = engineDesign(def, F, S);
  if (d.problems.length) return { part: null, design: d, problems: d.problems };
  const asp = F.engines.aspirations[def.aspiration ?? 'natural'], run = F.engines.running, st = d.stats;
  const words = engineWords(def), id = `crate_${def.id}`;
  const money = pricing({ value: d.power, tierBy: F.engines.economy.tierByPower, unlock: F.engines.economy.unlock, slot: 'engine', tiers });
  if (money.problem) return { part: null, design: d, problems: [`${def.name ?? def.id}: its power, ${money.problem}`] };
  const [L, W, H] = d.size, mounts = listOf(def.mount), across = mounts[0] === 'trans';      // (transverse: the crank across the car, x)
  const engine = {
    torqueCurve: d.curve, idleRpm: def.idle, redlineRpm: def.redline, inertia: st.inertia, induction: asp.induction, cylinders: def.cylinders,
    sound: `data/sounds/engines/${def.sound}.json`,
    friction: { base: st.friction, perKrpm: +(st.friction / 2).toFixed(3), perKrpm2: +(st.friction * 0.058).toFixed(4) },
    idle: { ...run.idle }, limiter: { ...run.limiter }, overRev: { ...run.overRev },
  };
  if (def.aspiration === 'turbo') {
    const b = def.boost, spool = st.peakRpm;
    engine.turbo = { boost: [[def.idle, +(b * 0.2).toFixed(2)], [r50(def.idle + (spool - def.idle) * 0.5), +(b * 0.6).toFixed(2)], [spool, b], [st.holdRpm, b], [def.redline, +(b * 0.85).toFixed(2)]], efficiency: run.turbo.efficiency, sound: JSON.parse(JSON.stringify(run.turbo.sound)) };
  }
  const needs = engineNeeds(st, F);
  const part = {
    id, name: def.name ?? `${def.maker ? `${def.maker} ` : ''}${words} (crate engine)`, category: 'engine', slot: 'engine', kind: 'component',
    price: money.price, mass: st.mass, model: `assets/parts/engine/${id}.glb`, icon: `assets/icons/parts/${id}.png`,
    fits: [`mount:${mounts[0]}`, `bay:${d.bay}`],
    // (leaveOff: { car: why } — the cars it would take past their class limits: tools/content/jobWorker.mjs)
    requires: needs.map(n => n.tag), conflicts: Object.keys(def.leaveOff ?? {}).map(c => `car:${c}`),
    provides: [`engine_family:${id}`, `engine_layout:${def.layout}${def.cylinders}`, `induction:${def.aspiration === 'turbo' ? 'turbo' : 'natural'}`, ...(def.aspiration === 'supercharged' ? ['forced_induction:supercharger'] : []), 'intake_flange:std', 'exhaust_flange:std'],
    engine, tier: money.tier, ...(money.level > 1 && { unlock: { level: money.level } }),
    bounds: { min: [-(across ? L : W) / 2, 0, -(across ? W : L) / 2].map(v => +v.toFixed(3)), max: [(across ? L : W) / 2, H, (across ? W : L) / 2].map(v => +v.toFixed(3)) }, massOffset: [0, +(H * 0.38).toFixed(3), 0],
    status: def.status ?? 'draft',
    engineSpec: { layout: def.layout, cylinders: def.cylinders, displacement: def.displacement, aspiration: def.aspiration ?? 'natural', boost: def.boost ?? 0, mounts, bay: d.bay, size: d.size, peakTorque: st.peakTorque, peakPower: d.power, words },
    generated: { engine: def.id },
    _generated: `Made by npm run content -- build from data/engines/${def.id}.json (and data/content/formulas.json engines): change those, not this file. ${words}: ${st.peakTorque} N·m, ${d.power} hp, ${st.mass} kg, ${d.size.join(' × ')} m (a ${d.bay} bay or bigger). It needs ${needs.length ? needs.map(n => `${n.why} (${n.tag})`).join(', ') : 'nothing else fitted'}.`,
  };
  return { part, design: d, problems: [] };
}

// An engine's figures in words, for reports: "3.0 L V6: 300 N·m, 260 hp, 170 kg, medium bay"
export const engineLine = (def, d) => `${engineWords(def)}: ${said(d.stats.peakTorque, 'N·m')}, ${said(d.power, 'hp')}, ${said(d.stats.mass, 'kg')}, ${d.bay} bay`;
