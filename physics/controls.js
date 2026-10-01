// Driver controls: between the raw input and the car, run once per physics step. Turns pedal and
// steering inputs into pedal positions and a steering wheel angle, according to the input device:
//
//  - keyboard: keys are on/off, so the pedals move at limited rates and the steering eases toward
//    its target; the steering has less reach and moves more slowly at speed.
//  - gamepad: analog, so the pedals go straight through (deadzones and curves are applied by the
//    game's input layer) and the steering eases faster; still speed-sensitive.
//  - wheel: raw. The steering wheel angle is the input itself over its rotation range, no smoothing,
//    no assists — you feel the car through force feedback instead.
//
// Keyboard / gamepad steering assists (each can be switched off):
//  - countersteer: in a slide, the wheels are allowed (and, with no input, left) to point where the
//    car is going, i.e. toward zero front slip angle, where the self-aligning torque pulls them.
//  - steering: the front wheels stay near their peak-grip slip angle, so full lock neither ploughs on
//    nor yanks the car round.
//  - drift: once the rear is properly sliding, the keys steer relative to the slide (hands off holds
//    a gentle drift, into the turn tightens it, out of it catches it).
//
// car: { speed (m/s forward), align (rad: where the front wheels would roll along the way the front
// of the car is going), rearDir (rad: direction of travel of the rear axle vs the heading),
// angleRate (how fast the rear slide grows, rad/s), centre (rad: where the steering settles hands off —
// 0, or off-centre with damaged front toe: physics/mechanical.js) } — worked out by the vehicle.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class Controls {
  constructor(spec, peakSlipAngle) {
    this.spec = spec;
    this.retune(peakSlipAngle);
    this.reset();
  }

  // (again when the spec is edited)
  retune(peakSlipAngle) {
    const St = this.spec.steering;
    this.peakSlipAngle = peakSlipAngle;
    this.maxWheel = St.maxWheelRotation / 2 * Math.PI / 180;   // steering wheel lock (rad)
    this.maxRoad = this.maxWheel / St.ratio;                  // front wheel lock (rad)
  }

  reset() {
    this.throttle = 0;
    this.brake = 0;
    this.road = 0;           // front wheel angle (rad, + = left)
    this.driftMemory = 0;
  }

  get steeringWheel() { return this.road * this.spec.steering.ratio; }

  // aids: { countersteer, steering, drift } (booleans). Returns { throttle, brake, road, drifting }.
  update(dt, input, car, aids) {
    const St = this.spec.steering, Pd = this.spec.pedals, device = input.device || 'keyboard';
    const inThrottle = clamp(input.throttle || 0, 0, 1), inBrake = clamp(input.brake || 0, 0, 1), steerIn = clamp(input.steer || 0, -1, 1);
    const moving = car.speed > St.counterSteer.minSpeed, rearAngle = Math.abs(car.rearDir);

    if (device === 'wheel') {
      this.throttle = inThrottle;
      this.brake = inBrake;
      // the device's own rotation range maps 1:1 onto the car's steering wheel
      const range = (input.wheelRange ?? St.maxWheelRotation) / 2 * Math.PI / 180;
      this.road = clamp(steerIn * range, -this.maxWheel, this.maxWheel) / St.ratio;
      return { throttle: this.throttle, brake: this.brake, road: this.road, drifting: 0 };
    }

    // pedals: keys move at limited rates (a tap is part throttle); a gamepad's triggers are analog
    if (device === 'gamepad') { this.throttle = inThrottle; this.brake = inBrake; }
    else {
      const ease = (cur, want, rise, fall) => cur + clamp(want - cur, -fall * dt, rise * dt);
      this.throttle = ease(this.throttle, inThrottle, Pd.throttleRise, Pd.throttleFall);
      this.brake = ease(this.brake, inBrake, Pd.brakeRise, Pd.brakeFall);
    }

    // steering: eases toward the input; less reach and slower movement at speed
    const v = Math.abs(car.speed), CS = St.counterSteer, max = this.maxRoad, align = car.align;
    const limit = max / (1 + v / St.falloffSpeed), speedUp = device === 'gamepad' ? St.gamepadRateScale : 1;
    // (hands off, it settles at the centre: straight ahead, or — damaged front toe — part-way off it)
    let target = steerIn ? steerIn * limit : car.centre ?? 0, rate = speedUp * (steerIn ? St.rate : St.returnRate) / (1 + v / St.rateFalloffSpeed);
    const sliding = aids.countersteer && moving ? smoothstep(CS.slideFrom, CS.slideTo, rearAngle) : 0;
    if (sliding > 0) {
      if (!steerIn) target = sliding * clamp(align, -max, max);          // wheels trail along the slide, as the self-aligning torque pulls them
      else if (Math.sign(steerIn) === Math.sign(align))                   // counter-steering: allowed as far as it takes
        target = steerIn * Math.min(max, Math.max(limit, Math.abs(align) + CS.margin));
      if (Math.sign(target - this.road) === Math.sign(align)) rate = Math.max(rate, CS.rate * sliding);
    }
    const Ad = this.spec.assists.drift;
    const drifting = aids.drift && moving ? smoothstep(Ad.from, Ad.to, rearAngle) : 0;
    if (drifting > 0 || this.driftMemory > 0) {
      // (the drift turns away from the side the rear is sliding to; as the slide shrinks the wheels
      // ease into the turn, and as it grows they ease out, which damps the swing)
      const turning = -Math.sign(car.rearDir), drift = align + turning * (Ad.hold - Ad.steerDamping * car.angleRate) + steerIn * Ad.range;
      target += (drift - target) * drifting;
      // the wheels stay quick for a moment after a drift, so the counter-steer unwinds as the rear
      // grips again instead of flicking the car into a slide the other way
      this.driftMemory = Math.max(drifting, this.driftMemory - dt / Ad.unwindTime);
      rate = Math.max(rate, CS.rate * this.driftMemory);
    }
    if (aids.steering && moving) {
      const m = this.peakSlipAngle * this.spec.assists.steering.ofPeakSlip;
      target = clamp(target, align - m, align + m);
    }
    this.road += clamp(clamp(target, -max, max) - this.road, -rate * dt, rate * dt);
    return { throttle: this.throttle, brake: this.brake, road: this.road, drifting };
  }
}
