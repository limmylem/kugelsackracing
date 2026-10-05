// Bulk validation of world content (Phase 4 Step 5): every quest, route and series in an export (the
// editor's Export, or the content service's exportContent) checked again — after a map rebake or a change
// to the rules — against the baked regions' road graphs (assets/map/<region>/graph.json.gz), and
// everything that needs looking at listed with the reasons (content/bulk.js).
//
//   npm run validate-content -- --file content.json [--json out.json]
//   exits with code 1 if anything has errors (warnings and notes don't fail it)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { contentChecker } from '../content/schema.js';
import { makeRater } from '../content/rating.js';
import { validateAll } from '../content/bulk.js';
import { createNetwork } from '../route/network.js';

const ROOT = new URL('..', import.meta.url).pathname, read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const file = opt('--file');
if (!file) { console.error('Which content? --file <export.json>'); process.exit(2); }
const doc = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const economy = read('data/economy.json'), classes = read('data/classes.json').classes, config = read('data/quests.json');
const cars = Object.fromEntries(read('data/cars/index.json').cars.map(f => { const c = read(`data/cars/${f}`); return [c.id ?? f.split('/')[0], { name: c.name, class: c.class ?? null }]; }));
const check = contentChecker(read('data/schemas/content-item.schema.json'), { economy, classes, cars }), rate = makeRater({ config, classes });
// the road networks of the regions the routes are in
const networks = {};
for (const r of read('data/map/baked.json').regions) {
  const dir = path.join(ROOT, path.dirname(r.manifest)), manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const used = (doc.entries ?? []).some(e => (e.draft ?? e.published)?.course?.region === r.id);
  if (used) networks[r.id] = createNetwork(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, manifest.files.graph))).toString()), { region: r.id, version: manifest.version });
}
const list = validateAll(doc.entries ?? [], { check, rate, networks });
const n = doc.entries?.length ?? 0;
console.log(`${n} item${n === 1 ? '' : 's'} checked; ${list.length} to look at.`);
for (const x of list) {
  console.log(`\n${x.kind} "${x.name}" (${x.id}, ${x.view})`);
  for (const r of x.reasons) console.log(`  ${r.level === 'error' ? '✘' : r.level === 'warning' ? '⚠' : '·'} ${r.text}`);
}
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(list, null, 2));
process.exit(list.some(x => x.reasons.some(r => r.level === 'error')) ? 1 : 0);
