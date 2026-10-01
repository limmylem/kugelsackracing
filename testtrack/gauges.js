// Tachometer and dyno overlay for the test worlds (2D canvas). The dyno plots the engine model the
// physics uses (physics/engine.js), swept across the rev range at full throttle.

import { dyno } from '../physics/engine.js';

const FONT = '600 11px system-ui, sans-serif';

// Round tacho: 0–8000 rpm over a 240° arc, redline band, needle, gear in the middle, shift light
export function createTacho(E) {
  const canvas = document.createElement('canvas'), dpr = Math.min(devicePixelRatio, 2), W = 190, H = 150;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  canvas.className = 'tacho';
  const g = canvas.getContext('2d'), max = Math.ceil((E.redlineRpm + 800) / 1000) * 1000;
  const cx = W / 2, cy = 88, r = 70, a0 = Math.PI * 5 / 6, sweep = Math.PI * 4 / 3;
  const ang = rpm => a0 + sweep * Math.min(rpm, max) / max;
  return {
    canvas,
    draw(e) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.lineCap = 'round';
      g.lineWidth = 6;
      g.strokeStyle = '#ffffff22'; g.beginPath(); g.arc(cx, cy, r, a0, a0 + sweep); g.stroke();
      g.strokeStyle = '#e8433a'; g.beginPath(); g.arc(cx, cy, r, ang(E.redlineRpm), a0 + sweep); g.stroke();
      g.strokeStyle = e.fuelCut ? '#e8433a' : '#5ec8ff'; g.beginPath(); g.arc(cx, cy, r, a0, ang(e.rpm)); g.stroke();
      g.font = FONT; g.fillStyle = '#ffffffaa'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 0; k <= max / 1000; k++) {
        const a = ang(k * 1000);
        g.lineWidth = 1.5; g.strokeStyle = '#ffffff88';
        g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10)); g.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); g.stroke();
        g.fillText(k, cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20));
      }
      const a = ang(e.rpm);
      g.lineWidth = 2.5; g.strokeStyle = '#ff6a3d';
      g.beginPath(); g.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10); g.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); g.stroke();
      g.fillStyle = '#ff6a3d'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
      // gear, mode and rpm
      g.fillStyle = '#fff'; g.font = '700 30px system-ui, sans-serif';
      g.fillText(e.gear, cx, cy + 30);
      g.font = FONT; g.fillStyle = '#ffffff99';
      g.fillText(`${e.mode === 'auto' ? 'AUTO' : 'SEQ'}${e.shifting ? ' · shift' : ''}`, cx, cy + 52);
      g.fillText(`${Math.round(e.rpm)} rpm ×1000`, cx, 10);
      // shift light
      const lit = e.rpm > E.redlineRpm - 500;
      g.fillStyle = lit ? (e.fuelCut && performance.now() % 120 < 60 ? '#ffffff' : '#e8433a') : '#ffffff18';
      g.beginPath(); g.arc(W - 16, 16, 6, 0, Math.PI * 2); g.fill();
    },
  };
}

// Dyno: a panel that sweeps the rev range at full throttle and draws torque and power (and the
// closed-throttle engine braking torque) as it goes
export function createDyno(E) {
  const el = document.createElement('div');
  el.id = 'dyno';
  el.hidden = true;
  const canvas = document.createElement('canvas'), dpr = Math.min(devicePixelRatio, 2), W = 560, H = 330;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = '100%'; canvas.style.aspectRatio = `${W} / ${H}`;
  el.innerHTML = '<div class="head"><b>Dyno</b> <span>full-throttle sweep · <kbd>Y</kbd> close · <kbd>Enter</kbd> run again</span></div>';
  el.appendChild(canvas);
  const g = canvas.getContext('2d');
  const data = dyno(E, 25), rpmMax = E.redlineRpm + 400;
  const tMax = Math.ceil(Math.max(...data.map(d => d.torque)) / 20) * 20 + 20, tMin = Math.floor(Math.min(...data.map(d => d.braking)) / 20) * 20;
  const kwMax = Math.ceil(Math.max(...data.map(d => d.kw)) / 20) * 20 + 20;
  const L = 48, R = 52, T = 18, B = 36, pw = W - L - R, ph = H - T - B;
  const X = rpm => L + pw * rpm / rpmMax, YT = t => T + ph * (tMax - t) / (tMax - tMin);
  // power shares the plot: 0 kW level with 0 N·m, kwMax at the top
  const Ykw = kw => YT(0) - (YT(0) - YT(tMax)) * kw / kwMax;
  let start = 0, raf = 0;

  function draw(progress) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = FONT; g.textBaseline = 'middle';
    // grid
    g.strokeStyle = '#ffffff18'; g.lineWidth = 1; g.fillStyle = '#ffffff88';
    for (let rpm = 0; rpm <= rpmMax; rpm += 1000) { g.beginPath(); g.moveTo(X(rpm), T); g.lineTo(X(rpm), T + ph); g.stroke(); g.textAlign = 'center'; g.fillText(rpm / 1000 + 'k', X(rpm), H - B + 14); }
    for (let t = tMin; t <= tMax; t += 20) { g.beginPath(); g.moveTo(L, YT(t)); g.lineTo(L + pw, YT(t)); g.stroke(); g.textAlign = 'right'; g.fillText(t, L - 6, YT(t)); }
    g.textAlign = 'left';
    for (let kw = 0; kw <= kwMax; kw += 20) g.fillText(`${kw} kW`, L + pw + 6, Ykw(kw));
    g.textAlign = 'center'; g.fillText('rpm', L + pw / 2, H - 8);
    g.save(); g.translate(12, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText('torque N·m', 0, 0); g.restore();
    g.strokeStyle = '#e8433a88'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(E.redlineRpm), T); g.lineTo(X(E.redlineRpm), T + ph); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#ffffff55'; g.beginPath(); g.moveTo(L, YT(0)); g.lineTo(L + pw, YT(0)); g.stroke();
    // curves up to the sweep position
    const upTo = E.idleRpm + (E.redlineRpm - E.idleRpm) * progress, shown = data.filter(d => d.rpm <= upTo);
    const line = (key, y, colour, dash = []) => { g.strokeStyle = colour; g.lineWidth = 2.5; g.setLineDash(dash); g.beginPath(); shown.forEach((d, i) => i ? g.lineTo(X(d.rpm), y(d[key])) : g.moveTo(X(d.rpm), y(d[key]))); g.stroke(); g.setLineDash([]); };
    line('torque', YT, '#5ec8ff');
    line('kw', Ykw, '#ff9a3d');
    line('braking', YT, '#b48cff', [5, 4]);
    // readouts
    const pt = shown.reduce((a, d) => d.torque > a.torque ? d : a, { torque: -1e9 }), pp = shown.reduce((a, d) => d.kw > a.kw ? d : a, { kw: -1e9 }), cur = shown.at(-1);
    g.textAlign = 'left'; g.font = '600 12px system-ui, sans-serif';
    g.fillStyle = '#5ec8ff'; g.fillText(`torque ${cur ? cur.torque.toFixed(0) : '–'} N·m   peak ${pt.torque.toFixed(0)} @ ${pt.rpm}`, L + 10, T + 12);
    g.fillStyle = '#ff9a3d'; g.fillText(`power ${cur ? cur.kw.toFixed(0) : '–'} kW   peak ${pp.kw.toFixed(1)} kW (${pp.hp.toFixed(0)} hp) @ ${pp.rpm}`, L + 10, T + 30);
    g.fillStyle = '#b48cff'; g.fillText('engine braking (throttle shut)', L + 10, T + 48);
    if (cur) { g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(`${Math.round(upTo)} rpm`, X(upTo), T + ph - 10); }
  }
  function run() {
    cancelAnimationFrame(raf);
    start = performance.now();
    const tick = () => { const p = Math.min(1, (performance.now() - start) / 3000); draw(p); if (p < 1 && !el.hidden) raf = requestAnimationFrame(tick); };
    tick();
  }
  return {
    el,
    toggle() { el.hidden = !el.hidden; if (!el.hidden) run(); },
    rerun() { if (!el.hidden) run(); },
    draw,                                   // draw(progress 0..1) directly, e.g. from the console
    hide() { el.hidden = true; },
  };
}
