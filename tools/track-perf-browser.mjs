// Generated tracks' frame times in a browser (Phase 5 Step 4): an 8-car race (you by the autopilot, seven
// NPC racers) on a track of the busiest theme, at each track detail level (data/tracks.json
// performance.detail), the frames timed for a while once it's under way — their 95th percentile against
// the level's frameMs — and the renderer's draw calls and triangles. Needs playwright-core and a Chromium
// (npm i -D playwright-core; CHROMIUM=/path/to/chrome) — not part of the npm test run. On a machine with no
// GPU (software rendering: --swiftshader) the times are the CPU drawing every pixel: not what a player sees.
//
//   node tools/track-perf-browser.mjs [--code TRACKCODE] [--seconds 30] [--swiftshader]

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname, args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { console.error('This needs playwright-core: npm i -D playwright-core'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(`${ROOT}/data/tracks.json`, 'utf8')), DT = cfg.performance.detail, seconds = +opt('--seconds', 30), port = 7790;
const { generateTrack } = await import('../track/generate.js'), { buildTrack } = await import('../track/build.js');
// the busiest theme's track (the most beside it), unless a code's given
let code = opt('--code', null);
if (!code) {
  let most = -1;
  for (const theme of ['countryside', 'forest', 'desert', 'coastal', 'mountain', 'street']) {
    const g = generateTrack({ seed: 777, params: { ...cfg.presets.find(p => p.id === 'mixed_gp').params, theme } }), n = buildTrack(g, cfg).objects.length;
    if (n > most) { most = n; code = g.code; }
  }
}
const server = spawn('node', ['tools/serve.mjs', String(port)], { cwd: ROOT, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: args.includes('--swiftshader') ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'] });
const nm = `${ROOT}/node_modules`;
let failed = 0;
try {
  for (const level of ['low', 'medium', 'high']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
    await page.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
    await page.addInitScript(l => { const k = 'driveWorld.settings.v1'; let s = {}; try { s = JSON.parse(localStorage.getItem(k)) ?? {}; } catch { /* none */ } localStorage.setItem(k, JSON.stringify({ ...s, trackDetail: l })); }, level);
    await page.goto(`http://localhost:${port}/dev/world.html?world=track&code=${code}&questBot`);
    await page.waitForFunction(() => window.testWorld?.active?.trackData && window.testWorld.active.quests, null, { timeout: 300000 });
    // the race: seven NPCs and you
    await page.evaluate(async () => {
      const w = window.testWorld.active, D = w.trackData;
      const { newTrackEvent, trackInfo } = await import('/track/events/model.js'), { readyEvent } = await import('/track/events/prepare.js');
      const qcfg = await (await fetch('/data/quests.json')).json();
      const ev = newTrackEvent({ id: 'trk_perf', track: { code: D.code, kind: 'quick', name: 'perf', info: trackInfo(D) }, type: 'circuit_race', params: { laps: 3 }, npc: { count: 7, skill: [0.5, 0.8], drivers: 'random' } });
      const { event, course } = readyEvent(ev, D, null, { config: qcfg });
      w.questGame.trackCourse = () => course;
      await w.quests.start(event);
    });
    await page.waitForFunction(() => window.testWorld.active.quests.state === 'racing', null, { timeout: 120000 });
    await page.waitForTimeout(5000);
    const r = await page.evaluate(secs => new Promise(res => {
      const times = [], R = window.testWorld.shared.renderer, t0 = performance.now(); let last = t0, calls = 0, tris = 0;
      const tick = now => { times.push(now - last); last = now; calls = Math.max(calls, R.info.render.calls); tris = Math.max(tris, R.info.render.triangles); if (now - t0 < secs * 1000) requestAnimationFrame(tick); else res({ times, calls, tris, cars: (window.testWorld.active.npcRace?.npcs.length ?? 0) + 1 }); };
      requestAnimationFrame(tick);
    }), seconds);
    const t = r.times.slice(10).sort((a, b) => a - b), p95 = t[Math.floor(t.length * 0.95)], p50 = t[Math.floor(t.length / 2)], T = DT.targets[level];
    const ok = p95 <= T.frameMs;
    if (!ok) failed++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${level.padEnd(6)} ${r.cars} cars · frames: median ${p50.toFixed(1)} ms, 95% within ${p95.toFixed(1)} ms (budget ${T.frameMs}) · ${r.calls} draw calls, ${(r.tris / 1000).toFixed(0)}k triangles`);
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
process.exit(failed ? 1 : 0);
