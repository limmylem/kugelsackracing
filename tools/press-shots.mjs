// The press kit's screenshots (press/index.html; docs/RELEASE.md "Press kit"), taken from the game itself in a browser:
// driving in San Francisco and Adelaide, a photo-mode shot with the HUD hidden, the settings' accessibility tab, the
// driving school's lessons. Written to press/shots/ as JPEGs (1920×1080), replacing what's there.
//
//   node tools/press-shots.mjs [--port 8932] [--wait 45000]
//   node tools/press-shots.mjs --logo     the logo as a PNG (press/logo.png, 1280 wide, transparent), drawn from the
//                                         landing page's SVG with its fonts (Saira, Barlow: Google Fonts, so online)
//
// A real GPU makes nicer pictures than this machine's software renderer: on a computer with one, pass --gpu (the
// browser's own GPU, no SwiftShader). The high graphics preset either way.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt('--port', 8932)), wait = Number(opt('--wait', 45000)), gpu = args.includes('--gpu');
const out = path.join(root, 'press/shots');
fs.mkdirSync(out, { recursive: true });

let pw;
try { pw = await import('playwright'); } catch { pw = await import('/opt/node-tools/node_modules/playwright-core/index.mjs'); }   // (CI's, or this machine's)
const server = spawn(process.execPath, ['tools/serve.mjs', String(port)], { cwd: root, env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const exe = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
const browser = await pw.chromium.launch({ ...exe, args: gpu ? ['--ignore-gpu-blocklist'] : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const nm = path.join(root, 'node_modules');
const shots = [];

async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'en-AU' });
  // (the first launch's screens already seen: the warning, the starter car, the tutorial, the statistics question)
  await ctx.addInitScript(() => {
    localStorage.setItem('ognistrada.photosensitivity.v1', '2026-01-01');
    localStorage.setItem('ognistrada.onboarding.v1', JSON.stringify({ welcome: 'offline', starter: 'starter_car', tutorial: 'skipped', quest: 'skipped', repair: 'skipped', part: 'skipped', npcRace: 'skipped' }));
    const s = JSON.parse(localStorage.getItem('driveWorld.settings.v1') ?? '{}');
    localStorage.setItem('driveWorld.settings.v1', JSON.stringify({ ...s, privacy: { analytics: false, asked: true } }));
  });
  const page = await ctx.newPage();
  // (the libraries from this computer's packages, not the CDN; no web fonts)
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: path.join(nm, 'three', new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')), contentType: 'text/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: path.join(nm, '@dimforge/rapier3d-compat/dist/rapier.mjs'), contentType: 'text/javascript' }));
  await page.route(/cdn\.jsdelivr\.net\/npm\/cesium/, r => r.abort());
  page.on('pageerror', e => console.log(`  page error: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}${url}`);
  await page.waitForTimeout(wait);
  // (the development page's own panels — its numbers, the tile bar — aren't the game players see)
  await page.addStyleTag({ content: '#testHud, #map3Label, #map3Perf, #worldLabel, #worldPerf { display: none !important; }' });
  return page;
}
const shot = async (page, name, what) => {
  const file = path.join(out, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  shots.push({ file: `shots/${name}.jpg`, what });
  console.log(`press/shots/${name}.jpg — ${what}`);
};
const drive = async (page, ms) => { await page.keyboard.down('KeyW'); await page.waitForTimeout(ms); await page.keyboard.up('KeyW'); };

if (args.includes('--logo')) {
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1280 / 560 })).newPage();
    await page.goto(`http://127.0.0.1:${port}/about/`);
    await page.evaluate(() => document.fonts.ready);
    const logo = page.locator('.hero svg.logo');
    await logo.evaluate(el => { el.style.width = '560px'; el.style.maxWidth = 'none'; document.body.style.background = 'transparent'; document.documentElement.style.background = 'transparent'; });
    await logo.screenshot({ path: path.join(root, 'press/logo.png'), omitBackground: true });
    console.log('press/logo.png');
  } finally { await browser.close(); server.kill(); }
  process.exit(0);
}

try {
  const only = opt('--regions', 'sf,adelaide').split(',');   // (--regions sf: San Francisco's shots alone)
  for (const [region, name, place] of [['sf', 'drive-sf', 'San Francisco'], ['adelaide', 'drive-adelaide', 'Adelaide']].filter(([r]) => only.includes(r))) {
    // (dev/world.html opens scenes/<world>.json: a region other than San Francisco rides in on the end of it)
    const world = region === 'sf' ? 'map_v3' : encodeURIComponent(`map_v3.json?region=${region}&_=`);
    const page = await open(`/dev/world.html?world=${world}&graphics=high`);
    await drive(page, 9000); await page.waitForTimeout(600);
    await shot(page, name, `Driving in ${place}, a real city from open map data`);
    if (region === 'sf') {
      // photo mode: the HUD hidden, the panel out of the way
      await page.keyboard.press('Slash'); await page.waitForTimeout(2500);
      await page.evaluate(() => { const p = document.getElementById('photoMode'); if (p) p.style.visibility = 'hidden'; });
      await page.mouse.move(960, 540); await page.mouse.down(); await page.mouse.move(820, 600, { steps: 12 }); await page.mouse.up();
      await page.waitForTimeout(2500);
      await shot(page, 'photo-mode', 'Photo mode: a free camera, depth of field and filters');
      await page.evaluate(() => { const p = document.getElementById('photoMode'); if (p) p.style.visibility = ''; });
      await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
      // the settings' accessibility tab
      await page.keyboard.press('KeyO'); await page.waitForTimeout(1200);
      await page.click('#settings [data-tab=accessibility]').catch(() => {});
      await page.waitForTimeout(800);
      await shot(page, 'accessibility', 'Accessibility: text size, high contrast, colour-blind palettes, reduced motion');
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
      // the driving school's lessons
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('kr:school'))); await page.waitForTimeout(2500);
      await shot(page, 'driving-school', 'The driving school: seven lessons, with medals');
    }
    await page.context().close();
  }
} finally {
  // (the list kept up to date: the shots taken now replace theirs, the others stay)
  let had = []; try { had = JSON.parse(fs.readFileSync(path.join(out, 'shots.json'), 'utf8')).shots ?? []; } catch { /* first time */ }
  const all = [...had.filter(h => !shots.some(x => x.file === h.file)), ...shots];
  fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify({ _note: 'Written by tools/press-shots.mjs.', taken: new Date().toISOString().slice(0, 10), shots: all }, null, 1) + '\n');
  await browser.close(); server.kill();
}
