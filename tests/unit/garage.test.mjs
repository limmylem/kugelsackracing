// Unit tests for the parts data system: schemas, the stats calculator and the build validator.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Garage, loadGarageData } from '../../garage/data.js';
import { computeStats, getPath } from '../../garage/stats.js';
import { checkInstall, checkRemove, validateBuild } from '../../garage/validate.js';
import { createValidator } from '../../garage/jsonSchema.js';
import { changes, explain } from '../../garage/report.js';
import { massFrame } from '../../physics/vehicle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = async rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const { db, problems, validator } = await loadGarageData(readJson);
const phase1 = await readJson('tests/fixtures/phase1_starter_car.json');
const fresh = () => new Garage(db);
const leaves = (v, p = '', out = {}) => { if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${p}.${i}`, out)); else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) if (!k.startsWith('_') && x !== undefined) leaves(x, p ? `${p}.${k}` : k, out); } else out[p] = v; return out; };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} should be ${b}`);
// a copy of the data with extra (made-up) parts, for testing rules
const withParts = (...parts) => ({ ...db, parts: { ...db.parts, ...Object.fromEntries(parts.map(p => [p.id, p])) } });
const part = (id, slot, extra) => ({ id, name: id, category: slot, slot, kind: 'modifier', price: 0, mass: 0, model: '', icon: '', fits: [], requires: [], conflicts: [], provides: [], effects: [], ...extra });

// ---------- schemas ----------

test('every data file matches its schema', () => assert.deepEqual(problems, []));

test('schema errors are specific: a typo, a missing field, a wrong type, a block on a modifier', async () => {
  const bad = { ...(await readJson('data/parts/intake/cold_air_intake.json')), masss: 2, price: 'cheap', engine: {} };
  delete bad.mass;
  const msgs = validator.validate('part.schema.json', bad).map(e => `${e.path} ${e.message}`);
  assert.ok(msgs.some(m => m.includes('masss') && m.includes('did you mean "mass"')), msgs.join('\n'));
  assert.ok(msgs.some(m => m.includes('missing "mass"')));
  assert.ok(msgs.some(m => m.startsWith('price should be number')));
  assert.ok(msgs.some(m => m.includes('is a modifier, so it has effects, not a system block')));
});

test('schema validator: $ref across files, if/then, anyOf, enum, limits', () => {
  const v = createValidator({
    'a.json': { $id: 'a.json', type: 'object', properties: { b: { $ref: 'b.json#/$defs/n' }, k: { enum: ['x', 'y'] }, t: { anyOf: [{ type: 'string' }, { type: 'array' }] } }, if: { properties: { k: { const: 'x' } } }, then: { required: ['b'] } },
    'b.json': { $id: 'b.json', $defs: { n: { type: 'number', minimum: 0 } } },
  });
  assert.deepEqual(v.validate('a.json', { b: 1, k: 'y', t: [] }), []);
  assert.equal(v.validate('a.json', { b: -1 })[0].message, 'should be at least 0');
  assert.equal(v.validate('a.json', { k: 'x' })[0].message, 'is missing "b"');
  assert.equal(v.validate('a.json', { k: 'z' }).length, 1);
  // (an `if` that only lists properties passes when they're absent, so `then` applies too)
  assert.deepEqual(v.validate('a.json', { t: 3 }).map(e => e.message), ['should be string, not integer', 'is missing "b"']);
});

test('a garage state, a build and an owned part match their schemas', () => {
  const g = fresh();
  g.install('cold_air_intake');
  assert.deepEqual(validator.validate('garage.schema.json', g.state), []);
  assert.deepEqual(validator.validate('build.schema.json', g.build), []);
  assert.deepEqual(validator.validate('owned-part.schema.json', { instanceId: 'x', partId: 'turbo_kit', condition: 72, paint: { colour: '#c8452f', finish: 'gloss' } }), []);
  assert.equal(validator.validate('owned-part.schema.json', { instanceId: 'x', partId: 'turbo_kit', condition: 140 })[0].message, 'should be at most 100');
});

// ---------- stats: the migrated starter car ----------

// The Phase 1 car, except what the move to starter_car_v2.glb changed on purpose: the model, its
// 0.29 m wheels (a 185/60 R14's real size, was 0.33) with every torque the old radius set scaled by
// 0.29 / 0.33 so the forces at the road stay the same, the suspension mounts above the new sockets,
// the body collider round the new body, and the cockpit camera under its roof. Mass and centre of mass
// are exactly as before.
const MODEL_V2 = {
  'wheels.radius': 0.29, 'wheels.inertia': 1, 'gearbox.finalDrive': 3.78,
  'brakes.front.discRadius': 0.101, 'brakes.rear.discRadius': 0.0923, 'brakes.handbrake.torque': 2810, 'brakes.autoHold.torque': 1320,
  'assists.stability.oversteerGain': 2200, 'assists.stability.understeerGain': 2200, 'assists.stability.maxTorque': 1230,
  'wheels.mountHeight.front': 0.202, 'wheels.mountHeight.rear': 0.21,
  'bodyCollider.centre.1': 0.81, 'bodyCollider.centre.2': -0.025, 'bodyCollider.halfExtents.1': 0.49, 'bodyCollider.halfExtents.2': 1.975,
  'camera.cockpit.position.0': 0.38, 'camera.cockpit.position.1': 1.06, 'camera.cockpit.position.2': -0.42, 'camera.cockpit.fov': 64, 'camera.cockpit.pitch': 4,
  name: 'Starter coupe',
};
test('the stock build is the Phase 1 starter car on the new model', () => {
  const s = fresh().stats();
  assert.deepEqual(s.errors, []);
  const a = leaves(phase1), b = leaves({ ...s.spec, aeroParts: undefined });
  // (Step 4: the inertia is a tensor worked out from the chassis and the parts — the same principal
  // moments as Phase 1's box, as Rapier stores them — and the wheels say their unsprung mass and offsets)
  const step4 = k => /^(inertiaBox|inertiaTensor)\./.test(k) || /^wheels\.(unsprung|unsprungBaseline|offsets)(\.|$)/.test(k) || /^assists\.abs\.referenceTorque\./.test(k);   // (Step 8: what the ABS is set for)
  // (Fixes and engine upgrades: the engine's condition, cylinders, over-rev limits and sound, the rev
  // protection aid, and the stock gearbox's quicker shift, 0.2 s rather than 0.25)
  const fixes = k => /^engine\.(cylinders|overRev|condition|blown|wear|sound)(\.|$)/.test(k) || k === 'assists.revProtection.enabled' || k === 'gearbox.shiftTime';
  // (Phase 3 Step 3: the mechanical damage the physics works — none on a new car — and the rim's radius)
  // (Phase 4: anti-roll bars — none — and lift, for the parts that add to them)
  // (Phase 8 Step 1: what it sounds like — spec.audio, from its parts' sound blocks)
  const damage = k => k.startsWith('damage.') || k === 'wheels.rimRadius' || k.startsWith('suspension.antiRoll.') || k === 'wheels.lift' || /^(cooling|soundMod|cosmetic|audio)\./.test(k);
  const same = k => !k.startsWith('model.') && !(k in MODEL_V2) && !step4(k) && !fixes(k) && !damage(k);
  assert.deepEqual(Object.keys(b).filter(same).sort(), Object.keys(a).filter(same).sort());
  for (const k of Object.keys(a).filter(same)) assert.equal(b[k], a[k], k);
  assert.equal(a['gearbox.shiftTime'], 0.25); assert.equal(b['gearbox.shiftTime'], 0.2);
  assert.equal(b['assists.revProtection.enabled'], false); assert.equal(b['engine.condition'], 100); assert.equal(b['engine.blown'], false);
  for (const [k, v] of Object.entries(MODEL_V2)) assert.equal(b[k], v, k);
  const box = massFrame({ ...phase1, inertiaBox: phase1.inertiaBox }), now = massFrame(s.spec);
  for (const k of ['x', 'y', 'z']) assert.equal(Math.fround(now.principal[k]), Math.fround(box.principal[k]), `inertia ${k}`);
  assert.deepEqual(now.frame, { x: 0, y: 0, z: 0, w: 1 });
  for (const k of ['FL', 'FR', 'RL', 'RR']) { assert.equal(s.spec.wheels.unsprung[k], s.spec.wheels.unsprungBaseline); assert.equal(s.spec.wheels.offsets[k], 0); }
  for (const k of ['FL', 'FR', 'RL', 'RR']) assert.deepEqual(s.spec.damage.wheels[k], { toe: 0, camber: 0, ride: 0, damper: 0, bend: 0, pressure: 1, leak: 0, brake: 0, off: false });
  assert.deepEqual([b['damage.coolant'], b['damage.radiatorLeak'], b['damage.boost'], b['damage.gearbox'], b['damage.differential'], b['damage.clutch'], b['damage.exhaust']], [1, 0, 0, 0, 0, 0, 0]);
  assert.equal(b['wheels.rimRadius'], 0.191);
  assert.equal(b['model.file'], 'assets/cars/starter_car/body.glb');
  assert.equal(b['model.source'], 'data/cars/starter_car/starter_car_v2.glb');
});

test('totals: mass, peak torque and power, estimated top speed', () => {
  const t = fresh().stats().totals;
  assert.equal(t.mass, 1150);
  assert.deepEqual(t.peakTorque, { nm: 158, rpm: 4500 });
  close(t.peakPower.hp, 114.6, 0.1);
  assert.ok(t.topSpeed.kmh > 185 && t.topSpeed.kmh < 198, `${t.topSpeed.kmh}`);   // the test suite measures 191
  assert.equal(t.massByPart.reduce((a, p) => a + p.mass, 0) + db.cars.starter_car.chassis.mass, 1150);
});

test('breakdown: every value says where it came from', () => {
  const s = fresh().stats();
  for (const path of Object.keys(leaves({ ...s.spec, aeroParts: undefined }))) assert.ok(s.breakdown[path]?.length, `no breakdown for ${path}`);
  assert.deepEqual(s.breakdown['engine.redlineRpm'].map(x => [x.step, x.source.id]), [['component', 'stock_engine_rs17']]);
  assert.deepEqual(s.breakdown['steering.ratio'].map(x => [x.step, x.source.id]), [['base', 'starter_car']]);
  assert.equal(s.breakdown['tyre.lateral.D'][0].source.count, 4);          // one definition on four corners
});

test('centre of mass moves with a part\'s mass at its socket', () => {
  const g = fresh(), before = g.stats().spec;
  assert.ok(g.install('front_mount_intercooler').ok);
  const after = g.stats().spec, ic = db.cars.starter_car.sockets.find(s => s.name === 'socket_intercooler').position;
  assert.equal(after.mass, before.mass + 9);
  for (let k = 0; k < 3; k++) close(after.centreOfMass[k], (before.centreOfMass[k] * before.mass + 9 * ic[k]) / after.mass, 1e-8);
});

test('modifiers apply adds, then multiplies, then sets, whatever their socket order', () => {
  // intake (an early socket) multiplies, the ECU (a later one) adds and sets: adds still come first
  const d = withParts(
    part('t_mul', 'intake', { fits: ['intake_flange:rs'], effects: [{ target: 'suspension.stiffness', op: 'multiply', value: 1.5 }, { target: 'suspension.damping', op: 'set', value: 1000 }] }),
    part('t_add', 'ecu', { effects: [{ target: 'suspension.stiffness', op: 'add', value: 1000 }, { target: 'suspension.damping', op: 'add', value: 50 }] }));
  const g = new Garage(d);
  assert.ok(g.install('t_mul').ok);
  assert.ok(g.install('t_add').ok);
  const s = g.stats();
  assert.equal(s.spec.suspension.stiffness, (30000 + 1000) * 1.5);
  assert.equal(s.spec.suspension.damping, 1000);                  // the set wins, last
  assert.deepEqual(s.breakdown['suspension.stiffness'].map(x => x.step), ['component', 'add', 'multiply']);
});

// ---------- the test parts ----------

test('cold air intake: more torque up top, a little less at the bottom, 1 kg lighter', () => {
  const g = fresh(), r = g.install('cold_air_intake');
  assert.ok(r.ok, JSON.stringify(r.errors));
  const E = r.after.spec.engine.torqueCurve, S = phase1.engine.torqueCurve;
  const at = rpm => [E.find(p => p[0] === rpm)[1], S.find(p => p[0] === rpm)[1]];
  for (const rpm of [4000, 5000, 6000, 7200]) { const [a, b] = at(rpm); close(a, b * 1.05); }
  { const [a, b] = at(3500); close(a, b * 1.025); }                 // half way through the fade
  { const [a, b] = at(3000); close(a, b); }                         // before it
  { const [a, b] = at(800); close(a, b * 0.98); }
  assert.equal(r.after.totals.mass, 1149);
  assert.ok(r.after.totals.peakPower.hp > r.before.totals.peakPower.hp);
  assert.match(explain(r.after, 'engine.torqueCurve.8.1'), /Cold air intake in socket_intake: ×1\.05/);
  assert.ok(changes(r.before, r.after).find(c => c.path === 'engine.torqueCurve.8.1').by.includes('Cold air intake'));
  assert.ok(r.steps.some(s => s.includes('took Bonnet')), 'the bonnet comes off first');
  assert.ok(g.build.sockets.socket_bonnet, 'and goes back on');
});

test('turbo kit: refused without an intercooler, boosts with one', () => {
  const g = fresh();
  const no = g.install('turbo_kit');
  assert.equal(no.ok, false);
  assert.ok(no.errors.some(e => e.code === 'requires' && /intercooler/.test(e.message)), JSON.stringify(no.errors));
  assert.equal(g.build.sockets.socket_turbo, null, 'nothing changed');
  assert.ok(g.install('front_mount_intercooler').ok);
  const r = g.install('turbo_kit');
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.after.spec.engine.induction, 'turbo');
  const t = rpm => r.after.spec.engine.torqueCurve.find(p => p[0] === rpm)[1], s = rpm => phase1.engine.torqueCurve.find(p => p[0] === rpm)[1];
  close(t(4500), s(4500) * (1 + 0.85 * 0.55 / 1.01325));
  close(t(1500), s(1500));                                           // no boost yet
  assert.ok(!r.warnings.some(w => w.code === 'clutch_slips'), 'the stock clutch holds a small turbo');
  // turned up to 1.05 bar (the standalone ECU), the stock clutch can't hold it
  const up = g.install('ecu_standalone');
  assert.ok(up.ok, JSON.stringify(up.errors));
  assert.ok(g.tune('ecu_standalone', 'boostTarget', 1.05).warnings.some(w => w.code === 'clutch_slips'));
  // and now the intercooler can't come off while the turbo needs it
  const off = g.remove('front_mount_intercooler');
  assert.equal(off.ok, false);
  assert.match(off.errors[0].message, /turbo kit.*needs an intercooler/i);
});

test('sport suspension: an upgrade of the car\'s own — the stock block, changed by its effects', () => {
  const g = fresh(), r = g.install('sport_suspension');
  assert.ok(r.ok, JSON.stringify(r.errors));
  const S = r.after.spec.suspension, near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(S.restLength, 0.3 * 0.843) && S.travel === 0.22 && near(S.stiffness, 42000) && near(S.damping, 3200 * 1.344), JSON.stringify(S));
  assert.deepEqual(S.antiRoll, { front: 0, rear: 0 });
  assert.equal(r.after.totals.mass, 1150 - 60 + 52);
  assert.deepEqual(r.after.breakdown['suspension.stiffness'].map(x => x.source.id), ['sport_suspension']);
  assert.equal(changes(r.before, r.after).filter(c => c.path.startsWith('suspension.')).length, 3);
});

// ---------- the validator ----------

test('validator: wrong slot, required socket empty, fits, conflicts, same part twice, unknown socket', () => {
  const g = fresh(), view = g.view, b = g.build;
  const intake = g.acquire('cold_air_intake').instanceId;
  assert.equal(checkInstall(b, 'socket_turbo', intake, view).errors[0].code, 'wrong_slot');
  assert.match(checkInstall(b, 'socket_turbo', intake, view).errors[0].message, /Cold air intake is an intake part: it doesn't go in socket_turbo, which takes a turbo/);
  const noEngine = validateBuild({ ...b, sockets: { ...b.sockets, socket_engine: null, socket_intake: null, socket_turbo: null, socket_exhaust: null } }, view);
  assert.ok(noEngine.errors.some(e => e.code === 'required_empty' && e.socket === 'socket_engine'));
  // a tyre needs a 14" rim: without the wheel it doesn't fit
  const noRim = validateBuild({ ...b, sockets: { ...b.sockets, socket_wheel_FL: null, socket_wheel_FR: null, socket_wheel_RL: null, socket_wheel_RR: null } }, view);
  assert.ok(noRim.errors.some(e => e.code === 'does_not_fit' && /rim:15/.test(e.message)));
  assert.ok(validateBuild({ ...b, sockets: { ...b.sockets, socket_intake: b.sockets.socket_exhaust } }, view).errors.some(e => e.code === 'instance_twice' || e.code === 'wrong_slot'));
  assert.equal(validateBuild({ ...b, sockets: { ...b.sockets, socket_nitrous: null } }, view).errors[0].code, 'unknown_socket');
});

test('validator: conflicts', () => {
  const d = withParts(part('t_supercharger', 'intercooler', { provides: ['forced_induction:supercharger', 'intercooler'] }));
  const g = new Garage(d);
  assert.ok(g.install('t_supercharger').ok);
  const r = g.install('turbo_kit');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'conflicts' && /t_supercharger/.test(e.message)), JSON.stringify(r.errors));
});

test('blockedBy: install / remove order', () => {
  const g = fresh(), view = g.view, b = g.build;
  const r = checkInstall(b, 'socket_intake', g.acquire('cold_air_intake').instanceId, view);
  assert.deepEqual(r.needEmpty, ['socket_bonnet']);
  assert.match(r.errors[0].message, /Take Bonnet \(stock\) out of socket_bonnet first/);
  assert.deepEqual(checkRemove(b, 'socket_clutch', view).needEmpty, ['socket_gearbox']);
  assert.deepEqual(checkRemove(b, 'socket_wheel_FL', view).needEmpty, ['socket_tyre_FL']);
  assert.equal(checkRemove({ ...b, sockets: { ...b.sockets, socket_bonnet: null } }, 'socket_intake', view).ok, true);
  // the garage does it in order on its own, or refuses when told not to
  assert.equal(g.install('cold_air_intake', { auto: false }).ok, false);
  assert.equal(g.install('cold_air_intake').ok, true);
});

test('reset: back to stock, identical stats, the parts taken off still owned', () => {
  const g = fresh();
  g.install('cold_air_intake'); g.install('sport_suspension');
  g.reset();
  assert.deepEqual(leaves(g.stats().spec), leaves(fresh().stats().spec));
  assert.ok(Object.values(g.state.parts).some(p => p.partId === 'cold_air_intake'));
});

test('modifier targets that don\'t exist are reported, not ignored', () => {
  const d = withParts(part('t_bad', 'ecu', { effects: [{ target: 'engine.turboLag', op: 'add', value: 1 }] }));
  const g = new Garage(d), r = g.install('t_bad');
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /there's no engine\.turboLag to change/);
  assert.equal(getPath(g.stats().spec, 'engine.idleRpm'), 900, 'nothing changed');
  assert.deepEqual(computeStats(g.build, g.view).errors, []);
});

// ---------- Step 3: socket groups, and the wheel size ----------

test('socket groups: a part whose slot is a group fills every socket in it; other parts one socket at a time', () => {
  const g = fresh(), view = () => g.view;
  const r = g.install('wheel_15_chrome');
  assert.ok(r.ok, JSON.stringify(r.errors));
  for (const s of db.cars.starter_car.socketGroups.wheels) assert.equal(g.state.parts[g.build.sockets[s]].partId, 'wheel_15_chrome');
  // (a group part in a single socket that isn't in the group: a clear refusal)
  const wrong = g.install('stock_wheel_15', { socket: 'socket_gearbox' });
  assert.equal(wrong.errors[0].message, '15" steel wheel (stock) goes on the wheels (4 sockets): it doesn\'t go in socket_gearbox, which takes a gearbox.');
  // seats: the first empty one
  assert.ok(g.remove('socket_seat_passenger').ok);
  assert.ok(g.install('stock_seat').steps.some(s => s.includes('socket_seat_passenger')));
  assert.ok(validateBuild(g.build, view()).ok);
});

test('wheels off: the tyres come off with them (fine in the garage), and go back on once there are rims', () => {
  const g = fresh();
  const off = g.remove('wheels');
  assert.ok(off.ok, JSON.stringify(off.errors));
  assert.ok(off.steps.some(s => /left 180\/55 R15 road tyre \(stock\) off/.test(s)));
  assert.ok(off.warnings.every(w => w.message.endsWith('(fine while it\'s in the garage)')));
  for (const s of [...db.cars.starter_car.socketGroups.wheels, ...db.cars.starter_car.socketGroups.tyres]) assert.equal(g.build.sockets[s], null);
  // rims first (the tyre sockets are still empty: a warning, not a refusal), then tyres
  const rims = g.install('stock_wheel_15');
  assert.ok(rims.ok, JSON.stringify(rims.errors));
  assert.ok(g.install('stock_tyre_180_55r15').ok);
  assert.ok(g.validate().ok);
  assert.deepEqual(g.stats().spec, fresh().stats().spec);
});

test('the wheel size: the tyre on its rim, for the physics to use (Step 4)', () => {
  const g = fresh();
  const w = g.stats().totals.wheel;
  assert.equal(w.label, '180/55 R15');
  // (the physics rolls on the rim + sidewall to the mm: 190.5 + 99 → 290 mm)
  assert.equal(w.radius, 0.29);
  assert.ok(Math.abs(w.rimRadius - 0.1905) < 1e-12);
  assert.equal(g.stats().spec.wheels.radius, 0.29);
  g.install('tyre_215_40r15');
  assert.equal(g.stats().spec.wheels.radius, 0.277);                    // 190.5 + 86 → 277 mm
});
