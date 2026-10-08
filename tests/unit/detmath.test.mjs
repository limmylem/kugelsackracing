// The deterministic maths (physics/detmath.js; docs/DETERMINISM.md): each function it puts on Math gives what the
// platform's does (to within rounding) — the same functions, not just the same bits everywhere. Found by the browser
// race test: stdlib's `log` is log(x, base), so Math.log was NaN everywhere (the engine sound) until it was mapped to `ln`.
import test from 'node:test';
import assert from 'node:assert/strict';

const native = Object.fromEntries(['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'pow', 'hypot'].map(f => [f, Math[f]]));
const { installDetMath, detMathInstalled } = await import('../../physics/detmath.js');

test('installed, each one agrees with the platform\'s', () => {
  assert.equal(installDetMath(), true);
  assert.ok(detMathInstalled());
  assert.equal(installDetMath(), false, 'once');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const close = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b || Math.abs(a - b) <= 2e-15 * Math.max(1, Math.abs(b));
  const one = { sin: () => (rnd() * 2 - 1) * 100, cos: () => (rnd() * 2 - 1) * 100, tan: () => (rnd() * 2 - 1) * 1.5, atan: () => (rnd() * 2 - 1) * 100,
    asin: () => rnd() * 2 - 1, acos: () => rnd() * 2 - 1, exp: () => (rnd() * 2 - 1) * 50, log: () => rnd() * 10 ** (rnd() * 20 - 10) };
  for (const [f, gen] of Object.entries(one)) for (let i = 0; i < 2000; i++) { const x = gen(); assert.ok(close(Math[f](x), native[f](x)), `${f}(${x}): ${Math[f](x)} vs ${native[f](x)}`); }
  for (let i = 0; i < 2000; i++) {
    const a = (rnd() * 2 - 1) * 20, b = (rnd() * 2 - 1) * 20, p = rnd() * 10;
    assert.ok(close(Math.atan2(a, b), native.atan2(a, b)), `atan2(${a}, ${b})`);
    assert.ok(close(Math.pow(p, a / 4), native.pow(p, a / 4)), `pow(${p}, ${a / 4})`);
    assert.ok(Math.abs(Math.hypot(a, b, p) - native.hypot(a, b, p)) <= 1e-14 * native.hypot(a, b, p), `hypot(${a}, ${b}, ${p})`);
  }
  // the edges
  assert.equal(Math.log(1), 0); assert.equal(Math.log(0), -Infinity); assert.ok(Number.isNaN(Math.log(-1))); assert.equal(Math.log(Math.E), 1);
  assert.equal(Math.hypot(), 0); assert.equal(Math.hypot(3, 4), 5); assert.equal(Math.pow(2, 10), 1024); assert.equal(Math.exp(0), 1);
});
