// A driver's numbers from its profile (data/npc.json): skill (0–1) → line accuracy, braking point,
// cornering margin, reaction time, consistency, mistake rate and throttle commitment (each can be set on its own too);
// personality → following gap, how often it tries a pass, how often it defends, how it takes a hit.
//
//   driverParams(profile, npcConfig, { skill, aggression }) → { skill, lineAccuracy, brakingPoint, cornerMargin,
//     reactionTime, consistency, mistakeRate, throttle, aggression, caution, followGap, overtakeEvery, defendChance, onHit }

const lerp = ([a, b], t) => a + (b - a) * Math.max(0, Math.min(1, t));

export function driverParams(profile, cfg, over = {}) {
  const K = cfg.skill, Pn = cfg.personality, skill = over.skill ?? profile.skill ?? 0.5;
  const aggression = over.aggression ?? profile.aggression ?? 0.5, caution = profile.caution ?? 0.5;
  const pick = key => profile[key] ?? lerp(K[key], skill);
  return {
    skill, aggression, caution, onHit: profile.onHit ?? 'calm',
    lineAccuracy: pick('lineAccuracy'), brakingPoint: pick('brakingPoint'), cornerMargin: pick('cornerMargin'),
    reactionTime: pick('reactionTime'), consistency: pick('consistency'), mistakeRate: pick('mistakeRate'),
    throttle: K.throttle ? pick('throttle') : 1,
    followGap: lerp(Pn.followGap, caution), overtakeEvery: lerp(Pn.overtakeEvery, aggression), defendChance: lerp(Pn.defendChance, aggression),
  };
}
