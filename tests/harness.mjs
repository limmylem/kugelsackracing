// Running the Step 6 tests on builds from Node (the command-line runner, the parts report and the
// physics unit tests share this): the car and part data, the test centre, and run(spec, tests).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { TESTS, createRun } from '../physics/testSuite.js';
import { socketsFromGlb } from '../physics/sockets.js';
import { Garage, loadGarageData } from '../garage/data.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const load = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

let ready = null;
export function harness() {
  return ready ??= (async () => {
    await RAPIER.init();
    const { db, problems } = await loadGarageData(async rel => load(rel));
    const settings = load('physics/settings.json'), track = load('scenes/test_centre.json'), glbs = new Map();
    const socketsOf = spec => {
      if (!glbs.has(spec.model.file)) { const b = fs.readFileSync(path.join(root, spec.model.file)); glbs.set(spec.model.file, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
      return socketsFromGlb(glbs.get(spec.model.file), spec.model);
    };
    // run some of the Step 6 tests (ids; all of them if none) on a spec: { id: result }
    const run = (spec, ids, { onRun, pace } = {}) => {
      const out = {};
      for (const test of TESTS.filter(t => !ids || ids.includes(t.id))) {
        const r = createRun({ RAPIER, settings, spec, sockets: socketsOf(spec), track, pace }, test.id);
        onRun?.(r, test);
        while (!r.done) r.next(5000);
        out[test.id] = r.result;
      }
      return out;
    };
    return { RAPIER, db, problems, settings, track, socketsOf, run, garage: (state, carId) => new Garage(db, state, carId), TESTS };
  })();
}

// The crash test suite's context (garage/crashSuite.js): the test centre, every car stock, where each
// car's body shell, glass and lights are, and the targets (tests/targets/crash.json)
export async function crashContext() {
  const H = await harness(), { nodeBoxes } = await import('../physics/sockets.js'), boxes = new Map();
  const boxesOf = car => {
    if (!boxes.has(car.id)) { const b = fs.readFileSync(path.join(root, car.model.file)); boxes.set(car.id, nodeBoxes(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), car.model, [...(car.model.breakables ?? []).map(x => x.node), 'body_shell'])); }
    return boxes.get(car.id);
  };
  return { RAPIER: H.RAPIER, settings: H.settings, track: H.track, db: H.db, socketsOf: H.socketsOf, boxesOf, garage: carId => H.garage(null, carId), targets: load('tests/targets/crash.json') };
}

// A model as three.js objects from its real meshes, for garage/visual.js's ModelCache in Node (which
// can't decode the textures, and doesn't need to): the dent tests and the stress tests draw real cars
export async function loadRealModel(url) {
  const THREE = await import('three'), { readModel } = await import('../tools/content/io.mjs');
  const doc = await readModel(path.join(root, url)), scene = new THREE.Group(), made = new Map();
  const node = n => {
    if (made.has(n)) return made.get(n);
    const o = new THREE.Group();
    o.name = n.getName(); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); o.scale.fromArray(n.getScale());
    for (const p of n.getMesh()?.listPrimitives() ?? []) {
      const g = new THREE.BufferGeometry();
      for (const [sem, name, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]]) { const a = p.getAttribute(sem); if (a) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(a.getArray()), size)); }
      if (p.getIndices()) g.setIndex(new THREE.BufferAttribute(new Uint32Array(p.getIndices().getArray()), 1));
      o.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: p.getMaterial()?.getName() ?? '' })));
    }
    for (const c of n.listChildren()) o.add(node(c));
    made.set(n, o);
    return o;
  };
  for (const n of doc.getRoot().getDefaultScene()?.listChildren() ?? doc.getRoot().listScenes()[0].listChildren()) scene.add(node(n));
  return { scene };
}
