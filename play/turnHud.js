// The next turn, clearly, whenever the game is giving directions (play/questUi.js's route to somewhere, an Expedition,
// the full map's Set route; a race's or a test drive's course, play/routeDressing.js; a free-roam challenge,
// play/roam.js): a card at the top of the screen — the turn's arrow, how far to it, "Turn left onto King William
// Street", and "then right" when another follows close behind. Further than NEAR m: just how far to go straight on;
// within SOON m it turns amber; within NOW m it says Now and pulses. Off the route by more than OFF m: hidden.
//
//   import { directions } from './turnHud.js'
//   directions.set(id, { line, turns, loop, length }, priority)   directions.clear(id)   (the highest priority shown)
//   directions.update({ x, z })                                     each frame, the car's place (testtrack/test-scene.js)
//   directions.state                                                what it shows now (the tests)
// The turns come from route/turns.js.

import { nextTurn } from '../route/turns.js';
import { project } from '../route/geometry.js';
import { t } from '../ui/i18n.js';
import { playerUnits } from '../ui/units.js';

export const TURN_HUD = { near: 400, soon: 120, now: 30, off: 70 };
const CSS = `
#turnHud{position:fixed;top:12px;left:50%;transform:translateX(-50%) scale(var(--qs,1));transform-origin:top center;z-index:42;pointer-events:none;display:none;align-items:center;gap:14px;
  padding:10px 18px 10px 12px;border-radius:14px;background:rgba(12,16,24,.82);border:2px solid rgba(255,255,255,.14);color:#fff;font:600 15px/1.2 Barlow,system-ui,sans-serif;
  box-shadow:0 6px 22px rgba(0,0,0,.45);min-width:240px;max-width:min(560px,calc(100vw - 260px));text-shadow:0 1px 3px rgba(0,0,0,.5)}
#turnHud.on{display:flex}
#turnHud .ic{width:64px;height:64px;flex:none;border-radius:12px;background:rgba(255,255,255,.08);display:grid;place-items:center}
#turnHud .ic svg{width:54px;height:54px}
#turnHud .d{font:700 30px/1 "JetBrains Mono",monospace;letter-spacing:-.01em}
#turnHud .w{font:700 19px/1.15 Barlow,system-ui,sans-serif;margin-top:3px}
#turnHud .o{font-size:14px;opacity:.85;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#turnHud .then{display:flex;align-items:center;gap:4px;padding-left:12px;border-left:1px solid rgba(255,255,255,.2);font-size:13px;opacity:.9;white-space:nowrap}
#turnHud .then svg{width:26px;height:26px}
#turnHud.far{opacity:.82;padding:6px 14px 6px 8px;min-width:0}#turnHud.far .ic{width:40px;height:40px}#turnHud.far .ic svg{width:32px;height:32px}#turnHud.far .d{font-size:20px}#turnHud.far .w{font-size:14px}
#turnHud.soon{border-color:#ffb020;background:rgba(48,32,6,.88)}#turnHud.soon .ic{background:#ffb020}#turnHud.soon .ic svg polyline{stroke:#1a1206}#turnHud.soon .ic svg polygon,#turnHud.soon .ic svg path{fill:#1a1206}
#turnHud.now{border-color:#ffd24a;background:rgba(70,46,4,.92);animation:turnHudNow .5s ease-in-out infinite alternate}#turnHud.now .ic{background:#ffd24a}#turnHud.now .ic svg polyline{stroke:#1a1206}#turnHud.now .ic svg polygon,#turnHud.now .ic svg path{fill:#1a1206}
@keyframes turnHudNow{to{box-shadow:0 0 0 6px rgba(255,210,74,.35),0 6px 22px rgba(0,0,0,.45)}}
body.photoHideHud #turnHud,body.garage-mode #turnHud,body.pursuitFilm #turnHud{display:none!important}
body.turnCard #questHud .top{top:132px}body.turnCard #trackBack{top:132px}
@media (prefers-reduced-motion: reduce){#turnHud.now{animation:none}}
html.a11y-reduced-motion #turnHud.now{animation:none}
@media (max-width:760px){#turnHud{top:8px;max-width:calc(100vw - 24px);transform:translateX(-50%) scale(.82)}}
`;

// the arrow for a kind of turn (drawn turning left; a right turn is its mirror)
const PATHS = {
  straight: [[24, 44], [24, 9]], slight: [[28, 44], [28, 27], [15, 12]], turn: [[31, 44], [31, 22], [10, 22]], sharp: [[31, 44], [31, 16], [12, 33]],
  uturn: [[32, 44], [32, 20], [29, 13], [24, 11], [19, 13], [16, 20], [16, 33]], bend: [[28, 44], [28, 30], [24, 20], [15, 13]],
  sharpBend: [[30, 44], [30, 24], [22, 14], [11, 16]], hairpin: [[31, 44], [31, 20], [27, 12], [20, 11], [15, 16], [15, 30]],
};
export function arrowSvg(kind, way) {
  if (kind === 'arrive') return `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 44s-12-13-12-23a12 12 0 0 1 24 0c0 10-12 23-12 23z" fill="#fff" stroke="none"/><circle cx="24" cy="21" r="5" fill="rgba(0,0,0,.55)" stroke="none"/></svg>`;
  const pts = PATHS[kind] ?? PATHS.straight, [ax, ay] = pts.at(-2), [bx, by] = pts.at(-1), a = Math.atan2(by - ay, bx - ax) * 180 / Math.PI + 90;
  const mirror = way === 'right' ? ' transform="translate(48 0) scale(-1 1)"' : '';
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><g${mirror}><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <polygon points="0,-9 9,4 -9,4" transform="translate(${bx} ${by}) rotate(${a.toFixed(1)})" fill="#fff" stroke="none"/></g></svg>`;
}
// what to say for a turn: "Turn left", "Keep right", "Sharp bend left", "Arrive"…
export const turnWords = turn => t(`turn.${turn.kind}`, { way: t(`turn.way.${turn.way ?? 'left'}`) });
// how far, rounded the way a sat-nav says it: to 10 m close in, 50 m further, then tenths of a km
export function roundDistance(m) { return m < 30 ? m : m < 300 ? Math.round(m / 10) * 10 : m < 1000 ? Math.round(m / 50) * 50 : Math.round(m / 100) * 100; }

function create() {
  const sources = new Map();
  let el = null, shown = null, key = '', near = null, lastAt = -1;
  const state = { visible: false, kind: null, way: null, dist: null, phase: null, source: null, name: null };
  function mount() {
    if (el || typeof document === 'undefined') return el;
    const s = document.createElement('style'); s.id = 'turnHudCss'; s.textContent = CSS; document.head.append(s);
    el = document.createElement('div'); el.id = 'turnHud'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.append(el);
    return el;
  }
  function hide() {
    state.visible = false; state.kind = state.way = state.dist = state.phase = state.name = null;
    if (el?.classList.contains('on')) { el.classList.remove('on'); document.body.classList.remove('turnCard'); key = ''; }
  }
  return {
    state,
    set(id, route, priority = 1) {
      if (!route?.line?.length || !route.turns) { this.clear(id); return; }
      sources.set(id, { ...route, length: route.length ?? route.line.at(-1).s, priority, k: 0 });
    },
    clear(id) { sources.delete(id); if (!sources.size) hide(); },
    has: id => sources.has(id),
    update(car) {
      if (!sources.size || !car) { hide(); return; }
      // (the highest priority route the car is on: a course shown on the map but not being driven doesn't hide the way
      // to it)
      let src = null, p = null;
      for (const [id, S] of [...sources].sort((a, b) => b[1].priority - a[1].priority)) {
        let q = project(S.line, car.x, car.z, { from: S.k - 40, to: S.k + 60 });
        if (!q || q.dist > 25) { const all = project(S.line, car.x, car.z); if (all && (!q || all.dist < q.dist)) q = all; }
        if (q && q.dist <= TURN_HUD.off) { src = { id, ...S }; p = q; break; }
      }
      if (!src) { hide(); return; }
      if (shown !== src.id) { shown = src.id; near = null; }
      const S = sources.get(src.id);
      S.k = p.k;
      const n = nextTurn(S.turns, p.s, { length: S.length, loop: S.loop });
      if (!n) { hide(); return; }
      const d = Math.max(0, n.dist), phase = d > TURN_HUD.near ? 'far' : d > TURN_HUD.soon ? 'near' : d > TURN_HUD.now ? 'soon' : 'now';
      Object.assign(state, { visible: true, kind: n.turn.kind, way: n.turn.way, dist: d, phase, source: src.id, name: n.turn.name });
      // (the screen: only when what it says changes)
      if (!mount()) return;
      const U = playerUnits(), shownDist = phase === 'now' ? t('turn.now') : U.distance(roundDistance(d)).text;
      const words = phase === 'far' ? (n.turn.kind === 'arrive' ? turnWords(n.turn) : t('turn.straight')) : turnWords(n.turn);
      const next = `${phase}|${n.turn.kind}|${n.turn.way}|${shownDist}|${n.turn.name}|${n.then?.kind}|${n.then?.way}|${words}`;
      if (next === key) return;
      key = next;
      const icon = phase === 'far' && n.turn.kind !== 'arrive' ? arrowSvg('straight') : arrowSvg(n.turn.kind, n.turn.way);
      const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      el.className = `on ${phase}`;
      el.innerHTML = `<div class="ic">${icon}</div><div class="tx"><div class="d">${esc(shownDist)}</div><div class="w">${esc(words)}</div>${phase !== 'far' && n.turn.name ? `<div class="o">${esc(t('turn.onto', { name: n.turn.name }))}</div>` : ''}</div>`
        + (phase !== 'far' && n.then ? `<div class="then">${esc(t('turn.then'))} ${arrowSvg(n.then.kind, n.then.way)}</div>` : '');
      document.body.classList.add('turnCard');
      // (a new turn coming into view: said once, for a screen reader)
      if (near !== n.turn && phase !== 'far') { near = n.turn; el.setAttribute('aria-label', `${words}${n.turn.name ? `, ${t('turn.onto', { name: n.turn.name })}` : ''}, ${shownDist}`); }
      lastAt = d;
    },
    get lastDistance() { return lastAt; },
  };
}
export const directions = create();
