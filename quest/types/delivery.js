// Delivery: carry the cargo from the start to the destination (the route's finish), inside the time
// limit if there is one. The cargo takes the damage the car takes (data/quests.json delivery: twice over
// if it's fragile); the payout loses the quest's damagePenalty × the share lost (quest/rules.js earnings);
// at 0% it's destroyed and the delivery's failed.
export default {
  id: 'delivery',
  init: S => ({ limit: S.quest.params?.timeLimitSeconds ?? null, cargo: 100 }),
  tick(S, I, emit, end) {
    const C = S.quest.params?.cargo ?? {}, factor = C.fragile ? S.config.delivery.fragileFactor : 1;
    const before = S.cargo;
    S.cargo = Math.max(0, 100 - S.damage * factor);
    if (S.cargo < before - 0.5) emit({ type: 'cargo', condition: S.cargo, lost: before - S.cargo });
    if (S.cargo <= 0) end('failed', { reason: 'cargo', text: `${S.quest.params?.cargo?.name || 'The cargo'} destroyed` });
  },
  finish: S => ({ cargo: Math.round(S.cargo * 10) / 10, cargoLost: Math.round((100 - S.cargo) * 10) / 1000 }),
  hud: S => ({ kind: 'delivery', name: S.quest.params?.cargo?.name || 'Cargo', fragile: !!S.quest.params?.cargo?.fragile, massKg: S.quest.params?.cargo?.massKg ?? 0, condition: Math.round(S.cargo), timeLeft: S.limit != null ? Math.max(0, S.limit + S.extension - S.clock) : null }),
};
