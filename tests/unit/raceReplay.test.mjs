// TV cameras round a generated track and the race replay (Phase 5 Step 4): cameras from the code (the same
// for everyone), on the outsides of corners, on the grandstands and beside the straights, covering all of
// it; a race recorded car by car (the Phase 4 recording format) and played back — the cars where they
// were, the TV view cutting from camera to camera as the car goes round and zoomed on it, chase and in-car
// views, play / pause / speed / skip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateTrack } from '../../track/generate.js';
import { buildTrack, heightAtOf } from '../../track/build.js';
import { tvCameras, cameraFor, nearestCamera, zoom } from '../../track/cameras.js';
import { createRaceRecording, createRacePlayer, SPEEDS } from '../../race/raceReplay.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../../data/tracks.json', import.meta.url), 'utf8'));
const built = (id, seed) => buildTrack(generateTrack({ seed, params: cfg.presets.find(p => p.id === id).params }), cfg);
const data = built('mixed_gp', 4);

test('TV cameras: from the code, every kind, all of the track covered, cutting as a car goes round', () => {
  const C = tvCameras(data), again = tvCameras(built('mixed_gp', 4));
  assert.deepEqual(C, again, 'the same cameras for everyone');
  assert.ok(C.some(c => c.kind === 'corner') && C.some(c => c.kind === 'grandstand') && C.some(c => c.kind === 'straight'), C.map(c => c.kind).join(' '));
  const n = data.centre.x.length;
  // every point of the lap has a camera; each camera off the road and above it
  let prev = null, cuts = 0;
  for (let i = 0; i < n; i++) {
    const c = cameraFor(C, data, i, prev);
    assert.ok(c, `no camera at point ${i}`);
    if (c !== prev) cuts++;
    prev = c;
  }
  assert.ok(cuts >= C.length * 0.6 && cuts <= C.length * 2.5, `${cuts} cuts round a lap of ${C.length} cameras`);
  for (const c of C) {
    let d = Infinity; for (let i = 0; i < n; i++) d = Math.min(d, Math.hypot(c.x - data.centre.x[i], c.z - data.centre.z[i]));
    assert.ok(d > data.width / 2 + 2, `camera ${c.id} (${c.kind}) ${d.toFixed(1)} m from the centreline: on the road`);
    assert.ok(c.y > data.centre.h[c.i] + 2, `camera ${c.id} not above the track`);
  }
  // a crash: the nearest camera; the zoom tighter the further it is
  const k = C[3], near = nearestCamera(C, k.x + 5, k.y, k.z + 5);
  assert.equal(near.id, k.id);
  assert.equal(nearestCamera(C, 1e6, 0, 1e6), null);
  assert.ok(zoom(20) > zoom(80) && zoom(80) > zoom(300));
  // a sprint: covered too
  const S = built('coastal_sprint', 2), CS = tvCameras(S);
  for (let i = 0; i < S.centre.x.length; i += 7) assert.ok(cameraFor(CS, S, i, null));
  // a mountain's: every camera above the ground where it stands (not in the hillside)
  const M = built('mountain_hillclimb', 3), T = M.terrain, ground = heightAtOf({ N: T.n, cell: T.size / T.n, half: T.size / 2, heights: T.heights });
  for (const c of tvCameras(M)) assert.ok(c.y >= ground(c.x, c.z) + 2, `camera ${c.id} (${c.kind}) ${(c.y - ground(c.x, c.z)).toFixed(1)} m above the ground`);
});

test('the race replay: every car recorded, played back where it was; TV, chase and in-car; play, pause, speed and skip', () => {
  const n = data.centre.x.length, X = data.centre.x, Z = data.centre.z, H = data.centre.h, R = createRaceRecording({ hz: 20 });
  // three cars round the centreline at different speeds (a step of 1/120 s), the second passing the first
  const at = (s, lane) => { const i = Math.floor(s / data.length * n) % n, j = (i + 1) % n, dx = X[j] - X[i], dz = Z[j] - Z[i], m = Math.hypot(dx, dz) || 1, a = Math.atan2(dx, dz) / 2; return { x: X[i] - dz / m * lane, y: H[i] + 0.5, z: Z[i] + dx / m * lane, q: [0, Math.sin(a), 0, Math.cos(a)], vx: dx / m * 40, vy: 0, vz: dz / m * 40 }; };
  const speeds = [40, 42, 38], start = [30, 10, 0];
  for (let k = 0; k <= 120 * 60; k++) {
    const t = 100 + k / 120;
    R.sample(t, speeds.map((v, id) => ({ id, name: `car ${id}`, player: id === 0, ...at(start[id] + v * (t - 100), id - 1) })));
    if (k === 120 * 20) R.note(t, 'overtake', { id: 1 });
  }
  const rec = R.finish();
  assert.equal(rec.cars.length, 3); assert.ok(Math.abs(rec.duration - 60) < 0.01);
  assert.ok(JSON.stringify(rec).length < 3 * 60 * 1200, `${JSON.stringify(rec).length} bytes for a minute of three cars`);
  const P = createRacePlayer(rec, { cameras: tvCameras(data), data });
  assert.equal(P.mode, 'tv'); assert.equal(P.focus, 0, 'the player first');
  // the cars where they were (within a sample's movement)
  P.seek(30);
  for (const id of [0, 1, 2]) { const p = P.pose(id), w = at(start[id] + speeds[id] * 30, id - 1); assert.ok(Math.hypot(p.position[0] - w.x, p.position[2] - w.z) < 2.5, `car ${id} at ${p.position} not ${w.x},${w.z}`); }
  // the TV view: a camera that sees the car, cutting as it goes; zoomed on it
  P.seek(0);
  const names = new Set();
  for (let k = 0; k < 600; k++) { P.step(0.1); const c = P.camera(); names.add(c.name + c.position.join()); const p = P.pose(0).position; assert.ok(Math.hypot(c.position[0] - p[0], c.position[2] - p[2]) < 450); assert.ok(c.fov >= 7 && c.fov <= 60); }
  assert.ok(names.size >= 6, `${names.size} cameras used in a minute`);
  // play, pause, speed, skip, the next event, the other cars and views
  P.seek(10); P.pause(); P.step(1); assert.equal(P.t, 10);
  P.play(); P.setSpeed(2); P.step(1); assert.equal(P.t, 12);
  P.faster(1); assert.equal(P.speed, 4); P.faster(-3); assert.equal(P.speed, 0.5); assert.ok(SPEEDS.includes(P.speed));
  P.skip(-100); assert.equal(P.t, 0); P.skip(1e3); assert.equal(P.t, P.end); P.step(1); assert.ok(P.paused && P.done);
  P.seek(0); const e = P.nextEvent(); assert.equal(e.type, 'overtake'); assert.ok(Math.abs(P.t - 18) < 0.01); assert.equal(P.focus, 1);
  P.cycleMode(); assert.equal(P.mode, 'chase'); const ch = P.camera(); P.cycleMode(); assert.equal(P.mode, 'incar'); const ic = P.camera(); P.cycleMode(); assert.equal(P.mode, 'tv');
  const p1 = P.pose(1).position;
  assert.ok(Math.hypot(ch.position[0] - p1[0], ch.position[2] - p1[2]) > 5 && Math.hypot(ic.position[0] - p1[0], ic.position[2] - p1[2]) < 1.5);
  P.nextCar(1); assert.equal(P.focus, 2); P.nextCar(1); assert.equal(P.focus, 0);
  // no track: no TV view (chase first)
  assert.equal(createRacePlayer(rec).mode, 'chase');
});
