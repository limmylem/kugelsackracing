// The ROADBOOK in a real browser (docs/ROADBOOK.md), on this computer: a player's journal — its chapters with a challenge
// done, the Expedition under way, the Season Shop (an item bought with the tokens shown; then theirs), the Personal
// History — and the driving HUD with the development command that takes them to the next Expedition stage.
//
//   TEST_DATABASE_URL=postgres://… node server/tools/roadbook-browser.ts      (needs playwright-core and Chromium: PLAYWRIGHT_CORE, CHROMIUM)
//   SHOTS=<dir>  also saves a screenshot of each page there
// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)

import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }

const PORT = 8793, BASE = `http://localhost:${PORT}`, SHOTS = process.env.SHOTS ?? null;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

const database = await freshDatabase('roadbook_browser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, TRUSTED_ORIGINS: 'http://localhost:8787' });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const outbox = app.deps.mailer.outbox as any[];
const pia = await signUp(app, outbox, { email: 'pia@example.com', name: 'Pia Pitlane', ip: '10.9.3.1' });
await pia.get('/api/v1/player');
const piaId = ((await app.deps.db.execute(sql`select id from users where email = 'pia@example.com'`)).rows[0] as any).id;
// the season on, a race finished (as the server's quest check reports it), tokens to spend
const st = await app.roadbook.status();
await app.roadbook.start(st.current, { by: null });
await app.roadbook.hear(piaId, 'test:race', { type: 'race_finished', data: { questType: 'sprint', medal: 'gold', place: 1, win: true } });
await app.roadbook.grantTokens({ id: piaId }, piaId, 300, 'Browser test', 'browser-test');

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const errors: string[] = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r: any) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => errors.push(String(e)));
  page.on('dialog', (d: any) => d.accept());
  await page.goto(`${BASE}/account/`);
  await page.evaluate(async () => { const { createApi } = await import('/account/api.js'); await createApi().auth('/sign-in/email', { email: 'pia@example.com', password: 'correct horse battery' }); });
  await page.goto(`${BASE}/account/`);
  const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/roadbook_${name}.png` }); };

  // ---------- the journal ----------
  await page.evaluate(async () => { const { roadbook } = await import('/roadbook/client.js'); await roadbook().refresh(); (await import('/ui/roadbook.js')).openRoadbook({ tab: 'chapters' }); });
  await page.waitForSelector('#rbBook .chapter', { timeout: 10000 });
  let text = await page.textContent('#rbBook');
  check('the journal opens: the season, its chapters, a challenge done, points and tokens', /After Hours/.test(text) && /First Night Out/.test(text) && /The Mountain Run/.test(text) && /Opens at 120 points/.test(text) && /\b40\b ROADBOOK points/.test(text) && /320 Season Tokens/.test(text), text.slice(0, 300));
  check('a challenge done is ticked, one in a closed chapter shows its progress', (await page.$$('#rbBook .ch.done')).length === 1);
  await shot('chapters');

  await page.click('#rbBook [data-act="tab:expeditions"]');
  await page.waitForSelector('#rbBook .exp');
  await page.click('#rbBook [data-act="start:midnight_run"]');
  await page.waitForSelector('#rbBook .card h3', { timeout: 10000 });
  text = await page.textContent('#rbBook .exp');
  check('an Expedition started from the journal: its first stage under way', /Now: The meeting spot/.test(text) && /Airport/.test(text), text.slice(0, 200));
  await shot('expeditions');

  await page.click('#rbBook [data-act="tab:shop"]');
  await page.waitForSelector('#rbBook .item');
  const disabled = await page.$$eval('#rbBook .item button[disabled]', bs => bs.map(b => b.textContent));
  check('the shop: every price up front; items too dear say how much more to save', (await page.$$('#rbBook .item')).length === 6 && disabled.some(t => /Save up: 1,180 more/.test(t)), disabled.join(' | '));
  await page.click('#rbBook [data-act="buy:ah_paint_midnight"]');
  await page.waitForFunction(() => /Yours, for good/.test(document.querySelector('#rbBook .shop')?.textContent ?? ''), null, { timeout: 10000 });
  text = await page.textContent('#rbBook');
  check('bought: the item theirs, the tokens spent, the purchase in the token list', /70 Season Tokens/.test(text) && /Bought: Midnight metallic paint/.test(text));
  await shot('shop');

  await page.click('#rbBook [data-act="tab:history"]');
  await page.waitForSelector('#rbBook .stats');
  text = await page.textContent('#rbBook');
  check('the Personal History: what never resets', /driven/.test(text) && /races entered/.test(text) && /places discovered/.test(text));
  await shot('history');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#rbBook .close')?.click());

  // ---------- the HUD while driving, and the development command to the next stage ----------
  await page.evaluate(async () => {
    const THREE = { MeshBasicMaterial: class {}, AdditiveBlending: 2, DoubleSide: 2 };
    const { createRoadbookPlay } = await import('/play/roadbook.js');
    (window as any).RB = createRoadbookPlay({ THREE, w: { scene: { add() {}, remove() {} }, stream: null }, carInstanceId: () => null });
  });
  await page.waitForFunction(() => !document.getElementById('rbHud')?.hidden, null, { timeout: 10000 });
  text = await page.textContent('#rbHud');
  check('the HUD: the Expedition under way, its stage', /The Midnight Run/.test(text) && /The meeting spot/.test(text) && /Stage 1 of 5/.test(text), text);
  await page.evaluate(() => (window as any).kr.roadbook.nextStage());
  await page.waitForFunction(() => /Follow the clue/.test(document.getElementById('rbHud')?.textContent ?? ''), null, { timeout: 10000 });
  text = await page.textContent('#rbHud');
  check('kr.roadbook.nextStage(): there, and the stage done — the next one\'s clue shown, its place not', /Stage 2 of 5/.test(text) && /crosses the river/.test(text), text);
  const toast = await page.textContent('#rbToasts');
  check('what was earned, shown as it\'s earned', /\+150 tokens/.test(toast), toast);
  await shot('hud');
  check('no errors on the page', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error(e);
  results.push(false);
} finally {
  await browser.close();
  await app.close();
  await database.drop?.();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
