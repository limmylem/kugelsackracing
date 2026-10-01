// Telemetry graphs (L): the last 10–30 s of whatever channels you pick, one lane each, drawn from the
// recorder in physics/telemetry.js; hover for the values at a moment; export the whole recording to
// CSV or JSON. Per-wheel channels draw all four wheels (FL, FR, RL, RR) in one lane. There can be more
// than one recording to look at (your own driving, the last test run): sources() lists them.

import { CAR_CHANNELS, WHEEL_CHANNELS, WHEELS } from '../physics/telemetry.js';

const STORE = 'driveWorld.telemetry.v1';
const WHEEL_COLOURS = { FL: '#5ec8ff', FR: '#ffb347', RL: '#7be07b', RR: '#ff6b8a' };
const LANE_COLOUR = '#e8e8e8';
// fixed ranges where they make sense (others scale to what's on screen)
const RANGES = { throttle: [0, 100], brake: [0, 100], engineThrottle: [0, 100], clutch: [0, 100], gripUsed: [0, 100], gear: [-1, 6], aids: [0, 7] };
const PICKS = [...CAR_CHANNELS.map(c => ({ id: c.id, name: c.name, unit: c.unit })), ...WHEEL_CHANNELS.map(c => ({ id: c.id, name: c.name + ' (4 wheels)', unit: c.unit, wheels: true }))];

// sources(): [{ id, name, telemetry }]
export function createTelemetryPanel(sources) {
  let current = null;
  const getTelemetry = () => { const list = sources(); return (list.find(x => x.id === current) || list[0]).telemetry; };
  let prefs = { channels: ['speed', 'throttle', 'brake', 'steer', 'latG', 'gripUsed'], seconds: 20 };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { /* defaults */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch { /* not kept */ } };

  const el = document.createElement('div');
  el.id = 'telemetry';
  el.hidden = true;
  el.innerHTML = `
    <div class="head"><b>Telemetry</b> <select data-source></select> <span class="what"></span>
      <span class="tools">
        <select data-seconds>${[10, 20, 30].map(s => `<option value="${s}" ${s === prefs.seconds ? 'selected' : ''}>last ${s} s</option>`).join('')}</select>
        <button data-picks>Channels ▾</button> <button data-freeze>Pause</button> <button data-clear>Clear</button> <button data-csv>Export CSV</button> <button data-json>Export JSON</button>
        <kbd>L</kbd> close
      </span></div>
    <div class="picks" hidden>${PICKS.map(p => `<label class="${p.wheels ? 'wheel' : ''}"><input type="checkbox" value="${p.id}" ${prefs.channels.includes(p.id) ? 'checked' : ''}>${p.name}</label>`).join('')}</div>
    <canvas></canvas>`;
  const canvas = el.querySelector('canvas'), g = canvas.getContext('2d'), what = el.querySelector('.what'), sourceSel = el.querySelector('[data-source]');
  const drawSources = () => {
    const list = sources(), id = list.find(x => x.id === current)?.id ?? list[0].id;
    const html = list.map(x => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${x.name}</option>`).join('');
    if (sourceSel.innerHTML !== html) sourceSel.innerHTML = html;
    sourceSel.hidden = list.length < 2;
  };
  let frozen = null, hoverX = null, lastDraw = 0;

  el.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('.picks input')) { prefs.channels = [...el.querySelectorAll('.picks input:checked')].map(i => i.value); save(); }
    if (t.dataset.seconds !== undefined) { prefs.seconds = +t.value; save(); }
    if (t.dataset.source !== undefined) { current = t.value; frozen = null; }
    t.blur();
  });
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    const T = getTelemetry();
    if (b.dataset.picks !== undefined) { const p = el.querySelector('.picks'); p.hidden = !p.hidden; b.textContent = p.hidden ? 'Channels ▾' : 'Channels ▴'; }
    if (b.dataset.freeze !== undefined) { frozen = frozen ? null : { head: T.count }; b.textContent = frozen ? 'Resume' : 'Pause'; }
    if (b.dataset.clear !== undefined) { T.clear(); frozen = null; el.querySelector('[data-freeze]').textContent = 'Pause'; }
    if (b.dataset.csv !== undefined) download(T.toCSV(), 'text/csv', 'csv', T);
    if (b.dataset.json !== undefined) download(JSON.stringify(T.toJSON()), 'application/json', 'json', T);
  });
  canvas.addEventListener('mousemove', e => { hoverX = e.offsetX; });
  canvas.addEventListener('mouseleave', () => { hoverX = null; });

  function download(text, type, ext, T) {
    const a = document.createElement('a'), name = (T.label || 'run').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = `telemetry_${name}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function draw() {
    drawSources();
    const T = getTelemetry(), dpr = Math.min(devicePixelRatio, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    what.textContent = `${T.label ? T.label + ' · ' : ''}${T.seconds.toFixed(1)} s recorded${frozen ? ' · paused' : ''}`;
    const lanes = PICKS.filter(p => prefs.channels.includes(p.id));
    if (!lanes.length || !T.count) { g.fillStyle = '#fff8'; g.font = '12px system-ui'; g.fillText(T.count ? 'Pick some channels above.' : 'Nothing recorded yet — drive!', 12, 24); return; }
    const end = frozen ? Math.min(frozen.head, T.count) : T.count, n = Math.min(end, Math.round(prefs.seconds * T.stepHz)), start = end - n;
    const left = 132, right = 8, plotW = W - left - right, laneH = H / lanes.length;
    const xOf = k => left + (k - start) / Math.max(1, Math.round(prefs.seconds * T.stepHz) - 1) * plotW;
    const hoverK = hoverX != null && hoverX > left ? Math.min(end - 1, Math.max(start, Math.round(start + (hoverX - left) / plotW * (Math.round(prefs.seconds * T.stepHz) - 1)))) : null;
    g.font = '11px system-ui';
    lanes.forEach((p, li) => {
      const top = li * laneH, ids = p.wheels ? WHEELS.map(w => `${p.id}_${w}`) : [p.id];
      // range: fixed, or what's on screen (with a little room), always including zero where it's near
      let [lo, hi] = RANGES[p.id] || [Infinity, -Infinity];
      if (!RANGES[p.id]) {
        for (const id of ids) for (let k = start; k < end; k++) { const x = T.value(id, k); if (x < lo) lo = x; if (x > hi) hi = x; }
        if (lo > 0 && lo < (hi - lo)) lo = 0;
        if (hi < 0 && -hi < (hi - lo)) hi = 0;
        if (hi - lo < 1e-3) { hi += 0.5; lo -= 0.5; }
        const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      }
      const yOf = x => top + laneH - 4 - (x - lo) / (hi - lo) * (laneH - 8);
      g.fillStyle = li % 2 ? '#ffffff06' : '#ffffff0c';
      g.fillRect(left, top, plotW, laneH);
      if (lo < 0 && hi > 0) { g.strokeStyle = '#ffffff30'; g.beginPath(); g.moveTo(left, yOf(0)); g.lineTo(left + plotW, yOf(0)); g.stroke(); }
      // one point per pixel column at most: min and max of the samples in it
      ids.forEach((id, wi) => {
        g.strokeStyle = p.wheels ? WHEEL_COLOURS[WHEELS[wi]] : LANE_COLOUR;
        g.lineWidth = 1.2;
        g.beginPath();
        const perPx = Math.max(1, Math.floor(n / plotW));
        for (let k = start; k < end; k += perPx) {
          let mn = Infinity, mx = -Infinity;
          for (let j = k; j < Math.min(end, k + perPx); j++) { const x = T.value(id, j); if (x < mn) mn = x; if (x > mx) mx = x; }
          const x = xOf(k);
          if (k === start) g.moveTo(x, yOf(mn)); else g.lineTo(x, yOf(mn));
          if (mx !== mn) g.lineTo(x, yOf(mx));
        }
        g.stroke();
      });
      // label, range and the latest (or hovered) value
      const at = hoverK ?? end - 1, val = id => T.value(id, at), fmt = x => Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
      // name, then the value(s) with the lane's range
      g.fillStyle = '#fff';
      g.fillText(`${p.name.replace(' (4 wheels)', '')}${p.unit ? ` (${p.unit})` : ''}`, 6, top + 13);
      if (p.wheels) WHEELS.forEach((w, wi) => { g.fillStyle = WHEEL_COLOURS[w]; g.fillText(fmt(val(`${p.id}_${w}`)), 6 + wi * 31, top + 26); });
      else {
        g.fillStyle = LANE_COLOUR; g.font = 'bold 12px system-ui'; g.fillText(fmt(val(p.id)), 6, top + 26);
        const w = g.measureText(fmt(val(p.id))).width;
        g.font = '10px system-ui'; g.fillStyle = '#fff8'; g.fillText(`${fmt(lo)} … ${fmt(hi)}`, 14 + w, top + 26); g.font = '11px system-ui';
      }
      g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(0, top + laneH - 0.5); g.lineTo(W, top + laneH - 0.5); g.stroke();
    });
    // time axis: a tick every 5 s, and the hover cursor
    g.fillStyle = '#fff7';
    const tEnd = T.value('t', end - 1);
    for (let s = Math.ceil((T.value('t', start)) / 5) * 5; s <= tEnd; s += 5) {
      const k = start + Math.round((s - T.value('t', start)) * T.stepHz);
      g.fillRect(xOf(k), H - 6, 1, 6);
      g.fillText(`${s}s`, xOf(k) + 2, H - 2);
    }
    if (hoverK != null) { g.fillStyle = '#fc3'; g.fillRect(xOf(hoverK), 0, 1, H); g.fillText(`${T.value('t', hoverK).toFixed(2)} s`, xOf(hoverK) + 4, 12); }
  }

  return {
    el,
    get open() { return !el.hidden; },
    toggle() { el.hidden = !el.hidden; },
    // show this recording (e.g. a test that's starting)
    select(id) { current = id; frozen = null; },
    hide() { el.hidden = true; },
    // redraw (at most ~30 times a second)
    update(now) { if (el.hidden || now - lastDraw < 33) return; lastDraw = now; draw(); },
  };
}
