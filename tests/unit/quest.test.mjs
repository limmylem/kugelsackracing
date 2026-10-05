// Quests at run time (Phase 4 Step 3), pure: the session's states, sub-tick timing, checkpoints in order,
// jump starts, rolling starts, laps and splits, drift scoring, the delivery's cargo, medals, rewards
// (once per tier, then a repeat), entry reasons, result validation, recordings, and PlayerService's side
// (fees charged at the start and refunded if it fails to start, rewards paid once, progress saved,
// invalid results paying nothing). A made-up car drives made-up routes: a point moving along the line.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { viewCourse } from '../../route/model.js';
import { encodeLine, resample, at } from '../../route/geometry.js';
import { crossing, crossTime, fmtTime } from '../../quest/timing.js';
import { createQuestSession } from '../../quest/session.js';
import { medalTargets, medalOf, earnings, entryReasons, carsThatQualify, levelOf, xpForLevel, levelProgress, farmingFactor } from '../../quest/rules.js';
import { rewardsOf, feeOf } from '../../content/quests.js';
import { createDriftScorer, pointsPerSecond } from '../../quest/drift.js';
import { createRecorder, decodeRecording } from '../../quest/recording.js';
import { buildResult } from '../../quest/result.js';
import { validateResult } from '../../quest/validate.js';
import { pinkSlipConfirmations } from '../../quest/types/pinkSlip.js';

const config = JSON.parse(fs.readFileSync(new URL('../../data/quests.json', import.meta.url)));
const economy = JSON.parse(fs.readFileSync(new URL('../../data/economy.json', import.meta.url)));
export const P = { toXZ: (lat, lon) => [lon * 1e5, -lat * 1e5], toLatLon: (x, z) => [-z / 1e5, x / 1e5] };

// a route from points (metres), its checkpoints at s
export function makeCourse(pts, { kind = 'p2p', checkpoints = [], w = 10, extension = 0, bonus = [] } = {}) {
  const line = resample(pts.map(([x, z]) => ({ x, z, h: 0, w })), 4);
  const path = encodeLine(line.map(p => { const [lat, lon] = P.toLatLon(p.x, p.z); return { lat, lon, h: 0, w }; }));
  const cps = checkpoints.map((s, i) => ({ id: `cp${i + 1}`, s, width: null, required: !bonus.includes(i), timeExtension: extension, auto: true }));
  return viewCourse({ kind, path, checkpoints: cps, grid: { count: 4 }, stats: { estimatedTime: 60 } }, P);
}
export const straight = (o = {}) => makeCourse([[0, 0], [2000, 0]], { checkpoints: [500, 1000, 1500], ...o });
export const ring = (o = {}) => {
  const pts = [];
  for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([300 * Math.sin(a), -300 * Math.cos(a) + 300]); }
  return makeCourse(pts, { kind: 'loop', checkpoints: [400, 900, 1400], ...o });
};
export function quest(type, params = {}, extra = {}) {
  return { id: `q_${type}`, kind: 'quest', type, version: 3, updated: '2026-01-01T00:00:00Z', route: 'r1', fee: 0, rewards: { tier: 'standard' }, entry: { classes: [], minLevel: 1 }, params: { laps: 1, ...params }, ...extra };
}

// A made-up car driving the line at a speed (m/s, or a function of time), on fixed ticks; returns the session
export function drive(Q, course, { hz = 120, speed = 30, throttle = () => 0, offset = 0, until = 400, impulse = () => 0, condition = () => 100, slip = () => 0, onEvent = () => {}, drivable = () => true } = {}) {
  const dt = 1 / hz, line = course.line, L = course.length, ev = [];
  const slot = course.grid.slots[0];
  let s = slot.s, t = 0, placed = false, moving = false;
  Q.begin({ intro: false });
  for (let i = 0; i < until * hz && !['finished', 'failed'].includes(Q.state.state); i++) {
    for (const e of Q.drain()) { ev.push(e); onEvent(e); if (e.type === 'place') { placed = true; if (e.rolling) s = course.grid.startS - e.rollingDistance; } if (e.type === 'go') moving = true; if (e.type === 'reset') { s = e.point.s; Q.noteReset(e.point); } }
    t = i * dt;
    const v = typeof speed === 'function' ? speed(t, s) : speed;
    if (moving) s += v * dt;
    const ss = course.loop ? ((s % L) + L) % L : s, p = at(line, ss, course.loop);
    const a = slip(t) * Math.PI / 180, fx = p.dx * Math.cos(a) - p.dz * Math.sin(a), fz = p.dx * Math.sin(a) + p.dz * Math.cos(a);
    Q.tick({ t, dt, x: p.x + p.dz * offset, z: p.z - p.dx * offset, vx: p.dx * (moving ? v : 0), vz: p.dz * (moving ? v : 0), fx, fz, throttle: throttle(t), drivable: drivable(t), condition: condition(t), impulse: impulse(t) });
  }
  for (const e of Q.drain()) { ev.push(e); onEvent(e); }
  assert.ok(placed);
  return ev;
}

test('timing: a gate crossed between two ticks, to the fraction of the tick', () => {
  const g = { x1: 10, z1: -5, x2: 10, z2: 5, dx: 1, dz: 0 };
  assert.equal(crossing(g, { x: 9, z: 0 }, { x: 11, z: 0 }), 0.5);
  assert.equal(crossing(g, { x: 11, z: 0 }, { x: 9, z: 0 }), null, 'backwards doesn\'t count');
  assert.equal(crossing(g, { x: 9, z: 6 }, { x: 11, z: 6 }), null, 'past its end');
  assert.equal(crossTime(g, { x: 9.5, z: 0, t: 1 }, { x: 10.5, z: 0, t: 1.01 }), 1.005);
  assert.equal(fmtTime(83.4567), '1:23.457');
});

test('session: intro → countdown → racing → finished, a standing start timed from GO', () => {
  const course = straight(), Q = createQuestSession({ quest: quest('sprint'), course, config });
  Q.begin();
  assert.equal(Q.state.state, 'intro');
  Q.frame(2); assert.equal(Q.state.state, 'intro');
  Q.skipIntro(); assert.equal(Q.state.state, 'countdown');
  const ev = drive(createQuestSession({ quest: quest('sprint'), course, config }), course, { speed: 25 });
  const types = ev.map(e => e.type);
  assert.deepEqual(types.filter(t => ['place', 'count', 'go', 'checkpoint', 'finish'].includes(t)), ['place', 'count', 'count', 'count', 'go', 'checkpoint', 'checkpoint', 'checkpoint', 'finish']);
  const fin = ev.find(e => e.type === 'finish').outcome;
  // from the grid slot (6 m behind the line) to the finish (15 m before the end) at 25 m/s
  const want = (course.grid.finishS - course.grid.slots[0].s) / 25;
  assert.ok(Math.abs(fin.time - want) < 1e-6, `${fin.time} vs ${want}`);
  assert.equal(fin.status, 'finished');
  assert.equal(fin.splits.length, 3);
  assert.ok(Math.abs(fin.splits[0].time - (500 - course.grid.slots[0].s) / 25) < 1e-6);
});

test('timing: the same run at 30, 60, 144 Hz and 120 Hz ticks: the same time (sub-tick crossing)', () => {
  const course = straight(), times = [];
  for (const hz of [30, 60, 120, 144]) {
    const Q = createQuestSession({ quest: quest('sprint'), course, config });
    drive(Q, course, { hz, speed: 33.3 });
    times.push(Q.outcome.time);
  }
  for (const t of times) assert.ok(Math.abs(t - times[0]) < 0.001, times.join(' '));
});

test('checkpoints in order: going round one is missed, an arrow back, no finish until it\'s done', () => {
  const course = straight();
  const Q = createQuestSession({ quest: quest('sprint'), course, config });
  // past checkpoint 2 (s = 1000) well off to the side (outside its gate), then back on the road
  const ev = drive(Q, course, { speed: 30, until: 120, offset: 0 });
  assert.equal(Q.outcome.status, 'finished');
  const Q2 = createQuestSession({ quest: quest('sprint'), course, config: { ...config, wreck: { seconds: 99 } } });
  let s0 = null;
  const ev2 = [];
  // drive past cp2 outside its gate: the car's 12 m to the side from 950 to 1050 m
  const dt = 1 / 120;
  Q2.begin({ intro: false });
  let s = course.grid.slots[0].s, go = false, back = false;
  for (let i = 0; i < 200 * 120 && Q2.state.state !== 'finished'; i++) {
    for (const e of Q2.drain()) { ev2.push(e); if (e.type === 'go') go = true; if (e.type === 'missed') back = true; }
    let v = go ? 30 : 0;
    // missed: back 120 m, then forward again through the gate
    if (back && s0 == null) s0 = s;
    if (s0 != null && s > s0 - 120 && !Q2.state.splits.find(x => x.number === 2) && ev2.filter(e => e.type === 'missed').length && Q2.state._rev !== false) { v = -30; if (s <= s0 - 119) Q2.state._rev = false; }
    s += v * dt;
    const p = at(course.line, s), off = s0 == null && s > 950 && s < 1050 ? 12 : 0;
    Q2.tick({ t: i * dt, dt, x: p.x + p.dz * off, z: p.z - p.dx * off, vx: p.dx * v, vz: p.dz * v, throttle: 1, drivable: true, condition: 100 });
  }
  const missed = ev2.find(e => e.type === 'missed');
  assert.ok(missed, 'missed');
  assert.equal(missed.number, 2);
  assert.ok(Math.abs(missed.x - at(course.line, 1000).x) < 0.5, 'the arrow points back at it');
  assert.equal(Q2.outcome?.status, 'finished', 'went back through it and finished');
  assert.deepEqual(Q2.outcome.splits.map(x => x.number), [1, 2, 3]);
});

test('no finish with a checkpoint missed', () => {
  const course = straight();
  const Q = createQuestSession({ quest: quest('sprint'), course, config });
  drive(Q, course, { speed: 30, until: 120, offset: 0, onEvent: e => { if (e.type === 'checkpoint' && e.number === 1) Q.state.next = 1; } });
  // (cp1 counted, then cp2 skipped by pretending the car went round it: the session never sees it)
  const Q2 = createQuestSession({ quest: quest('sprint'), course: { ...course, gates: course.gates.map((g, i) => i === 1 ? { ...g, x1: g.x1 + 9000, x2: g.x2 + 9000 } : g) }, config });
  const ev = drive(Q2, course, { speed: 30, until: 120 });
  assert.ok(ev.some(e => e.type === 'missed' && e.number === 2));
  assert.notEqual(Q2.state.state, 'finished');
});

test('jump start: throttle before GO costs the penalty; a rolling start times from the line', () => {
  const course = straight();
  const Q = createQuestSession({ quest: quest('sprint'), course, config });
  const ev = drive(Q, course, { speed: 30, throttle: t => t > 2.6 ? 1 : 0 });
  assert.ok(ev.some(e => e.type === 'jump'));
  assert.equal(Q.outcome.jump, true);
  assert.ok(Math.abs(Q.outcome.time - Q.outcome.rawTime - config.start.jumpPenalty) < 1e-9);
  const Q1 = createQuestSession({ quest: quest('sprint'), course, config });
  drive(Q1, course, { speed: 30, throttle: t => t > 2 && t < 2.3 ? 1 : 0 });
  assert.equal(Q1.outcome.jump, false, 'throttle earlier than the window is fine');
  const R = createQuestSession({ quest: quest('sprint'), course, config, startMode: 'rolling' });
  const ev2 = drive(R, course, { speed: 30, throttle: () => 1 });
  assert.ok(!ev2.some(e => e.type === 'jump'));
  assert.ok(Math.abs(R.outcome.time - (course.grid.finishS - course.grid.startS) / 30) < 1e-6, `${R.outcome.time}`);
});

test('laps on a loop: lap times, the best lap, splits compared to my best', () => {
  const course = ring();
  const q = quest('sprint', { laps: 3 });
  const Q = createQuestSession({ quest: q, course, config });
  const ev = drive(Q, course, { speed: t => t < 40 ? 25 : 30 });
  assert.equal(Q.outcome.status, 'finished');
  assert.equal(Q.outcome.laps.length, 3);
  assert.equal(ev.filter(e => e.type === 'lap').length, 2);
  assert.equal(Q.outcome.splits.length, 9);
  assert.ok(Q.outcome.bestLap < Q.outcome.laps[0]);
  assert.ok(Math.abs(Q.outcome.laps.reduce((a, b) => a + b, 0) - Q.outcome.rawTime) < 1e-9);
  // again, with that as my best: faster → green (negative) deltas
  const Q2 = createQuestSession({ quest: q, course, config, best: { splits: Q.outcome.splits.map(s => s.time), laps: Q.outcome.laps } });
  drive(Q2, course, { speed: 32 });
  assert.ok(Q2.outcome.splits.every(s => s.delta < 0));
});

test('time limits: checkpoint run out of time; extensions; time trial countdown', () => {
  const course = straight({ extension: 10 });
  const Q = createQuestSession({ quest: quest('checkpoint', { timeLimitSeconds: 45 }), course, config });
  drive(Q, course, { speed: 30 });
  assert.equal(Q.outcome.status, 'finished', 'with 45 s + 3 × 10 s it makes it');
  const Q2 = createQuestSession({ quest: quest('checkpoint', { timeLimitSeconds: 45 }), course: straight(), config });
  drive(Q2, straight(), { speed: 30 });
  assert.equal(Q2.outcome.status, 'failed');
  assert.equal(Q2.outcome.text, 'Out of time');
  const tt = createQuestSession({ quest: quest('time_trial', { targetSeconds: 60 }), course, config });
  assert.ok(tt.state.limit > 0, 'a countdown with extensions');
  assert.equal(createQuestSession({ quest: quest('time_trial', { targetSeconds: 60 }), course: straight(), config }).state.limit, null);
});

test('wrecked: undrivable for a while ends it', () => {
  const course = straight(), Q = createQuestSession({ quest: quest('sprint'), course, config });
  drive(Q, course, { speed: 30, drivable: t => t < 10 });
  assert.equal(Q.outcome.status, 'failed');
  assert.equal(Q.outcome.reason, 'wrecked');
});

test('drift scoring: angle, speed and time; the combo; a wall or a spin loses the pot', () => {
  const R = config.drift, D = createDriftScorer(R), dt = 1 / 120;
  const tick = (deg, ms, impulse = 0) => { const a = deg * Math.PI / 180; return D.tick({ dt, fx: Math.sin(a), fz: Math.cos(a), vx: 0, vz: ms, impulse }); };
  for (let i = 0; i < 120; i++) tick(30, 60 / 3.6);
  assert.ok(Math.abs(D.state.pot - pointsPerSecond(R, 30, 60)) < 1);
  for (let i = 0; i < 120 * 2; i++) tick(0, 20);
  assert.equal(D.state.score, 100, '1 s at 30° and 60 km/h, banked after the grace');
  // 5 s drift: the multiplier goes to 3
  for (let i = 0; i < 600; i++) tick(30, 60 / 3.6);
  assert.equal(D.state.multiplier, 3);
  const pot = D.state.pot;
  tick(30, 60 / 3.6, R.wallHit + 1);
  assert.equal(D.state.pot, 0); assert.equal(D.state.multiplier, 1); assert.equal(D.state.score, 100);
  for (let i = 0; i < 120; i++) tick(40, 20);
  tick(150, 20);
  assert.equal(D.state.pot, 0, 'a spin loses it'); assert.ok(pot > 0);
  // too slow or too straight: nothing
  const D2 = createDriftScorer(R);
  for (let i = 0; i < 240; i++) D2.tick({ dt, fx: Math.sin(0.1), fz: Math.cos(0.1), vx: 0, vz: 20 });
  for (let i = 0; i < 240; i++) D2.tick({ dt, fx: Math.sin(0.5), fz: Math.cos(0.5), vx: 0, vz: 5 });
  D2.end();
  assert.equal(D2.state.score, 0);
});

test('drift quest: scored along the route, medals for the score', () => {
  const course = straight();
  const q = quest('drift', { scoreTarget: 1000 });
  const Q = createQuestSession({ quest: q, course, config });
  drive(Q, course, { speed: 20, slip: t => (Math.floor(t / 4) % 2 ? 0 : 35) });
  assert.equal(Q.outcome.status, 'finished');
  assert.ok(Q.outcome.score > 1000, `${Q.outcome.score}`);
  assert.equal(Q.outcome.medal, 'gold');
  const T = medalTargets(q, course, config);
  assert.deepEqual([T.gold, T.silver, T.bronze], [1000, 700, 400]);
});

test('delivery: the cargo takes the damage, the payout drops, destroyed is failed', () => {
  const course = straight();
  const q = quest('delivery', { cargo: { name: 'Vases', massKg: 20, fragile: true }, damagePenalty: 0.5 });
  const Q = createQuestSession({ quest: q, course, config });
  drive(Q, course, { speed: 30, condition: t => t > 20 ? 90 : 100, impulse: t => Math.abs(t - 20) < 0.005 ? 3000 : 0 });
  assert.equal(Q.outcome.status, 'finished');
  assert.equal(Q.outcome.cargo, 80, '10% damage, fragile: 20% lost');
  assert.equal(Q.outcome.cargoLost, 0.2);
  assert.equal(Q.outcome.damage.taken, 10);
  assert.equal(Q.outcome.damage.events.length, 1);
  const full = earnings({ quest: q, outcome: { ...Q.outcome, cargoLost: 0 }, economy, config });
  const cut = earnings({ quest: q, outcome: Q.outcome, economy, config });
  assert.ok(Math.abs(cut.money - full.money * 0.9) <= (economy.quests.roundTo ?? 1), `${cut.money} vs ${full.money}`);
  const Q2 = createQuestSession({ quest: q, course, config });
  drive(Q2, course, { speed: 30, condition: t => t > 20 ? 40 : 100 });
  assert.equal(Q2.outcome.status, 'failed');
  assert.equal(Q2.outcome.reason, 'cargo');
});

test('medals: thresholds from the reference time × config multipliers, × laps', () => {
  const course = { ...straight(), referenceTime: 100 };
  const T = medalTargets(quest('sprint'), course, config);
  assert.deepEqual([T.gold, T.silver, T.bronze], [100, 112, 130]);
  assert.equal(medalOf(T, { time: 99 }), 'gold');
  assert.equal(medalOf(T, { time: 100 }), 'gold');
  assert.equal(medalOf(T, { time: 112.01 }), 'bronze');
  assert.equal(medalOf(T, { time: 131 }), null);
  const loopT = medalTargets(quest('sprint', { laps: 3 }), { ...ring(), referenceTime: 50 }, config);
  assert.equal(loopT.gold, 150);
  assert.equal(medalTargets(quest('time_trial', { targetSeconds: 80 }), course, config).gold, 80);
});

test('rewards: each tier once (a better one pays the difference), finishing once, then a repeat', () => {
  const q = quest('sprint'), base = earnings({ quest: q, outcome: { status: 'finished', medal: 'gold' }, economy, config }).base;
  const pay = (medal, progress) => earnings({ quest: q, outcome: { status: 'finished', medal }, progress, economy, config });
  const r = economy.quests.roundTo ?? 1, near = (a, b) => Math.abs(a - b) <= r;
  assert.ok(near(pay(null, {}).money, base.money * config.rewards.finish));
  assert.ok(near(pay('bronze', {}).money, base.money * config.rewards.bronze));
  assert.ok(near(pay('gold', { paidShare: config.rewards.bronze }).money, base.money * (config.rewards.gold - config.rewards.bronze)));
  assert.ok(near(pay('bronze', { paidShare: config.rewards.bronze }).money, base.money * config.rewards.repeat), 'the same medal again: the repeat');
  assert.equal(pay('bronze', { paidShare: config.rewards.bronze }).repeat, true);
  assert.ok(near(pay(null, { finishPaid: true }).money, base.money * config.rewards.repeat));
  assert.equal(earnings({ quest: q, outcome: { status: 'failed' }, economy, config }).money, 0);
  // levels: each a little more xp than the last
  assert.equal(levelOf(0, config), 1); assert.equal(levelOf(xpForLevel(5, config), config), 5); assert.equal(levelOf(xpForLevel(5, config) - 1, config), 4);
  assert.ok(xpForLevel(6, config) - xpForLevel(5, config) > xpForLevel(3, config) - xpForLevel(2, config));
  const lp = levelProgress(xpForLevel(3, config) + 10, config);
  assert.equal(lp.level, 3); assert.ok(lp.share > 0 && lp.share < 1);
  // xp: every finish earns some, medals and places more, a repeat less
  assert.ok(pay('gold', {}).xp > pay('bronze', {}).xp && pay('bronze', {}).xp > pay(null, {}).xp);
  assert.ok(pay('gold', { paidShare: 1 }).xp > 0 && pay('gold', { paidShare: 1 }).xp < pay('gold', {}).xp);
  const placed = p => earnings({ quest: q, outcome: { status: 'finished', medal: null, place: p }, economy, config });
  assert.ok(placed(4).xp > placed(7).xp && placed(4).money > placed(7).money, 'a better place pays more');
  // anti-farming: run the same quest again and again within the window and it pays less (not below the floor)
  const F = economy.quests.farming, now = '2026-10-04T12:00:00Z', ago = m => new Date(Date.parse(now) - m * 60e3).toISOString();
  const farmed = n => earnings({ quest: q, outcome: { status: 'finished', medal: 'gold' }, progress: { paidShare: 1, recent: Array.from({ length: n }, (_, i) => ago(5 * (i + 1))) }, economy, config, now });
  assert.equal(farmed(F.freeRuns - 1).farming, 1);
  assert.ok(farmed(F.freeRuns).farming < 1 && farmed(F.freeRuns + 3).farming < farmed(F.freeRuns).farming);
  assert.equal(farmed(50).farming, F.floor);
  assert.equal(farmingFactor([ago(F.windowHours * 60 + 5), ago(F.windowHours * 60 + 10), ago(F.windowHours * 60 + 20), ago(F.windowHours * 60 + 30)], now, economy), 1, 'older runs don\'t count');
});

test('entry: plain-English reasons, and which cars would do', () => {
  const q = quest('sprint', {}, { entry: { classes: ['D', 'C'], maxPowerKw: 150, minLevel: 3 }, rating: { stars: 3, km: 3 } });
  const car = { className: 'B', kw: 220, kg: 1300, drivable: { ok: false, reasons: ['front-left wheel missing'] } };
  const R = entryReasons({ quest: q, car, player: { money: 10, xp: 0 }, config, economy });
  const text = R.map(r => r.text).join('\n');
  assert.match(text, /Needs a class D or C car/);
  assert.match(text, /Needs a car under 201 hp \(yours has 295 hp\)/);
  assert.match(text, /Car too damaged: repair first \(front-left wheel missing\)/);
  assert.match(text, /Needs level 3/);
  assert.match(text, /Entry fee/);
  const cars = [{ id: 'a', className: 'C', kw: 100, kg: 1100 }, { id: 'b', className: 'C', kw: 200, kg: 1100 }, { id: 'c', className: 'D', kw: 90, kg: 900, drivable: { ok: false, reasons: [] } }];
  assert.deepEqual(carsThatQualify(q, cars, config).map(c => c.id), ['a']);
  assert.match(entryReasons({ quest: quest('pink_slip'), car: { ...cars[0], carId: 'starter_car' }, player: { money: 0, xp: 0 }, config })[0].text, /starter car/);
  // tiers open by level; a pink slip's stakes follow its tier
  const pro = quest('sprint', {}, { entry: { classes: ['B'] }, rating: { stars: 3, km: 3 } }), T = rewardsOf(pro, economy);
  assert.ok(T.unlockLevel > 1);
  assert.match(entryReasons({ quest: pro, car: { className: 'B', kw: 100, kg: 1200 }, player: { money: 1e6, xp: 0 }, config, economy }).map(r => r.text).join(), new RegExp(`${T.tierName} quests open at level ${T.unlockLevel}`));
  assert.deepEqual(entryReasons({ quest: pro, car: { className: 'B', kw: 100, kg: 1200 }, player: { money: 1e6, xp: xpForLevel(T.unlockLevel, config) }, config, economy }), []);
  const slip = quest('pink_slip', {}, { rating: { stars: 1, km: 2 } });
  assert.match(entryReasons({ quest: slip, car: { className: 'S', carId: 'apex_v8', kw: 400, kg: 1400 }, player: { money: 0, xp: 0 }, config, economy })[0].text, /stakes cars up to class D: yours is class S/);
});

test('result validation: in order, possible, the right route version; impossible pays nothing', () => {
  const course = straight(), q = quest('sprint');
  const Q = createQuestSession({ quest: q, course, config });
  drive(Q, course, { speed: 30 });
  const ok = buildResult({ quest: q, course, outcome: Q.outcome, car: { topSpeed: 50 } });
  assert.deepEqual(validateResult(ok, { quest: q, course, config }), { ok: true, problems: [] });
  const fast = { ...ok, checkpoints: ok.checkpoints.map(c => ({ ...c, time: c.time / 4 })), laps: [ok.rawTime / 4], rawTime: ok.rawTime / 4, time: ok.time / 4 };
  assert.match(validateResult(fast, { quest: q, course, config }).problems[0], /Impossible time/);
  const order = { ...ok, checkpoints: [ok.checkpoints[1], ok.checkpoints[0], ok.checkpoints[2]] };
  assert.match(validateResult(order, { quest: q, course, config }).problems[0], /out of order/);
  const skipped = { ...ok, checkpoints: ok.checkpoints.slice(1) };
  assert.equal(validateResult(skipped, { quest: q, course, config }).ok, false);
  assert.match(validateResult({ ...ok, routeVersion: 'zzz' }, { quest: q, course, config }).problems[0], /route has changed/);
  assert.match(validateResult(ok, { quest: { ...q, updated: 'later' }, course, config }).problems[0], /quest has changed/);
});

test('recording: compact, deterministic, decodes to the run', () => {
  const run = () => {
    const R = createRecorder({ hz: 20 });
    for (let i = 0; i < 120 * 60; i++) {
      const t = i / 120, a = t * 0.3;
      R.sample(t, { x: 1000 + 300 * Math.sin(a), y: 20 + Math.sin(t), z: -300 * Math.cos(a), q: [0, Math.sin(a / 2), 0, Math.cos(a / 2)], vx: 90 * Math.cos(a), vy: 0, vz: 90 * Math.sin(a) });
    }
    return R.finish();
  };
  const a = run(), b = run();
  assert.equal(a.data, b.data);
  assert.equal(a.frames, 1200);
  assert.ok(a.data.length < 30000, `${a.data.length} chars for a minute`);
  const f = decodeRecording(a);
  assert.equal(f.length, 1200);
  assert.ok(Math.abs(f[600].x - (1000 + 300 * Math.sin(30 * 0.3))) < 0.011);
  assert.ok(Math.abs(f[600].q[1] - Math.sin(30 * 0.3 / 2) * Math.sign(Math.cos(30 * 0.3 / 2))) < 1e-4);
});

test('pink slip: a race (its rival: race/race.js), confirmations say the car will be lost', () => {
  const course = straight(), Q = createQuestSession({ quest: quest('pink_slip', { opponentCar: 'x' }), course, config });
  Q.begin({ intro: false });
  assert.equal(Q.state.state, 'countdown');
  const c = pinkSlipConfirmations({ name: 'Hatchback', value: 12000 }, 'Rival');
  assert.equal(c.length, 3);
  assert.match(c[1].text, /gone for good/);
  assert.equal(c[2].typed, 'Hatchback');
});

test('quit is a DNF; reset during the run keeps the clock', () => {
  const course = straight(), Q = createQuestSession({ quest: quest('sprint'), course, config });
  drive(Q, course, { speed: 30, until: 10 });
  Q.quit();
  assert.equal(Q.outcome.status, 'dnf');
  assert.equal(Q.state.state, 'failed');
});

// ---------- PlayerService: fees, rewards, progress, recordings ----------
const { harness } = await import('../harness.mjs');
const { LocalPlayerService } = await import('../../garage/player/service.js');
const { MemoryStorage } = await import('../../garage/player/storage.js');
const { MemoryRecordStore } = await import('../../quest/recordStore.js');
const { questState } = await import('../../garage/player/quests.js');
const H = await harness();
async function service() {
  let clock = 0;
  const recordings = new MemoryRecordStore(), storage = new MemoryStorage();
  const s = new LocalPlayerService({ db: H.db, storage, now: () => new Date(Date.UTC(2026, 0, 1) + (clock += 1000)).toISOString(), quests: { config, recordings } });
  await s.init();
  return { s, recordings, storage };
}
// a run of a quest, handed in: the session driven, the result built and finished through the service
async function run(s, q, course, { speed = 30, restart = false, tamper = null, recording = true } = {}) {
  const st = await s.startQuest(q, { restart });
  assert.ok(st.ok, st.error);
  const Q = createQuestSession({ quest: q, course, config });
  const R = createRecorder({ hz: 20 });
  drive(Q, course, { speed, onEvent: () => {} });
  let i = 0; for (const p of course.line.slice(0, 50)) R.sample(i++ / 20, { x: p.x, y: 0, z: p.z, q: [0, 0, 0, 1] });
  let result = buildResult({ quest: q, course, outcome: Q.outcome, car: { topSpeed: 50 }, attemptId: st.attemptId });
  if (tamper) result = tamper(result);
  return { start: st, done: await s.finishQuest(result, { quest: q, course, recording: recording ? R.finish() : null }) };
}

test('PlayerService: the fee taken at the start, refunded if it didn\'t start; restart charges again unless free', async () => {
  const { s } = await service();
  const q = quest('sprint', {}, { rating: { stars: 3, km: 4 } }), m0 = s.profile.money, fee = feeOf(q, H.db.economy);
  s.profile.xp = xpForLevel(rewardsOf(q, H.db.economy).unlockLevel, config);
  assert.ok(fee > 0, 'a Club quest has a fee');
  const a = await s.startQuest(q);
  assert.equal(s.profile.money, m0 - fee);
  assert.equal(s.profile.quests[q.id].attempts, 1);
  await s.refundQuest(a.attemptId);
  assert.equal(s.profile.money, m0);
  assert.equal(s.profile.quests[q.id].attempts, 0);
  assert.equal((await s.refundQuest(a.attemptId)).ok, false, 'not twice');
  await s.startQuest(q); await s.startQuest(q, { restart: true });
  assert.equal(s.profile.money, m0 - 2 * fee);
  s.quests.config = { ...config, restart: { free: true } };
  await s.startQuest(q, { restart: true });
  assert.equal(s.profile.money, m0 - 2 * fee);
  s.quests.config = config;
  s.profile.money = 0;
  const poor = await s.startQuest(q);
  assert.equal(poor.ok, false); assert.match(poor.error, /Entry fee/);
});

test('PlayerService: rewards once per tier, then the repeat; progress, PB, recording kept; invalid pays nothing', async () => {
  const { s, recordings } = await service();
  const course = { ...straight(), referenceTime: 70 }, q = quest('sprint');
  const base = earnings({ quest: q, outcome: { status: 'finished', medal: 'gold' }, economy: H.db.economy, config }).base;
  // ~66 s: gold (70 s)
  const m0 = s.profile.money;
  const first = (await run(s, q, course)).done;
  assert.equal(first.valid, true, first.problems?.join());
  assert.equal(first.medal, 'gold');
  assert.equal(s.profile.money - m0, base.money);
  assert.equal(s.profile.xp, base.xp);
  assert.ok(first.pb);
  const P = s.profile.quests[q.id];
  assert.equal(P.completed, true); assert.equal(P.medal, 'gold'); assert.equal(P.attempts, 1);
  assert.equal(P.bestSplits.length, 3);
  assert.ok(P.recording && await recordings.get(P.recording));
  assert.deepEqual(questState(s.profile, q.id), { state: 'completed', medal: 'gold' });
  // again, gold again: the repeat only
  const m1 = s.profile.money, again = (await run(s, q, course, { speed: 31 })).done;
  assert.equal(again.repeat, true);
  assert.ok(Math.abs(s.profile.money - m1 - base.money * config.rewards.repeat) <= 50);
  assert.equal(recordings.size, 1, 'the better run\'s recording replaced the old one');
  // slower: no PB, the recording kept
  const rec = s.profile.quests[q.id].recording;
  const slow = (await run(s, q, course, { speed: 29 })).done;
  assert.equal(slow.pb, false); assert.equal(s.profile.quests[q.id].recording, rec);
  // impossible (tampered) results pay nothing and are logged
  const m2 = s.profile.money;
  const cheat = (await run(s, q, course, { tamper: r => ({ ...r, checkpoints: r.checkpoints.map(c => ({ ...c, time: c.time / 5 })), laps: [r.rawTime / 5], rawTime: r.rawTime / 5, time: r.time / 5 }) })).done;
  assert.equal(cheat.valid, false); assert.equal(s.profile.money, m2);
  assert.equal(s.profile.questLog.at(-1).valid, false);
  assert.match(s.profile.questLog.at(-1).problems.join(), /Impossible time/);
  // a result handed in twice pays once
  const st = await s.startQuest(q);
  const Q = createQuestSession({ quest: q, course, config }); drive(Q, course, { speed: 30 });
  const res = buildResult({ quest: q, course, outcome: Q.outcome, car: { topSpeed: 50 }, attemptId: st.attemptId });
  await s.finishQuest(res, { quest: q, course });
  const m3 = s.profile.money;
  assert.equal((await s.finishQuest(res, { quest: q, course })).valid, false);
  assert.equal(s.profile.money, m3);
});

test('PlayerService: a DNF counts as an attempt, pays nothing; the map says attempted; the save keeps it', async () => {
  const { s, storage } = await service();
  const q = quest('sprint');
  const a = await s.startQuest(q);
  await s.failQuest(a.attemptId, { questId: q.id, status: 'dnf', reason: 'quit' });
  assert.deepEqual(questState(s.profile, q.id), { state: 'attempted', medal: null });
  assert.equal(questState(s.profile, 'q_other').state, 'new');
  const again = new LocalPlayerService({ db: H.db, storage, quests: { config } });
  await again.init();
  assert.equal(again.profile.quests[q.id].dnfs, 1);
  assert.equal(again.profile.questPending, undefined);
});

test('PlayerService: pink slips change hands only in a pink-slip race', async () => {
  const { s } = await service();
  await s.addMoney(1e6);
  const other = Object.keys(H.db.cars).find(c => c !== H.db.economy.startingCar && !H.db.cars[c].hidden);
  const bad = await s.awardCar(other, { attemptId: 'x' });
  assert.equal(bad.ok, false);
  s.profile.questPending = { attemptId: 'att_pink', questId: 'q', fee: 0, pinkSlip: true };
  const won = await s.awardCar(other, { attemptId: 'att_pink' });
  assert.ok(won.ok, won.error);
  const lost = await s.forfeitCar(won.won, { attemptId: 'att_pink' });
  assert.ok(lost.ok, lost.error);
  assert.equal(s.profile.cars[won.won], undefined);
  assert.ok(!Object.values(s.profile.parts).some(x => x.installedOn?.car === won.won));
});
