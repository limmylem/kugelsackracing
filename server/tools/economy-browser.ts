// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// The server-owned economy in a real browser (Phase 6 Step 2's success check): a server of its own (a fresh
// database), Chromium with the game's own modules —
//   the client's player service (garage/player/remote.js): a purchase shown at once and marked pending, then
//   confirmed; a refusal put back with the server's words (the corner's message); offline: the change paused,
//   then sent once when the connection's back (one charge); two tabs kept in step by the server's events
//   the admin page: a player's money, cars, builds and ledger; money given with a reason; a transaction
//   reversed; the economy's settings with their history; the dashboard
//
//   node server/tools/economy-browser.ts      (needs playwright-core and Chromium: PLAYWRIGHT_CORE, CHROMIUM)

import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig, signUp, makeStaff, passTwoFactorInPage } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';

const PORT = Number(process.env.PORT ?? 8787), BASE = `http://localhost:${PORT}`;  // (the test helpers' origin: the players are made through them)
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

const database = await freshDatabase('ecobrowser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const outbox = app.deps.mailer.outbox as any[];
await signUp(app, outbox, { email: 'pia@example.com', name: 'Pia Pitlane', ip: '10.9.0.1' });
// an admin, as the server wants them: two-factor sign-in on (Phase 6 Step 5)
const bossPlayer = await makeStaff(app, await signUp(app, outbox, { email: 'boss@example.com', name: 'Bea Boss', ip: '10.9.0.2' }), 'boss@example.com', 'admin');
const boss = ((await app.deps.db.execute(sql`select * from users where email = 'boss@example.com'`)).rows[0] as any);
const pia = ((await app.deps.db.execute(sql`select id from users where email = 'pia@example.com'`)).rows[0] as any).id as string;

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const errors: string[] = [];
const newContext = async () => {
  const ctx = await browser.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r: any) => r.abort());
  return ctx;
};
const newPage = async (ctx: any) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => errors.push(String(e)));
  page.on('dialog', (d: any) => d.type() === 'prompt' ? d.accept('Browser test: putting it right') : d.accept());
  return page;
};
const signIn = (page: any, email: string) => page.evaluate(async (email: string) => {
  const { createApi } = await import('/account/api.js'); const api = createApi();
  await api.auth('/sign-in/email', { email, password: 'correct horse battery' });
}, email);
// the game's player service in the page, as garage/session.js makes it (its events and statuses kept for the checks)
const startService = (page: any) => page.evaluate(async () => {
  const { account } = await import('/account/session.js'), { mountAccountChip } = await import('/account/status.js');
  const { loadGarageData } = await import('/garage/data.js'), { RemotePlayerService } = await import('/garage/player/remote.js');
  const A = await account();
  mountAccountChip(A, { welcome: false });
  const readJson = async (p: string) => (await fetch(`/${p}`)).json();
  const { db } = await loadGarageData(readJson);
  const cfg = await A.api.get('/player/config'); db.economy = cfg.economy;
  const w = window as any;
  w.log = []; w.statuses = [];
  const P = w.P = new RemotePlayerService({ api: A.api, db, quests: { config: cfg.quests }, onStatus: (st: any) => { w.statuses.push(st); dispatchEvent(new CustomEvent('kr-economy', { detail: st })); } });
  await P.init();
  P.on((e: any) => w.log.push({ what: e.what, pending: !!e.pending, money: e.profile?.money }));
  return P.profile.money;
});
const ledger = async () => ((await app.deps.db.execute(sql`select kind, amount, reason from ledger where user_id = ${pia} order by id`)).rows as any[]).map(r => ({ ...r, amount: Number(r.amount) }));
const balance = async () => Number(((await app.deps.db.execute(sql`select balance from player_economy where user_id = ${pia}`)).rows[0] as any).balance);

try {
  // ---------- the client: shown at once, confirmed; refused and put back; offline; two tabs ----------
  const ctx = await newContext();
  const tab1 = await newPage(ctx);
  await tab1.goto(`${BASE}/account/?next=/account/`);
  await signIn(tab1, 'pia@example.com');
  const tab2 = await newPage(ctx);
  await tab2.goto(`${BASE}/account/?next=/account/`);
  const start = await startService(tab1);
  await startService(tab2);
  check('the garage from the server: the starting money', start === 6000 && await balance() === 6000, String(start));

  const t0 = Date.now();
  const bought = await tab1.evaluate(async () => {
    const w = window as any, r = await w.P.buyPart('cold_air_intake');
    return { ok: r.ok, money: r.updatedState.money, log: w.log, sawPending: w.statuses.some((s: any) => s.pending === 1) };
  });
  const first = bought.log[0], last = bought.log.at(-1);
  check('a purchase shown at once (pending), then confirmed by the server', bought.ok && first?.pending && first.money === 5650 && !last.pending && last.money === 5650 && bought.sawPending, JSON.stringify(bought.log));
  check('…in good time', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
  await tab2.waitForFunction(() => (window as any).P.profile.money === 5650, null, { timeout: 5000 });
  check('the other tab kept in step (the server\'s events)', true);

  // (the server says no where the page thought yes: the page didn't hear about the money taken away)
  await tab1.evaluate(() => (window as any).P.events.close());
  await app.economy.adminMoney(boss, pia, -5600, 'Browser test: leave too little');
  const refused = await tab1.evaluate(async () => {
    const w = window as any; w.log.length = 0;
    const r = await w.P.buyPart('catback_sport');
    await new Promise(res => setTimeout(res, 50));
    return { ok: r.ok, error: r.error, money: w.P.profile.money, log: w.log, toast: document.getElementById('krToast')?.textContent, shown: document.getElementById('krToast')?.className };
  });
  check('a refusal: put back to the server\'s profile, in plain words', !refused.ok && /Not enough money/.test(refused.error) && refused.money === 50 && refused.log.some((e: any) => e.pending) && refused.log.at(-1).what === 'rollback', JSON.stringify(refused));
  check('…and the corner says so', /Not enough money.*\(Put back as it was\.\)/.test(refused.toast ?? '') && /on/.test(refused.shown ?? ''), refused.toast);

  // offline: paused, then sent once
  await app.economy.adminMoney(boss, pia, 1000, 'Browser test: for the offline purchase');
  await tab1.evaluate(() => (window as any).P.refresh());
  const before = (await ledger()).length;
  await ctx.setOffline(true);
  await tab1.evaluate(() => { const w = window as any; w.offlineBuy = w.P.buyPart('intake_filter_street'); });
  await tab1.waitForFunction(() => (window as any).statuses.some((s: any) => s.paused), null, { timeout: 60000 });
  const paused = await tab1.evaluate(() => ({ chip: document.getElementById('krAccount')?.textContent, toast: document.getElementById('krToast')?.textContent }));
  check('offline: the change paused, with a message', /paused/.test(paused.chip ?? '') && /offline/i.test(paused.toast ?? ''), JSON.stringify(paused));
  check('…and nothing charged while offline', (await ledger()).length === before);
  await ctx.setOffline(false);
  const sent = await tab1.evaluate(async () => { const r = await (window as any).offlineBuy; return { ok: r.ok, money: r.updatedState.money }; });
  const after = await ledger();
  check('back online: sent by itself, charged once', sent.ok && sent.money === 920 && after.length === before + 1 && after.at(-1).amount === -130, JSON.stringify(sent));
  await tab2.waitForFunction(() => (window as any).P.profile.money === 920, null, { timeout: 10000 });
  check('the other tab caught up', true);
  // the game's own garage (garage/session.js), signed in: the server's player service, its prices from the server
  await ctx.route(`${BASE}/economy-blank.html`, (r: any) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title>' }));
  const game = await newPage(ctx);
  await game.goto(`${BASE}/economy-blank.html`);
  const g = await game.evaluate(async () => {
    const { garageSession } = await import('/garage/session.js'), S = await garageSession();
    return { remote: S.player.constructor.name, money: S.player.profile.money, cars: Object.keys(S.player.profile.cars).length };
  });
  check('the game\'s garage, signed in: the server\'s', g.remote === 'RemotePlayerService' && g.money === 920 && g.cars === 1, JSON.stringify(g));
  await ctx.close();

  // ---------- the admin page ----------
  const actx = await newContext(), adm = await newPage(actx);
  await adm.goto(`${BASE}/admin/`);
  await adm.fill('#signIn input[type=email]', 'boss@example.com'); await adm.fill('#signIn input[type=password]', 'correct horse battery');
  await adm.click('#signIn button[type=submit]');
  await passTwoFactorInPage(adm, (bossPlayer as any).totpSecret);
  await adm.waitForSelector('text=Recent admin actions', { timeout: 10000 });
  await adm.fill('input[type=search]', 'Pia'); await adm.click('button:text("Find")');
  await adm.click('.player:has-text("Pia Pitlane")');
  await adm.waitForSelector('h3:text("Ledger (every money change, newest first)")', { timeout: 10000 });
  const page = await adm.textContent('#detail');
  check('a player\'s economy: money, cars and builds, spare parts, the ledger', page.includes('$920') && page.includes('Cars and their builds') && page.includes('Spare parts') && /Bought Cold Air Intake/i.test(page), page.slice(0, 300));
  await adm.fill('input[placeholder="e.g. 500 or -500"]', '250'); await adm.fill('.action:has-text("Give or take money") input[placeholder="Why (required)"]', 'Browser test: a goodwill gift');
  await adm.click('.action:has-text("Give or take money") button:text("Apply")');
  await adm.waitForFunction(() => document.querySelector('#detail')?.textContent?.includes('$1,170'), null, { timeout: 10000 });
  check('money given, with a reason, in the ledger', (await ledger()).some(r => r.amount === 250 && /goodwill gift/.test(r.reason)) && await balance() === 1170);
  // reverse the newest: the gift
  await adm.click('#detail tbody tr:first-child button:text("Reverse")');
  await adm.waitForFunction(() => document.querySelector('#detail')?.textContent?.includes('— reversed'), null, { timeout: 10000 });
  check('a transaction reversed (a new ledger row; the old one kept)', await balance() === 920 && (await ledger()).filter(r => r.amount === 250).length === 1 && (await ledger()).some(r => r.amount === -250));
  const audit = ((await app.deps.db.execute(sql`select action, reason from audit_log where target_id = ${pia} order by id`)).rows as any[]).filter(a => !a.action.startsWith('view'));
  check('…both in the admin log with their reasons', audit.length === 2 && audit.every(a => a.reason?.length > 3), audit.map(a => `${a.action}: ${a.reason}`).join(', '));

  await adm.click('#tabs button:text("Economy settings")');
  await adm.waitForSelector('textarea', { timeout: 10000 });
  await adm.waitForFunction(() => (document.querySelector('textarea') as HTMLTextAreaElement).value.length > 100, null, { timeout: 10000 });
  const cfgText = await adm.inputValue('textarea');
  check('the economy\'s settings shown, with their history', /"economy"/.test(cfgText) && (await adm.textContent('main'))!.includes('(active)'));

  await adm.click('#tabs button:text("Economy dashboard")');
  await adm.waitForSelector('h3:text("Average balance by level")', { timeout: 10000 });
  const dash = (await adm.textContent('main'))!;
  check('the dashboard: totals, ledger checks, alerts, by day and by level', dash.includes('every balance matches its ledger') && dash.includes('All the money in the game') && dash.includes('Bea Boss took'), dash.slice(0, 160));
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
process.exitCode = failed ? 1 : 0;
