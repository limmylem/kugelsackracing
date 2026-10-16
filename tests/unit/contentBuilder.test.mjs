// The family builder (docs/CONTENT_PIPELINE.md "A family from the admin page"; tools/content/builder.mjs):
//  - a family made in the builder and the same family written by hand: identical files and identical parts; every
//    family file there is reads and writes back as it is (made by hand, changed in the builder — and the other way)
//  - what the summary says a family will make is what the build makes: stats, tiers, prices and unlock levels, for
//    every kind (each kind's family against the parts the build made)
//  - values outside the allowed ranges can't be saved (every setting and shape setting of every kind)
//  - names too close to a real brand refused; every suggested name passes that check
//  - changing a family never changes the ids of the parts it still makes, and the parts it retires are the ones the
//    build retires
//  - the same settings make the identical model, every kind, kit pieces too
//  - a job that fails puts every file back as it was

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { ROOT } from '../../tools/content/rules.mjs';
import { builderContext, familyChanges, familyText, normaliseFamily, shapeModel, suggestFamilyNames, summarise } from '../../tools/content/builder.mjs';
import { expandFamily, priceFamilyParts } from '../../tools/content/families.mjs';
import { nameProblem, suggestNames } from '../../tools/content/names.mjs';
import { createJobs } from '../../tools/content/jobs.mjs';
import { SCHEMAS } from '../../garage/data.js';
import { createValidator } from '../../garage/jsonSchema.js';

const ctx = await builderContext();
const partFile = id => { for (const d of fs.readdirSync(path.join(ROOT, 'data/parts'))) { const f = path.join(ROOT, 'data/parts', d, `${id}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } return null; };
// (a copy of the repository to read, made of links, with some files of its own: the build's plan run on a changed family)
function overlayRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ogn-builder-'));
  const link = (from, to) => fs.symlinkSync(from, to);
  const need = new Set(Object.keys(files).flatMap(f => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  const fill = rel => {
    for (const e of fs.readdirSync(path.join(ROOT, rel))) {
      const r = rel ? `${rel}/${e}` : e;
      if (e === 'node_modules' || e === '.git') continue;
      if (need.has(r)) { fs.mkdirSync(path.join(root, r)); fill(r); } else if (!(r in files)) link(path.join(ROOT, r), path.join(root, r));
    }
  };
  fill('');
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(root, f), text);
  return root;
}

test('every family file reads and writes back as it is: one made by hand is changed in the builder, and the other way', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'data/families'))) {
    const text = fs.readFileSync(path.join(ROOT, 'data/families', f), 'utf8');
    assert.equal(familyText(JSON.parse(text)), text, f);
  }
});

test('a family made in the builder and the same family written by hand: identical files, identical parts', () => {
  // as the form sends it: a range picked as from, to and step, ticked values, a shape setting varied
  const fromForm = { kind: 'wheels', name: 'Halo-12', settings: { diameter: { from: 16, to: 18, step: 1 }, construction: ['cast', 'forged'], spokes: [12] }, shape: { spoke: 'split', dish: 0.02, cap: ['flat', 'dome'] }, finishes: ['painted', 'chrome'], aim: { tiers: ['street', 'race'] } };
  const { def, problems } = normaliseFamily(fromForm, ctx);
  assert.deepEqual(problems, []);
  // as a person writes it (the layout every family file has)
  const byHand = `{
  "_note": "A part family (docs/CONTENT_PIPELINE.md): npm run content -- build makes a part for every combination of the settings listed here and every finish, its stats from data/content/formulas.json (families.<kind>), its tier, price and unlock level from what it does. Change this file, not the parts it makes.",
  "id": "halo12",
  "kind": "wheels",
  "name": "Halo-12",
  "settings": { "diameter": [16, 17, 18], "construction": ["cast", "forged"], "spokes": 12 },
  "finishes": ["painted", "chrome"],
  "shape": { "spoke": "split", "dish": 0.02, "cap": ["flat", "dome"] },
  "aim": { "tiers": ["street", "race"] },
  "status": "draft"
}
`;
  assert.equal(familyText(def), byHand, 'the same file');
  const parts = d => { const r = expandFamily(d, { formulas: ctx.formulas, db: ctx.db }); priceFamilyParts(r.variants.map(v => ({ part: v.part, ctx: v.ctx })), { db: ctx.db, formulas: ctx.formulas, tiers: ctx.tiers }); return r.variants.map(v => v.part); };
  const a = parts(def), b = parts(JSON.parse(byHand));
  assert.equal(a.length, 24);
  assert.deepEqual(a, b, 'the same parts');
  // (and valid part files: a varied shape setting is kept in generated.shape)
  const schemas = Object.fromEntries(SCHEMAS.map(f => [f, JSON.parse(fs.readFileSync(path.join(ROOT, 'data/schemas', f), 'utf8'))])), validator = createValidator(schemas);
  assert.ok(a.every(p => p.generated.shape?.cap));
  for (const p of a) assert.deepEqual(validator.validate('part.schema.json', p).map(e => `${e.path}: ${e.message}`), [], p.id);
});

test('what the summary says a family will make is what the build made — stats, tier, price, unlock level — for every kind', async () => {
  const kinds = new Set();
  for (const def of Object.values(ctx.families)) {
    const s = await summarise(def, ctx, { editing: def.id, suggest: false }), made = Object.values(ctx.db.parts).filter(p => p.generated?.family === def.id && !p.retired);
    assert.deepEqual(s.problems, [], def.id);
    assert.deepEqual(s.parts.map(p => p.id).sort(), made.map(p => p.id).sort(), `${def.id}: the same parts`);
    for (const p of s.parts) {
      const f = partFile(p.id);
      assert.equal(p.tier, f.tier, `${p.id} tier`);
      assert.equal(p.price, f.price, `${p.id} price`);
      assert.equal(p.unlock, f.unlock?.level ?? 1, `${p.id} unlock level`);
      assert.equal(p.name, f.name, `${p.id} name`);
      assert.deepEqual(Object.fromEntries(Object.entries(p.stats).map(([k, x]) => [k, x.value])), f.generated.stats, `${p.id} stats`);
    }
    kinds.add(def.kind);
  }
  assert.deepEqual([...kinds].sort(), Object.keys(ctx.formulas.families).filter(k => !k.startsWith('_')).sort(), 'every kind has a family to check');
});

test('values outside the allowed ranges can\'t be saved: every setting and shape setting of every kind', async () => {
  for (const def of Object.values(ctx.families)) {
    const K = ctx.formulas.families[def.kind];
    for (const [where, all] of [['settings', K.settings], ['shape', K.shapeSettings]]) for (const [k, S] of Object.entries(all)) {
      if (k.startsWith('_')) continue;
      const bad = S.range ? [S.range[0] - (S.range[1] - S.range[0]) * 0.1 - 1e-3, S.range[1] + (S.range[1] - S.range[0]) * 0.1 + 1e-3] : S.table || S.values || S.kit ? ['nonesuch'] : S.cars ? ['no_such_car'] : [];
      for (const v of bad) {
        const d = { ...def, [where]: { ...(def[where] ?? {}), [k]: v } }, s = await summarise(d, ctx, { editing: def.id, suggest: false });
        assert.ok(s.problems.some(p => /outside what's allowed|isn't one there is|isn't a kit piece|there's no car/.test(p)), `${def.kind} ${where} ${k} = ${v}: ${s.problems.join(' | ')}`);
      }
    }
    // (a setting or shape setting the kind hasn't got)
    assert.ok((await summarise({ ...def, shape: { ...(def.shape ?? {}), wobble: 1 } }, ctx, { editing: def.id, suggest: false })).problems.some(p => /"wobble" isn't a .* shape setting/.test(p)));
  }
});

test('names too close to a real make, model or part brand are refused; every suggested name passes', () => {
  for (const n of ['Brembo', 'Br3mbo', 'Bremboline', 'Rekaro', 'Akrapovik', 'Supra', 'Mustang GT', 'Golf', 'OZ Line', 'Nismo', 'Ohlinz', 'Volk-10'])
    assert.ok(nameProblem(n, ctx.names), `${n} should be refused`);
  for (const n of ['Streetline', 'Mesh-10', 'Aerofoil', 'Airflow', 'Coldcore', 'Gripline', 'Groundline', 'Readout', 'Shellback', 'Spool', 'Tone Bar', 'Halo-12'])
    assert.equal(nameProblem(n, ctx.names), null, `${n} is made up`);
  for (const kind of Object.keys(ctx.formulas.families).filter(k => !k.startsWith('_'))) for (const seed of [1, 2, 3, 99]) {
    const names = suggestFamilyNames(kind, ctx, { seed });
    assert.ok(names.length >= 3, `${kind}: names to suggest`);
    for (const n of names) assert.equal(nameProblem(n, ctx.names), null, `${kind}: ${n}`);
  }
  // (a real name among the words it makes names from is never suggested)
  const rules = { ...ctx.names, parts: { ...ctx.names.parts, exhaust: ['Brembo', 'Akrapovic', 'Hush'] } };
  for (const seed of [1, 2, 3, 4, 5]) for (const n of suggestNames('exhaust', rules, { seed })) assert.ok(!/brembo|akrapovic/i.test(n), n);
});

test('changing a family never changes the ids of the parts it still makes; it retires what the build retires', async () => {
  const edits = [
    ['aerofoil', d => ({ ...d, shape: { ...d.shape, plates: ['standard', 'tall'] } })],          // a shape setting varied
    ['streetline', d => ({ ...d, settings: { ...d.settings, material: 'stainless' } })],         // a varied setting fixed
    ['streetline', d => ({ ...d, settings: { ...d.settings, tips: ['dual', 'quad'], diameter: [63, 70, 76, 89, 102] } })],
    ['mesh10', d => ({ ...d, settings: { ...d.settings, construction: ['flow', 'forged'] } })],
    ['readout', d => ({ ...d, finishes: ['matte'], shape: { needle: ['orange', 'red'] } })],
  ];
  // (a part's settings, its shape — every shape setting, defaults filled in — and its finish)
  const sigs = d => new Map(expandFamily(d, { formulas: ctx.formulas, db: ctx.db }).variants.map(v => [JSON.stringify([Object.entries(v.settings).sort(), Object.entries(v.shape).sort(), v.finish]), v.id]));
  for (const [id, change] of edits) {
    const { def, problems } = normaliseFamily(change(ctx.families[id]), ctx, { editing: id });
    assert.deepEqual(problems, []);
    const c = await familyChanges(def, ctx);
    const old = Object.values(ctx.db.parts).filter(p => p.generated?.family === id && !p.retired), before = sigs(ctx.families[id]), after = sigs(def);
    assert.equal(before.size, old.length, `${id}: the parts it made`);
    // a part with the same settings, shape and finish as one the family made keeps that one's id
    let kept = 0;
    for (const [sig, oldId] of before) if (after.has(sig)) { assert.equal(after.get(sig), oldId, `${id}: a part it still makes keeps its id`); kept++; }
    assert.ok(kept > 0, `${id}: it still makes some`);
    // the retired: as the build's own plan has it (the changed file read by the build, in a copy of the repository)
    const root = overlayRoot({ [`data/families/${id}.json`]: familyText(def) });
    try {
      const { plan } = await import('../../tools/content/build.mjs'), p = await plan({ root, only: [id] });
      assert.deepEqual(p.failed, [], `${id}: the build makes it`);
      const made = new Set(p.jobs.map(j => j.id)), retiredByBuild = old.filter(x => !made.has(x.id)).map(x => x.id).sort();
      assert.deepEqual(c.retired.map(x => x.id).sort(), retiredByBuild, `${id}: the retired`);
      assert.deepEqual(c.added.map(x => x.id).sort(), [...made].filter(x => !old.some(o => o.id === x)).sort(), `${id}: the added`);
      assert.ok(old.every(o => !made.has(o.id) || c.same.concat(c.changed).some(x => x.id === o.id)), `${id}: the rest kept, by id`);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('the same settings make the identical model: every kind, with kit pieces too', async () => {
  const hash = b64 => crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
  for (const def of Object.values(ctx.families)) {
    const a = await shapeModel(def, null, ctx), b = await shapeModel(JSON.parse(JSON.stringify(def)), null, ctx);
    assert.equal(hash(a.glb), hash(b.glb), def.id);
    const kit = Object.entries(ctx.formulas.families[def.kind].shapeSettings).find(([, S]) => S?.kit);
    const piece = kit && ctx.kits[def.kind]?.[kit[1].kit]?.[0];
    if (piece) {
      const d = { ...def, shape: { ...(def.shape ?? {}), [kit[0]]: piece } }, x = await shapeModel(d, null, ctx), y = await shapeModel(d, null, ctx);
      assert.equal(hash(x.glb), hash(y.glb), `${def.id} with ${piece}`);
      assert.notEqual(hash(x.glb), hash(a.glb), `${def.id}: the kit piece is in it`);
    }
  }
});

test('a job that fails puts every file back as it was (and says why, as the command line does)', async () => {
  const status = () => execSync('git status --short --untracked-files=all -- data assets', { cwd: ROOT }).toString();
  const before = status(), { def } = normaliseFamily({ kind: 'exhaust', name: 'Failtone', settings: { diameter: 60, material: 'steel' }, shape: { tipPiece: 'nonesuch' }, finishes: ['matte'] }, ctx);
  let done;
  const ended = new Promise(r => { done = r; });
  const jobs = createJobs({ onFinish: j => done(j) });
  jobs.start({ type: 'family', target: def.id, title: 'a family that fails', payload: { def, text: familyText(def) } });
  const j = await ended;
  await jobs.close();
  assert.equal(j.state, 'failed');
  assert.match(j.error, /couldn't be made: failtone: tip piece \(kit\) "nonesuch" isn't a kit piece there is/);
  assert.ok(j.undone.removed.includes('data/families/failtone.json'));
  assert.equal(status(), before, 'everything as it was');
});
