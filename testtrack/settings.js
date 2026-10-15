// The settings (Phase 8 Step 4: one complete menu; docs/ACCESSIBILITY.md, docs/TRANSLATIONS.md): Gameplay (driver
// aids, damage, races, brakes), Controls (the device and its feel, every action rebindable on keyboard, gamepad and
// wheel, hold or toggle, the touch controls), Graphics, Sound (and music), Accessibility, Language (and units, place
// names), Privacy and Notifications. Kept in this browser (localStorage) and, for a player with an account or a guest,
// in their account (ui/settingsSync.js), so they follow the player to another device — all but the graphics, which are
// this device's own (its benchmark picked them). The panel opens with O (or the gamepad's Menu button); it's a dialog
// of tabs a keyboard and a screen reader can use (arrow keys between the tabs, every control labelled).

import { ACTIONS, DEFAULT_INPUT, DEFAULT_KEYS, DEFAULT_PAD, DEFAULT_WHEEL, DEFAULT_TOGGLES, TOGGLEABLE } from './input.js';
import { PALETTES } from '../play/palette.js';
import { graphicsOf, withPreset, withSetting, PRESETS } from '../perf/quality.js';
import { t, i18n, esc } from '../ui/i18n.js';
import { DEFAULT_A11Y } from '../ui/accessibility.js';
import { DEFAULT_TOUCH } from '../ui/touchControls.js';

const STORE = 'driveWorld.settings.v1';
const clone = x => JSON.parse(JSON.stringify(x));
export const TABS = ['gameplay', 'controls', 'graphics', 'sound', 'accessibility', 'language', 'privacy', 'notifications'];
// (what doesn't follow the player between devices: the graphics are this device's, the rebinding of a pad or wheel
// this device's hardware's)
export const DEVICE_ONLY = ['graphics'];

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
    // the quests' colours and route guides (play/palette.js), the HUDs' size, the first-time hints
    palette: 'standard',        // standard / colourblind / tritanopia / highContrast
    guides: 'normal',           // normal / bold
    hudScale: 1,                // 0.6–1.6
    hints: true,
    // the sound (audio/system.js): the whole and each group's volume (0..1), and its quality
    sound: { master: 1, engine: 1, tyres: 1, impacts: 1, environment: 1, others: 1, ui: 1, music: 1, quality: 'high' },
    // the music (audio/music.js): where it plays, and only what may be streamed (it's all the game's own: always safe)
    music: { menu: true, garage: true, race: true, build: true, streamerSafe: true },
    // accessibility (ui/accessibility.js, ui/soundCues.js)
    a11y: clone(DEFAULT_A11Y),
    // language and units (ui/i18n.js, ui/units.js): 'auto' is the browser's; place names local (OSM's) or English
    language: 'auto', units: 'auto', placeNames: 'local',
    // privacy: anonymous play statistics (null: not asked yet — the game asks once; docs/ANALYTICS.md)
    privacy: { analytics: null, showOnline: true },
    // what the game tells you about (ui/news.js)
    notifications: { news: true, patchNotes: true, events: true, eventReminders: true },
    input: clone(DEFAULT_INPUT), keys: clone(DEFAULT_KEYS), pad: clone(DEFAULT_PAD), wheel: clone(DEFAULT_WHEEL),
    toggles: clone(DEFAULT_TOGGLES), touch: clone(DEFAULT_TOUCH),
    updatedAt: 0,               // when last changed here (ms): the newer copy wins between devices
  };
}

const group = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// saved settings over the defaults: groups merge into theirs, single values (null is one) as saved
export function mergeSettings(s, saved) {
  if (saved) for (const k of Object.keys(s)) if (saved[k] !== undefined) s[k] = group(s[k]) ? (group(saved[k]) ? { ...s[k], ...saved[k] } : s[k]) : saved[k];
  // (an earlier version saved a value as an object here: the session's own then)
  if (s.collisions !== null && typeof s.collisions !== 'string') s.collisions = null;
  // (the older colour-blind palette is the new colours setting's red–green choice)
  if (saved?.palette === 'colourblind' && !saved?.a11y?.colours) s.a11y.colours = 'deuteranopia';
  return s;
}
export function loadSettings(spec) {
  const s = defaultSettings(spec);
  try { mergeSettings(s, JSON.parse(localStorage.getItem(STORE) || 'null')); } catch { /* storage unavailable: defaults */ }
  return s;
}
const savers = new Set();
// (another part of the game hears of every save: the account's copy — ui/settingsSync.js)
export const onSave = f => { savers.add(f); return () => savers.delete(f); };
export function saveSettings(s, { touched = true } = {}) {
  if (touched) s.updatedAt = Date.now();
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* not saved */ }
  for (const f of savers) try { f(s); } catch { /* its own problem */ }
}
// what follows the player between devices
export const portable = s => Object.fromEntries(Object.entries(s).filter(([k]) => !DEVICE_ONLY.includes(k)));

const AIDS = ['abs', 'tc', 'esc', 'countersteer', 'steering', 'drift', 'revProtection'];
const SOUNDS = ['master', 'engine', 'tyres', 'impacts', 'environment', 'others', 'ui', 'music'];
const clockText = h => i18n.time(new Date(2026, 0, 1, Math.floor(h) % 24, Math.round((h % 1) * 60)));
const bindingText = b => !b ? '—' : b.type === 'button' ? t('controls.button', { n: b.index }) : b.rest == null ? t(b.invert ? 'controls.axisFlipped' : 'controls.axis', { n: b.index }) : t('controls.axis', { n: b.index });
const pct = v => i18n.number(v, { style: 'percent', maximumFractionDigits: 0 });
const opt = (v, cur, label, extra = '') => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''} ${extra}>${esc(label)}</option>`;
let uid = 0;
// a labelled control: a tick box, a slider, a list
const check = (attr, on, name, help = '') => { const id = `set${++uid}`; return `<div class="row"><input type="checkbox" id="${id}" ${attr} ${on ? 'checked' : ''}${help ? ` aria-describedby="${id}h"` : ''}> <label for="${id}"><b>${esc(name)}</b>${help ? `<small id="${id}h">${esc(help)}</small>` : ''}</label></div>`; };
const range = (attr, name, min, max, step, value, shown) => { const id = `set${++uid}`; return `<div class="slider"><label for="${id}">${esc(name)}</label> <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" ${attr} value="${value}" aria-valuetext="${esc(shown)}"> <output for="${id}">${esc(shown)}</output></div>`; };
const select = (attr, name, options, help = '') => { const id = `set${++uid}`; return `<div class="slider"><label for="${id}">${esc(name)}</label> <select id="${id}" ${attr}${help ? ` aria-describedby="${id}h"` : ''}>${options}</select></div>${help ? `<small class="pads" id="${id}h">${esc(help)}</small>` : ''}`; };

// input: the InputManager (for capturing rebinds); onChange(settings) after any change; onRehint(): every
// first-time hint unseen again; graphics: { cfg, stats(), detect(), bench(), benchResult() }; sync: the account's copy
// (ui/settingsSync.js: its status()); languages: data/languages.json
export function createSettingsPanel(settings, spec, input, onChange, { onRehint = null, graphics = null, sync = null, languages = null, onTutorial = null, onPrivacy = null } = {}) {
  const el = document.createElement('div');
  el.id = 'settings';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'settingsTitle');
  let tab = 'gameplay';
  const changed = () => { saveSettings(settings); onChange(settings); render(); };

  function render() {
    uid = 0;
    const focused = document.activeElement && el.contains(document.activeElement) ? (document.activeElement.id || document.activeElement.dataset?.tab) : null;
    el.innerHTML = `
      <div class="head"><h2 id="settingsTitle">${t('settings.title')}</h2><span>${syncText()} · ${t('settings.closeKey', { key: (settings.keys.settings ?? ['KeyO'])[0].replace(/^Key/, '') })}</span>
        <button type="button" class="close" data-close aria-label="${t('settings.close')}">×</button></div>
      <div role="tablist" class="tabs" aria-label="${t('settings.title')}">${TABS.map(x => `<button type="button" role="tab" id="tab-${x}" data-tab="${x}" aria-selected="${x === tab}" aria-controls="panel-${x}" tabindex="${x === tab ? 0 : -1}">${t(`settings.tab.${x}`)}</button>`).join('')}</div>
      <section role="tabpanel" id="panel-${tab}" aria-labelledby="tab-${tab}" tabindex="0">${SECTIONS[tab]()}</section>`;
    if (focused) (el.querySelector(`#${CSS.escape(focused)}`) ?? el.querySelector(`[data-tab="${focused}"]`))?.focus();
  }
  const syncText = () => { const st = sync?.status?.(); return st === 'synced' ? t('settings.sync.synced') : st === 'saving' ? t('settings.sync.saving') : st === 'offline' ? t('settings.sync.offline') : t('settings.sync.local'); };

  const S = () => settings;
  const SECTIONS = {
    gameplay() {
      const s = S();
      return `<h3>${t('settings.aids')}</h3>
        ${AIDS.map(k => check(`data-aid="${k}"`, s.aids[k], t(`aids.${k}.name`), t(`aids.${k}.help`)) + (k === 'tc' ? range('data-num="aids.tcStrength"', t('aids.tcStrength'), 0, 1, 0.05, s.aids.tcStrength, pct(s.aids.tcStrength)) : '')).join('')}
        ${onTutorial ? `<button type="button" data-tutorial>${t('settings.aidsAdvice')}</button>` : ''}
        <h3>${t('settings.damage')}</h3>
        ${select('data-str="damage"', t('settings.crashes'), [['full', t('damage.full')], ['visual', t('damage.visual')], ['off', t('damage.off')]].map(([v, n]) => opt(v, s.damage ?? 'full', n)).join(''), t('damage.help'))}
        ${check('data-bool="crashReplay"', s.crashReplay !== false, t('settings.crashReplay'), t('settings.crashReplayHelp'))}
        <h3>${t('settings.races')}</h3>
        ${check('data-bool="rubberBand"', s.rubberBand !== false, t('settings.rubberBand'), t('settings.rubberBandHelp'))}
        ${check('data-bool="npcNames"', s.npcNames !== false, t('settings.npcNames'))}
        ${check('data-bool="questNotices"', s.questNotices !== false, t('settings.questNotices'), t('settings.questNoticesHelp'))}
        ${check('data-bool="hints"', s.hints !== false, t('settings.hints'), t('settings.hintsHelp'))}
        <button type="button" data-rehint>${t('settings.rehint')}</button>
        <h3>${t('settings.session')}</h3>
        ${select('data-str="session"', t('settings.sessionKind'), [['test', t('session.test')], ['race', t('session.race')]].map(([v, n]) => opt(v, s.session ?? 'test', n)).join(''))}
        ${select('data-str="collisions"', t('settings.cars'), [['', t('collisions.session')], ['full', t('collisions.full')], ['reduced', t('collisions.reduced')], ['off', t('collisions.off')]].map(([v, n]) => opt(v, s.collisions ?? '', n)).join(''), t('settings.sessionHelp'))}
        <h3>${t('settings.brakes')}</h3>
        ${range('data-num="brakeBias"', t('settings.brakeBias'), 0.5, 0.85, 0.01, s.brakeBias, pct(s.brakeBias))}
        ${check('data-bool="handbrakeClutch"', s.handbrakeClutch, t('settings.handbrakeClutch'), t('settings.handbrakeClutchHelp'))}
        <h3>${t('settings.aero')}</h3>
        ${range('data-num="altitude"', t('settings.altitude'), 0, 4000, 100, s.altitude, `${i18n.number(s.altitude)} m`)}
        ${range('data-num="timeOfDay"', t('settings.timeOfDay'), 0, 24, 0.25, s.timeOfDay ?? 13, clockText(s.timeOfDay ?? 13))}`;
    },
    controls() {
      const s = S(), I = s.input, pads = input.pads();
      return `${select('data-str="input.device"', t('controls.device'), ['auto', 'keyboard', 'gamepad', 'wheel', 'touch'].map(d => opt(d, I.device, t(`controls.devices.${d}`))).join(''))}
        <small class="pads">${pads.length ? pads.map(p => esc(`${t(`controls.devices.${p.kind}`)}: ${p.pad.id}`)).join('<br>') : t('controls.noPads')}</small>
        ${range('data-num="input.wheelRange"', t('controls.wheelRange'), 180, 1080, 10, I.wheelRange, `${I.wheelRange}°`)}
        ${range('data-num="input.stickDeadzone"', t('controls.stickDeadzone'), 0, 0.4, 0.01, I.stickDeadzone, i18n.number(I.stickDeadzone))}
        ${range('data-num="input.stickCurve"', t('controls.stickCurve'), 1, 3, 0.1, I.stickCurve, i18n.number(I.stickCurve))}
        ${range('data-num="input.triggerDeadzone"', t('controls.triggerDeadzone'), 0, 0.3, 0.01, I.triggerDeadzone, i18n.number(I.triggerDeadzone))}
        ${range('data-num="input.triggerCurve"', t('controls.triggerCurve'), 1, 3, 0.1, I.triggerCurve, i18n.number(I.triggerCurve))}
        ${range('data-num="input.rumble"', t('controls.rumble'), 0, 1, 0.05, I.rumble, pct(I.rumble))}
        <h3>${t('controls.holdToggle')}</h3><small class="pads">${t('controls.holdToggleHelp')}</small>
        ${TOGGLEABLE.map(id => select(`data-toggle="${id}"`, t(`actions.${id}`), [['hold', t('controls.hold')], ['toggle', t('controls.toggle')]].map(([v, n]) => opt(v, s.toggles?.[id] ? 'toggle' : 'hold', n)).join(''))).join('')}
        <h3>${t('controls.touch')}</h3>
        ${select('data-str="touch.enabled"', t('controls.touchShow'), [['auto', t('controls.touchAuto')], ['on', t('common.on')], ['off', t('common.off')]].map(([v, n]) => opt(v, s.touch.enabled, n)).join(''))}
        ${select('data-str="touch.steer"', t('controls.touchSteer'), ['buttons', 'slider', 'tilt'].map(v => opt(v, s.touch.steer, t(`controls.touchSteerKinds.${v}`))).join(''))}
        ${check('data-bool="touch.swap"', s.touch.swap, t('controls.touchSwap'))}
        ${range('data-num="touch.size"', t('controls.touchSize'), 0.7, 1.5, 0.05, s.touch.size, pct(s.touch.size))}
        ${range('data-num="touch.opacity"', t('controls.touchOpacity'), 0.2, 1, 0.05, s.touch.opacity, pct(s.touch.opacity))}
        <h3>${t('controls.bindings')}</h3><small class="pads">${t('controls.bindingsHelp')}</small>
        <table class="binds"><caption class="sr-only">${t('controls.bindings')}</caption><tr><th scope="col">${t('controls.action')}</th><th scope="col">${t('controls.devices.keyboard')}</th><th scope="col">${t('controls.devices.gamepad')}</th><th scope="col">${t('controls.devices.wheel')}</th></tr>
          ${ACTIONS.map(a => `<tr><th scope="row">${esc(t(`actions.${a.id}`))}</th>
            <td>${a.padOnly ? '' : `<button type="button" data-bind="keys.${a.id}" aria-label="${esc(t('controls.rebind', { action: t(`actions.${a.id}`), device: t('controls.devices.keyboard') }))}">${esc((s.keys[a.id] || []).join(' / ') || '—')}</button>`}</td>
            <td>${a.keyOnly ? '' : `<button type="button" data-bind="pad.${a.id}" aria-label="${esc(t('controls.rebind', { action: t(`actions.${a.id}`), device: t('controls.devices.gamepad') }))}">${esc(bindingText(s.pad[a.id]))}</button>`}</td>
            <td>${a.keyOnly ? '' : `<button type="button" data-bind="wheel.${a.id}" aria-label="${esc(t('controls.rebind', { action: t(`actions.${a.id}`), device: t('controls.devices.wheel') }))}">${esc(bindingText(s.wheel[a.id]))}</button>`}</td></tr>`).join('')}
        </table>
        <button type="button" data-reset-controls>${t('controls.reset')}</button>`;
    },
    graphics() { return graphicsRows() || `<p>${t('graphics.none')}</p>`; },
    sound() {
      const s = S();
      return `${SOUNDS.map(k => range(`data-num="sound.${k}"`, t(`sound.${k}`), 0, 1, 0.05, s.sound?.[k] ?? 1, pct(s.sound?.[k] ?? 1))).join('')}
        ${select('data-str="sound.quality"', t('sound.quality'), [['high', t('sound.high')], ['low', t('sound.low')]].map(([v, n]) => opt(v, s.sound?.quality ?? 'high', n)).join(''), t('sound.lowHelp'))}
        <h3>${t('music.title')}</h3>
        ${['menu', 'garage', 'race'].map(k => check(`data-bool="music.${k}"`, s.music?.[k] !== false, t(`music.${k}`))).join('')}
        ${check('data-bool="music.build"', s.music?.build !== false, t('music.build'), t('music.buildHelp'))}
        ${check('data-bool="music.streamerSafe"', s.music?.streamerSafe !== false, t('music.streamerSafe'), t('music.streamerSafeHelp'))}`;
    },
    accessibility() {
      const s = S(), A = { ...DEFAULT_A11Y, ...(s.a11y ?? {}) };
      return `${range('data-num="a11y.textSize"', t('a11y.textSize'), 0.85, 1.6, 0.05, A.textSize, pct(A.textSize))}
        ${range('data-num="hudScale"', t('a11y.hudSize'), 0.6, 1.6, 0.05, s.hudScale ?? 1, pct(s.hudScale ?? 1))}
        ${select('data-str="a11y.contrast"', t('a11y.contrast'), [['normal', t('a11y.contrastNormal')], ['high', t('a11y.contrastHigh')]].map(([v, n]) => opt(v, A.contrast, n)).join(''))}
        ${select('data-str="a11y.colours"', t('a11y.colours'), ['standard', 'deuteranopia', 'protanopia', 'tritanopia'].map(v => opt(v, A.colours, t(`a11y.coloursKinds.${v}`))).join(''), t('a11y.coloursHelp'))}
        ${select('data-str="guides"', t('a11y.guides'), [['normal', t('a11y.guidesNormal')], ['bold', t('a11y.guidesBold')]].map(([v, n]) => opt(v, s.guides ?? 'normal', n)).join(''), t('a11y.guidesHelp'))}
        ${select('data-str="a11y.motion"', t('a11y.motion'), ['auto', 'full', 'reduced'].map(v => opt(v, A.motion, t(`a11y.motionKinds.${v}`))).join(''), t('a11y.motionHelp'))}
        ${range('data-num="a11y.cameraShake"', t('a11y.cameraShake'), 0, 1, 0.05, A.cameraShake, pct(A.cameraShake))}
        ${select('data-str="a11y.flashing"', t('a11y.flashing'), [['reduced', t('a11y.flashingReduced')], ['full', t('a11y.flashingFull')]].map(([v, n]) => opt(v, A.flashing, n)).join(''), t('a11y.flashingHelp'))}
        ${check('data-bool="a11y.visualSounds"', A.visualSounds, t('a11y.visualSounds'), t('a11y.visualSoundsHelp'))}
        <button type="button" data-photo-warning>${t('a11y.photo.again')}</button>`;
    },
    language() {
      const s = S(), L = languages?.languages ?? [{ code: 'en', name: 'English' }], testing = languages?.testing ?? [];
      return `${select('data-str="language"', t('language.language'), [opt('auto', s.language, t('language.auto')), ...L.map(l => opt(l.code, s.language, l.name)), ...testing.map(l => opt(l.code, s.language, l.name))].join(''), t('language.help'))}
        ${select('data-str="units"', t('language.units'), ['auto', 'metric', 'imperial'].map(v => opt(v, s.units, t(`language.unitKinds.${v}`))).join(''), t('language.unitsHelp'))}
        ${select('data-str="placeNames"', t('language.placeNames'), ['local', 'english'].map(v => opt(v, s.placeNames, t(`language.placeKinds.${v}`))).join(''), t('language.placeNamesHelp'))}
        <p class="pads">${t('language.example', { speed: '', date: i18n.date(new Date(), 'long'), money: i18n.money(12500) })}</p>`;
    },
    privacy() {
      const s = S();
      return `${select('data-str="privacy.analytics"', t('privacy.analytics'), [['', t('privacy.notAsked')], ['true', t('privacy.yes')], ['false', t('privacy.no')]].map(([v, n]) => opt(v, s.privacy?.analytics == null ? '' : String(s.privacy.analytics), n, v === '' ? 'disabled' : '')).join(''), t('privacy.analyticsHelp'))}
        ${check('data-bool="privacy.showOnline"', s.privacy?.showOnline !== false, t('privacy.showOnline'), t('privacy.showOnlineHelp'))}
        <p class="pads"><a href="/account/privacy.html" target="_blank" rel="noopener">${t('privacy.policy')}</a> · <a href="/account/" target="_blank" rel="noopener">${t('privacy.yourData')}</a></p>`;
    },
    notifications() {
      const s = S();
      return ['news', 'patchNotes', 'events', 'eventReminders'].map(k => check(`data-bool="notifications.${k}"`, s.notifications?.[k] !== false, t(`notify.${k}`), t(`notify.${k}Help`))).join('');
    },
  };

  // ---------- graphics (perf/quality.js): a preset, or any setting changed (custom) ----------
  function graphicsRows() {
    if (!graphics) return '';
    const Q = graphics.cfg, G = graphicsOf(settings.graphics, Q), sel = (key, name, opts, help) => select(`data-gfx="${key}"`, name, opts.map(([v, n]) => opt(v, G[key], n)).join(''), help);
    const lmh = [['low', t('graphics.low')], ['medium', t('graphics.medium')], ['high', t('graphics.high')]], st = graphics.stats?.() ?? {};
    const B = graphics.benchResult?.();
    return `<small class="pads">${t('graphics.costKey')}${st.scale ? ` · ${t('graphics.now', { scale: Math.round(st.scale * 100), limit: st.fpsLimit ?? 0, saving: st.saving ? 'yes' : 'no' })}` : ''} · ${t('graphics.deviceOnly')}</small>
      ${select('data-gfx-preset', t('graphics.preset'), [...PRESETS.map(p => opt(p, G.preset, t(`graphics.${p}`))), opt('custom', G.preset, t('graphics.custom'), G.preset !== 'custom' ? 'disabled' : '')].join(''), t('graphics.presetHelp'))}
      <button type="button" data-gfx-detect>${graphics.detecting ? t('graphics.detecting') : t('graphics.detect')}</button>
      <button type="button" data-gfx-bench>${B?.running ? t('graphics.benching') : t('graphics.bench')}</button>
      ${B && !B.running ? `<small class="pads">${t('graphics.benchResult', { preset: B.preset, tier: B.tier, fps: B.targets.fps, low: B.targets.low1PctFps })} ${B.scenes.map(x => `${x.ok ? '✔' : '✖'} ${esc(x.name)}: ${t('graphics.benchScene', { fps: Math.round(x.fps), low: Math.round(x.low1PctFps), stutter: (x.stutterShare * 100).toFixed(1) })}`).join(' · ') || esc(B.error || t('graphics.nothing'))}</small>` : ''}
      ${range('data-gfx-num="renderDistance"', t('graphics.renderDistance'), 500, 2500, 100, G.renderDistance, `${i18n.number(G.renderDistance)} m`)}
      ${range('data-gfx-num="resolution"', t('graphics.resolution'), 0.5, 1, 0.05, G.resolution, pct(G.resolution))}
      ${sel('maxPixelRatio', t('graphics.sharpest'), [[1, t('graphics.px1')], [1.5, '1.5×'], [2, t('graphics.px2')]])}
      ${check('data-gfx-bool="dynamicResolution"', G.dynamicResolution, t('graphics.dynamicResolution'), t('graphics.dynamicResolutionHelp'))}
      ${range('data-gfx-num="minResolution"', t('graphics.minimum'), 0.4, 1, 0.05, G.minResolution, pct(G.minResolution))}
      ${sel('fpsCap', t('graphics.fpsCap'), [[30, '30'], [60, '60'], [120, '120'], [0, t('graphics.unlimited')]])}
      ${sel('powerSaver', t('graphics.powerSaver'), [['off', t('common.off')], ['battery', t('graphics.onBattery')], ['always', t('graphics.always')]], t('graphics.powerSaverHelp'))}
      ${sel('shadows', t('graphics.shadows'), [['off', t('common.off')], ...lmh])}
      ${sel('reflections', t('graphics.reflections'), [['off', t('common.off')], ['sky', t('graphics.sky')], ['live', t('graphics.live')]])}
      ${sel('effects', t('graphics.effects'), lmh, t('graphics.effectsHelp'))}
      ${sel('antialias', t('graphics.antialias'), [['off', t('common.off')], ['fxaa', t('graphics.fxaa')], ['msaa', 'MSAA 4×']])}
      ${check('data-gfx-bool="bloom"', G.bloom, t('graphics.bloom'), t('graphics.bloomHelp'))}
      ${check('data-gfx-bool="motionBlur"', G.motionBlur, t('graphics.motionBlur'), t('graphics.motionBlurHelp'))}
      ${sel('carDetail', t('graphics.carDetail'), [...lmh, ['ultra', t('graphics.ultra')]], t('graphics.carDetailHelp'))}
      ${range('data-gfx-num="detailedCars"', t('graphics.detailedCars'), 2, 16, 1, G.detailedCars, i18n.number(G.detailedCars))}
      ${sel('damageDetail', t('graphics.damageDetail'), lmh, t('graphics.damageDetailHelp'))}
      ${range('data-gfx-num="scenery"', t('graphics.scenery'), 0.2, 1, 0.05, G.scenery, pct(G.scenery))}
      ${sel('spectators', t('graphics.spectators'), [['off', t('common.off')], ...lmh])}
      ${range('data-gfx-num="fullEngineSounds"', t('graphics.fullEngineSounds'), 1, 12, 1, G.fullEngineSounds, i18n.number(G.fullEngineSounds))}`;
  }
  const setGraphics = (key, value) => { settings.graphics = key === null ? withPreset(settings.graphics ?? {}, graphics.cfg, value) : withSetting(settings.graphics ?? {}, graphics.cfg, key, value); changed(); };

  const get = path => path.split('.').reduce((o, k) => o?.[k], settings);
  const set = (path, value) => { const ks = path.split('.'); let o = settings; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; o[ks.at(-1)] = value; };
  const shown = (path, v) => /Bias|Strength|rumble|hudScale|^sound\.|textSize|cameraShake|touch\.(size|opacity)/.test(path) ? pct(v) : /wheelRange/.test(path) ? `${v}°` : path === 'altitude' ? `${i18n.number(v)} m` : path === 'timeOfDay' ? clockText(v) : i18n.number(v);
  el.addEventListener('input', e => {
    const x = e.target;
    if (x.dataset.gfxNum) { const k = x.dataset.gfxNum, v = +x.value; x.nextElementSibling.textContent = k === 'renderDistance' ? `${i18n.number(v)} m` : /resolution|scenery/i.test(k) ? pct(v) : i18n.number(v); return; }
    if (x.dataset.num) { set(x.dataset.num, +x.value); saveSettings(settings); onChange(settings); const txt = shown(x.dataset.num, +x.value); x.nextElementSibling.textContent = txt; x.setAttribute('aria-valuetext', txt); }
  });
  el.addEventListener('change', e => {
    const x = e.target;
    if (x.dataset.gfxPreset !== undefined) { setGraphics(null, x.value); return; }
    if (x.dataset.gfx) { const k = x.dataset.gfx, num = ['fpsCap', 'maxPixelRatio'].includes(k); setGraphics(k, num ? +x.value : x.value); return; }
    if (x.dataset.gfxNum) { setGraphics(x.dataset.gfxNum, +x.value); return; }
    if (x.dataset.gfxBool) { setGraphics(x.dataset.gfxBool, x.checked); return; }
    if (x.dataset.aid) { settings.aids[x.dataset.aid] = x.checked; changed(); return; }
    if (x.dataset.bool) { set(x.dataset.bool, x.checked); changed(); return; }
    if (x.dataset.toggle) { settings.toggles ??= {}; settings.toggles[x.dataset.toggle] = x.value === 'toggle'; input.toggled = {}; changed(); return; }
    const k = x.dataset.str;
    if (!k) return;
    if (k === 'collisions') settings.collisions = x.value || null;
    else if (k === 'session') { settings.session = x.value; settings.collisions = null; }
    else if (k === 'privacy.analytics') { settings.privacy.analytics = x.value === 'true'; onPrivacy?.(settings.privacy.analytics); }
    else if (k === 'a11y.colours') { set(k, x.value); settings.palette = x.value === 'tritanopia' ? 'tritanopia' : x.value === 'standard' ? 'standard' : 'colourblind'; }
    else set(k, x.value);
    changed();
  });
  el.addEventListener('keydown', e => {
    // (the tabs: arrow keys move between them, Home and End to the first and last)
    const tb = e.target.closest('[role=tab]');
    if (!tb) return;
    const i = TABS.indexOf(tb.dataset.tab), n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (n === undefined) return;
    e.preventDefault();
    tab = TABS[(n + TABS.length) % TABS.length]; render();
    el.querySelector(`[data-tab="${tab}"]`)?.focus();
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; render(); el.querySelector(`[data-tab="${tab}"]`)?.focus(); return; }
    if (b.dataset.close !== undefined) { api.hide(); return; }
    if (b.dataset.tutorial !== undefined) { api.hide(); onTutorial?.(); return; }
    if (b.dataset.photoWarning !== undefined) { import('../ui/accessibility.js').then(m => m.photosensitivityWarning({ force: true })); return; }
    if (b.dataset.resetControls !== undefined) { Object.assign(settings, { keys: clone(DEFAULT_KEYS), pad: clone(DEFAULT_PAD), wheel: clone(DEFAULT_WHEEL), input: clone(DEFAULT_INPUT), toggles: clone(DEFAULT_TOGGLES), touch: clone(DEFAULT_TOUCH) }); changed(); return; }
    if (b.dataset.rehint !== undefined) { onRehint?.(); b.textContent = t('settings.rehinted'); return; }
    // (the panel closed while they run: open, it pauses the game — the results are here when it's opened again)
    if (b.dataset.gfxBench !== undefined && graphics?.bench && !graphics.benchResult?.()?.running) { el.hidden = true; input.capture = null; const p = graphics.bench(); p.finally?.(() => render()); return; }
    if (b.dataset.gfxDetect !== undefined && graphics?.detect && !graphics.detecting) { graphics.detecting = true; render(); graphics.detect().finally(() => { graphics.detecting = false; render(); }); return; }
    const [grp, id] = (b.dataset.bind || '').split('.');
    if (!grp) return;
    b.textContent = id === 'steer' ? t('controls.turnLeft') : t('controls.press');
    b.classList.add('listening');
    const rest = {};                                    // axis positions when rebinding started
    input.capture = ev => {
      if (ev.kind === 'key') {
        if (ev.code === 'Escape') { render(); return true; }
        if (grp !== 'keys') return false;
        settings.keys[id] = [ev.code];
      } else {
        if (grp === 'keys') return false;
        if (ev.kind === 'button') settings[grp][id] = { type: 'button', index: ev.index };
        else {
          const key = ev.pad.index + ':' + ev.index;
          if (!(key in rest)) { rest[key] = ev.value; return false; }
          if (Math.abs(ev.value - rest[key]) < 0.5) return false;
          // steering: turning left should read negative (the axis convention); pedals: 0 at rest, 1 pressed
          settings[grp][id] = id === 'steer' ? { type: 'axis', index: ev.index, invert: ev.value > rest[key] } : { type: 'axis', index: ev.index, rest: rest[key], full: Math.sign(ev.value - rest[key]) };
        }
      }
      changed();
      return true;
    };
  });
  let release = null;
  const api = {
    el,
    get open() { return !el.hidden; },
    get tab() { return tab; },
    show(which) { if (which && TABS.includes(which)) tab = which; el.hidden = false; render(); input.capture = null; import('../ui/accessibility.js').then(m => { release?.(); release = m.trapFocus(el, { onEscape: () => api.hide() }); }); },
    toggle() { if (el.hidden) api.show(); else api.hide(); },
    hide() { el.hidden = true; input.capture = null; release?.(); release = null; },
    render,
  };
  return api;
}
// (kept for older callers: the palettes the colour settings choose between)
export { PALETTES };
