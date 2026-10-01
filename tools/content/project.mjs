// The game's data as the content tools need it: every car and part (loadGarageData), the model rules,
// which parts use each model file (and at what scale), and every socket name any car uses.

import fs from 'node:fs';
import path from 'node:path';
import { loadGarageData } from '../../garage/data.js';
import { resolveLook } from '../../garage/visual.js';
import { ROOT, loadRules, readJson } from './rules.mjs';
import { createValidator } from '../../garage/jsonSchema.js';

export async function loadProject(root = ROOT) {
  const { db, problems } = await loadGarageData(async f => readJson(f, root));
  const rules = loadRules(root);
  const schema = readJson('data/schemas/model-rules.schema.json', root);
  const { finishes, ...fileRules } = rules;
  const ruleProblems = createValidator({ 'model-rules.schema.json': schema }).validate('model-rules.schema.json', fileRules);
  const knownSockets = new Set();
  for (const car of Object.values(db.cars)) {
    for (const s of car.sockets) { knownSockets.add(s.name); if (s.node) knownSockets.add(s.node); }
    for (const n of Object.values(car.model.sockets ?? {})) knownSockets.add(n);
    if (car.model.steeringWheel) knownSockets.add(car.model.steeringWheel);
  }
  return { root, db, problems, rules, ruleProblems, knownSockets: [...knownSockets] };
}

// Every model the game uses: { file → [{ kind: 'part', part, scale } | { kind: 'car', car, role: 'body' | 'source' }] }
export function modelsInUse(project) {
  const out = new Map(), add = (file, use) => { if (!out.has(file)) out.set(file, []); out.get(file).push(use); };
  for (const car of Object.values(project.db.cars)) {
    if (car.model.file) add(car.model.file, { kind: 'car', car, role: 'body' });
    if (car.model.source) add(car.model.source, { kind: 'car', car, role: 'source' });
  }
  for (const part of Object.values(project.db.parts)) {
    const { model, look } = resolveLook(part, project.db.parts);
    if (!model) continue;
    const k = look?.scale ?? 1;
    add(model, { kind: 'part', part, scale: typeof k === 'number' ? [k, k, k] : k });
  }
  return out;
}

// Every .glb under a folder (or the file itself)
export function glbFiles(p) {
  if (!fs.existsSync(p)) return [];
  if (fs.statSync(p).isFile()) return [p];
  return fs.readdirSync(p, { recursive: true }).map(String).filter(f => f.toLowerCase().endsWith('.glb')).map(f => path.join(p, f)).sort();
}
