// The new player's first minutes in a real browser (Phase 8 Step 4; docs/ONBOARDING.md, docs/ACCESSIBILITY.md,
// docs/PHOTO_MODE.md, docs/TRANSLATIONS.md): the game opened fresh, as a first-time player sees it, with no server
// (tools/serve.mjs: the files alone) —
//   1. the photosensitivity warning comes first, and holds the keyboard until it's read
//   2. the starter car choice: picking the other car makes it the one you drive
//   3. the tutorial's offer, then its coach with the first step
//   4. the settings (O): every tab opens; Accessibility's text size, high contrast and reduced motion change the page
//   5. photo mode (/): the HUD hidden but the map's credit kept; Esc closes it from the picture
//   6. the pseudo-language (en-XA, every message longer): the settings' text stays inside its panel
//   7. the player's page (index.html): the dock and the news button in words, never a message's name
//   8. a route to anywhere: a click on an empty spot of the full map (Tab) asks "Route here?"; Set route draws the way
//      on the roads to it, and its pin, on both maps; Clear route takes them off
// Anything wrong is printed, and the exit code is 1.
//
//   node tools/first-launch-browser.mjs [--port 8941] [--wait 45000]     (server.yml runs it beside each deploy)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('--port', 8941)), wait = Number(opt('--wait', 45000));
let pw;
try { pw = await import('playwright'); } catch { pw = await import('/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const server = spawn(process.execPath, ['tools/serve.mjs', String(port)], { cwd: root, env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const exe = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
const browser = await pw.chromium.launch({ ...exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const nm = path.join(root, 'node_modules');
let failed = 0;
const bundles = new Map();
const bundle = async pkg => {
  if (!bundles.has(pkg)) {
    const esbuild = await import('esbuild');
    const contents = pkg === 'pbf' ? "import * as m from 'pbf'; export * from 'pbf'; export default m.default ?? m.Pbf ?? Object.values(m).find(v => typeof v === 'function');" : `export * from '${pkg}';`;
    bundles.set(pkg, (await esbuild.build({ stdin: { contents, resolveDir: root }, bundle: true, format: 'esm', write: false, logLevel: 'silent' })).outputFiles[0].text);
  }
  return bundles.get(pkg);
};
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

async function open(url, init = null, { cesium = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-AU' });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // (the player's page's map-tile libraries from the CDN as ES modules: this computer's copies, bundled, when it has
  // them — the CDN where it can be reached, as in CI, works too)
  if (fs.existsSync(path.join(nm, 'pbf')) && fs.existsSync(path.join(nm, '@mapbox/vector-tile'))) await page.route(/cdn\.jsdelivr\.net\/npm\/(pbf|@mapbox\/vector-tile)@/, async r => r.fulfill({ body: await bundle(/pbf@/.test(r.request().url()) ? 'pbf' : '@mapbox/vector-tile'), contentType: 'text/javascript' }));
  // (MapLibre too: the maps)
  if (fs.existsSync(path.join(nm, 'maplibre-gl/dist'))) await page.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', r => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: path.join(nm, 'maplibre-gl/dist', f), contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: path.join(nm, 'three', new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')), contentType: 'text/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: path.join(nm, '@dimforge/rapier3d-compat/dist/rapier.mjs'), contentType: 'text/javascript' }));
  await page.route(cesium ? /fonts\.(googleapis|gstatic)\.com/ : /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net\/npm\/cesium/, r => r.abort());   // (the player's page needs Cesium to start: it's there)
  // (every baked region, San Francisco among them: data/map/baked.json's inGame keeps the game to Adelaide otherwise)
  await page.goto(`http://127.0.0.1:${port}${url}${url.includes('?') ? '&' : '?'}regions=all`);
  await page.waitForTimeout(wait);
  return { page, errors };
}
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e || e.hidden) return false; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden'; }, sel);

try {
  console.log('== the first launch (San Francisco, a fresh browser)');
  const { page, errors } = await open('/dev/world.html?world=map_v3&onboarding');
  // 1. the warning
  check('the photosensitivity warning first', await visible(page, '.a11yDialog'), await page.evaluate(() => document.querySelector('.a11yDialog')?.textContent.slice(0, 70) ?? 'none'));
  check('… holding the keyboard (the focus inside it)', await page.evaluate(() => !!document.querySelector('.a11yDialog')?.contains(document.activeElement)));
  await page.click('.a11yDialog button'); await page.waitForTimeout(2500);
  check('… gone once read, and remembered', !(await visible(page, '.a11yDialog')) && await page.evaluate(() => !!localStorage.getItem('ognistrada.photosensitivity.v1')));
  // 2. the starter car
  const cars = await page.$$eval('.onboardCard [data-a=car]', b => b.map(x => x.dataset.id));
  check('the starter car choice: two cars', cars.length >= 2, cars.join(', '));
  const other = cars.find(c => c !== 'starter_car');
  if (other) {
    await page.click(`.onboardCard [data-a=car][data-id=${other}]`); await page.waitForTimeout(4000);
    const now = await page.evaluate(() => window.testWorld?.shared?.session?.garage?.car?.id ?? null);
    check('… the one picked is the one you drive', now === other, `${now}`);
  }
  // 3. the tutorial
  check('the tutorial offered', await visible(page, '.onboardCard [data-a=go]'));
  await page.click('.onboardCard [data-a=go]').catch(() => {}); await page.waitForTimeout(3000);
  const coach = await page.evaluate(() => document.querySelector('.tutorialCoach')?.textContent.slice(0, 80) ?? null);
  check('… its coach shows the first step', !!coach, coach ?? 'no coach');
  // 4. the settings
  await page.keyboard.press('KeyO'); await page.waitForTimeout(1500);
  check('the settings open (O)', await visible(page, '#settings'));
  const tabs = await page.$$eval('#settings [role=tab]', t => t.map(x => x.dataset.tab));
  const opened = [];
  for (const tab of tabs) { await page.click(`#settings [data-tab=${tab}]`); await page.waitForTimeout(250); if (await page.evaluate(t => document.querySelector(`#settings [data-tab=${t}]`)?.getAttribute('aria-selected') === 'true' && (document.querySelector('#settings [role=tabpanel]')?.textContent.trim().length ?? 0) > 20, tab)) opened.push(tab); }
  check('… every tab opens with its settings', opened.length === tabs.length && tabs.length >= 8, `${opened.length} of ${tabs.length}: ${tabs.join(', ')}`);
  await page.click('#settings [data-tab=accessibility]'); await page.waitForTimeout(300);
  const before = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  const set = async (sel, value) => page.evaluate(([s, v]) => { const e = document.querySelector(s); if (!e) return false; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [sel, value]);
  const found = { text: await set('#settings [data-num="a11y.textSize"], #settings [data-range="a11y.textSize"]', '1.4'), contrast: await set('#settings [data-str="a11y.contrast"]', 'high'), motion: await set('#settings [data-str="a11y.motion"]', 'reduced') };
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ size: parseFloat(getComputedStyle(document.documentElement).fontSize), cls: document.documentElement.className }));
  check('… bigger text makes the page\'s text bigger', found.text && after.size > before * 1.2, `${before}px → ${after.size}px`);
  check('… high contrast and reduced motion switch on', found.contrast && found.motion && /a11y-contrast/.test(after.cls) && /a11y-reduced-motion/.test(after.cls), after.cls);
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  check('… Esc closes them', !(await visible(page, '#settings')));
  // 5. photo mode
  await page.click('.tutorialCoach [data-a=skip]').catch(() => {}); await page.waitForTimeout(500);
  await page.mouse.click(640, 400); await page.keyboard.press('Slash'); await page.waitForTimeout(2000);
  check('photo mode opens (/)', await visible(page, '#photoMode'));
  check('… the HUD hidden', !(await visible(page, '#playerHud')));
  check('… the map\'s credit kept', await visible(page, '#map3Attribution, #worldAttribution'));
  await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(560, 430, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
  check('… Esc closes it from the picture', !(await visible(page, '#photoMode')) && await visible(page, '#playerHud'));
  check('no errors on the page', !errors.length, errors.slice(0, 3).join(' | '));
  await page.context().close();

  // 7. the player's page (index.html): its dock and news button drawn with words, never a message's name (they were,
  // online, when they were drawn before the words had loaded)
  console.log('\n== the player\'s page (/): words, not message names');
  const keys = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'))));
  const P = await open('/', () => { localStorage.setItem('ognistrada.photosensitivity.v1', '2026-01-01'); }, { cesium: true });
  const shown = await P.page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('#krDock, #krDock *, .newsButton, #newsPanel, #newsPanel *')) { out.push(el.textContent.trim(), el.getAttribute('aria-label') ?? '', el.dataset?.tip ?? '', el.title ?? ''); } return out; });
  const named = [...new Set(shown.flatMap(x => x.split(/\s+/)).filter(w => keys.has(w)))];
  check('the dock and the news button in words', shown.length > 10 && !named.length, named.length ? named.join(', ') : `${shown.filter(Boolean).length} labels`);
  await P.page.context().close();

  // 8. a route to anywhere on the map (San Francisco: a street by the car, then the bay — the nearest road to it)
  console.log('\n== a route to anywhere: a spot picked on the full map');
  const R = await open('/dev/world.html?world=map_v3&graphics=low', () => {
    localStorage.setItem('ognistrada.photosensitivity.v1', '2026-01-01');
    localStorage.setItem('ognistrada.onboarding.v1', JSON.stringify({ welcome: 'offline', starter: 'starter_car', tutorial: 'skipped', quest: 'skipped', repair: 'skipped', part: 'skipped', npcRace: 'skipped' }));
    localStorage.setItem('driveWorld.settings.v1', JSON.stringify({ privacy: { analytics: false, asked: true } }));
  });
  const W = fn => R.page.evaluate(async f => { const w = (await import('/testtrack/test-scene.js')).debug.active; return new Function('w', `return (${f})(w)`)(w); }, fn.toString());
  for (let k = 0; k < 60 && !(await W(w => !!(w?.maps && w?.quests && !w.spawning))); k++) await R.page.waitForTimeout(1000);
  await R.page.keyboard.press('Tab'); await R.page.waitForTimeout(3000);
  const box = await R.page.locator('#worldFull').boundingBox();
  const lines = () => W(w => (w.maps.miniMap.getSource('mini-lines-src')?.serialize().data.features ?? []).map(f => f.properties.kind));
  for (const [where, fx, fy] of [['a street near the car', 0.45, 0.45], ['the bay (the nearest road to it)', 0.72, 0.35]]) {
    await R.page.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await R.page.waitForTimeout(1200);
    const card = (await R.page.locator('.worldAsk').innerText().catch(() => '')).replace(/\s+/g, ' ');
    check(`a click on ${where} asks: Route here?`, /Route here\?/.test(card) && /away/.test(card), card || 'no card');
    await R.page.locator('.worldAsk button.go').click().catch(() => {});
    let set = null;
    for (let k = 0; k < 40 && !(set = await W(w => w.quests.guideFor)); k++) await R.page.waitForTimeout(500);
    await R.page.waitForTimeout(600);
    const kinds = await lines();
    check('… Set route: the way there on the roads and its pin, on the minimap too', set === 'place' && kinds.includes('guide') && kinds.includes('pin'), `${set} · ${kinds.join(', ')}`);
  }
  await R.page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.75); await R.page.waitForTimeout(1200);
  await R.page.locator('.worldAsk button:not(.go)', { hasText: 'Clear route' }).click().catch(() => {});
  await R.page.waitForTimeout(600);
  check('… Clear route takes it off', !(await W(w => w.quests.guideFor)) && !(await lines()).length);
  check('no errors on the page', !R.errors.length, R.errors.slice(0, 3).join(' | '));
  await R.page.context().close();

  // 6. the pseudo-language: longer text, still inside the panels
  console.log('\n== the pseudo-language (en-XA: every message longer and accented)');
  const X = await open('/dev/world.html?world=test_centre', () => {
    localStorage.setItem('ognistrada.photosensitivity.v1', '2026-01-01');
    localStorage.setItem('ognistrada.onboarding.v1', JSON.stringify({ welcome: 'offline', starter: 'starter_car', tutorial: 'skipped' }));
    localStorage.setItem('driveWorld.settings.v1', JSON.stringify({ language: 'en-XA', privacy: { analytics: false } }));
  });
  await X.page.keyboard.press('KeyO'); await X.page.waitForTimeout(1500);
  const xa = await X.page.evaluate(() => document.querySelector('#settings h2, #settings [id=settingsTitle]')?.textContent ?? '');
  check('the settings in the pseudo-language', /[À-ɏ]/.test(xa), xa.slice(0, 40));
  const over = [];
  for (const tab of await X.page.$$eval('#settings [role=tab]', t => t.map(x => x.dataset.tab))) {
    await X.page.click(`#settings [data-tab=${tab}]`); await X.page.waitForTimeout(200);
    over.push(...await X.page.evaluate(t => { const P = document.querySelector('#settings').getBoundingClientRect(); return [...document.querySelectorAll('#settings label, #settings button, #settings h2, #settings h3, #settings p')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > P.right + 1 || r.left < P.left - 1); }).slice(0, 3).map(e => `${t}: ${e.textContent.trim().slice(0, 30)}`); }, tab));
  }
  check('… nothing spills out of the panel', !over.length, over.slice(0, 5).join(' | '));
  check('no errors on the page', !X.errors.length, X.errors.slice(0, 3).join(' | '));
} finally {
  await browser.close(); server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
