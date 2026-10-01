// Writes sample models for trying the content pipeline (npm run import): a spoiler and a five-spoke
// rim made to the rules; with --broken, models with the mistakes the checker catches too.
//
//   npm run sample-models                  → incoming/: a ducktail, a five-spoke rim, a GT wing, a vented bonnet, a splitter
//   npm run sample-models -- wing_gt       just those whose names start so
//   npm run sample-models -- --broken      → and incoming/spoiler_centimetres.glb, …
//   npm run sample-models -- --out dir

import fs from 'node:fs';
import path from 'node:path';
import { modelIO } from './content/io.mjs';
import { brokenModels, sampleGtWing, sampleRim, sampleSplitterBumper, sampleSpoiler, sampleVentedBonnet } from './content/samples.mjs';
import { ROOT, loadRules } from './content/rules.mjs';

const args = process.argv.slice(2), i = args.indexOf('--out'), out = i >= 0 ? path.resolve(args[i + 1]) : path.join(ROOT, 'incoming');
const { finishes } = loadRules(), io = await modelIO();
const only = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--out');
const all = { 'spoiler_ducktail.glb': () => sampleSpoiler({ finishes }), 'rim_5spoke.glb': () => sampleRim({ finishes }), 'wing_gt.glb': () => sampleGtWing({ finishes }), 'bonnet_vented.glb': () => sampleVentedBonnet({ finishes }), 'bumper_front_splitter.glb': () => sampleSplitterBumper({ finishes }) };
const docs = {};
for (const [name, make] of Object.entries(all)) if (!only.length || only.some(o => name.startsWith(o))) docs[name] = await make();
if (args.includes('--broken')) Object.assign(docs, await brokenModels({ finishes }));
fs.mkdirSync(out, { recursive: true });
for (const [name, doc] of Object.entries(docs)) {
  fs.writeFileSync(path.join(out, name), await io.writeBinary(doc));
  console.log(`wrote ${path.relative(process.cwd(), path.join(out, name))}`);
}
