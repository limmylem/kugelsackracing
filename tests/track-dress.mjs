// Dressed tracks at scale (Phase 5 Step 2; npm run test:dress), against data/tracks.json dressTests and
// performance:
//   - determinism: 1,000 tracks over every preset and theme dressed twice, and again from their codes —
//     the same dressing (its hash: every kerb, run-off, barrier and object)
//   - placement over 1,000 seeds: every dressing passes every check measured again from the output
//     (track/validateDress.js: nothing on the track or run-off, no gaps in the barriers, grandstands never
//     inside the run-off, kerbs on the right side, where the racing line goes)
//   - run-off sized to the corners' speed: the faster the corner, the more run-off outside it
//   - speed: making and building a dressed track within the load target
//   - version 2's pinned tracks: the same layout and the same dressing
//
//   node tests/track-dress.mjs [--seeds 1000] [--determinism 1000]

import fs from 'node:fs';
import { generateTrack, THEMES } from '../track/generate.js';
import { dressTrack } from '../track/dress.js';
import { buildTrack } from '../track/build.js';
import { barrierRuns } from '../track/build2.js';
import { checkDressing } from '../track/validateDress.js';

const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? +args[i + 1] : d; };
const cfg = JSON.parse(fs.readFileSync(new URL('../data/tracks.json', import.meta.url), 'utf8')), P = cfg.presets, DT = cfg.dressTests, PERF = cfg.performance;
let failed = 0;
const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(50)} ${detail}`); };
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const spec = k => ({ seed: 7907 * k + 13, params: { ...P[k % P.length].params, theme: THEMES[Math.floor(k / P.length) % THEMES.length] } });

// ---------- determinism ----------
{
  const N = opt('--determinism', 1000);
  let same = 0, fromCode = 0;
  for (let k = 0; k < N; k++) {
    const g = generateTrack(spec(k));
    if (!g.ok) continue;
    const a = dressTrack(g, cfg), b = dressTrack(g, cfg);
    if (a.hash === b.hash) same++;
    if (dressTrack(generateTrack({ code: g.code }), cfg).hash === a.hash) fromCode++;
  }
  report(same === N && fromCode === N, `determinism: ${N} dressed tracks made twice`, `${same} of ${N} identical, ${fromCode} of ${N} the same again from their code`);
}

// ---------- placement over many seeds ----------
{
  const N = opt('--seeds', DT.placement.seeds), reasons = {}, ms = [], byTheme = {};
  let bad = 0, none = 0;
  const speed = { fast: [], medium: [], slow: [] };
  for (let k = 0; k < N; k++) {
    const s = spec(k + 5000), g = generateTrack(s);
    if (!g.ok) { none++; continue; }
    const t0 = performance.now(), plan = dressTrack(g, cfg), { runs } = barrierRuns(plan, g.track, cfg);
    ms.push(performance.now() - t0);
    const problems = checkDressing(g.track, plan, { runs });
    const th = (byTheme[g.params.theme] ??= { n: 0, objects: 0, stands: 0 });
    th.n++; th.objects += plan.objects.length; th.stands += plan.objects.filter(o => o.k === 'grandstand').length;
    if (problems.length) { bad++; for (const p of problems) { const r = p.replace(/[-0-9.,]+/g, '#'); reasons[r] = (reasons[r] ?? 0) + 1; } if (bad <= 4) console.log(`        ${g.code}: ${problems.join('; ')}`); }
    // run-off outside each corner's apex, by its speed (not where the room ran out)
    const W = g.track.width / 2, n = plan.n;
    for (const c of plan.corners) { const i = ((c.apex % n) + n) % n, o = (-c.side > 0 ? plan.runoff.L : plan.runoff.R)[i] - W; speed[c.vEntry >= 150 ? 'fast' : c.vEntry >= 95 ? 'medium' : 'slow'].push(o); }
  }
  report(bad === 0 && none === 0, `placement: ${N} seeds over every preset and theme`, `${N - bad - none} clean, ${bad} with a problem, ${none} with no track`);
  for (const [r, c] of Object.entries(reasons).slice(0, 6)) console.log(`          ${String(c).padStart(5)}  ${r}`);
  for (const [t, s] of Object.entries(byTheme)) console.log(`        ${t.padEnd(12)} ${(s.objects / s.n).toFixed(0)} things a track, ${(s.stands / s.n).toFixed(1)} grandstands`);
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  report(mean(speed.fast) > mean(speed.medium) && mean(speed.medium) > mean(speed.slow), 'run-off: the faster the corner, the more run-off', `outside the apex, on average: fast corners ${mean(speed.fast).toFixed(1)} m, medium ${mean(speed.medium).toFixed(1)} m, slow ${mean(speed.slow).toFixed(1)} m`);
  report(pct(ms, 0.99) < 1000, 'speed: dressing a track', `median ${pct(ms, 0.5).toFixed(0)} ms, 99% within ${pct(ms, 0.99).toFixed(0)} ms`);
}

// ---------- making and building a dressed track: within the load target ----------
{
  const ms = [];
  for (let k = 0; k < 30; k++) { const t0 = performance.now(), g = generateTrack(spec(k + 9000)); if (g.ok) buildTrack(g, cfg); ms.push(performance.now() - t0); }
  report(pct(ms, 0.9) <= PERF.loadSeconds * 1000, 'speed: making and building a dressed track', `median ${(pct(ms, 0.5) / 1000).toFixed(2)} s, 90% within ${(pct(ms, 0.9) / 1000).toFixed(2)} s, slowest ${(Math.max(...ms) / 1000).toFixed(2)} s (target ${PERF.loadSeconds} s)`);
}

// ---------- version 2's pinned tracks ----------
{
  const F = JSON.parse(fs.readFileSync(new URL('./fixtures/tracks-v2.json', import.meta.url), 'utf8'));
  const wrong = F.tracks.filter(t => { const g = generateTrack({ code: t.code }); return g.hash !== t.hash || dressTrack(g, cfg).hash !== t.dressHash; });
  report(!wrong.length, 'version 2: its pinned tracks unchanged', `${F.tracks.length - wrong.length} of ${F.tracks.length} identical, layout and dressing${wrong.length ? ` (changed: ${wrong.map(t => `${t.preset} ${t.seed}`).join(', ')})` : ''}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
