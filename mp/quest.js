// A multiplayer race as a quest (Phase 7 Step 2), pure: the game runs each player's race through the same QuestSession
// as any other (quest/session.js: the gates, the sub-tick timing, the result), and the API checks the run with the same
// rules (quest/validate.js) — against this quest, made the same way on both sides from what the race server says.
// No fee, no quest reward: a multiplayer race pays by place, once its results are confirmed (mp/results.js).
//
//   raceQuest({ raceId, venue, laps, loop, name, trackHash }) → quest

export function raceQuest({ raceId, venue, laps = 1, loop = false, name = 'Multiplayer race', trackHash = null }) {
  return {
    id: `mp_${raceId}`, kind: 'quest', mp: true, name,
    type: loop ? 'circuit_race' : 'sprint',
    route: venue?.kind === 'route' ? venue.id : null,
    track: venue?.kind === 'track' ? { code: venue.code, hash: trackHash, kind: 'mp' } : null,
    params: { laps: loop ? Math.max(1, laps) : 1 },
    start: { mode: 'standing' },
    fee: 0, reward: null, npc: null,
    version: 1, updated: `mp-${raceId}`,
  };
}
