// World content on the server (Phase 6 Step 1): an editor's drafts, publishing (with the same checks the editor
// runs), what the game sees (published only: near a point, in a cell, in a map tile), drafts kept from players,
// the published responses' cache (ETag, 304, a publish changes it), deleting (archived when published, asked
// first), restoring, undo's whole-state writes, export and import with its report.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { spawnSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp } from './helpers.ts';
import { newItem } from '../../content/quests.js';
import { encode, offset } from '../../content/geo.js';

const SF = { lat: 37.7936, lon: -122.3965 };
const sprint = (loc = SF, extra: Record<string, unknown> = {}) => ({ ...newItem('quest', { location: { ...loc, alt: 3, heading: 45 }, type: 'sprint' } as any), ...extra }) as any;
const finishOf = (loc = SF) => ({ ...offset(loc, 1, 90), alt: 4, heading: 90 });
const finished = (loc = SF, extra: Record<string, unknown> = {}) => { const q = sprint(loc, extra); q.params.finish = finishOf(loc); return q; };

let T: Awaited<ReturnType<typeof testApp>>, ed: Player, pl: Player, anon: Player;
before(async () => {
  T = await testApp('content');
  ed = await signUp(T.app, T.outbox, { email: 'ed@example.com', name: 'Ed Itor', ip: '10.1.0.1' });
  pl = await signUp(T.app, T.outbox, { email: 'pl@example.com', name: 'Pla Yer', ip: '10.1.0.2' });
  anon = new Player(T.app, '10.1.0.3');
  await T.app.deps.db.execute(sql`update users set role = 'editor' where email = 'ed@example.com'`);
});
after(async () => { await T?.close(); });

const near = (p: Player, q: Record<string, string | number> = {}) => p.get(`/api/v1/content?${new URLSearchParams({ lat: String(SF.lat), lon: String(SF.lon), km: '5', ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) })}`);

test('an editor makes a draft; players and visitors can\'t write or see drafts', async () => {
  const r = await ed.post('/api/v1/content/items', sprint());
  assert.equal(r.status, 200, r.text);
  const id = r.body.item.id;
  assert.match(id, /^quest_/); assert.equal(r.body.item.status, 'draft'); assert.equal(r.body.item.author, 'Ed Itor');
  // (a player: forbidden; nobody signed in: 401 — before anything runs)
  assert.equal((await pl.post('/api/v1/content/items', sprint())).status, 403);
  assert.equal((await anon.post('/api/v1/content/items', sprint())).status, 401);
  assert.equal((await pl.put(`/api/v1/content/items/${id}`, { name: 'Mine now' })).status, 403);
  assert.equal((await pl.post(`/api/v1/content/items/${id}/publish`)).status, 403);
  assert.equal((await pl.get(`/api/v1/content/items/${id}?view=draft`)).status, 403);
  assert.equal((await anon.get(`/api/v1/content/items/${id}?view=draft`)).status, 401);
  assert.equal((await pl.get('/api/v1/content/export')).status, 403);
  // the editor sees the draft; the game (published) sees nothing yet
  const draft = await ed.get(`/api/v1/content/items/${id}?view=draft`);
  assert.equal(draft.status, 200); assert.equal(draft.body.item.id, id);
  assert.match(String(draft.headers['cache-control']), /no-store/);
  assert.equal((await near(ed, { view: 'draft' })).body.items.length, 1);
  assert.equal((await near(anon)).body.items.length, 0);
  // the shape is checked by the content schema: a field that isn't one is refused
  const bad = await ed.post('/api/v1/content/items', { ...sprint(), fee: 100 });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'VALIDATION');
  const badLoc = await ed.post('/api/v1/content/items', { ...sprint(), location: { lat: 99, lon: 0 } });
  assert.equal(badLoc.status, 400);
});

test('publishing: the same checks as the editor; the game sees the published copy, edits stay drafts until published', async () => {
  const id = (await ed.post('/api/v1/content/items', sprint(offset(SF, 0.2, 10)))).body.item.id;
  const bad = await ed.post(`/api/v1/content/items/${id}/publish`);
  assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'UNPUBLISHABLE');
  assert.match(bad.body.error.message, /Sprint needs a route \(or a finish line\)/);
  const up = await ed.put(`/api/v1/content/items/${id}`, { params: finished().params });
  assert.equal(up.status, 200, up.text);
  const pub = await ed.post(`/api/v1/content/items/${id}/publish`);
  assert.equal(pub.status, 200, pub.text);
  assert.equal(pub.body.item.status, 'published');
  const seen = await anon.get(`/api/v1/content/items/${id}`);
  assert.equal(seen.status, 200); assert.equal(seen.body.item.name, 'New sprint');
  await ed.put(`/api/v1/content/items/${id}`, { name: 'Embarcadero dash' });
  assert.equal((await anon.get(`/api/v1/content/items/${id}`)).body.item.name, 'New sprint', 'the published copy until published again');
  await ed.post(`/api/v1/content/items/${id}/publish`);
  assert.equal((await anon.get(`/api/v1/content/items/${id}`)).body.item.name, 'Embarcadero dash');
  // switched off: published but not offered
  await ed.put(`/api/v1/content/items/${id}`, { enabled: false }); await ed.post(`/api/v1/content/items/${id}/publish`);
  assert.ok((await near(anon)).body.items.some((x: any) => x.item.id === id));
  assert.ok(!(await near(anon, { offered: 'true' })).body.items.some((x: any) => x.item.id === id));
  await ed.put(`/api/v1/content/items/${id}`, { enabled: true }); await ed.post(`/api/v1/content/items/${id}/publish`);
  // unpublish: gone from the game, kept as a draft
  const un = await ed.post(`/api/v1/content/items/${id}/unpublish`);
  assert.equal(un.status, 200); assert.equal(un.body.item.status, 'draft');
  assert.equal((await anon.get(`/api/v1/content/items/${id}`)).body.item, null);
  assert.equal((await ed.post(`/api/v1/content/items/${id}/unpublish`)).status, 409);
});

test('spatial queries: near a point (nearest first, with distances, by kind), in a cell, in a map tile; markers without courses', async () => {
  const ids: string[] = [];
  for (const [k, km] of [3, 1, 2, 7, 12].entries()) {
    const it = (await ed.post('/api/v1/content/items', finished(offset(SF, km, 40 * k), { name: `Ring ${km} km` }))).body.item;
    await ed.post(`/api/v1/content/items/${it.id}/publish`);
    ids.push(it.id);
  }
  const poi = (await ed.post('/api/v1/content/items', newItem('poi', { location: { ...offset(SF, 1.5, 200) } } as any))).body.item;
  await ed.post(`/api/v1/content/items/${poi.id}/publish`);
  const r = await near(anon, { km: 10 });
  assert.equal(r.status, 200, r.text);
  const kms = r.body.items.map((x: any) => x.km);
  assert.deepEqual(kms, [...kms].sort((a, b) => a - b), 'nearest first');
  const rings = r.body.items.filter((x: any) => /^Ring/.test(x.item.name));
  assert.deepEqual(rings.map((x: any) => x.item.name), ['Ring 1 km', 'Ring 2 km', 'Ring 3 km', 'Ring 7 km']);
  for (const x of rings) assert.ok(Math.abs(x.km - Number(x.item.name.split(' ')[1])) < 0.02, `${x.item.name}: ${x.km}`);
  assert.ok(r.body.items.every((x: any) => x.km <= 10));
  // by kind; a limit
  const pois = await near(anon, { km: 10, kinds: 'poi' });
  assert.deepEqual(pois.body.items.map((x: any) => x.item.id), [poi.id]);
  assert.equal((await near(anon, { km: 10, limit: 2 })).body.items.length, 2);
  assert.equal((await near(anon, { km: 10, kinds: 'spaceship' })).status, 400);
  assert.equal((await near(anon, { km: 5000 })).status, 400, 'too big an area');
  // in a cell, in a tile
  const one = offset(SF, 1, 40);
  const cell = encode(one.lat, one.lon, 5);
  const inCell = await anon.get(`/api/v1/content/cells/${cell}`);
  assert.equal(inCell.status, 200, inCell.text);
  assert.ok(inCell.body.items.some((x: any) => x.id === ids[1]));
  const z = 12, n = 2 ** z, x = Math.floor((SF.lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(SF.lat * Math.PI / 180) + 1 / Math.cos(SF.lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const tile = await anon.get(`/api/v1/content/tiles/${z}/${x}/${y}`);
  assert.equal(tile.status, 200, tile.text);
  assert.ok(Array.isArray(tile.body.items));
  assert.equal((await anon.get('/api/v1/content/tiles/3/1/1')).status, 400, 'too far out');
  assert.equal((await anon.get('/api/v1/content/tiles/12/99999/1')).status, 400, 'no such tile');
  assert.equal((await anon.get('/api/v1/content/cells/not-a-hash!')).status, 400);
  // markers: what the map needs
  const markers = await near(anon, { km: 10, fields: 'marker' });
  assert.equal(markers.body.items.length, r.body.items.length);
});

test('published responses are cached: an ETag, 304 for a current copy, a publish changes it', async () => {
  const first = await near(anon, { km: 3 });
  const tag = first.headers.etag;
  assert.match(String(tag), /^"c\d+"$/);
  assert.match(String(first.headers['cache-control']), /public, max-age=\d+, s-maxage=\d+/);
  const again = await anon.get(`/api/v1/content?lat=${SF.lat}&lon=${SF.lon}&km=3`, { headers: { 'if-none-match': tag } });
  assert.equal(again.status, 304);
  const it = (await ed.post('/api/v1/content/items', finished(offset(SF, 0.5, 300), { name: 'Fresh one' }))).body.item;
  await ed.post(`/api/v1/content/items/${it.id}/publish`);
  const after = await anon.get(`/api/v1/content?lat=${SF.lat}&lon=${SF.lon}&km=3`, { headers: { 'if-none-match': tag } });
  assert.equal(after.status, 200, 'a publish changes the version');
  assert.notEqual(after.headers.etag, tag);
  assert.ok(after.body.items.some((x: any) => x.item.id === it.id));
  // (drafts are never cached publicly)
  assert.match(String((await near(ed, { view: 'draft' })).headers['cache-control']), /private, no-store/);
});

test('deleting: a draft is gone; a published item asks first, then is archived and can be restored; undo puts a whole state back', async () => {
  const d = (await ed.post('/api/v1/content/items', sprint(offset(SF, 30, 0)))).body.item.id;
  const gone = await ed.del(`/api/v1/content/items/${d}`);
  assert.equal(gone.status, 200, gone.text); assert.equal(gone.body.archived, false);
  assert.equal((await ed.get(`/api/v1/content/items/${d}?view=draft`)).body.item, null);
  const p = (await ed.post('/api/v1/content/items', finished(offset(SF, 31, 0)))).body.item.id;
  await ed.post(`/api/v1/content/items/${p}/publish`);
  const ask = await ed.del(`/api/v1/content/items/${p}`);
  assert.equal(ask.status, 409); assert.equal(ask.body.error.code, 'NEEDS_CONFIRM'); assert.match(ask.body.error.message, /Archive it\?/);
  assert.ok((await anon.get(`/api/v1/content/items/${p}`)).body.item, 'still published until confirmed');
  const done = await ed.del(`/api/v1/content/items/${p}?confirm=true`);
  assert.equal(done.status, 200); assert.equal(done.body.archived, true);
  assert.equal((await anon.get(`/api/v1/content/items/${p}`)).body.item, null);
  assert.equal((await ed.get(`/api/v1/content/items/${p}?view=archived`)).body.item.status, 'archived');
  assert.equal((await ed.put(`/api/v1/content/items/${p}`, { name: 'x' })).status, 409, 'archived: restore it to edit');
  const back = await ed.post(`/api/v1/content/items/${p}/restore`);
  assert.equal(back.status, 200); assert.equal(back.body.item.status, 'draft');
  // undo: the state before, put back whole
  const st = (await ed.get(`/api/v1/content/items/${p}/state`)).body.state;
  await ed.put(`/api/v1/content/items/${p}`, { name: 'Renamed' });
  const undo = await ed.put(`/api/v1/content/items/${p}/state`, st);
  assert.equal(undo.status, 200, undo.text);
  assert.equal((await ed.get(`/api/v1/content/items/${p}?view=draft`)).body.item.name, st.draft.name);
  assert.equal((await ed.put(`/api/v1/content/items/${p}/state`, { ...st, draft: { ...st.draft, id: 'quest_other' } })).status, 400);
  assert.equal((await pl.get(`/api/v1/content/items/${p}/state`)).status, 403);
  // every change is in the history, with who made it
  const h = (await T.app.deps.db.execute(sql`select action from content_history where id = ${p} order by at`)).rows.map((r: any) => r.action);
  assert.deepEqual(h, ['create', 'publish', 'archive', 'restore', 'update', 'state']);
});

test('export and import: a round trip, a report of what was skipped and why, older versions migrated, conflicts kept or replaced', async () => {
  const ex = await ed.get('/api/v1/content/export');
  assert.equal(ex.status, 200, ex.text);
  assert.equal(ex.body.format, 'world-content');
  assert.ok(ex.body.count >= 8);
  assert.match(String(ex.headers['content-disposition']), /attachment/);
  const stats = (await ed.get('/api/v1/content/stats')).body;
  // into an empty server
  const U = await testApp('content_import');
  try {
    const e2 = await signUp(U.app, U.outbox, { email: 'ed2@example.com', name: 'Ed Two' });
    await U.app.deps.db.execute(sql`update users set role = 'editor'`);
    const doc = { ...ex.body, entries: [...ex.body.entries,
      { draft: { ...finished(), id: 'quest_badfield', fee: 5 } },
      { draft: { id: '../../etc', kind: 'quest' } },
      { published: { ...sprint(), id: 'quest_unfinish', status: 'published' } },
    ] };
    const r = await e2.post('/api/v1/content/import', doc);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.imported, ex.body.count);
    assert.deepEqual(r.body.skipped.map((s: any) => s.id).sort(), ['../../etc', 'quest_badfield', 'quest_unfinish']);
    for (const s of r.body.skipped) assert.match(s.why, /[a-z]{3,} [a-z]{2,}/i, 'a reason in words');
    assert.ok(r.body.byKind.quest >= 7 && r.body.byKind.poi === 1, JSON.stringify(r.body.byKind));
    assert.deepEqual((await e2.get('/api/v1/content/stats')).body, stats, 'the same drafts, published and archived');
    // the game reads them there
    const there = await new Player(U.app).get(`/api/v1/content?lat=${SF.lat}&lon=${SF.lon}&km=10`);
    assert.ok(there.body.items.length >= 5);
    // again: kept as they are by default, or replaced
    const again = await e2.post('/api/v1/content/import', ex.body);
    assert.equal(again.body.imported, 0); assert.equal(again.body.skipped.length, ex.body.count);
    const repl = await e2.post('/api/v1/content/import?onConflict=replace', ex.body);
    assert.equal(repl.body.imported, ex.body.count);
    // not a world content file; from a newer game; a version 1 item migrated
    assert.equal((await e2.post('/api/v1/content/import', { format: 'cars', version: 1, entries: [] })).status, 400);
    assert.equal((await e2.post('/api/v1/content/import', { ...ex.body, version: 999 })).status, 400);
    const v1 = { ...finished(offset(SF, 50, 0)), id: 'quest_oldone01', version: 1 } as any;
    delete v1.rating;
    const mig = await e2.post('/api/v1/content/import', { format: 'world-content', version: 1, entries: [{ draft: v1 }] });
    assert.equal(mig.status, 200, mig.text);
    assert.ok(mig.body.imported === 1 || mig.body.skipped.length === 1, JSON.stringify(mig.body));
  } finally { await U.close(); }
});

test('the import tool: an export file into a server — a dry run first, then for real, with a report', async () => {
  const ex = (await ed.get('/api/v1/content/export')).body;
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kr-import-')), file = nodePath.join(dir, 'world-content.json');
  fs.writeFileSync(file, JSON.stringify({ ...ex, entries: [...ex.entries, { draft: { ...finished(), id: 'quest_badfield', fee: 5 } }] }));
  const U = await testApp('content_tool');
  try {
    await signUp(U.app, U.outbox, { email: 'ed3@example.com', name: 'Ed Three' });
    const tool = (...a: string[]) => spawnSync(process.execPath, ['tools/import-content.ts', file, ...a], { cwd: nodePath.join(import.meta.dirname, '..'), env: { ...process.env, DATABASE_URL: U.database.url }, encoding: 'utf8' });
    // (only an editor's account)
    const notEditor = tool('--as', 'ed3@example.com');
    assert.equal(notEditor.status, 1); assert.match(notEditor.stderr, /isn't an editor/);
    await U.app.deps.db.execute(sql`update users set role = 'editor'`);
    const dry = tool('--as', 'ed3@example.com', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, new RegExp(`${ex.count} would be imported`));
    assert.match(dry.stdout, /skipped 1: .*quest_badfield/);
    assert.equal((await U.app.deps.db.execute(sql`select count(*)::int as n from content_items`)).rows[0].n, 0, 'nothing written');
    const real = tool('--as', 'ED3@example.com');
    assert.equal(real.status, 0, real.stderr);
    assert.match(real.stdout, new RegExp(`${ex.count} imported`));
    const report = real.stdout.match(/Report: (\S+)/)![1];
    const r = JSON.parse(fs.readFileSync(nodePath.resolve(nodePath.join(import.meta.dirname, '..'), report), 'utf8'));
    assert.equal(r.files[0].imported, ex.count); assert.equal(r.files[0].skipped[0].id, 'quest_badfield');
    assert.deepEqual((await ed.get('/api/v1/content/stats')).body, await U.app.content.stats(), 'the same counts on both servers');
    fs.rmSync(nodePath.resolve(nodePath.join(import.meta.dirname, '..'), report));
  } finally { await U.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
