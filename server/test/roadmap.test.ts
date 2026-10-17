// The roadmap (docs/ROADMAP.md): the team's features and bugs, shown to everyone; a player's idea seen only by its author
// and the admins until an admin accepts it; votes, one a player; guests read but don't post or vote; the filter, the
// daily limit; the admins' list, edits, rejections with a note, deletes, each in the admins' log.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, makeStaff } from './helpers.ts';

let T: Awaited<ReturnType<typeof testApp>>, boss: Player, ann: Player, bob: Player;
before(async () => {
  T = await testApp('roadmap');
  [boss, ann, bob] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'boss@example.com', name: 'Bea Boss', ip: '10.81.0.1' }),
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.81.0.2' }),
    signUp(T.app, T.outbox, { email: 'bob@example.com', name: 'Bob Brake', ip: '10.81.0.3' }),
  ]);
  await makeStaff(T.app, boss, 'boss@example.com', 'admin');
});
after(async () => { await T?.close(); });
const board = async (p: Player) => (await p.get('/api/v1/roadmap')).body;

test('the team\'s items are shown; an idea waits for an admin, seen only by its author; accepted, everyone sees it and votes', async () => {
  const f = await boss.post('/api/v1/admin/roadmap', { kind: 'feature', title: 'Night races in the hills', body: 'Floodlit hill climbs.', status: 'working' });
  assert.equal(f.status, 200, f.text);
  await boss.post('/api/v1/admin/roadmap', { kind: 'bug', title: 'Cars stop when tiles load', status: 'done' });
  assert.equal((await ann.post('/api/v1/admin/roadmap', { kind: 'feature', title: 'Something of mine', status: 'open' })).status, 403);

  const anon = await board(new Player(T.app, '10.81.1.1'));
  assert.deepEqual(anon.items.map((i: any) => i.title).sort(), ['Cars stop when tiles load', 'Night races in the hills']);
  assert.equal(anon.signedIn, false); assert.equal(anon.items[0].author, null, 'the team\'s items by nobody');

  const idea = await ann.post('/api/v1/roadmap/ideas', { title: '  Drag   strips at the airport ', body: 'Quarter-mile runs\n\n\n\nwith a tree.' });
  assert.equal(idea.status, 200, idea.text);
  assert.equal(idea.body.title, 'Drag strips at the airport'); assert.equal(idea.body.body, 'Quarter-mile runs\n\nwith a tree.'); assert.equal(idea.body.status, 'pending');
  assert.ok(!(await board(bob)).items.some((i: any) => i.id === idea.body.id), 'not shown to others yet');
  assert.equal((await bob.post(`/api/v1/roadmap/${idea.body.id}/vote`, {})).status, 404, 'nor voted for');
  const annSees = await board(ann);
  assert.equal(annSees.mine[0].id, idea.body.id); assert.equal(annSees.canPost, true);
  assert.ok(!annSees.items.some((i: any) => i.id === idea.body.id));

  const queue = (await boss.get('/api/v1/admin/roadmap?status=pending')).body;
  assert.equal(queue.pending, 1); assert.equal(queue.items[0].author, 'Ann Apex');
  const ok = await boss.put(`/api/v1/admin/roadmap/${idea.body.id}`, { ...queue.items[0], status: 'planned', note: null });
  assert.equal(ok.status, 200, ok.text);
  const shown = (await board(bob)).items.find((i: any) => i.id === idea.body.id);
  assert.equal(shown.status, 'planned'); assert.equal(shown.author, 'Ann Apex');

  // votes: one each, taken back; none for what's done; guests can't
  for (let k = 0; k < 2; k++) assert.deepEqual((await bob.post(`/api/v1/roadmap/${idea.body.id}/vote`, {})).body, { votes: 1, voted: true });
  assert.deepEqual((await ann.post(`/api/v1/roadmap/${idea.body.id}/vote`, {})).body, { votes: 2, voted: true });
  assert.deepEqual((await bob.del(`/api/v1/roadmap/${idea.body.id}/vote`)).body, { votes: 1, voted: false });
  const done = (await board(bob)).items.find((i: any) => i.status === 'done');
  assert.equal((await bob.post(`/api/v1/roadmap/${done.id}/vote`, {})).status, 409);
  const g = new Player(T.app, '10.81.2.1');
  await g.post('/api/auth/sign-in/anonymous', {});
  assert.equal((await g.post(`/api/v1/roadmap/${idea.body.id}/vote`, {})).status, 403);
  assert.equal((await g.post('/api/v1/roadmap/ideas', { title: 'A guest\'s idea here' })).status, 403);
  assert.equal((await board(g)).canPost, false);
  assert.equal((await board(ann)).items.find((i: any) => i.id === idea.body.id).voted, true);

  const logged = (await T.app.deps.db.execute(sql`select action from audit_log where action like 'roadmap-%' order by id`)).rows.map((r: any) => r.action);
  assert.deepEqual(logged, ['roadmap-add', 'roadmap-add', 'roadmap-accept']);
});

test('an idea rejected with a note: its author sees why, nobody else sees it; the filter; three a day; deleted', async () => {
  assert.equal((await bob.post('/api/v1/roadmap/ideas', { title: 'Short' })).status, 400);
  assert.equal((await bob.post('/api/v1/roadmap/ideas', { title: 'This is a shit idea really' })).status, 400, 'the filter');
  const r = (await bob.post('/api/v1/roadmap/ideas', { title: 'Flying cars over the city' })).body;
  await bob.post('/api/v1/roadmap/ideas', { title: 'Boats on the river too' });
  const third = (await bob.post('/api/v1/roadmap/ideas', { title: 'A third idea for today' })).body;
  assert.equal((await bob.post('/api/v1/roadmap/ideas', { title: 'One idea too many today' })).status, 429);

  const rej = await boss.put(`/api/v1/admin/roadmap/${r.id}`, { kind: 'idea', title: r.title, body: '', status: 'rejected', note: 'Cars stay on the ground in this one.' });
  assert.equal(rej.status, 200, rej.text);
  const mine = (await board(bob)).mine.find((i: any) => i.id === r.id);
  assert.equal(mine.status, 'rejected'); assert.equal(mine.note, 'Cars stay on the ground in this one.');
  assert.ok(!(await board(ann)).items.some((i: any) => i.id === r.id) && !(await board(ann)).mine.length);

  assert.equal((await ann.del(`/api/v1/admin/roadmap/${third.id}`)).status, 403);
  assert.equal((await boss.del(`/api/v1/admin/roadmap/${third.id}`)).status, 200);
  assert.equal((await boss.del(`/api/v1/admin/roadmap/${third.id}`)).status, 404);
  const logged = (await T.app.deps.db.execute(sql`select action from audit_log where action in ('roadmap-reject', 'roadmap-delete')`)).rows.map((r: any) => r.action).sort();
  assert.deepEqual(logged, ['roadmap-delete', 'roadmap-reject']);
});
