// The content pipeline's targets, measured (Phase 8 Step 3; data/content/targets.json, docs/CONTENT_PIPELINE.md):
//   a family of 50+ variants made from its definition and every part checked on every car it fits, ready to publish,
//   in under an hour (the biggest family there is, or the one named: made in memory — nothing written but its checks'
//   results — and checked from scratch)
//   a new car from a body template made playable (imported, its car.json, drivable, its class) — in a scratch copy of
//   the game's data, thrown away after
// Each run is added to targets.json's runs.
//
//   const r = await measureTargets({ family, log })   → { family: { id, variants, minutes, ok }, newCar: { … }, ok }

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadProject } from './project.mjs';
import { buildContent } from './build.mjs';
import { runChecks } from './checks.mjs';
import { newCar } from './newCar.mjs';
import { editJson } from './json.mjs';
import { ROOT, readJson } from './rules.mjs';
import { Garage } from '../../garage/data.js';

export async function measureTargets({ family = null, log = () => {} } = {}) {
  const T = readJson('data/content/targets.json'), out = {};
  // 1. a family: made, then every part checked
  const { db } = await loadProject(), counts = {};
  for (const p of Object.values(db.parts)) if (p.generated?.family && !p.retired) counts[p.generated.family] = (counts[p.generated.family] ?? 0) + 1;
  const fam = family ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (fam) {
    log(`family ${fam}: making it…`);
    let t = performance.now();
    const made = await buildContent({ only: [fam], check: true });
    const makeMin = (performance.now() - t) / 60000, ids = made.parts.map(p => p.id);
    log(`  ${ids.length} parts made in ${makeMin.toFixed(1)} min; checking every one on every car it fits…`);
    t = performance.now();
    const checked = await runChecks({ only: ids, all: true, log });
    const checkMin = (performance.now() - t) / 60000, minutes = makeMin + checkMin, failing = [...checked.failed, ...checked.drafts].filter(f => ids.includes(f.id));
    out.family = { id: fam, variants: ids.length, made: +makeMin.toFixed(1), checked: +checkMin.toFixed(1), minutes: +minutes.toFixed(1), failing: failing.length, ok: ids.length >= T.family.variants && minutes <= T.family.minutes };
  }
  // 2. a new car, in a scratch copy
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ogn-targets-'));
  try {
    for (const d of ['data', 'assets']) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true });
    log(`a new ${T.newCar.type}: from its template to playable…`);
    const t = performance.now(), r = await newCar('target_test_car', { type: T.newCar.type, root });
    const after = r.ok ? await loadProject(root) : null, g = after ? new Garage(after.db, null, 'target_test_car') : null;
    const minutes = (performance.now() - t) / 60000;
    out.newCar = { type: T.newCar.type, minutes: +minutes.toFixed(2), playable: !!(r.ok && g.drivable().ok && after.db.cars.target_test_car.class), class: after?.db.cars.target_test_car?.class ?? null, ok: false, why: r.ok ? null : r.message };
    out.newCar.ok = out.newCar.playable && minutes <= T.newCar.minutes;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  out.ok = Object.values(out).every(x => x.ok);
  const words = [out.family && `family ${out.family.id}: ${out.family.variants} variants made and checked in ${out.family.minutes} min (target ${T.family.variants}+ in ${T.family.minutes})${out.family.failing ? `, ${out.family.failing} failing` : ''}`, `new ${out.newCar.type}: playable (class ${out.newCar.class}) in ${out.newCar.minutes} min of the pipeline's time (target ${T.newCar.minutes}; under ${T.newCar.hours} h with the modelling)`].filter(Boolean).join('; ');
  editJson(path.join(ROOT, 'data/content/targets.json'), j => { j.runs = [...(j.runs ?? []), { date: new Date().toISOString().slice(0, 10), what: 'npm run content -- targets', result: `${out.ok ? 'met' : 'NOT met'} — ${words}` }].slice(-12); });
  return { ...out, words };
}
