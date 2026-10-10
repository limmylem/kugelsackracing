// Stats calculator: a build (a car and the parts in its sockets, their condition and tuning) → the
// physics spec the vehicle system uses (the same shape as the Phase 1 car spec, so the physics doesn't
// know parts exist), totals (mass, power, top speed, wheel size, the performance rating) and a breakdown
// of where every final number came from.
//
// Order, always the same:
//  1. the car: its own body-level values (chassis, dimensions, base aero, drive layout, the car's
//     controls, aids and cameras)
//  2. components, in socket order: each sets its whole system block (engine, gearbox, clutch,
//     differential, tyre, brakes, suspension) — or, an upgrade (part.upgrade: a big brake kit), the
//     car's own stock part's block changed by the upgrade's effects; aero components (a wing) are added to the car's aero
//     parts; body parts add their aeroEffect to the car's drag and lift. The tyre's grip scales with its
//     width (gripWidth). Parts on several corners (tyres) must be the same part on every corner (the
//     physics has one tyre for the whole car).
//  3. tuning: each fitted part's settings (its owner's, else the defaults; clamped to their range)
//  4. modifiers' effects, over every modifier in socket order and each one's effects in the order it
//     lists them: first all the adds, then all the multiplies (and boosts), then all the sets
//  5. condition: worn parts scale their category's targets (data/condition.json)
//  6. wheels: each corner's radius (rim + tyre sidewall, to the mm), turning inertia (hub + rim + tyre),
//     unsprung mass (rim, tyre, spacer) and how far out it sits (rim offset, spacers)
//  7. mass, centre of mass and inertia tensor: the chassis plus every fitted part at its socket (plus its
//     massOffset), each part a box the size of its bounds (a point, with none)
//
// A crash can shake parts loose or tear them off (build.attach: socket → 'loose' | 'detached'; none:
// all on): a torn-off part isn't on the car at all (no mass, no aero, no effects); a loose one is its
// own body in the physics (not the car's mass) and adds its detach.looseDrag to the car's drag. A wheel
// torn off takes its tyre and spacer with it (spec.damage.wheels[k].off: the physics drops that corner).
//
// A few values every car has for parts to change: cooling.capacity (the radiator, sized for the car's
// own engine — car.json cooling.capacity, 1 if it hasn't one: physics/mechanical.js),
// soundMod (level, tone, intake: how loud and open the engine is, and its intake — from the parts' sound blocks,
// with the rest of what they sound like in spec.audio: garage/carSound.js), cosmetic (smoke,
// underglow, fog: colours; tint: light | dark | limo — the drawing).
//
// The drive layout (car.json drivetrain.layout, or a part that sets it) says which differentials the
// car needs: AWD a front and a centre differential, 4WD a front differential and a transfer case (parts
// with those blocks). A roof part (a convertible's soft top or hardtop) sets spec.roof; a lift kit adds
// to wheels.lift, room in the arches (wheels.maxTyreRadius, the car's) for bigger tyres.
//
// Mechanical damage (each part copy's damage block: garage/mechanical.js) goes into spec.damage for the
// physics (physics/mechanical.js): every wheel's toe, camber, ride height, damper, rim bend, tyre
// pressure and leak, brake line; the coolant and radiator leak, boost leak, gearbox, diff, clutch and
// exhaust; and the rules it works by (data/damage.json mechanical.effects).
//
// db: { cars, parts, owned: { instanceId: { instanceId, partId, condition, tuning? } }, condition?, classes? }

import { dyno, engineTorque } from '../physics/engine.js';
import { angleScale } from '../physics/parts.js';
import { SEA_LEVEL_DENSITY } from '../physics/aero.js';
import { tyreFit } from './tyres.js';
import { fullTorques } from '../physics/brakes.js';
import { fingerprint } from './fingerprint.js';
import { performance } from './rating.js';
import { mechanicalLayout, specDamage } from './mechanical.js';
import { soundOf } from './carSound.js';

const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
export const SYSTEM_BLOCKS = ['engine', 'gearbox', 'clutch', 'differential', 'tyre', 'brakes', 'suspension'];
// (blocks a car needs only for some layouts, and a roof: a convertible's)
export const OPTIONAL_BLOCKS = ['frontDifferential', 'centreDifferential', 'transferCase', 'roof'];
const LAYOUT_BLOCKS = { AWD: ['frontDifferential', 'centreDifferential'], '4WD': ['frontDifferential', 'transferCase'] };
const BLOCK_WORDS = { tyre: 'tyres', frontDifferential: 'front differential', centreDifferential: 'centre differential', transferCase: 'transfer case' };
const ATM = 1.01325;     // bar

// Every leaf of a value (skipping notes): [path, value]
function leaves(v, path, out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}.${i}`, out));
  else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) leaves(x, path ? `${path}.${k}` : k, out); }
  else out.push([path, v]);
  return out;
}
export const getPath = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, path, value) { const ks = path.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = value; }

// The parts in a build: [{ socket (the car's socket), instance, part }] in socket order (empty ones too)
export function fittedParts(build, db) {
  const car = db.cars[build.carId];
  if (!car) return [];
  return car.sockets.map(socket => {
    const instanceId = build.sockets?.[socket.name] ?? null, instance = instanceId ? db.owned[instanceId] : null;
    return { socket, instanceId, instance, part: instance ? db.parts[instance.partId] ?? null : null };
  });
}

// How much of an effect applies at an engine speed (1 inside the rpm range, fading to 0 over `fade`)
function rpmWeight(when, rpm) {
  if (!when?.rpm) return 1;
  const [a, b] = when.rpm, f = when.fade || 0;
  if (rpm >= a && rpm <= b) return 1;
  const d = rpm < a ? a - rpm : rpm - b;
  return f > 0 && d < f ? 1 - d / f : 0;
}
function curveAt(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (x <= curve[i][0]) { const [x0, y0] = curve[i - 1], [x1, y1] = curve[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return curve[curve.length - 1][1];
}

// One effect on the spec: returns the leaves it changed [{ path, from, to }] (or throws if its target
// doesn't exist)
function applyEffect(spec, effect) {
  const target = getPath(spec, effect.target);
  if (target === undefined) throw new Error(`there's no ${effect.target} to change`);
  const changes = [];
  const change = (path, from, to) => { if (from !== to) { setPath(spec, path, to); changes.push({ path, from, to }); } };
  const isCurve = effect.target.endsWith('torqueCurve');
  // the numbers it acts on: each point's torque on a torque curve (with its rpm), else every number under the target
  const points = isCurve ? target.map(([rpm, t], i) => ({ path: `${effect.target}.${i}.1`, value: t, rpm }))
    : leaves(target, effect.target).map(([path, value]) => ({ path, value, rpm: null }));
  for (const p of points) {
    const w = p.rpm === null ? 1 : rpmWeight(effect.when, p.rpm);
    if (w <= 0) continue;
    if (effect.op === 'add') change(p.path, p.value, p.value + effect.value * w);
    else if (effect.op === 'multiply') change(p.path, p.value, p.value * (1 + (effect.value - 1) * w));
    else if (effect.op === 'boost') change(p.path, p.value, p.value * (1 + effect.efficiency * curveAt(effect.curve, p.rpm) / ATM));
    else if (effect.op === 'set' && w >= 0.5) change(p.path, p.value, effect.value);
  }
  if (!isCurve && effect.op === 'set' && !points.length) change(effect.target, target, effect.value);
  return changes;
}
const PHASES = [['add'], ['multiply', 'boost'], ['set']];

export function computeStats(build, db) {
  const car = db.cars[build.carId], errors = [], breakdown = {};
  if (!car) return { spec: null, totals: null, breakdown, errors: [`there's no car "${build.carId}"`] };
  const record = (path, entry) => (breakdown[path] ||= []).push(entry);
  const carSource = { kind: 'car', id: car.id, name: car.name };
  const partSource = (f, count = 1) => ({ kind: 'part', id: f.part.id, name: f.part.name, socket: f.socket.name, count });
  const W = car.wheels;

  // 1. the car
  const spec = {
    name: car.name, _axes: car._axes, _tuning: car._tuning,
    model: clone(car.model),
    mass: 0, centreOfMass: [0, 0, 0], inertiaTensor: [0, 0, 0, 0, 0, 0],
    bodyCollider: clone(car.dimensions.bodyCollider),
    suspension: null,
    wheels: {
      radius: null, inertia: null, front: clone(W.front), rear: clone(W.rear), ...(W.mountHeight && { mountHeight: clone(W.mountHeight) }),
      unsprungBaseline: W.unsprungBaseline ?? 0, unsprung: {}, offsets: {}, lift: 0,
    },
    steering: clone(car.steering), pedals: clone(car.pedals), drivetrain: clone(car.drivetrain),
    engine: null, clutch: null, gearbox: null, differential: null, brakes: null,
    assists: clone(car.assists), tyre: null, aero: clone(car.aero), camera: clone(car.camera),
    spawnHeight: car.dimensions.spawnHeight,
    aeroParts: [],
    ...(car.roof && { roof: clone(car.roof) }),
    // (for parts to change: the cooling — a bigger radiator —, the engine's sound — an exhaust, an
    // intake —, and looks the drawing and the effects follow: tyre smoke, underglow, window tint)
    cooling: { capacity: car.cooling?.capacity ?? 1 },
    soundMod: { level: 1, tone: 1, intake: 1 },
    cosmetic: { smoke: '', underglow: '', tint: '', fog: '' },
  };
  // (room in the arches for bigger tyres, which a lift kit adds to)
  if (W.maxTyreRadius) spec.wheels.maxTyreRadius = W.maxTyreRadius;
  // (the ABS's rates are for the car's own brakes: what they make at full pedal, physics/brakes.js)
  const stockBrakesPart = db.parts[car.sockets.find(s => s.slot === 'brakes')?.stock?.[0]];
  if (stockBrakesPart?.brakes && spec.assists?.abs) {
    spec.assists.abs.referenceTorque = fullTorques(stockBrakesPart.brakes);
    for (const k of ['front', 'rear']) record(`assists.abs.referenceTorque.${k}`, { step: 'base', source: { kind: 'part', id: stockBrakesPart.id, name: stockBrakesPart.name }, to: spec.assists.abs.referenceTorque[k], note: 'the car\'s own brakes at full pedal: what its ABS is set for' });
  }
  const derived = ['mass', 'centreOfMass', 'inertiaTensor', 'wheels.radius', 'wheels.inertia', 'wheels.unsprung', 'wheels.offsets', 'assists.abs.referenceTorque'];
  for (const [path, value] of leaves(spec, '')) if (value !== null && !derived.some(d => path === d || path.startsWith(d + '.'))) record(path, { step: 'base', source: carSource, to: value });

  // 2. components
  // (torn off: its socket, or the wheel it was on)
  const tornOff = f => build.attach?.[f.socket.name] === 'detached' || (!!f.socket.node && build.attach?.[f.socket.node] === 'detached');
  const all = fittedParts(build, db), fitted = all.filter(f => f.part && !tornOff(f));
  const loose = f => build.attach?.[f.socket.name] === 'loose';
  const seen = {};
  for (const f of fitted) {
    const p = f.part;
    // body parts' share of the car's drag and lift
    for (const [k, path] of [['drag', 'aero.dragCoefficient'], ['liftFront', 'aero.front.liftCoefficient'], ['liftRear', 'aero.rear.liftCoefficient']])
      if (p.aeroEffect?.[k]) { const from = getPath(spec, path); setPath(spec, path, from + p.aeroEffect[k]); record(path, { step: 'add', source: partSource(f), from, to: from + p.aeroEffect[k] }); }
    if (p.kind !== 'component') continue;
    if (p.aero) {
      // (the physics finds its mount by the model's socket key, e.g. spoiler → socket_spoiler)
      const key = Object.keys(car.model.sockets).find(k => car.model.sockets[k] === f.socket.name);
      if (!key) { errors.push(`${p.name} needs the model's ${f.socket.name} node listed in model.sockets`); continue; }
      spec.aeroParts.push({ socket: f.socket.name, part: { ...clone(p), socket: key }, angle: p.aero.angle?.default });
      continue;
    }
    // (an upgrade of the car's own part — a big brake kit, coilovers —: its socket's stock part's blocks,
    //  changed by the upgrade's effects, so one part suits every car)
    let own = p;
    if (p.upgrade) {
      const stock = db.parts[f.socket.stock?.[0]];
      if (!stock) { errors.push(`${p.name} upgrades the car's own ${f.socket.slot.replace(/_/g, ' ')}, but ${car.name} has none in ${f.socket.name}`); continue; }
      own = Object.fromEntries([...SYSTEM_BLOCKS, ...OPTIONAL_BLOCKS].filter(b => stock[b]).map(b => [b, clone(stock[b])]));
      try { for (const e of p.upgrade.effects) applyEffect(own, e); } catch (e) { errors.push(`${p.name}: ${e.message}`); continue; }
    }
    for (const block of [...SYSTEM_BLOCKS, ...OPTIONAL_BLOCKS]) {
      if (!own[block]) continue;
      if (seen[block]) {
        // the same block again (tyres on each corner): has to be the same part
        if (seen[block].part.id !== p.id) errors.push(`${f.socket.name} has ${p.name} but ${seen[block].socket.name} has ${seen[block].part.name}: for now every corner needs the same ${block === 'tyre' ? 'tyres' : block}`);
        else seen[block].count++;
        continue;
      }
      seen[block] = { part: p, socket: f.socket, count: 1 };
      spec[block] = clone(own[block]);
    }
  }
  for (const [block, s] of Object.entries(seen)) {
    const source = { kind: 'part', id: s.part.id, name: s.part.name, socket: s.socket.name, count: s.count };
    for (const [path, value] of leaves(spec[block], block)) record(path, { step: 'component', source, to: value });
  }
  // (suspension with no anti-roll bars of its own: none, for bars to add to)
  if (spec.suspension && !spec.suspension.antiRoll) {
    spec.suspension.antiRoll = { front: 0, rear: 0 };
    for (const end of ['front', 'rear']) record(`suspension.antiRoll.${end}`, { step: 'component', source: { kind: 'part', id: seen.suspension.part.id, name: seen.suspension.part.name, socket: seen.suspension.socket.name }, to: 0, note: 'no anti-roll bar' });
  }
  for (const block of [...SYSTEM_BLOCKS, ...(LAYOUT_BLOCKS[spec.drivetrain.layout] ?? [])]) if (!spec[block]) errors.push(`nothing fitted provides the ${BLOCK_WORDS[block] ?? block}${LAYOUT_BLOCKS[spec.drivetrain.layout]?.includes(block) ? ` (${spec.drivetrain.layout} needs one)` : ''}`);
  // the drag and lift add up to a sensible precision (so the stock car's are exactly the car's own)
  for (const path of ['aero.dragCoefficient', 'aero.front.liftCoefficient', 'aero.rear.liftCoefficient']) setPath(spec, path, round9(getPath(spec, path)));
  // wider tyres grip more (by the tyre's own gripWidth)
  const tyrePart = seen.tyre?.part;
  if (tyrePart?.gripWidth && tyrePart.tyreSize) {
    const k = Math.pow(tyrePart.tyreSize.width / tyrePart.gripWidth.reference, tyrePart.gripWidth.exponent);
    if (k !== 1) for (const path of ['tyre.longitudinal.D', 'tyre.lateral.D']) {
      const from = getPath(spec, path), to = from * k;
      setPath(spec, path, to);
      record(path, { step: 'multiply', source: { ...partSource({ part: tyrePart, socket: seen.tyre.socket }), count: seen.tyre.count }, from, to, note: `${tyrePart.tyreSize.width} mm wide` });
    }
  }
  // the tyres' own smoke colour (a tyre smoke part sets another: a modifier, below)
  if (tyrePart?.smokeColour) { spec.cosmetic.smoke = tyrePart.smokeColour; record('cosmetic.smoke', { step: 'set', source: { ...partSource({ part: tyrePart, socket: seen.tyre.socket }), count: seen.tyre.count }, from: '', to: tyrePart.smokeColour, note: 'the tyres\' smoke' }); }
  if (errors.length) return { spec: null, totals: null, breakdown, errors, fingerprint: fingerprint(build, db.owned) };

  // 3. tuning: every fitted part's settings (a part on a group of sockets: its first one's)
  const tuned = [], firstInGroup = new Set(Object.values(car.socketGroups || {}).map(g => g.find(s => build.sockets?.[s])).filter(Boolean));
  const grouped = new Set(Object.values(car.socketGroups || {}).flat());
  let boostPeak = null;
  for (const f of fitted) {
    if (!f.part.tuning || (grouped.has(f.socket.name) && !firstInGroup.has(f.socket.name))) continue;
    for (const [name, def] of Object.entries(f.part.tuning)) {
      const raw = f.instance?.tuning?.[name] ?? def.default, value = Math.min(def.max, Math.max(def.min, raw));
      tuned.push({ socket: f.socket.name, part: f.part.id, setting: name, label: def.label, unit: def.unit ?? '', value, asked: raw, clamped: value !== raw, min: def.min, max: def.max, default: def.default });
      for (const a of def.apply) {
        const v = value * (a.scale ?? 1) + (a.offset ?? 0);
        if (a.op === 'angle') {
          const entry = spec.aeroParts.find(x => x.socket === f.socket.name);
          if (entry) { record(`aeroParts.${f.socket.name}.angle`, { step: 'tune', source: partSource(f), from: entry.angle, to: v, note: def.label }); entry.angle = v; }
        } else if (a.op === 'boostPeak') boostPeak = { value: v, source: partSource(f), label: def.label };
        else {
          try { for (const c of applyEffect(spec, { target: a.target, op: a.op, value: v })) record(c.path, { step: 'tune', source: partSource(f), from: c.from, to: c.to, note: def.label }); }
          catch (e) { errors.push(`${f.part.name}: its ${def.label} setting: ${e.message}`); }
        }
      }
    }
  }

  // 4. modifiers: adds, then multiplies and boosts, then sets (a boost target from a tuned part sets
  //    how high the boost curves go)
  const modifiers = fitted.filter(f => f.part.kind === 'modifier');
  let turbo = null;                 // (the turbo fitted: its boost as it runs, and its sound)
  for (const ops of PHASES)
    for (const f of modifiers)
      for (const effect of f.part.effects || []) {
        if (!ops.includes(effect.op)) continue;
        let e = effect;
        if (effect.op === 'boost' && boostPeak) {
          // (a turbo's curve raised or lowered to the target — but no higher than the turbo can make)
          const peak = Math.max(...effect.curve.map(p => p[1])), to = Math.min(boostPeak.value, effect.max ?? Infinity);
          if (peak > 0) e = { ...effect, curve: effect.curve.map(([rpm, bar]) => [rpm, bar * to / peak]) };
        }
        if (effect.op === 'boost' && f.part.slot === 'turbo') turbo = { f, value: { part: f.part.id, boost: clone(e.curve), efficiency: e.efficiency, ...(f.part.sound && { sound: clone(f.part.sound) }) } };
        try {
          for (const c of applyEffect(spec, e)) record(c.path, { step: effect.op, source: partSource(f), from: c.from, to: c.to, ...(e !== effect && { note: `boost to ${num3(Math.min(boostPeak.value, effect.max ?? Infinity))} bar (${boostPeak.source.name}${boostPeak.value > (effect.max ?? Infinity) ? `: asked for ${num3(boostPeak.value)}, this turbo's most` : ''})` }) });
        } catch (err) { errors.push(`${f.part.name}: ${err.message}`); }
      }

  // (a factory turbo, on the engine itself: the same)
  if (!turbo && spec.engine?.turbo) {
    const f = fitted.find(x => x.part.engine);
    turbo = { f, value: { part: f.part.id, boost: clone(spec.engine.turbo.boost), efficiency: spec.engine.turbo.efficiency, ...(spec.engine.turbo.sound && { sound: clone(spec.engine.turbo.sound) }) } };
  }
  // (the turbo, for what needs more than its torque: its whistle and blow-off, audio/mix.js)
  if (turbo) {
    spec.turbo = turbo.value;
    for (const [path, to] of leaves(spec.turbo, 'turbo')) record(path, { step: 'boost', source: partSource(turbo.f), to, note: path.startsWith('turbo.boost') ? 'the boost it makes (bar), as fitted' : 'its sound' });
  }
  // (what it sounds like: every fitted part's sound block — garage/carSound.js, spec.audio.from says whose; soundMod
  //  as it was, its level, tone and intake now from those blocks)
  spec.audio = soundOf(fitted, spec);
  spec.soundMod = { level: spec.soundMod.level * spec.audio.exhaust.level, tone: spec.soundMod.tone * spec.audio.exhaust.tone, intake: spec.soundMod.intake * spec.audio.intake.roar };
  for (const [path, to] of leaves(spec.audio, 'audio')) {
    const key = path.split('.').slice(1, 3).join('.'), by = [...spec.audio.from].reverse().find(x => x.keys.some(k => key === k || key.startsWith(`${k}.`) || k.startsWith(`${key}.`)));
    record(path, by ? { step: 'sound', source: { kind: 'part', id: by.part, name: by.name }, to, note: 'how it sounds' } : { step: 'base', source: carSource, to, note: 'how it sounds: as its engine sounds (no part changes it)' });
  }

  // 5. condition: worn parts do less (their category's curves); a category on several parts (the four
  //    tyres): their average condition — or, for a curve per part (per: 'part', body panels), each
  //    part's own, their factors multiplied or (op: 'add') their amounts added (slots: only those)
  const curves = db.condition?.categories ?? {};
  for (const [category, list] of Object.entries(curves)) {
    const parts = fitted.filter(f => f.part.category === category);
    if (!parts.length) continue;
    const condition = parts.reduce((a, f) => a + (f.instance?.condition ?? 100), 0) / parts.length;
    for (const c of list) {
      if (c.per === 'part') {
        const own = parts.filter(f => !c.slots || c.slots.includes(f.part.slot)), add = c.op === 'add';
        const worn = own.filter(f => (f.instance?.condition ?? 100) < 100);
        const k = worn.reduce((a, f) => add ? a + curveAt(c.curve, f.instance.condition) : a * curveAt(c.curve, f.instance.condition), add ? 0 : 1);
        if (!worn.length || k === (add ? 0 : 1)) continue;
        try {
          for (const ch of applyEffect(spec, { target: c.target, op: add ? 'add' : 'multiply', value: k })) record(ch.path, { step: 'condition', source: { ...partSource(worn[0]), count: worn.length }, from: ch.from, to: ch.to, note: `condition ${worn.map(f => `${f.part.name} ${num3(f.instance.condition)}`).join(', ')}` });
        } catch (e) { errors.push(`condition (${category}): ${e.message}`); }
        continue;
      }
      const k = curveAt(c.curve, condition);
      if (k === 1) continue;
      try {
        for (const ch of applyEffect(spec, { target: c.target, op: 'multiply', value: k })) record(ch.path, { step: 'condition', source: { ...partSource(parts[0]), count: parts.length }, from: ch.from, to: ch.to, note: `condition ${num3(condition)}` });
      } catch (e) { errors.push(`condition (${category}): ${e.message}`); }
    }
  }

  // (loose parts: the drag of a panel flapping about)
  for (const f of fitted) if (loose(f) && f.part.detach?.looseDrag) {
    const from = spec.aero.dragCoefficient;
    spec.aero.dragCoefficient = from + f.part.detach.looseDrag;
    record('aero.dragCoefficient', { step: 'loose', source: partSource(f), from, to: spec.aero.dragCoefficient, note: 'loose' });
  }

  // (the engine's condition, for the physics (physics/engineHealth.js): damage while driving wears it
  //  from here by the same curve, so it drives the same before and after it's written back; at 0 it's
  //  blown and won't run)
  if (spec.engine) {
    const parts = fitted.filter(f => f.part.category === 'engine'), own = parts.find(f => f.part.engine);
    const condition = own?.instance?.condition ?? 100, curve = curves.engine?.find(c => c.target === 'engine.torqueCurve')?.curve;
    const source = own ? partSource(own) : carSource, note = `condition ${num3(condition)}`;
    spec.engine.condition = condition;
    spec.engine.blown = condition <= 0;
    record('engine.condition', { step: 'condition', source, to: condition, note });
    record('engine.blown', { step: 'condition', source, to: spec.engine.blown, note: condition <= 0 ? 'blown: repair it in the garage' : note });
    if (curve && parts.length) {
      spec.engine.wear = { curve: clone(curve), average: parts.reduce((a, f) => a + (f.instance?.condition ?? 100), 0) / parts.length, share: 1 / parts.length };
      for (const [path, to] of leaves(spec.engine.wear, 'engine.wear')) record(path, { step: 'condition', source, to, note: 'how wear while driving scales the torque (data/condition.json)' });
    }
  }

  // (mechanical damage: every wheel's and system's, from the parts that carry it — the physics works
  //  it, physics/mechanical.js; a wheel torn off in a crash still sets the size the others roll on)
  if (db.damage?.mechanical) {
    const layout = mechanicalLayout({ car, build, db }), D = spec.damage = specDamage(layout, db.owned, db.damage.mechanical);
    const holder = id => { const f = all.find(x => x.instanceId === id); return f?.part ? partSource(f) : carSource; };
    const wheelSource = (k, what) => holder(what === 'bend' ? layout.carriers.rim[k] : ['pressure', 'leak'].includes(what) ? layout.carriers.tyre[k] : what === 'brake' ? layout.carriers.brakeLine : layout.carriers.suspension);
    const RULES = { kind: 'car', id: 'damage', name: 'the damage rules (data/damage.json)' };
    for (const [path, to] of leaves(D, 'damage')) {
      const [, a, b, c] = path.split('.');
      const source = a === 'rules' ? RULES : a === 'wheels' ? (c === 'off' ? carSource : wheelSource(b, c)) : holder(layout.carriers[{ coolant: 'radiator', radiatorLeak: 'radiator', boost: 'intake' }[a] ?? a]);
      record(path, { step: a === 'rules' ? 'base' : 'damage', source, to, ...(a === 'wheels' && c === 'off' && to && { note: 'torn off in a crash' }) });
    }
  }

  // 6. wheels: each corner's rim, tyre and spacer → its radius, turning inertia, unsprung mass, offset
  const corners = {};
  for (const [k, socketName] of Object.entries(car.model.sockets)) {
    if (!['FL', 'FR', 'RL', 'RR'].includes(k)) continue;
    const here = all.filter(f => f.part && (f.socket.node ?? f.socket.name) === socketName);
    const rim = here.find(f => f.part.rim), tyre = here.find(f => f.part.tyreSize), spacer = here.find(f => f.part.spacer);
    if (!rim || !tyre) { errors.push(`the ${k} corner has no ${!rim ? 'wheel' : 'tyre'} to roll on`); continue; }
    const fit = tyreFit(rim.part.rim, tyre.part.tyreSize);
    const radius = Math.round(rim.part.rim.diameter * 25.4 / 2 + tyre.part.tyreSize.width * tyre.part.tyreSize.sidewall / 100) / 1000;
    const inertia = (W.hubInertia ?? 0) + rim.part.mass * fit.rimRadius ** 2 * RIM_SHAPE + tyre.part.mass * (fit.rimRadius ** 2 + fit.radius ** 2) / 2 + (spacer ? spacer.part.mass * HUB_RADIUS ** 2 / 2 : 0);
    corners[k] = {
      radius, inertia: Math.round(inertia * 1e4) / 1e4, unsprung: rim.part.mass + tyre.part.mass + (spacer?.part.mass ?? 0),
      offset: ((W.referenceOffset ?? rim.part.rim.offset) - rim.part.rim.offset + (spacer?.part.spacer.thickness ?? 0)) / 1000,
      sources: [rim, tyre, spacer].filter(Boolean),
    };
  }
  const cs = Object.values(corners);
  if (cs.length === 4) {
    if (cs.some(c => c.radius !== cs[0].radius || c.inertia !== cs[0].inertia)) errors.push('for now every corner needs the same size of wheel and tyre');
    // (tyres too big for the arches: a lift kit makes room)
    // (a lift raises the body, but a bigger tyre also grows forward into the arch: 60% of the lift is room)
    const room = spec.wheels.maxTyreRadius != null ? spec.wheels.maxTyreRadius + 0.6 * (spec.wheels.lift ?? 0) : Infinity;
    if (cs[0].radius > room + 1e-9) errors.push(`the tyres (${Math.round(cs[0].radius * 2000)} mm across) don't fit ${car.name}'s arches: ${Math.round(room * 2000)} mm at most${spec.wheels.lift ? '' : ' — a lift kit makes room'}`);
    const src = cs[0].sources.map(f => partSource(f, 4)), note = 'the rim and tyre';
    spec.wheels.radius = cs[0].radius; spec.wheels.inertia = cs[0].inertia;
    // (what's left with the tyre flat: the rim, with the squashed rubber under it)
    spec.wheels.rimRadius = Math.round(corners.FL.sources[0].part.rim.diameter * 25.4 / 2) / 1000;
    record('wheels.rimRadius', { step: 'wheels', source: partSource(corners.FL.sources[0], 4), to: spec.wheels.rimRadius, note: 'the rim: what a flat tyre rides on' });
    for (const f of src) { record('wheels.radius', { step: 'wheels', source: f, to: cs[0].radius, note: `${note}: ${tyreFit(corners.FL.sources[0].part.rim, corners.FL.sources[1].part.tyreSize).label}` }); record('wheels.inertia', { step: 'wheels', source: f, to: cs[0].inertia, note: 'the hub, rim and tyre' }); }
    for (const [k, c] of Object.entries(corners)) {
      spec.wheels.unsprung[k] = c.unsprung; spec.wheels.offsets[k] = c.offset;
      record(`wheels.unsprung.${k}`, { step: 'wheels', source: partSource(c.sources[0]), to: c.unsprung, note: 'rim, tyre and spacer' });
      record(`wheels.offsets.${k}`, { step: 'wheels', source: partSource(c.sources[0]), to: c.offset, note: 'rim offset and spacer' });
    }
  }
  if (errors.length) return { spec: null, totals: null, breakdown, errors, fingerprint: fingerprint(build, db.owned) };

  // 7. mass, centre of mass and inertia tensor: the chassis plus every fitted part
  const bodies = [{ mass: car.chassis.mass, at: car.chassis.centreOfMass, own: tensorOf(car.chassis.inertia), source: carSource }];
  record('mass', { step: 'base', source: carSource, to: car.chassis.mass });
  let mass = car.chassis.mass;
  for (const f of fitted) {
    if (loose(f)) continue;                        // (its own body in the physics while it's loose)
    const shape = physicalShape(f.part, db.parts, car.id), mirrored = f.socket.mirrored ?? car.sockets.find(s => s.name === f.socket.node)?.mirrored;
    const off = shape.massOffset ? (mirrored ? [-shape.massOffset[0], shape.massOffset[1], -shape.massOffset[2]] : shape.massOffset) : [0, 0, 0];
    bodies.push({ mass: f.part.mass, at: [0, 1, 2].map(k => f.socket.position[k] + off[k]), own: shape.bounds ? boxTensor(f.part.mass, shape.bounds) : null, source: partSource(f) });
    mass += f.part.mass;
    record('mass', { step: 'add', source: partSource(f), from: mass - f.part.mass, to: mass });
  }
  spec.mass = round9(mass);
  spec.centreOfMass = [0, 1, 2].map(k => round9(bodies.reduce((a, b) => a + b.mass * b.at[k], 0) / mass));
  const I = [0, 0, 0, 0, 0, 0];
  for (const b of bodies) {
    const d = [0, 1, 2].map(k => b.at[k] - spec.centreOfMass[k]), dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    const par = [b.mass * (dd - d[0] ** 2), b.mass * (dd - d[1] ** 2), b.mass * (dd - d[2] ** 2), -b.mass * d[0] * d[1], -b.mass * d[0] * d[2], -b.mass * d[1] * d[2]];
    for (let k = 0; k < 6; k++) I[k] += (b.own?.[k] ?? 0) + par[k];
  }
  spec.inertiaTensor = I.map(round9);
  for (let k = 0; k < 3; k++) record(`centreOfMass.${k}`, { step: 'mass', source: carSource, to: spec.centreOfMass[k], note: 'the chassis and every part at its socket' });
  for (let k = 0; k < 6; k++) record(`inertiaTensor.${k}`, { step: 'mass', source: carSource, to: spec.inertiaTensor[k], note: 'the chassis and every part (a box its size) about the centre of mass' });

  const geometry = geometryOf(car, spec);
  const totals = totalsOf(spec, fitted, geometry, db.classes);
  totals.tuning = tuned;
  return { spec, totals, breakdown, errors, fingerprint: fingerprint(build, db.owned) };
}

const RIM_SHAPE = 0.6;      // a rim's turning inertia: 0.6 × its mass × its radius² (between a disc, ½, and a hoop, 1)
const HUB_RADIUS = 0.07;    // m: where a spacer's mass sits
const round9 = x => Math.round(x * 1e9) / 1e9 + 0;   // (+ 0: never −0)
const num3 = x => +x.toFixed(3);

// A part's physical shape (its bounds and mass offset: its own, else the part it's a variant of; a part
// made to fit each car: that car's bounds)
function physicalShape(part, parts, carId) {
  const own = carId && part.byCar?.[carId];
  if (own) return { bounds: own.bounds, massOffset: part.massOffset ?? null };
  let p = part;
  for (let i = 0; i < 8 && p; i++) { if (p.bounds || p.massOffset) return { bounds: p.bounds ?? null, massOffset: p.massOffset ?? null }; p = p.variantOf ? parts[p.variantOf] : null; }
  return { bounds: null, massOffset: null };
}
// Inertia tensors as [xx, yy, zz, xy, xz, yz]: the chassis's, and a solid box the size of some bounds
const tensorOf = i => [i.xx, i.yy, i.zz, i.xy, i.xz, i.yz];
function boxTensor(m, bounds) {
  const [x, y, z] = [0, 1, 2].map(k => bounds.max[k] - bounds.min[k]);
  return [m / 12 * (y * y + z * z), m / 12 * (x * x + z * z), m / 12 * (x * x + y * y), 0, 0, 0];
}

// Where the wheels are and how high the centre of mass sits on them, standing still: the wheelbase and
// track (with the wheels' offsets), and the centre of mass's height above the ground once the springs
// have settled under the car's weight (for the rating, and the totals)
export function geometryOf(car, spec) {
  const at = k => car.sockets.find(s => s.name === car.model.sockets[k])?.position;
  const [FL, FR, RL, RR] = ['FL', 'FR', 'RL', 'RR'].map(at);
  if (!FL || !RL) return null;
  const off = spec.wheels.offsets ?? {};
  const wheelbase = Math.abs(FL[2] - RL[2]), track = Math.abs(FL[0] - FR[0]) + (off.FL ?? 0) + (off.FR ?? 0);
  const S = spec.suspension, W = spec.wheels, g = 9.81, c = spec.centreOfMass;
  const frontShare = (c[2] - RL[2]) / wheelbase;
  const ground = (socket, axle, share) => {
    const du = ((W.unsprung?.[axle === 'front' ? 'FL' : 'RL'] ?? 0) - (W.unsprungBaseline ?? 0));
    const load = spec.mass * g * share / 2 - du * g;                  // what one spring holds
    const length = Math.max(S.restLength - S.travel, S.restLength - load / S.stiffness);
    return socket[1] + (W.mountHeight?.[axle] ?? 0) - length - W.radius;
  };
  const groundY = (ground(FL, 'front', frontShare) + ground(RL, 'rear', 1 - frontShare)) / 2;
  return { wheelbase, track, frontAxle: FL[2], comHeight: c[1] - groundY };
}

// Totals: mass, peak torque and power (flywheel, full throttle, sea level), an estimated top speed,
// the wheels' size, how high the centre of mass sits, and the performance rating (garage/rating.js,
// with data/classes.json)
export function totalsOf(spec, fitted = [], geometry = null, classes = null) {
  const E = spec.engine, curve = dyno(E, 25);
  const peakT = curve.reduce((a, p) => p.torque > a.torque ? p : a), peakP = curve.reduce((a, p) => p.kw > a.kw ? p : a);
  const topSpeed = estimateTopSpeed(spec);
  return {
    mass: spec.mass,
    massByPart: fitted.map(f => ({ socket: f.socket.name, part: f.part.id, mass: f.part.mass })),
    peakTorque: { nm: peakT.torque, rpm: peakT.rpm },
    peakPower: { kw: peakP.kw, hp: peakP.hp, rpm: peakP.rpm },
    topSpeed,
    wheel: wheelSize(fitted, spec),
    centreOfMassHeight: geometry?.comHeight ?? null,
    rating: geometry && classes ? performance(spec, geometry, classes, topSpeed.kmh) : null,
  };
}

// The first tyre on a rim (a tyre part in a socket drawn at a wheel socket): its size, the rim and
// tyre, and the radius the physics rolls on
export function wheelSize(fitted, spec) {
  for (const f of fitted) {
    if (!f.part?.tyreSize || !f.socket.node) continue;
    const rim = fitted.find(g => g.socket.name === f.socket.node && g.part?.rim);
    if (rim) return { ...tyreFit(rim.part.rim, f.part.tyreSize), radius: spec?.wheels.radius ?? tyreFit(rim.part.rim, f.part.tyreSize).radius, rim: rim.part.id, tyre: f.part.id };
  }
  return null;
}

// Top speed, estimated: the fastest speed at which some gear, at or under the redline, still gives
// more drive at the wheels (full throttle, sea-level air) than the drag and rolling resistance take
export function estimateTopSpeed(spec) {
  const E = spec.engine, GB = spec.gearbox, r = spec.wheels.radius, eff = spec.drivetrain.efficiency, A = spec.aero;
  let cd = A.dragCoefficient;
  for (const a of spec.aeroParts || []) cd += a.part.aero.dragCoefficient * angleScale(a.part.aero, a.angle);
  const rolling = spec.tyre.rollingResistance * spec.mass * 9.81;
  // (each gear, from the top of its rev range down: the first speed it still pulls at is its fastest;
  // the fastest of those, the lowest gear on a tie — on the same 0.05 m/s steps as ever)
  let best = { kmh: 0, gear: null, rpm: null };
  GB.ratios.forEach((ratio, i) => {
    const total = ratio * GB.finalDrive, rpmAt = k => SPEEDS[k] / r * total * 30 / Math.PI;
    for (let k = SPEEDS.length - 1; k >= 0; k--) {
      const v = SPEEDS[k], rpm = rpmAt(k);
      if (rpm > E.redlineRpm) continue;
      if (rpm < E.idleRpm) break;
      const resist = 0.5 * SEA_LEVEL_DENSITY * cd * A.frontalArea * v * v + rolling;
      if (engineTorque(E, rpm, 1) * total * eff / r >= resist) {
        if (v * 3.6 > best.kmh || (v * 3.6 === best.kmh && i + 1 < best.gear)) best = { kmh: v * 3.6, gear: i + 1, rpm };
        break;
      }
    }
  });
  return best;
}
const SPEEDS = (() => { const out = []; for (let v = 1; v < 150; v += 0.05) out.push(v); return out; })();
