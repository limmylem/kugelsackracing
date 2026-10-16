// On-screen controls for phones and tablets (Phase 8 Step 4; docs/ACCESSIBILITY.md): steering, throttle, brake and
// handbrake, gear shifts, the camera, back on the road, and the menu — their layout the player's (settings.touch):
//   steer:  'buttons' (left and right), 'slider' (drag along the bottom), 'tilt' (turn the device)
//   swap:   the pedals on the left and steering on the right
//   size:   0.7–1.5 · opacity: 0.2–1
// They feed the input layer (testtrack/input.js: input.touch), which drives with them while they're in use. A toggle
// action (settings.toggles) is pressed once on, once off. Every button has a name a screen reader reads.
//
//   const tc = createTouchControls(input, settings, { t })   // tc.el, tc.apply(settings), tc.show(on)

import { t as tr } from './i18n.js';

export const DEFAULT_TOUCH = { enabled: 'auto', steer: 'buttons', swap: false, size: 1, opacity: 0.6, tiltRange: 30 };
export const touchDevice = () => !!globalThis.matchMedia?.('(pointer: coarse)').matches;

export function createTouchControls(input, settings, { t = tr } = {}) {
  const el = document.createElement('div');
  el.id = 'touchControls';
  el.setAttribute('role', 'group');
  const state = { active: false, steer: 0, throttle: false, brake: false, handbrake: false, pressed: new Set() };
  input.touch = state;
  let tilt = null;

  const btn = (id, label, cls, kind = 'hold') => `<button type="button" class="tc ${cls}" data-tc="${id}" data-kind="${kind}" aria-label="${label}">${label}</button>`;
  function render() {
    const T = { ...DEFAULT_TOUCH, ...(settings.touch ?? {}) };
    el.style.setProperty('--tc-size', T.size);
    el.style.setProperty('--tc-opacity', T.opacity);
    el.classList.toggle('swap', !!T.swap);
    el.setAttribute('aria-label', t('touch.label'));
    const steer = T.steer === 'slider' ? `<div class="tc steerSlider" data-tc="slider" role="slider" aria-label="${t('touch.steer')}" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0"><span></span></div>`
      : T.steer === 'tilt' ? `<div class="tc tiltNote">${t('touch.tiltNote')}</div>`
      : `${btn('left', t('touch.left'), 'left')}${btn('right', t('touch.right'), 'right')}`;
    el.innerHTML = `<div class="tcSide steer">${steer}</div>
      <div class="tcTop">${btn('settings', t('touch.menu'), 'small', 'press')}${btn('camera', t('touch.camera'), 'small', 'press')}${btn('reset', t('touch.reset'), 'small', 'press')}</div>
      <div class="tcSide pedals">${btn('shiftDown', '−', 'small', 'press')}${btn('shiftUp', '+', 'small', 'press')}${btn('handbrake', t('touch.handbrake'), 'hb')}${btn('brake', t('touch.brake'), 'brake')}${btn('throttle', t('touch.throttle'), 'gas')}</div>`;
    el.querySelector('[data-tc=shiftDown]').setAttribute('aria-label', t('touch.shiftDown'));
    el.querySelector('[data-tc=shiftUp]').setAttribute('aria-label', t('touch.shiftUp'));
    setTilt(T.steer === 'tilt', T.tiltRange);
  }
  const held = new Map();     // pointerId → control id
  const toggles = () => settings.toggles ?? {};
  function down(id, kind) {
    state.active = true;
    if (kind === 'press') { state.pressed.add(id); return; }
    if (id === 'left' || id === 'right') { state.steer = steerFromButtons(id, true); return; }
    if (toggles()[id]) input.flip(id); else state[id] = true;
  }
  function up(id) {
    if (id === 'left' || id === 'right') { state.steer = steerFromButtons(id, false); return; }
    if (!toggles()[id] && id in state) state[id] = false;
  }
  const lr = { left: false, right: false };
  const steerFromButtons = (id, on) => { lr[id] = on; return (lr.left ? 1 : 0) - (lr.right ? 1 : 0); };
  el.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-tc]');
    if (!b) return;
    e.preventDefault();
    b.setPointerCapture?.(e.pointerId);
    if (b.dataset.tc === 'slider') { held.set(e.pointerId, 'slider'); slide(b, e); state.active = true; return; }
    held.set(e.pointerId, b.dataset.tc);
    b.classList.add('on');
    down(b.dataset.tc, b.dataset.kind);
  });
  el.addEventListener('pointermove', e => { if (held.get(e.pointerId) === 'slider') slide(e.target.closest('[data-tc=slider]') ?? el.querySelector('[data-tc=slider]'), e); });
  const release = e => {
    const id = held.get(e.pointerId);
    if (!id) return;
    held.delete(e.pointerId);
    if (id === 'slider') { state.steer = 0; el.querySelector('[data-tc=slider] span')?.style.setProperty('--x', '50%'); return; }
    el.querySelector(`[data-tc="${id}"]`)?.classList.remove('on');
    up(id);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  // (keyboard and screen readers: a button pressed with Enter or Space is a press — the pedals held while it's down)
  el.addEventListener('keydown', e => { const b = e.target.closest('[data-tc]'); if (b && (e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); down(b.dataset.tc, b.dataset.kind); } });
  el.addEventListener('keyup', e => { const b = e.target.closest('[data-tc]'); if (b && (e.key === 'Enter' || e.key === ' ')) up(b.dataset.tc); });
  function slide(b, e) {
    if (!b) return;
    const r = b.getBoundingClientRect(), x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    state.steer = -(x * 2 - 1);                      // (the car's + is left)
    b.setAttribute('aria-valuenow', (x * 2 - 1).toFixed(2));
    b.querySelector('span')?.style.setProperty('--x', `${x * 100}%`);
  }
  function setTilt(on, range) {
    if (tilt) { removeEventListener('deviceorientation', tilt); tilt = null; }
    if (!on) return;
    tilt = e => { const g = (screen.orientation?.angle ?? 0) % 180 === 0 ? e.gamma : e.beta; if (g == null) return; state.active = true; state.steer = -Math.max(-1, Math.min(1, g / range)) * Math.sign(screen.orientation?.angle === 90 ? -1 : 1); };
    addEventListener('deviceorientation', tilt);
  }
  render();
  const on = () => { const E = settings.touch?.enabled ?? 'auto'; return E === 'on' || (E === 'auto' && touchDevice()); };
  el.hidden = !on();
  return {
    el, state,
    apply() { render(); el.hidden = !on(); if (el.hidden) state.active = false; },
    show(v) { el.hidden = !v || !on(); if (el.hidden) state.active = false; },
  };
}
