// Free roam challenges (Phase 7 Step 4; docs/FREE_ROAM.md "Challenges"), pure: asking a nearby player (or a party), the
// answer, the cooldowns that stop spam; the headlight flash that asks; the route (to a destination by road, or to a
// quest marker); the challenge itself with its rolling start, run by the zone server on the cars' states as it accepted
// them; the check of what it recorded (the API's, before paying), and the pay with its caps against farming. Settings:
// data/roam.json challenges.
//
//   const B = createChallengeBook(cfg)
//     B.ask({ from, to: [uid], type, now, check(a, b) → null | why, silent(a, b) → bool, route }) → { ok, id, invite } | { ok: false, why }
//     B.answer(id, uid, yes, now) → { state: 'waiting' | 'accepted' | 'declined', invite }    B.expire(now) → [invites closed]
//     B.cooldownSec(a, b, now)    B.get(id)
//   const F = createFlashDetector(cfg)    F.lights(uid, headOn, t) · F.target(uid, t, me { pos, heading }, others [{ uid, pos }]) → uid | null
//   sprintRoute(N, from [x, z], cfg, { rng, to? }) → { ok, line, length, dest, problems }    (route/build.js on the road graph)
//   checkpointsOf(line, cfg) → [{ n, s, x, z }]   (the last one the finish)
//   const R = createChallengeRun({ cfg, id, type, racers: [uid], route, now })
//     R.state(uid, f, t)     every accepted state (world frame: pos, vel, time — the server's clock)
//     R.tick(t) → events     ('go', 'checkpoint', 'finish', 'penalty', 'hold', 'done')      R.phase · R.results() · R.record()
//   verifyChallenge(record, cfg) → { ok, problems }      challengePay(cfg, { km, place, players, pairToday, paidToday }) → { money, xp, why }

import { buildRoute } from '../route/build.js';
import { project, at as lineAt } from '../route/geometry.js';
import { DEFAULT_OPTIONS } from '../route/network.js';

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const groupKey = uids => [...uids].sort().join('|');

// ---------- asking ----------
export function createChallengeBook(cfg) {
  const C = cfg.challenges, invites = new Map(), cool = new Map(), sent = new Map();
  let nextId = 1;
  const coolOf = (a, b) => cool.get(pairKey(a, b)) ?? { until: 0, times: 0 };
  const close = (inv, state, now) => {
    inv.state = state; inv.closedAt = now;
    invites.delete(inv.id);
    // (declined or not answered: that pair waits, longer each time)
    if (state === 'declined' || state === 'expired') for (const u of inv.to) if (!inv.accepted.has(u)) {
      const c = coolOf(inv.from, u), times = c.times + 1;
      cool.set(pairKey(inv.from, u), { until: now + Math.min(C.pairCooldownMaxSec, C.pairCooldownSec * 2 ** (times - 1)) * 1000, times });
    }
    return inv;
  };
  return {
    ask({ from, to, type, now, check = () => null, silent = () => false, route = null, meta = {} }) {
      to = [...new Set(to)].filter(u => u !== from);
      if (!C.types.includes(type)) return { ok: false, why: 'That kind of challenge doesn\'t exist.' };
      if (!to.length) return { ok: false, why: 'Challenge whom?' };
      if (to.length + 1 > C.groupMax) return { ok: false, why: `A challenge is ${C.groupMax} players at most.` };
      const mine = (sent.get(from) ?? []).filter(x => x > now - 60000);
      if (mine.length >= C.perMinute) return { ok: false, why: 'You\'ve sent a lot of challenges: wait a minute.' };
      for (const u of to) {
        // (a blocked player's challenge: declined without a word — they aren't told they're blocked)
        if (silent(from, u)) { sent.set(from, [...mine, now]); return { ok: true, id: null, silentDecline: true }; }
        const why = check(from, u);
        if (why) return { ok: false, why };
        const c = coolOf(from, u);
        if (c.until > now) return { ok: false, why: `Wait ${Math.ceil((c.until - now) / 1000)} s before challenging them again.` };
        if ([...invites.values()].some(i => i.from === from && i.to.includes(u))) return { ok: false, why: 'You\'ve challenged them already: wait for the answer.' };
      }
      sent.set(from, [...mine, now]);
      const inv = { id: `c${nextId++}`, from, to, type, at: now, until: now + C.answerSec * 1000, accepted: new Set(), declined: new Set(), state: 'waiting', route, meta };
      invites.set(inv.id, inv);
      return { ok: true, id: inv.id, invite: inv };
    },
    answer(id, uid, yes, now) {
      const inv = invites.get(id);
      if (!inv || !inv.to.includes(uid)) return { state: 'gone' };
      (yes ? inv.accepted : inv.declined).add(uid);
      const answered = inv.accepted.size + inv.declined.size === inv.to.length;
      if (!answered) return { state: 'waiting', invite: inv };
      // (a group: it goes ahead with everyone who said yes, if anyone did)
      return inv.accepted.size ? { state: 'accepted', invite: close(inv, 'accepted', now) } : { state: 'declined', invite: close(inv, 'declined', now) };
    },
    expire(now) {
      const out = [];
      for (const inv of [...invites.values()]) if (inv.until <= now) out.push(inv.accepted.size ? close(inv, 'accepted', now) : close(inv, 'expired', now));
      return out;
    },
    cancel(id, now) { const inv = invites.get(id); return inv ? close(inv, 'cancelled', now) : null; },
    cooldownSec(a, b, now) { return Math.max(0, Math.ceil((coolOf(a, b).until - now) / 1000)); },
    get: id => invites.get(id) ?? null,
    pending: () => [...invites.values()],
  };
}

// ---------- flashing headlights at someone ----------
export function createFlashDetector(cfg) {
  const C = cfg.challenges, flips = new Map(), was = new Map();
  return {
    lights(uid, on, t) {
      const prev = was.get(uid) ?? false;
      was.set(uid, !!on);
      if (on && !prev) { const l = (flips.get(uid) ?? []).filter(x => x > t - C.flashSec * 1000); l.push(t); flips.set(uid, l); }
    },
    // the car flashed at: enough flashes lately, and someone in range ahead (the nearest in the cone)
    target(uid, t, me, others) {
      const l = (flips.get(uid) ?? []).filter(x => x > t - C.flashSec * 1000);
      if (l.length < C.flashes || !me?.pos) return null;
      // (heading: the car's yaw, degrees — forward is [sin, cos] in x and z, as mp/contact.js yawOf has it)
      const h = (me.heading ?? 0) * Math.PI / 180, fx = Math.sin(h), fz = Math.cos(h);
      let best = null, bd = Infinity;
      for (const o of others) {
        const dx = o.pos[0] - me.pos[0], dz = o.pos[2] - me.pos[2], d = Math.hypot(dx, dz);
        if (d > C.rangeM || d < 0.5) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) * 180 / Math.PI;
        if (ang <= C.flashConeDeg && d < bd) { bd = d; best = o.uid; }
      }
      if (best) flips.set(uid, []);
      return best;
    },
  };
}

// ---------- the route ----------
// a sprint's destination: somewhere routeM.min–max away by road from where the challenger is, the route built as an
// editor's would be (route/build.js on the region's road graph). `to` [x, z]: a quest marker instead.
export function sprintRoute(N, from, cfg, { rng = Math.random, to = null, tries = 40 } = {}) {
  const C = cfg.challenges, P = N.P, mk = (x, z) => { const [lat, lon] = P.toLatLon(x, z); return { lat, lon }; };
  const tryTo = dest => {
    const built = buildRoute(N, { kind: 'p2p', waypoints: [mk(from[0], from[1]), mk(dest[0], dest[1])], options: {} });
    if (!built.ok || built.line.length < 2) return null;
    return { ok: true, line: built.line.map(p => ({ x: p.x, z: p.z, h: p.h, w: p.w, s: p.s })), length: built.length, dest: [built.line.at(-1).x, built.line.at(-1).z], names: [...new Set(built.segments.map(s => s.name).filter(Boolean))].slice(0, 4) };
  };
  if (to) { const r = tryTo(to); return r ?? { ok: false, line: [], length: 0, problems: ['There\'s no road from here to there.'] }; }
  // candidate destinations: points on drivable roads, as far away (straight) as the route should be long, give or take
  const main = N.mainPart(DEFAULT_OPTIONS), segs = N.segs.filter(s => N.usable(s, DEFAULT_OPTIONS) && s.length > 20 && main[s.from] && main[s.to]);
  let best = null;
  for (let k = 0; k < tries; k++) {
    const sg = segs[Math.floor(rng() * segs.length)];
    if (!sg) break;
    const p = N.pointOn(sg, sg.length / 2), d = Math.hypot(p.x - from[0], p.z - from[1]);
    if (d < C.routeM.min * 0.45 || d > C.routeM.max * 0.95) continue;
    if (N.inside && !N.inside(p.x, p.z)) continue;
    const r = tryTo([p.x, p.z]);
    if (!r) continue;
    if (r.length >= C.routeM.min && r.length <= C.routeM.max) return r;
    if (!best || Math.abs(r.length - (C.routeM.min + C.routeM.max) / 2) < Math.abs(best.length - (C.routeM.min + C.routeM.max) / 2)) best = r;
  }
  return best && best.length >= C.routeM.min * 0.6 && best.length <= C.routeM.max * 1.25 ? best : { ok: false, line: [], length: 0, problems: ['No destination the right distance away by road from here.'] };
}
export function checkpointsOf(line, cfg) {
  const C = cfg.challenges, L = line.at(-1)?.s ?? 0, n = Math.max(1, Math.round(L / C.checkpointEveryM)), out = [];
  for (let k = 1; k <= n; k++) { const s = L * k / n, p = lineAt(line, s); out.push({ n: k, s, x: p.x, z: p.z }); }
  return out;
}

// ---------- the challenge itself ----------
export function createChallengeRun({ cfg, id, type, racers, route = null, now, leader = null }) {
  const C = cfg.challenges, R = C.rolling, cps = route ? checkpointsOf(route.line, cfg) : [];
  const cars = new Map(racers.map(u => [u, { uid: u, last: null, s: 0, k: 0, next: 0, passed: [], finishAt: null, status: 'racing', penaltySec: 0, trail: [], topSpeed: 0, followSec: 0, breakSec: 0 }]));
  let phase = 'rolling', goAt = now + R.countSec * 1000, holdNote = 0, ended = null;
  const giveUpAt = now + (R.maxHoldSec ?? 30) * 1000;
  const lead = leader ?? racers[0];
  const events = [];
  const progressOf = (c, x, z) => { if (!route) return null; const p = project(route.line, x, z, { from: Math.max(0, c.k - 40), to: Math.min(route.line.length - 1, c.k + 80) }); c.k = p.k ?? c.k; return p; };
  const api = {
    id, type, racers, route, checkpoints: cps,
    get phase() { return phase; }, get goAt() { return goAt; }, get leader() { return lead; },
    state(uid, f, t) {
      const c = cars.get(uid);
      if (!c || c.status !== 'racing') return;
      const x = f.pos[0], z = f.pos[2], v = Math.hypot(f.vel[0], f.vel[2]);
      const prev = c.last;
      c.last = { t: f.time ?? t, x, z, v };
      if (phase === 'racing') {
        c.topSpeed = Math.max(c.topSpeed, v);
        if (!c.trail.length || c.last.t - c.trail.at(-1)[0] >= 500) c.trail.push([Math.round(c.last.t), Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round(v * 10) / 10]);
      }
      if (!route) return;
      const p = progressOf(c, x, z);
      c.s = p.s;
      if (phase !== 'racing') return;
      // checkpoints in order: within the gate's radius of the next one
      const cp = cps[c.next];
      if (cp) {
        const near = Math.hypot(cp.x - x, cp.z - z) <= (c.next === cps.length - 1 ? C.finishRadiusM : C.gateRadiusM);
        // (crossed between two states: the moment the line through the gate was reached, by distance along the route)
        if (near || (prev && c.s >= cp.s && Math.hypot(cp.x - x, cp.z - z) <= C.gateRadiusM * 3)) {
          const tPass = prev && prev.t < c.last.t ? prev.t + (c.last.t - prev.t) * Math.max(0, Math.min(1, Math.hypot(cp.x - prev.x, cp.z - prev.z) / (Math.hypot(x - prev.x, z - prev.z) || 1))) : c.last.t;
          c.passed.push({ n: cp.n, t: Math.round(tPass) });
          c.next++;
          events.push({ t: 'checkpoint', uid, n: cp.n, of: cps.length });
          if (c.next === cps.length) { c.finishAt = tPass + c.penaltySec * 1000; c.status = 'finished'; events.push({ t: 'finish', uid, timeMs: Math.round(c.finishAt - goAt) }); }
        }
      }
    },
    tick(t) {
      const out = events.splice(0);
      if (phase === 'done') return out;
      const list = [...cars.values()];
      if (phase === 'rolling') {
        // the rolling start: side by side, at a steady speed, for the countdown — anyone outside it holds the countdown
        const ready = list.every(c => c.last), kmh = c => (c.last?.v ?? 0) * 3.6;
        const spread = ready ? Math.max(...list.map(c => Math.hypot(c.last.x - list[0].last.x, c.last.z - list[0].last.z))) : Infinity;
        const steady = ready && list.every(c => kmh(c) >= R.minKmh - 3 && kmh(c) <= R.maxKmh + 5) && spread <= R.maxGapM * 1.5;
        if (!steady && t < goAt - 1000) {
          // (never steady for maxHoldSec: called off — nobody's paid, nobody's penalised)
          if (t >= giveUpAt) { phase = 'done'; ended = t; for (const c of list) c.status = 'cancelled'; out.push({ t: 'cancelled', why: 'the rolling start never came together' }); return out; }
          goAt = Math.max(goAt, t + R.countSec * 1000);
          if (t - holdNote > 1500) { holdNote = t; out.push({ t: 'hold', why: !ready ? 'waiting for every car' : spread > R.maxGapM * 1.5 ? 'close up: side by side' : `hold ${R.minKmh}–${R.maxKmh} km/h` }); }
        }
        if (t >= goAt) {
          phase = 'racing';
          out.push({ t: 'go', at: goAt });
          // a car more than maxGapM ahead of the rearmost at the go: a time penalty
          if (route && ready) {
            const back = Math.min(...list.map(c => c.s));
            for (const c of list) if (c.s - back > R.maxGapM) { c.penaltySec += R.jumpPenaltySec; out.push({ t: 'penalty', uid: c.uid, sec: R.jumpPenaltySec, why: 'jumped the rolling start' }); }
          }
        }
        return out;
      }
      // follow-the-leader: the follower within gapM for follow.sec wins; the leader breaking away breakM for breakSec wins
      if (type === 'follow') {
        const L = cars.get(lead), F = list.filter(c => c.uid !== lead);
        for (const c of F) {
          if (!L?.last || !c.last || c.status !== 'racing') continue;
          const d = Math.hypot(L.last.x - c.last.x, L.last.z - c.last.z), dt = 0.1;
          if (d <= C.follow.gapM) c.followSec += dt;
          if (d >= C.follow.breakM) c.breakSec += dt; else c.breakSec = 0;
          if (c.followSec >= C.follow.sec) { c.status = 'finished'; c.finishAt = t; out.push({ t: 'finish', uid: c.uid, timeMs: Math.round(t - goAt), won: true }); }
          else if (c.breakSec >= C.follow.breakSec) { c.status = 'dnf'; out.push({ t: 'lost', uid: c.uid, why: 'the leader got away' }); }
        }
        if (F.every(c => c.status !== 'racing')) { if (!L.finishAt && F.every(c => c.status === 'dnf')) { L.status = 'finished'; L.finishAt = t; } else L.status = L.finishAt ? 'finished' : 'dnf'; }
      }
      const timeout = t - goAt > C.timeoutSec * 1000;
      if (timeout) for (const c of list) if (c.status === 'racing') { c.status = 'dnf'; out.push({ t: 'dnf', uid: c.uid, why: 'out of time' }); }
      // (a sprint: once someone finishes, the others have the rest of the timeout, or a minute, whichever comes first)
      const first = list.filter(c => c.finishAt).sort((a, b) => a.finishAt - b.finishAt)[0];
      if (first && type !== 'follow') for (const c of list) if (c.status === 'racing' && t - first.finishAt > 60000) { c.status = 'dnf'; out.push({ t: 'dnf', uid: c.uid, why: 'the others finished a minute ago' }); }
      if (list.every(c => c.status !== 'racing')) { phase = 'done'; ended = t; out.push({ t: 'done' }); }
      return out;
    },
    // someone left or dropped out (blocked, disconnected, passive mode)
    out(uid, why) { const c = cars.get(uid); if (c && c.status === 'racing') { c.status = 'dnf'; events.push({ t: 'dnf', uid, why }); } },
    results() {
      const list = [...cars.values()];
      const fin = list.filter(c => c.status === 'finished').sort((a, b) => a.finishAt - b.finishAt);
      return [...fin.map((c, i) => ({ uid: c.uid, place: i + 1, status: 'finished', timeMs: Math.round(c.finishAt - goAt), penaltySec: c.penaltySec })),
        ...list.filter(c => c.status !== 'finished').map(c => ({ uid: c.uid, place: null, status: c.status === 'cancelled' ? 'cancelled' : 'dnf', timeMs: null, penaltySec: c.penaltySec }))];
    },
    // what the API checks before paying (verifyChallenge)
    record() {
      return { id, type, racers, goAt: Math.round(goAt), endedAt: ended, leader: lead, length: route?.length ?? null, checkpoints: cps.map(c => ({ n: c.n, x: Math.round(c.x * 10) / 10, z: Math.round(c.z * 10) / 10 })),
        results: api.results(), cars: Object.fromEntries([...cars.values()].map(c => [c.uid, { passed: c.passed, trail: c.trail, topSpeed: +c.topSpeed.toFixed(2), penaltySec: c.penaltySec, followSec: +c.followSec.toFixed(1) }])) };
    },
  };
  return api;
}

// ---------- checking it (the API, before paying) ----------
export function verifyChallenge(rec, cfg) {
  const C = cfg.challenges, problems = [];
  if (!rec || !Array.isArray(rec.results) || !rec.cars) return { ok: false, problems: ['No record'] };
  for (const r of rec.results) {
    if (r.status !== 'finished') continue;
    const c = rec.cars[r.uid];
    if (!c) { problems.push(`${r.uid}: no record of the car`); continue; }
    if (c.topSpeed > C.verify.maxSpeed) problems.push(`${r.uid}: faster than any car (${c.topSpeed} m/s)`);
    // (between trail points: no faster than possible)
    for (let k = 1; k < c.trail.length; k++) {
      const [ta, xa, za] = c.trail[k - 1], [tb, xb, zb] = c.trail[k], dt = (tb - ta) / 1000;
      if (dt > 0 && Math.hypot(xb - xa, zb - za) / dt > C.verify.maxSpeed * 1.1 + 5 / dt) { problems.push(`${r.uid}: moved too far between ${ta} and ${tb}`); break; }
    }
    if (rec.type !== 'follow') {
      // every checkpoint, in order, the last its finish time
      const ns = c.passed.map(p => p.n);
      if (ns.length !== rec.checkpoints.length || ns.some((n, i) => n !== i + 1)) problems.push(`${r.uid}: checkpoints missed (${ns.length} of ${rec.checkpoints.length})`);
      const last = c.passed.at(-1);
      if (last && Math.abs(last.t + (c.penaltySec ?? 0) * 1000 - rec.goAt - r.timeMs) > C.verify.maxTimeDiffMs) problems.push(`${r.uid}: its time doesn't match its finish`);
      // (the time against the trail: it couldn't have covered the route faster than maxSpeed)
      if (rec.length && r.timeMs < rec.length / C.verify.maxSpeed * 1000) problems.push(`${r.uid}: faster than the route allows`);
      // (each checkpoint passed where the trail was near it)
      for (const p of c.passed) {
        const cp = rec.checkpoints.find(x => x.n === p.n), tr = c.trail.reduce((b, q) => Math.abs(q[0] - p.t) < Math.abs(b[0] - p.t) ? q : b, c.trail[0] ?? [0, 1e9, 1e9]);
        if (cp && tr && Math.hypot(tr[1] - cp.x, tr[2] - cp.z) > C.gateRadiusM + (tr[3] ?? 0) * 0.6 + 15) { problems.push(`${r.uid}: checkpoint ${p.n} passed away from the car's path`); break; }
      }
    } else if (r.uid !== rec.leader && (c.followSec ?? 0) < C.follow.sec - 0.5) problems.push(`${r.uid}: didn't follow long enough`);
  }
  return { ok: problems.length === 0, problems };
}

// the pay for a challenge's finisher: by the route's length and their place — nothing once the same pair (or group) has
// been paid pairPerDay times today, or the player dailyPaid times
export function challengePay(cfg, { km = 0, place = null, players = 2, pairToday = 0, paidToday = 0 }) {
  const P = cfg.challenges.pay, caps = cfg.challenges.caps;
  if (!place) return { money: 0, xp: 0, why: 'didn\'t finish' };
  if (pairToday >= caps.pairPerDay) return { money: 0, xp: 0, why: `you've been paid for ${caps.pairPerDay} challenges against the same players today` };
  if (paidToday >= caps.dailyPaid) return { money: 0, xp: 0, why: `the day's ${caps.dailyPaid} paid challenges are done` };
  const share = P.places[Math.min(place, P.places.length) - 1] ?? 0, k = Math.min(P.maxKm, Math.max(0, km));
  const money = Math.round((P.base + P.perKm * k) * share * (players > 2 ? 1 + 0.1 * (players - 2) : 1));
  return { money, xp: Math.round(P.xp * share), why: place === 1 ? 'won a challenge' : `place ${place} in a challenge` };
}
