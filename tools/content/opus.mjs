// The game's sounds compressed for players (Phase 8 Step 1; docs/AUDIO.md): each WAV under assets/sounds as Opus
// (an .opus file beside it, Ogg, ~56 kbit/s — a fifth of the size or less), and assets/sounds/manifest.json saying
// which, made from which WAV (its hash: a WAV changed since is re-encoded, and the data check finds one that wasn't).
// The game fetches the .opus where the browser decodes it and the WAV where it doesn't (audio/system.js).
//
// A loop (an engine's on/off loops, the scrape and rattle loops…) is encoded with `pad` seconds of itself on each
// side — its end before its start, its start after its end — so the codec's smearing at a file's edges lands outside
// the loop: the game plays from pad to pad + seconds, and the join is as clean as the WAV's.
//
//   encodeOpus(samples, sr, { pad, bitrate }) → Buffer          (needs ffmpeg with libopus)
//   opusPass(root, { loops, force }) → { made, kept, bytes }   every WAV under assets/sounds; writes the manifest
//   hasFfmpeg()

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readWav } from './sound.mjs';

export const MANIFEST = 'assets/sounds/manifest.json', PAD = 0.05, BITRATE = '56k';

export function hasFfmpeg() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return r.status === 0 && /libopus/.test(r.stdout);
}

export function encodeOpus(samples, sr, { pad = 0, bitrate = BITRATE } = {}) {
  const P = Math.round(pad * sr), n = samples.length, pcm = Buffer.alloc((n + 2 * P) * 2);
  const at = i => samples[((i % n) + n) % n];
  for (let i = -P, k = 0; i < n + P; i++, k++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, at(i))) * 32767), k * 2);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(sr), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on', '-application', 'audio', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-f', 'ogg', 'pipe:1'], { input: pcm, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr?.toString().trim() || r.status}`);
  return r.stdout;
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

// loops: a Set of WAV paths that are loops (relative to root)
export function opusPass(root, { loops = new Set(), force = false } = {}) {
  const file = path.join(root, MANIFEST), was = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).files ?? {} : {};
  const files = {}, dir = path.join(root, 'assets/sounds');
  let made = 0, kept = 0, bytes = 0, wavBytes = 0;
  const wavs = fs.readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.wav')).map(f => `assets/sounds/${f.split(path.sep).join('/')}`).sort();
  for (const w of wavs) {
    const buf = fs.readFileSync(path.join(root, w)), h = sha(buf), opus = w.replace(/\.wav$/, '.opus'), loop = loops.has(w);
    const old = was[w];
    wavBytes += buf.length;
    if (!force && old && old.sha === h && !!old.pad === loop && fs.existsSync(path.join(root, opus))) { files[w] = old; kept++; bytes += old.bytes; continue; }
    const { samples, sr } = readWav(buf), out = encodeOpus(samples, sr, { pad: loop ? PAD : 0 });
    fs.writeFileSync(path.join(root, opus), out);
    files[w] = { opus, sha: h, seconds: Math.round(samples.length / sr * 1e6) / 1e6, ...(loop && { pad: PAD }), bytes: out.length };
    made++; bytes += out.length;
  }
  // (an .opus whose WAV is gone goes too)
  for (const f of fs.readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.opus'))) {
    const rel = `assets/sounds/${f.split(path.sep).join('/')}`;
    if (!files[rel.replace(/\.opus$/, '.wav')]) fs.rmSync(path.join(root, rel));
  }
  fs.writeFileSync(file, JSON.stringify({ _note: 'Every sound file compressed for players (tools/content/opus.mjs; npm run sounds makes it): each WAV\'s Opus, the WAV\'s hash (sha: a WAV changed since needs encoding again), its length (seconds) and for a loop the pad of itself each side (seconds). The game plays the Opus where the browser can decode it (audio/system.js), else the WAV.', codec: 'opus', bitrate: BITRATE, files }, null, 1) + '\n');
  return { made, kept, bytes, wavBytes, count: wavs.length };
}
