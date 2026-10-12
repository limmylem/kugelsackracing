// The content workflow (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): every part is a draft, in review or published —
// only a published part reaches players (the shop sells it, the used lot and other drivers' cars have it). A part's
// status starts as its file's (none: published — every part made before the workflow), and the live game's is the
// content manager's (the admin page): the server keeps each part's status, its versions and their history, and any
// stat or price changes made there, and sends the game what's published (applyContent).
//
//   statusOf(part) → 'draft' | 'review' | 'published'          released(part) → whether players get it
//   applyContent(db, overlay) — overlay: { version, parts: { id: { status?, set?: { field: value } } } }
//     (the parts' statuses and changed fields, in place; a part the overlay doesn't name keeps its file's)
//   editProblems(part, changes, { formulas, tiers }) → [problem in words]   (what the content manager may change)
//
// No browser or Node APIs.

import { applyStats, editableStats } from './families.js';
import { rangeProblem } from './formulas.js';

export const STATUSES = ['draft', 'review', 'published'];
export const statusOf = part => part?.status ?? 'published';
export const released = part => !!part && statusOf(part) === 'published';

// The overlay's statuses and changes on the game's parts (what each changes is remembered as the file had it, so
// applying another overlay — a newer version — starts from the files again)
const FILE = new WeakMap();
export function applyContent(db, overlay) {
  if (!overlay?.parts) return db;
  // (the parts an earlier overlay changed and this one doesn't name: back to their files)
  for (const part of Object.values(db.parts)) if (FILE.has(part) && !overlay.parts[part.id]) restore(part);
  for (const [id, o] of Object.entries(overlay.parts)) {
    const part = db.parts[id];
    if (!part) continue;
    if (!FILE.has(part)) FILE.set(part, { status: part.status, fields: {} });
    const file = FILE.get(part);
    // (back to the file's values for whatever an earlier overlay changed)
    for (const [k, v] of Object.entries(file.fields)) { if (v === undefined) delete part[k]; else part[k] = clone(v); }
    file.fields = {};
    if (o.status) part.status = o.status; else if (file.status === undefined) delete part.status; else part.status = file.status;
    for (const [k, v] of Object.entries(o.set ?? {})) {
      if (!EDITABLE_FIELDS.has(k)) continue;
      if (!(k in file.fields)) file.fields[k] = part[k] === undefined ? undefined : clone(part[k]);
      part[k] = clone(v);
    }
  }
  db.contentVersion = overlay.version ?? null;
  return db;
}
function restore(part) {
  const file = FILE.get(part);
  for (const [k, v] of Object.entries(file.fields)) { if (v === undefined) delete part[k]; else part[k] = clone(v); }
  if (file.status === undefined) delete part.status; else part.status = file.status;
  FILE.delete(part);
}
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

// What the content manager may change on a part: its price and unlock level (any part), its tier, name and its
// family's stats (a family's part, each within its allowed range — the rest of the part worked out again from
// them: garage/families.js applyStats)
export const EDITABLE_FIELDS = new Set(['price', 'unlock', 'tier', 'name', 'mass', 'effects', 'sound', 'aero', 'aeroEffect', 'rim', 'toughness', 'generated']);
export function editProblems(part, changes, { formulas, tiers }) {
  const out = [];
  if (!part) return ['there is no such part'];
  for (const k of Object.keys(changes)) if (!['price', 'unlockLevel', 'tier', 'name', 'stats'].includes(k)) out.push(`"${k}" can't be changed here (price, unlockLevel, tier, name or stats)`);
  if ('price' in changes && !(Number.isInteger(changes.price) && changes.price > 0 && changes.price <= 1_000_000)) out.push('the price is a whole number of dollars, more than 0');
  if ('unlockLevel' in changes && !(changes.unlockLevel === null || (Number.isInteger(changes.unlockLevel) && changes.unlockLevel >= 1 && changes.unlockLevel <= 50))) out.push('the unlock level is a whole number from 1 to 50 (or none)');
  if ('tier' in changes && !['street', 'sport', 'race'].includes(changes.tier)) out.push('the tier is street, sport or race');
  if ('name' in changes && !(typeof changes.name === 'string' && changes.name.trim().length >= 3 && changes.name.length <= 80)) out.push('the name is 3 to 80 characters');
  // (the price within its tier's band for its slot: data/content/tiers.json)
  const tier = changes.tier ?? part.tier, rule = tiers?.slots?.[part.slot], band = tiers?.tiers?.[tier]?.price;
  if ('price' in changes && rule?.street && band && part.tier !== 'stock') {
    const lo = Math.round(band[0] * rule.street), hi = Math.round(band[1] * rule.street);
    if (changes.price < lo || changes.price > hi) out.push(`$${changes.price.toLocaleString('en-GB')} is outside the ${tier} price band for ${part.slot} ($${lo.toLocaleString('en-GB')}–$${hi.toLocaleString('en-GB')})`);
  }
  if ('stats' in changes) {
    const kind = part.generated?.kind && formulas?.families?.[part.generated.kind];
    if (!kind) out.push(`${part.name} isn't a family's part: only its price, unlock level, tier and name can be changed here`);
    else {
      const ok = editableStats(kind);
      for (const [k, v] of Object.entries(changes.stats ?? {})) {
        if (!ok[k]) { out.push(`"${k}" isn't one of its stats (${Object.keys(ok).join(', ')})`); continue; }
        const p = rangeProblem(ok[k], v, k);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

// The fields an edit sets on a part (after editProblems passes): { price?, unlock?, tier?, name?, mass?, effects?… }
export function editFields(part, changes, { formulas }) {
  const set = {};
  if ('price' in changes) set.price = changes.price;
  if ('unlockLevel' in changes) set.unlock = changes.unlockLevel ? { level: changes.unlockLevel } : undefined;
  if ('tier' in changes) set.tier = changes.tier;
  if ('name' in changes) set.name = changes.name.trim();
  if (changes.stats && Object.keys(changes.stats).length) {
    const stats = { ...part.generated.stats, ...changes.stats };
    Object.assign(set, applyStats(part, formulas, stats), { generated: { ...part.generated, stats } });
  }
  return set;
}
// Which kind of checks an edit needs again: the economy's (a price, a tier, an unlock level, a name) or everything
// that depends on how the part performs (its stats)
export const editNeeds = changes => changes.stats && Object.keys(changes.stats).length ? 'performance' : 'economy';
