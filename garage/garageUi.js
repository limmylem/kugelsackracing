// The garage screen: the HTML overlay on the 3D garage (design/garage/garage.dc.html, ui/theme.css,
// garage/garage.css). It only shows things and passes on what the player does: the garage's logic is
// the Workshop (garage/workshop.js), the 3D is the GarageScene (garage/garageScene.js).
//
//  Parts: the focus rail, markers on every socket (by condition; empty ones dashed), a socket's panel
//    (what's fitted, what in the inventory fits, sorted and filtered, locked ones with the reason,
//    a ghost on the car while one's hovered), the comparison (current vs new, what makes up each
//    stat), fitting and taking off with the animation, and the Systems list for parts with no model
//  Tuning: a slider for every setting of the fitted parts, the stats changing as they move
//  Paint: colour (picker, presets), finish, and finishes for single parts
//  Dyno: an animated run drawing torque and power, over the run before
//  Inventory: every part the player has, grouped (a count; open for each copy), with where it is;
//    install (the parts panel at a socket it goes in), sell, repair
//  Damage: the damage report (garage/damageReport.js) — a top and side view of the car with each zone
//    coloured by its worst problem, and every problem in plain words with what it does; clicking one (or a
//    zone) takes the camera there; each repaired quick or in full, or a spare fitted instead, or all of it
//    at once — the dents easing out and loose parts going back on as it happens; and the free basic
//    repair for a player who can't afford to make the car drivable
//  Shop: every part still sold (buy; "Buy & install" from the parts panel), and the dealership
//  The top bar: the player's cars and each car's setups (save, save as, rename, delete, switch —
//    with what's missing and switching anyway), the money, undo / redo, the save (automatic; save now,
//    export and import in the settings) and test drive.
//  Money and parts only change through the player service (the Workshop asks it).
//  Mouse, touch and gamepad (the D-pad moves between controls, A presses, B goes back).

import { AREAS, SYSTEMS, conditionClass, conditionWord, iconFor, socketLabel, STAT_KEYS } from './workshop.js';
import { needsRepair } from './player/profile.js';
import { dealerCar, dealerList } from './dealer.js';
import { Garage } from './data.js';
import { hasDamage } from './mechanical.js';
import { ZONE_VIEW } from './damageReport.js';
import { Hints } from './hints.js';

const PRESETS = [['Arctic White', '#EDEFF0'], ['Cement Grey', '#8C9092'], ['Graphite', '#3A3F45'], ['Midnight Black', '#111316'], ['Signal Red', '#C8202B'], ['Sunburst Orange', '#E3701E'], ['Canary Yellow', '#E8C21C'], ['Lime', '#8DC63F'],
  ['Racing Green', '#1F4D3A'], ['Teal', '#1E7F80'], ['Sky Blue', '#5EA8DB'], ['Deep Blue', '#1D3E8A'], ['Plum', '#5B2A55'], ['Rose', '#C9677E'], ['Bronze', '#8A6A3E'], ['Sand', '#C8B48E'], ['Factory Sage', '#6D9A91']];
const PAINT_FINISHES = [['gloss', 'Gloss', 'Standard'], ['matte', 'Matte', 'Flat'], ['metallic', 'Metallic', 'Flake'], ['pearl', 'Pearl', 'Colour shift']];
// parts that can have their own finish (a socket, or a group of sockets as one row)
const PART_FINISHES = [
  { label: 'Bonnet', which: ['socket_bonnet'], opts: [['Paint', null], ['Carbon', 'carbon'], ['Chrome', 'chrome']] },
  { label: 'Boot lid', which: ['socket_boot'], opts: [['Paint', null], ['Carbon', 'carbon'], ['Chrome', 'chrome']] },
  { label: 'Mirrors', which: ['socket_mirror_left', 'socket_mirror_right'], opts: [['Paint', null], ['Carbon', 'carbon'], ['Chrome', 'chrome']] },
  { label: 'Bumpers', which: ['socket_bumper_front', 'socket_bumper_rear'], opts: [['Stock', null], ['Paint', 'gloss'], ['Carbon', 'carbon']] },
  { label: 'Wheels', which: ['wheels'], opts: [['Stock', null], ['Chrome', 'chrome'], ['Black', 'matte_black']] },
];
const SORTS = [['performance', 'Performance: best first'], ['name', 'Name: A–Z'], ['category', 'Category'], ['price', 'Price: low to high'], ['condition', 'Condition: best first']];
const FILTERS = [['all', 'All'], ['owned', 'Owned'], ['shop', 'Shop'], ['upgrades', 'Upgrades']];
const TABS = [['parts', 'Parts', 'build'], ['damage', 'Damage', 'car_crash'], ['tuning', 'Tuning', 'tune'], ['paint', 'Paint', 'palette'], ['dyno', 'Dyno', 'monitoring'], ['inventory', 'Inventory', 'inventory_2'], ['shop', 'Shop', 'storefront'], ['dealer', 'Dealership', 'directions_car']];
const SEVERITY = { critical: ['Stops the car', 'var(--c-bad)'], major: ['Major', '#F28C28'], minor: ['Minor', 'var(--c-warn)'] };
const ZONE_WORDS = { front: 'the front', rear: 'the back', left: 'the left side', right: 'the right side', roof: 'the body', engine: 'the engine bay', underbody: 'underneath', FL: 'the front-left wheel', FR: 'the front-right wheel', RL: 'the rear-left wheel', RR: 'the rear-right wheel' };
const VIEW_WORDS = { front: 'front', rear: 'rear', side_left: 'left side', side_right: 'right side', roof: 'roof', engine_bay: 'engine bay', underbody: 'underside', wheel_FL: 'front-left wheel', wheel_FR: 'front-right wheel', wheel_RL: 'rear-left wheel', wheel_RR: 'rear-right wheel' };
const INV_FILTERS = [['all', 'All'], ['installed', 'Installed'], ['spare', 'Spare'], ['repair', 'Needs repair']];
const INV_SORTS = [['name', 'Name: A–Z'], ['category', 'Category'], ['value', 'Value: highest first'], ['condition', 'Condition: worst first']];
const SHOP_SORTS = [['category', 'Category'], ['price', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['name', 'Name: A–Z']];
const WIDE = new Set(['inventory', 'shop']);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (v, dec = 0) => v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(dec);
const sgn = (v, dec = 0) => { const r = +v.toFixed(dec); return r === 0 ? '±0' : (r > 0 ? '+' : '−') + fmt(Math.abs(r), dec); };
const icon = (name, extra = '') => `<span class="icon" ${extra}>${name}</span>`;
const colourOf = better => better == null ? 'var(--c-text-3)' : better ? 'var(--c-good)' : 'var(--c-bad)';
const condColour = c => c == null ? 'var(--c-text-3)' : `var(--c-${conditionClass(c)})`;
function hsvHex(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; const t = x => Math.round(x * 255).toString(16).padStart(2, '0'); return '#' + t(f(5)) + t(f(3)) + t(f(1)); }
function hexHsv(hex) { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return { h, s: mx ? d / mx : 0, v: mx }; }

// A part in a few numbers
function partSpec(p) {
  if (p.tyreSize) return `${p.tyreSize.width}/${p.tyreSize.sidewall} · ${p.tyreSize.compound.replace(/_/g, '-')} compound · ${p.mass} kg`;
  if (p.rim) return `${p.rim.diameter}″ × ${p.rim.width} · ET${p.rim.offset} · ${p.mass} kg`;
  if (p.spacer) return `${p.spacer.thickness} mm · ${p.mass} kg each`;
  if (p.engine) return `${Math.max(...p.engine.torqueCurve.map(x => x[1]))} Nm peak · ${p.engine.redlineRpm} rpm · ${p.mass} kg`;
  if (p.suspension) return `${Math.round(p.suspension.stiffness / 1000)} kN/m · ${p.suspension.damping} N·s/m${p.tuning ? ' · adjustable' : ''}`;
  if (p.gearbox) return `${p.gearbox.ratios.length}-speed · final ${p.gearbox.finalDrive}${p.tuning ? ' · adjustable' : ''}`;
  if (p.differential) return `${p.differential.type.toUpperCase()} · ${p.differential.preload} Nm · ${Math.round(p.differential.lock * 100)}% lock`;
  if (p.brakes) return `${Math.round(p.brakes.front.discRadius * 2000)} mm discs · ${p.mass} kg`;
  if (p.aero) return `wing · ${p.aero.angle?.default ?? 0}° · ${p.mass} kg`;
  const boost = p.effects?.find(e => e.op === 'boost');
  if (boost) return `${Math.max(...boost.curve.map(x => x[1]))} bar · ${p.mass} kg`;
  if (p.tuning) return `adjustable · ${p.mass} kg`;
  return `${p.mass} kg`;
}

export class GarageScreen {
  // root: the overlay element; scene: GarageScene; actions: { leave, testDrive, modeChanged } from the garage
  constructor({ root, scene, sounds, actions }) {
    this.root = root; this.scene = scene; this.sounds = sounds; this.actions = actions;
    this.reset();
    this.root.innerHTML = `<div class="layer markers ui"></div><div class="stage ui"></div>`;
    this.markersEl = this.root.querySelector('.markers');
    this.stage = this.root.querySelector('.stage');
    this.markerEls = new Map();
    // (a save file to import: the settings' "Import save")
    this.fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
    this.root.appendChild(this.fileInput);
    this.#listen();
    this.pad = { prev: [], repeat: 0 };
  }
  // (a fresh visit: the overview, nothing open; the marker labels setting stays)
  reset() {
    this.ui = { tab: 'parts', area: null, view: 'overview', panel: null, socket: null, candidate: null, filter: 'all', sort: 'performance', expanded: 'power', paintEdit: null, dyno: { t: null, overlay: null }, dialog: null, pop: null, toast: null, labels: this.ui?.labels ?? 'hover', wheelCorner: 'FL',
      inv: this.ui?.inv ?? { cat: 'all', filter: 'all', sort: 'name', q: '', open: null }, shop: this.ui?.shop ?? { cat: 'all', fits: true, sort: 'category', q: '', section: 'parts' }, dmg: { problem: null, zone: null },
      confirm: null, renaming: null, fields: {}, dealer: this.ui?.dealer ?? { carId: null, paint: null } };
    this.preview = null; this.dynoShown = null; this.ghosting = null; this.tuneBase = null;
  }
  set workshop(w) {
    this.w = w;
    this.unlisten?.();
    this.unlisten = w.on(e => {
      if (this.quiet || e.kind === 'failed') return;     // (a failed change: the action that asked says why)
      this.render();
      if (e.kind === 'profile') this.#follow();
    });
    this.render();
  }
  // What the car looks like (which parts, the paint, parts' own looks, its dents): the 3D car follows it
  #lookKey() { const w = this.w, b = w.build; return JSON.stringify([w.carInstanceId, b.sockets, w.paint, Object.values(b.sockets).map(id => (id && w.state.parts[id]?.paint) || null), w.damage]); }
  // The car as it is now onto the lift (one at a time, each with the car as it is by then)
  showCar() {
    this.carQueue = (this.carQueue ?? Promise.resolve()).then(() => {
      const w = this.w;
      this.shownLook = this.#lookKey(); this.shownSpec = w.build.fingerprint;
      return this.scene.setCar({ car: w.car, finishes: w.db.finishes, build: w.build, view: w.view, paint: w.paint, rig: this.scene.rig, spec: this.stats.spec, damage: w.damage, rules: w.db.damage });
    }).catch(err => console.warn('The garage couldn\'t show the car:', err));
    return this.carQueue;
  }
  // (the profile changed — an undo, a setup, another car, the console: the car on the lift follows,
  // unless a fitting's animation is doing it)
  #follow() {
    if (this.changing || this.loading || !this.visible || this.scene.busy || this.ui.tab === 'dealer') return;
    if (this.#lookKey() !== this.shownLook) this.showCar().then(() => this.render());
    else if (this.w.build.fingerprint !== this.shownSpec) { this.shownSpec = this.w.build.fingerprint; this.scene.setSpec(this.stats.spec); }
  }
  // A message to read and close (what loading or importing a save changed)
  notice(title, list) { this.ui.dialog = { kind: 'notices', title, list }; this.render(); }
  // A first-time hint in the garage (garage/hints.js): once ever (the save keeps it), a card over the screen
  hint(when) {
    if (!this.w) return null;
    this.hints ??= new Hints(this.w.db.hints, { seen: () => this.w.profile.hints, mark: id => this.w.service.markHint(id) });
    const h = this.hints.note(when, 'garage');
    if (!h) return null;
    this.ui.hint = h;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => { this.ui.hint = null; this.render(); }, 9000);
    this.render();
    return h;
  }

  // ---------- helpers on the workshop's data ----------
  get stats() { return this.w.stats(); }
  // (what the tuning's numbers are compared with: the car as it was when the tab was opened)
  baseStats() { return this.tuneBase ?? this.stats; }
  money(n) { return this.w.price(n); }
  sockets() { return this.w.sockets(); }
  socket(name) { return this.sockets().find(s => s.name === name); }
  area(id) { return AREAS.find(a => a.id === id); }
  #scale() { const s = Math.min(innerWidth / 1920, innerHeight / 1080); return innerWidth <= 900 ? 1 : Math.max(0.6, Math.min(1, s)); }

  // ---------- drawing ----------
  render() {
    if (!this.w) return;
    // (the whole screen is redrawn: what had the focus keeps it — and a text box its caret — and
    // lists keep where they were scrolled to)
    const active = document.activeElement, mine = active?.closest?.('#garage-root');
    const focusKey = mine ? active.dataset.key : null, caret = mine && active.tagName === 'INPUT' && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
    const scrolled = [...this.stage.querySelectorAll('[data-scroll]')].map(el => [el.dataset.scroll, el.scrollTop]);
    const zoom = this.#scale();
    this.root.style.setProperty('--g-zoom', zoom);
    this.root.classList.toggle('labels-always', this.ui.labels === 'always');
    this.root.classList.toggle('has-banner', !this.w.drivable.ok && !WIDE.has(this.ui.tab));
    const tab = this.ui.tab, wide = WIDE.has(tab), showStrip = tab !== 'dyno' && tab !== 'dealer' && !wide;
    this.stage.innerHTML = [
      this.#top(), wide || tab === 'dealer' ? '' : this.#banner(), wide || tab === 'dealer' ? '' : this.#rail(),
      `<div class="g-cam">CAM · ${esc(this.#camLabel())}</div>`,
      this.#corners(),
      tab === 'parts' && !this.ui.panel ? `<div class="g-hint">DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A MARKER TO OPEN ITS SLOT</div>` : '',
      showStrip ? this.#strip() : '',
      this.#side(),
      tab === 'dyno' ? this.#dyno() : '',
      tab === 'inventory' ? this.#inventory() : '',
      tab === 'shop' ? this.#shop() : '',
      this.ui.pop === 'settings' ? this.#settingsPop() : this.ui.pop === 'garage' ? this.#garagePop() : '',
      this.ui.toast ? `<div class="g-toast ${this.ui.toast.kind ?? ''}">${icon(this.ui.toast.icon ?? 'info')}<span>${esc(this.ui.toast.text)}</span></div>` : '',
      this.ui.hint ? `<div class="g-hintcard panel">${icon('lightbulb', 'style="color:var(--c-accent)"')}<div style="flex:1;display:flex;flex-direction:column;gap:2px"><b>${esc(this.ui.hint.title)}</b><span class="secondary-text">${esc(this.ui.hint.text)}</span></div>
        ${this.ui.hint.when === 'safetyNet' || (this.ui.hint.when === 'damageTab' && this.ui.tab !== 'damage') ? `<button class="btn secondary bar sm" data-act="tab:damage" data-key="hint-go">Damage tab</button>` : ''}<button class="icon-btn flat" data-act="hint-close" data-key="hint-close" title="Close">${icon('close')}</button></div>` : '',
      this.ui.dialog ? this.#dialog() : '',
      this.loading ? `<div class="g-loading">LOADING THE GARAGE…</div>` : '',
    ].join('');
    for (const [k, top] of scrolled) { const el = this.stage.querySelector(`[data-scroll="${CSS.escape(k)}"]`); if (el) el.scrollTop = top; }
    this.#rebuildMarkers();
    this.scene.setInsets(this.#insets(zoom));
    if (focusKey) {
      const el = this.stage.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      el?.focus({ preventScroll: true });
      if (caret && el?.setSelectionRange) el.setSelectionRange(caret[0], caret[1]);
    }
    if (tab === 'dyno') this.#drawDyno();
  }

  // (the wheels and sides: which one the camera's on)
  #corners() {
    if (this.ui.tab !== 'parts' || this.ui.panel === 'systems') return '';
    const v = this.ui.view;
    const opts = this.ui.area === 'wheels' ? [['wheel_FL', 'Front left'], ['wheel_FR', 'Front right'], ['wheel_RL', 'Rear left'], ['wheel_RR', 'Rear right']]
      : this.ui.area === 'sides' ? [['side_left', 'Left'], ['side_right', 'Right']] : null;
    return opts ? `<div class="g-corners segmented">${opts.map(([id, n]) => `<button class="${v === id ? 'on' : ''}" data-act="view:${id}" data-key="view:${id}">${n}</button>`).join('')}</div>` : '';
  }
  // what the UI covers, for the camera to centre the car in the rest
  #insets(z) {
    const t = this.ui.tab, wide = WIDE.has(t), panel = t === 'tuning' || t === 'paint' || t === 'dealer' || t === 'damage' || (t === 'parts' && !!this.ui.panel);
    if (innerWidth <= 900) return { left: 0, right: 0, top: 128, bottom: 116 + (panel || wide || t === 'dyno' ? innerHeight * 0.55 : 0) };
    // (the inventory and shop: a wide panel on the right, the car in what's left)
    if (wide) return { left: 24 * z, right: (Math.min(1040, innerWidth / z - 520) + 48) * z, top: 72 * z, bottom: 24 * z };
    return { left: 240 * z, right: panel ? 504 * z : 0, top: 72 * z, bottom: (t === 'dyno' ? 520 : 104) * z };
  }
  #camLabel() {
    if (this.ui.tab === 'dyno') return 'DYNO BAY';
    if (this.ui.tab === 'inventory') return 'PARTS STORE';
    if (this.ui.tab === 'shop') return 'SHOWROOM';
    if (this.ui.tab === 'dealer') return 'DEALERSHIP · TURNTABLE';
    if (this.ui.tab === 'paint') return 'PAINT BOOTH';
    if (this.ui.tab === 'damage') return `DAMAGE REPORT${this.ui.view !== 'overview' ? ` · ${(VIEW_WORDS[this.ui.view] ?? this.ui.view).toUpperCase()}` : ''}`;
    if (this.ui.tab === 'tuning') return 'SIDE PROFILE';
    if (this.ui.panel === 'systems') return 'SYSTEMS · MODEL GHOSTED';
    const v = this.ui.view;
    if (v.startsWith('wheel_')) return `WHEEL · ${socketLabel({ name: `socket_wheel_${v.slice(6)}` }).split(', ')[1].toUpperCase()}`;
    return v === 'overview' ? 'ORBIT' : (this.area(this.ui.area)?.label ?? v).toUpperCase();
  }

  #top() {
    const w = this.w, st = this.stats, preview = this.ui.panel === 'compare' ? this.preview?.after : null, r = (preview ?? st).totals?.rating, d = w.drivable;
    const n = w.changes().length, setup = w.activeSetup, pop = this.ui.pop;
    return `<header class="g-top">
      <button class="icon-btn" data-act="leave" data-key="leave" title="Leave the garage">${icon('arrow_back', 'style="font-size:22px"')}</button>
      <button class="g-carbtn ${pop === 'garage' ? 'on' : ''}" data-act="pop:garage" data-key="pop:garage" title="Your cars, and this car's setups">
        <div class="car-name">${esc(w.name)}${icon(pop === 'garage' ? 'expand_less' : 'expand_more')}</div>
        <div class="car-sub">${setup ? `Setup: ${esc(setup.name)}` : 'No setup'}${n ? ` <span class="warn">· ${n} change${n > 1 ? 's' : ''}</span>` : ''} · ${fmt(st.spec?.mass ?? 0)} kg</div></button>
      <div class="class-badge" title="Performance rating and class"><div class="cls">${d.ok && r ? r.class : '—'}</div><div class="pi">${d.ok && r ? r.index : '—'}</div></div>
      <div class="spacer"></div>
      <nav class="tabs">${TABS.map(([id, name, ic]) => `<button class="tab ${this.ui.tab === id ? 'on' : ''}" data-act="tab:${id}" data-key="tab:${id}" title="${name}">${icon(ic)}<span>${name}</span></button>`).join('')}</nav>
      <div class="spacer"></div>
      <div class="g-wallet" title="Your money">${icon('account_balance_wallet')}<span>${esc(this.money(w.money))}</span></div>
      <div class="actions">
        <button class="icon-btn settings" data-act="pop:settings" data-key="pop:settings" title="Garage settings and the save">${icon('settings')}</button>
        <div class="divider"></div>
        <button class="icon-btn" data-act="undo" data-key="undo" title="Undo (Ctrl+Z)" ${w.canUndo ? '' : 'disabled'}>${icon('undo')}</button>
        <button class="icon-btn" data-act="redo" data-key="redo" title="Redo (Ctrl+Shift+Z)" ${w.canRedo ? '' : 'disabled'}>${icon('redo')}</button>
      </div>
      <button class="btn secondary bar" data-act="save" data-key="save" ${!setup || n ? '' : 'disabled'} title="${setup ? esc(`Save the car as it is to the setup "${setup.name}" (Ctrl+S)`) : 'Save the car as it is as a setup'}">${icon('save')}<span class="txt">Save setup</span>${n ? `<span class="count">${n}</span>` : ''}</button>
      ${d.ok ? `<button class="btn primary bar" data-act="test" data-key="test" title="Drive this build in the test centre">${icon('sports_score')}<span class="txt">Test drive</span></button>`
        : `<button class="btn bar disabled" data-key="test" title="${esc(d.reasons[0] ?? '')}" disabled>${icon('lock')}<span class="txt">Test drive</span></button>`}
    </header>`;
  }

  #banner() {
    const d = this.w.drivable;
    if (d.ok) return '';
    const empties = this.sockets().filter(s => s.required && s.empty), missing = empties[0];
    const what = missing && this.#names(empties.map(s => s.name), false).toLowerCase(), many = empties.length > 1;
    const title = missing ? `Car can't be driven: no ${what} fitted` : "Car can't be driven";
    const text = missing ? `Fit ${many ? '' : /^[aeiou]/i.test(what) ? 'an ' : 'a '}${what} to enable test drives and dyno runs.` : d.reasons[0];
    return `<div class="g-banner banner blocker">${icon('error')}<div style="flex:1;display:flex;flex-direction:column;gap:2px"><div class="title">${esc(title)}</div><div class="text">${esc(text)}</div></div>
      ${missing ? `<button class="btn danger solid bar" data-act="goto:${missing.name}" data-key="banner">Open ${esc(this.area(missing.area)?.label.toLowerCase() ?? 'slot')}</button>` : ''}</div>`;
  }

  #rail() {
    const socks = this.sockets(), worst = list => {
      if (list.some(s => s.required && s.empty)) return 'var(--c-bad)';
      const c = list.filter(s => s.condition != null).map(s => s.condition);
      return c.length ? condColour(Math.min(...c)) : 'var(--c-text-3)';
    };
    const item = (id, label, ic, list, on) => `<button class="area ${on ? 'on' : ''}" data-act="area:${id}" data-key="area:${id}">${icon(ic)}<span class="name">${label}</span><span class="dot" style="background:${worst(list)}"></span></button>`;
    return `<aside class="g-rail">
      <div class="areas panel a90"><div class="label">Focus area</div>
        ${AREAS.map(a => item(a.id, a.label, a.icon, socks.filter(s => s.area === a.id && !s.system), this.ui.area === a.id && this.ui.panel !== 'systems')).join('')}
        <div class="sep"></div>
        ${item('systems', 'Systems', 'settings_suggest', socks.filter(s => s.system), this.ui.panel === 'systems')}
      </div>
      <div class="legend panel a90"><div class="label">Condition</div>
        <div><span class="dot" style="background:var(--c-good)"></span>Good · 70–100%</div>
        <div><span class="dot" style="background:var(--c-warn)"></span>Worn · 40–69%</div>
        <div><span class="dot" style="background:var(--c-bad)"></span>Damaged · 0–39%</div>
        <div><span class="dot empty"></span>Empty slot</div>
      </div>
    </aside>`;
  }

  #strip() {
    const now = this.stats, d = this.w.drivable;
    const other = this.ui.panel === 'compare' && this.preview?.after ? this.preview.after : null;
    const base = this.ui.tab === 'tuning' ? this.baseStats() : null;
    const keys = ['power', 'torque', 'weight', 'top', 'accel', 'rating'];
    return `<div class="g-strip panel a90">${keys.map(k => {
      const K = STAT_KEYS.find(x => x.key === k), label = k === 'rating' ? 'Rating' : K.label;
      const shown = other ?? now, v = K.of(shown), cmp = other ? K.of(now) : base ? K.of(base) : null;
      const noEngine = !d.ok && k !== 'weight';
      const value = noEngine ? '—' : k === 'rating' ? `${shown.totals?.rating?.class ?? ''} ${fmt(v)}` : fmt(v, K.dec);
      let delta = '';
      if (!noEngine && cmp != null && v != null) { const dd = v - cmp; if (+dd.toFixed(K.dec)) delta = `<span class="d" style="color:${colourOf(K.up ? dd > 0 : dd < 0)}">${sgn(dd, K.dec)}</span>`; }
      return `<div class="stat"><div class="label">${label}</div><div class="val"><span class="v">${value}</span><span class="u">${k === 'rating' ? '' : K.unit}</span>${delta}</div></div>`;
    }).join('')}</div>`;
  }

  // ---------- the right panel ----------
  #side() {
    const t = this.ui.tab;
    if (t === 'dealer') return this.#dealer();
    if (t === 'tuning') return this.#tuning();
    if (t === 'paint') return this.#paint();
    if (t === 'damage') return this.#damagePanel();
    if (t !== 'parts') return '';
    if (this.ui.panel === 'socket') return this.#partsPanel();
    if (this.ui.panel === 'compare') return this.#comparePanel();
    if (this.ui.panel === 'systems') return this.#systemsPanel();
    return '';
  }

  #partsPanel() {
    const s = this.socket(this.ui.socket);
    if (!s) return '';
    const list = this.#candidates(), area = this.area(s.area)?.label ?? '', w = this.w;
    const fix = s.instance && w.needsRepair(s.instance.instanceId) ? w.repairCost(w.profile.parts[s.instance.instanceId]) : 0, dents = s.instance ? w.profile.parts[s.instance.instanceId]?.dents?.length ?? 0 : 0, broken = s.instance && hasDamage(w.profile.parts[s.instance.instanceId]?.damage);
    const installed = s.part ? `<div class="row">
        ${thumb(s.part, s.def.slot)}
        <div class="info"><div class="name">${esc(s.part.name)}</div><div class="spec">${esc(partSpec(s.part))}</div>
          ${fix ? `<button class="g-link" style="align-self:flex-start;margin-top:2px" data-act="repair-part" data-key="repair-part" ${w.money >= fix ? '' : `disabled title="You need ${esc(this.money(fix - w.money))} more"`}>${icon('build')}Repair to 100% · ${esc(this.money(fix))}</button>` : ''}</div>
        <div class="side"><span class="badge ${conditionClass(s.condition)}">${conditionWord(s.condition, s.part)} · ${Math.round(s.condition)}%${dents ? ` · dented` : ''}${broken ? ` · damaged` : ''}</span>
          <button class="btn ghost bar" style="height:30px;padding:0 10px;font-size:14px!important" data-act="takeoff" data-key="takeoff">${icon('logout', 'style="font-size:18px"')}Take off</button></div></div>`
      : `<div class="row empty"><div class="thumb">${icon('block', 'style="font-size:26px"')}</div><div class="info"><div class="name">Empty</div><div class="secondary-text">${s.required ? "The car can't be driven without one." : 'Nothing fitted here.'}</div></div></div>`;
    return `<section class="g-side panel">
      <div class="panel-head"><div class="grow"><div class="label">${esc(area)} / ${esc(s.def.slot.replace(/_/g, ' '))}</div><div class="panel-title">${esc(s.label)}</div></div>
        <button class="icon-btn flat" data-act="close" data-key="close" title="Close">${icon('close', 'style="font-size:22px"')}</button></div>
      <div class="panel-body" data-scroll="socket:${s.name}">
        <div class="label">Installed</div>${installed}
        <div class="section-head"><div class="label">Compatible parts · ${list.length}</div>
          <button class="chip square" data-act="sort" data-key="sort">${icon('sort', 'style="font-size:18px"')}${SORTS.find(x => x[0] === this.ui.sort)[1]}</button></div>
        <div class="chips">${FILTERS.map(([id, n]) => `<button class="chip ${this.ui.filter === id ? 'on' : ''}" data-act="filter:${id}" data-key="filter:${id}">${n}</button>`).join('')}</div>
        <div class="parts" data-ghostlist>${list.length ? list.map(c => this.#partRow(c)).join('') : `<div class="empty-list">${this.ui.filter === 'owned' ? 'Nothing in your inventory fits here: the shop has what does.' : `Nothing fits here${this.ui.filter !== 'all' ? ' with this filter' : ''}.`}</div>`}</div>
      </div></section>`;
  }
  #candidates() {
    const { candidates } = this.w.partsFor(this.ui.socket);
    const f = this.ui.filter, list = candidates.filter(c => f === 'all' || (f === 'owned' && c.owned) || (f === 'shop' && !c.owned) || (f === 'upgrades' && c.ratingChange > 0));
    const by = { performance: (a, b) => (b.ratingChange - a.ratingChange) || (b.owned - a.owned) || a.part.name.localeCompare(b.part.name), name: (a, b) => a.part.name.localeCompare(b.part.name), category: (a, b) => a.part.category.localeCompare(b.part.category) || a.part.name.localeCompare(b.part.name), price: (a, b) => (a.owned ? 0 : a.price) - (b.owned ? 0 : b.price), condition: (a, b) => b.condition - a.condition }[this.ui.sort];
    return [...list].sort((a, b) => (!!a.locked - !!b.locked) || by(a, b));
  }
  #partRow(c) {
    const sel = this.ui.candidate === c.key;
    const gain = c.locked ? `<div class="lock">${icon('lock')}${esc(this.#words(c.locked.text))}</div>`
      : c.gain.length ? `<div class="gain">${c.gain.map(g => `<span style="color:${colourOf(g.better)}">${esc(g.text)}</span>`).join(' · ')}</div>` : `<div class="gain muted">no change to the numbers</div>`;
    const side = c.owned ? `<span class="badge owned plain">OWNED</span><span class="badge ${conditionClass(c.condition)}">${conditionWord(c.condition)} · ${Math.round(c.condition)}%</span>`
      : `<span style="display:flex;gap:4px">${tierBadge(c.part)}<span class="badge info plain">${icon('storefront', 'style="font-size:14px"')}Shop</span></span><span class="g-price ${c.affordable ? '' : 'bad'}">${esc(this.money(c.price))}${c.set > 1 ? `<small> · set of ${c.set}</small>` : ''}</span>`;
    return `<button class="row ${sel ? 'selected' : ''} ${c.locked ? 'locked' : ''}" data-act="${c.locked ? '' : `pick:${c.key}`}" data-ghost="${c.key}" data-key="part:${c.key}" ${c.locked ? 'aria-disabled="true"' : ''}>
      ${thumb(c.part)}
      <div class="info"><div class="name">${esc(c.part.name)}${c.count > 1 ? ` <span class="muted mono" style="font-size:13px">×${c.count}</span>` : ''}</div><div class="spec">${esc(partSpec(c.part))}</div>${gain}</div>
      <div class="side">${side}</div>
    </button>`;
  }

  #comparePanel() {
    const s = this.socket(this.ui.socket), p = this.preview;
    if (!s || !p) return '';
    const removing = this.ui.candidate === 'remove', c = removing ? null : this.#cand(this.ui.candidate), w = this.w;
    if (!removing && !c) return '';
    const part = removing ? s.part : c.part, cond = removing ? s.condition : c.condition, buying = !removing && !c.owned;
    const rows = p.rows.map(r => {
      const open = this.ui.expanded === r.key, noEngine = r.cur == null && r.next == null;
      const show = v => v == null ? '—' : r.key === 'rating' ? `${v === r.cur ? this.stats.totals?.rating?.class ?? '' : p.after.totals?.rating?.class ?? ''} ${fmt(v)}` : fmt(v, r.dec);
      const delta = r.cur != null && r.next != null && +(r.next - r.cur).toFixed(r.dec) ? sgn(r.next - r.cur, r.dec) : '—';
      return `<div class="item"><button class="tr" data-act="expand:${r.key}" data-key="stat:${r.key}"><span class="n">${esc(r.label)}</span><span class="c">${show(r.cur)}</span><span class="x">${show(r.next)}</span><span class="x" style="color:${colourOf(r.better)}">${noEngine ? '—' : delta}</span>${icon(open ? 'expand_less' : 'expand_more')}</button>
        ${open ? this.#breakdown(r) : ''}</div>`;
    }).join('');
    // what else happens: parts in the way (back on after, or not if they don't fit the new part), and
    // whether the car can still be driven (one line for a whole group of empty sockets)
    const ops = p.ops ?? [], others = ops.filter(o => o.op === 'remove' && o.socket !== this.ui.socket && !this.#sameGroup(o.socket, this.ui.socket)).map(o => o.socket);
    const goBack = others.filter(x => ops.some(o => o.op === 'install' && o.socket === x)), stayOff = others.filter(x => !goBack.includes(x));
    const empties = (p.warnings ?? []).filter(x => x.code === 'required_empty').map(x => x.socket);
    const rest = [...new Set((p.warnings ?? []).filter(x => x.code !== 'required_empty').map(x => this.#words(x.message)))];
    const notes = [
      goBack.length && !removing ? [`info`, `${this.#names(goBack)} ${goBack.length > 1 ? 'come' : 'comes'} off first and ${goBack.length > 1 ? 'go' : 'goes'} back on after.`] : null,
      stayOff.length ? ['inventory_2', `${this.#names(stayOff)} ${stayOff.length > 1 ? "don't" : "doesn't"} fit ${removing ? 'without it' : 'with this'}: ${stayOff.length > 1 ? 'they go' : 'it goes'} to the inventory.`] : null,
      empties.length ? ['error', `The car can't be driven after this: nothing in ${this.#names(empties).toLowerCase()}. That's fine while it's in the garage.`, 'bad'] : null,
      ...rest.map(t => ['warning', t]),
    ].filter(Boolean);
    const warnings = notes.map(([ic, t, kind]) => `<div class="note ${kind ?? (ic === 'info' ? '' : 'warn')}">${icon(ic)}<span>${esc(t)}</span></div>`).join('');
    return `<section class="g-side panel">
      <div class="panel-head" style="align-items:center">
        <button class="icon-btn flat" data-act="back" data-key="back" title="Back to the list">${icon('arrow_back', 'style="font-size:22px"')}</button>
        <div class="grow"><div class="label">${esc(s.label)} / ${removing ? 'Take off' : 'Preview'}</div><div class="panel-title">${esc(removing ? `Without ${part?.name ?? ''}` : part?.name ?? '')}</div></div>
        <button class="icon-btn flat" data-act="close" data-key="close" title="Close">${icon('close', 'style="font-size:22px"')}</button></div>
      <div class="panel-body" style="gap:18px" data-scroll="compare">
        <div class="g-hero">${thumb(part, s.def.slot)}
          <div class="info"><div class="spec">${esc(part ? partSpec(part) : '')}</div><div class="badges"><span class="badge ${conditionClass(cond)}">${conditionWord(cond)} · ${Math.round(cond)}%</span><span class="badge info plain">${esc(cap(part?.category ?? ''))}</span></div></div>
          <span class="badge ${buying ? 'info' : 'owned'} plain">${removing ? 'TO INVENTORY' : buying ? `NEW · ${esc(this.money(c.price))}` : 'OWNED'}</span></div>
        ${p.ok ? `<div class="g-table"><div class="thead"><span>Stat</span><span>Current</span><span>New</span><span>Change</span><span></span></div>${rows}</div>` : ''}
        ${!p.ok ? `<div class="note warn">${icon('lock')}<span>${esc(this.#words(p.reason?.text ?? p.errors?.[0]?.message ?? "It can't go on"))}${p.reason?.kind === 'blocked' ? ' Quick mode (settings, top right) does this for you.' : ''}</span></div>` : ''}
        ${warnings}
      </div>
      <div class="panel-foot" style="flex-direction:column;align-items:stretch;gap:12px">
        ${buying ? `<div class="g-kv"><span>Price${c.set > 1 ? ` · set of ${c.set}` : ''}</span><span class="mono">${esc(this.money(c.price))}</span></div>
          <div class="g-kv"><span>Your money after</span><span class="mono ${c.affordable ? '' : 'bad'}">${c.affordable ? esc(this.money(w.money - c.price)) : `${esc(this.money(c.price - w.money))} short`}</span></div>`
        : `<div class="g-kv"><span>${removing ? 'Goes to' : 'From'}</span><span class="mono">your inventory</span></div>`}
        <div style="display:flex;gap:10px"><button class="btn secondary" data-act="back" data-key="cancel">Cancel</button>
          <button class="btn primary" style="flex:1" data-act="${removing ? 'confirm-takeoff' : 'install'}" data-key="confirm" ${p.ok && !this.scene.busy && (!buying || c.affordable) ? '' : 'disabled'}>${removing ? 'Take off' : buying ? `${icon('shopping_cart')}Buy &amp; install · ${esc(this.money(c.price))}` : 'Install'}</button></div>
      </div></section>`;
  }
  // (the validator's messages name sockets by id: the player sees their names)
  #words(text) { return String(text).replace(/socket_\w+/g, n => this.socket(n)?.label ?? n); }
  // sockets in words: a whole group as one ("Tyres ×4"), else their names
  #names(list, count = true) {
    const out = [], left = new Set(list), GROUP = { spacers: 'Wheel spacers', wheels: 'Wheels', tyres: 'Tyres' };
    for (const [g, members] of Object.entries(this.w.car.socketGroups || {})) {
      const here = members.filter(m => left.has(m));
      if (here.length > 1) { out.push(`${GROUP[g] ?? g}${count ? ` ×${here.length}` : ''}`); here.forEach(m => left.delete(m)); }
    }
    for (const n of left) out.push(this.socket(n)?.label ?? n);
    return out.length > 1 ? `${out.slice(0, -1).join(', ')} and ${out.at(-1)}` : out[0] ?? '';
  }
  #sameGroup(a, b) { return Object.values(this.w.car.socketGroups || {}).some(g => g.includes(a) && g.includes(b)); }
  #breakdown(r) {
    const bd = r.breakdown ?? [], max = Math.max(1e-9, ...bd.filter(b => b.effect !== 'base').map(b => Math.abs(b.amount)));
    const tip = (r.key === 'power' || r.key === 'torque') && bd.some(b => b.effect === 'worse' && /condition/.test(b.sub)) ? 'A worn engine loses power: repairs come with the shop.' : r.key === 'rating' ? 'The rating comes from quick estimates of acceleration, top speed, grip and braking.' : null;
    const unit = r.unit ? ' ' + r.unit : '';
    return `<div class="g-breakdown well"><div class="label" style="font-size:11px">What affects ${esc(r.label.toLowerCase())}</div>
      ${bd.length ? bd.map(b => {
        const colour = b.effect === 'base' ? 'var(--c-text-2)' : b.effect === 'none' ? 'var(--c-text-3)' : b.effect === 'better' ? 'var(--c-good)' : 'var(--c-bad)';
        const v = b.effect === 'base' ? fmt(b.amount, r.dec) + unit : sgn(b.amount, r.dec > 0 ? r.dec : Math.abs(b.amount) < 1 ? 2 : 0);
        return `<div class="b"><div style="display:flex;flex-direction:column;gap:1px;min-width:0"><span class="nm">${esc(b.name)}</span><span class="sb">${esc(b.sub || ' ')}</span></div>
          <div class="bar"><div style="width:${b.effect === 'base' ? 100 : Math.abs(b.amount) / max * 100}%;background:${colour}"></div></div><span class="v" style="color:${colour}">${v}</span></div>`;
      }).join('') : '<div class="sb muted">Nothing changes it.</div>'}
      ${tip ? `<div class="note" style="padding-top:8px;border-top:1px solid var(--c-line-soft)">${icon('lightbulb')}<span>${esc(tip)}</span></div>` : ''}</div>`;
  }

  #systemsPanel() {
    // (a group of sockets — the four spacers — is one row)
    const groups = Object.entries(this.w.car.socketGroups || {}), GROUP = { spacers: 'Wheel spacers', wheels: 'Wheels', tyres: 'Tyres' };
    const socks = this.sockets().filter(s => s.system).flatMap(s => {
      const g = groups.find(([, list]) => list.includes(s.name));
      if (!g) return [s];
      if (g[1][0] !== s.name) return [];
      const all = this.sockets().filter(x => g[1].includes(x.name)), worst = all.filter(x => x.condition != null).sort((a, b) => a.condition - b.condition)[0];
      return [{ ...s, label: `${GROUP[g[0]] ?? s.label} ×${all.length}`, condition: worst?.condition ?? null, empty: all.every(x => x.empty) }];
    });
    const systems = SYSTEMS.map(g => {
      const rows = socks.filter(s => g.slots.includes(s.def.slot));
      const need = rows.filter(s => (s.condition != null && s.condition < 70) || (s.required && s.empty)).length;
      return { ...g, rows, need };
    }).filter(g => g.rows.length);
    const needTotal = systems.reduce((a, g) => a + g.need, 0) + (this.w.body.cost > 0 ? 1 : 0);      // (and the bodywork)
    return `<section class="g-side panel">
      <div class="panel-head"><div class="grow"><div class="label">Hidden components</div><div class="panel-title">Systems</div></div>
        <button class="icon-btn flat" data-act="close" data-key="close" title="Close">${icon('close', 'style="font-size:22px"')}</button></div>
      <div class="panel-body" style="gap:18px;padding-top:16px" data-scroll="systems">${this.#bodyRow()}${systems.map(g => `<div class="g-sys-group">
        <div class="gh">${icon(g.icon, 'style="color:var(--c-text-2)"')}<span class="gn">${esc(g.name)}</span><span class="secondary-text" style="font-size:13px;color:var(--c-text-3)">${g.need ? `${g.need} need attention` : 'All good'}</span></div>
        <div class="rows well">${g.rows.map(s => `<button class="g-sys-row" data-act="open:${s.name}" data-key="sys:${s.name}">
          <span class="dot ${s.empty ? 'empty' : ''}" style="${s.empty ? '' : `background:${condColour(s.condition)}`}"></span><span class="sn">${esc(s.label)}</span>
          <span class="sp">${esc(s.part?.name ?? 'Empty slot')}</span><span class="sv" style="color:${condColour(s.condition)}">${s.condition == null ? '—' : Math.round(s.condition) + '%'}</span>${icon('chevron_right', 'style="color:var(--c-text-3)"')}</button>`).join('')}</div></div>`).join('')}</div>
      <div class="panel-foot"><div style="flex:1" class="secondary-text">${needTotal ? `${needTotal} ${needTotal > 1 ? 'things need' : 'thing needs'} attention` : 'Every system is in good order'}</div>
        ${this.#repairAllButton()}</div></section>`;
  }
  // (the body shell: the car itself, without its parts — its crash damage, and repairing it)
  #bodyRow() {
    const w = this.w, b = w.body, damaged = b.cost > 0;
    const what = [b.condition < 100 && `${Math.round(b.condition)}%`, b.dents && `${b.dents} dent${b.dents > 1 ? 's' : ''}`, b.broken.length && `${b.broken.length} window${b.broken.length > 1 ? 's' : ''} or light${b.broken.length > 1 ? 's' : ''} broken`].filter(Boolean).join(' · ');
    return `<div class="g-sys-group"><div class="gh">${icon('directions_car', 'style="color:var(--c-text-2)"')}<span class="gn">Bodywork</span><span class="secondary-text" style="font-size:13px;color:var(--c-text-3)">${damaged ? 'Needs attention' : 'All good'}</span></div>
      <div class="rows well"><div class="g-sys-row" style="cursor:default"><span class="dot" style="background:${condColour(b.condition)}"></span><span class="sn">Body shell</span><span class="sp">${esc(damaged ? what : 'No damage')}</span>
        ${damaged ? `<button class="btn ghost bar sm" data-act="repair-body" data-key="repair-body" ${w.money >= b.cost ? '' : `disabled title="You need ${esc(this.money(b.cost - w.money))} more"`}>Repair · ${esc(this.money(b.cost))}</button>` : `<span class="sv" style="color:${condColour(b.condition)}">100%</span>`}</div></div></div>`;
  }
  // (every part on the car back to 100%)
  #repairAllButton() {
    const w = this.w, cost = w.repairAllCost;
    return cost ? `<button class="btn secondary bar" data-act="repair-all" data-key="repair-all" ${w.money >= cost ? '' : `disabled title="You need ${esc(this.money(cost - w.money))} more"`}>${icon('build')}Repair all · ${esc(this.money(cost))}</button>` : '';
  }

  // ---------- the damage report ----------
  #damagePanel() {
    const w = this.w, r = w.problems(), u = this.ui.dmg, net = w.safetyNet, busy = this.changing || this.scene.busy;
    const list = r.problems.filter(p => !u.zone || p.zone === u.zone), money = n => esc(this.money(n));
    const afford = n => w.money >= n ? '' : `disabled title="You need ${money(n - w.money)} more"`;
    const row = p => {
      const [sev, colour] = SEVERITY[p.severity], one = p.quick === p.full, sure = this.ui.confirm === `spare:${p.id}`;
      const spare = p.spares[0] && w.profile.parts[p.spares[0]];
      return `<div class="g-dmg-row ${u.problem === p.id ? 'on' : ''}" data-act="dmg-focus:${esc(p.id)}" data-key="dmg:${esc(p.id)}" tabindex="0" role="button">
        <span class="dot" style="background:${colour}" title="${sev}"></span>
        <div class="info"><div class="t">${esc(p.title)}</div><div class="e">${esc(cap(p.effect))}${p.stops ? ' <span class="badge bad plain">STOPS THE CAR</span>' : ''}</div></div>
        <div class="acts">
          ${one ? '' : `<button class="btn ghost bar sm" data-act="dmg-fix:quick:${esc(p.id)}" data-key="dmg-quick:${esc(p.id)}" ${busy ? 'disabled' : afford(p.quick)} title="Quick repair: about ${w.db.economy.repair.quick.condition}%, most of the dents out">Quick · ${money(p.quick)}</button>`}
          <button class="btn secondary bar sm" data-act="dmg-fix:full:${esc(p.id)}" data-key="dmg-full:${esc(p.id)}" ${busy ? 'disabled' : afford(p.full)} title="${one ? 'Repair it' : 'Full repair: as new'}">${one ? 'Fix' : 'Full'} · ${money(p.full)}</button>
          ${spare ? `<button class="btn ${sure ? 'primary' : 'ghost'} bar sm" data-act="dmg-spare:${esc(p.id)}" data-key="dmg-spare:${esc(p.id)}" ${busy ? 'disabled' : ''} title="Fit your spare ${esc(w.db.parts[spare.partId]?.name ?? '')} (${Math.round(spare.condition)}%) instead: free; this one goes to the inventory">${sure ? `Fit spare (${Math.round(spare.condition)}%)?` : `${icon('swap_horiz', 'style="font-size:16px"')}Spare`}</button>` : ''}
        </div></div>`;
    };
    const status = r.drivable.ok ? `<div class="note">${icon('check_circle', 'style="color:var(--c-good)"')}<span>${r.problems.length ? 'It can carry on racing like this.' : 'No damage: as good as new.'}</span></div>`
      : `<div class="note bad">${icon('error')}<span>It can't carry on racing: ${esc(r.drivable.reasons.join(' '))}</span></div>`;
    const banner = net.offered ? `<div class="g-dmg-net well">${icon('volunteer_activism', 'style="color:var(--c-good)"')}<div style="flex:1;display:flex;flex-direction:column;gap:4px"><b>Free basic repair</b>
        <span class="secondary-text">Making it drivable would cost ${money(net.cost)}, more than you have. The workshop will patch it up just enough to drive, for nothing.</span></div>
        <button class="btn primary bar" data-act="dmg-basic" data-key="dmg-basic" ${busy ? 'disabled' : ''}>Patch it up</button></div>`
      : net.needed ? `<div class="secondary-text" style="font-size:13px">Quick repairs of what stops it: ${money(net.cost)}.</div>` : '';
    return `<section class="g-side panel g-damage">
      <div class="panel-head"><div class="grow"><div class="label">${r.problems.length ? `${r.problems.length} problem${r.problems.length > 1 ? 's' : ''}${u.zone ? ` · ${r.problems.filter(p => p.zone === u.zone).length} ${ZONE_WORDS[u.zone] ?? u.zone}` : ''}` : 'Nothing to fix'}</div><div class="panel-title">Damage report</div></div>
        ${u.zone ? `<button class="chip on" data-act="dmg-zone:${u.zone}" data-key="dmg-zone-clear" title="Show every problem">${esc(cap(ZONE_WORDS[u.zone] ?? u.zone))} ${icon('close', 'style="font-size:16px"')}</button>` : ''}</div>
      <div class="panel-body" style="gap:14px;padding-top:14px" data-scroll="damage">
        ${this.#diagram(r)}
        ${status}${banner}
        <div class="g-dmg-list">${list.length ? list.map(row).join('') : `<div class="empty-list">${r.problems.length ? 'Nothing wrong there.' : 'Every part is as good as new.'}</div>`}</div>
      </div>
      ${r.problems.length ? `<div class="panel-foot" style="flex-direction:column;align-items:stretch;gap:10px">
        <div class="g-kv"><span>Repair everything</span><span class="mono">quick ${money(r.quick)} · full ${money(r.full)}</span></div>
        <div style="display:flex;gap:10px"><button class="btn secondary" style="flex:1" data-act="dmg-all:quick" data-key="dmg-all-quick" ${busy ? 'disabled' : afford(r.quick)}>${icon('build')}Quick · ${money(r.quick)}</button>
          <button class="btn primary" style="flex:1" data-act="dmg-all:full" data-key="dmg-all-full" ${busy ? 'disabled' : afford(r.full)}>${icon('build')}Full · ${money(r.full)}</button></div>
      </div>` : ''}</section>`;
  }
  // The car from above and from the left, each zone coloured by its worst problem (click one: the camera
  // goes there, the list shows only it)
  #diagram(r) {
    const car = this.w.car, bc = car.dimensions.bodyCollider, [hx, hy, hz] = bc.halfExtents, cz = bc.centre[2], top = bc.centre[1] + hy, floor = bc.centre[1] - hy;
    const colour = z => r.zones[z] ? SEVERITY[r.zones[z]][1] : null, sel = this.ui.dmg.zone;
    const zone = (z, shape) => `<g class="z ${sel === z ? 'sel' : ''} ${r.zones[z] ? 'hit' : ''}" data-act="dmg-zone:${z}" style="--z:${colour(z) ?? 'var(--c-line-strong)'}"><title>${esc(cap(ZONE_WORDS[z]))}${r.zones[z] ? `: ${SEVERITY[r.zones[z]][0].toLowerCase()}` : ''}</title>${shape}</g>`;
    const wheel = c => { const s = car.sockets.find(x => x.name === car.model.sockets[c]); return s ? s.position : [c.endsWith('L') ? hx : -hx, 0.3, c.startsWith('F') ? cz + hz * 0.6 : cz - hz * 0.6]; };
    const k = 40, L = 2 * hz * k, H = (top - floor + 0.08) * k, band = Math.min(0.55, hz * 0.3), engine = car.sockets.find(s => s.slot === 'engine')?.position ?? [0, 0, 1.2];
    // from above, turned on its side: the front to the right, the car's left at the top
    const X = z => 14 + (z - (cz - hz)) * k, Y = x => 22 + (hx - x) * k;
    const rect = (x0, z0, x1, z1, rx = 4) => `<rect x="${Math.min(X(z0), X(z1))}" y="${Math.min(Y(x0), Y(x1))}" width="${Math.abs(X(z1) - X(z0))}" height="${Math.abs(Y(x1) - Y(x0))}" rx="${rx}"/>`;
    const above = [
      zone('roof', rect(hx - 0.22, cz + hz - band, -hx + 0.22, cz - hz + band, 6)),
      zone('front', rect(hx, cz + hz, -hx, cz + hz - band, 12)), zone('rear', rect(hx, cz - hz + band, -hx, cz - hz, 10)),
      zone('left', rect(hx, cz + hz - band, hx - 0.22, cz - hz + band, 3)), zone('right', rect(-hx + 0.22, cz + hz - band, -hx, cz - hz + band, 3)),
      zone('engine', rect(0.32, engine[2] + 0.3, -0.32, engine[2] - 0.3, 5)),
      ...['FL', 'FR', 'RL', 'RR'].map(c => { const p = wheel(c); return zone(c, `<rect x="${X(p[2]) - 13}" y="${Y(p[0]) - 6}" width="26" height="12" rx="4"/>`); }),
    ].join('');
    // from the left, below it: the front to the right
    const oy = 22 + 2 * hx * k + 30, SY = y => oy + (top - y) * k, side = (z0, z1, y0, y1, rx = 4) => `<rect x="${X(Math.min(z0, z1))}" y="${SY(Math.max(y0, y1))}" width="${Math.abs(z1 - z0) * k}" height="${Math.abs(y1 - y0) * k}" rx="${rx}"/>`;
    const mid = floor + (top - floor) * 0.55;
    const left = [
      zone('roof', side(cz - hz * 0.45, cz + hz * 0.35, mid, top, 8)), zone('left', side(cz - hz + band, cz + hz - band, floor + 0.1, mid)),
      zone('front', side(cz + hz - band, cz + hz, floor + 0.1, mid + 0.05, 8)), zone('rear', side(cz - hz, cz - hz + band, floor + 0.1, mid + 0.05, 8)),
      zone('underbody', side(cz - hz + 0.2, cz + hz - 0.2, floor - 0.02, floor + 0.1, 3)),
      ...['FL', 'RL'].map(c => { const p = wheel(c); return zone(c, `<circle cx="${X(p[2])}" cy="${SY(p[1])}" r="${0.3 * k}"/>`); }),
    ].join('');
    const w = 28 + L, h = oy + H + 18;
    return `<div class="g-dmg-diagram well"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Where the car is damaged">
        <text x="14" y="10">FROM ABOVE · FRONT ▸</text><text x="14" y="${oy - 8}">FROM THE LEFT</text>
        ${above}${left}</svg>
      <div class="legend">${Object.entries(SEVERITY).map(([, [n, c]]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}<span><i style="background:var(--c-line-strong)"></i>Fine</span></div></div>`;
  }

  // ---------- tuning ----------
  #tuning() {
    const settings = this.w.tunable(), bySocket = new Map();
    for (const t of settings) { if (!bySocket.has(t.socket)) bySocket.set(t.socket, []); bySocket.get(t.socket).push(t); }
    const sections = [...bySocket].map(([sock, list]) => {
      const s = this.socket(sock), compact = list.length > 4;
      return `<div class="g-sec-title"><div class="label">${esc(s.label)} · ${esc(s.part.name)}</div><button class="g-link" data-act="tune-reset:${sock}" data-key="reset:${sock}">${icon('restart_alt')}Default</button></div>
        ${list.map(t => this.#slider(t, compact)).join('')}`;
    }).join('<div class="g-divider"></div>');
    const locked = this.w.tunableInInventory().map(p => `<div class="g-divider"></div><div class="g-locked"><div class="label">${esc(p.category)} · ${esc(p.name)}</div>
      ${Object.values(p.tuning).slice(0, 2).map(t => `<div class="g-setting" style="margin-top:12px"><div class="top"><span class="sl">${esc(cap(t.label))}</span><span class="sv muted">—</span></div><div class="slider"><div class="track"></div></div></div>`).join('')}</div>
      <div class="lock" style="display:flex;align-items:center;gap:6px;margin-top:-8px;font-size:13px;font-weight:600;color:var(--c-bad-soft)">${icon('lock', 'style="font-size:16px"')}Requires: ${esc(p.name)} fitted</div>`).join('');
    return `<section class="g-side panel">
      <div class="panel-head" style="flex-direction:column;gap:14px;align-items:stretch">
        <div style="display:flex;flex-direction:column;gap:4px"><div class="label">Setup · adjustable parts only</div><div class="panel-title">Tuning</div></div>
        <div class="g-effects" data-effects>${this.#effects()}</div></div>
      <div class="panel-body" style="gap:16px;padding-top:18px" data-scroll="tuning">${sections || '<div class="empty-list">No adjustable parts fitted. Fit sport coilovers, the standalone ECU, a sport LSD, the close-ratio gearbox or the rear wing to tune them.</div>'}${locked}</div>
      <div class="panel-foot"><button class="btn ghost" data-act="tune-reset:all" data-key="reset-all" ${settings.length ? '' : 'disabled'}>${icon('restart_alt')}Reset</button>
        <div class="secondary-text" style="flex:1;font-size:13px;line-height:1.35">Kept as you go. The settings stay with the part, in whichever setup it's in.</div></div></section>`;
  }
  #effects() {
    const now = this.stats, was = this.baseStats(), E = k => STAT_KEYS.find(x => x.key === k);
    const tile = (label, k) => {
      const K = E(k), v = K.of(now), b = K.of(was), d = v != null && b != null ? v - b : 0, r = +d.toFixed(K.dec);
      const val = v == null ? '—' : k === 'rating' ? `${now.totals.rating.class} ${fmt(v)}` : `${fmt(v, K.dec)}${K.unit === 's' ? ' s' : K.unit === 'g' ? ' g' : ''}`;
      return `<div><span class="el">${label}</span><span class="ev">${val}</span><span class="ed" style="color:${r ? colourOf(K.up ? d > 0 : d < 0) : 'var(--c-text-3)'}">${r ? sgn(d, K.dec) : '±0'}</span></div>`;
    };
    return tile('Grip', 'grip') + tile('Top speed', 'top') + tile('0–100', 'accel') + tile('Rating', 'rating');
  }
  #slider(t, compact) {
    const pct = (t.value - t.min) / (t.max - t.min) * 100, def = (t.default - t.min) / (t.max - t.min) * 100, changed = t.value !== t.default;
    const dec = t.step < 0.1 ? 2 : t.step < 1 ? 1 : 0, text = `${t.value.toFixed(dec)}${t.unit && t.unit !== ':1' ? ' ' + t.unit : ''}`;
    const input = `<div class="slider"><div class="track"></div><div class="fill" style="width:${pct}%"></div><div class="tick" style="left:${def}%"></div><div class="thumb-dot" style="left:${pct}%"></div>
      <input type="range" min="${t.min}" max="${t.max}" step="${t.step}" value="${t.value}" data-tune="${t.socket}|${t.setting}" data-key="tune:${t.socket}:${t.setting}" aria-label="${esc(t.label)}"></div>`;
    const sv = `<span class="sv" data-sv style="color:${changed ? 'var(--c-accent)' : 'var(--c-text-2)'}">${text}</span>`;
    return compact ? `<div class="g-setting compact"><span class="sl">${esc(cap(t.label))}</span>${input}${sv}</div>`
      : `<div class="g-setting"><div class="top"><span class="sl">${esc(cap(t.label))}</span>${sv}</div>${input}</div>`;
  }

  // ---------- paint ----------
  #paint() {
    const applied = this.w.paint, e = this.ui.paintEdit ?? { ...hexHsv(applied.colour), finish: applied.finish };
    this.ui.paintEdit = e;
    const hex = hsvHex(e.h, e.s, e.v), match = PRESETS.find(p => p[1].toLowerCase() === hex.toLowerCase());
    const pending = hex.toLowerCase() !== applied.colour.toLowerCase() || e.finish !== applied.finish;
    const rows = PART_FINISHES.map(r => {
      const fitted = r.which.flatMap(x => this.w.garage.fittedIn(x));
      if (!fitted.length) return '';
      const cur = fitted[0].instance.paint?.finish ?? null;
      return `<div class="pf"><span class="pn">${r.label}</span><div class="segmented">${r.opts.map(([n, f]) => `<button class="${cur === f ? 'on' : ''}" data-act="pf:${r.label}:${f ?? ''}" data-key="pf:${r.label}:${n}">${n}</button>`).join('')}</div></div>`;
    }).join('');
    return `<section class="g-side panel">
      <div class="panel-head" style="flex-direction:column;gap:4px;align-items:stretch"><div class="label">Body colour · finish · part finishes</div><div class="panel-title">Paint</div></div>
      <div class="panel-body" style="gap:14px;padding-top:18px" data-scroll="paint">
        <div class="g-sv" data-pick="sv" style="background:linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${e.h},100%,50%))"><div class="knob" style="left:${e.s * 100}%;top:${(1 - e.v) * 100}%"></div></div>
        <div class="g-hue" data-pick="hue"><div class="knob" style="left:${e.h / 360 * 100}%;background:hsl(${e.h},100%,50%)"></div></div>
        <div class="g-colour"><div class="sw" style="background:${hex}"></div><div style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:600" data-cname>${esc(match ? match[0] : 'Custom colour')}</span><span class="mono" style="font-size:13px;color:var(--c-text-2)" data-chex>${hex.toUpperCase()}</span></div></div>
        <div class="label" style="margin-top:4px">Presets</div>
        <div class="g-presets">${PRESETS.slice(0, 16).map(([n, h]) => `<button class="${h.toLowerCase() === hex.toLowerCase() ? 'on' : ''}" style="background:${h}" data-act="preset:${h}" data-key="preset:${h}" title="${esc(n)}"></button>`).join('')}</div>
        <div class="label" style="margin-top:4px">Finish</div>
        <div class="g-finishes">${PAINT_FINISHES.map(([id, n, d]) => `<button class="${e.finish === id ? 'on' : ''}" data-act="finish:${id}" data-key="finish:${id}"><span class="fn">${n}</span><span class="fp">${d}</span></button>`).join('')}</div>
        ${rows ? `<div class="label" style="margin-top:4px">Part finishes</div><div class="g-part-fins well">${rows}</div>` : ''}
      </div>
      <div class="panel-foot"><div style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;color:var(--c-text-3)">Body paint</span><span class="mono" style="font-size:16px;font-weight:600">${applied.colour.toUpperCase()} · ${esc(this.w.db.finishes[applied.finish]?.name ?? applied.finish)}</span></div>
        <button class="btn primary" style="padding:0 28px" data-act="apply-paint" data-key="apply-paint" ${pending ? '' : 'disabled'}>Apply paint</button></div></section>`;
  }

  // ---------- dyno ----------
  #dyno() {
    const runs = this.w.runs, cur = this.dynoShown ?? runs[0] ?? null, overlay = runs.find(r => r.id === this.ui.dyno.overlay) ?? runs.find(r => r !== cur) ?? null;
    const d = this.w.drivable, peak = (run, k) => run ? (k === 'p' ? run.peakPower : run.peakTorque) : null;
    const delta = (k, unit) => { if (!cur || !overlay) return ''; const dd = k === 'p' ? cur.peakPower.hp - overlay.peakPower.hp : cur.peakTorque.nm - overlay.peakTorque.nm; return `<span class="pd" style="color:${colourOf(Math.round(dd) ? dd > 0 : null)}">${sgn(dd)} ${unit} vs ${esc(overlay.name)}</span>`; };
    return `<section class="g-dyno panel">
      <div class="dh"><span class="dt">Dyno</span><span class="secondary-text" style="color:var(--c-text-3)">Chassis dyno · wheel output · 20 °C</span><div style="flex:1"></div>
        <div class="legend"><span><span style="width:22px;height:3px;background:var(--c-accent)"></span>Power</span><span><span style="width:22px;height:3px;background:var(--c-text)"></span>Torque</span>${overlay ? `<span><span style="width:22px;height:0;border-top:2px dashed var(--c-text-3)"></span>${esc(overlay.name)} (overlay)</span>` : ''}</div></div>
      <div class="db"><svg viewBox="0 0 1080 400" preserveAspectRatio="none" data-dyno></svg>
        <div class="dside">
          <div class="peaks">
            <div class="peak well"><span class="label" style="font-size:11px">Peak power</span><span class="pv" style="color:var(--c-accent)">${cur ? fmt(peak(cur, 'p').hp) : '—'}<small> hp</small></span><span class="pr">${cur ? `@ ${fmt(peak(cur, 'p').rpm)} rpm` : 'no run yet'}</span>${delta('p', 'hp')}</div>
            <div class="peak well"><span class="label" style="font-size:11px">Peak torque</span><span class="pv">${cur ? fmt(peak(cur, 't').nm) : '—'}<small> Nm</small></span><span class="pr">${cur ? `@ ${fmt(peak(cur, 't').rpm)} rpm` : ''}</span>${delta('t', 'Nm')}</div>
          </div>
          <div class="label" style="font-size:11px">Runs · click to overlay</div>
          <div class="runs">${runs.map((r, i) => `<button class="run ${overlay === r ? 'overlay' : ''}" data-act="overlay:${r.id}" data-key="run:${r.id}"><span class="rn">${esc(r.name)}</span><span class="rt">${esc(r.note)}</span><span class="rp">${fmt(r.peakPower.hp)} hp · ${fmt(r.peakTorque.nm)} Nm</span><span class="rg" style="color:${i === 0 ? 'var(--c-accent)' : 'var(--c-text-2)'}">${i === 0 ? 'LATEST' : overlay === r ? 'OVERLAY' : ''}</span></button>`).join('') || '<div class="secondary-text">No runs yet.</div>'}</div>
          <div style="flex:1"></div>
          <button class="btn primary" data-act="dyno-run" data-key="dyno-run" ${d.ok && this.ui.dyno.t == null ? '' : 'disabled'}>${icon(d.ok ? 'play_arrow' : 'lock')}${this.ui.dyno.t != null ? 'Running…' : 'Run dyno'}</button>
        </div></div></section>`;
  }
  // the chart (redrawn each frame while a run is going)
  #drawDyno() {
    const svg = this.stage.querySelector('[data-dyno]');
    if (!svg) return;
    const runs = this.w.runs, cur = this.dynoShown ?? runs[0], overlay = runs.find(r => r.id === this.ui.dyno.overlay) ?? runs.find(r => r !== cur);
    const all = [cur, overlay].filter(Boolean), maxRpm = Math.max(7000, ...all.map(r => Math.ceil((r.points.at(-1).rpm + 200) / 1000) * 1000));
    const maxHp = Math.max(160, ...all.map(r => Math.ceil(r.peakPower.hp / 40) * 40)), maxNm = Math.max(200, ...all.map(r => Math.ceil(r.peakTorque.nm / 50) * 50));
    const X = r => 56 + (r - 1000) / (maxRpm - 1000) * 968, YP = p => 364 - p / maxHp * 348, YT = t => 364 - t / maxNm * 348;
    const path = (run, key, Y, upTo = Infinity) => { const pts = run.points.filter(p => p.rpm <= upTo); return pts.length ? 'M' + pts.map(p => `${X(p.rpm).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(' L') : ''; };
    const t = this.ui.dyno.t, sweep = t == null ? Infinity : cur.points[0].rpm + (cur.points.at(-1).rpm - cur.points[0].rpm) * t;
    let s = '';
    for (let k = 1; k <= maxRpm / 1000; k++) if (k * 1000 >= 1000) s += `<line x1="${X(k * 1000)}" x2="${X(k * 1000)}" y1="16" y2="364" stroke="#1C2228"/><text x="${X(k * 1000)}" y="386" fill="#6B7480" font-family="JetBrains Mono" font-size="12" text-anchor="middle">${k}k rpm</text>`;
    for (let i = 0; i <= 4; i++) { const y = 364 - i * 87; s += `<line x1="56" x2="1024" y1="${y}" y2="${y}" stroke="#1C2228"/><text x="46" y="${y + 4}" fill="#36B3F5" font-family="JetBrains Mono" font-size="12" text-anchor="end">${Math.round(maxHp / 4 * i)}</text><text x="1034" y="${y + 4}" fill="#A3ABB5" font-family="JetBrains Mono" font-size="12">${Math.round(maxNm / 4 * i)}</text>`; }
    s += `<text x="46" y="10" fill="#6B7480" font-family="JetBrains Mono" font-size="11" text-anchor="end">HP</text><text x="1034" y="10" fill="#6B7480" font-family="JetBrains Mono" font-size="11">NM</text>`;
    if (overlay) s += `<path d="${path(overlay, 'hp', YP)}" fill="none" stroke="#36B3F5" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="6 6"/><path d="${path(overlay, 'nm', YT)}" fill="none" stroke="#E9ECEF" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="6 6"/>`;
    if (cur) {
      s += `<path d="${path(cur, 'nm', YT, sweep)}" fill="none" stroke="#E9ECEF" stroke-width="2.5"/><path d="${path(cur, 'hp', YP, sweep)}" fill="none" stroke="#36B3F5" stroke-width="3"/>`;
      if (t == null) s += `<circle cx="${X(cur.peakPower.rpm)}" cy="${YP(cur.peakPower.hp)}" r="5" fill="#0B0E11" stroke="#36B3F5" stroke-width="2.5"/><circle cx="${X(cur.peakTorque.rpm)}" cy="${YT(cur.peakTorque.nm)}" r="5" fill="#0B0E11" stroke="#E9ECEF" stroke-width="2.5"/>`;
      else s += `<line x1="${X(sweep)}" x2="${X(sweep)}" y1="16" y2="364" stroke="#36B3F5" stroke-opacity="0.6"/><text x="${X(sweep) + 6}" y="30" fill="#36B3F5" font-family="JetBrains Mono" font-size="12">${Math.round(sweep)} rpm</text>`;
    } else s += `<text x="540" y="200" fill="#6B7480" font-family="JetBrains Mono" font-size="14" text-anchor="middle">RUN THE DYNO TO DRAW THE CURVES</text>`;
    svg.innerHTML = s;
  }

  // ---------- inventory ----------
  // Every copy the player has, grouped by part (a count; opened, each copy's condition and where it is)
  #inventory() {
    const w = this.w, u = this.ui.inv, all = w.allParts(), q = u.q.trim().toLowerCase();
    const cats = [...new Set(all.map(x => x.part.category))].sort();
    if (u.cat !== 'all' && !cats.includes(u.cat)) u.cat = 'all';
    const shown = all.filter(x => (u.cat === 'all' || x.part.category === u.cat)
      && (u.filter === 'all' || (u.filter === 'installed' && x.instance.installedOn) || (u.filter === 'spare' && !x.instance.installedOn) || (u.filter === 'repair' && (needsRepair(x.instance))))
      && (!q || x.part.name.toLowerCase().includes(q) || x.part.category.includes(q) || x.part.id.includes(q)));
    const byPart = new Map();
    for (const x of shown) { if (!byPart.has(x.part.id)) byPart.set(x.part.id, []); byPart.get(x.part.id).push(x); }
    const groups = [...byPart.values()].map(copies => ({
      part: copies[0].part, copies: copies.sort((a, b) => (!!a.instance.installedOn - !!b.instance.installedOn) || b.instance.condition - a.instance.condition),
      value: copies.reduce((a, x) => a + x.sell, 0), worst: Math.min(...copies.map(x => x.instance.condition)),
      mine: copies.filter(x => x.mine).length, elsewhere: copies.filter(x => x.instance.installedOn && !x.mine).length, spare: copies.filter(x => !x.instance.installedOn).length,
    }));
    const by = { name: (a, b) => a.part.name.localeCompare(b.part.name), category: (a, b) => a.part.category.localeCompare(b.part.category) || a.part.name.localeCompare(b.part.name), value: (a, b) => b.value - a.value, condition: (a, b) => a.worst - b.worst }[u.sort];
    groups.sort((a, b) => by(a, b) || a.part.name.localeCompare(b.part.name));
    const spare = all.filter(x => !x.instance.installedOn).length, worth = all.reduce((a, x) => a + x.sell, 0);
    const worn = shown.filter(x => needsRepair(x.instance)), fixAll = worn.reduce((a, x) => a + x.repair, 0);
    return `<section class="g-wide panel">
      <div class="panel-head" style="align-items:center">
        <div class="grow"><div class="label">${all.length} part${all.length === 1 ? '' : 's'} · ${spare} spare · worth ${esc(this.money(worth))} to sell</div><div class="panel-title">Inventory</div></div>
        <label class="g-search">${icon('search')}<input class="g-input" type="text" placeholder="Search your parts" data-field="inv.q" data-key="inv-q" value="${esc(u.q)}" aria-label="Search your parts"></label>
        <button class="icon-btn flat" data-act="tab:parts" data-key="close" title="Close">${icon('close', 'style="font-size:22px"')}</button></div>
      <div class="g-toolbar">
        <div class="chips">${['all', ...cats].map(c => `<button class="chip ${u.cat === c ? 'on' : ''}" data-act="inv-cat:${c}" data-key="inv-cat:${c}">${c === 'all' ? 'All' : esc(catName(c))}</button>`).join('')}</div>
        <div class="g-toolbar-row"><div class="segmented">${INV_FILTERS.map(([id, n]) => `<button class="${u.filter === id ? 'on' : ''}" data-act="inv-filter:${id}" data-key="inv-filter:${id}">${n}</button>`).join('')}</div>
          <div style="flex:1"></div><button class="chip square" data-act="inv-sort" data-key="inv-sort">${icon('sort', 'style="font-size:18px"')}${INV_SORTS.find(x => x[0] === u.sort)[1]}</button></div></div>
      <div class="panel-body g-inv" data-scroll="inventory">${groups.length ? groups.map(gp => this.#invGroup(gp)).join('')
        : `<div class="empty-list">${all.length ? 'No parts match.' : 'No parts yet.'} ${all.length ? '' : '<button class="g-link" style="display:inline-flex" data-act="tab:shop">Go to the shop</button>'}</div>`}</div>
      <div class="panel-foot"><div class="secondary-text" style="flex:1">${worn.length ? `${worn.length} part${worn.length > 1 ? 's' : ''} below 100%${u.filter !== 'all' || u.cat !== 'all' || q ? ' in this list' : ''}` : 'Everything here is in perfect condition.'}</div>
        ${fixAll ? `<button class="btn secondary bar" data-act="repair-shown" data-key="repair-shown" ${w.money >= fixAll ? '' : `disabled title="You need ${esc(this.money(fixAll - w.money))} more"`}>${icon('build')}Repair ${worn.length > 1 ? `all ${worn.length}` : 'it'} · ${esc(this.money(fixAll))}</button>` : ''}</div>
    </section>`;
  }
  #invGroup(gp) {
    const one = gp.copies.length === 1, open = !one && this.ui.inv.open === gp.part.id;
    const where = [gp.mine && `${gp.mine} on this car`, gp.elsewhere && `${gp.elsewhere} on ${gp.elsewhere === 1 && one ? gp.copies[0].car : 'other cars'}`, gp.spare && `${gp.spare} spare`].filter(Boolean).join(' · ');
    const head = `${thumb(gp.part)}
      <div class="info"><div class="name">${esc(gp.part.name)}${one ? '' : ` <span class="mono muted" style="font-size:14px">×${gp.copies.length}</span>`}${gp.part.retired ? ' <span class="badge info plain">No longer sold</span>' : ''}</div>
        <div class="spec">${esc(catName(gp.part.category))} · ${esc(partSpec(gp.part))}</div>
        <div class="where">${gp.mine ? icon('directions_car', 'style="font-size:15px;color:var(--c-accent)"') : ''}${esc(one && gp.copies[0].mine ? `On this car · ${this.socket(gp.copies[0].socket)?.label ?? ''}` : where)}</div></div>
      <span class="badge ${conditionClass(gp.worst)}">${one || gp.copies.every(x => x.instance.condition === gp.worst) ? '' : 'worst '}${Math.round(gp.worst)}%</span>`;
    return `<div class="g-inv-group ${open ? 'open' : ''}">
      <div class="g-inv-row">${one ? `<div class="main">${head}</div>${this.#copyActions(gp.copies[0])}`
        : `<button class="main" data-act="inv-open:${gp.part.id}" data-key="inv-open:${gp.part.id}" aria-expanded="${open}">${head}<span class="g-worth mono">${esc(this.money(gp.value))}</span>${icon(open ? 'expand_less' : 'expand_more', 'style="color:var(--c-text-3)"')}</button>`}</div>
      ${open ? `<div class="g-copies well">${gp.copies.map(x => `<div class="g-copy">
          <span class="badge ${conditionClass(x.instance.condition)}">${conditionWord(x.instance.condition, x.part ?? gp.part)} · ${Math.round(x.instance.condition)}%</span>
          <span class="cw">${esc(x.instance.installedOn ? (x.mine ? `On this car · ${this.socket(x.socket)?.label ?? x.socket}` : `On ${x.car}`) : 'Spare')}${x.instance.tuning && Object.keys(x.instance.tuning).length ? ' · tuned' : ''}${x.instance.paint?.finish ? ` · ${esc(x.instance.paint.finish.replace(/_/g, ' '))}` : ''}</span>
          ${this.#copyActions(x)}</div>`).join('')}</div>` : ''}
    </div>`;
  }
  // (one copy: fit it, or show it on the car; repair it; sell it — not while it's on a car)
  #copyActions(x) {
    const w = this.w, id = x.instance.instanceId, on = x.instance.installedOn, sure = this.ui.confirm === `sell:${id}`;
    const fits = !on && w.fitsCar(x.part);
    return `<div class="acts">
      ${x.mine ? `<button class="btn ghost bar sm" data-act="inv-show:${id}" data-key="show:${id}" title="Open its slot on the car">${icon('visibility')}Show</button>`
        : fits ? `<button class="btn secondary bar sm" data-act="inv-install:${id}" data-key="install:${id}" title="Fit it to ${esc(w.name)}">${icon('build')}Install</button>` : ''}
      ${needsRepair(x.instance) ? `<button class="btn ghost bar sm" data-act="repair:${id}" data-key="repair:${id}" ${w.money >= x.repair ? '' : `disabled title="You need ${esc(this.money(x.repair - w.money))} more"`}>Repair · ${esc(this.money(x.repair))}</button>` : ''}
      <button class="btn ${sure ? 'danger solid' : 'ghost'} bar sm" data-act="sell:${id}" data-key="sell:${id}" ${on ? `disabled title="${esc(x.mine ? 'Take it off the car first' : `It's on ${x.car}: take it off first`)}"` : `title="${sure ? 'Click again to sell it' : 'Sell it'}"`}>${sure ? `Sell for ${esc(this.money(x.sell))}?` : `Sell · ${esc(this.money(x.sell))}`}</button>
    </div>`;
  }

  // ---------- shop ----------
  #shop() {
    const w = this.w, u = this.ui.shop;
    const head = `<div class="panel-head" style="align-items:center">
        <div class="grow"><div class="label">${u.section === 'cars' ? 'Dealership · cars come with their factory parts' : 'Parts · new, at 100%'}</div><div class="panel-title">Shop</div></div>
        <div class="segmented">${[['parts', 'Parts', 'shop-section:parts'], ['cars', 'Cars', 'tab:dealer']].map(([id, n, act]) => `<button class="${u.section === id ? 'on' : ''}" data-act="${act}" data-key="shop-section:${id}">${n}</button>`).join('')}</div>
        ${u.section === 'parts' ? `<label class="g-search">${icon('search')}<input class="g-input" type="text" placeholder="Search the shop" data-field="shop.q" data-key="shop-q" value="${esc(u.q)}" aria-label="Search the shop"></label>` : ''}
        <button class="icon-btn flat" data-act="tab:parts" data-key="close" title="Close">${icon('close', 'style="font-size:22px"')}</button></div>`;
    if (u.section === 'cars') return `<section class="g-wide panel">${head}<div class="panel-body" data-scroll="dealer"><div class="g-shop-grid">${w.dealer().map(c => this.#dealerCard(c)).join('')}</div></div></section>`;
    const all = w.catalogue(), q = u.q.trim().toLowerCase(), cats = [...new Set(all.map(c => c.part.category))].sort();
    const list = all.filter(c => (u.cat === 'all' || c.part.category === u.cat) && (!u.fits || c.fits) && (!q || c.part.name.toLowerCase().includes(q) || c.part.category.includes(q) || c.part.id.includes(q)));
    const by = { category: (a, b) => a.part.category.localeCompare(b.part.category) || a.price - b.price, price: (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price, name: (a, b) => a.part.name.localeCompare(b.part.name) }[u.sort];
    list.sort((a, b) => by(a, b) || a.part.name.localeCompare(b.part.name));
    return `<section class="g-wide panel">${head}
      <div class="g-toolbar">
        <div class="chips">${['all', ...cats].map(c => `<button class="chip ${u.cat === c ? 'on' : ''}" data-act="shop-cat:${c}" data-key="shop-cat:${c}">${c === 'all' ? 'All' : esc(catName(c))}</button>`).join('')}</div>
        <div class="g-toolbar-row"><button class="chip square ${u.fits ? 'on' : ''}" data-act="shop-fits" data-key="shop-fits" aria-pressed="${u.fits}">${icon(u.fits ? 'check_box' : 'check_box_outline_blank', 'style="font-size:18px"')}Fits my ${esc(w.car.name.toLowerCase())}</button>
          <span class="secondary-text" style="font-size:13px">${list.length} of ${all.length} parts</span>
          <div style="flex:1"></div><button class="chip square" data-act="shop-sort" data-key="shop-sort">${icon('sort', 'style="font-size:18px"')}${SHOP_SORTS.find(x => x[0] === u.sort)[1]}</button></div></div>
      <div class="panel-body" data-scroll="shop">${list.length ? `<div class="g-shop-grid">${list.map(c => this.#shopCard(c)).join('')}</div>` : `<div class="empty-list">Nothing in the shop matches${u.fits ? ' that fits this car' : ''}.</div>`}</div>
    </section>`;
  }
  #shopCard(c) {
    const w = this.w, id = c.part.id, afford = w.money >= c.price, socket = c.fits ? w.socketFor(id) : null, fitted = socket && this.sockets().some(s => s.part?.id === id), soon = !!c.part.todo?.length;
    return `<div class="g-card">
      <div class="top">${thumb(c.part)}
        <div class="info"><div class="label">${esc(c.part.category)}</div><div class="name">${esc(c.part.name)}</div></div></div>
      <div class="spec">${esc(partSpec(c.part))}</div>
      <div class="badges">${tierBadge(c.part)}${fitted ? '<span class="badge owned plain">ON YOUR CAR</span>' : c.fits ? '<span class="badge good plain">FITS YOUR CAR</span>' : `<span class="badge info plain">Not for this car</span>`}${c.owned ? `<span class="badge info plain">You have ${c.owned}</span>` : ''}</div>
      <div class="buy"><div class="price">${soon ? '<span class="pv muted">Coming soon</span><span class="pe">not priced yet</span>' : `<span class="pv ${afford ? '' : 'bad'}">${esc(this.money(c.price))}</span>${c.set > 1 ? `<span class="pe">set of ${c.set} · ${esc(this.money(c.part.price))} each</span>` : ''}`}</div>
        ${socket && !soon ? `<button class="icon-btn" data-act="try:${id}" data-key="try:${id}" title="See it on the car (and buy it fitted)">${icon('visibility')}</button>` : ''}
        <button class="btn primary bar" data-act="buy:${id}" data-key="buy:${id}" ${soon ? `disabled title="Not for sale yet: its ${esc(c.part.todo.join(', '))} ${c.part.todo.length > 1 ? 'are' : 'is'} still to be filled in"` : afford ? '' : `disabled title="You need ${esc(this.money(c.price - w.money))} more"`}>${icon('shopping_cart')}Buy</button></div>
    </div>`;
  }
  // ---------- the dealership: every car by type, one on the lift turning, its paint, a test drive ----------
  #dealerPaint() { const d = this.ui.dealer, def = this.w.db.cars[d.carId]; return d.paint ?? def?.paint ?? { colour: '#8d969f', finish: 'gloss' }; }
  #showDealerCar(id) {
    const db = this.w.db, def = db.cars[id];
    if (!def) return;
    if (this.ui.dealer.carId !== id) this.ui.dealer.paint = null;
    this.ui.dealer.carId = id;
    if (this.dealerShown === id) return;
    this.dealerShown = id;
    const state = Garage.freshState(db, id), g = new Garage(db, state, id);
    this.carQueue = (this.carQueue ?? Promise.resolve()).then(() => this.scene.setCar({ car: def, finishes: db.finishes, build: g.build, view: g.view, paint: this.#dealerPaint(), spec: g.stats().spec }))
      .then(() => { this.shownLook = null; this.render(); }).catch(err => console.warn('The dealership couldn\'t show the car:', err));
  }
  #dealer() {
    const w = this.w, d = this.ui.dealer, groups = dealerList(w.db, w.money), sel = d.carId && dealerCar(w.db, d.carId, w.money);
    const mine = id => w.cars().filter(x => x.def.id === id).length, paint = this.#dealerPaint(), sure = sel && this.ui.confirm === `dealer:${sel.id}`;
    const row = c => `<button class="g-dealer-row ${c.id === d.carId ? 'on' : ''}" data-act="dealer-car:${c.id}" data-key="dealer-car:${c.id}">
        ${c.def.icon ? `<img src="${esc(c.def.icon)}" alt="">` : icon('directions_car')}
        <span class="n"><b>${esc(c.name)}</b><small>${fmt(c.hp)} hp · ${fmt(c.kg)} kg · ${c.zeroTo100 != null ? c.zeroTo100.toFixed(1) : '—'} s · ${esc(c.layout)}</small></span>
        <span class="c"><span class="badge class-${esc(c.class)}">${esc(c.class)}</span><span class="${c.affordable ? '' : 'bad'}">${esc(this.money(c.price))}</span></span></button>`;
    const stat = (label, value) => `<div class="g-dealer-stat"><span>${label}</span><b>${value}</b></div>`;
    const swatches = [['factory', w.db.cars[d.carId]?.paint?.colour ?? '#8d969f', 'Factory colour'], ...PRESETS.slice(0, 11).map(([n, hex]) => [hex, hex, n])];
    return `<section class="g-side panel g-dealer">
      <div class="panel-head"><div class="grow"><div class="label">Dealership · cars come with their factory parts</div><div class="panel-title">${sel ? esc(sel.name) : 'Cars'}</div></div></div>
      <div class="panel-body" style="gap:14px;padding-top:14px" data-scroll="dealer">
        ${sel ? `<div class="g-dealer-sel">
          <div class="badges"><span class="badge class-${esc(sel.class)}">CLASS ${esc(sel.class)}</span><span class="badge info plain">${esc(sel.type)}</span>${mine(sel.id) ? `<span class="badge owned plain">You have ${mine(sel.id)}</span>` : ''}</div>
          ${sel.about ? `<p class="secondary-text">${esc(sel.about)}</p>` : ''}
          <div class="g-dealer-stats">${stat('Power', `${fmt(sel.hp)} hp`)}${stat('Torque', `${fmt(sel.nm)} N·m`)}${stat('Weight', `${fmt(sel.kg)} kg`)}${stat('0–100 km/h', sel.zeroTo100 != null ? `${sel.zeroTo100.toFixed(1)} s` : '—')}${stat('Top speed', sel.top != null ? `${Math.round(sel.top)} km/h` : '—')}${stat('Grip', sel.grip != null ? `${sel.grip.toFixed(2)} g` : '—')}${stat('Drive', esc(sel.layout))}${stat('Gearbox', sel.gears ? `${sel.gears}-speed` : '—')}${stat('Rating', fmt(sel.rating))}</div>
          <div class="label">Paint (preview)</div>
          <div class="g-dealer-swatches">${swatches.map(([key, hex, name]) => `<button class="swatch ${(key === 'factory' ? !d.paint : d.paint?.colour === hex) ? 'on' : ''}" style="background:${esc(hex)}" data-act="dealer-paint:${esc(key)}" data-key="dealer-paint:${esc(key)}" title="${esc(name)}"></button>`).join('')}</div>
        </div>` : ''}
        ${groups.map(g => `<div class="g-dealer-group"><div class="label">${esc(g.type)}</div>${g.cars.map(row).join('')}</div>`).join('')}
      </div>
      ${sel ? `<div class="panel-foot" style="gap:10px">
        <button class="btn ghost bar" data-act="dealer-drive:${sel.id}" data-key="dealer-drive" title="Drive it at the test centre first: nothing you do to it is kept">${icon('sports_score')}Test drive</button>
        <button class="btn ${sure ? 'danger solid' : 'primary'} bar" data-act="dealer-buy:${sel.id}" data-key="dealer-buy" ${sel.affordable ? '' : `disabled title="You need ${esc(this.money(sel.price - w.money))} more"`}>${sure ? `Buy for ${esc(this.money(sel.price))}?` : `${icon('shopping_cart')}Buy · ${esc(this.money(sel.price))}`}</button>
      </div>` : ''}
    </section>`;
  }
  #dealerCard(c) {
    const w = this.w, id = c.def.id, sure = this.ui.confirm === `car:${id}`, mine = w.cars().filter(x => x.def.id === id).length;
    return `<div class="g-card">
      <div class="top">${c.def.icon ? `<div class="thumb pic"><img src="${esc(c.def.icon)}" alt=""></div>` : `<div class="thumb">${icon('directions_car')}</div>`}
        <div class="info"><div class="label">${esc(c.def.drivetrain?.layout ?? '')} · ${fmt(c.def.chassis?.mass ?? 0)} kg body</div><div class="name">${esc(c.def.name)}</div></div></div>
      <div class="spec">Comes with every factory part fitted, and a "Stock" setup.</div>
      <div class="badges">${mine ? `<span class="badge owned plain">You have ${mine}</span>` : ''}</div>
      <div class="buy"><div class="price"><span class="pv ${c.affordable ? '' : 'bad'}">${esc(this.money(c.price))}</span></div>
        <button class="btn ${sure ? 'danger solid' : 'primary'} bar" data-act="buy-car:${id}" data-key="buy-car:${id}" ${c.affordable ? '' : `disabled title="You need ${esc(this.money(c.price - w.money))} more"`}>${sure ? `Buy for ${esc(this.money(c.price))}?` : `${icon('shopping_cart')}Buy`}</button></div>
    </div>`;
  }

  // ---------- popovers, dialogs ----------
  #settingsPop() {
    const w = this.w, setup = w.activeSetup, n = w.changes().length;
    const seg = (act, value, opts) => `<div class="segmented">${opts.map(([v, name]) => `<button class="${value === v ? 'on' : ''}" data-act="${act}:${v}" data-key="${act}:${v}">${name}</button>`).join('')}</div>`;
    const saved = w.profile.saved ? new Date(w.profile.saved) : null;
    return `<div class="g-pop panel">
      <div class="pr"><div class="label">Fitting parts</div>${seg('mode', w.mode, [['quick', 'Quick'], ['mechanic', 'Mechanic']])}
        <div class="d">${w.mode === 'quick' ? 'Parts in the way come off and go back on by themselves.' : 'Take off whatever is in the way yourself, in order.'}</div></div>
      <div class="pr"><div class="label">Markers</div>${seg('labels', this.ui.labels, [['hover', 'Label on hover'], ['always', 'Always labelled']])}</div>
      <div class="pr"><div class="label">Sound</div>${seg('sound', this.sounds.enabled ? 'on' : 'off', [['on', 'On'], ['off', 'Off']])}</div>
      <div class="pr"><div class="label">Setup</div><button class="btn secondary bar" data-act="back-to-setup" data-key="back-to-setup" ${setup && n ? '' : 'disabled'}>${icon('history')}${setup ? esc(`Back to "${setup.name}"`) : 'Back to the setup'}</button></div>
      ${this.playtest ? `<div class="pr"><div class="label">Playtest</div>${seg('playtest', this.playtest.on ? 'on' : 'off', [['on', 'Log upgrades'], ['off', 'Off']])}
        <div class="d">${this.playtest.on ? `Every change is logged with the rating and the Step 6 results: ${this.playtest.log.entries.length} so far.` : 'Keep an upgrade log: what was bought, the money spent, and the rating and Step 6 results after each change.'}</div>
        <button class="g-link" style="align-self:flex-start" data-act="playtest-open" data-key="playtest-open">${icon('open_in_new')}Open the log</button></div>` : ''}
      ${this.dev ? `<div class="pr"><div class="label">Money (development)</div>${seg('money', this.dev.unlimitedMoney ? 'unlimited' : 'normal', [['unlimited', 'Unlimited'], ['normal', 'Normal']])}
        <div class="d">${this.dev.unlimitedMoney ? 'Nothing costs anything: buy, fit and repair what you like. Your money stays as it is.' : 'For testing: make everything free (kept in this browser, not in your save).'}</div></div>` : ''}
      <div class="pr"><div class="label">Your save</div>
        <div class="d">Saved in this browser after every change${saved ? ` · last at ${saved.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}.</div>
        <div class="g-save-btns"><button class="btn secondary bar" data-act="save-now" data-key="save-now">${icon('save')}Save now</button>
          <button class="btn ghost bar" data-act="export" data-key="export" title="Download the save as a file">${icon('download')}Export</button>
          <button class="btn ghost bar" data-act="import" data-key="import" title="Load a save file (it replaces this one)">${icon('upload')}Import</button></div></div>
    </div>`;
  }
  // The player's cars (switch; buy one), and this car's setups (switch, rename, delete; save the car
  // as it is to one, or as a new one)
  #garagePop() {
    const w = this.w, changes = w.changes(), f = this.ui.fields;
    const carRow = c => `<button class="g-car-row ${c.current ? 'on' : ''}" data-act="${c.current ? '' : `car:${c.carInstanceId}`}" data-key="car:${c.carInstanceId}">
        ${icon(c.current ? 'radio_button_checked' : 'radio_button_unchecked')}<span class="cn">${esc(c.name)}</span><span class="cs">${esc(c.setup ?? 'no setup')}</span>
        ${c.rating ? `<span class="class-badge sm"><span class="cls">${c.rating.class}</span><span class="pi">${c.rating.index}</span></span>` : '<span class="mono muted">—</span>'}</button>`;
    const stockOf = socket => w.car.sockets.find(x => x.name === socket)?.stock?.[0] ?? null;
    const setupRow = s => {
      if (this.ui.renaming === s.setupId) return `<div class="g-setup-row editing"><input class="g-input" type="text" maxlength="40" data-field="rename" data-key="rename" data-enter="rename-ok:${s.setupId}" value="${esc(f.rename ?? s.name)}" aria-label="Setup name">
        <button class="icon-btn flat" data-act="rename-ok:${s.setupId}" data-key="rename-ok" title="Rename">${icon('check')}</button><button class="icon-btn flat" data-act="rename-cancel" data-key="rename-cancel" title="Cancel">${icon('close')}</button></div>`;
      const mods = Object.entries(s.partIds ?? {}).filter(([k, id]) => (id ?? null) !== stockOf(k)).length, sure = this.ui.confirm === `del:${s.setupId}`;
      const note = s.active ? (changes.length ? `<span class="warn">${changes.length} change${changes.length > 1 ? 's' : ''} not saved</span>` : 'on the car') : mods ? `${mods} not stock` : 'all stock';
      return `<div class="g-setup-row ${s.active ? 'on' : ''}"><button class="sw" data-act="${s.active ? '' : `setup:${s.setupId}`}" data-key="setup:${s.setupId}" title="${s.active ? 'The setup the car is in' : 'Switch to this setup'}">${icon(s.active ? 'check_circle' : 'radio_button_unchecked')}<span class="sn">${esc(s.name)}</span><span class="sm">${note}</span></button>
        <button class="icon-btn flat" data-act="rename:${s.setupId}" data-key="rename:${s.setupId}" title="Rename">${icon('edit')}</button>
        <button class="icon-btn flat ${sure ? 'danger' : ''}" data-act="del-setup:${s.setupId}" data-key="del:${s.setupId}" title="${sure ? 'Click again to delete it' : 'Delete'}">${icon(sure ? 'delete_forever' : 'delete')}</button></div>`;
    };
    const setups = w.setups, active = w.activeSetup;
    return `<div class="g-pop left panel">
      <div class="pr"><div class="g-pop-head"><div class="label">Your cars</div><button class="g-link" data-act="buy-a-car" data-key="buy-a-car">${icon('add')}Buy a car</button></div>
        <div class="g-car-list">${w.cars().map(carRow).join('')}</div></div>
      <div class="pr"><div class="label">Setups · ${esc(w.name)}</div>
        <div class="g-setup-list">${setups.map(setupRow).join('') || '<div class="d">No setups yet: save the car as it is as one.</div>'}</div>
        ${active && changes.length ? `<div class="g-changes">${changes.slice(0, 4).map(c => `<div>${icon(c.icon)}<span>${esc(c.text)}</span></div>`).join('')}${changes.length > 4 ? `<div class="muted">and ${changes.length - 4} more</div>` : ''}</div>
          <button class="btn primary bar" data-act="save" data-key="save-to">${icon('save')}${esc(`Save to "${active.name}"`)}</button>` : ''}
        <div class="g-save-as"><input class="g-input" type="text" maxlength="40" placeholder="${esc(`Setup ${setups.length + 1}`)}" data-field="newSetup" data-key="new-setup" data-enter="save-as" value="${esc(f.newSetup ?? '')}" aria-label="Name for a new setup">
          <button class="btn secondary bar" data-act="save-as" data-key="save-as">${icon('add')}Save as new</button></div>
        <div class="d">A setup is which part goes in each socket. Switching puts the car back as it was saved: parts it doesn't use go to the inventory.</div></div>
    </div>`;
  }
  #dialog() {
    const d = this.ui.dialog, w = this.w;
    const box = (ic, colour, title, text, list, buttons) => `<div class="scrim"><div class="dialog" role="dialog" aria-modal="true">
      <div style="padding:24px 28px 8px;display:flex;gap:16px;align-items:flex-start">
        <div style="width:44px;height:44px;flex:none;border-radius:8px;background:color-mix(in srgb, ${colour} 14%, transparent);display:flex;align-items:center;justify-content:center;color:${colour}">${icon(ic, 'style="font-size:26px"')}</div>
        <div style="display:flex;flex-direction:column;gap:6px"><div class="panel-title">${esc(title)}</div>${text ? `<div class="secondary-text" style="font-size:15px;line-height:1.45">${esc(text)}</div>` : ''}</div></div>
      ${list.length ? `<div class="g-dialog-list well">${list.join('')}</div>` : ''}
      <div style="padding:24px 28px;display:flex;gap:10px;justify-content:flex-end">${buttons}</div>
    </div></div>`;
    if (d.kind === 'switch') {
      const setup = w.setups.find(s => s.setupId === d.setupId), part = id => w.db.parts[id]?.name ?? id ?? 'a part';
      const list = d.conflicts.map(c => `<div class="li">${icon(c.reason === 'gone' ? 'remove_shopping_cart' : 'directions_car')}<div style="flex:1;display:flex;flex-direction:column;gap:1px">
          <span>${esc(part(c.partId))} <span class="muted">· ${esc(this.socket(c.socket)?.label ?? c.socket)}</span></span>
          <span class="sub">${esc(c.reason === 'gone' ? "You don't have it any more" : `It's on ${c.car}`)} → ${esc(c.standIn ? `${part(c.standIn)} goes on instead` : 'left empty')}</span></div></div>`);
      return box('swap_horiz', 'var(--c-warn)', `Switch to "${setup?.name ?? 'the setup'}"?`, `${d.conflicts.length} of its parts ${d.conflicts.length === 1 ? "isn't" : "aren't"} here. Switch anyway, with ${d.conflicts.length === 1 ? 'that slot' : 'those slots'} stock or empty?`, list,
        `<button class="btn secondary" data-act="dialog-cancel" data-key="dialog-cancel">Cancel</button><button class="btn primary" data-act="switch-anyway" data-key="switch-anyway">Switch anyway</button>`);
    }
    return box('info', 'var(--c-accent)', d.title, null, d.list.map(t => `<div class="li">${icon('chevron_right')}<span style="flex:1">${esc(t)}</span></div>`),
      `<button class="btn primary" data-act="dialog-cancel" data-key="notice-ok">OK</button>`);
  }

  // ---------- markers ----------
  #rebuildMarkers() {
    const show = this.ui.tab === 'parts' && this.ui.panel !== 'systems' && !this.ui.dialog;
    const keep = new Set();
    for (const s of show ? this.sockets() : []) {
      keep.add(s.name);
      let el = this.markerEls.get(s.name);
      if (!el) { el = document.createElement('button'); el.className = 'g-marker'; el.dataset.act = `marker:${s.name}`; el.dataset.key = `marker:${s.name}`; this.markersEl.appendChild(el); this.markerEls.set(s.name, el); }
      const sel = this.ui.socket === s.name && this.ui.panel;
      const colour = s.empty ? (s.required ? 'var(--c-bad)' : 'var(--c-accent)') : condColour(s.condition);
      el.classList.toggle('sel', !!sel);
      el.innerHTML = (s.empty ? `<span class="m empty ${s.required ? 'required' : ''}" style="box-shadow:0 0 0 ${sel ? 6 : 0}px rgba(54,179,245,0.25)">+</span>`
        : `<span class="m filled" style="background:${colour};box-shadow:0 0 0 ${sel ? 6 : 4}px color-mix(in srgb, ${colour} ${sel ? 45 : 25}%, transparent)"></span>`)
        + `<span class="tag"><span>${esc(s.label)}</span>${s.empty ? '' : `<span class="pn">${esc(s.part.name)}</span>`}<span class="tv" style="color:${colour}">${s.empty ? 'Empty' : `${Math.round(s.condition)}%`}</span></span>`;
    }
    for (const [name, el] of this.markerEls) if (!keep.has(name)) { el.remove(); this.markerEls.delete(name); }
  }
  // (each frame: where the markers are on screen, and which to show)
  updateMarkers() {
    if (!this.w || !this.markerEls.size) return;
    const area = this.ui.area, zoomedOut = this.scene.zoomedOut, w = innerWidth, h = innerHeight, view = this.ui.view;
    const byName = new Map(this.sockets().map(s => [s.name, s])), I = this.#insets(this.#scale());
    const oneOf = area === 'wheels' || area === 'sides';     // (only the corner / side the camera's on)
    for (const [name, el] of this.markerEls) {
      const s = byName.get(name), p = s && this.scene.socketOnScreen(s, w, h);
      const inArea = area ? s.area === area && (!oneOf || s.def.focus === view) : false, sel = this.ui.socket === name;
      const clear = p && p.x > I.left + 8 && p.x < w - I.right - 8 && p.y > I.top + 8 && p.y < h - I.bottom - 8;
      const visible = p && p.visible && clear && !this.scene.busy && (sel || ((zoomedOut || inArea) && p.facing));
      el.style.display = visible ? '' : 'none';
      el.classList.toggle('labelled', inArea && !zoomedOut);
      if (visible) { el.style.transform = `translate(${(p.x - 9).toFixed(1)}px, ${(p.y - 9).toFixed(1)}px)`; el.style.zIndex = String(1000 - Math.round(p.depth * 10)); }
    }
  }

  // ---------- what the player does ----------
  #listen() {
    this.root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      // (a click anywhere else closes a popover)
      if (this.ui.pop && !e.target.closest('.g-pop') && !b?.dataset.act?.startsWith('pop:')) { this.ui.pop = null; this.ui.renaming = null; if (!b || b.disabled || !b.dataset.act) this.render(); }
      if (!b || !this.root.contains(b) || b.disabled || !b.dataset.act) return;
      this.act(b.dataset.act, b);
    });
    addEventListener('pointerdown', e => { if (this.visible && this.ui.pop && e.target?.id === 'garage-canvas') { this.ui.pop = null; this.ui.renaming = null; this.render(); } }, true);
    // text boxes: what's typed is kept (the screen is redrawn often); the searches filter as you type
    this.root.addEventListener('input', e => {
      const f = e.target.dataset?.field;
      if (!f) return;
      if (f === 'inv.q') { this.ui.inv.q = e.target.value; this.render(); }
      else if (f === 'shop.q') { this.ui.shop.q = e.target.value; this.render(); }
      else this.ui.fields[f] = e.target.value;
    });
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (!file) return;
      const r = await this.w.importSave(await file.text());
      if (!r.ok) return this.toast(r.error, 'error', 'bad');
      this.ui.pop = null; this.ui.panel = null; this.ui.socket = null; this.ui.candidate = null; this.scene.clearGhost();
      this.notice('Save imported', r.notices?.length ? r.notices : ['Everything in it loaded as it was.']);
    });
    // hovering a part in the list shows it on the car
    this.root.addEventListener('mouseover', e => { const r = e.target.closest('[data-ghost]'); if (r) this.#ghost(r.dataset.ghost); });
    this.root.addEventListener('mouseleave', e => { if (e.target.closest?.('[data-ghostlist]')) this.#ghost(this.ui.panel === 'compare' ? this.ui.candidate : null); }, true);
    this.root.addEventListener('focusin', e => { const r = e.target.closest?.('[data-ghost]'); if (r) this.#ghost(r.dataset.ghost); });
    // tuning sliders: the car changes as they move
    this.root.addEventListener('input', e => {
      const t = e.target.dataset.tune;
      if (!t) return;
      const [sock, setting] = t.split('|');
      this.quiet = true;
      try { this.w.tune(sock, setting, +e.target.value, { drag: true }); } finally { this.quiet = false; }
      this.#liveTuning(e.target);
    });
    this.root.addEventListener('change', async e => { if (e.target.dataset.tune) { await this.w.endDrag(); this.scene.setSpec(this.stats.spec); this.render(); } });
    // the colour picker
    this.root.addEventListener('pointerdown', e => {
      const pick = e.target.closest('[data-pick]');
      if (!pick) return;
      pick.setPointerCapture(e.pointerId);
      const move = ev => this.#pickColour(pick, ev), up = () => { pick.removeEventListener('pointermove', move); pick.removeEventListener('pointerup', up); };
      pick.addEventListener('pointermove', move); pick.addEventListener('pointerup', up);
      this.#pickColour(pick, e);
    });
    addEventListener('keydown', e => {
      if (!this.visible) return;
      // (typing in a text box: Enter does its button, Escape leaves it; the garage's keys wait)
      if (e.target?.matches?.('#garage-root input[type="text"]')) {
        if (e.key === 'Enter' && e.target.dataset.enter) { e.preventDefault(); this.act(e.target.dataset.enter); }
        else if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); if (this.ui.renaming) { this.ui.renaming = null; this.render(); } }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); this.back(); }
      else if ((e.key === 'Enter' || e.key === ' ') && e.target?.matches?.('#garage-root [role="button"]')) { e.preventDefault(); e.target.click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.act(e.shiftKey ? 'redo' : 'undo'); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.act('redo'); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.act('save'); }
    });
  }

  async act(a, el) {
    const [cmd, ...rest] = a.split(':'), arg = rest.join(':');
    const w = this.w;
    const failed = r => { if (r && !r.ok) { this.toast(this.#words(r.error ?? "That didn't work"), 'error', 'bad'); return true; } return !r; };
    switch (cmd) {
      case 'tab': return this.setTab(arg);
      case 'area': return arg === 'systems' ? this.openSystems() : this.setArea(arg);
      case 'marker': case 'open': case 'goto': return this.openSocket(arg);
      case 'close': this.ui.panel = null; this.ui.socket = null; this.ui.candidate = null; this.scene.clearGhost(); this.scene.setSeeThrough(false); return this.render();
      case 'back': return this.back();
      case 'pick': return this.pick(arg);
      case 'takeoff': this.ui.candidate = 'remove'; this.preview = w.previewRemove(this.ui.socket); this.ui.panel = 'compare'; this.scene.clearGhost(); return this.render();
      case 'install': return this.install();
      case 'confirm-takeoff': return this.takeOff();
      case 'view': {
        if (arg.startsWith('wheel_')) this.ui.wheelCorner = arg.slice(6);
        this.#view(arg);
        // (an open slot follows to the same slot on that corner / side)
        const s = this.ui.socket && this.socket(this.ui.socket), m = s?.name.match(/^(.*_)(FL|FR|RL|RR|left|right)$/);
        if (m) { const twin = arg.startsWith('wheel_') ? m[1] + arg.slice(6) : m[1] + arg.slice(5); if (this.socket(twin)?.def.focus === arg) return this.openSocket(twin); }
        if (s && s.def.focus !== arg) { this.ui.panel = null; this.ui.socket = null; this.scene.clearGhost(); }
        return this.render();
      }
      case 'filter': this.ui.filter = arg; return this.render();
      case 'sort': { const i = SORTS.findIndex(s => s[0] === this.ui.sort); this.ui.sort = SORTS[(i + 1) % SORTS.length][0]; return this.render(); }
      case 'expand': this.ui.expanded = this.ui.expanded === arg ? null : arg; return this.render();
      case 'undo': case 'redo': {
        const r = await w[cmd]();
        if (!r || failed(r)) return;
        this.#syncCar();
        return this.toast(cmd === 'undo' ? 'Undone' : 'Redone', cmd);
      }
      case 'test': return this.actions.testDrive();
      case 'leave': return this.actions.leave();
      case 'dialog-cancel': this.ui.dialog = null; return this.render();
      case 'hint-close': this.ui.hint = null; return this.render();
      case 'pop': this.ui.pop = this.ui.pop === arg ? null : arg; this.ui.renaming = null; this.ui.confirm = null; return this.render();
      case 'mode': w.mode = arg; this.actions.modeChanged?.(arg); if (this.ui.panel === 'compare' && this.ui.candidate !== 'remove') { const c = this.#cand(this.ui.candidate); this.preview = c ? w.preview(this.ui.socket, c) : null; } return this.render();
      case 'labels': this.ui.labels = arg; return this.render();
      case 'playtest': this.playtest?.set(arg === 'on'); return this.toast(arg === 'on' ? 'Playtest log on: every change is recorded' : 'Playtest log off', 'science');
      case 'playtest-open': return window.open('dev/playtest.html', '_blank');
      case 'money': await this.dev?.setUnlimitedMoney(arg === 'unlimited'); this.render(); return this.toast(arg === 'unlimited' ? 'Unlimited money: nothing costs anything' : 'Money back to normal', 'account_balance_wallet');
      case 'sound': this.sounds.enabled = arg === 'on'; return this.render();

      // ---- setups and cars ----
      case 'save': {
        const setup = w.activeSetup;
        if (!setup) { this.ui.pop = 'garage'; this.render(); return this.stage.querySelector('[data-key="new-setup"]')?.focus(); }
        if (failed(await w.saveSetup())) return;
        return this.toast(`Saved to "${setup.name}"`, 'check_circle', 'good');
      }
      case 'save-as': {
        const name = (this.ui.fields.newSetup ?? '').trim() || `Setup ${w.setups.length + 1}`;
        if (failed(await w.saveSetupAs(name))) return;
        this.ui.fields.newSetup = '';
        return this.toast(`Saved as a new setup: "${name}"`, 'check_circle', 'good');
      }
      case 'setup': return this.#switchSetup(arg);
      case 'back-to-setup': this.ui.pop = null; return w.activeSetup && this.#switchSetup(w.activeSetup.setupId);
      case 'switch-anyway': { const d = this.ui.dialog; this.ui.dialog = null; return this.#switchSetup(d.setupId, true); }
      case 'rename': this.ui.renaming = arg; this.ui.fields.rename = w.setups.find(s => s.setupId === arg)?.name ?? ''; this.render(); { const input = this.stage.querySelector('[data-key="rename"]'); input?.focus(); input?.select(); } return;
      case 'rename-cancel': this.ui.renaming = null; return this.render();
      case 'rename-ok': {
        if (failed(await w.renameSetup(arg, (this.ui.fields.rename ?? '').trim()))) return;
        this.ui.renaming = null; return this.render();
      }
      case 'del-setup': {
        if (this.ui.confirm !== `del:${arg}`) return this.#arm(`del:${arg}`);
        const name = w.setups.find(s => s.setupId === arg)?.name;
        this.ui.confirm = null;
        if (failed(await w.deleteSetup(arg))) return;
        return this.toast(`Setup "${name}" deleted`, 'delete');
      }
      case 'car': {
        if (failed(await w.selectCar(arg))) return;
        this.ui.pop = null; this.ui.panel = null; this.ui.socket = null; this.ui.candidate = null; this.preview = null; this.dynoShown = null; this.scene.clearGhost();
        return this.toast(`In the garage: ${w.name}`, 'directions_car');
      }
      case 'buy-a-car': this.ui.pop = null; return this.setTab('dealer');
      // ---- the dealership ----
      case 'dealer-car': this.ui.confirm = null; this.#showDealerCar(arg); return this.render();
      case 'dealer-paint': this.ui.dealer.paint = arg === 'factory' ? null : { colour: arg, finish: 'gloss' }; this.scene.previewPaint(this.#dealerPaint()); return this.render();
      case 'dealer-drive': {
        const r = this.actions.testDriveCar?.(arg);
        if (r && !r.ok) return this.toast(this.#words(r.errors?.[0] ?? "Can't test drive that"), 'error', 'bad');
        return;
      }
      case 'dealer-buy': {
        if (this.ui.confirm !== `dealer:${arg}`) return this.#arm(`dealer:${arg}`);
        this.ui.confirm = null;
        const r = await w.buyCar(arg);
        if (failed(r)) return;
        const paint = this.ui.dealer.paint;
        if (paint) await w.service.setPaint(r.carInstanceId, paint);
        return this.toast(`Bought a ${w.db.cars[arg].name}: it's in your cars (top left)`, 'directions_car', 'good');
      }
      case 'buy-car': {
        if (this.ui.confirm !== `car:${arg}`) return this.#arm(`car:${arg}`);
        this.ui.confirm = null;
        const r = await w.buyCar(arg);
        if (failed(r)) return;
        return this.toast(`Bought a ${w.db.cars[arg].name}: it's in your cars (top left)`, 'directions_car', 'good');
      }

      // ---- money ----
      case 'buy': {
        const part = w.db.parts[arg], r = await w.buy(arg);
        if (failed(r)) return;
        const n = r.instanceIds?.length ?? 1;
        this.sounds.clunk?.();
        return this.toast(`Bought ${part.name}${n > 1 ? ` ×${n}` : ''} · ${this.money(r.cost ?? part.price * n)}`, 'shopping_cart', 'good');
      }
      case 'try': {
        const socket = w.socketFor(arg);
        if (!socket) return;
        this.openSocket(socket);
        const c = w.partsFor(socket).candidates.find(x => x.partId === arg);
        if (!c) return this.toast(`${w.db.parts[arg].name} is already on the car`, 'info');
        if (c.locked) return this.toast(`${w.db.parts[arg].name}: ${this.#words(c.locked.text)}`, 'lock', 'bad');
        return this.pick(c.key);
      }
      case 'sell': {
        if (this.ui.confirm !== `sell:${arg}`) return this.#arm(`sell:${arg}`);
        this.ui.confirm = null;
        const name = w.db.parts[w.profile.parts[arg]?.partId]?.name, r = await w.sell(arg);
        if (failed(r)) return;
        return this.toast(`Sold ${name} · ${this.money(r.amount)}`, 'sell', 'good');
      }
      case 'repair': case 'repair-part': {
        const id = cmd === 'repair' ? arg : this.socket(this.ui.socket)?.instance?.instanceId, name = w.db.parts[w.profile.parts[id]?.partId]?.name, r = await w.repair(id);
        if (failed(r)) return;
        return this.toast(`${name} repaired to 100% · ${this.money(r.cost)}`, 'build', 'good');
      }
      case 'repair-body': { const r = await w.repairBody(); if (failed(r)) return; return this.toast(`Bodywork repaired · ${this.money(r.cost)}`, 'build', 'good'); }
      case 'repair-all': { const r = await w.repairAll(); if (failed(r)) return; return this.toast(`${r.repaired} part${r.repaired === 1 ? '' : 's'} repaired · ${this.money(r.cost)}`, 'build', 'good'); }
      case 'repair-shown': {
        const u = this.ui.inv, q = u.q.trim().toLowerCase();
        const ids = w.allParts().filter(x => x.instance.condition < 100 && (u.cat === 'all' || x.part.category === u.cat) && (u.filter !== 'installed' || x.instance.installedOn) && (u.filter !== 'spare' || !x.instance.installedOn)
          && (!q || x.part.name.toLowerCase().includes(q) || x.part.category.includes(q) || x.part.id.includes(q))).map(x => x.instance.instanceId);
        const r = await w.repairParts(ids);
        if (failed(r)) return;
        return this.toast(`${r.repaired} part${r.repaired === 1 ? '' : 's'} repaired · ${this.money(r.cost)}`, 'build', 'good');
      }

      // ---- inventory and shop lists ----
      case 'inv-cat': this.ui.inv.cat = arg; return this.render();
      case 'inv-filter': this.ui.inv.filter = arg; return this.render();
      case 'inv-sort': { const i = INV_SORTS.findIndex(x => x[0] === this.ui.inv.sort); this.ui.inv.sort = INV_SORTS[(i + 1) % INV_SORTS.length][0]; return this.render(); }
      case 'inv-open': this.ui.inv.open = this.ui.inv.open === arg ? null : arg; return this.render();
      case 'inv-install': {
        const copy = w.profile.parts[arg], socket = copy && w.socketFor(copy.partId);
        if (!socket) return this.toast("That doesn't go on this car", 'error', 'bad');
        this.openSocket(socket);
        return this.pick(arg);
      }
      case 'inv-show': { const on = w.profile.parts[arg]?.installedOn; return on && this.openSocket(on.socket); }
      case 'shop-cat': this.ui.shop.cat = arg; return this.render();
      case 'shop-fits': this.ui.shop.fits = !this.ui.shop.fits; return this.render();
      case 'shop-sort': { const i = SHOP_SORTS.findIndex(x => x[0] === this.ui.shop.sort); this.ui.shop.sort = SHOP_SORTS[(i + 1) % SHOP_SORTS.length][0]; return this.render(); }
      case 'shop-section': this.ui.shop.section = arg; this.ui.confirm = null; return this.render();

      // ---- the save ----
      case 'save-now': if (failed(await w.saveNow())) return; return this.toast('Saved', 'check_circle', 'good');
      case 'export': {
        const r = await w.exportSave();
        if (failed(r)) return;
        const url = URL.createObjectURL(new Blob([r.json], { type: 'application/json' })), link = Object.assign(document.createElement('a'), { href: url, download: `drive-world-save-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        return this.toast('Save exported', 'download', 'good');
      }
      case 'import': return this.fileInput.click();

      // ---- tuning, paint, dyno ----
      case 'tune-reset': if (failed(await w.resetTuning(arg === 'all' ? null : arg))) return; this.scene.setSpec(this.stats.spec); return this.render();
      case 'preset': { const hsv = hexHsv(arg); this.ui.paintEdit = { ...this.ui.paintEdit, ...hsv }; this.scene.previewPaint({ colour: arg.toLowerCase(), finish: this.ui.paintEdit.finish }); return this.render(); }
      case 'finish': this.ui.paintEdit = { ...this.ui.paintEdit, finish: arg }; this.scene.previewPaint({ colour: hsvHex(this.ui.paintEdit.h, this.ui.paintEdit.s, this.ui.paintEdit.v), finish: arg }); return this.render();
      case 'apply-paint': {
        const e = this.ui.paintEdit, colour = hsvHex(e.h, e.s, e.v);
        if (failed(await w.setPaint({ colour, finish: e.finish }))) return;
        this.sounds.clunk(); return this.toast(`Painted ${colour.toUpperCase()} · ${w.db.finishes[e.finish]?.name}`, 'palette', 'good');
      }
      case 'pf': { const [label, fin] = [rest[0], rest[1]], row = PART_FINISHES.find(r => r.label === label); for (const which of row.which) if (w.garage.fittedIn(which).length && failed(await w.paintPart(which, fin ? { finish: fin } : null))) return; return; }
      case 'dyno-run': return this.runDyno();

      // ---- the damage report ----
      case 'dmg-focus': {
        const p = this.#problem(arg);
        if (!p) return;
        this.ui.dmg.problem = this.ui.dmg.problem === arg ? null : arg;
        this.#view(this.ui.dmg.problem ? p.view : this.ui.dmg.zone ? ZONE_VIEW[this.ui.dmg.zone] : 'overview');
        return this.render();
      }
      case 'dmg-zone': {
        this.ui.dmg.zone = this.ui.dmg.zone === arg ? null : arg; this.ui.dmg.problem = null;
        this.#view(this.ui.dmg.zone ? ZONE_VIEW[this.ui.dmg.zone] : 'overview');
        return this.render();
      }
      case 'dmg-fix': {
        const kind = rest[0], p = this.#problem(rest.slice(1).join(':'));
        if (!p) return;
        return this.#repairWith(() => w.repairCar({ kind, items: [{ target: p.target, scope: p.scope }] }), r => `${p.title.replace(/ \(.*\)$/, '')}: ${kind === 'quick' && p.quick !== p.full ? 'quick repair' : 'fixed'} · ${this.money(r.cost)}`);
      }
      case 'dmg-all': return this.#repairWith(() => w.repairCar({ kind: arg }), r => `${r.repaired} repair${r.repaired === 1 ? '' : 's'} (${arg}) · ${this.money(r.cost)}`);
      case 'dmg-basic': return this.#repairWith(() => w.basicRepair(), () => 'Patched up, free: it can be driven');
      case 'dmg-spare': {
        const p = this.#problem(arg), spare = p?.spares[0];
        if (!spare || this.changing) return;
        if (this.ui.confirm !== `spare:${arg}`) return this.#arm(`spare:${arg}`);
        this.ui.confirm = null; this.changing = true;
        try {
          const r = await w.replaceWithSpare(p.socket, spare);
          if (failed(r)) return;
          this.render();
          await this.scene.animateChange(r.ops ?? [], () => this.showCar(), w.car.sockets, w.car.socketGroups, id => w.db.parts[w.profile.parts[id]?.partId]);
          return this.toast(`Spare fitted · the damaged ${w.db.parts[w.profile.parts[r.replaced]?.partId]?.name ?? 'part'} to the inventory`, 'swap_horiz', 'good');
        } finally { this.changing = false; this.render(); }
      }
      case 'overlay': this.ui.dyno.overlay = +arg; return this.render();
    }
  }
  // (a problem in the damage report, by its id)
  #problem(id) { return this.w.problems().problems.find(p => p.id === id) ?? null; }
  // A repair, shown: the dents ease out and loose parts go back on (the scene), then a toast
  async #repairWith(ask, said) {
    if (this.changing) return;
    const w = this.w, before = w.damage;
    this.changing = true;
    this.render();
    try {
      const r = await ask();
      if (!r.ok) { this.toast(this.#words(r.error ?? "That didn't work"), 'error', 'bad'); return; }
      this.ui.dmg.problem = null;
      this.sounds.ratchet?.();
      await this.scene.animateRepair(before, w.damage, { rules: w.db.damage, parts: w.db.parts, sockets: w.car.sockets }).catch(err => console.warn('The repair couldn\'t be shown:', err));
      await this.showCar();
      this.sounds.clunk?.();
      this.toast(said(r), 'build', 'good');
    } finally { this.changing = false; this.render(); }
  }
  // (a button that asks "are you sure?" by changing: pressed again within a few seconds, it happens)
  #arm(key) {
    this.ui.confirm = key;
    clearTimeout(this.confirmTimer);
    this.confirmTimer = setTimeout(() => { if (this.ui.confirm === key) { this.ui.confirm = null; this.render(); } }, 3500);
    this.render();
  }
  // Switching setups: if some of its parts are gone or on another car, say which and offer to switch anyway
  async #switchSetup(setupId, force = false) {
    const w = this.w, name = w.setups.find(s => s.setupId === setupId)?.name, r = await w.switchSetup(setupId, { force });
    if (!r.ok && r.conflicts?.length) { this.ui.pop = null; this.ui.dialog = { kind: 'switch', setupId, conflicts: r.conflicts }; return this.render(); }
    if (!r.ok) return this.toast(this.#words(r.error), 'error', 'bad');
    this.ui.pop = null; this.ui.panel = this.ui.panel === 'systems' ? 'systems' : null; this.ui.candidate = null; this.preview = null; this.scene.clearGhost();
    const off = (r.leftOff ?? []).length, missing = (r.conflicts ?? []).length;
    this.toast(`Setup "${name}"${missing ? ` · ${missing} slot${missing > 1 ? 's' : ''} stock or empty` : ''}${off ? ` · ${off} part${off > 1 ? 's' : ''} couldn't go on` : ''}`, 'swap_horiz', missing || off ? '' : 'good');
  }

  setTab(tab) {
    if (this.ui.tab === 'paint' && tab !== 'paint') { this.ui.paintEdit = null; this.scene.previewPaint(this.w.paint); }
    // (the dealership: a dealer's car on the lift, turning; leaving it, the player's own car again)
    if (tab === 'dealer' && this.ui.tab !== 'dealer') { this.ui.tab = tab; this.scene.turntable = true; this.#showDealerCar(this.ui.dealer.carId ?? dealerList(this.w.db)[0].cars[0].id); }
    else if (tab !== 'dealer' && this.ui.tab === 'dealer') { this.scene.turntable = false; this.dealerShown = null; this.showCar().then(() => this.render()); }
    this.ui.tab = tab; this.ui.pop = null; this.ui.confirm = null;
    if (tab === 'tuning') this.tuneBase = this.stats;
    this.scene.clearGhost(); this.scene.setSeeThrough(false);
    if (tab === 'paint') this.#view('side_left');
    else if (WIDE.has(tab) || tab === 'dealer') this.#view('overview');
    else if (tab === 'damage') { this.ui.dmg = { problem: null, zone: null }; this.#view('overview'); if (this.ui.hint?.when === 'damageTab') this.ui.hint = null; }
    else if (tab === 'dyno') this.#view('overview');
    else if (tab === 'tuning') this.#view('side_left');
    else this.#view(this.ui.area ? this.#areaView(this.ui.area) : 'overview');
    this.render();
  }
  setArea(id) {
    this.ui.tab = 'parts';
    if (this.ui.area === id && this.ui.panel !== 'systems') { this.ui.area = null; this.ui.panel = null; this.#view('overview'); }
    else { this.ui.area = id; this.ui.panel = null; this.#view(this.#areaView(id)); }
    this.ui.socket = null; this.scene.clearGhost(); this.scene.setSeeThrough(false);
    this.render();
  }
  #areaView(id) { return id === 'wheels' ? `wheel_${this.ui.wheelCorner}` : id === 'sides' ? 'side_left' : id === 'underside' ? 'underbody' : id; }
  #view(v) { this.ui.view = v; this.scene.focus(v); }
  openSystems() {
    this.ui.tab = 'parts'; this.ui.panel = 'systems'; this.ui.area = null; this.ui.socket = null;
    this.scene.clearGhost(); this.#view('systems'); this.scene.setSeeThrough(true);
    this.render();
  }
  openSocket(name) {
    const s = this.socket(name);
    if (!s) return;
    this.ui.tab = 'parts'; this.ui.socket = name; this.ui.panel = 'socket'; this.ui.candidate = null; this.ui.area = s.area;
    this.scene.setSeeThrough(false); this.scene.clearGhost();
    const f = s.def.focus;
    if (f.startsWith('wheel_')) this.ui.wheelCorner = f.slice(6);
    this.#view(f.startsWith('wheel_') ? f : this.#areaView(s.area) === 'side_left' && f === 'side_right' ? 'side_right' : this.#areaView(s.area));
    this.render();
  }
  // a candidate to look at (its key: a spare copy's id, or "shop:partId")
  pick(key) {
    const c = this.#cand(key);
    if (!c) return;
    this.ui.candidate = key; this.ui.panel = 'compare';
    this.preview = this.w.preview(this.ui.socket, c);
    this.#ghost(key);
    this.render();
  }
  // The candidate with this key for the open socket: from its list, or a particular spare copy picked
  // in the inventory
  #cand(key) {
    if (!key || key === 'remove' || !this.ui.socket) return null;
    const w = this.w, found = w.partsFor(this.ui.socket).candidates.find(c => c.key === key);
    if (found) return found;
    const copy = w.profile.parts[key], part = copy && w.db.parts[copy.partId];
    if (!part || copy.installedOn) return null;
    return { key, instanceId: key, partId: part.id, count: 1, part, condition: copy.condition ?? 100, owned: true, set: 1, price: 0, affordable: true, locked: null, blockers: [], gain: [], ratingChange: 0 };
  }
  back() {
    if (this.ui.dialog) { this.ui.dialog = null; return this.render(); }
    if (this.ui.pop) { this.ui.pop = null; this.ui.renaming = null; return this.render(); }
    if (this.ui.panel === 'compare') { this.ui.panel = 'socket'; this.ui.candidate = null; this.scene.clearGhost(); return this.render(); }
    if (this.ui.panel) return this.act('close');
    if (this.ui.tab !== 'parts') return this.setTab('parts');
    if (this.ui.area) return this.setArea(this.ui.area);
    return this.act('leave');
  }

  // the part being looked at, as a ghost on its socket(s)
  #ghost(key) {
    if (!key || key === 'remove' || this.ui.tab !== 'parts' || !this.ui.socket) { this.scene.clearGhost(); return; }
    if (this.ghosting === key && this.scene.ghosts.length) return;
    this.ghosting = key;
    const w = this.w, part = this.#cand(key)?.part;
    if (!part) return;
    const group = w.car.socketGroups?.[part.slot], sockets = group ?? [this.ui.socket];
    const entries = sockets.map(s => {
      const def = w.car.sockets.find(x => x.name === s), rimId = def.node && w.build.sockets[def.node];
      return { socket: s, part, rim: rimId ? w.db.parts[w.state.parts[rimId]?.partId] : null };
    });
    this.scene.ghost(entries, w.db.parts).catch(() => {});
  }

  // Fitting the candidate (bought first if it's the shop's), with the animation; the car on the lift
  // is the animation's to change meanwhile
  async install() {
    const w = this.w, c = this.#cand(this.ui.candidate);
    if (!c || this.changing) return;
    const old = this.socket(this.ui.socket)?.part;
    this.changing = true;
    try {
      const r = await w.install(this.ui.socket, c);
      if (!r.ok) { this.toast(this.#words(r.error ?? "It can't go on"), 'error', 'bad'); return; }
      this.ui.panel = 'socket'; this.ui.candidate = null; this.preview = null;
      this.render();
      await this.scene.animateChange(r.ops ?? [], () => this.showCar(), w.car.sockets, w.car.socketGroups, id => w.db.parts[w.profile.parts[id]?.partId]);
      this.toast(`${c.part.name} ${c.owned ? '' : `bought (${this.money(c.price)}) and `}fitted${old && old.id !== c.part.id ? ` · ${old.name} to the inventory` : ''}`, 'check_circle', 'good');
    } finally { this.changing = false; }
  }
  async takeOff() {
    const w = this.w, s = this.socket(this.ui.socket);
    if (this.changing) return;
    this.changing = true;
    try {
      const r = await w.remove(this.ui.socket);
      if (!r.ok) { this.toast(this.#words(r.error ?? "It can't come off"), 'error', 'bad'); return; }
      this.ui.panel = 'socket'; this.ui.candidate = null; this.preview = null;
      this.render();
      await this.scene.animateChange(r.ops ?? [], () => this.showCar(), w.car.sockets, w.car.socketGroups, id => w.db.parts[w.profile.parts[id]?.partId]);
      this.toast(`${s.part.name} to the inventory`, 'inventory_2');
    } finally { this.changing = false; }
  }
  // (after an undo and the like: the comparison open is worked out again; the car follows by itself)
  #syncCar() {
    const u = this.ui, c = u.panel === 'compare' && u.candidate !== 'remove' ? this.#cand(u.candidate) : null;
    this.preview = u.panel !== 'compare' ? null : u.candidate === 'remove' ? this.w.previewRemove(u.socket) : c ? this.w.preview(u.socket, c) : null;
    if (u.panel === 'compare' && !this.preview) { u.panel = u.socket ? 'socket' : null; u.candidate = null; this.scene.clearGhost(); }
    this.render();
  }

  // live tuning: the numbers and the slider, without redrawing the panel under the pointer
  #liveTuning(input) {
    const box = input.closest('.slider'), min = +input.min, max = +input.max, v = +input.value, pct = (v - min) / (max - min) * 100;
    box.querySelector('.fill').style.width = pct + '%'; box.querySelector('.thumb-dot').style.left = pct + '%';
    const [sock, setting] = input.dataset.tune.split('|'), t = this.w.tunable().find(x => x.socket === sock && x.setting === setting);
    const sv = input.closest('.g-setting').querySelector('[data-sv]'), dec = t.step < 0.1 ? 2 : t.step < 1 ? 1 : 0;
    sv.textContent = `${t.value.toFixed(dec)}${t.unit && t.unit !== ':1' ? ' ' + t.unit : ''}`;
    sv.style.color = t.value !== t.default ? 'var(--c-accent)' : 'var(--c-text-2)';
    const fx = this.stage.querySelector('[data-effects]'); if (fx) fx.innerHTML = this.#effects();
    const strip = this.stage.querySelector('.g-strip'); if (strip) strip.outerHTML = this.#strip();
    const badge = this.stage.querySelector('.class-badge'), r = this.stats.totals?.rating;
    if (badge && r) { badge.querySelector('.cls').textContent = r.class; badge.querySelector('.pi').textContent = r.index; }
    this.scene.setSpec(this.stats.spec);
  }
  #pickColour(el, e) {
    const r = el.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const p = this.ui.paintEdit;
    if (el.dataset.pick === 'hue') p.h = x * 359.9; else { p.s = x; p.v = 1 - y; }
    const hex = hsvHex(p.h, p.s, p.v);
    this.scene.previewPaint({ colour: hex, finish: p.finish });
    // (move the knobs and names in place: the panel stays under the pointer)
    const sv = this.stage.querySelector('.g-sv'), hue = this.stage.querySelector('.g-hue');
    sv.style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${p.h},100%,50%))`;
    sv.querySelector('.knob').style.left = p.s * 100 + '%'; sv.querySelector('.knob').style.top = (1 - p.v) * 100 + '%';
    hue.querySelector('.knob').style.left = p.h / 360 * 100 + '%'; hue.querySelector('.knob').style.background = `hsl(${p.h},100%,50%)`;
    this.stage.querySelector('.g-colour .sw').style.background = hex;
    this.stage.querySelector('[data-chex]').textContent = hex.toUpperCase();
    const match = PRESETS.find(q => q[1].toLowerCase() === hex.toLowerCase());
    this.stage.querySelector('[data-cname]').textContent = match ? match[0] : 'Custom colour';
    const apply = this.stage.querySelector('[data-act="apply-paint"]'); if (apply) apply.disabled = hex === this.w.paint.colour && p.finish === this.w.paint.finish;
  }

  runDyno() {
    const run = this.w.dynoRun();
    if (!run) return;
    this.ui.dyno.overlay = this.w.runs[1]?.id ?? null;
    this.dynoShown = run;
    this.ui.dyno.t = 0;
    this.render();
    const start = performance.now(), seconds = 3.2;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 1000 / seconds);
      this.ui.dyno.t = t;
      const rpm = run.points[0].rpm + (run.points.at(-1).rpm - run.points[0].rpm) * t;
      this.sounds.dyno(rpm);
      this.#drawDyno();
      if (t < 1) requestAnimationFrame(step);
      else { this.ui.dyno.t = null; this.dynoShown = null; this.sounds.dyno(null); this.render(); }
    };
    requestAnimationFrame(step);
  }

  toast(text, ic = 'info', kind = '') {
    this.ui.toast = { text, icon: ic, kind };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.ui.toast = null; this.render(); }, 3200);
    this.render();
  }

  // ---------- gamepad: the D-pad moves between controls, A presses, B goes back, the right stick orbits ----------
  pollGamepad(dt) {
    const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    if (!pad) return;
    const was = this.pad.prev, now = pad.buttons.map(b => b.pressed), hit = i => now[i] && !was[i];
    this.pad.prev = now;
    const ax = pad.axes, dz = v => Math.abs(v) > 0.15 ? v : 0;
    if (dz(ax[2]) || dz(ax[3])) this.scene.orbitBy(-dz(ax[2]) * 120 * dt, -dz(ax[3]) * 90 * dt);
    const lt = pad.buttons[6]?.value ?? 0, rt = pad.buttons[7]?.value ?? 0;
    if (lt > 0.1 || rt > 0.1) this.scene.zoomBy(Math.exp((lt - rt) * dt * 1.5));
    // direction: D-pad, or the left stick (repeating while held)
    let dir = hit(12) ? 'up' : hit(13) ? 'down' : hit(14) ? 'left' : hit(15) ? 'right' : null;
    const sx = dz(ax[0]), sy = dz(ax[1]);
    this.pad.repeat -= dt;
    if (!dir && (Math.abs(sx) > 0.6 || Math.abs(sy) > 0.6) && this.pad.repeat <= 0) { dir = Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'right' : 'left') : (sy > 0 ? 'down' : 'up'); this.pad.repeat = 0.22; }
    if (!sx && !sy) this.pad.repeat = 0;
    if (dir) {
      const f = document.activeElement;
      if (f?.type === 'range' && (dir === 'left' || dir === 'right')) { f.value = +f.value + (dir === 'right' ? 1 : -1) * +f.step; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); }
      else this.#moveFocus(dir);
    }
    if (hit(0)) { const f = document.activeElement; if (f && this.root.contains(f) && f.type !== 'range') f.click(); }
    if (hit(1)) this.back();
    if (hit(2)) this.act('undo');
    if (hit(3)) this.act('redo');
    if (hit(4) || hit(5)) { const i = TABS.findIndex(t => t[0] === this.ui.tab); this.setTab(TABS[(i + (hit(5) ? 1 : TABS.length - 1)) % TABS.length][0]); }
    if (hit(8)) this.act('save');
    if (hit(9) && this.w.drivable.ok) this.act('test');
  }
  #moveFocus(dir) {
    const all = [...this.root.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter(el => el.offsetParent !== null || el.closest('.markers'));
    const visible = all.filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).display !== 'none'; });
    const cur = document.activeElement && this.root.contains(document.activeElement) ? document.activeElement : null;
    if (!cur) { (this.stage.querySelector('.g-side button, .g-side input') ?? visible[0])?.focus(); return; }
    const c = cur.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of visible) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, dx = x - cx, dy = y - cy;
      const main = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx, side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (main <= 2) continue;
      const score = main + side * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    best?.focus();
    best?.scrollIntoView?.({ block: 'nearest' });
  }
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
// a part's picture: its icon (npm run import renders them), else its slot's symbol
const thumb = (part, slot) => part?.icon ? `<div class="thumb pic"><img src="${esc(part.icon)}" alt="" loading="lazy"></div>` : `<div class="thumb">${icon(iconFor(part?.slot === 'wheels' ? 'wheel' : part?.slot ?? slot))}</div>`;
const catName = c => ({ ecu: 'ECU', lsd: 'LSD' })[c] ?? cap(c);
// a part's upgrade tier (data/content/tiers.json), and what it's for if not just speed
const tierBadge = part => part?.tier && part.tier !== 'stock' ? `<span class="badge plain tier-${part.tier}" title="${cap(part.tier)} tier${part.purpose ? `: for ${part.purpose}` : ''}">${part.tier}${part.purpose ? ` · ${part.purpose}` : ''}</span>` : '';
