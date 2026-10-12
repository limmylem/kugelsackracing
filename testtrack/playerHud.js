// The players' HUD (the Ogni Strada look): a cluster in the bottom right — the speed, big; the revs as a segmented arc
// round it, red past the rev limit, glowing as it nears the limit (shift now); the gear; lamps (the aids working,
// HOLD, the limiter, an engine in trouble); the lap or stage time on a track; and where you are. The full HUD with
// its numbers (#testHud, H) is the admins' (index.html: body.kr-worlds).
//
//   const P = createPlayerHud()   document.body.append(P.el)
//   P.update({ place, kmh, gear, rpm, redline, idle, held, limiter, blown, floating, assists, abs, tc, esc, lap, stuck })
//     lap: { label, time, best, progress } or null      stuck: [reasons] or null

const CSS = `
#playerHud { position: fixed; right: 18px; bottom: 40px; z-index: 6; width: 260px; display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  color: #fff; font: 600 12px/1.2 Barlow, system-ui, sans-serif; pointer-events: none; user-select: none; font-variant-numeric: tabular-nums; }
body.garage-mode #playerHud, body.roamPhoto #playerHud, #playerHud [hidden] { display: none !important; }
#playerHud .ph-cluster { position: relative; height: 214px; border-radius: 22px; overflow: hidden;
  background: radial-gradient(120% 100% at 50% 100%, rgba(30, 10, 12, .9), rgba(8, 8, 10, .82) 70%); border: 1px solid rgba(255, 255, 255, .08);
  box-shadow: 0 14px 40px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .06); backdrop-filter: blur(6px); }
#playerHud .ph-cluster::before { content: ''; position: absolute; left: 18px; top: 0; width: 34%; height: 3px; border-radius: 0 0 3px 3px; background: linear-gradient(90deg, #E3121E, #FF4A36); }
#playerHud svg { position: absolute; left: 50%; top: 10px; width: 236px; height: 236px; transform: translateX(-50%); overflow: visible; }
#playerHud .track { fill: none; stroke: rgba(255, 255, 255, .09); stroke-width: 14; }
#playerHud .red { fill: none; stroke: rgba(227, 18, 30, .45); stroke-width: 14; }
#playerHud .rev { fill: none; stroke: url(#ph-rev); stroke-width: 14; stroke-dasharray: 0 100; transition: stroke-dasharray .1s linear; }
#playerHud .cuts { fill: none; stroke: #0b0b0d; stroke-width: 16; stroke-dasharray: .35 2.15; }
#playerHud.shift .rev { filter: drop-shadow(0 0 8px #ff2a2a); }
#playerHud.shift .ph-cluster { animation: ph-shift .18s steps(2) infinite; }
@keyframes ph-shift { 50% { box-shadow: 0 0 0 2px #ff3b2f, 0 0 26px rgba(255, 40, 40, .55); } }
#playerHud .ph-speed { position: absolute; left: 0; right: 0; top: 46px; text-align: center; line-height: 1; }
#playerHud .ph-speed b { display: block; font: italic 900 68px/0.95 Saira, 'Barlow Condensed', Barlow, sans-serif; font-stretch: 125%; letter-spacing: -.02em;
  text-shadow: 0 2px 0 rgba(0, 0, 0, .6), 0 0 22px rgba(255, 255, 255, .12); }
#playerHud .ph-speed small { display: block; margin-top: 4px; font-size: 11px; font-weight: 700; letter-spacing: .32em; color: #9AA0A8; }
#playerHud .ph-gear { position: absolute; left: 50%; transform: translateX(-50%); bottom: 12px; min-width: 44px; height: 44px; padding: 0 8px; display: grid; place-items: center;
  font: italic 900 28px Saira, 'Barlow Condensed', Barlow, sans-serif; font-stretch: 125%; color: #fff;
  background: linear-gradient(180deg, #FF4A36, #E3121E 48%, #B30A16 52%, #D8141F); clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); text-shadow: 0 1px 0 rgba(0,0,0,.4); }
#playerHud .ph-gear.n { background: linear-gradient(180deg, #3A3E46, #1C1E22); }
#playerHud .ph-rpm { position: absolute; left: 0; right: 0; top: 135px; text-align: center; font: 600 11px "JetBrains Mono", monospace; color: #9AA0A8; }
#playerHud .ph-rpm b { color: #fff; font-size: 13px; }
#playerHud .ph-lamps { display: flex; gap: 5px; justify-content: flex-end; flex-wrap: wrap; min-height: 22px; }
#playerHud .ph-lamps span { padding: 4px 8px; border-radius: 6px; font: 700 10px "JetBrains Mono", monospace; letter-spacing: .08em;
  background: rgba(8, 8, 10, .78); border: 1px solid rgba(255, 255, 255, .08); color: #6E737A; }
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
@media (max-width: 760px) { #playerHud { transform: scale(.78); transform-origin: bottom right; right: 8px; bottom: 34px; } }
`;

// the arc: 240°, from the bottom left round over the top to the bottom right
const R = 98, C = 118, A0 = 150, SWEEP = 240;
const arc = (t0, t1) => { const p = t => { const a = (A0 + SWEEP * t) * Math.PI / 180; return [C + R * Math.cos(a), C + R * Math.sin(a)]; }; const [x0, y0] = p(t0), [x1, y1] = p(t1); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 ${(t1 - t0) * SWEEP > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
const clock = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createPlayerHud() {
  if (!document.getElementById('playerHudCss')) { const st = document.createElement('style'); st.id = 'playerHudCss'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div');
  el.id = 'playerHud'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="ph-stuck" hidden></div><div class="ph-timer" hidden></div><div class="ph-lamps"></div>
    <div class="ph-cluster"><svg viewBox="0 0 236 236"><defs><linearGradient id="ph-rev" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#C3C8CF"/><stop offset=".6" stop-color="#FFFFFF"/><stop offset=".85" stop-color="#FF6A52"/><stop offset="1" stop-color="#E3121E"/></linearGradient></defs>
      <path class="track" d="${arc(0, 1)}"/><path class="red" d="${arc(0.86, 1)}"/><path class="rev" pathLength="100" d="${arc(0, 1)}"/><path class="cuts" pathLength="100" d="${arc(0, 1)}"/></svg>
      <div class="ph-speed"><b>0</b><small>KM/H</small></div><div class="ph-rpm"><b>0</b> rpm</div><div class="ph-gear n">N</div></div>
    <div class="ph-place"></div>
    <div class="ph-keys"><kbd>R</kbd> back on the road · <kbd>C</kbd> camera · <kbd>O</kbd> settings</div>`;
  const $ = s => el.querySelector(s);
  const speed = $('.ph-speed b'), rpmEl = $('.ph-rpm b'), gear = $('.ph-gear'), rev = $('.rev'), red = $('.red'), lamps = $('.ph-lamps'), timer = $('.ph-timer'), stuckEl = $('.ph-stuck'), place = $('.ph-place');
  let last = {};
  const set = (k, v, fn) => { if (last[k] !== v) { last[k] = v; fn(v); } };
  return {
    el,
    update(d) {
      // the dial's top: the rev limit and a little more; the red from the limit up
      const top = Math.ceil(((d.redline || 7000) + 800) / 1000) * 1000, share = Math.max(0, Math.min(1, (d.rpm || 0) / top));
      set('kmh', d.kmh, v => { speed.textContent = String(v); });
      set('rpm', Math.round((d.rpm || 0) / 50) * 50, v => { rpmEl.textContent = v.toLocaleString('en-GB'); });
      set('gear', d.gear, v => { const g = v == null || v === 0 ? 'N' : v === -1 ? 'R' : String(v); gear.textContent = g; gear.classList.toggle('n', g === 'N' || g === 'R'); });
      set('redline', top, () => red.setAttribute('d', arc(Math.min(0.99, (d.redline || 7000) / top), 1)));
      rev.style.strokeDasharray = `${(share * 100).toFixed(2)} 100`;
      el.classList.toggle('shift', !!d.redline && d.rpm >= d.redline * 0.93 && d.kmh > 3);
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
