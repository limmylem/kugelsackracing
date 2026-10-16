// A family's preview (docs/CONTENT_PIPELINE.md "A family from the admin page"): a few of its parts' models made as the
// build makes them — the same shape code, fitted to each car where the kind needs it, fixed, checked against the model
// rules, finished (levels of detail, compressed textures) — with their icons and studio thumbnails, into a folder of
// their own. Nothing is saved as a part.
//
//   previewPicks(parts, { max }) → [id]   the smallest, the largest, one in the middle, and one of each shape
//   previewParts(def, ids, { root, out, cars }) → { parts: [{ id, model, byCar, icon, thumb, findings, triangles }] }

import fs from 'node:fs';
import path from 'node:path';
import { checkModel } from './check.mjs';
import { autoFix } from './fix.mjs';
import { renderIcon } from './icon.mjs';
import { inspect } from './inspect.mjs';
import { finishModel } from './finish.mjs';
import { modelIO, quiet } from './io.mjs';
import { loadProject } from './project.mjs';
import { ROOT, readJson, rel } from './rules.mjs';
import { expandFamily } from './families.mjs';
import { forCar, REFERENCE_CAR } from './balance.mjs';
import { renderThumbnail } from './thumbnail.mjs';
import { shapeFor, withKits } from '../shapes/index.js';
import { loadCar } from '../generators/lib/car.js';
import { fitBuild } from '../generators/lib/fitcheck.js';

// (parts in order along what changes most: their varying numbers, then their ids)
export function previewPicks(parts, { max = 12 } = {}) {
  const made = parts.filter(p => p.made !== false);
  if (!made.length) return [];
  const num = p => Object.values(p.settings ?? {}).filter(v => typeof v === 'number');
  const sorted = [...made].sort((a, b) => { const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return a.id.localeCompare(b.id); });
  const out = [sorted[0], sorted.at(-1), sorted[Math.floor((sorted.length - 1) / 2)]];
  const shapes = new Map();
  for (const p of sorted) { const k = JSON.stringify(p.shape ?? {}); if (!shapes.has(k)) shapes.set(k, p); }
  out.push(...shapes.values());
  return [...new Set(out.map(p => p.id))].slice(0, max);
}

export async function previewParts(def, ids, { root = ROOT, out, cars = null, log = () => {}, progress = () => {} } = {}) {
  const project = await loadProject(root), formulas = readJson('data/content/formulas.json', root), config = readJson('data/content/builder.json', root);
  const r = expandFamily(def, { formulas, db: project.db, root });
  if (!r.variants.length) throw Object.assign(new Error(`Nothing to preview: ${r.problems[0] ?? 'it makes no parts'}`), { problems: r.problems });
  const picked = (ids?.length ? r.variants.filter(v => ids.includes(v.id)) : r.variants).slice(0, config.preview.maxParts);
  if (!picked.length) throw new Error(`None of those parts is one it makes (${ids.join(', ')}).`);
  const shape = shapeFor(r.kind.shape), io = await modelIO(), rules = project.rules, type = r.kind.type, made = new Map();
  const all = { ...project.db, parts: { ...project.db.parts, ...Object.fromEntries(r.variants.map(v => [v.id, v.part])) } };
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const write = async (key, model) => {
    if (made.has(key)) return made.get(key);
    const doc = quiet(await model.document());
    await autoFix(doc, { rules, type, compress: true });
    const info = inspect(doc), check = checkModel(info, { rules, type, file: `${key}.glb` });
    await finishModel(doc, { rules });
    const file = path.join(out, `${key}.glb`);
    fs.writeFileSync(file, Buffer.from(await io.writeBinary(doc)));
    const res = { file: rel(file, root), doc, findings: check.findings.filter(f => f.level !== 'pass').map(f => ({ level: f.level, text: f.text, fix: f.fix ?? null })), triangles: info.triangleCount ?? info.triangles?.length ?? null, bounds: info.bounds, fit: model.fit ?? null };
    made.set(key, res);
    return res;
  };
  const results = [];
  let done = 0;
  for (const v of picked) {
    const design = await withKits(def.kind, r.kind, v.design), p = v.part, entry = { id: p.id, name: p.name, modelKey: v.modelKey, byCar: {}, findings: [], fit: {}, part: p, cars: Object.keys(all.cars).filter(c => forCar(all, c, p)).sort() };
    try {
      if (r.kind.perCar) {
        const m = await write(v.modelKey, await shape(v.modelKey, v.ctx, v.stats, design, await loadCar(v.settings.car)));
        Object.assign(entry, { model: m.file, findings: m.findings, triangles: m.triangles });
      } else if (r.kind.fit) {
        const on = (cars?.length ? cars : Object.keys(all.cars)).filter(c => all.cars[c] && forCar(all, c, p)).sort((a, b) => (b === REFERENCE_CAR) - (a === REFERENCE_CAR) || a.localeCompare(b)).slice(0, config.preview.maxCars);
        if (!on.length) throw new Error(`it doesn't go on any car (it needs ${p.fits.flat().join(', ') || 'nothing'})`);
        const fitted = fitBuild({ db: all, rules, type, slot: p.slot, axes: r.kind.fit.axes, weights: r.kind.fit.weights, attach: r.kind.fit.attach ?? 0 }, (c, car) => shape(v.modelKey, v.ctx, v.stats, design, car, c));
        for (const carId of on) {
          const m = await write(`${v.modelKey}__${carId}`, await fitted(await loadCar(carId)));
          if (!entry.model) Object.assign(entry, { model: m.file, findings: m.findings, triangles: m.triangles, car: carId });
          else entry.byCar[carId] = { model: m.file };
          entry.fit[carId] = m.fit?.clashes ?? 0;
          if (m.fit?.clashes >= 10) entry.findings.push({ level: 'fail', text: `On the ${all.cars[carId].name} even its best fit goes through the car in ${m.fit.clashes} places: it would be left off that car.` });
        }
      } else {
        const m = await write(v.modelKey, await shape(v.modelKey, v.ctx, v.stats, design));
        Object.assign(entry, { model: m.file, findings: m.findings, triangles: m.triangles });
      }
      const t = rules.types[type];
      if (entry.triangles > t.triangles * 2) entry.findings.push({ level: 'fail', text: `${entry.triangles.toLocaleString('en-GB')} triangles, over twice the ${t.label.toLowerCase()} budget (${t.triangles.toLocaleString('en-GB')})` });
      // its icon and studio thumbnail, as the build and the checks make them
      const icon = path.join(out, `${p.id}.png`);
      fs.writeFileSync(icon, await renderIcon(made.get(entry.car ? `${v.modelKey}__${entry.car}` : v.modelKey).doc, { rules, type, look: p.look ?? null }));
      entry.icon = rel(icon, root);
      const part2 = { ...p, model: entry.model, byCar: Object.keys(entry.byCar).length ? entry.byCar : undefined }, db2 = { ...all, parts: { ...all.parts, [p.id]: part2 } };
      const th = await renderThumbnail(root, db2, rules, part2).catch(() => null);
      if (th) { const f = path.join(out, `${p.id}.webp`); fs.writeFileSync(f, th.webp); entry.thumb = rel(f, root); }
    } catch (err) { entry.findings.push({ level: 'fail', text: `Its model couldn't be made: ${err.message}` }); }
    entry.ok = !entry.findings.some(f => f.level === 'fail');
    results.push(entry);
    progress({ done: ++done, total: picked.length });
    log(`${entry.ok ? '✔' : '✘'} ${p.id}: ${entry.triangles ?? '?'} triangles${Object.keys(entry.fit).length ? `, fitted to ${Object.keys(entry.fit).join(', ')}` : ''}${entry.findings.length ? ` — ${entry.findings.map(f => f.text).join('; ')}` : ''}`, entry.ok ? '' : 'bad');
  }
  for (const m of made.values()) delete m.doc;
  return { parts: results, folder: rel(out, root) };
}
