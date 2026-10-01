// Checks models against the model rules (data/content/model-rules.json, docs/MODELLING_GUIDE.md) and
// prints a report per file: PASS / WARN / FAIL for each check, what's wrong in plain words and how to
// fix it. Exits with code 1 if any model fails.
//
//   npm run check-models                     every model the game uses (car bodies and sources, parts)
//   npm run check-models -- incoming         every .glb in a folder, or files
//   npm run check-models -- x.glb --type spoiler     (what it is, if its file name doesn't say)
//   --quiet: only the problems and warnings

import path from 'node:path';
import { checkModel, formatReport } from './content/check.mjs';
import { inspect } from './content/inspect.mjs';
import { readModel } from './content/io.mjs';
import { glbFiles, loadProject, modelsInUse } from './content/project.mjs';
import { ROOT, rel, typeForPart, typeFromName } from './content/rules.mjs';

const args = process.argv.slice(2), flag = n => args.includes(n), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const quiet = flag('--quiet'), forced = opt('--type');
const paths = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--type');

const project = await loadProject();
if (project.ruleProblems.length) {
  for (const p of project.ruleProblems) console.log(`ERROR data/content/model-rules.json · ${p.path}: ${p.message}`);
  process.exit(1);
}
if (forced && forced !== 'car' && !project.rules.types[forced]) { console.error(`--type ${forced}: not a type (${Object.keys(project.rules.types).join(', ')}, car)`); process.exit(2); }

const inUse = modelsInUse(project);
const files = paths.length ? paths.flatMap(p => glbFiles(path.resolve(p))).map(f => rel(f)) : [...inUse.keys()].sort();
if (!files.length) { console.log(paths.length ? `No .glb files in ${paths.join(', ')}.` : 'No models to check.'); process.exit(0); }

const results = [];
for (const file of files) results.push(...await checkFile(file));
const n = v => results.filter(r => r.verdict === v).length;
console.log(`\n${results.length} check${results.length === 1 ? '' : 's'} of ${files.length} model${files.length === 1 ? '' : 's'}: ${n('pass')} pass, ${n('warn')} with warnings, ${n('fail')} fail${n('fail') ? ' — see "How to fix" above' : ''}.`);
process.exit(n('fail') ? 1 : 0);

// A model, as each thing that uses it (a part at its scale, a car); or as its file name says
async function checkFile(file) {
  const out = [], print = (result, title) => { console.log(formatReport(file, result, { colour: process.stdout.isTTY, quiet, title })); out.push(result); };
  let info;
  try { info = inspect(await readModel(path.join(ROOT, file))); }
  catch (err) {
    print({ verdict: 'fail', findings: [{ level: 'fail', check: 'loads', text: `The file can't be read: ${err.message}.`, fix: 'Export it again as glTF Binary (.glb).' }] }, '');
    return out;
  }
  const uses = inUse.get(file) ?? [];
  const jobs = [];
  if (forced) jobs.push({ type: forced, car: forced === 'car' ? carFor(file) : null, title: forced });
  else if (uses.length) {
    for (const u of uses.filter(u => u.kind === 'car')) jobs.push({ type: 'car', car: u.car, title: `${u.car.name} · ${u.role === 'body' ? 'body' : 'whole car, before splitting'}` });
    // (parts: once per scale they're drawn at)
    const byScale = new Map();
    for (const u of uses.filter(u => u.kind === 'part')) {
      const type = typeForPart(u.part, project.rules), key = `${type}|${u.scale.join(',')}`;
      if (!byScale.has(key)) byScale.set(key, { type, scale: u.scale, parts: [] });
      byScale.get(key).parts.push(u.part.id);
    }
    for (const j of byScale.values()) jobs.push({ type: j.type, scale: j.scale, title: `${j.type ?? '?'} · ${j.parts.join(', ')}` });
  } else {
    const type = typeFromName(file, project.rules);
    jobs.push({ type, car: type === 'car' ? carFor(file) : null, title: type ?? '' });
  }
  for (const j of jobs) {
    if (!j.type) { print({ verdict: 'fail', findings: [{ level: 'fail', check: 'type', text: "Can't tell what this model is from its file name.", fix: `Name it after what it is (${Object.keys(project.rules.types).slice(0, 6).join('_…, ')}_…, e.g. spoiler_ducktail.glb, or car_<id>.glb for a car), or say: --type spoiler` }] }, j.title); continue; }
    print(checkModel(info, { rules: project.rules, type: j.type, scale: j.scale ?? 1, car: j.car, db: project.db, knownSockets: project.knownSockets, file, estimateMass: !uses.length }), j.title);
  }
  return out;
}
// (a car's file: car_<id>.glb, or in data/cars/<id>/)
function carFor(file) {
  const id = path.basename(file, '.glb').replace(/^car_/, ''), dir = file.match(/data\/cars\/([^/]+)\//)?.[1];
  return project.db.cars[dir] ?? project.db.cars[id] ?? null;
}
