// The problem seeds (Phase 5 Step 4): tracks that were bad or felt wrong, kept with what was wrong
// (tests/fixtures/problem-seeds.json). Each is a seed and a preset whose version-2 track had the problem;
// generator version 3 must make a good track from the same seed (tests/unit/problemSeeds.test.mjs), and
// version 2 still makes the original (old codes keep their tracks). This finds the worst of version 2 by
// the quality score, each preset's, and adds them to the list (the hand-written ones are kept).
//
//   node tools/problem-seeds.mjs [--scan 300] [--per 2]   → tests/fixtures/problem-seeds.json

import fs from 'node:fs';
import { generateTrack } from '../track/generate.js';
import { dressTrack } from '../track/dress.js';
import { qualityOf } from '../track/quality.js';

const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? +args[i + 1] : d; };
const cfg = JSON.parse(fs.readFileSync(new URL('../data/tracks.json', import.meta.url), 'utf8'));
const file = new URL('../tests/fixtures/problem-seeds.json', import.meta.url);
const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { seeds: [] };
const kept = old.seeds.filter(s => s.source !== 'scan');
const out = [...kept];
for (const P of cfg.presets) {
  const found = [];
  for (let k = 0; k < opt('--scan', 300); k++) {
    const seed = 104729 * k + 31, g = generateTrack({ seed, params: P.params, version: 2 });
    if (!g.ok) continue;
    const q = qualityOf(g, dressTrack(g, cfg), cfg);
    found.push({ seed, code: g.code, hash: g.hash, gate: q.gate, notes: q.notes, parts: q.parts });
  }
  found.sort((a, b) => a.gate - b.gate);
  for (const f of found.slice(0, opt('--per', 2))) out.push({ id: `${P.id}-${f.seed}`, source: 'scan', preset: P.id, seed: f.seed, version: 2, code: f.code, hash: f.hash,
    wrong: f.notes.length ? f.notes : [`a quality score of ${f.gate}`], gate: f.gate, parts: f.parts });
}
fs.writeFileSync(file, JSON.stringify({ _note: old._note ?? 'Seeds that were bad or felt wrong (Phase 5 Step 4), with what was wrong: each a preset and seed whose version-2 track had the problem (its code and hash: version 2 still makes it). Generator version 3 makes a good track from the same seed and preset (tests/unit/problemSeeds.test.mjs). source: scan — found by tools/problem-seeds.mjs, the worst of 300 version-2 seeds by the quality score; noted — found driving or testing (Steps 1-3), with what was seen.', seeds: out }, null, 1) + '\n');
console.log(`${out.length} problem seeds (${kept.length} noted, ${out.length - kept.length} from the scan)`);
for (const s of out) console.log(`  ${s.id.padEnd(28)} ${s.code} gate ${s.gate ?? '—'}: ${s.wrong.join('; ')}`);
