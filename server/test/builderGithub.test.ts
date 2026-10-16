// The live Builder (config contentBuilder.mode 'github'; server/src/content/github.ts, docs/CONTENT_PIPELINE.md): what a
// family makes worked out here as on a computer, but what's made sent to GitHub's content-builder workflow — the
// request it came from, checked again there — and nothing written here; GitHub's runs read back as the Builder's jobs
// (waiting, running with its steps, done, failed at a step); cancelling cancels the run; a change's hold applied once
// it's made; without its token it says what's missing. GitHub's API is a stand-in here.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { testApp, signUp, makeStaff, Player } from './helpers.ts';
import { REPO_DIR } from '../src/config.ts';

const B = '/api/v1/admin/builder';
const files = () => execSync('git status --short --untracked-files=all -- data assets', { cwd: REPO_DIR }).toString();
const exhaust = { kind: 'exhaust', name: 'Tonebar', settings: { diameter: [60, 76], material: ['steel', 'stainless'], tips: 'quad' }, finishes: ['polished', 'matte'] };

// (GitHub's API, as the runner uses it: dispatches recorded, runs and their steps as set)
const calls: { method: string; url: string; body: any; auth: string | null }[] = [];
let runs: any[] = [];
const stepsOf = new Map<number, any[]>();
const github: typeof fetch = async (input: any, init: any = {}) => {
  const url = String(input), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, url, body, auth: init.headers?.authorization ?? null });
  const json = (status: number, b: any) => new Response(b == null ? null : JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'POST' && url.endsWith('/actions/workflows/content-builder.yml/dispatches')) return json(204, null);
  if (method === 'GET' && url.includes('/actions/workflows/content-builder.yml/runs')) return json(200, { workflow_runs: runs });
  const m = /\/actions\/runs\/(\d+)\/(jobs|cancel)$/.exec(url);
  if (m && m[2] === 'jobs') return json(200, { jobs: [{ steps: stepsOf.get(+m[1]) ?? [] }] });
  if (m && m[2] === 'cancel') { const r = runs.find(x => x.id === +m[1]); if (r) Object.assign(r, { status: 'completed', conclusion: 'cancelled' }); return json(202, null); }
  return json(404, { message: 'Not Found' });
};
const run = (id: number, jobId: string, title: string, status: string, conclusion: string | null = null) => ({ id, display_title: `builder ${jobId}: ${title}`, status, conclusion, html_url: `https://github.com/limmylem/kugelsackracing/actions/runs/${id}`, created_at: new Date().toISOString() });

let T: Awaited<ReturnType<typeof testApp>>, N: Awaited<ReturnType<typeof testApp>>, admin: Player, admin2: Player;
before(async () => {
  const live = { contentBuilder: { enabled: true, mode: 'github', repo: 'limmylem/kugelsackracing' } };
  [T, N] = await Promise.all([
    testApp('buildergh', { overrides: live, env: { CONTENT_BUILDER_TOKEN: 'github_pat_test_only' }, githubFetch: github }),
    testApp('buildergh_notoken', { overrides: live, githubFetch: github }),
  ]);
  admin = await signUp(T.app, T.outbox, { email: 'adm@example.com', name: 'Ada Builder', ip: '10.13.0.1' });
  await makeStaff(T.app, admin, 'adm@example.com', 'admin');
  admin2 = await signUp(N.app, N.outbox, { email: 'adm2@example.com', name: 'Ann Builder', ip: '10.13.0.2' });
  await makeStaff(N.app, admin2, 'adm2@example.com', 'admin');
});
after(async () => { await Promise.all([T?.close(), N?.close()]); });

test('the live Builder: worked out here; what\'s made is sent to GitHub as its request, nothing written here', async () => {
  const before = files();
  const ov = await admin.get(B);
  assert.equal(ov.status, 200, ov.text);
  assert.equal(ov.body.available, true); assert.equal(ov.body.mode, 'github'); assert.equal(ov.body.canMake, true);
  const s = await admin.post(`${B}/summary`, { family: exhaust });
  assert.equal(s.status, 200, s.text); assert.equal(s.body.count, 8);
  const r = await admin.post(`${B}/families`, { family: exhaust, reason: 'Test: a new exhaust family from the live page' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.remote, true); assert.equal(r.body.job.state, 'waiting'); assert.equal(r.body.file, 'data/families/tonebar.json');
  const d = calls.find(c => c.method === 'POST' && c.url.endsWith('/dispatches'))!;
  assert.ok(d, 'dispatched'); assert.equal(d.auth, 'Bearer github_pat_test_only'); assert.equal(d.body.ref, 'main');
  assert.equal(d.body.inputs.id, r.body.job.id); assert.equal(d.body.inputs.title, 'New family: Tonebar');
  const req = JSON.parse(Buffer.from(d.body.inputs.request, 'base64').toString());
  assert.equal(req.request.type, 'family'); assert.equal(req.request.input.id, 'tonebar'); assert.equal(req.by.name, 'Ada Builder'); assert.match(req.reason, /live page/);
  assert.equal(files(), before, 'nothing written on the live server');
  // (made with the same code, where the repository is: the request as the workflow gets it)
  const { builderContext, requestJobs } = await import('../../tools/content/builder.mjs');
  const plan: any = await requestJobs(req.request, await builderContext());
  assert.equal(plan.specs.length, 1); assert.equal(plan.specs[0].target, 'tonebar'); assert.match(plan.specs[0].payload.text, /"name": "Tonebar"/);
  const h = (await T.app.deps.db.execute(sql`select action, reason from catalogue_history where kind = 'family' and id = 'tonebar' order by seq`)).rows as any[];
  assert.deepEqual(h.map(x => x.action), ['family sent']);
  // GitHub's run: waiting, then running at a step, then done
  const id = r.body.job.id;
  runs = [run(101, id, 'New family: Tonebar', 'queued')];
  await new Promise(res => setTimeout(res, 8100));
  assert.equal((await admin.get(`${B}/jobs/${id}`)).body.state, 'waiting');
  runs[0].status = 'in_progress';
  stepsOf.set(101, [{ name: 'Set up job', status: 'completed', conclusion: 'success' }, { name: 'Made (checked again, written, built and checked as the Builder\'s jobs)', status: 'in_progress', conclusion: null }]);
  await new Promise(res => setTimeout(res, 8100));
  const j = (await admin.get(`${B}/jobs/${id}`)).body;
  assert.equal(j.state, 'running'); assert.match(j.step, /^Made/); assert.equal(j.url, 'https://github.com/limmylem/kugelsackracing/actions/runs/101');
  Object.assign(runs[0], { status: 'completed', conclusion: 'success' });
  await new Promise(res => setTimeout(res, 8100));
  const done = (await admin.get(`${B}/jobs/${id}`)).body;
  assert.equal(done.state, 'done'); assert.match(done.result.words, /committed to main.*approve it on GitHub/);
  assert.ok((await admin.get(`${B}/jobs`)).body.jobs.some((x: any) => x.id === id && x.state === 'done'));
});

test('a run that fails says which step and that nothing was committed; cancelling cancels the run', async () => {
  runs = [run(201, 'gh_fail1', 'New family: Brokenbar', 'completed', 'failure'), run(202, 'gh_going1', 'New family: Slowbar', 'in_progress')];
  stepsOf.set(201, [{ name: 'Made (checked again, written, built and checked as the Builder\'s jobs)', status: 'completed', conclusion: 'success' }, { name: 'Everything the pre-commit hook runs (data, models, content verify, physics, crash suite)', status: 'completed', conclusion: 'failure' }]);
  await new Promise(res => setTimeout(res, 8100));
  const f = (await admin.get(`${B}/jobs/gh_fail1`)).body;
  assert.equal(f.state, 'failed'); assert.match(f.error, /pre-commit hook.*nothing was committed/);
  assert.ok(f.log.some((l: any) => l.kind === 'bad' && /✘ Everything the pre-commit hook/.test(l.text)));
  const c = await admin.post(`${B}/jobs/gh_going1/cancel`, { reason: 'Test: not that one' });
  assert.equal(c.status, 200, c.text); assert.equal(c.body.state, 'cancelled');
  assert.ok(calls.some(x => x.method === 'POST' && x.url.endsWith('/actions/runs/202/cancel')));
});

test('without its token it works things out and previews, and says what Make needs', async () => {
  const ov = await admin2.get(B);
  assert.equal(ov.body.available, true); assert.equal(ov.body.canMake, false);
  assert.equal((await admin2.post(`${B}/summary`, { family: exhaust })).status, 200);
  const r = await admin2.post(`${B}/families`, { family: exhaust, reason: 'Test: no token' });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /CONTENT_BUILDER_TOKEN/);
  assert.equal((await admin2.post(`${B}/cars`, { id: 'comet_gt', type: 'coupe', model: Buffer.from('glTF0000').toString('base64'), reason: 'Test' })).status, 400);
});
