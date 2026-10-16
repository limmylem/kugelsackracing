// A police pursuit's director, pure (docs/PURSUIT.md): the heat, what every police unit is doing and who it's after, who
// can be seen, the cooldown and its search area, busts, and when to send more units, a roadblock or a spike strip. No
// physics and no page in here: it's told each tick where the players and the units are and which units can see whom
// (los: the game's rays against the ground and buildings), and it says what each unit should do (pursuit/police.js
// drives it) and what the game should add. The solo game runs it on the player's machine (play/pursuitPlay.js); a
// co-op pursuit runs it on the race server (server/src/rt/pursuit.ts), the same code.
//
//   const D = createDirector({ cfg (data/pursuit.json), mission, rng })
//     mission: { startHeat, maxHeat, maxUnits (at once), totalUnits (ever), objective, coop, players (how many),
//                targeting (weights), timerEnds, roadblocks, spikes }
//   D.tick({ dt, players: [{ id, x, z, vx, vz, speed (m/s), drivable, condition (0–100), carrying }],
//            units: [{ id, x, z, vx, vz, speed, drivable }], los(unitId, playerId) → bool, hits: [{ unit, player, strength }] })
//     → { orders: [{ id, mode, target, goal: { x, z } | null, slot }], requests: [{ kind: 'unit' | 'roadblock' | 'spikes' | 'remove', … }] }
//   D.addUnit(id, { kind: 'chase' | 'block', target, joinAt })   (a unit the game put in: a request met)
//   D.spawnFailed()   (a unit asked for that couldn't be put anywhere)   D.expect(n)   (units coming that weren't asked for)
//   D.removeUnit(id)
//   D.revive(playerId)   (co-op: a busted player back in)   D.status → what the HUD, the session and the debug overlay show
//   D.drain() → events: heat, spotted, lost, cooldown-reset, reacquired, escaped, busting, busted, unit-disabled
//
// Unit modes: patrol (nothing known), alerted (driving to where a player was reported), pursue (on a player it can see),
// intercept (to a point ahead of the player, by another road), ram, pit (lined up on a rear corner, then turning in),
// box (one of the slots round a slow player: ahead, left, right), block (a roadblock's, parked until the player's near),
// search (the cooldown: places in the search area), out (disabled), leave (it's over: driving off).

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const MODES = ['patrol', 'alerted', 'pursue', 'intercept', 'ram', 'pit', 'box', 'block', 'search', 'out', 'leave'];

export function levelOf(heat) { return clamp(Math.floor(heat), 1, 5); }

// how many units the police want out at a heat level (co-op: more for more players), capped by the mission
export function unitsWanted(cfg, level, { players = 1, coop = false, maxUnits = null } = {}) {
  const base = cfg.levels[level - 1].units, n = coop ? Math.round(base * (1 + cfg.coop.perPlayer * Math.max(0, players - 1))) : base;
  return maxUnits != null ? Math.min(n, maxUnits) : n;
}

// which player a unit should go after (co-op): the best score — near, seen, damaged, carrying the objective — less the
// share of the units already on that player (they split up), with a little for the one it's already on
export function targetScore(w, { d, sight, seen, condition = 100, carrying = false, share = 0, current = false }) {
  return w.closest * (1 - clamp(d / sight, 0, 1)) + w.visible * (seen ? 1 : 0) + w.damaged * (1 - clamp(condition, 0, 100) / 100)
    + w.objective * (carrying ? 1 : 0) - w.spread * share + w.sticky * (current ? 1 : 0);
}

export function createDirector({ cfg, mission = {}, rng = Math.random }) {
  const M = {
    startHeat: clamp(mission.startHeat ?? 1, 1, 5), maxHeat: clamp(mission.maxHeat ?? 5, 1, 5), maxUnits: mission.maxUnits ?? null,
    totalUnits: Math.min(mission.totalUnits ?? cfg.police.maxTotal, cfg.police.maxTotal), coop: !!mission.coop, players: mission.players ?? 1,
    targeting: { ...cfg.targeting, ...(mission.targeting ?? {}) }, timerEnds: mission.timerEnds ?? cfg.escape.timerEnds,
    roadblocks: mission.roadblocks !== false, spikes: mission.spikes !== false, objective: mission.objective ?? 'escape',
  };
  M.maxHeat = Math.max(M.maxHeat, M.startHeat);
  const P = cfg.police, D = cfg.driving, B = cfg.bust, events = [];
  const emit = e => { events.push(e); return e; };
  const S = {
    t: 0, heat: M.startHeat, level: levelOf(M.startHeat), phase: 'pursuit', lastSeenAt: 0, lastSeen: null, cooldown: null,
    players: new Map(), units: new Map(), spawned: 0, pending: 0, disabled: 0, nextSpawnAt: 0, nextReassign: 0,
    nextRoadblockAt: null, nextSpikesAt: null, seenSeconds: 0, escapedAt: null,
    los: new Map(),           // `${unit}|${player}` → { seen, at } (rays aren't cast every tick: losEvery)
  };
  const level = () => cfg.levels[S.level - 1];
  const playerOf = id => S.players.get(id) ?? S.players.set(id, { id, bust: 0, busted: false, why: null, disabledFor: 0, lastSeenAt: -Infinity, seen: false, x: 0, z: 0 }).get(id);

  function setHeat(h) {
    const was = S.level;
    S.heat = clamp(h, M.startHeat, M.maxHeat + 0.999);
    S.level = levelOf(S.heat);
    if (S.level !== was) {
      emit({ type: 'heat', level: S.level, was });
      // (a new level's roadblocks and spikes: the first a little after it's reached)
      const L = level();
      if (L.roadblockEvery > 0 && M.roadblocks) S.nextRoadblockAt ??= S.t + L.roadblockEvery * 0.5;
      if (L.spikesEvery > 0 && M.spikes) S.nextSpikesAt ??= S.t + L.spikesEvery * 0.5;
    }
  }
  // (from the start: the start's own level's roadblocks and spikes)
  { const L = level(); if (L.roadblockEvery > 0 && M.roadblocks) S.nextRoadblockAt = L.roadblockEvery * 0.5; if (L.spikesEvery > 0 && M.spikes) S.nextSpikesAt = L.spikesEvery * 0.5; }

  // which units can see which players: a ray per pair within sight, each pair every losEvery s (staggered)
  const LOS_EVERY = 0.2;
  function sees(u, p, los) {
    const key = `${u.id}|${p.id}`, d = dist(u, p);
    if (d > P.sight) { S.los.set(key, { seen: false, at: S.t, d }); return false; }
    let c = S.los.get(key);
    if (!c || S.t - c.at >= LOS_EVERY || d < 12) { c = { seen: d < 8 || !!los(u.id, p.id), at: S.t + rng() * 0.05, d }; S.los.set(key, c); }
    return c.seen;
  }

  // what each unit does: its target and its mode (every reassignEvery s; a unit seeing its target switches at once)
  function assign(players, units, seen) {
    const live = units.filter(u => u.drivable !== false && S.units.get(u.id)?.mode !== 'out');
    const active = players.filter(p => !playerOf(p.id).busted);
    const orders = [];
    if (!active.length || S.phase === 'escaped') {
      for (const u of live) { S.units.get(u.id).mode = 'leave'; orders.push({ id: u.id, mode: 'leave', target: null, goal: null, slot: null }); }
      return orders;
    }
    const L = level(), W = M.targeting;
    // targets: each unit the best-scoring player (the units already counted on each: they spread out)
    const on = new Map(active.map(p => [p.id, 0]));
    const chase = live.filter(u => S.units.get(u.id)?.kind !== 'block' || S.units.get(u.id)?.joined);
    for (const u of chase) {
      const me = S.units.get(u.id);
      let best = null, bestScore = -Infinity;
      for (const p of active) {
        const sc = active.length === 1 ? 0 : targetScore(W, { d: dist(u, p), sight: P.sight, seen: seen.has(`${u.id}|${p.id}`), condition: p.condition, carrying: p.carrying, share: on.get(p.id) / Math.max(1, chase.length), current: me.target === p.id });
        if (sc > bestScore) { bestScore = sc; best = p; }
      }
      me.target = best.id;
      on.set(best.id, on.get(best.id) + 1);
    }
    // box-ins: a slow target with three units round it that can see it — the nearest three take the slots
    const boxed = new Map();
    if (L.boxIn && S.phase === 'pursuit') for (const p of active) {
      if (p.speed * 3.6 > D.box.maxKmh) continue;
      const near = chase.filter(u => S.units.get(u.id).target === p.id && seen.has(`${u.id}|${p.id}`) && dist(u, p) < D.box.range).sort((a, b) => dist(a, p) - dist(b, p));
      if (near.length < 3) continue;
      // (each slot to the unit nearest it)
      const fx = p.speed > 1 ? p.vx / p.speed : Math.sin(p.heading ?? 0), fz = p.speed > 1 ? p.vz / p.speed : Math.cos(p.heading ?? 0);
      const slots = { ahead: { x: p.x + fx * D.box.ahead, z: p.z + fz * D.box.ahead }, left: { x: p.x + fz * D.box.side, z: p.z - fx * D.box.side }, right: { x: p.x - fz * D.box.side, z: p.z + fx * D.box.side } };
      const free = new Set(near.slice(0, 3));
      for (const [slot, at] of Object.entries(slots)) {
        let u = null;
        for (const c of free) if (!u || dist(c, at) < dist(u, at)) u = c;
        free.delete(u); boxed.set(u.id, slot);
      }
    }
    let intercepting = 0;
    for (const u of live) {
      const me = S.units.get(u.id);
      // a roadblock's: parked until the player's near, or it's been there long enough
      if (me.kind === 'block' && !me.joined) {
        const p = active.reduce((a, b) => dist(u, a) < dist(u, b) ? a : b);
        if (dist(u, p) < cfg.roadblock.joinM || S.t >= (me.joinAt ?? Infinity) || seen.has(`${u.id}|${p.id}`) && dist(u, p) < cfg.roadblock.joinM * 2 && p.speed < 3) me.joined = true;
        else { orders.push({ id: u.id, mode: 'block', target: p.id, goal: null, slot: null }); continue; }
      }
      const p = active.find(x => x.id === me.target) ?? active[0], P0 = playerOf(p.id), d = dist(u, p), sees = seen.has(`${u.id}|${p.id}`);
      let mode, goal = null, slot = null;
      if (S.phase === 'cooldown') {
        // the search: a place in the area, a new one when it's there (or has been on its way a while)
        const C = S.cooldown;
        if (!me.searchGoal || dist(u, me.searchGoal) < 25 || S.t - (me.searchSince ?? 0) > 20 || dist(me.searchGoal, C) > C.radius) {
          const a = rng() * Math.PI * 2, r = C.radius * Math.sqrt(rng()) * 0.8;
          me.searchGoal = { x: C.x + Math.cos(a) * r, z: C.z + Math.sin(a) * r }; me.searchSince = S.t;
        }
        mode = 'search'; goal = me.searchGoal;
      } else if (boxed.has(u.id)) { mode = 'box'; slot = boxed.get(u.id); }
      else if (sees || d < 40) {
        const fx = p.speed > 1 ? p.vx / p.speed : 0, fz = p.speed > 1 ? p.vz / p.speed : 0, along = (u.x - p.x) * fx + (u.z - p.z) * fz, side = (u.x - p.x) * fz - (u.z - p.z) * fx;
        if (L.pit && d < D.pit.range && along < 0 && p.speed * 3.6 > D.pit.minKmh) { mode = 'pit'; slot = side >= 0 ? 'left' : 'right'; }
        else if (L.ram && d < D.ramRange) mode = 'ram';
        else mode = 'pursue';
      } else {
        // not in sight: where it was last reported (on the radio: any unit seeing it), or round ahead of it on another road
        const known = S.t - P0.lastSeenAt < P.lostGrace * 2, at = known ? { x: p.x, z: p.z } : S.lastSeen ?? { x: p.x, z: p.z };
        const ahead = p.speed > 5 ? { x: p.x + p.vx * 8, z: p.z + p.vz * 8 } : null;
        if (L.intercept && ahead && known && d > 80 && intercepting < Math.max(1, Math.floor(live.length / 2)) && dist(u, ahead) < dist(p, ahead) * 1.3) { mode = 'intercept'; goal = ahead; intercepting++; }
        else { mode = 'alerted'; goal = at; }
      }
      if (me.mode !== mode) { me.mode = mode; me.since = S.t; }
      me.goal = goal; me.slot = slot;
      orders.push({ id: u.id, mode, target: p.id, goal, slot });
    }
    return orders;
  }

  let lastOrders = [];
  const api = {
    get state() { return S; },
    mission: M,
    addUnit(id, { kind = 'chase', target = null, joinAt = null } = {}) {
      if (kind === 'chase' || kind === 'block') S.pending = Math.max(0, S.pending - 1);
      S.spawned++;
      S.units.set(id, { id, kind, target, joinAt, joined: kind !== 'block', mode: kind === 'block' ? 'block' : 'alerted', since: S.t, goal: null, slot: null, unseenFor: 0, outAt: null });
    },
    spawnFailed() { S.pending = Math.max(0, S.pending - 1); },
    // (units the game is putting in of its own accord — the one behind you at the start: not asked for again meanwhile)
    expect(n = 1) { S.pending += n; },
    removeUnit(id) { S.units.delete(id); for (const k of [...S.los.keys()]) if (k.startsWith(`${id}|`)) S.los.delete(k); },
    revive(playerId) { const p = playerOf(playerId); Object.assign(p, { busted: false, why: null, bust: 0, disabledFor: 0 }); },
    tick({ dt, players, units, los = () => true, hits = [] }) {
      S.t += dt;
      const requests = [];
      for (const p of players) Object.assign(playerOf(p.id), { x: p.x, z: p.z, carrying: !!p.carrying });
      // (where it started: they know that much)
      if (!S.lastSeen && players.length) S.lastSeen = { x: players[0].x, z: players[0].z, player: players[0].id };
      const active = players.filter(p => !playerOf(p.id).busted);
      const live = units.filter(u => S.units.has(u.id));
      // ---- who sees whom ----
      const seen = new Set();
      for (const u of live) {
        const me = S.units.get(u.id);
        if (u.drivable === false) {
          if (me.mode !== 'out') { me.mode = 'out'; me.outAt = S.t; S.disabled++; emit({ type: 'unit-disabled', id: u.id }); }
          continue;
        }
        let any = false;
        for (const p of active) if (sees(u, p, los)) { seen.add(`${u.id}|${p.id}`); any = true; Object.assign(playerOf(p.id), { lastSeenAt: S.t }); S.lastSeen = { x: p.x, z: p.z, player: p.id }; }
        me.seeing = any;
        me.unseenFor = any ? 0 : me.unseenFor + dt;
      }
      for (const p of active) playerOf(p.id).seen = live.some(u => seen.has(`${u.id}|${p.id}`));
      const seenAny = seen.size > 0;
      // ---- the phase: in pursuit, the cooldown (and its search area), escaped ----
      if (S.phase !== 'escaped') {
        if (seenAny) {
          S.lastSeenAt = S.t;
          if (S.phase === 'cooldown') { S.phase = 'pursuit'; S.cooldown = null; emit({ type: 'spotted' }); }
        } else if (S.phase === 'pursuit' && S.t - S.lastSeenAt >= P.lostGrace && S.lastSeen) {
          const L = level();
          S.phase = 'cooldown';
          S.cooldown = { left: L.cooldown, total: L.cooldown, x: S.lastSeen.x, z: S.lastSeen.z, radius: L.searchRadius };
          emit({ type: 'lost', ...S.cooldown });
        }
        if (S.phase === 'cooldown') {
          const C = S.cooldown;
          C.left -= dt;
          // out of the search area (all of you still free) before the time's up: escaped
          if (active.length && active.every(p => dist(p, C) > C.radius)) { S.phase = 'escaped'; S.escapedAt = S.t; emit({ type: 'escaped', level: S.level, how: 'left the area' }); }
          else if (C.left <= 0) {
            if (M.timerEnds === 'escape') { S.phase = 'escaped'; S.escapedAt = S.t; emit({ type: 'escaped', level: S.level, how: 'laid low' }); }
            else { S.phase = 'pursuit'; S.cooldown = null; S.lastSeenAt = S.t; for (const p of active) playerOf(p.id).lastSeenAt = S.t; emit({ type: 'reacquired' }); }
          }
        }
      }
      // ---- the heat: only while they can see you ----
      if (S.phase === 'pursuit' && seenAny) {
        S.seenSeconds += dt;
        let h = S.heat + cfg.heat.perSecond * dt;
        if (active.some(p => playerOf(p.id).seen && p.speed * 3.6 > cfg.heat.recklessKmh)) h += cfg.heat.recklessPerSecond * dt;
        for (const x of hits) h += Math.min(cfg.heat.hitMax, cfg.heat.perHit * (x.strength ?? 1));
        setHeat(h);
      } else if (hits.length && S.phase !== 'escaped') setHeat(S.heat + hits.reduce((a, x) => a + Math.min(cfg.heat.hitMax, cfg.heat.perHit * (x.strength ?? 1)), 0));
      // ---- busts: slow with a unit right there, or the car disabled ----
      if (S.phase !== 'escaped') for (const p of active) {
        const me = playerOf(p.id);
        if (p.drivable === false) me.disabledFor += dt; else me.disabledFor = 0;
        const near = live.some(u => u.drivable !== false && S.units.get(u.id).mode !== 'block' && (dist(u, p) < B.touchM || (dist(u, p) < B.range && seen.has(`${u.id}|${p.id}`))));
        const was = me.bust;
        if (S.phase === 'pursuit' && near && p.speed * 3.6 < B.kmh) me.bust += dt;
        else me.bust = Math.max(0, me.bust - dt * B.decay);
        if (was === 0 && me.bust > 0) emit({ type: 'busting', player: p.id });
        if (me.disabledFor >= B.disabledSeconds || me.bust >= B.seconds) {
          me.busted = true; me.why = me.disabledFor >= B.disabledSeconds ? 'disabled' : 'stopped';
          emit({ type: 'busted', player: p.id, why: me.why, x: p.x, z: p.z });
        }
      }
      // ---- units: more wanted, roadblocks, spikes; the far and the disabled taken away ----
      const nowActive = players.filter(p => !playerOf(p.id).busted);
      if (S.phase !== 'escaped' && nowActive.length) {
        const chaseAlive = [...S.units.values()].filter(u => u.mode !== 'out' && u.kind === 'chase').length;
        const want = unitsWanted(cfg, S.level, { players: M.players, coop: M.coop, maxUnits: M.maxUnits });
        if (chaseAlive + S.pending < want && S.spawned + S.pending < M.totalUnits && S.t >= S.nextSpawnAt) {
          // (near the player the fewest units are on)
          const load = new Map(nowActive.map(p => [p.id, 0]));
          for (const u of S.units.values()) if (load.has(u.target)) load.set(u.target, load.get(u.target) + 1);
          const target = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
          requests.push({ kind: 'unit', target, level: S.level, rating: level().rating }); S.pending++; S.nextSpawnAt = S.t + P.spawnEvery;
        }
        const L = level(), lead = nowActive[0];
        if (S.phase === 'pursuit' && L.roadblockEvery > 0 && M.roadblocks && S.nextRoadblockAt != null && S.t >= S.nextRoadblockAt && S.spawned + S.pending + cfg.roadblock.units <= M.totalUnits) {
          requests.push({ kind: 'roadblock', target: lead.id, units: cfg.roadblock.units, rating: L.rating }); S.pending += cfg.roadblock.units; S.nextRoadblockAt = S.t + L.roadblockEvery;
        }
        if (S.phase === 'pursuit' && L.spikesEvery > 0 && M.spikes && S.nextSpikesAt != null && S.t >= S.nextSpikesAt) {
          requests.push({ kind: 'spikes', target: lead.id }); S.nextSpikesAt = S.t + L.spikesEvery;
        }
      }
      for (const u of live) {
        const me = S.units.get(u.id), far = players.every(p => dist(u, p) > P.despawnM);
        const leaving = S.phase === 'escaped' && players.every(p => dist(u, p) > 120) && me.unseenFor > 2;
        if ((far && me.unseenFor > 5) || leaving || (me.mode === 'out' && S.t - me.outAt > 30 && me.unseenFor > 3)) { requests.push({ kind: 'remove', id: u.id }); }
      }
      // ---- orders ----
      if (S.t >= S.nextReassign || live.some(u => S.units.get(u.id).target != null && seen.has(`${u.id}|${S.units.get(u.id).target}`) !== !!S.units.get(u.id).sawTarget)) {
        lastOrders = assign(players.map(p => ({ ...p })), live, seen);
        for (const u of live) { const me = S.units.get(u.id); me.sawTarget = me.target != null && seen.has(`${u.id}|${me.target}`); }
        S.nextReassign = S.t + P.reassignEvery;
      }
      return { orders: lastOrders.filter(o => S.units.has(o.id)), requests, seen };
    },
    // what everyone else shows: the HUD, the session (quest/types/pursuit.js), the debug overlay, the network
    get status() {
      const C = S.cooldown;
      return {
        t: S.t, heat: S.heat, level: S.level, maxHeat: M.maxHeat, phase: S.phase, escapedAt: S.escapedAt,
        cooldown: C ? { left: Math.max(0, C.left), total: C.total, x: C.x, z: C.z, radius: C.radius } : null,
        lastSeen: S.lastSeen, seenSeconds: S.seenSeconds, disabled: S.disabled, spawned: S.spawned,
        players: [...S.players.values()].map(p => ({ id: p.id, bust: p.bust / B.seconds, busted: p.busted, why: p.why, seen: p.seen })),
        units: [...S.units.values()].map(u => ({ id: u.id, kind: u.kind, mode: u.mode, target: u.target, goal: u.goal, slot: u.slot, seeing: !!u.seeing })),
      };
    },
    drain() { return events.splice(0); },
  };
  return api;
}
