// The players' HUD: a car's instrument cluster in the bottom right — two round dials as in a real car, the rev
// counter (×1000 rpm, its red zone from the rev limit) and the speedometer (km/h), each with a chrome rim, numbered
// markings and a red needle; the gear and the gearbox (AUTO or SEQ) in the rev counter, the speed in digits in the
// speedometer; along the bottom the warning lights a car has — the engine temperature gauge, check engine, tyre
// pressure, overheating, limp mode, damaged systems (testtrack/dashboard.js's, put in P.warnings) — and the aids
// working, HOLD, the limiter; the lap or stage time on a track; where you are. The full HUD with its numbers
// (#testHud, H) is the admins' (index.html: body.kr-worlds).
//
//   const P = createPlayerHud()   document.body.append(P.el)   P.warnings.append(createDash().el)
//   P.update({ place, kmh, gear, mode ('auto' | 'manual': the gearbox, shown under the gear), rpm, redline, held, limiter, blown, floating, assists, abs, tc, esc, lap, stuck })
//     lap: { label, time, best, progress } or null      stuck: [reasons] or null

const CSS = `
#playerHud { position: fixed; right: 16px; bottom: 40px; z-index: 6; will-change: transform; width: 426px; display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  color: #fff; font: 600 12px/1.2 Barlow, system-ui, sans-serif; pointer-events: none; user-select: none; font-variant-numeric: tabular-nums; }
body.garage-mode #playerHud, body.roamPhoto #playerHud, #playerHud [hidden] { display: none !important; }
#playerHud .ph-cluster { position: relative; display: flex; flex-direction: column; align-items: stretch; padding: 10px 12px 8px;
  border-radius: 110px 110px 26px 26px; background: radial-gradient(140% 120% at 50% 100%, rgba(26, 12, 14, .92), rgba(6, 6, 8, .86) 70%);
  border: 1px solid rgba(255, 255, 255, .08); box-shadow: 0 10px 24px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .06); }
#playerHud .ph-dials { display: flex; align-items: flex-end; justify-content: center; }
#playerHud .ph-dial { position: relative; flex: none; }
/* the warning lights: dashboard.js's temperature gauge and lamps, then the tell-tales */
#playerHud .ph-warn { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 2px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, .07); }
#playerHud .ph-warn .dash { display: flex; align-items: center; gap: 6px; }
#playerHud .ph-warn .dash canvas { display: block; width: 74px !important; height: 40px !important; }
#playerHud .ph-warn .dash .lamps { display: flex; gap: 3px; }
#playerHud .ph-warn .dl { display: inline-flex; align-items: center; gap: 1px; height: 22px; min-width: 22px; justify-content: center; border-radius: 5px; color: rgba(255, 255, 255, .2); }
#playerHud .ph-warn .dl.text { font-size: 9px; font-weight: 800; letter-spacing: .05em; padding: 0 4px; }
#playerHud .ph-warn .dl.amber { color: #ffb52e; background: rgba(255, 181, 46, .14); box-shadow: 0 0 6px rgba(255, 181, 46, .45); }
#playerHud .ph-warn .dl.red { color: #ff4b3e; background: rgba(255, 75, 62, .16); box-shadow: 0 0 6px rgba(255, 60, 50, .5); }
#playerHud .ph-warn .dl b { font-size: 9px; }
#playerHud .ph-dial svg { display: block; width: 100%; height: 100%; overflow: visible; }
#playerHud .ph-tach { width: 168px; height: 168px; margin-right: 12px; margin-bottom: 4px; }
#playerHud .ph-speedo { width: 214px; height: 214px; }
#playerHud .face { fill: url(#ph-face); }
#playerHud .rim { fill: none; stroke: url(#ph-chrome); stroke-width: 6; }
#playerHud .rim-in { fill: none; stroke: #050506; stroke-width: 1.5; }
#playerHud .tick { stroke: #E9ECEF; stroke-linecap: round; }
#playerHud .tick.minor { stroke: #8B929B; }
#playerHud .tick.red, #playerHud .num.red { stroke: #FF3B2F; fill: #FF3B2F; }
#playerHud .num { fill: #F2F4F7; font: italic 700 14px Barlow, system-ui, sans-serif; text-anchor: middle; dominant-baseline: central; }
#playerHud .ph-tach .num { font-size: 12px; }
#playerHud .redzone { fill: none; stroke: rgba(227, 18, 30, .75); stroke-width: 5; }
#playerHud .unit { fill: #8B929B; font: 700 7.5px Barlow, system-ui, sans-serif; letter-spacing: .14em; text-anchor: middle; }
#playerHud .needle { transition: transform .1s linear; transform-box: view-box; transform-origin: 100px 100px; }
#playerHud .needle path { fill: #FF3B2F; stroke: rgba(255, 90, 70, .35); stroke-width: 2; }
#playerHud .hub { fill: #1A1C20; stroke: #6E737A; stroke-width: 1.5; }
#playerHud .hub-dot { fill: #2A2D32; }
#playerHud .ph-digits { position: absolute; left: 0; right: 0; bottom: 30px; text-align: center; line-height: 1; }
#playerHud .ph-digits b { font: italic 800 26px Saira, 'Barlow Condensed', Barlow, sans-serif; font-stretch: 125%; }
#playerHud .ph-digits small { display: block; margin-top: 1px; font-size: 8px; font-weight: 700; letter-spacing: .22em; color: #8B929B; }
#playerHud .ph-gear { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); min-width: 30px; height: 30px; padding: 0 6px; display: grid; place-items: center; border-radius: 6px;
  font: italic 900 20px Saira, 'Barlow Condensed', Barlow, sans-serif; font-stretch: 125%; color: #fff; background: #C80F1B; box-shadow: 0 0 10px rgba(255, 40, 40, .4); }
#playerHud .ph-gear.n { background: #2A2D32; box-shadow: none; }
#playerHud .ph-mode { position: absolute; left: 0; right: 0; bottom: 12px; text-align: center; font: 700 8px "JetBrains Mono", monospace; letter-spacing: .16em; color: #8B929B; }
#playerHud .ph-mode.seq { color: #FF6A52; }
#playerHud.shift .ph-tach .face { fill: url(#ph-face-hot); }
#playerHud.shift .ph-gear { animation: ph-shift .36s steps(2) infinite; }   /* (under three flashes a second: WCAG 2.3.1) */
.a11y-no-flash #playerHud.shift .ph-gear { animation: none; background: #fff; color: #C80F1B; }   /* (flashing reduced: lit, steady) */
@keyframes ph-shift { 50% { background: #fff; color: #C80F1B; } }
#playerHud .ph-lamps { display: flex; gap: 3px; flex-wrap: wrap; }
#playerHud .ph-lamps span { padding: 4px 5px; border-radius: 5px; font: 700 9px "JetBrains Mono", monospace; letter-spacing: .04em; background: rgba(255, 255, 255, .03); color: #555A61; }
#playerHud .ph-lamps span.on { color: #7ee08a; border-color: rgba(126, 224, 138, .35); }
#playerHud .ph-lamps span.lit { color: #1a1405; background: #F2C037; border-color: #F2C037; }
#playerHud .ph-lamps span.bad { color: #fff; background: #C80F1B; border-color: #FF4A36; }
#playerHud .ph-timer { display: flex; justify-content: space-between; align-items: baseline; padding: 8px 12px; border-radius: 12px; background: rgba(8, 8, 10, .8); border: 1px solid rgba(255, 255, 255, .08); }
#playerHud .ph-timer span { font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: #9AA0A8; }
#playerHud .ph-timer b { font: 600 18px "JetBrains Mono", monospace; }
#playerHud .ph-timer i { font-style: normal; font: 600 12px "JetBrains Mono", monospace; color: #9AA0A8; }
#playerHud .ph-timer .bar { position: relative; flex: 1; height: 3px; margin: 0 10px; border-radius: 2px; background: rgba(255,255,255,.1); align-self: center; }
#playerHud .ph-timer .bar > div { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: #FF4A36; }
#playerHud .ph-stuck { padding: 8px 12px; border-radius: 12px; background: rgba(200, 15, 27, .9); font-size: 12px; }
#playerHud .ph-place { text-align: right; font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: rgba(255, 255, 255, .7); text-shadow: 0 1px 2px #000; }
#playerHud .ph-keys { text-align: right; font-size: 11px; color: rgba(255, 255, 255, .75); text-shadow: 0 1px 2px #000; animation: ph-fade 1s ease 25s forwards; }
#playerHud .ph-keys kbd { font: 700 10px "JetBrains Mono", monospace; padding: 1px 4px; border-radius: 3px; background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.2); }
@keyframes ph-fade { to { opacity: 0; } }
@media (max-width: 760px) { #playerHud { transform: scale(.7); transform-origin: bottom right; right: 8px; bottom: 34px; } }
`;

// a dial: 240° from the bottom left round over the top to the bottom right (as a car's), on a 200×200 face
const A0 = 150, SWEEP = 240;
const polar = (r, t) => { const a = (A0 + SWEEP * t) * Math.PI / 180; return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]; };
const arcPath = (r, t0, t1) => { const [x0, y0] = polar(r, t0), [x1, y1] = polar(r, t1); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${(t1 - t0) * SWEEP > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
// max: the dial's top; major: a numbered tick every; minor: a tick every; label(v): the number written; redFrom: the red zone
function dial({ cls, max, major, minor, label, labelEvery = major, redFrom = null, unit }) {
  let ticks = '', nums = '';
  for (let v = 0; v <= max + 1e-6; v += minor) {
    const t = v / max, isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6, red = redFrom != null && v >= redFrom - 1e-6;
    const [x0, y0] = polar(isMajor ? 72 : 77, t), [x1, y1] = polar(85, t);
    ticks += `<line class="tick ${isMajor ? '' : 'minor'} ${red ? 'red' : ''}" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke-width="${isMajor ? 2.6 : 1.3}"/>`;
    if (isMajor && Math.abs(v / labelEvery - Math.round(v / labelEvery)) < 1e-6) { const [nx, ny] = polar(60, t); nums += `<text class="num ${red ? 'red' : ''}" x="${nx.toFixed(1)}" y="${ny.toFixed(1)}">${label(v)}</text>`; }
  }
  return `<svg viewBox="0 0 200 200" class="${cls}-svg">
    <circle cx="100" cy="100" r="96" class="face"/><circle cx="100" cy="100" r="96" class="rim"/><circle cx="100" cy="100" r="92.5" class="rim-in"/>
    ${redFrom != null ? `<path class="redzone" d="${arcPath(87.5, Math.min(0.999, redFrom / max), 1)}"/>` : ''}
    <g>${ticks}</g><g>${nums}</g><text class="unit" x="100" y="70">${unit}</text>
    <g class="needle"><path d="M100 96.5 L183 100 L100 103.5 L88 101.5 L88 98.5 Z"/></g>
    <circle cx="100" cy="100" r="11" class="hub"/><circle cx="100" cy="100" r="4" class="hub-dot"/></svg>`;
}
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="ph-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F1F3F5"/><stop offset=".45" stop-color="#6E737A"/><stop offset=".5" stop-color="#1A1C20"/><stop offset=".62" stop-color="#8B929B"/><stop offset="1" stop-color="#C3C8CF"/></linearGradient>
  <radialGradient id="ph-face" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#22252B"/><stop offset=".75" stop-color="#0C0D10"/><stop offset="1" stop-color="#050506"/></radialGradient>
  <radialGradient id="ph-face-hot" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#4A1216"/><stop offset=".75" stop-color="#16080A"/><stop offset="1" stop-color="#050506"/></radialGradient>
</defs></svg>`;
const clock = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SPEED_MAX = 280, SPEED_MAX_FAST = 360;
// (the speedometer in the player's unit, ui/units.js: in mph, its top 180 or 220 — the same dial, its numbers in mph)
const MPH = 1 / 1.609344, MPH_MAX = 180, MPH_MAX_FAST = 220;

export function createPlayerHud() {
  if (!document.getElementById('playerHudCss')) { const st = document.createElement('style'); st.id = 'playerHudCss'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div');
  el.id = 'playerHud'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `${DEFS}<div class="ph-stuck" hidden></div><div class="ph-timer" hidden></div>
    <div class="ph-cluster"><div class="ph-dials"><div class="ph-dial ph-tach"></div><div class="ph-dial ph-speedo"></div></div>
      <div class="ph-warn"><div class="ph-dash"></div><div class="ph-lamps"></div></div></div>
    <div class="ph-place"></div>
    <div class="ph-keys"><kbd>R</kbd> back on the road · <kbd>C</kbd> camera · <kbd>O</kbd> settings</div>`;
  const $ = s => el.querySelector(s);
  const tach = $('.ph-tach'), speedo = $('.ph-speedo'), lamps = $('.ph-lamps'), timer = $('.ph-timer'), stuckEl = $('.ph-stuck'), place = $('.ph-place');
  let last = {}, mode = null, tachNeedle = null, speedNeedle = null, digits = null, gear = null, tachMax = 0, speedMax = 0, mph = false;
  const set = (k, v, fn) => { if (last[k] !== v) { last[k] = v; fn(v); } };
  // (drawn again when the car's rev limit changes, or a car goes faster than the speedometer's top)
  const drawTach = redline => {
    tachMax = Math.ceil((redline + 1000) / 1000) * 1000;
    tach.innerHTML = dial({ cls: 'tach', max: tachMax, major: 1000, minor: 500, label: v => v / 1000, redFrom: redline, unit: 'RPM ×1000' }) + '<div class="ph-gear n">N</div><div class="ph-mode">AUTO</div>';
    tachNeedle = tach.querySelector('.needle'); gear = tach.querySelector('.ph-gear'); mode = tach.querySelector('.ph-mode'); last.gear = undefined; last.mode = undefined;
  };
  const drawSpeedo = max => {
    speedMax = max;
    const unit = mph ? 'MPH' : 'KM/H';
    speedo.innerHTML = dial({ cls: 'speedo', max, major: mph ? 10 : 20, minor: mph ? 5 : 10, labelEvery: mph ? 20 : 40, label: v => v, unit }) + `<div class="ph-digits"><b>0</b><small>${unit}</small></div>`;
    speedNeedle = speedo.querySelector('.needle'); digits = speedo.querySelector('.ph-digits b'); last.kmh = undefined;
  };
  const angle = t => `rotate(${(A0 + SWEEP * Math.max(0, Math.min(1.02, t))).toFixed(2)}deg)`;
  return {
    el,
    warnings: el.querySelector('.ph-dash'),
    // 'mph' or 'km/h' (the settings' units)
    setSpeedUnit(unit) { const m = unit === 'mph'; if (m !== mph) { mph = m; speedMax = 0; } },
    update(d) {
      const redline = d.redline || 7000;
      if (redline !== last.redline) { last.redline = redline; drawTach(redline); }
      const shown = mph ? Math.round((d.kmh ?? 0) * MPH) : d.kmh ?? 0;
      const want = mph ? (shown > MPH_MAX - 6 ? MPH_MAX_FAST : MPH_MAX) : shown > SPEED_MAX - 10 ? SPEED_MAX_FAST : SPEED_MAX;
      if (want > speedMax) drawSpeedo(want);
      tachNeedle.style.transform = angle((d.rpm || 0) / tachMax);
      speedNeedle.style.transform = angle((shown || 0) / speedMax);
      set('kmh', shown, v => { digits.textContent = String(v); });
      set('gear', d.gear, v => { const g = v == null || v === 0 ? 'N' : v === -1 ? 'R' : String(v); gear.textContent = g; gear.classList.toggle('n', g === 'N' || g === 'R'); });
      // (the gearbox: automatic, or sequential — you change gear)
      set('mode', d.mode === 'auto' ? 'auto' : 'seq', v => { mode.textContent = v === 'auto' ? 'AUTO' : 'SEQ'; mode.classList.toggle('seq', v === 'seq'); mode.title = v === 'auto' ? 'Automatic gearbox' : 'Sequential gearbox'; });
      el.classList.toggle('shift', !!d.redline && d.rpm >= d.redline * 0.93 && (d.kmh ?? 0) > 3);
      const L = [
        d.assists ? '<span class="on">AIDS</span>' : '<span>AIDS OFF</span>',
        `<span class="${d.abs ? 'lit' : ''}">ABS</span>`, `<span class="${d.tc ? 'lit' : ''}">TC</span>`, `<span class="${d.esc ? 'lit' : ''}">ESC</span>`,
        d.held ? '<span class="lit">HOLD</span>' : '', d.limiter ? '<span class="bad">LIMITER</span>' : '',
        d.blown ? '<span class="bad">ENGINE BLOWN</span>' : d.floating ? '<span class="bad">VALVE FLOAT</span>' : '',
      ].join('');
      set('lamps', L, v => { lamps.innerHTML = v; });
      const T = d.lap ? `<span>${esc(d.lap.label)}</span><b>${d.lap.time != null ? clock(d.lap.time) : '–'}</b>${d.lap.progress != null ? `<div class="bar"><div style="width:${Math.round(d.lap.progress * 100)}%"></div></div>` : '<div class="bar"></div>'}<i>best ${d.lap.best != null ? clock(d.lap.best) : '–'}</i>` : '';
      set('timer', T, v => { timer.hidden = !v; timer.innerHTML = v; });
      set('stuck', d.stuck?.length ? d.stuck.join(' · ') : '', v => { stuckEl.hidden = !v; stuckEl.textContent = v ? `Can't drive: ${v}` : ''; });
      set('place', d.place ?? '', v => { place.textContent = v; });
    },
  };
}
