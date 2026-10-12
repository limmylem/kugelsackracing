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

import { performance } from 'node:perf_hooks';

const [cmd, ...rest] = process.argv.slice(2);
const flag = n => rest.includes(n), opt = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
const ids = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && !['--check', '--quick', '--all'].includes(rest[i - 1])));
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
    const r = await buildContent({ only: ids.length ? ids : null, check: flag('--check'), log: flag('--verbose') ? console.log : () => {} });
    const by = {};
    for (const p of r.parts) { const k = p.generated?.family ?? `engine ${p.generated?.engine}`; (by[k] ??= []).push(p); }
    for (const [k, list] of Object.entries(by)) {
      const tiers = {}; for (const p of list) tiers[p.tier] = (tiers[p.tier] ?? 0) + 1;
      const prices = list.map(p => p.price);
      console.log(`  ${green('✔')} ${bold(k)}: ${list.length} part${list.length > 1 ? 's' : ''} (${Object.entries(tiers).map(([t, n]) => `${n} ${t}`).join(', ')}), $${Math.min(...prices).toLocaleString('en-GB')}–$${Math.max(...prices).toLocaleString('en-GB')}`);
    }
    const left = r.clashes.filter(c => c.left), cars = [...new Set(left.map(c => `${c.id.split('_')[0]} on the ${c.car}`))];
    if (cars.length) console.log(`  note: left off the cars they can't be made to fit: ${cars.join(', ')}`);
    failures(r.failed);
    if (flag('--check')) console.log(`\nChecked ${r.parts.length} parts and ${r.models} models in ${took()}: nothing written.`);
    else console.log(`\n${r.made.length} new, ${r.updated.length} changed, ${r.unchanged.length} the same, ${r.retired.length} retired; ${r.models} models — ${took()}.${r.made.length || r.updated.length ? ' Next: npm run content -- check' : ''}`);
    process.exit(r.failed.length ? 1 : 0);
  }
  case 'check': {
    const { runChecks, formatChecks } = await import('./content/checks.mjs');
    const r = await runChecks({ only: ids.length ? ids : null, quick: flag('--quick'), all: flag('--all'), log: console.log });
    console.log(formatChecks(r, { colour }));
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
    const r = setStatus(ids, opt('--to'));
    for (const p of r.problems) console.log(red(`  ✘ ${p}`));
    console.log(`${r.changed.length} part${r.changed.length === 1 ? '' : 's'} now ${opt('--to')}.`);
    process.exit(r.problems.length ? 1 : 0);
  }
  case 'report': {
    const { report } = await import('./content/workflow.mjs');
    console.log(await report());
    process.exit(0);
  }
  default:
    console.log('npm run content -- build | check | verify | new-car | status | report   (docs/CONTENT_PIPELINE.md)');
    process.exit(cmd ? 2 : 0);
}
