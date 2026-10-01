// Makes parts from variant tables (data/variants/*.json; tools/content/variants.mjs): one per
// combination of a table's options, with stable ids, prices and stats from the table's rules, and an
// icon each (the base part's model in the variant's look). Variants no longer in a table are retired.
//
//   npm run generate-variants                  every table
//   npm run generate-variants -- rim_5spoke    just these

import fs from 'node:fs';
import path from 'node:path';
import { createValidator } from '../garage/jsonSchema.js';
import { resolveLook } from '../garage/visual.js';
import { renderIcon } from './content/icon.mjs';
import { readModel } from './content/io.mjs';
import { addToIndex } from './content/importer.mjs';
import { writeJson } from './content/json.mjs';
import { loadProject } from './content/project.mjs';
import { ROOT, readJson, typeForPart } from './content/rules.mjs';
import { writeVariants } from './content/variants.mjs';

const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const dir = path.join(ROOT, 'data/variants');
const tables = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).filter(t => !only.length || only.includes(t));
if (!tables.length) { console.log(only.length ? `No tables ${only.join(', ')} in data/variants/.` : 'No variant tables in data/variants/.'); process.exit(0); }
const validator = createValidator({ 'variants.schema.json': readJson('data/schemas/variants.schema.json') });

let failed = false;
for (const tableId of tables) {
  const table = readJson(`data/variants/${tableId}.json`), problems = validator.validate('variants.schema.json', table);
  console.log(`\n── data/variants/${tableId}.json`);
  if (problems.length) { failed = true; for (const p of problems) console.log(`  ERROR ${p.path}: ${p.message}`); continue; }
  const project = await loadProject();
  let r;
  try { r = writeVariants(table, { root: ROOT, db: project.db, tableId }, { writeJson, addToIndex }); }
  catch (err) { failed = true; console.log(`  ✘ ${err.message}`); continue; }
  // icons: the base model in each variant's look
  const base = project.db.parts[table.base], type = typeForPart(base, project.rules), model = resolveLook(base, project.db.parts).model;
  const doc = model && await readModel(path.join(ROOT, model));
  let icons = 0;
  for (const part of r.parts) {
    if (!doc) break;
    const look = resolveLook(part, { ...project.db.parts, [part.id]: part }).look;
    fs.mkdirSync(path.join(ROOT, 'assets/icons/parts'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, part.icon), await renderIcon(doc, { rules: project.rules, type, look }));
    icons++;
  }
  const say = (list, what) => list.length && console.log(`  ${what} ${list.length}: ${list.join(', ')}`);
  say(r.made, 'new'); say(r.updated, 'updated'); say(r.retired, 'retired (no longer in the table: kept for players who own one)'); say(r.unretired, 'back in the table (no longer retired)');
  if (r.unchanged.length) console.log(`  unchanged ${r.unchanged.length}`);
  console.log(`  ${r.parts.length} variants of ${base.name}, ${icons} icons (${doc ? model : 'no model: no icons'})`);
}
const { problems } = await loadProject();
for (const p of problems) { failed = true; console.log(`  ERROR ${p.file} · ${p.path}: ${p.message}`); }
process.exit(failed ? 1 : 0);
