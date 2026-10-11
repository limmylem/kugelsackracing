// Driving feels the same on every graphics setting (Phase 8 Step 2; docs/PERFORMANCE.md): the Phase 1 physics tests
// (physics/testSuite.js — 0–100, braking, skidpad, slalom, a lap…) run in the game in a browser at each preset, their
// results and every step's telemetry compared bit for bit; the physics' rate checked the same; then the preset changed
// back and forth while the car drives, and the tests run again on the last one — still the same.
//
//   node tools/physics-presets.mjs [--tests zeroTo100,braking,skidpad,slalom] [--swiftshader]   (exits 1 on a difference)

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname, args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TESTS = opt('--tests', 'zeroTo100,quarterMile,braking,skidpad,slalom').split(',');
let pw;
try { pw = await import('playwright-core'); } catch { try { pw = await import('playwright'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); } }
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(port)], { env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/data/performance.json`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
const browser = await chromium.launch({ executablePath: exe, args: args.includes('--swiftshader') ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'] });
const nm = path.join(ROOT, 'node_modules');
const results = {};
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

// the tests run, and what came out: each one's result, and a hash of every step's telemetry (FNV-1a over the numbers' bits)
const runTests = (page, ids) => page.evaluate(async ids => {
  const D = window.testWorld, S = D.shared, out = {};
  for (const id of ids) {
    S.testTelemetry.clear();
    await D.runTests([id]);
    for (let t = 0; S.tests && t < 3000; t++) await new Promise(r => setTimeout(r, 100));
    // (physics/telemetry.js: a Float32Array a channel, count samples from the start — a test is far shorter than its ring)
    const T = S.testTelemetry;
    let h = 0x811c9dc5, n = 0;
    for (const id of Object.keys(T.data)) { const u = new Uint32Array(T.data[id].buffer, 0, T.count); for (let k = 0; k < u.length; k++) { h = Math.imul(h ^ u[k], 16777619) >>> 0; n++; } }
    out[id] = { result: JSON.stringify(S.results[id]?.last ?? null), telemetry: `${h.toString(16)}/${n}` };
  }
  return { out, stepHz: S.settings.stepHz, dt: D.active.sim.dt, preset: S.G.preset };
}, ids);

try {
  for (const preset of ['low', 'medium', 'high', 'ultra']) {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e.message ?? e)));
    await page.goto(`${base}/dev/world.html?world=test_centre&graphics=${preset}`);
    await page.waitForFunction(() => { const w = window.testWorld?.active; return !!(w && w.sim && !w.spawning); }, null, { timeout: 180000 });
    results[preset] = await runTests(page, TESTS);
    // (the last: the preset changed back and forth while driving, then the tests again — on the settings it ended on)
    if (preset === 'ultra') {
      await page.keyboard.down('ArrowUp');
      for (const p of ['low', 'high', 'medium', 'ultra', 'low']) {
        await page.evaluate(async p => { const S = window.testWorld.shared, { withPreset } = await import('/perf/quality.js'); S.prefs.graphics = withPreset(S.prefs.graphics ?? {}, S.perfCfg.quality, p); window.testWorld.applyGraphics(); }, p);
        await page.waitForTimeout(800);
      }
      await page.keyboard.up('ArrowUp');
      results.switched = await runTests(page, TESTS);
    }
    check(`${preset}: no errors on the page`, !errors.length, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  const ref = results.low;
  for (const [name, r] of Object.entries(results)) {
    if (name === 'low') continue;
    const diff = TESTS.filter(id => r.out[id].result !== ref.out[id].result || r.out[id].telemetry !== ref.out[id].telemetry);
    check(`${name === 'switched' ? 'switched presets while driving, then' : name}: every test's result and telemetry the same as on low, at the same physics rate`, !diff.length && r.stepHz === ref.stepHz && r.dt === ref.dt,
      diff.length ? diff.map(id => `${id}: ${r.out[id].result.slice(0, 80)} vs ${ref.out[id].result.slice(0, 80)} (telemetry ${r.out[id].telemetry} vs ${ref.out[id].telemetry})`).join(' · ') : `${TESTS.length} tests, ${r.stepHz} Hz, ${TESTS.map(id => r.out[id].telemetry).join(' ')}`);
  }
} catch (e) { check('ran to the end', false, e.stack ?? e.message); }
finally { await browser.close(); server.kill(); }
console.log(failed ? `\n${failed} failed` : '\nall the same');
process.exit(failed ? 1 : 0);
