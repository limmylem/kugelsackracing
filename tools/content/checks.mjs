// The automatic checks on every part (npm run content -- check; docs/CONTENT_PIPELINE.md, data/content/check-rules.json):
// each part on every car it fits — fit and clipping, a short drive, a crash, its sound, its models' budget, its price
// against what it does — and the class limits of every car with every part there is. Run in worker threads
// (tools/content/checkWorker.mjs); results in data/content/checks.json, each kept with a key of what it was worked out
// from (the part's numbers, its models, the car's), so a run checks only what's new or changed, and
// npm run content -- verify (the pre-commit hook, CI) can tell, without running anything, whether every part's results
// are there, up to date and passing. Parts that perform the same and share their models (a family's finishes) are
// checked once.
//
//   runChecks({ only, all, log, progress }) → { checked, reused, failed: [{ id, problems }], drafts: [{ id, problems }], known: [{ id, car, text }], classes }
//     (progress({ done, total }) after each part checked)
//   verify() → { problems: [plain words], parts, families, engines }

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { loadProject } from './project.mjs';
import { formatJson } from './json.mjs';
import { ROOT, readJson } from './rules.mjs';
import { forCar } from './balance.mjs';
import { perfKey } from '../../garage/families.js';
import { partShape } from '../../garage/partShape.js';
import { released } from '../../garage/content.js';

export const RESULTS = 'data/content/checks.json';
export const KINDS = ['fit', 'drive', 'crash', 'sound', 'budget', 'economy', 'ranges'];
const PER_CAR = new Set(['fit', 'drive', 'crash']);
export const KIND_WORDS = { ranges: 'its stats at the ends of their ranges', fit: 'fit and clipping', drive: 'a short drive', crash: 'a crash', sound: 'its sound', budget: 'its models\' budget', economy: 'its price and what it does', classes: 'class limits' };
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const fileHashes = new Map();
const fileHash = (root, f) => { if (!f) return 'none'; if (!fileHashes.has(f)) { const full = path.join(root, f); fileHashes.set(f, fs.existsSync(full) ? sha(fs.readFileSync(full)) : 'missing'); } return fileHashes.get(f); };

// What each check's result depends on, as a key
export function keysOf(root, db, part) {
  const models = [...new Set([partShape(part, db.parts).model, ...Object.values(part.byCar ?? {}).map(v => v.model)].filter(Boolean))].sort();
  const perf = perfKey(part), modelsKey = models.map(f => `${f}:${fileHash(root, f)}`).join('|');
  // (each check's rules too: a change to them checks again what they cover)
  const R = CHECK_RULES(), rule = k => JSON.stringify(R[k] ?? null);
  return {
    group: sha(`${perf}|${modelsKey}`),
    fit: sha(`fit|${rule('fit')}|${perf}|${modelsKey}|${JSON.stringify(part.byCar ?? {})}`),
    drive: sha(`drive|${rule('drive')}|${perf}`),
    crash: sha(`crash|${rule('crash')}|${perf}|${JSON.stringify(part.detach ?? null)}|${JSON.stringify(part.collision ?? null)}`),
    sound: sha(`sound|${rule('sound')}|${perf}|${part.engine?.sound ? fileHash(root, part.engine.sound) : ''}`),
    budget: sha(`budget|${rule('budget')}|${modelsKey}`),
    economy: sha(`economy|${rule('economy')}|${JSON.stringify(TIERS().slots?.[part.slot] ?? null)}|${perf}|${part.price}|${part.tier}|${JSON.stringify(part.unlock ?? null)}|${part.generated?.priceFactor ?? 1}`),
    // (a family's: checked once for the family, on its first part — the kind's ranges and that part as they are)
    ranges: part.generated?.family ? sha(`ranges|${JSON.stringify(FORMULAS().families?.[part.generated.kind] ?? null)}`) : null,
  };
}
export const carKeyOf = (root, car) => sha(`${JSON.stringify(car)}|${fileHash(root, car.model?.file)}`);
let formulas = null, checkRules = null, tierRules = null;
const FORMULAS = () => formulas ??= readJson('data/content/formulas.json');
const CHECK_RULES = () => checkRules ??= readJson('data/content/check-rules.json');
const TIERS = () => tierRules ??= readJson('data/content/tiers.json');
const carsFor = (db, part) => Object.keys(db.cars).filter(c => forCar(db, c, part)).sort();
const readResults = root => fs.existsSync(path.join(root, RESULTS)) ? readJson(RESULTS, root) : { parts: {}, classes: {} };

// What's out of date for a part: { kinds: [kind], cars: { kind: [car] } } (nothing: up to date)
function stale(root, db, part, have, carKeys, all) {
  const keys = keysOf(root, db, part), cars = carsFor(db, part), out = { keys, cars, kinds: [], perCar: {} };
  for (const kind of KINDS) {
    const r = have?.[kind];
    if (kind === 'ranges' && !keys.ranges) continue;
    if (all || !r || r.key !== keys[kind]) { out.kinds.push(kind); if (PER_CAR.has(kind)) out.perCar[kind] = cars; continue; }
    if (PER_CAR.has(kind)) {
      const need = cars.filter(c => !r.cars?.[c] || r.cars[c].carKey !== carKeys[c]);
      if (need.length || Object.keys(r.cars ?? {}).some(c => !cars.includes(c))) { out.kinds.push(kind); out.perCar[kind] = need; }
    }
  }
  return out;
}

// A pool of worker threads, each with the game's data loaded once
function pool(n) {
  const workers = [], queue = [], waiting = new Map();
  let next = 0;
  const ready = Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./checkWorker.mjs', import.meta.url), { workerData: { worker: true } });
    w.busy = false;
    w.on('message', m => {
      if (m.ready) { workers.push(w); resolve(); pump(); return; }
      const done = waiting.get(m.id); waiting.delete(m.id); w.busy = false; done(m); pump();
    });
    w.on('error', reject);
  })));
  function pump() { for (const w of workers) if (!w.busy && queue.length) { const job = queue.shift(); w.busy = true; w.postMessage(job); } }
  return {
    ready,
    run: job => new Promise(res => { job.id = next++; waiting.set(job.id, res); queue.push(job); pump(); }),
    close: () => Promise.all(workers.map(w => w.terminate())),
  };
}

export async function runChecks({ root = ROOT, only = null, all = false, log = () => {}, progress = () => {} } = {}) {
  const { db } = await loadProject(root), have = readResults(root), rulesKey = sha(fs.readFileSync(path.join(root, 'data/content/check-rules.json')));
  if (have.rules !== rulesKey) all = true;          // (the rules changed: everything again)
  const carKeys = Object.fromEntries(Object.values(db.cars).map(c => [c.id, carKeyOf(root, c)]));
  const parts = Object.values(db.parts).filter(p => !p.retired && (!only || only.includes(p.id) || only.includes(p.generated?.family) || only.includes(p.generated?.engine)));
  // (what's out of date, and which part of each group of the same parts is checked for the group)
  const plans = new Map(), leaders = new Map(), famLeaders = new Map();
  for (const p of [...parts].sort((a, b) => a.id.localeCompare(b.id))) {
    const s = stale(root, db, p, have.parts?.[p.id], carKeys, all); plans.set(p.id, s);
    if (!leaders.has(s.keys.group)) leaders.set(s.keys.group, p.id);
    if (p.generated?.family && !famLeaders.has(p.generated.family)) famLeaders.set(p.generated.family, p.id);
  }
  const jobs = [];
  for (const p of parts) {
    const s = plans.get(p.id), lead = leaders.get(s.keys.group), fam = famLeaders.get(p.generated?.family);
    // (economy: every part's own; a family's stat ranges: its first part's, for the family; the rest: one per group)
    const kinds = s.kinds.filter(k => k === 'economy' || (k === 'ranges' ? fam === p.id : lead === p.id || !plans.get(lead).kinds.includes(k)));
    if (!kinds.length) continue;
    const cars = [...new Set(kinds.flatMap(k => s.perCar[k] ?? []))];
    jobs.push({ partId: p.id, kinds, cars: cars.length ? cars : s.cars, perCar: s.perCar });
  }
  // the class limits: again when anything that changes how a car performs is new or changed (or a car is)
  const perfChanged = [...plans.values()].some(s => s.kinds.includes('drive'));
  const classCars = Object.keys(db.cars).filter(c => all || perfChanged || !have.classes?.[c] || have.classes[c].carKey !== carKeys[c]);
  const workers = Math.max(1, Math.min(8, (os.availableParallelism?.() ?? os.cpus().length) - 1));
  log(`Checking ${jobs.length} part${jobs.length === 1 ? '' : 's'} (${parts.length - jobs.length} up to date)${classCars.length ? ` and the class limits of ${classCars.length} car${classCars.length > 1 ? 's' : ''}` : ''} in ${workers} worker${workers > 1 ? 's' : ''}…`);
  const P = pool(workers);
  await P.ready;
  const results = new Map(), t0 = Date.now();
  let done = 0;
  const classJobs = classCars.map(car => P.run({ car, classes: true }));
  await Promise.all(jobs.map(async job => {
    const m = await P.run(job);
    results.set(job.partId, m.error ? { error: m.error } : m.results);
    if (++done % 25 === 0 || done === jobs.length) log(`  ${done}/${jobs.length} parts (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    progress({ done, total: jobs.length });
  }));
  const classResults = await Promise.all(classJobs);
  await P.close();

  // put together: each part's results (a part checked for its group, the leader's), merged into what was there
  const out = { _note: 'The automatic checks\' results (npm run content -- check, data/content/check-rules.json; docs/CONTENT_PIPELINE.md): don\'t edit — run the checks again.', rules: rulesKey, parts: {}, classes: {} };
  const keep = Object.fromEntries(Object.entries(have.parts ?? {}).filter(([id]) => db.parts[id] && !db.parts[id].retired));
  const failed = [], drafts = [];
  for (const p of Object.values(db.parts).filter(x => !x.retired).sort((a, b) => a.id.localeCompare(b.id))) {
    const s = plans.get(p.id), prev = keep[p.id] ?? {};
    if (!s) { if (keep[p.id]) out.parts[p.id] = keep[p.id]; continue; }
    const lead = leaders.get(s.keys.group), mine = results.get(p.id), theirs = results.get(lead), entry = {}, fam = famLeaders.get(p.generated?.family);
    for (const kind of KINDS) {
      if (kind === 'ranges') {
        if (!s.keys.ranges) continue;
        const r = mine?.ranges ?? results.get(fam)?.ranges;
        if (r) entry.ranges = { key: s.keys.ranges, ...r };
        else if (prev.ranges?.key === s.keys.ranges) entry.ranges = prev.ranges;
        else if (out.parts[fam]?.ranges) entry.ranges = out.parts[fam].ranges;
        continue;
      }
      let r = mine?.[kind] ?? (lead !== p.id && kind !== 'economy' ? theirs?.[kind] : null);
      if (mine?.error || (lead !== p.id && theirs?.error && !mine?.[kind])) r = { ok: false, problems: [`the checks went wrong: ${(mine?.error ?? theirs?.error).split('\n')[0]}`] };
      if (!r && kind !== 'economy' && lead !== p.id && !s.kinds.includes(kind)) r = null;
      if (!r) { if (prev[kind]) entry[kind] = prev[kind]; else if (lead !== p.id && out.parts[lead]?.[kind]) entry[kind] = out.parts[lead][kind]; continue; }
      // (per car: the cars checked now, with what was there for the rest; each with its car's key)
      if (PER_CAR.has(kind)) {
        const cars = {};
        for (const c of s.cars) { const now = r.cars?.[c]; if (now) cars[c] = { carKey: carKeys[c], ...now }; else if (prev[kind]?.cars?.[c] && prev[kind].key === s.keys[kind]) cars[c] = prev[kind].cars[c]; }
        const bad = Object.entries(cars).filter(([, x]) => !x.ok);
        entry[kind] = { key: s.keys[kind], ok: !bad.length, problems: bad.flatMap(([c, x]) => x.problems.map(q => `on the ${db.cars[c].name}: ${q}`)), cars };
      } else entry[kind] = { key: s.keys[kind], ...r };
    }
    out.parts[p.id] = entry;
  }
  for (const [c, prev] of Object.entries(have.classes ?? {})) if (db.cars[c]) out.classes[c] = prev;
  for (const m of classResults) out.classes[m.car] = m.error ? { carKey: carKeys[m.car], ok: false, problems: [`the class check went wrong: ${m.error.split('\n')[0]}`] } : { carKey: carKeys[m.car], ...m.classes };
  blame(out);
  const known = [];
  for (const [id, entry] of Object.entries(out.parts)) {
    const problems = [...KINDS, 'classes'].flatMap(k => (entry[k]?.problems ?? []).map(q => `${KIND_WORDS[k]}: ${q}`));
    if (problems.length) (released(db.parts[id]) ? failed : drafts).push({ id, name: db.parts[id].name, problems });
    // (problems kept until they're fixed: check-rules.json fit.known)
    for (const [c, x] of Object.entries(entry.fit?.cars ?? {})) if (x.known && db.parts[id]) known.push({ id, car: c, text: `on the ${db.cars[c]?.name ?? c}: ${x.known}` });
  }
  const classFails = Object.entries(out.classes).filter(([, c]) => !c.ok).map(([c, x]) => ({ id: c, name: db.cars[c].name, problems: x.problems.map(q => `class limits: ${q}`) }));
  fs.writeFileSync(path.join(root, RESULTS), formatJson(out) + '\n');
  return { checked: jobs.length, reused: parts.length - jobs.length, failed: [...failed, ...classFails], drafts, known, classes: out.classes, seconds: (Date.now() - t0) / 1000 };
}

// A part the class limits blame (the drafts in a car's too-powerful build: tools/content/checkWorker.mjs classCheck) fails
// its 'classes' check — worked out again from every car's results each time, so nothing stale stays
export function blame(results) {
  for (const e of Object.values(results.parts)) { delete e.classes; e.ok = KINDS.every(k => e[k]?.ok !== false); }
  for (const x of Object.values(results.classes ?? {})) for (const b of x.blamed ?? []) {
    const e = results.parts[b.id];
    if (!e) continue;
    e.classes = { ok: false, problems: [...(e.classes?.problems ?? []), b.why] };
    e.ok = false;
  }
  return results;
}

export function formatChecks(r, { colour = false } = {}) {
  const red = s => colour ? `\x1b[31m${s}\x1b[0m` : s, yellow = s => colour ? `\x1b[33m${s}\x1b[0m` : s, lines = [];
  lines.push(`Checked ${r.checked} part${r.checked === 1 ? '' : 's'} (${r.reused} up to date already) in ${r.seconds.toFixed(0)} s.`);
  for (const [c, x] of Object.entries(r.classes ?? {})) lines.push(`  ${c}: stock ${x.stock?.class ?? '?'} (${x.stock?.index ?? '?'}), fully upgraded ${x.max?.class ?? '?'} (${x.max?.index ?? '?'})${x.ok ? '' : red(' ✘')}${x.blamed?.length ? yellow(` — without ${x.blamed.map(b => b.id).join(', ')}, which would take it past its class limit`) : ''}`);
  if (r.drafts.length) { lines.push(yellow(`\n${r.drafts.length} draft${r.drafts.length > 1 ? 's' : ''} failing (they can't be published until they pass):`)); for (const d of r.drafts.slice(0, 40)) for (const p of d.problems.slice(0, 3)) lines.push(yellow(`  ${d.id}: ${p}`)); if (r.drafts.length > 40) lines.push(yellow(`  … and ${r.drafts.length - 40} more`)); }
  if (r.known?.length) { lines.push(yellow(`\n${r.known.length} known problem${r.known.length > 1 ? 's' : ''} kept until fixed (check-rules.json fit.known; docs/KNOWN_ISSUES.md):`)); for (const k of r.known) lines.push(yellow(`  ${k.id}: ${k.text}`)); }
  if (r.failed.length) { lines.push(red(`\n${r.failed.length} failing that players have (fix these):`)); for (const d of r.failed) for (const p of d.problems.slice(0, 4)) lines.push(red(`  ${d.id}: ${p}`)); }
  else lines.push('\nNothing players have is failing.');
  return lines.join('\n');
}

// Without running anything: every part's results there, up to date and — for what players have — passing
export async function verify({ root = ROOT } = {}) {
  const { db, problems: dataProblems } = await loadProject(root), have = readResults(root), problems = [];
  if (dataProblems.length) problems.push(`the data has ${dataProblems.length} problem${dataProblems.length > 1 ? 's' : ''}: npm run check`);
  const rulesKey = sha(fs.readFileSync(path.join(root, 'data/content/check-rules.json')));
  if (have.rules !== rulesKey) problems.push('data/content/check-rules.json changed since the checks last ran');
  const carKeys = Object.fromEntries(Object.values(db.cars).map(c => [c.id, carKeyOf(root, c)]));
  let n = 0;
  const outOfDate = [];
  for (const p of Object.values(db.parts).filter(x => !x.retired)) {
    n++;
    const s = stale(root, db, p, have.parts?.[p.id], carKeys, false);
    if (s.kinds.length) { outOfDate.push(`${p.id} (${s.kinds.map(k => KIND_WORDS[k]).join(', ')})`); continue; }
    if (released(p) && have.parts[p.id].ok === false) problems.push(`${p.id} is published but fails its checks: ${[...KINDS, 'classes'].flatMap(k => have.parts[p.id][k]?.problems ?? []).slice(0, 2).join('; ')}`);
  }
  if (outOfDate.length) problems.push(`${outOfDate.length} part${outOfDate.length > 1 ? 's\'' : '\'s'} checks are missing or out of date: ${outOfDate.slice(0, 6).join(', ')}${outOfDate.length > 6 ? ` and ${outOfDate.length - 6} more` : ''} — npm run content -- check`);
  for (const c of Object.keys(db.cars)) {
    const x = have.classes?.[c];
    if (!x || x.carKey !== carKeys[c]) problems.push(`${c}'s class limits are out of date — npm run content -- check`);
    else if (!x.ok) problems.push(`${c} breaks the class limits: ${x.problems.join('; ')}`);
  }
  // made from a definition: up to date with it (npm run content -- build makes nothing new)
  const { plan } = await import('./build.mjs'), p = await plan({ root });
  for (const f of p.failed) problems.push(`${f.source}: ${f.problems[0]}`);
  for (const j of p.jobs) {
    const was = db.parts[j.id];
    if (!was) { problems.push(`${j.id} isn't made yet (${j.source}) — npm run content -- build`); continue; }
    const want = { ...j.part }, keys = ['name', 'fits', 'requires', 'conflicts', 'provides', 'mass', 'effects', 'engine', 'aero', 'aeroEffect', 'rim', 'sound'];
    // (a fitted family part's own cars it can't be made to fit are worked out when it's built: not in the plan)
    const norm = (k, v) => k === 'conflicts' ? (v ?? []).filter(t => !String(t).startsWith('car:')) : v ?? null;
    const diff = keys.filter(k => JSON.stringify(norm(k, want[k])) !== JSON.stringify(norm(k, was[k])));
    if (diff.length) problems.push(`${j.id} is out of date with ${j.source} (${diff.join(', ')}) — npm run content -- build`);
  }
  return { problems, parts: n, families: new Set(p.jobs.filter(j => j.family).map(j => j.family)).size, engines: p.jobs.filter(j => !j.family).length };
}
