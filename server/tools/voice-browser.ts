// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// Voice chat in the game, in the browser (docs/FREE_ROAM.md "Voice chat"): two windows as Player A and Player B in San
// Francisco's free roam, the real-time server's voice going through a stand-in for Cloudflare Realtime's SFU (./fake-sfu.ts:
// the same calls, a WebRTC peer of its own) and Chromium's fake microphone (a beep). What's checked is what each window
// really plays: A turns their microphone on from the settings and B hears it — its sound arriving, loud near A; B mutes
// A and stops hearing them (the track closed), and hears them again unmuted; B turns proximity voice off and on; B drives
// far away (past voice.nearbyM) and A goes quiet, back near and A's heard again; push to talk: only while the key's held.
// Then a private lobby: A makes it, B joins with its code — the lobby's own voice (both hear each other, free roam's
// voice waiting meanwhile), and B leaving it gets free roam's voice back.
// One real-time process, no Redis.
//
//   node server/tools/voice-browser.ts [--local-libs]        (needs PostgreSQL with PostGIS: TEST_DATABASE_URL; Chromium)
//   (VOICE_SHOTS=<dir>: photos of A's voice settings and B's corner with A talking)

import path from 'node:path';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';
import { startFakeSfu } from './fake-sfu.ts';
import { voiceEntries } from '../src/rt/voice.ts';

const args = process.argv.slice(2);
const PORT = 8787, BASE = `http://localhost:${PORT}`, RT_PORT = 2745;
const SECRET = 'voice-browser-secret-voice-browser-secret-0123456789';
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => any, ms: number, every = 400) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await f(); if (v) return v; } return null; };

process.env.ROAM_ZONE_TILES ??= '4';
const sfu = await startFakeSfu({ token: 'voice-test-token', log: process.env.MP_DEBUG ? console.log : () => {} });
const rt = await startRt({ port: RT_PORT, redisUrl: null, secret: SECRET, rt: { allowGuests: true, maxPlayers: 100, roomMaxClients: 64, netsim: true, voiceGuests: true }, api: { url: BASE },
  voice: { appId: 'test-app', token: 'voice-test-token', url: sfu.url }, log: process.env.MP_DEBUG ? (m, e) => console.log(m, JSON.stringify(e ?? {})) : undefined });
const database = await freshDatabase('voicebrowser');
const app: any = await buildApp({ config: testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    // (both windows are tabs of one window: the hidden one's timers not slowed — its measures of what's arriving kept up)
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 420 }, permissions: ['microphone'] });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|cesium|openfreemap|demotiles/, (r: any) => r.abort());
if (args.includes('--local-libs')) {
  const nm = path.join(REPO_DIR, 'node_modules'), LIBS = process.env.CDN_LIBS ?? REPO_DIR, esbuild = await import('esbuild'), bundles = new Map();
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', (r: any) => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', (r: any) => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: `${nm}/maplibre-gl/dist/${f}`, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
  const bundle = async (pkg: string) => bundles.get(pkg) ?? bundles.set(pkg, (await esbuild.build({ stdin: { contents: pkg === 'pbf' ? `import * as m from 'pbf'; export * from 'pbf'; export default m.default ?? m.Pbf ?? Object.values(m).find(v => typeof v === 'function');` : `export * from '${pkg}'; export { default } from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false, logLevel: 'silent' }).catch(() => esbuild.build({ stdin: { contents: `export * from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false }))).outputFiles[0].text).get(pkg);
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pbf|@mapbox\/vector-tile)@/, async (r: any) => r.fulfill({ body: await bundle(/pbf@/.test(r.request().url()) ? 'pbf' : '@mapbox/vector-tile'), contentType: 'text/javascript' }));
}
const errors: string[] = [];
const A = await ctx.newPage(), B = await ctx.newPage();
for (const [n, p] of [['A', A], ['B', B]] as const) {
  p.on('pageerror', (e: any) => errors.push(`${n}: ${e}`));
  if (process.env.MP_DEBUG) p.on('console', (m: any) => console.log(`[${n}] ${m.type()}: ${m.text().slice(0, 240)}`));
  else p.on('console', (m: any) => { if (/voice/i.test(m.text())) console.log(`  [${n}] ${m.type()}: ${m.text().slice(0, 300)}`); });
}

// what a window's voice chat is doing: its state, and each voice it plays (how loud it's set, how loud it's arriving)
const voiceOf = (P: any) => P.evaluate(() => { const V = (globalThis as any).__krRoam?.voice; return V ? { ...V.state, ...V.debug(), overlay: document.getElementById('roamVoice')?.textContent ?? '' } : null; });
// (a development player's account: ?player=A is dev-player-a — the hello's 'you' can come before the page listens)
const uidOf = (P: any, n: string) => P.evaluate((n: string) => (globalThis as any).__krRoam?.state.you ?? `dev-player-${n.toLowerCase()}`, n);
const panel = (P: any) => P.evaluate(() => ({ open: document.getElementById('roamPanel')?.classList.contains('open'), text: document.getElementById('roamPanel')?.textContent ?? '' }));
const click = async (P: any, sel: string) => { await P.click(sel, { timeout: 20000, force: true }); };
// (the multiplayer menu's button in the dock can be under free roam's panel, left open by the settings checks: clicked as itself)
const openMpMenu = (P: any) => P.locator('#mpButton').dispatchEvent('click');
const openSettings = async (P: any) => {
  await P.bringToFront();
  await P.evaluate(() => { const el = document.querySelector('#roamPanel nav button[data-tab="settings"]') as HTMLElement; if (document.getElementById('roamPanel')?.classList.contains('open') && el) el.click(); });
  if (!(await panel(P)).open) await P.keyboard.press('F6');
  if (!(await panel(P)).open) await P.evaluate(() => (document.querySelector('#roamHud button') as HTMLElement)?.click());
  await click(P, '#roamPanel nav button[data-tab="settings"]');
  // (the click landing mid-animation: once more, from the page)
  if (!(await P.$('#roamPanel input[data-set="names"]'))) await P.evaluate(() => (document.querySelector('#roamPanel nav button[data-tab="settings"]') as HTMLElement)?.click());
};
// (B hearing A: A's voice pulled, its sound arriving over the noise floor)
// (the fake microphone beeps once a second: over 2.5 s, A's loudest; or B's voice from A — its sound energy arriving)
const loudest = (P: any) => P.evaluate(async () => {
  const V = (globalThis as any).__krRoam?.voice; let max = -Infinity;
  for (let i = 0; i < 50; i++) { const l = V?.debug().micLevel; if (l != null) max = Math.max(max, l); await new Promise(r => setTimeout(r, 50)); }
  return max;
});
const arriving = (P: any, uid: string) => P.evaluate(async (uid: string) => {
  const V = (globalThis as any).__krRoam?.voice, at = () => V?.debug().pulled.find((x: any) => x.uid === uid);
  const a = at(); await new Promise(r => setTimeout(r, 2500)); const b = at();
  return a && b && b.mid === a.mid ? { packets: b.packets - a.packets, energy: b.energy - a.energy, level: b.audioLevel, volume: b.volume } : null;
}, uid);
const hears = async (P: any, uid: string) => { const a = await arriving(P, uid); return a && a.packets > 0 && a.energy > 0 ? { v: await voiceOf(P), p: a } : null; };
const silent = async (P: any, uid: string) => { const v = await voiceOf(P); return v && !v.pulled.some((x: any) => x.uid === uid) ? v : null; };
const move = (P: any, dx: number) => P.evaluate(async (dx: number) => {
  const { debug } = await import('/testtrack/test-scene.js'), MapV3 = await import('/map/build/render/game.js'), w = debug.active, t = w.sim.vehicle.body.translation();
  const [x, z] = w.stream.toWorld ? w.stream.toWorld(t.x, t.z) : [t.x, t.z];
  MapV3.travelTo(w, { xz: [x + dx, z], heading: 90 });
}, dx);

try {
  console.log('== Two windows, Player A and Player B, into San Francisco with ?mp; voice through the stand-in SFU');
  // (the fake microphone's beep is steady: noise suppression would learn it as noise and send silence — off for the test)
  await ctx.addInitScript(() => { try { localStorage.setItem('kr.voice', JSON.stringify({ noiseSuppression: false })); } catch { /* none */ } });
  for (const [n, P] of [['A', A], ['B', B]] as const) await P.goto(`${BASE}/?mp&player=${n}&view=600&regions=all`);   // (San Francisco's in it: every baked region)
  for (const [n, P] of [['A', A], ['B', B]] as const) {
    await until(async () => { const b = P.locator('[data-k="later"]'); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); return P.evaluate(async () => !!(await import('/testtrack/test-scene.js')).enter).catch(() => false); }, 120000, 1000);
    void P.evaluate(async () => { const m = await import('/testtrack/test-scene.js'); await m.enter('scenes/map_v3.json?region=sf'); }).catch((e: any) => console.log(`  ${n}: entering San Francisco failed: ${e?.message}`));
  }
  // (in San Francisco, and its free roam's voice joined)
  const inSf = (P: any) => P.evaluate(async () => { const { debug } = await import('/testtrack/test-scene.js'), w = debug.active; return !!(w?.stream && !w.spawning && w.track?.mapV3?.manifest?.includes('/sf/') && (globalThis as any).__krRoam?.RC?.home); });
  const joined = await until(async () => { if (!(await inSf(A)) || !(await inSf(B))) return null; const [a, b] = [await voiceOf(A), await voiceOf(B)]; return a?.joined && b?.joined ? [a, b] : null; }, 400000, 1500);
  check('both in free roam: voice chat available and joined (listening) without asking for the microphone', !!joined, JSON.stringify([await voiceOf(A), await voiceOf(B)].map(v => v && { available: v.available, joined: v.joined, why: v.why, mic: v.mic })));
  const [ua, ub] = [await uidOf(A, 'A'), await uidOf(B, 'B')];
  await B.bringToFront(); await B.keyboard.press('F9');          // (B beside A — the development key)
  await sleep(2000);

  // A's microphone on, from the settings (a real click)
  await openSettings(A);
  const text = (await panel(A)).text;
  check('A\'s settings: a voice chat section — party voice, proximity voice, the microphone, open mic or push to talk, the volume', /Voice chat/.test(text) && /Party voice/.test(text) && /Proximity voice/.test(text) && /Turn my microphone on/.test(text) && /Push to talk/.test(text), text.slice(text.indexOf('Voice chat'), text.indexOf('Voice chat') + 200));
  await click(A, '#roamPanel button[data-a="mic"]');
  const micA = await until(async () => { const v = await voiceOf(A); return v?.mic && await loudest(A) > -70 ? v : null; }, 15000);
  check('A turns the microphone on: the browser\'s microphone (the fake one\'s beep) is picked up', !!micA, JSON.stringify(await voiceOf(A)));
  const opens0 = (await voiceOf(A))?.opens ?? 0;
  const gate = await until(async () => { const v = await voiceOf(A); return v && v.opens > opens0 ? v : null; }, 15000, 500);
  check('open mic: A\'s sound opens the gate (sent while there\'s sound, nothing in silence)', !!gate, `A's loudest ${(await loudest(A)).toFixed(1)} dB`);
  const heard = await until(() => hears(B, ua), 30000, 500);
  if (!heard || process.env.MP_DEBUG) console.log('  voice entries:', JSON.stringify((await voiceEntries(true)).map(e => ({ ...e, session: e.session.slice(0, 6) }))));
  check('B hears A (proximity voice): A\'s voice pulled from the SFU and its sound arriving', !!heard, heard ? `${heard.p.packets} packets in 2.5 s` : JSON.stringify(await arriving(B, ua).catch((e: any) => String(e))));
  check('… loud, beside them', !!heard && heard.p.volume > 0.9, `volume ${heard?.p.volume}, ${heard?.p.packets} packets in 2.5 s`);
  const talkA = await until(async () => { const v = await voiceOf(A); return /Proximity voice/.test(v?.overlay ?? '') ? v : null; }, 5000);
  check('A\'s corner says proximity voice, the microphone on', !!talkA, (await voiceOf(A))?.overlay);
  const shown = await until(async () => { const v = await voiceOf(B); return v?.peers.some((p: any) => p.uid === ua && p.speaking) && /Player A/.test(v.overlay) ? v : null; }, 20000, 100);
  check('B\'s corner shows "Player A" talking', !!shown, (await voiceOf(B))?.overlay);
  // (VOICE_SHOTS: B's corner, A talking; A's settings, scrolled to voice chat)
  if (process.env.VOICE_SHOTS) {
    await B.bringToFront(); await until(async () => /Player A/.test((await voiceOf(B))?.overlay ?? ''), 10000, 50);
    await B.locator('#roamVoice').screenshot({ path: path.join(process.env.VOICE_SHOTS, 'voice-talking.png') }).catch(() => {});
    await A.bringToFront(); await A.evaluate(() => { const h = [...document.querySelectorAll('#roamPanel h4')].find(x => /Voice chat/.test(x.textContent ?? '')); h?.scrollIntoView(); });
    await A.locator('#roamPanel').screenshot({ path: path.join(process.env.VOICE_SHOTS, 'voice-settings.png') }).catch(() => {});
  }
  const none = (await voiceOf(A))?.pulled.find((x: any) => x.uid === ub);
  check('A doesn\'t pull B (B\'s microphone is off: nothing sent for them)', !none);

  // B mutes A (Nearby ⋯ Mute): A's voice closed; unmuted, back
  await B.evaluate((uid: string) => { const R = (globalThis as any).__krRoam; R.state.muted.add(uid); R.voice.sync(); }, ua);
  check('B mutes A: A\'s voice closed', !!(await until(() => silent(B, ua), 15000)));
  await B.evaluate((uid: string) => { const R = (globalThis as any).__krRoam; R.state.muted.delete(uid); R.voice.sync(); }, ua);
  const again = await until(() => hears(B, ua), 30000, 500);
  check('… unmuted: heard again', !!again, again ? '' : JSON.stringify({ B: await voiceOf(B), sfu: sfu.sessions() }));

  // B's proximity voice off (the settings' checkbox): nothing; on again: back
  await openSettings(B);
  if (!(await B.$('#roamPanel input[data-set="voiceNearby"]'))) console.log('  B\'s panel:', JSON.stringify(await panel(B)), JSON.stringify(await voiceOf(B)));
  await click(B, '#roamPanel input[data-set="voiceNearby"]');
  const set = await B.evaluate(() => (globalThis as any).__krRoam.state.settings.voiceNearby);
  if (set !== false) console.log('  B\'s proximity voice after the click:', set);
  const off = await until(() => silent(B, ua), 15000);
  check('B turns proximity voice off: hears nobody', !!off && off.voiceMode === 'off', JSON.stringify(off && { mode: off.voiceMode, peers: off.peers.length }));
  await click(B, '#roamPanel input[data-set="voiceNearby"]');
  const on = await until(() => hears(B, ua), 20000, 500);
  check('… on again: hears A', !!on, on ? '' : JSON.stringify({ B: await voiceOf(B), sfu: sfu.sessions() }));

  // far away: past nearbyM, A goes; back, A's heard again
  await move(B, 1500);
  check('B drives 1.5 km away: A\'s out of range, closed', !!(await until(() => silent(B, ua), 30000, 1000)));
  await move(B, -1500);
  check('… back beside A: heard again', !!(await until(() => hears(B, ua), 40000, 1000)));

  // push to talk: A sends only while the key is held
  await A.evaluate(() => (globalThis as any).__krRoam.voice.ptt(false));
  await A.bringToFront();
  await openSettings(A);
  await click(A, '#roamPanel input[data-voice="mode"][value="ptt"]');
  await sleep(1500);
  const quiet = await until(async () => { const v = await voiceOf(A); return v && !v.live ? v : null; }, 5000);
  check('A switches to push to talk: not sending with the key up', !!quiet);
  await A.evaluate(() => (globalThis as any).__krRoam.voice.ptt(true));
  const live = await until(async () => { const v = await voiceOf(A); return v?.live ? v : null; }, 3000, 100);
  check('… sending while it\'s held', !!live);
  check('… and B hears it', !!(await until(() => hears(B, ua), 10000, 200)));
  await A.evaluate(() => (globalThis as any).__krRoam.voice.ptt(false));
  // A's microphone off: B stops pulling A
  await A.evaluate(() => (globalThis as any).__krRoam.voice.setMic(false));
  check('A turns the microphone off: B stops pulling A', !!(await until(() => silent(B, ua), 15000)));
  check('the stand-in SFU: two sessions, each sending', sfu.sessions().length >= 2 && sfu.sessions().every((s: any) => s.packets > 0), JSON.stringify(sfu.sessions()));

  // ---------- a lobby: its own voice chat (everyone in it, at full volume); free roam's waits, and comes back after ----------
  console.log('== A private lobby: A makes it, B joins with the code; the lobby\'s voice');
  const lobbyVoice = (P: any) => P.evaluate(() => { const V = (globalThis as any).__krMpVoice; return V ? { ...V.state, ...V.debug(), box: document.getElementById('mpVoice')?.textContent ?? '' } : null; });
  const lobbyArriving = (P: any, uid: string) => P.evaluate(async (uid: string) => {
    const at = () => (globalThis as any).__krMpVoice?.debug().pulled.find((x: any) => x.uid === uid);
    const a = at(); await new Promise(r => setTimeout(r, 2500)); const b = at();
    return a && b && b.mid === a.mid && b.packets > a.packets && b.energy > a.energy ? { packets: b.packets - a.packets, volume: b.volume } : null;
  }, uid);
  for (const P of [A, B]) await until(() => P.evaluate(() => !!(globalThis as any).__krMpS?.hubConn), 60000, 1000);
  await A.bringToFront(); await openMpMenu(A); await click(A, '#mpMenu [data-private]');
  const code = (await until(async () => { const t = (await A.locator('#mpLobby [data-code]').textContent().catch(() => ''))?.trim(); return /^[A-Z0-9]{6}$/.test(t ?? '') ? t : null; }, 20000)) as string | null;
  await B.bringToFront(); await openMpMenu(B);
  await B.locator('#mpMenu [data-code]').fill(code ?? ''); await click(B, '#mpMenu [data-joincode]');
  const inLobby = await until(async () => { const [a, b] = [await lobbyVoice(A), await lobbyVoice(B)]; return a?.joined && b?.joined ? [a, b] : null; }, 30000, 500);
  check('both in the lobby: its voice chat joined in each window', !!inLobby, `code ${code ?? '—'} · ${JSON.stringify([await lobbyVoice(A), await lobbyVoice(B)].map(v => v && { available: v.available, joined: v.joined, why: v.why }))}`);
  const roamPaused = await until(async () => { const [a, b] = [await voiceOf(A), await voiceOf(B)]; return !a?.joined && !b?.joined ? true : null; }, 15000, 500);
  check('… free roam\'s voice waits meanwhile (one microphone connection each)', !!roamPaused);
  const entryRoom = (await voiceEntries(true)).find(e => e.uid === ua)?.room;
  check('… A\'s voice entry is the lobby\'s', !!entryRoom && entryRoom !== null, String(entryRoom));
  await A.evaluate(() => (globalThis as any).__krMpVoice.setMic(true));
  const lobbyHeard = await until(() => lobbyArriving(B, ua), 30000, 500);
  check('A\'s microphone on in the lobby: B hears A, at full volume', !!lobbyHeard && lobbyHeard.volume > 0.9, JSON.stringify(lobbyHeard ?? await lobbyVoice(B)));
  check('… B\'s lobby shows the voice box (the microphone, who\'s here)', /Lobby voice/.test((await lobbyVoice(B))?.box ?? ''), (await lobbyVoice(B))?.box);
  // (B leaves the lobby: its voice goes, free roam's comes back)
  await B.bringToFront(); await click(B, '#mpLobby [data-leave]');
  const backB = await until(async () => { const v = await voiceOf(B); return !(await lobbyVoice(B)) && v?.joined ? v : null; }, 30000, 1000);
  check('B leaves the lobby: its voice gone, free roam\'s joined again', !!backB, JSON.stringify(await voiceOf(B)));
  check('… and A, still in the lobby, no longer pulls anything from B', !((await lobbyVoice(A))?.pulled ?? []).some((x: any) => x.uid === ub));
} catch (e: any) {
  check('the test ran', false, e?.stack ?? String(e));
} finally {
  if (errors.length) console.log(`page errors:\n${errors.slice(0, 10).join('\n')}`);
  await browser.close().catch(() => {});
  await app.close(); await rt.stop(); await database.drop(); await sfu.stop();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed} of ${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
