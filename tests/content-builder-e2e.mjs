// The family builder end to end, in this copy of the game (docs/CONTENT_PIPELINE.md "A family from the admin page"):
// a new family made as a job — the admin page's own path (tools/content/jobs.mjs) — its file the same as one written by
// hand, its parts what the summary said they'd be (tiers, prices, unlock levels, stats), npm run content -- verify and
// the pre-commit hook passing with it; then changed (a value added, one taken away, a shape setting varied): the parts
// it still makes keep their ids, what it no longer makes is retired, verify passes again. Everything is put back at the
// end, as it was.
//
//   node tests/content-builder-e2e.mjs        (npm run test:content-builder; takes about ten minutes: the checks run twice)

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { ROOT } from '../tools/content/rules.mjs';
import { builderContext, familyChanges, familyText, normaliseFamily, summarise } from '../tools/content/builder.mjs';
import { createJobs, snapshot, touchesOf } from '../tools/content/jobs.mjs';
import { verify } from '../tools/content/checks.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const status = () => execSync('git status --short --untracked-files=all -- data assets', { cwd: ROOT }).toString();
const partFile = id => { for (const d of fs.readdirSync(path.join(ROOT, 'data/parts'))) { const f = path.join(ROOT, 'data/parts', d, `${id}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } return null; };
async function job(spec) {
  let done;
  const ended = new Promise(r => { done = r; }), jobs = createJobs({ onFinish: j => done(j) });
  jobs.start({ ...spec, by: { id: null, name: 'the end-to-end check' }, reason: 'tests/content-builder-e2e.mjs' });
  const j = await ended;
  await jobs.close();
  return j;
}

const before = status();
let ctx = await builderContext();
const input = { kind: 'exhaust', name: 'Hushbar', settings: { diameter: { from: 63, to: 76, step: 13 }, material: ['steel', 'stainless'], tips: 'quad' }, shape: { cut: 'slash', length: 0.2 }, finishes: ['polished', 'matte'] };
const { def } = normaliseFamily(input, ctx);
const keep = snapshot(ROOT, touchesOf({ type: 'family', target: def.id, payload: { def } }), path.join(ROOT, 'data/.backup/e2e'));
try {
  const predicted = await summarise(def, ctx);
  check('the summary: what it will make, nothing stopping it', !predicted.problems.length && predicted.count === 8, `${predicted.count} parts ${predicted.problems.join('; ')}`);
  const j = await job({ type: 'family', target: def.id, title: `New family: ${def.name}`, payload: { def, text: familyText(def) } });
  check('made as a job: written, built and checked', j.state === 'done', j.error ?? j.result?.words);
  const text = fs.readFileSync(path.join(ROOT, `data/families/${def.id}.json`), 'utf8');
  const byHand = `{
  "_note": "A part family (docs/CONTENT_PIPELINE.md): npm run content -- build makes a part for every combination of the settings listed here and every finish, its stats from data/content/formulas.json (families.<kind>), its tier, price and unlock level from what it does. Change this file, not the parts it makes.",
  "id": "hushbar",
  "kind": "exhaust",
  "name": "Hushbar",
  "settings": { "diameter": [63, 76], "material": ["steel", "stainless"], "tips": "quad" },
  "finishes": ["polished", "matte"],
  "shape": { "cut": "slash", "length": 0.2 },
  "status": "draft"
}
`;
  check('its file is the one a person writes', text === byHand, text === byHand ? '' : text);
  const wrong = predicted.parts.filter(p => { const f = partFile(p.id); return !f || f.tier !== p.tier || f.price !== p.price || (f.unlock?.level ?? 1) !== p.unlock || JSON.stringify(f.generated.stats) !== JSON.stringify(Object.fromEntries(Object.entries(p.stats).map(([k, x]) => [k, x.value]))) || f.status !== 'draft'; });
  check('its parts are what the summary said: tiers, prices, unlock levels, stats — drafts', !wrong.length, wrong.map(p => p.id).join(', '));
  const v = await verify();
  check('npm run content -- verify passes with it', !v.problems.length, v.problems.slice(0, 3).join(' | '));
  const hook = spawnSync('sh', ['.githooks/pre-commit'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  check('the pre-commit hook passes with it (what a commit runs)', hook.status === 0, hook.status ? (hook.stdout + hook.stderr).slice(-1200) : '');

  // changed: a diameter added, steel dropped, the tip's length varied
  ctx = await builderContext();
  const { def: changed } = normaliseFamily({ ...ctx.families[def.id], settings: { ...ctx.families[def.id].settings, diameter: [63, 76, 89], material: 'stainless' }, shape: { cut: 'slash', length: [0.2, 0.25] } }, ctx, { editing: def.id });
  const c = await familyChanges(changed, ctx), oldIds = Object.values(ctx.db.parts).filter(p => p.generated?.family === def.id).map(p => p.id);
  const j2 = await job({ type: 'family', target: def.id, title: `Change family: ${def.name}`, payload: { def: changed, text: familyText(changed) } });
  check('changed as a job', j2.state === 'done', j2.error ?? j2.result?.words);
  const kept = oldIds.filter(id => partFile(id) && !partFile(id).retired), retired = oldIds.filter(id => partFile(id)?.retired);
  check('the parts it still makes keep their ids', kept.length === 4 && kept.every(id => /_stainless_/.test(id)) && c.same.concat(c.changed).map(x => x.id).sort().join() === kept.sort().join(), kept.join(', '));
  check('what it no longer makes is retired — as the builder said — and kept for players who own them', retired.sort().join() === c.retired.map(x => x.id).sort().join() && retired.length === 4, retired.join(', '));
  check('what it adds is new', c.added.every(x => partFile(x.id) && !partFile(x.id).retired) && c.added.length === 8, c.added.map(x => x.id).join(', '));
  const v2 = await verify();
  check('verify passes after the change', !v2.problems.length, v2.problems.slice(0, 3).join(' | '));
} catch (err) {
  check('the end-to-end check ran through', false, err.stack ?? String(err));
} finally {
  const u = keep.restore();
  keep.drop();
  check('everything put back as it was', status() === before, `${u.restored.length} restored, ${u.removed.length} removed`);
}
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
