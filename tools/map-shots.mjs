// Map screenshots (MAP_README.md, "Debug views"): a list of places in a baked region rendered to PNG files in
// the game's own renderer — top down (an orthographic camera straight above, `size` m across) or from the car's
// chase camera — optionally with a debug view on (colliders, roads, mask, lamps, seams). For before/after
// comparisons (Map v3 vs v4, MAP_V4_REPORT.md) and the bad-spot list. Output goes to output/map-shots/ (gitignored).
//
//   node tools/map-shots.mjs --spots spots.json [--out output/map-shots/<name>] [--map v3|v4] [--port 7690]
//   spots.json: [{ "name": "belair-springbank", "region": "adelaide", "lat": -34.9899, "lon": 138.6104,
//                  "bearing": 120, "mode": "top" | "chase", "size": 80, "view": "colliders", "hours": 13,
//                  "y": 385 (with "exact": on the first ground under that height — a road in a tunnel) }]
//   (or --spots data/map/known-bad-spots.json: every saved bad spot, chase camera)
// Needs the dev server (npm start) on --port, and Playwright's Chromium (preinstalled in the cloud sessions).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = +opt('--port', 7690), out = path.resolve(opt('--out', path.join(ROOT, 'output/map-shots'))), map = opt('--map', null);
let spots = JSON.parse(fs.readFileSync(opt('--spots'), 'utf8'));
if (!Array.isArray(spots)) spots = (spots.spots ?? []).map((s, k) => ({ name: `bad-${String(k + 1).padStart(2, '0')}-${(s.road ?? s.tile ?? '').replace(/\W+/g, '-').toLowerCase()}`, mode: 'chase', ...s }));
fs.mkdirSync(out, { recursive: true });

const playwright = await (async () => { for (const p of [path.join(ROOT, 'node_modules/playwright/index.mjs'), '/opt/node22/lib/node_modules/playwright/index.mjs']) if (fs.existsSync(p)) return import(p); return createRequire(import.meta.url)('playwright'); })();
const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const nm = path.join(ROOT, 'node_modules');
const byRegion = new Map();
for (const s of spots) (byRegion.get(s.region ?? 'adelaide') ?? byRegion.set(s.region ?? 'adelaide', []).get(s.region ?? 'adelaide')).push(s);

for (const [region, list] of byRegion) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|demotiles\.maplibre|unpkg\.com\/maplibre|cdn\.jsdelivr\.net\/npm\/maplibre/, r => r.abort());
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  const until = async (fn, ms, every = 500) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await page.evaluate(fn).catch(() => null); if (v) return v; await page.waitForTimeout(every); } return null; };
  await page.goto(`http://localhost:${port}/dev/world.html?world=map_v3&region=${region}&graphics=high&hud=0&view=700${map ? `&map=${map}` : ''}`, { waitUntil: 'load', timeout: 120000 });
  if (!await until(() => !!globalThis.__map3 && !globalThis.__map3.spawning, 180000)) { console.log(`${region}: never drivable`, errors); continue; }
  for (const h of await page.locator('text=click to dismiss').all()) await h.click({ timeout: 2000 }).catch(() => {});
  for (const s of list) {
    // (the time of day: the game's own setting — night has the street lights and headlights)
    await page.evaluate(async h => { const TS = await import('/testtrack/test-scene.js'); TS.debug.shared.prefs.timeOfDay = h; }, s.hours ?? 13);
    // there, on the ground
    await page.evaluate(s => { const w = globalThis.__map3; w.mapDebug.setView('off'); const heading = s.exact && s.bearing != null ? 180 - s.bearing : undefined; w.travel(s.xz ? { xz: s.xz, heading, y: s.y } : { lat: s.lat, lon: s.lon, heading, y: s.y }); }, s);
    await page.waitForTimeout(500);
    if (!await until(() => !globalThis.__map3.spawning, 120000)) { console.log(`  ${s.name}: no ground there`); continue; }
    await page.waitForTimeout(2500);
    await page.evaluate(v => globalThis.__map3.mapDebug.setView(v ?? 'off'), s.view ?? 'off');
    if ((s.mode ?? 'top') === 'top') {
      // an orthographic camera straight down over the place, the world still streaming round it
      await page.evaluate(async s => {
        const THREE = await import('three'), TS = await import('/testtrack/test-scene.js'), w = globalThis.__map3, S = w.stream, size = s.size ?? 90;
        // (a narrow perspective camera high above, straight down: as good as top down, and drawn by the game's own
        // effects, which expect a perspective camera)
        const [wx, wz] = s.xz ?? S.projection.toXZ(s.lat, s.lon), [x, z] = S.toSim(wx, wz), fov = 12, cam = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 5, 6000);
        const ground = S.heightAt(x, z) ?? 0, y = ground + size / 2 / Math.tan(fov / 2 * Math.PI / 180);
        cam.position.set(x, y, z); cam.up.set(0, 0, -1); cam.lookAt(x, ground, z); cam.updateMatrixWorld();
        TS.editorHooks.camera = cam;
        TS.editorHooks.frame = (ww, sec) => { const p = ww.sim.vehicle.body.translation(); ww.stream.update([p.x, p.y, p.z], [0, 0, 0], sec); ww.mapDebug?.frame(sec); };
        TS.editorPause(true);
      }, s);
      await page.waitForTimeout(2500);
    } else await page.waitForTimeout(1500);
    const file = path.join(out, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${s.name} → ${path.relative(ROOT, file)}`);
    await page.evaluate(async () => { const TS = await import('/testtrack/test-scene.js'); TS.editorHooks.camera = null; TS.editorHooks.frame = null; TS.editorPause(false); });
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
  await ctx.close();
}
await browser.close();
