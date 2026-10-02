// The crash test suite: the starter car driven into the test centre's wall at 30, 60, 100 and 150 km/h —
// front first, reversing in, sliding in side-on and on a front corner — and into another car at the same
// speeds (rear-ending it, T-boning it, head on), with the damage worked out by the game's own rules
// (garage/carDamage.js) for both cars. Each crash's outcome against the targets (tests/targets/crash.json):
// how bad the mechanical damage is, what came loose or off, whether the car can carry on, what fixing it
// costs. No rendering and no Node: the command line (npm run crash-test) and the balance report run it.
//
//   crashRuns(targets) → [{ id, kind: 'wall' | 'cars', kmh, direction | pair, carId, otherId }]
//   runCrash(ctx, run, targets) → { run, cars: [outcome, outcome?] } (ctx: crashContext's)
//   evaluateCrashes(results, targets) → [{ id, name, pass, problems: [plain words] }]
//
// An outcome: { strength (the hardest hit, m/s), hits, dents, broken, mechanical: 'none' | 'mild' |
// 'heavy', worst ([what made it heavy]), loose, detached (sockets), minCondition, heavy, drivable,
// reasons, repair: { quick, full } }

import { createSimulation } from '../physics/sim.js';
import { placeForCrash } from '../physics/crashTest.js';
import { CarDamage } from './carDamage.js';
import { carWork, drivability, systemOf } from './repair.js';

export const DIRECTIONS = { front: { side: 'front', angleDeg: 0 }, rear: { side: 'rear', angleDeg: 0 }, side: { side: 'side', angleDeg: 0 }, corner: { side: 'front', angleDeg: 30 } };
export const PAIRS = ['rear-end', 't-bone', 'head-on'];
const IDLE = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
const OPEN = [-300, -3000];             // (the test centre's long straight: room for two cars)

// Every crash the targets ask for
export function crashRuns(T) {
  const out = [], W = T.walls, C = T.cars;
  for (const kmh of Object.keys(W?.speeds ?? {}).map(Number)) for (const d of W.directions) out.push({ id: `wall-${kmh}-${d}`, kind: 'wall', kmh, direction: d, carId: T.car });
  for (const kmh of Object.keys(C?.speeds ?? {}).map(Number)) for (const p of C.pairs) out.push({ id: `cars-${kmh}-${p}`, kind: 'cars', kmh, pair: p, carId: T.car, otherId: C.other ?? T.car });
  if (C?.mass) out.push({ id: `mass-${C.mass.kmh}-${C.mass.pair}`, kind: 'cars', kmh: C.mass.kmh, pair: C.mass.pair, carId: T.car, otherId: C.mass.heavy, mass: true });
  return out;
}

// ctx: { RAPIER, settings, track (the test centre), db, garage(carId) → a Garage on that car stock,
// socketsOf(spec), boxesOf(car) }
export function runCrash(ctx, run, T) {
  const make = carId => { const g = ctx.garage(carId), spec = g.stats().spec, car = ctx.db.cars[carId]; return { g, spec, car, damage: new CarDamage({ car, build: g.build, view: g.view, boxes: ctx.boxesOf(car), rules: ctx.db.damage }) }; };
  const A = make(run.carId), sim = createSimulation(ctx.RAPIER, { settings: ctx.settings, spec: A.spec, sockets: ctx.socketsOf(A.spec), track: ctx.track });
  const cars = [A];
  if (run.kind === 'wall') placeForCrash(sim, run.kmh, T.walls.target ?? 'wall', DIRECTIONS[run.direction]);
  else {
    const B = make(run.otherId), v = run.kmh / 3.6, reach = c => { const b = c.car.dimensions.bodyCollider; return { front: b.centre[2] + b.halfExtents[2], rear: b.halfExtents[2] - b.centre[2], half: b.halfExtents[0] }; };
    const a = reach(A), b = reach(B), gap = 1.2, [x, z] = OPEN, front = z + a.front + gap;
    sim.resetCar({ position: [x, 0, z], headingDeg: 0, speed: run.pair === 'head-on' ? v / 2 : v });
    const at = run.pair === 'rear-end' ? { position: [x, 0, front + b.rear], headingDeg: 0, speed: 0 }
      : run.pair === 't-bone' ? { position: [x, 0, front + b.half], headingDeg: 90, speed: 0 }
        : { position: [x, 0, front + b.front], headingDeg: 180, speed: v / 2 };
    sim.addCar(at, () => IDLE, B.spec);
    cars.push(B);
  }
  const vehicles = [sim.vehicle, ...sim.cars.map(c => c.vehicle)], hits = cars.map(() => []);
  for (let i = 0; i < (T.seconds ?? 2.5) / sim.dt; i++) {
    sim.step(IDLE);
    vehicles.forEach((veh, k) => { for (const impact of veh.sensor.take()) { hits[k].push(impact.strength); cars[k].damage.hit(impact); } });
  }
  return { run, cars: cars.map((c, k) => outcome(ctx.db, c, hits[k], T)) };
}

// What a crash left a car with
export function outcome(db, { car, damage: cd }, hits, T) {
  const owned = cd.owned, rules = db.damage, mild = T.mild ?? {}, worst = [];
  let level = 'none';
  const note = (what, value, cap) => { if (level === 'none') level = 'mild'; if (cap == null || value > cap + 1e-9) { level = 'heavy'; worst.push(`${what} ${+value.toFixed(4)}`); } };
  for (const x of Object.values(owned)) {
    const part = db.parts[x.partId], b = x.damage ?? {};
    if (part?.engine && x.condition < 100) note('engine −', 100 - x.condition, mild.engine?.loss);
    if (!Object.keys(b).length) continue;
    const system = systemOf(part), caps = mild[system] ?? {};
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object') { for (const [j, u] of Object.entries(v)) note(`${system} ${k} ${j}`, Math.abs(u), caps[j]); continue; }
      if (k === 'pressure' || k === 'coolant') note(`${system} ${k}`, 1 - v, caps[k] != null ? 1 - caps[k] : null);
      else note(`${system} ${k}`, Math.abs(v), caps[k]);
    }
  }
  const states = Object.entries(cd.attach), loose = states.filter(([, s]) => s.state === 'loose').map(([k]) => k), detached = states.filter(([, s]) => s.state === 'detached').map(([k]) => k);
  const conditions = [cd.damage.shell?.condition ?? 100, ...Object.values(owned).map(x => x.condition)];
  const dents = (cd.damage.shell?.dents?.length ?? 0) + Object.values(owned).reduce((a, x) => a + (x.dents?.length ?? 0), 0);
  const bySocket = Object.fromEntries(Object.values(owned).map(x => [x.installedOn.socket, { ...x, engine: !!db.parts[x.partId]?.engine }]));
  const d = drivability(car, bySocket, rules);
  // (what fixing it costs: the car as a player's, with this damage)
  const profile = { cars: { c: { carInstanceId: 'c', carId: car.id, ...(cd.damage.shell && { damage: cd.damage.shell }) } }, parts: Object.fromEntries(Object.values(owned).map(x => [x.instanceId, { ...x, installedOn: { car: 'c', socket: x.installedOn.socket } }])) };
  const work = carWork(db, profile, 'c');
  return {
    strength: +Math.max(0, ...hits).toFixed(2), hits: hits.length, dents, broken: cd.damage.shell?.broken?.length ?? 0, mechanical: level, worst, loose, detached,
    minCondition: +Math.min(...conditions).toFixed(1), heavy: detached.length > 0 || level === 'heavy' || Math.min(...conditions) < 50, drivable: d.ok, reasons: d.reasons, repair: { quick: work.quick, full: work.full },
  };
}

const LEVELS = ['none', 'mild', 'heavy'];
// One outcome against one set of targets: [problems]
function check(o, t = {}) {
  const out = [];
  if (t.dents === true && !o.dents) out.push('no dents');
  if (t.mechanical && LEVELS.indexOf(o.mechanical) > LEVELS.indexOf(t.mechanical)) out.push(`${o.mechanical} mechanical damage (at most ${t.mechanical}: ${o.worst.slice(0, 3).join(', ')})`);
  if (t.loose === 'none' && (o.loose.length || o.detached.length)) out.push(`parts came loose: ${[...o.loose, ...o.detached].join(', ')}`);
  if (Array.isArray(t.loose)) for (const s of t.loose) if (!o.loose.includes(s)) out.push(`${s} isn't loose`);
  if (t.detached === 'none' && o.detached.length) out.push(`torn off: ${o.detached.join(', ')}`);
  if (Array.isArray(t.detached)) for (const s of t.detached) if (!o.detached.includes(s)) out.push(`${s} isn't torn off`);
  if (t.broken != null && o.broken > t.broken) out.push(`${o.broken} windows / lights broken (at most ${t.broken})`);
  if (t.minCondition != null && o.minCondition < t.minCondition) out.push(`a part down to ${o.minCondition}% (at least ${t.minCondition})`);
  if (t.heavy === true && !o.heavy) out.push('not heavy damage');
  if (t.drivable === true && !o.drivable) out.push(`can't carry on: ${o.reasons.join(' ')}`);
  if (t.drivable === false && o.drivable) out.push('still drivable');
  return out;
}
// Every result against the targets: a row per crash, and one per speed for what most crashes there
// should come to (drivable: { min | max } share of the crashes at that speed still drivable)
export function evaluateCrashes(results, T) {
  const rows = [];
  for (const r of results) {
    const { run } = r, problems = [];
    if (run.kind === 'wall') {
      const S = T.walls.speeds[run.kmh] ?? {};
      problems.push(...check(r.cars[0], { ...S.every, ...S[run.direction] }));
    } else if (run.mass) {
      const [light, heavy] = r.cars, M = T.cars.mass;
      if (!(light.strength > heavy.strength * (M.ratio ?? 1))) problems.push(`the lighter car felt ${light.strength} m/s, the heavier ${heavy.strength} (the lighter should feel more)`);
    } else {
      const S = T.cars.speeds[run.kmh] ?? {};
      r.cars.forEach((o, k) => problems.push(...check(o, { ...S.both, ...S[run.pair] }).map(p => `${k ? 'the car hit' : 'the car hitting'}: ${p}`)));
      const [a, b] = r.cars, fair = T.cars.fair;
      if (fair != null && run.carId === run.otherId && Math.abs(a.strength - b.strength) > fair * Math.max(a.strength, b.strength)) problems.push(`not fair: ${a.strength} m/s and ${b.strength} m/s for two cars the same`);
      if (!(a.hits && b.hits)) problems.push('both cars should be hit');
    }
    rows.push({ id: run.id, name: nameOf(run), pass: !problems.length, problems, cars: r.cars });
  }
  for (const [group, G] of [['wall', T.walls], ['cars', T.cars]]) for (const [kmh, S] of Object.entries(G?.speeds ?? {})) {
    if (!S.drivable) continue;
    const here = results.filter(r => r.run.kind === group && r.run.kmh === +kmh && !r.run.mass), outs = here.flatMap(r => r.cars), share = outs.filter(o => o.drivable).length / Math.max(1, outs.length);
    const problems = [];
    if (S.drivable.min != null && share < S.drivable.min) problems.push(`only ${Math.round(share * 100)}% still drivable (at least ${S.drivable.min * 100}%)`);
    if (S.drivable.max != null && share > S.drivable.max) problems.push(`${Math.round(share * 100)}% still drivable (at most ${S.drivable.max * 100}%: it should end the race)`);
    rows.push({ id: `${group}-${kmh}-drivable`, name: `${group === 'wall' ? 'into the wall' : 'into a car'} at ${kmh} km/h: still drivable`, pass: !problems.length, problems, share });
  }
  return rows;
}
export const nameOf = run => run.kind === 'wall' ? `${run.kmh} km/h into the wall, ${{ front: 'front first', rear: 'reversing', side: 'side-on', corner: 'on a front corner' }[run.direction]}`
  : run.mass ? `${run.kmh} km/h ${run.pair}, ${run.carId} and ${run.otherId}: the lighter feels more` : `${run.kmh} km/h ${run.pair} into another car`;

// What a crash costs to fix at each speed (the average of every crash there, both cars), against the
// race rewards (data/economy.json raceRewards): [{ kmh, kind, quick, full, ofWin }]
export function crashEconomy(results, db) {
  const out = [], win = db.economy.raceRewards?.win ?? null;
  for (const kind of ['wall', 'cars']) for (const kmh of [...new Set(results.filter(r => r.run.kind === kind && !r.run.mass).map(r => r.run.kmh))]) {
    const outs = results.filter(r => r.run.kind === kind && r.run.kmh === kmh && !r.run.mass).flatMap(r => r.cars), avg = k => Math.round(outs.reduce((a, o) => a + o.repair[k], 0) / outs.length);
    const quick = avg('quick'), full = avg('full');
    out.push({ kmh, kind, quick, full, ofWin: win ? +(full / win).toFixed(2) : null, drivable: outs.filter(o => o.drivable).length / outs.length });
  }
  return out;
}
