// The variant generator (npm run generate-variants): from a variant table (data/variants/<base>.json,
// schema data/schemas/variants.schema.json) and its base part, a part for every combination of the
// table's options — its id from the table's pattern (rim_5spoke_17_chrome_forged: the same every time),
// price and stats from the options' rules, drawn with the base part's model in its own look.
// Existing variants are updated in place (same id); a variant no longer in the table is retired, never
// deleted or renamed, so players who own it keep it.
//
//   generateVariants(table, { root, db }) → { made: [part], retired: [id], plan: [{ id, file, part, status }] }

import fs from 'node:fs';
import path from 'node:path';

const clone = x => JSON.parse(JSON.stringify(x));
const setPath = (o, p, v) => { const k = p.split('.'); let x = o; for (const s of k.slice(0, -1)) x = x[s] ??= {}; x[k.at(-1)] = clone(v); };
const getPath = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const OWN = ['id', 'name', 'model', 'icon', 'todo', '_todo', 'generated', 'retired', 'variantOf', 'look', 'bounds'];

export function planVariants(table, db, { tableId = table.base } = {}) {
  const base = db.parts[table.base];
  if (!base) throw new Error(`there's no base part "${table.base}"`);
  const groups = Object.entries(table.groups);
  // every combination of one option from each group
  let combos = [[]];
  for (const [g, options] of groups) combos = combos.flatMap(c => Object.keys(options).map(k => [...c, [g, k]]));
  combos = combos.filter(c => !(table.skip ?? []).some(s => Object.entries(s).every(([g, k]) => c.some(([cg, ck]) => cg === g && ck === k))));
  const plan = combos.map(combo => {
    const opts = combo.map(([g, k]) => ({ g, k, o: table.groups[g][k] }));
    const fill = (pattern, useName) => pattern.replace(/\{(\w+)\}/g, (m, g) => g === 'base' ? base.id : (() => { const x = opts.find(o => o.g === g); return x ? (useName ? x.o.name ?? x.k : x.k) : m; })());
    const id = fill(table.id, false).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const part = clone(base);
    for (const k of OWN) delete part[k];
    Object.assign(part, { id, name: fill(table.name, true), model: '', icon: `assets/icons/parts/${id}.png`, variantOf: base.id });
    let look = {}, price = table.price.base === 'part' ? base.price : table.price.base;
    for (const { o } of opts) {
      price *= o.priceFactor ?? 1;
      if (o.look) look = { ...look, ...clone(o.look), ...(o.look.materials ? { materials: { ...look.materials, ...o.look.materials } } : {}) };
      if (o.scale) look.scale = o.scale;
      for (const [p, v] of Object.entries(o.set ?? {})) setPath(part, p, v);
      for (const [p, k] of Object.entries(o.multiply ?? {})) { const v = getPath(part, p); if (typeof v === 'number') setPath(part, p, +(v * k).toFixed(4)); }
    }
    const r = table.price.round ?? 1;
    part.price = Math.round(price / r) * r;
    if (typeof part.mass === 'number') part.mass = +part.mass.toFixed(2);
    if (Object.keys(look).length) part.look = look;
    part.generated = { table: tableId, key: combo.map(([g, k]) => `${g}=${k}`).join(',') };
    part._generated = `Made by npm run generate-variants from data/variants/${tableId}.json: change the table, not this file.`;
    return { id, part };
  });
  const ids = plan.map(p => p.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`two combinations make the id "${dup}": put every group in the id pattern`);
  return { base, plan };
}

// Writes them: { made (new), updated, unchanged, retired, files } — files: the definitions written
export function writeVariants(table, { root, db, tableId = table.base }, { writeJson, addToIndex }) {
  const { base, plan } = planVariants(table, db, { tableId });
  const out = { made: [], updated: [], unchanged: [], retired: [], unretired: [], files: [], parts: [] };
  for (const { id, part } of plan) {
    const file = `data/parts/${base.category}/${id}.json`, full = path.join(root, file), was = db.parts[id];
    if (was && !was.generated) throw new Error(`"${id}" is already a part that wasn't made from a table: change the table's id pattern`);
    if (was && was.generated.table !== tableId) throw new Error(`"${id}" was made from another table (${was.generated.table})`);
    const old = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    writeJson(full, part);
    if (!old) { out.made.push(id); addToIndex(root, 'data/parts/index.json', 'parts', `${base.category}/${id}.json`); }
    else if (old === fs.readFileSync(full, 'utf8')) out.unchanged.push(id);
    else { out.updated.push(id); if (was?.retired) out.unretired.push(id); }
    out.files.push(file); out.parts.push(part);
  }
  // made from this table before, but not in it now: retired (kept, so players who own one keep it)
  const now = new Set(plan.map(p => p.id));
  for (const p of Object.values(db.parts)) {
    if (p.generated?.table !== tableId || now.has(p.id) || p.retired) continue;
    const full = path.join(root, `data/parts/${p.category}/${p.id}.json`), def = JSON.parse(fs.readFileSync(full, 'utf8'));
    def.retired = true;
    def._retired = `No longer in data/variants/${tableId}.json (${new Date().toISOString().slice(0, 10)}): not sold, but copies players own still work. Its id stays.`;
    writeJson(full, def);
    out.retired.push(p.id);
  }
  return out;
}
