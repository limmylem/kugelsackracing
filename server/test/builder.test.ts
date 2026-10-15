// The family builder (docs/CONTENT_PIPELINE.md "A family from the admin page"; server/src/content/builder.ts): admins only;
// what a family would make, worked out before anything is made; values outside the allowed ranges, names too close to a
// real brand and unknown fields refused by the API as by the form; the live shape model; a preview made as a job
// (nothing saved as a part); a family made as a job — cancelled, everything put back as it was; changing a family says
// what changes and who owns what it retires; presets; every action in the history and the admins' log.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, makeStaff } from './helpers.ts';
import { REPO_DIR } from '../src/config.ts';

let T: Awaited<ReturnType<typeof testApp>>, admin: Player, player: Player;
const B = '/api/v1/admin/builder';
const files = () => execSync('git status --short --untracked-files=all -- data assets', { cwd: REPO_DIR }).toString();
const waitJob = async (p: Player, id: string, until = (j: any) => !['waiting', 'running'].includes(j.state), ms = 600_000) => {
  const t0 = Date.now();
  for (;;) { const j = (await p.get(`${B}/jobs/${id}`)).body; if (until(j)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${id} still ${j.state}`); await new Promise(r => setTimeout(r, 300)); }
};
const exhaust = (extra: Record<string, unknown> = {}) => ({ kind: 'exhaust', name: 'Tonebar', settings: { diameter: [60, 76], material: ['steel', 'stainless'], tips: 'quad' }, shape: { cut: 'slash', length: 0.22 }, finishes: ['polished', 'matte'], ...extra });

before(async () => {
  T = await testApp('builder');
  [admin, player] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'adm@example.com', name: 'Ada Builder', ip: '10.12.0.1' }),
    signUp(T.app, T.outbox, { email: 'pla@example.com', name: 'Pat Player', ip: '10.12.0.2' }),
  ]);
  await makeStaff(T.app, admin, 'adm@example.com', 'admin');
});
after(async () => { await T?.close(); });

test('only admins reach the builder and its API', async () => {
  for (const [m, url, body] of [['GET', B], ['POST', `${B}/summary`, { family: exhaust() }], ['POST', `${B}/families`, { family: exhaust(), reason: 'trying' }], ['GET', `${B}/jobs`], ['POST', `${B}/presets`, { name: 'x', family: exhaust(), reason: 'trying' }]] as const) {
    const r = await player.req(m, url, { body });
    assert.equal(r.status, 403, `${m} ${url}: ${r.status}`);
  }
  assert.equal((await new Player(T.app, '10.12.0.9').get(B)).status, 401);
  const r = await admin.get(B);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.available, true, r.body.why);
  assert.ok(r.body.kinds.length >= 10 && r.body.kinds.some((k: any) => k.kind === 'exhaust' && k.families.some((f: any) => f.id === 'streetline')));
});

test('what a family would make, before anything is made: every part with its stats, tier, price and unlock level', async () => {
  const r = await admin.post(`${B}/summary`, { family: exhaust({ settings: { diameter: { from: 60, to: 84, step: 8 }, material: ['steel', 'stainless'], tips: 'quad' } }) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.count, 16);
  assert.equal(r.body.parts.length, 16);
  assert.deepEqual(r.body.problems, []);
  for (const p of r.body.parts) assert.ok(p.made && ['street', 'sport', 'race'].includes(p.tier) && p.price > 0 && p.unlock >= 1 && p.stats.topEnd.words, JSON.stringify(p));
  assert.match(r.body.text, /"diameter": \[60, 68, 76, 84\]/);
  assert.ok(r.body.fits.total >= 1 && r.body.previewPicks.length >= 3);
  // a part that does the same as another family's: warned
  const same = await admin.post(`${B}/summary`, { family: exhaust({ settings: { diameter: 76, material: 'stainless', tips: 'dual' }, shape: {}, finishes: ['polished'] }) });
  assert.ok(same.body.warnings.some((w: string) => /does the same as .*Streetline/.test(w)), same.body.warnings.join(' | '));
  // an aim it misses: warned, with what to change
  const aim = await admin.post(`${B}/summary`, { family: exhaust({ aim: { tiers: ['race'] } }) });
  assert.ok(aim.body.warnings.some((w: string) => /miss the aim/.test(w)) && aim.body.suggestions.length >= 1, JSON.stringify(aim.body.suggestions));
});

test('values outside the allowed ranges, real brands and unknown fields are refused by the API', async () => {
  const out = await admin.post(`${B}/summary`, { family: exhaust({ settings: { diameter: [40, 76], material: 'steel' } }) });
  assert.equal(out.status, 200);
  assert.ok(out.body.problems.some((p: string) => /pipe diameter 40 mm is outside what's allowed \(50–110 mm\)/.test(p)), out.body.problems.join(' | '));
  const make = await admin.post(`${B}/families`, { family: exhaust({ settings: { diameter: [40, 76], material: 'steel' } }), reason: 'Test: out of range' });
  assert.equal(make.status, 400); assert.match(make.text, /outside what's allowed/);
  const shape = await admin.post(`${B}/families`, { family: exhaust({ shape: { length: 0.9 } }), reason: 'Test: a shape out of range' });
  assert.equal(shape.status, 400); assert.match(shape.text, /tip length 0.9 m is outside what's allowed/);
  const brand = await admin.post(`${B}/families`, { family: exhaust({ name: 'Akrapovik' }), reason: 'Test: a real brand' });
  assert.equal(brand.status, 400); assert.match(brand.body.error.message, /too close to "Akrapovic"/);
  const extra = await admin.post(`${B}/summary`, { family: { ...exhaust(), price: 5 } });
  assert.equal(extra.status, 400);
  const taken = await admin.post(`${B}/families`, { family: exhaust({ name: 'Streetline' }), reason: 'Test: taken' });
  assert.equal(taken.status, 400); assert.match(taken.body.error.message, /already a family "streetline"/);
  // every suggested name passes the real-brand check
  const names = await admin.post(`${B}/names`, { kind: 'wheels', seed: 7 });
  assert.ok(names.body.names.length >= 3);
  for (const n of names.body.names) assert.equal((await admin.post(`${B}/name`, { name: n })).body.problem, null, n);
  assert.match((await admin.post(`${B}/name`, { name: 'Rekaro' })).body.problem, /Recaro/);
});

test('the live shape model: a glTF of one part, with its triangles against the budget', async () => {
  const r = await admin.post(`${B}/shape`, { family: exhaust() });
  assert.equal(r.status, 200, r.text);
  const glb = Buffer.from(r.body.glb, 'base64');
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.ok(r.body.triangles > 50 && r.body.triangles <= r.body.budget * 2, `${r.body.triangles} of ${r.body.budget}`);
});

test('a preview: a few parts\' models, icons and thumbnails, nothing saved as a part — and one on a car', async () => {
  const before = files();
  const r = await admin.post(`${B}/preview`, { family: exhaust(), reason: 'Test: preview' });
  assert.equal(r.status, 200, r.text);
  const j = await waitJob(admin, r.body.job.id);
  assert.equal(j.state, 'done', `${j.error} ${j.log.map((l: any) => l.text).join('\n')}`);
  assert.ok(j.result.parts.length >= 2 && j.result.parts.every((p: any) => p.ok && p.model && p.icon), JSON.stringify(j.result.parts.map((p: any) => p.findings)));
  const p = j.result.parts[0];
  const model = await admin.get(`${B}/files/${j.id}/${path.basename(p.model)}`);
  assert.equal(model.status, 200); assert.equal(model.headers['content-type'], 'model/gltf-binary');
  assert.equal((await admin.get(`${B}/files/${j.id}/..%2F..%2Fpackage.json`)).status, 404);
  const car = p.cars[0], on = await admin.get(`${B}/preview/${j.id}/${p.id}/${car}`);
  assert.equal(on.status, 200, on.text);
  assert.ok(on.body.parts[p.id] && on.body.parts[p.id].model.startsWith(`/api/v1${B.slice(7)}/files/${j.id}/`), JSON.stringify(on.body.parts[p.id]?.model));
  assert.equal(files(), before, 'a preview writes no part, no model in assets');
});

test('a family made as a job — cancelled: everything put back as it was; in the history and the admins\' log', async () => {
  const before = files();
  const r = await admin.post(`${B}/families`, { family: exhaust(), reason: 'Test: make and cancel' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.file, 'data/families/tonebar.json');
  assert.match(r.body.text, /"status": "draft"/);
  // one job per family at a time
  const again = await admin.post(`${B}/families`, { family: exhaust(), reason: 'Test: twice' });
  assert.equal(again.status, 409); assert.match(again.text, /one at a time/);
  await waitJob(admin, r.body.job.id, j => j.step === 'check' || !['waiting', 'running'].includes(j.state));
  const c = await admin.post(`${B}/jobs/${r.body.job.id}/cancel`, { reason: 'Test: changed my mind' });
  assert.equal(c.status, 200);
  const j = await waitJob(admin, r.body.job.id);
  assert.equal(j.state, 'cancelled', j.error);
  assert.ok(j.undone && j.undone.removed.some((f: string) => f === 'data/families/tonebar.json'), JSON.stringify(j.undone));
  assert.equal(files(), before, 'files as they were');
  assert.ok(!fs.existsSync(path.join(REPO_DIR, 'data/families/tonebar.json')));
  const h = (await T.app.deps.db.execute(sql`select action, reason from catalogue_history where kind = 'family' and id = 'tonebar' order by seq`)).rows as any[];
  assert.deepEqual(h.map(x => x.action), ['family started', 'family cancel', 'family cancelled']);
  const a = (await T.app.deps.db.execute(sql`select action, reason from audit_log where action like 'content-builder-%' order by id`)).rows as any[];
  assert.ok(a.some(x => x.action === 'content-builder-family-started' && x.reason === 'Test: make and cancel') && a.some(x => x.reason === 'Test: changed my mind'), JSON.stringify(a));
});

test('changing a family: what will change — added, changed, retired and who owns those — ids kept', async () => {
  const pid = (await T.app.deps.db.execute(sql`select id from users where email = 'pla@example.com'`)).rows[0] as any;
  await T.app.deps.db.execute(sql`insert into owned_parts (user_id, instance_id, part_id, condition) values (${pid.id}, 'p_test_1', 'streetline_57_stainless_polished', 100)`);
  const def = (await admin.get(`${B}/families/streetline`)).body.def;
  const r = await admin.post(`${B}/summary`, { family: { ...def, settings: { ...def.settings, diameter: [63, 70, 76, 89, 102] } }, editing: 'streetline' });
  assert.equal(r.status, 200, r.text);
  const ch = r.body.changes;
  assert.deepEqual(ch.retired.map((x: any) => x.id).sort(), ['streetline_57_stainless_carbon', 'streetline_57_stainless_matte', 'streetline_57_stainless_polished', 'streetline_57_titanium_carbon', 'streetline_57_titanium_matte', 'streetline_57_titanium_polished']);
  assert.equal(ch.retired.find((x: any) => x.id === 'streetline_57_stainless_polished').players, 1);
  assert.equal(ch.added.length, 6); assert.ok(ch.added.every((x: any) => x.id.startsWith('streetline_102_')));
  assert.ok(ch.same.some((x: any) => x.id === 'streetline_63_stainless_polished'), 'a part it still makes keeps its id');
  // unchanged: refused (nothing to save)
  const same = await admin.put(`${B}/families/streetline`, { family: def, reason: 'Test: nothing' });
  assert.equal(same.status, 400); assert.match(same.text, /Nothing changed/);
});

test('presets: saved as data/content/presets/<name>.json, listed, deleted — each in the history', async () => {
  const r = await admin.post(`${B}/presets`, { name: 'Test quad slash', family: exhaust(), reason: 'Test: a preset' });
  assert.equal(r.status, 200, r.text);
  const file = path.join(REPO_DIR, r.body.file);
  try {
    assert.equal(r.body.file, 'data/content/presets/test_quad_slash.json');
    assert.ok(fs.existsSync(file));
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(p.kind, 'exhaust'); assert.deepEqual(p.shape, { cut: 'slash', length: 0.22 });
    assert.ok((await admin.get(`${B}/presets`)).body.presets.some((x: any) => x.name === 'Test quad slash'));
    const v = await admin.post(`${B}/variations/plan`, { from: { preset: 'Test quad slash' }, vary: ['material'], count: 3 });
    assert.equal(v.status, 200, v.text);
    assert.ok(v.body.variations.length >= 1 && v.body.variations.every((x: any) => x.def.name && x.summary.count > 0));
    assert.equal((await admin.del(`${B}/presets/Test%20quad%20slash`, { reason: 'Test: tidy up' })).status, 200);
    assert.ok(!fs.existsSync(file));
  } finally { fs.rmSync(file, { force: true }); }
  const h = (await T.app.deps.db.execute(sql`select action from catalogue_history where kind = 'preset' order by seq`)).rows as any[];
  assert.deepEqual(h.map(x => x.action), ['preset saved', 'preset deleted']);
});
