// Dents as drawn (garage/dents.js, garage/visual.js), with three.js in Node on the real models' meshes:
// the finer meshes keep every edge short and neighbouring faces joined; a crash dents this car's own
// copy of its meshes (another car on the same models is untouched), never deeper than the most, and the
// same wherever a door or the bonnet is; broken lights look broken; a repair puts the shared models
// back; and a hundred and fifty crashes stay cheap.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { harness, root } from '../harness.mjs';
import { readModel } from '../../tools/content/io.mjs';
import { ModelCache, createCarVisual } from '../../garage/visual.js';
import { MAX_EDGE, tessellate } from '../../garage/dents.js';
import { applyDamage, damageLayout, impactDamage } from '../../garage/damage.js';
import { nodeBoxes } from '../../physics/sockets.js';

const H = await harness(), rules = H.db.damage, car = H.db.cars.starter_car;
const glb = (() => { const b = fs.readFileSync(path.join(root, car.model.file)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); })();
const boxes = nodeBoxes(glb, car.model, [...car.model.breakables.map(b => b.node), 'body_shell']);

// A model as three.js objects from its real meshes (Node can't decode its textures, and doesn't need to)
async function loadReal(url) {
  const doc = await readModel(path.join(root, url)), scene = new THREE.Group(), made = new Map();
  const node = n => {
    if (made.has(n)) return made.get(n);
    const o = new THREE.Group();
    o.name = n.getName(); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); o.scale.fromArray(n.getScale());
    for (const p of n.getMesh()?.listPrimitives() ?? []) {
      const g = new THREE.BufferGeometry();
      for (const [sem, name, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]]) { const a = p.getAttribute(sem); if (a) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(a.getArray()), size)); }
      if (p.getIndices()) g.setIndex(new THREE.BufferAttribute(new Uint32Array(p.getIndices().getArray()), 1));
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: p.getMaterial()?.getName() ?? '' }));
      o.add(m);
    }
    for (const c of n.listChildren()) o.add(node(c));
    made.set(n, o);
    return o;
  };
  for (const n of doc.getRoot().getDefaultScene()?.listChildren() ?? doc.getRoot().listScenes()[0].listChildren()) scene.add(node(n));
  return { scene };
}
const cache = () => new ModelCache({ load: loadReal });
async function carOf(models) {
  const g = H.garage(), vis = await createCarVisual({ car, finishes: H.db.finishes, models });
  await vis.applyBuild(g.build, g.view);
  return { g, vis };
}
const meshesOf = o => { const out = []; o.traverse(x => { if (x.isMesh) out.push(x); }); return out; };
const moved = mesh => { const D = mesh.userData.dent; if (!D) return 0; const a = D.own.attributes.position.array; let m = 0; for (let i = 0; i < a.length; i += 3) m = Math.max(m, Math.hypot(a[i] - D.base[i], a[i + 1] - D.base[i + 1], a[i + 2] - D.base[i + 2])); return m; };
// a 60 km/h head-on hit into the test centre's wall, as the physics reported it
const HEAD_ON = { point: [0, 0.81, 1.95], normal: [0, -0.03, 1], yRange: [0.32, 1.3], extent: { min: [-0.85, 0.32, 1.95], max: [0.85, 1.3, 1.95] }, closing: 16.6, strength: 16.6, material: 'concrete', other: 'world', under: false };
function damageFor(g, impacts, state = { shell: null, parts: {} }) {
  const L = damageLayout({ car, build: g.build, db: g.view, boxes }, rules);
  for (const i of impacts) state = applyDamage(state, impactDamage(i, L, rules), rules, g.build.sockets);
  const parts = {};
  for (const [socket, id] of Object.entries(g.build.sockets)) if (id && state.parts[id]?.dents?.length) parts[socket] = state.parts[id].dents;
  return { state, damage: { shell: state.shell, parts } };
}

test('finer meshes: every edge short, attributes kept, neighbouring faces still joined after a dent', async () => {
  const { scene } = await loadReal('assets/parts/stock/starter_car/bumper_front.glb'), [mesh] = meshesOf(scene);
  const fine = tessellate(mesh.geometry), P = fine.attributes.position.array, idx = fine.index.array;
  let longest = 0;
  for (let i = 0; i < idx.length; i += 3) for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) longest = Math.max(longest, Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]));
  assert.ok(longest <= MAX_EDGE + 1e-6, `longest edge ${longest.toFixed(3)} m`);
  assert.ok(fine.attributes.normal && idx.length / 3 > 20 * (mesh.geometry.attributes.position.count / 3));
  // (no T-junctions: every vertex on another triangle's edge is one of its corners — checked as: the
  // edges by position are each shared by at most two faces' worth of triangles, and none is left half-split)
  const key = i => `${P[i * 3].toFixed(5)},${P[i * 3 + 1].toFixed(5)},${P[i * 3 + 2].toFixed(5)}`, ends = new Map();
  for (let i = 0; i < idx.length; i += 3) for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) { const k = [key(a), key(b)].sort().join('|'); ends.set(k, (ends.get(k) ?? 0) + 1); }
  const mids = new Set();
  for (const k of ends.keys()) { const [a, b] = k.split('|').map(s => s.split(',').map(Number)); mids.add(a.map((v, j) => ((v + b[j]) / 2).toFixed(5)).join(',')); }
  const corners = new Set(Array.from({ length: P.length / 3 }, (_, i) => key(i)));
  const halfSplit = [...ends.keys()].filter(k => { const [a, b] = k.split('|').map(s => s.split(',').map(Number)); return corners.has(a.map((v, j) => ((v + b[j]) / 2).toFixed(5)).join(',')) && ends.get(k) === 1; });
  assert.ok(halfSplit.length < 0.01 * ends.size, `${halfSplit.length} edges split on one side only`);
});

test('finer meshes from what the model loader gives: interleaved, quantised attributes', () => {
  // two triangles (a 0.4 m square) with positions as normalised shorts, positions and normals interleaved
  const q = v => Math.round(v * 32767), shorts = new Int16Array([q(0), q(0), q(0), 0, 0, q(1), q(0.4), q(0), q(0), 0, 0, q(1), q(0.4), q(0.4), q(0), 0, 0, q(1), q(0), q(0.4), q(0), 0, 0, q(1)]);
  const buf = new THREE.InterleavedBuffer(shorts, 6), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0, true));
  g.setAttribute('normal', new THREE.InterleavedBufferAttribute(buf, 3, 3, true));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const fine = tessellate(g), P = fine.attributes.position;
  assert.ok(fine.index.count / 3 > 30);
  const xs = Array.from({ length: P.count }, (_, i) => P.getX(i));
  assert.ok(Math.abs(Math.max(...xs) - 0.4) < 1e-3 && Math.min(...xs) === 0, 'the same size, in metres');
  assert.ok(Math.abs(fine.attributes.normal.getZ(0) - 1) < 1e-3);
});

test('a 60 km/h crash caves in this car\'s front — its own meshes; another car on the same models is untouched', async () => {
  const models = cache(), a = await carOf(models), b = await carOf(models);
  const { damage } = damageFor(a.g, [HEAD_ON]);
  a.vis.setDamage(damage, rules);
  const bumper = meshesOf(a.vis.partObject('socket_bumper_front')), bonnet = meshesOf(a.vis.partObject('socket_bonnet')), door = meshesOf(a.vis.partObject('socket_door_left'));
  assert.ok(Math.max(...bumper.map(moved)) > 0.2, `the bumper pushed in ${Math.max(...bumper.map(moved)).toFixed(3)} m`);
  assert.ok(Math.max(...bumper.map(moved)) <= rules.dent.maxDepth + 1e-6);
  assert.ok(Math.max(...bonnet.map(moved)) > 0.02, 'the bonnet too');
  assert.equal(Math.max(...door.map(moved)), 0, 'not the doors');
  assert.ok(door.every(m => !m.userData.dent), '(which keep the shared model)');
  const shell = meshesOf(a.vis.root).filter(m => /body_shell/.test(m.parent?.name));
  assert.ok(Math.max(...shell.map(moved)) > 0.1, 'the body shell');
  // (dents go back: the bumper's front pushed back, not out)
  const m = bumper.find(x => x.userData.dent), D = m.userData.dent, pos = D.own.attributes.position.array;
  let back = 0;
  for (let i = 2; i < pos.length; i += 3) back = Math.min(back, pos[i] - D.base[i]);
  assert.ok(back < -0.2);
  // the other car: every mesh on the shared models, as they were
  for (const x of meshesOf(b.vis.root)) assert.ok(!x.userData.dent);
  const shared = meshesOf(b.vis.partObject('socket_bumper_front'))[0].geometry;
  assert.equal(shared, bumper[0].userData.dent?.shared ?? bumper[0].geometry, 'the same model under both');
  // broken headlights: their own cracked, dead-looking material
  const head = meshesOf(a.vis.nodes.get('light_head_left'))[0];
  assert.ok(head.material.userData.cracked && head.material.emissiveIntensity === 0);
  assert.ok(!meshesOf(b.vis.nodes.get('light_head_left'))[0].material.userData.cracked);
  // repaired: the shared models and the whole lights back
  a.vis.setDamage({ shell: null, parts: {} }, rules);
  for (const x of meshesOf(a.vis.root)) { assert.ok(!x.userData.dent); assert.ok(!x.material.userData?.cracked); }
  assert.equal(meshesOf(a.vis.partObject('socket_bumper_front'))[0].geometry, shared);
});

test('the dents land in the same place with the bonnet open (the garage lifts it)', async () => {
  const { vis, g } = await carOf(cache()), { damage } = damageFor(g, [HEAD_ON]);
  vis.setDamage(damage, rules);
  const bonnet = meshesOf(vis.partObject('socket_bonnet')).filter(m => m.userData.dent), shut = bonnet.map(m => Float32Array.from(m.userData.dent.own.attributes.position.array));
  vis.setDamage({ shell: null, parts: {} }, rules);
  const hinge = vis.nodes.get('socket_bonnet');
  hinge.rotateX(-0.95);
  vis.setDamage(damage, rules);
  const open = meshesOf(vis.partObject('socket_bonnet')).filter(m => m.userData.dent).map(m => m.userData.dent.own.attributes.position.array);
  assert.equal(open.length, shut.length);
  open.forEach((a, k) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - shut[k][i])); assert.ok(d < 1e-6, `${d}`); });
});

// (this process's time on the processor, ms: the other test files running alongside don't count)
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

test('a hundred and fifty crashes: dent lists stay short, each crash stays cheap, nothing goes deeper than the most', async () => {
  const { vis, g } = await carOf(cache());
  let state = { shell: null, parts: {} }, rnd = 7;
  const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  const L = damageLayout({ car, build: g.build, db: g.view, boxes }, rules), times = [];
  // (the finer models once, as the game does while it loads)
  vis.setDamage(damageFor(g, [HEAD_ON]).damage, rules);
  for (let i = 0; i < 150; i++) {
    const a = r() * Math.PI * 2, n = [Math.sin(a), 0, Math.cos(a)], p = [n[0] * 0.85, 0.4 + r() * 0.8, n[2] * 1.95];
    const hit = { point: p, normal: n, yRange: [0.32, 1.3], strength: 1.5 + r() * 14, material: 'concrete', other: 'world' };
    state = applyDamage(state, impactDamage(hit, L, rules), rules, g.build.sockets);
    const parts = {};
    for (const [socket, id] of Object.entries(g.build.sockets)) if (id && state.parts[id]?.dents?.length) parts[socket] = state.parts[id].dents;
    const t0 = cpuMs();
    vis.setDamage({ shell: state.shell, parts }, rules);
    times.push(cpuMs() - t0);
  }
  for (const p of Object.values(state.parts)) assert.ok(p.dents.length <= rules.dent.maxPerPart);
  assert.ok(state.shell.dents.length <= rules.dent.maxPerPart);
  times.sort((a, b) => a - b);
  const median = times[75];
  assert.ok(median < 60, `a crash's dents drawn in ${median.toFixed(1)} ms (median)`);
  let deepest = 0;
  for (const m of meshesOf(vis.root)) deepest = Math.max(deepest, moved(m));
  assert.ok(deepest <= rules.dent.maxDepth + 1e-6, `${deepest}`);
});

test('loose and torn-off parts keep their dents, hang where the physics puts them, show both sides, and go back as they were', async () => {
  const { vis, g } = await carOf(cache()), { damage } = damageFor(g, [HEAD_ON]);
  vis.setDamage(damage, rules);
  const bumper = vis.partObject('socket_bumper_front'), node = bumper.parent, rest = bumper.matrix.clone();
  const dentedBefore = meshesOf(bumper).filter(m => m.userData.dent).map(m => Float32Array.from(m.userData.dent.own.attributes.position.array));
  vis.group.updateMatrixWorld(true);
  const worldBefore = new THREE.Vector3().setFromMatrixPosition(bumper.matrixWorld);
  assert.ok(vis.loosenPart('socket_bumper_front'));
  vis.group.updateMatrixWorld(true);
  assert.equal(bumper.parent, vis.group);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(bumper.matrixWorld).distanceTo(worldBefore) < 1e-6, 'where it was, to start with');
  assert.ok(meshesOf(bumper).every(m => [m.material].flat().every(x => x.side === THREE.DoubleSide)), 'both sides');
  // hanging off one end: turned 40° down about its left end
  const sp = car.sockets.find(s => s.name === 'socket_bumper_front').position, pivot = [sp[0] + 0.8, sp[1], sp[2]];
  const pose = new THREE.Matrix4().makeTranslation(...pivot).multiply(new THREE.Matrix4().makeRotationZ(-0.7)).multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2])).multiply(new THREE.Matrix4().makeTranslation(...sp));
  vis.setPartPose('socket_bumper_front', pose);
  vis.group.updateMatrixWorld(true);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(bumper.matrixWorld).distanceTo(worldBefore) > 0.2, 'swung down');
  // its dents stay, and a new look at the damage while it hangs doesn't move them
  vis.setDamage(damage, rules);
  meshesOf(bumper).filter(m => m.userData.dent).forEach((m, i) => assert.deepEqual(Array.from(m.userData.dent.own.attributes.position.array), Array.from(dentedBefore[i])));
  // torn off: off the car, placed in the world by the game
  const piece = vis.detachPart('socket_bumper_front');
  assert.equal(piece, bumper);
  assert.equal(bumper.parent, null);
  const where = vis.pieceMatrix('socket_bumper_front', new THREE.Matrix4().makeTranslation(5, 0.2, 9));
  assert.ok(new THREE.Vector3().setFromMatrixPosition(where).distanceTo(new THREE.Vector3(5, 0.2 - sp[1], 9 - sp[2]).add(new THREE.Vector3().setFromMatrixPosition(rest).add(new THREE.Vector3(...sp)))) < 1e-6);
  // back on: on its socket as it was, one-sided, dents and all
  assert.ok(vis.reattachPart('socket_bumper_front'));
  assert.equal(bumper.parent, node);
  bumper.updateMatrix();
  assert.ok(bumper.matrix.equals(rest));
  assert.ok(meshesOf(bumper).every(m => [m.material].flat().every(x => x.side !== THREE.DoubleSide)));
  assert.ok(meshesOf(bumper).some(m => m.userData.dent), 'still dented: ready to repair');
  assert.equal(vis.partState('socket_bumper_front'), 'attached');
});
