// The frame profiler (Phase 8 Step 2; docs/PERFORMANCE.md): where each frame's time goes, how steady the frames are,
// and what caused each stutter — in the game (the performance overlay, Shift+P) and in the benchmarks (perf/bench.js).
//
// A frame is the time from one frame's start to the next's (what the player sees). Inside it the game's work is
// timed in stages, one after another (lap): input, streaming, physics, ai, network, audio, effects, render and game
// (the rest). What isn't any stage's — the browser's own work, garbage collection, waiting for the graphics card — is
// the frame's `other`.
//
// A stutter is a frame longer than `stutterFactor` × the target. Its cause is the stage that took the most, unless:
//   - new shaders were compiled in it (the renderer's programs grew): 'shader compile'
//   - the JavaScript heap shrank by more than a megabyte across it (a collection ran): 'garbage collection'
//   - none of the game's stages explain it (they took less than half of it): 'browser' (garbage collection we
//     couldn't see, the compositor, the graphics card, another tab)
//
//   const P = createProfiler({ targetMs, stutterFactor, renderer })
//   P.frameStart(now)   at the top of each frame · P.lap(stage) after each stage · P.add(stage, ms) (time measured
//   elsewhere, e.g. the physics' AI) · P.frameEnd()
//   P.stats() → { frames, seconds, avgMs, p50Ms, p95Ms, p99Ms, worst1PctMs, fps, low1PctFps, stages: { stage: avg ms },
//     stageShare, stutters: { count, perMinute, share, byCause }, heapMB, allocMBps (garbage made a second), collections,
//     calls, triangles }
//   P.stutters → the last few (each { at, ms, cause, stages }) · P.last → { calls, triangles } (the last frame's, every
//   pass) · P.reset() · P.recent(n) → the last n frame times

export const STAGES = ['input', 'streaming', 'physics', 'ai', 'network', 'audio', 'effects', 'render', 'game'];

const heap = () => globalThis.performance?.memory?.usedJSHeapSize ?? null;

export function createProfiler({ targetMs = 1000 / 60, stutterFactor = 2, keep = 36000, renderer = null, now = () => performance.now() } = {}) {
  const N = STAGES.length, idx = Object.fromEntries(STAGES.map((s, i) => [s, i]));
  // (each frame's time and its stages, in rings)
  const times = new Float32Array(keep), stageRing = new Float32Array(keep * N), otherRing = new Float32Array(keep);
  const cur = new Float64Array(N);
  // (the frame being timed: when it started, the renderer's programs at its start and end, the heap at its start)
  let count = 0, head = 0, lapAt = 0, prevStart = 0, startPrograms = 0, endPrograms = 0, startHeap = null;
  let callsSum = 0, trisSum = 0, renderFrames = 0, allocBytes = 0, collections = 0;
  const stutters = [], byCause = {};
  let stutterCount = 0, open = false, target = targetMs;
  const programs = () => renderer?.info?.programs?.length ?? 0;
  // (the renderer's counts kept for the whole frame — every pass: the effects draw after the scene — read and started
  // again at its end; P.last has them, for the overlays)
  if (renderer?.info) renderer.info.autoReset = false;
  const last = { calls: 0, triangles: 0 };

  // the frame just finished (its time now known: up to this start) — recorded, and judged
  function close(at) {
    const ms = at - prevStart;
    let work = 0;
    for (let i = 0; i < N; i++) work += cur[i];
    const i0 = head;
    times[i0] = ms; otherRing[i0] = Math.max(0, ms - work);
    for (let i = 0; i < N; i++) stageRing[i0 * N + i] = cur[i];
    head = (head + 1) % keep; count++;
    if (ms > stutterFactor * target) {
      const h = heap();
      let cause = null, top = -1;
      for (let i = 0; i < N; i++) if (top < 0 || cur[i] > cur[top]) top = i;
      if (endPrograms > startPrograms) cause = 'shader compile';
      else if (startHeap != null && h != null && startHeap - h > 1048576) cause = 'garbage collection';
      else if (work < ms * 0.5) cause = 'browser';
      else cause = STAGES[top];
      stutterCount++;
      byCause[cause] = (byCause[cause] ?? 0) + 1;
      const made = cause === 'shader compile' ? (renderer.info.programs ?? []).slice(startPrograms, endPrograms).map(p => p.name) : undefined;
      stutters.push({ at: prevStart, ms, cause, stages: Object.fromEntries(STAGES.map((s, i) => [s, +cur[i].toFixed(2)]).filter(([, v]) => v >= 0.5)), ...(made && { shaders: made }) });
      if (stutters.length > 50) stutters.shift();
    }
  }

  const P = {
    get target() { return target; },
    get stutterFactor() { return stutterFactor; },
    set target(ms) { target = ms; },
    frameStart(at = now()) {
      if (open) close(at);
      prevStart = at; lapAt = at; open = true;
      cur.fill(0);
      startPrograms = endPrograms = programs();
      // (what the frame before allocated: the heap's growth across it — or, where a collection shrank it, nothing known)
      const h = heap();
      if (open && startHeap != null && h != null) { if (h >= startHeap) allocBytes += h - startHeap; else if (startHeap - h > 1048576) collections++; }
      startHeap = h;
    },
    // the time since the last lap (or the frame's start) was this stage's
    lap(stage) { const t = now(), i = idx[stage]; if (i != null) cur[i] += t - lapAt; lapAt = t; },
    // time measured elsewhere, counted to a stage and out of another (the physics' AI out of the physics)
    add(stage, ms, from = null) { const i = idx[stage]; if (i == null || !(ms > 0)) return; cur[i] += ms; if (from != null && idx[from] != null) cur[idx[from]] = Math.max(0, cur[idx[from]] - ms); },
    frameEnd() {
      endPrograms = programs();
      const R = renderer?.info?.render;
      if (R) { last.calls = R.calls; last.triangles = R.triangles; callsSum += R.calls; trisSum += R.triangles; renderFrames++; renderer.info.reset(); }
    },
    reset() { count = 0; head = 0; stutterCount = 0; stutters.length = 0; for (const k of Object.keys(byCause)) delete byCause[k]; callsSum = trisSum = renderFrames = allocBytes = collections = 0; open = false; startHeap = null; },
    get stutters() { return stutters; },
    // (frames timed since the start or the last reset)
    get count() { return count; },
    get last() { return last; },
    recent(n = 120) { const m = Math.min(n, count, keep), out = new Array(m); for (let k = 0; k < m; k++) out[k] = times[(head - m + k + keep) % keep]; return out; },
    stats() {
      const m = Math.min(count, keep);
      if (!m) return null;
      const t = Array.from({ length: m }, (_, k) => times[(head - m + k + keep) % keep]), sorted = t.slice().sort((a, b) => a - b);
      const sum = t.reduce((a, b) => a + b, 0), pick = q => sorted[Math.min(m - 1, Math.floor(q * m))];
      const worst = sorted.slice(Math.floor(m * 0.99)), worst1PctMs = worst.reduce((a, b) => a + b, 0) / Math.max(1, worst.length);
      const stages = {}, stageShare = {};
      for (let i = 0; i < N; i++) { let s = 0; for (let k = 0; k < m; k++) s += stageRing[((head - m + k + keep) % keep) * N + i]; stages[STAGES[i]] = s / m; }
      let other = 0; for (let k = 0; k < m; k++) other += otherRing[(head - m + k + keep) % keep];
      stages.other = other / m;
      const avgMs = sum / m, median = pick(0.5);
      let relStutters = 0;
      for (const x of t) if (x > stutterFactor * median) relStutters++;
      for (const [k, v] of Object.entries(stages)) stageShare[k] = v / avgMs;
      const h = heap();
      return {
        frames: m, seconds: sum / 1000, avgMs, p50Ms: pick(0.5), p95Ms: pick(0.95), p99Ms: pick(0.99), worst1PctMs, fps: 1000 / avgMs, low1PctFps: 1000 / worst1PctMs,
        stages, stageShare,
        stutters: { count: stutterCount, perMinute: stutterCount / Math.max(1e-9, sum / 60000), share: stutterCount / m, byCause: { ...byCause } },
        // (frames over stutterFactor × this run's own median: what stutters on a machine far from the target, e.g. with
        // no graphics card)
        relStutters: { count: relStutters, share: relStutters / m },
        heapMB: h != null ? h / 1048576 : null,
        // (garbage made: MB a second the heap grew between collections — what object pools cut — and the collections seen)
        allocMBps: h != null ? allocBytes / 1048576 / Math.max(1e-9, sum / 1000) : null, collections,
        calls: renderFrames ? callsSum / renderFrames : null, triangles: renderFrames ? trisSum / renderFrames : null,
      };
    },
  };
  return P;
}
