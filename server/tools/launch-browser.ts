// The launch screens in a real browser (Phase 6 Step 5), on this computer:
//   a player: "Contact support" on the account page and the in-game Feedback button, each sent with the game's version and
//   device (the feedback with the game's last errors — Phase 7 Step 5); the credits page; the status page
//   an admin (two-factor sign-in): the Support tab shows both messages with their version and device, and answers one by
//   email; the Launch tab closes sign-ups and makes an invite code; a new player can't sign up without it, and does with it
//   (the code's use shown on the Launch tab); Reports & flags and Monitoring open; a player's full history
//
//   TEST_DATABASE_URL=postgres://… node server/tools/launch-browser.ts      (needs playwright-core and Chromium: PLAYWRIGHT_CORE, CHROMIUM)
// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)

import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig, signUp, makeStaff, totp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }

const PORT = 8791, BASE = `http://localhost:${PORT}`;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

const database = await freshDatabase('launch_browser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, TRUSTED_ORIGINS: 'http://localhost:8787' });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const outbox = app.deps.mailer.outbox as any[];
await signUp(app, outbox, { email: 'pia@example.com', name: 'Pia Pitlane', ip: '10.9.1.1' });
const boss = await makeStaff(app, await signUp(app, outbox, { email: 'boss@example.com', name: 'Bea Boss', ip: '10.9.1.2' }), 'boss@example.com', 'admin');

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const errors: string[] = [];
const newPage = async (answer = 'Browser test: launch screens') => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r: any) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => { if (!/a test error/.test(String(e))) errors.push(String(e)); });   // (the feedback check's own are meant)
  page.on('dialog', (d: any) => d.type() === 'prompt' ? d.accept(answer) : d.accept());
  return { ctx, page };
};
const signIn = (page: any, email: string, code?: string) => page.evaluate(async ({ email, code }: any) => {
  const { createApi } = await import('/account/api.js'), api = createApi();
  await api.auth('/sign-in/email', { email, password: 'correct horse battery' });
  if (code) await api.auth('/two-factor/verify-totp', { code });
}, { email, code });
const tickets = async () => (await app.deps.db.execute(sql`select kind, category, message, client from support_tickets order by id`)).rows as any[];

try {
  // ---------- a player: support, feedback, credits, status ----------
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/account/`);
    await signIn(page, 'pia@example.com');
    await page.goto(`${BASE}/account/?mode=support`);
    await page.waitForSelector('h2:text("Contact support")');
    const shown = await page.textContent('section:has(h2:text("Contact support"))');
    await page.selectOption('section:has(h2:text("Contact support")) select', 'bug');
    await page.fill('section:has(h2:text("Contact support")) textarea', 'My garage shows the wrong car after a race.');
    await page.click('section:has(h2:text("Contact support")) button[type=submit]');
    await page.waitForSelector('text=Sent: thanks', { timeout: 10000 });
    let t = await tickets();
    check('"Contact support" sent from the account page, with the game\'s version and device (shown before sending)', t.length === 1 && t[0].kind === 'support' && t[0].category === 'bug' && !!t[0].client?.version && !!t[0].client?.screen && shown!.includes(`Game version ${t[0].client.version}`), JSON.stringify(t[0]?.client));

    // the Feedback button, in the game's corner (as the game mounts the account chip)
    await page.evaluate(async () => {
      const { account } = await import('/account/session.js'), { mountAccountChip } = await import('/account/status.js');
      mountAccountChip(await account(), { welcome: false });
    });
    // (Phase 7 Step 5) the game hits an error twice — its address with an invite code and a token: sent folded, without them
    await page.evaluate(() => { for (let i = 0; i < 2; i++) setTimeout(() => { throw new Error('Boom (a test error) loading https://example.com/x.js?invite=ABCDE-FGHIJ&token=s3cret#t'); }, 0); });
    await page.waitForTimeout(300);
    await page.click('#krFeedback');
    await page.waitForSelector('#krFeedbackBox textarea');
    const info = await page.textContent('#krFeedbackBox .info'), errShown = await page.textContent('#krFeedbackBox .errbox').catch(() => '');
    await page.click('#krFeedbackBox .moods button >> nth=0');
    await page.fill('#krFeedbackBox textarea', 'Love the real streets. The minimap could be bigger.');
    await page.click('#krFeedbackBox .send');
    await page.waitForSelector('#krFeedbackBox h2:text("Thanks!")', { timeout: 10000 });
    t = await tickets();
    check('the Feedback button: a mood and a message, with the version and device', t.length === 2 && t[1].kind === 'feedback' && !!t[1].client?.version && info!.includes(`Game version ${t[1].client.version}`), `${info} · ${JSON.stringify(t[1]?.client)}`);
    const sentErr = t[1]?.client?.errors ?? [], e0 = sentErr.find((e: any) => /Boom/.test(e.message));
    check('…with the game\'s last errors (shown before sending): a repeat folded with its count, the address without its query (no invite code, no token)', /2 errors/.test(errShown ?? '') && !!e0 && e0.count === 2 && /example\.com\/x\.js/.test(e0.message) && !/ABCDE|s3cret|invite=|#t/.test(JSON.stringify(sentErr)), `${(errShown ?? '').slice(0, 120)} · ${JSON.stringify(sentErr).slice(0, 300)}`);

    await page.goto(`${BASE}/account/credits.html`);
    await page.waitForFunction(() => document.body.textContent!.includes('OpenStreetMap') && document.querySelectorAll('tr, li').length > 10, null, { timeout: 10000 });
    const credits = await page.textContent('body');
    check('the credits page: map data, libraries and their licences', /OpenStreetMap/.test(credits!) && /MIT/.test(credits!) && /three/i.test(credits!), `${credits!.length} characters`);

    await page.goto(`${BASE}/site/status.html`);
    await page.waitForFunction(() => /Everything is working/.test(document.body.textContent!), null, { timeout: 10000 }).then(() => check('the status page: everything working', true), async () => check('the status page: everything working', false, (await page.textContent('body'))!.slice(0, 200)));
    await ctx.close();
  }

  // ---------- an admin ----------
  const { ctx: actx, page: adm } = await newPage('Browser test: thanks, we found the bug and it\'s fixed in the next update.');
  await adm.goto(`${BASE}/account/`);
  await signIn(adm, 'boss@example.com', totp((boss as any).totpSecret));
  await adm.goto(`${BASE}/admin/`);
  await adm.waitForSelector('text=Recent admin actions', { timeout: 10000 });

  await adm.click('#tabs button:has-text("Support")');
  await adm.waitForSelector('h2:text("Support and feedback")');
  await adm.waitForSelector('text=My garage shows the wrong car', { timeout: 10000 });
  const sup = await adm.textContent('main');
  check('the Support tab: both messages, from whom, with the game and device', /My garage shows the wrong car/.test(sup!) && /minimap could be bigger/.test(sup!) && /pia@example\.com/.test(sup!) && /version/.test(sup!));
  // (the feedback's errors: under it, collapsed until opened)
  const errBox = adm.locator('tr:has-text("minimap could be bigger") details.errors');
  const closed = await errBox.evaluate((d: any) => !d.open && d.querySelector('summary').textContent).catch(() => null);
  await errBox.locator('summary').click().catch(() => {});
  const opened = await errBox.evaluate((d: any) => d.open && d.innerText).catch(() => null);
  check('…the feedback\'s errors under it, collapsed, opening to the message, where and how often', /1 recent error/.test(closed || '') && /Boom \(a test error\)/.test(opened || '') && /×2/.test(opened || ''), `${closed} · ${(opened || '').slice(0, 160)}`);
  const before = outbox.length;
  await adm.click('tr:has-text("My garage shows the wrong car") button:has-text("Answer")');
  for (let i = 0; i < 50 && outbox.length === before; i++) await adm.waitForTimeout(100);
  const mail = outbox.at(-1);
  check('…answered by email from the Support tab', outbox.length > before && mail?.to === 'pia@example.com' && /fixed in the next update/.test(mail?.text ?? ''), mail?.subject);

  await adm.click('#tabs button:has-text("Launch")');
  await adm.waitForSelector('h2:text("Closed beta")');
  if (/Off: anyone can sign up/.test((await adm.textContent('main'))!)) {
    await adm.click('button:has-text("Close sign-ups (invite only)")');
    await adm.waitForSelector('text=On: signing up needs an invite code', { timeout: 10000 });
  }
  check('the Launch tab: sign-ups closed (invite only)', true);
  await adm.click('button:has-text("Make codes")');
  await adm.waitForSelector('text=Made:', { timeout: 10000 });
  const code = ((await adm.textContent('main'))!.match(/Made: ([A-Z0-9-]+)/) ?? [])[1];
  check('…an invite code made', !!code, code);

  // a new player: refused without the code, let in with it (from the link someone sent)
  {
    const { ctx, page } = await newPage();
    const fill = async (invite: string) => {
      await page.goto(`${BASE}/account/?mode=sign-up${invite ? `&invite=${invite}` : ''}`);
      await page.waitForSelector('input[autocomplete=nickname]');
      await page.fill('input[autocomplete=nickname]', 'Nia Newcomer');
      await page.waitForSelector('.hint.good', { timeout: 5000 });
      await page.fill('input[type=email]', 'nia@example.com');
      await page.fill('input[autocomplete=new-password]', 'correct horse battery');
      await page.fill('input[type=date]', '1999-09-09');
      await page.check('input[type=checkbox]');
    };
    await fill('');
    const inviteField = await page.$('input[maxlength="40"][autocomplete=off]');
    await inviteField!.fill('NOT-A-CODE');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => /invite/i.test(document.querySelector('.msg')?.textContent ?? ''), null, { timeout: 10000 });
    check('closed beta: signing up with a wrong code is refused, and says why', true, await page.textContent('.msg'));
    await fill(code!);
    await page.click('button[type=submit]');
    await page.waitForSelector('text=Check your email', { timeout: 10000 });
    const nia = (await app.deps.db.execute(sql`select u.id from users u where email = 'nia@example.com'`)).rows.length;
    check('…and let in with the code from the link', nia === 1);
    await ctx.close();
  }
  await adm.click('#tabs button:has-text("Launch")');
  await adm.waitForSelector(`text=${code}`, { timeout: 10000 });
  const row = await adm.textContent(`tr:has-text("${code}")`);
  check('…the code\'s use shown on the Launch tab, and who used it', /1 \/ 1/.test(row!) && /Nia Newcomer/.test(row!), row!.replace(/\s+/g, ' ').slice(0, 160));

  await adm.click('#tabs button:has-text("Reports & flags")');
  await adm.waitForSelector('h2:text("Reports")');
  check('the Reports & flags tab opens', true);
  await adm.click('#tabs button:has-text("Monitoring")');
  await adm.waitForSelector('h2:text("Monitoring")', { timeout: 10000 });
  const mon = await adm.textContent('main');
  check('the Monitoring tab: players, requests, the database', /database/i.test(mon!) && /request/i.test(mon!), mon!.replace(/\s+/g, ' ').slice(0, 160));

  await adm.click('#tabs button:has-text("Players")');
  await adm.fill('input[type=search]', 'Pia'); await adm.click('button:text("Find")');
  await adm.click('.player:has-text("Pia Pitlane")');
  await adm.click('button:has-text("Full history")');
  await adm.waitForSelector('h2:text("Support (")', { timeout: 10000 });
  const hist = await adm.textContent('main');
  check('a player\'s full history: their support and feedback among it', /My garage shows the wrong car/.test(hist!) && /minimap could be bigger/.test(hist!));
  await actx.close();

  check('no errors on the pages', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e: any) {
  check('ran to the end', false, e.stack ?? e.message);
} finally {
  await browser.close();
  await app.close();
  await database.drop();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exit(failed ? 1 : 0);
