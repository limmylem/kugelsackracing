// The content bundles the site serves (Phase 8 Step 3; docs/CONTENT_PIPELINE.md, docs/DEPLOYMENT.md; garage/
// contentBundle.js reads them): written by tools/build-site.mjs into the site it builds —
//   data/bundle.json           { version, data: 'bundles/data-<hash>.json', models: { path: hash } } — asked for every time
//   bundles/data-<hash>.json   { version, files: { 'data/…json': contents } }: every file the game reads its cars and
//                              parts from (loadGarageData) — named by its content, so it's cached for good
// The models' hashes are of the files deploy.yml puts on the tiles address (R2) from the same commit.
//
//   const r = buildBundle({ root, out })   → { version, files, models, bytes }

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './rules.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
// (the data the game reads as it starts: garage/data.js loadGarageData, and its schemas)
const TOP = ['data/cars/index.json', 'data/parts/index.json', 'data/finishes.json', 'data/condition.json', 'data/classes.json', 'data/economy.json', 'data/damage.json', 'data/sessions.json', 'data/hints.json', 'data/content/standards.json', 'data/quests.json'];

export function dataFiles(root = ROOT) {
  const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  const out = [...TOP.filter(f => fs.existsSync(path.join(root, f)))];
  for (const f of fs.readdirSync(path.join(root, 'data/schemas')).filter(f => f.endsWith('.json'))) out.push(`data/schemas/${f}`);
  for (const c of read('data/cars/index.json').cars) out.push(`data/cars/${c}`);
  for (const p of read('data/parts/index.json').parts) out.push(`data/parts/${p}`);
  return out;
}
export function modelFiles(root = ROOT) {
  const dir = path.join(root, 'assets');
  return fs.readdirSync(dir, { recursive: true }).map(String).filter(f => /\.(glb|webp)$/i.test(f) && !f.split(path.sep).includes('incoming')).map(f => `assets/${f.split(path.sep).join('/')}`).sort();
}

export function buildBundle({ root = ROOT, out }) {
  const files = {}, models = {};
  for (const f of dataFiles(root)) files[f] = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  for (const f of modelFiles(root)) models[f] = hash(fs.readFileSync(path.join(root, f)));
  const text = JSON.stringify({ files }), version = hash(text + JSON.stringify(models)), dataName = `bundles/data-${hash(text)}.json`;
  fs.mkdirSync(path.join(out, 'bundles'), { recursive: true });
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });
  fs.writeFileSync(path.join(out, dataName), JSON.stringify({ version, files }));
  fs.writeFileSync(path.join(out, 'data/bundle.json'), JSON.stringify({ version, data: dataName, models }));
  return { version, data: dataName, files: Object.keys(files).length, models: Object.keys(models).length, bytes: Buffer.byteLength(text) };
}
