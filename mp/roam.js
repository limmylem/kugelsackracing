// Free roam's rules (Phase 7 Step 4; docs/FREE_ROAM.md), pure: the zones the world is cut into and the zones a car is in,
// which instance a player joins, who sees whom (privacy and blocks), whose cars touch (ghosting, passive mode, the
// automatic protection against ramming), meets, and where a player comes back to. The real-time server, the game, the
// bots and the tests all use these; nothing here knows about sockets or pages. Settings: data/roam.json.
//
// ZONES. A region's map frame (x east, z south, m) is cut into square zones of zoneTiles x zoneTiles Map v3 tiles.
//   zoneSize(cfg, tileSize) · zoneOf(x, z, size) → { i, j, key } · zoneBox(key, size) · distToZone(x, z, key, size)
//   createZoneTracker(cfg, { tileSize }) → T.update(x, z) → { home, zones, add, drop, handoff }
//     zones: the zones this car is in now (its home, and every neighbour within overlapM); add / drop: what changed;
//     handoff: { from, to } when its home changed (handoffM past the border: no flapping on the line).
// INSTANCES.
//   placeInstance({ me, candidates, cfg }) → { group, room?, why }    who joins which instance of a zone, in order: a
//     party member's, a friend's, the one with the most players near, the lowest ping; never one with someone blocked
//     either way; full ones skipped (a party or friend may use the friendSlots beyond capacity); none fits: a new group.
// SEEING.
//   relation(viewerUid, target, rel) → 'self' | 'blocked' | 'friend' | 'party' | 'other'
//   seesInWorld · seesOnMap · canJoin · nameFor(viewer, target, rel)  — privacy settings and blocks, one place for all
// CONTACT.
//   touches(a, b) → whether two players' cars collide (both 'contact', or one party with party contact on; never a
//     passive, auto-ghosted or other-challenge car); toggleAllowed(kind, last, now, cfg)
//   createAutoGhost(cfg) → G.hit({ uid, t, share, strength }) → { ghosted, until, safetyHits } · G.until(uid)
// MEETS.  meetSpots(meet, cfg) → spots [{ n, x, z, heading }] · nearestFreeSpot(spots, taken, x, z)
//   meetEventState(event, now, cfg) → { state: 'later' | 'announced' | 'live' | 'over', startsInSec }
// COMING BACK. restorePoint(saved, { regions, roadDistance, spawnOf, cfg }) → { region, pos, heading, car, damage, garage, why }

export const TILE = 512;

// ---------- zones ----------
export const zoneSize = (cfg, tileSize = TILE) => cfg.zones.zoneTiles * tileSize;
export function zoneOf(x, z, size) {
  const i = Math.floor(x / size), j = Math.floor(z / size);
  return { i, j, key: `${i},${j}` };
}
export function zoneBox(key, size) {
  const [i, j] = String(key).split(',').map(Number);
  return { x0: i * size, z0: j * size, x1: (i + 1) * size, z1: (j + 1) * size };
}
// how far a point is outside a zone (0 inside it)
export function distToZone(x, z, key, size) {
  const b = zoneBox(key, size), dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
  return Math.hypot(dx, dz);
}
// how far inside a zone a point is (to its nearest edge; negative: outside)
export function depthInZone(x, z, key, size) {
  const b = zoneBox(key, size);
  const inside = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z);
  return inside >= 0 ? inside : -distToZone(x, z, key, size);
}
// every zone within reach of a point (its own, and the neighbours whose edge is within reach)
export function zonesWithin(x, z, size, reach) {
  const out = [], h = zoneOf(x, z, size), k = Math.ceil(reach / size);
  for (let i = h.i - k; i <= h.i + k; i++) for (let j = h.j - k; j <= h.j + k; j++) {
    const key = `${i},${j}`;
    if (distToZone(x, z, key, size) <= reach) out.push(key);
  }
  return out;
}

export function createZoneTracker(cfg, { tileSize = TILE } = {}) {
  const Z = cfg.zones, size = zoneSize(cfg, tileSize);
  let home = null;
  const zones = new Set();
  return {
    size,
    get home() { return home; },
    get zones() { return [...zones]; },
    update(x, z) {
      const add = [], drop = [];
      let handoff = null;
      const here = zoneOf(x, z, size).key;
      if (home == null) home = here;
      // (a reset or a teleport far away: straight to where it is)
      else if (here !== home && distToZone(x, z, home, size) > Z.overlapM + Z.leaveSlackM) { handoff = { from: home, to: here, jump: true }; home = here; }
      // the home zone changes once the car is handoffM inside another (hysteresis: a car on the line doesn't flap)
      else if (here !== home && depthInZone(x, z, here, size) >= Z.handoffM) { handoff = { from: home, to: here }; home = here; }
      const want = new Set([home, ...zonesWithin(x, z, size, Z.overlapM)]);
      for (const k of want) if (!zones.has(k)) { zones.add(k); add.push(k); }
      for (const k of [...zones]) if (k !== home && !want.has(k) && distToZone(x, z, k, size) > Z.overlapM + Z.leaveSlackM) { zones.delete(k); drop.push(k); }
      return { home, zones: [...zones], add, drop, handoff };
    },
    reset() { home = null; zones.clear(); },
  };
}

// ---------- instances ----------
// me: { uid, pos: [x, z] | null, party: [uids] (not me), friends: [uids], blocked: [uids] (either way), group (the one
// it's in elsewhere: a handoff keeps it) }
// candidates: [{ group, room, players, uids: [], positions: [[x, z]], process?, pingMs? }]
export function placeInstance({ me, candidates, cfg, newGroup = () => `g${Math.random().toString(36).slice(2, 9)}` }) {
  const Z = cfg.zones, cap = Z.capacity, hard = Z.capacity + Z.friendSlots;
  const blocked = new Set(me.blocked ?? []), party = new Set(me.party ?? []), friends = new Set(me.friends ?? []);
  const ok = candidates.filter(c => !(c.uids ?? []).some(u => blocked.has(u)) && !(c.uids ?? []).includes(me.uid));
  const count = (c, set) => (c.uids ?? []).filter(u => set.has(u)).length;
  const near = c => !me.pos ? 0 : (c.positions ?? []).filter(p => Math.hypot(p[0] - me.pos[0], p[1] - me.pos[1]) <= Z.nearRadiusM).length;
  const best = (list, score, why) => {
    let top = null, s = -Infinity;
    for (const c of list) { const v = score(c); if (v > s || (v === s && top && (c.pingMs ?? 0) < (top.pingMs ?? 0))) { s = v; top = c; } }
    return top ? { group: top.group, room: top.room ?? null, why } : null;
  };
  // 1. the party's (a party sticks together, using the slots kept for friends)
  const withParty = ok.filter(c => count(c, party) > 0 && c.players < hard);
  if (withParty.length) return best(withParty, c => count(c, party) * 1000 + count(c, friends), 'party');
  // 2. a friend's
  const withFriends = ok.filter(c => count(c, friends) > 0 && c.players < hard);
  if (withFriends.length) return best(withFriends, c => count(c, friends), 'friends');
  // 3. the same group as in the zone it came from (a handoff), if it has room
  const same = ok.find(c => me.group && c.group === me.group && c.players < cap);
  if (same) return { group: same.group, room: same.room ?? null, why: 'same group' };
  // 4. the most players near, then the lowest ping (and, all else equal, the fuller: instances fill up rather than spread)
  const open = ok.filter(c => c.players < cap);
  if (open.length) {
    const top = best(open, c => near(c) * 1e6 - (c.pingMs ?? 0) * 1e3 + c.players, 'players near');
    if (top && near(open.find(c => c.group === top.group)) === 0) top.why = (open.some(c => c.pingMs != null) ? 'lowest ping' : 'fullest');
    return top;
  }
  // 5. none with room: a new instance — the group it was in, if it came with one and that group isn't here yet
  const g = me.group && !candidates.some(c => c.group === me.group) ? me.group : newGroup();
  return { group: g, room: null, why: 'new instance' };
}

// ---------- seeing (privacy and blocks) ----------
// rel: { friends: Set, blocked: Set (either way), party: Set }    target: { uid, settings: { location, appearOffline } }
export function relation(viewerUid, target, rel) {
  if (target.uid === viewerUid) return 'self';
  if (rel.blocked?.has(target.uid)) return 'blocked';
  if (rel.party?.has(target.uid)) return 'party';
  if (rel.friends?.has(target.uid)) return 'friend';
  return 'other';
}
// a car on the road: everyone near sees it — except someone blocked (either way), never in the same world
export const seesInWorld = (viewerUid, target, rel) => relation(viewerUid, target, rel) !== 'blocked';
// on the map and minimap: as the target's location setting says (a party always sees its own: they're driving together)
export function seesOnMap(viewerUid, target, rel) {
  const r = relation(viewerUid, target, rel), s = target.settings ?? {};
  if (r === 'self') return true;
  if (r === 'blocked') return false;
  if (r === 'party') return true;
  if (s.appearOffline) return false;
  if (s.location === 'everyone') return true;
  if (s.location === 'friends') return r === 'friend';
  return false;
}
// "Join friend": a friend who shows their location to friends (or everyone), and isn't appearing offline
export function canJoin(viewerUid, target, rel) {
  const r = relation(viewerUid, target, rel), s = target.settings ?? {};
  if (r !== 'friend' && r !== 'party') return { ok: false, why: r === 'blocked' ? 'blocked' : 'You can join your friends.' };
  if (s.appearOffline) return { ok: false, why: 'They aren\'t online.' };
  if (s.location === 'nobody') return { ok: false, why: 'They don\'t share where they are.' };
  return { ok: true };
}
// the name over a car: a player who shows their location to nobody (or appears offline) is a "Driver" to strangers
export function nameFor(viewerUid, target, rel) {
  const r = relation(viewerUid, target, rel), s = target.settings ?? {};
  if (r === 'self' || r === 'friend' || r === 'party') return target.name;
  if (s.appearOffline || s.location === 'nobody') return 'Driver';
  return target.name;
}

// ---------- contact ----------
// a: { uid, settings: { contact, passive, partyContact }, party (id or null), ghostUntil, challenge (id or null) }
export function touches(a, b, now = 0) {
  if (!a || !b || a.uid === b.uid) return false;
  const A = a.settings ?? {}, B = b.settings ?? {};
  if (A.passive || B.passive) return false;
  if ((a.ghostUntil ?? 0) > now || (b.ghostUntil ?? 0) > now) return false;
  // (a challenge: ghost to everyone outside it)
  if ((a.challenge ?? null) !== (b.challenge ?? null)) return false;
  if (A.contact && B.contact) return true;
  return !!(a.party && a.party === b.party && A.partyContact && B.partyContact);
}
// passive mode can be switched once every passiveCooldownSec; contact and the rest once every toggleCooldownSec
export function toggleAllowed(kind, lastAt, now, cfg) {
  const wait = (kind === 'passive' ? cfg.contact.passiveCooldownSec : cfg.contact.toggleCooldownSec) * 1000;
  const left = lastAt == null ? 0 : lastAt + wait - now;
  return left <= 0 ? { ok: true } : { ok: false, waitSec: Math.ceil(left / 1000) };
}

// the automatic protection: hits a player was at fault for, in a window; past the limit, ghosted for everyone (longer
// each time) and their safety rating to drop by each of those hits
export function createAutoGhost(cfg) {
  const G = cfg.contact.autoGhost, hits = new Map(), ghosted = new Map(), times = new Map();
  return {
    hit({ uid, t, share = 1, strength = 0 }) {
      if (share < G.faultShare || strength < G.minStrength) return { ghosted: false };
      const list = (hits.get(uid) ?? []).filter(x => x > t - G.windowSec * 1000);
      list.push(t); hits.set(uid, list);
      if (list.length < G.hits || (ghosted.get(uid) ?? 0) > t) return { ghosted: (ghosted.get(uid) ?? 0) > t, until: ghosted.get(uid) ?? 0 };
      const k = times.get(uid) ?? 0, until = t + G.ghostSec * 1000 * G.repeatFactor ** k;
      times.set(uid, k + 1); ghosted.set(uid, until); hits.set(uid, []);
      return { ghosted: true, until, safetyHits: list.length, safetyDrop: list.length * G.safetyPerHit, times: k + 1 };
    },
    until: uid => ghosted.get(uid) ?? 0,
    hitsOf: uid => (hits.get(uid) ?? []).length,
  };
}

// ---------- meets ----------
// a meet spot's parking places, laid out from its marker: rows of perRow, facing its heading (deg, 0 north, clockwise)
export function meetSpots(meet, cfg) {
  const M = cfg.meets, n = Math.max(1, Math.min(200, meet.spots ?? M.spots)), per = Math.max(1, meet.perRow ?? M.perRow);
  const h = (meet.heading ?? 0) * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h), rx = -fz, rz = fx;   // forward, right (x east, z south)
  const rows = Math.ceil(n / per), out = [];
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / per), col = k % per, across = (col - (Math.min(per, n - row * per) - 1) / 2) * M.spacingM, back = (row - (rows - 1) / 2) * M.rowGapM;
    // (alternate rows face each other: nose to nose across the aisle)
    out.push({ n: k + 1, x: meet.x + rx * across - fx * back, z: meet.z + rz * across - fz * back, heading: row % 2 ? (meet.heading ?? 0) + 180 : meet.heading ?? 0 });
  }
  return out;
}
export function nearestFreeSpot(spots, taken, x, z) {
  let best = null, d = Infinity;
  for (const s of spots) { if (taken.has(s.n)) continue; const e = Math.hypot(s.x - x, s.z - z); if (e < d) { d = e; best = s; } }
  return best ? { ...best, d } : null;
}
export function meetEventState(ev, now, cfg) {
  const start = Date.parse(ev.startsAt), end = start + Math.min(cfg.meets.eventMaxHours, ev.hours ?? 2) * 3600e3;
  if (now >= end) return { state: 'over', startsInSec: 0 };
  if (now >= start) return { state: 'live', startsInSec: 0, endsInSec: Math.round((end - now) / 1000) };
  const inSec = Math.round((start - now) / 1000);
  return { state: inSec <= cfg.meets.announceHours * 3600 ? 'announced' : 'later', startsInSec: inSec };
}

// ---------- coming back ----------
// saved: { region, pos: [x, y, z], heading, carId, damage, at } · regions: the baked regions' ids · roadDistance(region,
// x, z) → metres to the nearest road (null: unknown) · spawnOf(region) → { pos, heading }
export function restorePoint(saved, { regions, roadDistance = () => 0, spawnOf = () => null, cfg, now = Date.now() }) {
  const P = cfg.persistence;
  const garage = why => ({ garage: true, why, region: saved?.region && regions.includes(saved.region) ? saved.region : regions[0] ?? null, ...(spawnOf(saved?.region) ?? {}), car: saved?.carId ?? null, damage: saved?.damage ?? null });
  if (!saved || !saved.region || !Array.isArray(saved.pos)) return garage('nothing saved');
  if (saved.at && now - Date.parse(saved.at) > P.keepDays * 86400e3) return garage('too long ago');
  if (!regions.includes(saved.region)) return garage('that area isn\'t in the game any more');
  if (!saved.pos.every(Number.isFinite)) return garage('the place saved isn\'t right');
  const d = roadDistance(saved.region, saved.pos[0], saved.pos[2]);
  if (d != null && d > P.maxOffRoadM) return garage('that spot isn\'t on a road');
  return { garage: false, why: 'where you left', region: saved.region, pos: saved.pos, heading: saved.heading ?? 0, car: saved.carId ?? null, damage: saved.damage ?? null };
}

// ---------- the map ----------
// a player's place on the map, as precise as the map needs (not their exact position: mapPrecisionM)
export const mapPoint = (pos, cfg) => { const k = cfg.zones.mapPrecisionM; return [Math.round(pos[0] / k) * k, Math.round(pos[2] / k) * k]; };
// how much of another car to draw, by distance (data/roam.json seeing)
export function lodFor(d, cfg) { const S = cfg.seeing; return d <= S.fullM ? 'full' : d <= S.simpleM ? 'simple' : 'marker'; }
// a name's opacity over a car by distance (1 near, fading out to nameHideM)
export function nameOpacity(d, cfg) { const S = cfg.seeing; return d <= S.nameFullM ? 1 : d >= S.nameHideM ? 0 : 1 - (d - S.nameFullM) / (S.nameHideM - S.nameFullM); }
// the server region to use: the lowest ping, unless the friends' or party's is within preferWithinMs of it
export function pickRegion(pings, cfg, preferred = null) {
  const list = Object.entries(pings ?? {}).filter(([, ms]) => Number.isFinite(ms)).sort((a, b) => a[1] - b[1]);
  if (!list.length) return cfg.regions.list[0]?.id ?? 'local';
  const [best, bestMs] = list[0];
  if (preferred && Number.isFinite(pings[preferred]) && pings[preferred] - bestMs <= cfg.regions.preferWithinMs) return preferred;
  return best;
}
