// A multiplayer race, owned by the server (Phase 7 Step 2; docs/MULTIPLAYER.md "Race flow"), pure: no network in
// here. The race room (server/src/rt/race.ts) feeds it who joined and left, what the players asked for, and every
// car state it accepted (Step 1's live checks first); it says what happened. The tests drive it directly.
//
//   lobby → loading → countdown → racing → results        (and back to lobby: a rematch)
//
//   - loading: every racer loads the route or track; a generated track's hash must match the server's (else that
//     player watches instead). It goes on when everyone's in, or at race.loadTimeoutSec: anyone still loading
//     starts from the back of the grid when they're in (race.lateJoin 'back') or watches ('spectate').
//   - the grid: by rating (the best at the front), at random, or the last race's order reversed (settings.gridOrder)
//   - countdown: the lights go out at goAt, a time on the server's clock, sent ahead to everyone (Step 1's time sync
//     puts every client's clock within a few ms of it). A car more than jumpStart.toleranceM from its slot before
//     then has jumped the start: jumpStart.penaltySec added to its time. (Judged once the car has been on its slot, or
//     jumpStart.settleSec after the grid was announced: the game needs a moment to put it there.)
//   - racing: each racer's progress from their car states, on the server — the route's own tracker (route/tracker.js:
//     checkpoints in order, laps, the finish), each crossing timed between the two states either side of it on the
//     server's clock. Positions: the finished by time, then by distance along the race, then the out.
//     The live checks on progress: more distance than race.progress.maxSpeed allows, or a checkpoint passed out of
//     order — flagged for the results' check (not judged here).
//   - after the winner finishes, the others have race.finishWindowSec; a player dropped for race.dnfGraceSec is out
//     (DNF); a player who leaves is out, and in a ranked race it counts as last.
//
//   const R = createRace({ cfg, settings, course, now, seed })
//     course: route/model.js viewCourse (line, loop, grid, checkpoints, start, finish, corridor, trackHash?)
//   R.join(pid, { uid, name, npc, car, rating, guest }) → 'racer' | 'spectator'     R.leave(pid, now)
//   R.drop(pid, now) / R.back(pid, now)   R.setReady(pid, v)   R.setCar(pid, car)   R.makeSpectator(pid)
//   R.start(now)        the host (or the queue) starts it: lobby → loading
//   R.loaded(pid, { hash }, now) → { ok, why }
//   R.carState(pid, { t, pos, vel }) → events      R.update(now) → events
//   R.standings(now) → [{ pid, name, place, status, lap, laps, u, gapMs, timeMs, npc, away }]
//   R.results() → the provisional results     R.view(now) → what the clients are told     R.rematch(now)
//   events: { type: 'phase' | 'grid' | 'jumpstart' | 'checkpoint' | 'lap' | 'finish' | 'dnf' | 'flag' | 'late' | 'spectate', pid?, … }

import { createTracker } from '../route/tracker.js';
import { crossing } from '../quest/timing.js';

export const PHASES = ['lobby', 'loading', 'countdown', 'racing', 'results'];

function rngOf(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ordinal = r => (r?.mu ?? 25) - 3 * (r?.sigma ?? 25 / 3);

export function createRace({ cfg, settings, course, now = 0, seed = 1 }) {
  const C = cfg.race, rng = rngOf(seed);
  const slots = course?.grid?.slots ?? [];
  const maxRacers = Math.min(settings.maxPlayers ?? cfg.grid.maxPlayers, slots.length || cfg.grid.maxPlayers);
  const laps = course?.loop ? Math.max(1, settings.laps ?? 1) : 1;
  const S = {
    phase: 'lobby', since: now, loadDeadline: null, countdownAt: null, goAt: null, finishDeadline: null, endedAt: null,
    order: [], firstFinish: null, lastOrder: settings.lastOrder ?? null,
  };
  const players = new Map();
  const racers = () => [...players.values()].filter(p => p.role === 'racer');
  const events = [];
  const emit = e => { events.push(e); return e; };
  const phase = (to, at, extra = {}) => { S.phase = to; S.since = at; emit({ type: 'phase', phase: to, at, ...extra }); };

  function makeTracker(p) {
    const g = course.grid;
    p.tracker = createTracker({ line: course.line, loop: course.loop, startS: g.startS, finishS: g.finishS, checkpoints: course.checkpoints ?? [], laps, corridor: course.corridor ?? {} });
    const slot = slots[p.slot] ?? slots.at(-1);
    p.tracker.begin(slot.x, slot.z);
    p.settled = false;
    if (S.phase === 'racing') p.tracker.start();
  }
  // the grid: who starts where
  function assignGrid() {
    const list = racers().filter(p => p.loaded || C.lateJoin === 'back');
    let order;
    if (settings.gridOrder === 'random') order = [...list].sort(() => rng() - 0.5);
    else if (settings.gridOrder === 'reverse' && S.lastOrder?.length) {
      const last = S.lastOrder, pos = p => { const i = last.indexOf(p.uid); return i < 0 ? -1 : i; };
      order = [...list].sort((a, b) => pos(b) - pos(a));              // (last time's winner at the back; newcomers at the front)
    } else order = [...list].sort((a, b) => ordinal(b.rating) - ordinal(a.rating) || String(a.uid).localeCompare(String(b.uid)));
    // (the loaded first: a late one takes the slots left at the back)
    order.sort((a, b) => (b.loaded ? 1 : 0) - (a.loaded ? 1 : 0));
    order.forEach((p, i) => { p.slot = i; });
    S.order = order.map(p => p.pid);
    emit({ type: 'grid', order: order.map(p => ({ pid: p.pid, slot: p.slot })) });
  }
  function beginCountdown(at) {
    for (const p of racers()) if (!p.loaded) {
      if (C.lateJoin === 'spectate') { p.role = 'spectator'; p.status = 'spectating'; emit({ type: 'spectate', pid: p.pid, why: 'Still loading when the race started: watching this one.' }); }
      else { p.late = true; emit({ type: 'late', pid: p.pid }); }
    }
    assignGrid();
    for (const p of racers()) { p.status = 'racing'; makeTracker(p); }
    S.countdownAt = at; S.goAt = at + C.countdownSec * 1000;
    phase('countdown', at, { goAt: S.goAt, lightsSec: C.lightsSec });
  }
  function out(p, why, at) {
    if (p.status === 'finished' || p.status === 'dnf') return;
    p.status = 'dnf'; p.why = why; p.outAt = at;
    emit({ type: 'dnf', pid: p.pid, why });
  }
  function finishRace(at) {
    if (S.phase === 'results') return;
    for (const p of racers()) if (p.status === 'racing') out(p, 'time', at);
    S.endedAt = at;
    phase('results', at, { results: api.results() });
  }

  const api = {
    get phase() { return S.phase; }, get goAt() { return S.goAt; }, get state() { return S; }, players, laps, maxRacers,
    join(pid, info) {
      const racing = S.phase !== 'lobby';
      const room = racers().length < maxRacers;
      const role = !racing && room && !info.spectator ? 'racer' : 'spectator';
      players.set(pid, { pid, uid: info.uid, name: info.name, npc: !!info.npc, guest: !!info.guest, car: info.car ?? null, rating: info.rating ?? null, ping: null,
        role, ready: !!info.npc, loaded: !!info.npc, status: role === 'racer' ? 'waiting' : 'spectating', slot: null, tracker: null, last: null,
        jumped: false, penaltyMs: 0, finishMs: null, lapMs: [], flags: [], history: [], away: null, leftEarly: false, late: false, why: null, joinedAt: now });
      return role;
    },
    leave(pid, at) {
      const p = players.get(pid);
      if (!p) return;
      if (S.phase === 'lobby' || p.role === 'spectator') { players.delete(pid); return; }
      // (during a race: out, and it counts — their car is taken away)
      if (p.status !== 'finished') { p.leftEarly = S.phase !== 'results'; out(p, 'left', at); }
      p.gone = true;
    },
    drop(pid, at) { const p = players.get(pid); if (p) p.away = at; },
    back(pid) { const p = players.get(pid); if (p) p.away = null; },
    setReady(pid, v) { const p = players.get(pid); if (p && S.phase === 'lobby' && p.role === 'racer') p.ready = !!v; },
    setCar(pid, car) { const p = players.get(pid); if (p && S.phase === 'lobby') { p.car = car; p.ready = false; } },
    makeSpectator(pid) { const p = players.get(pid); if (p && S.phase === 'lobby') { p.role = 'spectator'; p.status = 'spectating'; p.ready = false; } },
    makeRacer(pid) { const p = players.get(pid); if (p && S.phase === 'lobby' && p.role === 'spectator' && racers().length < maxRacers) { p.role = 'racer'; p.status = 'waiting'; } },
    allReady() { const r = racers().filter(p => !p.npc); return r.length > 0 && r.every(p => p.ready); },
    start(at) {
      if (S.phase !== 'lobby' || !racers().length) return false;
      S.loadDeadline = at + C.loadTimeoutSec * 1000;
      for (const p of racers()) { p.loaded = p.npc; p.hashOk = null; p.status = 'loading'; }
      phase('loading', at, { deadline: S.loadDeadline });
      return true;
    },
    loaded(pid, { hash = null } = {}, at) {
      const p = players.get(pid);
      if (!p) return { ok: false, why: 'not in this race' };
      if (course.trackHash && hash !== course.trackHash) {
        // (a generated track built differently here: they'd be racing something else)
        p.hashOk = false;
        if (p.role === 'racer' && S.phase !== 'lobby') { p.role = 'spectator'; p.status = 'spectating'; emit({ type: 'spectate', pid, why: 'Your game built this track differently from the server\'s (its check didn\'t match): watching this one. Update the game.' }); }
        return { ok: false, why: 'The track your game built doesn\'t match the server\'s.' };
      }
      p.hashOk = true;
      if (p.loaded) return { ok: true };
      p.loaded = true;
      // (late: a slot at the back, and off they go from it)
      if (p.role === 'racer' && (S.phase === 'countdown' || S.phase === 'racing') && p.slot == null) {
        const used = new Set(racers().filter(x => x.slot != null).map(x => x.slot));
        let i = 0; while (used.has(i)) i++;
        p.slot = Math.min(i, slots.length - 1); p.status = 'racing'; makeTracker(p);
        emit({ type: 'grid', order: [{ pid, slot: p.slot }], late: true });
      }
      return { ok: true };
    },
    carState(pid, st) {
      const p = players.get(pid), ev = [];
      if (!p || p.role !== 'racer' || !p.tracker || (S.phase !== 'countdown' && S.phase !== 'racing')) return ev;
      const t = st.t, x = st.pos[0], z = st.pos[2], vx = st.vel?.[0] ?? 0, vz = st.vel?.[2] ?? 0;
      const slot = slots[p.slot];
      // the start: before the lights go out, a car off its slot has jumped it
      if (S.goAt != null && t < S.goAt) {
        const off = slot ? Math.hypot(x - slot.x, z - slot.z) > C.jumpStart.toleranceM : false;
        if (!off) p.settled = true;
        const judged = p.settled || t >= (S.countdownAt ?? -Infinity) + (C.jumpStart.settleSec ?? 0) * 1000;
        if (slot && !p.jumped && !p.late && off && judged && p.last) {
          p.jumped = true; p.penaltyMs += C.jumpStart.penaltySec * 1000;
          ev.push(emit({ type: 'jumpstart', pid, penaltySec: C.jumpStart.penaltySec }));
        }
        p.last = { t, x, z, vx, vz };
        return ev;
      }
      if (p.status !== 'racing') { p.last = { t, x, z, vx, vz }; return ev; }
      if (!p.tracker.state.running) p.tracker.start();
      const prev = p.last ?? { t: S.goAt, x, z, vx, vz };
      const dt = (t - prev.t) / 1000;
      if (dt <= 0) return ev;
      const u0 = p.tracker.state.u;
      const tev = p.tracker.update(dt, { x, z, vx, vz });
      // (the live check on progress: never more distance than the car could have driven)
      const gained = p.tracker.state.u - u0, allowed = cfg.race.progress.maxSpeed * dt + cfg.race.progress.slackM;
      if (gained > allowed) {
        p.tracker.state.u = u0;
        p.flags.push({ kind: 'progress', at: t, gained: Math.round(gained), allowed: Math.round(allowed) });
        ev.push(emit({ type: 'flag', pid, kind: 'progress', message: `Gained ${Math.round(gained)} m along the route in ${dt.toFixed(2)} s.` }));
      }
      for (const e of tev) {
        if (e.type === 'missed') { p.flags.push({ kind: 'missed', at: t, number: e.number }); ev.push(emit({ type: 'flag', pid, kind: 'missed', number: e.number, message: e.message })); }
        if (e.type === 'checkpoint' && !e.bonus) ev.push(emit({ type: 'checkpoint', pid, number: e.number, of: e.of }));
        if (e.type === 'lap' || e.type === 'finish') {
          // (the moment it crossed the line, between the two states either side of it)
          const f = crossing(course.loop ? course.start : course.finish, prev, { x, z }), tc = prev.t + (f ?? 1) * (t - prev.t);
          const sinceGo = tc - S.goAt, lapsSoFar = p.lapMs.reduce((a, b) => a + b, 0);
          p.lapMs.push(sinceGo - lapsSoFar);
          if (e.type === 'lap') ev.push(emit({ type: 'lap', pid, lap: e.lap, of: laps, lapMs: p.lapMs.at(-1) }));
          else {
            p.status = 'finished'; p.finishMs = sinceGo + p.penaltyMs; p.finishedAt = tc;
            if (S.firstFinish == null) { S.firstFinish = tc; S.finishDeadline = tc + C.finishWindowSec * 1000; }
            ev.push(emit({ type: 'finish', pid, timeMs: p.finishMs, penaltyMs: p.penaltyMs, place: api.standings(t).find(x => x.pid === pid)?.place, deadline: S.finishDeadline }));
          }
        }
      }
      if (!p.history.length || p.tracker.state.u - p.history.at(-1)[0] >= 20) { p.history.push([p.tracker.state.u, t]); if (p.history.length > 4000) p.history.splice(0, 1000); }
      p.last = { t, x, z, vx, vz };
      return ev;
    },
    update(at) {
      if (S.phase === 'loading') {
        const r = racers();
        if (!r.length) { phase('lobby', at); return api.drain(); }
        if (r.every(p => p.loaded) || at >= S.loadDeadline) beginCountdown(at);
      }
      if (S.phase === 'countdown' && at >= S.goAt) phase('racing', S.goAt);
      if (S.phase === 'racing') {
        for (const p of racers()) {
          if (p.status === 'racing' && p.away != null && at - p.away >= C.dnfGraceSec * 1000) out(p, 'disconnected', at);
          if (p.status === 'racing' && p.gone) out(p, 'left', at);
        }
        if (S.finishDeadline != null && at >= S.finishDeadline) finishRace(at);
        else if (!racers().some(p => p.status === 'racing' || (p.status === 'loading' && !p.npc))) finishRace(at);
        // (no players left at all — only NPCs: it's over)
        else if (!racers().some(p => !p.npc && !p.gone && p.status !== 'dnf')) finishRace(at);
      }
      return api.drain();
    },
    drain() { return events.splice(0); },
    standings(at) {
      const r = racers();
      const leader = [...r].filter(p => p.status === 'racing').sort((a, b) => (b.tracker?.state.u ?? -1e9) - (a.tracker?.state.u ?? -1e9))[0];
      const timeAt = (h, u) => { for (let i = h.length - 1; i >= 0; i--) if (h[i][0] <= u) { const n = h[i + 1]; return n ? h[i][1] + (u - h[i][0]) / Math.max(1e-6, n[0] - h[i][0]) * (n[1] - h[i][1]) : h[i][1]; } return null; };
      const rank = p => p.status === 'finished' ? 0 : p.status === 'racing' || p.status === 'loading' ? 1 : 2;
      const sorted = [...r].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.finishMs - b.finishMs : (b.tracker?.state.u ?? -1e9) - (a.tracker?.state.u ?? -1e9)));
      const winner = sorted.find(p => p.status === 'finished');
      return sorted.map((p, i) => {
        const u = p.tracker?.state.u ?? 0, st = p.tracker?.state;
        let gapMs = null;
        if (p.status === 'finished') gapMs = winner ? p.finishMs - winner.finishMs : 0;
        else if (p.status === 'racing' && leader && leader !== p && !winner) { const tl = timeAt(leader.history, u); gapMs = tl != null && p.last ? Math.max(0, p.last.t - tl) : null; }
        return { pid: p.pid, uid: p.uid, name: p.name, npc: p.npc, place: i + 1, status: p.status, lap: Math.min(laps, (st?.lap ?? 0) + (p.status === 'finished' ? 0 : 1)), laps, u: Math.round(u), progress: st?.progress ?? 0, gapMs, timeMs: p.finishMs, penaltyMs: p.penaltyMs, away: p.away != null, why: p.why, late: p.late };
      });
    },
    results() {
      return api.standings(S.endedAt ?? 0).map(s => {
        const p = players.get(s.pid);
        return { pid: s.pid, uid: p.uid, name: p.name, npc: p.npc, guest: p.guest, place: s.place, status: p.status === 'finished' ? 'finished' : 'dnf', why: p.why, timeMs: p.finishMs, penaltyMs: p.penaltyMs, jumped: p.jumped,
          lapMs: p.lapMs.slice(), bestLapMs: p.lapMs.length ? Math.min(...p.lapMs) : null, laps: p.lapMs.length, leftEarly: p.leftEarly, flags: p.flags.slice(0, 20), car: p.car, rating: p.rating };
      });
    },
    // (back to the lobby with the same players: the last order kept for a reversed grid)
    rematch(at) {
      S.lastOrder = api.results().map(r => r.uid);
      for (const [pid, p] of players) {
        if (p.gone || p.npc) { players.delete(pid); continue; }
        Object.assign(p, { ready: false, loaded: false, status: p.role === 'racer' ? 'waiting' : 'spectating', slot: null, tracker: null, last: null, jumped: false, penaltyMs: 0, finishMs: null, lapMs: [], flags: [], history: [], leftEarly: false, late: false, why: null });
      }
      Object.assign(S, { loadDeadline: null, countdownAt: null, goAt: null, finishDeadline: null, endedAt: null, firstFinish: null, order: [] });
      phase('lobby', at);
    },
    view(at) {
      return { phase: S.phase, goAt: S.goAt, loadDeadline: S.loadDeadline, finishDeadline: S.finishDeadline, laps, maxRacers,
        players: [...players.values()].filter(p => !p.gone).map(p => ({ pid: p.pid, uid: p.uid, name: p.name, npc: p.npc, guest: p.guest, role: p.role, ready: p.ready, loaded: p.loaded, status: p.status, slot: p.slot, car: p.car, rating: p.rating, away: p.away != null })),
        standings: S.phase === 'lobby' || S.phase === 'loading' ? [] : api.standings(at) };
    },
  };
  return api;
}
