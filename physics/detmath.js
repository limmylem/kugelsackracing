// Deterministic maths (Phase 7 Step 3; docs/DETERMINISM.md): the platform's sine, cosine, exp, pow, atan2 … give
// different last bits on different engines (and engine versions), and a race's physics replayed on the server must
// match the player's browser bit for bit. installDetMath() replaces them on Math with stdlib's ports of FreeBSD's
// maths library (physics/vendor/detmath.js: built only from exact IEEE arithmetic), once, before anything is built or
// simulated. The game, the bots and the verifier all install it. Math.hypot keeps taking any number of arguments.

import * as D from './vendor/detmath.js';

const FNS = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'pow'];
let installed = false;
export function installDetMath() {
  if (installed) return false;
  for (const f of FNS) Math[f] = D[f];
  // (stdlib's hypot takes two: folded over however many are given, the same way everywhere)
  const h2 = D.hypot;
  Math.hypot = function hypot(...xs) {
    if (xs.length === 0) return 0;
    let h = Math.abs(+xs[0]);
    for (let i = 1; i < xs.length; i++) h = h2(h, +xs[i]);
    return h;
  };
  installed = true;
  return true;
}
export const detMathInstalled = () => installed;
