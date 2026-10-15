// Every kind's model generator across its shape settings (docs/CONTENT_PIPELINE.md "Shape settings and kits"): for each
// family kind, starting from its family's middle part, every shape setting at the bottom and the top of its range (each
// value of a list or table, each kit piece) and a set of random mixes of them — each part's model made as the build
// makes it (fitted to every car it goes on, where the kind is fitted; on its car, for an aero kit), then
//  - the model rules (npm run import's checks, levels of detail and compressed textures made as the importer makes
//    them): nothing failing; the budget check: no more than twice the type's triangles
//  - collision hulls made, for a part that comes off in a crash
//  - the fit check (npm run content -- check's) on every car it goes on: through nothing more than the car's own part
// and the shape settings that change what a part does keep its stats inside their ranges, and pass the short drive and
// the crash. Fails with each problem in words.
//
//   node tests/content-shapes.mjs [kinds…] [--random n] [--seed n] [--quick]     (npm run test:shapes)

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROOT, readJson } from '../tools/content/rules.mjs';
import { loadProject } from '../tools/content/project.mjs';
import { expandFamily, priceFamilyParts } from '../tools/content/families.mjs';
import { shapeFor, withKits } from '../tools/shapes/index.js';
import { checkModel } from '../tools/content/check.mjs';
import { autoFix } from '../tools/content/fix.mjs';
import { inspect } from '../tools/content/inspect.mjs';
import { finishModel } from '../tools/content/finish.mjs';
import { collisionHulls } from '../tools/content/collision.mjs';
import { modelIO, quiet } from '../tools/content/io.mjs';
import { listKits } from '../tools/generators/lib/kit.js';
import { loadCar } from '../tools/generators/lib/car.js';
import { fitBuild } from '../tools/generators/lib/fitcheck.js';
import { forCar, REFERENCE_CAR } from '../tools/content/balance.mjs';
import { checkPart } from '../tools/content/checkWorker.mjs';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = args.filter((a, i) => !a.startsWith('--') && !['--random', '--seed'].includes(args[i - 1]));
const RANDOM = +(opt('--random') ?? 4), quick = args.includes('--quick');
const project = await loadProject(), { db, rules } = project, F = readJson('data/content/formulas.json'), tiers = readJson('data/content/tiers.json'), kits = listKits(ROOT), io = await modelIO();
const OUT = path.join(ROOT, '.cache/shape-test');
fs.rmSync(OUT, { recursive: true, force: true });
const families = fs.readdirSync(path.join(ROOT, 'data/families')).map(f => readJson(`data/families/${f}`));
const problems = [], t0 = performance.now();
let models = 0, fits = 0, cases = 0;
let seed = +(opt('--seed') ?? 7) >>> 0 || 7;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

// each shape setting's ends: a range's bottom and top, every value of a list or table, every kit piece
function ends(kind, k, S) {
  if (S.range) return [S.range[0], S.range[1]].map(v => S.integer ? Math.round(v) : v);
  if (S.table) return Object.keys(S.table).filter(x => !x.startsWith('_'));
  if (S.kit) return ['none', ...(kits[kind]?.[S.kit] ?? [])];
  return S.values ?? [];
}
const pick = (kind, k, S) => { const e = ends(kind, k, S); return S.range && !S.integer ? +(S.range[0] + (S.range[1] - S.range[0]) * rnd()).toFixed(4) : S.range ? Math.round(S.range[0] + (S.range[1] - S.range[0]) * rnd()) : e[Math.floor(rnd() * e.length)]; };

for (const base of families) {
  const kindName = base.kind, K = F.families[kindName];
  if (only.length && !only.includes(kindName) && !only.includes(base.id)) continue;
  const all = expandFamily(base, { formulas: F, db, root: ROOT }), mid = all.variants[Math.floor((all.variants.length - 1) / 2)];
  // the family's middle part: its settings fixed, one finish; then each shape case on it
  const settings = Object.fromEntries(Object.entries(mid.settings).filter(([k]) => base.settings?.[k] !== undefined || K.settings[k]?.cars));
  const shapeKeys = Object.keys(K.shapeSettings).filter(k => !k.startsWith('_'));
  const list = [];
  for (const k of shapeKeys) for (const v of ends(kindName, k, K.shapeSettings[k])) list.push({ [k]: v });
  for (let i = 0; i < RANDOM; i++) list.push(Object.fromEntries(shapeKeys.map(k => [k, pick(kindName, k, K.shapeSettings[k])])));
  console.log(`${kindName} (from ${base.id}: ${Object.entries(settings).map(([k, v]) => `${k} ${v}`).join(', ')}): ${list.length} shapes`);
  for (const [i, sh] of list.entries()) {
    cases++;
    const def = { id: `shape_test_${kindName}`, kind: kindName, name: 'Shape test', settings, shape: { ...(base.shape ?? {}), ...sh }, finishes: [mid.finish] };
    const what = `${kindName} ${Object.entries(sh).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    const r = expandFamily(def, { formulas: F, db, root: ROOT });
    if (r.problems.length || !r.variants.length) { problems.push(`${what}: not made — ${r.problems[0]}`); continue; }
    const v = r.variants[0], p = v.part;
    // (its stats inside their ranges: expandFamily refuses any outside — and priced, as the build prices it)
    const priced = priceFamilyParts([{ part: p, ctx: v.ctx }], { db, formulas: F, tiers });
    if (priced.problems.size) { problems.push(`${what}: can't be priced — ${[...priced.problems.values()][0][0]}`); continue; }
    const design = await withKits(kindName, K, v.design), shape = shapeFor(K.shape), dbx = { ...db, parts: { ...db.parts, [p.id]: p } };
    const cars = K.perCar ? [v.settings.car] : Object.keys(db.cars).filter(c => forCar(dbx, c, p)).sort((a, b) => (b === REFERENCE_CAR) - (a === REFERENCE_CAR) || a.localeCompare(b)).slice(0, quick ? 2 : undefined);
    const fitted = K.fit && fitBuild({ db: dbx, rules, type: K.type, slot: p.slot, axes: K.fit.axes, weights: K.fit.weights, attach: K.fit.attach ?? 0 }, (c, car) => shape(v.modelKey, v.ctx, v.stats, design, car, c));
    const files = {};
    for (const carId of K.fit || K.perCar ? cars : [null]) {
      let model;
      try { model = K.perCar ? await shape(v.modelKey, v.ctx, v.stats, design, await loadCar(carId)) : K.fit ? await fitted(await loadCar(carId)) : await shape(v.modelKey, v.ctx, v.stats, design); }
      catch (err) { problems.push(`${what}${carId ? ` on the ${carId}` : ''}: its model couldn't be made — ${err.message}`); continue; }
      models++;
      if (model.fit?.clashes >= 10) continue;                // (the build leaves it off that car: not a car it goes on)
      const doc = quiet(await model.document());
      await autoFix(doc, { rules, type: K.type, compress: true });
      await finishModel(doc, { rules });
      const info = inspect(doc), check = checkModel(info, { rules, type: K.type, file: `${v.modelKey}.glb` });
      for (const f of check.findings.filter(f => f.level === 'fail')) problems.push(`${what}${carId ? ` on the ${carId}` : ''}: ${f.text}`);
      if (info.triangles.length > rules.types[K.type].triangles * 2) problems.push(`${what}: ${info.triangles.length} triangles, over twice the budget`);
      if (p.detach?.detachable && rules.collision) { const c = await collisionHulls(info.triangles, rules.collision); if (!c?.hulls?.length && !c?.length) problems.push(`${what}: no collision hulls`); }
      const file = `.cache/shape-test/${kindName}/${i}${carId ? `_${carId}` : ''}.glb`;
      fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, file), Buffer.from(await io.writeBinary(doc)));
      files[carId ?? '*'] = file;
    }
    // the fit check on every car it goes on (as npm run content -- check runs it: through no more than the stock part)
    const on = K.fit || K.perCar ? Object.keys(files) : cars;
    if (!on.length) { problems.push(`${what}: it fits no car`); continue; }
    const own = files[on[0]] ?? files['*'], part = { ...p, model: own, ...(K.fit && on.length > 1 && { byCar: Object.fromEntries(on.slice(1).map(c => [c, { model: files[c] }])) }) };
    const dbf = { ...db, parts: { ...db.parts, [p.id]: part } };
    const r2 = await checkPart(dbf, p.id, { kinds: ['fit', ...(Object.keys(sh).some(k => K.shapeSettings[k].stats) ? ['drive', 'crash'] : [])], cars: on });
    fits += on.length;
    for (const [k, res] of Object.entries(r2)) for (const x of res.problems ?? []) problems.push(`${what}: ${k}: ${x}`);
  }
}
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n${cases} shapes, ${models} models, ${fits} fit checks — ${((performance.now() - t0) / 1000).toFixed(0)} s.`);
for (const p of problems) console.log(`  ✘ ${p}`);
console.log(problems.length ? `\n${problems.length} problem${problems.length > 1 ? 's' : ''}.` : 'Every shape passes.');
process.exit(problems.length ? 1 : 0);
