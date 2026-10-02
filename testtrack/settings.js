// Settings for the test worlds: driver aids, brake bias, input device and feel, and control bindings.
// Defaults come from the car spec and the input layer; changes are kept in this browser
// (localStorage) so they survive a reload. The panel opens with O (or the gamepad's Menu button).

import { ACTIONS, DEFAULT_INPUT, DEFAULT_KEYS, DEFAULT_PAD, DEFAULT_WHEEL } from './input.js';

const STORE = 'driveWorld.settings.v1';
const clone = x => JSON.parse(JSON.stringify(x));

export function defaultSettings(spec) {
  const A = spec.assists;
  return {
    aids: { abs: A.abs.enabled, tc: A.tractionControl.enabled, tcStrength: A.tractionControl.strength, esc: A.stability.enabled, countersteer: A.countersteer.enabled, steering: A.steering.enabled, drift: A.drift.enabled, revProtection: A.revProtection?.enabled ?? false },
    brakeBias: spec.brakes.bias,
    handbrakeClutch: spec.brakes.handbrake.disengageClutch,
    damage: 'full',
    session: 'test',            // a test drive or a race (data/sessions.json kinds)
    collisions: null,           // between cars: full, reduced, off (ghosting); null: the session's own
    crashReplay: true,          // a slow-motion replay after a big crash (never in a race)
    spoilerAngle: 8,
    altitude: 0,
    effects: 'medium',          // visual effects quality: low / medium / high (data/effects.json)
    timeOfDay: 13,              // the test worlds' time of day (hours)
    input: clone(DEFAULT_INPUT), keys: clone(DEFAULT_KEYS), pad: clone(DEFAULT_PAD), wheel: clone(DEFAULT_WHEEL),
  };
}

export function loadSettings(spec) {
  const s = defaultSettings(spec);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved) for (const k of Object.keys(s)) if (saved[k] !== undefined) s[k] = typeof s[k] === 'object' ? { ...s[k], ...saved[k] } : saved[k];
  } catch { /* storage unavailable: defaults */ }
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* not saved */ }
}

const AID_ROWS = [
  ['abs', 'ABS', 'Stops the wheels locking under hard braking, so you can still steer'],
  ['tc', 'Traction control', 'Eases the throttle when the driven wheels spin'],
  ['esc', 'Stability control', 'Brakes single wheels to stop a spin or tighten understeer'],
  ['countersteer', 'Countersteer assist', 'Keyboard / gamepad: steering helps catch slides'],
  ['steering', 'Steering assist', 'Keyboard / gamepad: full lock only turns as far as the tyres can use'],
  ['drift', 'Drift assist', 'Keyboard / gamepad: holds a drift once it starts (stability control allows more slide)'],
  ['revProtection', 'Rev protection', 'Refuses a downshift that would over-rev the engine (a money shift bends valves or blows it)'],
];

const clockText = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const bindingText = b => !b ? '—' : b.type === 'button' ? `button ${b.index}` : b.rest == null ? `axis ${b.index}${b.invert ? ' (flipped)' : ''}` : `axis ${b.index}`;

// input: the InputManager (for capturing rebinds); onChange(settings) after any change
export function createSettingsPanel(settings, spec, input, onChange) {
  const el = document.createElement('div');
  el.id = 'settings';
  el.hidden = true;
  const changed = () => { saveSettings(settings); onChange(settings); render(); };

  function render() {
    const S = settings, I = S.input;
    const pads = input.pads();
    el.innerHTML = `
      <div class="head"><b>Settings</b><span><kbd>O</kbd> close</span></div>
      <div class="cols">
      <section><h3>Driver aids</h3>
        ${AID_ROWS.map(([k, name, help]) => `<label class="row"><input type="checkbox" data-aid="${k}" ${S.aids[k] ? 'checked' : ''}> <span><b>${name}</b><small>${help}</small></span></label>
          ${k === 'tc' ? `<label class="slider">strength <input type="range" min="0" max="1" step="0.05" data-num="aids.tcStrength" value="${S.aids.tcStrength}"> <output>${Math.round(S.aids.tcStrength * 100)}%</output></label>` : ''}`).join('')}
        <h3>Damage</h3>
        <label class="slider">crashes <select data-str="damage">${[['full', 'Full'], ['visual', 'Visual only'], ['off', 'Off']].map(([v, n]) => `<option value="${v}" ${(S.damage ?? 'full') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <small class="pads">Full: dents, broken glass and lights, parts lose condition, and the mechanicals take damage (bent steering and suspension, punctures, a leaking radiator that overheats the engine, a grinding gearbox…; a huge hit can tear a wheel off). Visual only: the dents and breakages, none of the mechanical effects. Off: none (the crash sounds stay).</small>
        <label class="row"><input type="checkbox" data-bool="crashReplay" ${S.crashReplay !== false ? 'checked' : ''}> <span><b>Crash replay</b><small>A short slow-motion replay after a big crash (any key skips it). Never in a race.</small></span></label>
        <h3>Session</h3>
        <label class="slider">kind <select data-str="session">${[['test', 'Test drive'], ['race', 'Race']].map(([v, n]) => `<option value="${v}" ${(S.session ?? 'test') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="slider">cars <select data-str="collisions">${[['', 'The session\'s own'], ['full', 'Full damage'], ['reduced', 'Reduced damage from other cars'], ['off', 'No collisions (ghosting)']].map(([v, n]) => `<option value="${v}" ${(S.collisions ?? '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <small class="pads">A test drive: cars hit with full damage, R puts loose parts back on, B repairs everything (development). A race: reduced damage from other cars (public races will be the same), R keeps all the damage (only a wheel torn off goes back on), no free repairs — Backspace twice tows the car to the garage, ending the race.</small>
        <h3>Brakes</h3>
        <label class="slider">front bias <input type="range" min="0.5" max="0.85" step="0.01" data-num="brakeBias" value="${S.brakeBias}"> <output>${Math.round(S.brakeBias * 100)}%</output></label>
        <label class="row"><input type="checkbox" data-bool="handbrakeClutch" ${S.handbrakeClutch ? 'checked' : ''}> <span><b>Clutch in with handbrake</b><small>Keeps the engine revving through handbrake turns</small></span></label>
        <h3>Aero and air <small>K fits / removes the spoiler (its angle is its setting: garage.tune("basic_wing", "angle", 12)) · J puts an AI car ahead to slipstream</small></h3>
        <label class="slider">test altitude <input type="range" min="0" max="4000" step="100" data-num="altitude" value="${S.altitude}"> <output>${S.altitude} m</output></label>
        <h3>Effects <small>. opens the effects panel</small></h3>
        <label class="slider">quality <select data-str="effects">${[['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([v, n]) => `<option value="${v}" ${(S.effects ?? 'medium') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <small class="pads">How many particles (smoke, sparks, dust…), how big and how long they last, how far away cars' effects play, soft edges where they meet surfaces (medium and high) and little lights where sparks fly (high).</small>
        <label class="slider">time of day <input type="range" min="0" max="24" step="0.25" data-num="timeOfDay" value="${S.timeOfDay ?? 13}"> <output>${clockText(S.timeOfDay ?? 13)}</output></label>
      </section>
      <section><h3>Input</h3>
        <label class="slider">device <select data-str="input.device">${['auto', 'keyboard', 'gamepad', 'wheel'].map(d => `<option ${I.device === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <small class="pads">${pads.length ? pads.map(p => `${p.kind}: ${p.pad.id}`).join('<br>') : 'No gamepad or wheel seen yet — press a button on it.'}</small>
        <label class="slider">wheel rotation <input type="range" min="180" max="1080" step="10" data-num="input.wheelRange" value="${I.wheelRange}"> <output>${I.wheelRange}°</output></label>
        <label class="slider">stick deadzone <input type="range" min="0" max="0.4" step="0.01" data-num="input.stickDeadzone" value="${I.stickDeadzone}"> <output>${I.stickDeadzone}</output></label>
        <label class="slider">stick curve <input type="range" min="1" max="3" step="0.1" data-num="input.stickCurve" value="${I.stickCurve}"> <output>${I.stickCurve}</output></label>
        <label class="slider">trigger deadzone <input type="range" min="0" max="0.3" step="0.01" data-num="input.triggerDeadzone" value="${I.triggerDeadzone}"> <output>${I.triggerDeadzone}</output></label>
        <label class="slider">trigger curve <input type="range" min="1" max="3" step="0.1" data-num="input.triggerCurve" value="${I.triggerCurve}"> <output>${I.triggerCurve}</output></label>
        <label class="slider">rumble <input type="range" min="0" max="1" step="0.05" data-num="input.rumble" value="${I.rumble}"> <output>${Math.round(I.rumble * 100)}%</output></label>
        <h3>Controls <small>click to rebind, then press the key / button or move the axis (Esc cancels)</small></h3>
        <table class="binds"><tr><th></th><th>keyboard</th><th>gamepad</th><th>wheel</th></tr>
          ${ACTIONS.map(a => `<tr><td>${a.label}</td>
            <td>${a.padOnly ? '' : `<button data-bind="keys.${a.id}">${(S.keys[a.id] || []).join(' / ') || '—'}</button>`}</td>
            <td>${a.keyOnly ? '' : `<button data-bind="pad.${a.id}">${bindingText(S.pad[a.id])}</button>`}</td>
            <td>${a.keyOnly ? '' : `<button data-bind="wheel.${a.id}">${bindingText(S.wheel[a.id])}</button>`}</td></tr>`).join('')}
        </table>
        <button data-reset>Reset everything to defaults</button>
      </section></div>`;
  }

  const set = (path, value) => { const [a, b] = path.split('.'); if (b) settings[a][b] = value; else settings[a] = value; };
  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.num) { set(t.dataset.num, +t.value); saveSettings(settings); onChange(settings); t.nextElementSibling.textContent = t.dataset.num.includes('Bias') || t.dataset.num.includes('Strength') || t.dataset.num.includes('rumble') ? Math.round(t.value * 100) + '%' : t.dataset.num.includes('wheelRange') || t.dataset.num === 'spoilerAngle' ? t.value + '°' : t.dataset.num === 'altitude' ? t.value + ' m' : t.dataset.num === 'timeOfDay' ? clockText(+t.value) : t.value; }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.aid) { settings.aids[t.dataset.aid] = t.checked; changed(); }
    if (t.dataset.bool) { settings[t.dataset.bool] = t.checked; changed(); }
    if (t.dataset.str === 'collisions') { settings.collisions = t.value || null; changed(); }
    else if (t.dataset.str === 'session') { settings.session = t.value; settings.collisions = null; changed(); }
    else if (t.dataset.str) { set(t.dataset.str, t.value); changed(); }
  });
  el.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.reset !== undefined) { Object.assign(settings, defaultSettings(spec)); changed(); return; }
    const [group, id] = (t.dataset.bind || '').split('.');
    if (!group) return;
    t.textContent = id === 'steer' ? 'turn left…' : 'press…';
    t.classList.add('listening');
    const rest = {};                                    // axis positions when rebinding started
    input.capture = ev => {
      if (ev.kind === 'key') {
        if (ev.code === 'Escape') { render(); return true; }
        if (group !== 'keys') return false;
        settings.keys[id] = [ev.code];
      } else {
        if (group === 'keys') return false;
        if (ev.kind === 'button') settings[group][id] = { type: 'button', index: ev.index };
        else {
          const key = ev.pad.index + ':' + ev.index;
          if (!(key in rest)) { rest[key] = ev.value; return false; }
          if (Math.abs(ev.value - rest[key]) < 0.5) return false;
          // steering: turning left should read negative (the axis convention); pedals: 0 at rest, 1 pressed
          settings[group][id] = id === 'steer' ? { type: 'axis', index: ev.index, invert: ev.value > rest[key] } : { type: 'axis', index: ev.index, rest: rest[key], full: Math.sign(ev.value - rest[key]) };
        }
      }
      changed();
      return true;
    };
  });
  return {
    el,
    get open() { return !el.hidden; },
    toggle() { el.hidden = !el.hidden; if (!el.hidden) render(); input.capture = null; },
    hide() { el.hidden = true; input.capture = null; },
  };
}
