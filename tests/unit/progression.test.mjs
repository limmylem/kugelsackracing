// Phase 4 Step 5: difficulty, ratings, rewards by rating, levels, series and records from older versions
// of a quest. The economy simulation has its own (tests/unit/economy.test.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resample, encodeLine, at } from '../../route/geometry.js';
import { viewCourse } from '../../route/model.js';
import { createQuestSession } from '../../quest/session.js';
import { buildResult } from '../../quest/result.js';
import { routeStats } from '../../route/stats.js';
import { difficultyOf, carWarning, starsText } from '../../quest/difficulty.js';
import { rateQuest } from '../../content/rating.js';
import { rewardsOf, newItem, problems } from '../../content/quests.js';
import { seriesBonus, markOldRecords, finishAttempt, startAttempt } from '../../garage/player/quests.js';
import { xpForLevel } from '../../quest/rules.js';

const json = p => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url)));
const config = json('data/quests.json'), economy = json('data/economy.json'), classes = json('data/classes.json').classes;

// lines (metres): a straight, and a twisty narrow climb with hairpins
const straight = km => resample([{ x: 0, z: 0, h: 0, w: 12 }, { x: km * 1000, z: 0, h: 0, w: 12 }], 4);
// switchbacks: 150 m legs up a hill joined by 180° hairpins of 10 m radius, on a 5 m road
function twisty(km) {
  const pts = [];
  let x = 0, z = 0, h = 0, dir = 1, s = 0;
  while (s < km * 1000) {
    for (let d = 0; d < 150; d += 4) { pts.push({ x: x + dir * d, z, h, w: 5 }); h += 0.3; }
    x += dir * 150; s += 150;
    for (let a = 0; a <= Math.PI; a += Math.PI / 8) pts.push({ x: x + dir * 10 * Math.sin(a), z: z + 10 - 10 * Math.cos(a), h, w: 5 });
    z += 20; dir = -dir; s += Math.PI * 10;
  }
  return resample(pts, 4);
}
const route = line => ({ id: 'route_test0001', kind: 'route', course: { kind: 'p2p', length: line.at(-1).s, stats: routeStats(line, { junctions: 2 }), path: 'x', checkpoints: [] } });
const sprint = (extra = {}) => ({ ...newItem('quest', { id: 'quest_test0001', location: { lat: 0, lon: 0 }, type: 'sprint' }), route: 'route_test0001', ...extra });

test('difficulty: stars from the route, its rivals and its medals; a recommended car; a warning when mine is far below', () => {
  const easy = route(straight(2)), hard = route(twisty(6));
  const dEasy = difficultyOf(sprint(), easy.course, { config, classes }), dHard = difficultyOf(sprint(), hard.course, { config, classes });
  assert.equal(dEasy.stars, 1, JSON.stringify(dEasy));
  assert.ok(dHard.stars >= 4, JSON.stringify(dHard));
  assert.ok(dHard.parts.some(p => p.what === 'hairpins') && dHard.parts.some(p => p.what === 'narrow'));
  // rivals make it harder; so does a tight gold
  const raced = difficultyOf(sprint({ npc: { count: 7, skill: [0.7, 0.95] } }), easy.course, { config, classes });
  assert.ok(raced.points > dEasy.points && raced.stars > dEasy.stars);
  const est = easy.course.stats.estimatedTime;
  assert.ok(difficultyOf(sprint(), easy.course, { config, classes, medals: { kind: 'time', gold: est * 0.8 } }).points > dEasy.points);
  // the recommended car: more for more stars, inside the quest's class
  assert.ok(dHard.recommended > dEasy.recommended);
  const forC = difficultyOf(sprint({ entry: { classes: ['C'], minLevel: 1 } }), hard.course, { config, classes });
  assert.equal(forC.recommendedClass, 'C');
  assert.equal(carWarning(dHard, dHard.recommended, config), null);
  assert.match(carWarning(dHard, dHard.recommended * 0.6, config), /well below/);
  assert.equal(starsText(3), '★★★☆☆');
});

test('a quest\'s rating is worked out from its route (never set by hand), and its reward follows', () => {
  const r = rateQuest(sprint(), route(twisty(4)), { config, classes });
  assert.ok(r.stars >= 1 && r.stars <= 5 && Math.abs(r.km - 4) < 0.2 && r.routeVersion, JSON.stringify(r));
  assert.equal(rateQuest(sprint(), null, { config, classes }), null, 'no route: no rating');
  const easy = { ...sprint(), rating: rateQuest(sprint(), route(straight(2)), { config, classes }) };
  const hard = { ...sprint(), rating: r };
  assert.ok(rewardsOf(hard, economy).money > rewardsOf(easy, economy).money, 'harder and longer pays more');
  assert.ok(rewardsOf(hard, economy).tier >= rewardsOf(easy, economy).tier);
  // laps count in its length
  const lapped = rateQuest({ ...sprint(), params: { laps: 3 } }, { ...route(straight(2)), course: { ...route(straight(2)).course, kind: 'loop' } }, { config, classes });
  assert.ok(Math.abs(lapped.km - 6) < 0.1);
  assert.deepEqual(problems({ ...sprint(), rating: r }, { economy }).filter(p => p.field === 'rating'), []);
});

test('tiers: new players start with Rookie quests; better tiers open with levels and pay more', () => {
  const Q = economy.quests;
  assert.equal(Q.tiers[0].level, 1);
  for (let i = 1; i < Q.tiers.length; i++) assert.ok(Q.tiers[i].level > Q.tiers[i - 1].level && Q.tiers[i].feeShare >= Q.tiers[i - 1].feeShare);
  const at = (stars, cls) => rewardsOf({ ...sprint({ entry: { classes: cls ? [cls] : [], minLevel: 1 } }), rating: { stars, km: 4 } }, economy);
  assert.equal(at(1).tier, 1); assert.equal(at(2).tier, 1, 'a 2-star quest for the starter car\'s class is a Rookie one');
  assert.ok(at(5, 'S').tier === 5 && at(5, 'S').money > at(3, 'C').money && at(3, 'C').money > at(1).money);
  assert.ok(xpForLevel(Q.tiers.at(-1).level, config) > xpForLevel(Q.tiers[1].level, config));
});

// a real course (route/model.js) and a run driven along it at 30 m/s through a quest session
const P = { toXZ: (lat, lon) => [lon * 1e5, -lat * 1e5], toLatLon: (x, z) => [-z / 1e5, x / 1e5] };
function straightCourse() {
  const line = resample([{ x: 0, z: 0, h: 0, w: 10 }, { x: 2000, z: 0, h: 0, w: 10 }], 4);
  const path = encodeLine(line.map(p => { const [lat, lon] = P.toLatLon(p.x, p.z); return { lat, lon, h: 0, w: 10 }; }));
  return viewCourse({ kind: 'p2p', path, checkpoints: [{ id: 'cp1', s: 1000, width: null, required: true, timeExtension: 0, auto: true }], grid: { count: 4 }, stats: { estimatedTime: 60 } }, P);
}
function driven(quest, course, attemptId) {
  const Q = createQuestSession({ quest, course, config }), dt = 1 / 60;
  let s = course.grid.slots[0].s, moving = false;
  Q.begin({ intro: false });
  for (let i = 0; i < 400 * 60 && !['finished', 'failed'].includes(Q.state.state); i++) {
    for (const e of Q.drain()) if (e.type === 'go') moving = true;
    if (moving) s += 30 * dt;
    const p = at(course.line, s);
    Q.tick({ t: i * dt, dt, x: p.x, z: p.z, vx: p.dx * (moving ? 30 : 0), vz: p.dz * (moving ? 30 : 0), fx: p.dx, fz: p.dz, throttle: 0, drivable: true, condition: 100, impulse: 0 });
  }
  Q.drain();
  return buildResult({ quest, course, outcome: Q.outcome, car: { topSpeed: 50 }, attemptId });
}

test('a series: the bonus once, when its last quest is finished', () => {
  const q = id => ({ ...sprint(), id, rating: { stars: 2, km: 3 } });
  const quests = [q('quest_s0000001'), q('quest_s0000002'), q('quest_s0000003')];
  const S = { item: { id: 'series_t0000001', kind: 'series', name: 'Harbour run', quests: quests.map(x => x.id) }, quests };
  const b = seriesBonus(S, economy);
  assert.equal(b.money, Math.round(quests.reduce((a, x) => a + rewardsOf(x, economy).money, 0) * economy.series.moneyShare / economy.quests.roundTo) * economy.quests.roundTo);
  const p = { money: 0, xp: 0 }, course = straightCourse();
  const finish = (quest, k) => {
    startAttempt(p, { quest, fee: 0, attemptId: `a${k}`, now: '2026-10-04T12:00:00Z' });
    return finishAttempt(p, { result: driven(quest, course, `a${k}`), quest, course, config, economy, now: '2026-10-04T12:00:00Z', series: [S] });
  };
  const r1 = finish(quests[0], 1), r2 = finish(quests[1], 2);
  assert.ok(r1.valid, r1.problems?.join('; '));
  assert.deepEqual(r1.series, []); assert.deepEqual(r2.series, []);
  const r3 = finish(quests[2], 3);
  assert.equal(r3.series.length, 1); assert.equal(r3.series[0].money, b.money);
  assert.ok(p.series[S.item.id].completed);
  assert.deepEqual(finish(quests[2], 4).series, [], 'once');
});

test('a quest edited after publishing: a best on another version of its route is kept, marked as older', () => {
  const p = { quests: { quest_a0000001: { bestTime: 50, routeVersion: 'v1', oldRecord: false } } };
  assert.equal(markOldRecords(p, 'quest_a0000001', 'v1'), false, 'the same route: still its record');
  assert.equal(markOldRecords(p, 'quest_a0000001', 'v2'), true);
  assert.equal(p.quests.quest_a0000001.oldRecord, true); assert.equal(p.quests.quest_a0000001.bestTime, 50);
});
