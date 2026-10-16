// The driving school's lessons, as rules (Phase 8 Step 4; docs/ONBOARDING.md): what each lesson lays out on the
// proving ground, what it measures from the car as it drives, and when a run is over — kept apart from the drawing
// (play/school.js) so the tests can run a lesson with made-up drives. Positions are [x, z] from the lesson's start, the
// car facing +z; each lesson's medals and rewards are in data/school.json, the server pays them.
//
//   const L = createLesson(def)          // def: a lesson from data/school.json
//   L.layout → { gates: [{ at, width }], cones: [[x, z]], line: { z }, circle: { at, r } }
//   L.update({ t, pos: [x, z], kmh, brake (0..1), rearSlipDeg, gripUsed }) → { phase, tip, value, done, failed }
//   phase: 'ready' (drive to start) → 'run' → 'done' | 'failed'; tip: a message key (locales/en.json school.*)

export const COURSES = {
  hairpins: { gates: [[0, 60], [24, 110], [0, 160], [-24, 210], [0, 260], [0, 300]], width: 9 },
  'single-corner': { gates: [[0, 130], [55, 190]], width: 10 },
  skidpad: { circle: { at: [0, 70], r: 18 } },
  slalom: { cones: Array.from({ length: 10 }, (_, i) => [i % 2 ? 1.2 : -1.2, 50 + i * 18]), finish: 50 + 10 * 18 + 10 },
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const crossed = (prev, pos, gate, width) => {
  // (passing a gate: within its width of its middle as the car goes by it — closest approach on this step's segment)
  const [ax, az] = prev, [bx, bz] = pos, dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
  const k = Math.max(0, Math.min(1, ((gate[0] - ax) * dx + (gate[1] - az) * dz) / L2));
  return Math.hypot(ax + dx * k - gate[0], az + dz * k - gate[1]) <= width / 2;
};

export function createLesson(def) {
  const S = def.setup ?? {}, course = COURSES[S.course] ?? {};
  const layout = { gates: (course.gates ?? []).map(at => ({ at, width: course.width })), cones: course.cones ?? [], line: null, circle: course.circle ?? null };
  if (def.id === 'braking-zone') layout.line = { z: S.stopAt ?? 120 };
  let phase = 'ready', prev = null, startT = null, next = 0, value = null, braking = null, entry = null, drift = 0, hits = new Set(), peak = 0, tip = 'school.tip.start';
  const finish = (v, fail = null) => { phase = fail ? 'failed' : 'done'; value = v; tip = fail ?? 'school.tip.done'; };
  function update(s) {
    if (phase === 'done' || phase === 'failed') return state();
    const pos = s.pos;
    if (prev == null) prev = pos;
    peak = Math.max(peak, s.kmh);
    switch (def.id) {
      case 'braking-zone': case 'threshold-braking': {
        const want = S.speedKmh ?? 100;
        if (phase === 'ready') { tip = 'school.tip.speedUp'; if (s.kmh >= want * 0.95) { phase = 'run'; startT = s.t; tip = def.id === 'braking-zone' ? 'school.tip.stopOnLine' : 'school.tip.brakeHard'; } break; }
        if (!braking && s.brake > 0.5) braking = { pos, kmh: s.kmh };
        if (braking && def.id === 'threshold-braking' && braking.kmh < want * 0.95) return finish(null, 'school.fail.tooSlow'), state();
        if (s.kmh < 0.5 && braking) {
          if (def.id === 'braking-zone') finish(Math.abs(pos[1] - layout.line.z));
          else finish(dist(braking.pos, pos));
        }
        if (def.id === 'braking-zone' && pos[1] > layout.line.z + 60) finish(null, 'school.fail.overshot');
        break;
      }
      case 'cornering-line': case 'wet-control': {
        const G = layout.gates;
        if (phase === 'ready') { tip = 'school.tip.throughGates'; if (pos[1] > 5) { phase = 'run'; startT = s.t; } break; }
        if (next < G.length && crossed(prev, pos, G[next].at, G[next].width)) next++;
        // (missed one: past it by more than 25 m without going through)
        if (next < G.length && pos[1] > G[next].at[1] + 25) { finish(null, 'school.fail.missedGate'); break; }
        if (next === G.length) finish(s.t - startT);
        if (s.t - startT > 300) finish(null, 'school.fail.tooLong');
        break;
      }
      case 'trail-braking': {
        const [g1, g2] = layout.gates, want = S.entryKmh ?? 110;
        if (phase === 'ready') { tip = 'school.tip.entrySpeed'; if (crossed(prev, pos, g1.at, g1.width)) { if (s.kmh < want * 0.95) { finish(null, 'school.fail.tooSlow'); break; } phase = 'run'; entry = s.kmh; startT = s.t; tip = 'school.tip.trail'; } break; }
        if (crossed(prev, pos, g2.at, g2.width)) finish(s.kmh);
        if (s.t - startT > 20) finish(null, 'school.fail.missedGate');
        break;
      }
      case 'drift-intro': {
        const C = layout.circle;
        if (phase === 'ready') { tip = 'school.tip.toCircle'; if (dist(pos, C.at) < C.r + 8) { phase = 'run'; startT = s.t; tip = 'school.tip.drift'; } break; }
        const onPad = Math.abs(dist(pos, C.at) - C.r) < 10;
        if (onPad && s.kmh > 25 && Math.abs(s.rearSlipDeg) > 15) drift += s.dt ?? 0;
        if (s.t - startT >= 30) finish(Math.round(drift * 10) / 10);
        break;
      }
      case 'car-control': {
        if (phase === 'ready') { tip = 'school.tip.slalom'; if (pos[1] > 20) { phase = 'run'; startT = s.t; } break; }
        layout.cones.forEach((c, i) => { if (dist(pos, c) < 1.1) hits.add(i); });
        if (pos[1] > COURSES.slalom.finish) { if (s.t - startT > 40) finish(null, 'school.fail.tooSlow'); else finish(hits.size); }
        if (s.t - startT > 120) finish(null, 'school.fail.tooLong');
        break;
      }
      default: finish(null, 'school.fail.unknown');
    }
    prev = pos;
    return state();
  }
  const state = () => ({ phase, tip, value, done: phase === 'done', failed: phase === 'failed', next, hits: hits.size, drift });
  return { def, layout, update, state };
}

// the medal a value earns (as the server works it out: server/src/routes/launch.ts medalFor)
export function medalOf(def, value) {
  if (value == null || !Number.isFinite(value)) return null;
  let got = null;
  for (const m of ['bronze', 'silver', 'gold']) if (def.better === 'lower' ? value <= def.medals[m] : value >= def.medals[m]) got = m;
  return got;
}
