// The model rules (data/content/model-rules.json) and what a model is: a part type from its file name
// (spoiler_ducktail.glb → spoiler; rim_5spoke.glb → rim) or from the part that uses it (its slot), or
// a car (car_<id>.glb, or a car's body / source model).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const rel = (p, root = ROOT) => path.relative(root, p).split(path.sep).join('/');
export const readJson = (file, root = ROOT) => JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8'));

// { ...model-rules.json, finishes: { id: finish } }
export function loadRules(root = ROOT) {
  const rules = readJson('data/content/model-rules.json', root);
  rules.finishes = readJson('data/finishes.json', root).finishes;
  return rules;
}

// The part type a file name says (its first words: spoiler_ducktail → spoiler, bumper_front_lip →
// bumper_front), or 'car' (car_<id>), or null
export function typeFromName(file, rules) {
  const base = path.basename(file).replace(/\.glb$/i, '').toLowerCase();
  let best = null;
  const consider = (type, name) => { if ((base === name || base.startsWith(name + '_')) && (!best || name.length > best.name.length)) best = { type, name }; };
  for (const [type, t] of Object.entries(rules.types)) for (const name of [type, ...(t.names ?? [])]) consider(type, name);
  for (const name of rules.car.names) consider('car', name);
  return best?.type ?? null;
}

// The part type for a part definition (by its slot; a wheel is a rim)
export function typeForPart(part, rules) {
  return Object.entries(rules.types).find(([, t]) => t.slot === part.slot)?.[0] ?? null;
}

// Whether a material name is one a model may use
export function allowedMaterial(name, rules) {
  const m = rules.materials;
  return m.names.includes(name) || m.patterns.some(p => new RegExp(p).test(name)) || (m.finishes && !!rules.finishes[name]);
}
export function allowedMaterialList(rules) {
  return [...rules.materials.names, 'light_… (light_head, light_tail…)', ...(rules.materials.finishes ? Object.keys(rules.finishes) : [])];
}
