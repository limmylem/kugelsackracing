// Crash damage: an impact (physics/impacts.js) → what it did to the car, by the rules in
// data/damage.json. Pure, no rendering, so the page, tests and (later) a server work it out the same.
//
//  - What was hit: the parts a hit can reach (rules.exterior categories) and the body shell, each a box
//    in the car frame (its bounds on its socket; the shell's and the glass and lights' from the model:
//    physics/sockets.js nodeBoxes). Of those level with the contact (its height range: a low barrier
//    doesn't reach the mirror) and beside it (within reach), the one sticking out furthest toward what
//    was hit: the bumper in a head-on hit, the mirror or door along a wall.
//  - The dent: on that part's outside, pushed in along the contact normal, as deep and wide as the
//    strength says. Every part (and the shell) the dent reaches keeps it in its own list (each part's
//    point relative to its socket, so the dent moves with the part), and the drawing (garage/dents.js)
//    pushes their vertices in with a smooth falloff. Lists are kept short: a dent near an old one
//    deepens it.
//  - Condition: the part hit loses points by the strength (÷ its toughness), those round it less; a
//    hard hit on the engine's end (the front; a mid or rear engine's, the back) hurts the engine a
//    little, one that reaches a wheel its rim and tyre.
//  - Glass and lights the dent reaches break, hit hard enough.
//
// mode: 'full' (all of it), 'visual' (dents and breakages, no condition: no performance lost), 'off'
// (nothing; the result still says how hard it was, for the sound).

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = a => { const l = Math.hypot(...a) || 1; return scale(a, 1 / l); };
const round = (a, d = 4) => a.map(x => +x.toFixed(d));
export function curveAt(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (x <= curve[i][0]) { const [x0, y0] = curve[i - 1], [x1, y1] = curve[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return curve[curve.length - 1][1];
}
export const dentSize = (rules, s) => ({ depth: curveAt(rules.dent.depth, s), radius: curveAt(rules.dent.radius, s) });
export const strengthClass = (rules, s) => s >= rules.classes.crash ? 'crash' : s >= rules.classes.crunch ? 'crunch' : 'tap';

// (boxes)
const boxOf = (origin, b) => ({ min: add(origin, b.min), max: add(origin, b.max) });
const around = (p, h) => ({ min: sub(p, h), max: add(p, h) });
const boxDistance = (p, b) => Math.hypot(...[0, 1, 2].map(k => Math.max(0, b.min[k] - p[k], p[k] - b.max[k])));
const support = (b, n) => [0, 1, 2].reduce((a, k) => a + (n[k] > 0 ? b.max[k] : b.min[k]) * n[k], 0);
const volume = b => [0, 1, 2].reduce((a, k) => a * Math.max(1e-4, b.max[k] - b.min[k]), 1);
const WHEEL_BOX = [0.11, 0.3, 0.3];

// What a hit can reach on a car as built: { shell, parts, breakables, engine, corners }
// car: its definition; build: { sockets }; db: { parts, owned }; boxes: nodeBoxes of the body's
// model (body_shell, and the glass and lights: car.model.breakables)
export function damageLayout({ car, build, db, boxes = {} }, rules) {
  const bc = car.dimensions.bodyCollider, shellBox = boxes.body_shell ?? around(bc.centre, bc.halfExtents);
  const parts = [], corners = {};
  let engine = null, engineAt = null, cage = 0;
  for (const s of car.sockets) {
    const id = build.sockets?.[s.name], inst = id && db.owned[id], part = inst && db.parts[inst.partId];
    if (!part || build.attach?.[s.name] === 'detached') continue;      // (torn off: nothing there to hit)
    if (part.engine) { engine = id; engineAt = s.position; }
    cage += part.chassisToughness ?? 0;              // (a roll cage: the whole car takes hits better)
    if (!rules.exterior.includes(part.category)) continue;
    const wheel = s.slot === 'wheel' || s.slot === 'tyre' ? Object.entries(car.model.sockets).find(([, n]) => n === (s.node ?? s.name))?.[0] ?? null : null;
    const box = wheel ? around(s.position, WHEEL_BOX) : (part.byCar?.[car.id]?.bounds ?? part.bounds) ? boxOf(s.position, part.byCar?.[car.id]?.bounds ?? part.bounds) : around(s.position, [0.15, 0.15, 0.15]);
    parts.push({ target: s.name, socket: s.name, instanceId: id, part, box, origin: s.position, toughness: part.toughness ?? 1, wheel });
    if (wheel) (corners[wheel] ??= { box })[s.slot === 'tyre' ? 'tyre' : 'rim'] = id;
  }
  const breakables = (car.model.breakables ?? []).filter(b => boxes[b.node]).map(b => ({ node: b.node, kind: b.kind, box: boxes[b.node] }));
  if (cage) for (const p of parts) p.toughness *= 1 + cage * 0.5;
  // (armour — a bull bar, rock sliders: the parts it shields take hits that much better)
  for (const s of car.sockets) {
    const id = build.sockets?.[s.name], A = id && build.attach?.[s.name] !== 'detached' && db.parts[db.owned[id]?.partId]?.protects;
    if (A?.slots) for (const p of parts) if (A.slots.includes(p.part.slot)) p.toughness /= 1 - A.by;
  }
  return { shell: { target: 'shell', box: shellBox, origin: [0, 0, 0], toughness: (car.shell?.toughness ?? 1) + cage }, parts, breakables, engine, engineAt, corners, cage };
}

// An impact → { strength, class, material, other, hit, point, normal, depth, radius, dents, losses, stress, broken }
//  dents: [{ target: socket name | 'shell', p (from its socket, car frame), d (the way it's pushed), s,
//          w (how much of the dent's depth: a wide hit's dents share it) }]
//  losses: [{ target, instanceId (none for the shell), loss (condition points) }]
//  stress: [{ target, instanceId, points }] how hard each part was hit (the same, whatever the setting)
//  broken: [glass / light node names]
export function impactDamage(impact, layout, rules, { mode = 'full' } = {}) {
  const s = impact.strength, n = norm(impact.normal), out = { strength: s, class: strengthClass(rules, s), material: impact.material, other: impact.other, under: !!impact.under, hit: null, point: impact.point, normal: n, depth: 0, radius: 0, dents: [], losses: [], stress: [], broken: [] };
  const { depth, radius } = dentSize(rules, s);
  Object.assign(out, { depth, radius });
  const all = [...layout.parts, layout.shell];
  if (impact.under) { out.hit = { target: 'shell', name: 'the underbody' }; }
  else {
    // level with the contact and beside it; then the one furthest out toward what was hit
    const [y0, y1] = impact.yRange ?? [impact.point[1], impact.point[1]], c = impact.point, flat = Math.abs(n[1]) < 0.7;
    const side = flat ? norm([n[2], 0, -n[0]]) : null, reach = rules.dent.reach + radius * 0.5;
    // (beside: along the side, anywhere the contact reached — a wall along the car's side touches it
    // from end to end, and the mirror sticking out is what it hits)
    const ext = impact.extent, ca = ext ? Math.min(dot(ext.min, side ?? [0, 0, 0]), dot(ext.max, side ?? [0, 0, 0])) : null, cb = ext ? Math.max(dot(ext.min, side ?? [0, 0, 0]), dot(ext.max, side ?? [0, 0, 0])) : null;
    const beside = t => {
      if (!flat) return boxDistance(c, t.box) <= reach;
      const lo = Math.min(dot(t.box.min, side), dot(t.box.max, side)), hi = Math.max(dot(t.box.min, side), dot(t.box.max, side)), x = dot(c, side);
      const from = ext ? Math.min(ca, x) : x, to = ext ? Math.max(cb, x) : x;
      return t.box.max[1] >= y0 - 0.05 && t.box.min[1] <= y1 + 0.05 && Math.max(0, lo - to, from - hi) <= reach;
    };
    const candidates = all.filter(beside), hit = (candidates.length ? candidates : [layout.shell]).reduce((best, t) => {
      const a = support(t.box, n), b = support(best.box, n);
      return a > b + 1e-3 || (Math.abs(a - b) <= 1e-3 && volume(t.box) < volume(best.box)) ? t : best;
    });
    // the dent's centre: on the outside of the part hit, level with the contact as far as it can be
    let P = add(c, scale(n, support(hit.box, n) - dot(c, n)));
    P = P.map((v, k) => Math.abs(n[k]) > 0.7 ? v : clamp(v, hit.box.min[k], hit.box.max[k]));
    out.hit = { target: hit.target, name: hit.part?.name ?? 'the body shell' };
    out.point = round(P);
    if (mode === 'off') return out;
    // a wide, hard hit (a wall across the whole front) caves it in all along the contact: dents every
    // half radius, each weighted (w) so together they go evenly deep
    const fall = d => d >= radius ? 0 : (1 - (d / radius) ** 2) ** 2;
    let centres = [P], weights = [1];
    if (flat && impact.extent && radius >= 0.3) {
      const a = dot(impact.extent.min, side), b = dot(impact.extent.max, side), from = Math.min(a, b), to = Math.max(a, b), x = dot(P, side);
      const k = Math.min(8, Math.ceil((to - from) / (radius * 0.5)));
      if (k >= 1) {
        const xs = Array.from({ length: k + 1 }, (_, i) => from + (to - from) * i / k);
        centres = xs.map(at => round(add(P, scale(side, at - x))));
        weights = xs.map(xi => 1 / xs.reduce((sum, xj) => sum + fall(Math.abs(xi - xj)), 0));
      }
    }
    out.centres = centres;
    const inward = round(scale(n, -1)), near = t => Math.min(...centres.map(q => boxDistance(q, t.box)));
    for (const t of all) {
      if (t.wheel) continue;                         // (wheels spin: no dents drawn on them)
      centres.forEach((q, i) => {
        if (!((t === hit && centres.length === 1) || boxDistance(q, t.box) <= radius)) return;
        out.dents.push({ target: t.target, p: round(sub(q, t.origin)), d: inward, s: +s.toFixed(3), ...(weights[i] < 0.999 && { w: +weights[i].toFixed(3) }) });
      });
    }
    for (const b of layout.breakables) if (near(b) <= radius * 0.9 && s >= rules.breakables[b.kind]) out.broken.push(b.node);
    // how hard each part (and the shell) was hit, in condition points: what it loses (full damage),
    // and what shakes it loose (garage/detach.js), whatever the damage setting
    const base = curveAt(rules.condition.loss, s), loss = [];
    for (const t of all) {
      if (t.wheel) continue;
      const d = t === hit ? 0 : near(t);
      if (d > radius) continue;
      const pts = (t === hit ? base : base * rules.condition.neighbours * fall(d)) / t.toughness;
      if (pts > 0.05) loss.push({ target: t.target, instanceId: t.instanceId ?? null, loss: +pts.toFixed(2) });
    }
    out.stress = loss.map(l => ({ target: l.target, instanceId: l.instanceId, points: l.loss }));
    if (mode !== 'full') return out;
    // the wheels the hit reaches: rim and tyre
    if (s >= rules.wheels.from) for (const [k, corner] of Object.entries(layout.corners)) {
      const d = near(corner), hitHere = hit.wheel === k;
      if (!hitHere && d > radius) continue;
      for (const id of [corner.rim, corner.tyre].filter(Boolean)) {
        const t = layout.parts.find(x => x.instanceId === id), pts = base * rules.wheels.share * (hitHere ? 1 : fall(d)) / (t?.toughness ?? 1);
        if (pts > 0.05) loss.push({ target: t.target, instanceId: id, loss: +pts.toFixed(2) });
      }
    }
    // the engine: a hard hit on its end of the car (the front; a mid or rear engine's, the back)
    const E = rules.engine, end = (layout.engineAt?.[2] ?? 1) < 0 ? -1 : 1;
    if (layout.engine && n[2] * end > 0.5 && P[2] * end > E.frontZ && s > E.from) loss.push({ target: 'engine', instanceId: layout.engine, loss: +Math.min(E.max, (s - E.from) * E.perMs).toFixed(2) });
    out.losses = loss;
    return out;
  }
  // (under the car: no dent drawn; the shell takes a little)
  if (mode === 'full') { const pts = curveAt(rules.condition.loss, s) * 0.5 / layout.shell.toughness; if (pts > 0.05) out.losses.push({ target: 'shell', instanceId: null, loss: +pts.toFixed(2) }); }
  return out;
}

// A part's (or the shell's) dent list with a new dent: near an old one (within merge × the bigger's
// radius), it deepens that one (strengths add as energies: two taps in one place make a deeper dent);
// with the list full, it goes into the nearest
export function addDent(list, dent, rules) {
  const out = (list ?? []).map(x => ({ ...x })), r = dentSize(rules, dent.s).radius;
  let best = -1, bestD = Infinity;
  out.forEach((x, i) => { const d = Math.hypot(...sub(x.p, dent.p)); if (d < bestD) { bestD = d; best = i; } });
  const near = best >= 0 && bestD <= rules.dent.merge * Math.max(r, dentSize(rules, out[best].s).radius);
  if (!near && out.length < rules.dent.maxPerPart) { out.push({ p: dent.p, d: dent.d, s: dent.s, ...(dent.w != null && { w: dent.w }) }); return out; }
  const o = out[best], a = o.s ** 2, b = dent.s ** 2, w = Math.max(o.w ?? 1, dent.w ?? 1);
  out[best] = { p: round(scale(add(scale(o.p, a), scale(dent.p, b)), 1 / (a + b))), d: round(norm(add(scale(o.d, a), scale(dent.d, b)))), s: +Math.sqrt(a + b).toFixed(3), ...(w < 0.999 && { w }) };
  return out;
}

// A car's damage state with an impact's result applied: { shell: { condition, dents, broken }, parts:
// { instanceId: { condition, dents } } } (conditions: what they are now, for the parts involved)
export function applyDamage(state, result, rules, bySocket) {
  const next = { shell: { condition: state.shell?.condition ?? 100, dents: state.shell?.dents ?? [], broken: [...(state.shell?.broken ?? [])] }, parts: { ...state.parts } };
  const copied = new Set(), part = id => {
    if (!copied.has(id)) { copied.add(id); next.parts[id] = { condition: 100, dents: [], ...next.parts[id] }; }
    return next.parts[id];
  };
  for (const d of result.dents) {
    const dent = { p: d.p, d: d.d, s: d.s, ...(d.w != null && { w: d.w }) };
    if (d.target === 'shell') next.shell.dents = addDent(next.shell.dents, dent, rules);
    else { const id = bySocket[d.target]; if (id) part(id).dents = addDent(part(id).dents, dent, rules); }
  }
  for (const l of result.losses) {
    if (l.target === 'shell') next.shell.condition = +Math.max(0, next.shell.condition - l.loss).toFixed(2);
    else if (l.instanceId) { const p = part(l.instanceId); p.condition = +Math.max(0, p.condition - l.loss).toFixed(2); }
  }
  for (const b of result.broken) if (!next.shell.broken.includes(b)) next.shell.broken.push(b);
  return next;
}
