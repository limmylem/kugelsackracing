// Making content from its definitions (npm run content -- build; docs/CONTENT_PIPELINE.md): every engine
// (data/engines/<id>.json → its crate engine part) and every part family (data/families/<id>.json → a part for each
// combination of its settings and finishes), each with its stats from data/content/formulas.json, its model (made in
// code: tools/shapes/ — fitted to each car it goes on, for the kinds that need it), checked against the model rules,
// its icon, and — for a family's parts — its tier, price and unlock level from what it does (measured on a car, by
// the economy rules). Every file it writes is worked out from the definitions, the same every time: change the
// definition, not the files. A part no longer made is retired (kept: players who own one keep it), never deleted.
//
//   buildContent({ only: [ids], check: true }) → { made, updated, unchanged, retired, failed: [{ id, problems }], parts, models }
//     (check: build and check everything, write nothing)

import fs from 'node:fs';
import path from 'node:path';
import { checkModel } from './check.mjs';
import { autoFix } from './fix.mjs';
import { renderIcon } from './icon.mjs';
import { inspect } from './inspect.mjs';
import { finishModel } from './finish.mjs';
import { collisionHulls } from './collision.mjs';
import { modelIO, quiet } from './io.mjs';
import { formatJson, writeJson } from './json.mjs';
import { loadProject } from './project.mjs';
import { ROOT, readJson } from './rules.mjs';
import { addToIndex } from './importer.mjs';
import { forCar, REFERENCE_CAR } from './balance.mjs';
import { cratePart } from '../../garage/engines.js';
import { expandFamily, priceFamilyParts } from './families.mjs';
import { engineModel } from '../shapes/engine.js';
import { shapeFor } from '../shapes/index.js';
import { loadCar } from '../generators/lib/car.js';
import { fitBuild, fitCheck } from '../generators/lib/fitcheck.js';

const round = (v, d = 4) => +v.toFixed(d);
export const listDefs = (root, dir) => fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.json')).sort().map(f => ({ file: `${dir}/${f}`, def: readJson(`${dir}/${f}`, root) })) : [];

// Whether an engine's sound (data/sounds/engines/<sound>.json) was made for it: as many cylinders, and recorded from
// below its idle to past its redline (the sound's sweep: what tests/check-data.mjs holds every engine to)
export function soundProblems(root, def) {
  const cfg = readJson(`data/sounds/engines/${def.sound}.json`, root), out = [];
  if (cfg.cylinders && cfg.cylinders !== def.cylinders) out.push(`${def.id}: its sound, ${def.sound}, is a ${cfg.cylinders}-cylinder's: a ${def.cylinders}-cylinder engine would sound wrong (pick a sound with ${def.cylinders}, or make one: npm run sounds)`);
  if (cfg.granular?.grains && fs.existsSync(path.join(root, cfg.granular.grains))) {
    const g = readJson(cfg.granular.grains, root), lo = Math.max(g.on[0][2], g.off[0][2]), hi = Math.min(g.on.at(-1)[2], g.off.at(-1)[2]);
    if (!(lo <= def.idle * 0.9 && hi >= def.redline * 1.03)) out.push(`${def.id}: its sound, ${def.sound}, was recorded from ${Math.round(lo)} to ${Math.round(hi)} rpm: it suits an engine idling at ${Math.ceil(lo / 0.9 / 10) * 10} rpm or more and revving to ${Math.floor(hi / 1.03 / 10) * 10} at most (this one: ${def.idle}–${def.redline}). Change the revs, or pick or make another sound (npm run sounds).`);
  }
  return out;
}

// Everything the definitions make (parts without their model's numbers yet), and the problems that stop any
export async function plan({ root = ROOT, only = null, project = null } = {}) {
  project ??= await loadProject(root);
  const formulas = readJson('data/content/formulas.json', root), standards = readJson('data/content/standards.json', root), tiers = readJson('data/content/tiers.json', root);
  const jobs = [], failed = [];
  const wanted = (...ids) => !only || ids.some(id => only.includes(id));
  // engines → crate engines
  for (const { file, def } of listDefs(root, 'data/engines')) {
    if (!wanted(def.id, `crate_${def.id}`)) continue;
    if (path.basename(file, '.json') !== def.id) { failed.push({ id: def.id ?? file, source: file, problems: [`${file}: its id should be "${path.basename(file, '.json')}" (its file name)`] }); continue; }
    if (!fs.existsSync(path.join(root, `data/sounds/engines/${def.sound}.json`))) { failed.push({ id: def.id, source: file, problems: [`${def.id}: there's no engine sound "${def.sound}" (data/sounds/engines: ${fs.readdirSync(path.join(root, 'data/sounds/engines')).map(f => f.replace(/\.json$/, '')).join(', ')})`] }); continue; }
    const r = cratePart(def, { formulas, standards, tiers });
    if (!r.part) { failed.push({ id: def.id, source: file, problems: r.problems }); continue; }
    const heard = soundProblems(root, def);
    if (heard.length) { failed.push({ id: def.id, source: file, problems: heard }); continue; }
    const p = r.part;
    jobs.push({ id: p.id, source: file, type: 'engine', part: p, look: null, engineFit: true, models: [{ file: p.model, build: () => engineModel(p.id, { ...def, size: r.design.size, mount: [].concat(def.mount)[0] }) }] });
  }
  // part families → their parts (each fitted to every car it goes on, for a kind that's fitted)
  for (const { file, def } of listDefs(root, 'data/families')) {
    if (!wanted(def.id)) continue;
    if (path.basename(file, '.json') !== def.id) { failed.push({ id: def.id ?? file, source: file, problems: [`${file}: its id should be "${path.basename(file, '.json')}" (its file name)`] }); continue; }
    const r = expandFamily(def, { formulas, db: project.db });
    if (r.problems.length) failed.push({ id: def.id, source: file, problems: r.problems });
    const shape = r.kind && shapeFor(r.kind.shape);
    if (r.kind && !shape) { failed.push({ id: def.id, source: file, problems: [`${def.id}: there's no shape "${r.kind.shape}" (tools/shapes/index.js)`] }); continue; }
    // (the cars each goes on: the data with the new parts in it)
    const all = { ...project.db, parts: { ...project.db.parts, ...Object.fromEntries(r.variants.map(v => [v.id, v.part])) } };
    for (const v of r.variants) {
      const p = v.part, design = def.shape ?? {}, base = `assets/parts/${p.category}/${def.id}/${v.modelKey}`;
      let models;
      if (r.kind.perCar) models = [{ file: p.model, build: async () => shape(v.modelKey, v.ctx, v.stats, design, await loadCar(v.settings.car)) }];
      else if (r.kind.fit) {
        const cars = Object.keys(all.cars).filter(c => forCar(all, c, p)).sort((a, b) => (b === REFERENCE_CAR) - (a === REFERENCE_CAR) || a.localeCompare(b));
        if (!cars.length) { failed.push({ id: p.id, source: file, problems: [`${p.name}: it doesn't go on any car (it needs ${p.fits.flat().join(', ') || 'nothing'})`] }); continue; }
        const fitted = fitBuild({ db: all, rules: project.rules, type: r.kind.type, slot: p.slot, axes: r.kind.fit.axes, weights: r.kind.fit.weights, attach: r.kind.fit.attach ?? 0 }, (c, car) => shape(v.modelKey, v.ctx, v.stats, design, car, c));
        // (a model for each car; which car's is the part's own, and which it can't be made to fit, once they're made)
        models = cars.map(carId => ({ file: `${base}/${carId}.glb`, car: carId, fitted: true, build: async () => fitted(await loadCar(carId)) }));
      } else models = [{ file: p.model, build: () => shape(v.modelKey, v.ctx, v.stats, design) }];
      jobs.push({ id: p.id, source: file, family: def.id, type: r.kind.type, part: p, ctx: v.ctx, look: p.look ?? null, models });
    }
  }
  return { project, formulas, standards, tiers, jobs, failed };
}

export async function buildContent({ root = ROOT, only = null, check = false, log = () => {} } = {}) {
  const { project, formulas, tiers, jobs, failed } = await plan({ root, only });
  const out = { made: [], updated: [], unchanged: [], retired: [], failed, parts: [], models: 0, clashes: [] };
  const io = await modelIO(), rules = project.rules, made = new Map();
  // each model once (a family's finishes share theirs): made, fixed (compressed), checked
  for (const job of jobs) {
    for (const m of job.models) {
      if (!made.has(m.file)) {
        let doc = null, problems = [], fit = null, model = null;
        try {
          model = await m.build();
          const t = rules.types[job.type];
          fit = model.fit ?? null;
          if (model.triangles > t.triangles * 2) problems.push(`${job.id}: its model has ${model.triangles.toLocaleString('en-GB')} triangles, over twice the ${t.label.toLowerCase()} budget (${t.triangles.toLocaleString('en-GB')})`);
          doc = quiet(await model.document());
          await autoFix(doc, { rules, type: job.type, compress: true });
          const r = checkModel(inspect(doc), { rules, type: job.type, file: m.file });
          for (const x of r.findings) if (x.level === 'fail') problems.push(`${job.id}${m.car ? ` (on the ${project.db.cars[m.car].name})` : ''}: its model — ${x.text}${x.fix ? ` ${x.fix}` : ''}`);
        } catch (err) { problems.push(`${job.id}: its model couldn't be made: ${err.message}`); }
        made.set(m.file, { doc, problems, fit, info: doc ? inspect(doc) : null, tris: model?.tris?.() ?? null });
        log(`  model ${m.file}${fit?.clashes ? ` (${fit.clashes} clash${fit.clashes > 1 ? 'es' : ''} left)` : ''}`);
      }
      const r = made.get(m.file);
      if (r.problems.length) { job.failed = [...(job.failed ?? []), ...r.problems]; continue; }
      m.bounds = { min: r.info.bounds.min.map(v => round(v)), max: r.info.bounds.max.map(v => round(v)) };
      if (!m.fitted) { job.part.bounds = m.bounds; if (!job.part.massOffset) job.part.massOffset = r.info.centroid.map(v => round(v, 3)); }
    }
    // fitted to each car: a car where even its best fit goes through the body or another part (or through the engine
    // in 10 places or more) is one it doesn't go on; its own model is the first car's it fits (the starter car's if it can)
    if (job.models[0]?.fitted && !job.failed) {
      const fits = job.models.filter(m => (made.get(m.file).fit?.clashes ?? 0) < 10), no = job.models.filter(m => !fits.includes(m));
      for (const m of job.models) if (made.get(m.file).fit?.clashes > 0) out.clashes.push({ id: job.id, car: m.car, clashes: made.get(m.file).fit.clashes, left: !fits.includes(m) });
      if (!fits.length) { job.failed = [`${job.part.name}: it can't be made to fit any car it would go on (${no.map(m => `${project.db.cars[m.car].name}: through it in ${made.get(m.file).fit.clashes} places`).join('; ')})`]; continue; }
      const own = fits[0];
      job.part.model = own.file; job.part.bounds = own.bounds;
      job.part.massOffset = made.get(own.file).info.centroid.map(v => round(v, 3));
      if (fits.length > 1) job.part.byCar = Object.fromEntries(fits.slice(1).map(m => [m.car, { model: m.file, bounds: m.bounds }]));
      if (no.length) {
        job.part.conflicts = [...job.part.conflicts, ...no.map(m => `car:${m.car}`)];
        job.part._fit = `It can't be made to fit the ${no.map(m => project.db.cars[m.car].name).join(', ')} (its best fit still goes through the car), so it isn't for ${no.length > 1 ? 'them' : 'it'}.`;
      }
      job.models = [own, ...fits.slice(1)];
    }
  }
  for (const j of jobs.filter(j => j.failed)) failed.push({ id: j.id, source: j.source, problems: [...new Set(j.failed)] });
  let ok = jobs.filter(j => !j.failed);
  // a family's parts: what they do, measured on a car, → their tier, price and unlock level (the economy rules)
  const famJobs = ok.filter(j => j.family);
  if (famJobs.length) {
    const priced = priceFamilyParts(famJobs.map(j => ({ part: j.part, ctx: j.ctx })), { db: project.db, formulas, tiers });
    for (const j of famJobs) { const p = priced.problems.get(j.id); if (p?.length) { j.failed = p; failed.push({ id: j.id, source: j.source, problems: p }); } }
    ok = ok.filter(j => !j.failed);
  }
  if (check) { out.parts = ok.map(j => j.part); out.models = made.size; return out; }

  // write: the models, the icons, the part files, the index
  const writeIf = (full, bytes) => { fs.mkdirSync(path.dirname(full), { recursive: true }); if (!fs.existsSync(full) || !fs.readFileSync(full).equals(bytes)) fs.writeFileSync(full, bytes); };
  // (each model finished as the importer finishes one: its levels of detail, big textures compressed — and, for a part
  // that comes off in a crash, its collision hulls, worked out once a model)
  const written = new Set(), hulls = new Map();
  for (const j of ok) for (const m of j.models) if (!written.has(m.file)) { const doc = made.get(m.file).doc; await finishModel(doc, { rules }); writeIf(path.join(root, m.file), Buffer.from(await io.writeBinary(doc))); written.add(m.file); }
  const hullsOf = async file => { if (!hulls.has(file)) hulls.set(file, rules.collision ? await collisionHulls(made.get(file).info.triangles, rules.collision) : null); return hulls.get(file); };
  for (const j of ok.filter(j => j.part.detach?.detachable && made.has(j.part.model))) {
    const c = await hullsOf(j.part.model);
    if (c) j.part.collision = c;
    for (const v of Object.values(j.part.byCar ?? {})) if (made.has(v.model)) { const cv = await hullsOf(v.model); if (cv) v.collision = cv; }
  }
  // a crate engine in each car its mount and bay say it fits, as the garage fits it (the airbox and header that go
  // with the car's own engine off): a car whose bonnet or body it would go through is one it isn't for
  for (const j of ok.filter(j => j.engineFit)) {
    const all = { ...project.db, parts: { ...project.db.parts, [j.id]: { ...j.part, conflicts: [] } } }, no = [];
    for (const carId of Object.keys(all.cars).filter(c => forCar(all, c, all.parts[j.id])).sort()) {
      const r = await fitCheck(all, carId, j.id);
      if (r.error) { no.push({ carId, why: r.error }); continue; }
      const through = Object.entries(r.clashes).filter(([owner]) => owner !== all.parts[all.cars[carId].sockets.find(x => x.slot === 'engine')?.stock?.[0]]?.name);
      if (through.length) no.push({ carId, why: through.map(([o, n]) => `through ${o} in ${n} place${n > 1 ? 's' : ''}`).join(', ') });
    }
    if (no.length) {
      j.part.conflicts = [...j.part.conflicts, ...no.map(x => `car:${x.carId}`)];
      j.part._fit = `It doesn't fit the ${no.map(x => `${project.db.cars[x.carId].name} (${x.why})`).join('; ')}: so it isn't for ${no.length > 1 ? 'them' : 'it'}.`;
      for (const x of no) out.clashes.push({ id: j.id, car: x.carId, left: true });
    }
  }
  for (const j of ok) {
    writeIf(path.join(root, j.part.icon), await renderIcon(made.get(j.part.model).doc, { rules, type: j.type, look: j.look }));
    const file = `data/parts/${j.part.category}/${j.part.id}.json`, full = path.join(root, file), was = project.db.parts[j.part.id];
    if (was && !was.generated?.engine && !was.generated?.family) { failed.push({ id: j.id, source: j.source, problems: [`${j.id}: there's already a part "${j.id}" that wasn't made from ${j.source}: rename it in ${j.source}`] }); continue; }
    // (its status is the content workflow's: a part already made keeps the one it has)
    const part = { ...j.part, status: was?.status ?? j.part.status };
    const text = formatJson(part) + '\n', old = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    if (old === text) out.unchanged.push(j.id);
    else { writeJson(full, part); (old ? out.updated : out.made).push(j.id); }
    if (!old) addToIndex(root, 'data/parts/index.json', 'parts', `${j.part.category}/${j.part.id}.json`);
    out.parts.push(part);
  }
  out.models = written.size;
  // made before from a definition that doesn't make it now (or a definition that's gone): retired — players who own
  // one keep it
  const failedDefs = new Set(failed.map(f => f.id));
  for (const p of Object.values(project.db.parts)) {
    if (!(p.generated?.engine || p.generated?.family) || p.retired) continue;
    const from = p.generated.engine ?? p.generated.family, src = p.generated.engine ? `data/engines/${from}.json` : `data/families/${from}.json`;
    if (only && !only.includes(from) && !only.includes(p.id)) continue;
    if (jobs.some(j => j.id === p.id) || failedDefs.has(from) || failedDefs.has(p.id)) continue;      // (still made, or its definition failed: left as it is)
    const full = path.join(root, `data/parts/${p.category}/${p.id}.json`), def = readJson(full);
    def.retired = true;
    def._retired = `No longer made by ${src} (${new Date().toISOString().slice(0, 10)}): not sold, but copies players own still work. Its id stays.`;
    writeJson(full, def);
    out.retired.push(p.id);
  }
  return out;
}
