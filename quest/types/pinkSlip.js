// Pink slip: race a rival for keeps, the loser's car to the winner. The framework only — it needs rival
// drivers (Phase 4 Step 4), so it can't be started yet. What's here: the stake (which car, what it's
// worth), the confirmation screens that say plainly that the car will be lost, and what the outcome does:
// the car changes hands through PlayerService (forfeitCar / awardCar), never anywhere else.
export default {
  id: 'pink_slip',
  enabled: false,
  disabledReason: 'Pink slips need rival drivers: they come with Phase 4 Step 4.',
  init: () => ({ rival: null }),
  // (with rivals: who crossed first. Until then a finish is a win against no one, and transfers nothing)
  finish: (S, status) => ({ pinkSlip: { won: status === 'finished' && S.rival?.finished !== true, rival: S.rival?.car ?? S.quest.params?.opponentCar ?? null, transfer: !!S.rival } }),
  hud: S => ({ kind: 'pinkSlip', rival: S.quest.params?.opponentCar ?? null }),
};

// The confirmation screens before a pink slip starts: each must be accepted, the last by typing the
// car's name. stake: { name, value, currency }
export function pinkSlipConfirmations(stake, rivalName) {
  const value = `${stake.currency ?? '$'}${Math.round(stake.value ?? 0).toLocaleString('en-GB')}`;
  return [
    { title: 'Race for pink slips', text: `You're putting up your ${stake.name} (worth about ${value}) against ${rivalName ?? 'your rival'}'s car. The winner keeps both.`, accept: 'I understand' },
    { title: 'You will lose this car if you lose', text: `If you lose, crash out, quit or run out of time, your ${stake.name} is gone for good: it leaves your garage with everything fitted to it. This can't be undone.`, accept: 'I accept the risk' },
    { title: 'Last chance', text: `Type the car's name to put it up: ${stake.name}.`, typed: stake.name, accept: 'Race for it' },
  ];
}
