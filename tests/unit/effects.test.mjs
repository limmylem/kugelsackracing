// Unit tests for the visual effects (effects/: particles.js, marks.js, director.js, carInfo.js, lighting.js,
// cesiumRenderer.js), without a browser: the pool and its budget, what each effect makes and when, the
// events another player's car would replay, the data they come from, and what they cost.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ParticleSystem, resolveEffects } from '../../effects/particles.js';
import { MarkLayer } from '../../effects/marks.js';
import { EffectsDirector } from '../../effects/director.js';
import { carEffectsInfo, contactMaterialOf } from '../../effects/carInfo.js';
import { lightAt } from '../../effects/lighting.js';
import { createCesiumEffects } from '../../effects/cesiumRenderer.js';
import { Garage, loadGarageData } from '../../garage/data.js';
import { LocalFrame } from '../../physics/geo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = async rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const cfg = await readJson('data/effects.json');
const { db } = await loadGarageData(readJson);
// (a fixed random sequence: the same run every time)
const seeded = (s = 7) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const SURFACES = (await readJson('scenes/test_centre.json')).surfaces;

// a car's snapshot as physics/vehicle.js gives it: driving along +z at speed, its wheels slipping
function snapshot({ speed = 15, slip = 0, surface = null, position = [0, 0.3, 0], mechanical = {}, health = { condition: 100, blown: false }, scrape = null, partScrape = null, debris = [] } = {}) {
  return {
    position, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: [0, 0, speed],
    wheels: ['FL', 'FR', 'RL', 'RR'].map((name, i) => ({ name, grounded: true, contact: [position[0] + (i % 2 ? -0.7 : 0.7), 0, position[2] + (i < 2 ? 1.3 : -1.3)], slipSpeed: slip, surface, omega: speed / 0.3, radius: 0.3, origin: [position[0] + (i % 2 ? -0.7 : 0.7), 0.3, position[2] + (i < 2 ? 1.3 : -1.3)] })),
    mechanical: { radiatorLeak: 0, coolant: 1, temp: 90, rimScrape: null, gearbox: 0, differential: 0, ...mechanical },
    engine: { health }, scrape, partScrape, debris,
  };
}
const director = (o = {}) => new EffectsDirector(cfg, { surfaces: SURFACES, random: seeded(), ...o });
const run = (d, seconds, make, id = 0) => { for (let t = 0; t < seconds * 60; t++) { const s = make(t / 60); d.updateCar(id, s, 1 / 60); d.sense(id, s); d.update(1 / 60); } };
const metal = { materialAt: () => 'metal', colourAt: () => '#c8202b', pieceMaterial: () => 'metal' };

test('the effects config: every effect a style the renderers draw, and the quality levels scale them', () => {
  for (const level of ['low', 'medium', 'high']) {
    const r = resolveEffects(cfg, level);
    for (const e of r.effects) assert.ok(['puff', 'spark', 'flame', 'shard', 'chip'].includes(e.style), e.name);
    if (level !== 'high') for (const e of r.effects) assert.ok(e.limitNow <= e.limit, `${level} ${e.name}`);
  }
  assert.ok(cfg.quality.low.count < cfg.quality.medium.count && cfg.quality.medium.count <= cfg.quality.high.count);
  assert.ok(cfg.quality.low.drawDistance < cfg.quality.high.drawDistance);
  assert.equal(cfg.quality.low.soft, false);
  assert.ok(cfg.quality.high.lights > 0 && cfg.quality.medium.lights === 0, 'spark lights on high only');
});

test('particles are pooled: slots come back, the budget holds (old ones make room), each effect stops at its limit', () => {
  const P = new ParticleSystem(cfg, 'low', { random: seeded() });
  const budget = P.budget, at = { position: [0, 1, 0], floor: 0 };
  // past an effect's limit: refused
  for (let i = 0; i < P.byName.sparks.limitNow + 50; i++) P.emit('sparks', at);
  assert.equal(P.byEffect().sparks, P.byName.sparks.limitNow);
  assert.ok(P.stats.refused >= 50);
  // past the budget: old particles make room, never more than the budget
  for (const name of ['tyreSmoke', 'dust', 'spray', 'debris', 'steam', 'glass']) for (let i = 0; i < 2000; i++) P.emit(name, at);
  assert.equal(P.count, budget);
  assert.ok(P.stats.stolen > 0);
  // they die, and their slots are free again
  for (let t = 0; t < 600; t++) P.update(1 / 60);
  assert.equal(P.count, 0);
  assert.equal(P.freeCount, P.capacity);
  // the arrays are made once (nothing new while playing)
  const arrays = P.pos;
  for (let i = 0; i < 500; i++) P.emit('dust', at);
  assert.equal(P.pos, arrays);
});

test('particles fall, bounce off the ground under where they were made, drift with the wind, and move with the origin', () => {
  const P = new ParticleSystem(cfg, 'high', { random: seeded() });
  const i = P.emit('glass', { position: [0, 2, 0], velocity: [0, 0, 0], floor: 0.5 });
  let lowest = Infinity;
  for (let t = 0; t < 120; t++) { P.update(1 / 60); lowest = Math.min(lowest, P.pos[i * 3 + 1]); }
  assert.ok(lowest >= 0.5 - 1e-6, 'never through the ground');
  assert.ok(P.pos[i * 3 + 1] < 0.6, 'lying on it');
  const s = P.emit('tyreSmoke', { position: [0, 1, 0], velocity: [0, 0, 0], floor: 0 });
  for (let t = 0; t < 60; t++) P.update(1 / 60, [5, 0, 0]);
  assert.ok(P.pos[s * 3] > 1, `smoke drifts with the wind (${P.pos[s * 3].toFixed(2)} m)`);
  const before = P.pos[s * 3 + 2];
  P.shift({ x: 0, y: 0, z: 0, w: 1 }, [0, 0, -100]);
  assert.ok(Math.abs(P.pos[s * 3 + 2] - (before - 100)) < 1e-3);
});

test('fewer effects far from the camera, none past the draw distance', () => {
  const P = new ParticleSystem(cfg, 'medium', { random: seeded() });
  P.setViewer([0, 0, 0]);
  const near = Array.from({ length: 200 }, () => P.amount(10, [5, 0, 0])).reduce((a, b) => a + b, 0) / 200;
  const mid = Array.from({ length: 200 }, () => P.amount(10, [(P.Q.fullDetail + P.Q.drawDistance) / 2, 0, 0])).reduce((a, b) => a + b, 0) / 200;
  assert.ok(Math.abs(near - 10 * P.Q.count) < 0.6, `near: ${near}`);
  assert.ok(mid < near * 0.7 && mid > 0, `half way: ${mid}`);
  assert.equal(P.amount(10, [P.Q.drawDistance + 1, 0, 0]), 0);
});

test('marks stay, fade slowly, and at most the limit stay — the oldest go first', () => {
  const M = new MarkLayer(100);
  const quad = x => [[x, 0, 0], [x + 1, 0, 0], [x + 1, 0, 1], [x, 0, 1]];
  for (let i = 0; i < 150; i++) M.add(quad(i), [0, 0, 0], 0.6, 0.6, 60);
  assert.equal(M.count, 100);
  assert.equal(M.pos[0], 100, 'the 101st took the oldest one\'s place');
  assert.equal(M.strength(5), 1);
  M.update(45);
  assert.ok(M.strength(5) > 0 && M.strength(5) < 1, 'fading in the last third');
  M.update(20);
  assert.equal(M.strength(5), 0);
  M.setLimit(40);
  assert.equal(M.limit, 40);
  assert.equal(M.count, 0);
});

test('sparks: metal scraping something hard throws a stream of them (more the harder), plastic and wood don\'t', () => {
  const scrape = (part, material, amount) => {
    const d = director();
    d.setCar(0, { ...metal, materialAt: () => part });
    run(d, 0.5, () => snapshot({ scrape: { point: [0.9, 0.4, 1], normal: [1, 0, 0], amount, speed: 18, force: 6000, material } }));
    return d.particles.byEffect().sparks;
  };
  const hard = scrape('metal', 'concrete', 1), soft = scrape('metal', 'concrete', 0.2);
  assert.ok(hard > 60, `${hard} sparks`);
  assert.ok(soft < hard * 0.6, `a lighter scrape, fewer (${soft})`);
  assert.equal(scrape('plastic', 'concrete', 1), 0, 'a plastic part: none');
  assert.equal(scrape('metal', 'wood', 1), 0, 'on wood: none');
  // the rim of a flat tyre, a loose part dragging, the floor pan bottoming out, a torn-off metal part sliding
  const d = director();
  d.setCar(0, metal);
  const sources = { mechanical: { rimScrape: { wheel: 'FL', amount: 0.8, speed: 12, material: 'metal' } }, partScrape: { socket: 'socket_bumper_front', position: [0, 0, 2], amount: 0.6, speed: 10, material: 'concrete' }, debris: [{ id: 3, key: 'socket_exhaust', owner: 0, position: [0, 0, -4], sliding: 9, contact: [0, 0, -4] }] };
  const events = d.sense(0, snapshot(sources));
  assert.deepEqual(events.map(e => e.key).sort(), ['drag', 'piece_3', 'rim_FL']);
  assert.ok(events.every(e => e.type === 'scrapeStart'));
  assert.deepEqual(d.sense(0, snapshot()).map(e => e.type), ['scrapeStop', 'scrapeStop', 'scrapeStop']);
});

test('sparks glow brighter at night, and on high quality light up a little flickering light', () => {
  const night = lightAt(23), day = lightAt(13);
  assert.ok(night.night > 0.9 && day.night < 0.05);
  assert.ok(day.key.intensity > night.key.intensity * 3);
  const d = director({ level: 'high' });
  d.setCar(0, metal);
  run(d, 0.2, () => snapshot({ scrape: { point: [0.9, 0.4, 1], normal: [1, 0, 0], amount: 1, speed: 18, force: 9000, material: 'metal' } }));
  assert.ok(d.lights.length >= 1 && d.lights.length <= cfg.quality.high.lights);
  const m = director({ level: 'medium' });
  m.setCar(0, metal);
  run(m, 0.2, () => snapshot({ scrape: { point: [0.9, 0.4, 1], normal: [1, 0, 0], amount: 1, speed: 18, force: 9000, material: 'metal' } }));
  assert.equal(m.lights.length, 0);
});

test('tyres: smoke from slipping on grippy ground (thicker with more slip, the tyre\'s colour), skid marks; dust and spray on loose ground, none on ice', () => {
  const smoke = (slip, surface = 'tarmac', info = {}) => { const d = director(); d.setCar(0, info); run(d, 1, t => snapshot({ slip, surface, position: [0, 0.3, 15 * t] })); return d; };
  assert.equal(smoke(2).particles.byEffect().tyreSmoke, 0, 'a little slip: none');
  const drift = smoke(9), burnout = smoke(16);
  assert.ok(drift.particles.byEffect().tyreSmoke > 20);
  assert.ok(burnout.particles.byEffect().tyreSmoke > drift.particles.byEffect().tyreSmoke);
  assert.ok(drift.marks.count > 20, `${drift.marks.count} pieces of skid mark`);
  const black = smoke(12, 'tarmac', { smoke: '#1b1b1b' }), P = black.particles, i = P.list[0];
  assert.ok(P.col0[i * 3] < 0.15, 'in the tyre smoke colour');
  const dirt = smoke(9, 'dirt').particles.byEffect();
  assert.equal(dirt.tyreSmoke, 0);
  assert.ok(dirt.spray > 10 && dirt.dust > 10, 'dirt: spray and dust');
  assert.ok(smoke(9, 'grass').particles.byEffect().clippings > 5, 'grass: clippings');
  assert.equal(smoke(12, 'ice').particles.byEffect().tyreSmoke, 0);
  // a dust trail behind the car on a dry dirt road, just driving
  assert.ok(smoke(0, 'dirt').particles.byEffect().dust > 10);
});

test('the engine bay: steam (a leaking radiator, stronger stopped; a hot engine), grey smoke as the engine wears, a blown engine\'s burst, flame and trail', () => {
  const bay = (o, seconds = 1) => { const d = director(); d.setCar(0, { cooling: { warn: 108, limp: 116 } }); run(d, seconds, () => snapshot(o)); return d; };
  assert.equal(bay({}).particles.byEffect().steam, 0, 'a healthy car: none');
  const leakStill = bay({ speed: 0, mechanical: { radiatorLeak: 0.01, coolant: 0.6 } }), leakMoving = bay({ speed: 30, mechanical: { radiatorLeak: 0.01, coolant: 0.6 } });
  assert.ok(leakStill.particles.byEffect().steam > leakMoving.particles.byEffect().steam, 'stronger standing still');
  assert.ok(leakStill.cars.get(0).steam > 0.4, 'the steam (for its hiss)');
  assert.ok(bay({ speed: 0, mechanical: { temp: 118 } }).particles.byEffect().steam > 10, 'overheating');
  assert.equal(bay({ speed: 0, mechanical: { radiatorLeak: 0.01, coolant: 0 } }).particles.byEffect().steam, 0, 'no coolant left: no steam');
  const worn = c => bay({ health: { condition: c, blown: false } }).particles.byEffect().engineSmoke;
  assert.equal(worn(90), 0);
  assert.ok(worn(10) > worn(40) && worn(40) > 0, 'more as the condition drops');
  // blown: the event (and the state: a remote car), not both twice
  const d = director();
  d.setCar(0, {});
  run(d, 0.1, () => snapshot());
  d.play({ type: 'engineBlow', car: 0 });
  run(d, 0.3, () => snapshot({ health: { condition: 0, blown: true } }));
  const b = d.particles.byEffect();
  assert.ok(b.blowSmoke > 60 && b.blowSmoke < cfg.effects.blowSmoke.burst * 1.6, `one burst (${b.blowSmoke})`);
  assert.ok(b.flame > 5, 'a flash of flame');
  run(d, 3, () => snapshot({ health: { condition: 0, blown: true } }));
  assert.equal(d.particles.byEffect().flame, 0, 'no lasting fire');
  assert.ok(d.particles.byEffect().blowSmoke > 10, 'a lingering trail');
});

test('crashes: chips the colour of what was hit, sparks off metal, glass shards, dust on loose ground', () => {
  const d = director();
  d.setCar(0, metal);
  run(d, 0.05, () => snapshot());
  d.play(d.impactEvent(0, { point: [0, 0.5, 2], normal: [0, 0, 1], strength: 14, material: 'concrete' }, null, 'dirt'));
  const e = d.particles.byEffect();
  assert.ok(e.debris > 20 && e.sparks > 20 && e.crashDust > 20, JSON.stringify(e));
  const P = d.particles, chips = [...P.list.slice(0, P.count)].filter(i => P.effect[i] === P.byName.debris.id);
  assert.ok(chips.filter(i => Math.abs(P.col0[i * 3] - 0xc8 / 255) < 0.01).length > chips.length * 0.5, 'mostly its paint');
  // a tap makes nothing; a hit on tarmac no dust
  const t = director(); t.setCar(0, metal); run(t, 0.05, () => snapshot());
  t.play(t.impactEvent(0, { point: [0, 0.5, 2], normal: [0, 0, 1], strength: 2, material: 'concrete' }, null, 'tarmac'));
  assert.equal(t.particles.byEffect().debris, 0);
  assert.equal(t.particles.byEffect().crashDust, 0);
  // glass and lights breaking: only what's newly broken
  const events = d.breakEvents(0, ['glass_windscreen', 'light_head_left', 'light_tail_left'], new Set(['light_tail_left']), { glass_windscreen: { min: [-0.6, 0.9, 0.4], max: [0.6, 1.2, 0.9] } });
  assert.deepEqual(events.map(x => x.kind), ['glass', 'light']);
  for (const x of events) d.play(x);
  assert.ok(d.particles.byEffect().glass >= (cfg.effects.glass.window + cfg.effects.glass.light) * 0.6);
});

test('leaks: coolant and oil drip onto the road behind a leaking car, as small fading marks', () => {
  const drips = o => { const d = director(); d.setCar(0, {}); run(d, 4, () => snapshot(o)); return d.marks; };
  assert.equal(drips({}).count, 0);
  const coolant = drips({ mechanical: { radiatorLeak: 0.01, coolant: 0.5 } }), oil = drips({ health: { condition: 20, blown: false } });
  assert.ok(coolant.count > 10 && oil.count > 10);
  assert.ok(coolant.round[0] === 1, 'drops, not strips');
  assert.ok(coolant.fade[0] < oil.fade[0], 'coolant dries sooner than oil');
});

test('events, for other players\' cars: what starts here is sent, and replaying it elsewhere plays the same effects', () => {
  const here = director(), there = director({ random: seeded(99) }), sent = [];
  for (const d of [here, there]) d.setCar(0, metal);
  here.onEvent(e => sent.push(e));
  there.onEvent(() => assert.fail('a replayed event isn\'t sent on again'));
  const scrape = { point: [0.9, 0.4, 1], normal: [1, 0, 0], amount: 1, speed: 18, force: 9000, material: 'concrete' };
  for (let t = 0; t < 30; t++) {
    const s = snapshot({ scrape: t < 20 ? scrape : null });
    here.updateCar(0, s, 1 / 60); there.updateCar(0, s, 1 / 60);       // (the remote car's snapshot: its pose and state)
    here.sense(0, s);
    for (const e of sent.splice(0)) there.play({ ...e, remote: true });
    here.update(1 / 60); there.update(1 / 60);
    assert.equal(there.scrapes.size, here.scrapes.size);
  }
  here.play({ type: 'engineBlow', car: 0 });
  for (const e of sent.splice(0)) there.play({ ...e, remote: true });
  assert.ok(there.particles.byEffect().blowSmoke > 0);
});

test('a car\'s effects info from the garage: what its parts are made of, their colours, its tyres\' smoke (a smoke part overrides it)', () => {
  const g = new Garage(db, null, 'starter_car'), session = { garage: g, db, paint: { colour: '#c8202b' }, spec: g.stats().spec };
  const info = carEffectsInfo(session, {});
  assert.equal(info.materialAt(null, 'socket_door_left'), 'metal');
  assert.equal(info.materialAt(null, 'socket_mirror_left'), 'plastic');
  assert.equal(info.materialAt(null, 'socket_bumper_front'), 'metal', 'a loose bumper dragging throws sparks');
  assert.equal(info.pieceMaterial('socket_wheel_FL'), 'rubber', 'a wheel torn off rolls on its tyre');
  assert.equal(info.colourAt(null, 'socket_door_left'), '#c8202b', 'painted');
  assert.equal(info.smoke, '#d8d8d8', 'the tyres\' own smoke');
  assert.ok(info.anchors.engine[2] > 0.5, 'a front engine\'s bay');
  assert.ok(g.install('tyre_smoke_black').ok);
  assert.equal(carEffectsInfo({ ...session, spec: g.stats().spec }, {}).smoke, '#1b1b1b');
  assert.equal(contactMaterialOf({ category: 'exhaust' }), 'metal');
  // every part on the outside of a car says what it's made of
  const untagged = Object.values(db.parts).filter(p => db.damage.exterior.includes(p.category) && !p.contactMaterial).map(p => p.id);
  assert.deepEqual(untagged, []);
});

test('the real world\'s renderer (Cesium): a billboard for each live particle, lit, marks in one primitive', () => {
  // (a stand-in for the few Cesium classes it uses)
  const made = { billboards: 0, primitives: 0 };
  class V { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } }
  const C = {
    Cartesian3: Object.assign(V, { subtract: (a, b) => new V(a.x - b.x, a.y - b.y, a.z - b.z), normalize: a => { const l = Math.hypot(a.x, a.y, a.z) || 1; return new V(a.x / l, a.y / l, a.z / l); } }),
    Color: class { constructor(r = 1, g = 1, b = 1, a = 1) { Object.assign(this, { red: r, green: g, blue: b, alpha: a }); } },
    BillboardCollection: class { constructor() { this.list = []; } add(o) { made.billboards++; const b = { ...o }; this.list.push(b); return b; } },
    BlendOption: { TRANSLUCENT: 1 }, JulianDate: { now: () => 0 },
    Simon1994PlanetaryPositions: { computeSunPositionInEarthInertialFrame: () => new V(1.5e11, 0, 0) },
    Transforms: { computeIcrfToFixedMatrix: () => [1, 0, 0, 0, 1, 0, 0, 0, 1], computeTemeToPseudoFixedMatrix: () => [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    Matrix3: { multiplyByVector: (m, v) => v },
    Geometry: class { constructor(o) { Object.assign(this, o); } }, GeometryAttribute: class { constructor(o) { Object.assign(this, o); } }, GeometryInstance: class { constructor(o) { Object.assign(this, o); } },
    ComponentDatatype: { DOUBLE: 1 }, PrimitiveType: { TRIANGLES: 4 }, BoundingSphere: { fromVertices: () => ({}) },
    ColorGeometryInstanceAttribute: { fromColor: c => c }, PerInstanceColorAppearance: class {}, Primitive: class { constructor(o) { made.primitives++; this.instances = o.geometryInstances; } },
  };
  const added = [];
  const scene = { primitives: { add: p => { added.push(p); return p; }, remove: p => added.splice(added.indexOf(p), 1) } };
  globalThis.document ??= { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {} }), toDataURL: () => 'data:,' }) };
  const d = director(), frame = new LocalFrame(0.9, 0.2, 10);
  const draw = createCesiumEffects(C, d, { scene, frame: () => frame, rebuild: 0 });
  d.setCar(0, metal);
  run(d, 0.5, t => snapshot({ slip: 10, surface: 'tarmac', position: [0, 0.3, 15 * t], scrape: { point: [0.9, 0.4, 1], normal: [1, 0, 0], amount: 1, speed: 18, force: 9000, material: 'concrete' } }));
  draw.update(1 / 60);
  assert.equal(draw.stats.drawn, d.particles.count);
  assert.ok(made.billboards >= d.particles.count);
  assert.ok(made.primitives === 1 && draw.stats.marks > 0, 'the skid marks');
  const spark = added.find(p => p.list?.some(b => b.alignedAxis));
  assert.ok(spark, 'sparks turned along their motion');
  // fewer later: the rest hidden, not removed
  d.clear(); d.update(1 / 60); draw.update(1 / 60);
  assert.ok(added.filter(p => p.list).every(p => p.list.every(b => !b.show)));
});

test('a big multi-car crash: ten cars at once stay within the budget and cheap to move', () => {
  const d = director({ level: 'medium' });
  for (let id = 0; id < 10; id++) d.setCar(id, metal);
  const t0 = performance.now();
  let frames = 0;
  for (let t = 0; t < 180; t++) {
    for (let id = 0; id < 10; id++) {
      const s = snapshot({ position: [id * 3, 0.3, 0], slip: 12, surface: id % 2 ? 'dirt' : 'tarmac', mechanical: { radiatorLeak: 0.01, coolant: 0.5 }, scrape: { point: [0.9, 0.4, 1], normal: [1, 0, 0], amount: 1, speed: 18, force: 9000, material: 'concrete' } });
      d.updateCar(id, s, 1 / 60); d.sense(id, s);
      if (t === 30) { d.play(d.impactEvent(id, { point: [0, 0.5, 2], normal: [0, 0, 1], strength: 20, material: 'car' }, null, 'dirt')); d.play({ type: 'break', car: id, kind: 'glass', point: [0, 1, 0.8] }); }
    }
    d.update(1 / 60);
    frames++;
    assert.ok(d.particles.count <= d.particles.budget);
  }
  const ms = (performance.now() - t0) / frames;
  assert.ok(d.particles.stats.stolen > 0, 'the budget was reached (old particles made room)');
  assert.ok(ms < 8, `${ms.toFixed(2)} ms a frame for ten cars' effects`);
});
