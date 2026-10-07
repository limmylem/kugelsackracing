// Multiplayer's protocol and smoothing (Phase 7 Step 1; docs/MULTIPLAYER.md), without a server: the binary messages
// (sizes, precision, round trips, bad input refused), the shared world frame, the clock's sync, the network simulator,
// and how smoothly another car is shown through the whole path at the target network conditions and much worse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NET } from '../../net/settings.js';
import { PROTOCOL, F, ALL, CODES, messageFor } from '../../net/protocol.js';
import { quantise, dequantise, packQuat, unpackQuat, maskFor, mergeState, encodeStateMessage, decodeStateMessage, encodeSnapshot, decodeSnapshot, encodeValue, decodeValue } from '../../net/codec.js';
import { createFrame } from '../../net/frame.js';
import { createClock } from '../../net/clock.js';
import { createLink, rng } from '../../net/netsim.js';
import { simulateRemote } from '../../net/simulate.js';
import { createRouteDriver, testLoop } from '../../net/bot.js';

const car = (over = {}) => ({
  tick: 12345, time: 67890, pos: [123456.789, 42.125, -98765.4321], rot: [0.1, 0.7, -0.05, 0.7], vel: [31.25, -0.4, 12.5], ang: [0.01, 0.8, -0.02],
  steer: -0.35, throttle: 0.8, brake: 0, gear: 4, rpm: 6120,
  wheels: [0, 1, 2, 3].map(i => ({ omega: 95.5 + i, length: 0.21 + i * 0.004, slip: 0.12 * i, grounded: i !== 2 })), flags: 1, ...over,
});

test('a car state: 63 bytes complete, 9 when nothing changed, and back the same', () => {
  const q = quantise(car()), full = encodeStateMessage(q, ALL);
  assert.equal(full.length, 63);
  assert.equal(encodeStateMessage(q, maskFor(q, q)).length, 9);
  const back = decodeStateMessage(full);
  assert.deepEqual(back.q, q);
  assert.equal(back.mask, ALL);
});

test('quantising is precise enough for racing: 1 mm, 0.01°, 1 cm/s', () => {
  const s = car(), d = dequantise(quantise(s));
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(d.pos[k] - s.pos[k]) <= 0.0005, `position ${k}`);
  const l = Math.hypot(...s.rot), qn = s.rot.map(x => x / l), dot = Math.abs(qn.reduce((a, x, i) => a + x * d.rot[i], 0));
  assert.ok(2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI < 0.01, 'rotation within 0.01°');
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(d.vel[k] - s.vel[k]) <= 0.005);
  assert.equal(d.gear, 4); assert.equal(d.rpm, 6120); assert.equal(d.flags, 1);
  assert.deepEqual(d.wheels.map(w => w.grounded), [true, true, false, true]);
  // every rotation, including the awkward ones (a part near ±1, the other sign)
  const R = rng(3);
  for (let i = 0; i < 2000; i++) {
    let q = [R() - 0.5, R() - 0.5, R() - 0.5, R() - 0.5]; const n = Math.hypot(...q); q = q.map(x => x / n);
    const u = unpackQuat(packQuat(q)), c = Math.abs(q.reduce((a, x, k) => a + x * u[k], 0));
    assert.ok(2 * Math.acos(Math.min(1, c)) < 3e-4, `rotation ${i}`);
  }
});

test('only what changed is sent, and merging it onto the last full state gives the full state', () => {
  const a = quantise(car()), b = quantise(car({ pos: [123457.789, 42.125, -98765.4321], rpm: 6200, tick: 12346, time: 67923 }));
  const m = maskFor(b, a, true);
  assert.equal(m, F.POS | F.ENGINE);
  assert.equal(maskFor(b, a, false), F.POS, 'wheels and engine wait for a detail state');
  const sent = decodeStateMessage(encodeStateMessage(b, m));
  assert.deepEqual(mergeState(a, sent.q, sent.mask), b);
  assert.equal(maskFor(b, null), ALL, 'no base: everything');
});

test('the server\'s batches and plain values round-trip; bad messages are refused, not crashed on', () => {
  const q = quantise(car()), snap = decodeSnapshot(encodeSnapshot(1234, [{ id: 7, q, mask: ALL }, { id: 9, q, mask: F.POS }]));
  assert.equal(snap.time, 1234); assert.equal(snap.cars.length, 2); assert.deepEqual(snap.cars[0].q, q); assert.equal(snap.cars[1].mask, F.POS);
  const v = { kind: 'damage', n: -5, big: 2 ** 40, f: 0.25, ok: true, none: null, list: [1, 'two', { three: 3 }], bytes: new Uint8Array([1, 2, 3]) };
  assert.deepEqual(decodeValue(encodeValue(v)), v);
  for (const bad of [new Uint8Array([]), new Uint8Array([99]), new Uint8Array([8, 255, 255, 255, 255, 15]), new Uint8Array([6, 50, 1])]) assert.throws(() => decodeValue(bad));
  assert.throws(() => decodeStateMessage(new Uint8Array([1, 2, 3])));
  assert.throws(() => decodeValue(encodeValue({ __proto__: null, ...JSON.parse('{"__proto__": {"x": 1}}') })), 'no prototype keys');
});

test('the shared world frame: players with different floating origins agree to the millimetre', () => {
  const T = 1024, mine = createFrame(() => [3 * T, 7 * T]), theirs = createFrame(() => [-2 * T, 11 * T]);
  const world = [3333.125, 12.5, 7777.875];
  // each has the same car in its own physics frame; on the wire (quantised) they're identical
  const a = mine.toSim(world), b = theirs.toSim(world);
  const qa = quantise(car({ pos: mine.toWorld(a) })), qb = quantise(car({ pos: theirs.toWorld(b) }));
  assert.deepEqual(qa.pos, qb.pos);
  assert.deepEqual(mine.toSim(dequantise(qa).pos), a);
});

test('the clock: within a few ms of the server, from noisy pings', () => {
  for (const [lat, jit] of [[20, 5], [150, 30], [300, 80]]) {
    const R = rng(lat), offset = 123456.789;            // the server's clock is this far ahead of ours
    let t = 0;
    const C = createClock({ now: () => t });
    for (let i = 0; i < 60; i++) {
      const up = lat + jit * (R() + R() - 1) * 1.7, down = lat + jit * (R() + R() - 1) * 1.7;
      const sent = t; t += Math.max(0, up); const server = t + offset; t += Math.max(0, down);
      C.sample(sent, server, t); t += 1000;
    }
    const err = Math.abs(C.serverNow() - (t + offset));
    assert.ok(err <= (jit <= 30 ? NET.targets.timeSyncMs : 15), `${lat}/${jit}: off by ${err.toFixed(2)} ms`);
  }
});

test('the network simulator: a stream keeps its order and loses nothing; datagrams may be lost', () => {
  let now = 0; const q = [];
  const sched = (f, ms) => { const h = { at: now + ms, f }; q.push(h); return h; };
  const run = () => { q.sort((a, b) => a.at - b.at); while (q.length) { const h = q.shift(); now = h.at; h.f(); } };
  const got = [], L = createLink({ latencyMs: 100, jitterMs: 40, loss: 0.2, mode: 'stream', now: () => now, schedule: sched, cancel: () => {} });
  for (let i = 0; i < 500; i++) { now = i * 10; L.send(x => got.push(x), i); }
  run();
  assert.equal(got.length, 500); assert.deepEqual(got, [...got].sort((a, b) => a - b));
  assert.ok(L.stats.resent > 50, 'losses were resent (late)');
  const got2 = [], D = createLink({ latencyMs: 100, jitterMs: 40, loss: 0.2, mode: 'datagram', now: () => now, schedule: sched, cancel: () => {} });
  for (let i = 0; i < 500; i++) { now = 10000 + i * 10; D.send(x => got2.push(x), i); }
  run();
  assert.ok(got2.length < 450 && got2.length > 340, `${got2.length} of 500 arrived`);
});

test('another car, smooth at the target network (150 ms, 30 ms jitter, 5% loss) — WebSockets and datagrams', () => {
  const T = NET.targets.smooth, c = { latencyMs: T.latencyMs, jitterMs: T.jitterMs, loss: T.loss };
  for (const mode of ['stream', 'datagram']) {
    const r = simulateRemote({ seconds: 60, up: { ...c, mode }, down: { ...c, mode }, seed: 9 });
    assert.equal(r.snaps, 0, `${mode}: ${JSON.stringify(r)}`);
    assert.ok(r.errorP95Cm < 15, `${mode}: shown within 15 cm of where it really was 95% of the time (${r.errorP95Cm})`);
    assert.ok(r.upKBs < NET.targets.upKBs, `${mode}: upload ${r.upKBs} kB/s`);
  }
});

test('much worse networks: handled gracefully (keeps moving, few visible corrections, catches up)', () => {
  const r = simulateRemote({ seconds: 60, up: { latencyMs: 400, jitterMs: 120, loss: 0.2 }, down: { latencyMs: 400, jitterMs: 120, loss: 0.2 }, seed: 4 });
  assert.ok(r.frames > 3300 && r.snaps / r.frames < 0.05, JSON.stringify(r));
  assert.ok(r.errorP50Cm < 50, `most of the time it's where it really was (${r.errorP50Cm} cm)`);
});

test('a bot drives its line smoothly, side by side with an offset', () => {
  const D = createRouteDriver(testLoop(), { offset: 3 });
  let prev = null, worst = 0;
  for (let i = 0; i < 120 * 60; i++) {
    const s = D.step(1 / 120);
    if (prev) worst = Math.max(worst, Math.hypot(...[0, 1, 2].map(k => s.pos[k] - (prev.pos[k] + prev.vel[k] / 120))));
    prev = s;
  }
  assert.ok(D.laps >= 1 && worst < 0.03, `${D.laps} laps, worst step ${worst}`);
});

test('the protocol\'s codes have a message each, and the version is a whole number', () => {
  assert.ok(Number.isInteger(PROTOCOL) && PROTOCOL >= 1);
  for (const c of Object.values(CODES)) assert.ok(messageFor(c).length > 10);
});
