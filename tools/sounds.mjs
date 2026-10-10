// npm run sounds — makes every engine's sound files from its sound config (data/sounds/engines/*.json:
// the synth settings; tools/content/sound.mjs), and the crash sounds (data/sounds/crash.json), and
// writes them where the configs say. A config with no synth (real recordings) is left alone.
// --only rs17 (or crash): just that one. Then every WAV under assets/sounds compressed as Opus for players, where
// it's changed (tools/content/opus.mjs: needs ffmpeg with libopus; --opus does them all again, --no-opus none).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crashSounds, engineSounds, writeSounds } from './content/sound.mjs';
import { hasFfmpeg, opusPass } from './content/opus.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dir = path.join(root, 'data/sounds/engines');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const enginesUsing = sound => fs.readdirSync(path.join(root, 'data/parts'), { recursive: true }).map(String).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(root, 'data/parts', f), 'utf8'))).filter(p => p.engine?.sound === sound).map(p => p.engine);
const partFile = id => { for (const f of fs.readdirSync(path.join(root, 'data/parts'), { recursive: true }).map(String)) if (f.endsWith(`${id}.json`)) return path.join(root, 'data/parts', f); return null; };
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const name = f.replace(/\.json$/, '');
  if (only && name !== only) continue;
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!cfg.synth) { console.log(`${name}: recordings (no synth settings), left as they are`); continue; }
  const pf = partFile(cfg.engine), E = pf && JSON.parse(fs.readFileSync(pf, 'utf8')).engine;
  if (!E) { console.error(`${name}: its engine part "${cfg.engine}" isn't there`); process.exitCode = 1; continue; }
  // (every engine with this sound: the sweep reaches below the lowest idle and past the highest redline)
  const users = enginesUsing(`data/sounds/engines/${f}`), range = { idleRpm: Math.min(E.idleRpm, ...users.map(u => u.idleRpm)), redlineRpm: Math.max(E.redlineRpm, ...users.map(u => u.redlineRpm)) };
  const t0 = performance.now(), list = engineSounds(cfg, E, range);
  writeSounds(root, list);
  const bytes = list.reduce((a, x) => a + (x.samples ? 44 + x.samples.length * 2 : 0), 0);
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

// ---------- compressed for players ----------
if (!process.argv.includes('--no-opus')) {
  if (!hasFfmpeg()) { console.error('Opus: ffmpeg with libopus isn\'t here — the .opus files weren\'t made (the data check will say which are out of date)'); process.exitCode = 1; }
  else {
    // (which WAVs are loops: the engines' layers and intake, the scrape, rattle and flap loops)
    const loops = new Set();
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) { const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); for (const L of c.layers) { loops.add(L.on); loops.add(L.off); } loops.add(c.intake.file); }
    const crash = JSON.parse(fs.readFileSync(path.join(root, 'data/sounds/crash.json'), 'utf8'));
    for (const f of [...Object.values(crash.scrape.files), crash.rattle?.file, crash.flap?.file]) if (f) loops.add(f);
    const t0 = performance.now(), r = opusPass(root, { loops, force: process.argv.includes('--opus') });
    console.log(`opus: ${r.made} made, ${r.kept} as they were — ${r.count} files, ${(r.bytes / 1048576).toFixed(1)} MB (the WAVs: ${(r.wavBytes / 1048576).toFixed(1)} MB), in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${'assets/sounds/manifest.json'}`);
  }
}
