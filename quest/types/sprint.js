// Sprint: from the start to the finish (laps on a loop), the fastest time wins. Nothing on top of the
// session: its medals are times (quest/rules.js medalTargets).
export default {
  id: 'sprint',
  hud: S => ({ kind: 'target', next: nextMedal(S) }),
};

// the best medal still within reach at the clock now, and its time
export function nextMedal(S) {
  const T = S.targets;
  if (T.kind !== 'time') return null;
  const now = S.clock + S.penalties.reduce((a, p) => a + p.seconds, 0);
  for (const tier of ['gold', 'silver', 'bronze']) if (T[tier] != null && now <= T[tier]) return { tier, time: T[tier] };
  return null;
}
