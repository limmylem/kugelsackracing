// The visual effects of driving, crashes and damage (data/effects.json): what each car's doing turned into
// particles (effects/particles.js) and marks on the road (effects/marks.js), for a renderer to draw.
//
// Two ways in, so the same effects can play for other players' cars later (multiplayer):
//  - events, for what happens once: impact, break (glass / a light), scrapeStart / scrapeUpdate /
//    scrapeStop (metal sliding on something: sparks while it lasts), partOff (a part torn off), engineBlow,
//    burst (an effect on demand: the debug panel). play(event) shows one; for the player's own car,
//    sense(id, snapshot) works out the scrape events from its snapshot, and the game sends the rest
//    (impactEvent(), breakEvents()). onEvent(fn) hears every event that starts here (to send on).
//  - each car's snapshot every frame (updateCar): what lasts — tyre smoke and skid marks from slipping
//    wheels, dirt spray, dust and grass off loose surfaces (the surfaces' effects settings), steam from a
//    leaking radiator or a hot engine, grey smoke from a damaged engine and the trail of a blown one,
//    drips from a leaking car. A remote car's snapshot has all of that too.
//
// Effects are visual, so they play whatever the damage setting; engine smoke and fire follow the engine's
// own state (its condition, blown or not), steam the cooling's. Positions are in the simulation's frame
// (y up); a car's points (where it was hit, its engine bay) are in its own frame and placed by its pose.
// Every effect plays less the further it is from the viewer (setViewer) and with the quality setting.

import { ParticleSystem, rgb } from './particles.js';
import { MarkLayer } from './marks.js';
import { rotate } from '../physics/math.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
// what sparks off metal: hard things (a wall, a barrier, the road, another car); not wood or plastic
export const HARD = new Set(['concrete', 'metal', 'ground', 'car', 'tarmac', 'asphalt']);
// a car's own engine bay when it doesn't say (front-engined, car frame)
const ENGINE_BAY = [0, 0.75, 1.25];

export class EffectsDirector {
  // cfg: data/effects.json; surfaces: { name: { marks, effects: { spray, dust, clippings, smoke } } };
  // markLift: how far above the ground marks lie (m: a world whose roads are drawn above their surface)
  constructor(cfg, { level = cfg.default, surfaces = {}, random = Math.random, markLift = 0.012 } = {}) {
    this.cfg = cfg;
    this.markLift = markLift;
    this.random = random;
    this.particles = new ParticleSystem(cfg, level, { random });
    this.marks = new MarkLayer(cfg.budget.marks);
    this.cars = new Map();
    this.scrapes = new Map();          // `${car}:${key}` → an active scrape (sparks while it lasts)
    this.timed = [];                   // bursts spread over time (a flame, a blown engine's trail)
    this.listeners = new Set();
    this.lights = [];                  // small flickering lights where sparks fly (high quality)
    this.wind = [0, 0, 0];
    this.time = 0;
    this.stats = { events: 0, ms: 0 };
    this.setSurfaces(surfaces);
    this.setQuality(level);
  }

  get level() { return this.particles.level; }
  setQuality(level) {
    this.particles.setQuality(level);
    this.marks.setLimit(this.cfg.budget.marks * this.particles.Q.marks);
  }
  setSurfaces(surfaces) { this.surfaces = Object.fromEntries(Object.entries(surfaces ?? {}).map(([k, v]) => [k, { ...v, marksRgb: v.marks ? rgb(v.marks) : null }])); }
  setViewer(p) { this.particles.setViewer(p); }
  setWind(w) { this.wind = w ? [w[0], w[1], w[2]] : [0, 0, 0]; }
  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // A car: info { anchors: { engine: [x, y, z] (car frame) }, smoke (tyre smoke "#rrggbb"), cooling: { warn,
  // limp } (°C), materialAt(point) → 'metal' | 'plastic' | …: what the car's made of there (car frame),
  // colourAt(point | socket) → "#rrggbb": the colour of the part there (its paint, or its finish),
  // pieceMaterial(key) → the material of a part torn off (its socket) }
  setCar(id, info = {}) {
    const c = this.cars.get(id) ?? { id, carry: {}, skid: {}, drip: { dist: 0, time: 0 }, blown: false, last: null };
    c.info = info;
    this.cars.set(id, c);
    return c;
  }
  dropCar(id) {
    this.cars.delete(id);
    for (const k of [...this.scrapes.keys()]) if (k.startsWith(`${id}:`)) this.scrapes.delete(k);
  }

  // ---------- events ----------

  play(e) {
    this.stats.events++;
    if (!e.remote) for (const fn of this.listeners) fn(e);
    const c = this.cars.get(e.car);
    switch (e.type) {
      case 'impact': return this.#impact(c, e);
      case 'break': return this.#break(c, e);
      case 'scrapeStart': case 'scrapeUpdate': {
        const k = `${e.car}:${e.key}`, s = this.scrapes.get(k) ?? { carry: 0 };
        this.scrapes.set(k, Object.assign(s, e, { carry: s.carry }));
        return;
      }
      case 'scrapeStop': this.scrapes.delete(`${e.car}:${e.key}`); return;
      case 'partOff': return this.#partOff(c, e);
      case 'engineBlow': return this.#blow(c);
      case 'burst': return this.#burst(e);
    }
  }

  // ---------- each car's state, every frame ----------

  // A car's snapshot (physics/vehicle.js: position, rotation, velocity, wheels, mechanical, engine) this frame
  updateCar(id, s, dt) {
    const c = this.cars.get(id) ?? this.setCar(id);
    c.last = s;
    c.q = s.rotation; c.pos = s.position; c.vel = s.velocity ?? [0, 0, 0];
    c.fwd = rotate(c.q, [0, 0, 1]); c.right = rotate(c.q, [-1, 0, 0]);
    const grounded = s.wheels?.filter(w => w.grounded && w.contact) ?? [];
    c.floor = grounded.length ? grounded.reduce((m, w) => Math.min(m, w.contact[1]), Infinity) : (c.floor ?? s.position[1] - 0.5);
    if (!dt) return;
    const speed = Math.hypot(c.vel[0], c.vel[2]);
    for (const w of s.wheels ?? []) this.#wheel(c, w, speed, dt);
    this.#engineBay(c, s, speed, dt);
    this.#drips(c, s, speed, dt);
  }

  // The player's car: the scrapes in its snapshot (sliding along a wall, a loose part dragging, a flat
  // tyre's rim, the floor pan on the road, its torn-off metal parts sliding), as start / update / stop
  // events. Returns them (they're played too)
  sense(id, s) {
    const c = this.cars.get(id) ?? this.setCar(id), info = c.info, now = new Map();
    const metal = m => m === 'metal' || m === 'titanium';
    const sc = s.scrape;
    if (sc && sc.point) {
      const part = sc.under ? 'metal' : info.materialAt?.(sc.point) ?? 'metal';
      if (metal(part) && HARD.has(sc.material)) now.set(sc.under ? 'under' : 'body', { point: sc.point, normal: sc.normal ?? null, amount: sc.amount, speed: sc.speed });
    }
    const ps = s.partScrape;
    if (ps && ps.position && metal(info.materialAt?.(null, ps.socket) ?? 'metal') && HARD.has(ps.material)) now.set('drag', { position: ps.position, amount: ps.amount, speed: ps.speed });
    const rim = s.mechanical?.rimScrape, rw = rim && s.wheels?.find(w => w.name === rim.wheel);
    if (rw && (rw.contact || rw.origin)) now.set(`rim_${rim.wheel}`, { position: rw.contact ?? [rw.origin[0], rw.origin[1] - (rw.radius ?? 0.3), rw.origin[2]], amount: rim.amount, speed: rim.speed });
    for (const d of s.debris ?? []) if (d.owner === id && d.sliding && metal(info.pieceMaterial?.(d.key) ?? 'plastic')) now.set(`piece_${d.id}`, { position: d.contact ?? d.position, amount: clamp(d.sliding / 15, 0.2, 1), speed: d.sliding });
    const events = [];
    for (const [key, x] of now) events.push({ type: this.scrapes.has(`${id}:${key}`) ? 'scrapeUpdate' : 'scrapeStart', car: id, key, ...x });
    for (const k of this.scrapes.keys()) { const [car, key] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]; if (String(car) === String(id) && !now.has(key)) events.push({ type: 'scrapeStop', car: id, key }); }
    for (const e of events) this.play(e);
    return events;
  }

  // An impact (physics/impacts.js, with what garage/damage.js made of it) as an event: car-frame point and
  // normal, how hard, what it hit; part: the socket hit (or null: the body), surface: the ground under the car
  impactEvent(car, impact, result = null, surface = null) {
    return { type: 'impact', car, point: result?.point ?? impact.point, normal: impact.normal, strength: result?.strength ?? impact.strength, material: impact.material, under: !!impact.under, part: result?.hit?.target ?? null, surface };
  }
  // The glass and lights a hit broke (new since before it): node names and where they are (car frame boxes)
  breakEvents(car, broken, before, boxes = {}) {
    return broken.filter(b => !before.has(b)).map(b => { const box = boxes[b]; return { type: 'break', car, kind: /glass/.test(b) ? 'glass' : 'light', node: b, point: box ? [0, 1, 2].map(k => (box.min[k] + box.max[k]) / 2) : [0, 0.8, 0] }; });
  }

  // ---------- move it all on ----------

  update(dt) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.time += dt;
    this.lights.length = 0;
    for (const t of [...this.timed]) {
      t.left -= dt;
      t.step(dt, t);
      if (t.left <= 0) this.timed.splice(this.timed.indexOf(t), 1);
    }
    for (const [k, sc] of this.scrapes) this.#sparksFrom(sc, dt);
    this.lights.sort((a, b) => b.intensity - a.intensity);
    this.lights.length = Math.min(this.lights.length, this.particles.Q.lights);
    this.particles.update(dt, this.wind);
    this.marks.update(dt);
    if (t0) this.stats.ms += ((performance.now() - t0) - this.stats.ms) * 0.1;
  }

  shift(q, t) {
    this.particles.shift(q, t);
    this.marks.shift(q, t);
    for (const c of this.cars.values()) for (const k of Object.keys(c.skid)) c.skid[k] = null;
  }
  clear() { this.particles.clear(); this.marks.clear(); this.scrapes.clear(); this.timed.length = 0; }
  // A car put right (repaired, reset): its lingering effects stop (a blown engine's trail, its sparks)
  resetCar(id) {
    this.timed = this.timed.filter(t => t.car !== id);
    for (const k of [...this.scrapes.keys()]) if (k.startsWith(`${id}:`)) this.scrapes.delete(k);
    const c = this.cars.get(id);
    if (c) { c.blown = false; c.blownAt = null; }
  }

  // ---------- the effects ----------

  #e(name) { return this.particles.byName[name]; }
  #toWorld(c, p) { return add(c.pos, rotate(c.q, p)); }
  #jitter(r) { return [(this.random() - 0.5) * 2 * r, (this.random() - 0.5) * 2 * r, (this.random() - 0.5) * 2 * r]; }
  // (n particles of an effect at p, each from make(i) → the rest of its options)
  #spawn(name, n, at, make) {
    const count = this.particles.amount(n, at);
    for (let i = 0; i < count; i++) this.particles.emit(name, make(i));
    return count;
  }

  // sparks from a scrape, by how hard (rate × its amount), flying on along the way it's going
  #sparksFrom(sc, dt) {
    const c = this.cars.get(sc.car), E = this.#e('sparks');
    if (!c?.pos) return;
    const at = sc.position ?? this.#toWorld(c, sc.point), amount = clamp(sc.amount ?? 0.5, 0, 1);
    sc.carry = (sc.carry ?? 0) + E.rate * amount * dt;
    const n = Math.floor(sc.carry);
    sc.carry -= n;
    const hot = rgb(E.hot), cool = rgb(E.cool), v = c.vel, sp = Math.hypot(...v), floor = sc.key === 'under' || sc.position ? at[1] : c.floor;
    // (off the surface it's scraping: away from it, never into it)
    const away = sc.normal ? scale(rotate(c.q, sc.normal), -1) : null;
    this.#spawn('sparks', n, at, () => {
      const k = E.speed[0] + this.random() * (E.speed[1] - E.speed[0]), j = this.#jitter(E.spread * (0.4 + 0.6 * amount));
      if (away) { const into = j[0] * away[0] + j[1] * away[1] + j[2] * away[2]; if (into < 0) for (let i = 0; i < 3; i++) j[i] -= 2 * into * away[i]; }
      return { position: add(at, away ? scale(away, 0.05) : this.#jitter(0.08)), velocity: add(add(scale(v, k), j), [0, E.up * this.random(), 0]), colour: hot, colourEnd: cool, size: 0.7 + amount * 0.8, alpha: 0.6 + 0.4 * amount, floor };
    });
    if (amount > 0.15 && sp > 2) this.lights.push({ position: at, colour: hot, intensity: amount * (0.6 + this.random() * 0.8) });
  }

  #impact(c, e) {
    if (!c?.pos) return;
    const at = this.#toWorld(c, e.point), n = rotate(c.q, e.normal ?? [0, 0, 1]), inward = scale(n, -1), s = e.strength ?? 0;
    const D = this.#e('debris'), S = this.#e('sparks'), floor = c.floor;
    // a hard landing on the floor pan: a shower of sparks
    if (e.under) {
      this.#spawn('sparks', S.landing * Math.max(1, s - 4), at, () => ({ position: add(at, this.#jitter(0.3)), velocity: add(scale(c.vel, 0.6 + 0.4 * this.random()), add(this.#jitter(S.spread * 1.4), [0, S.up * this.random(), 0])), colour: rgb(S.hot), colourEnd: rgb(S.cool), size: 1.4, floor }));
      return;
    }
    // metal on something hard: a burst of sparks
    const part = this.cars.get(e.car)?.info.materialAt?.(e.point, e.part) ?? 'metal';
    if ((part === 'metal' || part === 'titanium') && HARD.has(e.material) && s > S.debrisFrom) {
      this.#spawn('sparks', 8 + s * 4, at, () => ({ position: add(at, this.#jitter(0.15)), velocity: add(scale(c.vel, 0.5 * this.random()), add(scale(n, -2 * this.random()), this.#jitter(S.spread * 1.6))), colour: rgb(S.hot), colourEnd: rgb(S.cool), size: 1.2, floor }));
    }
    // bits of it: chips the colour of the part hit
    if (s > D.from) {
      const colour = rgb(c.info.colourAt?.(e.point, e.part) ?? '#8a8d90'), other = rgb(part === 'metal' ? '#9a9da0' : '#1c1d20');
      this.#spawn('debris', Math.min(D.max, (s - D.from) * D.perMs), at, () => ({ position: add(at, this.#jitter(0.2)), velocity: add(add(scale(c.vel, D.speed), scale(inward, 1 + 2 * this.random())), add(this.#jitter(D.spread), [0, 1.5 * this.random(), 0])), colour: this.random() < 0.7 ? colour : other, floor }));
    }
    // on loose ground: a dust cloud
    const surf = this.surfaces[e.surface]?.effects?.dust;
    if (surf) {
      const C = this.#e('crashDust'), dust = rgb(surf.colour);
      this.#spawn('crashDust', Math.min(C.max, s * C.perMs), at, () => ({ position: add([at[0], floor + 0.3, at[2]], [(this.random() - 0.5) * 2.5, this.random() * 0.4, (this.random() - 0.5) * 2.5]), velocity: add(scale(c.vel, 0.3), add(this.#jitter(C.speed), [0, 0.6 * this.random(), 0])), colour: dust, floor }));
    }
  }

  #break(c, e) {
    if (!c?.pos) return;
    const G = this.#e('glass'), at = this.#toWorld(c, e.point), out = rotate(c.q, [Math.sign(e.point[0]) * 0.6, 0.3, Math.sign(e.point[2]) * 0.6]);
    const colour = rgb(e.kind === 'light' ? G.lightColour : G.colour);
    this.#spawn('glass', e.kind === 'light' ? G.light : G.window, at, () => ({ position: add(at, this.#jitter(0.25)), velocity: add(add(scale(c.vel, 0.7 + 0.3 * this.random()), scale(out, G.speed * this.random())), this.#jitter(G.speed)), colour, floor: c.floor }));
  }

  #partOff(c, e) {
    if (!c?.pos) return;
    const D = this.#e('debris'), at = e.position ?? this.#toWorld(c, e.point ?? [0, 0.5, 0]), colour = rgb(c.info.colourAt?.(e.point ?? null, e.socket) ?? '#8a8d90');
    this.#spawn('debris', D.partOff, at, () => ({ position: add(at, this.#jitter(0.3)), velocity: add(scale(c.vel, 0.6), add(this.#jitter(D.spread), [0, 2 * this.random(), 0])), colour, floor: c.floor }));
  }

  // the engine blows: a big dark burst, a flash of flame, then a lingering trail
  #blow(c) {
    if (!c?.pos || this.time - (c.blownAt ?? -1e9) < 2) return;        // (the event and the state both say so)
    c.blownAt = this.time; c.blown = true;
    const B = this.#e('blowSmoke'), F = this.#e('flame'), dark = rgb(B.colour), anchor = c.info.anchors?.engine ?? ENGINE_BAY;
    const at = () => this.#toWorld(c, anchor);
    const p0 = at();
    this.#spawn('blowSmoke', B.burst, p0, () => ({ position: add(at(), this.#jitter(0.4)), velocity: add(c.vel, add(this.#jitter(B.burstSpeed), [0, B.burstSpeed * this.random(), 0])), colour: dark, size: 1.3, floor: c.floor }));
    let flame = 0;
    this.timed.push({ car: c.id, left: F.seconds, step: (dt) => {
      flame += F.burst * dt / F.seconds;
      const n = Math.floor(flame); flame -= n;
      this.#spawn('flame', n, p0, () => ({ position: add(at(), this.#jitter(0.25)), velocity: add(scale(c.vel, 0.9), add(this.#jitter(1.2), [0, 1.5 + 2 * this.random(), 0])), colour: rgb(F.hot), colourEnd: rgb(F.cool), floor: c.floor }));
      this.lights.push({ position: at(), colour: rgb(F.hot), intensity: 2 });
    } });
    let trail = 0;
    this.timed.push({ car: c.id, left: B.trailSeconds, step: (dt, t) => {
      trail += B.trail * (t.left / B.trailSeconds) ** 1.5 * dt;
      const n = Math.floor(trail); trail -= n;
      this.#spawn('blowSmoke', n, p0, () => ({ position: add(at(), this.#jitter(0.3)), velocity: add(scale(c.vel, 0.9), [0, 0.5 + this.random(), 0]), colour: dark, floor: c.floor }));
    } });
  }

  // An effect on demand (the debug panel): count particles at a world point (at), or on a car (car, point:
  // car frame, or 'engine': its engine bay), at once or spread over seconds (following the car);
  // effect 'marks': a curving skid mark and a few drips beside the car
  #burst({ effect, car = null, at = null, point = null, count = 40, seconds = 0, colour = null }) {
    const c = car != null ? this.cars.get(car) : null;
    if (effect === 'marks') { if (c?.pos) this.#testMarks(c); return; }
    const E = this.#e(effect);
    if (!E || (!at && !c?.pos)) return;
    const col = rgb(colour ?? E.colour ?? E.hot ?? '#cccccc'), end = E.cool ? rgb(E.cool) : col;
    const where = () => at ?? this.#toWorld(c, point === 'engine' ? c.info.anchors?.engine ?? ENGINE_BAY : point ?? [0, 0.5, 0]);
    const one = () => { const p = where(), v = c?.vel ?? [0, 0, 0]; return { position: add(p, this.#jitter(0.2)), velocity: add(scale(v, 0.8), add(this.#jitter(E.style === 'chip' ? 2 : 0.8), [0, (E.style === 'chip' ? 2.5 : 0.8) * this.random(), 0])), colour: col, colourEnd: end, floor: c ? c.floor : p[1] - 0.5 }; };
    if (!seconds) { this.#spawn(effect, count, where(), one); return; }
    let carry = 0;
    this.timed.push({ car, left: seconds, step: dt => { carry += count * dt / seconds; const n = Math.floor(carry); carry -= n; this.#spawn(effect, n, where(), one); } });
  }
  #testMarks(c) {
    const K = this.cfg.marks.skid, y = c.floor + this.markLift, side = c.right, fwd = c.fwd;
    let prev = null;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, along = -2 - t * 8, out = 2.2 + Math.sin(t * Math.PI) * 1.2;
      const p = [c.pos[0] + fwd[0] * along + side[0] * out, y, c.pos[2] + fwd[2] * along + side[2] * out];
      if (prev) {
        const dx = p[0] - prev[0], dz = p[2] - prev[2], len = Math.hypot(dx, dz) || 1, sx = -dz / len * K.halfWidth, sz = dx / len * K.halfWidth;
        this.marks.add([[prev[0] + sx, y, prev[2] + sz], [prev[0] - sx, y, prev[2] - sz], [p[0] - sx, y, p[2] - sz], [p[0] + sx, y, p[2] + sz]], rgb(K.colour), K.alpha * Math.sin(t * Math.PI), K.alpha * Math.sin(t * Math.PI), K.fade);
      }
      prev = p;
    }
    const D = this.cfg.marks.drips;
    for (let i = 0; i < 8; i++) {
      const kind = i % 2 ? D.oil : D.coolant, at = [c.pos[0] - side[0] * 2 + fwd[0] * (i * 0.9 - 3), y + 0.002, c.pos[2] - side[2] * 2 + fwd[2] * (i * 0.9 - 3)], r = 0.04 + this.random() * 0.03;
      this.marks.add([0, 1, 2, 3].map(k => [at[0] + Math.cos(k * Math.PI / 2) * r, at[1], at[2] + Math.sin(k * Math.PI / 2) * r]), rgb(kind.colour), kind.alpha, kind.alpha, kind.fade, true);
    }
  }

  // a wheel: tyre smoke and skid marks; spray, dust and grass off loose ground
  #wheel(c, w, speed, dt) {
    const key = w.name, slip = w.grounded ? w.slipSpeed ?? 0 : 0;
    const surf = this.surfaces[w.surface] ?? {}, fx = surf.effects ?? {}, carry = c.carry[key] ??= { smoke: 0, spray: 0, dust: 0, clip: 0 };
    if (!w.grounded || !w.contact || w.off) { c.skid[key] = null; return; }
    const p = w.contact, floor = p[1];
    // tyre smoke: grippy ground (loose ground throws dust instead)
    const T = this.#e('tyreSmoke');
    if (fx.smoke !== false && !fx.dust && !fx.spray && slip > T.from) {
      const strength = smoothstep(T.from, T.full, slip) * (0.65 + 0.35 * Math.min(1, speed / 20));
      carry.smoke += T.rate * strength * dt;
      const n = Math.floor(carry.smoke); carry.smoke -= n;
      const colour = rgb(c.info.smoke ?? T.colour);
      this.#spawn('tyreSmoke', n, p, () => ({ position: add(p, [(this.random() - 0.5) * 0.4, 0.12, (this.random() - 0.5) * 0.4]), velocity: add(scale(c.vel, T.carry), [(this.random() - 0.5) * 1.6, 0.3 + this.random() * 0.6, (this.random() - 0.5) * 1.6]), colour, alpha: 0.5 + 0.5 * strength, size: 0.8 + 0.4 * strength, floor }));
    } else carry.smoke = 0;
    // a skid mark: a piece every few centimetres while it slides
    this.#skid(c, w, slip, surf);
    // loose ground: spray off a spinning or sliding tyre, dust behind, grass clippings
    const throwing = smoothstep(1, 8, slip), back = scale(c.fwd, -Math.sign(w.omega ?? 1));
    if (fx.spray && throwing > 0) {
      carry.spray += fx.spray.rate * throwing * dt;
      const n = Math.floor(carry.spray); carry.spray -= n;
      const colour = rgb(fx.spray.colour);
      this.#spawn('spray', n, p, () => ({ position: add(p, [(this.random() - 0.5) * 0.3, 0.05, (this.random() - 0.5) * 0.3]), velocity: add(add(scale(c.vel, 0.5), scale(back, slip * (fx.spray.speed ?? 0.5) * this.random())), [(this.random() - 0.5) * 2, 1.5 + 2.5 * this.random(), (this.random() - 0.5) * 2]), colour, floor }));
    }
    if (fx.dust) {
      carry.dust += Math.min(60, speed * (fx.dust.perSpeed ?? 0.9) + slip * (fx.dust.perSlip ?? 5)) * dt;
      const n = Math.floor(carry.dust); carry.dust -= n;
      const colour = rgb(fx.dust.colour), strength = Math.min(1, speed / 20 + slip / 6) * (fx.dust.alpha ?? 1);
      this.#spawn('dust', n, p, () => ({ position: add(p, [(this.random() - 0.5) * 0.5, 0.15, (this.random() - 0.5) * 0.5]), velocity: [c.vel[0] * 0.25 + (this.random() - 0.5) * 1.6, 0.5 + this.random() * 1.1, c.vel[2] * 0.25 + (this.random() - 0.5) * 1.6], colour, alpha: strength, floor }));
    }
    if (fx.clippings && (throwing > 0 || speed > 8)) {
      carry.clip += fx.clippings.rate * Math.max(throwing, smoothstep(8, 30, speed) * 0.3) * dt;
      const n = Math.floor(carry.clip); carry.clip -= n;
      const colour = rgb(fx.clippings.colour);
      this.#spawn('clippings', n, p, () => ({ position: add(p, [(this.random() - 0.5) * 0.3, 0.05, (this.random() - 0.5) * 0.3]), velocity: add(add(scale(c.vel, 0.4), scale(back, slip * 0.3 * this.random())), [(this.random() - 0.5) * 2, 1 + 2 * this.random(), (this.random() - 0.5) * 2]), colour, floor }));
    }
  }

  #skid(c, w, slip, surf) {
    const K = this.cfg.marks.skid, key = w.name, strength = smoothstep(K.from, K.full, slip);
    if (strength <= 0) { c.skid[key] = null; return; }
    const p = [w.contact[0], w.contact[1] + this.markLift, w.contact[2]], prev = c.skid[key];
    const dx = prev ? p[0] - prev.p[0] : 0, dz = prev ? p[2] - prev.p[2] : 0, len = Math.hypot(dx, dz);
    if (!prev || len > 4) { c.skid[key] = { p, strength }; return; }
    if (len < K.every) return;
    const sx = -dz / len * K.halfWidth, sz = dx / len * K.halfWidth, q = prev.p;
    const colour = surf.marksRgb ?? rgb(K.colour);
    this.marks.add([[q[0] + sx, q[1], q[2] + sz], [q[0] - sx, q[1], q[2] - sz], [p[0] - sx, p[1], p[2] - sz], [p[0] + sx, p[1], p[2] + sz]], colour, prev.strength * K.alpha, strength * K.alpha, K.fade);
    c.skid[key] = { p, strength };
  }

  // the engine bay: steam (a leaking radiator, a hot engine), grey smoke (a damaged engine), a blown one's wisp
  #engineBay(c, s, speed, dt) {
    const m = s.mechanical, h = s.engine?.health, anchor = c.info.anchors?.engine ?? ENGINE_BAY, cool = c.info.cooling ?? { warn: 112, limp: 122 };
    const at = this.#toWorld(c, anchor), still = 1 - 0.6 * Math.min(1, speed / 25), carry = c.carry.bay ??= { steam: 0, smoke: 0 };
    // steam
    const leak = m && m.radiatorLeak > 0 && m.coolant > 0.02 ? 0.45 + 0.55 * Math.min(1, m.radiatorLeak * 40) : 0;
    const hot = m ? smoothstep(cool.warn - 4, cool.limp, m.temp ?? 0) : 0;
    c.steam = Math.max(leak, hot) * still;
    if (c.steam > 0.01) {
      const E = this.#e('steam'), colour = rgb(E.colour);
      carry.steam += E.rate * c.steam * dt;
      const n = Math.floor(carry.steam); carry.steam -= n;
      this.#spawn('steam', n, at, () => ({ position: add(at, [(this.random() - 0.5) * 0.6, 0.05, (this.random() - 0.5) * 0.4]), velocity: add(scale(c.vel, 0.85), [(this.random() - 0.5) * 0.8, 0.8 + this.random(), (this.random() - 0.5) * 0.8]), colour, alpha: 0.5 + 0.5 * c.steam, floor: c.floor }));
    }
    // grey smoke from a damaged engine; a blown one keeps smoking a little
    const S = this.#e('engineSmoke'), B = this.#e('blowSmoke');
    const damaged = h && !h.blown ? clamp((S.from - h.condition) / S.from, 0, 1) : 0;
    const rate = h?.blown ? B.wisp : S.rate * damaged;
    if (h?.blown && !c.blown && c.seenHealth) this.#blow(c);        // (blown since the last frame: a remote car, or no event)
    c.blown = !!h?.blown; c.seenHealth = !!h;
    if (rate > 0) {
      carry.smoke += rate * dt;
      const n = Math.floor(carry.smoke); carry.smoke -= n;
      const colour = rgb(h?.blown ? B.colour : S.colour);
      this.#spawn(h?.blown ? 'blowSmoke' : 'engineSmoke', n, at, () => ({ position: add(at, this.#jitter(0.2)), velocity: add(scale(c.vel, 0.85), [0, 0.4 + this.random() * 0.8, 0]), colour, alpha: h?.blown ? 0.6 : 0.5 + 0.5 * damaged, floor: c.floor }));
    }
  }

  // drips from a leaking car: coolant from a holed radiator, oil from a worn engine or a broken gearbox or diff
  #drips(c, s, speed, dt) {
    const K = this.cfg.marks.drips, m = s.mechanical, h = s.engine?.health;
    const coolant = m && m.radiatorLeak > 0 && m.coolant > 0.02, oil = (h && h.condition < K.oilBelow) || (m && Math.max(m.gearbox ?? 0, m.differential ?? 0) > K.oilDamage);
    if (!coolant && !oil) return;
    const d = c.drip;
    d.dist += speed * dt; d.time += dt;
    if (d.dist < K.every && (speed > 0.5 || d.time < K.still)) return;
    d.dist = 0; d.time = 0;
    const kind = coolant && (!oil || this.random() < 0.6) ? K.coolant : K.oil, anchor = c.info.anchors?.engine ?? ENGINE_BAY;
    const at = this.#toWorld(c, [anchor[0] + (this.random() - 0.5) * 0.3, 0, anchor[2] + (this.random() - 0.5) * 0.3]);
    const r = (K.size[0] + this.random() * (K.size[1] - K.size[0])) / 2, a = this.random() * Math.PI, y = c.floor + this.markLift + 0.002;
    const corner = k => { const t = a + k * Math.PI / 2; return [at[0] + Math.cos(t) * r, y, at[2] + Math.sin(t) * r]; };
    this.marks.add([corner(0), corner(1), corner(2), corner(3)], rgb(kind.colour), kind.alpha, kind.alpha, kind.fade, true);
  }
}
