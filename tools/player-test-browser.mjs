// The scripted player test (Phase 5 Step 4), in a browser: in the real world (San Francisco), a race venue
// with an official track event is published; fast travel to it; its race on the generated track (the quest
// autopilot drives); the race replay watched (TV cameras, chase, in-car, the next action) and closed; back
// to the real world on the very spot; the day's track from the track library, raced for a minute, then
// quit back to the real world; its code loaded as a friend's shared code (the same track and hash); a
// repair and a part bought (PlayerService, as the garage's buttons call it). Fails on any page error.
// Needs playwright-core and a Chromium (npm i -D playwright-core; CHROMIUM=/path/to/chrome); about 30
// minutes with software rendering. Screenshots: --out dir (default reports/player-test).
//
//   node tools/player-test-browser.mjs [--out reports/player-test] [--swiftshader]

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname, args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const port = 7741, out = opt('--out', `${root}/reports/player-test`);
fs.mkdirSync(out, { recursive: true });
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { console.error('This needs playwright-core: npm i -D playwright-core'); process.exit(2); }
const server = spawn('node', ['tools/serve.mjs', String(port)], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: args.includes('--swiftshader') ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
const nm = `${root}/node_modules`;
await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
await page.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts|tunnel/.test(m.text())) errors.push(m.text()); });
let failed = false;
const step = s => console.log(`[${(performance.now() / 1000).toFixed(1)}s] ${s}`);
const CODE = process.argv[2] ?? null;
const shot = async n => page.screenshot({ path: `${out}/p-${n}.png` });
const text = sel => page.evaluate(s => document.querySelector(s)?.innerText.replace(/\s+/g, ' ').slice(0, 300), sel);
const spotOf = () => page.evaluate(() => { const w = window.testWorld.active, p = w.sim.vehicle.body.translation(); return { file: w.file, x: p.x, z: p.z }; });
const results = async () => { await page.waitForFunction(() => document.querySelector('.questScreen [data-retry]'), null, { timeout: 3000000, polling: 1000 }); await page.waitForTimeout(1500); };
try {
  await page.goto(`http://localhost:${port}/dev/world.html?world=map_v3&questBot`);
  await page.waitForFunction(() => window.testWorld?.active?.quests && window.testWorld.active.content && !window.testWorld.active.spawning && window.testWorld.shared.trackUi, null, { timeout: 240000 });
  step('1. the real world');
  // a race venue with an official track event, 400 m down the road (published as an author would)
  const made = await page.evaluate(async () => {
    const w = window.testWorld.active;
    const { worldContent } = await import('./content/client.js'), { newItem } = await import('./content/quests.js'), { quickTrack } = await import('./track/events/model.js');
    const TC = await (await fetch('data/tracks.json')).json(), C = await worldContent();
    const b = w.sim.vehicle.body.translation(), [wx, wz] = w.stream.toWorld(b.x, b.z), [lat, lon] = w.stream.projection.toLatLon(wx + 300, wz + 250);
    const { author: _a, id: _i, ...venue } = newItem('venue', { location: { lat, lon, alt: 0, heading: 0 } }); venue.name = 'Player Test Raceway';
    const rv = await C.service.create(venue); if (!rv.ok) return { error: rv.error };
    const t = quickTrack('club_circuit', 21, TC);
    const { author: _b, id: _j, ...ev } = newItem('quest', { location: rv.item.location, type: 'circuit_race' });
    Object.assign(ev, { name: 'Player Test Raceway race', venue: rv.item.id, params: { ...ev.params, laps: 1 }, npc: { count: 2, skill: [0.4, 0.6], drivers: 'random' },
      track: { code: t.code, kind: 'official', name: 'Player Test Raceway', hash: null, layout: 'loop', gridSlots: 8, km: t.info.km, corners: t.info.corners, theme: t.info.theme, version: t.version, check: { trackOk: true, aiFinished: true, spots: [], at: new Date().toISOString() } }, rating: { stars: 2, km: t.info.km } });
    const re = await C.service.create(ev); if (!re.ok) return { error: re.error };
    const pe = await C.service.publish(re.item.id); if (!pe.ok) return { error: pe.error, problems: pe.problems };
    await C.service.update(rv.item.id, { ...(await C.service.get(rv.item.id)).item, events: [re.item.id] });
    const pv = await C.service.publish(rv.item.id); if (!pv.ok) return { error: pv.error };
    window.__venue = pv.item;
    return { code: t.code, money: window.testWorld.shared.session.player.profile.money };
  });
  if (made.error) throw new Error(made.error);
  step(`venue published (track ${made.code}); money ${made.money}`);
  // to the venue: fast travel (the finder's), its card opens
  await page.evaluate(() => window.testWorld.active.questGame?.fastTravel?.(window.__venue) ?? window.testWorld.active.content.openCard(window.__venue));
  await page.waitForFunction(() => document.querySelector('#contentCard [data-go]'), null, { timeout: 120000 });
  await shot('1-venue'); step(`2. at the venue: ${await text('#contentCard')}`);
  const spot = await spotOf();
  // the official track's race
  await page.click('#contentCard [data-go]');
  await page.waitForFunction(() => window.testWorld.active?.trackData && window.testWorld.shared.trip.state === 'track', null, { timeout: 600000 });
  await page.waitForFunction(() => window.testWorld.active.quests.state === 'racing', null, { timeout: 120000 });
  await page.waitForTimeout(4000); await shot('2-racing'); step(`3. racing the official track: ${await text('#questHud')}`);
  await results(); await shot('3-results'); step(`results: ${await text('.questScreen')}`);
  // its replay
  await page.click('.questScreen [data-replay]');
  await page.waitForFunction(() => document.getElementById('raceReplay'), null, { timeout: 10000 });
  await page.waitForTimeout(3000); await shot('4-replay-tv'); step(`4. replay: ${await text('#raceReplay')}`);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(2000); await shot('4-replay-chase');
  await page.keyboard.press('KeyC'); await page.waitForTimeout(2000); await shot('4-replay-incar');
  await page.keyboard.press('KeyC'); await page.keyboard.press('KeyN'); await page.waitForTimeout(2500); await shot('4-replay-action'); step(`replay, next action: ${await text('#raceReplay')}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('raceReplay') && document.querySelector('.questScreen [data-leave]'), null, { timeout: 10000 });
  step('replay closed: the results again');
  // back to the real world
  await page.click('.questScreen [data-leave]');
  await page.waitForFunction(() => window.testWorld.shared.trip.state === 'roam' && !window.testWorld.active.trackData, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  const back = await spotOf();
  step(`5. back in the real world ${Math.hypot(back.x - spot.x, back.z - spot.z).toFixed(2)} m from where the car left`);
  // the daily track, from the library
  await page.keyboard.press('F4'); await page.waitForTimeout(1000);
  await page.click('#trackLibrary [data-tab="daily"]');
  await page.waitForFunction(() => document.querySelector('#trackLibrary .body [data-ev]'), null, { timeout: 60000 });
  const daily = await page.evaluate(() => ({ name: document.querySelector('#trackLibrary .row h4')?.innerText, code: document.querySelector('#trackLibrary .row .pv')?.dataset.code }));
  await shot('5-daily'); step(`6. the daily track: ${daily.name} (${daily.code})`);
  await page.click('#trackLibrary .body [data-ev]');
  await page.waitForFunction(() => window.testWorld.active?.trackData && window.testWorld.shared.trip.state === 'track', null, { timeout: 600000 });
  await page.waitForFunction(() => window.testWorld.active.quests.state === 'racing', null, { timeout: 120000 });
  await page.waitForTimeout(60000); await shot('6-daily-racing'); step(`on the daily track: ${await text('#questHud')} · ${await text('#trackLabel')}`);
  // (a minute of it, then out: the pause menu's quit, and back to the real world)
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.questScreen button')].map(b => b.outerHTML.slice(0, 80)));
  step(`pause menu: ${buttons.join(' | ')}`);
  const quit = await page.$('.questScreen [data-leave]') ?? await page.$('.questScreen [data-quit]');
  if (quit) await quit.click();
  await page.waitForTimeout(1500);
  if (await page.$('.questScreen [data-leave]')) await page.click('.questScreen [data-leave]');
  if (await page.evaluate(() => !!window.testWorld.active.trackData)) await page.evaluate(() => window.testWorld.shared.trackUi?.leave?.() ?? document.getElementById('trackBack')?.click());
  await page.waitForFunction(() => window.testWorld.shared.trip.state === 'roam' && !window.testWorld.active.trackData, null, { timeout: 120000 });
  step('back in the real world again');
  // a shared code: the daily's, loaded as a friend would — the same track, the same hash
  await page.keyboard.press('F4'); await page.waitForTimeout(800);
  await page.click('#trackLibrary [data-tab="code"]');
  await page.fill('#trackLibrary [data-code]', daily.code); await page.click('#trackLibrary [data-load]');
  await page.waitForFunction(() => document.querySelector('#trackLibrary .res .row'), null, { timeout: 60000 });
  const shared = await page.evaluate(async c => { const { sharedTrack, dailyTrack } = await import('./track/events/model.js'), E = await (await fetch('data/trackEvents.json')).json(), TC = await (await fetch('data/tracks.json')).json(); const s = sharedTrack(c), d = dailyTrack(Date.now(), E, TC); return { row: document.querySelector('#trackLibrary .res .row h4')?.innerText, same: s.gen.hash === d.gen.hash && s.code === d.code }; }, daily.code);
  await shot('7-shared'); step(`7. shared code loaded: ${shared.row} · the same track and hash as the daily: ${shared.same}`);
  await page.keyboard.press('F4');
  // the garage's work: repair, and a part bought (PlayerService, as the garage's buttons call it)
  const shop = await page.evaluate(async () => {
    const S = window.testWorld.shared.session, P = S.player, id = P.profile.currentCar, before = P.profile.money, db = S.db;
    const rep = await P.repairCar(id, { kind: 'quick' });
    const parts = Object.entries(db.parts).filter(([, p]) => p.price > 0).sort((a, b) => a[1].price - b[1].price), [pid, part] = parts[0];
    const owned = Object.keys(P.profile.parts).length, buy = await P.buyPart(pid);
    return { repair: rep.ok ? 'ok' : rep.error, bought: buy.ok ? `${part.name ?? pid} for ${part.price}` : buy.error, money: [before, P.profile.money], parts: [owned, Object.keys(P.profile.parts).length] };
  });
  step(`8. repair: ${shop.repair} · bought ${shop.bought} · money ${shop.money.join(' → ')} · parts ${shop.parts.join(' → ')}`);
} catch (e) { failed = true; console.log('FAILED', e.message); await page.screenshot({ path: `${out}/p-failed.png` }).catch(() => {}); }
const real = errors.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.g/.test(e));
console.log(real.length ? `errors: ${real.join('\n')}` : 'no errors');
process.exitCode = real.length || failed ? 1 : 0;
await browser.close(); server.kill();
