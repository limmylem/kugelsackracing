// The browsers (Phase 8 Step 2; docs/PERFORMANCE.md's browser table): the game in each — Chromium, Chrome, Edge,
// Firefox, WebKit (Safari's engine; on macOS, as Safari has it) — what it supports (perf/features.js: what the game needs
// and the extras it uses, with their fallbacks), the test centre loaded and driven for a few seconds on the low preset
// and on the high one (frames drawn, the car moving, no errors on the page), the graphics settings switched while
// driving, and an old browser (a needed feature taken away) told what to use instead of a page that never starts.
//
//   node tools/browsers.mjs [--browsers chromium,firefox,webkit] [--channels chrome,msedge] [--tag linux] [--seconds 6]
//   (Playwright with those browsers installed: npx playwright install firefox webkit; .github/workflows/browsers.yml)
//   → reports/browsers/<tag>.json, and a table; exits 1 if one can't run the game

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname, args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const names = opt('--browsers', 'chromium').split(',').filter(Boolean), channels = opt('--channels', '').split(',').filter(Boolean);
const tag = opt('--tag', process.platform), seconds = +opt('--seconds', 6);
let pw;
try { pw = await import('playwright'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
pw = pw.chromium ? pw : pw.default;

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(port)], { env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/data/performance.json`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
const nm = path.join(ROOT, 'node_modules');
const results = [];

// each browser (and each Chromium channel: Chrome, Edge — the ones installed on this machine)
const runs = [...names.map(n => ({ name: n, type: n })), ...channels.map(c => ({ name: c, type: 'chromium', channel: c }))];
for (const run of runs) {
  const R = { browser: run.name, version: null, features: null, runs: {}, oldBrowser: null, switching: null, errors: [], ok: false };
  results.push(R);
  let browser;
  try {
    browser = await pw[run.type].launch({ ...(run.channel && { channel: run.channel }), ...(run.type === 'chromium' && !run.channel && process.env.CHROMIUM && { executablePath: process.env.CHROMIUM }), args: run.type === 'chromium' ? ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] : [] });
    R.version = browser.version();
    const page = async () => {
      const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
      await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
      await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const p = await ctx.newPage(), errors = [];
      p.on('pageerror', e => errors.push(String(e.message ?? e).slice(0, 200)));
      return { ctx, p, errors };
    };
    // what it supports
    {
      const { ctx, p } = await page();
      await p.goto(`${base}/dev/world.html?world=none`).catch(() => {});
      await p.goto(`${base}/data/performance.json`);
      R.features = await p.evaluate(async () => (await import('/perf/features.js')).features());
      await ctx.close();
    }
    // the test centre, driven, at low and at high
    for (const preset of ['low', 'high']) {
      const { ctx, p, errors } = await page(), t0 = Date.now();
      await p.goto(`${base}/dev/world.html?world=test_centre&graphics=${preset}`);
      const ready = await p.waitForFunction(() => { const w = window.testWorld?.active; return !!(w && w.sim && !w.spawning); }, null, { timeout: 180000 }).then(() => true, () => false);
      const loadS = (Date.now() - t0) / 1000;
      if (!ready) { R.runs[preset] = { ok: false, why: 'never drivable', errors: errors.slice(0, 3) }; await ctx.close(); continue; }
      await p.click('canvas', { position: { x: 400, y: 300 }, force: true }).catch(() => {});
      const c0 = await p.evaluate(() => window.testWorld.shared.prof.count);
      await p.keyboard.down('ArrowUp'); await p.waitForTimeout(seconds * 1000); await p.keyboard.up('ArrowUp');
      const s = await p.evaluate(c => { const S = window.testWorld.shared, st = S.prof.stats(); return { frames: S.prof.count - c, fps: st?.fps ?? 0, speed: window.testWorld.active.sim.vehicle.forwardSpeed(), preset: S.G.preset, post: S.gfx.stats.post }; }, c0);
      const ok = s.frames > 5 && s.speed > 1 && !errors.length && s.preset === preset;
      R.runs[preset] = { ok, loadS, ...s, errors: errors.slice(0, 3) };
      // (on the low one, in Chromium: the settings' "Run the benchmarks" — the pile-up and downtown, then back)
      if (preset === 'low' && ok && run.type === 'chromium' && !run.channel) {
        const B = await p.evaluate(() => window.testWorld.runOwnBenchmarks()).catch(e => ({ error: e.message }));
        R.ownBench = { ok: !B.error && B.scenes?.length === 2 && B.scenes.every(x => x.fps > 0) && !errors.length, scenes: B.scenes?.map(x => `${x.name}: ${x.fps.toFixed(1)} fps`), error: B.error ?? errors[0] ?? null, back: await p.evaluate(() => window.testWorld.active?.file) };
      }
      // (on the high one: every setting changed while driving — the settings panel's own way — and still drawing, no errors)
      if (preset === 'high' && ok) {
        R.switching = await p.evaluate(async () => {
          const S = window.testWorld.shared, { withPreset, withSetting } = await import('/perf/quality.js'), Q = S.perfCfg.quality, out = [];
          // (each kept until it has drawn a few frames — the heaviest, in software, take a while)
          const settle = async c => { for (let t = 0; t < 150 && S.prof.count - c < 4; t++) await new Promise(r => setTimeout(r, 100)); return S.prof.count - c; };
          for (const name of ['low', 'ultra', 'medium']) { const c = S.prof.count; S.prefs.graphics = withPreset(S.prefs.graphics, Q, name); window.testWorld.applyGraphics?.(); out.push({ to: name, frames: await settle(c), preset: S.G.preset }); }
          let g = S.prefs.graphics;
          for (const [k, v] of [['shadows', 'off'], ['antialias', 'fxaa'], ['bloom', true], ['motionBlur', true], ['reflections', 'live'], ['renderDistance', 600], ['scenery', 0.3], ['fpsCap', 30], ['dynamicResolution', true]]) g = withSetting(g, Q, k, v);
          const c = S.prof.count; S.prefs.graphics = g; window.testWorld.applyGraphics?.();
          out.push({ to: 'custom', frames: await settle(c), preset: S.G.preset });
          return out;
        });
        R.switching = { steps: R.switching, ok: R.switching.every(x => x.frames >= 4 && x.preset === x.to) && !errors.length, errors: errors.slice(0, 3) };
      }
      await ctx.close();
    }
    // the first launch's test (?autodetect: as a player's first visit, under automation): a preset picked and saved
    {
      const { ctx, p, errors } = await page();
      await p.goto(`${base}/dev/world.html?world=test_centre&autodetect`);
      R.autodetect = await p.waitForFunction(() => window.testWorld?.shared?.graphicsDetected, null, { timeout: 120000 }).then(h => h.jsonValue(), () => null);
      R.autodetect = R.autodetect ? { ok: !errors.length && ['low', 'medium', 'high', 'ultra'].includes(R.autodetect.preset), preset: R.autodetect.preset, why: R.autodetect.why, gpu: R.autodetect.gpu } : { ok: false, why: 'nothing picked in 2 minutes' };
      await ctx.close();
    }
    // an old browser: one needed thing taken away before the page loads — the message, not a page that never starts
    {
      const { ctx, p } = await page();
      await ctx.addInitScript(() => { delete globalThis.DecompressionStream; });
      await p.goto(`${base}/index.html`);
      R.oldBrowser = await p.waitForSelector('#tooOld', { timeout: 15000 }).then(async el => ({ ok: true, text: (await el.textContent()).slice(0, 120) }), () => ({ ok: false }));
      await ctx.close();
    }
    R.ok = Object.values(R.features.needed).every(Boolean) && Object.values(R.runs).every(r => r.ok) && R.oldBrowser.ok && (R.switching?.ok ?? false) && !!R.autodetect?.ok && (R.ownBench?.ok ?? true);
  } catch (e) { R.errors.push(String(e.message ?? e).slice(0, 300)); }
  finally { await browser?.close(); }
}
server.kill();

// the table
const row = r => `${r.ok ? '  ok  ' : ' FAIL '} ${r.browser.padEnd(9)} ${String(r.version ?? '?').padEnd(16)} ${r.features ? `needs: ${Object.entries(r.features.needed).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all there'} · extras: ${Object.entries(r.features.extras).map(([k, v]) => `${k} ${v ? 'yes' : 'no'}`).join(', ')}` : ''}
         ${Object.entries(r.runs).map(([k, v]) => `${k}: ${v.ok ? `${v.frames} frames (${v.fps?.toFixed(1)} fps), ${v.speed?.toFixed(1)} m/s, loaded in ${v.loadS?.toFixed(1)} s` : `FAILED ${v.why ?? ''} ${(v.errors ?? []).join(' | ')}`}`).join(' · ')} · switching settings: ${r.switching ? (r.switching.ok ? 'ok' : `FAILED ${JSON.stringify(r.switching)}`) : '—'} ${r.ownBench ? ` · the settings' benchmarks: ${r.ownBench.ok ? r.ownBench.scenes.join(', ') : `FAILED ${r.ownBench.error}`}` : ''} · first launch picked: ${r.autodetect?.ok ? `${r.autodetect.preset} (${r.autodetect.why})` : `NO ${r.autodetect?.why ?? ''}`} · old browser told: ${r.oldBrowser?.ok ? 'yes' : 'NO'}${r.errors.length ? ` · ${r.errors.join(' | ')}` : ''}`;
for (const r of results) console.log(row(r));
const dir = path.join(ROOT, 'reports/browsers');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${tag}.json`), JSON.stringify({ at: new Date().toISOString(), tag, results }, null, 1));
process.exit(results.every(r => r.ok) ? 0 : 1);
