// The long play test (Phase 8 Step 2; docs/PERFORMANCE.md): the game itself (index.html) played for a long while — round
// and round: free roam in the real world (a downtown race against seven NPCs on the autopilot, then driving on), a race
// on a generated track, the garage (in, a look round, out), and the test centre (a ten-car pile-up, then everything
// repaired) — its memory sampled every half minute: the JavaScript heap, what the graphics card holds (geometries,
// textures, shader programs), the page's elements and the sound's nodes. It passes when what it holds at the end is no
// more than after the first round (the warm-up: everything loaded once) by more than the allowance — memory flat, not
// creeping up.
//
//   node tools/memory-soak.mjs [--minutes 120] [--preset medium] [--swiftshader] [--every 30]
//   → reports/performance/soak.json (the timeline); exits 1 if memory grew

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname, args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const minutes = +opt('--minutes', 120), preset = opt('--preset', 'medium'), every = +opt('--every', 30);
// (what may grow from the end of the first round to the end: a share, and a little on top)
const ALLOW = { heapMB: [0.15, 25], geometries: [0.1, 40], textures: [0.1, 10], programs: [0.1, 6], gpuMB: [0.1, 20], dom: [0.1, 200], audioNodes: [0.2, 40] };
let pw;
try { pw = await import('playwright-core'); } catch { try { pw = await import('playwright'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); } }
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(port)], { env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/data/performance.json`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
const browser = await chromium.launch({ executablePath: exe, args: [...(args.includes('--swiftshader') ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : []), '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const nm = path.join(ROOT, 'node_modules');
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com|cesium|openfreemap|demotiles/, r => r.abort());
// (pbf@4 and @mapbox/vector-tile@2 from the CDN, as the game has them: node_modules has a newer pbf, with no default export)
await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', r => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: `${nm}/maplibre-gl/dist/${f}`, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(String(e.message ?? e).slice(0, 200)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = s => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

// what the page holds now (a collection asked for first, so what's measured is what's kept)
const sample = () => page.evaluate(async () => {
  globalThis.gc?.();
  const { debug } = await import('/testtrack/test-scene.js'), S = debug.shared, w = debug.active, info = S?.renderer.info;
  const { sceneBytes } = await import('/perf/memory.js'), b = w ? sceneBytes(w.scene) : { meshes: 0, textures: 0 };
  const { audioSystem } = await import('/audio/system.js'), A = audioSystem();
  return { heapMB: (performance.memory?.usedJSHeapSize ?? 0) / 1048576, geometries: info?.memory.geometries ?? 0, textures: info?.memory.textures ?? 0, programs: info?.programs?.length ?? 0,
    gpuMB: (b.meshes + b.textures) / 1048576, dom: document.getElementsByTagName('*').length, audioNodes: A?.nodes ?? 0, world: w?.file ?? null, models: S?.models.stats().length ?? 0 };
});
const world = name => page.evaluate(n => { const b = [...document.querySelectorAll('#worlds button')].find(x => x.textContent.includes(n)); b?.click(); return !!b; }, name);
const inWorld = file => page.waitForFunction(f => { const w = window.testWorld?.active; return !!(w && w.file?.startsWith(f) && !w.spawning); }, file, { timeout: 300000 }).then(() => true, () => false);
const bench = (scene, o = {}) => page.evaluate(async ([s, o]) => (await import('/perf/bench.js')).setup(s, o), [scene, o]);
const quitQuest = () => page.evaluate(() => { const q = window.testWorld?.active?.quests; try { q?.quit?.() ?? q?.abandon?.() ?? q?.stop?.(); } catch { /* none */ } });

const timeline = [], rounds = [];
let round = 0, stopAt = Date.now() + minutes * 60000, lastSample = 0;
const tick = async what => { if (Date.now() - lastSample < every * 1000) return; lastSample = Date.now(); const s = await sample().catch(e => ({ error: e.message })); timeline.push({ t: Math.round((Date.now() - t0) / 1000), round, what, ...s }); };
const wait = async (ms, what) => { for (const end = Date.now() + ms; Date.now() < end;) { await tick(what); await sleep(2000); } };
const t0 = Date.now();
try {
  await page.goto(`${base}/index.html?questBot&graphics=${preset}`);
  if (!(await inWorld('scenes/map_v3'))) throw new Error('the real world never became drivable');
  await page.keyboard.press('Shift');
  log('in the real world');
  while (Date.now() < stopAt) {
    round++;
    // free roam: a downtown race on the autopilot, then on round the streets
    if (!(await inWorld('scenes/map_v3'))) { await world('Real world'); await inWorld('scenes/map_v3'); }
    const r1 = await bench('city'); log(`round ${round}: downtown race ${r1.ok ? 'on' : `not started (${r1.error})`}`);
    await wait(150000, 'downtown race');
    await quitQuest(); await page.keyboard.down('ArrowUp'); await wait(30000, 'free roam'); await page.keyboard.up('ArrowUp');
    // a race on a generated track
    await world('Track');
    if (await inWorld('track:')) { const r2 = await bench('track_race'); log(`round ${round}: track race ${r2.ok ? 'on' : `not started (${r2.error})`}`); await wait(120000, 'track race'); await quitQuest(); }
    // the garage
    await world('Garage'); await wait(20000, 'garage');
    // the test centre: a pile-up, then all repaired
    await world('Test centre');
    // (J takes the AI cars away, B repairs everything — the test centre's own keys)
    if (await inWorld('scenes/test_centre')) { await bench('pileup'); await wait(30000, 'pile-up'); await page.keyboard.press('KeyJ'); await page.keyboard.press('KeyB'); await wait(10000, 'repaired'); }
    await world('Real world');
    lastSample = 0; await tick('round end');
    rounds.push(timeline.at(-1));
    log(`round ${round} done: ${JSON.stringify(timeline.at(-1))}`);
  }
} catch (e) { errors.push(`ran: ${e.message}`); }
finally { await browser.close(); server.kill(); }

// the end of the first round against the end of the last
const first = rounds[0], last = rounds.at(-1), grew = [];
if (first && last && rounds.length >= 2) for (const [k, [share, plus]] of Object.entries(ALLOW)) if (last[k] > first[k] * (1 + share) + plus) grew.push(`${k} ${first[k].toFixed(1)} → ${last[k].toFixed(1)}`);
const ok = rounds.length >= 2 && !grew.length;
const res = { at: new Date().toISOString(), minutes, preset, rounds: rounds.length, ok, grew, first, last, errors: errors.slice(0, 20), timeline };
fs.mkdirSync(path.join(ROOT, 'reports/performance'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/performance/soak.json'), JSON.stringify(res, null, 1));
console.log(`\n${ok ? '  ok  ' : ' FAIL '} ${rounds.length} rounds in ${Math.round((Date.now() - t0) / 60000)} min at ${preset}: ${grew.length ? `grew — ${grew.join(', ')}` : 'memory flat after the first round'} · first ${first ? `heap ${first.heapMB.toFixed(0)} MB, ${first.geometries} geometries, ${first.textures} textures, ${first.programs} shaders` : '—'} · last ${last ? `heap ${last.heapMB.toFixed(0)} MB, ${last.geometries} geometries, ${last.textures} textures, ${last.programs} shaders` : '—'}${errors.length ? ` · ${errors.length} page errors: ${errors[0]}` : ''}`);
process.exit(ok ? 0 : 1);
