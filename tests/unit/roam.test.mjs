// Free roam's rules, pure (Phase 7 Step 4; docs/FREE_ROAM.md): zones and the zones a car is in (with the handoff's
// hysteresis), which instance a player joins (party, friends, players near, ping; never with someone blocked; the cap),
// who sees whom (privacy and blocks: world, map, join friend, names), whose cars touch (contact, party, passive, auto-ghost,
// challenges), challenges (asking, cooldowns, blocked players, flashing headlights, a route on the real road graph, the
// rolling start, results, the check, the pay and its caps), meets and coming back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zoneSize, zoneOf, createZoneTracker, placeInstance, seesInWorld, seesOnMap, canJoin, nameFor, touches, toggleAllowed, createAutoGhost, meetSpots, nearestFreeSpot, meetEventState, restorePoint, lodFor, nameOpacity, pickRegion, mapPoint } from '../../mp/roam.js';
import { createChallengeBook, createFlashDetector, sprintRoute, checkpointsOf, createChallengeRun, verifyChallenge, challengePay } from '../../mp/challenge.js';
import { createNetwork } from '../../route/network.js';
import { transverseMercator } from '../../map/build/format/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/roam.json'), 'utf8'));

test('zones: a 2,048 m square of map tiles; a car near a border is in both zones, hands over past the line, leaves with slack', () => {
  const size = zoneSize(CFG);
  assert.equal(size, 2048);
  assert.deepEqual(zoneOf(10, 10, size), { i: 0, j: 0, key: '0,0' });
  assert.equal(zoneOf(-1, 2049, size).key, '-1,1');
  const T = createZoneTracker(CFG);
  let u = T.update(1000, 1000);
  assert.equal(u.home, '0,0'); assert.deepEqual(u.zones, ['0,0']);
  // (driving east towards x = 2048: the neighbour joined overlapM before the border)
  u = T.update(2048 - CFG.zones.overlapM - 1, 1000); assert.deepEqual(u.zones, ['0,0']);
  u = T.update(2048 - CFG.zones.overlapM + 1, 1000); assert.deepEqual(u.add, ['1,0']); assert.equal(u.home, '0,0');
  // (on the line, and just past it: no handoff yet — hysteresis)
  u = T.update(2048 + CFG.zones.handoffM - 1, 1000); assert.equal(u.handoff, null); assert.equal(u.home, '0,0');
  u = T.update(2048 + CFG.zones.handoffM + 1, 1000); assert.deepEqual(u.handoff, { from: '0,0', to: '1,0' });
  // (back over the line a little: stays in the new home; the old one is kept while within overlap + slack)
  u = T.update(2040, 1000); assert.equal(u.home, '1,0'); assert.ok(u.zones.includes('0,0'));
  u = T.update(2048 + CFG.zones.overlapM + CFG.zones.leaveSlackM + 1, 1000); assert.deepEqual(u.drop, ['0,0']);
  // (a corner: three neighbours at once)
  const C = createZoneTracker(CFG);
  assert.equal(C.update(2040, 2040).zones.length, 4);
  // (a teleport: straight to where it is)
  u = C.update(20000, 20000); assert.equal(u.home, zoneOf(20000, 20000, size).key); assert.ok(u.handoff.jump);
});

test('instances: party first, then friends, then players near, then ping; never with someone blocked; the cap, with slots kept for friends', () => {
  const c = (group, uids, extra = {}) => ({ group, room: `r_${group}`, players: uids.length, uids, positions: uids.map(() => [0, 0]), ...extra });
  const fill = (n, p = 'x') => Array.from({ length: n }, (_, i) => `${p}${i}`);
  const me = { uid: 'me', pos: [0, 0], party: ['pal'], friends: ['amy'], blocked: ['troll'] };
  // the party's instance even when another has more people near and a friend
  assert.equal(placeInstance({ me, cfg: CFG, candidates: [c('a', [...fill(30), 'amy']), c('b', ['pal', 'z'])] }).group, 'b');
  // a friend's, when no party member is about
  assert.equal(placeInstance({ me: { ...me, party: [] }, cfg: CFG, candidates: [c('a', fill(30)), c('b', ['amy'])] }).group, 'b');
  // never one with someone blocked (either way) — even a friend's
  assert.equal(placeInstance({ me: { ...me, party: [] }, cfg: CFG, candidates: [c('a', fill(3)), c('b', ['amy', 'troll'])] }).group, 'a');
  // the most players near (not just the most players)
  const far = c('far', fill(40, 'f'), { positions: fill(40).map(() => [9000, 9000]) }), near = c('near', fill(5, 'n'));
  assert.equal(placeInstance({ me: { uid: 'me', pos: [0, 0] }, cfg: CFG, candidates: [far, near] }).group, 'near');
  // nobody near either: the lowest ping
  const p1 = c('p1', fill(3, 'a'), { positions: [[9e3, 9e3]], pingMs: 90 }), p2 = c('p2', fill(3, 'b'), { positions: [[9e3, 9e3]], pingMs: 30 });
  const pp = placeInstance({ me: { uid: 'me', pos: [0, 0] }, cfg: CFG, candidates: [p1, p2] });
  assert.equal(pp.group, 'p2'); assert.equal(pp.why, 'lowest ping');
  // full: skipped by strangers, open to a friend (friendSlots), and past those, a new instance
  const full = c('full', [...fill(CFG.zones.capacity - 1), 'amy']);
  assert.notEqual(placeInstance({ me: { uid: 'me', pos: [0, 0] }, cfg: CFG, candidates: [full] }).group, 'full');
  assert.equal(placeInstance({ me: { ...me, party: [] }, cfg: CFG, candidates: [full] }).group, 'full');
  const packed = c('packed', [...fill(CFG.zones.capacity + CFG.zones.friendSlots - 1), 'amy']);
  assert.equal(placeInstance({ me: { ...me, party: [] }, cfg: CFG, candidates: [packed] }).why, 'new instance');
  // a handoff keeps its group: the same one in the next zone, or a new one by that name if it isn't there yet
  assert.equal(placeInstance({ me: { uid: 'me', pos: [0, 0], group: 'g7' }, cfg: CFG, candidates: [c('g1', fill(9)), c('g7', fill(2, 'q'))] }).group, 'g7');
  assert.equal(placeInstance({ me: { uid: 'me', pos: [0, 0], group: 'g7' }, cfg: CFG, candidates: [] }).group, 'g7');
});

test('seeing: blocks hide everywhere; location everyone / friends / nobody on the maps and for joining; appear offline; names', () => {
  const rel = { friends: new Set(['f']), blocked: new Set(['b']), party: new Set(['p']) };
  const t = (uid, location, appearOffline = false) => ({ uid, name: `N_${uid}`, settings: { location, appearOffline } });
  assert.equal(seesInWorld('me', t('b', 'everyone'), rel), false);
  assert.equal(seesInWorld('me', t('x', 'nobody'), rel), true);
  for (const [who, loc, map] of [['x', 'everyone', true], ['x', 'friends', false], ['f', 'friends', true], ['f', 'nobody', false], ['b', 'everyone', false], ['p', 'nobody', true]]) assert.equal(seesOnMap('me', t(who, loc), rel), map, `${who} ${loc}`);
  assert.equal(seesOnMap('me', t('f', 'everyone', true), rel), false);
  assert.equal(canJoin('me', t('f', 'friends'), rel).ok, true);
  assert.equal(canJoin('me', t('f', 'nobody'), rel).ok, false);
  assert.equal(canJoin('me', t('f', 'everyone', true), rel).ok, false);
  assert.equal(canJoin('me', t('x', 'everyone'), rel).ok, false);
  assert.equal(canJoin('me', t('b', 'everyone'), rel).ok, false);
  assert.equal(nameFor('me', t('x', 'nobody'), rel), 'Driver');
  assert.equal(nameFor('me', t('f', 'nobody'), rel), 'N_f');
  assert.equal(nameFor('me', t('x', 'everyone'), rel), 'N_x');
});

test('contact: ghost by default; both on, or a party with party contact; passive, auto-ghosted and challenges ghost; cooldowns', () => {
  const p = (uid, s = {}, extra = {}) => ({ uid, settings: { contact: false, passive: false, partyContact: true, ...s }, party: null, ghostUntil: 0, challenge: null, ...extra });
  assert.equal(touches(p('a'), p('b')), false);
  assert.equal(touches(p('a', { contact: true }), p('b')), false);
  assert.equal(touches(p('a', { contact: true }), p('b', { contact: true })), true);
  assert.equal(touches(p('a', {}, { party: 'P' }), p('b', {}, { party: 'P' })), true);
  assert.equal(touches(p('a', { partyContact: false }, { party: 'P' }), p('b', {}, { party: 'P' })), false);
  assert.equal(touches(p('a', { contact: true, passive: true }), p('b', { contact: true })), false);
  assert.equal(touches(p('a', { contact: true }, { ghostUntil: 5000 }), p('b', { contact: true }), 1000), false);
  assert.equal(touches(p('a', { contact: true }, { ghostUntil: 5000 }), p('b', { contact: true }), 6000), true);
  assert.equal(touches(p('a', { contact: true }, { challenge: 'c1' }), p('b', { contact: true })), false);
  assert.equal(touches(p('a', { contact: true }, { challenge: 'c1' }), p('b', { contact: true }, { challenge: 'c1' })), true);
  assert.equal(toggleAllowed('passive', 0, 1000, CFG).ok, false);
  assert.equal(toggleAllowed('passive', 0, CFG.contact.passiveCooldownSec * 1000, CFG).ok, true);
  assert.equal(toggleAllowed('contact', null, 0, CFG).ok, true);
});

test('griefing: a player ramming others is auto-ghosted for everyone (longer each time), their safety to drop; light or blameless contacts don\'t count', () => {
  const G = createAutoGhost(CFG), A = CFG.contact.autoGhost;
  // (not their fault, or too light: nothing)
  for (let k = 0; k < 10; k++) assert.equal(G.hit({ uid: 'v', t: k * 1000, share: 0.3, strength: 9 }).ghosted, false);
  for (let k = 0; k < 10; k++) assert.equal(G.hit({ uid: 'v', t: k * 1000, share: 1, strength: 0.5 }).ghosted, false);
  let r;
  for (let k = 0; k < A.hits; k++) r = G.hit({ uid: 'rammer', t: 1000 + k * 5000, share: 0.9, strength: 6 });
  assert.equal(r.ghosted, true); assert.equal(r.safetyHits, A.hits); assert.equal(r.safetyDrop, A.hits * A.safetyPerHit);
  const first = r.until - (1000 + (A.hits - 1) * 5000);
  assert.equal(first, A.ghostSec * 1000);
  // (spread out beyond the window: no ghost)
  for (let k = 0; k < 6; k++) assert.equal(G.hit({ uid: 'slow', t: k * (A.windowSec + 1) * 1000, share: 1, strength: 5 }).ghosted, false);
  // (again after the ghost: twice as long)
  const t0 = r.until + 1000;
  for (let k = 0; k < A.hits; k++) r = G.hit({ uid: 'rammer', t: t0 + k * 1000, share: 1, strength: 6 });
  assert.equal(r.until - (t0 + (A.hits - 1) * 1000), A.ghostSec * 1000 * A.repeatFactor);
});

test('challenges: asked, answered, declined (cooldown doubling), not answered, spam limits, blocked players declined silently, groups', () => {
  const B = createChallengeBook(CFG), C = CFG.challenges;
  let r = B.ask({ from: 'a', to: ['b'], type: 'sprint', now: 0 });
  assert.ok(r.ok && r.id);
  assert.equal(B.ask({ from: 'a', to: ['b'], type: 'sprint', now: 10 }).ok, false, 'one at a time');
  assert.equal(B.answer(r.id, 'b', false, 1000).state, 'declined');
  assert.equal(B.cooldownSec('a', 'b', 1000), C.pairCooldownSec);
  assert.equal(B.ask({ from: 'a', to: ['b'], type: 'sprint', now: 2000 }).ok, false);
  r = B.ask({ from: 'a', to: ['b'], type: 'sprint', now: 1000 + C.pairCooldownSec * 1000 + 1 });
  assert.ok(r.ok);
  // (not answered: expires, the next cooldown twice as long)
  const out = B.expire(1000 + C.pairCooldownSec * 1000 + 1 + C.answerSec * 1000);
  assert.equal(out[0].state, 'expired');
  assert.equal(B.cooldownSec('a', 'b', out[0].closedAt), C.pairCooldownSec * 2);
  // accepted
  r = B.ask({ from: 'c', to: ['d'], type: 'follow', now: 0 });
  assert.equal(B.answer(r.id, 'd', true, 100).state, 'accepted');
  // a blocked player's: "sent", declined silently — no invite made
  const s = B.ask({ from: 'troll', to: ['e'], type: 'sprint', now: 0, silent: (x, y) => x === 'troll' });
  assert.equal(s.ok, true); assert.equal(s.id, null); assert.equal(B.pending().some(i => i.from === 'troll'), false);
  // passive (the server's check) refuses with its reason
  assert.equal(B.ask({ from: 'f', to: ['g'], type: 'sprint', now: 0, check: () => 'They\'re in passive mode.' }).why, 'They\'re in passive mode.');
  // perMinute
  const S = createChallengeBook(CFG);
  for (let k = 0; k < C.perMinute; k++) assert.ok(S.ask({ from: 'spam', to: [`v${k}`], type: 'sprint', now: k }).ok);
  assert.equal(S.ask({ from: 'spam', to: ['v9'], type: 'sprint', now: 100 }).ok, false);
  // a group: goes ahead with those who said yes
  const G = createChallengeBook(CFG);
  r = G.ask({ from: 'lead', to: ['p1', 'p2', 'p3'], type: 'sprint', now: 0 });
  G.answer(r.id, 'p1', true, 10); G.answer(r.id, 'p2', false, 10);
  const done = G.answer(r.id, 'p3', true, 20);
  assert.equal(done.state, 'accepted'); assert.deepEqual([...done.invite.accepted].sort(), ['p1', 'p3']);
  assert.equal(G.ask({ from: 'x', to: Array.from({ length: C.groupMax }, (_, i) => `u${i}`), type: 'sprint', now: 0 }).ok, false);
});

test('flashing headlights at the car ahead asks it', () => {
  const F = createFlashDetector(CFG);
  const me = { pos: [0, 0, 0], heading: 0 }, ahead = { uid: 'ahead', pos: [3, 0, 40] }, behind = { uid: 'behind', pos: [0, 0, -30] };
  F.lights('a', true, 0); F.lights('a', false, 200);
  assert.equal(F.target('a', 300, me, [ahead, behind]), null, 'one flash');
  F.lights('a', true, 400); F.lights('a', false, 600);
  assert.equal(F.target('a', 700, me, [ahead, behind]), 'ahead');
  F.lights('a', true, 5000); F.lights('a', false, 5200); F.lights('a', true, 9000);
  assert.equal(F.target('a', 9100, me, [ahead]), null, 'too slow');
});

test('a sprint route on the real road graph (Milton Keynes): the right length by road, checkpoints along it; the run: rolling start, a jump start penalised, finishes, the check, the pay and its caps', () => {
  const dir = path.join(ROOT, 'assets/map/mk'), m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const P = transverseMercator(m.projection.lat0, m.projection.lon0);
  const N = createNetwork(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'graph.json.gz')))), { P, region: 'mk', version: m.version, bbox: m.bbox });
  let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const start = N.nearest(0, 0, undefined, 300);
  const route = sprintRoute(N, [start.x, start.z], CFG, { rng });
  assert.ok(route.ok, JSON.stringify(route.problems));
  assert.ok(route.length >= CFG.challenges.routeM.min * 0.6 && route.length <= CFG.challenges.routeM.max * 1.25, `${route.length} m`);
  const cps = checkpointsOf(route.line, CFG);
  assert.ok(cps.length >= 2); assert.ok(Math.abs(cps.at(-1).s - route.length) < 1);
  // drive it: two cars on the line, b just behind; a creeps ahead before the go (penalty), then both drive
  const R = createChallengeRun({ cfg: CFG, id: 'c1', type: 'sprint', racers: ['a', 'b'], route, now: 0 });
  const L = route.length, posAt = s => { const k = Math.min(route.line.length - 1, Math.max(0, route.line.findIndex(p => p.s >= s))); const p = route.line[k < 0 ? route.line.length - 1 : k]; return [p.x, 0, p.z]; };
  const ev = [];
  let sa = 0, sb = 0;
  for (let t = 0; t <= 240000; t += 100) {
    const going = R.phase === 'racing';
    const va = going ? 30 : 8, vb = going ? 28 : 8;
    sa = Math.min(L, sa + va * 0.1 + (!going && t > 4000 ? 3 : 0)); sb = Math.min(L, sb + vb * 0.1);
    R.state('a', { pos: posAt(sa), vel: [va, 0, 0], time: t }, t);
    R.state('b', { pos: posAt(Math.max(0, sb - 2)), vel: [vb, 0, 0], time: t }, t);
    ev.push(...R.tick(t));
    if (R.phase === 'done') break;
  }
  assert.ok(ev.some(e => e.t === 'go'));
  assert.ok(ev.some(e => e.t === 'penalty' && e.uid === 'a'), 'a jumped the start');
  const res = R.results();
  assert.equal(res.filter(r => r.status === 'finished').length, 2, JSON.stringify(res));
  const rec = R.record();
  const v = verifyChallenge(rec, CFG);
  assert.ok(v.ok, v.problems.join('; '));
  // a record edited: a checkpoint dropped, a car teleported, a time improved — each caught
  const bad1 = structuredClone(rec); bad1.cars.a.passed.splice(1, 1); assert.equal(verifyChallenge(bad1, CFG).ok, false);
  const bad2 = structuredClone(rec); bad2.cars.b.trail[5] = [bad2.cars.b.trail[5][0], 99999, 99999, 20]; assert.equal(verifyChallenge(bad2, CFG).ok, false);
  const bad3 = structuredClone(rec); bad3.results[0].timeMs -= 20000; assert.equal(verifyChallenge(bad3, CFG).ok, false);
  // the pay: the winner, the second; nothing past the caps
  const km = route.length / 1000;
  const w = challengePay(CFG, { km, place: 1 }), s = challengePay(CFG, { km, place: 2 });
  assert.ok(w.money > s.money && s.money > 0);
  assert.equal(challengePay(CFG, { km, place: 1, pairToday: CFG.challenges.caps.pairPerDay }).money, 0);
  assert.equal(challengePay(CFG, { km, place: 1, paidToday: CFG.challenges.caps.dailyPaid }).money, 0);
  assert.equal(challengePay(CFG, { km, place: null }).money, 0);
});

test('follow-the-leader: the follower who keeps up wins; one dropped beyond breakM loses', () => {
  const mk = () => createChallengeRun({ cfg: CFG, id: 'f', type: 'follow', racers: ['lead', 'f'], route: null, now: 0 });
  const run = (gapAt) => {
    const R = mk(); let out = [], x = 0;
    for (let t = 0; t < 400000 && R.phase !== 'done'; t += 100) {
      const v = R.phase === 'racing' ? 20 : 12; x += v * 0.1;
      R.state('lead', { pos: [x, 0, 0], vel: [v, 0, 0], time: t }, t);
      R.state('f', { pos: [x - gapAt(t), 0, 0], vel: [v, 0, 0], time: t }, t);
      out = out.concat(R.tick(t));
    }
    return R;
  };
  const kept = run(() => 20).results();
  assert.equal(kept.find(r => r.uid === 'f').place, 1);
  const lost = run(t => t > 20000 ? 400 : 20).results();
  // (a rolling start that never comes together — far too fast — is called off)
  const off = createChallengeRun({ cfg: CFG, id: 'x', type: 'sprint', racers: ['a', 'b'], route: null, now: 0 });
  let evs = [];
  for (let t = 0; t < 60000 && off.phase !== 'done'; t += 100) { off.state('a', { pos: [t, 0, 0], vel: [50, 0, 0], time: t }, t); off.state('b', { pos: [t, 0, 3], vel: [50, 0, 0], time: t }, t); evs = evs.concat(off.tick(t)); }
  assert.ok(evs.some(e => e.t === 'cancelled')); assert.ok(off.results().every(r => r.status === 'cancelled'));
  assert.equal(lost.find(r => r.uid === 'lead').place, 1);
  assert.equal(lost.find(r => r.uid === 'f').status, 'dnf');
});

test('meets, the map, coming back, regions', () => {
  const spots = meetSpots({ x: 100, z: 200, heading: 90, spots: 16, perRow: 8 }, CFG);
  assert.equal(spots.length, 16);
  // (all distinct, none on top of another)
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) >= CFG.meets.spacingM - 0.01);
  const free = nearestFreeSpot(spots, new Set([spots[0].n]), spots[0].x, spots[0].z);
  assert.notEqual(free.n, spots[0].n);
  const ev = { startsAt: new Date(10 * 3600e3).toISOString(), hours: 2 };
  assert.equal(meetEventState(ev, 0, CFG).state, 'announced');
  assert.equal(meetEventState(ev, 10.5 * 3600e3, CFG).state, 'live');
  assert.equal(meetEventState(ev, 13 * 3600e3, CFG).state, 'over');
  assert.equal(meetEventState({ startsAt: new Date(100 * 3600e3).toISOString() }, 0, CFG).state, 'later');
  // coming back: where you left; the garage when the region's gone or the spot is off road
  const saved = { region: 'mk', pos: [10, 0, 20], heading: 45, carId: 'car1', damage: { shell: 1 }, at: new Date(0).toISOString() };
  assert.equal(restorePoint(saved, { regions: ['mk'], cfg: CFG, now: 1000 }).garage, false);
  assert.equal(restorePoint(saved, { regions: ['sf'], cfg: CFG, now: 1000 }).garage, true);
  assert.equal(restorePoint(saved, { regions: ['mk'], cfg: CFG, now: 1000, roadDistance: () => 500 }).garage, true);
  assert.equal(restorePoint(null, { regions: ['mk'], cfg: CFG }).garage, true);
  assert.deepEqual(restorePoint(saved, { regions: ['mk'], cfg: CFG, now: 1000 }).damage, { shell: 1 });
  assert.equal(lodFor(100, CFG), 'full'); assert.equal(lodFor(500, CFG), 'simple'); assert.equal(lodFor(5000, CFG), 'marker');
  assert.equal(nameOpacity(10, CFG), 1); assert.equal(nameOpacity(1000, CFG), 0);
  assert.equal(pickRegion({ eu: 40, us: 90 }, CFG), 'eu');
  assert.equal(pickRegion({ eu: 40, us: 70 }, CFG, 'us'), 'us');
  // (no pings: the environment's first region — data/roam.json regions.list is keyed by environment)
  assert.equal(pickRegion({}, CFG, null, 'production'), 'au');
  assert.equal(pickRegion(null, CFG, null, 'development'), 'local');
  assert.equal(pickRegion({ au: NaN }, CFG), 'local');
  assert.deepEqual(mapPoint([123, 0, 456], CFG), [120, 460]);
});
