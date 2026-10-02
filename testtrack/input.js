// Input layer for the test worlds: keyboard, gamepads and steering wheels (both through the Gamepad
// API), with rebindable controls, deadzones and response curves, and force feedback output.
//
// poll() returns what the car needs — { device, steer (-1..1, + = left), throttle, brake, clutch
// (null = auto-clutch), handbrake, wheelRange } — plus the game actions pressed since the last poll.
// The physics does the rest per device (physics/controls.js): smoothing, speed-sensitive steering and
// steering assists for keyboard / gamepad; nothing for a wheel.
//
// Keys are also kept with the moment they were pressed (physics/inputTimeline.js): stepInput() gives
// each physics step the keys as they were at its own moment and the gear shifts pressed during it, so
// the drive doesn't depend on the frame rate.
//
// Bindings: keyboard actions → key codes; gamepad / wheel actions → { type: 'button', index } or
// { type: 'axis', index, rest, full } (pedals and triggers read 0 at `rest`, 1 at `full`; the steering
// axis reads -1..1, flipped with invert).

import { InputTimeline } from '../physics/inputTimeline.js';

export const ACTIONS = [
  { id: 'steerLeft', label: 'Steer left', keyOnly: true }, { id: 'steerRight', label: 'Steer right', keyOnly: true },
  { id: 'steer', label: 'Steering (axis)', padOnly: true },
  { id: 'throttle', label: 'Throttle' }, { id: 'brake', label: 'Brake / reverse' }, { id: 'handbrake', label: 'Handbrake' },
  { id: 'clutch', label: 'Clutch' }, { id: 'halfPedal', label: 'Half pedal (hold)', keyOnly: true },
  { id: 'shiftUp', label: 'Shift up', press: true }, { id: 'shiftDown', label: 'Shift down', press: true },
  { id: 'reset', label: 'Back on the road', press: true }, { id: 'camera', label: 'Camera', press: true },
  { id: 'aids', label: 'All aids on / off', press: true }, { id: 'gearbox', label: 'Gearbox auto / manual', press: true },
  { id: 'hud', label: 'Small HUD', press: true }, { id: 'debug', label: 'Debug lines', press: true },
  { id: 'dyno', label: 'Dyno', press: true }, { id: 'mute', label: 'Sound', press: true }, { id: 'settings', label: 'Settings', press: true },
  { id: 'spoiler', label: 'Spoiler on / off', press: true }, { id: 'aiCar', label: 'AI car ahead', press: true },
  { id: 'tuning', label: 'Tuning panel', press: true }, { id: 'telemetry', label: 'Telemetry graphs', press: true },
  { id: 'sockets', label: 'Show the car\'s sockets', press: true },
  { id: 'restore', label: 'Reset car (development: repaired)', press: true }, { id: 'damageView', label: 'Damage view', press: true },
  { id: 'damageReport', label: 'Damage report', press: true },
  { id: 'transfer', label: 'Transfer case 2H / 4H / 4L (4WD)', press: true },
  { id: 'lockFront', label: 'Front diff lock', press: true }, { id: 'lockRear', label: 'Rear diff lock', press: true },
  { id: 'lockCentre', label: 'Centre diff lock', press: true }, { id: 'roof', label: 'Roof up / down (convertible)', press: true },
  { id: 'effects', label: 'Effects panel (debug)', press: true },
  { id: 'tow', label: 'Tow to the garage (twice)', press: true },
  { id: 'worldMap', label: 'Map and quick travel (real world)', press: true },
  { id: 'perfOverlay', label: 'Performance overlay (real world)', press: true },
];

export const DEFAULT_KEYS = {
  steerLeft: ['KeyA', 'ArrowLeft'], steerRight: ['KeyD', 'ArrowRight'], throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'],
  handbrake: ['Space'], clutch: ['KeyF'], halfPedal: ['ShiftLeft', 'ShiftRight'], shiftUp: ['KeyE'], shiftDown: ['KeyQ'],
  reset: ['KeyR'], camera: ['KeyC'], aids: ['KeyX'], gearbox: ['KeyZ'], hud: ['KeyH'], debug: ['KeyG'], dyno: ['KeyY'], mute: ['KeyM'], settings: ['KeyO'],
  spoiler: ['KeyK'], aiCar: ['KeyJ'], tuning: ['KeyP'], telemetry: ['KeyL'], sockets: ['KeyN'], restore: ['KeyB'], damageView: ['KeyU'], damageReport: ['KeyI'],
  transfer: ['KeyV'], lockFront: ['BracketLeft'], lockRear: ['BracketRight'], lockCentre: ['Backslash'], roof: ['Semicolon'], effects: ['Period'], tow: ['Backspace'],
  worldMap: ['Tab'], perfOverlay: ['F3'],
};
const btn = index => ({ type: 'button', index }), axis = (index, rest, full) => ({ type: 'axis', index, rest, full });
// Standard gamepad layout (Xbox names): left stick steers, triggers are the pedals
export const DEFAULT_PAD = {
  steer: axis(0), throttle: btn(7), brake: btn(6), handbrake: btn(2), clutch: btn(1), shiftUp: btn(5), shiftDown: btn(4),
  reset: btn(8), camera: btn(3), aids: btn(13), gearbox: btn(12), hud: btn(15), debug: btn(14), dyno: null, mute: null, settings: btn(9), spoiler: null, aiCar: null,
  tuning: null, telemetry: null, sockets: null, restore: null, damageView: null, damageReport: null,
  transfer: null, lockFront: null, lockRear: null, lockCentre: null, roof: null, effects: null, tow: null, worldMap: null, perfOverlay: null,
};
// Wheels differ a lot; this is a common layout (pedals as axes resting at +1) — rebind in settings
export const DEFAULT_WHEEL = {
  steer: axis(0), throttle: axis(2, 1, -1), brake: axis(3, 1, -1), clutch: axis(1, 1, -1), handbrake: btn(6), shiftUp: btn(4), shiftDown: btn(5),
  reset: btn(3), camera: btn(2), aids: null, gearbox: null, hud: null, debug: null, dyno: null, mute: null, settings: btn(9),
};
export const DEFAULT_INPUT = { device: 'auto', wheelRange: 900, stickDeadzone: 0.1, stickCurve: 1.5, triggerDeadzone: 0.05, triggerCurve: 1.2, rumble: 0.8 };

const WHEEL_NAMES = /wheel|G2[79]|G9[02]\d?|G923|T150|T248|T300|TMX|TX Racing|T-GT|Fanatec|CSL|Driving Force|DFGT|Momo|Moza|Simucube|SimXperience/i;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// typing into a text / number box or a list: keys are for that, not the car (sliders and tick boxes
// hand the keys on to the car)
const typing = t => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)));
// deadzone then a power curve (keeps the sign)
const shape = (x, dead, curve) => { const a = Math.abs(x); return a <= dead ? 0 : Math.sign(x) * ((a - dead) / (1 - dead)) ** curve; };

export class InputManager {
  // settings: { input, keys, pad, wheel } (edited in place by the settings panel)
  constructor(settings, getGamepads = () => (navigator.getGamepads ? [...navigator.getGamepads()] : [])) {
    this.settings = settings;
    this.getGamepads = getGamepads;
    this.keys = {};
    this.pressedKeys = new Set();
    this.lastPadButtons = new Map();
    this.active = 'keyboard';
    this.activePad = null;
    this.ffb = new ForceFeedback();
    this.capture = null;          // a rebinding in progress: (event) => true when done
    this.enabled = false;         // only while a test world is showing
    this.timeline = new InputTimeline();
    this.lastPoll = performance.now();
    addEventListener('keydown', e => this.onKey(e, true));
    addEventListener('keyup', e => this.onKey(e, false));
    addEventListener('blur', () => { this.keys = {}; this.timeline.set(performance.now(), this.keyboardState()); });
  }

  onKey(e, down) {
    if (typing(e.target)) return;
    if (down && this.capture) { e.preventDefault(); if (this.capture({ kind: 'key', code: e.code })) this.capture = null; return; }
    if (!this.enabled) return;
    if (down && !e.repeat) this.pressedKeys.add(e.code);
    this.keys[e.code] = down;
    if (down) this.active = 'keyboard';
    // when it happened, for the physics steps (a gear shift is an event at that moment)
    this.timeline.set(e.timeStamp, this.keyboardState());
    if (down && !e.repeat) for (const [id, dir] of [['shiftUp', 1], ['shiftDown', -1]]) if ((this.settings.keys[id] || []).includes(e.code)) this.timeline.event(e.timeStamp, dir);
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab' || e.code === 'F3') e.preventDefault();
  }

  // The car's input from the keyboard alone
  keyboardState() {
    const S = this.settings, keyHeld = id => (S.keys[id] || []).some(c => this.keys[c]), half = keyHeld('halfPedal') ? 0.5 : 1;
    return {
      steer: (keyHeld('steerLeft') ? 1 : 0) - (keyHeld('steerRight') ? 1 : 0), throttle: keyHeld('throttle') ? half : 0, brake: keyHeld('brake') ? half : 0,
      handbrake: keyHeld('handbrake'), clutch: keyHeld('clutch') ? 1 : null,
    };
  }

  // Input for one physics step covering the moments start..end (ms, performance.now()'s clock), given
  // this frame's poll(): the keys as they were at the end of it, and any gear shift pressed during it
  stepInput(frame, start, end) {
    const out = { ...frame, pressed: undefined };
    if (frame.device === 'keyboard' && this.enabled) Object.assign(out, this.timeline.at(end) ?? {});
    const shifts = this.timeline.eventsIn(start, end);
    if (shifts.length) out.shift = shifts.reduce((a, b) => a + b, 0);
    return out;
  }

  // Connected gamepads / wheels, with what kind each is
  pads() {
    return this.getGamepads().filter(Boolean).map(p => ({ pad: p, kind: WHEEL_NAMES.test(p.id) ? 'wheel' : 'gamepad' }));
  }
  bindingsFor(kind) { return kind === 'wheel' ? this.settings.wheel : this.settings.pad; }

  // Reads a binding on a pad: buttons 0..1 (triggers are analog buttons), axes per their calibration
  readBinding(p, b, kind) {
    if (!b) return 0;
    if (b.type === 'button') return p.buttons[b.index]?.value ?? 0;
    const v = p.axes[b.index] ?? 0;
    if (b.rest == null) return b.invert ? -v : v;
    return clamp((v - b.rest) / (b.full - b.rest), 0, 1);
  }

  poll() {
    const S = this.settings, I = S.input, k = this.keys, pressed = new Set(), now = performance.now(), since = this.lastPoll;
    const keyHeld = id => (S.keys[id] || []).some(c => k[c]);
    for (const a of ACTIONS) if (a.press && (S.keys[a.id] || []).some(c => this.pressedKeys.has(c))) pressed.add(a.id);
    this.pressedKeys.clear();
    this.lastPoll = now;
    this.timeline.prune(now);

    // gamepads / wheels: note presses, and which one was used last
    const pads = this.pads();
    for (const { pad: p, kind } of pads) {
      const last = this.lastPadButtons.get(p.index) || [];
      const buttons = p.buttons.map(b => b.pressed);
      const B = this.bindingsFor(kind);
      if (this.capture) {
        buttons.forEach((on, i) => { if (on && !last[i] && this.capture?.({ kind: 'button', pad: p, padKind: kind, index: i })) this.capture = null; });
        p.axes.forEach((v, i) => { if (this.capture?.({ kind: 'axis', pad: p, padKind: kind, index: i, value: v })) this.capture = null; });
      } else if (this.enabled) {
        for (const a of ACTIONS) if (a.press && B[a.id]?.type === 'button' && buttons[B[a.id].index] && !last[B[a.id].index]) {
          pressed.add(a.id);
          // (buttons are only seen when polled: a shift goes to the first step after the last poll)
          if (a.id === 'shiftUp' || a.id === 'shiftDown') this.timeline.event(since + 0.001, a.id === 'shiftUp' ? 1 : -1);
        }
        const moved = buttons.some(Boolean) || Math.abs(this.readBinding(p, B.steer, kind)) > 0.25 || this.readBinding(p, B.throttle, kind) > 0.2 || this.readBinding(p, B.brake, kind) > 0.2;
        if (moved) { this.active = kind; this.activePad = p.index; }
      }
      this.lastPadButtons.set(p.index, buttons);
    }

    // which device drives: the settings' choice, or (auto) whichever was used last
    let device = I.device === 'auto' ? this.active : I.device;
    const pad = pads.find(x => x.pad.index === this.activePad && (device === 'auto' || x.kind === device)) || pads.find(x => x.kind === device);
    if (device !== 'keyboard' && !pad) device = 'keyboard';
    const out = { device, steer: 0, throttle: 0, brake: 0, clutch: null, handbrake: false, wheelRange: I.wheelRange, pressed, padName: pad?.pad.id ?? null };
    if (device === 'keyboard' || !this.enabled) return this.enabled ? Object.assign(out, this.keyboardState()) : out;
    const p = pad.pad, B = this.bindingsFor(pad.kind), read = id => this.readBinding(p, B[id], pad.kind);
    if (pad.kind === 'wheel') {
      // raw: no deadzones or curves on a wheel (pedals are calibrated by their bindings)
      out.steer = -clamp(read('steer'), -1, 1);         // axes read + to the right; the car's + is left
      out.throttle = read('throttle');
      out.brake = read('brake');
      out.clutch = B.clutch ? read('clutch') : null;
    } else {
      out.steer = -shape(clamp(read('steer'), -1, 1), I.stickDeadzone, I.stickCurve);
      out.throttle = Math.max(0, shape(read('throttle'), I.triggerDeadzone, I.triggerCurve));
      out.brake = Math.max(0, shape(read('brake'), I.triggerDeadzone, I.triggerCurve));
      const c = read('clutch');
      out.clutch = c > 0.05 ? c : (keyHeld('clutch') ? 1 : null);
    }
    out.handbrake = read('handbrake') > 0.5 || keyHeld('handbrake');
    this.ffb.pad = p;
    this.ffb.kind = pad.kind;
    return out;
  }

  // Force feedback / rumble from the car's state (called each frame with the snapshot)
  feedback(s, dt) {
    this.ffb.update(s, dt, this.settings.input.rumble, this.active);
  }
  // A jolt felt for a moment (a gear grinding, a kerb strike): strength 0..1, seconds
  pulse(strength, seconds = 0.25) { this.ffb.pulse(strength, seconds); }
}

// Force feedback: works out what the driver should feel from the car, then hands it to outputs.
// Rumble for gamepads now; a steering wheel output (WebHID, or a desktop build) can be added as
// another output with the same send(effect) shape, driving `torque` as a constant force.
//
// Mechanical damage (physics/mechanical.js) is felt too: a bent rim's wobble (more with speed), a flat or
// soft tyre thumping once a turn, and jolts (pulse(): a gear grinding, a kerb strike). A phone buzzes
// for them (navigator.vibrate) whatever the controls.
export class ForceFeedback {
  constructor() {
    this.outputs = [new RumbleOutput(), new PhoneVibrateOutput()];
    this.kerbPhase = 0;
    this.flapPhase = 0;
    this.jolt = { strength: 0, left: 0 };
    this.effect = { torque: 0, kerb: 0, lockup: 0, spin: 0, wobble: 0, flat: 0, jolt: 0 };
  }
  pulse(strength, seconds = 0.25) { if (strength >= this.jolt.strength || this.jolt.left <= 0) this.jolt = { strength: Math.min(1, Math.max(0, strength)), left: seconds }; }
  update(s, dt, gain, device) {
    const onKerb = s.wheels.some(w => w.grounded && w.surface === 'kerb') && Math.abs(s.speed) > 2;
    const lockup = s.wheels.some(w => w.grounded && w.slipRatio < -0.5 && Math.abs(s.speed) > 3) ? 1 : 0;
    const spin = s.wheels.some(w => w.grounded && w.driven && w.slipRatio > 0.4) ? 1 : 0;
    this.kerbPhase += dt * Math.abs(s.speed) / 1.2;              // one pulse per kerb stripe
    const m = s.mechanical, flap = m?.flap;
    this.flapPhase += dt * (flap?.rate ?? 0);                    // one thump a turn
    this.jolt.left -= dt;
    const flat = flap ? (this.flapPhase % 1 < 0.3 ? Math.min(1, flap.amount) : 0.15 * flap.amount) : 0;
    this.effect = { torque: s.steering?.ffb ?? 0, kerb: onKerb ? (Math.sin(this.kerbPhase * Math.PI * 2) > 0 ? 1 : 0.3) : 0, lockup, spin, wobble: m?.vibration ?? 0, flat, jolt: this.jolt.left > 0 ? this.jolt.strength : 0 };
    if (!gain) return;
    for (const o of this.outputs) if (device !== 'keyboard' || o.anyDevice) o.send(this.effect, this, gain);
  }
}

// Gamepad rumble: the strong (low) motor follows steering weight and kerbs, the weak (high) one
// buzzes for lock-ups and wheelspin
class RumbleOutput {
  constructor() { this.next = 0; }
  send(e, ffb, gain) {
    const p = ffb.pad, act = p?.vibrationActuator;
    if (!act || ffb.kind !== 'gamepad' || performance.now() < this.next) return;
    this.next = performance.now() + 50;
    const strong = clamp(Math.abs(e.torque) * 0.25 + e.kerb * 0.7 + e.flat * 0.8 + e.jolt * 0.9, 0, 1) * gain, weak = clamp(e.lockup * 0.6 + e.spin * 0.45 + e.kerb * 0.3 + e.wobble * 0.7 + e.jolt * 0.6, 0, 1) * gain;
    if (strong < 0.02 && weak < 0.02) return;
    act.playEffect?.('dual-rumble', { startDelay: 0, duration: 80, strongMagnitude: strong, weakMagnitude: weak }).catch?.(() => {});
  }
}

// A phone's vibration (navigator.vibrate: on or off, so short buzzes by strength): the damage — a
// wobbling rim, a flat tyre's thump, a grinding gear, a strike — and kerbs
class PhoneVibrateOutput {
  constructor() {
    this.next = 0;
    this.anyDevice = true;
    this.ok = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && !!globalThis.matchMedia?.('(pointer: coarse)').matches;
  }
  send(e, ffb, gain) {
    if (!this.ok || performance.now() < this.next) return;
    const k = clamp(Math.max(e.jolt, e.flat * 0.8, e.wobble * 0.7, e.kerb * 0.5), 0, 1) * gain;
    if (k < 0.15) return;
    const ms = Math.round(15 + 45 * k);
    this.next = performance.now() + ms + 60;
    try { navigator.vibrate(ms); } catch { this.ok = false; }
  }
}
