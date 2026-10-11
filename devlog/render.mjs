// The devlog video rendered (DEVLOG.md): the script and the captured clips through the Remotion template
// (remotion/Devlog.jsx) into a 1080×1920 MP4, plus the post's caption with hashtags.
//
//   node render.mjs [--script out/script.txt] [--clips out/clips] [--music path/to/music.mp3] [--out out/devlog-<date>.mp4]
//                   [--quick]
//
//   --script   the script (HOOK:, a caption a line, END:). Missing: drafted from git first (script/draft.mjs).
//              Or the text itself with --script-text "Hook | caption | caption".
//   --music    background music (mp3, m4a, wav, ogg) — your own, or royalty free with the right to use it; none is bundled
//   --quick    a fast, lower-quality render (to check the timing)
// Writes the MP4, the script used (script.txt) and the post's caption (post.txt) next to it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript, plan, LIMITS } from './remotion/timeline.js';
import { draft, commitsSince, lastDevlog, scriptText, postCaption, today } from './script/draft.mjs';

const DEVLOG = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, flag = n => args.includes(n);
const OUTDIR = path.join(DEVLOG, 'out');                 // (Remotion's public folder: the clips and the music are served from here)
const date = opt('--today', today());
const outFile = path.resolve(opt('--out', path.join(OUTDIR, `devlog-${date}.mp4`)));
const clipsDir = path.resolve(opt('--clips', path.join(OUTDIR, 'clips')));
fs.mkdirSync(OUTDIR, { recursive: true });

// ---------- the script ----------
let text = opt('--script-text', null), scriptFile = path.resolve(opt('--script', path.join(OUTDIR, 'script.txt')));
let topics = [];
if (text == null) {
  if (!fs.existsSync(scriptFile)) {
    const since = lastDevlog(date), d = draft({ commits: commitsSince(since), since, date });
    fs.writeFileSync(scriptFile, scriptText(d, date));
    topics = d.topics;
    console.log(`No script yet: drafted one from git (${path.relative(process.cwd(), scriptFile)})`);
  }
  text = fs.readFileSync(scriptFile, 'utf8');
}
const script = parseScript(text);
if (!script.hook) { console.error('The script has no hook (HOOK: …) and no captions: nothing to say'); process.exit(2); }

// ---------- the clips ----------
const listed = fs.existsSync(path.join(clipsDir, 'clips.json')) ? JSON.parse(fs.readFileSync(path.join(clipsDir, 'clips.json'), 'utf8')).clips : [];
const clips = listed.map(c => ({ ...c, abs: path.resolve(DEVLOG, c.file) })).filter(c => fs.existsSync(c.abs))
  // (served from out/: a clip elsewhere is copied in)
  .map(c => {
    let rel = path.relative(OUTDIR, c.abs);
    if (rel.startsWith('..')) { rel = path.join('clips-in', path.basename(c.abs)); fs.mkdirSync(path.join(OUTDIR, 'clips-in'), { recursive: true }); fs.copyFileSync(c.abs, path.join(OUTDIR, rel)); }
    return { src: rel.split(path.sep).join('/'), seconds: c.seconds, name: c.name };
  });
if (!clips.length) console.warn(`No clips in ${path.relative(process.cwd(), clipsDir)} (npm run capture makes them): the video will be captions on a plain background`);

// ---------- the music ----------
let music = null;
const musicFile = opt('--music', process.env.DEVLOG_MUSIC || null);
if (musicFile) {
  if (!fs.existsSync(musicFile)) { console.error(`No music file at ${musicFile}`); process.exit(2); }
  const ext = path.extname(musicFile).toLowerCase();
  if (!['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'].includes(ext)) { console.error('Music: an mp3, m4a, aac, wav, ogg or opus file'); process.exit(2); }
  music = `music${ext}`;
  fs.copyFileSync(musicFile, path.join(OUTDIR, music));
}

const props = { script, clips: clips.map(({ src, seconds }) => ({ src, seconds })), music, musicVolume: +opt('--music-volume', 0.35) };
const P = plan({ script, clips: props.clips, fps: 30 });
for (const w of P.warnings) console.warn(`  note: ${w}`);
console.log(`Rendering ${(P.frames / 30).toFixed(1)} s (${LIMITS.min}–${LIMITS.max} s): the hook, ${P.captions.length} caption${P.captions.length === 1 ? '' : 's'}, the end card; ${P.cuts.length} cuts from ${clips.length} clip${clips.length === 1 ? '' : 's'}${music ? ', with music' : ''}`);

// ---------- Remotion ----------
const { bundle } = await import('@remotion/bundler');
const { renderMedia, selectComposition } = await import('@remotion/renderer');
const serveUrl = await bundle({ entryPoint: path.join(DEVLOG, 'remotion/index.jsx'), publicDir: OUTDIR, onProgress: () => {} });
// (a Chrome of our own if one's given — CHROMIUM / REMOTION_BROWSER — else Remotion fetches its headless shell once)
const browserExecutable = process.env.REMOTION_BROWSER || null;
const composition = await selectComposition({ serveUrl, id: 'Devlog', inputProps: props, browserExecutable });
let last = -1;
await renderMedia({
  composition, serveUrl, codec: 'h264', outputLocation: outFile, inputProps: props, browserExecutable,
  crf: flag('--quick') ? 30 : 18, scale: flag('--quick') ? 0.5 : 1, x264Preset: flag('--quick') ? 'veryfast' : 'medium',
  audioBitrate: '192k', pixelFormat: 'yuv420p', enforceAudioTrack: true,
  onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; console.log(`  ${p * 10}%`); } },
});
fs.writeFileSync(path.join(path.dirname(outFile), 'script.txt'), text.endsWith('\n') ? text : `${text}\n`);
fs.writeFileSync(path.join(path.dirname(outFile), 'post.txt'), postCaption(script, topics));
console.log(`\nDone: ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB)`);
console.log(`The post's caption: ${path.relative(process.cwd(), path.join(path.dirname(outFile), 'post.txt'))}\n`);
console.log(fs.readFileSync(path.join(path.dirname(outFile), 'post.txt'), 'utf8'));
