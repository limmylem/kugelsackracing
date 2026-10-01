// Unit tests for drawing cars from their parts (garage/visual.js), with three.js in Node: the models
// are stand-ins built from each real .glb's node tree (names, transforms, and a box per mesh with its
// real material names), since Node can't decode the textures.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { Garage, loadGarageData } from '../../garage/data.js';
import { ModelCache, createCarVisual, resolveLook, tyreGeometry } from '../../garage/visual.js';
import { tyreFit } from '../../garage/tyres.js';
import { glbJson } from '../../physics/sockets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = async rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const { db } = await loadGarageData(readJson);
const car = db.cars.starter_car;

// a stand-in for GLTFLoader: the file's nodes as Object3Ds, each mesh a small box per primitive
function standIn(url) {
  const bytes = fs.readFileSync(path.join(root, url)), json = glbJson(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const materials = (json.materials || []).map(m => new THREE.MeshStandardMaterial({ name: m.name }));
  const make = i => {
    const n = json.nodes[i], o = n.mesh !== undefined ? new THREE.Group() : new THREE.Object3D();
    o.name = n.name;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) o.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), materials[p.material]));
    for (const c of n.children || []) o.add(make(c));
    return o;
  };
  const scene = new THREE.Group();
  for (const i of json.scenes[0].nodes) scene.add(make(i));
  return { scene };
}
// a model cache whose loads can be held back (gate[url] = a promise) or fail (fail: a set of urls)
function cache({ gate = {}, fail = new Set() } = {}) {
  return new ModelCache({ load: async url => { await gate[url]; if (fail.has(url)) throw new Error('404 Not Found'); return standIn(url); } });
}
const fresh = () => new Garage(db, null);
const meshesAt = (vis, node) => { const out = []; vis.root.getObjectByName(node).traverse(o => { if (o.isMesh) out.push(o); }); return out; };
const at = (vis, socket) => vis.attached.get(socket)?.object;

test('the stock car: every stock part on its socket, one wheel model for four wheels, tyres made to fit', async () => {
  const g = fresh(), models = cache(), vis = await createCarVisual({ car, finishes: db.finishes, models });
  await vis.applyBuild(g.build, g.view);
  for (const s of ['socket_bonnet', 'socket_bumper_front', 'socket_seat_driver', 'socket_seat_passenger', 'socket_engine', 'socket_exhaust', 'socket_steering_wheel'])
    assert.equal(vis.attached.get(s).status, 'loaded', s);
  // the exhaust is drawn at its tip, the wheels and tyres on each wheel's pivot
  assert.equal(at(vis, 'socket_exhaust').parent.name, 'socket_exhaust_tip');
  for (const k of ['FL', 'FR', 'RL', 'RR']) {
    assert.equal(at(vis, `socket_wheel_${k}`).parent.name, `wheel_${k}`);
    assert.equal(at(vis, `socket_tyre_${k}`).parent.name, `wheel_${k}`);
  }
  const stats = Object.fromEntries(models.stats().map(s => [s.model, s]));
  assert.equal(stats['assets/parts/stock/starter_car/wheel_stock.glb'].inUse, 4);
  assert.equal(stats['assets/parts/stock/starter_car/wheel_stock.glb'].loaded, 1);
  assert.equal(stats['assets/parts/stock/starter_car/seat.glb'].inUse, 2);
  // parts with no model (the ECU, the gearbox…) show nothing
  assert.equal(vis.attached.get('socket_ecu').object, null);
  // the tyres: 180/55 on the 15" rim, as the model had them
  assert.ok(Math.abs(vis.wheelRadius('FL') - 0.2895) < 1e-9);
  assert.equal(vis.attached.get('socket_tyre_FL').status, 'made to fit (180/55 R15)');
});

test('ten cars load each model once, share geometry, and let go of it when they go', async () => {
  const g = fresh(), models = cache(), cars = [];
  for (let i = 0; i < 10; i++) { const v = await createCarVisual({ car, finishes: db.finishes, models }); await v.applyBuild(g.build, g.view); cars.push(v); }
  for (const s of models.stats()) assert.equal(s.loaded, 1, `${s.model} loaded ${s.loaded} times`);
  const bonnets = cars.map(v => meshesAt(v, 'socket_bonnet')[0]);
  assert.ok(bonnets.every(m => m.geometry === bonnets[0].geometry), 'one bonnet geometry for every car');
  assert.ok(new Set(cars.map(v => v.paintMaterial)).size === 10, 'every car its own paint');
  // disposing: the models' geometry goes when the last car does
  const geometry = bonnets[0].geometry;
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  for (const v of cars.slice(0, 9)) v.dispose();
  await new Promise(r => setTimeout(r));
  assert.equal(disposed, 0);
  cars[9].dispose();
  await new Promise(r => setTimeout(r));
  assert.equal(disposed, 1);
  assert.equal(models.entries.size, 0);
});

test('applyBuild only changes what is different, and keeps the old part until the new one has loaded', async () => {
  const g = fresh(), models = cache();
  const vis = await createCarVisual({ car, finishes: db.finishes, models });
  await vis.applyBuild(g.build, g.view);
  const before = new Map([...vis.attached].map(([s, e]) => [s, e.object]));
  await vis.applyBuild(g.build, g.view);
  for (const [s, o] of before) assert.equal(at(vis, s) ?? null, o ?? null, `${s} was redrawn`);
  // swap the bonnet for the carbon one, holding its load back
  let release;
  const models2 = cache({ gate: { 'assets/parts/stock/starter_car/bonnet.glb': new Promise(r => { release = r; }) } });
  const vis2 = await createCarVisual({ car, finishes: db.finishes, models: models2 });
  const building = vis2.applyBuild(g.build, g.view);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(at(vis2, 'socket_bonnet'), undefined, 'nothing yet: still loading');
  assert.equal(vis2.list().find(r => r.socket === 'socket_bonnet').loading?.startsWith('assets/parts/stock/starter_car/bonnet.glb'), true);
  release(); await building;
  const old = at(vis2, 'socket_bonnet');
  assert.ok(old);
  g.install('bonnet_carbon');
  let release2;
  models2.load = async url => { if (url.endsWith('bonnet.glb')) await new Promise(r => { release2 = r; }); return standIn(url); };
  // (the carbon bonnet is the same model with a finish: no new load, and it changes straight away)
  await vis2.applyBuild(g.build, g.view);
  assert.notEqual(at(vis2, 'socket_bonnet'), old);
  assert.equal(meshesAt(vis2, 'socket_bonnet')[0].material.userData.finish ?? meshesAt(vis2, 'socket_bonnet')[0].material.clearcoat, 1);
  assert.equal(release2, undefined, 'the bonnet model wasn\'t loaded again');
});

test('a part whose model won\'t load is a placeholder box its bounds\' size, with a clear error', async () => {
  const g = fresh(), models = cache({ fail: new Set(['assets/parts/stock/starter_car/door_left.glb']) });
  const errors = [], log = console.error;
  console.error = m => errors.push(String(m));
  try {
    const vis = await createCarVisual({ car, finishes: db.finishes, models });
    await vis.applyBuild(g.build, g.view);
    const e = vis.attached.get('socket_door_left'), bounds = db.parts.stock_door_left.bounds;
    assert.equal(e.status, 'placeholder (model failed to load)');
    const box = new THREE.Box3().setFromObject(e.object.children[0]), size = box.getSize(new THREE.Vector3());
    assert.deepEqual(size.toArray().map(v => +v.toFixed(4)), bounds.max.map((v, i) => +(v - bounds.min[i]).toFixed(4)));
    assert.match(errors.join('\n'), /couldn't load the model of Door, left \(stock\) for socket_door_left \(assets\/parts\/stock\/starter_car\/door_left\.glb\): 404 Not Found\. Drawing a placeholder box instead\./);
    // the rest of the car is there
    assert.equal(vis.attached.get('socket_door_right').status, 'loaded');
  } finally { console.error = log; }
});

test('socket groups, hides, empty sockets, variants and placeholders', async () => {
  // (a wing and an intercooler with no model yet, drawn as placeholders: these two as they were before theirs were made)
  const real = { basic_wing: db.parts.basic_wing, front_mount_intercooler: db.parts.front_mount_intercooler };
  db.parts.basic_wing = { ...real.basic_wing, model: '', byCar: undefined, placeholder: { width: 1.3, chord: 0.28, thickness: 0.03, height: 0.22, colour: '#1f2226' } };
  db.parts.front_mount_intercooler = { ...real.front_mount_intercooler, model: '', byCar: undefined };
  try { await placeholders(); } finally { Object.assign(db.parts, real); }
});
async function placeholders() {
  const g = fresh(), models = cache(), vis = await createCarVisual({ car, finishes: db.finishes, models });
  // three looks of the stock wheel on all four corners: the same model, different finishes, a wider one
  for (const [id, check] of [['wheel_15_chrome', m => m.metalness === 1], ['wheel_15_matte_black', m => m.roughness === 0.85], ['wheel_15_bronze_wide', m => m.color.getHexString() === 'a57c45']]) {
    assert.ok(g.install(id).ok);
    await vis.applyBuild(g.build, g.view);
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const rim = at(vis, `socket_wheel_${k}`);
      rim.traverse(o => { if (o.isMesh) assert.ok(check(o.material), `${id} on ${k}`); });
      assert.deepEqual(rim.scale.toArray(), id === 'wheel_15_bronze_wide' ? [1.25, 1, 1] : [1, 1, 1]);
    }
  }
  assert.equal(models.stats().find(s => s.model.endsWith('wheel_stock.glb')).loaded, 1);
  // empty optional sockets show nothing: the bonnet off
  g.remove('socket_bonnet');
  await vis.applyBuild(g.build, g.view);
  assert.equal(at(vis, 'socket_bonnet'), undefined);
  assert.equal(vis.root.getObjectByName('socket_bonnet').children.length, 0);
  g.install('stock_bonnet');
  // a placeholder spoiler, and a turbo that hides the intake while it's on
  g.install('cold_air_intake'); g.install('front_mount_intercooler'); g.install('turbo_kit'); g.install('basic_wing');
  await vis.applyBuild(g.build, g.view);
  assert.equal(vis.attached.get('socket_spoiler').status, 'placeholder (no model yet)');
  assert.ok(at(vis, 'socket_spoiler').userData.wing);
  assert.equal(vis.attached.get('socket_intercooler').status, 'placeholder (no model yet)');
  assert.equal(at(vis, 'socket_intercooler').parent.userData.virtual, true, 'a socket the model hasn\'t got: a node at its car.json place');
  assert.equal(at(vis, 'socket_intake').visible, false, 'the turbo hides the intake');
  g.remove('socket_turbo');
  await vis.applyBuild(g.build, g.view);
  assert.equal(at(vis, 'socket_intake').visible, true);
}

test('tyres: made round the rim, resized with the tyre size', async () => {
  const fit = tyreFit({ diameter: 15 }, { width: 180, sidewall: 55 });
  const geo = tyreGeometry(fit), p = geo.getAttribute('position');
  let rMin = Infinity, rMax = 0, xMax = 0;
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getY(i), p.getZ(i)); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); xMax = Math.max(xMax, Math.abs(p.getX(i))); }
  assert.ok(Math.abs(rMin - 0.1905) < 1e-6 && Math.abs(rMax - 0.2895) < 1e-6 && Math.abs(xMax - 0.09) < 1e-6);
  assert.equal(p.count, 18 * 7 * 6);                         // 18 faces round, 7 bands, 2 triangles each
  // every face points out of the tyre
  const n = geo.getAttribute('normal');
  for (let i = 0; i < p.count; i += 3) {
    const c = new THREE.Vector3(), mid = new THREE.Vector3();
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(p.getX(i + k), p.getY(i + k), p.getZ(i + k)));
    c.divideScalar(3);
    const a = Math.atan2(c.y, c.z); mid.set(0, 0.24 * Math.sin(a), 0.24 * Math.cos(a));
    assert.ok(new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).dot(c.sub(mid)) > 0, `face ${i / 3} faces in`);
  }
  // fitting wider, lower tyres remakes the tyres (and the wheel's radius) around the same rims
  const g = fresh(), vis = await createCarVisual({ car, finishes: db.finishes, models: cache() });
  await vis.applyBuild(g.build, g.view);
  const rim = at(vis, 'socket_wheel_FL');
  g.install('tyre_215_40r15');
  await vis.applyBuild(g.build, g.view);
  assert.equal(at(vis, 'socket_wheel_FL'), rim, 'the rims stay');
  assert.ok(Math.abs(vis.wheelRadius('RR') - (0.1905 + 0.215 * 0.4)) < 1e-9);
  const box = new THREE.Box3().setFromObject(at(vis, 'socket_tyre_FL')).getSize(new THREE.Vector3());
  assert.ok(Math.abs(box.x - 0.215) < 1e-6, `tyre width ${box.x}`);
  // taking the wheels off takes the tyres with them (they fit the rims)…
  assert.ok(g.remove('wheels').ok);
  await vis.applyBuild(g.build, g.view);
  assert.equal(at(vis, 'socket_wheel_FL'), undefined);
  assert.equal(at(vis, 'socket_tyre_FL'), undefined);
  // …and a tyre with no rim under it (a build made by hand) isn't drawn
  const handMade = { ...g.build, sockets: { ...g.build.sockets, socket_tyre_FL: g.acquire('stock_tyre_180_55r15').instanceId } };
  await vis.applyBuild(handMade, g.view);
  assert.equal(vis.attached.get('socket_tyre_FL').status, 'not drawn: no rim to go on');
});

test('paint: one per car, followed by the body and every painted part; finishes; a part\'s own look', async () => {
  const g = fresh(), models = cache();
  const a = await createCarVisual({ car, finishes: db.finishes, models }), b = await createCarVisual({ car, finishes: db.finishes, models, paint: { colour: '#c8452f', finish: 'metallic' } });
  await a.applyBuild(g.build, g.view); await b.applyBuild(g.build, g.view);
  const painted = v => [...meshesAt(v, 'starter_car').filter(m => m.material.name === 'paint')];
  assert.ok(painted(a).length > 5 && painted(a).every(m => m.material === a.paintMaterial), 'body and panels share the car\'s paint');
  assert.equal(a.paintMaterial.color.getHexString(), '6d9a91');
  assert.equal(b.paintMaterial.color.getHexString(), 'c8452f');
  assert.ok(b.paintMaterial.isMeshPhysicalMaterial && b.paintMaterial.clearcoat === 1 && b.paintMaterial.metalness === 0.65);
  // repaint a: b doesn't change
  a.setPaint({ colour: '#2255aa', finish: 'matte' });
  assert.equal(a.paintMaterial.roughness, 0.92);
  assert.ok(painted(a).every(m => m.material === a.paintMaterial));
  assert.equal(b.paintMaterial.color.getHexString(), 'c8452f');
  // brake lights and glass are each car's own
  const lamp = v => meshesAt(v, 'starter_car').find(m => m.material.name === 'light_tail').material;
  assert.notEqual(lamp(a), lamp(b));
  // a part instance's own look: a matte black bonnet stays matte black when the car is repainted
  g.install('stock_bonnet');
  g.state.parts[g.build.sockets.socket_bonnet].paint = { finish: 'matte_black' };
  await a.applyBuild(g.build, g.view);
  a.setPaint({ colour: '#ffcc00', finish: 'gloss' });
  const bonnet = meshesAt(a, 'socket_bonnet')[0].material;
  assert.equal(bonnet.color.getHexString(), '161617');
  assert.notEqual(bonnet, a.paintMaterial);
  // a part painted in its own colour keeps the car's finish
  g.state.parts[g.build.sockets.socket_bonnet].paint = { colour: '#00ff00' };
  await a.applyBuild(g.build, g.view);
  assert.equal(meshesAt(a, 'socket_bonnet')[0].material.color.getHexString(), '00ff00');
  assert.equal(meshesAt(a, 'socket_bonnet')[0].material.roughness, 0.4);
});

test('a variant\'s look: its base part\'s model and bounds, its own look over the base\'s, the owner\'s over that', () => {
  const r = resolveLook(db.parts.wheel_15_bronze_wide, db.parts, { paint: { finish: 'chrome' } });
  assert.equal(r.model, db.parts.stock_wheel_15.model);
  assert.deepEqual(r.bounds, db.parts.stock_wheel_15.bounds);
  assert.deepEqual(r.look, { finish: 'chrome', colour: '#a57c45', scale: [1.25, 1, 1] });
  assert.equal(resolveLook(db.parts.stock_ecu, db.parts).model, '');
});

// ---------- generated parts (npm run generate-parts) ----------

test('a brake kit is drawn at every wheel: on a hub that steers but doesn\'t turn, inside the rim, its caliper behind the axle on both sides', async () => {
  const g = fresh(), vis = await createCarVisual({ car, finishes: db.finishes, models: cache() });
  assert.ok(g.install('brakes_race', { auto: true }).ok);
  await vis.applyBuild(g.build, g.view);
  const e = vis.attached.get('socket_brakes');
  assert.equal(e.status, 'at 4 wheels');
  const copies = e.object.userData.atWheels;
  assert.deepEqual(copies.map(c => c.object.parent.name).sort(), ['hub_FL', 'hub_FR', 'hub_RL', 'hub_RR']);
  for (const k of ['FL', 'FR', 'RL', 'RR']) assert.equal(vis.hubs[k].parent, vis.wheels[k], `hub_${k} is on the wheel's pivot`);
  assert.equal(vis.hubs.FR.scale.z, -1); assert.equal(vis.hubs.FL.scale.z, 1);
  // (the starter car's 15" rims: the kit made smaller to fit inside them)
  const b = db.parts.brakes_race.bounds, reach = Math.max(...[1, 2].flatMap(i => [Math.abs(b.min[i]), Math.abs(b.max[i])]));
  assert.ok(Math.abs(copies[0].object.scale.y - Math.min(1, (15 * 0.0254 / 2 - 0.034) / reach)) < 1e-9);
  // the wheel turns; its hub turns back, so the caliper stays put
  vis.wheels.FL.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2);
  vis.setWheelSpin('FL', [1, 0, 0], 1.2);
  vis.root.updateMatrixWorld(true);
  const q = vis.hubs.FL.getWorldQuaternion(new THREE.Quaternion()), base = vis.wheels.FL.parent.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(q.angleTo(base) < 1e-6);
  // off again: all four copies go
  g.remove('socket_brakes');
  await vis.applyBuild(g.build, g.view);
  for (const k of ['FL', 'FR', 'RL', 'RR']) assert.equal(vis.hubs[k].children.length, 0);
});

test('a part made to fit each car is drawn with that car\'s model; a wing\'s element turns to its angle; a light glows its colour', async () => {
  for (const carId of ['starter_car', 'kaze_gt', 'ridgeback_4x4']) {
    const c = db.cars[carId], g = new Garage(db, null, carId), vis = await createCarVisual({ car: c, finishes: db.finishes, models: cache() });
    assert.ok(g.install('roll_cage_welded', { auto: true }).ok, carId);
    await vis.applyBuild(g.build, g.view);
    assert.equal(vis.attached.get('socket_cage').url, db.parts.roll_cage_welded.byCar?.[carId]?.model ?? db.parts.roll_cage_welded.model, carId);
    assert.equal(resolveLook(db.parts.roll_cage_welded, db.parts, null, carId).model, vis.attached.get('socket_cage').url);
  }
  const g = new Garage(db, null, 'kaze_gt'), vis = await createCarVisual({ car: db.cars.kaze_gt, finishes: db.finishes, models: cache() });
  for (const id of ['kaze_gt_gt_wing', 'underglow_blue']) assert.ok(g.install(id, { auto: true }).ok, id);
  await vis.applyBuild(g.build, g.view);
  assert.equal(vis.attached.get('socket_spoiler').object.userData.wing?.name, 'wing_element');
  const lit = []; vis.attached.get('socket_underglow').object.traverse(o => { if (o.isMesh && o.material.name === 'light_aux') lit.push(o.material); });
  assert.ok(lit.length && lit.every(m => m.emissive.getHexString() === '2f8cff'), 'the underglow strips glow blue');
});
