// One content job, in a worker thread (tools/content/jobs.mjs starts it; docs/CONTENT_PIPELINE.md): the pipeline's own
// modules, called as npm run content calls them — build, check, thumbnails, verify — telling the job how it's going
// (its step, its progress, its log in the command line's words). It writes what it's for; putting things back if it
// fails is the job's (it copied them first).
//
//   family  { def, text }       data/families/<id>.json written, then build, check, thumbnails and verify for it
//   engine  { def, text }       data/engines/<id>.json the same way (its crate engine part)
//   build   { ids }             build, check, thumbnails and verify for families or engines already there
//   car     { type, name, model }   npm run content -- new-car, then its checks
//   preview { def, ids, cars, out } a few parts' models made into a folder of their own (nothing saved as a part)

import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const { root, job } = workerData;
const post = m => parentPort.postMessage(m);
const log = (text, kind = '') => post({ type: 'log', text, kind });
const step = (name, text) => post({ type: 'step', step: name, text });
const progress = p => post({ type: 'progress', ...p });
class Stop extends Error { constructor(message, problems = [], result = null) { super(message); this.problems = problems; this.result = result; } }

// build → check → thumbnails → verify, for these families or engines (what npm run content -- build / check do)
// (an engine: the cars the class check finds it would take past their class limits — a monster crate engine in a small
// car — are added to its leaveOff and it's made and checked again, so it goes only in the cars it keeps fair)
async function buildAndCheck(ids, { what, engine = null, again = 0 }) {
  const { buildContent, buildWords } = await import('./build.mjs');
  step('build', `Building ${what} (npm run content -- build ${ids.join(' ')})…`);
  let t0 = performance.now();
  const b = await buildContent({ root, only: ids, progress });
  for (const l of buildWords(b, { seconds: (performance.now() - t0) / 1000 })) log(l.text, l.bad ? 'bad' : l.ok ? 'good' : '');
  if (b.failed.length) throw new Stop(`${b.failed.length} couldn't be made: ${b.failed[0].problems[0]}`, b.failed.flatMap(f => f.problems));
  const { runChecks, formatChecks } = await import('./checks.mjs');
  const only = [...ids, ...b.parts.map(p => p.id)];
  step('check', `Checking them on every car they fit (npm run content -- check ${ids.join(' ')})…`);
  t0 = performance.now();
  const c = await runChecks({ root, only, log: t => log(t.trim()), progress });
  for (const line of formatChecks(c).split('\n')) if (line.trim()) log(line);
  if (engine && again < 2) {
    const crate = `crate_${engine}`, over = Object.entries(c.classes ?? {}).flatMap(([car, x]) => (x.blamed ?? []).filter(b => b.id === crate).map(b => [car, b.why]));
    if (over.length) {
      const file = path.join(root, `data/engines/${engine}.json`), def = JSON.parse(fs.readFileSync(file, 'utf8'));
      const { engineText } = await import('./builder.mjs');
      def.leaveOff = { ...(def.leaveOff ?? {}), ...Object.fromEntries(over.map(([car]) => [car, 'it would take it past its class limit'])) };
      fs.writeFileSync(file, engineText(def));
      log(`Too strong for ${over.map(([car]) => car).join(', ')}: it would take ${over.length === 1 ? 'it' : 'them'} past ${over.length === 1 ? 'its' : 'their'} class limit${over.length === 1 ? '' : 's'}, so it's left off ${over.length === 1 ? 'that car' : 'those cars'} (leaveOff) — made and checked again.`, 'good');
      return buildAndCheck(ids, { what, engine, again: again + 1 });
    }
  }
  // (only what this job made: anything else failing isn't its doing — the command line would say so too)
  const failed = c.failed.filter(f => only.includes(f.id));
  if (failed.length) throw new Stop(`${failed.length} that players have would fail their checks: ${failed[0].problems[0]}`, failed.flatMap(f => f.problems.map(p => `${f.id}: ${p}`)));
  step('thumbnails', 'Making their studio thumbnails…');
  const { makeThumbnails } = await import('./thumbnail.mjs');
  const t = await makeThumbnails({ root, only });
  log(`${t.made.length} thumbnail${t.made.length === 1 ? '' : 's'} made, ${t.kept} up to date.`);
  step('verify', 'Everything made and checked? (npm run content -- verify, as the pre-commit hook and CI run it)');
  const { verify } = await import('./checks.mjs');
  const v = await verify({ root }), mine = v.problems.filter(p => ids.some(id => p.includes(id)) || b.parts.some(x => p.includes(x.id)));
  for (const p of v.problems) log(`${mine.includes(p) ? '✘' : 'note (not from this job):'} ${p}`, mine.includes(p) ? 'bad' : '');
  if (mine.length) throw new Stop(`npm run content -- verify would fail: ${mine[0]}`, mine);
  const drafts = c.drafts.filter(d => only.includes(d.id));
  return {
    parts: b.parts.map(p => p.id).sort(), made: b.made, changed: b.updated, same: b.unchanged.length, retired: b.retired, models: b.models,
    checked: c.checked, failingDrafts: drafts.map(d => ({ id: d.id, problems: d.problems.slice(0, 4) })), verify: v.problems.length ? 'notes' : 'passes',
    words: `${b.made.length} new, ${b.updated.length} changed, ${b.unchanged.length} the same, ${b.retired.length} retired; ${c.checked} checked${drafts.length ? `, ${drafts.length} failing a check (drafts: fix them before review)` : ', all passing'}.`,
  };
}

async function run() {
  const P = job.payload;
  if (job.type === 'family' || job.type === 'engine') {
    const dir = job.type === 'family' ? 'data/families' : 'data/engines', file = `${dir}/${job.target}.json`;
    step('write', `Writing ${file}…`);
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, file), P.text);
    log(`Wrote ${file} (${P.text.split('\n').length - 1} lines): status ${P.def.status ?? 'draft'}.`);
    return { file, ...(await buildAndCheck([job.target], { what: `the ${P.def.name ?? job.target} ${job.type}`, engine: job.type === 'engine' ? job.target : null })) };
  }
  if (job.type === 'build') return buildAndCheck(P.ids, { what: P.ids.join(', ') });
  if (job.type === 'car') {
    step('car', `Making the car ${job.target} from the ${P.type} template (npm run content -- new-car)…`);
    const { newCar } = await import('./newCar.mjs');
    const r = await newCar(job.target, { type: P.type, name: P.name || null, model: P.model ? path.join(root, P.model) : null, root });
    for (const n of r.notes ?? []) log(n);
    if (!r.ok) throw new Stop(r.message, [r.message]);
    log(r.message, 'good');
    const { loadProject } = await import('./project.mjs');
    const { db } = await loadProject(root), own = Object.keys(db.parts).filter(id => id.endsWith(`_${job.target}`));
    step('check', 'Checking its parts and its class limits…');
    const { runChecks, formatChecks, verify } = await import('./checks.mjs');
    const c = await runChecks({ root, only: [job.target, ...own], log: t => log(t.trim()), progress });
    for (const line of formatChecks(c).split('\n')) if (line.trim()) log(line);
    step('verify', 'Everything made and checked?');
    const v = await verify({ root }), mine = v.problems.filter(p => p.includes(job.target));
    for (const p of v.problems) log(`${mine.includes(p) ? '✘' : 'note (not from this job):'} ${p}`, mine.includes(p) ? 'bad' : '');
    if (mine.length) throw new Stop(`npm run content -- verify would fail: ${mine[0]}`, mine);
    return { car: job.target, parts: own, message: r.message, notes: r.notes ?? [] };
  }
  if (job.type === 'preview') {
    const { previewParts } = await import('./preview.mjs');
    step('models', `Making ${P.ids.length} part${P.ids.length === 1 ? '' : 's'}' models (nothing is saved as a part)…`);
    return previewParts(P.def, P.ids, { root, out: path.resolve(root, P.out), cars: P.cars ?? null, log, progress });
  }
  throw new Stop(`There's no job "${job.type}".`);
}

run().then(result => post({ type: 'done', result }), err => post({ type: 'failed', error: err.message, problems: err.problems ?? [], result: err.result ?? null, stack: err instanceof Stop ? null : err.stack }));
