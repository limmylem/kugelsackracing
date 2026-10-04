// Drift scoring, pure (the rules: data/quests.json drift). Fed the car each physics tick: where it points
// and where it's going. A drift is a slip angle over minAngle at over minKmh; its points go into the combo
// pot, faster for a bigger angle and more speed; holding it raises the multiplier. A drift ending is kept
// in the combo if another starts within comboGrace; otherwise the pot × the multiplier is banked. A wall
// hit or a spin loses the pot.
//
//   const D = createDriftScorer(rules)
//   D.tick({ dt, fx, fz, vx, vz, impulse }) → events (impulse: the hardest hit this tick, its strength in m/s) [{ type: 'drift-start' | 'drift-bank' | 'drift-lost', … }]
//   D.end() → banks what's in the pot (the run's over)
//   D.state { score, pot, multiplier, angle, drifting, held, combo, best }

const DEG = 180 / Math.PI;

// the angle between where the car points and where it's going, 0–180°
export function slipAngle(fx, fz, vx, vz) {
  const sp = Math.hypot(vx, vz), fm = Math.hypot(fx, fz);
  if (sp < 1e-6 || fm < 1e-6) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (fx * vx + fz * vz) / (sp * fm)))) * DEG;
}
export function pointsPerSecond(R, angle, kmh) {
  return R.pointsPerSecond * Math.min(2, angle / 30) * Math.min(2, kmh / 60);
}

export function createDriftScorer(R) {
  const S = { score: 0, pot: 0, multiplier: 1, angle: 0, drifting: false, held: 0, gap: 0, combo: false, best: 0, drifts: 0, lost: 0 };
  const bank = ev => {
    if (S.pot > 0) {
      const pts = Math.round(S.pot * S.multiplier);
      S.score += pts; S.best = Math.max(S.best, pts);
      ev?.push({ type: 'drift-bank', points: pts, multiplier: S.multiplier, score: S.score });
    }
    S.pot = 0; S.multiplier = 1; S.held = 0; S.combo = false;
  };
  const lose = (ev, why) => {
    if (S.pot > 0 || S.combo) ev.push({ type: 'drift-lost', why, points: Math.round(S.pot * S.multiplier) });
    S.lost += S.pot > 0 ? 1 : 0;
    S.pot = 0; S.multiplier = 1; S.held = 0; S.combo = false; S.drifting = false;
  };
  return {
    state: S,
    tick({ dt, fx, fz, vx, vz, impulse = 0 }) {
      const ev = [], sp = Math.hypot(vx, vz), kmh = sp * 3.6;
      S.angle = sp > 1 ? slipAngle(fx, fz, vx, vz) : 0;
      if (impulse > R.wallHit) { lose(ev, 'wall'); return ev; }
      if (sp > 3 && S.angle > R.spinAngle) { lose(ev, 'spin'); return ev; }
      const drifting = S.angle >= R.minAngle && kmh >= R.minKmh;
      if (drifting) {
        if (!S.drifting) { S.drifts++; ev.push({ type: 'drift-start', combo: S.combo }); }
        S.drifting = true; S.combo = true; S.gap = 0;
        const before = Math.floor(S.held / R.comboEvery);
        S.held += dt;
        if (Math.floor(S.held / R.comboEvery) > before && S.multiplier < R.comboMax) { S.multiplier++; ev.push({ type: 'drift-combo', multiplier: S.multiplier }); }
        S.pot += pointsPerSecond(R, S.angle, kmh) * dt;
      } else {
        S.drifting = false;
        if (S.combo) { S.gap += dt; if (S.gap > R.comboGrace) bank(ev); }
      }
      return ev;
    },
    end() { const ev = []; bank(ev); S.drifting = false; return ev; },
    // (what the run has: the banked score and what's in the pot now)
    get total() { return S.score + Math.round(S.pot * S.multiplier); },
  };
}
