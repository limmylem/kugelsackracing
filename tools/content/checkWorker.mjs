// One part's automatic checks (npm run content -- check: tools/content/checks.mjs runs these in worker threads), on
// each car it fits, by the rules in data/content/check-rules.json:
//   fit     through nothing on the car (tools/generators/lib/fitcheck.js)
//   drive   0–100 and 100–0 at the test centre, the car real numbers, upright and on its wheels (physics/testSuite.js)
//   crash   into the wall with it on: the damage, what's loose, drivability and the repair real numbers (garage/crashSuite.js)
//   sound   it sounds, as its settings say (audio/dsp.js, tests/audioHarness.mjs)
//   budget  its models against the model rules
//   economy its price and what it does against its tier (data/content/tiers.json)
// Each result: { ok, problems: [plain words], notes?, cars?: { carId: { ok, problems, … } } }.
//
//   checkPart(partId, { kinds, cars }) → { [kind]: result }      classCheck(carId) → { … }

import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { createRun } from '../../physics/testSuite.js';
import { runCrash } from '../../garage/crashSuite.js';
import { harness, crashContext, root } from '../../tests/harness.mjs';
import { fitCheck, ENGINE_MOUNTED } from '../generators/lib/fitcheck.js';
import { checkModel } from './check.mjs';
import { inspect } from './inspect.mjs';
import { readModel } from './io.mjs';
import { fitWithNeeds, forCar, partGain, REFERENCE_CAR } from './balance.mjs';
import { maxBuild } from './maxbuild.mjs';
import { classProblems } from './classes.mjs';
import { loadRules, readJson } from './rules.mjs';
import { partShape } from '../../garage/partShape.js';
import { Garage } from '../../garage/data.js';
import { released } from '../../garage/content.js';

const R = readJson('data/content/check-rules.json'), tiers = readJson('data/content/tiers.json'), rules = loadRules();
const finite = x => x == null ? true : typeof x === 'number' ? Number.isFinite(x) : Array.isArray(x) ? x.every(finite) : typeof x === 'object' ? Object.values(x).every(finite) : true;
const r2 = v => typeof v === 'number' ? +v.toFixed(3) : v;
let H = null, C = null, S = null;
const fitted = (db, carId, partId) => { const f = fitWithNeeds(db, carId, partId); return f.ok ? f : { ...f, ok: false }; };

// ---------- fit and clipping ----------
async function fit(db, part, carId) {
  if (!partShape(part, db.parts, carId).model) return { ok: true, problems: [], note: 'no model yet: nothing to fit' };
  const r = await fitCheck(db, carId, part.id);
  if (r.error) return { ok: false, problems: [`it can't be fitted: ${r.error}`] };
  const engine = Object.keys(r.clashes).filter(o => db.parts[Object.values(db.cars[carId].sockets).find(s => s.slot === 'engine')?.stock?.[0]]?.name === o);
  const mounted = ENGINE_MOUNTED.has(part.slot), problems = [];
  for (const [owner, n] of Object.entries(r.clashes)) {
    if (mounted && engine.includes(owner) && n <= R.fit.engineTouch) continue;
    problems.push(`it goes through ${owner} (${n} place${n > 1 ? 's' : ''})`);
  }
  return { ok: !problems.length, problems, clashes: r.clashes };
}

// ---------- a short drive ----------
async function drive(db, part, carId) {
  H ??= await harness();
  const f = fitted(db, carId, part.id);
  if (!f.ok) return { ok: false, problems: [`it can't be fitted: ${f.error}`] };
  const stats = f.garage.stats(), spec = stats.spec;
  if (!spec) return { ok: false, problems: ['the car can\'t be built with it'] };
  if (!finite(spec)) return { ok: false, problems: ['the car\'s numbers with it aren\'t all real numbers (NaN or infinite)'] };
  if (!f.garage.drivable().ok) return { ok: false, problems: [`the car can't be driven with it: ${f.garage.drivable().reasons.join(' ')}`] };
  const out = { ok: true, problems: [] };
  for (const id of ['zeroTo100', 'braking']) {
    const run = createRun({ RAPIER: H.RAPIER, settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track }, id);
    let steps = 0;
    while (!run.done && steps < 200000) { run.next(5000); steps += 5000; }
    const v = run.sim?.vehicle, t = v?.body.translation(), q = v?.body.rotation(), value = run.result?.value;
    const up = q ? 1 - 2 * (q.x * q.x + q.z * q.z) : 1;          // (the car's up, against the world's)
    out[id] = r2(value ?? null);
    if (!run.done) out.problems.push(`${id === 'zeroTo100' ? '0–100' : '100–0'} didn't finish`);
    else if (value == null || !Number.isFinite(value)) out.problems.push(`${id === 'zeroTo100' ? 'it didn\'t reach 100 km/h' : 'it didn\'t stop from 100 km/h'}`);
    else if (value > R.drive[id]) out.problems.push(id === 'zeroTo100' ? `0–100 took ${value.toFixed(1)} s (at most ${R.drive.zeroTo100})` : `100–0 took ${value.toFixed(1)} m (at most ${R.drive.braking})`);
    if (t && !(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z))) out.problems.push('the car went somewhere that isn\'t a real number');
    if (up < 0.8) out.problems.push(`it ended ${up < 0 ? 'upside down' : 'on its side'}`);
  }
  out.ok = !out.problems.length;
  return out;
}

// ---------- a crash ----------
async function crash(db, part, carId) {
  C ??= await crashContext();
  const f = fitted(db, carId, part.id);
  if (!f.ok) return { ok: false, problems: [`it can't be fitted: ${f.error}`] };
  const T = { ...C.targets, seconds: C.targets.seconds ?? 2.5 };
  let r;
  try { r = runCrash({ ...C, db, garage: () => f.garage }, { id: 'check', kind: 'wall', kmh: R.crash.kmh, direction: R.crash.direction, carId }, T); }
  catch (err) { return { ok: false, problems: [`the crash went wrong: ${err.message}`] }; }
  const o = r.cars[0], problems = [], win = db.economy.raceRewards?.win ?? 1500;
  if (!finite({ strength: o.strength, minCondition: o.minCondition, quick: o.repair.quick, full: o.repair.full })) problems.push('its damage or repair isn\'t a real number');
  if (o.repair.full > R.crash.maxOfWin * win) problems.push(`fixing a ${R.crash.kmh} km/h crash costs $${Math.round(o.repair.full).toLocaleString('en-GB')}: more than ${R.crash.maxOfWin} race wins`);
  return { ok: !problems.length, problems, drivable: o.drivable, repair: Math.round(o.repair.full), loose: o.loose.length + o.detached.length };
}

// ---------- its sound ----------
async function sound(db, part, carId) {
  if (!part.sound && !part.engine) return { ok: true, problems: [], note: 'no sound of its own' };
  if (!S) { const A = await import('../../tests/audioHarness.mjs'); S = { ...(await A.soundHarness()), A }; }
  const problems = [];
  let before, after;
  try { before = S.spec(carId); after = S.spec(carId, [part.id]); }
  catch (err) { return { ok: false, problems: [`it can't be fitted to hear it: ${err.message}`] }; }
  const level = spec => { const v = S.engine(spec, { mute: { intake: false, pops: true } }); const x = S.A.render(v, R.sound.seconds, () => ({ rpm: spec.engine.redlineRpm * 0.75, throttle: 1, pedal: 1, load: 1, gear: 3 }), { channels: [0] }); return { rms: S.A.rms(x, x.length >> 1), peak: S.A.peak(x), finite: x.every(Number.isFinite) }; };
  let a, b;
  try { a = level(before); b = level(after); }
  catch (err) { return { ok: false, problems: [`its sound couldn't be played: ${err.message}`] }; }
  if (!b.finite) problems.push('its sound isn\'t a real signal (NaN)');
  else if (b.rms < 1e-4) problems.push('with it the engine is silent');
  else if (b.peak > R.sound.peak) problems.push(`it's far too loud (peak ${b.peak.toFixed(2)})`);
  const want = after.audio?.exhaust?.level / (before.audio?.exhaust?.level || 1);
  if (part.sound?.exhaust?.level > 1.04 && !(b.rms > a.rms)) problems.push(`its exhaust should make it louder (${want.toFixed(2)}×) but it doesn't`);
  return { ok: !problems.length, problems, louder: r2(b.rms / (a.rms || 1)) };
}

// ---------- its models ----------
async function budget(db, part) {
  const files = [...new Set([part.model, ...Object.values(part.byCar ?? {}).map(v => v.model)].filter(Boolean))], problems = [], notes = [];
  const type = Object.entries(rules.types).find(([, t]) => t.slot === part.slot)?.[0];
  if (!type) return { ok: true, problems: [], note: `no model rules for the ${part.slot} slot` };
  let tris = 0;
  for (const f of files) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) { problems.push(`its model ${f} isn't there`); continue; }
    const bytes = fs.statSync(full).size;
    if (bytes > R.budget.maxBytes) problems.push(`${f} is ${(bytes / 1024).toFixed(0)} KB (at most ${(R.budget.maxBytes / 1024).toFixed(0)} KB)`);
    const info = inspect(await readModel(full)), r = checkModel(info, { rules, type, file: f });
    tris = Math.max(tris, info.triangleCount);
    for (const x of r.findings) {
      if (!['triangles', 'textures'].includes(x.check)) continue;
      if (x.level === 'fail') problems.push(`${f}: ${x.text}`); else if (x.level === 'warn') notes.push(`${f}: ${x.text}`);
    }
  }
  return { ok: !problems.length, problems, notes, triangles: tris, models: files.length };
}

// ---------- its price and what it does ----------
const curves = new Map();
async function economy(db, part) {
  const problems = [], rule = tiers.slots[part.slot];
  if (part.tier === 'stock' || !part.tier) return { ok: true, problems: [], note: part.tier === 'stock' ? 'a stock part: not sold on its own' : 'no tier' };
  if (!rule) return { ok: false, problems: [`data/content/tiers.json has no rules for the ${part.slot} slot`] };
  const band = tiers.tiers[part.tier].price.map(k => k * rule.street), each = part.price;
  if (each < band[0] - 0.5 || each > band[1] + 0.5) problems.push(`$${each.toLocaleString('en-GB')} is outside the ${part.tier} price band for ${part.slot} ($${Math.round(band[0]).toLocaleString('en-GB')}–$${Math.round(band[1]).toLocaleString('en-GB')})`);
  const out = { ok: true, problems };
  if (rule.stat && !part.purpose && rule.gain?.[part.tier]) {
    const carId = part.generated?.measuredOn ?? (forCar(db, REFERENCE_CAR, part) ? REFERENCE_CAR : Object.keys(db.cars).sort().find(c => forCar(db, c, part)));
    if (carId) {
      const g = partGain(db, carId, part, tiers), range = rule.gain[part.tier];
      if (!g.ok) problems.push(`it can't be fitted to the ${db.cars[carId].name} to measure it: ${g.error}`);
      else {
        out.gain = r2(g.gain); out.on = carId;
        if (g.gain == null || g.gain < range[0] - 1e-9 || g.gain > range[1] + 1e-9) problems.push(`it improves ${[].concat(rule.stat).join(' / ')} by ${g.gain == null ? 'nothing' : `${(g.gain * 100).toFixed(1)}%`}: a ${part.tier} ${part.slot} part gives ${(range[0] * 100).toFixed(1)}–${(range[1] * 100).toFixed(1)}%`);
        // (value for money against the slot's hand-made parts on the same car: too cheap for what it does)
        const key = `${carId}|${part.slot}`;
        if (!curves.has(key)) {
          const own = Object.values(db.parts).filter(p => p.slot === part.slot && !p.generated && !p.retired && !p.todo?.length && p.tier && p.tier !== 'stock' && !p.purpose && forCar(db, carId, p));
          curves.set(key, Math.max(0, ...own.map(p => { const x = partGain(db, carId, p, tiers); return x.ok && x.gain > 0 ? x.gain / p.price : 0; })));
        }
        const best = curves.get(key), price = part.price / (part.generated?.priceFactor ?? 1);
        if (part.generated && best > 0 && g.gain > 0 && g.gain / price > R.economy.valueOutlier * best) problems.push(`it's too cheap for what it does: ${((g.gain / price) / best).toFixed(1)}× the value of the best ${part.slot} part made by hand (at most ${R.economy.valueOutlier}×)`);
      }
    }
  }
  out.ok = !problems.length;
  return out;
}

const PER_CAR = { fit, drive, crash };
export async function checkPart(db, partId, { kinds, cars }) {
  const part = db.parts[partId], out = {};
  for (const kind of kinds) {
    try {
      if (PER_CAR[kind]) {
        const res = {};
        for (const c of cars) res[c] = await PER_CAR[kind](db, part, c);
        const failed = Object.entries(res).filter(([, r]) => !r.ok);
        out[kind] = { ok: !failed.length, problems: failed.flatMap(([c, r]) => r.problems.map(p => `on the ${db.cars[c].name}: ${p}`)), cars: res };
      } else if (kind === 'sound') out.sound = cars.length ? await sound(db, part, cars[0]) : { ok: true, problems: [], note: 'it goes on no car' };
      else if (kind === 'budget') out.budget = await budget(db, part);
      else if (kind === 'economy') out.economy = await economy(db, part);
    } catch (err) { out[kind] = { ok: false, problems: [`the ${kind} check went wrong: ${err.message}`] }; }
  }
  return out;
}

// The class limits for one car: its most powerful build with every part there is (drafts too: anything that could be
// published). Over the limit with drafts in that build: those drafts are to blame (they can't be published), and the
// search runs again without them — until it's within the limit, or it's over with published parts alone (the car fails)
export function classCheck(db, carId) {
  const balance = readJson('data/content/balance.json'), blamed = [];
  const s = new Garage(db, null, carId).stats().totals.rating;
  let max, problems = [];
  for (let round = 0; round < 5; round++) {
    max = maxBuild(db, carId, { forSale: p => !p.retired && !p.todo?.length && !blamed.includes(p.id) });
    problems = classProblems(db, carId, balance, { stock: s, max: max.rating });
    if (!problems.length) break;
    const drafts = max.parts.filter(id => !released(db.parts[id]));
    if (!drafts.length) break;
    blamed.push(...drafts.map(id => ({ id, why: `with it the ${db.cars[carId].name}'s most powerful build is class ${max.rating.class} (${max.rating.index}): ${problems[0]}` })).filter(b => !blamed.some(x => x.id === b.id)));
  }
  return { ok: !problems.length, problems, blamed, stock: { index: s.index, class: s.class }, max: { index: max.rating.index, class: max.rating.class, parts: max.parts, tuning: max.tuning } };
}

if (parentPort && workerData?.worker) {
  const { loadProject } = await import('./project.mjs');
  const { db } = await loadProject();
  parentPort.on('message', async job => {
    try {
      if (job.car && job.classes) parentPort.postMessage({ id: job.id, car: job.car, classes: classCheck(db, job.car) });
      else parentPort.postMessage({ id: job.id, partId: job.partId, results: await checkPart(db, job.partId, job) });
    } catch (err) { parentPort.postMessage({ id: job.id, partId: job.partId, car: job.car, error: err.stack ?? String(err) }); }
  });
  parentPort.postMessage({ ready: true });
}
