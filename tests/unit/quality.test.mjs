// The graphics settings (perf/quality.js; data/performance.json quality): presets and custom, the frame rate cap and
// dynamic resolution — the logic, without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { graphicsOf, withPreset, withSetting, presetOf, PRESETS, SETTINGS, createFrameCap, createDynamicResolution } from '../../perf/quality.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../../data/performance.json', import.meta.url), 'utf8')).quality;

test('every preset sets every setting (but power saver, the player\'s own), and the presets go up in detail', () => {
  for (const p of PRESETS) for (const k of SETTINGS.filter(k => k !== 'powerSaver')) assert.ok(cfg.presets[p][k] !== undefined, `${p}.${k}`);
  const order = PRESETS.map(p => cfg.presets[p]);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i].renderDistance >= order[i - 1].renderDistance);
    assert.ok(order[i].scenery >= order[i - 1].scenery);
    assert.ok(order[i].detailedCars >= order[i - 1].detailedCars);
    assert.ok(order[i].fullEngineSounds >= order[i - 1].fullEngineSounds);
    assert.ok(order[i].minResolution >= order[i - 1].minResolution);
  }
  for (const p of PRESETS) assert.ok(cfg.presets[p].minResolution <= cfg.presets[p].resolution);
});

test('nothing saved: the default preset; a preset picked: its values; one setting changed: custom; set back: the preset again', () => {
  const G0 = graphicsOf(null, cfg);
  assert.equal(G0.preset, cfg.default);
  assert.equal(G0.renderDistance, cfg.presets[cfg.default].renderDistance);
  assert.equal(G0.powerSaver, 'battery');
  let s = withPreset({}, cfg, 'low');
  assert.equal(graphicsOf(s, cfg).preset, 'low');
  assert.equal(graphicsOf(s, cfg).shadows, 'off');
  s = withSetting(s, cfg, 'shadows', 'high');
  const G = graphicsOf(s, cfg);
  assert.equal(G.preset, 'custom');
  assert.equal(G.shadows, 'high');
  assert.equal(G.renderDistance, cfg.presets.low.renderDistance, 'the rest stays as it was');
  s = withSetting(s, cfg, 'shadows', 'off');
  assert.equal(graphicsOf(s, cfg).preset, 'low', 'exactly a preset\'s values: that preset');
  // (power saver isn't part of any preset: changing it keeps the preset)
  s = withSetting(withPreset({}, cfg, 'high'), cfg, 'powerSaver', 'always');
  assert.equal(graphicsOf(s, cfg).preset, 'high');
  assert.equal(graphicsOf(s, cfg).powerSaver, 'always');
  assert.equal(graphicsOf(withPreset(s, cfg, 'ultra'), cfg).powerSaver, 'always', 'a new preset keeps power saver');
  assert.equal(presetOf(cfg.presets.ultra, cfg), 'ultra');
});

test('the frame rate cap: 60 on a 144 Hz screen draws 60 a second, 30 on a 60 Hz one every other frame, 0 every frame', () => {
  for (const [hz, fps, want] of [[144, 60, 60], [60, 30, 30], [120, 60, 60], [60, 60, 60], [60, 120, 60], [144, 0, 144]]) {
    const C = createFrameCap();
    let drawn = 0;
    for (let i = 0; i < hz * 10; i++) if (C.due(i * 1000 / hz + (i % 3) * 0.3, fps)) drawn++;
    assert.ok(Math.abs(drawn / 10 - want) <= 1.5, `${hz} Hz capped at ${fps}: ${drawn / 10} a second`);
  }
});

test('dynamic resolution: down when frames run long (not below the minimum), up again once steady, not straight back to a scale that failed', () => {
  const D = createDynamicResolution(cfg.dynamic), target = 1000 / 60;
  let t = 0;
  const run = (ms, seconds, lim) => { for (const end = t + seconds * 1000; t < end; t += ms) D.update(ms, target, t, lim); return D.scale; };
  const lim = { min: 0.6, max: 1 };
  assert.equal(run(16.6, 2, lim), 1, 'on time: full resolution');
  run(25, 3, lim);
  assert.ok(Math.abs(D.scale - 0.6) < 1e-9, `long frames for 3 s: down to the minimum (${D.scale})`);
  run(25, 5, lim);
  assert.ok(D.scale >= 0.6 - 1e-9, 'never below the minimum');
  const low = D.scale;
  run(16.6, cfg.dynamic.steady + 1, lim);
  assert.ok(D.scale > low, `steady again: up (${D.scale})`);
  // (a scale that failed a moment ago isn't tried again until `retry` s later)
  const D2 = createDynamicResolution(cfg.dynamic);
  let t2 = 0;
  const run2 = (ms, seconds) => { for (const end = t2 + seconds * 1000; t2 < end; t2 += ms) D2.update(ms, target, t2, lim); };
  run2(25, 0.6);
  const after = D2.scale;
  assert.ok(after < 1);
  run2(16.6, cfg.dynamic.steady + 0.5);
  const up1 = D2.scale;
  run2(16.6, cfg.dynamic.steady + 0.5);
  assert.ok(D2.scale <= 1 - 1e-9 || t2 > cfg.dynamic.retry * 1000, `the failed scale (1) not retried within ${cfg.dynamic.retry} s: ${up1} → ${D2.scale}`);
});

test('memory budgets: over one, the caches that can let go do, least recently used first, until it fits; what\'s in use is never touched', async () => {
  const { createMemoryBudget } = await import('../../perf/memory.js');
  const MB = 1048576;
  let kept = 120 * MB, scene = 200 * MB;
  const M = createMemoryBudget({ budgets: () => ({ textures: 100, meshes: 256, audio: 32, heap: 700 }), sources: [
    { name: 'the world', kind: 'meshes', bytes: () => scene },
    { name: 'kept models', kind: 'meshes', bytes: () => kept, evict: b => { const f = Math.min(kept, b); kept -= f; return f; } },
  ] });
  const r = M.check();
  assert.ok(kept <= 56 * MB + 1, `let go down to the budget: ${kept / MB} MB kept`);
  assert.equal(r.meshes.over, false);
  assert.equal(scene, 200 * MB, 'what\'s in use untouched');
  // (still over with nothing left to let go: said so)
  scene = 300 * MB;
  assert.equal(M.check().meshes.over, true);
  assert.equal(kept, 0);
});

test('the scene\'s memory walked a little at a time comes to the same as walked at once', async () => {
  const { createSceneMeter, sceneBytes } = await import('../../perf/memory.js'), THREE = await import('three');
  const sc = new THREE.Scene(), shared = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 1200; i++) { const g = new THREE.Group(); g.add(new THREE.Mesh(i % 3 ? shared : new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial())); sc.add(g); }
  const M = createSceneMeter(() => sc, { pause: 0 });
  let r = null, steps = 0;
  while (!(r = M.step(300)) && steps < 100) steps++;
  assert.ok(steps > 3, `walked in ${steps + 1} steps`);
  assert.deepEqual(r, sceneBytes(sc));
});
