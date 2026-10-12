// The content manager (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): parts and cars listed with their status and checks;
// a draft isn't sold until it's published, and publishing needs its checks passed; an edit is a new version, checked
// there and then (a price outside its tier's band, a stat outside its allowed range: refused in words) and by the live
// checks in their worker, and the version players have stays until the new one is published; every change in the
// history; the game told what's published (/player/config); CSV out and back in.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testApp, Player, signUp, makeStaff } from './helpers.ts';
import { REPO_DIR } from '../src/config.ts';

let T: Awaited<ReturnType<typeof testApp>>, ann: Player, admin: Player;
const checks = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/content/checks.json'), 'utf8'));
const part = (id: string) => { for (const dir of fs.readdirSync(path.join(REPO_DIR, 'data/parts'))) { const f = path.join(REPO_DIR, 'data/parts', dir, `${id}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } return null; };
// (a draft family part whose content checks pass, and one of the same family with a different price to edit)
const draft = Object.keys(checks.parts).find(id => checks.parts[id].ok && part(id)?.status === 'draft' && part(id)?.generated?.family && part(id)?.tier !== 'race');
const act = (p: Player, action: string, args: object) => p.post(`/api/v1/player/actions/${action}`, { args });
const waitChecked = async (id: string) => { for (let i = 0; i < 600; i++) { const r = (await admin.get(`/api/v1/admin/content/items/part/${id}`)).body; if (r.liveChecks && r.liveChecks.version === r.version) return r; await new Promise(res => setTimeout(res, 100)); } throw new Error('live checks never finished'); };

before(async () => {
  T = await testApp('catalogue');
  [ann, admin] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.9.0.1' }),
    signUp(T.app, T.outbox, { email: 'adm@example.com', name: 'Ada Boss', ip: '10.9.0.4' }),
  ]);
  await makeStaff(T.app, admin, 'adm@example.com', 'admin');
  await ann.get('/api/v1/player');
  const id = ((await T.app.deps.db.execute((await import('drizzle-orm')).sql`select id from users where email = 'ann@example.com'`)).rows[0] as any).id;
  assert.equal((await admin.post(`/api/v1/admin/players/${id}/money`, { amount: 200_000, reason: 'Test: money to shop with' })).status, 200);
});
after(async () => { await T?.close(); });

test('there is a draft family part with passing checks to work with', () => assert.ok(draft, 'npm run content -- build && npm run content -- check'));

test('only admins see the content manager', async () => {
  assert.equal((await ann.get('/api/v1/admin/content/items')).status, 403);
  const r = await admin.get('/api/v1/admin/content/items?kind=part&limit=5');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.total > 400 && r.body.items.length === 5, `${r.body.total} parts`);
  assert.ok(r.body.facets.status.draft > 50 && r.body.facets.status.published > 300, JSON.stringify(r.body.facets.status));
  const fam = await admin.get(`/api/v1/admin/content/items?family=${part(draft!).generated.family}&limit=500`);
  assert.ok(fam.body.items.every((x: any) => x.family === part(draft!).generated.family) && fam.body.items.length >= 6);
  const one = await admin.get(`/api/v1/admin/content/items/part/${draft}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.status, 'draft'); assert.equal(one.body.live, false); assert.ok(one.body.checks?.ok);
  assert.ok(one.body.cars.length >= 1 && one.body.cars.every((c: any) => c.model && c.socket), 'the cars it fits, for the preview');
  assert.ok(one.body.stats.length >= 1 && one.body.stats.every((s: any) => s.range?.length === 2), 'its editable stats, with their ranges');
});

test('a draft isn\'t sold; published (its checks pass), it is — and the game is told', async () => {
  const before = await act(ann, 'buyPart', { partId: draft! });
  assert.notEqual(before.status, 200, 'a draft can\'t be bought');
  assert.match(before.text, /isn't out yet/);
  const r = await admin.post('/api/v1/admin/content/status', { items: [{ kind: 'part', id: draft }], status: 'published', reason: 'Test: out it goes' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.refused, []);
  const cfg = (await ann.get('/api/v1/player/config')).body;
  assert.equal(cfg.content.parts[draft!].status, 'published');
  const bought = await act(ann, 'buyPart', { partId: draft! });
  assert.equal(bought.status, 200, bought.text);
});

test('an edit is checked there and then: a price outside its tier\'s band, a stat out of range — refused in words', async () => {
  const p = part(draft!);
  const bad = await admin.post('/api/v1/admin/content/edit', { ids: [draft], changes: { price: 1 }, reason: 'Test: too cheap' });
  assert.equal(bad.status, 400); assert.match(bad.body.message ?? bad.text, /outside the .* price band/);
  const stat = (await admin.get(`/api/v1/admin/content/items/part/${draft}`)).body.stats[0];
  const out = await admin.post('/api/v1/admin/content/edit', { ids: [draft], changes: { stats: { [stat.key]: stat.range[1] * 10 + 1 } }, reason: 'Test: out of range' });
  assert.equal(out.status, 400); assert.match(out.text, /outside what's allowed/);
  assert.equal(p.status, 'draft');
});

test('an edit is a new draft version; players keep the published one until it\'s published, with its live checks passed', async () => {
  const one = (await admin.get(`/api/v1/admin/content/items/part/${draft}`)).body;
  const price = one.price + 10;
  const r = await admin.post('/api/v1/admin/content/edit', { ids: [draft], changes: { price }, reason: 'Test: a little dearer' });
  assert.equal(r.status, 200, r.text);
  let now = (await admin.get(`/api/v1/admin/content/items/part/${draft}`)).body;
  assert.equal(now.status, 'draft'); assert.equal(now.live, true, 'the published version is still what players have'); assert.equal(now.price, price);
  const cfg = (await ann.get('/api/v1/player/config')).body;
  assert.equal(cfg.content.parts[draft!].status, 'published');
  assert.notEqual(cfg.content.parts[draft!].set?.price, price, 'not the new price yet');
  now = await waitChecked(draft!);
  assert.ok(now.liveChecks.ok, JSON.stringify(now.liveChecks.problems));
  const pub = await admin.post('/api/v1/admin/content/status', { items: [{ kind: 'part', id: draft }], status: 'published', reason: 'Test: the new price' });
  assert.deepEqual(pub.body.refused, []);
  assert.equal((await ann.get('/api/v1/player/config')).body.content.parts[draft!].set.price, price);
  assert.equal((await T.app.economyConfig.gameDb()).db.parts[draft!].price, price, 'the server prices from the published version');
  const h = (await admin.get(`/api/v1/admin/content/items/part/${draft}`)).body.history;
  assert.deepEqual(h.map((x: any) => x.action).slice(0, 3), ['publish', 'edit', 'publish']);
  assert.ok(h.every((x: any) => x.actor === 'Ada Boss' && x.reason));
});

test('publishing needs passing checks: a part whose checks fail stays as it is, with why', async () => {
  const failing = Object.keys(checks.parts).find(id => checks.parts[id].ok === false && part(id) && !part(id).retired);
  if (!failing) return;                       // (nothing failing just now: nothing to refuse)
  const r = await admin.post('/api/v1/admin/content/status', { items: [{ kind: 'part', id: failing }], status: 'published', reason: 'Test: try anyway' });
  assert.equal(r.body.refused.length, 1); assert.ok(r.body.refused[0].why.length > 5);
});

test('CSV out and back in: a changed price comes in as an edit', async () => {
  const csv = (await admin.get(`/api/v1/admin/content/export.csv?family=${part(draft!).generated.family}`)).text;
  // (a spreadsheet's cells: quoted where they hold a comma)
  const cellsOf = (l: string) => [...l.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map(m => m[1]).slice(0, -1);
  const lines = csv.trim().split('\n'), head = cellsOf(lines[0]), row = lines.find(l => cellsOf(l)[1] === draft)!;
  assert.ok(head.includes('price') && head.includes('stats') && row, csv.slice(0, 300));
  const cells = cellsOf(row), pi = head.indexOf('price'), now = Number(cells[pi]);
  cells[pi] = String(now + 10);
  const sheet = [lines[0], cells.join(',')].join('\n');
  const dry = await admin.post('/api/v1/admin/content/import', { csv: sheet, reason: 'Test: a price from a sheet', dryRun: true });
  assert.equal(dry.status, 200, dry.text); assert.equal(dry.body.edits, 1, JSON.stringify(dry.body)); assert.equal(dry.body.applied, false);
  const real = await admin.post('/api/v1/admin/content/import', { csv: sheet, reason: 'Test: a price from a sheet' });
  assert.equal(real.body.applied, true);
  assert.equal((await admin.get(`/api/v1/admin/content/items/part/${draft}`)).body.price, now + 10);
});
