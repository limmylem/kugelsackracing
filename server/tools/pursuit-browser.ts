// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// A co-op police pursuit in two game windows (docs/PURSUIT.md "Co-op"): Player A (the party's leader — the host, whose
// game drives the police in its physics) and Player B, on San Francisco's Market Street, with the API and ONE
// real-time process here (no Redis). Checked in each window:
//   1. the party: A makes it, B joins; A starts the co-op pursuit; both games taken into its room, loading its route
//   2. the intro: playing in both windows through the countdown, on the server's clock (the same moment in each); the
//      host's first police car parked behind the grid in A's physics
//   3. GO: both handed over at once, moving (not standing): the cars already going
//   4. the chase: the police in A's physics, driven by the room's orders; B draws them (the room's cars) with light
//      bars; both report their sight lines; the shared heat in both windows' panels
//   5. the end: the time limit — the room ends it in both windows
//
//   node server/tools/pursuit-browser.ts [--local-libs]   (TEST_DATABASE_URL; playwright-core and Chromium; MP_SHOTS=dir keeps screenshots)

import path from 'node:path';
import fs from 'node:fs';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';
import { PursuitRoom } from '../src/rt/pursuit.ts';
import { seedMpRoutes } from './seed-mp-routes.ts';
import { newItem } from '../../content/quests.js';

const args = process.argv.slice(2);
const PORT = 8787, BASE = `http://localhost:${PORT}`, RT_PORT = 2746, SECRET = 'pursuit-browser-secret-pursuit-browser-0123456789';
const ROUTE = { id: 'route_mpsfchase', region: 'sf', name: 'Market Street Chase', kind: 'p2p', what: 'the pursuit browser test\'s route', waypoints: [[37.7936, -122.3955], [37.7880, -122.4075]] };
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [], lines: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`; console.log(l); lines.push(l); };
const section = (s: string) => { console.log(`\n== ${s}`); lines.push('', `## ${s}`, ''); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms, every = 500) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await fn().catch(() => null); if (v) return v; } return null; };

const database = await freshDatabase('pursuitbrowser');
const app: any = await buildApp({ config: testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });
await seedMpRoutes(app.content, { regions: [], extra: [ROUTE] });
const author = { id: null, name: 'Kugelsack Racing' };
const route = (await app.content.get(ROUTE.id, 'published')).item;
const qid = 'quest_pursuitbrowser';
await app.content.create({ ...newItem('quest', { id: qid, location: route.location, type: 'pursuit_coop', name: 'Market Street Getaway', author: author.name }), route: ROUTE.id, params: { ...newItem('quest', { type: 'pursuit_coop', location: route.location }).params, kind: 'convoy', objective: 'escape', startHeat: 2, maxHeat: 3, timeLimitSeconds: 45 } }, author);
const pub = await app.content.publish(qid, author);
if (!pub.ok) throw new Error(`publish: ${JSON.stringify(pub.problems ?? pub.error)}`);
const rtLog: string[] = [];
const rt = await startRt({ port: RT_PORT, secret: SECRET, redisUrl: null, rt: { allowGuests: true, maxPlayers: 200, roomMaxClients: 64, netsim: true }, api: { url: `http://localhost:${PORT}` }, log: (m: string, e: any) => { rtLog.push(`${new Date().toISOString().slice(11, 19)} ${m} ${JSON.stringify(e ?? {})}`); } });

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const nm = path.join(REPO_DIR, 'node_modules');
const ctx = await browser.newContext({ viewport: { width: 520, height: 380 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|cesium|openfreemap|demotiles/, (r: any) => r.abort());
if (args.includes('--local-libs')) {
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', (r: any) => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
  await ctx.route(/maplibre/, (r: any) => r.abort());
}
const errors: string[] = [];
const pages: Record<string, any> = {};
for (const n of ['A', 'B']) {
  const P = pages[n] = await ctx.newPage();
  P.on('pageerror', (e: any) => { const k = `${n}: ${e}`; if (!errors.includes(k)) errors.push(k); });
  if (process.env.MP_DEBUG) P.on('console', (m: any) => { if (/pursuit|police|error/i.test(m.text())) console.log(`[${n}] ${m.type()}: ${m.text().slice(0, 240)}`); });
}
const { A, B } = pages;
const shot = async (P, name) => { if (process.env.MP_SHOTS) await P.screenshot({ path: `${process.env.MP_SHOTS}/pursuit-${name}.png` }).catch(() => {}); };
// what a window's co-op pursuit is doing
const look = P => P.evaluate(async () => {
  const { debug } = await import('/testtrack/test-scene.js'), w = debug.active, R = (globalThis as any).__krMpRace, S = (globalThis as any).__krMpS, r = R?.run;
  const c = w?.questGame?.carNow();
  return { phase: S?.phase, race: R?.state, quest: r?.quest?.type ?? null, cine: r?.cine ? { phase: r.cine.phase, t: +(r.cine.t ?? 0).toFixed(2) } : null, Q: r?.Q?.state.state ?? null, kmh: c ? Math.round(c.kmh) : null,
    host: S?.pursuitHost === S?.myUid, units: w?.pursuit ? [...w.pursuit.units.values()].map(u => ({ sid: u.sid, mode: u.driver.order?.mode, how: u.driver.state.how })) : [],
    status: S?.pursuit?.status ? { heat: +S.pursuit.status.heat.toFixed(2), phase: S.pursuit.status.phase, units: S.pursuit.status.units.map(u => `${u.id}:${u.mode}`) } : null,
    remote: (S?.pursuit?.status?.units ?? []).filter(u => u.net != null).map(u => { const c2 = R?.drawn?.car(u.net); return { net: u.net, drawn: !!c2?.handle?.vis?.group?.visible, bar: !!c2?.handle?.vis?.group?.children?.some(g => g.children?.length === 3) }; }),
    hud: !!document.getElementById('pursuitHud') && document.getElementById('pursuitHud').style.display !== 'none', done: S?.pursuitDone ?? null, myUid: S?.myUid };
}).catch(e => ({ err: e.message }));

try {
  section('Setup: two windows in San Francisco, as Player A and Player B');
  const q = '&view=600&mpauto';
  await A.goto(`${BASE}/?mp&player=A${q}`); await B.goto(`${BASE}/?mp&player=B${q}`);
  for (const P of [A, B]) {
    await until(async () => { const b = P.locator('[data-k="later"]'); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); return P.evaluate(async () => !!(await import('/testtrack/test-scene.js')).enter).catch(() => false); }, 120000, 1000);
    void P.evaluate(async () => { const m = await import('/testtrack/test-scene.js'); await m.enter('scenes/map_v3.json?region=sf'); }).catch(() => {});
  }
  const later = async (P: any) => { const b = P.locator('[data-k="later"]'); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); };
  const up = await until(async () => { for (const P of [A, B]) await later(P); return (await Promise.all([A, B].map(P => P.evaluate(() => !!(globalThis as any).__krMpS?.hubConn)))).every(Boolean); }, 300000, 1000);
  check('each window is online (the hub joined)', !!up);
  await sleep(2000);

  section('1. The party starts it');
  await A.evaluate(() => (globalThis as any).__krMpS.hubSend({ t: 'party-create' }));
  const party = await until(() => A.evaluate(() => (globalThis as any).__krMpS.party), 10000);
  await B.evaluate(id => (globalThis as any).__krMpS.hubSend({ t: 'party-join', partyId: id }), party?.id);
  const two = await until(() => A.evaluate(() => (globalThis as any).__krMpS.party?.members.length === 2), 10000);
  check('a party of two: A makes it, B joins', !!two);
  await A.evaluate(id => (globalThis as any).__krMpS.hubSend({ t: 'party-pursuit', questId: id }), qid);
  const loaded = await until(async () => { const [a, b] = [await look(A), await look(B)]; return a.quest === 'pursuit_coop' && b.quest === 'pursuit_coop' ? [a, b] : null; }, 240000, 1000);
  check('A starts the co-op pursuit: both games in its room, loading its route as a co-op pursuit', !!loaded, JSON.stringify(loaded?.map(x => x.race) ?? [await look(A), await look(B)]).slice(0, 300));

  section('2. The intro, through the countdown, the same moment in both');
  const playing = await until(async () => { const [a, b] = [await look(A), await look(B)]; return a.cine?.phase === 'playing' && b.cine?.phase === 'playing' ? [a, b] : null; }, 240000, 200);
  check('the intro plays in both windows', !!playing, playing ? `t ${playing[0].cine.t} s and ${playing[1].cine.t} s` : JSON.stringify([await look(A), await look(B)]).slice(0, 400));
  await shot(A, 'intro-A'); await shot(B, 'intro-B');
  // (each window's own clock read against the server's: the intro's time in each is the server's time less its start)
  const sync = await Promise.all([A, B].map(P => P.evaluate(() => { const R = (globalThis as any).__krMpRace, S = (globalThis as any).__krMpS; return { t: R.run.cine?.t, now: S.race.net.roomNow(), go: S.goAt }; })));
  const lead = sync.map(s => s.go / 1000 - s.now / 1000);
  check('the intro on the server\'s clock: both windows the same distance from GO (within a frame or two)', Math.abs(lead[0] - lead[1]) < 0.25, `${lead.map(x => x.toFixed(2)).join(' s and ')} s to GO`);
  const hostA = await look(A);
  check('the host\'s first police car in A\'s physics, behind the grid (u0)', hostA.host && hostA.units.some(u => u.sid === 'u0'), JSON.stringify(hostA.units));

  section('3. GO: handed over, moving, in both at once');
  const went = await until(async () => { const [a, b] = [await look(A), await look(B)]; return ['handover', 'done'].includes(a.cine?.phase) && ['handover', 'done'].includes(b.cine?.phase) ? [a, b] : null; }, 60000, 100);
  check('both handed over at GO, already moving', !!went && went.every(x => x.kmh > 10), went ? `${went.map(x => `${x.kmh} km/h`).join(', ')}` : '');

  section('4. The chase');
  await sleep(12000);
  const [a, b] = [await look(A), await look(B)];
  await shot(A, 'chase-A'); await shot(B, 'chase-B');
  check('A drives the police from the room\'s orders', a.units.length >= 1 && a.units.some(u => u.mode && u.mode !== 'block'), JSON.stringify(a.units));
  check('B draws the police cars the room sends, with their light bars', b.remote.length >= 1 && b.remote.some(r => r.drawn && r.bar), JSON.stringify(b.remote));
  const R = [...PursuitRoom.pursuits].at(-1);
  check('both games report their sight lines to the room', !!R?.P && [a.myUid, b.myUid].every(u => R.P.seen.has(u)), R?.P ? [...R.P.seen.keys()].length + ' reporting' : 'no room');
  check('the shared heat in both windows\' panels', a.hud && b.hud && a.status?.heat === b.status?.heat || Math.abs((a.status?.heat ?? 0) - (b.status?.heat ?? 9)) < 0.05, `${a.status?.heat} / ${b.status?.heat} (${a.status?.phase})`);

  section('5. The end');
  const done = await until(async () => { const [x, y] = [await look(A), await look(B)]; return x.done && y.done ? [x, y] : null; }, 120000, 1000);
  check('the room ends it in both windows (its time limit: 45 s)', !!done, done ? `${done[0].done.status}: ${done[0].done.reason}` : '');
  await shot(A, 'end-A');
  check('no errors on either page', !errors.length, errors.slice(0, 5).join(' · '));
} catch (e) { check('ran without throwing', false, e?.stack ?? String(e)); }
finally {
  await browser.close(); await rt.stop?.(); await app.close(); await database.drop?.();
}
if (results.some(r => !r)) console.log(`\n(the real-time server:\n${rtLog.filter(l => /pursuit|fail/.test(l)).slice(-15).join('\n') || 'none'})`);
const failed = results.filter(r => !r).length;
fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
fs.writeFileSync(path.join(REPO_DIR, 'reports/pursuit-browser.md'), `# A co-op pursuit in two windows\n\n${new Date().toISOString()}. ${failed ? `${failed} of ${results.length} failed` : `${results.length} of ${results.length} ok`}.\n${lines.join('\n')}\n`);
console.log(`\n${failed ? `${failed} of ${results.length} failed` : `${results.length} of ${results.length} ok`}`);
process.exit(failed ? 1 : 0);
