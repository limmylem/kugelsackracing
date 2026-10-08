// The contact replay (Phase 7 Step 3; docs/CONTACT.md "Debug tools"): any contact seen from both players' games, side
// by side — each game's own car and its proxy of the other (the reports' tracks: the second and a half before each
// game reported it), with the race server's own record of both cars drawn faintly under each, so it shows where the
// games disagreed and by how much. The admin page (a race's contacts, ramming evidence) and the game (F10, the last
// contact) both use it. Plain DOM and canvas.
//
//   const V = openContactReplay(contact, { parent, names, boxes, onClose })
//     contact: the race server's log entry (server/src/rt/contact.ts): { cid, t, kind, closing, cars, blame, reports:
//       [{ pid, track: [{ t, me: [x, z, yaw], them: [x, z, yaw] }], point, closing, predictMs, J }], srv: { pid: [[t, x, z,
//       yaw, vx, vz]] } } — or ramming evidence ({ cars: { pid: [{ t, pos, yaw }] }, hits }): the server's view alone
//     names: { pid: name }   boxes: { pid: { halfExtents, centre } } (or the usual 1.85 × 4.4 m)
//   V.close()

const DEFAULT_BOX = { halfExtents: [0.92, 0.7, 2.2], centre: [0, 0.7, 0] };
const COLOURS = ['#5ec8ff', '#ffb454'];

// a car's pose along a track of [t, x, z, yaw] at time t (between the two either side)
function poseAt(list, t) {
  if (!list?.length) return null;
  if (t <= list[0][0]) return list[0];
  for (let i = 1; i < list.length; i++) if (list[i][0] >= t) {
    const a = list[i - 1], b = list[i], u = (t - a[0]) / Math.max(1, b[0] - a[0]);
    let dy = b[3] - a[3]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + dy * u];
  }
  return list.at(-1);
}

// the views to draw: one per report (that game's own car and its proxy of the other), each with the server's record
export function contactViews(contact) {
  const pids = Object.keys(contact.cars ?? {});
  if (contact.reports) {
    const srv = Object.fromEntries(Object.entries(contact.srv ?? {}).map(([pid, l]) => [pid, l.map(s => [s[0], s[1], s[2], s[3]])]));
    return pids.map(pid => {
      const r = contact.reports.find(x => x.pid === pid), other = pids.find(p => p !== pid);
      const own = (r?.track ?? []).map(x => [x.t, ...x.me]), proxy = (r?.track ?? []).map(x => [x.t, ...x.them]);
      return { pid, other, report: r ?? null, cars: { [pid]: own, [other]: proxy }, server: srv };
    });
  }
  // (ramming evidence: the race server's record only)
  const cars = Object.fromEntries(Object.entries(contact.cars ?? {}).map(([pid, l]) => [pid, (l ?? []).map(s => [s.t, s.pos[0], s.pos[2], s.yaw])]));
  return [{ pid: null, other: null, report: null, cars: {}, server: cars }];
}

export function openContactReplay(contact, { parent = document.body, names = {}, boxes = {}, onClose = null } = {}) {
  const views = contactViews(contact), pids = [...new Set(views.flatMap(v => [...Object.keys(v.cars), ...Object.keys(v.server)]))];
  const colour = pid => COLOURS[pids.indexOf(pid) % COLOURS.length];
  const name = pid => names[pid] ?? (pid ? `…${String(pid).slice(-4)}` : '');
  // the time span: every track's, played over and over
  const times = views.flatMap(v => [...Object.values(v.cars), ...Object.values(v.server)].flat().map(s => s[0])).filter(Number.isFinite);
  const t0 = Math.min(...times), t1 = Math.max(...times), span = Math.max(500, t1 - t0);
  // the frame: every pose, with room round it
  const pts = views.flatMap(v => [...Object.values(v.cars), ...Object.values(v.server)].flat());
  const xs = pts.map(p => p[1]), zs = pts.map(p => p[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, R = Math.max(8, (Math.max(...xs) - Math.min(...xs)) / 2 + 4, (Math.max(...zs) - Math.min(...zs)) / 2 + 4);

  const el = document.createElement('div');
  el.className = 'krContactReplay';
  el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:120;background:rgba(10,14,20,.95);color:#e9ecef;border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:12px 14px;font:13px/1.4 Barlow,system-ui,sans-serif;max-width:96vw';
  const head = `${contact.kind ?? 'contact'}${contact.closing != null ? ` at ${contact.closing.toFixed(1)} m/s` : ''}${contact.sources ? ` · ${contact.sources}` : ''}${contact.gentler ? ' · the gentler report used' : ''}`;
  const blame = contact.blame ? `${contact.blame.fault ? `${name(contact.blame.fault)} at fault` : 'Nobody at fault'} (${Object.entries(contact.blame.shares ?? {}).map(([p, s]) => `${name(p)} ${Math.round(s * 100)}%`).join(', ')})${contact.blame.reasons?.length ? ` — ${contact.blame.reasons.join('; ')}` : ''}` : '';
  el.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><b>Contact ${contact.cid ?? ''}: ${head}</b><button data-close style="cursor:pointer">Close</button></div>
    ${blame ? `<div style="opacity:.8">${blame}</div>` : ''}
    <div data-views style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap"></div>
    <div style="opacity:.65;font-size:12px;margin-top:6px">Each side: one player's game — their own car solid, the other car as their game had it (outlined); faint: where the race server had both. Click to pause.</div>`;
  const holder = el.querySelector('[data-views]'), size = Math.min(380, Math.floor((innerWidth - 80) / Math.max(1, views.length)));
  const canvases = views.map(v => {
    const box = document.createElement('div');
    const r = v.report;
    box.innerHTML = `<div style="font-weight:600;color:${v.pid ? colour(v.pid) : '#e9ecef'}">${v.pid ? `${esc(name(v.pid))}'s game` : 'The race server\'s record'}</div>
      <div style="opacity:.75;font-size:12px">${r ? `saw ${esc(r.kind ?? contact.kind ?? '')} at ${Number(r.closing ?? 0).toFixed(1)} m/s · predicted ${r.predictMs ?? 0} ms ahead · pushed ${Math.round(Math.hypot(...(r.J ?? [0, 0])))} N s, agreed ${Math.round(Math.hypot(...(contact.cars?.[v.pid]?.impulse ?? [0, 0])))} N s` : v.pid ? 'no report from this game (one-sided)' : ''}</div>`;
    const c = document.createElement('canvas'); c.width = size * devicePixelRatio; c.height = size * devicePixelRatio; c.style.width = c.style.height = `${size}px`; c.style.background = '#0d1117'; c.style.borderRadius = '8px'; c.style.cursor = 'pointer';
    box.appendChild(c); holder.appendChild(box);
    return { v, c };
  });
  parent.appendChild(el);

  let paused = false, start = performance.now(), at = 0, raf = 0;
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); else if (e.target.tagName === 'CANVAS') { paused = !paused; if (!paused) start = performance.now() - at; } });
  // (seen from above: x to the right, so +z down the canvas — the world's own handedness, a left turn drawn as one)
  const toPx = (x, z, n) => [(x - cx) / R * n / 2 + n / 2, (z - cz) / R * n / 2 + n / 2];
  function car(ctx, n, p, b, style, fill) {
    if (!p) return;
    const [px, pz] = toPx(p[1], p[2], n), s = n / 2 / R, hw = b.halfExtents[0] * s, hl = b.halfExtents[2] * s;
    // (drawn nose up the canvas, then turned: at yaw 0 it faces +z, down the canvas — its nose marked)
    ctx.save(); ctx.translate(px, pz); ctx.rotate(Math.PI - p[3]);
    if (fill) { ctx.fillStyle = style; ctx.fillRect(-hw, -hl, hw * 2, hl * 2); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-hw, -hl, hw * 2, hl * 0.3); }
    else { ctx.strokeStyle = style; ctx.lineWidth = 2; ctx.strokeRect(-hw, -hl, hw * 2, hl * 2); }
    ctx.restore();
  }
  function draw() {
    if (!paused) at = (performance.now() - start) % (span + 600);
    const t = t0 + Math.min(span, at);
    for (const { v, c } of canvases) {
      const ctx = c.getContext('2d'), n = c.width;
      ctx.clearRect(0, 0, n, n);
      // a metre grid (5 m)
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
      for (let g = Math.ceil((cx - R) / 5) * 5; g < cx + R; g += 5) { const [x] = toPx(g, cz, n); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, n); ctx.stroke(); }
      for (let g = Math.ceil((cz - R) / 5) * 5; g < cz + R; g += 5) { const [, z] = toPx(cx, g, n); ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(n, z); ctx.stroke(); }
      for (const [pid, list] of Object.entries(v.server)) car(ctx, n, poseAt(list, t), boxes[pid] ?? DEFAULT_BOX, `${colour(pid)}44`, true);
      for (const [pid, list] of Object.entries(v.cars)) car(ctx, n, poseAt(list, t), boxes[pid] ?? DEFAULT_BOX, colour(pid), pid === v.pid);
      // where the contact was, once it's begun
      const p = v.report?.point ?? contact.cars?.[v.pid]?.point;
      if (p && contact.t != null && t >= contact.t) { const [x, z] = toPx(p[0], p[1], n); ctx.fillStyle = '#ff7b72'; ctx.beginPath(); ctx.arc(x, z, 5 * devicePixelRatio, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(233,236,239,.7)'; ctx.font = `${11 * devicePixelRatio}px "JetBrains Mono",monospace`;
      ctx.fillText(`${((t - (contact.t ?? t1)) / 1000).toFixed(2)} s`, 6 * devicePixelRatio, n - 8 * devicePixelRatio);
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  function close() { cancelAnimationFrame(raf); el.remove(); onClose?.(); }
  return { close, el };
}

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
