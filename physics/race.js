// Driving sessions: a test drive or a race (data/sessions.json kinds), and what they decide — whether
// cars hit each other and how much of it they take (physics/carCollisions.js), whether a big crash is
// replayed, what going back on the road puts back on, whether the development reset (everything
// repaired, free) is allowed, and towing to the garage. Pure: the test worlds keep one, and a race
// server would decide the same way.
//
//   createSession(rules, kind, overrides) → { kind, name, collisions, replay, restore, reset, tow, … }
//   session.scale(impact) → the share of an impact's damage a car takes (reduced from other cars)
//   session.allows(action) → { ok, why } for 'restore' | 'tow' | 'reset'

import { MODES, carHitScale } from './carCollisions.js';

export function createSession(rules, kind = 'test', overrides = {}) {
  const K = rules.kinds[kind];
  if (!K) throw new Error(`no session "${kind}": ${Object.keys(rules.kinds).join(', ')}`);
  const s = { kind, name: K.name, collisions: K.collisions, replay: K.replay, restore: K.restore, reset: K.reset, tow: K.tow, ...overrides };
  if (!MODES.includes(s.collisions)) throw new Error(`no collision mode "${s.collisions}": ${MODES.join(', ')}`);
  return {
    ...s,
    race: kind === 'race',
    scale: impact => carHitScale(impact, s.collisions, rules.collisions),
    allows(action) {
      if (action === 'restore' && !s.restore) return { ok: false, why: `No free repairs in a ${K.name.toLowerCase()}: tow it to the garage.` };
      if (action === 'tow' && !s.tow) return { ok: false, why: `There's no tow in a ${K.name.toLowerCase()}.` };
      return { ok: true, why: null };
    },
    describe() { return `${K.name} · cars ${s.collisions === 'off' ? 'pass through each other' : s.collisions === 'reduced' ? `hit each other for ${Math.round(rules.collisions.reduced * 100)}% of the damage` : 'hit each other'} · back on the road: ${s.reset === 'wheels' ? 'damage stays' : 'parts back on'}`; },
  };
}
export { MODES };
