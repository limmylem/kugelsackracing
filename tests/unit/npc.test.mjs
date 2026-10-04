// NPC racers (Phase 4 Step 4), the pure parts: the racing line (minimum curvature inside the road), the
// speed plan (grip, braking, power), seeded randomness, driver skills, NPC cars from the parts system
// within a quest's limits, the rewards and validation of a race result by place, pink slips, the AI
// reference times as medal targets. (Driving in the physics: tests/map/npc.test.ts.)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { racingLine, withPoints, referenceLine, speedPlan, carCaps, lapTime, encodeOffsets, decodeOffsets } from '../../route/racingLine.js';
import { rng, hashSeed } from '../../ai/rng.js';
import { driverParams } from '../../ai/skill.js';
import { buildNpcCar, targetRating, eligibleModels } from '../../ai/npcCars.js';
import { setupNpcs, npcSettings } from '../../race/setup.js';
import { earnings, entryReasons, medalTargets, medalOfPlace, classKey } from '../../quest/rules.js';
import { validateResult } from '../../quest/validate.js';
import { harness } from '../harness.mjs';

const cfg = JSON.parse(fs.readFileSync(new URL('../../data/npc.json', import.meta.url)));
const qcfg = JSON.parse(fs.readFileSync(new URL('../../data/quests.json', import.meta.url)));
const H = await harness();

// a road: straight, a 90° bend of 30 m radius, straight (10 m wide)
function bend({ w = 10, r = 30 } = {}) {
  const pts = [];
  for (let x = 0; x <= 200; x += 4) pts.push({ x, z: 0 });
  for (let a = 4 / r; a < Math.PI / 2; a += 4 / r) pts.push({ x: 200 + r * Math.sin(a), z: -r + r * Math.cos(a) * 1 - 0 });
  for (let z = -r; z >= -230; z -= 4) pts.push({ x: 200 + r, z });
  let s = 0;
  return pts.map((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); return { ...p, h: 0, w, s }; });
}

test('racing line: straightens the bend inside the road, a margin from the edges', () => {
  const line = bend(), rl = racingLine(line), centre = withPoints(referenceLine(line), new Float32Array(referenceLine(line).length));
  const maxK = l => Math.max(...l.points.map(p => Math.abs(p.k)));
  assert.ok(maxK(rl) < maxK(centre) * 0.95, `${maxK(rl)} vs ${maxK(centre)}`);
  // inside the road (the margin) everywhere
  for (const p of rl.points) assert.ok(Math.abs(p.d) <= 10 * 0.4 - 1.1 + 0.05, `off the road: ${p.d}`);
  // the classic line: out wide on the way in, the apex on the inside (east, then north: a left bend,
  // inside to the left, d > 0), out wide again after
  const mid = rl.points.find(p => p.x > 200 && p.z < -10 && p.z > -25), before = rl.points.find(p => p.x > 150 && p.x < 160);
  assert.ok(mid.d > 1, `apex inside: ${mid?.d}`);
  assert.ok(before.d < -1, `wide on the way in: ${before?.d}`);
  // the offsets survive saving
  const back = decodeOffsets(encodeOffsets(rl.d), rl.d.length);
  assert.ok(back.every((x, i) => Math.abs(x - rl.d[i]) <= 0.051));
});

test('racing line: a narrow street stays near the middle; the ends of a route stay central', () => {
  const rl = racingLine(bend({ w: 5 }));
  for (const p of rl.points) assert.ok(Math.abs(p.d) <= 0.7, `${p.d}`);
  const wide = racingLine(bend());
  assert.ok(Math.abs(wide.points[0].d) < 0.01 && Math.abs(wide.points.at(-1).d) < 0.01);
});

test('speed plan: corners from grip, braking zones before them, faster on the racing line, slower with less grip', () => {
  const line = bend(), rl = racingLine(line), caps = carCaps(H.garage(null, 'starter_car').stats());
  const v = speedPlan(rl, caps), corner = Math.min(...v.slice(10, v.length - 10));
  assert.ok(corner > 10 && corner < 25, `${corner}`);
  // braking: never slows faster than the car can brake
  for (let i = 0; i < v.length - 1; i++) {
    const ds = rl.points[i + 1].s - rl.points[i].s;
    if (v[i] > v[i + 1]) assert.ok(v[i] ** 2 - v[i + 1] ** 2 <= 2 * (caps.brake + 3) * ds + 1e-3);
  }
  const centre = withPoints(referenceLine(line), new Float32Array(referenceLine(line).length));
  assert.ok(lapTime(rl, v) < lapTime(centre, speedPlan(centre, caps)), 'the racing line is quicker');
  assert.ok(lapTime(rl, speedPlan(rl, caps, { corner: 0.8 })) > lapTime(rl, v), 'less grip: slower');
  // a faster car (its parts: more power) is quicker on the same line
  const apex = carCaps(H.garage(null, 'apex_v8').stats());
  assert.ok(lapTime(rl, speedPlan(rl, apex)) < lapTime(rl, v));
});

test('randomness: the same seed, the same numbers', () => {
  const a = rng(hashSeed(7, 'mara')), b = rng(hashSeed(7, 'mara')), c = rng(hashSeed(8, 'mara'));
  const A = Array.from({ length: 50 }, a), B = Array.from({ length: 50 }, b), C = Array.from({ length: 50 }, c);
  assert.deepEqual(A, B); assert.notDeepEqual(A, C);
  assert.ok(A.every(x => x >= 0 && x < 1));
});

test('skills: a better driver brakes later, corners closer to the grip, reacts faster, errs less', () => {
  const lo = driverParams({ skill: 0.1 }, cfg), hi = driverParams({ skill: 0.95 }, cfg);
  assert.ok(hi.brakingPoint > lo.brakingPoint && hi.cornerMargin > lo.cornerMargin);
  assert.ok(hi.reactionTime < lo.reactionTime && hi.mistakeRate < lo.mistakeRate && hi.lineAccuracy < lo.lineAccuracy && hi.consistency < lo.consistency);
  const aggro = driverParams({ skill: 0.5, aggression: 0.9 }, cfg), calm = driverParams({ skill: 0.5, aggression: 0.1 }, cfg);
  assert.ok(aggro.overtakeEvery < calm.overtakeEvery && aggro.defendChance > calm.defendChance);
  // each setting can be set on its own
  assert.equal(driverParams({ skill: 0.5, mistakeRate: 0 }, cfg).mistakeRate, 0);
});

test('NPC cars: built from the parts system, within the quest\'s limits, aimed at the class', () => {
  const quest = { type: 'sprint', entry: { classes: ['C'], maxPowerKw: 200 } };
  const target = targetRating({ quest, classes: H.db.classes.classes ?? H.db.classes, cfg });
  const models = eligibleModels(H.db, quest, qcfg);
  assert.ok(models.length > 0 && !models.includes('starter_car'));
  for (const carId of models) {
    const car = buildNpcCar(H.db, { carId, quest, target, seed: 3, cfg, qcfg });
    assert.equal(car.className, 'C', carId);
    assert.ok(car.kw <= 200 + 1e-6, `${carId} ${car.kw} kW`);
    assert.ok(car.rating <= target + cfg.cars.tolerance, `${carId} ${car.rating} vs ${target}`);
    assert.ok(car.garage.drivable().ok);
  }
  // the same seed, the same build
  const a = buildNpcCar(H.db, { carId: models[0], quest, target, seed: 9, cfg, qcfg }), b = buildNpcCar(H.db, { carId: models[0], quest, target, seed: 9, cfg, qcfg });
  assert.deepEqual(a.parts, b.parts);
  // an open quest: the player's car's rating
  assert.equal(targetRating({ quest: { entry: {} }, classes: H.db.classes.classes ?? H.db.classes, cfg, playerRating: 430 }), 430);
});

test('who races: the quest\'s settings, the seed picks the drivers, their skill inside the range', () => {
  const course = { grid: { slots: Array.from({ length: 8 }, (_, i) => ({ i })) } };
  const quest = { id: 'q', type: 'sprint', entry: { classes: ['D'] }, npc: { count: 5, skill: [0.2, 0.6] } };
  const a = setupNpcs({ db: H.db, quest, course, cfg, qcfg, seed: 4 }), b = setupNpcs({ db: H.db, quest, course, cfg, qcfg, seed: 4 }), c = setupNpcs({ db: H.db, quest, course, cfg, qcfg, seed: 5 });
  assert.equal(a.length, 5);
  assert.deepEqual(a.map(n => n.profile.id), b.map(n => n.profile.id));
  assert.notDeepEqual(a.map(n => n.profile.id), c.map(n => n.profile.id));
  for (const n of a) { assert.ok(n.params.skill >= 0.2 && n.params.skill <= 0.6); assert.equal(n.build.className, 'D'); }
  // picked drivers; the most there can be; a pink slip: one rival, in the car at stake, no rubber-banding
  const picked = setupNpcs({ db: H.db, quest: { ...quest, npc: { count: 2, drivers: ['ana_lima', 'tom_hale'], skill: [0, 1] } }, course, cfg, qcfg, seed: 1 });
  assert.deepEqual(picked.map(n => n.profile.id), ['ana_lima', 'tom_hale']);
  assert.equal(npcSettings({ type: 'sprint', npc: { count: 99 } }, cfg).count, cfg.race.maxNpcs);
  const pink = { id: 'p', type: 'pink_slip', entry: {}, params: { opponentCar: 'kaze_gt' } };
  assert.equal(npcSettings(pink, cfg).count, 1); assert.equal(npcSettings(pink, cfg).rubberBand, false);
  assert.equal(setupNpcs({ db: H.db, quest: pink, course, cfg, qcfg, seed: 1 })[0].build.carId, 'kaze_gt');
});

test('race rewards: the place is the medal, once per tier; lower places a share; pink slips pay no money', () => {
  const economy = H.db.economy, q = { kind: 'quest', type: 'sprint', rewards: { tier: 'extreme' }, entry: {} };
  const base = earnings({ quest: q, outcome: { status: 'finished', medal: 'gold' }, economy, config: qcfg }).base.money;
  assert.equal(medalOfPlace(1, qcfg), 'gold'); assert.equal(medalOfPlace(3, qcfg), 'bronze'); assert.equal(medalOfPlace(4, qcfg), null);
  const pay = (place, progress = {}) => earnings({ quest: q, outcome: { status: 'finished', medal: medalOfPlace(place, qcfg), place }, progress, economy, config: qcfg }).money;
  assert.equal(pay(1), base);
  assert.ok(pay(5) < pay(4) && pay(4) > 0);
  assert.ok(pay(1, { paidShare: 1 }) > pay(6, { paidShare: 1, finishPaid: true }), 'the repeat: by place');
  assert.equal(earnings({ quest: { ...q, type: 'pink_slip' }, outcome: { status: 'finished', place: 1, medal: 'gold' }, economy, config: qcfg }).money, 0);
});

test('race results: the place must be what the times say', () => {
  const quest = { id: 'q', type: 'sprint', updated: 'u', params: { laps: 1 } };
  const course = { loop: false, length: 1000, version: 'v', grid: { startS: 0, finishS: 1000 }, gates: [] };
  const r = { questId: 'q', questVersion: 'u', routeVersion: 'v', status: 'finished', type: 'sprint', checkpoints: [], laps: [60], rawTime: 60, time: 60, penalties: [], car: { topSpeed: 50 },
    place: 2, field: [{ id: 1, status: 'finished', time: 58 }, { id: 0, player: true, status: 'finished', time: 60 }, { id: 2, status: 'finished', time: 63 }] };
  assert.equal(validateResult(r, { quest, course, config: qcfg }).ok, true);
  assert.match(validateResult({ ...r, place: 1 }, { quest, course, config: qcfg }).problems[0], /place/);
});

test('pink slips: never the starter car; the confirmation names the rival', () => {
  const quest = { type: 'pink_slip', entry: {} };
  const R = entryReasons({ quest, car: { carId: 'starter_car', className: 'D', kw: 85, kg: 1150 }, player: { money: 0, xp: 0 }, config: qcfg, economy: H.db.economy });
  assert.ok(R.some(r => r.code === 'stake' && /starter car/.test(r.text)));
  assert.equal(entryReasons({ quest, car: { carId: 'kaze_gt', className: 'C', kw: 151, kg: 1250 }, player: { money: 0, xp: 0 }, config: qcfg, economy: H.db.economy }).length, 0);
});

test('AI reference times: the medal targets for the quest\'s class', () => {
  const quest = { type: 'sprint', entry: { classes: ['D'] }, params: {} };
  const course = { loop: false, aiTimes: { D: { low: 90, medium: 80, high: 72 } }, stats: { estimatedTime: 100 } };
  const T = medalTargets(quest, course, qcfg);
  assert.deepEqual([T.gold, T.silver, T.bronze], [72, 80, 90]);
  assert.equal(classKey({ entry: {} }), 'open');
  assert.equal(medalTargets({ ...quest, entry: { classes: ['C'] } }, course, qcfg).gold, 100);
});
