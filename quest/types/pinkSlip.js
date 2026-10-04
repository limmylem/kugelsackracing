// Pink slip: race a rival (an NPC, race/race.js) for keeps, head to head: the loser's car to the winner.
// The confirmation screens say plainly that the car will be lost; the outcome (who crossed first: the
// race's place) moves the car through PlayerService (awardCar / forfeitCar: play/questController.js),
// never anywhere else. No rubber-banding. The starter car can't be staked (quest/rules.js).
export default {
  id: 'pink_slip',
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
