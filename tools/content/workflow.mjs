// The content workflow in the repository (Phase 8 Step 3; docs/CONTENT_PIPELINE.md) — the files' statuses, which the
// live game's content manager starts from (the admin page's Content tab keeps its own on the server):
//
//   setStatus(ids, to) → { changed: [id], problems: [words] }   a part's (or a car's, or every part of a family or an
//       engine, by its name) status in its file: draft, review or published. Publishing needs its checks passed and up
//       to date (data/content/checks.json: npm run content -- check); a part that fails stays as it is, with why
//   report() → text   every family and engine: how many parts, their tiers, prices and statuses, and what's failing;
//       the cars and their class limits; the targets (data/content/targets.json) against the last runs

import fs from 'node:fs';
import path from 'node:path';
import { loadProject } from './project.mjs';
import { editJson } from './json.mjs';
import { ROOT, readJson } from './rules.mjs';
import { STATUSES, statusOf } from '../../garage/content.js';

const RESULTS = 'data/content/checks.json';

export async function setStatus(ids, to, { root = ROOT } = {}) {
  const out = { changed: [], problems: [] };
  if (!STATUSES.includes(to)) { out.problems.push(`--to must be one of ${STATUSES.join(', ')}`); return out; }
  if (!ids.length) { out.problems.push('which parts? npm run content -- status <ids, a family or an engine…> --to published'); return out; }
  const { db } = await loadProject(root), have = fs.existsSync(path.join(root, RESULTS)) ? readJson(RESULTS, root) : { parts: {} };
  const { keysOf, KINDS } = await import('./checks.mjs');
  const files = Object.fromEntries(readJson('data/parts/index.json', root).parts.map(f => [path.basename(f, '.json'), `data/parts/${f}`]));
  // (a family's or an engine's name: all its parts)
  const parts = [], cars = [];
  for (const id of ids) {
    if (db.parts[id]) parts.push(db.parts[id]);
    else if (db.cars[id]) cars.push(db.cars[id]);
    else {
      const of = Object.values(db.parts).filter(p => !p.retired && (p.generated?.family === id || p.generated?.engine === id));
      if (of.length) parts.push(...of); else out.problems.push(`there's no part, car, family or engine "${id}"`);
    }
  }
  for (const p of parts) {
    if (statusOf(p) === to) continue;
    if (to === 'published') {
      const r = have.parts?.[p.id], keys = keysOf(root, db, p);
      const stale = !r || KINDS.some(k => keys[k] && r[k]?.key !== keys[k]);
      if (stale) { out.problems.push(`${p.id}: its checks are missing or out of date — npm run content -- check ${p.id}`); continue; }
      if (r.ok === false) { out.problems.push(`${p.id}: its checks fail — ${KINDS.flatMap(k => r[k]?.problems ?? []).slice(0, 2).join('; ')}`); continue; }
    }
    editJson(path.join(root, files[p.id]), def => { if (to === 'published') delete def.status; else def.status = to; });
    out.changed.push(p.id);
  }
  for (const c of cars) {
    if (statusOf(c) === to) continue;
    const classes = have.classes?.[c.id];
    if (to === 'published' && classes && !classes.ok) { out.problems.push(`${c.id}: it breaks the class limits — ${classes.problems.join('; ')}`); continue; }
    editJson(path.join(root, `data/cars/${c.id}/car.json`), def => { if (to === 'published') delete def.status; else def.status = to; });
    out.changed.push(c.id);
  }
  return out;
}

export async function report({ root = ROOT } = {}) {
  const { db } = await loadProject(root), have = fs.existsSync(path.join(root, RESULTS)) ? readJson(RESULTS, root) : { parts: {}, classes: {} };
  const lines = [], money = n => `$${Math.round(n).toLocaleString('en-GB')}`;
  const groups = new Map();
  for (const p of Object.values(db.parts)) {
    if (p.retired) continue;
    const k = p.generated?.family ? `family ${p.generated.family}` : p.generated?.engine ? `engine ${p.generated.engine}` : null;
    if (k) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  }
  lines.push('Made from definitions (data/families, data/engines):');
  for (const [k, list] of [...groups].sort()) {
    const count = f => { const o = {}; for (const p of list) { const v = f(p); o[v] = (o[v] ?? 0) + 1; } return Object.entries(o).map(([a, n]) => `${n} ${a}`).join(', '); };
    const prices = list.map(p => p.price), failing = list.filter(p => have.parts[p.id]?.ok === false).length, unchecked = list.filter(p => !have.parts[p.id]).length;
    lines.push(`  ${k}: ${list.length} part${list.length > 1 ? 's' : ''} — ${count(p => p.tier)}; ${money(Math.min(...prices))}–${money(Math.max(...prices))}; ${count(statusOf)}${failing ? `; ${failing} failing` : ''}${unchecked ? `; ${unchecked} not checked yet` : ''}`);
  }
  const all = Object.values(db.parts).filter(p => !p.retired);
  const by = s => all.filter(p => statusOf(p) === s).length;
  lines.push(`\nEvery part: ${all.length} — ${by('published')} published, ${by('review')} in review, ${by('draft')} drafts; ${all.filter(p => have.parts[p.id]?.ok === false).length} failing their checks.`);
  lines.push('\nCars (class limits: stock → fully upgraded):');
  for (const c of Object.values(db.cars)) {
    const x = have.classes?.[c.id];
    lines.push(`  ${c.id} (${c.name}, ${statusOf(c)}): ${x ? `${x.stock?.class ?? '?'} → ${x.max?.class ?? '?'}${x.ok ? '' : ` ✘ ${x.problems.join('; ')}`}` : 'not checked yet'}`);
  }
  const targets = fs.existsSync(path.join(root, 'data/content/targets.json')) ? readJson('data/content/targets.json', root) : null;
  if (targets?.runs?.length) {
    lines.push('\nTargets (data/content/targets.json):');
    for (const r of targets.runs.slice(-4)) lines.push(`  ${r.date} ${r.what}: ${r.result}`);
  }
  return lines.join('\n');
}
