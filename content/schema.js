// World content's shape, checked against data/schemas/content-item.schema.json (garage/jsonSchema.js, the
// same small validator the game's data uses), and every check of an item in one list for the editor:
// shape errors first (said as plainly as a path can be), then content/quests.js's plain-word problems.
//
//   const check = contentChecker(schemaJson, { economy, classes, cars })
//   check(item) → [{ field, level, message }]      check.shape(item) → the shape errors only

import { createValidator } from '../garage/jsonSchema.js';
import { problems } from './quests.js';

export const SCHEMA_ID = 'content-item.schema.json';

const FIELD_NAMES = { name: 'The name', description: 'The description', location: 'The place', 'location.lat': 'The latitude', 'location.lon': 'The longitude', 'location.heading': 'The facing', fee: 'The entry fee', 'rewards.tier': 'The reward tier', 'entry.minLevel': 'The minimum level', type: 'The quest type' };
const plain = e => {
  const field = e.path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1');
  return { field: field || 'item', level: 'error', message: `${FIELD_NAMES[field] ?? (field ? `"${field}"` : 'It')} ${e.message}.` };
};

export function contentChecker(schemaJson, ctx = {}) {
  const v = createValidator({ [SCHEMA_ID]: schemaJson });
  const shape = item => v.validate(SCHEMA_ID, item).map(plain);
  const check = item => { const s = shape(item); return [...s, ...problems(item, ctx)]; };
  check.shape = shape;
  check.ctx = ctx;
  return check;
}
