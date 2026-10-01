// npm run sounds — makes every engine's sound files from its sound config (data/sounds/engines/*.json:
// the synth settings; tools/content/sound.mjs), and the crash sounds (data/sounds/crash.json), and
// writes them where the configs say. A config with no synth (real recordings) is left alone.
// --only rs17 (or crash): just that one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crashSounds, engineSounds, writeSounds } from './content/sound.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dir = path.join(root, 'data/sounds/engines');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const partFile = id => { for (const f of fs.readdirSync(path.join(root, 'data/parts'), { recursive: true }).map(String)) if (f.endsWith(`${id}.json`)) return path.join(root, 'data/parts', f); return null; };
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const name = f.replace(/\.json$/, '');
  if (only && name !== only) continue;
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!cfg.synth) { console.log(`${name}: recordings (no synth settings), left as they are`); continue; }
  const pf = partFile(cfg.engine), E = pf && JSON.parse(fs.readFileSync(pf, 'utf8')).engine;
  if (!E) { console.error(`${name}: its engine part "${cfg.engine}" isn't there`); process.exitCode = 1; continue; }
  const t0 = performance.now(), list = engineSounds(cfg, E);
  writeSounds(root, list);
  const bytes = list.reduce((a, x) => a + 44 + x.samples.length * 2, 0);
  console.log(`${name}: ${list.length} files, ${(bytes / 1024).toFixed(0)} KB, in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${path.dirname(list[0].file)}/`);
}

{
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/sounds/crash.json'), 'utf8'));
  if ((!only || only === 'crash') && cfg.synth) {
    const t0 = performance.now(), list = crashSounds(cfg);
    writeSounds(root, list);
    console.log(`crash: ${list.length} files, ${(list.reduce((a, x) => a + 44 + x.samples.length * 2, 0) / 1024).toFixed(0)} KB, in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${path.dirname(list[0].file)}/`);
  }
}
