// Generated tracks at scale (Phase 5 Step 1; npm run test:tracks):
//   - determinism: 1,000 seeds made twice (across every preset), their hashes compared — and every one
//     made again from its code alone
//   - validity: 10,000 seeds across every preset; every final track passes every check, measured again
//     from the output (track/validate.js); the attempts each took, and why attempts failed
//   - old versions: every pinned track of every generator version (tests/fixtures/tracks-v*.json) made
//     exactly as it was
//   - speed: how long a track's layout takes
//
//   node tests/tracks.mjs [--seeds 10000] [--determinism 1000]

import fs from 'node:fs';
import { generateTrack, VERSIONS } from '../track/generate.js';
import { checkTrack } from '../track/validate.js';
import * as v1 from '../track/gen/v1.js';

const LIMITS_OF = { 1: v1.LIMITS };
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? +args[i + 1] : d; };
const cfg = JSON.parse(fs.readFileSync(new URL('../data/tracks.json', import.meta.url), 'utf8')), P = cfg.presets;
let failed = 0;
const report = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(46)} ${detail}`); };
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

// ---------- determinism ----------
{
  const N = opt('--determinism', 1000);
  let same = 0, fromCode = 0;
  for (let k = 0; k < N; k++) {
    const p = P[k % P.length].params, seed = 1_000_003 * k + 17, a = generateTrack({ seed, params: p }), b = generateTrack({ seed, params: p });
    if (a.hash === b.hash && a.code === b.code) same++;
    if (generateTrack({ code: a.code }).hash === a.hash) fromCode++;
  }
  report(same === N && fromCode === N, `determinism: ${N} seeds made twice`, `${same} of ${N} identical, ${fromCode} of ${N} the same again from their code`);
}

// ---------- validity at scale ----------
{
  const N = opt('--seeds', 10000), per = {}, reasons = {}, ms = [];
  let bad = 0, none = 0;
  for (let k = 0; k < N; k++) {
    const pr = P[k % P.length], seed = 7919 * k + 3, g = generateTrack({ seed, params: pr.params });
    ms.push(g.ms);
    const s = (per[pr.id] ??= { n: 0, attempts: 0, most: 0 });
    s.n++;
    if (!g.ok) { none++; continue; }
    s.attempts += g.attempts.length; s.most = Math.max(s.most, g.attempts.length);
    for (const a of g.attempts) if (a.reason) { const r = a.reason.replace(/[-0-9.×%]+/g, '#'); reasons[r] = (reasons[r] ?? 0) + 1; }
    const problems = checkTrack(g.track, g.params, LIMITS_OF[g.version]);
    if (problems.length) { bad++; if (bad <= 5) console.log(`        ${pr.id} seed ${seed} (${g.code}): ${problems.join('; ')}`); }
  }
  report(bad === 0 && none === 0, `validity: ${N} seeds over ${P.length} presets`, `${N - bad - none} valid, ${bad} failing a check, ${none} with no valid track in ${v1.LIMITS.attempts} attempts`);
  for (const [id, s] of Object.entries(per)) console.log(`        ${id.padEnd(20)} ${(s.attempts / Math.max(1, s.n)).toFixed(2)} attempts a track (most ${s.most})`);
  const total = Object.values(per).reduce((a, s) => a + s.attempts, 0);
  console.log(`        on average ${(total / N).toFixed(2)} attempts a track; why attempts failed:`);
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`          ${String(n).padStart(6)}  ${r}`);
  report(pct(ms, 0.99) < 500, 'speed: a track\'s layout', `median ${pct(ms, 0.5).toFixed(0)} ms, 99% within ${pct(ms, 0.99).toFixed(0)} ms, slowest ${Math.max(...ms).toFixed(0)} ms`);
}

// ---------- every version's pinned tracks ----------
for (const v of VERSIONS) {
  const file = new URL(`./fixtures/tracks-v${v}.json`, import.meta.url);
  if (!fs.existsSync(file)) { report(false, `version ${v}: pinned tracks`, 'no fixture: pin some tracks when a version is released'); continue; }
  const F = JSON.parse(fs.readFileSync(file, 'utf8'));
  const wrong = F.tracks.filter(t => generateTrack({ code: t.code }).hash !== t.hash);
  report(wrong.length === 0, `version ${v}: its pinned tracks unchanged`, `${F.tracks.length - wrong.length} of ${F.tracks.length} identical${wrong.length ? ` (changed: ${wrong.map(t => `${t.preset} ${t.seed}`).join(', ')})` : ''}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
