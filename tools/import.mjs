// Imports every model dropped in incoming/ (or the files named): checks it, fixes what can be fixed,
// checks it again, and puts it in the game — model, icon and a starting part definition (price and
// stats to do), or for a car its source, car.json and split body and parts. See tools/content/importer.mjs
// and docs/MODELLING_GUIDE.md. A model that still fails stays in incoming/ with what to fix.
//
//   npm run import                        every .glb in incoming/ (named like spoiler_ducktail.glb)
//   npm run import -- incoming/x.glb      just these
//     --type spoiler                      what they are (if the names don't say: otherwise it asks)
//     --place-origin   --scale 0.01   --paint "#6d9a91"   --material "Material.001=paint"   (as npm run fix-model)
//     --keep                              leave the originals in incoming/

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { formatReport } from './content/check.mjs';
import { importFile } from './content/importer.mjs';
import { glbFiles, loadProject } from './content/project.mjs';
import { ROOT, rel } from './content/rules.mjs';

const args = process.argv.slice(2), flag = n => args.includes(n), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const valued = new Set(['--type', '--scale', '--paint', '--paint-tolerance', '--material']);
const named = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const incoming = path.join(ROOT, 'incoming');
const files = named.length ? named.flatMap(p => glbFiles(path.resolve(p))) : fs.existsSync(incoming) ? fs.readdirSync(incoming).filter(f => f.toLowerCase().endsWith('.glb')).map(f => path.join(incoming, f)) : [];
if (!files.length) { console.log(named.length ? 'No .glb files there.' : 'Nothing to import: put .glb files in incoming/ (named like spoiler_ducktail.glb or rim_5spoke.glb).'); process.exit(0); }

const colour = process.stdout.isTTY, bold = s => colour ? `\x1b[1m${s}\x1b[0m` : s;
const options = {
  type: opt('--type'), scale: opt('--scale') ? +opt('--scale') : null, placeOrigin: flag('--place-origin'), keepOriginal: flag('--keep'),
  paint: opt('--paint') ? { colour: opt('--paint'), tolerance: +(opt('--paint-tolerance') ?? 40) } : null,
  materials: Object.fromEntries(args.flatMap((a, i) => a === '--material' ? [args[i + 1].split('=')] : [])),
  ask: process.stdin.isTTY ? askType : null,
};
let ok = 0, failed = 0;
for (const file of files) {
  const project = await loadProject();          // (again for each: the one before may have added parts)
  console.log(`\n${bold(`── ${rel(file)}`)}`);
  const r = await importFile(file, project, options);
  // (the check as it came, what the fixer did, and the check after — once, if fixing changed nothing it found)
  const same = r.before && r.after && JSON.stringify(r.before.findings) === JSON.stringify(r.after.findings);
  if (r.before && !same) console.log(formatReport(rel(file), r.before, { colour, quiet: true, title: 'as it came' }));
  if (r.did?.length) console.log(r.did.map(d => `  fixed: ${d}`).join('\n'));
  if (r.after) console.log(formatReport(rel(file), r.after, { colour, quiet: true, title: same ? 'checked' : 'after fixing' }));
  if (!r.ok) { failed++; console.log(`  ✘ ${r.message}`); continue; }
  ok++;
  for (const w of r.written) console.log(`  wrote ${w}`);
  for (const n of r.notes) console.log(`  ${n}`);
}
if (ok) {
  // the data as a whole still checks out with the new files in it
  const { problems } = await loadProject();
  for (const p of problems) console.log(`  ERROR ${p.file} · ${p.path}: ${p.message}`);
  if (problems.length) failed++;
}
console.log(`\nImported ${ok} of ${files.length}${failed ? `; ${failed} not (see above)` : ''}.${ok ? ' New parts are in the shop with "to do" on them: fill in their price and stats (and delete "todo") to sell them. Look at them in the part preview: http://localhost:7690/dev/parts.html' : ''}`);
process.exit(failed ? 1 : 0);

async function askType(file, types) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`What is ${path.basename(file)}? (next time, name it like <type>_<name>.glb)`);
    types.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}  ${t}`));
    const a = (await rl.question('Number or type (Enter to skip): ')).trim();
    return types[+a - 1] ?? (types.includes(a) ? a : null);
  } finally { rl.close(); }
}
