// Directions (route/turns.js, play/turnHud.js): the turns along a route — a junction turned at, the way and how
// sharply, the road it goes onto; a bend that needs telling, a gentle one that doesn't; straight over a crossroads, no
// turn; arriving at the end — and the card's next turn, how far, and "then" when another follows close behind; the
// arrows on the road before a turn picked out.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeTurns, nextTurn, turnAngle, kindOf, TURN } from '../../route/turns.js';
import { resample, withS } from '../../route/geometry.js';
import { arrowSvg, roundDistance, directions } from '../../play/turnHud.js';
import { guideArrowSpots } from '../../play/routeDressing.js';

// a route along points (z is south: heading north is -z), 4 m apart
const route = pts => resample(withS(pts.map(([x, z]) => ({ x, z, h: 0, w: 8 }))));
// north 300 m, left (west) 200 m, then right (north) 200 m
const L = route([[0, 0], [0, -300], [-200, -300], [-200, -500]]);

test('a junction turned at: which way, how sharply, onto which road; straight over a crossroads isn\'t a turn', () => {
  const nodes = [{ s: 150, degree: 4 }, { s: 300, degree: 3 }, { s: 500, degree: 3 }];
  const segments = [{ sStart: 0, name: 'King William Street' }, { sStart: 300, name: 'North Terrace' }, { sStart: 500, name: 'Frome Road' }];
  const turns = routeTurns(L, { nodes, segments });
  const j = turns.filter(t => t.junction);
  assert.equal(j.length, 2, JSON.stringify(turns));
  assert.equal(j[0].way, 'left'); assert.equal(j[0].kind, 'turn'); assert.equal(j[0].name, 'North Terrace'); assert.ok(Math.abs(j[0].s - 300) < 6);
  assert.equal(j[1].way, 'right'); assert.equal(j[1].name, 'Frome Road');
  assert.ok(!turns.some(t => Math.abs(t.s - 150) < 20), 'no turn at the crossroads it goes straight over');
  assert.equal(turns.at(-1).kind, 'arrive');
  assert.ok(Math.abs(turnAngle(L, 300) - 90) < 15, `${turnAngle(L, 300)}`);
});

test('without junctions (a race\'s course): its real bends; a gentle curve isn\'t one; kinds by how sharp', () => {
  const turns = routeTurns(L);
  assert.deepEqual(turns.filter(t => t.kind !== 'arrive').map(t => t.way), ['left', 'right']);
  assert.ok(turns.every(t => !t.junction));
  // (a 35° curve: the road just goes that way)
  const gentle = route([[0, 0], [0, -300], [-200 * Math.sin(35 * Math.PI / 180), -300 - 200 * Math.cos(35 * Math.PI / 180)]]);
  assert.deepEqual(routeTurns(gentle).map(t => t.kind), ['arrive']);
  assert.equal(kindOf(30, true), 'slight'); assert.equal(kindOf(-90, true), 'turn'); assert.equal(kindOf(140, true), 'sharp'); assert.equal(kindOf(175, true), 'uturn');
  assert.equal(kindOf(70, false), 'bend'); assert.equal(kindOf(120, false), 'sharpBend'); assert.equal(kindOf(170, false), 'hairpin');
  assert.ok(TURN.bend > TURN.junction);
});

test('the next turn from where the car is, how far, and "then" when the one after is close', () => {
  const turns = [{ s: 300, kind: 'turn', way: 'left' }, { s: 380, kind: 'turn', way: 'right' }, { s: 900, kind: 'arrive' }];
  const a = nextTurn(turns, 100);
  assert.equal(a.turn.s, 300); assert.equal(a.dist, 200); assert.equal(a.then.way, 'right');
  const b = nextTurn(turns, 320);
  assert.equal(b.turn.s, 380); assert.equal(b.then, null, 'the next is 520 m on: no "then"');
  assert.equal(nextTurn(turns, 950), null);
  // (a lap: round to the first again)
  const lap = nextTurn([{ s: 100, kind: 'bend', way: 'left' }], 900, { length: 1000, loop: true });
  assert.equal(lap.dist, 200);
});

test('the card: arrows for every kind, distances rounded as a sat-nav says them, no screen needed to work it out', () => {
  for (const k of ['slight', 'turn', 'sharp', 'uturn', 'bend', 'sharpBend', 'hairpin', 'arrive']) for (const w of ['left', 'right']) assert.match(arrowSvg(k, w), /^<svg/);
  assert.match(arrowSvg('turn', 'right'), /scale\(-1 1\)/, 'a right turn is the left one mirrored');
  assert.deepEqual([12, 87, 263, 412, 1234].map(roundDistance), [12, 90, 260, 400, 1200]);
  directions.set('test', { line: L, turns: routeTurns(L) }, 1);
  directions.update({ x: 0, z: -100 });
  assert.equal(directions.state.visible, true); assert.equal(directions.state.way, 'left'); assert.ok(Math.abs(directions.state.dist - 200) < 8); assert.equal(directions.state.phase, 'near');
  directions.update({ x: 0, z: -280 });
  assert.equal(directions.state.phase, 'now');
  directions.update({ x: 500, z: 500 });
  assert.equal(directions.state.visible, false, 'far off the route: nothing');
  // (a course shown but not being driven doesn't hide the route the car is on)
  directions.set('course', { line: route([[5000, 0], [5000, -500]]), turns: [] }, 3);
  directions.update({ x: 0, z: -100 });
  assert.equal(directions.state.source, 'test');
  directions.clear('course'); directions.clear('test');
  assert.equal(directions.state.visible, false);
});

test('the arrows on the road: each knows where it is along the route, for the ones before a turn to stand out', () => {
  const spots = guideArrowSpots(L.filter(p => p.s >= 200));
  assert.ok(spots.length > 5 && spots.every(a => Number.isFinite(a.s) && a.s >= 200));
  assert.ok(Math.abs(spots[0].s - 208) < 1);
});
