// The sound's debug overlay (Phase 8 Step 1; docs/AUDIO.md; Shift+M in the game, always on in the test page): what
// the audio costs against its budget (data/audio.json budget) — the audio thread's work as a share of the time it
// plays, the main thread's ms a frame — the voices (full, simple), what's loaded, the limiter (the loudest peak in,
// out, and how far it turned down), and what the echo and the area are (audio/environment.js).
//
//   const O = createAudioOverlay(A, () => gameAudio)   O.update(dt) each frame · O.toggle() · O.show(on) · O.last

const pct = x => `${(x * 100).toFixed(1)}%`, db = x => x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dB` : '−∞';

export function createAudioOverlay(A, game = () => null, { shown = false, parent = globalThis.document?.body } = {}) {
  const el = document.createElement('div');
  el.id = 'audioOverlay';
  el.style.cssText = 'position:fixed;right:12px;bottom:40px;z-index:43;display:none;color:#fff;background:rgba(10,14,20,.84);border-radius:9px;padding:8px 11px;font:11px/1.5 "JetBrains Mono",monospace;pointer-events:none;min-width:280px;white-space:pre';
  parent?.appendChild(el);
  let on = shown, since = 0, last = null;
  const ok = (v, max) => `<b style="color:${v <= max ? '#7ee787' : '#ff7b72'}">`;
  function draw() {
    const s = A.stats(), G = game(), B = s.cpu.budget, low = A.quality === 'low';
    const audioMax = low ? B.lowEndShare / B.lowEndFactor : B.audioShare;
    const vc = G?.voices?.counts ?? { full: 0, simple: 0, off: 0 }, sur = G?.env?.surroundings, area = G?.env?.area;
    last = { ...s, voices: vc, surroundings: sur, area };
    const place = sur ? ['tunnel', 'under', 'street', 'open'].map(k => `${k} ${(sur[k] * 100).toFixed(0)}`).join(' · ') : '—';
    el.innerHTML = `<b>SOUND</b>  ${s.state} · ${s.worklet ? 'worklet' : 'no worklet'} · quality ${s.quality}
audio thread  ${ok(s.cpu.audio, audioMax)}${pct(s.cpu.audio)}</b> of real time (budget ${pct(audioMax)})
main thread   ${ok(s.cpu.main, B.mainMs)}${s.cpu.main.toFixed(3)} ms</b> a frame (budget ${B.mainMs} ms)
voices        your car + ${vc.full} full · ${vc.simple} simple · ${vc.off} unheard (${s.voices} on the audio thread)
loaded        ${s.engines} engine${s.engines === 1 ? '' : 's'} · ${s.buffers} files · bank ${s.bankMB.toFixed(1)} MB · ${s.nodes} nodes
limiter       peak in ${db(s.limiter.peakIn)} · out ${db(s.limiter.peakOut)} · turned down ${(-s.limiter.reductionDb).toFixed(1)} dB
echo          ${place}${sur?.width ? ` · walls ${sur.width.toFixed(0)} m apart` : ''}
area          ${area ? `city ${(area.city * 100).toFixed(0)} · forest ${(area.forest * 100).toFixed(0)} · coast ${(area.coast * 100).toFixed(0)}` : '—'}${G?.last ? `
engine        ${G.last.engine.rpm.toFixed(0)} rpm · load ${G.last.engine.load.toFixed(2)} · gear ${G.last.engine.gear}${G.last.spool ? ` · boost ${(G.last.spool * 100).toFixed(0)}%` : ''}
tyres         scrub ${G.last.tyres.scrub.toFixed(2)} · squeal ${G.last.tyres.squeal.toFixed(2)} · skid ${G.last.tyres.skid.toFixed(2)}` : ''}`;
  }
  return {
    el,
    get shown() { return on; },
    get last() { return last; },
    show(x) { on = !!x; el.style.display = on ? 'block' : 'none'; if (on) draw(); },
    toggle() { this.show(!on); },
    update(dt) { if (!on) return; since += dt; if (since >= 0.25) { since = 0; draw(); } },
    dispose() { el.remove(); },
  };
}
