// Multiplayer races' rules (Phase 7 Step 2; docs/MULTIPLAYER.md): tiers, matchmaking, the race itself (on a made-up
// circuit, cars driven along it), the results' confirmation and pay, and the lobby's rules. All pure: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tierOf, tierChange, START } from '../../mp/rank.js';
import { matchQueue, percentile } from '../../mp/match.js';
import { createRace } from '../../mp/race.js';
import { confirmResults, ratingOrder, payFor } from '../../mp/results.js';
import { normaliseSettings, inviteCode, normaliseCode, createChatGate, nextHost, carAllowed } from '../../mp/lobby.js';
import { speedPlan, createNpcDriver } from '../../mp/npc.js';
import { courseFromLine, circuit } from '../../mp/course.js';

const CFG = JSON.parse(fs.readFileSync(new URL('../../data/multiplayer.json', import.meta.url), 'utf8'));
const ECON = JSON.parse(fs.readFileSync(new URL('../../data/economy.json', import.meta.url), 'utf8'));

test('tiers: unranked until placed, then by the ordinal (never the number); a change says up or down', () => {
  assert.equal(tierOf({ ...START, races: 1 }, CFG.rank).id, 'unranked');
  assert.equal(tierOf({ ...START, races: 5 }, CFG.rank).id, 'bronze');
  assert.equal(tierOf({ mu: 40, sigma: 3, races: 50 }, CFG.rank).id, 'champion');
  const t = tierOf({ mu: 28, sigma: 4, races: 20 }, CFG.rank);
  assert.equal(t.id, 'gold'); assert.ok(['I', 'II', 'III'].includes(t.division));
  const c = tierChange({ mu: 22, sigma: 4, races: 10 }, { mu: 27, sigma: 3.8, races: 11 }, CFG.rank);
  assert.ok(c.up && !c.down, JSON.stringify(c));
});

const party = (id, since, players, extra = {}) => ({ id, since, players: players.map(([skill, pr, cls = 'C'], i) => ({ uid: `${id}-${i}`, skill, pr, cls })), pings: { local: 20 }, ...extra });

test('matchmaking: similar players fill a race at once; far apart ones wait until the windows have grown', () => {
  const eight = Array.from({ length: 8 }, (_, i) => party(`p${i}`, 0, [[10 + i * 0.3, 500 + i * 3]]));
  const m = matchQueue(eight, 1000, CFG);
  assert.equal(m.matches.length, 1); assert.equal(m.matches[0].players.length, 8);
  assert.ok(m.matches[0].quality.skillSpread < 3 && m.matches[0].quality.sameClass);
  // (a strong player and a weak one: not straight away; together once both have waited)
  const two = [party('a', 0, [[2, 500]]), party('b', 0, [[30, 500]])];
  assert.equal(matchQueue(two, 1000, CFG).matches.length, 0);
  const late = matchQueue(two, 200000, CFG);
  assert.equal(late.matches.length, 0, 'never a race spanning more than the widest window');
  const near = [party('a', 0, [[10, 500]]), party('b', 0, [[16, 500]])];
  assert.equal(matchQueue(near, 1000, CFG).matches.length, 0);
  assert.equal(matchQueue(near, (CFG.queue.fillAfterSec + 1) * 1000, CFG).matches.length, 1, 'the window grows, and a slow queue starts with fewer');
});

test('matchmaking: car class, ping and parties', () => {
  const mixed = [...Array.from({ length: 4 }, (_, i) => party(`c${i}`, 0, [[10, 500, 'C']])), ...Array.from({ length: 4 }, (_, i) => party(`b${i}`, 0, [[10, 600, 'B']]))];
  const m = matchQueue(mixed, (CFG.queue.fillAfterSec + 1) * 1000, CFG);
  assert.equal(m.matches.length, 2);
  for (const g of m.matches) assert.ok(g.quality.sameClass, 'never two classes in one race');
  // (a party of three stays together; five singles fill the rest)
  const p = [party('team', 0, [[10, 500], [11, 505], [9, 495]]), ...Array.from({ length: 6 }, (_, i) => party(`s${i}`, 100, [[10, 500]]))];
  const r = matchQueue(p, 1000, CFG).matches[0];
  assert.equal(r.players.length, 8); assert.ok(r.entries.some(e => e.id === 'team'));
  // (far away: only once the anchor has waited long enough for its ping limit)
  const far = [party('near', 0, [[10, 500]], { pings: { local: 20 } }), party('far', 0, [[10, 500]], { pings: { local: 200 } })];
  assert.equal(matchQueue(far, (CFG.queue.fillAfterSec + 1) * 1000, CFG).matches.length, 0);
  assert.equal(matchQueue(far, (CFG.queue.pingStepSec * 2 + 1) * 1000, CFG).matches.length, 1);
});

test('matchmaking: a lone player is offered NPCs, and races at once on saying yes', () => {
  const lone = [party('solo', 0, [[10, 500]])];
  assert.deepEqual(matchQueue(lone, (CFG.queue.npcOfferSec + 1) * 1000, CFG).offers, ['solo']);
  const yes = matchQueue([{ ...lone[0], npcOk: true, offered: true }], (CFG.queue.npcOfferSec + 2) * 1000, CFG);
  assert.equal(yes.matches.length, 1); assert.ok(yes.matches[0].npcFill);
  assert.equal(percentile([1, 2, 3, 4, 100], 0.5), 3);
});

// ---------- the race ----------
const COURSE = courseFromLine(circuit({ radius: 70, straight: 250 }), { loop: true });
const SET = (o = {}) => ({ kind: 'custom', laps: 2, gridOrder: 'rating', maxPlayers: 8, ...o });
// a car driven along the circuit (the NPC driver: a steady, fast car), its state as the room would pass it on
function car(slot, skill) { const plan = speedPlan(COURSE.line, { loop: true, cfg: CFG.npc }); return createNpcDriver({ line: COURSE.line, loop: true, plan, slot, skill }); }
function runRace(R, drivers, { from, until, step = 33, each } = {}) {
  const ev = [];
  for (let t = from; t <= until; t += step) {
    for (const [pid, d] of drivers) { const s = d.state(t); ev.push(...R.carState(pid, { t, pos: s.pos, vel: s.vel })); }
    ev.push(...R.update(t));
    each?.(t, ev);
    if (R.phase === 'results') break;
  }
  return ev;
}

test('a race: lobby → loading → countdown (lights out on the server\'s clock) → racing → results; the grid by rating', () => {
  const R = createRace({ cfg: CFG, settings: SET(), course: COURSE, now: 0 });
  const ratings = [{ mu: 20, sigma: 3 }, { mu: 30, sigma: 3 }, { mu: 25, sigma: 3 }];
  ratings.forEach((r, i) => assert.equal(R.join(i + 1, { uid: `u${i + 1}`, name: `P${i + 1}`, rating: r }), 'racer'));
  for (const pid of [1, 2, 3]) R.setReady(pid, true);
  assert.ok(R.allReady());
  assert.ok(R.start(1000)); assert.equal(R.phase, 'loading');
  for (const pid of [1, 2, 3]) R.loaded(pid, {}, 1500);
  const ev = R.update(2000);
  assert.equal(R.phase, 'countdown');
  const grid = ev.find(e => e.type === 'grid').order;
  assert.deepEqual(grid.map(g => g.pid), [2, 3, 1], 'pole: the best rated');
  assert.equal(R.goAt, 2000 + CFG.race.countdownSec * 1000);
  // (each on its slot, then the drive: the fastest car wins)
  const drivers = new Map([[1, car(COURSE.grid.slots[2], 0.95)], [2, car(COURSE.grid.slots[0], 0.88)], [3, car(COURSE.grid.slots[1], 0.92)]]);
  runRace(R, drivers, { from: 2000, until: R.goAt - 1 });
  for (const d of drivers.values()) d.go(R.goAt);
  let mid = null;
  const all = runRace(R, drivers, { from: R.goAt, until: R.goAt + 400000, each: (t) => { if (!mid && t > R.goAt + 30000) mid = R.standings(t); } });
  assert.equal(R.phase, 'results');
  assert.ok(mid.every((s, i) => i === 0 || s.u <= mid[i - 1].u), 'live positions by distance along the race');
  assert.ok(mid.slice(1).every(s => s.gapMs != null && s.gapMs >= 0), 'gaps to the leader');
  const res = R.results();
  assert.deepEqual(res.map(r => r.pid), [1, 3, 2], 'the fastest car first');
  assert.ok(res.every(r => r.status === 'finished' && r.laps === 2 && r.timeMs > 0));
  assert.ok(all.filter(e => e.type === 'lap').length >= 3);
  // (a time no car could beat: two laps at the NPCs' top speed)
  assert.ok(res[0].timeMs > 2 * COURSE.length / CFG.npc.topSpeed * 1000);
});

test('a race: a jump start costs its penalty; the finish window marks the slow DNF; a drop past its grace is out', () => {
  const C2 = { ...CFG, race: { ...CFG.race, finishWindowSec: 5 } };
  const R = createRace({ cfg: C2, settings: SET({ laps: 1 }), course: COURSE, now: 0 });
  for (const i of [1, 2, 3]) R.join(i, { uid: `u${i}`, name: `P${i}`, rating: { mu: 30 - i, sigma: 3 } });
  R.start(0); for (const i of [1, 2, 3]) R.loaded(i, {}, 0); R.update(0);
  const slots = COURSE.grid.slots;
  // (player 1 creeps forward 3 m before the lights)
  const st = (pid, t, dx = 0) => { const sl = slots[R.players.get(pid).slot]; return R.carState(pid, { t, pos: [sl.x + dx, 0, sl.z], vel: [0, 0, 0] }); };
  for (const pid of [1, 2, 3]) st(pid, 100);
  const jump = st(1, 500, 3);
  assert.ok(jump.some(e => e.type === 'jumpstart'), 'jump start detected');
  const drivers = new Map([[1, car(slots[R.players.get(1).slot], 0.95)], [2, car(slots[R.players.get(2).slot], 0.94)], [3, car(slots[R.players.get(3).slot], 0.5)]]);
  for (const d of drivers.values()) d.go(R.goAt);
  // (player 2's connection drops halfway and never comes back)
  let dropped = false;
  runRace(R, drivers, { from: R.goAt, until: R.goAt + 300000, each: t => { if (!dropped && t > R.goAt + 8000) { dropped = true; R.drop(2, t); drivers.delete(2); } } });
  const res = R.results(), by = Object.fromEntries(res.map(r => [r.pid, r]));
  assert.equal(by[1].status, 'finished'); assert.equal(by[1].penaltyMs, CFG.race.jumpStart.penaltySec * 1000);
  assert.equal(by[2].status, 'dnf'); assert.equal(by[2].why, 'disconnected');
  assert.equal(by[3].status, 'dnf'); assert.equal(by[3].why, 'time', 'too slow: out when the finish window closed');
});

test('a race: leaving counts; a wrong track hash watches; a late loader starts from the back; impossible progress is flagged', () => {
  const R = createRace({ cfg: CFG, settings: SET({ laps: 1 }), course: { ...COURSE, trackHash: 'abc' }, now: 0 });
  for (const i of [1, 2, 3, 4]) R.join(i, { uid: `u${i}`, name: `P${i}`, rating: { mu: 25, sigma: 3 } });
  R.start(0);
  assert.equal(R.loaded(1, { hash: 'abc' }, 10).ok, true);
  assert.equal(R.loaded(2, { hash: 'xyz' }, 10).ok, false);
  assert.equal(R.players.get(2).role, 'spectator', 'a different track: watching, not racing it');
  R.loaded(3, { hash: 'abc' }, 10);
  R.update(CFG.race.loadTimeoutSec * 1000 + 1);                    // (player 4 still loading: the race goes on without waiting)
  assert.equal(R.phase, 'countdown'); assert.ok(R.players.get(4).late);
  R.loaded(4, { hash: 'abc' }, CFG.race.loadTimeoutSec * 1000 + 500);
  const s4 = R.players.get(4).slot;
  assert.ok(s4 > R.players.get(1).slot && s4 > R.players.get(3).slot, 'from the back of the grid');
  R.update(R.goAt);
  R.leave(3, R.goAt + 100);
  const p1 = R.players.get(1), sl = COURSE.grid.slots[p1.slot];
  R.carState(1, { t: R.goAt + 50, pos: [sl.x, 0, sl.z], vel: [0, 0, 0] });
  // (a 600 m leap in a third of a second)
  const far = COURSE.line[Math.floor(COURSE.line.length / 2)];
  const ev = R.carState(1, { t: R.goAt + 380, pos: [far.x, 0, far.z], vel: [0, 0, 0] });
  assert.ok(ev.some(e => e.type === 'flag' && e.kind === 'progress'), 'flagged');
  assert.ok(R.players.get(1).tracker.state.u < 100, 'and not counted');
  const r3 = R.results().find(r => r.pid === 3);
  assert.equal(r3.status, 'dnf'); assert.ok(r3.leftEarly);
});

test('results: a run that fails the check is disqualified and the others move up; rating order; pay by place', () => {
  const prov = [
    { pid: 1, uid: 'a', place: 1, status: 'finished', timeMs: 60000, flags: [] },
    { pid: 2, uid: 'b', place: 2, status: 'finished', timeMs: 61000, flags: [] },
    { pid: 3, uid: 'npc', npc: true, place: 3, status: 'finished', timeMs: 62000, flags: [] },
    { pid: 4, uid: 'c', place: 4, status: 'finished', timeMs: 63000, flags: [] },
    { pid: 5, uid: 'd', place: 5, status: 'dnf', why: 'left', leftEarly: true, flags: [] },
  ];
  const conf = confirmResults(prov, { a: { ok: false, problems: ['Missed checkpoint 2.'] }, b: { ok: true, timeMs: 61050 }, c: { ok: true, timeMs: 64000 } }, { toleranceMs: 300 });
  const by = Object.fromEntries(conf.map(r => [r.uid, r]));
  assert.equal(by.a.status, 'dsq'); assert.equal(by.b.place, 1, 'moved up'); assert.equal(by.npc.place, 2);
  assert.equal(by.c.status, 'dsq', 'its time isn\'t what the server saw');
  assert.ok(by.a.place > by.d.place, 'the disqualified below the DNFs');
  const order = Object.fromEntries(ratingOrder(conf).map(o => [o.uid, o.rank]));
  assert.equal(order.b, 1); assert.ok(!('npc' in order), 'NPCs aren\'t rated');
  assert.ok(order.a === order.c && order.c === order.d && order.d > order.b, 'leavers and the disqualified share last');
  const pay = payFor(conf, ECON.multiplayer, { ranked: true, humans: 4, npcs: 1 });
  assert.ok(pay.b.money > 0); assert.equal(pay.a.money, 0); assert.equal(pay.d.money, 0);
  const tired = payFor(conf, ECON.multiplayer, { ranked: true, humans: 4, npcs: 1, todayRaces: { b: 100 } });
  assert.ok(tired.b.money < pay.b.money, 'after the day\'s full-pay races, less');
});

test('lobby rules: settings clamped (ghost only), codes, the chat\'s pace, the next host, car classes', () => {
  const { settings, problems } = normaliseSettings({ laps: 99, collisions: 'on', weather: 'snow', classes: ['C', 'Q'], venue: { kind: 'track', code: 'not a code' } }, CFG, { kind: 'custom' });
  assert.equal(settings.laps, CFG.lobby.lapsMax); assert.equal(settings.collisions, 'ghost'); assert.equal(settings.weather, 'clear');
  assert.deepEqual(settings.classes, ['C']); assert.equal(settings.venue.kind, 'random'); assert.ok(problems.length >= 2);
  assert.ok(carAllowed({ cls: 'C' }, settings) && !carAllowed({ cls: 'B' }, settings));
  const code = inviteCode(Math.random, 6);
  assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/); assert.equal(normaliseCode(` ${code.toLowerCase().slice(0, 3)}-${code.slice(3)} `), code);
  const gate = createChatGate(CFG.lobby.chat);
  let sent = 0; for (let i = 0; i < 20; i++) if (gate(1000)) sent++;
  assert.equal(sent, CFG.lobby.chat.burst);
  assert.ok(gate(1000 + 1000 / CFG.lobby.chat.perSec + 10));
  const ps = [{ pid: 1, joinedAt: 5 }, { pid: 2, joinedAt: 1, npc: true }, { pid: 3, joinedAt: 3 }];
  assert.equal(nextHost(ps, 3).pid, 1); assert.equal(nextHost(ps).pid, 3);
});
