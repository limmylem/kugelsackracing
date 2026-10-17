// The gauge pods reading the engine (play/liveGauges.js): what each pod's gauges are for, from its name or how many it
// has; the numbers — boost with the turbo's lag (and vacuum with none), oil pressure with the revs and none with the
// engine stopped or blown, the coolant's temperature, the oil's after it; the needle on its scale; and the faces
// found in the real models (the A-pillar pod, the twin dash pod, a readout), facing the driver, as many as it has.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gaugeKinds, createGaugeModel, dialOf, needleAngle, facesFrom } from '../../play/liveGauges.js';
import { readModel } from '../../tools/content/io.mjs';

const part = id => JSON.parse(fs.readFileSync(new URL(`../../data/parts/interior/${id}.json`, import.meta.url), 'utf8'));

test('what each gauge reads: the pod\'s name says, or the usual ones for how many it has', () => {
  assert.deepEqual(gaugeKinds(part('gauge_pod'), 3), ['boost', 'oilPressure', 'water']);
  assert.deepEqual(gaugeKinds(part('gauge_pod_dash_twin'), 2), ['boost', 'oilPressure']);
  assert.deepEqual(gaugeKinds(part('readout_1_matte'), 1), ['boost']);
  assert.deepEqual(gaugeKinds(part('readout_4_carbon'), 4), ['boost', 'water', 'oilPressure', 'oilTemp']);
});

const snap = (rpm, throttle, { temp = 90, blown = false, leak = 0 } = {}) => ({ engine: { rpm, throttle, health: { condition: 100, blown } }, mechanical: { temp, boost: leak } });
const run = (G, s, seconds) => { let v; for (let t = 0; t < seconds; t += 1 / 60) v = G.update(s, 1 / 60); return { ...v }; };

test('a turbo\'s boost: builds with its lag at full throttle, vacuum off it; a leak loses its share; none with no turbo', () => {
  const spec = { engine: { redlineRpm: 7000 }, turbo: { boost: [[2000, 0.2], [3500, 1.0], [7000, 0.9]] } };
  const G = createGaugeModel(spec);
  run(G, snap(900, 0), 2);
  assert.ok(G.state.boost < -0.5, `idling: vacuum (${G.state.boost.toFixed(2)})`);
  const early = run(G, snap(4000, 1), 0.15).boost, later = run(G, snap(4000, 1), 2).boost;
  assert.ok(early < 0.7 && later > 0.95, `spooling: ${early.toFixed(2)} → ${later.toFixed(2)} bar`);
  assert.ok(run(G, snap(4000, 0), 0.4).boost < -0.3, 'off the throttle: back to vacuum quickly');
  assert.ok(run(G, snap(4000, 1, { leak: 0.5 }), 3).boost < 0.55, 'half its boost leaking');
  const N = createGaugeModel({ engine: { redlineRpm: 7000 } });
  assert.ok(Math.abs(run(N, snap(5000, 1), 2).boost) < 0.05, 'no turbo, full throttle: about nothing');
  assert.equal(G.peakBoost, 1.0);
});

test('oil pressure with the revs, none stopped or blown; the coolant as the cooling model has it; the oil after it', () => {
  const G = createGaugeModel({ engine: { redlineRpm: 7000 } });
  const idle = run(G, snap(900, 0), 2).oilPressure, high = run(G, snap(6000, 1), 2).oilPressure;
  assert.ok(idle > 1 && idle < 2.5 && high > 5, `${idle.toFixed(1)} → ${high.toFixed(1)} bar`);
  assert.ok(run(G, snap(0, 0), 2).oilPressure < 0.1, 'stopped');
  assert.ok(run(G, snap(3000, 1, { blown: true }), 2).oilPressure < 0.1, 'blown');
  assert.ok(Math.abs(run(G, snap(3000, 0.5, { temp: 112 }), 10).water - 112) < 1, 'the coolant');
  const H = createGaugeModel({ engine: { redlineRpm: 7000 } });
  const oil0 = run(H, snap(6500, 1, { temp: 95 }), 1).oilTemp, oil1 = run(H, snap(6500, 1, { temp: 95 }), 120).oilTemp;
  assert.ok(oil1 > oil0 + 10 && oil1 > 110, `the oil warms after it, with the load: ${oil0.toFixed(0)} → ${oil1.toFixed(0)} °C`);
});

test('the needle on its scale: from bottom left round to bottom right, held at the ends; imperial in psi and °F', () => {
  const d = dialOf('water');
  assert.ok(Math.abs(needleAngle(d, 40) + 135 * Math.PI / 180) < 1e-9 && Math.abs(needleAngle(d, 130) - 135 * Math.PI / 180) < 1e-9 && Math.abs(needleAngle(d, 85)) < 1e-9);
  assert.equal(needleAngle(d, 500), needleAngle(d, 130));
  const p = dialOf('oilPressure', { imperial: true });
  assert.equal(p.unit, 'psi'); assert.ok(Math.abs(p.of(3) - 43.5) < 0.1);
  assert.equal(dialOf('water', { imperial: true }).unit, '°F');
  assert.equal(dialOf('boost', { peakBoost: 1.4 }).max, 1.5);
});

// the model's pieces, as the game sees them (its node's place applied; gltf-transform undoes the quantization)
async function pieces(file) {
  const doc = await readModel(file), out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), pts = [];
      for (let i = 0; i < P.getCount(); i++) { const [x, y, z] = P.getElement(i, []); pts.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]); }
      out.push({ points: pts, count: P.getCount() });
    }
  }
  return out;
}
test('the faces in the real models: one dial a gauge, the size of its face, facing the driver (−z), side by side', async () => {
  for (const [file, n] of [['assets/parts/interior/gauge_pod.glb', 3], ['assets/parts/interior/gauge_pod_dash_twin.glb', 2], ['assets/parts/interior/readout/readout_1/starter_car.glb', 1], ['assets/parts/interior/readout/readout_4/starter_car.glb', 4]]) {
    if (!fs.existsSync(file)) continue;
    const faces = facesFrom(await pieces(file));
    assert.equal(faces.length, n, file);
    for (const f of faces) {
      assert.ok(f.normal[2] < -0.95, `${file}: facing −z (${f.normal.map(x => x.toFixed(2))})`);
      assert.ok(f.radius > 0.015 && f.radius < 0.03, `${file}: radius ${f.radius.toFixed(4)}`);
      assert.ok(Math.abs(f.up[1]) > 0.9, 'its top up');
    }
    const c = faces.map(f => f.centre);
    for (let i = 0; i + 1 < c.length; i++) assert.ok(Math.hypot(c[i][0] - c[i + 1][0], c[i][1] - c[i + 1][1]) > 0.05, `${file}: the dials apart`);
  }
});
