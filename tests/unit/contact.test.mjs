// Car-to-car contact's rules (Phase 7 Step 3; docs/CONTACT.md, mp/contact.js), pure: the boxes, each car's own push
// against the other's proxy (two cars in a little 2-D world, each seeing the other only as its proxy — at once, or as
// a stale state), the caps, the agreed result, blame, ghosting, penalties, ramming and the safety rating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { footprintOf, overlap, closingAt, createContactTracker, spinOf, agree, blame, ghostState, createIncidents, safetyAfterRace, safetyTier, zoneOf, yawOf } from '../../mp/contact.js';

const CFG = JSON.parse(fs.readFileSync(new URL('../../data/multiplayer.json', import.meta.url), 'utf8')).contact;
const BOX = { halfExtents: [0.9, 0.6, 2.2], centre: [0, 0.7, 0] }, M = 1300, DT = 1 / 120;

// a car in the 2-D world: its state, a footprint of it, a push at a point
const car = (x, z, yawDeg, speed, extra = {}) => { const y = yawDeg * Math.PI / 180; return { x, z, yaw: y, vx: Math.sin(y) * speed, vz: Math.cos(y) * speed, w: 0, ...extra }; };
const fp = c => footprintOf({ pos: [c.x, 0, c.z], yaw: c.yaw, vel: [c.vx, 0, c.vz], w: c.w }, BOX, { mass: M });
const push = (c, r) => { c.vx += r.impulse[0] / M; c.vz += r.impulse[1] / M; c.w += spinOf(fp(c), r.point, r.impulse); };
const move = c => { c.x += c.vx * DT; c.z += c.vz * DT; c.yaw += c.w * DT; };
const speed = c => Math.hypot(c.vx, c.vz);

// Two cars, each pushed only by its own tracker against the other's proxy. lag: how stale (s) each one's view of the
// other is (its proxy predicted forward from that old state, as the game does)
function run(a, b, { seconds = 1.5, lag = 0, steer = null } = {}) {
  const ta = createContactTracker(CFG), tb = createContactTracker(CFG), hist = { a: [], b: [] }, pushes = { a: [], b: [] };
  let maxSpin = 0, t = 0;
  const seen = (h, now) => {
    // the newest state at least `lag` old, predicted to now from it (velocity only)
    const s = [...h].reverse().find(x => x.t <= now - lag + 1e-9) ?? h[0], d = now - s.t;
    return { stampT: s.t, f: { ...fp(s), x: fp(s).x + s.vx * d, z: fp(s).z + s.vz * d } };
  };
  for (let i = 0; i < seconds / DT; i++, t += DT) {
    hist.a.push({ ...a, t }); hist.b.push({ ...b, t });
    steer?.(a, b, t);
    const va = seen(hist.b, t), vb = seen(hist.a, t);
    const ra = ta.step(fp(a), va.f, { dt: DT, t, otherId: 'b', stampT: va.stampT });
    const rb = tb.step(fp(b), vb.f, { dt: DT, t, otherId: 'a', stampT: vb.stampT });
    const w0 = [a.w, b.w];
    if (ra) { push(a, ra); pushes.a.push(ra); }
    if (rb) { push(b, rb); pushes.b.push(rb); }
    maxSpin = Math.max(maxSpin, Math.abs(a.w - w0[0]), Math.abs(b.w - w0[1]));
    move(a); move(b);
  }
  return { a, b, ta, tb, pushes, maxSpin };
}

test('the boxes: overlapping side by side (depth, the normal across), apart (the gap), and not at different heights', () => {
  const a = fp(car(0, 0, 0, 0)), b = fp(car(1.7, 0.3, 0, 0));
  const o = overlap(a, b);
  assert.ok(Math.abs(o.depth - 0.1) < 1e-6, `depth ${o.depth}`);
  assert.ok(o.n[0] > 0.99, `the normal across, towards b: ${o.n}`);
  assert.ok(o.point[0] > 0.7 && o.point[0] < 1.0, `the point between them: ${o.point}`);
  const far = overlap(a, fp(car(0, 10, 0, 0)));
  assert.ok(far.depth < 0 && Math.abs(far.gap - 5.6) < 1e-6, `5.6 m apart: ${far.gap}`);
  const above = footprintOf({ pos: [1.7, 1.5, 0.3], yaw: 0, vel: [0, 0, 0] }, BOX, { mass: M });
  assert.ok(!overlap(a, above).heights, 'one car above the other: no contact');
  assert.equal(zoneOf(a, [0, 2.1]), 'front'); assert.equal(zoneOf(a, [0, -2.1]), 'rear'); assert.equal(zoneOf(a, [0.9, 0]), 'side');
  assert.ok(Math.abs(yawOf([0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]) - Math.PI / 2) < 1e-9, 'yaw from a quaternion');
  assert.ok(closingAt(fp(car(0, 0, 0, 20)), fp(car(0, 4, 0, 10)), [0, 1], [0, 2.2]) === 10, 'closing at 10 m/s');
});

test('a rear-end at 10 m/s closing: the two-body push (the one behind slows, the one ahead speeds up), each car pushing only itself', () => {
  const { a, b, pushes } = run(car(0, 0, 0, 25), car(0, 5, 0, 15));
  const dvA = 25 - speed(a), dvB = speed(b) - 15, e = CFG.response.restitution;
  assert.ok(pushes.a.some(p => p.kind === 'hit') && pushes.b.some(p => p.kind === 'hit'), 'both felt a hit');
  // each car changes by half of (1 + e) × the closing speed (equal masses)
  assert.ok(Math.abs(dvA - (1 + e) * 5) < 0.8, `the one behind slowed ${dvA.toFixed(2)} m/s`);
  assert.ok(Math.abs(dvB - (1 + e) * 5) < 0.8, `the one ahead sped up ${dvB.toFixed(2)} m/s`);
  assert.ok(speed(b) > speed(a), 'they part');
});

test('lag: the proxy a stale state (150 ms), predicted forward — the hit still comes out the same, near enough', () => {
  const fresh = run(car(0, 0, 0, 25), car(0, 5, 0, 15)), stale = run(car(0, 0, 0, 25), car(0, 5, 0, 15), { lag: 0.15 });
  const dv = r => [25 - speed(r.a), speed(r.b) - 15];
  const [fa, fb] = dv(fresh), [sa, sb] = dv(stale);
  assert.ok(Math.abs(fa - sa) < 1.5 && Math.abs(fb - sb) < 1.5, `fresh ${fa.toFixed(2)}/${fb.toFixed(2)}, stale ${sa.toFixed(2)}/${sb.toFixed(2)}`);
  assert.ok(sa < 10.01 && sb < 10.01, 'and within the cap');
});

test('caps: a 40 m/s hit changes neither car by more than maxDeltaV; an off-centre one spins it no more than maxSpin; nothing vertical', () => {
  const { a, b, pushes, maxSpin } = run(car(0, 0, 0, 45), car(0.8, 5, 0, 5));
  assert.ok(45 - speed(a) <= CFG.limits.maxDeltaV + 1e-6, `the one behind: −${(45 - speed(a)).toFixed(2)} m/s`);
  assert.ok(speed(b) - 5 <= CFG.limits.maxDeltaV + 1e-6, `the one ahead: +${(speed(b) - 5).toFixed(2)} m/s`);
  const spin = pushes.a.reduce((s, p) => s + spinOf(fp(car(0, 0, 0, 0)), [p.point[0] - 0, p.point[1] - 0], p.impulse), 0);
  assert.ok(Math.abs(a.w) <= CFG.limits.maxSpin + 1e-6 && Math.abs(b.w) <= CFG.limits.maxSpin + 1e-6, `spin ${a.w.toFixed(2)} / ${b.w.toFixed(2)} rad/s`);
  assert.ok(maxSpin <= CFG.limits.maxSpin + 1e-6 && Number.isFinite(spin));
  for (const p of [...pushes.a, ...pushes.b]) assert.equal(p.impulse.length, 2, 'every push is horizontal (x, z only)');
});

test('rubbing through a corner: side by side, both steering in — light, steady contact, not repeated bouncing', () => {
  // both at 30 m/s, a little overlapping, each steering 0.6 m/s² into the other
  const steer = (a, b) => { a.vx += 0.6 * DT; b.vx -= 0.6 * DT; };
  const { a, b, pushes } = run(car(0, 0, 0, 30), car(1.75, 0, 0, 30), { seconds: 3, steer });
  const rubs = pushes.a.filter(p => p.kind === 'rub');
  assert.ok(rubs.length > 100, `leaning on each other for most of it (${rubs.length} steps)`);
  for (const p of rubs) assert.ok(Math.hypot(...p.impulse) / M / DT <= CFG.limits.maxRubG * 9.81 * 1.3 + 1e-6, 'each push within the rubbing cap (friction included)');
  // no bouncing: the gap between them settles (their sideways speeds apart never swing back and forth)
  let flips = 0, last = 0;
  const h = run(car(0, 0, 0, 30), car(1.75, 0, 0, 30), { seconds: 3, steer: (x, y, t) => { steer(x, y); const s = Math.sign(Math.round((y.vx - x.vx) * 20)); if (s && last && s !== last) flips++; if (s) last = s; } });
  assert.ok(flips <= 2, `the sideways speed between them changed direction ${flips} times`);
  assert.ok(Math.abs(b.x - a.x) > 1.5 && Math.abs(b.x - a.x) < 2.2, `side by side still (${(b.x - a.x).toFixed(2)} m apart)`);
  assert.ok(Math.abs(speed(a) - 30) < 2 && h.a.vz > 25, 'and neither slowed much');
});

const report = (pid, other, closing, n, extra = {}) => ({ pid, other, t: 1000, kind: 'hit', closing, n, point: [0, 2.2], J: [0, 0], ...extra });
const A = { pid: 'a', mass: M, box: BOX }, B = { pid: 'b', mass: M, box: BOX };

test('the agreed result: two reports that agree are averaged; that disagree, the gentler; one-sided, checked against the server', () => {
  const r = agree([report('a', 'b', 10, [0, 1]), report('b', 'a', 9, [0, -1])], { a: A, b: B, mode: 'full', cfg: CFG });
  assert.ok(r.ok && Math.abs(r.closing - 9.5) < 1e-9 && r.sources === 'both' && !r.gentler);
  const e = CFG.response.restitution;
  assert.ok(Math.abs(r.J - (1 + e) * (M / 2) * 9.5) < 1e-6, 'Phase 3: (1 + e) m_red v');
  assert.deepEqual(r.cars.a.impulse.map(x => Math.round(x) + 0), [0, -Math.round(r.J)]); assert.deepEqual(r.cars.b.impulse.map(x => Math.round(x) + 0), [0, Math.round(r.J)]);
  assert.ok(Math.abs(r.cars.a.strength - 4.75) < 1e-6, `each feels half the closing speed: ${r.cars.a.strength}`);
  // disagreeing (one saw 18, the other 6): the gentler
  const d = agree([report('a', 'b', 18, [0, 1]), report('b', 'a', 6, [0, -1])], { a: A, b: B, mode: 'full', cfg: CFG });
  assert.ok(d.ok && d.gentler && d.closing === 6, JSON.stringify(d));
  // reduced: the same push, a share of the damage
  const red = agree([report('a', 'b', 10, [0, 1]), report('b', 'a', 9, [0, -1])], { a: A, b: B, mode: 'reduced', cfg: CFG });
  assert.equal(red.cars.a.scale, CFG.damage.reduced); assert.equal(red.J, r.J);
  // ghost: nothing
  assert.ok(!agree([report('a', 'b', 10, [0, 1])], { a: A, b: B, mode: 'ghost', cfg: CFG }).ok);
  // one-sided: the server saw them 6 m apart → refused; touching → the gentler of the report and the server's view
  const fake = agree([report('a', 'b', 15, [0, 1])], { a: A, b: B, serverView: { gap: 6, closing: 0 }, mode: 'full', cfg: CFG });
  assert.ok(!fake.ok && /didn't see/.test(fake.why), fake.why);
  const one = agree([report('a', 'b', 15, [0, 1])], { a: A, b: B, serverView: { gap: 0.2, closing: 11 }, mode: 'full', cfg: CFG });
  assert.ok(one.ok && one.closing === 11 && one.gentler);
  // capped: 60 m/s closing changes neither by more than maxDeltaV
  const big = agree([report('a', 'b', 60, [0, 1]), report('b', 'a', 60, [0, -1])], { a: A, b: B, mode: 'full', cfg: CFG });
  assert.ok(big.J / M <= CFG.limits.maxDeltaV + 1e-9);
});

const hist = (pid, list) => list.map(([t, x, z, vx, vz, u]) => ({ t, pos: [x, 0, z], vel: [vx, 0, vz], yaw: Math.atan2(vx, vz), u }));

test('blame: a rear-end is the car behind\'s; a brake test in front shifts it; a swerve into the other car is the swerver\'s', () => {
  const fa = fp(car(0, 0, 0, 25)), fb = fp(car(0, 4.3, 0, 15));
  const res = agree([report('a', 'b', 10, [0, 1], { point: [0, 2.15] }), report('b', 'a', 10, [0, -1], { point: [0, 2.15] })], { a: A, b: B, mode: 'full', cfg: CFG });
  const steady = { a: hist('a', [[0, 0, -25, 0, 25, 100], [1000, 0, 0, 0, 25, 125]]), b: hist('b', [[0, 0, -10.7, 0, 15, 110.7], [1000, 0, 4.3, 0, 15, 125.7]]) };
  const r1 = blame({ a: { ...A, name: 'A' }, b: { ...B, name: 'B' }, result: res, history: steady, cfg: CFG, footprints: { a: fa, b: fb } });
  assert.equal(r1.fault, 'a', JSON.stringify(r1)); assert.ok(r1.careless && r1.shares.a > 0.7, JSON.stringify(r1));
  // B braked from 25 to 15 in the last second (1 g) while A held its speed: much less of it A's
  const brake = { a: steady.a, b: hist('b', [[0, 0, -15.7, 0, 25, 110], [1000, 0, 4.3, 0, 15, 125.7]]) };
  const r2 = blame({ a: A, b: B, result: res, history: brake, cfg: CFG, footprints: { a: fa, b: fb } });
  assert.ok(r2.shares.b >= 0.45 && !r2.careless, `brake test: B's share ${r1.shares.b.toFixed(2)} → ${r2.shares.b.toFixed(2)}`);
  assert.ok(r2.reasons.some(x => /braked hard/.test(x)), r2.reasons.join(' | '));
  // side by side, A moves 2 m across into B in a second: A's
  const ga = fp(car(0, 0, 0, 25)), gb = fp(car(1.75, 0, 0, 25));
  const side = agree([report('a', 'b', 2.5, [1, 0], { point: [0.88, 0] }), report('b', 'a', 2.5, [-1, 0], { point: [0.88, 0] })], { a: A, b: B, mode: 'full', cfg: CFG });
  const swerve = { a: hist('a', [[0, -2, -25, 0, 25, 100], [1000, 0, 0, 2, 25, 125]]), b: hist('b', [[0, 1.75, -25, 0, 25, 100], [1000, 1.75, 0, 0, 25, 125]]) };
  const r3 = blame({ a: A, b: B, result: side, history: swerve, cfg: CFG, footprints: { a: { ...ga, vx: 2 }, b: gb } });
  assert.equal(r3.fault, 'a', JSON.stringify(r3)); assert.ok(r3.reasons.some(x => /left their line/.test(x)), r3.reasons.join(' | '));
});

test('ghosting: lag, jitter, a reset, a rejoin, the wrong way, the pit lane, the first corner, being lapped, an offender', () => {
  const base = { pingMs: 60, jitterMs: 10, resetAt: null, rejoinAt: null, wrongWay: 0, rightWay: 99, inPit: false, lap: 2, u: 2000 };
  const now = 100000, g = c => ghostState({ ...base, ...c }, now, CFG);
  assert.equal(g({}).ghost, false);
  assert.match(g({ pingMs: 400 }).reasons[0], /ping/); assert.match(g({ jitterMs: 150 }).reasons[0], /jitter/);
  // (a game drawing a frame every 2.5 s: its car sent too seldom; a parked one's 200 ms "still here" isn't)
  assert.match(g({ gapMs: 2500 }).reasons[0], /apart/); assert.equal(g({ gapMs: 200 }).ghost, false);
  assert.ok(g({ resetAt: now - 1000 }).ghost && !g({ resetAt: now - 10000 }).ghost);
  assert.ok(g({ rejoinAt: now - 1000 }).ghost);
  assert.ok(g({ wrongWay: 2 }).ghost && g({ wasWrong: true, rightWay: 0.5 }).ghost && !g({ wasWrong: true, rightWay: 5 }).ghost);
  assert.ok(g({ inPit: true }).ghost);
  assert.ok(!g({ lap: 1, u: 100 }).ghost, 'the first corner only when switched on');
  assert.ok(ghostState({ ...base, lap: 1, u: 100 }, now, { ...CFG, ghost: { ...CFG.ghost, firstCorner: true } }).ghost);
  assert.ok(ghostState({ ...base, lappedBy: 'x' }, now, { ...CFG, ghost: { ...CFG.ghost, lapped: true } }).ghost);
  assert.ok(g({ offender: true }).ghost);
  assert.ok(ghostState(base, now, CFG, { mode: 'ghost' }).ghost);
});

test('in a race: a clear cause of a crash is penalised; repeat offenders ghosted; repeated hits on one car flagged as ramming', () => {
  const I = createIncidents(CFG), res = { kind: 'hit' }, pair = { a: A, b: B };
  const hit = (t, share, strength) => I.add(res, { fault: 'a', share, strength, careless: share >= CFG.blame.carelessShare && strength >= CFG.blame.minStrength }, t, pair);
  assert.deepEqual(hit(0, 0.65, 3), [], 'at fault but not careless: nothing');
  const a1 = hit(1000, 0.9, 9);
  assert.ok(a1.some(x => x.type === 'penalty' && x.seconds === CFG.penalties.seconds && x.pid === 'a'), JSON.stringify(a1));
  const a2 = hit(5000, 0.85, 4), a3 = hit(9000, 0.9, 4);
  assert.ok(![...a1, ...a2].some(x => x.type === 'ghost') && a3.some(x => x.type === 'ghost' && x.pid === 'a'), 'ghosted at the third careless contact');
  assert.ok(a3.some(x => x.type === 'ramming' && x.victim === 'b'), `ramming: ${JSON.stringify(a3)}`);
  assert.ok(!hit(12000, 0.9, 4).some(x => x.type === 'ramming'), 'flagged once');
  assert.equal(I.of('a').length, 5);
});

test('the safety rating: careless contacts cost points by how hard and how much at fault; a clean race earns a little back', () => {
  const S = CFG.safety;
  const crash = safetyAfterRace(70, [{ share: 1, strength: 10 }], { km: 5, cfg: CFG });
  assert.equal(crash.points, S.points.crash); assert.equal(crash.sr, 70 - S.points.crash * S.perPoint);
  const light = safetyAfterRace(70, [{ share: 0.6, strength: 1 }], { km: 5, cfg: CFG });
  assert.ok(light.sr > crash.sr && light.sr < 70);
  assert.equal(safetyAfterRace(70, [{ share: 0.4, strength: 10 }], { km: 5, cfg: CFG }).delta, Math.min(S.cleanMax, S.cleanPerKm * 5), 'under half at fault: no points');
  assert.equal(safetyAfterRace(99, [], { km: 100, cfg: CFG }).sr, S.max);
  assert.equal(safetyAfterRace(1, [{ share: 1, strength: 20 }, { share: 1, strength: 20 }], { km: 1, cfg: CFG }).sr, S.min);
  assert.equal(safetyAfterRace(null, [], { km: 0, cfg: CFG }).sr, S.start);
  assert.equal(safetyTier(85, CFG).id, 'A'); assert.equal(safetyTier(60, CFG).id, 'B'); assert.equal(safetyTier(5, CFG).id, 'E');
});
