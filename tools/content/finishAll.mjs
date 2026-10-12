// What the importer does to a model on its way in, done to the models already in the game (npm run content -- finish;
// docs/CONTENT_PIPELINE.md): every model in use with at least lods.from triangles and no levels of detail gets them
// (tools/content/lods.mjs, written back into its file), every part that can come off in a crash and has a model gets
// its collision hulls (tools/content/collision.mjs, in its part file — and in byCar for its version on each car), and
// big textures are compressed (tools/content/ktx2.mjs). Run it again any time: what's done already is left alone.
//
//   const r = await finishExisting({ only: [ids] | null, dryRun })   → { lods: [file], textures: [file], collision: [id], log }

import fs from 'node:fs';
import path from 'node:path';
import { loadProject, modelsInUse } from './project.mjs';
import { readModel, modelIO } from './io.mjs';
import { inspect } from './inspect.mjs';
import { makeLods } from './lods.mjs';
import { compressTextures } from './ktx2.mjs';
import { collisionHulls } from './collision.mjs';
import { editJson } from './json.mjs';
import { readJson } from './rules.mjs';
import { partShape } from '../../garage/partShape.js';
import { resolveLook } from '../../garage/visual.js';

export async function finishExisting({ only = null, dryRun = false, log = () => {} } = {}) {
  const project = await loadProject(), { db, rules, root } = project, out = { lods: [], textures: [], collision: [] };
  const wanted = id => !only || only.includes(id);

  // levels of detail and textures, model by model (a car's source isn't drawn: its body and parts are)
  for (const [file, uses] of modelsInUse(project)) {
    if (uses.every(u => u.kind === 'car' && u.role === 'source')) continue;
    if (!uses.some(u => wanted(u.part?.id ?? u.car?.id))) continue;
    if (!fs.existsSync(path.join(root, file))) continue;
    const doc = await readModel(path.join(root, file)), info = inspect(doc), did = [];
    if (rules.lods && info.triangleCount >= rules.lods.from && !info.lods.length) {
      const r = await makeLods(doc, rules.lods);
      did.push(`LOD1 ${r.levels[0]?.triangles} of ${r.base} triangles`);
      out.lods.push(file);
    }
    if (rules.ktx2) {
      const t = await compressTextures(doc, rules.ktx2);
      if (t.length) { did.push(...t); out.textures.push(file); }
    }
    if (!did.length) continue;
    log(`  ${file}: ${did.join('; ')}`);
    if (!dryRun) fs.writeFileSync(path.join(root, file), await (await modelIO()).writeBinary(doc));
  }

  // collision hulls: parts that come off in a crash
  const files = Object.fromEntries(readJson('data/parts/index.json', root).parts.map(f => [path.basename(f, '.json'), `data/parts/${f}`]));
  for (const part of Object.values(db.parts)) {
    if (!part.detach?.detachable || !wanted(part.id) || !rules.collision) continue;
    const todo = [];
    const model = partShape(part, db.parts).model;
    if (model && !part.collision) todo.push([null, model]);
    for (const [carId, v] of Object.entries(part.byCar ?? {})) if (v.model && !v.collision) todo.push([carId, v.model]);
    if (!todo.length) continue;
    const scale = [].concat(resolveLook(part, db.parts).look?.scale ?? 1), s = scale.length === 3 ? scale : [scale[0], scale[0], scale[0]];
    const made = [];
    for (const [carId, file] of todo) {
      if (!fs.existsSync(path.join(root, file))) continue;
      const info = inspect(await readModel(path.join(root, file)));
      const tris = info.triangles.map(t => ({ p: t.p.map(v => v.map((x, k) => x * s[k])) }));
      const c = await collisionHulls(tris, rules.collision);
      if (c) made.push([carId, c]);
    }
    if (!made.length) continue;
    log(`  ${part.id}: ${made.map(([car, c]) => `${car ? `${car}: ` : ''}${c.hulls.length} hull${c.hulls.length > 1 ? 's' : ''} (${c.method})`).join(', ')}`);
    out.collision.push(part.id);
    if (!dryRun) editJson(path.join(root, files[part.id]), p => {
      for (const [carId, c] of made) { if (carId) p.byCar[carId].collision = c; else p.collision = c; }
    });
  }
  return out;
}
