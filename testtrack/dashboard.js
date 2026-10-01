// The dashboard's damage side for the test worlds: the engine temperature gauge, the check engine light,
// and small lamps for tyre pressure, overheating, limp mode and damaged systems (physics/mechanical.js's
// snapshot, garage/mechanical.js's report); and the damage report (I): every system's state, per wheel
// and for the car. Styled in index.html (#testHud .dash, .damage-report).

const svg = (body, view = '0 0 24 24') => `<svg viewBox="${view}" width="18" height="18" aria-hidden="true">${body}</svg>`;
const ICONS = {
  engine: svg('<path fill="currentColor" d="M4 9h2V7h5V5h3v2h3l2 2h2v7h-2l-2 2H8l-2-2H4v-2H2v-4h2V9zm2 2v4h1.8l2 2h6.4l2-2H20v-3h-1.8l-2-2H6z"/>'),
  tyre: svg('<path fill="currentColor" d="M12 3C7 3 3 6.6 3 11c0 2.6 1.3 4.9 3.4 6.4L5 21h2.2l1.1-2.6c1.1.4 2.4.6 3.7.6s2.6-.2 3.7-.6l1.1 2.6H19l-1.4-3.6C19.7 15.9 21 13.6 21 11c0-4.4-4-8-9-8zm0 2c3.9 0 7 2.7 7 6s-3.1 6-7 6-7-2.7-7-6 3.1-6 7-6zm-1 2v5h2V7h-2zm0 6v2h2v-2h-2z"/>'),
  temp: svg('<path fill="currentColor" d="M11 3h2v9.3a3 3 0 1 1-2 0V3zm3 3h5v2h-5V6zm0 4h4v2h-4v-2zM3 19c1.3 0 1.3 1 2.7 1s1.3-1 2.6-1 1.3 1 2.7 1 1.3-1 2.7-1 1.3 1 2.6 1 1.3-1 2.7-1 1.3 1 2 1v1.5c-1.3 0-1.3-1-2.7-1s-1.3 1-2.6 1-1.4-1-2.7-1-1.3 1-2.7 1-1.3-1-2.6-1-1.4 1-2.7 1-1.3-1-2.7-1V19z"/>'),
  wrench: svg('<path fill="currentColor" d="M21.7 6.3 18 10l-4-4 3.7-3.7a6 6 0 0 0-7.4 7.4L3 17a2.1 2.1 0 0 0 3 3l7.3-7.3a6 6 0 0 0 7.4-7.4z"/>'),
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function createDash() {
  const el = document.createElement('div'), dpr = Math.min(devicePixelRatio, 2), W = 110, H = 60;
  el.className = 'dash';
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const lamps = document.createElement('div');
  lamps.className = 'lamps';
  el.append(canvas, lamps);
  const g = canvas.getContext('2d');
  const lamp = (key, title) => { const x = document.createElement('span'); x.className = 'dl'; x.title = title; x.innerHTML = ICONS[key] ?? ''; lamps.append(x); return x; };
  const cel = lamp('engine', 'check engine'), tpms = lamp('tyre', 'tyre pressure'), hot = lamp('temp', 'engine overheating');
  const limp = document.createElement('span'); limp.className = 'dl text'; limp.textContent = 'LIMP'; limp.title = 'limp mode: overheated'; lamps.append(limp);
  const fix = lamp('wrench', 'damaged systems'), fixN = document.createElement('b'); fix.append(fixN);
  const set = (x, level, title) => { x.className = `dl${x.classList.contains('text') ? ' text' : ''}${level ? ` ${level}` : ''}`; if (title) x.title = title; };
  let blink = 0;
  return {
    el,
    // s: the vehicle's snapshot; rows: the damage report (garage/mechanical.js damageReport); C: the cooling rules
    update(s, rows, C, dt = 0.1) {
      const m = s.mechanical;
      blink = (blink + dt) % 1;
      // the temperature gauge: C to H, the red past the warning
      const lo = 50, hi = 135, a0 = Math.PI * 1.1, sweep = Math.PI * 0.8, ang = x => a0 + sweep * clamp((x - lo) / (hi - lo), 0, 1), cx = W / 2, cy = 52, r = 38;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.lineCap = 'round'; g.lineWidth = 5;
      g.strokeStyle = '#ffffff22'; g.beginPath(); g.arc(cx, cy, r, a0, a0 + sweep); g.stroke();
      if (C) { g.strokeStyle = '#e8433a'; g.beginPath(); g.arc(cx, cy, r, ang(C.warn), a0 + sweep); g.stroke(); }
      const t = m?.temp ?? 90, a = ang(t);
      g.lineWidth = 2.5; g.strokeStyle = m?.warn ? '#ff5a4a' : '#ffffffdd';
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8); g.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); g.stroke();
      g.font = '600 10px system-ui, sans-serif'; g.fillStyle = '#ffffffaa'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('C', cx + Math.cos(a0) * (r + 1) - 6, cy + Math.sin(a0) * (r + 1) + 4); g.fillText('H', cx + Math.cos(a0 + sweep) * (r + 1) + 6, cy + Math.sin(a0 + sweep) * (r + 1) + 4);
      g.fillStyle = m?.warn ? '#ff5a4a' : '#fff'; g.font = '700 13px system-ui, sans-serif'; g.fillText(`${Math.round(t)}°`, cx, cy - 12);
      if (!m) return;
      // the lamps
      const bad = rows.filter(r => r.level !== 'ok'), worst = bad.some(r => r.level === 'bad') ? 'red' : bad.length ? 'amber' : '';
      const engineSide = ['cooling', 'boost pipes', 'gearbox', 'differential', 'clutch', 'exhaust'];
      const h = s.engine.health, engineBad = m.limp || m.warn || h.blown || h.condition < 70 || h.misfire > 0 || rows.some(r => engineSide.includes(r.system) && r.level !== 'ok');
      set(cel, engineBad ? (m.limp || h.blown || m.cooking ? 'red' : 'amber') : '', engineBad ? `check engine: ${[m.limp && 'limp mode', m.warn && 'overheating', h.blown && 'blown', h.condition < 70 && `condition ${Math.round(h.condition)}%`, ...rows.filter(r => engineSide.includes(r.system) && r.level !== 'ok').map(r => `${r.system} ${r.state}`)].filter(Boolean).join(' · ')}` : 'check engine');
      const tyres = Object.entries(m.wheels).filter(([, w]) => !w.off && (w.pressure < 0.9 || w.leak > 0));
      const flat = tyres.some(([, w]) => w.flat);
      set(tpms, flat ? 'red' : tyres.length ? 'amber' : '', tyres.length ? `tyre pressure: ${tyres.map(([k, w]) => `${k} ${w.flat ? 'FLAT' : `${Math.round(w.pressure * 100)}%`}`).join(', ')}` : 'tyre pressure');
      set(hot, m.cooking ? (blink < 0.5 ? 'red' : '') : m.warn ? 'red' : '', m.warn ? `overheating: ${Math.round(m.temp)}°C` : 'engine overheating');
      set(limp, m.limp ? 'red' : '');
      set(fix, worst, bad.length ? `damaged: ${bad.map(r => `${r.corner ? `${r.corner} ` : ''}${r.system} (${r.state})`).join(', ')}` : 'damaged systems');
      fixN.textContent = bad.length ? String(bad.length) : '';
    },
  };
}

// The damage report (I): every wheel's and system's state, live
export function createDamageReport() {
  const el = document.createElement('div');
  el.className = 'damage-report';
  el.hidden = true;
  const colour = l => l === 'bad' ? 'bad' : l === 'worn' ? 'worn' : 'ok';
  return {
    el,
    get open() { return !el.hidden; },
    toggle(on = el.hidden) { el.hidden = !on; return on; },
    // rows: garage/mechanical.js damageReport; s: the vehicle's snapshot; mode: the damage setting;
    // ratio: the steering ratio (the steering wheel's turn for the road wheels')
    update(rows, s, mode, ratio = 1) {
      if (el.hidden) return;
      const m = s.mechanical, wheels = ['FL', 'FR', 'RL', 'RR'], systems = ['steering', 'suspension', 'rim', 'tyre', 'brake line'];
      const cell = (k, sys) => { const r = rows.find(x => x.corner === k && x.system === sys) ?? rows.find(x => x.corner === k && x.system === 'wheel'); return r ? `<td class="${colour(r.level)}">${r.state}</td>` : '<td></td>'; };
      const car = rows.filter(r => !r.corner);
      el.innerHTML = `<div class="head"><b>Damage report</b> <span>damage: ${mode === 'full' ? 'full' : mode === 'visual' ? 'visual only — no mechanical effects' : 'off'}</span> <kbd>I</kbd></div>
        <table><tr><th></th>${wheels.map(k => `<th>${k}</th>`).join('')}</tr>
        ${systems.map(sys => `<tr><th>${sys}</th>${wheels.map(k => cell(k, sys)).join('')}</tr>`).join('')}</table>
        <table>${car.map(r => `<tr><th>${r.system}</th><td class="${colour(r.level)}">${r.state}</td></tr>`).join('')}
        <tr><th>engine</th><td class="${s.engine.health.blown ? 'bad' : s.engine.health.condition < 70 ? 'worn' : 'ok'}">${Math.round(s.engine.health.condition)}%${s.engine.health.blown ? ' · BLOWN' : ''} · ${Math.round(m?.temp ?? 0)}°C${m?.limp ? ' · <b>LIMP MODE</b>' : m?.warn ? ' · hot' : ''}</td></tr>
        <tr><th>steering</th><td>${Math.abs(m?.centre ?? 0) > 1e-4 ? `hands off, the steering wheel sits ${Math.abs(m.centre * ratio * 180 / Math.PI).toFixed(0)}° ${m.centre > 0 ? 'left' : 'right'} of centre` : 'centred'}${m?.vibration > 0.02 ? ` · vibration ${Math.round(m.vibration * 100)}%` : ''}</td></tr></table>
        <div class="foot">garage.damage(…) sets any of it (garage.help()) · the workshop repairs it</div>`;
    },
  };
}
