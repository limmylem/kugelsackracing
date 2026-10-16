// A co-op police pursuit's mission (docs/PURSUIT.md), pure: the party's side of it on top of the director
// (pursuit/director.js — the shared heat, the units, who's busted). The race server runs it (server/src/rt/pursuit.ts:
// it decides, the players' games show it); the tests run it on made-up cars.
//
//   kinds: convoy   get away (or to the drop) together — it fails only when every one of you is busted
//          getaway  one of you carries the goods (the police go for the carrier first: targeting.objective); busted,
//                   the goods are dropped where they were and anyone free can pick them up (within pickupM); it's done
//                   when the goods reach the drop — or they've escaped with them
//          split    each of you has your own drop (drops[i]); the police split up; done when everyone still free is at
//                   theirs
//   A busted player respawns after respawn s (back in, out of sight: the game picks the place) or spectates (busted:
//   'spectate'). Rewards: shared (everyone paid the whole) or split (each a share by their part of the score).
//
//   const M = createCoopMission({ cfg (data/pursuit.json), mission: { kind, players: [id], drops: [{ x, z }], destination,
//                                 busted: 'respawn' | 'spectate', respawn, rewards: 'shared' | 'split', escapeFirst, dropM } })
//   M.tick({ dt, players: [{ id, x, z, speed }], status (the director's), revive(id) }) → events
//   M.leave(id)   M.end(status, reason)   M.status → { kind, carrier, goods, players: [{ id, state, respawnIn, drop, score, arrived }], done }
//   M.shares(total) → { id: share of the reward (0–1) }

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const COOP_KINDS = ['convoy', 'getaway', 'split'];

export function createCoopMission({ cfg, mission }) {
  const C = cfg.coop, kind = COOP_KINDS.includes(mission.kind) ? mission.kind : 'convoy', ids = mission.players.slice(0, C.maxPlayers);
  const respawn = mission.respawn ?? C.respawn, mode = mission.busted === 'spectate' ? 'spectate' : 'respawn', R = mission.dropM ?? 18;
  const S = {
    kind, done: null, t: 0,
    carrier: kind === 'getaway' ? ids[0] : null, goods: null,       // goods: dropped { x, z } (carried: null — it's the carrier's)
    players: new Map(ids.map((id, i) => [id, { id, state: 'active', respawnIn: 0, drop: kind === 'split' ? mission.drops?.[i % (mission.drops?.length || 1)] ?? mission.destination ?? null : mission.destination ?? null, arrived: false, score: 0, busts: 0 }])),
  };
  const events = [], emit = e => events.push(e);
  const P = id => S.players.get(id);
  const free = () => [...S.players.values()].filter(p => p.state === 'active' || p.state === 'arrived');
  function end(status, reason) { if (!S.done) { S.done = { status, reason, t: S.t }; emit({ type: 'coop-done', status, reason }); } }

  return {
    kind, state: S,
    tick({ dt, players, status, revive = () => {} }) {
      if (S.done) return events.splice(0);
      S.t += dt;
      const at = new Map(players.map(p => [p.id, p]));
      // who the director's busted; respawns
      for (const p of S.players.values()) {
        const D = status?.players?.find(x => x.id === p.id);
        if (p.state === 'active' && D?.busted) {
          p.state = mode === 'respawn' ? 'respawning' : 'spectating'; p.respawnIn = respawn; p.busts++;
          emit({ type: 'coop-busted', player: p.id, respawn: mode === 'respawn' ? respawn : null });
          // the goods dropped where the carrier was caught
          if (S.carrier === p.id) { const q = at.get(p.id); S.goods = q ? { x: q.x, z: q.z } : S.goods; S.carrier = null; emit({ type: 'coop-drop', player: p.id, ...S.goods }); }
        } else if (p.state === 'respawning' && (p.respawnIn -= dt) <= 0) { p.state = 'active'; revive(p.id); emit({ type: 'coop-respawn', player: p.id }); }
      }
      // the score: each of you, every second you're free and they're after you, × the heat
      const chased = status && (status.phase === 'pursuit' || status.phase === 'cooldown');
      for (const p of S.players.values()) if (chased && p.state === 'active') p.score += dt * (status.level ?? 1);
      // the goods on the ground: anyone free close enough picks them up
      if (kind === 'getaway' && S.goods) for (const p of free()) { const q = at.get(p.id); if (q && dist(q, S.goods) <= C.pickupM) { S.carrier = p.id; S.goods = null; emit({ type: 'coop-pickup', player: p.id }); break; } }
      // at a drop
      for (const p of free()) {
        const q = at.get(p.id);
        if (!q || !p.drop || p.arrived) continue;
        if (dist(q, p.drop) <= R && (!mission.escapeFirst || status?.phase === 'escaped')) { p.arrived = true; p.state = 'arrived'; emit({ type: 'coop-arrived', player: p.id }); }
      }
      // over?
      const left = free();
      if (!left.length && ![...S.players.values()].some(p => p.state === 'respawning')) end('failed', 'all busted');
      else if (kind === 'getaway') {
        if (S.carrier && P(S.carrier)?.arrived) end('finished', 'delivered');
        else if (!mission.destination && status?.phase === 'escaped' && S.carrier) end('finished', 'escaped');
      } else if (kind === 'split') {
        if (left.length && left.every(p => p.arrived) && ![...S.players.values()].some(p => p.state === 'respawning')) end('finished', 'all at their drops');
      } else {
        if (mission.destination ? left.length && left.every(p => p.arrived) : status?.phase === 'escaped') end('finished', mission.destination ? 'at the drop' : 'escaped');
      }
      return events.splice(0);
    },
    // (a player who's left the room: out of it — not waited for, not counted as free)
    leave(id) { const p = P(id); if (p && p.state !== 'gone') { p.state = 'gone'; if (S.carrier === id) S.carrier = null; emit({ type: 'coop-left', player: id }); } },
    end,
    get status() {
      return { kind, carrier: S.carrier, goods: S.goods, done: S.done, players: [...S.players.values()].map(p => ({ id: p.id, state: p.state, respawnIn: Math.max(0, p.respawnIn), drop: p.drop, arrived: p.arrived, score: Math.round(p.score * 10) / 10 })) };
    },
    // each player's share of the reward: shared — everyone the whole; split — by their score (at least an even tenth)
    shares() {
      const ps = [...S.players.values()];
      if (mission.rewards !== 'split') return Object.fromEntries(ps.map(p => [p.id, 1]));
      const total = ps.reduce((a, p) => a + p.score, 0);
      if (!(total > 0)) return Object.fromEntries(ps.map(p => [p.id, 1 / ps.length]));
      const floor = 0.1 / ps.length, raw = ps.map(p => Math.max(floor, p.score / total)), sum = raw.reduce((a, b) => a + b, 0);
      return Object.fromEntries(ps.map((p, i) => [p.id, raw[i] / sum]));
    },
  };
}
