// Draws every part's icon (assets/icons/parts/<id>.png) and points its definition at it: a part with a
// model is drawn from its model, in its own look (a variant: the base part's model in its finish); one
// without, from simple artwork for its slot in its tier's colour (tools/content/artwork.mjs).
//
//   npm run icons                  every part
//   npm run icons -- --missing     only parts with no icon yet
//   npm run icons -- turbo_kit …   just these

import fs from 'node:fs';
import path from 'node:path';
import { resolveLook } from '../garage/visual.js';
import { artworkFor } from './content/artwork.mjs';
import { renderIcon } from './content/icon.mjs';
import { readModel } from './content/io.mjs';
import { editJson } from './content/json.mjs';
import { loadProject } from './content/project.mjs';
import { ROOT, typeForPart } from './content/rules.mjs';

const args = process.argv.slice(2), missing = args.includes('--missing'), only = args.filter(a => !a.startsWith('--'));
const { db, rules } = await loadProject();
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/parts/index.json'), 'utf8')).parts;
const models = new Map(), made = [], none = [];
for (const part of Object.values(db.parts)) {
  if (only.length && !only.includes(part.id)) continue;
  if (missing && part.icon && fs.existsSync(path.join(ROOT, part.icon))) continue;
  const { model, look } = resolveLook(part, db.parts), type = typeForPart(part, rules);
  let doc = null, what;
  if (model && !part.tyreSize) {
    if (!models.has(model)) models.set(model, await readModel(path.join(ROOT, model)));
    doc = models.get(model); what = 'model';
  } else { doc = await artworkFor(part, { finishes: rules.finishes }); what = 'artwork'; }
  if (!doc) { none.push(part.id); continue; }
  const file = `assets/icons/parts/${part.id}.png`;
  fs.mkdirSync(path.join(ROOT, 'assets/icons/parts'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), await renderIcon(doc, { rules, type: type ?? part.slot, look: what === 'model' ? look : null }));
  if (part.icon !== file) editJson(path.join(ROOT, 'data/parts', index.find(f => f.endsWith(`/${part.id}.json`))), p => { p.icon = file; });
  made.push(`${part.id} (${what})`);
}
console.log(`${made.length} icon${made.length === 1 ? '' : 's'} drawn${none.length ? `; no model or artwork for ${none.join(', ')}` : ''}.`);
