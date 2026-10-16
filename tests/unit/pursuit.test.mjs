// Police pursuits (docs/PURSUIT.md), pure: the director (heat, sight, the cooldown and its search area, escapes, busts,
// more units, roadblocks and spikes, who chases whom), where a police car aims (pursue, ram, PIT, box) and its small
// rubber band, the pursuit quest type in the session (escaped, busted, at the drop; the score), the server's check of
// a result, and the bust fine taken from the profile.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDirector, levelOf, unitsWanted, targetScore } from '../../pursuit/director.js';
import { aimFor, rubberBand } from '../../pursuit/police.js';
import { viewCourse } from '../../route/model.js';
import { encodeLine, resample, at } from '../../route/geometry.js';
import { createQuestSession } from '../../quest/session.js';
import { buildResult } from '../../quest/result.js';
import { validateResult } from '../../quest/validate.js';
import { maxPursuitScore } from '../../quest/types/pursuit.js';
import { startAttempt, failAttempt } from '../../garage/player/quests.js';
import { bustFineOf, problems } from '../../content/quests.js';
import { medalTargets } from '../../quest/rules.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../../data/pursuit.json', import.meta.url)));
const qcfg = JSON.parse(fs.readFileSync(new URL('../../data/quests.json', import.meta.url)));
const economy = JSON.parse(fs.readFileSync(new URL('../../data/economy.json', import.meta.url)));
const P = { toXZ: (lat, lon) => [lon * 1e5, -lat * 1e5], toLatLon: (x, z) => [-z / 1e5, x / 1e5] };
function makeCourse(pts) {
  const line = resample(pts.map(([x, z]) => ({ x, z, h: 0, w: 10 })), 4);
  const path = encodeLine(line.map(p => { const [lat, lon] = P.toLatLon(p.x, p.z); return { lat, lon, h: 0, w: 10 }; }));
  return viewCourse({ kind: 'p2p', path, checkpoints: [{ id: 'cp1', s: 500, width: null, required: true, timeExtension: 0, auto: true }], grid: { count: 4 }, stats: { estimatedTime: 60 } }, P);
}
const pursuitQuest = (params = {}) => ({ id: 'q_pursuit', kind: 'quest', type: 'pursuit', version: 1, updated: '2026-10-16T00:00:00Z', route: 'r1', entry: { classes: [], minLevel: 1 }, name: 'Getaway', location: { lat: 0, lon: 0, heading: 0 }, params: { objective: 'escape', startHeat: 1, maxHeat: 3, scoreTarget: 2500, ...params } });

// a director, a player and a unit: dt ticks with what each can see
function world({ mission = {}, seen = () => true, speed = 20 } = {}) {
  const D = createDirector({ cfg, mission, rng: () => 0.5 });
  D.addUnit(1, { kind: 'chase', target: 0 });
  const me = { id: 0, x: 0, z: 0, vx: speed, vz: 0, speed, drivable: true, condition: 100 }, unit = { id: 1, x: -40, z: 0, vx: speed, vz: 0, speed, drivable: true };
  const step = (n, dt = 1 / 60, o = {}) => { const ev = []; let out; for (let i = 0; i < n; i++) { me.x += me.vx * dt; me.z += me.vz * dt; unit.x += unit.vx * dt; unit.z += unit.vz * dt; out = D.tick({ dt, players: [me], units: [unit], los: () => seen(D.state.t), hits: o.hits?.(i) ?? [] }); ev.push(...D.drain()); } return { ev, out }; };
  return { D, me, unit, step };
}

test('heat: rises while they can see you (time, hits, recklessness), never past the mission\'s most; its level is the whole number', () => {
  assert.equal(levelOf(1.99), 1); assert.equal(levelOf(3.2), 3); assert.equal(levelOf(9), 5);
  const { D, step } = world({ mission: { startHeat: 1, maxHeat: 2 } });
  step(60 * 10);
  assert.ok(D.state.heat > 1.1 && D.state.heat < 1.2, `10 s seen: ${D.state.heat}`);
  // a hard hit on a police car is worth more than seconds of being chased
  const before = D.state.heat;
  step(1, 1 / 60, { hits: () => [{ unit: 1, player: 0, strength: 6 }] });
  assert.ok(D.state.heat - before >= cfg.heat.perHit * 6 - 1e-9);
  const { ev } = step(60 * 200, 1 / 60, { hits: i => i % 60 === 0 ? [{ unit: 1, player: 0, strength: 10 }] : [] });
  assert.equal(D.state.level, 2, 'capped at the mission\'s most heat');
  assert.ok(D.state.heat < 3);
  assert.ok(ev.some(e => e.type === 'heat' && e.level === 2));
  // (none of it while nobody can see you)
  const W = world({ seen: () => false });
  W.step(60 * 1);
  assert.equal(W.D.state.heat, 1);
});

test('more units at more heat (co-op: more for more players), asked for one at a time', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(l => unitsWanted(cfg, l)), cfg.levels.map(L => L.units));
  assert.ok(unitsWanted(cfg, 3, { coop: true, players: 3 }) > unitsWanted(cfg, 3));
  assert.equal(unitsWanted(cfg, 5, { maxUnits: 2 }), 2);
  const { D, step } = world({ mission: { startHeat: 3, maxHeat: 3 } });
  const { out } = step(1);
  assert.deepEqual(out.requests.filter(r => r.kind === 'unit').map(r => r.target), [0]);
  // (one pending: not asked again until it's in or has failed, and not before spawnEvery)
  const again = step(30).out;
  assert.equal(again.requests.filter(r => r.kind === 'unit').length, 0);
  D.spawnFailed();
  const later = step(60 * cfg.police.spawnEvery).out;
  assert.ok(later.requests.some(r => r.kind === 'unit') || D.state.pending > 0);
});

test('escape: out of sight starts the cooldown and its search area round where you were last seen; out of it in time, escaped', () => {
  let hidden = false;
  const { D, me, step } = world({ seen: () => !hidden });
  step(60);
  assert.equal(D.state.phase, 'pursuit');
  hidden = true;
  const lost = step(Math.ceil(60 * (cfg.police.lostGrace + 0.4))).ev;   // (a sight line's looked at every 0.2 s)
  assert.equal(D.state.phase, 'cooldown');
  const C = D.status.cooldown, L = cfg.levels[0];
  assert.ok(lost.some(e => e.type === 'lost'));
  assert.equal(C.radius, L.searchRadius); assert.equal(C.total, L.cooldown);
  assert.ok(Math.hypot(C.x - me.x, C.z - me.z) < 40, 'centred where you were last seen');
  // driving on at 20 m/s: out of a 180 m circle in about 9 s, before its 12 s are up
  const { ev } = step(60 * 15);
  assert.ok(ev.some(e => e.type === 'escaped' && e.how === 'left the area'));
  assert.equal(D.state.phase, 'escaped');
  assert.ok(D.status.units.every(u => u.mode === 'leave'), 'the police give up');
});

test('the cooldown: spotted again, it starts over; run out inside the area, they close in (or, set so, you got away)', () => {
  let hidden = true;
  const W = world({ seen: () => !hidden, speed: 0 });
  W.step(Math.ceil(60 * (cfg.police.lostGrace + 0.5)));
  assert.equal(W.D.state.phase, 'cooldown');
  hidden = false;
  const { ev } = W.step(20);
  assert.ok(ev.some(e => e.type === 'spotted'));
  assert.equal(W.D.state.phase, 'pursuit');
  // parked inside: the time runs out
  hidden = true;
  const sat = W.step(Math.ceil(60 * (cfg.police.lostGrace + cfg.levels[0].cooldown + 1))).ev;
  assert.ok(sat.some(e => e.type === 'reacquired'));
  assert.notEqual(W.D.state.phase, 'escaped');
  const E = world({ seen: () => false, speed: 0, mission: { timerEnds: 'escape' } });
  E.D.state.lastSeen = { x: 0, z: 0, player: 0 };
  const laid = E.step(Math.ceil(60 * (cfg.police.lostGrace + cfg.levels[0].cooldown + 1))).ev;
  assert.ok(laid.some(e => e.type === 'escaped' && e.how === 'laid low'));
});

test('busted: slow with a unit on you for long enough (the meter falls back when you get going), or the car disabled', () => {
  const W = world({ speed: 0 });
  W.unit.x = -5;
  const { ev } = W.step(Math.ceil(60 * (cfg.bust.seconds + 0.2)));
  assert.ok(ev.some(e => e.type === 'busting'));
  assert.ok(ev.some(e => e.type === 'busted' && e.why === 'stopped'));
  assert.equal(W.D.status.players[0].busted, true);
  // half the meter, then away: it falls back
  const M = world({ speed: 0 });
  M.unit.x = -5;
  M.step(Math.ceil(60 * cfg.bust.seconds / 2));
  const half = M.D.status.players[0].bust;
  Object.assign(M.me, { vx: 30, speed: 30 });
  M.step(60);
  assert.ok(M.D.status.players[0].bust < half, 'it falls back once you get going');
  assert.equal(M.D.status.players[0].busted, false);
  // a car that can't drive: busted once it's been that way a moment
  const X = world();
  X.me.drivable = false;
  const out = X.step(Math.ceil(60 * (cfg.bust.disabledSeconds + 0.1))).ev;
  assert.ok(out.some(e => e.type === 'busted' && e.why === 'disabled'));
});

test('unit modes: pursue in sight, ram close at heat 2, PIT on a rear corner at speed at heat 3, alerted out of sight; a box-in round a slow car', () => {
  const W = world({ mission: { startHeat: 1, maxHeat: 1 } });
  W.step(31);
  assert.equal(W.D.status.units[0].mode, 'pursue');
  const R = world({ mission: { startHeat: 2, maxHeat: 2 } });
  R.unit.x = -15;
  R.step(31);
  assert.equal(R.D.status.units[0].mode, 'ram');
  const T = world({ mission: { startHeat: 3, maxHeat: 3 }, speed: 25 });
  T.unit.x = -9; T.unit.z = 2;
  T.step(31);
  assert.equal(T.D.status.units[0].mode, 'pit');
  const A = world({ seen: t => t < 0.3 });
  A.unit.x = -150;
  A.step(60);
  assert.equal(A.D.status.units[0].mode, 'alerted');
  // three units round a slow car at heat 3: the nearest each to a slot — ahead, left, right
  const B = createDirector({ cfg, mission: { startHeat: 3, maxHeat: 3 }, rng: () => 0.5 });
  const units = [{ id: 1, x: 8, z: 0 }, { id: 2, x: 0, z: -6 }, { id: 3, x: 0, z: 6 }].map(u => ({ ...u, vx: 5, vz: 0, speed: 5, drivable: true }));
  for (const u of units) B.addUnit(u.id, { kind: 'chase', target: 0 });
  B.tick({ dt: 0.6, players: [{ id: 0, x: 0, z: 0, vx: 5, vz: 0, speed: 5, drivable: true, condition: 100 }], units, los: () => true });
  const modes = B.status.units.map(u => `${u.mode}:${u.slot}`).sort();
  assert.deepEqual(modes, ['box:ahead', 'box:left', 'box:right']);
});

test('roadblocks from heat 4, spikes at 5 (when the mission allows them); a roadblock\'s cars wait until you\'re near', () => {
  const W = world({ mission: { startHeat: 5, maxHeat: 5 } });
  const all = [];
  for (let i = 0; i < 60 * 40; i++) { const { out } = W.step(1); all.push(...out.requests); }
  assert.ok(all.some(r => r.kind === 'roadblock'));
  assert.ok(all.some(r => r.kind === 'spikes'));
  const N = world({ mission: { startHeat: 5, maxHeat: 5, roadblocks: false, spikes: false } });
  const none = [];
  for (let i = 0; i < 60 * 40; i++) none.push(...N.step(1).out.requests);
  assert.ok(!none.some(r => r.kind === 'roadblock' || r.kind === 'spikes'));
  const B = createDirector({ cfg, mission: { startHeat: 4, maxHeat: 4 } });
  B.addUnit(7, { kind: 'block', target: 0, joinAt: 100 });
  const tick = x => B.tick({ dt: 0.6, players: [{ id: 0, x, z: 0, vx: 20, vz: 0, speed: 20, drivable: true }], units: [{ id: 7, x: 300, z: 0, vx: 0, vz: 0, speed: 0, drivable: true }], los: () => true });
  tick(0);
  assert.equal(B.status.units[0].mode, 'block');
  tick(300 - cfg.roadblock.joinM + 5);
  assert.notEqual(B.status.units[0].mode, 'block', 'it joins the chase once you\'re near');
});

test('co-op targeting: near, seen, damaged and carrying score; units spread out over the players', () => {
  const W = cfg.targeting, base = { d: 50, sight: 200, seen: true, condition: 100 };
  assert.ok(targetScore(W, { ...base, carrying: true }) > targetScore(W, base));
  assert.ok(targetScore(W, { ...base, condition: 40 }) > targetScore(W, base));
  assert.ok(targetScore(W, { ...base, d: 20 }) > targetScore(W, base));
  assert.ok(targetScore(W, { ...base, share: 1 }) < targetScore(W, base));
  const D = createDirector({ cfg, mission: { coop: true, players: 2, startHeat: 1 }, rng: () => 0.5 });
  const units = [1, 2, 3, 4].map(id => ({ id, x: 0, z: id * 3, vx: 0, vz: 0, speed: 0, drivable: true }));
  for (const u of units) D.addUnit(u.id, { kind: 'chase' });
  D.tick({ dt: 0.6, players: [{ id: 'a', x: 50, z: 0, vx: 10, vz: 0, speed: 10, drivable: true }, { id: 'b', x: -50, z: 0, vx: -10, vz: 0, speed: 10, drivable: true }], units, los: () => true });
  const on = id => D.status.units.filter(u => u.target === id).length;
  assert.equal(on('a'), 2); assert.equal(on('b'), 2);
});

test('where a police car aims: on your bumper, through you to ram, your rear corner for a PIT, its slot of a box; its rubber band is small', () => {
  const me = { x: -30, z: 0 }, tg = { x: 0, z: 0, vx: 20, vz: 0, speed: 20 }, D = cfg.driving;
  const p = aimFor('pursue', me, tg, null, D);
  assert.ok(p.x > 0 && p.speed > 20, 'ahead of where you are, faster than you');
  assert.ok(aimFor('ram', { x: -10, z: 0 }, tg, null, D).speed >= 20 + D.ramClosingKmh / 3.6 - 1e-9);
  // lining up on the left rear corner (x east, z south: the left of a car going east is −z), then turning in across it
  const line = aimFor('pit', { x: -20, z: -5 }, tg, 'left', D);
  assert.ok(line.z < 0);
  const turn = aimFor('pit', { x: -D.pit.behind, z: -D.pit.side }, tg, 'left', D);
  assert.ok(turn.z > 0, 'turning in: aiming across the target');
  const ahead = aimFor('box', { x: 7, z: 0 }, tg, 'ahead', D);
  assert.ok(ahead.speed < 20, 'in its slot ahead: slower than you — the box closes');
  const R = D.rubberBand;
  assert.equal(rubberBand(R, 1000), R.max); assert.equal(rubberBand(R, 0), -R.max);
  assert.ok(Math.abs(rubberBand(R, (R.far + R.near) / 2)) < 1e-9);
  assert.ok(R.max <= 0.1, 'small');
});

// the session with a pursuit, its director's status made up tick by tick
function run(statusAt, { params = {}, until = 120, path = s => s, speed = 30 } = {}) {
  const course = makeCourse([[0, 0], [3000, 0]]), Q = createQuestSession({ quest: pursuitQuest(params), course, config: qcfg, car: { topSpeed: 60 } });
  Q.begin({ intro: true });
  const ev = [];
  let s = 0, moving = false;
  const dt = 1 / 60;
  for (let i = 0; i < until * 60 && !['finished', 'failed'].includes(Q.state.state); i++) {
    for (const e of Q.drain()) { ev.push(e); if (e.type === 'place') s = e.at; if (e.type === 'go') moving = true; }
    const t = i * dt;
    if (moving) s += speed * dt;
    const p = at(course.line, Math.min(course.length, path(s)));
    Q.state.pursuitNow = statusAt(t, Q);
    Q.tick({ t, dt, x: p.x, z: p.z, vx: speed, vz: 0, fx: 1, fz: 0, throttle: 1, drivable: true, condition: 100 });
  }
  ev.push(...Q.drain());
  return { Q, ev, course };
}
const status = (o = {}) => ({ heat: 1.2, level: 1, maxHeat: 3, phase: 'pursuit', cooldown: null, disabled: 0, players: [{ id: 0, bust: 0, busted: false, seen: true }], units: [{ id: 1, mode: 'pursue' }], ...o });

test('the pursuit quest: no fly-along; rolling from along the route; escaped → finished, with a score for the chase and the escape', () => {
  const { Q, ev } = run(t => status(t > 20 ? { phase: 'escaped', level: 2 } : t > 12 ? { phase: 'cooldown', level: 2, cooldown: { left: 5, total: 15, x: 0, z: 0, radius: 200 } } : { level: t > 6 ? 2 : 1 }));
  assert.ok(!ev.some(e => e.type === 'intro'), 'no fly-along');
  const place = ev.find(e => e.type === 'place');
  assert.ok(place.rolling && place.at > Q.state.course.grid.startS, 'room behind for the police');
  assert.equal(Q.state.state, 'finished');
  const o = Q.outcome;
  assert.ok(o.pursuit.escaped && o.pursuit.heatMax === 2);
  assert.ok(o.score > qcfg.pursuit.escapeBonus * 2 && o.score <= maxPursuitScore(qcfg, { seconds: o.pursuit.seconds, heat: 2, disabled: 0 }));
  assert.ok(ev.some(e => e.type === 'pursuit-lost') && ev.some(e => e.type === 'pursuit-escaped'));
  assert.equal(Q.hud().next, null, 'no arrow: anywhere will do');
  assert.equal(Q.hud().panel.kind, 'pursuit');
  // medals are the score's
  assert.equal(medalTargets(pursuitQuest(), null, qcfg).kind, 'score');
});

test('the pursuit quest: busted → failed (its outcome says so); a disabled unit scores; at the drop → finished (lose them first, if it says so)', () => {
  const B = run(t => status(t > 5 ? { players: [{ id: 0, bust: 1, busted: true, why: 'stopped' }] } : {}));
  assert.equal(B.Q.state.state, 'failed');
  assert.equal(B.Q.outcome.reason, 'busted');
  assert.equal(B.Q.outcome.pursuit.busted, 'stopped');
  const U = run(t => status(t > 3 ? { disabled: 1 } : {}), { until: 6 });
  assert.equal(U.Q.state.chase.disabled, 1);
  // the drop: the route's finish
  const R = run(() => status(), { params: { objective: 'destination' }, until: 200, speed: 40 });
  assert.equal(R.Q.state.state, 'finished');
  assert.ok(R.Q.outcome.pursuit.reached);
  assert.ok(R.Q.hud().next != null || R.Q.state.state === 'finished');
  const F = run(t => status(t > 60 ? { phase: 'escaped' } : {}), { params: { objective: 'destination', escapeFirst: true }, until: 150, speed: 60 });
  assert.ok(F.ev.some(e => e.type === 'pursuit-not-yet'), 'at the drop with them still on you: not yet');
  assert.equal(F.Q.state.state, 'finished');
  assert.ok(F.Q.outcome.pursuit.escaped && F.Q.outcome.pursuit.reached);
});

test('the server\'s check of a pursuit result: a real one passes; a padded score, too much heat or no escape doesn\'t', () => {
  const { Q, course } = run(t => status(t > 20 ? { phase: 'escaped', level: 2 } : { level: t > 6 ? 2 : 1 }));
  const quest = pursuitQuest(), result = buildResult({ quest, course, outcome: Q.outcome, car: { topSpeed: 60 }, attemptId: 'a1' });
  assert.deepEqual(validateResult(result, { quest, course, config: qcfg }).problems, []);
  const bad = patch => validateResult({ ...result, ...patch, pursuit: { ...result.pursuit, ...(patch.pursuit ?? {}) } }, { quest, course, config: qcfg });
  assert.ok(!bad({ score: result.score * 10 }).ok, 'a padded score');
  assert.ok(!bad({ pursuit: { heatMax: 5 } }).ok, 'more heat than the mission allows');
  assert.ok(!bad({ pursuit: { escaped: false } }).ok, 'no escape');
  assert.ok(!bad({ rawTime: 2, time: 2 }).ok, 'too short');
  assert.ok(!bad({ pursuit: { disabled: 999 } }).ok);
});

test('the bust fine: worked out from the quest when it starts, taken when busted (never more than there is), not for running out of time', () => {
  const q = pursuitQuest({ bustPenalty: 900 });
  assert.equal(bustFineOf(q, economy, qcfg), 900);
  assert.ok(bustFineOf(pursuitQuest(), economy, qcfg) >= qcfg.pursuit.fine.min);
  assert.equal(bustFineOf({ ...q, type: 'sprint' }, economy, qcfg), 0);
  const p = { money: 5000, quests: {} };
  startAttempt(p, { quest: q, fee: 100, attemptId: 'a1', now: 't', fine: 900 });
  assert.equal(failAttempt(p, { attemptId: 'a1', questId: q.id, status: 'failed', reason: 'busted', now: 't' }).fine, 900);
  assert.equal(p.money, 4100);
  startAttempt(p, { quest: q, fee: 100, attemptId: 'a2', now: 't', fine: 900 });
  assert.equal(failAttempt(p, { attemptId: 'a2', questId: q.id, status: 'failed', reason: 'time', now: 't' }).fine, 0);
  const poor = { money: 300, quests: {} };
  startAttempt(poor, { quest: q, fee: 0, attemptId: 'b', now: 't', fine: 900 });
  failAttempt(poor, { attemptId: 'b', questId: q.id, status: 'failed', reason: 'busted', now: 't' });
  assert.equal(poor.money, 0);
  // the editor's checks
  assert.ok(problems({ ...pursuitQuest({ startHeat: 4, maxHeat: 2 }) }, { route: {} }).some(x => x.field === 'params.maxHeat'));
});

test('the intro cinematic: its shots as data — eased curves round the cars, ending on the chase camera; the throttle schedule', async () => {
  const { cinematicCamera, catmullRom, throttleAt, EASE, shotAt } = await import('../../play/cinematic.js');
  const cine = JSON.parse(fs.readFileSync(new URL('../../data/cinematics.json', import.meta.url)));
  for (const [name, def] of Object.entries(cine)) {
    if (name.startsWith('_')) continue;
    assert.equal(def.shots[0].from, 0, `${name} starts at 0`);
    def.shots.forEach((s, i) => { if (i) assert.equal(s.from, def.shots[i - 1].to, `${name}: shot ${i} follows on`); });
    assert.equal(def.shots.at(-1).to, def.seconds);
    assert.equal(def.shots.at(-1).path.at(-1), 'chase', `${name} hands over on the chase camera`);
  }
  assert.deepEqual(catmullRom([[0, 0, 0], [10, 0, 0]], 0), [0, 0, 0]);
  assert.deepEqual(catmullRom([[0, 0, 0], [10, 0, 0], [10, 10, 0]], 1), [10, 10, 0]);
  for (const e of Object.values(EASE)) { assert.equal(e(0), 0); assert.equal(e(1), 1); }
  assert.equal(throttleAt([[0, 0.5], [1, 1]], -1), 0.5); assert.equal(throttleAt([[0, 0.5], [1, 1]], 5), 1);
  const def = cine.pursuit_intro, pose = (x, z) => ({ p: [x, 0, z], f: [0, 0, 1], l: [1, 0, 0] });
  const chase = { p: [0, 3, -8], look: [0, 1, 10], fov: 60 }, subjects = { player: pose(0, 0), police: pose(0, -20) };
  // (the first shot round the police car; at the end, exactly the chase camera: no cut at the handover)
  const a = cinematicCamera(def, 0, { subjects, chase });
  assert.equal(a.shot.subject, 'police');
  assert.ok(Math.hypot(a.p[0] - 0, a.p[2] + 20) < 10);
  const end = cinematicCamera(def, def.seconds - 1e-6, { subjects, chase });
  assert.ok(Math.hypot(end.p[0] - chase.p[0], end.p[1] - chase.p[1], end.p[2] - chase.p[2]) < 0.05);
  assert.ok(Math.abs(end.fov - 60) < 0.1);
  // (right is −left: a point to the right of a car facing +z with +x on its left is at −x)
  const s = { ...def, shots: [{ from: 0, to: 1, subject: 'player', path: [[2, 0, 0]], look: [0, 0, 1], fov: [40, 40] }] };
  assert.deepEqual(cinematicCamera(s, 0.5, { subjects, chase }).p, [-2, 0, 0]);
  assert.equal(shotAt(def, 3).subject, 'player');
});

test('a cinematic start: held until the game lets it go, no 3-2-1 or jump start, GO when the cinematic says (the clock from then), the car not set going', () => {
  const course = makeCourse([[0, 0], [3000, 0]]), Q = createQuestSession({ quest: pursuitQuest(), course, config: qcfg, car: { topSpeed: 60 }, startMode: 'cinematic' });
  Q.begin();
  const place = Q.drain().find(e => e.type === 'place');
  assert.ok(place.cinematic && !place.rolling && place.at > course.grid.startS);
  const ev = [];
  for (let i = 0; i < 600; i++) { const t = i / 60; if (i === 300) Q.setGo(t); Q.state.pursuitNow = status(); Q.tick({ t, dt: 1 / 60, x: 100 + t * 10, z: 0, vx: 10, vz: 0, fx: 1, fz: 0, throttle: 1, drivable: true, condition: 100 }); ev.push(...Q.drain()); }
  assert.ok(!ev.some(e => e.type === 'count' || e.type === 'jump'), 'no 3-2-1, no jump start under full throttle');
  const go = ev.find(e => e.type === 'go');
  assert.ok(go?.cinematic && go.speed === 0, 'GO hands the car over as it is');
  assert.ok(Math.abs(Q.state.t0 - 5) < 1e-9, 'the clock from GO');
});

test('a police car feels its way round something solid just ahead (the road data running through a fence)', async () => {
  const { avoid } = await import('../../pursuit/police.js');
  assert.deepEqual(avoid({ centre: 14, left: 14, right: 14 }, 20, 0.1), { steer: 0.1, cap: Infinity });
  const r = avoid({ centre: 3, left: 14, right: 2 }, 15, 0);
  assert.ok(r.steer > 0.2, 'to the left: more room there');
  assert.ok(r.cap < 8, 'and slower');
  assert.ok(avoid({ centre: 3, left: 2, right: 14 }, 15, 0).steer < -0.2);
});

test('co-op: a convoy fails only when everyone\'s busted (a busted player back in after the respawn, or watching)', async () => {
  const { createCoopMission } = await import('../../pursuit/coop.js');
  const st = busted => ({ phase: 'pursuit', level: 2, players: ['a', 'b'].map(id => ({ id, busted: busted.includes(id) })) });
  const M = createCoopMission({ cfg, mission: { kind: 'convoy', players: ['a', 'b'], respawn: 2 } });
  const pl = [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 50, z: 0 }], revived = [];
  let ev = M.tick({ dt: 0.1, players: pl, status: st(['a']), revive: id => revived.push(id) });
  assert.ok(ev.some(e => e.type === 'coop-busted' && e.player === 'a' && e.respawn === 2));
  assert.equal(M.status.done, null, 'b is still free');
  for (let i = 0; i < 25; i++) ev = M.tick({ dt: 0.1, players: pl, status: st([]), revive: id => revived.push(id) });
  assert.deepEqual(revived, ['a']);
  M.tick({ dt: 0.1, players: pl, status: st(['a', 'b']) });
  assert.equal(M.status.done, null, 'busted together, both respawning: not over yet');
  const S = createCoopMission({ cfg, mission: { kind: 'convoy', players: ['a', 'b'], busted: 'spectate' } });
  S.tick({ dt: 0.1, players: pl, status: st(['a', 'b']) });
  assert.equal(S.status.done.status, 'failed');
  const E = createCoopMission({ cfg, mission: { kind: 'convoy', players: ['a', 'b'] } });
  E.tick({ dt: 0.1, players: pl, status: { ...st([]), phase: 'escaped' } });
  assert.equal(E.status.done.status, 'finished');
});

test('co-op getaway: the carrier busted drops the goods; a teammate picks them up and takes them to the drop', async () => {
  const { createCoopMission } = await import('../../pursuit/coop.js');
  const M = createCoopMission({ cfg, mission: { kind: 'getaway', players: ['a', 'b'], destination: { x: 500, z: 0 }, busted: 'spectate' } });
  assert.equal(M.status.carrier, 'a');
  const st = b => ({ phase: 'pursuit', level: 1, players: [{ id: 'a', busted: b }, { id: 'b', busted: false }] });
  let ev = M.tick({ dt: 0.1, players: [{ id: 'a', x: 100, z: 0 }, { id: 'b', x: 140, z: 0 }], status: st(true) });
  assert.ok(ev.some(e => e.type === 'coop-drop'));
  assert.deepEqual(M.status.goods, { x: 100, z: 0 });
  ev = M.tick({ dt: 0.1, players: [{ id: 'a', x: 100, z: 0 }, { id: 'b', x: 102, z: 0 }], status: st(true) });
  assert.ok(ev.some(e => e.type === 'coop-pickup' && e.player === 'b'));
  ev = M.tick({ dt: 0.1, players: [{ id: 'a', x: 100, z: 0 }, { id: 'b', x: 499, z: 0 }], status: st(true) });
  assert.equal(M.status.done.status, 'finished');
  assert.equal(M.status.done.reason, 'delivered');
});

test('co-op split up: each to their own drop; the reward shared, or split by each one\'s part', async () => {
  const { createCoopMission } = await import('../../pursuit/coop.js');
  const drops = [{ x: 300, z: 0 }, { x: -300, z: 0 }];
  const M = createCoopMission({ cfg, mission: { kind: 'split', players: ['a', 'b'], drops, rewards: 'split' } });
  const st = { phase: 'pursuit', level: 2, players: [{ id: 'a', busted: false }, { id: 'b', busted: false }] };
  for (let i = 0; i < 20; i++) M.tick({ dt: 0.5, players: [{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 0, z: 0 }], status: st });
  M.tick({ dt: 0.1, players: [{ id: 'a', x: 300, z: 0 }, { id: 'b', x: 0, z: 0 }], status: st });
  assert.equal(M.status.done, null, 'b isn\'t at its drop yet');
  for (let i = 0; i < 10; i++) M.tick({ dt: 0.5, players: [{ id: 'a', x: 300, z: 0 }, { id: 'b', x: 0, z: 0 }], status: st });
  M.tick({ dt: 0.1, players: [{ id: 'a', x: 300, z: 0 }, { id: 'b', x: -300, z: 0 }], status: st });
  assert.equal(M.status.done.status, 'finished');
  const sh = M.shares();
  assert.ok(Math.abs(sh.a + sh.b - 1) < 1e-9);
  assert.ok(sh.b > sh.a, 'b was chased longer');
  const shared = createCoopMission({ cfg, mission: { kind: 'split', players: ['a', 'b'], drops } }).shares();
  assert.deepEqual(shared, { a: 1, b: 1 });
});
