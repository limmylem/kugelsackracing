// Matchmaking for quick races (Phase 7 Step 2; docs/MULTIPLAYER.md "Matchmaking"), pure: the queue as it stands
// in, the races to start (and the parties to offer NPCs to) out. The queue room (server/src/rt/queue.ts) runs it
// every queue.cycleMs; the load test runs it the same way.
//
// A queue entry is a party (one player, or friends queuing together — always kept together):
//   { id, since (ms), players: [{ uid, skill (OpenSkill ordinal), pr (performance rating), cls (car class), safety }],
//     pings: { region: ms }, npcOk (the party said yes to NPC fill) }
//
// The oldest party waiting anchors a group, and the parties that fit join it, closest first. What fits, in order:
//   1. region: the anchor's best region (lowest ping); every party's ping there (the anchor's too) within the limit for
//      how long the anchor has waited (queue.pingLimitsMs, one step every queue.pingStepSec; after the last, none)
//   2. skill: its average within the skill window of the group's (start, growing per second waited, up to max)
//   3. car: the same class (queue.classStrict), and its performance rating within the performance window
//   4. safety (Phase 7 Step 3): its safety rating within the safety window of the group's (contact.match: start,
//      growing per second waited, up to max) — clean drivers race clean drivers; weight: how much it counts in choosing
// A group starts when it's full (grid.maxPlayers), or when the anchor has waited queue.fillAfterSec and it has
// grid.quickMinHumans players — or straight away, with NPCs in the empty slots, once the anchor's party has said
// yes to the NPC offer (made at queue.npcOfferSec).
//
//   matchQueue(entries, now, cfg) → { matches: [{ entries, players, region, npcFill, quality }], offers: [entryId] }
//   quality: { skillSpread, performanceSpread, safetySpread, pingOver (worst ping above that party's best), sameClass, waitSec (each party's) }

const waited = (e, now) => Math.max(0, (now - e.since) / 1000);
const grow = (w, x) => Math.min(w.max, w.start + w.growPerSec * x);
const avg = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
export const bestRegion = pings => Object.entries(pings ?? {}).sort((a, b) => a[1] - b[1])[0] ?? ['local', 0];
const SAFETY_START = 60;
const partyOf = e => ({ skill: avg(e.players.map(p => p.skill)), pr: avg(e.players.map(p => p.pr)), safety: avg(e.players.map(p => p.safety ?? SAFETY_START)), cls: e.players[0]?.cls ?? null, mixed: new Set(e.players.map(p => p.cls)).size > 1 });

export function matchQueue(entries, now, cfg) {
  const Q = cfg.queue, max = cfg.grid.maxPlayers, minHumans = cfg.grid.quickMinHumans;
  const list = [...entries].sort((a, b) => a.since - b.since || String(a.id).localeCompare(String(b.id)));
  const used = new Set(), matches = [], offers = [];
  for (const anchor of list) {
    if (used.has(anchor.id)) continue;
    const w = waited(anchor, now), [region, anchorPing] = bestRegion(anchor.pings);
    // (the ping limit: every party in the race within it, the anchor too — past the last step, no limit, so a player
    // far from every region still gets a race in the end)
    const step = Math.floor(w / Q.pingStepSec), pingLimit = step >= Q.pingLimitsMs.length - 1 ? Infinity : Q.pingLimitsMs[step];
    if (anchorPing > pingLimit) continue;
    const skillWin = grow(Q.skill, w), prWin = grow(Q.performance, w), SW = cfg.contact?.match, safeWin = SW ? grow(SW, w) : Infinity;
    const a = partyOf(anchor);
    const group = [anchor];
    let size = anchor.players.length;
    // (the parties that fit, closest to the group first)
    const fits = [];
    for (const e of list) {
      if (e === anchor || used.has(e.id) || size + e.players.length > max) continue;
      const ping = e.pings?.[region];
      if (ping == null || ping > pingLimit) continue;
      const p = partyOf(e);
      if (Q.classStrict && (p.cls !== a.cls || p.mixed || a.mixed)) continue;
      const ds = Math.abs(p.skill - a.skill), dp = Math.abs(p.pr - a.pr), dsf = Math.abs(p.safety - a.safety);
      if (ds > skillWin || dp > prWin || dsf > safeWin) continue;
      fits.push({ e, score: ds / Math.max(1, skillWin) + dp / Math.max(1, prWin) + (SW ? SW.weight * dsf / Math.max(1, safeWin) : 0) + ping / 1000 });
    }
    fits.sort((x, y) => x.score - y.score);
    for (const { e } of fits) {
      if (size + e.players.length > max) continue;
      // (each one added must still fit the group as it now is: its average moves as it fills)
      const gs = avg(group.flatMap(g => g.players.map(p => p.skill))), gp = avg(group.flatMap(g => g.players.map(p => p.pr))), gf = avg(group.flatMap(g => g.players.map(p => p.safety ?? SAFETY_START))), p = partyOf(e);
      if (Math.abs(p.skill - gs) > skillWin || Math.abs(p.pr - gp) > prWin || Math.abs(p.safety - gf) > safeWin) continue;
      group.push(e); size += e.players.length;
      if (size >= max) break;
    }
    const full = size >= max, slow = w >= Q.fillAfterSec && size >= minHumans, npc = !!anchor.npcOk;
    if (full || slow || npc) {
      for (const g of group) used.add(g.id);
      matches.push({ entries: group, players: group.flatMap(g => g.players), region, npcFill: npc && !full, quality: qualityOf(group, region, now) });
    } else if (w >= Q.npcOfferSec && !anchor.offered) offers.push(anchor.id);
  }
  return { matches, offers };
}

export function qualityOf(group, region, now) {
  const ps = group.flatMap(g => g.players), sk = ps.map(p => p.skill), pr = ps.map(p => p.pr), sf = ps.map(p => p.safety ?? SAFETY_START);
  return {
    skillSpread: Math.max(...sk) - Math.min(...sk),
    performanceSpread: Math.max(...pr) - Math.min(...pr),
    safetySpread: Math.max(...sf) - Math.min(...sf),
    pingOver: Math.max(...group.map(g => (g.pings?.[region] ?? 0) - bestRegion(g.pings)[1])),
    sameClass: new Set(ps.map(p => p.cls)).size === 1,
    waitSec: group.map(g => waited(g, now)),
    humans: ps.length,
  };
}

// (percentiles, for the dashboard and the load test)
export function percentile(xs, q) { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; }
