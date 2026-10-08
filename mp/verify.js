// Checking a multiplayer run with contact (Phase 7 Step 3; docs/CONTACT.md "Verification"). Pure apart from the
// physics passed in. Three checks, so a client can't fake being pushed (or skip being slowed):
//
//   checkContacts({ uid, run, log, cfg }) → { ok, problems, contacts }
//     every push the run applied (its record's J events) against the race server's log: each agreed contact's hit
//     pushes (the game's own as it hit, h, and the agreed correction) add up to the impulse the server agreed for this
//     car; its light rubbing pushes are each within the rubbing cap for the car's mass, and away from the other car; a
//     contact the server refused is undone; there are no pushes the server never heard of. And each push the game made
//     against another car's proxy: that car was there (the server's own states of it, round the contact).
//   checkTrail({ run, serverTrail, cfg }) → problems     the run's trail (where the car was each second, as it says)
//     against where the race server saw it
//   trackFor(code, cfg) → { data, track, course }   a generated track built from its code (data/tracks.json cfg)
//   replayRun({ RAPIER, settings, spec, sockets, track, run }) → { trail, steps, final }   the run driven again from
//     its inputs, pushes and car events (mp/runRecord.js), headless; compareTrails(run.trail, replay.trail) → problems
//
//   log: the race server's contact log (server/src/rt/contact.ts forRecord): { contacts: [{ cid, t, eps, cars: { uid:
//     { impulse } }, srv: { uid: [[t, x, z, yaw, vx, vz]] } }], rejected: [{ uid, ep }] }

import { createSimulation } from '../physics/sim.js';
import { inputFrom, fromBase64 } from './runRecord.js';
import { generateTrack } from '../track/generate.js';
import { buildTrack, trackWorld, trackProjection } from '../track/build.js';
import { viewCourse } from '../route/model.js';
import { trackHash } from '../track/events/hash.js';

// a generated track from its code, as the game builds it (the world the physics drives in, and its course)
export function trackFor(code, cfg) {
  const gen = generateTrack({ code });
  if (!gen.ok) throw new Error(gen.error);
  const data = buildTrack(gen, cfg);
  // (its course as a race's: the track's hash with it, as the game's — track/events/prepare.js eventCourse)
  const course = viewCourse(data.course, trackProjection);
  course.trackHash = trackHash(data);
  return { data, track: trackWorld(data), course };
}

const len = v => Math.hypot(v[0], v[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];

// a car's server state at time t, between the two kept either side
function at(list, t) {
  if (!list?.length) return null;
  if (t <= list[0][0]) return list[0];
  for (let i = 1; i < list.length; i++) if (list[i][0] >= t) { const a = list[i - 1], b = list[i], u = (t - a[0]) / Math.max(1, b[0] - a[0]); return a.map((x, k) => x + (b[k] - x) * u); }
  return list.at(-1);
}

// a car on its trail ([t, x, z, vx, vz], a point every half second) at time t: from the nearest point, at its speed —
// as [t, x, z, yaw (unknown), vx, vz]
function fromTrail(trail, t) {
  if (!trail?.length) return null;
  let k = 0;
  for (let i = 1; i < trail.length; i++) if (Math.abs(trail[i][0] - t) < Math.abs(trail[k][0] - t)) k = i;
  const [t0, x, z, vx, vz] = trail[k], dt = (t - t0) / 1000;
  return Math.abs(dt) > 1 ? null : [t, x + vx * dt, z + vz * dt, 0, vx, vz];
}

export function checkContacts({ uid, run, log, cfg }) {
  const V = cfg.verify, problems = [], bad = t => { if (problems.length < 12) problems.push(t); };
  const pushes = (run?.events ?? []).filter(e => e.k === 'J'), dt = 1 / (run?.header?.stepHz ?? 120);
  // the game's own pushes by episode (its hits' apart), the corrections by contact; the episodes it tied to a contact (M)
  const local = new Map(), fixes = new Map(), tied = new Map();
  for (const e of pushes) {
    if (e.c === 'L') { const x = local.get(e.ep) ?? { j: [0, 0], hit: [0, 0], events: [] }; x.j = add(x.j, e.j); if (e.h) x.hit = add(x.hit, e.j); x.events.push(e); local.set(e.ep, x); }
    else if (e.c === 'F') fixes.set(e.cid, add(fixes.get(e.cid) ?? [0, 0], e.j));
    else bad(`A push at step ${e.s} that isn't a contact's.`);
  }
  for (const e of run?.events ?? []) if (e.k === 'M') tied.set(e.ep, e.cid);
  const contacts = (log?.contacts ?? []).filter(c => c.cars?.[uid]);
  const byCid = new Map(contacts.map(c => [c.cid, c]));
  const rejected = new Set((log?.rejected ?? []).filter(r => r.uid === uid).map(r => r.ep));
  const accounted = new Set(), out = [];
  // the light rubbing push, each step: no more than the cap allows a car of this mass, and away from the other car
  const R = cfg.response, L = cfg.limits, G = 9.81;
  // (away from the other car: from where the race server had the other car to where it had this one, at that moment —
  // its own record of both, not the run's word; the rubbing's friction is never more than a quarter of the push)
  const rubOk = (e, mass, mine, theirs) => {
    const cap = mass * L.maxRubG * G * dt * (1 + R.rubFriction) * 1.02 + 1, n = len(e.j);
    if (n > cap) return `a rubbing push of ${n.toFixed(0)} N s in one step (at most ${cap.toFixed(0)})`;
    const a = mine(e.at), b = theirs(e.at);
    if (a && b && n > 1) { const d = [a[1] - b[1], a[2] - b[2]], dl = len(d); if (dl > 0.3 && (e.j[0] * d[0] + e.j[1] * d[1]) < -0.35 * n * dl) return 'a rubbing push towards the other car'; }
    return null;
  };
  for (const c of contacts) {
    const eps = new Set([c.eps?.[uid], ...[...tied].filter(([, cid]) => cid === c.cid).map(([ep]) => ep)].filter(x => x != null));
    // the hit: this game's own hit pushes and the agreed correction add up to the impulse agreed for this car
    let got = fixes.get(c.cid) ?? [0, 0];
    for (const ep of eps) { if (local.has(ep)) { got = add(got, local.get(ep).hit); accounted.add(ep); } }
    const want = c.cars[uid].impulse, off = len(sub(got, want)), tol = V.impulseTolShare * len(want) + V.impulseTolNs;
    out.push({ cid: c.cid, want, got, off });
    if (off > tol) bad(`Contact ${c.cid}: the car was pushed ${len(got).toFixed(0)} N s, the race server agreed ${len(want).toFixed(0)} N s (${off.toFixed(0)} apart).`);
    // the rest: rubbing, within its cap
    // (a car where the race server had it at t: its states round the contact, or — after them, a long rub — its trail)
    const where = id => t => { const l = c.srv?.[id]; return l?.length && t >= l[0][0] - 50 && t <= l.at(-1)[0] + 50 ? at(l, t) : fromTrail(log?.trails?.[id], t); };
    const other = Object.keys(c.cars).find(k => k !== uid), srv = c.srv?.[other], trail = log?.trails?.[other];
    const mass = c.cars[uid].mass ?? run?.header?.mass ?? 1500;
    for (const ep of eps) for (const e of local.get(ep)?.events ?? []) { if (e.h) continue; const why = rubOk(e, mass, where(uid), where(other)); if (why) { bad(`Contact ${c.cid}: ${why}.`); break; } }
    // the other car was where the game pushed against it
    for (const ep of eps) for (const e of local.get(ep)?.events ?? []) {
      if (!e.f || e.at == null) continue;
      const s = srv?.length && e.at >= srv[0][0] - 50 && e.at <= srv.at(-1)[0] + 50 ? at(srv, e.at) : fromTrail(trail, e.at);
      if (!s) continue;
      const d = Math.hypot(e.f[0] - s[1], e.f[1] - s[2]), speed = Math.hypot(s[4], s[5]);
      if (d > V.proxyTolM + V.proxyTolPerSpeed * speed) { bad(`Contact ${c.cid}: the other car wasn't where this run pushed against it (${d.toFixed(1)} m from where the race server had it).`); break; }
    }
  }
  // refused contacts: undone (the game's pushes and the correction cancel out)
  for (const ep of rejected) {
    if (!local.has(ep)) continue;
    accounted.add(ep);
    const net = add(local.get(ep).j, fixes.get(`x${ep}`) ?? [0, 0]);
    if (len(net) > V.impulseTolNs) bad(`A contact the race server refused wasn't undone (${len(net).toFixed(0)} N s left).`);
  }
  // pushes the server never heard of
  for (const [ep, x] of local) if (!accounted.has(ep) && len(x.j) > V.impulseTolNs) bad(`Pushes the race server never heard of (${len(x.j).toFixed(0)} N s, from step ${x.events[0].s}).`);
  for (const [cid, j] of fixes) if (!byCid.has(cid) && !(cid.startsWith('x') && rejected.has(Number(cid.slice(1)))) && len(j) > V.impulseTolNs) bad(`A correction for a contact the race server never agreed (${cid}).`);
  return { ok: problems.length === 0, problems, contacts: out };
}

// the run's trail against where the race server saw the car: header.t0 (room ms at the run's first step), dt. Where,
// not exactly when: each point must lie on the server's record of the car (its half-second trail, as a path) within
// `trailWindowSec` of the point's time — a computer whose physics falls behind real time (a slow one: the physics
// catches up a second a frame) maps its steps onto the race's clock only roughly; the race's own timing is checked
// apart (the race server's timing of the run, Phase 6's checks)
export function checkTrail({ run, serverTrail, cfg }) {
  const problems = [], dt = 1000 / (run?.header?.stepHz ?? 120), t0 = run?.header?.t0, V = cfg.verify, W = (V.trailWindowSec ?? 2.5) * 1000;
  if (t0 == null || !serverTrail?.length) return problems;
  let worst = 0, where = null;
  // (not across a reset: the car put elsewhere, the server's half-second trail jumps with it)
  const resets = (run.events ?? []).filter(e => e.k === 'R').map(e => e.s), nearReset = s => resets.some(r => Math.abs(s - r) * dt < 1100);
  const segDist = (px, pz, a, b) => { const dx = b[1] - a[1], dz = b[2] - a[2], L = dx * dx + dz * dz, u = L > 0 ? Math.max(0, Math.min(1, ((px - a[1]) * dx + (pz - a[2]) * dz) / L)) : 0; return Math.hypot(px - (a[1] + dx * u), pz - (a[2] + dz * u)); };
  for (const [s, x, , z, stamp] of run.trail ?? []) {
    if (nearReset(s)) continue;
    const t = stamp ?? t0 + s * dt;
    if (t < serverTrail[0][0] || t > serverTrail.at(-1)[0]) continue;
    const near = serverTrail.filter(p => Math.abs(p[0] - t) <= W);
    if (near.length < 2) continue;
    let d = Infinity, speed = 0;
    for (let i = 1; i < near.length; i++) { const e = segDist(x, z, near[i - 1], near[i]); if (e < d) { d = e; speed = Math.hypot(near[i][3] ?? 0, near[i][4] ?? 0); } }
    const tol = V.trailTolM + V.trailTolPerSpeed * speed;
    if (d - tol > worst) { worst = d - tol; where = { s, d }; }
  }
  if (where) problems.push(`The run's car wasn't where the race server saw it (${where.d.toFixed(1)} m off at step ${where.s}).`);
  return problems;
}

// The run driven again, headless: the car put where it started, every step's input, the car's changes between steps
// at the step they counted from, the pushes in the step they were applied — exactly as the game did
export function replayRun({ RAPIER, settings, spec, sockets, track, run, everyStep = null }) {
  const sim = createSimulation(RAPIER, { settings, spec, sockets, track });
  const H = run.header ?? {};
  sim.resetCar(H.pose);
  if (H.aids) Object.assign(sim.vehicle.aids, H.aids);
  if (H.damage !== undefined) sim.vehicle.spec.damage = H.damage ?? sim.vehicle.spec.damage;
  const inputs = fromBase64(run.inputs), steps = inputs.length / 5;
  const carEvents = new Map(), pushes = new Map();
  for (const e of run.events ?? []) { const m = e.k === 'J' ? pushes : carEvents; if (e.k === 'M') continue; (m.get(e.s) ?? m.set(e.s, []).get(e.s)).push(e); }
  let i = 0;
  const stop = sim.beforeWorldStep(() => {
    const b = sim.vehicle.body;
    for (const e of pushes.get(i) ?? []) b.applyImpulseAtPoint({ x: e.j[0], y: 0, z: e.j[1] }, { x: e.p[0], y: b.worldCom().y, z: e.p[1] }, true);
  });
  const trail = [], want = new Set((run.trail ?? []).map(x => x[0]));
  for (i = 0; i < steps; i++) {
    for (const e of carEvents.get(i) ?? []) {
      const v = sim.vehicle;
      if (e.k === 'D') v.spec.damage = e.damage;
      else if (e.k === 'A') Object.assign(v.aids, e.aids ?? {});
      else if (e.k === 'R') sim.resetCar(e.at);
      else if (e.k === 'P') {
        if (e.op === 'loosen') v.parts.loosen(e.socket, e.def);
        else if (e.op === 'detach') v.parts.detach(e.socket, e.def, sim.time, e.key ?? e.socket);
        else if (e.op === 'reattach') v.parts.reattach(e.socket);
        else if (e.op === 'clear') v.parts.clear();
      }
    }
    if (want.has(i)) { const p = sim.vehicle.body.translation(); trail.push([i, Math.fround(p.x), Math.fround(p.y), Math.fround(p.z)]); }
    sim.step(inputFrom(inputs, i, { wheelRange: H.wheelRange ?? null }));
    everyStep?.(sim, i);
  }
  stop();
  const p = sim.vehicle.body.translation();
  const out = { trail, steps, final: [p.x, p.y, p.z] };
  sim.vehicle.world.free();
  return out;
}
export function compareTrails(claimed, replayed, tolM = 0.01) {
  const by = new Map(replayed.map(x => [x[0], x]));
  for (const [s, x, y, z] of claimed ?? []) {
    const r = by.get(s);
    if (!r) return [`The run's trail has a point at step ${s} the replay never reached.`];
    const d = Math.hypot(x - r[1], y - r[2], z - r[3]);
    if (d > tolM) return [`Driven again from its inputs and pushes, the car isn't where the run says it was (${d.toFixed(3)} m off at step ${s}).`];
  }
  return [];
}
