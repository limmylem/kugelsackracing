// Car-to-car contact between players (Phase 7 Step 3; docs/CONTACT.md), pure: the same functions on the player's
// game (its car against the other cars' proxies), on the race server (its own view of the cars, the agreed result,
// blame, ghosting, penalties) and in the verifier (a run driven again). Every number is in data/multiplayer.json
// `contact`. Fair and stable beats realistic: every push is horizontal, at the centre of mass's height, and capped.
//
// Shapes: a car is its FOOTPRINT, an oriented box in the ground plane (its body box's length and width) with the
// height range it occupies. Car frame (physics/vehicle.js): +x left, +z forward; heading yaw: forward [sin, cos].
//   footprintOf({ pos, rot | yaw, vel, ang | w }, box, { mass, yawI }) → { x, z, yaw, hl, hw, y0, y1, vx, vz, w, mass, yawI }
//     box: the body collider ({ halfExtents: [hx, hy, hz], centre: [cx, cy, cz] }, the spec's bodyCollider)
//   overlap(a, b) → { depth, gap, n: [x, z] (unit, from a to b), point: [x, z] } — depth > 0: touching (heights too);
//     gap: how far apart (≤ 0 when overlapping, the boxes' separation along the best axis otherwise)
//   closingAt(a, b, n, point) → how fast a goes into b along n there (m/s; > 0 closing)
//   zoneOf(f, point) → 'front' | 'rear' | 'side' (where on car f a world point is)
//
// The local response, one physics step at a time, for the player's own car against one proxy:
//   const T = createContactTracker(cfg)
//   T.step(me, proxy, { dt, t, otherId, ghost, stampT }) → null | { impulse: [x, z], point: [x, z], kind, episode,
//     start, used (the proxy's footprint as used) }
//     an episode starts when the boxes first overlap: a HIT (closing faster than rubBelow) is the two-body impulse
//     (1 + e)·m_red·v spread over impactSpreadSec — and, while they still close that fast, this car's share of
//     stopping them; RUBBING is a soft spring and damper on the overlap with a little sliding friction. Capped: the
//     change of speed (maxDeltaV), the yaw spin (maxSpin), the rubbing force (maxRubG). During a hit the proxy is moved
//     by its predicted reaction (the push, equal and opposite) until its own states show it.
//   T.reports(t) → the episodes due a report (reportAfterMs after they started)   T.episodes   T.reset()
//
// The race server:
//   agree(reports, { a, b, serverView, mode, cfg }) → the agreed result (or { ok: false, why })
//     reports: one or both players' (the reporter's view: closing, n towards the other, point, positions, J applied)
//     a / b: { pid, mass, box }  serverView: overlap and closing from the server's own log at the report's time
//   blame({ a, b, result, history, cfg }) → { shares: { pid: 0..1 }, fault, careless, reasons }
//   ghostState(car, now, cfg, ctx) → { ghost, reasons }     (auto-ghosting: lag, resets, rejoins, wrong way, pits …)
//   createIncidents(cfg) → add(result, blame, t) → actions [{ type: 'penalty' | 'ghost' | 'ramming', pid, … }]
//   safetyAfterRace(sr, incidents, { km, cfg }) → { sr, delta, points }     safetyTier(sr, cfg) → { id, name }

const G = 9.81;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const len2 = a => Math.hypot(a[0], a[1]);
const norm2 = a => { const l = len2(a); return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0]; };
// (r × j)·y for horizontal r = (rx, 0, rz), j = (jx, 0, jz): rz·jx − rx·jz — the yaw a push at r gives (a positive yaw
// turns forward from +z towards +x, as yawOf has it)
const cross2 = (r, j) => r[1] * j[0] - r[0] * j[1];

// the yaw of a rotation (a quaternion [x, y, z, w] or { x, y, z, w }): forward is [sin yaw, cos yaw]
export function yawOf(q) {
  const [x, y, z, w] = Array.isArray(q) ? q : [q.x, q.y, q.z, q.w];
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

export function footprintOf(s, box, { mass = 1300, yawI = null } = {}) {
  const yaw = s.yaw ?? yawOf(s.rot), f = [Math.sin(yaw), Math.cos(yaw)], l = [Math.cos(yaw), -Math.sin(yaw)];
  const [hx, hy, hz] = box?.halfExtents ?? [0.9, 0.6, 2.2], [cx, cy, cz] = box?.centre ?? [0, 0.7, 0];
  const pos = s.pos, vel = s.vel ?? [0, 0, 0];
  // (the yaw spin: the world-frame spin's y, a quaternion's or as given)
  const w = s.w ?? (s.ang ? s.ang[1] : 0);
  return {
    x: pos[0] + f[0] * cz + l[0] * cx, z: pos[2] + f[1] * cz + l[1] * cx, yaw, hl: hz, hw: hx,
    y0: pos[1] + cy - hy, y1: pos[1] + cy + hy, vx: vel[0], vz: vel[2], w, mass,
    yawI: yawI ?? mass * ((2 * hx) ** 2 + (2 * hz) ** 2) / 12,
  };
}
const axesOf = f => [[Math.sin(f.yaw), Math.cos(f.yaw)], [Math.cos(f.yaw), -Math.sin(f.yaw)]];
// how far a box reaches along an axis from its centre
const reach = (f, ax) => { const [fw, lf] = axesOf(f); return f.hl * Math.abs(dot2(fw, ax)) + f.hw * Math.abs(dot2(lf, ax)); };
const corners = f => { const [fw, lf] = axesOf(f); return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [f.x + fw[0] * a * f.hl + lf[0] * b * f.hw, f.z + fw[1] * a * f.hl + lf[1] * b * f.hw]); };
const inside = (f, p) => { const [fw, lf] = axesOf(f), d = [p[0] - f.x, p[1] - f.z]; return Math.abs(dot2(d, fw)) <= f.hl + 1e-9 && Math.abs(dot2(d, lf)) <= f.hw + 1e-9; };

// Separating axes: the least overlap is the depth, along the normal (from a to b)
export function overlap(a, b) {
  const d = [b.x - a.x, b.z - a.z];
  let best = null;
  for (const ax of [...axesOf(a), ...axesOf(b)]) {
    const o = reach(a, ax) + reach(b, ax) - Math.abs(dot2(d, ax));
    if (!best || o < best.o) best = { o, ax: dot2(d, ax) >= 0 ? ax : [-ax[0], -ax[1]] };
  }
  const heights = a.y1 > b.y0 && b.y1 > a.y0;
  // where: the corners of each inside the other (the deepest part), else between the two
  const pts = [...corners(a).filter(p => inside(b, p)), ...corners(b).filter(p => inside(a, p))];
  const point = pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
    : [a.x + best.ax[0] * (reach(a, best.ax) - Math.max(0, best.o) / 2), a.z + best.ax[1] * (reach(a, best.ax) - Math.max(0, best.o) / 2)];
  return { depth: heights ? best.o : Math.min(best.o, -0.01), gap: -best.o, n: best.ax, point, heights };
}

// a point's velocity on a footprint (its yaw spin turning it: ω = (0, w, 0), r = (rx, 0, rz) → (w·rz, 0, −w·rx))
const velAt = (f, p) => [f.vx + f.w * (p[1] - f.z), f.vz - f.w * (p[0] - f.x)];
export const closingAt = (a, b, n, p) => dot2([velAt(a, p)[0] - velAt(b, p)[0], velAt(a, p)[1] - velAt(b, p)[1]], n);

export function zoneOf(f, p, frontShare = 0.45) {
  const [fw] = axesOf(f), along = dot2([p[0] - f.x, p[1] - f.z], fw);
  return along > f.hl * frontShare ? 'front' : along < -f.hl * frontShare ? 'rear' : 'side';
}
// a world point in a car's frame (x left, z forward), from its footprint
export function toCarFrame(f, p) { const [fw, lf] = axesOf(f), d = [p[0] - f.x, p[1] - f.z]; return [dot2(d, lf), dot2(d, fw)]; }
export const reducedMass = (m1, m2) => m1 * m2 / (m1 + m2);

// The yaw spin an impulse j (horizontal, world) at point p gives a car: Δω = (r × j)·y / I
export const spinOf = (f, p, j) => cross2([p[0] - f.x, p[1] - f.z], j) / f.yawI;

// Scale an impulse's lever arm so the spin stays within what's left: the push still at the point's line through the
// centre of mass, just nearer the centre (no extra speed, less spin)
function capSpin(f, p, j, left) {
  const dw = spinOf(f, p, j);
  if (Math.abs(dw) <= left || Math.abs(dw) < 1e-12) return { point: p, spin: dw };
  const k = Math.max(0, left) / Math.abs(dw);
  return { point: [f.x + (p[0] - f.x) * k, f.z + (p[1] - f.z) * k], spin: dw * k };
}

export function createContactTracker(cfg) {
  const R = cfg.response, L = cfg.limits;
  const episodes = new Map();          // other id → episode
  let nextEp = 1;
  // The other car as this game treats it during a hit: moved by the push this car gave it (equal and opposite, by its
  // mass), until its own states show its reaction — handed over as the newest one's stamp (stampT, in the same seconds as
  // t) passes the hit's beginning, fully once it's reactSec after. So this car doesn't keep pushing into a car that, in
  // its owner's game, has already been knocked away.
  // (handed over smoothly: the states stamped in the reactSec after the hit began show part of the reaction already)
  const unseen = (ep, stampT) => stampT == null ? 1 : Math.max(0, Math.min(1, 1 - (stampT - ep.start) / R.reactSec));
  const reacted = (other, ep, stampT) => {
    const k = ep && (ep.pv[0] || ep.pv[1]) ? unseen(ep, stampT) : 0;
    return k <= 0 ? other : { ...other, x: other.x + ep.disp[0] * k, z: other.z + ep.disp[1] * k, vx: other.vx + ep.pv[0] * k, vz: other.vz + ep.pv[1] * k };
  };
  const advance = (ep, dt) => { if (ep) { ep.disp[0] += ep.pv[0] * dt; ep.disp[1] += ep.pv[1] * dt; } };
  // each other car's speed relative to this one over the last closingLookSec (the closing speed of a hit is the one
  // just before it: whichever game notices the touch second may already see the other car's reaction to it)
  const recent = new Map();
  const remember = (id, me, other, t) => {
    const l = recent.get(id) ?? [];
    l.push({ t, rv: [me.vx - other.vx, me.vz - other.vz] });
    while (l.length && t - l[0].t > R.closingLookSec) l.shift();
    recent.set(id, l);
    return l;
  };
  return {
    episodes,
    reset() { episodes.clear(); recent.clear(); },
    // One physics step: me (the player's car's footprint), proxy (the other car's, predicted to the present), at
    // simulation time t (s); stampT: when the proxy's newest state was stamped (s, the same clock as t)
    step(me, proxy, { dt, t, otherId = 'other', ghost = false, stampT = null }) {
      let ep = episodes.get(otherId);
      const other = reacted(proxy, ep, stampT);
      const hist = remember(otherId, me, other, t);
      const o = ghost ? null : overlap(me, other);
      const touching = !!o && o.heights && o.depth > 0;
      // (a contact the race server refused: nothing more pushed for it while it lasts)
      if (ep?.void && !ep.over) { if (touching) ep.lastTouch = t; else if (t - ep.lastTouch > R.endAfterSec) ep.over = true; return null; }
      if (touching && ep) {
        const now = closingAt(me, other, o.n, o.point);
        // rubbing that turns into a real knock: a hit of its own (reported and agreed as one)
        if (!ep.over && ep.kind === 'rub' && !ep.settled && now > R.rubBelow * 1.25) ep.over = true;
        // rubbing that parted for a moment and leans in again: the same contact still, not a new one each time
        else if (ep.over && !ep.void && ep.kind === 'rub' && now < R.rubBelow && t - ep.lastTouch <= R.forgetSec) ep.over = false;
      }
      if (!touching) {
        if (ep && !ep.over && t - ep.lastTouch > R.endAfterSec) ep.over = true;
        if (ep?.over && t - ep.lastTouch > R.forgetSec) { episodes.delete(otherId); return null; }
        // (a hit still being spread keeps going for its steps even as the boxes part)
        if (!ep || ep.stepsLeft <= 0) { advance(ep, dt); return null; }
      }
      // a new episode: the boxes overlap and either there wasn't one, or the last one has ended
      if (touching && (!ep || ep.over)) {
        const closing = Math.max(0, closingAt(me, other, o.n, o.point), ...hist.map(h => dot2(h.rv, o.n))), mRed = reducedMass(me.mass, other.mass);
        const kind = closing >= R.rubBelow ? 'hit' : 'rub';
        const J = kind === 'hit' ? Math.min((1 + R.restitution) * mRed * closing, me.mass * L.maxDeltaV) : 0;
        const steps = Math.max(1, Math.round(R.impactSpreadSec / dt));
        ep = { id: nextEp++, other: otherId, kind, start: t, lastTouch: t, closing, n: o.n, point: o.point, depth: o.depth, J, stepsLeft: kind === 'hit' ? steps : 0, perStep: J / steps,
          applied: [0, 0], dv: 0, spin: 0, pv: [0, 0], disp: [0, 0], reported: false, over: false, maxDepth: o.depth,
          me: { x: me.x, z: me.z, vx: me.vx, vz: me.vz, yaw: me.yaw, w: me.w }, them: { x: other.x, z: other.z, vx: other.vx, vz: other.vz, yaw: other.yaw, w: other.w } };
        episodes.set(otherId, ep);
      }
      if (touching) { ep.lastTouch = t; ep.maxDepth = Math.max(ep.maxDepth, o.depth); }
      const n = touching ? o.n : ep.n, point = touching ? o.point : ep.point;
      let j = [0, 0], kind;
      if (ep.stepsLeft > 0) {
        // the hit, spread over a few steps: along −n (away from the other car)
        kind = 'hit'; j = [-n[0] * ep.perStep, -n[1] * ep.perStep]; ep.stepsLeft--;
      } else {
        const closing = closingAt(me, other, n, point);
        // (once the race server has agreed the contact, its hit is settled: only the light push from here on)
        if (closing > R.rubBelow && !ep.settled) {
          // still closing hard after the hit (the other car's reaction not yet in its states): this car's share of
          // stopping it (an inelastic contact) — from the same budget as the hit
          kind = 'hit';
          const k = me.mass * other.mass / (me.mass + other.mass) * closing;
          j = [-n[0] * k, -n[1] * k];
        } else {
          // leaning on each other: a soft spring on the overlap and a damper on the closing speed, capped; and a little
          // friction against the sliding (never more than stops it)
          kind = 'rub';
          // (the damper both ways — less push while they draw apart — so they settle rather than bounce)
          const a = Math.min(L.maxRubG * G, Math.max(0, R.rubStiffness * o.depth + R.rubDamping * closing));
          const push = me.mass * a * dt;
          const va = velAt(me, point), vb = velAt(other, point), rel = [va[0] - vb[0], va[1] - vb[1]];
          const tang = [rel[0] - n[0] * dot2(rel, n), rel[1] - n[1] * dot2(rel, n)], ts = len2(tang);
          const fr = ts > 1e-6 ? Math.min(R.rubFriction * push, 0.5 * ts * me.mass) : 0;
          j = [-n[0] * push - (ts > 1e-6 ? tang[0] / ts * fr : 0), -n[1] * push - (ts > 1e-6 ? tang[1] / ts * fr : 0)];
        }
      }
      if (!j[0] && !j[1]) { advance(ep, dt); return null; }
      // the caps: the speed a hit may change, the spin (each per episode)
      if (kind === 'hit') {
        const dv = len2(j) / me.mass, room = L.maxDeltaV - ep.dv;
        if (room <= 1e-9) { advance(ep, dt); return null; }
        if (dv > room) j = [j[0] * room / dv, j[1] * room / dv];
        ep.dv += len2(j) / me.mass;
        // (the other car's reaction to it, as this game predicts it until its own states show it)
        ep.pv = [ep.pv[0] - j[0] / other.mass, ep.pv[1] - j[1] / other.mass];
      }
      // (the spin: no more than maxSpin from one contact — and never pushing the car's own yaw rate past maxSpin either,
      // so a car already turning, or knocked by another just before, isn't spun up further)
      const dw = spinOf(me, point, j), adds = dw * (me.w ?? 0) > 0;
      const s = capSpin(me, point, j, Math.min(L.maxSpin - Math.abs(ep.spin), adds ? Math.max(0, L.maxSpin - Math.abs(me.w)) : Infinity));
      ep.spin += s.spin;
      ep.applied = [ep.applied[0] + j[0], ep.applied[1] + j[1]];
      advance(ep, dt);
      return { impulse: j, point: s.point, kind, episode: ep.id, start: ep.start === t, used: other };
    },
    // how far this game's pushes have moved the other car, as it predicts it, while its own states don't show it yet
    // (stampT: s, as step's) — null once they do, or when there's nothing to show
    predicted(otherId, stampT) { const ep = episodes.get(otherId), k = ep && (ep.disp[0] || ep.disp[1]) ? unseen(ep, stampT) : 0; return k > 0 ? [ep.disp[0] * k, ep.disp[1] * k] : null; },
    // the race server's word on an episode: agreed (its hit settled) or refused (void: nothing more pushed for it)
    settle(id, { refused = false } = {}) { for (const ep of episodes.values()) if (ep.id === id) { ep.settled = true; if (refused) ep.void = true; } },
    // the episodes to report now (reportAfterMs after each began): what this player's game saw
    reports(t) {
      const out = [];
      for (const ep of episodes.values()) if (!ep.reported && t - ep.start >= cfg.agree.reportAfterMs / 1000) { ep.reported = true; out.push(ep); }
      return out;
    },
  };
}

// ---------- the race server ----------

const angleBetween = (a, b) => Math.acos(clamp(dot2(norm2(a), norm2(b)), -1, 1)) * 180 / Math.PI;

// The agreed result of one contact. reports: the players' own ({ pid, other, t, kind, closing, n, point, me, them,
// J, predictMs }); a, b: { pid, mass, box }; serverView: { gap, closing, n, point } from the server's log (or null);
// mode: 'full' | 'reduced' | 'ghost'. Out: { ok, why, kind, t, closing, n (a→b), J, gentler, sources, cars: { pid:
// { impulse: [x, z], point: [x, z] world, strength, closing, scale } } }
export function agree(reports, { a, b, serverView = null, mode = 'reduced', cfg }) {
  const A = cfg.agree, R = cfg.response, L = cfg.limits;
  if (mode === 'ghost') return { ok: false, why: 'Ghost mode: cars don\'t touch.' };
  const ra = reports.find(r => r.pid === a.pid) ?? null, rb = reports.find(r => r.pid === b.pid) ?? null;
  if (!ra && !rb) return { ok: false, why: 'No report.' };
  // (each report's normal, as a → b)
  const nA = ra ? ra.n : null, nB = rb ? [-rb.n[0], -rb.n[1]] : null;
  let closing, n, gentler = false, sources;
  if (ra && rb) {
    const tol = Math.max(A.closingTol, A.closingTolShare * Math.max(ra.closing, rb.closing));
    const agreeV = Math.abs(ra.closing - rb.closing) <= tol, agreeN = angleBetween(nA, nB) <= A.normalTolDeg;
    if (agreeV && agreeN) { closing = (ra.closing + rb.closing) / 2; n = norm2([nA[0] + nB[0], nA[1] + nB[1]]); sources = 'both'; }
    else {
      // they don't agree (lag, a lost state): the gentler of the two, as that player saw it
      const g = ra.closing <= rb.closing ? { v: ra.closing, n: nA } : { v: rb.closing, n: nB };
      closing = g.v; n = g.n; gentler = true; sources = 'both, disagreeing';
    }
  } else {
    // one report: the server's own view at that moment must show the cars together
    const r = ra ?? rb, rn = ra ? nA : nB;
    if (!serverView || serverView.gap > A.serverCheckM) return { ok: false, why: `The race server didn't see the cars touch (${serverView ? `${serverView.gap.toFixed(1)} m apart` : 'no states'}).` };
    closing = Math.min(r.closing, Math.max(0, serverView.closing ?? r.closing)); n = rn; gentler = closing < r.closing; sources = 'one, checked against the server';
  }
  const kind = (ra?.kind === 'hit' || rb?.kind === 'hit') && closing >= R.rubBelow ? 'hit' : 'rub';
  // the impulse: Phase 3's car-to-car rule (the two masses, the closing speed along the normal), capped so neither car
  // changes speed by more than maxDeltaV; rubbing keeps the push each game applied (its force was capped already)
  let J = kind === 'hit' ? Math.min((1 + R.restitution) * reducedMass(a.mass, b.mass) * closing, Math.min(a.mass, b.mass) * L.maxDeltaV) : 0;
  const scale = mode === 'reduced' ? cfg.damage.reduced : 1;
  const t = ra && rb ? Math.min(ra.t, rb.t) : (ra ?? rb).t;
  const pointOf = (r, other) => (r ?? other).point;
  const strengthOf = (m, om) => kind === 'hit' ? Math.min(closing * om / (m + om), J / m) : 0;
  // (rubbing: no hit for either car — only each game's own light push, capped and checked step by step by the verifier)
  const cars = {
    [a.pid]: { impulse: kind === 'hit' ? [-n[0] * J, -n[1] * J] : [0, 0], point: pointOf(ra, rb), closing, strength: strengthOf(a.mass, b.mass), scale, n: [n[0], n[1]], mass: a.mass },
    [b.pid]: { impulse: kind === 'hit' ? [n[0] * J, n[1] * J] : [0, 0], point: pointOf(rb, ra), closing, strength: strengthOf(b.mass, a.mass), scale, n: [-n[0], -n[1]], mass: b.mass },
  };
  // (where on each car, in its own frame — x left, z forward — as it was at the contact: its own report's pose, else the
  // other's view of it, else the server's; the damage comes from this, whenever the result arrives)
  const poseOf = (own, theirs, srv) => own?.me ?? theirs?.them ?? srv ?? null;
  for (const [pid, pose] of [[a.pid, poseOf(ra, rb, serverView?.fa)], [b.pid, poseOf(rb, ra, serverView?.fb)]]) {
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || !Number.isFinite(pose.yaw)) continue;
    const c = cars[pid], f = { x: pose.x, z: pose.z, yaw: pose.yaw }, [fw, lf] = axesOf(f);
    c.local = toCarFrame(f, c.point); c.nLocal = [dot2(c.n, lf), dot2(c.n, fw)];
  }
  return { ok: true, kind, t, closing, n, J, gentler, sources, cars };
}

// ---------- blame ----------
// history: { pid: [{ t, pos: [x, y, z], vel, yaw, u (distance along the race), lateral (signed, off the line) }] }, the
// last couple of seconds before the contact, oldest first. result: agree()'s. a / b: { pid, box, mass }.
export function blame({ a, b, result, history = {}, cfg, footprints }) {
  const B = cfg.blame, W = B.weights, reasons = [];
  const fa = footprints[a.pid], fb = footprints[b.pid];
  const score = { [a.pid]: 0, [b.pid]: 0 };
  const add = (pid, w, why) => { score[pid] += w; if (why) reasons.push(why); };
  const p = result.cars[a.pid].point;
  // 1. who hit whom: a nose into the other's tail or side is the hitter
  const za = zoneOf(fa, p), zb = zoneOf(fb, p);
  if (za === 'front' && zb !== 'front') add(a.pid, W.hitter, `${a.name ?? a.pid}'s front into ${b.name ?? b.pid}'s ${zb}`);
  else if (zb === 'front' && za !== 'front') add(b.pid, W.hitter, `${b.name ?? b.pid}'s front into ${a.name ?? a.pid}'s ${za}`);
  else { score[a.pid] += W.hitter / 2; score[b.pid] += W.hitter / 2; }
  // 2. who closed in: each car's own speed towards the other along the normal
  const n = result.n, ca = Math.max(0, fa.vx * n[0] + fa.vz * n[1]), cb = Math.max(0, -(fb.vx * n[0] + fb.vz * n[1]));
  if (ca + cb > 0.2) { score[a.pid] += W.closing * ca / (ca + cb); score[b.pid] += W.closing * cb / (ca + cb); if (Math.abs(ca - cb) > 1) reasons.push(`${(ca > cb ? a : b).name ?? (ca > cb ? a : b).pid} closed in faster`); }
  else { score[a.pid] += W.closing / 2; score[b.pid] += W.closing / 2; }
  // 3. braking much harder than the car behind expected (a brake test): the car ahead's
  // (the hardest braking in the look back, a quarter second at a time: a late stab on the brakes counts in full)
  const decel = pid => {
    const h = (history[pid] ?? []).filter(s => s.t >= (history[pid]?.at(-1)?.t ?? 0) - B.lookSec * 1000);
    let most = 0;
    for (const x of h) { const y = h.findLast(s => s.t <= x.t - 250); if (!y) continue; const dt = (x.t - y.t) / 1000; if (dt > 0.12) most = Math.max(most, (len2([y.vel[0], y.vel[2]]) - len2([x.vel[0], x.vel[2]])) / dt); }
    return most;
  };
  const uOf = pid => (history[pid] ?? []).at(-1)?.u ?? null;
  const ua = uOf(a.pid), ub = uOf(b.pid), ahead = ua != null && ub != null ? (ua > ub ? a : b) : null, behind = ahead ? (ahead === a ? b : a) : null;
  const brakeTest = ahead && decel(ahead.pid) > B.brakeTestG * G && decel(behind.pid) < B.brakeTestG * G * 0.5 ? ahead : null;
  if (brakeTest) add(brakeTest.pid, W.braking, `${brakeTest.name ?? brakeTest.pid} braked hard in front`);
  else { score[a.pid] += W.braking / 2; score[b.pid] += W.braking / 2; }
  // 4. left its line towards the other car (a swerve)
  const swerve = (pid, towards) => { const h = history[pid] ?? []; if (h.length < 2) return 0; const x = h.at(-1), y = h.find(s => s.t >= x.t - B.lookSec * 1000) ?? h[0]; const dt = (x.t - y.t) / 1000; if (dt < 0.1) return 0; const lat = [x.pos[0] - y.pos[0], x.pos[2] - y.pos[2]], f = [Math.sin(y.yaw), Math.cos(y.yaw)]; const side = [lat[0] - f[0] * dot2(lat, f), lat[1] - f[1] * dot2(lat, f)]; return Math.max(0, dot2(side, towards)) / dt; };
  const sa = swerve(a.pid, n), sb = swerve(b.pid, [-n[0], -n[1]]);
  const swerver = sa > B.swerveMs && sa > sb * 1.5 ? a : sb > B.swerveMs && sb > sa * 1.5 ? b : null;
  if (swerver) add(swerver.pid, W.line, `${swerver.name ?? swerver.pid} left their line`);
  else { score[a.pid] += W.line / 2; score[b.pid] += W.line / 2; }
  // 5. who was ahead: the one behind has the most room to avoid it
  if (behind) add(behind.pid, W.behind, null); else { score[a.pid] += W.behind / 2; score[b.pid] += W.behind / 2; }
  const total = score[a.pid] + score[b.pid] || 1, shares = { [a.pid]: score[a.pid] / total, [b.pid]: score[b.pid] / total };
  // a brake test or a swerve into the other car outweighs who hit whom: a share of the other's fault moves to them
  const shift = (to, k) => { const from = to.pid === a.pid ? b.pid : a.pid, x = shares[from] * k; shares[from] -= x; shares[to.pid] += x; };
  if (brakeTest) shift(brakeTest, B.shifts.brakeTest);
  if (swerver) shift(swerver, B.shifts.swerve);
  const top = shares[a.pid] >= shares[b.pid] ? a : b, share = shares[top.pid];
  const strength = Math.max(result.cars[a.pid].strength, result.cars[b.pid].strength);
  const fault = share >= B.faultShare ? top.pid : null;
  return { shares, fault, share, careless: !!fault && share >= B.carelessShare && strength >= B.minStrength, strength, reasons };
}

// ---------- ghosting ----------
// car: { pingMs, jitterMs, resetAt, rejoinAt, wrongWay (seconds going the wrong way), rightWay (seconds back on it
// since), inPit, lap, u, lappedBy (a car a lap ahead within lappedWithinM), offender (ghosted for incidents) }
export function ghostState(car, now, cfg, { mode = 'reduced' } = {}) {
  const G = cfg.ghost, reasons = [];
  if (mode === 'ghost') return { ghost: true, reasons: ['ghost mode'] };
  if (car.pingMs > G.maxPingMs) reasons.push(`ping ${Math.round(car.pingMs)} ms`);
  if (car.jitterMs > G.maxJitterMs) reasons.push(`jitter ${Math.round(car.jitterMs)} ms`);
  // (a game that can't keep up — a few frames a second — sends its car too seldom to be touched fairly)
  if (G.maxStateGapMs && car.gapMs > G.maxStateGapMs) reasons.push(`updates ${Math.round(car.gapMs)} ms apart`);
  if (car.resetAt != null && now - car.resetAt < G.resetSec * 1000) reasons.push('just reset');
  if (car.rejoinAt != null && now - car.rejoinAt < G.rejoinSec * 1000) reasons.push('just rejoined');
  if (car.wrongWay >= G.wrongWaySec || (car.wasWrong && car.rightWay < G.rightWaySec)) reasons.push('going the wrong way');
  if (G.pitLane && car.inPit) reasons.push('in the pit lane');
  if (G.firstCorner && car.lap === 1 && car.u != null && car.u < G.firstCornerM) reasons.push('the first corner');
  if (G.lapped && car.lappedBy) reasons.push('being lapped');
  if (car.offender) reasons.push('too many incidents');
  return { ghost: reasons.length > 0, reasons };
}

// ---------- incidents in a race: penalties, repeat offenders, ramming ----------
export function createIncidents(cfg) {
  const P = cfg.penalties, RM = cfg.ramming, list = [], count = new Map(), ghosted = new Set(), flagged = new Set();
  return {
    list,
    // one agreed contact and its blame at room time t → what the race should do about it
    add(result, bl, t, { a, b }) {
      const actions = [];
      if (!bl.fault) return actions;
      const victim = bl.fault === a.pid ? b.pid : a.pid;
      const inc = { t, fault: bl.fault, victim, share: bl.share, strength: bl.strength, careless: bl.careless, kind: result.kind };
      list.push(inc);
      if (!bl.careless) return actions;
      count.set(bl.fault, (count.get(bl.fault) ?? 0) + 1);
      if (P.enabled && bl.share >= P.crashShare && bl.strength >= P.crashStrength) actions.push({ type: 'penalty', pid: bl.fault, seconds: P.seconds, why: `Caused a crash (${Math.round(bl.share * 100)}% at fault)` });
      if (count.get(bl.fault) >= P.repeatIncidents && !ghosted.has(bl.fault)) { ghosted.add(bl.fault); actions.push({ type: 'ghost', pid: bl.fault, why: `${P.repeatIncidents} careless contacts: ghosted for the rest of the race` }); }
      // ramming: the same car hit again and again by the same driver, each mostly their fault
      const recent = list.filter(x => x.fault === bl.fault && x.victim === victim && x.share >= RM.minShare && t - x.t <= RM.withinSec * 1000);
      const key = `${bl.fault}>${victim}`;
      if (recent.length >= RM.hits && !flagged.has(key)) { flagged.add(key); actions.push({ type: 'ramming', pid: bl.fault, victim, hits: recent.length, why: `${recent.length} hits on the same car in ${RM.withinSec} s` }); }
      return actions;
    },
    // a player's incidents in this race (for the safety rating): [{ share, strength }]
    of(pid) { return list.filter(x => x.fault === pid).map(x => ({ share: x.share, strength: x.strength, careless: x.careless })); },
  };
}

// ---------- the safety rating ----------
export function incidentPoints(inc, cfg) {
  const S = cfg.safety;
  if (!(inc.share >= 0.5)) return 0;
  const pts = inc.strength >= S.crashStrength ? S.points.crash : inc.strength >= S.contactStrength ? S.points.contact : S.points.light;
  return pts * inc.share;
}
export function safetyAfterRace(sr, incidents, { km = 0, cfg }) {
  const S = cfg.safety, before = sr ?? S.start;
  const points = incidents.reduce((a, x) => a + incidentPoints(x, cfg), 0);
  const delta = points > 0 ? -points * S.perPoint : Math.min(S.cleanMax, S.cleanPerKm * Math.max(0, km));
  return { sr: clamp(Math.round((before + delta) * 100) / 100, S.min, S.max), delta, points };
}
export function safetyTier(sr, cfg) {
  const S = cfg.safety, v = sr ?? S.start;
  return [...S.tiers].reverse().find(t => v >= t.from) ?? S.tiers[0];
}
