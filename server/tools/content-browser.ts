// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// The content manager in a real browser (Phase 8 Step 3; the admin page's Content tab): a server of its own (a fresh
// database), an admin signed in — the parts listed with their status and checks; filtered by family; one opened (its
// checks, stats with ranges, history) with its 3D preview drawn on a car; published; several picked and their price
// changed in bulk (new draft versions); the game's config then says what's published.
//
//   node server/tools/content-browser.ts [--shots dir] [--local-libs]   (playwright-core and Chromium, as shop-browser.ts)

import path from 'node:path';
import fs from 'node:fs';
import { freshDatabase, testConfig, signUp, makeStaff, totp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';

const args = process.argv.slice(2), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const PORT = Number(process.env.PORT ?? 8787), BASE = `http://localhost:${PORT}`;
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const checks = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/content/checks.json'), 'utf8'));
const partFile = (id: string) => { for (const d of fs.readdirSync(path.join(REPO_DIR, 'data/parts'))) { const f = path.join(REPO_DIR, 'data/parts', d, `${id}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } return null; };
const draft = Object.keys(checks.parts).find(id => checks.parts[id].ok && partFile(id)?.status === 'draft' && partFile(id)?.generated?.family);
const family = partFile(draft).generated.family;

const database = await freshDatabase('contentbrowser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, ...(PORT !== 8787 ? { TRUSTED_ORIGINS: 'http://localhost:8787' } : {}) });
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
page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });   // (fonts are blocked here; the page asks who's signed in before the sign-in)
// (5% cheaper: the picked parts' prices stay inside their tier's band — some drafts sit at its top)
page.on('dialog', async (d: any) => d.accept(d.message().includes('Price ×') ? '0.95' : 'Test: from the content browser check'));
const shot = async (name: string) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }); };
try {
  await page.goto(`${BASE}/admin/`);
  await page.evaluate(async (code: string) => { const { createApi } = await import('/account/api.js'), api = createApi(); await api.auth('/sign-in/email', { email: 'boss@example.com', password: 'correct horse battery' }); await api.auth('/two-factor/verify-totp', { code }); }, totp((boss as any).totpSecret));
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector('#tabs button');
  await page.click('#tabs button:has-text("Content")');
  await page.waitForSelector('table tr td input[type=checkbox]', { timeout: 30000 });
  const total = await page.textContent('section .list > .muted');
  check('the parts listed, with their status and checks', /\d[\d,]* parts/.test(total ?? ''), total ?? '');
  await shot('content-list');
  // filtered to the family
  await page.selectOption('label:has-text("Family") select', family);
  await page.waitForFunction((f: string) => [...document.querySelectorAll('section table tr td .muted')].length > 0 && [...document.querySelectorAll('section table tr td .muted')].every(e => e.textContent.includes(f)), family, { timeout: 20000 });
  const rows = await page.$$eval('section table tr td a', (as: any[]) => as.length);
  check(`filtered to the ${family} family`, rows >= 6, `${rows} rows`);
  // one opened: checks, stats, history, the 3D preview
  await page.click(`section table tr td a:has-text("${partFile(draft).name}")`);
  await page.waitForSelector('#contentDetail h3:has-text("Checks")', { timeout: 20000 });
  const detail = await page.textContent('#contentDetail');
  check('one opened: its checks and its stats with their ranges', /fit/.test(detail) && /drive/.test(detail) && /Save a new version/.test(detail), detail.slice(0, 160));
  await page.waitForFunction(() => /Fitted|wouldn't go on|No preview/.test(document.querySelector('#contentDetail .list .muted:last-child')?.textContent ?? ''), null, { timeout: 90000 });
  const p3d = await page.evaluate(() => { const c = document.querySelector('#contentDetail canvas') as HTMLCanvasElement; return { canvas: !!c, w: c?.width, note: document.querySelector('#contentDetail .list .muted:last-child')?.textContent }; });
  await page.waitForTimeout(1500);
  check('its 3D preview drawn on a car it fits', p3d.canvas && p3d.w > 100 && /Fitted/.test(p3d.note), JSON.stringify(p3d));
  await shot('content-detail');
  // published
  await page.click('#contentDetail button:has-text("Publish")');
  await page.waitForFunction(() => /Now published|Not published/.test(document.querySelector('#contentDetail .msg')?.textContent ?? ''), null, { timeout: 20000 });
  check('published (its checks pass)', /Now published/.test(await page.textContent('#contentDetail .msg')));
  const cfg = await page.evaluate(async () => (await (await fetch('/api/v1/player/config')).json()).content);
  check('the game is told it\'s published', cfg?.parts?.[draft]?.status === 'published', JSON.stringify(cfg?.parts?.[draft]));
  // several picked, their price changed
  const boxes = await page.$$('section table tr td input[type=checkbox]');
  for (const b of boxes.slice(0, 3)) await b.check();
  await page.click('button:has-text("Price ×")');
  await page.waitForFunction(() => /changed: new draft versions/.test(document.querySelector('section .msg')?.textContent ?? ''), null, { timeout: 20000 }).catch(async e => { throw new Error(`no bulk change: ${await page.textContent('section .msg').catch(() => '')}`); });
  check('three picked and their price changed in bulk: new draft versions', true, await page.textContent('section .msg'));
  await shot('content-bulk');
  check('no errors on the page', !errors.length, errors.slice(0, 3).join(' | '));
} catch (e) { check('the run', false, String(e?.stack ?? e).slice(0, 500)); await shot('content-error'); }
finally {
  await browser.close();
  await app.close();
  await database.drop();
}
const ok = results.every(Boolean);
console.log(ok ? `\nAll ${results.length} checks passed.` : `\n${results.filter(x => !x).length} of ${results.length} failed.`);
process.exit(ok ? 0 : 1);
