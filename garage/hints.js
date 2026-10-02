// First-time hints (data/hints.json): short tips shown the first time something happens — the car's
// first damage ("Your car is damaged. Visit the garage to repair it."), a part hanging off, the garage's
// damage report — and never again: the hints seen are kept in the player's save (PlayerService
// markHint), so a server can keep them too. Pure: the test worlds and the garage show them.
//
//   const hints = new Hints(db.hints, { seen: () => profile.hints, mark: id => service.markHint(id) })
//   hints.note('damage', 'drive') → the hint to show now (marked seen), or null
//   what happened, from the game: damageEvents(result, session) → ['damage', 'mechanical', 'loose', …]

export class Hints {
  // config: data/hints.json; seen(): the ids seen (the save's); mark(id): keep one as seen
  constructor(config, { seen = () => [], mark = () => {} } = {}) {
    this.list = config?.hints ?? []; this.seen = seen; this.mark = mark;
    this.shown = new Set();                     // (this visit: not twice, even before the save has it)
  }
  // Something happened (when) somewhere (where): its hint, if it hasn't been seen — marked seen
  note(when, where) {
    const seen = new Set([...(this.seen() ?? []), ...this.shown]);
    const h = this.list.find(x => x.when === when && x.where === where && !seen.has(x.id));
    if (!h) return null;
    this.shown.add(h.id);
    this.mark(h.id);
    return h;
  }
  // every hint not seen yet
  get left() { const seen = new Set([...(this.seen() ?? []), ...this.shown]); return this.list.filter(h => !seen.has(h.id)); }
}

// What a crash did, as hint events: a result from garage/carDamage.js crashOutcome (via the session),
// mode: the damage setting
export function crashEvents(result, mode = 'full') {
  if (mode === 'off' || !result) return [];
  const out = [];
  if (result.dents?.length || result.losses?.length || result.broken?.length) out.push('damage');
  if (Object.keys(result.mechanical?.damage ?? {}).length) out.push('mechanical');
  if (result.attach?.some(c => c.to !== 'attached')) out.push('loose');
  return out;
}
