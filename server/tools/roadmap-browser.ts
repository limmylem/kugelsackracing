// The Roadmap in a real browser (docs/ROADMAP.md), on this computer: a player's board — the team's items, a vote (shown
// at once, kept), an idea sent (theirs, waiting; nobody else sees it) — and the admin page's Roadmap tab: the idea
// accepted, another rejected with a note its author sees, a bug added from the form; then the board as players see it.
//
//   TEST_DATABASE_URL=postgres://… node server/tools/roadmap-browser.ts      (needs playwright-core and Chromium: PLAYWRIGHT_CORE, CHROMIUM)
//   SHOTS=<dir>  also saves a screenshot of each page there
// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)

import { freshDatabase, testConfig, signUp, makeStaff, totp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }

const PORT = 8794, BASE = `http://localhost:${PORT}`, SHOTS = process.env.SHOTS ?? null;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

const database = await freshDatabase('roadmap_browser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, TRUSTED_ORIGINS: 'http://localhost:8787' });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const outbox = app.deps.mailer.outbox as any[];
await signUp(app, outbox, { email: 'pia@example.com', name: 'Pia Pitlane', ip: '10.9.4.1' });
await signUp(app, outbox, { email: 'rex@example.com', name: 'Rex Redline', ip: '10.9.4.3' });
const boss = await makeStaff(app, await signUp(app, outbox, { email: 'boss@example.com', name: 'Bea Boss', ip: '10.9.4.2' }), 'boss@example.com', 'admin');
await boss.post('/api/v1/admin/roadmap', { kind: 'feature', title: 'Night races in the hills', body: 'Floodlit hill climbs.', status: 'working' });
await boss.post('/api/v1/admin/roadmap', { kind: 'feature', title: 'A garage you can walk around', status: 'planned' });

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const errors: string[] = [];
const signedIn = async (email: string, size = { width: 1300, height: 900 }) => {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r: any) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => errors.push(String(e)));
  await page.goto(`${BASE}/account/`);
  await page.evaluate(async (email: string) => { const { createApi } = await import('/account/api.js'); await createApi().auth('/sign-in/email', { email, password: 'correct horse battery' }); }, email);
  await page.goto(`${BASE}/account/`);
  return page;
};
const openBoard = async (page: any) => {
  await page.evaluate(async () => { const m = await import('/ui/roadmap.js'); m.closeRoadmap(); m.openRoadmap(); });
  await page.waitForSelector('#rmBoard .item', { timeout: 10000 });
};
try {
  // ---------- a player's board ----------
  const page = await signedIn('pia@example.com');
  const shot = async (p: any, name: string) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/roadmap_${name}.png` }); };
  await openBoard(page);
  let text = await page.textContent('#rmBoard');
  check('the board opens: the team\'s items, what\'s being worked on first', /Night races in the hills/.test(text) && /Being worked on/.test(text) && text.indexOf('Night races') < text.indexOf('A garage you can walk'), text.replace(/\s+/g, ' ').slice(0, 300));
  await page.click('#rmBoard .vote');
  await page.waitForFunction(() => document.querySelector('#rmBoard .vote')?.classList.contains('on') && !document.querySelector('#rmBoard .vote')?.disabled, null, { timeout: 10000 });
  check('a vote: shown at once and kept by the server', (await page.textContent('#rmBoard .vote')).includes('1'));
  await page.fill('#rmBoard input[name=title]', 'Drag strips at the airport');
  await page.fill('#rmBoard textarea[name=body]', 'Quarter-mile runs with a tree of lights.');
  await page.click('#rmBoard .send');
  await page.waitForSelector('#rmBoard .good', { timeout: 10000 });
  text = await page.textContent('#rmBoard');
  check('an idea sent: theirs, waiting for an admin; the form empty again', /Your ideas/.test(text) && /Drag strips at the airport/.test(text) && /Waiting for an admin/.test(text) && (await page.inputValue('#rmBoard input[name=title]')) === '');
  await page.fill('#rmBoard input[name=title]', 'Flying cars over the city');
  await page.click('#rmBoard .send');
  await page.waitForFunction(() => document.querySelectorAll('#rmBoard .tag.pending').length === 2, null, { timeout: 10000 });
  await page.click('#rmBoard [data-f="working"]');
  check('the filters: only what\'s being worked on', (await page.$$('#rmBoard .item .vote')).length === 1);
  await shot(page, 'player');

  const rex = await signedIn('rex@example.com');
  await openBoard(rex);
  check('nobody else sees an idea until an admin accepts it', !/Drag strips/.test(await rex.textContent('#rmBoard')));

  // ---------- the admin page's Roadmap tab ----------
  const actx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await actx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r: any) => r.abort());
  const adm = await actx.newPage();
  adm.on('pageerror', (e: any) => errors.push(`admin: ${e}`));
  adm.on('dialog', (d: any) => d.accept(d.type() === 'prompt' ? 'Cars stay on the ground in this one.' : undefined));
  await adm.goto(`${BASE}/account/`);
  await adm.evaluate(async ({ code }: any) => { const { createApi } = await import('/account/api.js'), api = createApi(); await api.auth('/sign-in/email', { email: 'boss@example.com', password: 'correct horse battery' }); await api.auth('/two-factor/verify-totp', { code }); }, { code: totp((boss as any).totpSecret) });
  await adm.goto(`${BASE}/admin/`);
  await adm.waitForSelector('text=Recent admin actions', { timeout: 10000 });
  await adm.click('#tabs button:has-text("Roadmap")');
  await adm.waitForSelector('text=Players\' ideas waiting for you');
  await adm.waitForSelector('tr:has-text("Drag strips at the airport")');
  check('the admin tab: the ideas waiting, with who sent them', /Pia Pitlane/.test(await adm.textContent('tr:has-text("Drag strips at the airport")')));
  await shot(adm, 'admin');
  await adm.click('tr:has-text("Drag strips at the airport") button:has-text("Accept")');
  await adm.waitForSelector('text=Accepted: players see it');
  await adm.click('tr:has-text("Flying cars over the city") button:has-text("Reject")');
  await adm.waitForSelector('text=Rejected: only its author sees it');
  await adm.fill('input[placeholder^="Title"]', 'Cars stop when tiles load');
  await adm.locator('section select').first().selectOption('bug');
  await adm.click('button:has-text("Add to the board")');
  await adm.waitForSelector('text=Added: players see it now.');
  check('accepted, rejected with a note, a bug added: all on the admin tab', /No ideas waiting/.test(await adm.textContent('main')) && /Cars stop when tiles load/.test(await adm.textContent('main')));

  // ---------- the board after ----------
  await openBoard(rex);
  text = await rex.textContent('#rmBoard');
  check('accepted: everyone sees the idea, by its author, and the bug', /Drag strips at the airport/.test(text) && /Idea from Pia Pitlane/.test(text) && /Cars stop when tiles load/.test(text) && !/Flying cars/.test(text));
  await openBoard(page);
  text = await page.textContent('#rmBoard');
  check('the author sees the rejected idea, and why', /Flying cars over the city/.test(text) && /Not this time/.test(text) && /Cars stay on the ground in this one/.test(text));
  await shot(rex, 'after');

  // a phone's width
  const phone = await signedIn('rex@example.com', { width: 390, height: 800 });
  await openBoard(phone);
  const fits = await phone.evaluate(() => { const p = document.querySelector('#rmBoard .panel').getBoundingClientRect(); return p.left >= 0 && p.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  check('on a phone: the board fits the screen', fits);
  await shot(phone, 'phone');
  check('no errors on any page', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await app.close();
  await database.drop?.();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
