// The sound in a real browser (Phase 8 Step 1; docs/AUDIO.md) — npm run test:audio-browser: Chromium renders the game's
// whole audio graph (the AudioWorklet's voices, the native nodes, the echoes, compressor and limiter) offline
// (tests/audio/offline.html), and opens the audio test page (dev/audio.html):
//
//   an 8-car race with crashes: nothing past the limiter's ceiling; the time it takes once it's going against its CPU
//   budget (high, and low × the low-end factor; data/audio.json budget)
//   every sound's Opus decoded in Chromium against its WAV: the same length, matching, not shifted (a sweep's grains
//   stay where they are), a loop's join as smooth as anywhere in it
//   another car's voice going full → simple → off → full as it plays: no clicks
//   the audio test page: starts, sweeps, no errors
//
//   node tools/audio-browser.mjs        (needs playwright-core and a Chromium: CHROMIUM=/path, or Playwright's own)

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pw;
try { pw = await import('playwright-core'); } catch { try { pw = await import('playwright'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); } }
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(port)], { env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/data/audio.json`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`); if (!ok) failed++; };
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));   // (no fonts from outside here)
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/client-config|favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/tests/audio/offline.html`);
  await page.waitForFunction(() => window.__audioTest?.ready, null, { timeout: 60000 });

  console.log('An 8-car race with crashes, rendered through the whole graph');
  for (const quality of ['high', 'low']) {
    // What it costs once it's going: a fresh render's audio thread starts with its code not yet compiled for speed
    // (a game pays that once, as it starts) — so the race is rendered for 8 s and for 24 s and the 16 s between them
    // is what's measured (the crashes come every 8 s, so they're in it). Each three times, the quickest kept: what else the
    // machine's doing only ever adds.
    const run = async seconds => {
      const rs = [];
      for (let k = 0; k < 3; k++) rs.push(await page.evaluate(o => window.__audioTest.race(o), { seconds, quality }));
      return { ...rs.reduce((a, b) => b.workMs < a.workMs ? b : a), peak: Math.max(...rs.map(x => x.peak)) };
    };
    const r = await run(8), long = await run(24), share = Math.max(0, long.workMs - r.workMs) / 16000;
    check(r.worklet, `${quality}: the worklet's there`);
    check(Math.max(r.peak, long.peak) <= r.ceiling + 1e-4, `${quality}: the loudest ${(20 * Math.log10(Math.max(r.peak, long.peak))).toFixed(2)} dBFS against the ceiling ${(20 * Math.log10(r.ceiling)).toFixed(2)} dBFS`);
    check(r.rms > 0.01, `${quality}: heard — ${(20 * Math.log10(r.rms)).toFixed(1)} dBFS RMS`);
    const k = quality === 'low' ? r.budget.lowEndFactor : 1, budget = quality === 'low' ? r.budget.lowEndShare : r.budget.audioShare;
    check(share * k <= budget, `${quality}: ${(share * 100).toFixed(1)}% of real time once going${quality === 'low' ? ` — ${(share * k * 100).toFixed(1)}% on a device ${k}× slower` : ''} (budget ${(budget * 100).toFixed(0)}%; the first 8 s, warming up: ${(r.share * 100).toFixed(1)}%)`);
  }

  console.log('Every sound\'s Opus, decoded in Chromium, against its WAV');
  const op = await page.evaluate(() => window.__audioTest.opus());
  // (the loops and sweeps the engines play: their grains and joins must stay to the sample; one-shots (a crash, a shift)
  // only to a few — a tenth of a millisecond is nothing to a bang)
  const engine = op.filter(o => /engines\//.test(o.wav) && /rpm|sweep/.test(o.wav)), shots = op.filter(o => !engine.includes(o));
  check(op.every(o => Math.abs(o.length - o.want) <= 2), `${op.length} files, each the same length (${op.filter(o => Math.abs(o.length - o.want) > 2).slice(0, 3).map(o => `${o.wav}: ${o.length} against ${o.want}`).join('; ') || 'all within 2 samples'})`);
  check(engine.every(o => Math.abs(o.lag) <= 1), `the engines' ${engine.length} loops and sweeps not shifted (their grains stay put): the most ${Math.max(...engine.map(o => Math.abs(o.lag)))} sample`);
  check(shots.every(o => Math.abs(o.lag) <= 5), `the ${shots.length} other sounds shifted by no more than 5 samples (0.16 ms): the most ${Math.max(...shots.map(o => Math.abs(o.lag)))}`);
  check(engine.every(o => o.corr > 0.9), `the engines' loops and sweeps match their WAVs: the least ${Math.min(...engine.map(o => o.corr)).toFixed(3)}`);
  const loops = op.filter(o => o.join != null);
  check(loops.every(o => o.join <= 1.2), `${loops.length} loops join as smoothly as anywhere in them (the worst join ${Math.max(...loops.map(o => o.join)).toFixed(2)} × their biggest step)`);

  console.log('Another car\'s voice going full → simple → off → full as it plays');
  {
    // the car far off: the air's taken everything above ~10 kHz, so what's left above 18 kHz (two 2nd-order high-passes)
    // is a click's — round each change and as what's faded is let go, against anywhere else it plays (and checked
    // that a step of 2% of its level would show)
    const { x, changes, gone } = await page.evaluate(() => window.__audioTest.lod()), sr = 48000;
    const hp = (inp, f) => { const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * 0.7071), a0 = 1 + al, b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0; const y = new Float64Array(inp.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < inp.length; i++) { const v = b0 * inp[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = inp[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
    const level = (a, b) => { let s2 = 0; for (let i = Math.round(a * sr); i < b * sr; i++) s2 += x[i] * x[i]; return Math.sqrt(s2 / ((b - a) * sr)); };
    const events = [...changes, ...gone], near = t => events.some(e => t > e - 0.05 && t < e + 0.45);
    const worst = y => { let n = 0, a = 0; for (let i = Math.round(0.2 * sr); i < y.length; i++) { const v = Math.abs(y[i]); if (near(i / sr)) n = Math.max(n, v); else a = Math.max(a, v); } return { n, a }; };
    const top = s => hp(hp(s, 18000), 18000), { n, a } = worst(top(x)), lvl = level(0.3, 0.9);
    const stepped = Float64Array.from(x); for (let i = Math.round(2.0 * sr); i < stepped.length; i++) stepped[i] += 0.02 * lvl;
    const seen = worst(top(stepped)).n;
    check(n <= a * 2 + lvl * 1e-3, `no clicks: above 18 kHz round the changes ${(n / lvl * 100).toFixed(3)}% of its level, anywhere else ${(a / lvl * 100).toFixed(3)}% (a step of 2% would show as ${(seen / lvl * 100).toFixed(2)}%)`);
    check(seen > n * 3, 'and a click would show');
    check(lvl > 1e-4 && level(1.3, 1.9) > lvl * 0.3 && level(2.5, 2.9) < level(1.3, 1.9) * 0.05 && level(3.4, 4.4) > lvl * 0.5, `heard as it should be: full ${lvl.toFixed(5)}, simple ${level(1.3, 1.9).toFixed(5)}, off ${level(2.5, 2.9).toFixed(6)}, full again ${level(3.4, 4.4).toFixed(5)} RMS`);
  }

  console.log('The audio test page (dev/audio.html)');
  await page.goto(`${base}/dev/audio.html`);
  await page.waitForFunction(() => window.__audioPage, null, { timeout: 30000 });
  await page.click('#go');
  await page.waitForFunction(() => window.__audioPage?.voice?.sound?.modes?.size, null, { timeout: 30000 });
  await page.click('#start'); await page.waitForTimeout(1500);
  await page.click('#sweep'); await page.waitForTimeout(3000);
  for (const v of ['cockpit', 'chase']) await page.click(`[data-view="${v}"]`);
  await page.click('[data-mode="layers"]'); await page.waitForTimeout(800); await page.click('[data-mode="granular"]');
  await page.click('[data-crash="crash:car"]'); await page.waitForTimeout(500);
  const info = await page.textContent('#info'), ov = await page.textContent('#audioOverlay');
  check(/granular|layers/.test(info) && /worklet/.test(ov), 'it plays: the engine, both ways, the cameras, a crash');
  check(!errors.length, `no errors on the pages${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exitCode = failed ? 1 : 0;
