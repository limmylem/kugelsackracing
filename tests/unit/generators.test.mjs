// Unit tests for the part generators (tools/generators, npm run generate-parts): every part they make —
// and every car's own version of it — builds under its type's triangle budget, passes the model checks
// with nothing to warn about and is closed (so it can be weighed); what's in the game is what they make
// now; and each generated part goes on every car it's for, through the garage, as the shop fits it.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkModel } from '../../tools/content/check.mjs';
import { inspect } from '../../tools/content/inspect.mjs';
import { readModel } from '../../tools/content/io.mjs';
import { loadProject } from '../../tools/content/project.mjs';
import { forCar, fitWithNeeds } from '../../tools/content/balance.mjs';
import { carsFor, loadCar } from '../../tools/generators/lib/car.js';
import { partShape } from '../../garage/partShape.js';
import { fitCheck, ENGINE_MOUNTED } from '../../tools/generators/lib/fitcheck.js';
import { damageLayout } from '../../garage/damage.js';
import { bodyDef } from '../../garage/detach.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), dir = path.join(root, 'tools/generators');
const project = await loadProject(), { db, rules } = project;
const generators = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const jobs = [];
for (const f of generators) for (const j of await (await import(path.join(dir, f))).parts({ project, loadCar, carsFor })) jobs.push({ ...j, generator: f });

test('there are generators for every kind of mechanical part, and they make the parts from the prompts document and the 20 extra rims', () => {
  assert.deepEqual(generators, ['aero.js', 'bay.js', 'brakes.js', 'engine.js', 'exhaust.js', 'interior.js', 'lights.js', 'offroad.js', 'rims.js']);
  const ids = new Set(jobs.map(j => j.id));
  for (const id of ['rim_multispoke', 'rim_rally', 'rim_beadlock', 'rim_deepdish', 'brakes_street', 'brakes_sport', 'brakes_race', 'turbo_kit', 'turbo_medium', 'turbo_large', 'supercharger_centrifugal', 'supercharger_twin_screw', 'front_mount_intercooler', 'intake_filter_street', 'cold_air_intake',
    'kaze_gt_gt_wing', 'kaze_gt_ducktail', 'kaze_gt_front_lip', 'vortex_r_front_splitter', 'kaze_gt_canards', 'strada_evo_mud_flaps', 'bucket_seat_street', 'bucket_seat_race', 'quick_release_wheel', 'gauge_pod', 'roll_cage_bolt_in', 'roll_cage_welded', 'strut_brace',
    'catback_street', 'fog_lights_round', 'ridgeback_4x4_light_bar', 'strada_evo_rally_lights', 'ridgeback_4x4_bull_bar', 'ridgeback_4x4_winch', 'ridgeback_4x4_snorkel', 'ridgeback_4x4_roof_rack', 'ridgeback_4x4_skid_plates', 'ridgeback_4x4_rock_sliders', 'ridgeback_4x4_lift_kit_2in', 'ridgeback_4x4_lift_kit_4in'])
    assert.ok(ids.has(id), id);
  const pack = jobs.filter(j => j.generator === 'rims.js' && j.defaults);
  assert.equal(pack.length, 20);
  assert.equal(new Set(pack.map(j => JSON.stringify([j.settings.spoke, j.settings.spokes, j.settings.diameter]))).size, 20, 'twenty different designs');
  for (const d of [15, 16, 17, 18, 19, 20]) assert.ok(pack.some(j => j.settings.diameter === d), `a ${d}" one`);
  // (nothing that has to follow a car's curves: those are modelled by hand)
  for (const j of jobs) assert.ok(!['bonnet', 'boot', 'bumper_front', 'bumper_rear', 'fender_left', 'fender_right', 'widebody', 'roof', 'engine_cover', 'skirt_left', 'skirt_right'].includes(project.rules.types[j.type].slot), j.id);
});

test('every generated model (and each car\'s own version) is under its budget, passes the checks without a warning, and is closed', async () => {
  // (each made by its generator for its base car, as npm run generate-parts makes it first; and every car's
  // version as the game loads it, from its file — the fit searches for every car are generate-parts' work)
  let n = 0;
  for (const j of jobs) {
    const t = rules.types[j.type], base = j.cars?.length ? (j.cars.includes(j.baseCar) ? j.baseCar : j.cars[0]) : null;
    const m = await j.build(base ? await loadCar(base) : null), info = inspect(await m.document());
    assert.ok(m.triangles <= t.triangles, `${j.id}: ${m.triangles} triangles (budget ${t.triangles})`);
    assert.ok(m.mass() > 0, `${j.id} weighs something`);
    const files = [[j.id, info], ...await Promise.all(Object.entries(db.parts[j.id].byCar ?? {}).map(async ([c, v]) => [`${j.id} on ${c}`, inspect(await readModel(path.join(root, v.model)))]))];
    for (const [label, i] of files) {
      assert.ok(i.triangles.length <= t.triangles, `${label}: ${i.triangles.length} triangles (budget ${t.triangles})`);
      const r = checkModel(i, { rules, type: j.type, file: label, estimateMass: true });
      assert.equal(r.verdict, 'pass', `${label}: ${r.findings.filter(f => f.level !== 'pass').map(f => f.text).join(' / ')}`);
      assert.ok(i.closed, `${label} is closed`);
      n++;
    }
  }
  assert.ok(n > 140, `${n} models`);
});

test('the game has what the generators make: each part\'s model, a version for every car it\'s made to fit, no placeholder left', () => {
  for (const j of jobs) {
    const p = db.parts[j.id];
    assert.ok(p, `${j.id} is a part`);
    assert.equal(p.madeBy?.generator, `tools/generators/${j.generator}`, j.id);
    assert.deepEqual(p.madeBy.settings ?? null, j.settings ? JSON.parse(JSON.stringify(j.settings)) : null, `${j.id}: made with its generator's settings now (npm run generate-parts)`);
    assert.ok(p.model && fs.existsSync(path.join(root, p.model)), `${j.id}: ${p.model}`);
    assert.ok(!p.modelTodo && !p.placeholder, `${j.id} isn't a placeholder any more`);
    assert.ok(fs.existsSync(path.join(root, p.icon)), `${j.id} has an icon`);
    const others = (j.cars ?? []).filter(c => c !== (j.cars.includes(j.baseCar) ? j.baseCar : j.cars[0]));
    for (const c of others) assert.ok(p.byCar?.[c] && fs.existsSync(path.join(root, p.byCar[c].model)), `${j.id}: its ${c} version`);
    // (a new part waits for its price: the shop doesn't sell it until then)
    if (j.defaults) assert.ok(p.todo?.includes('price') && p.tier && p.mass > 0, `${j.id}: tier ${p.tier}, ${p.mass} kg, price to do`);
  }
});

test('every generated part goes on every car it\'s for, through the garage (what it fits, needs and where)', () => {
  const generated = Object.values(db.parts).filter(p => p.madeBy);
  let fitted = 0;
  for (const p of generated) for (const carId of Object.keys(db.cars)) {
    if (!forCar(db, carId, p)) continue;
    const r = fitWithNeeds(db, carId, p.id);
    assert.ok(r.ok, `${p.id} on ${carId}: ${r.error}`);
    fitted++;
  }
  // (and the ones made for one car are for it)
  for (const id of ['kaze_gt_canards', 'vortex_r_front_splitter', 'strada_evo_mud_flaps', 'ridgeback_4x4_snorkel', 'apex_v8_aero_kit']) assert.ok(forCar(db, id.split('_').slice(0, 2).join('_'), db.parts[id]), id);
  assert.ok(fitted > 300, `${fitted} fits`);
});

test('every generated part fits every car it goes on: nothing through the body or another part', async () => {
  // (what bolts to the engine meets its block; and the starter car's rear arches are tight for a 17" rim —
  // its own hand-made 17" rims meet them just the same)
  const allowed = (p, carId, owner) => (ENGINE_MOUNTED.has(p.slot) && owner === db.parts[db.cars[carId].sockets.find(s => s.name === 'socket_engine')?.stock?.[0]]?.name)
    || (carId === 'starter_car' && p.rim?.diameter === 17 && owner === 'the body');
  const bad = [];
  for (const p of Object.values(db.parts).filter(p => p.madeBy)) for (const carId of Object.keys(db.cars)) {
    if (!forCar(db, carId, p)) continue;
    const r = await fitCheck(db, carId, p.id);
    for (const [owner, n] of Object.entries(r.clashes)) if (!allowed(p, carId, owner)) bad.push(`${p.id} on ${carId}: ${owner} (${n})`);
    if (r.error) bad.push(`${p.id} on ${carId}: ${r.error}`);
  }
  assert.deepEqual(bad, []);
});

test('a part made to fit each car is that car\'s on it: its model, and its size for crashes', () => {
  const cage = db.parts.roll_cage_welded, kaze = db.cars.kaze_gt;
  assert.equal(partShape(cage, db.parts, 'kaze_gt').model, cage.byCar.kaze_gt.model);
  assert.equal(partShape(cage, db.parts, 'starter_car').model, cage.model);
  assert.notDeepEqual(cage.byCar.ridgeback_4x4.bounds, cage.byCar.hana_roadster.bounds, 'a tall 4x4\'s cage isn\'t a roadster\'s');
  // (a loose part's body in the physics, and what a crash can hit: the car's own size of it)
  const sock = kaze.sockets.find(s => s.name === 'socket_cage'), def = bodyDef(cage, sock, db.parts, () => 0, 'kaze_gt');
  assert.deepEqual(def.half.map(v => +v.toFixed(6)), [0, 1, 2].map(k => +((cage.byCar.kaze_gt.bounds.max[k] - cage.byCar.kaze_gt.bounds.min[k]) / 2).toFixed(6)));
  const own = { min: [-0.5, 0, -0.2], max: [0.5, 0.1, 0.2] }, lip = { ...db.parts.kaze_gt_front_lip, id: 'lip_by_car', byCar: { kaze_gt: { model: db.parts.kaze_gt_front_lip.model, bounds: own } } };
  const L = damageLayout({ car: kaze, build: { sockets: { socket_front_lip: 'l' } }, db: { parts: { ...db.parts, lip_by_car: lip }, owned: { l: { partId: 'lip_by_car' } } } }, db.damage);
  const box = L.parts.find(x => x.socket === 'socket_front_lip').box, at = kaze.sockets.find(s => s.name === 'socket_front_lip').position;
  assert.deepEqual(box.max.map((v, k) => +(v - at[k]).toFixed(6)), own.max);
});
