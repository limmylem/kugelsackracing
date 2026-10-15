// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// The family builder in a real browser (the admin page's Builder tab › New family; docs/CONTENT_PIPELINE.md): a server
// of its own (a fresh database), an admin signed in — a new exhaust family picked step by step: its kind, a suggested
// name (checked against real brands), settings within their ranges (one outside refused), a shape setting with the live
// 3D shape, finishes, an aim, the cars it fits — every part it'd make listed with its tier and price before anything is
// made; a preview (thumbnails, one on a car in 3D); made as a job, then cancelled (everything put back); the jobs list;
// an existing family changed (what it adds, changes and retires); a new engine's live torque curve; variations planned.
//
//   node server/tools/builder-browser.ts [--shots dir] [--local-libs]      (playwright-core and Chromium, as content-browser.ts)

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { freshDatabase, testConfig, signUp, makeStaff, totp, endTest } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';

const args = process.argv.slice(2), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const PORT = Number(process.env.PORT ?? 8793), BASE = `http://localhost:${PORT}`;
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const files = () => execSync('git status --short --untracked-files=all -- data assets', { cwd: REPO_DIR }).toString();

const database = await freshDatabase('builderbrowser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, TRUSTED_ORIGINS: 'http://localhost:8787' });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const boss = await makeStaff(app, await signUp(app, app.deps.mailer.outbox as any[], { email: 'boss@example.com', name: 'Bea Boss', ip: '10.9.0.4' }), 'boss@example.com', 'admin');

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors: string[] = [];
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r: any) => r.abort());
if (args.includes('--local-libs')) {
  const nm = path.join(REPO_DIR, 'node_modules');
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
}
const page = await ctx.newPage();
page.on('pageerror', (e: any) => errors.push(String(e)));
page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
let answer = 'Test: from the builder browser check';
page.on('dialog', async (d: any) => d.type() === 'prompt' ? d.accept(/leave it off/i.test(d.message()) ? 'it doesn\'t suit it' : /preset/i.test(d.message()) ? 'Browser test setup' : answer) : d.accept());
const shot = async (name: string) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }); };
const left = 'main > section:nth-child(1)', right = 'main > section:nth-child(2)';
const step = async (n: string) => { await page.click(`${left} button:has-text("${n}")`); await page.waitForTimeout(150); };
const summaryCount = async () => (await page.textContent(`${right} b`).catch(() => '')) ?? '';

try {
  const before = files();
  await page.goto(`${BASE}/admin/`);
  await page.evaluate(async (code: string) => { const { createApi } = await import('/account/api.js'), api = createApi(); await api.auth('/sign-in/email', { email: 'boss@example.com', password: 'correct horse battery' }); await api.auth('/two-factor/verify-totp', { code }); }, totp((boss as any).totpSecret));
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector('#tabs button');
  await page.click('#tabs button:has-text("Builder")');
  await page.waitForSelector('button:has-text("New family")', { timeout: 30000 });
  const home = await page.textContent('main');
  check('the Builder tab: its own page in the admin menu, with New family, New engine, New car, presets and jobs, and the families to change', ['New family', 'New engine', 'New car', 'Presets & variations', 'Jobs', 'Change a family', 'Streetline'].every(t => home.includes(t)), home.slice(0, 160));
  await page.click('button:has-text("New family")');
  await page.waitForSelector('h2:text("New family")', { timeout: 30000 });

  // 1. what it is
  await page.click(`${left} .action:has-text("Cat-back exhaust")`);
  await page.waitForTimeout(400);
  // 2. a suggested name
  await step('2. Name');
  await page.click('button:has-text("Suggest names")');
  await page.waitForSelector(`${left} .row button.btn.ghost >> nth=0`);
  const suggested = await page.$$eval(`${left} .row:has(button:has-text("Suggest names")) button`, (bs: any[]) => bs.slice(1).map(b => b.textContent));
  await page.click(`${left} .row:has(button:has-text("Suggest names")) button >> nth=1`);
  await page.waitForSelector(`${left} span:has-text("Its id")`, { timeout: 10000 });
  const name = await page.inputValue(`${left} label:has-text("Name") input`);
  check('a suggested name, checked against real brands (its id shown)', suggested.length >= 3 && name.length >= 3, `${suggested.join(', ')} → ${name}`);
  await page.fill(`${left} label:has-text("Name") input`, 'Bremboline');
  await page.waitForSelector(`${left} span:has-text("real make or brand")`, { timeout: 10000 });
  check('a name with a real brand in it refused, with the reason', true);
  await page.fill(`${left} label:has-text("Name") input`, name);
  await page.waitForSelector(`${left} span:has-text("Its id")`, { timeout: 10000 });

  // 3. settings within their ranges
  await step('3. Settings');
  const addDiameter = `${left} .action:has-text("pipe diameter") input[type=number]`;
  for (const v of ['60', '76']) { await page.fill(addDiameter, v); await page.press(addDiameter, 'Tab'); await page.waitForTimeout(150); }
  await page.fill(addDiameter, '200'); await page.press(addDiameter, 'Tab');
  await page.waitForSelector(`${left} .msg.bad:has-text("50–110 mm")`, { timeout: 5000 });
  check('a value outside the allowed range can\'t be picked (the range shown with it)', (await page.textContent(`${left} .action:has-text("pipe diameter")`)).includes('allowed: 50–110 mm'));
  await page.click(`${left} .action:has-text("material") button:has-text("mild steel")`);
  await page.click(`${left} .action:has-text("material") button:has-text("stainless")`);
  await page.click(`${left} .action:has-text("tips") button:has-text("quad")`);
  // 4. shape, with its live 3D model
  await step('4. Shape');
  await page.selectOption(`${left} .action:has-text("tip end") select`, 'slash');
  await page.waitForSelector(`${left} span:has-text("triangles (budget")`, { timeout: 30000 });
  const tri = await page.textContent(`${left} span:has-text("triangles (budget")`);
  check('the shape step: a live 3D model of a part beside its shape settings, with its triangles against the budget', !!(await page.$(`${left} canvas`)) && /\d+ triangles/.test(tri), tri);
  await shot('builder-shape');
  // 5. finishes, 6. aim, 7. fits
  await step('5. Finishes');
  await page.click(`${left} button:has-text("matte black")`);
  await step('6. Aim');
  await page.click(`${left} button:has-text("sport (")`);
  await step('7. Fits');
  await page.waitForSelector(`${left} table tr:has-text("Leave it off")`, { timeout: 10000 });
  const fitsText = await page.textContent(`${left} p.muted`);
  check('the cars it fits, with a count', /It goes on \d+ of \d+ cars/.test(fitsText), fitsText);
  await page.waitForFunction(() => /8 parts/.test(document.querySelector('main > section:nth-child(2) b')?.textContent ?? ''), null, { timeout: 30000 });
  const rows = await page.$$eval(`${right} table tr`, (trs: any[]) => trs.filter(t => t.querySelector('td')).length);
  const table = await page.textContent(`${right} table`);
  check('every part it\'d make listed before anything is made: 8 (2 × 2 × 2), each with its tier and price', rows === 8 && /street|sport|race/.test(table) && /\$\d/.test(table), `${await summaryCount()} · ${rows} rows`);
  check('the aim it misses warned, with what to change', /miss the aim/.test(await page.textContent(right)), '');
  await shot('builder-summary');

  // a preview: thumbnails, one on a car
  await page.click(`${left} button:has-text("Preview")`);
  await page.waitForSelector(`${right} img[alt="Studio thumbnail"]`, { timeout: 180000 });
  const thumbs = await page.$$eval(`${right} img[alt="Studio thumbnail"]`, (is: any[]) => is.filter(i => i.complete && i.naturalWidth > 0).length);
  check('Preview: a few parts made (models, studio thumbnails), nothing saved as a part', thumbs >= 2 && files() === before, `${thumbs} thumbnails`);
  await page.click(`${right} .action button:has-text("Show it") >> nth=0`);
  await page.waitForFunction(() => /Fitted|wouldn't go on/.test([...document.querySelectorAll('main > section:nth-child(2) .muted')].map(e => e.textContent).join(' ')), null, { timeout: 60000 });
  check('a previewed part on a car, in 3D', (await page.$$(`${right} canvas`)).length >= 1);
  await shot('builder-preview');

  // made as a job, then cancelled: everything put back
  await page.click(`${left} button:has-text("Make the family")`);
  await page.waitForSelector(`${right} .action b:has-text("New family:")`, { timeout: 20000 });
  await page.waitForFunction(() => /check|thumbnails|verify/.test(document.querySelector('main > section:nth-child(2) .action .muted')?.parentElement?.textContent ?? ''), null, { timeout: 120000 });
  const fileShown = await page.textContent(`${right} details`);
  answer = 'Test: cancelling it';
  await page.click(`${right} .action button:has-text("Cancel")`);
  await page.waitForSelector(`${right} .badge:text("cancelled")`, { timeout: 60000 });
  check('Make the family: its file shown, built and checked as a job with its log — cancelled: nothing it did is kept', /"status": "draft"/.test(fileShown) && files() === before, files().slice(0, 300));
  await shot('builder-cancelled');

  // the jobs list
  await page.click('#tabs button:has-text("Builder")');
  await page.click('button:has-text("Jobs")');
  await page.waitForSelector('h2:text("Jobs")');
  await page.waitForSelector('main .action .badge', { timeout: 10000 });
  const jobsText = await page.textContent('main');
  check('the jobs: each with its state and log', /Preview:/.test(jobsText) && /cancelled/.test(jobsText) && /done/.test(jobsText));

  // an existing family changed: what will change
  await page.click('#tabs button:has-text("Content")');
  await page.waitForSelector('label:has-text("Family") select', { timeout: 30000 });
  await page.selectOption('label:has-text("Family") select', 'streetline');
  await page.click('button:has-text("Change streetline in the builder")', { timeout: 20000 });
  await page.waitForSelector('h2:text("Change family: Streetline")', { timeout: 30000 });
  await page.click(`${left} .action:has-text("pipe diameter") button:has-text("57 mm ✕")`);
  await page.waitForSelector(`${right} .action:has-text("What saving changes")`, { timeout: 30000 });
  const ch = await page.textContent(`${right} .action:has-text("What saving changes")`);
  check('changing a family: what it retires (and how many players own each), ids kept for the rest', /Retired \(not sold; players keep theirs\) \(6\)/.test(ch) && /streetline_57_/.test(ch) && /player/.test(ch), ch.slice(0, 200));
  await shot('builder-change');

  // a new engine: a live torque curve, the cars it fits and why not
  await page.click('#tabs button:has-text("Builder")');
  await page.click('button:has-text("New engine")');
  await page.waitForSelector('h2:text("New engine")', { timeout: 20000 });
  await page.fill(`${left} label:has-text("Id") input`, 'vmc_i4_18');
  await page.press(`${left} label:has-text("Id") input`, 'Tab');
  await page.waitForSelector(`${right} svg polyline`, { timeout: 20000 });
  const eng = await page.textContent(right);
  check('New engine: its torque curve, power, bay and price, and the cars it goes in (and why not the others)', /hp/.test(eng) && /bay/.test(eng) && /\$\d/.test(eng) && /its engine sits|its bay is|✔/.test(eng), eng.slice(0, 160));
  await shot('builder-engine');

  // variations planned from a family
  await page.click('#tabs button:has-text("Builder")');
  await page.click('button:has-text("Presets & variations")');
  await page.waitForSelector('h2:text("Make variations")');
  await page.selectOption(`${left} label:has-text("Start from") select`, 'family:aerofoil');
  await page.click(`${left} button:has-text("wing profile (shape)")`);
  await page.click(`${left} button:has-text("end plates (shape)")`);
  await page.click(`${left} button:has-text("Plan them")`);
  await page.waitForSelector(`${right} .action input[maxlength="24"]`, { timeout: 60000 });
  const vars = await page.$$eval(`${right} .action input[maxlength="24"]`, (is: any[]) => is.map(i => i.value));
  check('variations: new designs from a family, each with an invented name and what it\'d make', vars.length >= 3 && vars.every(v => v.length >= 3) && new Set(vars).size === vars.length, vars.join(', '));
  await shot('builder-variations');

  check('no errors on the page', !errors.length, errors.slice(0, 3).join(' | '));
  check('the repository\'s files as they were', files() === before);
} catch (err) {
  check('the browser check ran through', false, err.stack ?? String(err));
  await shot('builder-error');
} finally {
  await browser.close();
  await app.close();
  await database.drop();
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  endTest(failed);
}
