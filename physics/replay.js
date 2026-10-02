// The crash replay: the last few seconds of every car's state kept as the game runs, and after a big
// crash a short stretch of it played back slowly from a cinematic angle. Pure (no drawing): the test
// worlds record each drawn frame's snapshot and draw the replay's frames as they would the live ones.
//
// ReplayRecorder({ record, rate }): record(time, snapshot) keeps a frame at most `rate` times a second,
// the last `record` seconds of them — each car (yours: id 0, and the others) as the drawing needs it
// (position, rotation, each wheel's travel, steer, spin, size and bend, the loose parts' poses, the
// brake lights, the steering wheel), and the pieces torn off. window(at, before, after) → the frames
// from `before` s ahead of a moment to `after` s past it.
// ReplayPlayer(frames, { speed, at, focus }): step(dt) moves it on at speed × real time → { a, b, alpha
// (two frames and how far between them), t, done }; skip() ends it at once. camera(t) → a slow pan
// round the crash: { position, target } in the world (focus: where it happened).

const pick = s => ({
  id: s.id ?? 0, position: [...s.position], rotation: { ...s.rotation }, brakeLights: !!s.brakeLights,
  steering: { wheelAngle: s.steering?.wheelAngle ?? 0 },
  wheels: (s.wheels ?? []).map(w => ({ name: w.name, length: w.length, steerAngle: w.steerAngle, spin: w.spin, radius: w.radius, bend: w.bend, off: !!w.off })),
  ...(s.looseParts?.length && { looseParts: s.looseParts.map(p => ({ socket: p.socket, position: [...p.position], rotation: { ...p.rotation } })) }),
});

export class ReplayRecorder {
  constructor({ record = 6, rate = 30 } = {}) { this.seconds = record; this.rate = rate; this.frames = []; this.last = -Infinity; }
  clear() { this.frames = []; this.last = -Infinity; }
  // time: the simulation's (s); snapshot: the simulation's (with others and debris)
  record(time, snapshot) {
    if (time - this.last < 1 / this.rate - 1e-6 && time >= this.last) return false;
    if (time < this.last) this.clear();                     // (the simulation started again)
    this.last = time;
    this.frames.push({ t: time, cars: [pick(snapshot), ...(snapshot.others ?? []).map(pick)], debris: (snapshot.debris ?? []).map(d => ({ id: d.id, position: [...d.position], rotation: { ...d.rotation } })) });
    while (this.frames.length && this.frames[0].t < time - this.seconds) this.frames.shift();
    return true;
  }
  window(at, before, after) { return this.frames.filter(f => f.t >= at - before - 1e-9 && f.t <= at + after + 1e-9); }
  // (how much it holds, roughly: what a replay costs to keep)
  get bytes() { return JSON.stringify(this.frames).length; }
}

export class ReplayPlayer {
  // frames: a recorder's window; speed: of real time (0.3: slow motion); at: the moment of the crash;
  // focus: where (world)
  constructor(frames, { speed = 0.3, at = frames[0]?.t ?? 0, focus = frames[0]?.cars[0].position ?? [0, 0, 0] } = {}) {
    this.frames = frames; this.speed = speed; this.at = at; this.focus = [...focus];
    this.t = frames[0]?.t ?? 0; this.end = frames.at(-1)?.t ?? 0; this.done = frames.length < 2;
    this.i = 0;
    // (the angle: from the side the car came from, low down, a little ahead of the crash)
    const f0 = frames[0]?.cars[0], f1 = frames.find(f => f.t >= at)?.cars[0] ?? f0, d = f0 && f1 ? [f1.position[0] - f0.position[0], f1.position[2] - f0.position[2]] : [0, 1], l = Math.hypot(...d) || 1;
    this.heading = Math.atan2(d[0] / l, d[1] / l);
  }
  // On by dt of real time: the two frames to draw between, and how far between them
  step(dt) {
    if (this.done) return { a: this.frames.at(-1), b: this.frames.at(-1), alpha: 1, t: this.end, done: true };
    this.t = Math.min(this.end, this.t + dt * this.speed);
    while (this.i < this.frames.length - 2 && this.frames[this.i + 1].t <= this.t) this.i++;
    const a = this.frames[this.i], b = this.frames[this.i + 1] ?? a, alpha = b.t > a.t ? Math.min(1, Math.max(0, (this.t - a.t) / (b.t - a.t))) : 1;
    if (this.t >= this.end) this.done = true;
    return { a, b, alpha, t: this.t, done: this.done };
  }
  skip() { this.done = true; this.t = this.end; }
  // whether the crash has happened yet, in the replay (the damage drawn before and after it)
  get afterCrash() { return this.t >= this.at; }
  // The camera at replay time t: low, to the side of the car's path, panning slowly round the crash
  camera(t = this.t) {
    const k = (t - (this.frames[0]?.t ?? 0)) / Math.max(1e-3, this.end - (this.frames[0]?.t ?? 0)), a = this.heading + Math.PI * 0.42 + k * 0.6, r = 7.5 - 1.5 * k;
    return { position: [this.focus[0] + Math.sin(a) * r, this.focus[1] + 1.1 + 0.6 * k, this.focus[2] + Math.cos(a) * r], target: [this.focus[0], this.focus[1] + 0.6, this.focus[2]] };
  }
}
