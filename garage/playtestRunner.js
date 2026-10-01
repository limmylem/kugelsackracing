// The playtest log's Step 6 tests in the page (garage/playtest.js): the same runs as the test centre,
// a slice at a time between frames, so the game carries on while they run in the background.
//
//   await runPlaytestTests(spec, ['zeroTo100', 'braking', 'skidpad', 'lap'])  → { id: value | null }

import { createRun } from '../physics/testSuite.js';
import { socketsFromGlb } from '../physics/sockets.js';

let ready = null;
function setup() {
  return ready ??= (async () => {
    const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
    await RAPIER.init();
    const get = f => fetch(f).then(r => r.json());
    const [settings, track] = await Promise.all([get('physics/settings.json'), get('scenes/test_centre.json')]);
    return { RAPIER, settings, track, glbs: new Map() };
  })();
}

export async function runPlaytestTests(spec, ids) {
  const s = await setup();
  if (!s.glbs.has(spec.model.file)) s.glbs.set(spec.model.file, await (await fetch(spec.model.file)).arrayBuffer());
  const sockets = socketsFromGlb(s.glbs.get(spec.model.file), spec.model), out = {};
  for (const id of ids) {
    const run = createRun({ RAPIER: s.RAPIER, settings: s.settings, spec, sockets, track: s.track }, id);
    while (!run.done) { run.next(400); await new Promise(r => setTimeout(r, 0)); }
    out[id] = run.result.value == null ? null : +run.result.value.toFixed(id === 'skidpad' ? 3 : 2);
  }
  return out;
}
