// The network overlay (Phase 7 Step 1; docs/MULTIPLAYER.md "Debug tools"): what the connection is doing, in a
// corner of the screen. Ping and its jitter, packet loss (pings unanswered), kB a second up and down, the
// interpolation buffer, and for each other car how far behind it's shown, whether it's being predicted ahead, and how
// much it's being corrected (now and at worst). The network simulator's conditions too, when it's on.
//
//   const O = createNetOverlay(N)    N: net/client.js     O.toggle() · O.update() (a few times a second) · O.dispose()

export function createNetOverlay(N, { parent = document.body, shown = false } = {}) {
  const el = document.createElement('div');
  el.id = 'krNet';
  el.style.cssText = 'position:fixed;right:12px;top:72px;z-index:80;min-width:250px;max-width:340px;font:12px/1.45 "JetBrains Mono",ui-monospace,monospace;color:#e9ecef;background:rgba(8,12,18,.82);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:9px 11px;pointer-events:none;white-space:pre';
  el.hidden = !shown;
  parent.appendChild(el);
  const f = (x, d = 0) => Number.isFinite(x) ? x.toFixed(d) : '–';
  const tone = (x, ok, warn) => x <= ok ? '#7ee787' : x <= warn ? '#f2cc60' : '#ff7b72';
  return {
    get shown() { return !el.hidden; },
    toggle(on = el.hidden) { el.hidden = !on; return on; },
    update() {
      if (el.hidden) return;
      const s = N.stats, rows = [];
      rows.push(`<b>NETWORK</b>  ${s.status}${N.message ? ` · ${N.message}` : ''}`);
      rows.push(`ping   <span style="color:${tone(s.ping, 80, 200)}">${f(s.ping)} ms</span>  jitter ${f(s.jitter)} ms`);
      rows.push(`loss   <span style="color:${tone(s.loss * 100, 1, 5)}">${f(s.loss * 100, 1)}%</span>`);
      rows.push(`up     ${f(s.upKBs, 2)} kB/s   down ${f(s.downKBs, 2)} kB/s`);
      rows.push(`buffer ${f(s.bufferMs)} ms above the usual delay`);
      if (s.netsim) rows.push(`<span style="color:#f2cc60">SIMULATED ${s.netsim.latencyMs} ms, ±${s.netsim.jitterMs} ms, ${f(s.netsim.loss * 100, 0)}% loss (${s.netsim.mode})</span>`);
      for (const r of s.remotes.slice(0, 8)) {
        rows.push(`#${r.id} ${(r.name ?? '').slice(0, 12).padEnd(12)} ${f(r.delayMs)} ms · fix ${f(r.lastCorrectionCm ?? 0)}/${f(r.maxCorrectionCm)} cm · ${r.corrections} fixes${r.extrapolatedMs ? ` · predicted ${f(r.extrapolatedMs / 1000, 1)} s` : ''}`);
      }
      el.innerHTML = rows.join('\n');
    },
    dispose() { el.remove(); },
  };
}
