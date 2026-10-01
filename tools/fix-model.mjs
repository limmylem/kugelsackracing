// The auto-fixer on its own (npm run import runs it on everything it imports): checks a model, fixes
// what it can (tools/content/fix.mjs), checks it again and writes it.
//
//   npm run fix-model -- in.glb [--out out.glb]     (default: in place)
//     --type spoiler        what it is, if its file name doesn't say
//     --scale 0.01          scale it (made in centimetres: 0.01; millimetres: 0.001)
//     --place-origin        move it so its origin is where its type's rules say
//     --paint "#6d9a91"     put the surfaces textured in this colour in the "paint" material
//     --paint-tolerance 40  how close a colour counts (0–441, RGB distance)
//     --material "Material.001=paint"   rename a material (repeatable)
//     --no-compress         leave the geometry uncompressed

import fs from 'node:fs';
import path from 'node:path';
import { checkModel, formatReport } from './content/check.mjs';
import { autoFix } from './content/fix.mjs';
import { inspect } from './content/inspect.mjs';
import { modelIO, readModel } from './content/io.mjs';
import { loadProject } from './content/project.mjs';
import { typeFromName } from './content/rules.mjs';

const args = process.argv.slice(2), flag = n => args.includes(n), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const valued = new Set(['--out', '--type', '--scale', '--paint', '--paint-tolerance', '--material']);
const renames = Object.fromEntries(args.flatMap((a, i) => a === '--material' ? [args[i + 1].split('=')] : []));
const input = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
if (!input) { console.error('usage: npm run fix-model -- model.glb [--out out.glb] [--type t] [--scale k] [--place-origin] [--paint #rrggbb] [--no-compress]'); process.exit(2); }
const out = opt('--out') ?? input;
const project = await loadProject();
const type = opt('--type') ?? typeFromName(input, project.rules);
if (!type) console.log(`(can't tell what ${path.basename(input)} is from its name: checking the general rules only; say --type to check its size and origin)`);

const doc = await readModel(input), inputBytes = fs.statSync(input).size;
const ctx = { rules: project.rules, type: type ?? 'spoiler', db: project.db, knownSockets: project.knownSockets, file: input, estimateMass: true };
const report = (title, d) => {
  const r = checkModel(inspect(d), ctx);
  if (!type) r.findings = r.findings.filter(f => !['size', 'origin', 'shape'].includes(f.check));
  console.log(formatReport(input, { ...r, verdict: r.findings.some(f => f.level === 'fail') ? 'fail' : r.findings.some(f => f.level === 'warn') ? 'warn' : 'pass' }, { colour: process.stdout.isTTY, quiet: true, title }));
  return r;
};
report('before', doc);
const did = await autoFix(doc, { rules: project.rules, type, scale: opt('--scale') ? +opt('--scale') : null, placeOrigin: flag('--place-origin'), paint: opt('--paint') ? { colour: opt('--paint'), tolerance: +(opt('--paint-tolerance') ?? 40) } : null, materials: renames, compress: !flag('--no-compress') });
console.log(did.length ? did.map(d => `  fixed: ${d}`).join('\n') : '  nothing to fix');
const after = report('after', doc);
const bytes = await (await modelIO()).writeBinary(doc);
fs.writeFileSync(out, bytes);
console.log(`wrote ${out} (${(bytes.byteLength / 1024).toFixed(1)} KB, was ${(inputBytes / 1024).toFixed(1)} KB)`);
process.exit(after.findings.some(f => f.level === 'fail') ? 1 : 0);
