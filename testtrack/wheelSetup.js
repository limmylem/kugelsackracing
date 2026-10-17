// Setting up a wheel, its pedals and a shifter by asking (the settings' Controls › "Set up my wheel"): turn the wheel
// left, press each pedal all the way, pull each paddle, put the shifter in each gear — whatever moves is bound,
// on whichever device it's on (pedals or a shifter plugged in on their own included), with its own rest and travel.
// Any wheel, whatever its layout in the browser; nothing to know about it beforehand.
//
//   const W = createWheelSetup()
//   W.feed(devices) each poll (InputManager.watch: [{ id, index, kind, axes, buttons }]) → true when the step changed
//   W.step → { id, kind: 'steer' | 'pedal' | 'button' | 'ask', optional }   W.index, W.count   W.done
//   W.skip()   W.finishGears()   W.answer(yes) (the H-shifter question)   W.found → { action: binding }
//   applyWheelSetup(settings, found)   the wheel's bindings set, and whatever else was on those buttons cleared
// Pure (tests/unit/wheelSetup.test.mjs).

export const SETUP_STEPS = [
  { id: 'steer', kind: 'steer' },
  { id: 'throttle', kind: 'pedal' }, { id: 'brake', kind: 'pedal' }, { id: 'clutch', kind: 'pedal', optional: true },
  { id: 'shiftUp', kind: 'button', optional: true }, { id: 'shiftDown', kind: 'button', optional: true },
  { id: 'handbrake', kind: 'pedal', optional: true, button: true },
  { id: 'hShifter', kind: 'ask' },
  ...[1, 2, 3, 4, 5, 6, 7].map(g => ({ id: `gear${g}`, kind: 'button', optional: true, gears: true })), { id: 'gearR', kind: 'button', optional: true, gears: true },
];
const MOVE = { steer: 0.45, pedal: 0.5, released: 0.15 };
const key = (d, i) => `${d.id}#${i}`;

export function createWheelSetup() {
  let i = 0, rest = null, prev = null, cand = null, hShifter = null;
  const found = {}, used = new Set();
  const W = {
    found,
    get index() { return i; },
    get count() { return SETUP_STEPS.length; },
    get step() { return SETUP_STEPS[i] ?? null; },
    get done() { return i >= SETUP_STEPS.length; },
    get candidate() { return cand; },
    feed(devices) {
      const S = W.step;
      if (!S) return false;
      if (S.kind === 'ask') return false;
      if (!rest) { rest = new Map(); for (const d of devices) d.axes.forEach((v, a) => rest.set(key(d, a), v)); prev = new Map(devices.map(d => [d.id, d.buttons])); return false; }
      const pressedNow = [];
      for (const d of devices) { const was = prev.get(d.id) ?? []; d.buttons.forEach((on, b) => { if (on && !was[b] && !used.has(`${d.id}@${b}`)) pressedNow.push({ d, b }); }); }
      prev = new Map(devices.map(d => [d.id, d.buttons]));
      if (S.kind === 'button' || (S.button && pressedNow.length && !cand)) {
        const p = pressedNow[0];
        if (p) return take({ type: 'button', index: p.b, dev: p.d.id }, `${p.d.id}@${p.b}`);
        if (S.kind === 'button') return false;
      }
      // the axes that moved from where they rested (a hat switch rests past ±1: not one)
      let best = null;
      for (const d of devices) {
        if (S.kind === 'steer' && d.kind === 'extra') continue;
        d.axes.forEach((v, a) => {
          const k = key(d, a), r = rest.get(k);
          if (r == null || Math.abs(r) > 1.05 || used.has(k)) return;
          const m = Math.abs(v - r);
          if (!best || m > best.m) best = { d, a, k, r, v, m };
        });
      }
      if (S.kind === 'steer') return best && best.m >= MOVE.steer ? take({ type: 'axis', index: best.a, invert: best.v > best.r, dev: best.d.id }, best.k) : false;
      // a pedal: pressed all the way (its furthest kept), then let go
      if (!cand && best && best.m >= MOVE.pedal) cand = { ...best, peak: best.v };
      if (cand) {
        const d = devices.find(x => x.id === cand.d.id), v = d?.axes[cand.a] ?? cand.r;
        if (Math.abs(v - cand.r) > Math.abs(cand.peak - cand.r)) cand.peak = v;
        if (Math.abs(v - cand.r) < MOVE.released) {
          // (a little short of the furthest seen: all the way reads 1 every time)
          const full = cand.r + (cand.peak - cand.r) * 0.97;
          return take({ type: 'axis', index: cand.a, rest: round(cand.r), full: round(full), dev: cand.d.id }, cand.k);
        }
      }
      return false;
    },
    // (any step: skipped, it's left unbound — a gear skipped is a gear the shifter hasn't, the rest still asked)
    skip() { if (W.step) next(); return true; },
    // (the gears: no more — a 5- or 6-speed shifter)
    finishGears() { while (W.step?.gears) next(); return true; },
    answer(yes) { hShifter = !!yes; next(); if (!yes) while (W.step?.gears) next(); return true; },
    get hShifter() { return hShifter; },
  };
  function next() { i++; rest = null; prev = null; cand = null; }
  function take(binding, k) { found[W.step.id] = binding; used.add(k); next(); return true; }
  return W;
}
const round = x => Math.round(x * 1000) / 1000;

// The setup into the settings: the wheel's bindings for what was found (what was skipped: unbound), and any other
// wheel or gamepad action on a button now used cleared — a shifter's gears changed the camera before
export function applyWheelSetup(settings, found) {
  const W = settings.wheel;
  for (const { id } of SETUP_STEPS) if (id !== 'hShifter') W[id] = found[id] ?? null;
  const taken = Object.entries(found).filter(([, b]) => b.type === 'button').map(([id, b]) => ({ id, b }));
  for (const [setName, set] of [['wheel', W], ['pad', settings.pad]]) {
    for (const [id, b] of Object.entries(set)) {
      if (!b || b.type !== 'button' || (setName === 'wheel' && found[id])) continue;
      // (a binding naming no device is on the device of its kind: the wheel's on the wheel)
      if (taken.some(t => t.b.index === b.index && (b.dev ? b.dev === t.b.dev : setName === 'wheel'))) set[id] = null;
    }
  }
  return settings;
}
