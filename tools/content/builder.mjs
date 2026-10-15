// The family builder (docs/CONTENT_PIPELINE.md "A family from the admin page"): what the admin page's Content tab › New
// family and npm run content -- new-family / preview / variations / presets / shapes are made of. It writes the same
// files a person does (data/families/<id>.json, data/engines/<id>.json, data/content/presets/<name>.json) in the same
// layout, and works out what they'll make with the same code the build uses (expandFamily, priceFamilyParts) — so
// what it says a family will make is what npm run content -- build makes, and a family made here can be changed by
// hand, and the other way round. Every limit is in data/content/builder.json.
//
//   builderContext({ root }) → ctx (the game's data, the formulas, tiers, limits, names, kit pieces, families, engines)
//   kindOptions(kind, ctx) → its settings, shape settings and finishes with what each may be
//   normaliseFamily(input, ctx) → { def, problems }     (from, to, step expanded; the id from the name; the layout's order)
//   familyText(def) → the file, in the hand-written layout
//   summarise(def, ctx, { editing }) → { count, parts: [{ id, stats, tier, price, unlock… }], problems, warnings, fits, aim }
//   familyChanges(def, ctx) → { added, changed, retired, same }   (an existing family against what it'd make now)

import fs from 'node:fs';
import path from 'node:path';
import { loadProject } from './project.mjs';
import { ROOT, readJson } from './rules.mjs';
import { expandFamily, priceFamilyParts } from './families.mjs';
import { listKits } from '../generators/lib/kit.js';
import { idFromName, loadNameRules, nameProblem, suggestNames } from './names.mjs';
import { forCar, partGain, TIER_ORDER } from './balance.mjs';
import { perfKey, shapeValues } from '../../garage/families.js';
import { said } from '../../garage/formulas.js';

export const FAMILY_NOTE = 'A part family (docs/CONTENT_PIPELINE.md): npm run content -- build makes a part for every combination of the settings listed here and every finish, its stats from data/content/formulas.json (families.<kind>), its tier, price and unlock level from what it does. Change this file, not the parts it makes.';
// (a family file's fields, in the order the hand-written ones have them)
export const FAMILY_KEYS = ['_note', 'id', 'kind', 'name', 'settings', 'finishes', 'skip', 'shape', 'leaveOff', 'idKeys', 'idOmit', 'aim', 'status'];
const named = (o = {}) => Object.keys(o).filter(k => !k.startsWith('_'));
const listOf = v => v == null ? [] : Array.isArray(v) ? v : [v];
const money = n => `$${Math.round(n).toLocaleString('en-GB')}`;

// ---------- what there is ----------

const defsIn = (root, dir) => fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.json')).sort().map(f => readJson(`${dir}/${f}`, root)) : [];
export async function builderContext({ root = ROOT, project = null } = {}) {
  project ??= await loadProject(root);
  return {
    root, project, db: project.db,
    formulas: readJson('data/content/formulas.json', root), tiers: readJson('data/content/tiers.json', root), standards: readJson('data/content/standards.json', root),
    checkRules: readJson('data/content/check-rules.json', root), config: readJson('data/content/builder.json', root), names: loadNameRules(root), kits: listKits(root),
    families: Object.fromEntries(defsIn(root, 'data/families').map(d => [d.id, d])), engines: Object.fromEntries(defsIn(root, 'data/engines').map(d => [d.id, d])),
  };
}

// The kinds a family can be (formulas.json families), with how many families each has
export function kindList(ctx) {
  return named(ctx.formulas.families).map(k => { const K = ctx.formulas.families[k]; return { kind: k, label: K.label, slot: K.slot, category: K.category, maker: K.maker, fitted: !!K.fit, perCar: !!K.perCar, families: Object.values(ctx.families).filter(f => f.kind === k).map(f => ({ id: f.id, name: f.name })) }; });
}

// One setting (or shape setting) as the form shows it: what kind of control, and what it may be
function control(key, S, { kits = [], cars = [] } = {}) {
  const base = { key, label: S.label ?? key, unit: S.unit ?? '', default: S.default ?? null, stats: !!S.stats };
  if (S.table) return { ...base, type: 'table', entries: named(S.table).map(id => ({ id, label: S.table[id].label ?? id, ...Object.fromEntries(Object.entries(S.table[id]).filter(([k, v]) => k !== 'label' && typeof v === 'number')) })) };
  if (S.kit) return { ...base, type: 'kit', attach: S.kit, values: ['none', ...kits] };
  if (S.cars) return { ...base, type: 'cars', values: cars };
  if (S.values) return { ...base, type: 'values', values: S.values };
  if (S.range) {
    const w = S.range[1] - S.range[0], step = S.step ?? (S.integer ? 1 : +(10 ** Math.floor(Math.log10(w / 20))).toPrecision(1));
    return { ...base, type: 'range', range: S.range, integer: !!S.integer, step, ...(typeof S.default === 'string' && { default: null, defaultFormula: S.default }) };
  }
  return { ...base, type: 'none' };
}
export function kindOptions(kindName, ctx) {
  const K = ctx.formulas.families[kindName];
  if (!K || kindName.startsWith('_')) return null;
  const cars = Object.values(ctx.db.cars).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    kind: kindName, label: K.label, slot: K.slot, category: K.category, maker: K.maker, fitted: !!K.fit, perCar: !!K.perCar, economy: K.economy === 'measured' ? 'measured' : 'by its settings',
    settings: named(K.settings).map(k => ({ ...control(k, K.settings[k], { cars }), shapes: !K.shapeKeys || K.shapeKeys.includes(k) })),
    shape: named(K.shapeSettings).map(k => control(k, K.shapeSettings[k], { kits: ctx.kits[kindName]?.[K.shapeSettings[k].kit] ?? [] })),
    stats: named(K.stats).map(k => ({ key: k, label: K.stats[k].label ?? k, unit: K.stats[k].unit ?? '', range: K.stats[k].range ?? null, digits: K.stats[k].digits ?? null })),
    finishes: named(ctx.formulas.finishes).map(id => ({ id, label: ctx.formulas.finishes[id].label, price: ctx.formulas.finishes[id].price, mass: ctx.formulas.finishes[id].mass })),
    tiers: TIER_ORDER.filter(t => ctx.tiers.tiers[t]?.price).map(t => ({ tier: t, price: ctx.tiers.tiers[t].price.map(k => Math.round(k * (ctx.tiers.slots[K.slot]?.street ?? 0))), unlock: ctx.formulas.economy.unlock[t] ?? null })),
    families: Object.values(ctx.families).filter(f => f.kind === kindName).map(f => ({ id: f.id, name: f.name })),
    limits: { maxVariants: ctx.config.families.maxVariants, hardMaxVariants: ctx.config.families.hardMaxVariants, maxValuesPerSetting: ctx.config.families.maxValuesPerSetting },
  };
}

// ---------- the family file ----------

// The file as a person writes it: one field a line, each value on its line ({ "diameter": [57, 63], "tips": "dual" })
const inline = v => Array.isArray(v) ? `[${v.map(inline).join(', ')}]` : v && typeof v === 'object' ? (Object.keys(v).length ? `{ ${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}') : JSON.stringify(v);
export function familyText(def) {
  const keys = [...FAMILY_KEYS.filter(k => def[k] !== undefined), ...Object.keys(def).filter(k => !FAMILY_KEYS.includes(k) && def[k] !== undefined)];
  return `{\n${keys.map(k => `  ${JSON.stringify(k)}: ${inline(def[k])}`).join(',\n')}\n}\n`;
}

// (from, to, step → the values, each rounded to the step's decimals)
export function stepValues({ from, to, step }, max = 1000) {
  if (![from, to, step].every(Number.isFinite) || step <= 0 || to < from) return null;
  const d = Math.max(0, ...[from, step].map(x => (String(x).split('.')[1] ?? '').length)), out = [];
  for (let i = 0; i <= max; i++) { const v = +(from + i * step).toFixed(d); if (v > to + 1e-9) break; out.push(v); }
  return out;
}
// A family from what the form (or the API, or a preset) sends: the fields a family file has, settings and shape values
// as a value, a list or { from, to, step }, its id from its name if it has none; what isn't right, in words
export function normaliseFamily(input, ctx, { editing = null } = {}) {
  const problems = [], C = ctx.config, K = ctx.formulas.families[input?.kind];
  if (!input || typeof input !== 'object') return { def: null, problems: ['There\'s no family to make.'] };
  for (const k of Object.keys(input)) if (!FAMILY_KEYS.includes(k)) problems.push(`"${k}" isn't something a family file has (${FAMILY_KEYS.filter(x => x !== '_note').join(', ')}).`);
  if (!K) return { def: null, problems: [...problems, `Pick what it is: one of ${named(ctx.formulas.families).join(', ')}.`] };
  const name = String(input.name ?? '').trim(), id = editing ?? (input.id ? String(input.id) : idFromName(name));
  const values = (where, key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'from' in v) {
      const list = stepValues(v, C.families.maxValuesPerSetting + 1);
      if (!list) { problems.push(`${where} ${key}: from, to and step are numbers, step more than 0 and to no less than from.`); return []; }
      return list.length === 1 ? list[0] : list;
    }
    return v;
  };
  const settings = {}, shape = {};
  for (const [k, v] of Object.entries(input.settings ?? {})) { if (v === undefined || (Array.isArray(v) && !v.length)) continue; settings[k] = values('Setting', k, v); }
  for (const [k, v] of Object.entries(input.shape ?? {})) { if (v === undefined || (Array.isArray(v) && !v.length)) continue; shape[k] = values('Shape', k, v); }
  for (const [where, o] of [['Setting', settings], ['Shape', shape]]) for (const [k, v] of Object.entries(o)) if (Array.isArray(v) && v.length > C.families.maxValuesPerSetting) problems.push(`${where} ${k} lists ${v.length} values: at most ${C.families.maxValuesPerSetting} (data/content/builder.json families.maxValuesPerSetting).`);
  // (a list of one is that value, as a person writes it)
  for (const o of [settings, shape]) for (const [k, v] of Object.entries(o)) if (Array.isArray(v) && v.length === 1 && !(o === shape && K.shapeSettings?.[k] && Array.isArray(v[0]))) o[k] = v[0];
  const def = {
    _note: input._note ?? FAMILY_NOTE, id, kind: input.kind, name,
    settings, finishes: listOf(input.finishes),
    ...(input.skip?.length && { skip: input.skip }),
    ...(Object.keys(shape).length && { shape }),
    ...(input.leaveOff && Object.keys(input.leaveOff).length && { leaveOff: input.leaveOff }),
    ...(input.idKeys?.length && { idKeys: input.idKeys }), ...(input.idOmit && Object.keys(input.idOmit).length && { idOmit: input.idOmit }),
    ...(input.aim && cleanAim(input.aim) && { aim: cleanAim(input.aim) }),
    status: input.status ?? 'draft',
  };
  // (an existing family changed: its parts' ids kept for what it still makes)
  return { def: editing && ctx.families[editing] ? withStableIds(def, ctx.families[editing], ctx) : def, problems };
}
const cleanAim = a => {
  const out = {};
  if (Array.isArray(a.tiers) && a.tiers.length) out.tiers = a.tiers.filter(t => typeof t === 'string');
  for (const k of ['price', 'unlock']) if (Array.isArray(a[k]) && a[k].length === 2 && a[k].every(x => x == null || Number.isFinite(x)) && a[k].some(x => x != null)) out[k] = a[k];
  return Object.keys(out).length ? out : null;
};

// What stops a family being made (the name, the id, its settings against the kind, how many parts), in words
export function familyProblems(def, ctx, { editing = null } = {}) {
  const out = [], C = ctx.config, db = ctx.db;
  const np = nameProblem(def.name, ctx.names);
  if (np) out.push(np);
  if (!new RegExp(C.ids.pattern).test(def.id ?? '')) out.push(`The id "${def.id ?? ''}" (made from the name) should be 3 to 24 lower-case letters, digits and _, starting with a letter: pick a name that makes one.`);
  else if (!editing) {
    if (ctx.families[def.id]) out.push(`There's already a family "${def.id}" (${ctx.families[def.id].name}): pick another name, or edit that one.`);
    if (ctx.engines[def.id] || db.cars[def.id]) out.push(`"${def.id}" is already an engine's or a car's id: pick another name.`);
    const clash = Object.values(db.parts).find(p => (p.id === def.id || p.id.startsWith(`${def.id}_`)) && p.generated?.family !== def.id);
    if (clash) out.push(`Its parts' ids would start "${def.id}_", like the part "${clash.id}" (${clash.name}): pick another name.`);
  }
  if (!def.finishes?.length) out.push('Tick at least one finish.');
  if (def.status && !['draft', 'review', 'published'].includes(def.status)) out.push('Its status is draft, review or published.');
  if (def.aim?.tiers) for (const t of def.aim.tiers) if (!ctx.tiers.tiers[t]?.price) out.push(`Aim: "${t}" isn't a tier (${TIER_ORDER.filter(x => ctx.tiers.tiers[x]?.price).join(', ')}).`);
  return out;
}

// ---------- what it'll make ----------

const countOf = (def, kind, ctx) => {
  let n = 1;
  for (const [k, S] of Object.entries(kind.settings)) if (!k.startsWith('_')) n *= Math.max(1, listOf(def.settings?.[k]).length || (S.cars ? 0 : 1));
  for (const [k, S] of Object.entries(kind.shapeSettings ?? {})) if (!k.startsWith('_') && Array.isArray(def.shape?.[k]) && !(S.table && !Array.isArray(def.shape[k]))) n *= Math.max(1, def.shape[k].length);
  return n * Math.max(1, listOf(def.finishes).length);
};
// (a stat in words, with its unit)
const statWords = (S, v) => v == null ? '—' : said(v, S.unit ?? '');

// What a family would make, before anything is made: every part with its stats, tier, price and unlock level (the
// build's own expandFamily and priceFamilyParts on the game's data), what stops it (problems: nothing is made) and what
// to look at (warnings). editing: the family's id when it's an existing one changed (its own parts aren't rivals)
export async function summarise(def, ctx, { editing = null, suggest = true } = {}) {
  const { db, formulas: F, tiers, config: C } = ctx, kind = F.families[def.kind];
  const out = { id: def.id, kind: def.kind, count: 0, parts: [], problems: familyProblems(def, ctx, { editing }), warnings: [], notMade: [], fits: null, byTier: {}, suggestions: [] };
  if (!kind) return out;
  out.count = countOf(def, kind, ctx);
  if (out.count > C.families.hardMaxVariants) { out.problems.push(`It would make ${out.count} parts: at most ${C.families.hardMaxVariants} (data/content/builder.json families.hardMaxVariants). Fewer values, or skip some.`); return out; }
  if (out.count > C.families.maxVariants) out.warnings.push(`It makes ${out.count} parts, over ${C.families.maxVariants} (data/content/builder.json families.maxVariants): slow to build and check, and a long list in the shop. Fewer values, or more families.`);
  const r = expandFamily(def, { formulas: F, db, root: ctx.root, kits: ctx.kits });
  const settingProblems = r.problems.filter(p => !r.variants.length || !/is outside what's allowed|doesn't work/.test(p));
  if (!r.variants.length) { out.problems.push(...r.problems); return out; }
  // (combinations whose stats come out of their ranges: not made — the build would stop; skip them, or change them)
  for (const p of r.problems.filter(x => !settingProblems.includes(x))) out.notMade.push({ id: p.split(':')[0], why: p.slice(p.indexOf(':') + 1).trim() });
  // (the parts it makes: every combination but those it skips)
  out.count = r.variants.length + new Set(out.notMade.map(n => n.id)).size;
  if (settingProblems.length) out.problems.push(...settingProblems);
  const priced = priceFamilyParts(r.variants.map(v => ({ part: v.part, ctx: v.ctx })), { db, formulas: F, tiers });
  for (const [id, ps] of priced.problems) out.notMade.push({ id, why: ps.map(p => p.replace(/^[^:]*: /, '')).join('; ') });
  if (out.notMade.length) out.problems.push(`${out.notMade.length} of its ${out.count} parts can't be made (${out.notMade.slice(0, 2).map(n => `${n.id}: ${n.why}`).join('; ')}${out.notMade.length > 2 ? '…' : ''}): change their settings, or skip them.`);
  const statSpec = kind.stats, varying = Object.keys(def.settings ?? {}).filter(k => Array.isArray(def.settings[k]) && def.settings[k].length > 1 || kind.settings[k]?.cars), shapeVarying = Object.keys(def.shape ?? {}).filter(k => Array.isArray(def.shape[k]) && def.shape[k].length > 1);
  for (const v of r.variants) {
    const p = v.part, bad = out.notMade.find(n => n.id === p.id);
    out.parts.push({
      id: p.id, name: p.name, key: v.key, modelKey: v.modelKey, finish: v.finish,
      settings: Object.fromEntries(varying.map(k => [k, v.settings[k]])), shape: Object.fromEntries(shapeVarying.map(k => [k, v.shape[k]])),
      stats: Object.fromEntries(Object.entries(v.stats).map(([k, x]) => [k, { value: x, words: statWords(statSpec[k] ?? {}, x), range: statSpec[k]?.range ?? null }])),
      tier: bad ? null : p.tier, price: bad ? null : p.price, unlock: bad ? null : p.unlock?.level ?? 1, gain: p.generated.gain ?? null, measuredOn: p.generated.measuredOn ?? null,
      made: !bad, why: bad?.why ?? null, part: p, design: v.design,
    });
  }
  const made = out.parts.filter(x => x.made);
  for (const x of made) out.byTier[x.tier] = (out.byTier[x.tier] ?? 0) + 1;
  // warnings: what the economy check would say, rivals with the same stats or shape, a crowded slot, the aim
  out.warnings.push(...economyWarnings(made, ctx), ...duplicateWarnings(def, made, r, ctx, { editing }), ...crowdWarnings(def, made, ctx, { editing }));
  out.fits = fitsOf(def, made.length ? made : out.parts, ctx);
  if (kind.fit || kind.perCar) out.warnings.push(`Its models are made to fit each car when it's built: a car one can't be made to clear is left out then${kind.economy === 'measured' ? ' (and if that\'s the car it\'s measured on, its tier and price are worked out on the next one)' : ''}.`);
  if (def.aim) {
    const aim = aimOf(def.aim, made);
    out.aim = aim;
    if (aim.misses.length) {
      out.warnings.push(`${aim.misses.length} of ${made.length} parts miss the aim: ${aim.words}.`);
      if (suggest) out.suggestions = await suggestions(def, ctx, r, aim);
    }
  }
  for (const x of out.parts) delete x.part;
  return out;
}

// (the economy check's own rule, data/content/check-rules.json economy.valueOutlier: much better value than the slot's
// hand-made parts — too cheap for what it does)
function economyWarnings(made, ctx) {
  const { db, tiers, checkRules } = ctx, out = [], best = new Map();
  for (const x of made) {
    if (x.gain == null || !(x.gain > 0) || !x.measuredOn) continue;
    const key = `${x.measuredOn}|${x.part.slot}`;
    if (!best.has(key)) {
      const own = Object.values(db.parts).filter(p => p.slot === x.part.slot && !p.generated && !p.retired && !p.todo?.length && p.tier && p.tier !== 'stock' && !p.purpose && forCar(db, x.measuredOn, p));
      best.set(key, Math.max(0, ...own.map(p => { const g = partGain(db, x.measuredOn, p, tiers); return g.ok && g.gain > 0 ? g.gain / p.price : 0; })));
    }
    const b = best.get(key), price = x.price / (x.part.generated.priceFactor ?? 1);
    if (b > 0 && x.gain / price > checkRules.economy.valueOutlier * b) out.push(`${x.id} would fail the economy check: too cheap for what it does (${((x.gain / price) / b).toFixed(1)}× the value of the best hand-made ${x.part.slot} part; at most ${checkRules.economy.valueOutlier}×).`);
  }
  return out;
}

// (another family's part that does the same — every stat within warnings.nearStats of its range — or a hand-made one
// that performs the same; another family of the kind whose shape is all but the same)
function duplicateWarnings(def, made, r, ctx, { editing }) {
  const { db, formulas: F, config: C, families } = ctx, kind = F.families[def.kind], out = [], seen = new Set();
  const ranged = Object.entries(kind.stats).filter(([k, S]) => !k.startsWith('_') && S.range);
  const others = Object.values(db.parts).filter(p => !p.retired && p.slot === kind.slot && p.generated?.family !== (editing ?? def.id));
  for (const x of made) {
    for (const o of others) {
      if (seen.has(o.generated?.family ?? o.id)) continue;
      const same = o.generated?.kind === def.kind && o.generated.stats
        ? ranged.every(([k, S]) => Math.abs((o.generated.stats[k] ?? NaN) - x.part.generated.stats[k]) <= C.warnings.nearStats * (S.range[1] - S.range[0]))
        : !o.generated && perfKey(o) === perfKey(x.part);
      if (!same) continue;
      seen.add(o.generated?.family ?? o.id);
      out.push(`${x.id} does the same as ${o.name} (${o.id}${o.generated?.family ? `, the ${families[o.generated.family]?.name ?? o.generated.family} family` : ''}): ${o.generated ? 'every stat within a whisker' : 'it performs exactly the same'}.`);
    }
  }
  // the shape: each of this family's designs against each of another family's of the kind
  const mine = designs(def, kind, ctx);
  for (const f of Object.values(families).filter(f => f.kind === def.kind && f.id !== (editing ?? def.id))) {
    const theirs = designs(f, kind, ctx), close = mine.find(a => theirs.some(b => nearShape(a, b, kind, C.warnings.nearShape)));
    if (close) out.push(`Its shape is very like the ${f.name} family's (${Object.entries(close).filter(([k]) => kind.shapeSettings?.[k]).map(([k, v]) => `${kind.shapeSettings[k].label ?? k} ${v ?? 'auto'}`).slice(0, 4).join(', ')}…): change a shape setting or two to make it a design of its own.`);
  }
  return out;
}
// (a family's designs: each combination of its shape values and the settings that change the model)
function designs(def, kind, ctx) {
  const sh = shapeValues(def, kind, { kits: ctx.kits[def.kind] ?? {} });
  let out = [{}];
  for (const { key, values } of sh.settings) out = out.flatMap(d => values.map(v => ({ ...d, [key]: v })));
  for (const k of kind.shapeKeys ?? []) { const vals = listOf(def.settings?.[k]); if (vals.length) out = out.flatMap(d => vals.map(v => ({ ...d, [`=${k}`]: v }))); }
  return out.slice(0, 400);
}
function nearShape(a, b, kind, share) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const S = k.startsWith('=') ? kind.settings[k.slice(1)] : kind.shapeSettings?.[k], x = a[k], y = b[k];
    if (x === undefined || y === undefined) continue;          // (a setting one leaves to its default: not a difference)
    if (S?.range && typeof x === 'number' && typeof y === 'number') { if (Math.abs(x - y) > share * (S.range[1] - S.range[0])) return false; }
    else if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}
// (a slot with a lot of parts at a tier already: warnings.crowdedTier)
function crowdWarnings(def, made, ctx, { editing }) {
  const { db, formulas: F, config: C } = ctx, slot = F.families[def.kind].slot, out = [], have = {};
  for (const p of Object.values(db.parts)) if (!p.retired && p.slot === slot && p.generated?.family !== (editing ?? def.id) && p.tier) have[p.tier] = (have[p.tier] ?? 0) + 1;
  const adds = {};
  for (const x of made) adds[x.tier] = (adds[x.tier] ?? 0) + 1;
  for (const [t, n] of Object.entries(adds)) if ((have[t] ?? 0) + n >= C.warnings.crowdedTier) out.push(`The ${slot} slot would have ${(have[t] ?? 0) + n} ${t} parts (${have[t] ?? 0} there now): a long list in the shop. Aim it at another tier, or fewer variants.`);
  return out;
}

// Which cars it goes on: each part's standards and the cars that have them
function fitsOf(def, parts, ctx) {
  const { db } = ctx, all = { ...db, parts: { ...db.parts } }, cars = {}, groups = new Map();
  for (const x of parts) if (x.part) all.parts[x.id] = x.part;
  // (parts with the same standards go on the same cars: each such group once)
  for (const x of parts) { if (!x.part) continue; const k = JSON.stringify([x.part.slot, x.part.fits, x.part.conflicts]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x.id); }
  for (const ids of groups.values()) for (const c of Object.keys(db.cars)) if (forCar(all, c, all.parts[ids[0]])) { cars[c] ??= new Set(); for (const id of ids) cars[c].add(id); }
  const sample = parts.find(x => x.part)?.part, standards = [];
  for (const tag of new Set(parts.flatMap(x => x.part ? x.part.fits.flat() : []))) {
    const probe = { ...sample, id: '__builder_probe', fits: [tag], conflicts: [] }, db2 = { ...all, parts: { ...all.parts, [probe.id]: probe } };
    standards.push({ tag, cars: Object.keys(db.cars).filter(c => forCar(db2, c, probe)).sort() });
  }
  const left = Object.keys(def.leaveOff ?? {});
  return {
    total: Object.keys(cars).length,
    cars: Object.keys(db.cars).sort().map(c => ({ id: c, name: db.cars[c].name, parts: cars[c]?.size ?? 0, leftOff: left.includes(c) ? def.leaveOff[c] : null })),
    standards,
  };
}

// The aim (tiers, a price range, unlock levels) against what it makes
function aimOf(aim, made) {
  const misses = [], why = { tier: 0, price: 0, unlock: 0 };
  for (const x of made) {
    const r = [];
    if (aim.tiers?.length && !aim.tiers.includes(x.tier)) { r.push('tier'); why.tier++; }
    if (aim.price && ((aim.price[0] != null && x.price < aim.price[0]) || (aim.price[1] != null && x.price > aim.price[1]))) { r.push('price'); why.price++; }
    if (aim.unlock && ((aim.unlock[0] != null && x.unlock < aim.unlock[0]) || (aim.unlock[1] != null && x.unlock > aim.unlock[1]))) { r.push('unlock'); why.unlock++; }
    if (r.length) misses.push({ id: x.id, tier: x.tier, price: x.price, unlock: x.unlock, misses: r });
  }
  const words = [why.tier && `${why.tier} not ${aim.tiers.join(' or ')}`, why.price && `${why.price} priced outside ${aim.price.map(p => p == null ? '…' : money(p)).join('–')}`, why.unlock && `${why.unlock} unlocked outside level${aim.unlock.map(l => l ?? '…').join('–')}`].filter(Boolean).join(', ');
  return { misses, words };
}

// Which settings to change to hit the aim: each setting that changes what it does tried along its range (or each of its
// table's entries) with the rest as the family's first part has them — the tier, price and unlock level each gives
async function suggestions(def, ctx, r, aim) {
  const { db, formulas: F, tiers } = ctx, kind = F.families[def.kind], base = r.variants[0], out = [];
  if (!base) return out;
  const probe = (settings, shape) => {
    const d2 = { id: def.id, kind: def.kind, name: def.name, settings, shape, finishes: [base.finish] }, e = expandFamily(d2, { formulas: F, db, root: ctx.root, kits: ctx.kits });
    const v = e.variants[0];
    if (!v || e.problems.length) return null;
    const pr = priceFamilyParts([{ part: v.part, ctx: v.ctx }], { db, formulas: F, tiers });
    return pr.problems.size ? null : { tier: v.part.tier, price: v.part.price, unlock: v.part.unlock?.level ?? 1 };
  };
  const now = { ...Object.fromEntries(Object.entries(base.settings).filter(([k]) => kind.settings[k] && !kind.settings[k].cars)), ...(kind.settings.car ? { car: base.settings.car } : {}) };
  const shapeNow = Object.fromEntries(Object.entries(base.shape).filter(([, x]) => x != null));
  const hits = t => (!def.aim.tiers?.length || def.aim.tiers.includes(t.tier)) && (!def.aim.price || ((def.aim.price[0] == null || t.price >= def.aim.price[0]) && (def.aim.price[1] == null || t.price <= def.aim.price[1]))) && (!def.aim.unlock || ((def.aim.unlock[0] == null || t.unlock >= def.aim.unlock[0]) && (def.aim.unlock[1] == null || t.unlock <= def.aim.unlock[1])));
  const tryList = (S) => S.table ? named(S.table) : S.values ? S.values : S.range ? Array.from({ length: 7 }, (_, i) => { const v = S.range[0] + (S.range[1] - S.range[0]) * i / 6; return S.integer ? Math.round(v) : +v.toPrecision(3); }) : [];
  for (const [where, all, isShape] of [['setting', kind.settings, false], ['shape', kind.shapeSettings ?? {}, true]]) {
    for (const [k, S] of Object.entries(all)) {
      if (k.startsWith('_') || S.cars || S.kit || (isShape && !S.stats)) continue;
      const results = [];
      for (const val of [...new Set(tryList(S))]) {
        const t = isShape ? probe(now, { ...shapeNow, [k]: val }) : probe({ ...now, [k]: val }, shapeNow);
        if (t) results.push({ value: val, ...t, hits: hits(t) });
      }
      const good = results.filter(x => x.hits);
      if (good.length && good.length < results.length) out.push({ key: k, where, label: S.label ?? k, unit: S.unit ?? '', values: good.map(x => x.value), words: `${S.label ?? k}: ${good.map(x => `${typeof x.value === 'number' ? said(x.value, S.unit) : S.table?.[x.value]?.label ?? x.value} → ${x.tier}, ${money(x.price)}${x.unlock > 1 ? `, level ${x.unlock}` : ''}`).slice(0, 4).join('; ')}`, tried: results });
    }
  }
  return out.slice(0, 6);
}

// ---------- an existing family changed ----------

// A changed family's ids kept for the parts it still makes (players own them): a setting it varied and now doesn't stays
// in the ids (idKeys); one it didn't vary and now does leaves its old value out of them (idOmit) — so a part with the same
// settings, shape and finish as before keeps its id
export function withStableIds(def, was, ctx) {
  if (!was || was.kind !== def.kind) return def;
  const K = ctx.formulas.families[def.kind], kits = ctx.kits[def.kind] ?? {};
  const varies = (d, k, where) => where === 'settings' ? (listOf(d.settings?.[k]).length > 1 || !!K.settings[k]?.cars) : Array.isArray(d.shape?.[k]) && d.shape[k].length > 1;
  // (a fixed value as the family had it: its own, else its kind's default)
  const oldShape = Object.fromEntries(shapeValues(was, K, { kits }).settings.map(x => [x.key, x.values[0]]));
  const fixedWas = (k, where) => where === 'settings' ? (was.settings?.[k] !== undefined ? listOf(was.settings[k])[0] : K.settings[k]?.values || K.settings[k]?.table ? K.settings[k].default ?? null : null) : oldShape[k] ?? null;
  const idKeys = new Set(was.idKeys ?? def.idKeys ?? []), idOmit = { ...(was.idOmit ?? {}), ...(def.idOmit ?? {}) };
  for (const [where, all] of [['settings', K.settings], ['shape', K.shapeSettings ?? {}]]) for (const k of named(all)) {
    const before = varies(was, k, where) || idKeys.has(k), now = varies(def, k, where);
    if (before && !now) idKeys.add(k);
    if (!before && now) { const v = fixedWas(k, where); if (v != null && !(k in idOmit)) idOmit[k] = v; }
  }
  const out = { ...def };
  delete out.idKeys; delete out.idOmit;
  if (idKeys.size) out.idKeys = [...idKeys];
  if (Object.keys(idOmit).length) out.idOmit = idOmit;
  // (in the file's order)
  return Object.fromEntries(FAMILY_KEYS.filter(k => out[k] !== undefined).map(k => [k, out[k]]).concat(Object.entries(out).filter(([k]) => !FAMILY_KEYS.includes(k))));
}

// What saving a changed family does to its parts, worked out as the build will: parts added, parts whose stats, price,
// tier, unlock level, name or model change, and parts retired (no longer made: not sold, but players keep theirs) —
// ids never change for parts that are still made
export async function familyChanges(def, ctx, { summary = null } = {}) {
  const { db } = ctx, old = Object.values(db.parts).filter(p => p.generated?.family === def.id && !p.retired);
  summary ??= await summarise(def, ctx, { editing: def.id, suggest: false });
  const was = ctx.families[def.id], oldDesign = new Map();
  if (was) { const e = expandFamily(was, { formulas: ctx.formulas, db, root: ctx.root, kits: ctx.kits }); for (const v of e.variants) oldDesign.set(v.id, JSON.stringify([v.modelKey, v.design, v.part.model])); }
  const now = new Map(summary.parts.map(x => [x.id, x])), out = { added: [], changed: [], retired: [], same: [] };
  // (a family the build can't make isn't touched: none of its parts is retired)
  const stopped = summary.problems.length > 0;
  for (const x of summary.parts) {
    const p = db.parts[x.id];
    if (!p || p.retired) { out.added.push({ id: x.id, name: x.name, tier: x.tier, price: x.price, unlock: x.unlock, back: !!p?.retired }); continue; }
    const what = [];
    for (const [k, v] of Object.entries(x.stats)) if (p.generated?.stats?.[k] !== v.value) what.push({ field: k, from: p.generated?.stats?.[k] ?? null, to: v.value });
    if (x.made) for (const [k, a, b] of [['price', p.price, x.price], ['tier', p.tier, x.tier], ['unlock', p.unlock?.level ?? 1, x.unlock], ['name', p.name, x.name]]) if (a !== b) what.push({ field: k, from: a, to: b });
    if (oldDesign.size && oldDesign.get(x.id) !== JSON.stringify([x.modelKey, x.design, `assets/parts/${p.category}/${def.id}/${x.modelKey}.glb`])) what.push({ field: 'model', from: null, to: null });
    (what.length ? out.changed : out.same).push({ id: x.id, name: x.name, changes: what });
  }
  if (!stopped) for (const p of old) if (!now.has(p.id)) out.retired.push({ id: p.id, name: p.name, tier: p.tier, price: p.price });
  return out;
}

// ---------- names, presets ----------

export function suggestFamilyNames(kind, ctx, { seed = 1, count } = {}) {
  const taken = [...Object.values(ctx.families).map(f => f.name), ...Object.keys(ctx.families), ...Object.keys(ctx.engines), ...Object.keys(ctx.db.cars)];
  return suggestNames(kind, ctx.names, { taken, seed, count }).filter(n => !familyProblems({ id: idFromName(n), name: n, kind, finishes: ['painted'] }, ctx).length);
}

export const PRESET_DIR = 'data/content/presets';
const PRESET_KEYS = ['_note', 'name', 'kind', 'settings', 'shape', 'finishes', 'skip', 'leaveOff', 'aim'];
export const PRESET_NOTE = 'A family builder preset (docs/CONTENT_PIPELINE.md): a setup to start new families from — the admin page\'s New family › Start from a preset, or npm run content -- new-family --from-preset <name>. Its name is the preset\'s, not a family\'s.';
export const presetFile = name => `${PRESET_DIR}/${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}.json`;
export function listPresets(root = ROOT) {
  const dir = path.join(root, PRESET_DIR);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({ file: `${PRESET_DIR}/${f}`, ...readJson(`${PRESET_DIR}/${f}`, root) })) : [];
}
export function presetText(p) {
  const keys = [...PRESET_KEYS.filter(k => p[k] !== undefined)];
  return `{\n${keys.map(k => `  ${JSON.stringify(k)}: ${inline(p[k])}`).join(',\n')}\n}\n`;
}
export function presetFrom(name, def) {
  return { _note: PRESET_NOTE, name, kind: def.kind, settings: def.settings ?? {}, ...(def.shape && { shape: def.shape }), finishes: def.finishes ?? [], ...(def.skip && { skip: def.skip }), ...(def.leaveOff && { leaveOff: def.leaveOff }), ...(def.aim && { aim: def.aim }) };
}
export const presetProblem = name => /^[A-Za-z0-9][A-Za-z0-9 _-]{1,40}$/.test(String(name ?? '')) ? null : 'A preset\'s name is 2 to 41 letters, digits, spaces, _ or -.';

export const nameProblemOf = (name, ctx) => nameProblem(name, ctx.names);

// ---------- the live shape preview ----------

// One part's model, made there and then (for the shape step's 3D preview as the settings change): the middle part, or
// the one asked for — on its own, not fitted to a car (an aero kit: on its car). → { id, glb (base64), triangles, budget, findings }
export async function shapeModel(def, partId, ctx) {
  const { formulas: F, db, root } = ctx, kind = F.families[def.kind];
  const r = expandFamily(def, { formulas: F, db, root, kits: ctx.kits });
  if (!r.variants.length) throw Object.assign(new Error(r.problems[0] ?? 'It makes no parts.'), { status: 400 });
  const v = r.variants.find(x => x.id === partId) ?? r.variants[Math.floor((r.variants.length - 1) / 2)];
  const { shapeFor, withKits } = await import('../shapes/index.js'), { checkModel } = await import('./check.mjs'), { inspect } = await import('./inspect.mjs'), { modelIO, quiet } = await import('./io.mjs');
  const design = await withKits(def.kind, kind, v.design), shape = shapeFor(kind.shape);
  const car = kind.perCar ? await (await import('../generators/lib/car.js')).loadCar(v.settings.car) : undefined;
  const model = await shape(v.modelKey, v.ctx, v.stats, design, car);
  const doc = quiet(await model.document()), info = inspect(doc), t = ctx.project.rules.types[kind.type];
  const findings = checkModel(info, { rules: ctx.project.rules, type: kind.type, file: `${v.modelKey}.glb` }).findings.filter(f => f.level !== 'pass').map(f => ({ level: f.level, text: f.text }));
  const io = await modelIO();
  return { id: v.id, name: v.part.name, glb: Buffer.from(await io.writeBinary(doc)).toString('base64'), triangles: info.triangles.length, budget: t.triangles, findings, fitted: !!kind.fit };
}

// ---------- variations ----------

// Several new families from one (a preset or a family): each the same but for the settings and shape settings chosen —
// each of their values in turn (three materials, a budget, middle and top build), or, for several, different mixes of
// them — each with an invented name (checked like any other) and what it'd make. Nothing is made.
//   from: { preset } | { family } | { def }   vary: [key] (a setting's or a shape setting's)   → [{ def, varied, summary }]
export async function variationPlan(from, vary, ctx, { count = ctx.config.variations.max, seed = 1 } = {}) {
  let base;
  if (from?.preset) { base = listPresets(ctx.root).find(p => p.name === from.preset || p.file === presetFile(from.preset)); if (!base) throw Object.assign(new Error(`There's no preset "${from.preset}".`), { status: 404 }); }
  else if (from?.family) { base = ctx.families[from.family]; if (!base) throw Object.assign(new Error(`There's no family "${from.family}".`), { status: 404 }); }
  else base = from?.def;
  if (!base?.kind || !ctx.formulas.families[base.kind]) throw Object.assign(new Error('Start from a preset or a family.'), { status: 400 });
  const kind = ctx.formulas.families[base.kind], keys = [...new Set(vary ?? [])], max = Math.min(count, ctx.config.variations.max);
  if (!keys.length) throw Object.assign(new Error('Pick the settings to vary.'), { status: 400 });
  // each key's values to try: a table's entries, a list's values, a range's spread across it — not the one it has
  const choices = {};
  for (const k of keys) {
    const S = kind.settings[k] ?? kind.shapeSettings?.[k], where = kind.settings[k] ? 'settings' : 'shape';
    if (!S || k.startsWith('_') || S.cars) throw Object.assign(new Error(`"${k}" isn't a setting or shape setting of a ${kind.label} that can be varied.`), { status: 400 });
    const now = listOf(base[where]?.[k]).map(x => JSON.stringify(x));
    let vals = S.table ? named(S.table) : S.values ? S.values : S.kit ? ['none', ...(ctx.kits[base.kind]?.[S.kit] ?? [])] : S.range ? Array.from({ length: Math.max(2, max) }, (_, i) => { const v = S.range[0] + (S.range[1] - S.range[0]) * (i + 0.5) / Math.max(2, max); return S.integer ? Math.round(v) : +v.toPrecision(3); }) : [];
    vals = [...new Set(vals.map(v => JSON.stringify(v)))].filter(v => !now.includes(v) || vals.length <= 1).map(v => JSON.parse(v));
    choices[k] = { where, vals };
  }
  // the mixes: each value of one key in turn; for several keys, their values stepped together and shuffled by the seed
  let combos = [];
  if (keys.length === 1) combos = choices[keys[0]].vals.map(v => ({ [keys[0]]: v }));
  else {
    const n = Math.max(...keys.map(k => choices[k].vals.length));
    let x = (seed >>> 0) || 1; const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    const seen = new Set();
    for (let i = 0; combos.length < max && i < n * 8; i++) {
      const c = Object.fromEntries(keys.map((k, j) => [k, choices[k].vals[(i + (j ? Math.floor(rnd() * choices[k].vals.length) : 0)) % choices[k].vals.length]]));
      const s = JSON.stringify(c); if (!seen.has(s)) { seen.add(s); combos.push(c); }
    }
  }
  combos = combos.slice(0, max);
  const names = suggestFamilyNames(base.kind, ctx, { seed, count: combos.length + 6 }), out = [];
  for (const [i, c] of combos.entries()) {
    const name = names[i] ?? `${base.name ?? 'Family'} ${i + 2}`;
    const d = { kind: base.kind, name, settings: { ...(base.settings ?? {}) }, shape: { ...(base.shape ?? {}) }, finishes: base.finishes, ...(base.skip && { skip: base.skip }), ...(base.leaveOff && { leaveOff: base.leaveOff }), ...(base.aim && { aim: base.aim }) };
    for (const [k, v] of Object.entries(c)) d[choices[k].where][k] = v;
    // (a table or list setting that's varied is one value in each — a skip naming another of its values is dropped)
    if (d.skip) d.skip = d.skip.filter(sk => Object.entries(c).every(([k, v]) => sk[k] === undefined || String(sk[k]) === String(v)));
    if (!Object.keys(d.shape).length) delete d.shape;
    const { def, problems } = normaliseFamily(d, ctx);
    const s = def ? await summarise(def, ctx, { suggest: false }) : { problems, warnings: [], parts: [], count: 0, byTier: {} };
    const made = s.parts.filter(p => p.made), prices = made.map(p => p.price);
    out.push({ def, varied: c, text: def ? familyText(def) : null, summary: { count: s.count, byTier: s.byTier, problems: [...problems, ...s.problems], warnings: s.warnings.slice(0, 6), price: prices.length ? [Math.min(...prices), Math.max(...prices)] : null, unlock: made.length ? [Math.min(...made.map(p => p.unlock)), Math.max(...made.map(p => p.unlock))] : null, previewPicks: [] } });
  }
  return out;
}

// ---------- engines ----------

export const ENGINE_NOTE = 'An engine (docs/CONTENT_PIPELINE.md): its settings here, its torque curve, mass and size from data/content/formulas.json engines (overrides: torqueCurve, mass, size to set them yourself). npm run content -- build makes its crate engine part, data/parts/engine/crate_<id>.json, and its model.';
const ENGINE_KEYS = ['_note', 'id', 'maker', 'name', 'layout', 'cylinders', 'displacement', 'aspiration', 'boost', 'idle', 'redline', 'character', 'mount', 'sound', 'colour', 'overrides', 'status'];
export function engineText(def) {
  const keys = [...ENGINE_KEYS.filter(k => def[k] !== undefined), ...Object.keys(def).filter(k => !ENGINE_KEYS.includes(k) && def[k] !== undefined)];
  const val = (k, v) => k === 'displacement' && Number.isInteger(v) ? v.toFixed(1) : k === 'boost' && Number.isInteger(v) ? v.toFixed(1) : inline(v);
  return `{\n${keys.map(k => `  ${JSON.stringify(k)}: ${val(k, def[k])}`).join(',\n')}\n}\n`;
}
export function engineOptions(ctx) {
  const E = ctx.formulas.engines, S = ctx.standards, root = ctx.root, dir = path.join(root, 'data/sounds/engines');
  const sounds = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => { const c = readJson(`data/sounds/engines/${f}`, root); return { id: f.replace(/\.json$/, ''), cylinders: c.cylinders ?? null, label: c.label ?? c.name ?? f.replace(/\.json$/, '') }; }) : [];
  const makers = [...new Set([...(ctx.config.engines?.makers ?? []), ...Object.values(ctx.engines).map(e => e.maker).filter(Boolean)])];
  return {
    makers: makers.filter(m => !nameProblem(m, { ...ctx.names, pattern: '.*', maxLength: 60 })), layouts: named(E.layouts).map(k => ({ id: k, label: E.layouts[k].label })), aspirations: named(E.aspirations).map(k => ({ id: k, label: E.aspirations[k].label })),
    ranges: Object.fromEntries(Object.entries(E.ranges).filter(([k]) => !k.startsWith('_'))), mounts: named(S.engineMounts).map(k => ({ id: k, label: S.engineMounts[k].label })), sounds, colours: ctx.config.engines?.colours ?? ['grey'],
    engines: Object.values(ctx.engines).map(e => ({ id: e.id, maker: e.maker, name: e.name ?? null })),
  };
}
// An engine from the form: its file, what it comes to (torque curve, power, mass, bay, price, tier, unlock level), the
// cars it goes in and why the others won't, and what stops it being made
export async function engineSummary(input, ctx, { editing = null } = {}) {
  const { cratePart, engineWords } = await import('../../garage/engines.js');
  const { soundProblems } = await import('./build.mjs');
  const problems = [], E = ctx.formulas.engines;
  if (!input || typeof input !== 'object') return { problems: ['There\'s no engine to make.'] };
  for (const k of Object.keys(input)) if (!ENGINE_KEYS.includes(k) && k !== 'editing') problems.push(`"${k}" isn't something an engine file has (${ENGINE_KEYS.filter(x => x !== '_note').join(', ')}).`);
  const num = k => input[k] === '' || input[k] == null ? undefined : Number(input[k]);
  const def = {
    _note: input._note ?? ctx.engines[editing]?._note ?? ENGINE_NOTE, id: editing ?? String(input.id ?? '').trim(), maker: String(input.maker ?? '').trim(), ...(input.name ? { name: String(input.name).trim() } : {}),
    layout: input.layout, cylinders: num('cylinders'), displacement: num('displacement'), aspiration: input.aspiration ?? 'natural', ...((input.aspiration ?? 'natural') !== 'natural' ? { boost: num('boost') } : {}),
    idle: num('idle'), redline: num('redline'), character: num('character'), mount: input.mount, sound: input.sound, colour: input.colour ?? 'grey', ...(input.overrides && { overrides: input.overrides }), status: input.status ?? ctx.engines[editing]?.status ?? 'draft',
  };
  if (!/^[a-z][a-z0-9_]{2,30}$/.test(def.id)) problems.push(`An engine's id is 3 to 31 lower-case letters, digits and _, starting with a letter (like "kmw_v6_35"): "${def.id}" isn't one.`);
  else if (!editing && (ctx.engines[def.id] || ctx.families[def.id] || ctx.db.cars[def.id] || ctx.db.parts[`crate_${def.id}`])) problems.push(`There's already an engine, family or car "${def.id}" (or a part crate_${def.id}): pick another id.`);
  const makers = engineOptions(ctx).makers;
  if (!makers.includes(def.maker)) problems.push(`Pick its maker from the made-up makers (${makers.join(', ')}: data/content/builder.json engines.makers).`);
  if (def.name) { const np = nameProblem(def.name, { ...ctx.names, pattern: '^[A-Z0-9].*$', maxLength: 60 }); if (np) problems.push(np); }
  if (!(ctx.config.engines?.colours ?? []).includes(def.colour)) problems.push(`Its colour is one of ${(ctx.config.engines?.colours ?? []).join(', ')}.`);
  if (!def.sound || !fs.existsSync(path.join(ctx.root, `data/sounds/engines/${def.sound}.json`))) problems.push(`Pick its sound (data/sounds/engines: ${engineOptions(ctx).sounds.map(s => s.id).join(', ')}).`);
  const r = cratePart(def, { formulas: ctx.formulas, standards: ctx.standards, tiers: ctx.tiers });
  problems.push(...r.problems);
  if (!problems.length) problems.push(...soundProblems(ctx.root, def));
  const out = { def, text: engineText(def), problems, name: r.part?.name ?? def.name ?? def.id, words: r.part ? engineWords(def) : null };
  if (!r.part) return out;
  const p = r.part, all = { ...ctx.db, parts: { ...ctx.db.parts, [p.id]: { ...p, conflicts: [] } } };
  out.part = { id: p.id, name: p.name, tier: p.tier, price: p.price, unlock: p.unlock?.level ?? 1, mass: p.mass, requires: p.requires, fits: p.fits };
  out.curve = r.design.curve; out.power = r.design.power; out.torque = r.design.stats.peakTorque; out.size = r.design.size; out.bay = r.design.bay; out.mass = r.design.stats.mass;
  // the cars it goes in, and why not the others (their engine mount, their bay)
  out.cars = Object.keys(ctx.db.cars).sort().map(c => {
    const car = ctx.db.cars[c], ok = forCar(all, c, all.parts[p.id]), why = [];
    if (!ok) for (const tag of p.fits) { const probe = { ...p, id: '__engine_probe', fits: [tag], conflicts: [] }; if (!forCar({ ...all, parts: { ...all.parts, [probe.id]: probe } }, c, probe)) why.push(tag.startsWith('mount:') ? `its engine sits ${car.standards?.engineMount ?? 'another way'}, this one is made to sit ${tag.slice(6)}` : tag.startsWith('bay:') ? `its bay is ${car.standards?.bay ?? 'smaller'}, this engine needs a ${tag.slice(4)} bay or bigger` : `it hasn't ${tag}`); }
    return { id: c, name: car.name, fits: ok, why: ok ? null : why.join('; ') || 'it doesn\'t take it' };
  });
  out.note = 'A car whose bonnet or body it would go through is left out when it\'s built (the fit check needs the models).';
  return out;
}

// ---------- cars ----------

export function carOptions(ctx) {
  const dir = path.join(ctx.root, 'data/content/templates');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => { const t = readJson(`data/content/templates/${f}`, ctx.root); return { type: t.type, label: t.label, donor: t.donor, sizes: t.sizes ?? null, standards: t.standards }; }) : [];
}
export function carProblems(input, ctx) {
  const out = [], types = carOptions(ctx).map(t => t.type);
  if (!/^[a-z][a-z0-9_]{2,30}$/.test(input.id ?? '')) out.push(`A car's id is 3 to 31 lower-case letters, digits and _, starting with a letter (like "comet_gt"): "${input.id ?? ''}" isn't one.`);
  else if (ctx.db.cars[input.id] || fs.existsSync(path.join(ctx.root, `data/cars/${input.id}`)) || ctx.families[input.id] || ctx.engines[input.id]) out.push(`There's already a car, family or engine "${input.id}": pick another id.`);
  if (!types.includes(input.type)) out.push(`Its type is one of ${types.join(', ')}.`);
  if (input.name) { const np = nameProblem(input.name, { ...ctx.names, pattern: '^[A-Z0-9].*$', maxLength: 40 }); if (np) out.push(np); }
  return out;
}
