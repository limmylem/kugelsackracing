// The ROADBOOK in a real browser (docs/ROADBOOK.md), on this computer: a player's journal — its chapters with a challenge
// done, the Expedition under way, the Season Shop (an item bought with the tokens shown; then theirs), the Personal
// History — and the driving HUD with the development command that takes them to the next Expedition stage; and the admin
// page's ROADBOOK tab: the season's clock, a shop price changed in its form and saved as a new version, live at once.
//
//   TEST_DATABASE_URL=postgres://… node server/tools/roadbook-browser.ts      (needs playwright-core and Chromium: PLAYWRIGHT_CORE, CHROMIUM)
//   SHOTS=<dir>  also saves a screenshot of each page there
// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)

import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig, signUp, makeStaff, totp } from '../test/helpers.ts';
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
const boss = await makeStaff(app, await signUp(app, outbox, { email: 'boss@example.com', name: 'Bea Boss', ip: '10.9.3.2' }), 'boss@example.com', 'admin');
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
    // (the quests' route guide and the world's clock, as the game hands them over: what they're asked to do, kept)
    const calls: any = { guide: [], cleared: 0, hours: [] };
    const Q: any = { active: false, guideFor: null, guideLine: null, setGuide(to: any) { calls.guide.push(to); Q.guideFor = to.id; }, clearGuide() { calls.cleared++; Q.guideFor = null; } };
    (window as any).RBcalls = calls;
    (window as any).RB = createRoadbookPlay({ THREE, w: { scene: { add() {}, remove() {} }, stream: null }, carInstanceId: () => null, quests: () => Q, setHours: (h: any) => calls.hours.push(h) });
  });
  await page.waitForFunction(() => !document.getElementById('rbHud')?.hidden, null, { timeout: 10000 });
  text = await page.textContent('#rbHud');
  check('the HUD: the Expedition under way, its stage', /The Midnight Run/.test(text) && /The meeting spot/.test(text) && /Stage 1 of 5/.test(text), text);
  // a frame across town from the meeting spot: the way there on the road and the maps, a pin at its end; midnight
  await page.evaluate(() => (window as any).RB.frame(0, { lat: -34.9238, lon: 138.5999 }));
  let calls = await page.evaluate(() => (window as any).RBcalls);
  check('the way there: the route guide set to the meeting spot, with a pin on the maps', calls.guide.length === 1 && calls.guide[0].pin === true && Math.abs(calls.guide[0].location.lat - -34.94144) < 1e-6 && calls.guide[0].id === 'rb:midnight_run:meet:meet', JSON.stringify(calls.guide));
  check('the Midnight Run at midnight: the world\'s clock set to 0:00', calls.hours.length === 1 && calls.hours[0] === 0, JSON.stringify(calls.hours));
  await page.evaluate(() => (window as any).RB.frame(0, { lat: -34.9238, lon: 138.5999 }));
  calls = await page.evaluate(() => (window as any).RBcalls);
  check('…set once, not every frame', calls.guide.length === 1 && calls.hours.length === 1);
  await page.evaluate(() => (window as any).kr.roadbook.nextStage());
  await page.waitForFunction(() => /Follow the clue/.test(document.getElementById('rbHud')?.textContent ?? ''), null, { timeout: 10000 });
  text = await page.textContent('#rbHud');
  check('kr.roadbook.nextStage(): there, and the stage done — the next one\'s clue shown, its place not', /Stage 2 of 5/.test(text) && /crosses the river/.test(text), text);
  await page.evaluate(() => (window as any).RB.frame(0, { lat: -34.9414, lon: 138.5318 }));
  calls = await page.evaluate(() => (window as any).RBcalls);
  check('the clue\'s stage: no way shown (the route taken off) until its place is found', calls.cleared === 1 && calls.guide.length === 1, JSON.stringify(calls));
  const toast = await page.textContent('#rbToasts');
  check('what was earned, shown as it\'s earned', /\+150 tokens/.test(toast), toast);
  await shot('hud');
  check('no errors on the page', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ---------- the admin page's ROADBOOK tab ----------
  const actx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await actx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r: any) => r.abort());
  const adm = await actx.newPage();
  const aErrors: string[] = [];
  adm.on('pageerror', (e: any) => aErrors.push(String(e)));
  adm.on('dialog', (d: any) => d.accept());
  await adm.goto(`${BASE}/account/`);
  await adm.evaluate(async ({ code }: any) => { const { createApi } = await import('/account/api.js'), api = createApi(); await api.auth('/sign-in/email', { email: 'boss@example.com', password: 'correct horse battery' }); await api.auth('/two-factor/verify-totp', { code }); }, { code: totp((boss as any).totpSecret) });
  await adm.goto(`${BASE}/admin/`);
  await adm.waitForSelector('text=Recent admin actions', { timeout: 10000 });
  await adm.click('#tabs button:text-is("ROADBOOK")');
  await adm.waitForSelector('main button:text-is("Places")', { timeout: 15000 });
  let atext = await adm.textContent('main');
  check('the admin tab: the season\'s clock — live, its players and tokens', /live/i.test(atext) && /After Hours/.test(atext), atext.slice(0, 300));
  if (SHOTS) await adm.screenshot({ path: `${SHOTS}/roadbook_admin_season.png`, fullPage: false });
  await adm.click('main button:text-is("Shop")');
  const price = adm.locator('main label:has-text("Price (Season Tokens)") input').first();
  await price.waitFor({ timeout: 10000 });
  await price.fill('120');
  await price.dispatchEvent('input'); await price.dispatchEvent('change');
  if (SHOTS) await adm.screenshot({ path: `${SHOTS}/roadbook_admin_shop.png`, fullPage: false });
  await adm.fill('input[placeholder^="Why this change"]', 'Browser test: the badge a little dearer');
  await adm.click('button:text-is("Save as a new version")');
  await adm.waitForFunction(async () => { const r = await fetch('/api/v1/admin/roadbook', { credentials: 'include' }); const b = await r.json(); return b.version === 2; }, null, { timeout: 15000 }).catch(() => {});
  const after = await (await adm.request.get(`${BASE}/api/v1/admin/roadbook`)).json();
  check('a price changed in the form, saved with a reason: a new version, live at once', after.version === 2 && after.data.seasons.after_hours.shop.items[0].price === 120 && after.versions[0].reason === 'Browser test: the badge a little dearer' && after.versions[0].actor === 'Bea Boss', JSON.stringify(after.versions?.[0]));
  const piaView = await pia.get('/api/v1/roadbook');
  check('…and the players\' shop shows it', piaView.body.shop[0].price === 120);
  check('no errors on the admin page', aErrors.length === 0, aErrors.join(' | '));
  await actx.close();
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
