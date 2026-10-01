// Makes the mechanical parts' models in code (tools/generators/<category>.js) and puts them in the game
// through the import pipeline (tools/content/importer.mjs): each model is checked against the model
// rules, fixed where it can be, checked again, then written with its icon and its part definition —
// a part that was a placeholder gets its model; a new one starts with its tier, a mass from its
// volume and materials, and its price and stats to do. Parts made to fit each car (a roll cage, a
// strut brace) get a version per car (the part's byCar). Then the variants of the parts made get
// their icons again, a preview sheet of everything made is drawn (docs/generated_parts.png), and every
// car with a set of them fitted through the garage, outside and cut away (docs/generated_fit.png).
//
//   npm run generate-parts                    every generator
//   npm run generate-parts -- rims brakes     just these (tools/generators/rims.js, brakes.js)
//     --only rim_mesh,rim_twist5              just these parts
//     --check                                 build and check them, write nothing

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkModel, formatReport } from './content/check.mjs';
import { renderIcon } from './content/icon.mjs';
import { importFile } from './content/importer.mjs';
import { inspect } from './content/inspect.mjs';
import { modelIO } from './content/io.mjs';
import { loadProject } from './content/project.mjs';
import { ROOT, rel } from './content/rules.mjs';
import { carsFor, loadCar } from './generators/lib/car.js';
import { fitSheet } from './generators/lib/fitsheet.js';
import { previewSheet, sheetOf } from './generators/lib/sheet.js';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const checkOnly = args.includes('--check'), only = opt('--only')?.split(',') ?? null;
const wanted = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');
const dir = path.join(ROOT, 'tools/generators');
const all = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).sort();
const bad = wanted.filter(w => !all.includes(w));
if (bad.length) { console.error(`No generator ${bad.join(', ')} (there are: ${all.join(', ')}).`); process.exit(2); }

const colour = process.stdout.isTTY, bold = s => colour ? `\x1b[1m${s}\x1b[0m` : s, red = s => colour ? `\x1b[31m${s}\x1b[0m` : s;
const io = await modelIO(), work = path.join(ROOT, 'incoming/generated');
fs.mkdirSync(work, { recursive: true });
let project = await loadProject();
const made = [], failed = [], previews = [];

for (const name of wanted.length ? wanted : all) {
  const gen = await import(path.join(dir, `${name}.js`));
  const jobs = (await gen.parts({ project, loadCar, carsFor })).filter(j => !only || only.includes(j.id));
  if (!jobs.length) continue;
  console.log(bold(`\n── ${name}: ${jobs.length} part${jobs.length > 1 ? 's' : ''}`));
  for (const job of jobs) {
    const cars = job.cars ?? [];
    const base = cars.length ? (cars.includes(job.baseCar) ? job.baseCar : cars[0]) : null;
    const versions = [base, ...cars.filter(c => c !== base)];
    const notes = [];
    let ok = true;
    for (const carId of versions) {
      const car = carId ? await loadCar(carId) : null, label = `${job.id}${carId && carId !== base ? ` (${carId})` : ''}`;
      let model;
      try { model = await job.build(car); }
      catch (err) { failed.push(label); ok = false; console.log(red(`  ✘ ${label}: ${err.stack ?? err}`)); break; }
      const t = project.rules.types[job.type], doc = await model.document();
      if (model.triangles > t.triangles) { failed.push(label); ok = false; console.log(red(`  ✘ ${label}: ${model.triangles} triangles, over the ${t.label.toLowerCase()} budget (${t.triangles})`)); break; }
      if (checkOnly) {
        const r = checkModel(inspect(doc), { rules: project.rules, type: job.type, file: label });
        if (r.verdict !== 'pass') { console.log(formatReport(label, r, { colour, quiet: true })); if (r.verdict === 'fail') { failed.push(label); ok = false; } }
        const png = path.join(work, `${job.id}${carId && carId !== base ? `__${carId}` : ''}.png`);
        fs.writeFileSync(png, await renderIcon(doc, { rules: project.rules, type: job.type }));
        previews.push({ id: label, group: name, icon: png, note: `${model.triangles} tris · ${model.mass().toFixed(1)} kg` });
        notes.push(`${carId && carId !== base ? carId : `${model.triangles} triangles, ${model.mass().toFixed(1)} kg`}${model.fit?.clashes ? ` (${model.fit.clashes} clash${model.fit.clashes > 1 ? 'es' : ''} left)` : ''}`);
        continue;
      }
      const file = path.join(work, `${job.id}${carId && carId !== base ? `__${carId}` : ''}.glb`);
      fs.writeFileSync(file, await io.writeBinary(doc));
      const mass = +Math.min(t.massRange[1], Math.max(t.massRange[0], model.mass())).toFixed(1);
      const r = await importFile(file, project, {
        type: job.type, id: job.id, keepOriginal: true, byCar: carId && carId !== base ? carId : null, madeBy: 'npm run generate-parts',
        defaults: { ...job.defaults, mass, _massHow: `from its volume and materials (${model.materials().join(', ')})` },
        set: { ...job.set, madeBy: { generator: `tools/generators/${name}.js`, ...(job.design && { design: job.design }), ...(job.settings && { settings: job.settings }) } },
      });
      fs.rmSync(file, { force: true });
      if (r.after && r.after.verdict !== 'pass') console.log(formatReport(rel(file), r.after, { colour, quiet: true }));
      if (!r.ok) { failed.push(label); ok = false; console.log(red(`  ✘ ${label}: ${r.message}`)); break; }
      if (!project.db.parts[job.id]) project = await loadProject();      // (a new part: the next version adds to it)
      notes.push(`${carId && carId !== base ? carId : `${model.triangles} triangles${project.db.parts[job.id]?.todo?.length ? `, new (${mass} kg, price to do)` : ''}`}${model.fit?.clashes ? ` (${model.fit.clashes} clash${model.fit.clashes > 1 ? 'es' : ''} left)` : ''}`);
    }
    if (ok) { made.push(job.id); console.log(`  ✔ ${job.id}: ${notes[0]}${notes.length > 1 ? `; versions for ${notes.slice(1).join(', ')}` : ''}`); }
  }
}

if (!checkOnly && made.length) {
  project = await loadProject();
  for (const p of project.problems) { console.log(red(`  ERROR ${p.file} · ${p.path}: ${p.message}`)); failed.push(p.file); }
  // the variants of what was made: their icons from the new model, in their own finish
  const variants = Object.values(project.db.parts).filter(p => made.includes(p.variantOf)).map(p => p.id);
  if (variants.length) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/icons.mjs'), ...variants], { encoding: 'utf8', cwd: ROOT });
    console.log(`\n${r.stdout.trim()} (variants)`);
  }
  // the preview sheet: every generated part
  const sheet = await previewSheet(project);
  console.log(`\nPreview sheet: ${sheet.file} (${sheet.count} parts)`);
  // and on every car, fitted through the garage as the shop would
  const fit = await fitSheet(project);
  for (const r of fit.report) if (r.missed.length) console.log(red(`  ${r.car}: didn't fit ${r.missed.join(', ')}`));
  console.log(`Fit sheet: ${fit.file} (${fit.report.length} cars, ${fit.report.reduce((n, r) => n + r.fitted.length, 0)} parts fitted)`);
}
if (checkOnly && previews.length) { await sheetOf(previews, path.join(work, 'preview.png'), 'Generated parts (checked, not imported)'); console.log(`\nPreview: ${rel(path.join(work, 'preview.png'))}`); }
console.log(`\n${checkOnly ? 'Checked' : 'Made'} ${made.length} part${made.length === 1 ? '' : 's'}${failed.length ? `; ${failed.length} failed: ${failed.join(', ')}` : ''}.${!checkOnly && made.length ? ' They are in the part preview (http://localhost:7690/dev/parts.html, "Generated"); new ones are in the shop as "coming soon" until their price and stats are filled in.' : ''}`);
process.exit(failed.length ? 1 : 0);
