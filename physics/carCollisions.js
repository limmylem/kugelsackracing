// Cars hitting cars, fairly. Pure (no Rapier objects): the impact sensor (physics/impacts.js), the
// game's sessions (physics/race.js) and the crash test suite share it.
//
// How hard a hit is, for the car it happened to: the change in its velocity. Into a wall (or anything
// fixed) that's how fast it was going into it; into another car, both cars change velocity by the same
// push, each by the push over its own mass — so a car hit by one just as heavy feels half the speed they
// closed at (two equal cars meeting head on at 50 km/h each: like each hitting a wall at 50), a heavy
// car hitting a light one feels little and the light one a lot. Only the speed along the contact counts
// (a glancing blow less than a square one), and the sensor's push says whether they really stopped each
// other (a cone just moves out of the way):
//   impactStrength({ closing, impulse, mass, otherMass }) → m/s
//
// Collision modes for a race or session (data/sessions.json):
//   full     cars hit each other and take all of it
//   reduced  cars hit each other, but take only `reduced` of the damage from another car (walls, as ever)
//   off      cars pass through each other (ghosting): no hits between cars at all
// collisionGroups(mode): the car body's Rapier collision groups for the mode; carHitScale(impact, mode,
// rules): the share of a hit's damage a car takes.

export const MODES = ['full', 'reduced', 'off'];
// collision groups (membership << 16 | filter): what a car body is, and what it hits
export const CAR = 0x0002, DEBRIS = 0x0004;
const ALL = 0xffff;

// A hit's strength for the car it happened to (m/s): closing speed along the contact, at most the change
// in its velocity the push gave it (impulse ÷ its mass); otherMass: the other body's (none: something
// fixed, as heavy as anything)
export function impactStrength({ closing, impulse, mass, otherMass = Infinity }) {
  if (!(closing > 0) || !(mass > 0)) return 0;
  const share = Number.isFinite(otherMass) ? otherMass / (mass + otherMass) : 1;
  return Math.min(closing * share, Math.max(0, impulse) / mass);
}
// The share of the closing speed each of two cars feels (a: the first, by mass): { a, b }
export const shares = (massA, massB) => ({ a: massB / (massA + massB), b: massA / (massA + massB) });

// The car body's collision groups in a collision mode (ghosting: it doesn't touch other cars)
export const collisionGroups = mode => (CAR << 16) | (mode === 'off' ? ALL & ~CAR : ALL);

// The share of an impact's damage a car takes in a collision mode: all of it from anything but a car;
// from a car, by the mode (rules: data/sessions.json collisions)
export function carHitScale(impact, mode = 'full', rules = {}) {
  if (impact?.other !== 'car') return 1;
  if (mode === 'off') return 0;
  return mode === 'reduced' ? rules.reduced ?? 0.5 : 1;
}
