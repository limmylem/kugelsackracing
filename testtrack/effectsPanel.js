// The effects' debug panel (. in the test worlds): every effect on demand on your car, the quality and the
// time of day, and what the effects cost — particles alive (all, and each effect's), marks on the road,
// spark lights, and the milliseconds a frame spends moving them, uploading them and drawing them (the
// CPU's side of it; the scene's own draw beside it, for scale).

import { saveSettings } from './settings.js';

const CSS = `
  #fxPanel { position: fixed; z-index: 25; right: 12px; top: 12px; width: 300px; max-height: calc(100vh - 24px); overflow: auto; background: rgba(15, 20, 30, 0.92); color: #fff; border-radius: 10px; padding: 10px 12px; font: 12px system-ui, sans-serif; }
  #fxPanel .head { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; margin-bottom: 6px; }
  #fxPanel .head span { font-size: 11px; opacity: 0.7; }
  #fxPanel h4 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; margin: 10px 0 4px; font-weight: 600; }
  #fxPanel .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  #fxPanel button { background: #2a3446; color: #fff; border: 1px solid #3c4a62; border-radius: 6px; padding: 4px 6px; font: inherit; cursor: pointer; text-align: left; }
  #fxPanel button:hover { background: #34425a; }
  #fxPanel label { display: flex; gap: 8px; align-items: center; margin: 3px 0; }
  #fxPanel label input[type=range] { flex: 1; }
  #fxPanel table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  #fxPanel td { padding: 1px 0; } #fxPanel td:last-child { text-align: right; }
  #fxPanel .bar { height: 4px; background: #2a3446; border-radius: 2px; overflow: hidden; } #fxPanel .bar div { height: 100%; background: #5ec8ff; }
`;

// What each button does to your car (car 0): an event, as the game (or another player's) would send
const TRIGGERS = [
  ['Wall scrape (sparks)', fx => { fx.play({ type: 'scrapeStart', car: 0, key: 'debug', point: [0.95, 0.45, 0.6], amount: 1, speed: 18 }); setTimeout(() => fx.play({ type: 'scrapeStop', car: 0, key: 'debug' }), 2500); }],
  ['Bottoming out', fx => fx.play({ type: 'impact', car: 0, point: [0, 0.12, 0.3], normal: [0, -1, 0], strength: 12, material: 'ground', under: true })],
  ['Hard impact', fx => fx.play({ type: 'impact', car: 0, point: [0.3, 0.5, 2], normal: [0, 0, 1], strength: 16, material: 'concrete', part: 'socket_bumper_front', surface: 'dirt' })],
  ['Window breaks', fx => fx.play({ type: 'break', car: 0, kind: 'glass', point: [0, 1.05, 0.7] })],
  ['Light breaks', fx => fx.play({ type: 'break', car: 0, kind: 'light', point: [0.6, 0.65, 2] })],
  ['Part torn off', fx => fx.play({ type: 'partOff', car: 0, socket: 'socket_bumper_front', point: [0, 0.4, 2] })],
  ['Engine blows', fx => fx.play({ type: 'engineBlow', car: 0 })],
  ['Steam (5 s)', fx => fx.play({ type: 'burst', car: 0, effect: 'steam', point: 'engine', count: 220, seconds: 5 })],
  ['Engine smoke (5 s)', fx => fx.play({ type: 'burst', car: 0, effect: 'engineSmoke', point: 'engine', count: 150, seconds: 5 })],
  ['Flame', fx => fx.play({ type: 'burst', car: 0, effect: 'flame', point: 'engine', count: 70, seconds: 0.5 })],
  ['Tyre smoke (3 s)', fx => fx.play({ type: 'burst', car: 0, effect: 'tyreSmoke', point: [0.75, 0.1, -1.3], count: 160, seconds: 3 })],
  ['Dirt spray', fx => fx.play({ type: 'burst', car: 0, effect: 'spray', point: [0.75, 0.1, -1.3], count: 120, seconds: 1.5, colour: '#6b5640' })],
  ['Dust cloud', fx => fx.play({ type: 'burst', car: 0, effect: 'crashDust', point: [0, 0.3, 0], count: 90, colour: '#8a7152' })],
  ['Dust trail (3 s)', fx => fx.play({ type: 'burst', car: 0, effect: 'dust', point: [0, 0.2, -1.8], count: 150, seconds: 3, colour: '#b9a37f' })],
  ['Grass clippings', fx => fx.play({ type: 'burst', car: 0, effect: 'clippings', point: [0.75, 0.1, -1.3], count: 90, seconds: 1.5, colour: '#5c8a33' })],
  ['Skid marks + drips', fx => fx.play({ type: 'burst', car: 0, effect: 'marks' })],
];

export function createEffectsPanel(world, shared) {
  if (!document.getElementById('fxPanelCss')) { const st = document.createElement('style'); st.id = 'fxPanelCss'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div');
  el.id = 'fxPanel';
  el.hidden = true;
  const P = shared.prefs;
  el.innerHTML = `
    <div class="head"><b>Effects</b><span><kbd>.</kbd> close</span></div>
    <label>quality <select data-q>${['low', 'medium', 'high'].map(q => `<option ${P.effects === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
    <label>time <input type="range" min="0" max="24" step="0.25" data-t value="${P.timeOfDay ?? 13}"> <output data-to></output></label>
    <h4>Play on your car</h4>
    <div class="grid">${TRIGGERS.map(([name], i) => `<button data-i="${i}">${name}</button>`).join('')}</div>
    <h4>Cost</h4>
    <div data-cost></div>`;
  const clock = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  el.querySelector('[data-to]').textContent = clock(P.timeOfDay ?? 13);
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'), w = world();
    if (b && w) TRIGGERS[+b.dataset.i][1](w.fx);
  });
  el.addEventListener('input', e => {
    if (e.target.dataset.t !== undefined) { P.timeOfDay = +e.target.value; el.querySelector('[data-to]').textContent = clock(P.timeOfDay); saveSettings(P); }
  });
  el.addEventListener('change', e => { if (e.target.dataset.q !== undefined) { P.effects = e.target.value; saveSettings(P); } });

  let timer = 0;
  const cost = el.querySelector('[data-cost]');
  function update(w, dt) {
    if (el.hidden || (timer -= dt) > 0) return;
    timer = 0.25;
    const fx = w.fx, ps = fx.particles, d = w.fxDraw.stats, by = ps.byEffect();
    const row = (name, n, max) => `<tr><td>${name}</td><td>${n}${max ? ` / ${max}` : ''}</td></tr>`;
    const total = fx.stats.ms + d.uploadMs + d.fxMs;
    cost.innerHTML = `<table>
      ${row('quality', fx.level)}${row('particles', ps.count, ps.budget)}
      <tr><td colspan="2"><div class="bar"><div style="width:${Math.min(100, ps.count / ps.budget * 100)}%"></div></div></td></tr>
      ${ps.effects.map(e => by[e.name] ? row(`&nbsp;&nbsp;${e.name}`, by[e.name], e.limitNow) : '').join('')}
      ${row('marks on the road', fx.marks.live, fx.marks.limit)}${row('spark lights', fx.lights.length, ps.Q.lights)}${row('sparking now', fx.scrapes.size)}
      ${row('replaced (over budget)', ps.stats.stolen)}${row('events', fx.stats.events)}
      ${row('move (ms / frame)', fx.stats.ms.toFixed(2))}${row('upload (ms)', d.uploadMs.toFixed(2))}${row('draw (ms)', d.fxMs.toFixed(2))}
      ${row('effects in all (ms)', total.toFixed(2))}${row('the scene (ms, for scale)', d.sceneMs.toFixed(2))}
    </table>`;
  }
  return {
    el, update,
    toggle() { el.hidden = !el.hidden; },
    get open() { return !el.hidden; },
  };
}
