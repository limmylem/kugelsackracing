// Class rules (data/content/balance.json): a car is its own class (car.json class) stock, and the most
// powerful build there is for it (tools/content/maxbuild.mjs) is at most maxClassJump classes higher —
// except the cars in exempt (a supercar, already at the top). (garage/balance.js: the server checks edits by it too.)
//
//   classProblems(db, carId, rules, { stock, max }) → [problem in words]   (stock, max: ratings)

export { classProblems } from '../../garage/balance.js';
