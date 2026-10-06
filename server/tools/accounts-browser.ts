// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// The account flows in a real browser (Phase 6 Step 1's success check): a server of its own (a fresh
// database, mail into memory so the links can be followed), Chromium on the account page —
//   sign up → confirm by the emailed link → change the name → a copy of the data → sign out → sign in →
//   forget the password → reset it by the link → sign in with the new one
//   play as a guest → accept the terms → make the account → confirm → still the same progress (the guest's
//   save moved to the account in this browser, their server data too) → delete the account
//   the connection chip: online, offline (free roam: quests refused), back online by itself
//   the editor: refused for a player, open for an editor
//
//   node server/tools/accounts-browser.ts      (needs playwright-core and Chromium: PLAYWRIGHT_CORE, CHROMIUM)

import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';

const PORT = Number(process.env.PORT ?? 8791), BASE = `http://localhost:${PORT}`;
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

const database = await freshDatabase('browser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const outbox = app.deps.mailer.outbox as any[];
const linkFor = async (to: string, kind: string) => {
  for (let k = 0; k < 50; k++) { const m = [...outbox].reverse().find(x => x.to === to && x.kind === kind); if (m) return m.text.match(/https?:\/\/\S+/)[0] as string; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`no ${kind} mail for ${to}`);
};
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const errors: string[] = [];
const newPage = async () => {
  const ctx = await browser.newContext({ acceptDownloads: true }), page = await ctx.newPage();
  page.on('pageerror', (e: any) => errors.push(String(e)));
  page.on('dialog', (d: any) => d.accept());
  // (the fonts' host isn't reachable here: nothing to wait for)
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r: any) => r.abort());
  return { ctx, page };
};
const msg = (page: any) => page.textContent('#msg').then((t: string | null) => (t ?? '').trim());

try {
  // ---------- sign up, confirm, name, data, sign out, sign in, reset ----------
  {
    const { page } = await newPage();
    await page.goto(`${BASE}/account/?mode=sign-up&next=/account/`);
    await page.fill('input[autocomplete=nickname]', 'Ola Nordmann');
    await page.waitForSelector('.hint.good', { timeout: 5000 });
    await page.fill('input[type=email]', 'ola@example.com');
    await page.fill('input[autocomplete=new-password]', 'correct horse battery');
    await page.fill('input[type=date]', '1995-05-05');
    await page.check('input[type=checkbox]');
    await page.click('button[type=submit]');
    await page.waitForSelector('text=Check your email');
    check('sign up: asked to confirm by email', true);
    await page.goto(await linkFor('ola@example.com', 'verify-email'));
    await page.waitForSelector('text=Display name', { timeout: 10000 });
    check('the emailed link confirms and signs in', (await page.textContent('h2')) === 'Ola Nordmann');
    await page.fill('section:has(h2:text("Display name")) input', 'Ola Apex');
    await page.click('section:has(h2:text("Display name")) button[type=submit]');
    await page.waitForSelector('h2:text("Ola Apex")');
    check('display name changed (then not again for a month)', (await page.textContent('body'))!.includes('You can change it again'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download my data')]);
    const data = JSON.parse(await (await dl.createReadStream()).toArray().then((b: Buffer[]) => Buffer.concat(b).toString('utf8')));
    check('a copy of my data', data.account?.email === 'ola@example.com' && !JSON.stringify(data).includes('correct horse battery'), dl.suggestedFilename());
    await page.click('section:has(h2:text("Signing out")) button:text("Sign out")');
    await page.waitForSelector('h2:text("Sign in")');
    await page.fill('input[type=email]', 'ola@example.com'); await page.fill('input[type=password]', 'wrong password!!');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#msg')?.textContent?.length);
    check('a wrong password says so', /password/i.test(await msg(page)), await msg(page));
    await page.click('text=Forgot your password?');
    await page.fill('input[type=email]', 'ola@example.com'); await page.click('button[type=submit]');
    await page.waitForFunction(() => /on its way/.test(document.querySelector('#msg')?.textContent ?? ''));
    await page.goto(await linkFor('ola@example.com', 'reset-password'));
    await page.waitForSelector('h2:text("Choose a new password")');
    const pws = await page.$$('input[type=password]');
    await pws[0].fill('a brand new password'); await pws[1].fill('a brand new password');
    await page.click('button[type=submit]');
    await page.waitForSelector('h2:text("Sign in")');
    await page.fill('input[type=email]', 'ola@example.com'); await page.fill('input[type=password]', 'a brand new password');
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.startsWith('/account'), { timeout: 10000 }), page.click('button[type=submit]')]);
    const who = await page.evaluate(async () => (await (await fetch('/api/v1/me')).json()).user?.displayName);
    check('password reset by the emailed link, then signed in with it (and back to the game)', who === 'Ola Apex', who);
  }

  // ---------- a guest, their progress, the account made, deleted ----------
  {
    const { page } = await newPage();
    await page.goto(`${BASE}/account/?next=/account/`);
    await page.click('text=Play as a guest');
    await page.waitForSelector('h2:text("Before you play")');
    await page.fill('input[type=date]', '2000-01-01'); await page.check('input[type=checkbox]');
    await page.click('button[type=submit]');
    await page.waitForSelector('h2:text("Make your account")');
    const guest = await page.evaluate(async () => (await (await fetch('/api/v1/me')).json()).user);
    check('a guest, the terms accepted', guest.isGuest && !guest.needsTerms, guest.displayName);
    // (their progress: a save in this browser, and a record on the server)
    await page.evaluate(async () => {
      const { account } = await import('/account/session.js'); const A = await account();
      const { IdbStorage } = await import('/garage/player/storage.js');
      await new IdbStorage({ key: A.profileKey, legacy: false }).save({ version: 99, money: 12345, marker: 'guest-progress' });
    });
    await app.deps.db.execute(sql`insert into track_records (user_id, code, version, car_class, best_time, best_lap, runs) values (${guest.id}, 'TESTX-00000-00000-00000-00000-0', 3, 'D', 80, 40, 1)`);
    await page.fill('input[autocomplete=nickname]', 'Gus Guest'); await page.fill('input[type=email]', 'gus@example.com');
    await page.fill('input[autocomplete=new-password]', 'correct horse battery'); await page.fill('input[type=date]', '2000-01-01');
    await page.check('input[type=checkbox]'); await page.click('button[type=submit]');
    await page.waitForSelector('text=Check your email');
    await page.goto(await linkFor('gus@example.com', 'verify-email'));
    await page.waitForURL((u: URL) => !u.pathname.startsWith('/account') && !u.pathname.startsWith('/api'), { timeout: 10000 });
    await page.goto(`${BASE}/account/?next=/account/`);
    await page.waitForSelector('h2:text("Gus Guest")', { timeout: 10000 });
    const kept = await page.evaluate(async () => {
      const { account } = await import('/account/session.js'); const A = await account();
      const { IdbStorage } = await import('/garage/player/storage.js'), S = new IdbStorage({ key: A.profileKey, legacy: false });
      if (A.upgradedFrom) await S.adopt(`profile:${A.upgradedFrom}`);
      return { me: A.me, save: await S.load() };
    });
    const rec = (await app.deps.db.execute(sql`select user_id from track_records where code = 'TESTX-00000-00000-00000-00000-0'`)).rows[0] as any;
    check('the guest made their account: the same progress (this browser\'s save, the server\'s records)', !kept.me.isGuest && kept.me.id !== guest.id && kept.save?.marker === 'guest-progress' && rec?.user_id === kept.me.id);
    await page.fill('section:has(h2:text("Delete my account")) input[type=password]', 'correct horse battery');
    await page.fill('input[pattern=DELETE]', 'DELETE');
    await page.click('section:has(h2:text("Delete my account")) button[type=submit]');
    await page.waitForSelector('text=Your account is deleted');
    const gone = (await app.deps.db.execute(sql`select count(*)::int as n from users where email = 'gus@example.com'`)).rows[0] as any;
    check('account deleted (and its records)', gone.n === 0 && ((await app.deps.db.execute(sql`select count(*)::int as n from track_records where code = 'TESTX-00000-00000-00000-00000-0'`)).rows[0] as any).n === 0);
  }

  // ---------- the connection chip: online, offline (free roam), back; the editor gate ----------
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/account/?next=/account/`);
    await page.fill('input[type=email]', 'ola@example.com'); await page.fill('input[type=password]', 'a brand new password');
    await page.click('button[type=submit]'); await page.waitForSelector('h2:text("Ola Apex")');
    const state = () => page.evaluate(async () => {
      const { account } = await import('/account/session.js'), { mountAccountChip } = await import('/account/status.js'), { editorAccess } = await import('/editor/access.js');
      const A = await account();
      if (!document.getElementById('krAccount')) mountAccountChip(A, { welcome: false });
      return { state: A.state, online: A.online, quests: A.questsAllowed, chip: document.getElementById('krAccount')!.className, text: document.getElementById('krAccount')!.textContent, editor: editorAccess(A).allowed };
    });
    let s = await state();
    check('the chip: online, who\'s playing', s.online && s.chip === 'online' && s.text!.includes('Ola Apex'), JSON.stringify(s));
    check('the editor: refused for a player', s.editor === false);
    await ctx.setOffline(true);
    await page.evaluate(async () => { const { account } = await import('/account/session.js'); const A = await account(); await A.api.get('/health', { retries: 0 }).catch(() => {}); });
    s = await state();
    check('offline: shown, free roam only', s.state === 'offline' && s.chip === 'offline' && /free roam/.test(s.text!), JSON.stringify(s));
    await ctx.setOffline(false);
    await page.waitForFunction(() => document.getElementById('krAccount')?.className === 'online', null, { timeout: 15000 });
    check('back online by itself', true);
    await app.deps.db.execute(sql`update users set role = 'editor' where email = 'ola@example.com'`);
    await page.reload(); await page.waitForSelector('h2:text("Ola Apex")');
    s = await state();
    check('the editor: open for an editor', s.editor === true);
  }
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
process.exitCode = failed ? 1 : 0;
