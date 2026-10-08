// Imported first by the game (testtrack/test-scene.js): the deterministic maths in place before anything is built or
// simulated — the server drives multiplayer runs again with the same (physics/detmath.js; docs/DETERMINISM.md).
// ?nativemath leaves the platform's own (a diagnostic: what it costs; multiplayer runs then can't be driven again)
import { installDetMath } from './detmath.js';

if (!(typeof location !== 'undefined' && new URLSearchParams(location.search).has('nativemath'))) installDetMath();
