// The content pipeline as a whole (Phase 8 Step 3; docs/CONTENT_PIPELINE.md):
//  - every part's automatic checks up to date and passing for everything players have — fit and clipping on every car
//    it fits, a drive, a crash, its sound, its budget, its price — and no car's class limits beatable even with every
//    draft that passes its checks (npm run content -- verify: the pre-commit hook and CI run it too)
//  - engine swaps: a crate engine goes in every car with its mount and bay (or says why not, in words), changing the
//    car's weight and balance; not in a car of another mount
//  - a new car of every body type made playable from its template
//  - the content bundles: the data the game starts from in one file named by its content, every model versioned by
//    its content; the same files, the same names
//  - studio thumbnails: a part on a car, or on its own

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { verify } from '../../tools/content/checks.mjs';
import { loadProject } from '../../tools/content/project.mjs';
import { ROOT } from '../../tools/content/rules.mjs';
import { fitWithNeeds, forCar } from '../../garage/balance.js';
import { Garage } from '../../garage/data.js';
import { newCar, TYPES } from '../../tools/content/newCar.mjs';
import { buildBundle, dataFiles } from '../../tools/content/bundle.mjs';
import { renderThumbnail, W, H } from '../../tools/content/thumbnail.mjs';

const { db, rules } = await loadProject();

test('every part\'s content checks are up to date, and pass for everything players have; no car\'s class limits can be beaten', async () => {
  const r = await verify();
  assert.deepEqual(r.problems, [], 'npm run content -- check (then commit data/content/checks.json)');
  assert.ok(r.parts > 600);
});

test('engine swaps: a crate engine goes in every car with its mount and bay, changing its weight and balance; not in others, saying why', () => {
  const crates = Object.values(db.parts).filter(p => p.generated?.engine && !p.retired);
  assert.ok(crates.length >= 6, `${crates.length} crate engines`);
  let swaps = 0;
  for (const p of crates) {
    const [mount, bay] = ['mount:', 'bay:'].map(k => p.fits.flat().find(t => t.startsWith(k))?.slice(k.length));
    for (const car of Object.values(db.cars)) {
      const left = (p.conflicts ?? []).includes(`car:${car.id}`), matches = car.standards?.engineMount === mount;
      const fits = forCar(db, car.id, p);
      if (!matches) { assert.equal(fits, false, `${p.id} (${mount}) shouldn't go in the ${car.name} (${car.standards?.engineMount})`); continue; }
      if (left) { assert.equal(fits, false); assert.match(p._fit ?? '', new RegExp(car.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${p.id}: why it's not for the ${car.name}`); continue; }
      if (!fits) continue;                 // (a bay too small: its tags say so)
      const before = new Garage(db, null, car.id).stats().spec, f = fitWithNeeds(db, car.id, p.id);
      assert.ok(f.ok, `${p.id} in the ${car.name}: ${f.error}`);
      const after = f.garage.stats().spec;
      assert.ok(f.garage.drivable().ok, `${p.id} in the ${car.name}: drivable`);
      assert.notEqual(after.mass, before.mass, `${p.id} in the ${car.name}: its weight changes`);
      assert.notEqual(after.centreOfMass[2], before.centreOfMass[2], `${p.id} in the ${car.name}: its balance changes`);
      assert.equal(after.engine.redlineRpm, p.engine.redlineRpm, `${p.id} in the ${car.name}: it's the engine that runs`);
      swaps++;
    }
    // and a car without the right mount says so, in words
    const other = Object.values(db.cars).find(c => c.standards?.engineMount && c.standards.engineMount !== mount);
    if (other) { const r = new Garage(db, null, other.id).install(p.id, { auto: true }); assert.equal(r.ok, false); assert.match(r.errors.map(e => e.message).join(' '), /mount|fit/i); }
  }
  assert.ok(swaps >= 6, `${swaps} swaps made`);
});

test('a new car of every body type, from its template: imported, drivable and given its class', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ogn-newcar-'));
  try {
    for (const d of ['data', 'assets']) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true });
    for (const type of TYPES()) {
      const r = await newCar(`t_${type}`, { type, root });
      assert.ok(r.ok, `${type}: ${r.message} ${(r.notes ?? []).filter(n => /problem/.test(n)).join(' ')}`);
    }
    const { db: after } = await loadProject(root);
    for (const type of TYPES()) {
      const car = after.cars[`t_${type}`];
      assert.equal(car.status, 'draft', 'a draft until it\'s published');
      assert.ok(car.class, `${type}: its class`);
      assert.equal(car.standards.type, type);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the content bundle: every file the game starts from, in one file named by its content; every model versioned by its own', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'ogn-bundle-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'ogn-bundle-'));
  try {
    const r1 = buildBundle({ out: a }), r2 = buildBundle({ out: b });
    assert.equal(r1.version, r2.version, 'the same files: the same bundle');
    assert.equal(r1.data, r2.data);
    const manifest = JSON.parse(fs.readFileSync(path.join(a, 'data/bundle.json'), 'utf8')), bundle = JSON.parse(fs.readFileSync(path.join(a, manifest.data), 'utf8'));
    for (const f of dataFiles()) assert.deepEqual(bundle.files[f], JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
    assert.ok(Object.keys(bundle.files).length > 650);
    const glb = 'assets/cars/starter_car/body.glb';
    assert.match(manifest.models[glb], /^[0-9a-f]{12}$/);
    assert.notEqual(manifest.models[glb], manifest.models['assets/cars/kaze_gt/body.glb']);
  } finally { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); }
});

test('studio thumbnails: a body part on a car, an engine part on its own; nothing for a part with no model', async () => {
  for (const id of ['spoiler_ducktail', 'kaze_gt_turbo_kit']) {
    const t = await renderThumbnail(ROOT, db, rules, db.parts[id]);
    const meta = await sharp(t.webp).metadata();
    assert.equal(meta.format, 'webp'); assert.equal(meta.width, W); assert.equal(meta.height, H);
    assert.match(t.key, /^[0-9a-f]{16}$/);
  }
  assert.equal(await renderThumbnail(ROOT, db, rules, Object.values(db.parts).find(p => !p.model && !p.variantOf && p.slot === 'ecu')), null);
});
