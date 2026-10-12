// The model import pipeline (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): broken models refused with clear errors (a
// level of detail over its budget, a new car missing a socket); a model imported is finished — levels of detail made
// with meshoptimizer, big textures made KTX2 — and a part that comes off in a crash gets collision hulls and its detach
// mounts from the model; the game draws a far car from the levels of detail (garage/visual.js lodOf), and a part lying
// in the road collides as its hulls (garage/detach.js, physics/looseParts.js) — every part that comes off has hulls
// the physics can make.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { importFile } from '../../tools/content/importer.mjs';
import { loadProject } from '../../tools/content/project.mjs';
import { ROOT, loadRules } from '../../tools/content/rules.mjs';
import { ModelBuilder, box } from '../../tools/content/shapes.mjs';
import { modelIO, readModel } from '../../tools/content/io.mjs';
import { inspect } from '../../tools/content/inspect.mjs';
import { checkModel } from '../../tools/content/check.mjs';
import { compressTextures } from '../../tools/content/ktx2.mjs';
import { collisionHulls } from '../../tools/content/collision.mjs';
import { ModelCache, lodOf } from '../../garage/visual.js';
import { bodyDef } from '../../garage/detach.js';
import { harness } from '../harness.mjs';

const rules = loadRules();
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogn-import-'));
  fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'incoming'));
  return dir;
}
const writeGlb = async (doc, file) => fs.writeFileSync(file, await (await modelIO()).writeBinary(doc));
// (a box with each face split n × n: 12n² triangles)
function slab([x0, y0, z0], [x1, y1, z1], n) {
  const tris = [], P = (u, v, f) => f(u / n, v / n);
  const face = f => { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a = P(i, j, f), b = P(i + 1, j, f), c = P(i + 1, j + 1, f), d = P(i, j + 1, f); tris.push([a, b, c], [a, c, d]); } };
  const L = (a, b, t) => a + (b - a) * t;
  face((u, v) => [L(x0, x1, u), y0, L(z0, z1, v)]); face((u, v) => [L(x0, x1, v), y1, L(z0, z1, u)]);
  face((u, v) => [x0, L(y0, y1, v), L(z0, z1, u)]); face((u, v) => [x1, L(y0, y1, u), L(z0, z1, v)]);
  face((u, v) => [L(x0, x1, v), L(y0, y1, u), z0]); face((u, v) => [L(x0, x1, u), L(y0, y1, v), z1]);
  return tris;
}

test('import refuses a level of detail over its budget, in plain words', async () => {
  const root = scratch();
  try {
    const m = new ModelBuilder();
    m.add(slab([-0.6, 0, -0.15], [0.6, 0.06, 0.15], 15), { node: 'wing', material: 'paint' });          // 2,700 triangles
    m.add(slab([-0.6, 0, -0.15], [0.6, 0.06, 0.15], 13), { node: 'wing__lod1', material: 'paint' });    // 2,028: 3× its 700
    const file = path.join(root, 'incoming/spoiler_heavy_lod.glb');
    await writeGlb(await m.document({ finishes: rules.finishes }), file);
    const r = await importFile(file, await loadProject(root));
    assert.equal(r.ok, false);
    assert.ok(r.after.findings.some(f => f.level === 'fail' && /^LOD1 has 3× too many triangles: 2,028, where its budget is 700/.test(f.text)), JSON.stringify(r.after.findings.filter(f => f.level !== 'pass')));
    assert.ok(fs.existsSync(file) && !fs.existsSync(path.join(root, 'data/parts/aero/spoiler_heavy_lod.json')), 'nothing written');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('import refuses a new car missing a socket, socket by socket in plain words', async () => {
  const root = scratch();
  try {
    fs.cpSync(path.join(ROOT, 'assets'), path.join(root, 'assets'), { recursive: true });
    const doc = await readModel(path.join(ROOT, 'data/cars/starter_car/starter_car_v2.glb'));
    const sock = doc.getRoot().listNodes().find(n => n.getName() === 'socket_bumper_front');
    for (const c of sock.listChildren()) c.dispose();
    sock.dispose();
    const file = path.join(root, 'incoming/car_nobumper.glb');
    await writeGlb(doc, file);
    const r = await importFile(file, await loadProject(root));
    assert.equal(r.ok, false);
    const fails = r.after.findings.filter(f => f.level === 'fail').map(f => f.text);
    assert.ok(fails.some(t => t.startsWith('Front bumper missing socket "socket_bumper_front"')), fails.join(' | '));
    assert.ok(!fs.existsSync(path.join(root, 'data/cars/nobumper/car.json')), 'nothing written');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a part imported is finished: levels of detail, collision hulls and how it hangs when it comes loose — and the game draws its LOD far away', async () => {
  const root = scratch();
  try {
    const m = new ModelBuilder();
    m.add(slab([-0.85, -0.15, -0.1], [0.85, 0.15, 0.15], 8), { node: 'bumper', material: 'paint' });   // 768 triangles
    const file = path.join(root, 'incoming/bumper_front_testline.glb');
    await writeGlb(await m.document({ finishes: rules.finishes }), file);
    const r = await importFile(file, await loadProject(root));
    assert.ok(r.ok, r.message);
    assert.ok(r.finished.some(d => /^made LOD1: \d+ triangles/.test(d)), r.finished.join('; '));
    const part = (await loadProject(root)).db.parts.bumper_front_testline;
    assert.equal(part.detach?.looseType, 'hanging');
    assert.deepEqual(part.detach.mounts, [[0.765, 0, 0], [-0.765, 0, 0]], 'its fixings at the ends of its long side');
    assert.ok(part.collision?.hulls.length >= 1 && part.collision.hulls.every(h => h.length % 3 === 0 && h.length >= 12));
    // its model: the LOD in a scene of its own, which the game's checks leave out of the model's own count
    const doc = await readModel(path.join(root, part.model)), info = inspect(doc);
    assert.equal(info.triangleCount, 768);
    assert.equal(info.lods[0].level, 1); assert.ok(info.lods[0].triangles < 768 * 0.5);
    assert.equal(checkModel(info, { rules, type: 'bumper_front', file: 'x.glb' }).verdict, 'pass');
    // the physics: a box no more — its hulls
    const def = bodyDef(part, { position: [0, 0.4, 2] }, {});
    assert.equal(def.hulls, part.collision.hulls);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the game keeps a model\'s LOD1 for the geometry it stands for, shared by every copy, and lets it go with the model', async () => {
  const mesh = (n, name) => { const g = new THREE.BoxGeometry(1, 1, 1, n, n, n), o = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); o.name = name; o.userData.name = name; return o; };
  const scene = new THREE.Group(), lods = new THREE.Group(), body = mesh(8, 'body'), far = mesh(2, 'body__lod1');
  lods.name = 'lods'; far.userData = { name: 'body__lod1', lodOf: 'body', lod: 1 };
  scene.add(body); lods.add(far);
  let disposed = false;
  far.geometry.addEventListener('dispose', () => { disposed = true; });
  const cache = new ModelCache({ load: async () => ({ scene, scenes: [scene, lods] }) });
  const a = await cache.acquire('m.glb'), b = await cache.acquire('m.glb');
  assert.equal(lodOf(a.children[0].geometry), far.geometry);
  assert.equal(lodOf(b.children[0].geometry), far.geometry, 'one LOD for every copy');
  cache.release('m.glb'); cache.release('m.glb');
  await new Promise(r => setTimeout(r, 0));
  assert.ok(disposed, 'let go with the model');
});

test('big textures become KTX2 (compressed on the graphics card); small ones stay PNG', async () => {
  const sharp = (await import('sharp')).default, { Document } = await import('@gltf-transform/core');
  const doc = new Document(); doc.createBuffer();
  const png = n => sharp({ create: { width: n, height: n, channels: 4, background: { r: 120, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const big = doc.createTexture('photo').setImage(new Uint8Array(await png(512))).setMimeType('image/png');
  const small = doc.createTexture('palette').setImage(new Uint8Array(await png(64))).setMimeType('image/png');
  doc.createMaterial('paint').setBaseColorTexture(big).setEmissiveTexture(small);
  const did = await compressTextures(doc, rules.ktx2);
  assert.equal(did.length, 1); assert.match(did[0], /^photo 512×512 → KTX2 \(ETC1S\)/);
  assert.equal(big.getMimeType(), 'image/ktx2'); assert.equal(small.getMimeType(), 'image/png');
  assert.ok(doc.getRoot().listExtensionsUsed().some(e => e.extensionName === 'KHR_texture_basisu' && e.isRequired()));
  const back = await (await modelIO()).readBinary(await (await modelIO()).writeBinary(doc));
  assert.deepEqual(back.getRoot().listTextures().find(t => t.getName() === 'photo').getSize(), [512, 512]);
});

test('the built-in convex decomposition wraps an L-shaped part snugly in more than one hull', async () => {
  const tris = [...slab([0, 0, 0], [1, 0.1, 0.1], 2), ...slab([0, 0, 0], [0.1, 1, 0.1], 2)].map(p => ({ p }));
  const c = await collisionHulls(tris, { ...rules.collision, coacd: false });
  assert.equal(c.method, 'built-in');
  assert.ok(c.hulls.length >= 2, `${c.hulls.length} hulls`);
  const total = c.volumes.reduce((a, v) => a + v, 0);
  assert.ok(total < 0.1 && total > 0.015, `${total} m³ of hulls for 0.019 m³ of part (one hull: 0.05)`);
});

test('every part that comes off in a crash has hulls the physics can make', async () => {
  const H = await harness(), { db } = await loadProject(), R = H.RAPIER;
  const parts = Object.values(db.parts).filter(p => p.detach?.detachable && p.collision);
  assert.ok(parts.length > 150, `${parts.length} parts with hulls: npm run content -- finish`);
  for (const p of parts) for (const [i, h] of p.collision.hulls.entries()) {
    assert.ok(R.ColliderDesc.convexHull(new Float32Array(h)), `${p.id}: hull ${i + 1} isn't one the physics can make`);
    assert.ok(p.collision.volumes[i] > 0, `${p.id}: hull ${i + 1} has no volume`);
  }
});
