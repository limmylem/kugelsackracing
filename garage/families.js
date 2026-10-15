// Part families (Phase 8 Step 3; data/families/<id>.json, data/content/formulas.json families; docs/CONTENT_PIPELINE.md):
// one definition → a part for every combination of its settings' values and its finishes, each the same every time
// (its id from its family and values: mesh10_18_forged_chrome), its stats from the kind's formulas (a turbo's size →
// its boost and spool, an exhaust's diameter → its torque, a wheel's size and build → its weight), kept within each
// stat's allowed range — what's outside isn't made.
//
//   expandFamily(def, { formulas, carNames, kits }) → { kind, variants: [{ id, key, settings, shape, design, finish, stats, part, modelKey }], problems }
//   shapeValues(def, kind, { kits }) → { settings: [{ key, values }], problems }   (its shape settings, checked)
//
// Shape settings (formulas.json families.<kind>.shapeSettings; the family file's shape): what the model looks like —
// a wheel's spoke style, a wing's profile and end plates, an exhaust's tips — each a range, a list of values, a table
// (whose fields the stats' formulas can use as shape.<setting>.<field>: a wing's profile changes its downforce) or a
// kit piece (assets/kits/<kind>/: a hand-made piece the generator mixes in). Like a setting, a shape setting can list
// several values: a part for each. One the file doesn't give is its default (null: the generator's own, worked out
// from the part). A shape setting is in a part's id only when its family lists more than one value for it.
//
// A part's id: its family's, then the value of each setting (and shape setting) the family varies, then its finish.
// So that a family changed later keeps its parts' ids (players own them): idKeys — settings that stay in the id though
// the family no longer varies them; idOmit — a setting's value left out of the id (the one it had before the family
// varied it). The family builder writes both when an edit needs them.
//   applyStats(kindName, kind, ctx, stats) → the part's fields that come from its stats (what an edit re-works)
//   perfKey(part) → what a part does, as a string: two parts with the same one perform the same (a finish apart)
//
// The tier, price and unlock level come later, from what each part does on a car (tools/content/families.mjs).
// No browser or Node APIs.

import { evalStats, evaluate, rangeProblem } from './formulas.js';

const named = (o = {}) => Object.keys(o).filter(k => !k.startsWith('_'));
const listOf = v => v == null ? [] : Array.isArray(v) ? v : [v];
const r = (v, d = 4) => +(+v).toFixed(d);
const word = v => typeof v === 'number' ? String(v).replace('.', 'p') : String(v);

// A combination's settings for the formulas: numbers as they are, a table setting as its entry (construction.mass),
// a list setting's value as itself, the finish as its entry (finish.mass, finish.price), and its shape settings under
// shape (a table's as its entry: shape.profile.lift)
function contextOf(kind, values, finish, F, shape = {}) {
  const ctx = {};
  for (const [k, S] of Object.entries(kind.settings)) {
    if (k.startsWith('_')) continue;
    const v = values[k];
    ctx[k] = S.table ? { id: v, ...S.table[v] } : v;
  }
  ctx.finish = { id: finish, ...F.finishes[finish] };
  ctx.shape = shapeContext(kind, shape);
  return ctx;
}
const shapeContext = (kind, shape) => Object.fromEntries(Object.entries(kind.shapeSettings ?? {}).filter(([k]) => !k.startsWith('_')).map(([k, S]) => [k, S.table ? { id: shape[k], ...S.table[shape[k]] } : shape[k] ?? null]));

// A table's entry a value names: its id, or (as a hand-written file may give it) the entry's own fields — { up: 0.05,
// down: 0.06 } is the end plates' "standard"
export function tableEntry(S, v) {
  if (typeof v === 'string' || typeof v === 'number') return S.table[v] !== undefined ? String(v) : null;
  if (v && typeof v === 'object') return named(S.table).find(id => Object.entries(v).every(([k, x]) => JSON.stringify(S.table[id]?.[k]) === JSON.stringify(x))) ?? null;
  return null;
}
// What the generator is given for a part's shape: each shape setting's value (a table's entry, with its id), the ones
// left to the generator (null) left out
export function designOf(kind, shape) {
  const out = {};
  for (const [k, S] of Object.entries(kind.shapeSettings ?? {})) {
    if (k.startsWith('_') || shape[k] == null) continue;
    out[k] = S.table ? { id: shape[k], ...S.table[shape[k]] } : shape[k];
  }
  return out;
}

// The shape settings a family gives, checked against its kind: [{ key, values }] (a value each, its default where
// the file gives none) and the problems
export function shapeValues(def, kind, { kits = {} } = {}) {
  const problems = [], out = [], what = def.id, all = kind.shapeSettings ?? {}, given = def.shape ?? {};
  for (const k of Object.keys(given)) if (!all[k] || k.startsWith('_')) problems.push(`${what}: "${k}" isn't a ${kind.label} shape setting (they are: ${named(all).join(', ') || 'none'})`);
  for (const [k, S] of Object.entries(all)) {
    if (k.startsWith('_')) continue;
    // (a list is several values — a part for each — unless the setting's one value is itself a list)
    const raw = given[k] === undefined ? [] : Array.isArray(given[k]) ? given[k] : [given[k]];
    if (!raw.length) { out.push({ key: k, values: [S.default ?? null], fromDefault: true }); continue; }
    const vals = [];
    for (const v of raw) {
      if (S.table) { const id = tableEntry(S, v); if (id == null) problems.push(`${what}: ${S.label ?? k} ${JSON.stringify(v)} isn't one there is (${named(S.table).join(', ')})`); else vals.push(id); }
      else if (S.kit) { const have = ['none', ...(kits[S.kit] ?? [])]; if (!have.includes(v)) problems.push(`${what}: ${S.label ?? k} "${v}" isn't a kit piece there is (${have.join(', ')}: assets/kits/${def.kind}/)`); else vals.push(v); }
      else if (S.values) { if (!S.values.some(x => x === v)) problems.push(`${what}: ${S.label ?? k} ${JSON.stringify(v)} isn't one there is (${S.values.map(x => JSON.stringify(x)).join(', ')})`); else vals.push(v); }
      else if (S.range) {
        if (v === null) { vals.push(null); continue; }
        const p = rangeProblem(S, v, k);
        if (p) problems.push(`${what}: ${p}`);
        else if (S.integer && !Number.isInteger(v)) problems.push(`${what}: ${S.label ?? k} ${v} should be a whole number`);
        else vals.push(v);
      } else problems.push(`${what}: ${S.label ?? k} has no allowed values in formulas.json (a range, values, a table or a kit)`);
    }
    if (new Set(vals.map(x => JSON.stringify(x))).size !== vals.length) problems.push(`${what}: ${S.label ?? k} lists a value twice`);
    out.push({ key: k, values: vals });
  }
  return { settings: out, problems };
}

// The part's fields that come from its stats, by kind (what a stat edit in the content manager works out again)
export const KINDS = {
  wheels: (c, st) => ({
    kind: 'component', contactMaterial: 'metal', toughness: st.toughness, mass: st.mass,
    fits: ['wheel_hub:std', `rim_fits:${c.diameter}`, ...(c.boltPattern ? [`bolt_pattern:${c.boltPattern}`] : [])], provides: [`rim:${c.diameter}`],
    rim: { diameter: c.diameter, width: c.width, offset: c.offset },
  }),
  exhaust: (c, st) => ({
    kind: 'modifier', mass: st.mass, fits: [[`exhaust_route:${c.route ?? 'std'}`, 'exhaust_flange:rs']],
    effects: [
      { target: 'engine.torqueCurve', op: 'multiply', value: r(1 + st.topEnd), when: { rpm: [3000, 9000], fade: 1000 } },
      ...(st.lowEnd < 0 ? [{ target: 'engine.torqueCurve', op: 'multiply', value: r(1 + st.lowEnd), when: { rpm: [0, 2500], fade: 800 } }] : []),
    ],
    sound: { exhaust: { level: st.loudness, tone: st.tone, rasp: st.rasp, pops: st.pops } },
    detach: { detachable: true, looseType: 'hanging', mounts: [[0, 0, -0.18]], attachStrength: 1500, looseThreshold: 50, detachThreshold: 90 },
  }),
  spoiler: (c, st) => {
    // (a wing's set angle — shape.angle — is where it's tuned to when fitted: its downforce and drag are at that angle, and
    // the angle range scales them as before — × 0.45 at 0°, × 1.5 at 16° of what they are at 8°)
    const wing = c.style.id === 'wing', A = wing ? c.shape?.angle ?? 8 : 8, at = A <= 8 ? 0.45 + 0.55 * A / 8 : 1 + 0.5 * (A - 8) / 8;
    return {
      kind: 'component', mass: st.mass, contactMaterial: c.finish.id === 'carbon' ? 'carbon' : 'plastic', toughness: 0.7,
      fits: [`spoiler_mount:${c.mount}`],
      aero: { liftCoefficient: -st.downforce, dragCoefficient: st.drag, point: [0, r(c.riser + 0.04, 3), 0], angle: { min: 0, max: 16, default: A, scaleAtMin: r(0.45 / at, 3), scaleAtMax: r(1.5 / at, 3) } },
      ...(wing && { tuning: { angle: { label: 'angle', unit: '°', min: 0, max: 16, step: 1, default: A, apply: [{ op: 'angle' }] } } }),
      detach: { detachable: true, looseType: 'none', attachStrength: 2200, looseThreshold: 12, detachThreshold: 8 },
    };
  },
  intake: (c, st) => ({
    kind: 'modifier', mass: st.mass, fits: [['intake_flange:rs', 'intake_flange:std']], provides: [`intake:${c.style.id}`],
    effects: [
      { target: 'engine.torqueCurve', op: 'multiply', value: r(1 + st.topEnd), when: { rpm: [4000, 7200], fade: 1000 } },
      ...(st.lowEnd < 0 ? [{ target: 'engine.torqueCurve', op: 'multiply', value: r(1 + st.lowEnd), when: { rpm: [0, 1500], fade: 500 } }] : []),
    ],
    sound: { intake: { roar: st.roar, tone: 1.02 }, exhaust: { tone: 1.02 } },
  }),
  turbo: (c, st) => {
    const b = st.boost, curve = [[st.spoolRpm - 1000, 0], [st.spoolRpm, r(b * 0.5, 3)], [st.fullRpm, r(b * 0.95, 3)], [st.fullRpm + 600, b], [Math.max(st.fullRpm + 700, 6500), b], [Math.max(st.fullRpm + 1400, 7200), r(b * 0.9, 3)]];
    return {
      kind: 'modifier', mass: st.mass,
      effects: [{ target: 'engine.torqueCurve', op: 'boost', curve, efficiency: 0.85, max: r(b * 1.1, 2) }, { target: 'engine.induction', op: 'set', value: 'turbo' }],
      sound: { whistle: { fromHz: st.whistleLow, toHz: st.whistleHigh, gain: r(0.05 + (c.size - 40) * 0.0006, 4), noise: 0.5, q: 9, spoolUp: r(0.5 + (c.size - 40) * 0.012, 3), spoolDown: 0.45 }, blowoff: { kind: 'valve', gain: 0.06, hz: 2000, seconds: 0.45 } },
    };
  },
  intercooler: (c, st) => ({ kind: 'modifier', mass: st.mass, fits: ['intercooler_mount:std'], provides: ['intercooler'], effects: [] }),
  seat: (c, st) => ({ kind: 'component', mass: st.mass, fits: [`seat_mount:${c.mount}`], provides: ['seat:bucket'] }),
  steering_wheel: (c, st) => ({ kind: 'component', mass: st.mass, fits: ['steering_column:std'] }),
  gauges: (c, st) => ({ kind: 'component', mass: st.mass }),
  body_kit: (c, st) => ({
    kind: 'component', mass: st.mass, contactMaterial: c.finish.id === 'carbon' ? 'carbon' : 'plastic', toughness: 0.8, fits: [`car:${c.car}`],
    aeroEffect: { liftFront: st.liftFront, liftRear: st.liftRear, drag: st.drag },
    detach: { detachable: true, looseType: 'none', attachStrength: 1800, looseThreshold: 12, detachThreshold: 8 },
  }),
};

// The settings' values a family lists, checked against its kind: [{ key, values: [...] }] and the problems
function settingsOf(def, kind, { carNames }) {
  const problems = [], out = [], what = def.id;
  const given = def.settings ?? {};
  for (const k of Object.keys(given)) if (!kind.settings[k]) problems.push(`${what}: "${k}" isn't a ${kind.label} setting (they are: ${named(kind.settings).join(', ')})`);
  for (const [k, S] of Object.entries(kind.settings)) {
    if (k.startsWith('_')) continue;
    const vals = listOf(given[k]);
    if (!vals.length) {
      if (S.default == null && !S.cars) { problems.push(`${what}: it needs its ${S.label ?? k} (${k})`); continue; }
      if (S.cars) { problems.push(`${what}: it needs the cars its kit is made for (car: a list of car ids: ${Object.keys(carNames).join(', ')})`); continue; }
      out.push({ key: k, values: [null], fromDefault: true });
      continue;
    }
    for (const v of vals) {
      if (S.table && !(v in S.table)) problems.push(`${what}: ${S.label ?? k} "${v}" isn't one there is (${named(S.table).join(', ')})`);
      else if (S.values && !S.values.includes(v)) problems.push(`${what}: ${S.label ?? k} "${v}" isn't one there is (${S.values.join(', ')})`);
      else if (S.cars && !carNames[v]) problems.push(`${what}: there's no car "${v}" (${Object.keys(carNames).join(', ')})`);
      else if (S.range) {
        const p = rangeProblem(S, v, k);
        if (p) problems.push(`${what}: ${p}`);
        else if (S.integer && !Number.isInteger(v)) problems.push(`${what}: ${S.label ?? k} ${v} should be a whole number`);
      }
    }
    if (new Set(vals.map(String)).size !== vals.length) problems.push(`${what}: ${S.label ?? k} lists a value twice`);
    out.push({ key: k, values: vals });
  }
  return { settings: out, problems };
}

export function expandFamily(def, { formulas: F, carNames = {}, kits = {} }) {
  const problems = [], kind = F.families?.[def.kind];
  if (!def.id || !/^[a-z0-9_]+$/.test(def.id)) return { kind, variants: [], problems: [`${def.id ?? '(no id)'}: a family's id is lower-case letters, digits and _`] };
  if (!kind) return { kind, variants: [], problems: [`${def.id}: "${def.kind}" isn't a kind of part family (there are: ${named(F.families).join(', ')})`] };
  const s = settingsOf(def, kind, { carNames }), sh = shapeValues(def, kind, { kits: kits[def.kind] ?? {} });
  problems.push(...s.problems, ...sh.problems);
  const finishes = listOf(def.finishes ?? ['painted']);
  for (const f of finishes) if (!F.finishes[f]) problems.push(`${def.id}: finish "${f}" isn't one there is (${named(F.finishes).join(', ')})`);
  if (problems.length) return { kind, variants: [], problems };
  // every combination of the listed values (settings, then shape settings), then each in every finish
  let combos = [{ values: {}, shape: {} }];
  for (const { key, values } of s.settings) combos = combos.flatMap(c => values.map(v => ({ ...c, values: { ...c.values, [key]: v } })));
  for (const { key, values } of sh.settings) combos = combos.flatMap(c => values.map(v => ({ ...c, shape: { ...c.shape, [key]: v } })));
  combos = combos.flatMap(c => finishes.map(f => ({ ...c, finish: f })));
  const said = c => ({ ...c.values, ...c.shape, finish: c.finish });
  combos = combos.filter(c => !(def.skip ?? []).some(sk => Object.entries(sk).every(([k, v]) => String(said(c)[k]) === String(v))));
  const idKeys = new Set(def.idKeys ?? []), omit = def.idOmit ?? {};
  for (const k of [...idKeys, ...Object.keys(omit)]) if (!kind.settings[k] && !kind.shapeSettings?.[k]) problems.push(`${def.id}: idKeys and idOmit name settings: "${k}" isn't one of a ${kind.label}'s`);
  if (problems.length) return { kind, variants: [], problems };
  const varying = s.settings.filter(x => x.values.length > 1 || kind.settings[x.key].cars).map(x => x.key);
  const shapeVarying = sh.settings.filter(x => x.values.length > 1).map(x => x.key);
  const inId = [...s.settings.filter(x => varying.includes(x.key) || idKeys.has(x.key)).map(x => ['s', x.key]), ...sh.settings.filter(x => shapeVarying.includes(x.key) || idKeys.has(x.key)).map(x => ['sh', x.key])];
  const token = (k, v) => k in omit && String(omit[k]) === String(v) ? null : word(v);
  const variants = [];
  for (const combo of combos) {
    // (defaults worked out in order: a later one can use an earlier setting)
    const values = { ...combo.values }, finish = combo.finish, shape = combo.shape;
    const ctx0 = {};
    for (const [k, S] of Object.entries(kind.settings)) {
      if (k.startsWith('_')) continue;
      if (values[k] == null && S.default != null) {
        if (S.values || S.table) values[k] = S.default;
        else { try { values[k] = r(evaluate(S.default, { ...ctx0 })); } catch (err) { problems.push(`${def.id}: the default for ${S.label ?? k} (${S.default}) doesn't work: ${err.message}`); } }
      }
      ctx0[k] = S.table ? { id: values[k], ...S.table[values[k]] } : values[k];
    }
    const key = [...inId.map(([w, k]) => token(k, w === 's' ? values[k] : shape[k])).filter(t => t != null), finish].join('_');
    const id = `${def.id}_${key}`, what = id;
    const ctx = contextOf(kind, values, finish, F, shape);
    const { stats, problems: sp } = evalStats(kind.stats, ctx, { what });
    if (sp.length) { problems.push(...sp); continue; }
    const apply = KINDS[def.kind];
    if (!apply) { problems.push(`${def.id}: the ${def.kind} kind has no part maker (garage/families.js KINDS)`); break; }
    // what it needs fitted with it, and what it can't be fitted with (the kind's rules)
    const requires = [];
    for (const rule of kind.requires ?? []) { try { if (!rule.when || evaluate(rule.when, { ...ctx, ...stats })) requires.push(rule.needs); } catch (err) { problems.push(`${what}: the rule "${rule.when}" doesn't work: ${err.message}`); } }
    const made = apply(ctx, stats);
    // (its model: shared by the combinations that only differ in what doesn't change its shape — a finish, a build)
    const modelKey = [def.id, ...varying.filter(k => !kind.shapeKeys || kind.shapeKeys.includes(k)).map(k => word(values[k])), ...shapeVarying.map(k => word(shape[k]))].join('_');
    const name = (kind.name ?? '{family} {finish}').replace(/\{(\w+)\}/g, (m, k) => k === 'family' ? def.name ?? def.id : k === 'finish' ? F.finishes[finish].label : k === 'car' ? carNames[values.car] ?? values.car : values[k] == null ? m : kind.settings[k]?.table ? kind.settings[k].table[values[k]].label ?? values[k] : String(values[k]));
    const look = kind.finishMaterial ? { materials: { [kind.finishMaterial]: { finish: F.finishes[finish].finish } } } : { finish: F.finishes[finish].finish };
    // (in the part: the shape settings its family varies, and any that change its stats set other than their default —
    // what a stat edit in the content manager works the part out again from)
    const varied = Object.fromEntries(Object.keys(shape).filter(k => shapeVarying.includes(k) || (kind.shapeSettings[k]?.stats && shape[k] !== (kind.shapeSettings[k].default ?? null))).map(k => [k, shape[k]]));
    const part = {
      id, name: name[0].toUpperCase() + name.slice(1), category: kind.category, slot: kind.slot, kind: made.kind,
      price: 0, mass: made.mass, model: `assets/parts/${kind.category}/${def.id}/${modelKey}.glb`, icon: `assets/icons/parts/${id}.png`,
      fits: made.fits ?? [], requires: [...new Set([...(made.requires ?? []), ...requires])], conflicts: [...(kind.conflicts ?? []), ...(made.conflicts ?? []), ...Object.keys(def.leaveOff ?? {}).map(c => `car:${c}`)], provides: [...new Set([...(made.provides ?? []), ...(kind.provides ?? [])])],
      ...Object.fromEntries(Object.entries(made).filter(([k]) => !['kind', 'mass', 'fits', 'requires', 'conflicts', 'provides'].includes(k))),
      ...(kind.purpose && { purpose: kind.purpose }),
      look, status: def.status ?? 'draft',
      generated: { family: def.id, kind: def.kind, key, settings: { ...values, finish }, ...(Object.keys(varied).length && { shape: varied }), stats },
      _generated: `Made by npm run content -- build from data/families/${def.id}.json (and data/content/formulas.json families.${def.kind}): change those, not this file.`,
    };
    variants.push({ id, key, settings: values, shape, design: designOf(kind, shape), finish, stats, part, modelKey, ctx });
  }
  const ids = variants.map(v => v.id), dup = ids.find((x, i) => ids.indexOf(x) !== i);
  if (dup) problems.push(`${def.id}: two combinations make the id "${dup}"`);
  return { kind, variants, problems };
}

// What a part does, as a string: everything but how it looks and sells (its name, finish, price, icon, model, tier,
// unlock, status and notes) — finish variants of a family's part have the same one
const LOOKS = new Set(['id', 'name', 'price', 'icon', 'model', 'look', 'tier', 'unlock', 'status', 'generated', 'byCar', 'madeBy', 'variantOf', 'retired', 'todo', 'bounds', 'massOffset', 'contactMaterial']);
export function perfKey(part) {
  const keep = {};
  for (const [k, v] of Object.entries(part)) if (!LOOKS.has(k) && !k.startsWith('_')) keep[k] = v;
  // (a finish's own mass: carbon is lighter, so it does perform differently)
  return JSON.stringify(keep, Object.keys(keep).sort());
}

// The stats a kind lets the content manager change, with their allowed ranges (formulas.json): { stat: { label, unit, range } }
export function editableStats(kind) {
  return Object.fromEntries(Object.entries(kind?.stats ?? {}).filter(([k, s]) => !k.startsWith('_') && s.range).map(([k, s]) => [k, { label: s.label ?? k, unit: s.unit ?? '', range: s.range, digits: s.digits }]));
}
// A family part's fields from changed stats (a content manager edit), the rest of the part as it was
export function applyStats(part, F, stats) {
  const kindName = part.generated?.family && part.generated.kind;
  if (!kindName || !KINDS[kindName] || !F.families[kindName]) return null;
  const kind = F.families[kindName], values = { ...part.generated.settings }, finish = values.finish;
  delete values.finish;
  const ctx = contextOf(kind, values, finish, F, { ...Object.fromEntries(Object.entries(kind.shapeSettings ?? {}).map(([k, S]) => [k, S.default ?? null])), ...(part.generated.shape ?? {}) });
  const made = KINDS[kindName](ctx, stats);
  const out = { mass: made.mass };
  for (const k of ['effects', 'sound', 'aero', 'aeroEffect', 'rim', 'toughness']) if (made[k] !== undefined) out[k] = made[k];
  return out;
}
