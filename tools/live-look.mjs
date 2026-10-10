// The live game in a real browser (docs/OPERATIONS.md): each page opened, and everything that went wrong on it — the
// console's errors and warnings, failed requests, answers of 400 and over — printed. Read only: it signs in to nothing.
//   node tools/live-look.mjs [--game https://ognistrada.com]   (run by .github/workflows/live-look.yml)
import { chromium } from 'playwright';

const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const GAME = opt('--game', 'https://ognistrada.com');
// (a few files fetched as they are: what comes back, and from where)
for (const f of (opt('--files', '/editor/roads.js,/editor/markers3d.js,/testtrack/test-scene.js,/site/config.js')).split(',')) {
  const r = await fetch(`${GAME}${f}`, { redirect: 'manual' });
  console.log(`${f}: ${r.status} ${r.headers.get('content-type')} · ${r.headers.get('location') ?? ''} · cf-cache ${r.headers.get('cf-cache-status') ?? '-'} · ${(await r.text()).slice(0, 80).replace(/\s+/g, ' ')}`);
}
const browser = await chromium.launch();
for (const [name, url, wait] of [['the account page', `${GAME}/account/`, 15000], ['the game', `${GAME}/`, 45000]]) {
  console.log(`\n== ${name}: ${url}`);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  console ${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', e => console.log(`  page error: ${String(e.stack ?? e).slice(0, 600)}`));
  page.on('requestfailed', r => console.log(`  request failed: ${r.method()} ${r.url().slice(0, 200)} — ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) console.log(`  answer ${r.status()}: ${r.request().method()} ${r.url().slice(0, 200)}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(e => console.log(`  goto: ${e.message}`));
  await page.waitForTimeout(wait);
  console.log(`  shows: ${(await page.textContent('body').catch(() => ''))?.replace(/\s+/g, ' ').trim().slice(0, 400)}`);
  await page.screenshot({ path: `live-${name.replace(/\W+/g, '-')}.png` });
}
await browser.close();
