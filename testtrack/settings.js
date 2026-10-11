// Settings for the test worlds: driver aids, brake bias, input device and feel, and control bindings.
// Defaults come from the car spec and the input layer; changes are kept in this browser
// (localStorage) so they survive a reload. The panel opens with O (or the gamepad's Menu button).

import { ACTIONS, DEFAULT_INPUT, DEFAULT_KEYS, DEFAULT_PAD, DEFAULT_WHEEL } from './input.js';
import { PALETTES } from '../play/palette.js';
import { graphicsOf, withPreset, withSetting, PRESETS } from '../perf/quality.js';

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
    // the graphics (Phase 8 Step 2: perf/quality.js, data/performance.json quality): { preset, values } — null until the
    // first launch's benchmark picks a preset (perf/autodetect.js); the effects' quality and tracks' detail are in it
    graphics: null,
    timeOfDay: 13,              // the test worlds' time of day (hours)
    // accessibility (play/palette.js): the quests' colours, how visible the route guides are, the HUDs' size,
    // and the first-time hints
    palette: 'standard',        // standard / colourblind
    guides: 'normal',           // normal / bold
    hudScale: 1,                // 0.6–1.6
    hints: true,
    // the sound (audio/system.js): the whole and each group's volume (0..1), and its quality (low: fewer full voices
    // for other cars, the engines' loops instead of their grains, no echo or muffling behind buildings — slow devices)
    sound: { master: 1, engine: 1, tyres: 1, impacts: 1, environment: 1, others: 1, ui: 1, music: 1, quality: 'high' },
    input: clone(DEFAULT_INPUT), keys: clone(DEFAULT_KEYS), pad: clone(DEFAULT_PAD), wheel: clone(DEFAULT_WHEEL),
  };
}

export function loadSettings(spec) {
  const s = defaultSettings(spec);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    // (groups of settings merge into their defaults; a single value — null is one, not a group — is taken
    // as saved)
    const group = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (saved) for (const k of Object.keys(s)) if (saved[k] !== undefined) s[k] = group(s[k]) ? (group(saved[k]) ? { ...s[k], ...saved[k] } : s[k]) : saved[k];
    // (an earlier version saved a value as an object here: the session's own then)
    if (s.collisions !== null && typeof s.collisions !== 'string') s.collisions = null;
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

const SOUND_ROWS = [['master', 'Everything'], ['engine', 'Engine'], ['tyres', 'Tyres and road'], ['impacts', 'Crashes'], ['environment', 'Wind and surroundings'], ['others', 'Other cars'], ['ui', 'Menus and cues'], ['music', 'Music']];
const clockText = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const bindingText = b => !b ? '—' : b.type === 'button' ? `button ${b.index}` : b.rest == null ? `axis ${b.index}${b.invert ? ' (flipped)' : ''}` : `axis ${b.index}`;

// input: the InputManager (for capturing rebinds); onChange(settings) after any change; onRehint(): every
// first-time hint unseen again
// graphics: { cfg (data/performance.json quality), stats() (perf/graphics.js), detect() (the first launch's benchmark, run
// again) } — the Graphics section
export function createSettingsPanel(settings, spec, input, onChange, { onRehint = null, graphics = null } = {}) {
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
        <h3>Races</h3>
        <label class="row"><input type="checkbox" data-bool="rubberBand" ${S.rubberBand !== false ? 'checked' : ''}> <span><b>Rubber-banding</b><small>Rivals ease off a little when well ahead of you, and push a little when behind (their driving only, never their car). Never in pink slips.</small></span></label>
        <label class="row"><input type="checkbox" data-bool="npcNames" ${S.npcNames !== false ? 'checked' : ''}> <span><b>Rivals' names over their cars</b></span></label>
        <label class="row"><input type="checkbox" data-bool="questNotices" ${S.questNotices !== false ? 'checked' : ''}> <span><b>Nearby quest notices</b><small>While free roaming, a small notice now and then when you pass a quest you haven't played.</small></span></label>
        <h3>Session</h3>
        <label class="slider">kind <select data-str="session">${[['test', 'Test drive'], ['race', 'Race']].map(([v, n]) => `<option value="${v}" ${(S.session ?? 'test') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="slider">cars <select data-str="collisions">${[['', 'The session\'s own'], ['full', 'Full damage'], ['reduced', 'Reduced damage from other cars'], ['off', 'No collisions (ghosting)']].map(([v, n]) => `<option value="${v}" ${(S.collisions ?? '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <small class="pads">A test drive: cars hit with full damage, R puts loose parts back on, B repairs everything (development). A race: reduced damage from other cars (public races will be the same), R keeps all the damage (only a wheel torn off goes back on), no free repairs — Backspace twice tows the car to the garage, ending the race.</small>
        <h3>Brakes</h3>
        <label class="slider">front bias <input type="range" min="0.5" max="0.85" step="0.01" data-num="brakeBias" value="${S.brakeBias}"> <output>${Math.round(S.brakeBias * 100)}%</output></label>
        <label class="row"><input type="checkbox" data-bool="handbrakeClutch" ${S.handbrakeClutch ? 'checked' : ''}> <span><b>Clutch in with handbrake</b><small>Keeps the engine revving through handbrake turns</small></span></label>
        <h3>Aero and air <small>K fits / removes the spoiler (its angle is its setting: garage.tune("basic_wing", "angle", 12)) · J puts an AI car ahead to slipstream</small></h3>
        <label class="slider">test altitude <input type="range" min="0" max="4000" step="100" data-num="altitude" value="${S.altitude}"> <output>${S.altitude} m</output></label>
        ${graphicsRows()}
        <label class="slider">time of day <input type="range" min="0" max="24" step="0.25" data-num="timeOfDay" value="${S.timeOfDay ?? 13}"> <output>${clockText(S.timeOfDay ?? 13)}</output></label>
        <h3>Sound <small>M on / off · Shift+M what it costs</small></h3>
        ${SOUND_ROWS.map(([k, n]) => `<label class="slider">${n} <input type="range" min="0" max="1" step="0.05" data-num="sound.${k}" value="${S.sound?.[k] ?? 1}"> <output>${Math.round((S.sound?.[k] ?? 1) * 100)}%</output></label>`).join('')}
        <label class="slider">quality <select data-str="sound.quality">${[['high', 'High'], ['low', 'Low (slower devices)']].map(([v, n]) => `<option value="${v}" ${(S.sound?.quality ?? 'high') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <small class="pads">Low: fewer other cars heard in full, the engines' simpler sound, no echoes, and no muffling behind buildings.</small>
        <h3>Accessibility</h3>
        <label class="slider">colours <select data-str="palette">${Object.entries(PALETTES).map(([v, p]) => `<option value="${v}" ${(S.palette ?? 'standard') === v ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>
        <small class="pads">Checkpoint gates, splits (ahead / behind), warnings and the route on the maps. Colour-blind friendly: blue for ahead, orange for behind, and gates and guides told apart by brightness as well as colour.</small>
        <label class="slider">route guides <select data-str="guides">${[['normal', 'Normal'], ['bold', 'More visible']].map(([v, n]) => `<option value="${v}" ${(S.guides ?? 'normal') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <small class="pads">More visible: bigger, brighter arrows on the road, taller gates that glow at night, a thicker route line on the maps and a bigger checkpoint arrow.</small>
        <label class="slider">HUD size <input type="range" min="0.6" max="1.6" step="0.05" data-num="hudScale" value="${S.hudScale ?? 1}"> <output>${Math.round((S.hudScale ?? 1) * 100)}%</output></label>
        <label class="row"><input type="checkbox" data-bool="hints" ${S.hints !== false ? 'checked' : ''}> <span><b>First-time hints</b><small>A short tip the first time you meet something new (quests, medals, rivals, pink slips, fast travel, damage). Click one to dismiss it.</small></span></label>
        <button data-rehint>Show the hints again</button>
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

  // ---------- graphics (perf/quality.js): a preset, or any setting changed (custom) ----------
  function graphicsRows() {
    if (!graphics) return '';
    const Q = graphics.cfg, G = graphicsOf(settings.graphics, Q), sel = (key, opts) => `<select data-gfx="${key}">${opts.map(([v, n]) => `<option value="${v}" ${String(G[key]) === String(v) ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const lmh = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], st = graphics.stats?.() ?? {};
    const row = (name, html, help = '') => `<label class="slider">${name} ${html}</label>${help ? `<small class="pads">${help}</small>` : ''}`;
    return `<h3>Graphics <small>Shift+P what each frame costs${st.scale ? ` · now ${Math.round(st.scale * 100)}% resolution${st.fpsLimit ? `, at most ${st.fpsLimit} fps` : ''}${st.saving ? ' (power saver)' : ''}` : ''}</small></h3>
      ${row('preset', `<select data-gfx-preset>${[...PRESETS.map(p => [p, p[0].toUpperCase() + p.slice(1)]), ['custom', 'Custom']].map(([v, n]) => `<option value="${v}" ${G.preset === v ? 'selected' : ''} ${v === 'custom' && G.preset !== 'custom' ? 'disabled' : ''}>${n}</option>`).join('')}</select>`, 'Low: older laptops and Chromebooks (30 fps). Medium: a typical laptop (60 fps). High: a gaming PC. Ultra: the most there is. Change anything below and it\'s Custom. None of it changes how the car drives.')}
      <button data-gfx-detect>${graphics.detecting ? 'Testing this computer…' : 'Test this computer and pick for me'}</button>
      <button data-gfx-bench>${graphics.benchResult?.()?.running ? 'Running the benchmarks…' : 'Run the benchmarks (about a minute)'}</button>
      ${(() => { const B = graphics.benchResult?.(); if (!B || B.running) return ''; return `<small class="pads">At ${B.preset} (the ${B.tier} tier's targets: ${B.targets.fps} fps, worst 1% ${B.targets.low1PctFps}): ${B.scenes.map(x => `${x.ok ? '✔' : '✖'} ${x.name}: ${x.fps.toFixed(0)} fps, worst 1% ${x.low1PctFps.toFixed(0)}, stutters ${(x.stutterShare * 100).toFixed(1)}%`).join(' · ') || B.error || 'nothing measured'}</small>`; })()}
      ${row('render distance', `<input type="range" min="500" max="2500" step="100" data-gfx-num="renderDistance" value="${G.renderDistance}"> <output>${G.renderDistance} m</output>`)}
      ${row('resolution', `<input type="range" min="0.5" max="1" step="0.05" data-gfx-num="resolution" value="${G.resolution}"> <output>${Math.round(G.resolution * 100)}%</output>`)}
      ${row('sharpest', sel('maxPixelRatio', [[1, '1× (fastest)'], [1.5, '1.5×'], [2, '2× (high-DPI screens)']]))}
      <label class="row"><input type="checkbox" data-gfx-bool="dynamicResolution" ${G.dynamicResolution ? 'checked' : ''}> <span><b>Dynamic resolution</b><small>Lowers the resolution by itself to keep the frame rate, never below the minimum.</small></span></label>
      ${row('minimum', `<input type="range" min="0.4" max="1" step="0.05" data-gfx-num="minResolution" value="${G.minResolution}"> <output>${Math.round(G.minResolution * 100)}%</output>`)}
      ${row('frame rate cap', sel('fpsCap', [[30, '30'], [60, '60'], [120, '120'], [0, 'Unlimited (the screen\'s)']]))}
      ${row('power saver', sel('powerSaver', [['off', 'Off'], ['battery', 'On battery'], ['always', 'Always']]), 'At most 30 fps and a lower resolution — for laptops (on battery: where the browser can tell).')}
      ${row('shadows', sel('shadows', [['off', 'Off'], ...lmh]))}
      ${row('reflections', sel('reflections', [['off', 'Off'], ['sky', 'Sky'], ['live', 'Live (surroundings)']]))}
      ${row('effects', sel('effects', lmh), 'Particles, sparks and smoke: how many, how long they last, soft edges (medium, high), little lights where sparks fly (high).')}
      ${row('anti-aliasing', sel('antialias', [['off', 'Off'], ['fxaa', 'FXAA (fast)'], ['msaa', 'MSAA 4×']]))}
      <label class="row"><input type="checkbox" data-gfx-bool="bloom" ${G.bloom ? 'checked' : ''}> <span><b>Bloom</b><small>A glow round bright lights.</small></span></label>
      <label class="row"><input type="checkbox" data-gfx-bool="motionBlur" ${G.motionBlur ? 'checked' : ''}> <span><b>Motion blur</b><small>The edges of the picture streak at speed.</small></span></label>
      ${row('car detail', sel('carDetail', [...lmh, ['ultra', 'Ultra']]), 'How far away cars are drawn whole (further: their body as one piece).')}
      ${row('detailed cars', `<input type="range" min="2" max="16" step="1" data-gfx-num="detailedCars" value="${G.detailedCars}"> <output>${G.detailedCars}</output>`, 'At most this many of the nearest cars drawn whole.')}
      ${row('damage detail', sel('damageDetail', lmh), 'How finely a crash dents the body.')}
      ${row('scenery', `<input type="range" min="0.2" max="1" step="0.05" data-gfx-num="scenery" value="${G.scenery}"> <output>${Math.round(G.scenery * 100)}%</output>`, 'Trees, rocks and the like.')}
      ${row('spectators', sel('spectators', [['off', 'Off'], ...lmh]))}
      ${row('full engine sounds', `<input type="range" min="1" max="12" step="1" data-gfx-num="fullEngineSounds" value="${G.fullEngineSounds}"> <output>${G.fullEngineSounds}</output>`, 'Other cars heard in full (the rest, simply).')}`;
  }
  const setGraphics = (key, value) => { settings.graphics = key === null ? withPreset(settings.graphics ?? {}, graphics.cfg, value) : withSetting(settings.graphics ?? {}, graphics.cfg, key, value); changed(); };

  const set = (path, value) => { const [a, b] = path.split('.'); if (b) settings[a][b] = value; else settings[a] = value; };
  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.gfxNum) { const k = t.dataset.gfxNum, v = +t.value; t.nextElementSibling.textContent = k === 'renderDistance' ? `${v} m` : /resolution|scenery/i.test(k) ? `${Math.round(v * 100)}%` : String(v); return; }
    if (t.dataset.num) { set(t.dataset.num, +t.value); saveSettings(settings); onChange(settings); t.nextElementSibling.textContent = t.dataset.num.includes('Bias') || t.dataset.num.includes('Strength') || t.dataset.num.includes('rumble') || t.dataset.num === 'hudScale' || t.dataset.num.startsWith('sound.') ? Math.round(t.value * 100) + '%' : t.dataset.num.includes('wheelRange') || t.dataset.num === 'spoilerAngle' ? t.value + '°' : t.dataset.num === 'altitude' ? t.value + ' m' : t.dataset.num === 'timeOfDay' ? clockText(+t.value) : t.value; }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.gfxPreset !== undefined) { setGraphics(null, t.value); return; }
    if (t.dataset.gfx) { const k = t.dataset.gfx, num = ['fpsCap', 'maxPixelRatio'].includes(k); setGraphics(k, num ? +t.value : t.value); return; }
    if (t.dataset.gfxNum) { setGraphics(t.dataset.gfxNum, +t.value); return; }
    if (t.dataset.gfxBool) { setGraphics(t.dataset.gfxBool, t.checked); return; }
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
    if (t.dataset.rehint !== undefined) { onRehint?.(); t.textContent = 'They\'ll show again'; return; }
    // (the panel closed while they run: open, it pauses the game — the results are here when it's opened again)
    if (t.dataset.gfxBench !== undefined && graphics?.bench && !graphics.benchResult?.()?.running) { el.hidden = true; input.capture = null; const p = graphics.bench(); p.finally?.(() => render()); return; }
    if (t.dataset.gfxDetect !== undefined && graphics?.detect && !graphics.detecting) { graphics.detecting = true; render(); graphics.detect().finally(() => { graphics.detecting = false; render(); }); return; }
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
