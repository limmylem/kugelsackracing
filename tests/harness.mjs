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
