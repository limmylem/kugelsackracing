// Generated tracks (Phase 5 Step 1), the quick checks (npm run test:unit; the big runs are npm run
// test:tracks and test:track-drive): the deterministic arithmetic and random numbers, track codes, the
// same track every time, version 1's pinned tracks unchanged, every preset's tracks passing every check
// (measured again from the output, by a checker that's shown to catch broken tracks), and the world
// built from a track — its course in the Phase 4 route format, its collider the road it's drawn as.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rng, sin, cos, seedOf, mix } from '../../track/det.js';
import { encode, decode, normalise } from '../../track/code.js';
import { generateTrack, LATEST, VERSIONS } from '../../track/generate.js';
import { LIMITS } from '../../track/gen/v1.js';
import { checkTrack } from '../../track/validate.js';
import { buildTrack, trackWorld, trackProjection } from '../../track/build.js';
import { viewCourse } from '../../route/model.js';
import { trackShapes, surfaceMap, terrainOf } from '../../physics/track.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const cfg = json('data/tracks.json');

test('deterministic arithmetic: its sine and cosine match the platform\'s to the last bits, and its random numbers never change', () => {
  for (let k = 0; k < 4000; k++) {
    const x = (k - 2000) * 0.0377;
    assert.ok(Math.abs(sin(x) - Math.sin(x)) < 4e-16 * Math.max(1, Math.abs(x)), `sin ${x}`);
    assert.ok(Math.abs(cos(x) - Math.cos(x)) < 4e-16 * Math.max(1, Math.abs(x)), `cos ${x}`);
  }
  // (xoshiro128** from splitmix32, and the sine's bits: these exact numbers for ever — the tracks depend on them)
  const r = rng(12345);
  assert.deepEqual([r.next(), r.next(), r.next(), r.next()], [518667457, 440444462, 4232892992, 3757857622]);
  assert.deepEqual([sin(1), cos(2.5), sin(-100.25)], [0.8414709848078965, -0.8011436155469337, 0.27728285645485135]);
  assert.equal(seedOf('42'), 42); assert.equal(seedOf(42), 42); assert.equal(seedOf('monza'), seedOf('monza')); assert.notEqual(seedOf('monza'), seedOf('Monza'));
  assert.notEqual(mix(1, 0), mix(1, 1));
  const f = rng(7); for (let i = 0; i < 1000; i++) { const v = f.float(); assert.ok(v >= 0 && v < 1); }
});

test('track codes: every parameter and the seed round-trip; typos are caught; the parameters are what a code can hold', () => {
  for (const p of cfg.presets) for (const seed of [0, 1, 4294967295, 123456789]) {
    const code = encode({ version: 1, seed, params: p.params }), d = decode(code);
    assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{1,5}){5}$/);
    assert.equal(d.version, 1); assert.equal(d.seed, seed); assert.deepEqual(d.params, normalise(p.params, { version: 1 }));
    assert.equal(decode(code.toLowerCase().replace(/-/g, ' ')).seed, seed, 'case and separators don\'t matter');
    // one character changed: refused
    const k = code.indexOf('-') - 1, typo = code.slice(0, k) + (code[k] === '0' ? '1' : '0') + code.slice(k + 1);
    assert.throws(() => decode(typo), /typo|isn't a track code/);
  }
  assert.deepEqual(normalise(normalise({ type: 'p2p', lengthKm: [3.333, 3.37], width: 9.3, climb: 12.7 })), normalise({ type: 'p2p', lengthKm: [3.333, 3.37], width: 9.3, climb: 12.7 }));
  assert.throws(() => decode('nonsense'));
});

test('the same seed, parameters and version: the same track — and version 1\'s pinned tracks unchanged', () => {
  const pinned = json('tests/fixtures/tracks-v1.json');
  assert.ok(VERSIONS.includes(1) && LATEST >= 1);
  for (const t of pinned.tracks) {
    const g = generateTrack({ code: t.code });
    assert.equal(g.hash, t.hash, `${t.preset} seed ${t.seed}: version 1 has changed`);
    assert.equal(g.track.length, t.length);
  }
  for (let seed = 0; seed < 40; seed++) {
    const p = cfg.presets[seed % cfg.presets.length].params, a = generateTrack({ seed, params: p }), b = generateTrack({ seed, params: p });
    assert.equal(a.hash, b.hash); assert.equal(a.code, b.code);
    assert.equal(generateTrack({ code: a.code }).hash, a.hash, 'from its code: the same');
  }
});

test('every preset: a valid track every time, passing every check measured again from the output', () => {
  const attempts = {};
  for (const p of cfg.presets) for (let seed = 100; seed < 130; seed++) {
    const g = generateTrack({ seed, params: p.params });
    assert.ok(g.ok, `${p.id} seed ${seed}: ${g.error}`);
    assert.deepEqual(checkTrack(g.track, g.params, LIMITS), [], `${p.id} seed ${seed}`);
    attempts[p.id] = (attempts[p.id] ?? 0) + g.attempts.length;
    // every failed attempt says why
    for (const a of g.attempts.slice(0, -1)) assert.ok(a.reason, 'a reason for each rejected attempt');
  }
  for (const [id, n] of Object.entries(attempts)) assert.ok(n / 30 < 12, `${id}: ${n / 30} attempts a track`);
});

test('the checker catches broken tracks: a kink, a corner too tight, a gap, a crossing, too steep, unasked-for banking, a sudden twist', () => {
  const g = generateTrack({ seed: 3, params: cfg.presets[1].params }), t = g.track, clone = () => ({ ...t, x: t.x.slice(), z: t.z.slice(), h: t.h.slice(), bank: t.bank.slice() });
  const at = (f, what) => { const b = clone(); f(b); const p = checkTrack(b, g.params, LIMITS); assert.ok(p.length, `${what} not caught`); return p; };
  at(b => { for (let i = 0; i < 30; i++) b.x[i] += 0.4 * i; }, 'a gap / kink at the start');
  at(b => { const i = Math.floor(b.n / 3); b.x[i] += 3; }, 'a sudden jog (too tight)');
  at(b => { const i = Math.floor(b.n / 2); for (let k = 0; k < 40; k++) { b.x[i + k] = b.x[0]; b.z[i + k] = b.z[0] + k; } }, 'crossing itself');
  at(b => { for (let i = 0; i < b.n; i++) b.h[i] = i * 0.5; }, 'too steep');
  const flat = generateTrack({ seed: 3, params: { ...cfg.presets[0].params, banking: 0 } });
  const p = checkTrack({ ...flat.track, bank: flat.track.bank.map((v, i) => i === 10 ? 2 : v) }, flat.params, LIMITS);
  assert.ok(p.some(x => /banking/.test(x)));
  // banking flipping from one way to the other within a few metres: too sudden a twist
  const banked = generateTrack({ seed: 3, params: cfg.presets.find(q => q.id === 'high_speed').params }), bt = banked.track;
  assert.deepEqual(checkTrack(bt, banked.params, LIMITS), []);
  const twist = checkTrack({ ...bt, bank: bt.bank.map((v, i) => i > 100 && i < 104 ? (i % 2 ? 6 : -6) : v) }, banked.params, LIMITS);
  assert.ok(twist.some(x => /twists/.test(x)), 'a sudden twist not caught');
});

test('the world from a track: its course in the route format, its collider and its drawing one mesh, its surfaces painted', () => {
  // (version 1's undressed world; version 2's dressed one: tests/unit/trackDress.test.mjs)
  const g = generateTrack({ seed: 9, params: cfg.presets[0].params, version: 1 }), d = buildTrack(g, cfg);
  // the course: as a real-world route's, read back the same way
  const c = viewCourse(d.course, trackProjection);
  assert.equal(c.loop, true);
  assert.ok(Math.abs(c.length - d.length) < 3, `${c.length} vs ${d.length}`);
  assert.ok(c.grid.slots.length === 8 && c.grid.problems.filter(p => p.level === 'error').length === 0, JSON.stringify(c.grid.problems));
  assert.ok(c.gates.length >= 3, `${c.gates.length} checkpoints`);
  assert.ok(d.course.stats.estimatedTime > 30 && d.course.racing?.d, 'its stats and racing line');
  assert.equal(d.course.generated.code, g.code);
  // the course's line where the road is: every point within a few cm of the centreline it was made from
  for (let i = 0; i < c.line.length; i += 25) { const q = c.line[i]; let best = Infinity; for (let k = 0; k < d.centre.x.length; k++) best = Math.min(best, Math.hypot(d.centre.x[k] - q.x, d.centre.z[k] - q.z)); assert.ok(best < 0.3, `${best}`); }
  // what's simulated is what's drawn: the trimesh shape is the build's own arrays
  const w = trackWorld(d), shapes = trackShapes(w), road = shapes.find(s => s.kind === 'trimesh'), ground = shapes.find(s => s.kind === 'heightfield');
  assert.equal(road.positions, d.road.positions); assert.equal(road.indices, d.road.indices);
  assert.ok(ground && terrainOf(w).heights === d.terrain.heights);
  // every road triangle faces up
  const P = d.road.positions, I = d.road.indices;
  for (let k = 0; k < I.length; k += 3) { const a = I[k] * 3, b = I[k + 1] * 3, e = I[k + 2] * 3; const ux = P[b] - P[a], uz = P[b + 2] - P[a + 2], vx = P[e] - P[a], vz = P[e + 2] - P[a + 2]; assert.ok(uz * vx - ux * vz >= -1e-6); }
  // the ground under the road is below it, and meets its edge beyond the verges
  const T = terrainOf(w);
  for (let i = 0; i < d.centre.x.length; i += 40) {
    assert.ok(T.heightAt(d.centre.x[i], d.centre.z[i]) < d.centre.h[i] - 0.1, 'ground under the road');
  }
  // surfaces: tarmac on the road, the verge beside it, grass beyond
  const S = surfaceMap(w), i0 = 50, tx = d.centre.x[i0 + 1] - d.centre.x[i0 - 1], tz = d.centre.z[i0 + 1] - d.centre.z[i0 - 1], m = Math.hypot(tx, tz), lx = tz / m, lz = -tx / m;
  const at = u => S.at(d.centre.x[i0] + lx * u, d.centre.z[i0] + lz * u).name;
  assert.equal(at(0), 'tarmac'); assert.equal(at(d.width / 2 + 2.5), 'verge'); assert.equal(at(d.width / 2 + d.verge + 6), 'grass');
});
