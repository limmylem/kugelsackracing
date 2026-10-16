// Static camber's grip (physics/vehicle.js each step; not the rating: a setup, garage/rating.js): a tyre grips best sideways
// leaning in a little against the road (best, ° — negative: its top in), less the further it is from that (curve a
// degree², at least floor). As the body rolls in a corner each wheel leans with it (rollFollow of the roll: the
// outside one out, the inside one in), so the loaded outside tyre leans the wrong way and a little negative camber
// gives it back grip. Grip is worked out against the same wheel with no static camber, so a car without a camber kit
// grips exactly as before: sideways (lat) and, standing less flat on the road, braking and accelerating (long:
// longPerDeg less a degree either way).

export const CAMBER = { best: -2, curve: 0.004, floor: 0.75, rollFollow: 0.7, longPerDeg: 0.006 };

const lean = g => Math.max(CAMBER.floor, 1 - CAMBER.curve * (g - CAMBER.best) ** 2);

// A wheel with static camber g0 (°) leaning a further `roll` (°, + out) with the body: { lat, long } grip, × the same
// wheel's with none
export function camberGrip(g0, roll = 0) {
  const rolled = CAMBER.rollFollow * roll;
  return { lat: lean(g0 + rolled) / lean(rolled), long: 1 - CAMBER.longPerDeg * Math.abs(g0) };
}
