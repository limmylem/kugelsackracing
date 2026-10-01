// Mechanical damage: an impact (physics/impacts.js), a kerb strike or a heavy landing → what it does to
// the car's mechanicals, by the car's damage zones (car.json damageZones) and the rules in
// data/damage.json mechanical. Pure, like garage/damage.js, so the page, tests and a server agree.
//
// Each system's damage is kept on the part that carries it (its owned copy's `damage` block), so a
// repair of that part puts it right:
//   steering, suspension → the suspension:  { FL: { toe, camber, ride, damper }, … }
//       toe: degrees, + the wheel points left (the car pulls); camber: degrees out (less grip);
//       ride: m lower; damper: share of its damping lost
//   rim       → each wheel: { bend } (mm: it wobbles, more with speed)
//   tyre      → each tyre: { pressure (share of full; none: full), leak (share a second) }
//   brakeLine → the brakes: { FL: { line } } (share of that corner's brake force lost)
//   radiator  → the engine: { coolant (share of full), leak (share a second) }
//   intake    → the turbo: { boost } (share of its boost lost; no turbo, nothing to leak)
//   gearbox, differential → { gears } · clutch → { wear } · exhaust → { holes } (0..1)
// A corner hit hard enough (wheelOff.from) tears the wheel off: for the drive (the game puts it back,
// bent and flat, like any part torn off).
//
// A hit reaches a zone by how near the contact is to the zone's box (within zoneReach, plus the dent's
// depth: a hard hit crumples further in) and, for a zone that faces a way, how squarely it came from
// there. Each system in the zone takes damage by how far that strength is over its `from`, divided by
// the carrying part's toughness.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const r4 = x => Math.round(x * 1e4) / 1e4 + 0;
export const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const WHEEL_SYSTEMS = ['steering', 'suspension', 'rim', 'tyre', 'brakeLine'];
// the slot of the part that carries each (whole-car) system
export const CARRIER_SLOTS = { steering: 'suspension', suspension: 'suspension', brakeLine: 'brakes', radiator: 'engine', intake: 'turbo', gearbox: 'gearbox', differential: 'differential', clutch: 'clutch', exhaust: 'exhaust' };

const boxDistance = (p, b) => Math.hypot(...[0, 1, 2].map(k => Math.max(0, b.min[k] - p[k], p[k] - b.max[k])));
// (the nearest the contact came to a box: its point, or anywhere in the box round its contacts — a wall
// across the front)
function nearest(impact, box) {
  const e = impact.extent;
  if (!e) return boxDistance(impact.point, box);
  return Math.hypot(...[0, 1, 2].map(k => Math.max(0, box.min[k] - e.max[k], e.min[k] - box.max[k])));
}

// Which part copies carry what on a car as built: { system: instanceId } and { rim: { FL: id }, tyre: { FL: id } },
// each copy's toughness, and what's torn off (build.attach) — db: { parts, owned }
export function mechanicalLayout({ car, build, db }) {
  const carriers = { rim: {}, tyre: {} }, toughness = {}, partOf = {};
  const bySlot = {};
  for (const s of car.sockets) {
    const id = build.sockets?.[s.name], inst = id && db.owned[id], part = inst && db.parts[inst.partId];
    if (!part) continue;
    toughness[id] = part.toughness ?? 1;
    partOf[id] = part;
    const corner = Object.entries(car.model.sockets).find(([, n]) => n === (s.node ?? s.name))?.[0];
    if (corner && CORNERS.includes(corner) && (s.slot === 'wheel' || s.slot === 'tyre')) { carriers[s.slot === 'wheel' ? 'rim' : 'tyre'][corner] = id; continue; }
    bySlot[s.slot] ??= id;
  }
  for (const [system, slot] of Object.entries(CARRIER_SLOTS)) if (bySlot[slot]) carriers[system] = bySlot[slot];
  // (armour — skid plates, a bull bar: the share of a hit it keeps off each system it shields)
  const armour = {};
  for (const p of Object.values(partOf)) for (const sys of p.protects?.systems ?? []) armour[sys] = Math.max(armour[sys] ?? 0, p.protects.by);
  // (no turbo part, but a factory turbo on the engine: its pipes are the engine's)
  if (!carriers.intake && carriers.radiator && partOf[carriers.radiator]?.engine?.turbo) carriers.intake = carriers.radiator;
  const off = Object.fromEntries(CORNERS.map(k => [k, build.attach?.[car.model.sockets[k]] === 'detached']));
  return { carriers, toughness, partOf, off, zones: car.damageZones ?? {}, armour };
}

// The zones a hit reaches, and how hard: [{ zone, strength, corner? }]
export function zonesHit(impact, zones, rules) {
  const n = norm(impact.normal), s = impact.strength, out = [];
  const reach = (rules.zoneReach ?? 0.35) + (impact.depth ?? 0);
  for (const [name, z] of Object.entries(zones)) {
    if (name.startsWith('_')) continue;
    if (impact.under && !CORNERS.includes(name)) continue;          // (from underneath: only the wheels feel it)
    const d = nearest(impact, z.box), near = d <= 0 ? 1 : Math.max(0, 1 - d / reach);
    const facing = z.facing ? Math.max(0, dot(n, norm(z.facing))) : 1, strength = s * near * facing;
    if (strength > 0.05) out.push({ zone: name, strength: r4(strength), ...(CORNERS.includes(name) && { corner: name }) });
  }
  return out;
}

// A car's mechanical damage (instanceId → its damage block) with a hit on some zones applied.
// hits: [{ zone, strength, corner? }]; toe: the way a hit turns a wheel ({ FL: ±1 }, by where and which
// way it struck; none: outward). Returns { damage: { instanceId: block } (only those changed), effects:
// [{ system, corner, what, from, to }], wheelOff: [corner] }
export function applyHits(state, hits, layout, rules, { toe = {} } = {}) {
  const M = rules, S = M.systems, out = { damage: {}, effects: [], wheelOff: [] };
  const block = id => (out.damage[id] ??= clone(state[id] ?? {}));
  const T = id => layout.toughness[id] ?? 1;
  const bump = (id, path, add, max, min = -Infinity) => {
    if (!id || !add) return;
    const b = block(id), keys = path.split('.'), last = keys.pop(), o = keys.reduce((a, k) => (a[k] ??= {}), b);
    const from = o[last] ?? 0, to = r4(clamp(from + add, min, max));
    if (to === from) return;
    o[last] = to;
    out.effects.push({ what: path, id, from, to });
  };
  for (const h of hits) {
    // (the car's belly: a landing hard enough to bottom it out — rules.underbody)
    const zone = layout.zones[h.zone] ?? (h.zone === 'underbody' && M.underbody ? { systems: M.underbody.systems } : null);
    if (!zone) continue;
    const systems = zone.systems ?? [], k = h.corner, c = h.strength;
    if (k && layout.off[k]) continue;                                  // (no wheel there to damage)
    if (k && M.wheelOff && c >= M.wheelOff.from && layout.carriers.rim[k]) out.wheelOff.push(k);
    for (const sys of systems) {
      // (armour takes its share of the hit first)
      const R = S[sys], over = R ? c * (1 - (layout.armour?.[sys] ?? 0)) - R.from : 0;
      if (!R || over <= 0) continue;
      if (WHEEL_SYSTEMS.includes(sys) && !k) continue;
      const n0 = out.effects.length;
      if (sys === 'steering') {
        const id = layout.carriers.suspension, sign = toe[k] ?? (k.endsWith('L') ? 1 : -1);
        bump(id, `${k}.toe`, sign * over * R.toePerMs / T(id), R.max, -R.max);
      } else if (sys === 'suspension') {
        const id = layout.carriers.suspension, t = T(id);
        bump(id, `${k}.camber`, over * R.camberPerMs / t, R.maxCamber, 0);
        bump(id, `${k}.ride`, over * R.ridePerMs / t, R.maxRide, 0);
        bump(id, `${k}.damper`, over * R.damperPerMs / t, 1 - R.minDamper, 0);
      } else if (sys === 'rim') {
        const id = layout.carriers.rim[k];
        bump(id, 'bend', over * R.bendPerMs / T(id), R.max, 0);
      } else if (sys === 'tyre') {
        const id = layout.carriers.tyre[k];
        bump(id, 'leak', over * R.leakPerMs / T(id), R.maxLeak, 0);
      } else if (sys === 'brakeLine') {
        const id = layout.carriers.brakeLine;
        bump(id, `${k}.line`, over * R.perMs / T(id), R.max, 0);
      } else if (sys === 'radiator') {
        const id = layout.carriers.radiator;
        bump(id, 'leak', over * R.leakPerMs / T(id), R.max, 0);
      } else if (sys === 'intake') {
        const id = layout.carriers.intake;                               // (the turbo: none fitted, nothing leaks)
        bump(id, 'boost', over * R.leakPerMs / T(id), R.max, 0);
      } else {
        const id = layout.carriers[sys], key = { gearbox: 'gears', differential: 'gears', exhaust: 'holes' }[sys];
        if (key) bump(id, key, over * R.perMs / T(id), R.max, 0);
      }
      for (let i = n0; i < out.effects.length; i++) Object.assign(out.effects[i], { system: sys, ...(k && { corner: k }) });
    }
  }
  return out;
}

// An impact → the mechanical damage it does (mode 'full' only: visual only and off leave the
// mechanicals alone). depth: the dent's depth (garage/damage.js), so a hard hit reaches further in.
// Each wheel hit is turned the way the blow twists it about its steering axis.
export function impactMechanical(state, impact, layout, rules, { mode = 'full', wheelAt = {} } = {}) {
  if (mode !== 'full' || !rules) return { damage: {}, effects: [], wheelOff: [], hits: [] };
  const hits = zonesHit(impact, layout.zones, rules), n = norm(impact.normal), toe = {};
  for (const h of hits) {
    if (!h.corner || !wheelAt[h.corner]) continue;
    // (the blow's twist about the upright: + turns the wheel to the left)
    const r = sub(impact.point, wheelAt[h.corner]), F = n.map(x => -x), twist = r[2] * F[0] - r[0] * F[2];
    toe[h.corner] = Math.abs(twist) > 1e-3 ? Math.sign(twist) : (h.corner.endsWith('L') ? 1 : -1);
  }
  return { ...applyHits(state, hits, layout, rules, { toe }), hits };
}

// A wheel slammed (a kerb's edge hit hard, a heavy landing: physics/mechanical.js works out how hard):
// a hit on its corner at that strength — and a landing hard enough to bottom the car out
// (rules.underbody.from) hits its belly too: the exhaust, gearbox, diff and sump (skid plates shield them)
export function strikeMechanical(state, corner, strength, layout, rules, { mode = 'full', kind = 'kerb' } = {}) {
  if (mode !== 'full' || !rules || !(strength > 0) || !CORNERS.includes(corner)) return { damage: {}, effects: [], wheelOff: [], hits: [] };
  const hits = [{ zone: corner, corner, strength: r4(strength) }], U = rules.underbody;
  if (kind === 'landing' && U && strength >= U.from) hits.push({ zone: 'underbody', strength: r4(strength * U.share) });
  return { ...applyHits(state, hits, layout, rules), hits };
}

// Set one system's damage straight (debug): which: 'toe' | 'camber' | 'ride' | 'damper' | 'bend' |
// 'puncture' | 'pressure' | 'brakeLine' | 'radiator' | 'coolant' | 'boost' | 'gearbox' | 'differential'
// | 'clutch' | 'exhaust'; corner for the wheel ones. Returns { damage: { id: block } } or { error }
export const DEBUG_KINDS = {
  toe: { carrier: 'suspension', path: k => `${k}.toe`, corner: true },
  camber: { carrier: 'suspension', path: k => `${k}.camber`, corner: true },
  ride: { carrier: 'suspension', path: k => `${k}.ride`, corner: true },
  damper: { carrier: 'suspension', path: k => `${k}.damper`, corner: true },
  bend: { carrier: 'rim', path: () => 'bend', corner: true },
  puncture: { carrier: 'tyre', path: () => 'leak', corner: true },
  pressure: { carrier: 'tyre', path: () => 'pressure', corner: true },
  brakeLine: { carrier: 'brakeLine', path: k => `${k}.line`, corner: true },
  radiator: { carrier: 'radiator', path: () => 'leak' },
  coolant: { carrier: 'radiator', path: () => 'coolant' },
  boost: { carrier: 'intake', path: () => 'boost' },
  gearbox: { carrier: 'gearbox', path: () => 'gears' },
  differential: { carrier: 'differential', path: () => 'gears' },
  clutch: { carrier: 'clutch', path: () => 'wear' },
  exhaust: { carrier: 'exhaust', path: () => 'holes' },
};
export function setMechanical(state, kind, value, corner, layout) {
  const K = DEBUG_KINDS[kind];
  if (!K) return { error: `No damage called "${kind}": ${Object.keys(DEBUG_KINDS).join(', ')}.` };
  if (K.corner && !CORNERS.includes(corner)) return { error: `${kind} needs a corner: FL, FR, RL or RR.` };
  const id = K.corner && (K.carrier === 'rim' || K.carrier === 'tyre') ? layout.carriers[K.carrier][corner] : layout.carriers[K.carrier];
  if (!id) return { error: kind === 'boost' ? 'No turbo fitted: nothing to leak boost.' : `Nothing fitted carries the ${kind}.` };
  const b = clone(state[id] ?? {}), keys = K.path(corner).split('.'), last = keys.pop(), o = keys.reduce((a, k) => (a[k] ??= {}), b);
  if (value == null) delete o[last]; else o[last] = value;
  return { damage: { [id]: prune(b) } };
}

// A damage block without the values that mean "fine" (and empty corners): what's kept in the save
export function prune(block) {
  const out = {};
  for (const [k, v] of Object.entries(block ?? {})) {
    if (v && typeof v === 'object') { const inner = prune(v); if (Object.keys(inner).length) out[k] = inner; }
    else if (Number.isFinite(v) && !((k === 'pressure' || k === 'coolant') ? v >= 1 : v === 0)) out[k] = v;
  }
  return out;
}
export const hasDamage = block => !!block && Object.keys(prune(block)).length > 0;
const clone = x => JSON.parse(JSON.stringify(x));

// The spec's damage block (garage/stats.js): every wheel's and system's values as the physics uses
// them, from the parts' damage blocks — layout from mechanicalLayout, owned: { id: { damage } }
export function specDamage(layout, owned, rules) {
  const d = id => (id && owned[id]?.damage) || {};
  const sus = d(layout.carriers.suspension), br = d(layout.carriers.brakeLine), eng = d(layout.carriers.radiator);
  const wheels = {};
  for (const k of CORNERS) {
    const s = sus[k] ?? {}, rim = d(layout.carriers.rim[k]), tyre = d(layout.carriers.tyre[k]);
    wheels[k] = {
      toe: s.toe ?? 0, camber: s.camber ?? 0, ride: s.ride ?? 0, damper: s.damper ?? 0, bend: rim.bend ?? 0,
      pressure: tyre.pressure ?? 1, leak: tyre.leak ?? 0, brake: br[k]?.line ?? 0, off: !!layout.off[k],
    };
  }
  return {
    wheels,
    coolant: eng.coolant ?? 1, radiatorLeak: eng.leak ?? 0, boost: d(layout.carriers.intake).boost ?? 0,
    gearbox: d(layout.carriers.gearbox).gears ?? 0, differential: d(layout.carriers.differential).gears ?? 0,
    clutch: d(layout.carriers.clutch).wear ?? 0, exhaust: d(layout.carriers.exhaust).holes ?? 0,
    rules: clone(rules.effects),
  };
}

// Every system's state in words (the damage report, the HUD): [{ system, corner?, state, level: 'ok' |
// 'worn' | 'bad', value }] from the spec's damage block and the physics' live values (snapshot)
export function damageReport(D, live = null) {
  if (!D) return [];
  const E = D.rules ?? {}, rows = [], lvl = (x, a, b) => x >= b ? 'bad' : x >= a ? 'worn' : 'ok';
  for (const k of CORNERS) {
    const w = D.wheels[k], L = live?.wheels?.[k] ?? {};
    if (w.off || L.off) { rows.push({ system: 'wheel', corner: k, state: 'torn off', level: 'bad' }); continue; }
    const p = L.pressure ?? w.pressure, leak = w.leak;
    rows.push({ system: 'steering', corner: k, value: w.toe, state: w.toe ? `toe ${w.toe > 0 ? '+' : '−'}${Math.abs(w.toe).toFixed(2)}°` : 'straight', level: lvl(Math.abs(w.toe), 0.2, 1.5) });
    rows.push({ system: 'suspension', corner: k, value: w.camber, state: [w.camber && `camber ${w.camber.toFixed(1)}°`, w.ride && `${Math.round(w.ride * 1000)} mm low`, w.damper && `damper ${Math.round((1 - w.damper) * 100)}%`].filter(Boolean).join(' · ') || 'fine', level: lvl(Math.max(w.camber / 2, w.ride * 50, w.damper * 2), 0.1, 1) });
    rows.push({ system: 'rim', corner: k, value: w.bend, state: w.bend ? `bent ${w.bend.toFixed(1)} mm` : 'true', level: lvl(w.bend, 0.5, 3) });
    const flat = p <= (E.tyre?.flatBelow ?? 0.08);
    rows.push({ system: 'tyre', corner: k, value: p, state: flat ? 'FLAT' : `${Math.round(p * 100)}%${leak ? ` · leaking ${(leak * 100).toFixed(1)}%/s` : ''}`, level: flat ? 'bad' : lvl(Math.max(1 - p, leak * 20), 0.05, 0.3) });
    rows.push({ system: 'brake line', corner: k, value: w.brake, state: w.brake ? `${Math.round((1 - w.brake) * 100)}% force` : 'fine', level: lvl(w.brake, 0.05, 0.4) });
  }
  const coolant = live?.coolant ?? D.coolant;
  rows.push({ system: 'cooling', value: coolant, state: `coolant ${Math.round(coolant * 100)}%${D.radiatorLeak ? ` · radiator leaking ${(D.radiatorLeak * 100).toFixed(1)}%/s` : ''}${live?.temp != null ? ` · ${Math.round(live.temp)}°C` : ''}${live?.limp ? ' · LIMP MODE' : ''}`, level: live?.limp || coolant < 0.3 ? 'bad' : lvl(Math.max(1 - coolant, D.radiatorLeak * 50), 0.05, 0.5) });
  rows.push({ system: 'boost pipes', value: D.boost, state: D.boost ? `${Math.round(D.boost * 100)}% of the boost leaking` : 'sealed', level: lvl(D.boost, 0.05, 0.3) });
  rows.push({ system: 'gearbox', value: D.gearbox, state: D.gearbox ? `${Math.round(D.gearbox * 100)}% damaged${D.gearbox >= (E.gearbox?.failFrom ?? 1) ? ' · gears can miss' : ''}` : 'fine', level: lvl(D.gearbox, 0.1, E.gearbox?.failFrom ?? 0.4) });
  rows.push({ system: 'differential', value: D.differential, state: D.differential ? `${Math.round(D.differential * 100)}% damaged` : 'fine', level: lvl(D.differential, 0.1, 0.5) });
  const wear = live?.clutchWear ?? D.clutch;
  rows.push({ system: 'clutch', value: wear, state: `${wear ? `${Math.round(wear * 100)}% worn` : 'fine'}${live?.clutchTemp != null ? ` · ${Math.round(live.clutchTemp)}°C` : ''}`, level: lvl(wear, 0.1, 0.4) });
  rows.push({ system: 'exhaust', value: D.exhaust, state: D.exhaust ? `${Math.round(D.exhaust * 100)}% holed` : 'fine', level: lvl(D.exhaust, 0.1, 0.5) });
  return rows;
}
