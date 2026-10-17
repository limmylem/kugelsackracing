// The garage's slot lists in a real browser (garage/garageUi.js): every slot reachable without clicking a marker on the
// car — an area's list (hovering a row lights its marker), All parts with its search, the slot panel's arrows and [ ]
// going on through every area — and the markers pushed apart so none sits on another (the underside: the most of them).
//
//   node tools/garage-slots-browser.mjs        (needs playwright-core and Chromium: PLAYWRIGHT_CORE, CHROMIUM)
//   SHOTS=<dir>  also saves a screenshot of each step there

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), nm = path.join(root, 'node_modules'), SHOTS = process.env.SHOTS ?? null;
let pw;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const exe = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(port)], { env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

const browser = await pw.chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`${e.message} @ ${(e.stack ?? '').split('\n')[1]?.trim() ?? ''}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: path.join(nm, 'three', new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')), contentType: 'text/javascript' }));
  await page.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: path.join(nm, '@dimforge/rapier3d-compat/dist/rapier.mjs'), contentType: 'text/javascript' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  for (let tries = 0; ; tries++) { try { await page.goto(`http://127.0.0.1:${port}/dev/garage.html`); break; } catch (e) { if (tries > 20) throw e; await page.waitForTimeout(250); } }
  await page.waitForSelector('[data-act="area:engine_bay"]', { timeout: 90000 });
  await page.waitForTimeout(2500);
  const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/garage_slots_${name}.png` }); };
  const screen = () => page.evaluate(async () => { const s = (await import('/garage/garage.js')).debug.screen; return { socket: s.ui.socket, panel: s.ui.panel }; });
  const total = await page.evaluate(async () => (await import('/garage/garage.js')).debug.workshop.sockets().length);

  // an area: its list
  await page.click('[data-act="area:engine_bay"]'); await page.waitForTimeout(1200);
  const rows = await page.$$eval('.g-side [data-hover]', r => r.map(x => x.dataset.hover));
  check('a focus area opens the list of its slots', rows.length >= 3, `${rows.length} slots in the engine bay`);
  await page.hover(`.g-side [data-hover="${rows[1]}"]`); await page.waitForTimeout(400);
  check('… pointing at one lights its marker on the car', await page.evaluate(n => { const m = document.querySelector(`.g-marker.lit[data-act="marker:${n}"]`); return !!m && m.style.display !== 'none'; }, rows[1]));
  await shot('area');
  await page.click(`.g-side [data-hover="${rows[0]}"]`); await page.waitForTimeout(800);
  const first = (await screen()).socket;
  await page.click('[data-act="step:1"]'); await page.waitForTimeout(600);
  const second = (await screen()).socket;
  check('a slot opens from it; the arrow goes to the next slot', first === rows[0] && second === rows[1], `${first} → ${second}`);
  await page.keyboard.press('BracketLeft'); await page.waitForTimeout(600);
  check('… [ back again', (await screen()).socket === first);
  await shot('slot');
  await page.click('.g-side [data-act="close"]'); await page.waitForTimeout(600);
  check('… closing it goes back to the list', (await screen()).panel === 'list' && (await page.$$('.g-side [data-hover]')).length === rows.length);

  // all of them, and the search
  await page.click('[data-act="area:all"]'); await page.waitForTimeout(1000);
  const all = await page.$$eval('.g-side [data-hover]', r => r.length);
  check('All parts: every slot on the car in one list', all === total, `${all} of ${total}`);
  await page.fill('[data-key="slots-q"]', 'brake'); await page.waitForTimeout(600);
  const found = await page.$$eval('.g-side [data-hover] .sn', r => r.map(x => x.textContent));
  check('… the search keeps the ones that match', found.length > 0 && found.length < all && found.every(n => /brake/i.test(n)), found.join(', '));
  await shot('all');
  await page.fill('[data-key="slots-q"]', ''); await page.waitForTimeout(400);

  // ] through every slot of every area
  await page.click('.g-side [data-hover]'); await page.waitForTimeout(600);
  const seen = new Set([(await screen()).socket]);
  for (let i = 0; i < total; i++) { await page.keyboard.press('BracketRight'); await page.waitForTimeout(80); seen.add((await screen()).socket); }
  check('] goes through every slot of every area, and round again', seen.size === total, `${seen.size} of ${total}`);

  // the markers: none on another
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  await page.click('[data-act="area:underside"]'); await page.waitForTimeout(2500);
  const crowd = await page.evaluate(() => {
    const ms = [...document.querySelectorAll('.g-marker')].filter(m => m.style.display !== 'none');
    const at = ms.map(m => m.getBoundingClientRect()), tags = ms.filter(m => m.classList.contains('labelled')).map(m => m.querySelector('.tag').getBoundingClientRect());
    let dots = 0, labels = 0;
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) if (Math.hypot(at[i].left - at[j].left, at[i].top - at[j].top) < 18) dots++;
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) { const a = tags[i], b = tags[j]; if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) labels++; }
    return { markers: ms.length, dots, labels };
  });
  check('the markers under the car: none on top of another, no name over another', crowd.markers > 5 && crowd.dots === 0 && crowd.labels === 0, JSON.stringify(crowd));
  await shot('underside');
  check('no errors on the page', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
