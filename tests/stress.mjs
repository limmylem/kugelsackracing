// The stress tests, headless (npm run stress; CI runs them): what a lot of crashing costs.
//
//  1. A pile-up: ten cars on the test centre's straight driving into each other at 60 km/h — the physics,
//     every car's own damage (garage/carDamage.js), their real meshes dented (garage/visual.js, three.js
//     in Node), the denting spread over frames (garage/dents.js DentBudget: at most budget.dentsMs a
//     frame) and the effects on medium quality (effects/director.js). Each 60 fps frame's work must stay
//     within budget.crashFrameMs (physics/settings.json: what's left of the frame is for drawing, which
//     Node can't measure), and the denting within its own budget (a single step — a mesh's own copy
//     made, or its denting — can't be split: the costliest is shown, and held to budget.dentMeshMs).
//  2. A hundred crashes and repairs, as the game makes them: each crash worked out on the car as it is,
//     saved through the player's save (garage/player/service.js), drawn; then repaired (mostly quick,
//     every tenth full) and the repair eased in on the drawing. After every full repair the car's own
//     copies of meshes and materials are all given back (none left over: a renderer would keep their GPU
//     buffers), the memory doesn't grow, and the last crashes and repairs are no slower than the first.
//
//   npm run stress                 both (node --expose-gc, so the memory can be measured)
//   npm run stress -- --pileup     only the pile-up (--cycles: only the crashes and repairs)
//   npm run stress -- --json f     also write the measurements as JSON

import fs from 'node:fs';
import * as THREE from 'three';
import { crashContext, harness, loadRealModel } from './harness.mjs';
import { createSimulation } from '../physics/sim.js';
import { placeForCrash } from '../physics/crashTest.js';
import { createSession } from '../physics/race.js';
import { straightLine } from '../physics/ai.js';
import { CarDamage, crashOutcome } from '../garage/carDamage.js';
import { DentBudget, finerOf } from '../garage/dents.js';
import { ModelCache, createCarVisual } from '../garage/visual.js';
import { EffectsDirector } from '../effects/director.js';
import { carEffectsInfo } from '../effects/carInfo.js';
import { LocalPlayerService } from '../garage/player/service.js';
import { MemoryStorage } from '../garage/player/storage.js';
import { Garage } from '../garage/data.js';
import { garageStateOf } from '../garage/player/profile.js';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = args.includes('--pileup') ? 'pileup' : args.includes('--cycles') ? 'cycles' : null;
const H = await harness(), ctx = await crashContext(), db = H.db, rules = db.damage, B = H.settings.budget;
const car = db.cars.starter_car, boxes = ctx.boxesOf(car), effectsCfg = JSON.parse(fs.readFileSync(new URL('../data/effects.json', import.meta.url), 'utf8'));
const IDLE = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
const ms = x => `${x.toFixed(2)} ms`, pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const results = {}, failures = [];
const expect = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
// (every car on the same models, as the game's ModelCache shares them)
const models = new ModelCache({ load: loadRealModel });
async function carVisual(g) {
  const vis = await createCarVisual({ car, finishes: db.finishes, models });
  await vis.applyBuild(g.build, g.view);
  return vis;
}
const meshesOf = o => { const out = []; o.traverse(x => { if (x.isMesh) out.push(x); }); return out; };

// ---------- 1. the pile-up ----------

async function pileup({ cars = 10, kmh = 60, seconds = 6, quality = 'medium' } = {}) {
  const g = H.garage(), spec = g.stats().spec, sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
  const play = createSession(db.sessions, 'test'), dents = new DentBudget(B.dentsMs);
  const fx = new EffectsDirector(effectsCfg, { level: quality, surfaces: H.track.surfaces }), info = carEffectsInfo({ garage: g, db, paint: null, spec }, boxes);
  // a ring 22 m round a point on the open straight, every car heading for the middle
  const centre = [-300, -3000], R = 22, v = kmh / 3.6, fleet = [];
  for (let i = 0; i < cars; i++) {
    const a = (i / cars) * Math.PI * 2, at = { position: [centre[0] + Math.sin(a) * R, 0, centre[1] + Math.cos(a) * R], headingDeg: (a * 180 / Math.PI + 180) % 360, speed: v };
    const id = i ? sim.addCar(at, straightLine({ speed: v })) : (sim.resetCar(at), 0);
    const vehicle = id ? sim.cars.find(c => c.id === id).vehicle : sim.vehicle;
    vehicle.mechanical.enabled = !id;
    const vis = await carVisual(g);
    vis.dentBudget = dents;
    fleet.push({ id, vehicle, vis, damage: new CarDamage({ car, build: g.build, view: g.view, boxes, rules, mode: id ? 'visual' : 'full' }) });
    fx.setCar(id, info);
  }
  // (the finer meshes for dents, once per model: the game works them out while it loads — warmDents)
  for (const m of meshesOf(fleet[0].vis.group)) finerOf(m.geometry);
  const frames = [], dt = 1 / 60;
  let hits = 0, dentedMeshes = 0, worstMesh = 0;
  const hitMs = [], lookMs = [];
  for (let f = 0; f < seconds * 60; f++) {
    const t0 = performance.now();
    const view = sim.advance(dt, IDLE);
    const t1 = performance.now();
    // every car's hits: its damage (both cars of a car-to-car hit, by the session's collisions), the
    // effects; then each car hit hands the drawing its dents, once a frame however many hits
    const looks = new Set();
    for (const c of fleet) for (const impact of c.vehicle.sensor.take()) {
      hits++;
      const scale = play.scale(impact), h0 = performance.now(), r = c.damage.hit(impact, { scale }).result;
      hitMs.push(performance.now() - h0);
      if (r.dents.length || r.broken.length) looks.add(c);
      fx.play(fx.impactEvent(c.id, impact, r, null));
    }
    for (const c of looks) { const h = performance.now(); c.vis.setDamage(c.damage.view3d, rules); lookMs.push(performance.now() - h); }
    const t2 = performance.now();
    // the denting: a step at a time (a mesh's copy, or its denting), till the frame's budget is used —
    // as flush() does, but each step timed for the record
    const before = dents.stats.meshes, d0 = performance.now();
    for (let steps = 0; dents.pending && !(steps && performance.now() - d0 >= B.dentsMs);) {
      const m0 = performance.now(), n = dents.flush(0);
      if (!n) break;
      steps += n;
      worstMesh = Math.max(worstMesh, performance.now() - m0);
    }
    dentedMeshes += dents.stats.meshes - before;
    const t3 = performance.now();
    // the effects: every car's state, the particles and marks moved on
    const b = view.current;
    for (const s of [b, ...(b.others ?? [])]) { const id = s.id ?? 0; fx.updateCar(id, s, dt); fx.sense(id, s); }
    fx.setViewer(b.position);
    fx.update(dt);
    const t4 = performance.now();
    frames.push({ total: t4 - t0, physics: t1 - t0, damage: t2 - t1, dents: t3 - t2, effects: t4 - t3, steps: view.stepsThisFrame });
  }
  const damaged = fleet.filter(c => c.damage.view3d.shell?.dents?.length || Object.keys(c.damage.view3d.parts).length).length;
  const sum = k => frames.reduce((a, x) => a + x[k], 0) / frames.length;
  const out = {
    cars, kmh, quality, frames: frames.length, hits, damaged, dentedMeshes, waiting: dents.pending,
    median: pct(frames.map(x => x.total), 0.5), p95: pct(frames.map(x => x.total), 0.95), worst: Math.max(...frames.map(x => x.total)), worstFrame: frames.reduce((a, x) => x.total > a.total ? x : a),
    average: { physics: sum('physics'), damage: sum('damage'), dents: sum('dents'), effects: sum('effects') },
    dentsWorst: Math.max(...frames.map(x => x.dents)), dentMeshWorst: worstMesh, hit: { median: pct(hitMs, 0.5), worst: Math.max(...hitMs) }, look: { median: pct(lookMs, 0.5), worst: Math.max(0, ...lookMs) }, particles: fx.particles?.count ?? null,
  };
  for (const c of fleet) c.vis.dispose();
  return out;
}

// ---------- 2. a hundred crashes and repairs ----------

// the impacts of a crash into the test centre's wall (the crash test suite's), as the physics reports them
const impactsCache = new Map();
function impactsOf(kmh, side, angleDeg = 0) {
  const key = `${kmh}|${side}|${angleDeg}`;
  if (!impactsCache.has(key)) {
    const spec = H.garage().stats().spec, sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track }), out = [];
    placeForCrash(sim, kmh, 'wall', { side, angleDeg });
    for (let i = 0; i < 2.5 / sim.dt; i++) { sim.step(IDLE); out.push(...sim.vehicle.sensor.take()); }
    impactsCache.set(key, out);
  }
  return impactsCache.get(key);
}
// a crash as the game sends it to the save (garage/session.js crash): worked out on the car as it is
async function crash(service, carId, impacts) {
  for (const impact of impacts) {
    const p = service.profile, gg = new Garage(db, { ...garageStateOf(p, db), current: carId }, p.cars[carId].carId), sockets = gg.build.sockets;
    const ids = Object.values(sockets).filter(Boolean);
    const attach = Object.fromEntries(Object.entries(sockets).filter(([, id]) => id && p.parts[id].attach).map(([s, id]) => [s, { state: p.parts[id].attach, stress: 0 }]));
    const out = crashOutcome({ car: gg.car, build: gg.build, view: gg.view, boxes, rules, attach, mech: Object.fromEntries(ids.map(id => [id, p.parts[id].damage ?? {}])),
      damage: { shell: p.cars[carId].damage ?? null, parts: Object.fromEntries(ids.map(id => [id, { condition: p.parts[id].condition, dents: p.parts[id].dents ?? [] }])) } }, impact);
    const parts = {}, hitsOf = t => out.result.dents.filter(d => d.target === t).map(({ target: _, ...d }) => d);
    for (const id of out.touched) parts[id] = { condition: out.next.parts[id].condition, hits: hitsOf(Object.keys(sockets).find(k => sockets[k] === id)) };
    for (const [id, b] of Object.entries(out.mech.damage)) parts[id] = { ...(parts[id] ?? {}), damage: b };
    for (const c of out.changes) parts[sockets[c.socket]] = { ...(parts[sockets[c.socket]] ?? {}), attach: c.to };
    const r = await service.damageCar(carId, { parts, shell: { condition: out.next.shell.condition, hits: hitsOf('shell'), broken: out.next.shell.broken } });
    if (!r.ok) throw new Error(r.error);
  }
}
// the car's damage as the drawing takes it (garage/workshop.js damage)
function drawn(service, carId) {
  const p = service.profile, gg = new Garage(db, { ...garageStateOf(p, db), current: carId }, p.cars[carId].carId), parts = {}, attach = {};
  for (const [socket, id] of Object.entries(gg.build.sockets)) {
    if (id && p.parts[id]?.dents?.length) parts[socket] = p.parts[id].dents;
    if (id && p.parts[id]?.attach) attach[socket] = p.parts[id].attach;
  }
  return { shell: p.cars[carId].damage ?? null, parts, attach };
}
// (every copy of a mesh or material made, and given back: what a renderer would hold on the GPU)
const live = { geometries: 0, materials: 0 };
for (const [proto, key] of [[THREE.BufferGeometry.prototype, 'geometries'], [THREE.Material.prototype, 'materials']]) {
  const clone = proto.clone;
  proto.clone = function () { const c = clone.call(this); live[key]++; c.addEventListener('dispose', () => live[key]--); return c; };
}
const heap = () => { globalThis.gc?.(); globalThis.gc?.(); return process.memoryUsage().heapUsed / 2 ** 20; };

async function cycles(n = 100) {
  const service = new LocalPlayerService({ db, storage: new MemoryStorage(null) });
  await service.init();
  service.unlimited = true;                    // (the repairs' money isn't what's measured here)
  const carId = service.profile.currentCar, g = new Garage(db, { ...garageStateOf(service.profile, db), current: carId }, service.profile.cars[carId].carId);
  const vis = await carVisual(g), dents = new DentBudget(B.dentsMs);
  vis.dentBudget = dents;
  const CRASHES = [[60, 'front'], [100, 'front', 30], [60, 'side'], [100, 'rear'], [150, 'front'], [30, 'side']];
  for (const c of CRASHES) impactsOf(...c);
  const draw = d => { vis.setDamage(d, rules); vis.showAttach(d.attach); while (dents.pending) dents.flush(); };
  // the car as new, drawn, its finer meshes worked out (once per model, shared: the game's warmDents) —
  // what every full repair must come back to
  draw(drawn(service, carId));
  for (const m of meshesOf(vis.group)) finerOf(m.geometry);
  const base = { ...live, heap: heap() }, rows = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await crash(service, carId, impactsOf(...CRASHES[i % CRASHES.length]));
    const hurt = drawn(service, carId);
    draw(hurt);
    const t1 = performance.now(), peak = { geometries: live.geometries, materials: live.materials };
    const kind = i % 10 === 9 ? 'full' : 'quick', r = await service.repairCar(carId, { kind });
    if (!r.ok) throw new Error(r.error);
    const fixed = drawn(service, carId), blend = vis.blendDamage(hurt, fixed, rules);
    for (let k = 1; k <= 8; k++) blend.set(k / 8);
    blend.done();
    vis.showAttach(fixed.attach);
    while (dents.pending) dents.flush();
    const t2 = performance.now(), D = service.profile.cars[carId].damage;
    const row = { i, kind, crashMs: t1 - t0, repairMs: t2 - t1, totalMs: t2 - t0, dented: meshesOf(vis.group).filter(m => m.userData.dent).length, own: vis.own.size, ...live, dentLog: (D?.dentLog?.base?.length ?? 0) + (D?.dentLog?.hits?.length ?? 0), peak };
    if (kind === 'full') Object.assign(row, { heap: heap() });
    rows.push(row);
  }
  const fulls = rows.filter(r => r.kind === 'full'), first = rows.slice(0, 20).map(r => r.totalMs), last = rows.slice(-20).map(r => r.totalMs);
  const out = {
    cycles: n, base, rows,
    afterFull: fulls.map(r => ({ i: r.i, geometries: r.geometries, materials: r.materials, own: r.own, dented: r.dented, heap: +r.heap.toFixed(1) })),
    firstMedian: pct(first, 0.5), lastMedian: pct(last, 0.5), heapGrowth: fulls.at(-1).heap - fulls[0].heap, maxGeometries: Math.max(...rows.map(r => r.peak.geometries)), maxMaterials: Math.max(...rows.map(r => r.peak.materials)),
  };
  vis.dispose();
  out.afterDispose = { ...live };
  return out;
}

// ---------- run ----------

console.log(`\nThe stress tests${globalThis.gc ? '' : ' (run with --expose-gc to measure the memory: npm run stress)'}\n`);
if (only !== 'cycles') {
  // (a short one first, not measured: the game has been running a while before a pile-up — its code
  // warmed up, the finer meshes worked out)
  await pileup({ seconds: 2 });
  const t = performance.now(), P = results.pileup = await pileup();
  console.log(`A ${P.cars}-car pile-up at ${P.kmh} km/h, ${P.quality} effects: ${P.hits} hits, ${P.damaged} cars damaged, ${P.dentedMeshes} meshes dented (${((performance.now() - t) / 1000).toFixed(1)} s)`);
  console.log(`  a frame: median ${ms(P.median)}, 95% within ${ms(P.p95)} — physics ${ms(P.average.physics)}, damage ${ms(P.average.damage)}, denting ${ms(P.average.dents)}, effects ${ms(P.average.effects)} on average`);
  const W = P.worstFrame;
  console.log(`  a hit: its damage ${ms(P.hit.median)} (worst ${ms(P.hit.worst)}), a car's dents handed to the drawing ${ms(P.look.median)} (worst ${ms(P.look.worst)})`);
  console.log(`  the worst frame ${ms(W.total)}: physics ${ms(W.physics)} (${W.steps} steps), damage ${ms(W.damage)}, denting ${ms(W.dents)}, effects ${ms(W.effects)}`);
  expect(P.damaged >= P.cars * 0.8, `most cars hit and damaged (${P.damaged} of ${P.cars})`);
  expect(P.p95 <= B.crashFrameMs, `95% of frames within ${B.crashFrameMs} ms (${ms(P.p95)}; drawing has the rest of the 16.7 ms)`);
  expect(P.dentsWorst <= B.dentsMs + P.dentMeshWorst + 0.5, `the denting a frame: at most ${B.dentsMs} ms, or one step (worst frame ${ms(P.dentsWorst)})`);
  expect(P.dentMeshWorst <= B.dentMeshMs, `the costliest step (a mesh copied, or dented) within ${B.dentMeshMs} ms (${ms(P.dentMeshWorst)})`);
  expect(P.waiting === 0, 'every dent drawn by the end');
  console.log('');
}
if (only !== 'pileup') {
  const t = performance.now(), C = results.cycles = await cycles(100);
  console.log(`${C.cycles} crashes and repairs (${((performance.now() - t) / 1000).toFixed(1)} s): a crash and its repair took ${ms(C.firstMedian)} at first, ${ms(C.lastMedian)} at the end (medians of 20)`);
  console.log(`  after each full repair, copies held beyond the car as new (meshes / materials)${globalThis.gc ? ' and the memory' : ''}: ${C.afterFull.map(r => `${r.geometries - C.base.geometries} / ${r.materials - C.base.materials}${globalThis.gc ? ` ${r.heap} MB` : ''}`).join(' · ')}`);
  console.log(`  crashed, at most ${C.maxGeometries - C.base.geometries} mesh and ${C.maxMaterials - C.base.materials} material copies more; the body's dent log never longer than ${Math.max(...C.rows.map(r => r.dentLog))} dents`);
  expect(C.afterFull.every(r => r.geometries === C.base.geometries && r.dented === 0), 'every full repair gives back every dented mesh copy');
  expect(C.afterFull.every(r => r.materials === C.base.materials), `every full repair gives back every material copy (${C.base.materials} the car keeps)`);
  expect(C.afterDispose.geometries <= C.base.geometries && C.afterDispose.materials === 0, `the car taken away gives back all its own copies (${C.afterDispose.geometries - C.base.geometries} mesh, ${C.afterDispose.materials} material copies left)`);
  if (globalThis.gc) expect(C.heapGrowth < 12, `no memory growth over ${C.cycles} cycles (${C.heapGrowth >= 0 ? '+' : ''}${C.heapGrowth.toFixed(1)} MB from the first full repair to the last)`);
  expect(C.lastMedian <= C.firstMedian * 1.5 + 2, `no slowdown (${ms(C.firstMedian)} → ${ms(C.lastMedian)})`);
  console.log('');
}
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ when: new Date().toISOString(), ...results, cycles: results.cycles && { ...results.cycles, rows: undefined } }, null, 2));
console.log(failures.length ? `${failures.length} out of budget: ${failures.join('; ')}\n` : 'All within budget\n');
process.exit(failures.length ? 1 : 0);
