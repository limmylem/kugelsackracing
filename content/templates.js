// Quest templates (data/content/quest-templates.json): a quest started from one — "Mountain sprint, 3 NPCs,
// medium" — gets the template's type, rivals, entry and type fields, and a name from the route's road.
// Pure: the editor and its route suggestions use it.
//
//   applyTemplate(item, template, { road, region }) → the quest item with the template's fields

import { withType, TYPES } from './quests.js';

const clone = x => JSON.parse(JSON.stringify(x));
const merge = (a, b) => { const out = { ...a }; for (const [k, v] of Object.entries(b ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? merge(a[k], v) : clone(v); return out; };

export function applyTemplate(item, template, { road = null, region = null } = {}) {
  const T = template.quest ?? {};
  if (T.type && !TYPES[T.type]) throw new Error(`template "${template.id}": no quest type "${T.type}"`);
  let q = T.type ? withType(item, T.type) : clone(item);
  if (T.params) q.params = merge(q.params ?? {}, T.params);
  if (T.entry) q.entry = merge(q.entry ?? {}, T.entry);
  if (T.npc) q.npc = clone(T.npc);
  if (T.name) q.name = T.name.replace('{road}', road || 'Road').replace('{region}', region || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return q;
}
