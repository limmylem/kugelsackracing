// The deterministic maths bundle (Phase 7 Step 3; docs/DETERMINISM.md): stdlib's ports of FreeBSD's maths library —
// sine, cosine, … built only from + − × ÷ and sqrt, which IEEE 754 makes exact everywhere — as one module the game,
// the bots and the verifier all load (physics/detmath.js installs it). Run after updating the packages:
//   node tools/build-detmath.mjs   → physics/vendor/detmath.js
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// Math's name → stdlib's package (Math.log is the natural log: stdlib's `ln` — its `log` is log(x, base))
const FNS = { sin: 'sin', cos: 'cos', tan: 'tan', atan: 'atan', atan2: 'atan2', asin: 'asin', acos: 'acos', exp: 'exp', log: 'ln', pow: 'pow', hypot: 'hypot' };
const entry = path.join(root, '.cache/detmath-entry.mjs');
fs.mkdirSync(path.dirname(entry), { recursive: true });
fs.writeFileSync(entry, Object.entries(FNS).map(([f, pkg]) => `export { default as ${f} } from '@stdlib/math-base-special-${pkg}';`).join('\n'));
const versions = Object.values(FNS).map(pkg => `${pkg} ${JSON.parse(fs.readFileSync(path.join(root, `node_modules/@stdlib/math-base-special-${pkg}/package.json`), 'utf8')).version}`).join(', ');
await build({ entryPoints: [entry], bundle: true, format: 'esm', minify: true, outfile: path.join(root, 'physics/vendor/detmath.js'), nodePaths: [path.join(root, 'node_modules')], logLevel: 'warning',
  banner: { js: `// stdlib (Apache-2.0, https://github.com/stdlib-js/stdlib): @stdlib/math-base-special-* — ${versions}. Built by tools/build-detmath.mjs.` } });
console.log(`${Object.keys(FNS).length} functions → physics/vendor/detmath.js`);
