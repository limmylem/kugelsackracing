// The generated tracks' variety report (Phase 5 Step 4; npm run track-variety): 10,000 tracks of every
// preset made (the latest generator) and measured — length, corners by speed class, hairpins, elevation,
// themes, signature features, the quality score and its parts — and their spread reported against the
// targets in data/tracks.json variety.targets; then how alike their layouts are (track/quality.js
// similarity: near-duplicates among a sample). Worker threads share the work. Writes reports/track-variety.txt
// and .json; exits with 1 if a target isn't met (--no-fail: 0 anyway).
//
//   node tools/track-variety.mjs [--per 10000] [--threads 4] [--only mixed_gp,club_circuit] [--out reports]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const ROOT = new URL('..', import.meta.url).pathname;

if (!isMainThread) {
  // ---------- a worker: its share of the seeds ----------
  const { generateTrack } = await import('../track/generate.js'), { dressTrack } = await import('../track/dress.js'), { qualityOf, layoutSignature } = await import('../track/quality.js');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tracks.json'), 'utf8'));
  const { preset, from, to, sample } = workerData, P = cfg.presets.find(p => p.id === preset);
  const rows = [];
  for (let k = from; k < to; k++) {
    const seed = 7919 * k + 1013, g = generateTrack({ seed, params: P.params });
    if (!g.ok) { rows.push({ seed, ok: false }); continue; }
    const plan = dressTrack(g, cfg), q = qualityOf(g, plan, cfg), M = q.measures;
    rows.push({ seed, ok: true, code: g.code, km: g.track.length / 1000, corners: M.corners.total, slow: M.corners.slow, medium: M.corners.medium, fast: M.corners.fast, hairpins: g.track.stats.hairpins,
      elevation: g.track.stats.elevationRange, crests: M.elevation.crests + M.elevation.dips, theme: g.params.theme, signature: g.track.stats.signature ?? 'none', crossing: !!g.track.crossing,
      gate: q.gate, parts: q.parts, attempts: g.attempts.length, ...(k - from < sample ? { sig: layoutSignature(g) } : {}) });
  }
  parentPort.postMessage(rows);
} else {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tracks.json'), 'utf8')), V = cfg.variety;
  const per = +opt('--per', V.per ?? 10000), threads = +opt('--threads', Math.max(1, os.cpus().length)), only = opt('--only', null)?.split(','), outDir = path.resolve(opt('--out', path.join(ROOT, 'reports')));
  const { similarity } = await import('../track/quality.js');
  const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : null; };
  const r1 = x => x == null ? '—' : Math.round(x * 10) / 10;
  const lines = [], json = { per, presets: {} }, fails = [];
  const say = s => { lines.push(s); console.log(s); };
  say(`Generated tracks' variety: ${per} tracks a preset, generator v${(await import('../track/generate.js')).LATEST}\n`);
  const t0 = performance.now();
  for (const P of cfg.presets) {
    if (only && !only.includes(P.id)) continue;
    const chunk = Math.ceil(per / threads), sample = Math.ceil((V.similarity?.sample ?? 400) / threads);
    const parts = await Promise.all(Array.from({ length: threads }, (_, t) => new Promise((res, rej) => {
      // (each worker's heap kept small: a lazy collector with room to spare grows to gigabytes)
      const w = new Worker(new URL(import.meta.url), { workerData: { preset: P.id, from: t * chunk, to: Math.min(per, (t + 1) * chunk), sample }, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
      w.on('message', res); w.on('error', rej);
    })));
    const rows = parts.flat(), ok = rows.filter(r => r.ok), T = { ...(V.targets.all ?? {}), ...(V.targets[P.id] ?? {}) };
    const share = f => ok.filter(f).length / Math.max(1, ok.length);
    const stat = k => ({ p10: pct(ok.map(r => r[k]), 0.1), p50: pct(ok.map(r => r[k]), 0.5), p90: pct(ok.map(r => r[k]), 0.9) });
    const themes = {}, sigs = {};
    for (const r of ok) { themes[r.theme] = (themes[r.theme] ?? 0) + 1; sigs[r.signature] = (sigs[r.signature] ?? 0) + 1; }
    // near-duplicates: pairs among the sample as alike as two tracks shouldn't be
    const S = ok.filter(r => r.sig).map(r => r.sig);
    let pairs = 0, dup = 0, simSum = 0;
    for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) { const s = similarity(S[a], S[b]); pairs++; simSum += s; if (s > (V.similarity?.duplicate ?? 0.92)) dup++; }
    const res = {
      tracks: ok.length, failed: rows.length - ok.length, km: stat('km'), corners: stat('corners'), elevation: stat('elevation'), crests: stat('crests'), gate: stat('gate'),
      withSlow: share(r => r.slow > 0), withMedium: share(r => r.medium > 0), withFast: share(r => r.fast > 0), allThree: share(r => r.slow && r.medium && r.fast), hairpins: share(r => r.hairpins > 0),
      themes: Object.fromEntries(Object.entries(themes).map(([k, v]) => [k, v / ok.length])), signatures: Object.fromEntries(Object.entries(sigs).map(([k, v]) => [k, v / ok.length])),
      signature: share(r => r.signature !== 'none'), crossings: share(r => r.crossing), passGate: Object.fromEntries(Object.entries(cfg.quality.min).map(([k, m]) => [k, share(r => r.gate >= m)])),
      parts: Object.fromEntries(Object.keys(ok[0]?.parts ?? {}).map(k => [k, pct(ok.map(r => r.parts[k]), 0.5)])), duplicates: pairs ? dup / pairs : 0, meanSimilarity: pairs ? simSum / pairs : 0,
      lengthCover: (pct(ok.map(r => r.km), 0.9) - pct(ok.map(r => r.km), 0.1)) / Math.max(0.01, P.params.lengthKm[1] - P.params.lengthKm[0]),
    };
    json.presets[P.id] = res;
    // the targets
    const checks = [];
    const want = (name, value, ok_, text) => { checks.push({ name, ok: ok_, text }); if (!ok_) fails.push(`${P.id}: ${name} — ${text}`); };
    if (T.failed != null) want('every seed a track', res.failed, res.failed <= T.failed, `${res.failed} seeds with no track (at most ${T.failed})`);
    if (T.gateP10 != null) want('quality (p10)', res.gate.p10, res.gate.p10 >= T.gateP10, `p10 ${r1(res.gate.p10)} (at least ${T.gateP10})`);
    if (T.gateP50 != null) want('quality (median)', res.gate.p50, res.gate.p50 >= T.gateP50, `median ${r1(res.gate.p50)} (at least ${T.gateP50})`);
    if (T.passQuick != null) want('pass the quick races\' gate', res.passGate.quick, res.passGate.quick >= T.passQuick, `${Math.round(res.passGate.quick * 100)}% (at least ${Math.round(T.passQuick * 100)}%)`);
    if (T.allThree != null) want('slow, medium and fast corners', res.allThree, res.allThree >= T.allThree, `${Math.round(res.allThree * 100)}% of tracks have all three (at least ${Math.round(T.allThree * 100)}%)`);
    if (T.signature != null) want('signature features', res.signature, res.signature >= T.signature, `${Math.round(res.signature * 100)}% of tracks (at least ${Math.round(T.signature * 100)}%)`);
    if (T.lengthCover != null) want('length spread', res.lengthCover, res.lengthCover >= T.lengthCover, `p10–p90 covers ${Math.round(res.lengthCover * 100)}% of the preset's range (at least ${Math.round(T.lengthCover * 100)}%)`);
    if (T.themeMin != null && P.params.theme === 'auto') { const least = Math.min(...Object.values(res.themes)); want('every theme', least, Object.keys(res.themes).length >= 6 && least >= T.themeMin, `${Object.keys(res.themes).length} themes, the rarest ${Math.round(least * 100)}% (at least ${Math.round(T.themeMin * 100)}%)`); }
    if (T.duplicates != null) want('no near-duplicates', res.duplicates, res.duplicates <= T.duplicates, `${(res.duplicates * 100).toFixed(2)}% of pairs alike (at most ${(T.duplicates * 100).toFixed(2)}%)`);
    if (T.elevationP50 != null) want('elevation', res.elevation.p50, res.elevation.p50 >= T.elevationP50, `median ${r1(res.elevation.p50)} m (at least ${T.elevationP50} m)`);
    say(`${P.id} (${res.tracks} tracks${res.failed ? `, ${res.failed} seeds with none` : ''})`);
    say(`  length ${r1(res.km.p10)}–${r1(res.km.p90)} km (median ${r1(res.km.p50)}) · corners ${res.corners.p10}–${res.corners.p90} · elevation ${r1(res.elevation.p10)}–${r1(res.elevation.p90)} m · crests/dips ${res.crests.p50} (median)`);
    say(`  corners: ${Math.round(res.withSlow * 100)}% have slow, ${Math.round(res.withMedium * 100)}% medium, ${Math.round(res.withFast * 100)}% fast, ${Math.round(res.allThree * 100)}% all three · hairpins in ${Math.round(res.hairpins * 100)}%`);
    say(`  themes: ${Object.entries(res.themes).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ')}`);
    say(`  signatures: ${Object.entries(res.signatures).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/_/g, ' ')} ${Math.round(v * 100)}%`).join(' · ')}`);
    say(`  quality: p10 ${r1(res.gate.p10)} · median ${r1(res.gate.p50)} · p90 ${r1(res.gate.p90)} · passing the gates: daily ${Math.round(res.passGate.daily * 100)}%, weekly ${Math.round(res.passGate.weekly * 100)}%, quick ${Math.round(res.passGate.quick * 100)}% · parts (median): ${Object.entries(res.parts).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(' ')}`);
    say(`  layouts: mean similarity ${res.meanSimilarity.toFixed(2)}, near-duplicates ${(res.duplicates * 100).toFixed(2)}% of ${S.length} tracks' pairs`);
    for (const c of checks) say(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.text}`);
    say('');
  }
  say(fails.length ? `${fails.length} target${fails.length > 1 ? 's' : ''} not met:\n${fails.map(f => `  ${f}`).join('\n')}` : 'Every variety target met.');
  say(`(${((performance.now() - t0) / 60000).toFixed(1)} min, ${threads} threads)`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'track-variety.txt'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'track-variety.json'), JSON.stringify(json, null, 1));
  process.exit(fails.length && !args.includes('--no-fail') ? 1 : 0);
}
