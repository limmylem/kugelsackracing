// Map v5's recognisability capture (MAP_README.md, "Debug views"): the places in data/map/v5/recognise.json shot
// from the car's chase camera in each map asked for — with nothing on screen that names the place: no HUD, no
// where-am-I box, no debug label, no names painted on the road (the world's own street signs stay: they're there in
// the real street too) — and a quiz page to try them on someone who knows the city: each place's Map v5 picture,
// "where is this?", the answer kept back until asked, and Map v4's picture beside it to compare.
//
//   node tools/map-recognise.mjs [--places data/map/v5/recognise.json] [--maps v5,v4] [--out output/map-recognise]
//                                [--hours 13] [--port 7690]
//   → <out>/<map>/<id>.png, <out>/index.html (the quiz), <out>/answers.json
// Needs the dev server (npm start) on --port, and Playwright's Chromium (preinstalled in the cloud sessions). A place
// outside what a map has baked (a slice) is left out of that map's pictures and marked so on the page.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = +opt('--port', 7690), out = path.resolve(opt('--out', path.join(ROOT, 'output/map-recognise'))), maps = opt('--maps', 'v5,v4').split(',');
const hours = +opt('--hours', 13), file = opt('--places', path.join(ROOT, 'data/map/v5/recognise.json'));
const { places } = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.mkdirSync(out, { recursive: true });

const playwright = await (async () => { for (const p of [path.join(ROOT, 'node_modules/playwright/index.mjs'), '/opt/node22/lib/node_modules/playwright/index.mjs']) if (fs.existsSync(p)) return import(p); return createRequire(import.meta.url)('playwright'); })();
const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const nm = path.join(ROOT, 'node_modules'), shot = {};

for (const map of maps) {
  fs.mkdirSync(path.join(out, map), { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|demotiles\.maplibre|unpkg\.com\/maplibre|cdn\.jsdelivr\.net\/npm\/maplibre/, r => r.abort());
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  const until = async (fn, ms, every = 500) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await page.evaluate(fn).catch(() => null); if (v) return v; await page.waitForTimeout(every); } return null; };
  await page.goto(`http://localhost:${port}/dev/world.html?world=map_v3&region=adelaide&graphics=high&hud=0&view=700&map=${map}`, { waitUntil: 'load', timeout: 120000 });
  if (!await until(() => !!globalThis.__map3 && !globalThis.__map3.spawning, 180000)) { console.log(`${map}: never drivable`, errors); await ctx.close(); continue; }
  for (const h of await page.locator('text=click to dismiss').all()) await h.click({ timeout: 2000 }).catch(() => {});
  // (nothing on screen but the world: every overlay hidden, the canvas kept)
  await page.addStyleTag({ content: 'body *:not(canvas) { visibility: hidden !important } canvas { visibility: visible !important }' });
  await page.evaluate(async h => { const TS = await import('/testtrack/test-scene.js'); TS.debug.shared.prefs.timeOfDay = h; }, hours);
  for (const p of places) try {
    // (outside what this map baked — a slice's tiles — left out at once)
    const inside = await page.evaluate(p => { const S = globalThis.__map3.stream, M = S.manifest, T = M.grid.tileSize, [x, z] = S.projection.toXZ(p.lat, p.lon), i = Math.floor(x / T), j = Math.floor(z / T); return (M.tiles ?? []).some(t => t.i === i && t.j === j); }, p);
    if (!inside) { console.log(`  ${map} ${p.id}: not in this map's bake`); continue; }
    await page.evaluate(p => { const w = globalThis.__map3; w.mapDebug.setView('off'); w.travel({ lat: p.lat, lon: p.lon, heading: p.exact && p.bearing != null ? 180 - p.bearing : undefined, y: p.y }); }, p);
    await page.waitForTimeout(500);
    if (!await until(() => !globalThis.__map3.spawning, 120000)) { console.log(`  ${map} ${p.id}: no ground there`); continue; }
    // (outside what this map baked — a slice — the car lands on its nearest road, somewhere else: left out)
    const off = await page.evaluate(p => { const S = globalThis.__map3.stream, b = globalThis.__map3.sim.vehicle.body.translation(), [wx, wz] = S.toWorld(b.x, b.z), [px, pz] = S.projection.toXZ(p.lat, p.lon); return Math.hypot(wx - px, wz - pz); }, p);
    if (off > 60) { console.log(`  ${map} ${p.id}: not in this map (the nearest road is ${Math.round(off)} m away)`); continue; }
    await page.waitForTimeout(3500);
    // (no names painted on the roads)
    await page.evaluate(() => globalThis.__map3.stream.world.traverse(o => { if (o.name === 'roadNames') o.visible = false; }));
    await page.waitForTimeout(300);
    const f = path.join(out, map, `${p.id}.png`);
    // (software rendering on a busy machine can take a while over a frame)
    await page.screenshot({ path: f, timeout: 120000 });
    (shot[p.id] ??= {})[map] = `${map}/${p.id}.png`;
    console.log(`  ${map} ${p.id} → ${path.relative(ROOT, f)}`);
  } catch (e) { console.log(`  ${map} ${p.id}: left out (${String(e?.message ?? e).split('\n')[0].slice(0, 120)})`); }
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
  await ctx.close();
}
await browser.close();

// the quiz: the places in a fixed shuffled order (so the CBD's don't come all together), the answers held back
const order = places.map((p, k) => ({ p, k: Math.sin(k * 12.9898 + 4.1) * 43758.5453 % 1 })).sort((a, b) => a.k - b.k).map(x => x.p).filter(p => shot[p.id]);
const answers = order.map((p, n) => ({ n: n + 1, id: p.id, name: p.name, lat: p.lat, lon: p.lon, maps: Object.keys(shot[p.id]) }));
fs.writeFileSync(path.join(out, 'answers.json'), JSON.stringify(answers, null, 1));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cards = order.map((p, n) => {
  const imgs = maps.map(m => shot[p.id][m] ? `<figure><img src="${esc(shot[p.id][m])}" alt="Place ${n + 1}, Map ${esc(m)}" loading="lazy"><figcaption>Map ${esc(m)}</figcaption></figure>` : `<figure class="none"><div>not in Map ${esc(m)}'s bake</div><figcaption>Map ${esc(m)}</figcaption></figure>`).join('');
  return `<section class="card"><h2>${n + 1}. Where is this?</h2><div class="imgs">${imgs}</div><div class="guess"><input aria-label="Your guess for place ${n + 1}" placeholder="Your guess"><button type="button">Show the answer</button><span class="answer" hidden>${esc(p.name)}</span></div></section>`;
}).join('\n');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Map recognisability</title>
<style>
:root { --bg: #f4f2ee; --fg: #1d1f22; --card: #fff; --muted: #6a6f75; --accent: #1f6feb; }
@media (prefers-color-scheme: dark) { :root { --bg: #15171a; --fg: #e8e6e3; --card: #1f2226; --muted: #9aa0a6; --accent: #58a6ff; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 4px 0 2px; } p.lede { color: var(--muted); margin: 0 0 18px; }
.card { background: var(--card); border-radius: 10px; padding: 12px 14px 14px; margin: 0 0 16px; box-shadow: 0 1px 3px #0002; }
.card h2 { font-size: 16px; margin: 0 0 8px; }
.imgs { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; align-items: start; }
@media (max-width: 720px) { .imgs { grid-template-columns: 1fr; } }
figure { margin: 0; } figure img { width: 100%; border-radius: 6px; display: block; }
figure.none div { aspect-ratio: 16 / 10; display: grid; place-items: center; border: 1px dashed var(--muted); border-radius: 6px; color: var(--muted); }
figcaption { color: var(--muted); font-size: 12px; margin-top: 3px; }
.guess { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.guess input { flex: 1 1 220px; padding: 7px 9px; border-radius: 6px; border: 1px solid var(--muted); background: transparent; color: inherit; font: inherit; }
.guess button { padding: 7px 12px; border-radius: 6px; border: 0; background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
.answer { font-weight: 600; }
</style></head><body><main>
<h1>Map recognisability</h1>
<p class="lede">${answers.length} places from the street, as the game draws them at ${String(Math.floor(hours)).padStart(2, '0')}:00 — no HUD, no map, no road names. Guess each from Map ${esc(maps[0])}'s picture, then show the answer${maps.length > 1 ? ` (Map ${esc(maps.slice(1).join(', '))} beside it, to compare)` : ''}.</p>
${cards}
</main><script>
for (const c of document.querySelectorAll('.card')) c.querySelector('button').addEventListener('click', e => { const a = c.querySelector('.answer'); a.hidden = !a.hidden; e.target.textContent = a.hidden ? 'Show the answer' : 'Hide the answer'; });
</script></body></html>
`);
console.log(`${answers.length} places → ${path.relative(ROOT, path.join(out, 'index.html'))}`);
