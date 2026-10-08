// The contact overlay (Phase 7 Step 3; docs/CONTACT.md "Debug tools"; F10 in a race): what car-to-car contact is
// doing, in a corner of the screen. A map of the cars round yours as the contact sees them — each other car's proxy
// (where it's predicted to be now: solid, or a ghost), how far ahead it's predicted, a knock's predicted push, the
// points where contacts began — and the latest contacts: what this game saw and pushed, what the race server agreed,
// and who it blamed. Shift+F10 replays the last one from both players' views (mp/contactReplay.js).
//
//   const O = createContactOverlay({ C (mp/contactClient.js), names: uid → name, mode: () → collisions, me: () → uid })
//   O.toggle() · O.update() (a few times a second) · O.lastCid() · O.dispose()

export function createContactOverlay({ C, names = () => null, mode = () => '', me = () => null, parent = document.body, shown = false }) {
  const el = document.createElement('div');
  el.id = 'krContact';
  el.style.cssText = 'position:fixed;left:12px;top:72px;z-index:80;width:300px;font:12px/1.45 "JetBrains Mono",ui-monospace,monospace;color:#e9ecef;background:rgba(8,12,18,.84);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:9px 11px;pointer-events:none';
  el.hidden = !shown;
  const map = document.createElement('canvas'), text = document.createElement('div');
  map.width = map.height = 276 * devicePixelRatio; map.style.cssText = 'width:276px;height:276px;display:block;background:#0d1117;border-radius:8px;margin-bottom:6px';
  text.style.whiteSpace = 'pre-wrap';
  el.append(map, text);
  parent.appendChild(el);
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const f = (x, d = 0) => Number.isFinite(x) ? x.toFixed(d) : '–';
  const nameOf = uid => names(uid) ?? `…${String(uid).slice(-4)}`;
  const R = 20;          // (metres round your car)

  function drawMap() {
    const ctx = map.getContext('2d'), n = map.width, s = n / 2 / R, mine = C.me?.();
    ctx.clearRect(0, 0, n, n);
    if (!mine) return;
    // (seen from above with the world's handedness — x right, +z down — centred on your car)
    const px = (x, z) => [(x - mine.x) * s + n / 2, (z - mine.z) * s + n / 2];
    const box = (x, z, yaw, hl, hw, style, fill) => {
      const [cx, cz] = px(x, z);
      ctx.save(); ctx.translate(cx, cz); ctx.rotate(Math.PI - yaw);
      if (fill) { ctx.fillStyle = style; ctx.fillRect(-hw * s, -hl * s, hw * 2 * s, hl * 2 * s); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(-hw * s, -hl * s, hw * 2 * s, hl * 0.3 * s); }
      else { ctx.setLineDash([4, 3]); ctx.strokeStyle = style; ctx.lineWidth = 2; ctx.strokeRect(-hw * s, -hl * s, hw * 2 * s, hl * 2 * s); }
      ctx.restore();
    };
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    for (let r = 5; r <= R; r += 5) { ctx.beginPath(); ctx.arc(n / 2, n / 2, r * s, 0, Math.PI * 2); ctx.stroke(); }
    box(mine.x, mine.z, mine.yaw, mine.hl, mine.hw, C.solid(me()) ? '#5ec8ff' : 'rgba(94,200,255,.35)', true);
    ctx.font = `${10 * devicePixelRatio}px "JetBrains Mono",monospace`;
    for (const [uid, p] of C.debug.proxies) {
      box(p.x, p.z, p.yaw, p.hl, p.hw, p.solid ? '#7ee787' : 'rgba(180,180,180,.6)', p.solid);
      const [lx, lz] = px(p.x, p.z);
      ctx.fillStyle = '#e9ecef'; ctx.fillText(`${nameOf(uid).slice(0, 8)} +${f(p.aheadMs)}ms`, lx + 8 * devicePixelRatio, lz);
      // (a knock this game gave it, drawn on until its own states show it)
      if (p.nudge) { const [ax, az] = px(p.x - p.nudge[0], p.z - p.nudge[1]); ctx.strokeStyle = '#f2cc60'; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(lx, lz); ctx.stroke(); }
    }
    const now = performance.now() / 1000;
    for (const c of C.debug.contacts.slice(-12)) {
      const age = now - (c.wall ?? now), [x, z] = px(c.point[0], c.point[1]);
      ctx.fillStyle = c.kind === 'hit' ? `rgba(255,123,114,${Math.max(0.15, 1 - age / 6)})` : `rgba(242,204,96,${Math.max(0.15, 1 - age / 6)})`;
      ctx.beginPath(); ctx.arc(x, z, 4 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
    }
  }

  function update() {
    if (el.hidden) return;
    drawMap();
    const rows = [], d = C.debug, ghosts = C.ghosts ?? new Map(), my = ghosts.get(me());
    rows.push(`<b>CONTACT</b>  ${esc(mode())}${my?.ghost ? ` · <span style="color:#f2cc60">you're a ghost: ${esc(my.reasons.join(', '))}</span>` : ''}`);
    rows.push(`cost   ${f(d.stepMs, 3)} ms a step, ${f(d.frameMs, 2)} ms a frame`);
    for (const [uid, p] of d.proxies) {
      const g = ghosts.get(uid);
      rows.push(`${esc(nameOf(uid).slice(0, 10).padEnd(10))} near ${f(C.nearness(uid), 2)} · +${f(p.aheadMs)} ms · ${p.solid ? '<span style="color:#7ee787">solid</span>' : `<span style="color:#aaa">ghost${g?.reasons?.length ? `: ${esc(g.reasons.join(', '))}` : ''}</span>`}`);
    }
    rows.push('<b>LATEST</b>');
    if (!d.agreed.length) rows.push('<span style="color:#8b949e">no contact yet</span>');
    for (const a of d.agreed.slice(-5).reverse()) {
      if (a.rejected) { rows.push(`<span style="color:#ff7b72">refused</span> (episode ${a.ep}): ${esc(a.why)}`); continue; }
      const mine = a.mine ? ` · you: pushed ${f(Math.hypot(...(a.mine.applied ?? [0, 0])))} → agreed ${f(Math.hypot(...a.mine.agreed))} N s` : '';
      const bl = a.blame ? (a.blame.fault ? ` · <b>${esc(nameOf(a.blame.fault))}</b> ${f((a.blame.shares?.[a.blame.fault] ?? 0) * 100)}%${a.blame.careless ? ' careless' : ''}` : ' · nobody at fault') : '';
      rows.push(`${esc(a.cid)} ${a.kind} ${f(a.closing, 1)} m/s${a.gentler ? ' (gentler)' : ''}${mine}${bl}`);
    }
    rows.push('<span style="color:#8b949e">F10 this overlay · Shift+F10 replay the last contact</span>');
    text.innerHTML = rows.join('\n');
  }

  return {
    get shown() { return !el.hidden; },
    toggle(on = el.hidden) { el.hidden = !on; return on; },
    update,
    lastCid() { return [...C.debug.agreed].reverse().find(a => a.cid)?.cid ?? null; },
    dispose() { el.remove(); },
  };
}
