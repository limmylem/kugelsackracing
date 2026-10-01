// Test cars for the drive-layout tests (physics/testSuite.js): simple specs made from a base car's (the
// car being tested) with its drivetrain swapped, so each test compares like with like. Nothing here is
// for sale: real cars get these layouts from their car.json and parts.
//
//   fwd, fwdLsd   front-wheel drive, a warmer engine (a hot hatch), an open / limited-slip front diff,
//                 and the torque steer a front-driver's unequal drive shafts give it
//   rwdPower      rear-wheel drive with a strong engine, an open diff
//   awdPower      the same engine through all four wheels: a viscous centre diff, 40% to the front
//   fourWd        part-time 4WD: a two-speed transfer case (2H / 4H / 4L, 2.72:1 low range) and
//                 selectable lockers front and rear
//
// The engine is the base car's, scaled so its peak torque in first gear pushes as hard, for the car's
// weight and tyres, as the starter car's test cars do (× 0.83 of what the tyres can take for the FWD
// cars, × 1.04 for the strong ones, × 0.52 for the 4WD: the starter car's 158 N·m × 1.6, × 2, × 1):
// a test compares drivetrains, not engines, and a supercar's test cars spin their wheels too.
//
// ownLayout(spec, id): the car itself when it already has that test car's layout (a FWD car's own torque
// steer, an AWD car's own launch, a 4WD's own low range) — the test is then about the car.

const clone = x => JSON.parse(JSON.stringify(x));
const OPEN = { type: 'open', preload: 0, lock: 0 };
// (the engine torque that pushes in first gear with the force the tyres can take: μ m g)
const grip = S => S.tyre.longitudinal.D * S.mass * 9.81 * S.wheels.radius / (S.gearbox.ratios[0] * S.gearbox.finalDrive * S.drivetrain.efficiency);
// (the engine scaled so its peak is `share` of that, with a clutch to hold it)
function strength(S, share) {
  const peak = share * grip(S), most = Math.max(...S.engine.torqueCurve.map(p => p[1])), k = peak / most;
  if (k === 1) return;
  S.engine.torqueCurve = S.engine.torqueCurve.map(([rpm, t]) => [rpm, t * k]);
  S.clutch.maxTorque = Math.max(S.clutch.maxTorque, peak * 1.1 * 1.35);
  delete S.engine.turbo; delete S.turbo;
}
// (just the rear axle driven)
const rwd = S => { S.drivetrain.layout = 'RWD'; delete S.frontDifferential; delete S.centreDifferential; delete S.transferCase; };
const fwd = S => { rwd(S); S.drivetrain.layout = 'FWD'; S.drivetrain.torqueSteer = 0.006; strength(S, 0.83); };

export const TEST_CARS = {
  fwd: { name: 'FWD test car, open diff', layout: 'FWD', make: S => { fwd(S); S.differential = { ...OPEN }; }, own: S => { S.differential = { ...OPEN }; } },
  fwdLsd: { name: 'FWD test car, limited-slip diff', layout: 'FWD', make: S => { fwd(S); S.differential = { type: 'lsd', preload: 40, lock: 0.35 }; }, own: S => { S.differential = { type: 'lsd', preload: 40, lock: 0.35 }; } },
  rwdPower: { name: 'RWD test car (strong engine)', layout: 'AWD', make: S => { rwd(S); strength(S, 1.04); S.differential = { ...OPEN }; }, own: S => { if (S.drivetrain.layout === '4WD') S.transferCase.mode = '2H'; else rwd(S); } },
  awdPower: { name: 'AWD test car (strong engine)', layout: 'AWD', make: S => { rwd(S); strength(S, 1.04); S.drivetrain.layout = 'AWD'; S.differential = { ...OPEN }; S.frontDifferential = { ...OPEN }; S.centreDifferential = { type: 'viscous', split: 0.4, viscous: 60 }; }, own: S => { if (S.drivetrain.layout === '4WD') S.transferCase.mode = '4H'; } },
  fourWd: { name: '4WD test car', layout: '4WD', make: S => { rwd(S); strength(S, 0.52); S.drivetrain.layout = '4WD'; S.differential = { ...OPEN, lockable: true }; S.frontDifferential = { ...OPEN, lockable: true }; S.transferCase = { lowRatio: 2.72, modes: ['2H', '4H', '4L'], mode: '2H', shiftBelow: 2 }; },
    own: () => {} },         // (a 4WD's own: its diffs as they are — the locks it has)
};

// Whether a car tests a layout with itself: a FWD car its torque steer, an AWD or 4WD car its launch, a
// 4WD its low range and diff locks
export function ownLayout(spec, id) {
  const T = TEST_CARS[id], L = spec.drivetrain?.layout;
  return !!T && (T.layout === L || (T.layout === 'AWD' && L === '4WD'));
}

// A test car's spec, from a base spec (not changed): the car itself (with the test's diff) when it
// has the layout already, else the base with its drivetrain swapped
export function testCar(base, id) {
  const T = TEST_CARS[id];
  if (!T) throw new Error(`no test car "${id}": ${Object.keys(TEST_CARS).join(', ')}`);
  const S = clone(base);
  if (ownLayout(base, id)) { T.own(S); S.name = `${base.name} (${id})`; }
  else { T.make(S); S.name = T.name; }
  delete S.damage;          // (as new)
  return S;
}
