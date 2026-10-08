// The deterministic maths bundle (Phase 7 Step 3; docs/DETERMINISM.md): stdlib's ports of FreeBSD's maths library —
// sine, cosine, … built only from + − × ÷ and sqrt, which IEEE 754 makes exact everywhere — as one module the game,
// the bots and the verifier all load (physics/detmath.js installs it). Run after updating the packages:
//   node tools/build-detmath.mjs   → physics/vendor/detmath.js
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FNS = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'pow', 'hypot'];
const entry = path.join(root, '.cache/detmath-entry.mjs');
fs.mkdirSync(path.dirname(entry), { recursive: true });
fs.writeFileSync(entry, FNS.map(f => `export { default as ${f} } from '@stdlib/math-base-special-${f}';`).join('\n'));
const versions = FNS.map(f => `${f} ${JSON.parse(fs.readFileSync(path.join(root, `node_modules/@stdlib/math-base-special-${f}/package.json`), 'utf8')).version}`).join(', ');
await build({ entryPoints: [entry], bundle: true, format: 'esm', minify: true, outfile: path.join(root, 'physics/vendor/detmath.js'), nodePaths: [path.join(root, 'node_modules')], logLevel: 'warning',
  banner: { js: `// stdlib (Apache-2.0, https://github.com/stdlib-js/stdlib): @stdlib/math-base-special-* — ${versions}. Built by tools/build-detmath.mjs.` } });
console.log(`${FNS.length} functions → physics/vendor/detmath.js`);
