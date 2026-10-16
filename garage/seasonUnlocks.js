// The ROADBOOK's season-shop unlocks in the garage and on the profile card (docs/ROADBOOK.md): which finishes a player
// may pick — data/finishes.json's locked ones only by owners of a shop item that grants them (the server refuses anyone
// else) — and the badges their items give. Pure: R is roadbook/client.js's store (view, owns, lockedBy), or anything
// shaped like it; with no ROADBOOK (no server, nobody signed in: R.view null) nothing locked is shown at all.
//
//   finishLock(finishes, id, R)   → null (anyone may use it) | { hidden: true } (no ROADBOOK) | { owned, item, season }
//                                   (item: the shop item that unlocks it { id, name, price, season }, or null if unknown)
//   seasonFinishes(finishes, R, { paint })  → [{ id, name, owned, item, season }] the locked finishes to show: paint
//                                   finishes (paint: true) or part finishes (paint: false); none with no ROADBOOK
//   badgesOf(R)                   → [{ id, name, season }] the badges the player's items give (as the server's profile)
//   seasonName(id, R)             → the season's name ('after_hours' → 'After Hours')

const words = id => String(id ?? '').split(/[_-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
export const seasonName = (id, R = null) => R?.view?.season?.id === id && R.view.season.name ? R.view.season.name : words(id);

export function finishLock(finishes, id, R = null) {
  if (!finishes?.[id]?.locked) return null;
  if (!R?.view) return { hidden: true };
  const item = R.lockedBy?.('finishes', id) ?? null;
  return { owned: !!R.owns?.('finishes', id), item, season: item ? seasonName(item.season, R) : null };
}

export function seasonFinishes(finishes, R = null, { paint = true } = {}) {
  if (!R?.view) return [];
  return Object.entries(finishes ?? {}).filter(([, f]) => f.locked && !!f.paint === paint)
    .map(([id, f]) => ({ id, name: f.name ?? words(id), ...finishLock(finishes, id, R) }));
}

export function badgesOf(R = null) {
  const ids = R?.view?.owned?.unlocks?.badges ?? [];
  return ids.map(id => { const it = R.lockedBy?.('badges', id); return { id, name: it?.name ?? words(id), season: it?.season ?? null }; });
}
