// (the determinism experiment: stdlib's ports of FreeBSD's maths — sine, cosine, … built only from exact IEEE
// arithmetic — bundled as one module, .cache/determinism/detmath.mjs, for Node and the browsers.
// Needs the @stdlib/math-base-special-* packages installed: .github/workflows/determinism.yml)
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { root } from '../harness.mjs';

const FNS = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'pow', 'hypot'];
const dir = path.join(root, '.cache/determinism');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'detmath-entry.mjs'), FNS.map(f => `export { default as ${f} } from '@stdlib/math-base-special-${f}';`).join('\n'));
await build({ entryPoints: [path.join(dir, 'detmath-entry.mjs')], bundle: true, format: 'esm', minify: true, outfile: path.join(dir, 'detmath.mjs'), nodePaths: [path.join(root, 'node_modules')], logLevel: 'warning' });
console.log(`${FNS.length} functions → ${path.join(dir, 'detmath.mjs')}`);
