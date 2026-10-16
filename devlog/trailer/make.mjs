// The game's trailer (docs/RELEASE.md "Trailer"), made from the game itself: filmed frame by frame by the devlog's
// capture (capture/capture.mjs: real cities driven along real roads by the game's autopilot, the race tracks, a second
// car online), the game's own music rendered to the trailer's plan (audio/music.js in a browser's OfflineAudioContext:
// no samples, nobody else's music), and cut together by remotion/Trailer.jsx. 1920×1080, about 50 seconds.
//
//   cd devlog && node trailer/make.mjs [--reuse-clips] [--quick] [--out ../assets/press/ognistrada-trailer.mp4]
//
//   --reuse-clips   the clips filmed last time (out/trailer/clips) — new music or edit without filming again (filming
//                   takes about an hour on a computer without a graphics card)
//   --quick         a short, small test of the whole thing
// Needs: npm ci at the repository's root and in devlog/ (Playwright, Remotion), ffmpeg (Remotion brings one).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trailerPlan } from '../remotion/trailerPlan.js';
import { copyFonts } from '../lib/fonts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), DEVLOG = path.resolve(HERE, '..'), ROOT = path.resolve(DEVLOG, '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, flag = n => args.includes(n);
const QUICK = flag('--quick'), OUT = path.join(DEVLOG, 'out'), DIR = path.join(OUT, 'trailer'), CLIPS = path.join(DIR, 'clips');
const outFile = path.resolve(opt('--out', QUICK ? path.join(DIR, 'trailer-quick.mp4') : path.join(ROOT, 'assets/press/ognistrada-trailer.mp4')));
const log = s => console.log(`[${(performance.now() / 1000).toFixed(0).padStart(5)}s] ${s}`);
fs.mkdirSync(CLIPS, { recursive: true });

// ---------- 1. filming ----------
if (!flag('--reuse-clips')) {
  log('filming (capture/capture.mjs)…');
  const r = spawnSync(process.execPath, [path.join(DEVLOG, 'capture/capture.mjs'), '--shots', path.join(HERE, 'shots.json'), '--size', '960x540', '--multiplayer', '--out', CLIPS, ...(QUICK ? ['--quick', '--max-seconds', '1'] : [])], { cwd: DEVLOG, stdio: 'inherit' });
  if (r.status !== 0 && !fs.existsSync(path.join(CLIPS, 'clips.json'))) { console.error('Filming failed.'); process.exit(1); }
}
// (in the trailer's order: shots.json "order" — they're filmed run by run, the second car's shots last)
const ORDER = JSON.parse(fs.readFileSync(path.join(HERE, 'shots.json'), 'utf8')).order ?? [];
const rank = n => { const i = ORDER.indexOf(n); return i < 0 ? ORDER.length : i; };
const listed = JSON.parse(fs.readFileSync(path.join(CLIPS, 'clips.json'), 'utf8')).clips.filter(c => !ORDER.length || ORDER.includes(c.name)).sort((a, b) => rank(a.name) - rank(b.name));
const clips = listed.filter(c => fs.existsSync(path.resolve(DEVLOG, c.file)))
  .map(c => ({ src: path.relative(OUT, path.resolve(DEVLOG, c.file)).split(path.sep).join('/'), seconds: c.seconds, name: c.name, sound: !!c.sound, label: c.label ?? null }));
const P = trailerPlan({ clips, fps: 30 });
log(`${clips.length} clips: ${P.seconds.toFixed(1)} s in all`);

// ---------- 2. the music: the game's own, to the trailer's plan ----------
log('the music (audio/music.js, rendered offline)…');
const PORT = 7791;
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, HOST: '127.0.0.1' } });
try {
  for (let k = 0; k < 50; k++) { if (await fetch(`http://localhost:${PORT}/index.html`).then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 200)); }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/site/ping.html`).catch(() => page.goto(`http://localhost:${PORT}/`));
  // (the intensity, sampled every quarter second: the page can't call back into this script)
  const curve = Array.from({ length: Math.ceil(P.seconds * 4) + 4 }, (_, i) => +P.intensityAt(i / 4).toFixed(3));
  const b64 = await page.evaluate(async ({ seconds, curve }) => {
    const { createMusic } = await import('/audio/music.js');
    const rate = 48000, ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
    const M = createMusic({ ctx, bus: { music: ctx.destination } }, { settings: {} });
    M.play('race');
    M.scheduleTo(seconds, t => curve[Math.min(curve.length - 1, Math.round(t * 4))]);
    const buf = await ctx.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1);
    // (16-bit stereo, peak-normalised a little under full scale)
    let peak = 1e-6; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const k = 0.89 / peak, pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { pcm[i * 2] = Math.round(Math.max(-1, Math.min(1, L[i] * k)) * 32767); pcm[i * 2 + 1] = Math.round(Math.max(-1, Math.min(1, R[i] * k)) * 32767); }
    const bytes = new Uint8Array(pcm.buffer); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, { seconds: P.seconds + 1, curve });
  await browser.close();
  const pcm = Buffer.from(b64, 'base64'), h = Buffer.alloc(44), rate = 48000;
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(DIR, 'music.wav'), Buffer.concat([h, pcm]));
  log(`  out/trailer/music.wav: ${(pcm.length / 4 / rate).toFixed(1)} s`);
} finally { server.kill(); }

// ---------- 3. the edit ----------
copyFonts(OUT);
fs.copyFileSync(path.join(ROOT, 'press/logo.png'), path.join(DIR, 'logo.png'));
const props = { clips, music: 'trailer/music.wav' };
log(`the edit (remotion/Trailer.jsx): ${P.cuts.length} cuts, ${P.captions.length} captions…`);
const { bundle } = await import('@remotion/bundler');
const { renderMedia, selectComposition } = await import('@remotion/renderer');
const serveUrl = await bundle({ entryPoint: path.join(DEVLOG, 'remotion/index.jsx'), publicDir: OUT, onProgress: () => {} });
const browserExecutable = process.env.REMOTION_BROWSER || null;
const composition = await selectComposition({ serveUrl, id: 'Trailer', inputProps: props, browserExecutable });
fs.mkdirSync(path.dirname(outFile), { recursive: true });
let last = -1;
await renderMedia({
  composition, serveUrl, codec: 'h264', outputLocation: outFile, inputProps: props, browserExecutable,
  crf: QUICK ? 30 : 21, scale: QUICK ? 0.5 : 1, x264Preset: QUICK ? 'veryfast' : 'slow', audioBitrate: '192k', pixelFormat: 'yuv420p', enforceAudioTrack: true,
  onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; log(`  ${p * 10}%`); } },
});
log(`Done: ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB)`);
