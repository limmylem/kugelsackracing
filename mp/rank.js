// A player's skill as players see it (Phase 7 Step 2; docs/MULTIPLAYER.md "Skill rating"): a tier, never the
// number. The rating itself is OpenSkill's (the server's mp/rating: mu and sigma); its ordinal (mu − 3·sigma, the
// rating the system is fairly sure the player is at least) picks the tier (data/multiplayer.json rank.tiers), and a
// player is Unranked until they've raced rank.placementRaces races.
//
//   ordinalOf({ mu, sigma }) → mu − 3·sigma
//   tierOf(rating, cfg.rank) → { id, name, division }    rating: { mu, sigma, races }  (division: I–III within the tier)
//   tierChange(before, after, cfg.rank) → { from, to, up, down }   (the results screen: "Silver II → Gold III")

export const START = { mu: 25, sigma: 25 / 3 };
export const ordinalOf = r => (r?.mu ?? START.mu) - 3 * (r?.sigma ?? START.sigma);

export function tierOf(rating, rank) {
  if ((rating?.races ?? 0) < rank.placementRaces) return { id: 'unranked', name: 'Unranked', division: null, placement: rank.placementRaces - (rating?.races ?? 0) };
  const o = ordinalOf(rating), tiers = rank.tiers;
  let i = 0;
  while (i + 1 < tiers.length && o >= tiers[i + 1].from) i++;
  const t = tiers[i], next = tiers[i + 1];
  // (three divisions within a tier: III at its bottom, I just below the next — the top tier has none)
  let division = null;
  if (next) {
    const lo = Math.max(t.from, next.from - 6), share = Math.max(0, Math.min(0.999, (o - lo) / (next.from - lo)));
    division = ['III', 'II', 'I'][Math.floor(share * 3)];
  }
  return { id: t.id, name: t.name, division };
}

export const tierLabel = t => t ? `${t.name}${t.division ? ` ${t.division}` : ''}` : '';

export function tierChange(before, after, rank) {
  const a = tierOf(before, rank), b = tierOf(after, rank), ids = rank.tiers.map(t => t.id), D = ['III', 'II', 'I'];
  const score = t => t.id === 'unranked' ? -1 : ids.indexOf(t.id) * 3 + (t.division ? D.indexOf(t.division) : 2);
  return { from: a, to: b, up: score(b) > score(a), down: score(b) < score(a), ordinalDelta: ordinalOf(after) - ordinalOf(before) };
}
