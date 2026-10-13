// Voice chat's rules (docs/FREE_ROAM.md "Voice chat"), pure: who hears whom, and how loud. The real-time server works out
// each player's voices with these (server/src/rt/voice.ts) and checks every request against them; the game sets each
// voice's volume with voiceGain (play/voice.js). Settings: data/roam.json voice.
//
//   voiceMode(entry) → 'party' | 'near' | 'off'
//     party: in a party with party voice on — they hear their party, wherever each is, and nobody else;
//     near: otherwise, with proximity voice on — the players near them who are in proximity voice too;
//     off: neither (not in a party with proximity voice off, or in one with both off).
//   hears(me, other, { blocked, cfg }) → null | { d, party }   whether `me` hears `other` (who must have their microphone
//     on), and at what distance (null in party voice: full volume anywhere)
//   voicesFor(me, entries, { blocked, cfg }) → [{ uid, name, d, party }]   the voices `me` hears, the nearest first, at
//     most maxPeers
//   voiceGain(d, cfg) → 0..1   full within fullM, fading out to nothing at nearbyM (null: party voice, full)
//
// An entry (one a player, kept in the real-time server's presence by their home zone):
//   { uid, name, region, pos: [x, z], party: id | null, voiceParty, voiceNearby, mic: whether it's on, session, track, at }

export function voiceMode(e) {
  if (!e) return 'off';
  if (e.party && e.voiceParty !== false) return 'party';
  return e.voiceNearby !== false ? 'near' : 'off';
}

export function hears(me, o, { blocked = new Set(), cfg }) {
  if (!me || !o || o.uid === me.uid || !o.mic || !o.session || !o.track) return null;
  if (blocked.has(o.uid)) return null;
  const a = voiceMode(me), b = voiceMode(o);
  if (a === 'party' && b === 'party' && me.party === o.party) return { d: null, party: true };
  if (a === 'near' && b === 'near' && me.region === o.region && me.pos && o.pos) {
    const d = Math.hypot(me.pos[0] - o.pos[0], me.pos[1] - o.pos[1]);
    if (d <= cfg.voice.nearbyM) return { d, party: false };
  }
  return null;
}

export function voicesFor(me, entries, { blocked = new Set(), cfg }) {
  const out = [];
  for (const o of entries) { const h = hears(me, o, { blocked, cfg }); if (h) out.push({ uid: o.uid, name: o.name, d: h.d, party: h.party }); }
  return out.sort((x, y) => (x.d ?? -1) - (y.d ?? -1)).slice(0, cfg.voice.maxPeers);
}

export function voiceGain(d, cfg) {
  const V = cfg.voice;
  if (d == null || d <= V.fullM) return 1;
  if (d >= V.nearbyM) return 0;
  const t = (d - V.fullM) / (V.nearbyM - V.fullM);
  // (smooth: gently at first, then away to nothing)
  return Math.round((1 - t * t * (3 - 2 * t)) * 1000) / 1000;
}
