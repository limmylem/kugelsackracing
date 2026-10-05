// Dressed tracks (Phase 5 Step 2), the quick checks (npm run test:unit; the big runs: npm run test:dress
// and test:dress-drive): version-2 track codes (the theme, a pit lane, sausage kerbs, the dressing's
// variant) and version 1's unchanged; the dressing the same every time and from its code, another variant
// or theme the same layout; every preset and theme dressed passing every check, measured again from the
// output (track/validateDress.js — itself shown to catch a broken dressing); the built world: the barriers'
// colliders the pieces drawn, the kerbs' collider the kerbs, the surfaces where the dressing put them;
// the start lights following the countdown; version 2's pinned tracks unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encode, decode, normalise, THEMES } from '../../track/code.js';
import { generateTrack } from '../../track/generate.js';
import { dressTrack, RUNOFF } from '../../track/dress.js';
import { buildTrack, trackWorld } from '../../track/build.js';
import { barrierRuns } from '../../track/build2.js';
import { checkDressing } from '../../track/validateDress.js';
import { trackShapes, surfaceMap } from '../../physics/track.js';
import { barrierBoxes } from '../../map/build/format/barriers.js';
import { startLights } from '../../track/lights.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const cfg = json('data/tracks.json'), P = id => cfg.presets.find(p => p.id === id).params;

test('version-2 codes: the theme, pit lane, sausage kerbs and dressing variant round-trip; version 1\'s codes are as they were', () => {
  for (const theme of THEMES) for (const [pitLane, sausages, dressing] of [[true, false, 0], [false, true, 37], [true, true, 63]]) {
    const params = { ...P('mixed_gp'), theme, pitLane, sausages, dressing }, code = encode({ version: 2, seed: 99, params }), d = decode(code);
    assert.equal(d.version, 2); assert.equal(d.seed, 99);
    assert.deepEqual(d.params, normalise(params, { version: 2 }));
    assert.equal(d.params.theme, theme); assert.equal(d.params.dressing, dressing);
  }
  // (auto: chosen by the seed, and held in the code as the theme it chose)
  const g = generateTrack({ seed: 5, params: { ...P('fast_flowing'), theme: 'auto' } });
  assert.ok(THEMES.includes(g.params.theme)); assert.equal(decode(g.code).params.theme, g.params.theme);
  // a version-1 code: none of version 2's parameters
  const v1 = decode(encode({ version: 1, seed: 5, params: { ...P('fast_flowing'), theme: 'desert', pitLane: true } }));
  assert.equal(v1.params.theme, undefined); assert.equal(v1.params.pitLane, undefined);
  // a sprint never has a pit lane
  assert.equal(normalise({ type: 'p2p', pitLane: true }).pitLane, false);
});

test('the same code: the same dressing; another variant or theme: the same layout, another dressing', () => {
  const g = generateTrack({ seed: 21, params: { ...P('high_speed'), theme: 'countryside' } });
  const a = dressTrack(g, cfg), b = dressTrack(g, cfg), c = dressTrack(generateTrack({ code: g.code }), cfg);
  assert.equal(a.hash, b.hash); assert.equal(a.hash, c.hash);
  const g2 = generateTrack({ seed: 21, params: { ...P('high_speed'), theme: 'countryside', dressing: 1 } });
  assert.equal(g2.hash, g.hash, 'redressing keeps the layout');
  assert.notEqual(dressTrack(g2, cfg).hash, a.hash, 'another variant: another dressing');
  const g3 = generateTrack({ seed: 21, params: { ...P('high_speed'), theme: 'desert' } });
  assert.equal(g3.hash, g.hash, 'another theme keeps the layout');
  assert.notEqual(dressTrack(g3, cfg).hash, a.hash);
});

test('every preset and theme dressed: every check passes, measured again from the output', () => {
  let k = 0;
  for (const pr of cfg.presets) for (const theme of [THEMES[k % THEMES.length], THEMES[(k + 3) % THEMES.length]]) {
    k++;
    const g = generateTrack({ seed: 300 + k, params: { ...pr.params, theme } });
    assert.ok(g.ok, `${pr.id} ${theme}: ${g.error}`);
    const plan = dressTrack(g, cfg), { runs } = barrierRuns(plan, g.track, cfg);
    assert.deepEqual(checkDressing(g.track, plan, { runs }), [], `${pr.id} ${theme} ${g.code}`);
    assert.ok(plan.kerbs.length > 0 && plan.corners.length > 0);
    assert.ok(plan.objects.some(o => o.k === 'gantry'), 'a start gantry');
    if (pr.params.pitLane) assert.ok(plan.pit, `${pr.id}: a pit lane`);
  }
});

test('the checker catches a broken dressing: something on the run-off, a gap in a barrier, a kerb on the wrong side, a jagged barrier', () => {
  const g = generateTrack({ seed: 4, params: { ...P('mixed_gp'), theme: 'countryside' } }), plan = dressTrack(g, cfg), { runs } = barrierRuns(plan, g.track, cfg), T = g.track;
  assert.deepEqual(checkDressing(T, plan, { runs }), []);
  const copy = () => ({ ...plan, objects: plan.objects.map(o => ({ ...o })), kerbs: plan.kerbs.map(k => ({ ...k })), runoff: { L: plan.runoff.L.slice(), R: plan.runoff.R.slice() } });
  // a tree on the run-off
  { const p = copy(), t = p.objects.find(o => o.k === 'tree'), i = 50; Object.assign(t, { x: T.x[i] + (T.z[i + 1] - T.z[i - 1]) * 2, z: T.z[i] - (T.x[i + 1] - T.x[i - 1]) * 2 }); assert.ok(checkDressing(T, p, { runs }).some(x => /inside the barriers/.test(x))); }
  // a grandstand's corner over the barrier
  { const p = copy(), s = p.objects.find(o => o.k === 'grandstand'); s.x += s.fx * (s.deep / 2 + 7); s.z += s.fz * (s.deep / 2 + 7); assert.ok(checkDressing(T, p, { runs }).some(x => /grandstand/.test(x))); }
  // a piece of barrier gone
  { const r = runs.map(r => ({ ...r })), k = r.findIndex(x => x.side === 1); r[k] = { ...r[k], pieces: Float32Array.from([...r[k].pieces.slice(0, 7 * 3), ...r[k].pieces.slice(7 * 4)]) }; assert.ok(checkDressing(T, plan, { runs: r }).some(x => /gap/.test(x))); }
  // a kerb on the wrong side
  { const p = copy(); p.kerbs[0].side = -p.kerbs[0].side; assert.ok(checkDressing(T, p, { runs }).some(x => /wrong side/.test(x))); }
  // the barrier jumping out
  { const p = copy(); p.runoff.L[Math.floor(T.n / 2)] += 12; assert.ok(checkDressing(T, p, { runs }).some(x => /suddenly/.test(x))); }
});

test('the dressed world: the barriers\' colliders are the pieces drawn, the kerbs\' collider the kerbs; the surfaces where the dressing put them', () => {
  const g = generateTrack({ seed: 12, params: { ...P('mixed_gp'), theme: 'countryside', sausages: true } }), d = buildTrack(g, cfg), w = trackWorld(d), shapes = trackShapes(w);
  // every barrier piece a box (Map v3's chained colliders: thick, taller than drawn, overlapping its neighbours)
  const boxes = shapes.filter(s => s.barrier), want = d.barriers.runs.reduce((a, r) => a + barrierBoxes(r.type, r.pieces, d.barriers.cfg, 7).length, 0);
  assert.equal(boxes.length, want);
  for (const b of boxes.slice(0, 50)) assert.ok(b.halfExtents[2] * 2 >= d.barriers.cfg.minThickness - 1e-6 && b.halfExtents[1] * 2 >= 1.2);
  assert.ok(boxes.some(b => b.barrier === 'tyres' && b.material === 'tyres' && b.restitution === 0));
  const kerbShape = shapes.find(s => s.name === 'kerbs');
  assert.equal(kerbShape.positions, d.kerbs.positions); assert.equal(kerbShape.indices, d.kerbs.indices);
  // the surfaces: on a kerb, kerb; in the run-off, what the dressing says; on the road, tarmac
  const S = surfaceMap(w), C = d.centre, n = C.x.length, W = d.width / 2, Dr = d.dress;
  const left = i => { const a = (i - 1 + n) % n, b = (i + 1) % n, dx = C.x[b] - C.x[a], dz = C.z[b] - C.z[a], m = Math.hypot(dx, dz); return [dz / m, -dx / m]; };
  const at = (i, u) => { const [lx, lz] = left(i); return S.at(C.x[i] + lx * u, C.z[i] + lz * u).name; };
  const flat = Dr.kerbs.find(k => k.type === 'flat' && k.len > 8), ki = (flat.from + Math.floor(flat.len / 2)) % n;
  assert.equal(at(ki, flat.side * (W + 0.6)), 'kerb');
  assert.equal(at(ki, 0), 'tarmac');
  let checked = 0;
  for (let i = 10; i < n; i += 97) for (const side of [1, -1]) {
    const o = (side > 0 ? Dr.runoff.L : Dr.runoff.R)[i], want = RUNOFF[(side > 0 ? Dr.surface.L : Dr.surface.R)[i]];
    if (o - W < 6) continue;
    assert.equal(at(i, side * (W + (o - W) * 0.6)), want, `run-off at ${i}`); checked++;
  }
  assert.ok(checked > 3);
  // sausage kerbs at chicanes (when asked for), raised
  if (Dr.kerbs.some(k => k.type === 'sausage')) { const k = Dr.kerbs.find(k => k.type === 'sausage'), i = (k.from + Math.floor(k.len / 2)) % n; assert.equal(at(i, k.side * (W + 1.5)), 'sausage'); }
  // the gravel's plough and the kerb's rumble are there for the physics and the sound
  assert.ok(cfg.surfaces.gravel.plough > 0 && cfg.surfaces.gravel.rollingResistance > cfg.surfaces.gravel.grip * 0.6 && cfg.surfaces.kerb.rumble > 0);
});

test('the start lights follow the countdown: five reds one after another, all out at GO (the greens a moment)', () => {
  assert.deepEqual(startLights(), { red: 0, green: false });
  const reds = [3, 2.5, 1.9, 1.3, 0.7, 0.1].map(left => startLights({ phase: 'countdown', left, total: 3 }).red);
  assert.deepEqual(reds, [1, 1, 2, 3, 4, 5]);
  assert.deepEqual(startLights({ phase: 'go', since: 0.5 }), { red: 0, green: true });
  assert.deepEqual(startLights({ phase: 'go', since: 10 }), { red: 0, green: false });
});

test('version 2\'s pinned tracks: the same layout and dressing as when it was released', () => {
  const F = json('tests/fixtures/tracks-v2.json');
  for (const t of F.tracks) {
    const g = generateTrack({ code: t.code });
    assert.equal(g.hash, t.hash, `${t.preset} seed ${t.seed}: version 2's layout has changed`);
    assert.equal(dressTrack(g, cfg).hash, t.dressHash, `${t.preset} seed ${t.seed} (${t.theme}): version 2's dressing has changed`);
  }
});
