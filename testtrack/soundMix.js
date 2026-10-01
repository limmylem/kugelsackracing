// The engine's sound worked out from the engine's state (no Web Audio here, so it's tested in Node;
// testtrack/audio.js plays it): which loops of the engine's sound config (data/sounds/engines) play,
// how loud and how fast; how loud the whole engine is and how open its tone; the intake's air; the
// turbo's spool and whistle; and how rough a misfiring or floating engine runs.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function curveAt(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (x <= curve[i][0]) { const [x0, y0] = curve[i - 1], [x1, y1] = curve[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return curve[curve.length - 1][1];
}

// How on load the engine is (0 off .. 1 on): the throttle it's actually getting, none while the rev
// limiter has the fuel cut
export const loadOf = (cfg, throttle, fuelCut) => fuelCut ? 0 : smoothstep(cfg.mix.load[0], cfg.mix.load[1], throttle);

// The loops: for each layer, the gain of its on-load and off-load loop and the rate to play them at.
// Between two rpm points the nearer one plays alone, and they crossfade (equal power) over the middle
// `blend` of the gap (by log rpm), so a loop's only heard near its own pitch; on and off load share the
// load the same way; each plays at rpm ÷ its own rpm (within ±maxShift)
export function layerMix(cfg, rpm, load) {
  const L = cfg.layers, n = L.length, w = new Array(n).fill(0), blend = cfg.mix.blend ?? 1;
  if (rpm <= L[0].rpm) w[0] = 1;
  else if (rpm >= L[n - 1].rpm) w[n - 1] = 1;
  else {
    let i = 0;
    while (rpm >= L[i + 1].rpm) i++;
    const x = Math.log(rpm / L[i].rpm) / Math.log(L[i + 1].rpm / L[i].rpm), y = clamp((x - (1 - blend) / 2) / blend, 0, 1);
    w[i] = Math.cos(y * Math.PI / 2); w[i + 1] = Math.sin(y * Math.PI / 2);
  }
  const on = Math.sin(load * Math.PI / 2), off = Math.cos(load * Math.PI / 2), m = cfg.mix.maxShift;
  return L.map((layer, i) => ({ on: w[i] * on, off: w[i] * off, rate: clamp(rpm / layer.rpm, 1 - m, 1 + m) }));
}

// How loud the engine is, and its tone (a low-pass, Hz): louder and brighter with the revs and the
// load; fading out below idle (stopping, stalled, blown)
export function engineLevels(cfg, E, rpm, load) {
  const M = cfg.mix, r = clamp((rpm - E.idleRpm) / (E.redlineRpm - E.idleRpm), 0, 1.3);
  const level = M.level * (M.idleLevel + (1 - M.idleLevel) * r ** M.curve) * (M.offLoadLevel + (1 - M.offLoadLevel) * load) * smoothstep(0.3 * E.idleRpm, 0.7 * E.idleRpm, rpm);
  const tone = M.toneHz[0] * (M.toneHz[1] / M.toneHz[0]) ** Math.min(1, r) * (0.75 + 0.25 * load);
  return { level, tone };
}

// The intake's air: heard at high throttle, louder and higher with the revs
export function intakeMix(cfg, E, rpm, throttle) {
  const I = cfg.intake, r = clamp(rpm / E.redlineRpm, 0, 1.2);
  return { gain: I.gain * smoothstep(I.throttle[0], I.throttle[1], throttle) * (0.3 + 0.7 * r), hz: I.hz[0] * (I.hz[1] / I.hz[0]) ** Math.min(1, r), q: I.q };
}

// How often a firing drops out: a misfiring engine (health.misfire), valve float (damage.rough … it's
// floating), none from a healthy one
export const roughShare = (cfg, health) => Math.max(health?.misfire ?? 0, health?.floating ? cfg.damage.rough : 0);
// (which firings: a fixed pattern)
export function dropped(n, share) {
  if (share <= 0) return false;
  let x = Math.imul(n ^ 0x51ed27f, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 0) / 4294967296 < share;
}

// The turbo, for its sound (the physics has no spool yet): the spool chases the boost the turbo's curve
// gives at these revs (a share of its most) times how open the throttle is — spoolUp s to rise,
// spoolDown s to fall; the whistle's pitch follows the spool (fromHz … toHz), its level the spool and
// the throttle, so it rises under throttle and fades off it. turbo: the spec's (the turbo part's sound
// and its boost curve as fitted); none: silent.
export class TurboSpool {
  constructor() { this.spool = 0; }
  update(dt, turbo, rpm, throttle) {
    const W = turbo?.sound?.whistle;
    if (!W || !turbo.boost?.length) { this.spool = 0; return { spool: 0, hz: 0, gain: 0, noise: 0, q: 1 }; }
    const most = Math.max(...turbo.boost.map(p => p[1])) || 1;
    const target = clamp(curveAt(turbo.boost, rpm) / most, 0, 1) * smoothstep(0.15, 0.85, throttle);
    const tau = target > this.spool ? W.spoolUp : W.spoolDown;
    this.spool += (target - this.spool) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
    const s = this.spool;
    return { spool: s, hz: W.fromHz + (W.toHz - W.fromHz) * s ** 0.8, gain: W.gain * s ** 1.5 * (0.35 + 0.65 * smoothstep(0.1, 0.7, throttle)), noise: W.noise, q: W.q };
  }
}

// What the cockpit hears of the engine and the wind (testtrack/audio.js). roof: spec.roof ({ kind:
// fixed | soft | hard | none, open }) or none (a fixed roof); inside: a cockpit or bonnet camera; speed:
// m/s. A closed car sounds as it always has, with a little wind at speed; with the roof down (or no
// roof) the engine's louder in the cockpit and the wind roars. → { engine (gain ×), wind (0..1) }
export const roofOpen = roof => !!roof && (roof.kind === 'none' || (roof.kind === 'soft' && (roof.open ?? 0) >= 0.5));
export function cabinMix(roof, inside, speed) {
  const air = Math.min(1, (Math.abs(speed) / 45) ** 2);
  if (!inside) return { engine: 1, wind: 0.12 * air };
  return roofOpen(roof) ? { engine: 1.35, wind: air } : { engine: 1, wind: 0.15 * air };
}
