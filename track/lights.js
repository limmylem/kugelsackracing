// The start lights (Phase 5 Step 2): the gantry over a dressed track's start line follows the race's own
// countdown (Phase 4 Step 3: the quest session's, or the route test drive's) — five red lights coming on
// one after another through the countdown, all going out at GO (and the green ones lit a moment). Pure:
// the game asks it each frame what the gantry shows.
//
//   startLights({ phase: 'idle' | 'countdown' | 'go', left (s to GO), total (s of countdown), since (s since GO) }) → { red: 0–5, green }

export const LIGHTS = { count: 5, greenFor: 3 };

export function startLights({ phase = 'idle', left = 0, total = 3, since = Infinity } = {}) {
  if (phase === 'countdown') {
    const f = Math.min(1, Math.max(0, (total - left) / total));
    return { red: Math.min(LIGHTS.count, Math.floor(f * LIGHTS.count) + 1), green: false };
  }
  if (phase === 'go') return { red: 0, green: since < LIGHTS.greenFor };
  return { red: 0, green: false };
}
