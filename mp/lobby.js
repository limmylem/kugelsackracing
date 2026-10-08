// A lobby's rules (Phase 7 Step 2; docs/MULTIPLAYER.md "Lobbies"), pure: its settings and what they may be, invite
// codes, the chat's pace, and who becomes host. The race room keeps the lobby; the game's lobby screen shows the same
// limits.
//
//   LOBBY_KINDS: quick (matchmaking: the server's settings, ranked), private (an invite code or a friend's invite),
//                custom (the host's settings, optionally in the public lobby browser)
//   normaliseSettings(input, cfg, { kind }) → { settings, problems }      (anything out of range brought into it)
//     venue: { kind: 'route', id } (a real-world route) | { kind: 'track', code } (a track code) |
//            { kind: 'official' } (today's track) | { kind: 'random' }
//   inviteCode(rng, length) → 'K7M2QX' (no look-alike letters)      normaliseCode(text)
//   createChatGate(cfg.lobby.chat) → gate(now) → whether one more message may go now
//   nextHost(players, leaving) → the one who's been there longest (not an NPC, not leaving)

export const LOBBY_KINDS = ['quick', 'private', 'custom'];
export const CLASSES = ['D', 'C', 'B', 'A', 'S', 'X'];
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normaliseSettings(input = {}, cfg, { kind = 'custom' } = {}) {
  const L = cfg.lobby, problems = [];
  const v = input.venue ?? { kind: 'random' };
  let venue;
  if (v.kind === 'route' && typeof v.id === 'string' && v.id.length <= 80) venue = { kind: 'route', id: v.id };
  else if (v.kind === 'track' && typeof v.code === 'string' && /^[0-9A-Z-]{20,40}$/i.test(v.code.trim())) venue = { kind: 'track', code: v.code.trim().toUpperCase() };
  else if (v.kind === 'official') venue = { kind: 'official', which: v.which === 'weekly' ? 'weekly' : 'daily' };
  else { if (v.kind && v.kind !== 'random') problems.push('That route or track isn\'t one the lobby can use: a random one instead.'); venue = { kind: 'random' }; }
  const pick = (x, list, d) => list.includes(x) ? x : d;
  const classes = Array.isArray(input.classes) ? input.classes.filter(c => CLASSES.includes(c)) : [];
  const settings = {
    kind: LOBBY_KINDS.includes(kind) ? kind : 'custom',
    name: String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
    listed: kind === 'custom' ? input.listed !== false : false,
    venue,
    laps: Math.max(1, Math.min(L.lapsMax, Math.round(Number(input.laps) || 3))),
    classes: classes.length ? [...new Set(classes)] : null,                      // (null: any class)
    npcFill: !!input.npcFill,
    timeOfDay: pick(input.timeOfDay, L.times, 'afternoon'),
    weather: pick(input.weather, L.weathers, 'clear'),
    // (car contact, Phase 7 Step 3: a quick race the public mode, else the host's choice)
    collisions: kind === 'quick' ? cfg.contact?.publicMode ?? 'reduced' : pick(input.collisions, cfg.contact?.modes ?? ['ghost'], cfg.contact?.defaultMode ?? 'reduced'),
    gridOrder: pick(input.gridOrder, L.gridOrders, 'rating'),
    maxPlayers: Math.max(2, Math.min(L.maxPlayers, Math.round(Number(input.maxPlayers) || L.maxPlayers))),
    ranked: kind === 'quick',
  };
  if (input.collisions && kind !== 'quick' && !(cfg.contact?.modes ?? []).includes(input.collisions)) problems.push(`There's no collision mode "${String(input.collisions).slice(0, 20)}": ${settings.collisions}.`);
  return { settings, problems };
}

// (whether a car may race in this lobby: its class among the allowed ones)
export const carAllowed = (car, settings) => !settings.classes || (car?.cls && settings.classes.includes(car.cls));

export function inviteCode(rng = Math.random, length = 6) { let s = ''; for (let i = 0; i < length; i++) s += CODE_LETTERS[Math.floor(rng() * CODE_LETTERS.length)]; return s; }
export const normaliseCode = t => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

export function createChatGate({ burst, perSec }) {
  let tokens = burst, at = null;
  return now => {
    if (at != null) tokens = Math.min(burst, tokens + (now - at) / 1000 * perSec);
    at = now;
    if (tokens < 1) return false;
    tokens--; return true;
  };
}

/** @param {any[]} players @param {string | number | null} [leavingPid] */
export function nextHost(players, leavingPid = null) {
  return [...players].filter(p => !p.npc && p.pid !== leavingPid && !p.gone).sort((a, b) => a.joinedAt - b.joinedAt || a.pid - b.pid)[0] ?? null;
}
