// The performance overlay (Phase 8 Step 2; docs/PERFORMANCE.md): Shift+P in the game. The frame time over the last few
// seconds (a graph, the target as a line), the average and the worst 1%, where each frame's time goes (the profiler's
// stages), the draw calls and triangles, the resolution and frame rate cap now, memory, and the last stutters with what
// caused them.
//
//   const O = createPerfOverlay({ prof, gfx, renderer })   O.toggle()   O.update() (each frame; draws a few times a second)

import { STAGES } from './profiler.js';

const COLOURS = { input: '#9aa', streaming: '#4cc', physics: '#e84', ai: '#fb4', network: '#8cf', audio: '#c8f', effects: '#f6a', render: '#6e6', game: '#ccc', other: '#555' };

export function createPerfOverlay({ prof, gfx, renderer }) {
  const el = document.createElement('div');
  el.id = 'perfOverlay';
  el.style.cssText = 'position:fixed;right:8px;top:8px;z-index:30;width:300px;padding:8px 10px;background:rgba(10,14,20,.82);color:#e8edf2;font:11px/1.35 ui-monospace,Menlo,monospace;border-radius:8px;pointer-events:none;display:none';
  const graph = document.createElement('canvas');
  graph.width = 280; graph.height = 60;
  graph.style.cssText = 'display:block;width:280px;height:60px;margin:4px 0';
  const text = document.createElement('div');
  el.append(graph, text);
  document.body.appendChild(el);
  let on = false, last = 0;
  const g = graph.getContext('2d');

  function draw() {
    const st = prof.stats(), G = gfx.settings ?? {}, gs = gfx.stats, T = prof.target;
    if (!st) return;
    // (the last 280 frames, 0–3× the target high; the target and twice it as lines)
    const t = prof.recent(280), H = graph.height, k = H / (T * 3);
    g.clearRect(0, 0, graph.width, H);
    for (let i = 0; i < t.length; i++) { const y = Math.min(H, t[i] * k); g.fillStyle = t[i] > T * prof.stutterFactor ? '#f55' : t[i] > T * 1.2 ? '#fb4' : '#5d5'; g.fillRect(i, H - y, 1, y); }
    g.fillStyle = '#fff8'; g.fillRect(0, H - T * k, graph.width, 1); g.fillStyle = '#f558'; g.fillRect(0, H - T * prof.stutterFactor * k, graph.width, 1);
    const stages = [...STAGES, 'other'].map(s => [s, st.stages[s] ?? 0]).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]);
    const total = stages.reduce((a, [, v]) => a + v, 0) || 1;
    const bar = `<div style="display:flex;height:8px;margin:3px 0;border-radius:3px;overflow:hidden">${stages.map(([s, v]) => `<span style="width:${(v / total * 100).toFixed(1)}%;background:${COLOURS[s]}"></span>`).join('')}</div>`;
    const mem = performance.memory ? `heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB · ` : '';
    const info = renderer.info;
    const stut = prof.stutters.slice(-4).reverse().map(x => `${x.ms.toFixed(0)} ms: ${x.cause}`).join(' · ') || 'none';
    text.innerHTML = `<b>${st.fps.toFixed(0)} fps</b> · ${st.avgMs.toFixed(1)} ms avg · worst 1% ${st.worst1PctMs.toFixed(1)} ms · target ${T.toFixed(1)} ms
      ${bar}<div>${stages.slice(0, 6).map(([s, v]) => `<span style="color:${COLOURS[s]}">■</span> ${s} ${v.toFixed(1)}`).join(' &nbsp;')}</div>
      <div>${Math.round(st.calls ?? 0)} draw calls · ${((st.triangles ?? 0) / 1000).toFixed(0)}k triangles · ${info.programs?.length ?? '?'} shaders</div>
      <div>${G.preset ?? '?'} · ${Math.round((gs.scale ?? 1) * 100)}% resolution (${(gs.pixelRatio ?? 1).toFixed(2)}×) · ${gs.fpsLimit ? `cap ${gs.fpsLimit}` : 'no cap'}${gs.saving ? ' · power saver' : ''} · ${gs.post}</div>
      <div>${mem}${info.memory.geometries} meshes · ${info.memory.textures} textures${st.allocMBps != null ? ` · garbage ${st.allocMBps.toFixed(1)} MB/s` : ''}</div>
      <div>stutters ${st.stutters.count} (${(st.stutters.share * 100).toFixed(2)}%): ${stut}</div>`;
  }
  return {
    el,
    get open() { return on; },
    toggle() { on = !on; el.style.display = on ? 'block' : 'none'; if (on) { prof.reset(); last = 0; } },
    update() { if (!on) return; const now = performance.now(); if (now - last < 250) return; last = now; draw(); },
  };
}
