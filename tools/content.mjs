// The content pipeline (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): one command for cars, engines and part families.
//
//   npm run content -- build [ids…] [--check]   make every engine's and part family's parts (or just these), their
//                                               models and icons, priced by what they do; --check: write nothing
//   npm run content -- check [ids…]            the automatic checks on every part (or these) on every car it fits:
//                                               fit and clipping, a short drive, a crash, its sound, its budget —
//                                               results in data/content/checks.json (the content manager shows them)
//   npm run content -- verify                  what CI and the pre-commit hook run: every made part up to date with its
//                                               definition, and checked (with nothing failing) since it last changed
//   npm run content -- new-car <id> --type <hatchback|saloon|coupe|estate|suv|pickup|sports> [--name "…"] [--model file.glb]
//   npm run content -- status [ids…] --to <draft|review|published>   a part's workflow status in the repository
//   npm run content -- report                  every family and engine: how many parts, their tiers and prices, problems
//   npm run content -- targets [family]        the targets (data/content/targets.json): a 50+ variant family made and
//                                               checked within the hour, a new car playable — measured, and recorded
//   npm run content -- thumbnails [ids…] [--all]   each part's studio thumbnail (assets/thumbs), made again where what
//                                               it shows changed (npm run content -- check makes them too)
//   npm run content -- finish [ids…] [--dry-run]   what the importer does, done to what's in the game already: levels of
//                                               detail, big textures compressed, collision hulls for parts that come off
//
// The family builder's (the admin page's Content tab › New family; tools/content/builder.mjs — the same code):
//   npm run content -- new-family --kind <kind> --name "…" [--set key=v,v…] [--set key=from..to/step] [--shape key=v…]
//                     [--finishes a,b] [--aim-tiers sport,race] [--leave-off car] [--dry-run]
//                     (or --from <family> / --from-preset <name> to start from one; --suggest-names for names)
//                                               what it'd make (every part, its stats, tier, price, unlock level, warnings);
//                                               then its file as a draft, built and checked as a job (put back if it fails)
//   npm run content -- preview <family> [part ids…] [--out dir]   a few parts' models, icons and thumbnails (no parts)
//   npm run content -- variations <preset or family> --vary <setting,…> [--count n] [--seed n] [--make]
//                                               several new families, each the same but for those settings (invented
//                                               names, checked): what each would make; --make makes them
//   npm run content -- presets [--save <name> --from <family>]   the builder's presets (data/content/presets)
//   npm run content -- shapes <kind>           a kind's shape settings, what each may be, and its kit pieces
//   npm run content -- run-job <request.json> [--message file]   a request from the live admin page's Builder (its
//                                               content-builder workflow): checked again, then made as jobs

import { performance } from 'node:perf_hooks';

const [cmd, ...rest] = process.argv.slice(2);
const flag = n => rest.includes(n), opt = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
const BOOL = ['--check', '--quick', '--all', '--dry-run', '--no-thumbnails', '--make', '--suggest-names', '--verbose'];
const ids = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && !BOOL.includes(rest[i - 1])));
const opts = n => rest.flatMap((a, i) => a === n && rest[i + 1] != null ? [rest[i + 1]] : []);
// (a value as typed: a number, true or false, or the word)
const typed = v => /^-?\d+(\.\d+)?$/.test(v) ? +v : v === 'true' ? true : v === 'false' ? false : v;
// (key=a,b or key=from..to/step)
const pairs = list => Object.fromEntries(list.map(s => { const i = s.indexOf('='), k = s.slice(0, i), v = s.slice(i + 1), m = v.match(/^(-?[\d.]+)\.\.(-?[\d.]+)\/([\d.]+)$/); return [k, m ? { from: +m[1], to: +m[2], step: +m[3] } : v.includes(',') ? v.split(',').map(typed) : typed(v)]; }));
// A job (tools/content/jobs.mjs: the admin page's jobs), its log printed as it goes → the job as it ended
async function runJob(spec) {
  const { createJobs } = await import('./content/jobs.mjs');
  let shown = 0, ended;
  const done = new Promise(r => { ended = r; });
  const jobs = createJobs({ onChange: j => { for (const l of j.log.slice(shown)) console.log(l.kind === 'bad' ? red(`  ${l.text}`) : l.kind === 'good' ? green(`  ${l.text}`) : l.kind === 'step' ? bold(l.text) : `  ${l.text}`); shown = j.log.length; }, onFinish: j => ended(j) });
  const j = jobs.start({ ...spec, by: { id: null, name: process.env.USER ?? 'the command line' }, reason: 'npm run content' });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { console.log(red('\nStopping: putting back what it changed…')); jobs.cancel(j.id); });
  const r = await done;
  await jobs.close();
  return r;
}
function printSummary(s) {
  const made = s.parts.filter(p => p.made), prices = made.map(p => p.price);
  console.log(`${bold(`${s.count} part${s.count === 1 ? '' : 's'}`)}: ${Object.entries(s.byTier).map(([t, n]) => `${n} ${t}`).join(', ') || 'none made'}${prices.length ? `, $${Math.min(...prices).toLocaleString('en-GB')}–$${Math.max(...prices).toLocaleString('en-GB')}` : ''}`);
  for (const p of s.parts) console.log(`  ${p.made ? ' ' : red('✘')} ${p.id.padEnd(40)} ${String(p.tier ?? '—').padEnd(7)} ${p.price ? `$${p.price.toLocaleString('en-GB')}`.padEnd(8) : '—'.padEnd(8)} level ${String(p.unlock ?? '—').padEnd(3)} ${Object.values(p.stats).map(x => x.words).join(' · ')}${p.why ? red(`  ${p.why}`) : ''}`);
  for (const p of s.problems) console.log(red(`  ✘ ${p}`));
  for (const w of s.warnings) console.log(`  ! ${w}`);
  for (const x of s.suggestions ?? []) console.log(green(`  → to hit the aim: ${x.words}`));
  if (s.fits) console.log(`  goes on ${s.fits.total} of ${s.fits.cars.length} cars: ${s.fits.cars.filter(c => c.parts).map(c => c.id).join(', ')}`);
}
const colour = process.stdout.isTTY, bold = s => colour ? `\x1b[1m${s}\x1b[0m` : s, red = s => colour ? `\x1b[31m${s}\x1b[0m` : s, green = s => colour ? `\x1b[32m${s}\x1b[0m` : s;
const t0 = performance.now(), took = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;

function failures(failed) {
  if (!failed.length) return;
  console.log(red(bold(`\n${failed.length} couldn't be made:`)));
  for (const f of failed) for (const p of f.problems) console.log(red(`  ✘ ${p}`));
}

switch (cmd) {
  case 'build': {
    const { buildContent } = await import('./content/build.mjs');
    const { buildWords } = await import('./content/build.mjs');
    const r = await buildContent({ only: ids.length ? ids : null, check: flag('--check'), log: flag('--verbose') ? console.log : () => {} });
    const lines = buildWords(r, { check: flag('--check'), seconds: (performance.now() - t0) / 1000 });
    for (const [i, l] of lines.entries()) console.log(l.ok ? `  ${green('✔')} ${bold(l.text.split(':')[0])}:${l.text.slice(l.text.indexOf(':') + 1)}` : l.bad ? red(i && !l.text.startsWith('  ') ? bold(`\n${l.text}`) : l.text) : i === lines.length - 1 ? `\n${l.text}` : `  ${l.text}`);
    process.exit(r.failed.length ? 1 : 0);
  }
  case 'check': {
    const { runChecks, formatChecks } = await import('./content/checks.mjs');
    const r = await runChecks({ only: ids.length ? ids : null, quick: flag('--quick'), all: flag('--all'), log: console.log });
    console.log(formatChecks(r, { colour }));
    // (and the thumbnails of what changed: tools/content/thumbnail.mjs)
    if (!flag('--no-thumbnails')) {
      const { makeThumbnails } = await import('./content/thumbnail.mjs');
      const t = await makeThumbnails({ only: ids.length ? ids : null });
      if (t.made.length) console.log(`${t.made.length} thumbnail${t.made.length > 1 ? 's' : ''} made (assets/thumbs).`);
    }
    console.log(`\n${took()}.`);
    process.exit(r.failed.length ? 1 : 0);
  }
  case 'verify': {
    const { verify } = await import('./content/checks.mjs');
    const r = await verify();
    for (const p of r.problems) console.log(red(`  ✘ ${p}`));
    console.log(r.problems.length ? red(bold(`\n${r.problems.length} problem${r.problems.length > 1 ? 's' : ''}: run npm run content -- build, then npm run content -- check`)) : `Content up to date and checked: ${r.parts} parts from ${r.families} families and ${r.engines} engines (${took()}).`);
    process.exit(r.problems.length ? 1 : 0);
  }
  case 'new-car': {
    const { newCar } = await import('./content/newCar.mjs');
    const r = await newCar(ids[0], { type: opt('--type'), name: opt('--name'), model: opt('--model') });
    for (const n of r.notes ?? []) console.log(`  ${n}`);
    if (!r.ok) { console.log(red(`✘ ${r.message}`)); process.exit(1); }
    console.log(green(`✔ ${r.message}`));
    process.exit(0);
  }
  case 'status': {
    const { setStatus } = await import('./content/workflow.mjs');
    const r = await setStatus(ids, opt('--to'));
    for (const p of r.problems) console.log(red(`  ✘ ${p}`));
    console.log(`${r.changed.length} part${r.changed.length === 1 ? '' : 's'} now ${opt('--to')}.`);
    process.exit(r.problems.length ? 1 : 0);
  }
  case 'report': {
    const { report } = await import('./content/workflow.mjs');
    console.log(await report());
    process.exit(0);
  }
  case 'targets': {
    const { measureTargets } = await import('./content/targets.mjs');
    const r = await measureTargets({ family: ids[0] ?? null, log: console.log });
    console.log(`\n${r.ok ? green('✔ Targets met') : red('✘ Targets not met')}: ${r.words} — ${took()}.`);
    process.exit(r.ok ? 0 : 1);
  }
  case 'thumbnails': {
    const { makeThumbnails } = await import('./content/thumbnail.mjs');
    const r = await makeThumbnails({ only: ids.length ? ids : null, all: flag('--all'), log: console.log });
    console.log(`${r.made.length} made, ${r.kept} up to date, ${r.none.length} with nothing to show (no model) — ${took()}.`);
    process.exit(0);
  }
  case 'finish': {
    const { finishExisting } = await import('./content/finishAll.mjs');
    const r = await finishExisting({ only: ids.length ? ids : null, dryRun: flag('--dry-run'), log: console.log });
    console.log(`\n${r.lods.length} model${r.lods.length === 1 ? '' : 's'} given levels of detail, ${r.textures.length} with textures compressed, ${r.collision.length} part${r.collision.length === 1 ? '' : 's'} given collision hulls${flag('--dry-run') ? ' (--dry-run: nothing written)' : ''} — ${took()}.${!flag('--dry-run') && (r.lods.length || r.collision.length) ? ' Next: npm run content -- check' : ''}`);
    process.exit(0);
  }
  case 'new-family': {
    const B = await import('./content/builder.mjs'), ctx = await B.builderContext();
    let base = {};
    if (opt('--from')) { base = ctx.families[opt('--from')]; if (!base) { console.log(red(`✘ There's no family "${opt('--from')}" (${Object.keys(ctx.families).join(', ')}).`)); process.exit(2); } }
    if (opt('--from-preset')) { base = B.listPresets(ctx.root).find(p => p.name === opt('--from-preset') || p.file === B.presetFile(opt('--from-preset'))); if (!base) { console.log(red(`✘ There's no preset "${opt('--from-preset')}" (npm run content -- presets).`)); process.exit(2); } }
    const kind = opt('--kind') ?? base.kind;
    if (!kind || !ctx.formulas.families[kind]) { console.log(red(`✘ --kind is one of ${Object.keys(ctx.formulas.families).filter(k => !k.startsWith('_')).join(', ')} (or --from <family>, --from-preset <name>).`)); process.exit(2); }
    if (flag('--suggest-names')) { console.log(B.suggestFamilyNames(kind, ctx, { seed: +(opt('--seed') ?? 1) }).join('\n')); process.exit(0); }
    const input = {
      kind, name: opt('--name') ?? '', settings: { ...(base.settings ?? {}), ...pairs(opts('--set')) }, shape: { ...(base.shape ?? {}), ...pairs(opts('--shape')) },
      finishes: opt('--finishes')?.split(',') ?? base.finishes ?? [], ...(base.skip && { skip: base.skip }),
      ...((opt('--leave-off') || base.leaveOff) && { leaveOff: { ...(base.leaveOff ?? {}), ...Object.fromEntries(opts('--leave-off').map(c => [c, 'left off (npm run content -- new-family)'])) } }),
      ...((opt('--aim-tiers') || base.aim) && { aim: { ...(base.aim ?? {}), ...(opt('--aim-tiers') && { tiers: opt('--aim-tiers').split(',') }) } }),
    };
    const { def, problems } = B.normaliseFamily(input, ctx);
    if (!def || problems.length) { for (const p of problems) console.log(red(`✘ ${p}`)); process.exit(1); }
    const s = await B.summarise(def, ctx);
    printSummary(s);
    console.log(`\n${bold(`data/families/${def.id}.json`)}:\n${B.familyText(def)}`);
    if (s.problems.length) { console.log(red('Nothing made: fix the problems above.')); process.exit(1); }
    if (flag('--dry-run')) { console.log('(--dry-run: nothing written)'); process.exit(0); }
    const j = await runJob({ type: 'family', target: def.id, title: `New family: ${def.name}`, payload: { def, text: B.familyText(def) } });
    console.log(j.state === 'done' ? green(`\n✔ ${j.result.words} Publish them when they're ready (the Content tab, or npm run content -- status ${def.id} --to published).`) : red(`\n✘ ${j.error ?? j.state}: nothing it did is kept.`));
    process.exit(j.state === 'done' ? 0 : 1);
  }
  case 'preview': {
    const B = await import('./content/builder.mjs'), { previewParts, previewPicks } = await import('./content/preview.mjs'), ctx = await B.builderContext();
    const [fam, ...partIds] = ids, def = ctx.families[fam] ?? B.listPresets(ctx.root).find(p => p.name === fam);
    if (!def) { console.log(red(`✘ npm run content -- preview <family> [part ids…]: there's no family or preset "${fam ?? ''}".`)); process.exit(2); }
    const d = def.id ? def : { ...def, id: 'preset_preview', name: def.name };
    const picks = partIds.length ? partIds : previewPicks((await B.summarise(d, ctx, { editing: def.id ?? null, suggest: false })).parts, { max: ctx.config.preview.maxParts });
    const out = opt('--out') ? (await import('node:path')).resolve(opt('--out')) : (await import('node:path')).join(ctx.root, '.cache/builder', `preview_${d.id}`);
    console.log(`Previewing ${picks.join(', ')} (nothing saved as a part) into ${out}…`);
    const r = await previewParts(d, picks, { root: ctx.root, out, log: t => console.log(`  ${t}`) });
    for (const p of r.parts) console.log(`  ${p.ok ? green('✔') : red('✘')} ${p.id}: ${p.model}${p.thumb ? `, ${p.thumb}` : ''}`);
    process.exit(r.parts.every(p => p.ok) ? 0 : 1);
  }
  case 'variations': {
    const B = await import('./content/builder.mjs'), ctx = await B.builderContext(), from = ids[0];
    const src = ctx.families[from] ? { family: from } : { preset: from };
    let plan;
    try { plan = await B.variationPlan(src, (opt('--vary') ?? '').split(',').filter(Boolean), ctx, { count: +(opt('--count') ?? ctx.config.variations.max), seed: +(opt('--seed') ?? 1) }); }
    catch (err) { console.log(red(`✘ ${err.message} (npm run content -- variations <preset or family> --vary <setting,…>)`)); process.exit(2); }
    for (const v of plan) {
      console.log(`${bold(v.def?.name ?? '?')} (${v.def?.id}): ${Object.entries(v.varied).map(([k, x]) => `${k} ${x}`).join(', ')} — ${v.summary.count} parts, ${Object.entries(v.summary.byTier).map(([t, n]) => `${n} ${t}`).join(', ')}${v.summary.price ? `, $${v.summary.price[0].toLocaleString('en-GB')}–$${v.summary.price[1].toLocaleString('en-GB')}` : ''}`);
      for (const p of v.summary.problems) console.log(red(`  ✘ ${p}`));
      for (const w of v.summary.warnings.slice(0, 3)) console.log(`  ! ${w}`);
    }
    if (!flag('--make')) { console.log(`\n(nothing made: --make makes ${plan.filter(v => !v.summary.problems.length).length} of them)`); process.exit(0); }
    let bad = 0;
    for (const v of plan.filter(x => !x.summary.problems.length)) {
      const j = await runJob({ type: 'family', target: v.def.id, title: `New family: ${v.def.name}`, payload: { def: v.def, text: v.text } });
      if (j.state !== 'done') bad++;
    }
    process.exit(bad ? 1 : 0);
  }
  case 'presets': {
    const B = await import('./content/builder.mjs'), ctx = await B.builderContext();
    if (opt('--save')) {
      const def = ctx.families[opt('--from')], p = B.presetProblem(opt('--save'));
      if (!def || p) { console.log(red(`✘ ${p ?? `npm run content -- presets --save <name> --from <family>: there's no family "${opt('--from') ?? ''}"`}`)); process.exit(2); }
      const fs = await import('node:fs'), path = await import('node:path'), file = B.presetFile(opt('--save'));
      fs.mkdirSync(path.join(ctx.root, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(ctx.root, file), B.presetText(B.presetFrom(opt('--save'), def)));
      console.log(green(`✔ Wrote ${file}.`));
      process.exit(0);
    }
    const list = B.listPresets(ctx.root);
    for (const p of list) console.log(`${bold(p.name)} (${p.kind}): ${p.file} — ${Object.entries(p.settings ?? {}).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ')}${p.shape ? `; shape ${Object.entries(p.shape).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ')}` : ''}`);
    if (!list.length) console.log('No presets yet: the admin page\'s family builder › Save as preset, or npm run content -- presets --save <name> --from <family>.');
    process.exit(0);
  }
  case 'shapes': {
    const B = await import('./content/builder.mjs'), ctx = await B.builderContext(), o = ids[0] && B.kindOptions(ids[0], ctx);
    if (!o) { console.log(red(`✘ npm run content -- shapes <kind>: one of ${Object.keys(ctx.formulas.families).filter(k => !k.startsWith('_')).join(', ')}`)); process.exit(2); }
    console.log(bold(`${o.label} (${o.kind}) shape settings`) + ' — data/content/formulas.json families.' + o.kind + '.shapeSettings; in a family file\'s "shape" (a value, or a list: a part for each):');
    for (const s of o.shape) console.log(`  ${s.key.padEnd(14)} ${s.label}${s.stats ? ' (changes its stats)' : ''}: ${s.type === 'range' ? `${s.range[0]}–${s.range[1]}${s.unit ? ` ${s.unit}` : ''}${s.integer ? ', whole' : ''}, step ${s.step}` : s.type === 'table' ? s.entries.map(e => e.id).join(' | ') : s.type === 'kit' ? `kit pieces: ${s.values.join(' | ')} (assets/kits/${o.kind}/${s.attach}_<name>.glb)` : s.values.map(v => JSON.stringify(v)).join(' | ')} — default ${s.default ?? 'auto'}`);
    process.exit(0);
  }
  case 'run-job': {
    // (a request from the live admin page, made here: the content-builder workflow; tools/content/builder.mjs requestJobs)
    const fs = await import('node:fs'), path = await import('node:path'), B = await import('./content/builder.mjs');
    if (!ids[0] || !fs.existsSync(ids[0])) { console.log(red('✘ npm run content -- run-job <request.json> [--message file]')); process.exit(2); }
    const job = JSON.parse(fs.readFileSync(ids[0], 'utf8')), ctx = await B.builderContext();
    let plan;
    try { plan = await B.requestJobs(job.request, ctx); }
    catch (err) { for (const p of err.problems ?? [err.message]) console.log(red(`✘ ${p}`)); console.log(red('Nothing made: the request was refused (the same checks as the admin page).')); process.exit(1); }
    const titles = [];
    for (const w of plan.writes) { fs.mkdirSync(path.join(ctx.root, path.dirname(w.file)), { recursive: true }); fs.writeFileSync(path.join(ctx.root, w.file), w.text); console.log(green(`✔ Wrote ${w.file}.`)); titles.push(`Preset saved: ${path.basename(w.file, '.json')}`); }
    for (const f of plan.removes) { fs.rmSync(path.join(ctx.root, f)); console.log(green(`✔ Removed ${f}.`)); titles.push(`Preset deleted: ${path.basename(f, '.json')}`); }
    for (const spec of plan.specs) {
      console.log(bold(`\n${spec.title}`));
      const j = await runJob(spec);
      if (j.state !== 'done') { console.log(red(`\n✘ ${spec.title}: ${j.error ?? j.state} — nothing it did is kept.`)); for (const p of (j.problems ?? []).slice(0, 12)) console.log(red(`  ${p}`)); process.exit(1); }
      console.log(green(`✔ ${j.result.words ?? j.result.message ?? 'done'}`));
      titles.push(spec.title);
    }
    if (opt('--message')) fs.writeFileSync(opt('--message'), `Builder: ${titles.join('; ').slice(0, 120)}\n\n${titles.join('\n')}\n\nFrom the admin page's Builder tab, by ${job.by?.name ?? 'an admin'}: ${job.reason ?? ''}\n(job ${job.id ?? '?'}; .github/workflows/content-builder.yml)\n`);
    process.exit(0);
  }
  default:
    console.log('npm run content -- build | check | verify | new-car | status | report | targets | thumbnails | finish | new-family | preview | variations | presets | shapes | run-job   (docs/CONTENT_PIPELINE.md)');
    process.exit(cmd ? 2 : 0);
}
