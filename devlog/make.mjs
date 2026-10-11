// The devlog video in one go (DEVLOG.md): the script (drafted from git if there isn't one for today), the gameplay
// filmed, the video rendered.
//
//   node make.mjs [--target local|live] [--multiplayer] [--music path/to/music.mp3] [--script file | --script-text "…"]
//                 [--reuse-clips] [--quick]
//
//   --reuse-clips   don't film again: the clips already in out/clips (after editing the script, a re-render takes minutes)
//   everything else goes to capture/capture.mjs and render.mjs (see each)
// Out: out/devlog-<date>.mp4, out/script.txt (the script used), out/post.txt (the post's caption and hashtags).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { today } from './script/draft.mjs';

const DEVLOG = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(DEVLOG, 'out');
const args = process.argv.slice(2), flag = n => args.includes(n), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const pass = names => names.flatMap(n => { const i = args.indexOf(n); return i < 0 ? [] : args[i + 1] && !args[i + 1].startsWith('--') ? [n, args[i + 1]] : [n]; });
const node = (file, a) => { const r = spawnSync(process.execPath, [path.join(DEVLOG, file), ...a], { stdio: 'inherit', cwd: DEVLOG }); if (r.status !== 0) process.exit(r.status ?? 1); };
fs.mkdirSync(OUT, { recursive: true });
const date = opt('--today', today());

// 1. the script: one given, today's (drafted earlier and perhaps edited), or a new draft (an older week's kept aside)
const scriptFile = path.join(OUT, 'script.txt');
if (!opt('--script', null) && !opt('--script-text', null)) {
  const old = fs.existsSync(scriptFile) ? fs.readFileSync(scriptFile, 'utf8') : null;
  const when = old?.match(/^# Devlog script for (\d{4}-\d{2}-\d{2})/)?.[1];
  if (old && when !== date) fs.renameSync(scriptFile, path.join(OUT, `script-${when ?? 'old'}.txt`));
  if (!old || when !== date) { console.log('== The script: a draft from git'); node('script/draft.mjs', ['--out', scriptFile, '--today', date]); }
  else console.log(`== The script: today's (${path.relative(process.cwd(), scriptFile)})`);
}
// 2. the gameplay
const clips = path.join(OUT, 'clips/clips.json');
if (flag('--reuse-clips') && fs.existsSync(clips)) console.log('== The gameplay: the clips already filmed (out/clips)');
else { console.log('== The gameplay: filming (frame by frame — several minutes)'); node('capture/capture.mjs', pass(['--target', '--multiplayer', '--quick', '--shots', '--fps', '--max-seconds', '--game', '--api'])); }
// 3. the video
console.log('== The video');
node('render.mjs', [...pass(['--script', '--script-text', '--music', '--music-volume', '--quick', '--out']), '--today', date]);
