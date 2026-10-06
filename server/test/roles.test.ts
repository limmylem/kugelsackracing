// Roles (Phase 6 Step 1): player, editor, admin — kept on the server. Every editor and admin endpoint (the
// list the app collects as routes are made, so a new one can't be missed) refuses visitors, guests and
// players before anything runs, and the admin ones refuse editors; Better Auth's own admin endpoints are
// closed to browsers however the path is written. The server's owner (ADMIN_EMAIL) becomes an admin once
// their email is verified. The admin API: find a player, see their account, change their role (never
// leaving no admin), suspend for some days, ban, lift it, sign them out everywhere — each in the log.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, linkIn, path } from './helpers.ts';

let T: Awaited<ReturnType<typeof testApp>>, boss: Player, ed: Player, pl: Player, guest: Player, anon: Player;
const idOf = async (email: string) => ((await T.app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any).id as string;
before(async () => {
  T = await testApp('roles', { env: { ADMIN_EMAIL: 'Boss@Example.com' } });
  // (the owner's email before it's verified: still a player)
  const b = new Player(T.app, '10.2.0.1');
  await b.post('/api/auth/sign-up/email', { email: 'boss@example.com', password: 'correct horse battery', name: 'The Boss', acceptTerms: T.config.termsVersion, birthDate: '1990-01-01' });
  assert.equal(((await T.app.deps.db.execute(sql`select role from users where email = 'boss@example.com'`)).rows[0] as any).role, 'player');
  const mail = T.outbox.find(m => m.to === 'boss@example.com' && m.kind === 'verify-email')!;
  assert.ok((await b.get(path(linkIn(mail)))).status < 400);
  boss = b;
  ed = await signUp(T.app, T.outbox, { email: 'ed@example.com', name: 'Ed Itor', ip: '10.2.0.2' });
  pl = await signUp(T.app, T.outbox, { email: 'pl@example.com', name: 'Pla Yer', ip: '10.2.0.3' });
  guest = new Player(T.app, '10.2.0.4');
  assert.equal((await guest.post('/api/auth/sign-in/anonymous')).status, 200);
  anon = new Player(T.app, '10.2.0.5');
  await T.app.deps.db.execute(sql`update users set role = 'editor' where email = 'ed@example.com'`);
});
after(async () => { await T?.close(); });

test('the owner (ADMIN_EMAIL) is an admin once their email is verified, and it\'s logged', async () => {
  const me = await boss.get('/api/v1/me');
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.user.role, 'admin');
  const log = (await T.app.deps.db.execute(sql`select * from audit_log where action = 'owner-admin' and target_id = ${me.body.user.id}`)).rows as any[];
  assert.equal(log.length, 1); assert.equal(log[0].actor_id, null); assert.match(log[0].reason, /ADMIN_EMAIL/);
  assert.equal((await pl.get('/api/v1/me')).body.user.role, 'player');
});

// a path for a route: its parameters filled in
const fill = (url: string) => url.replace(':id', 'quest_abc123').replace(':hash', '9q8zn').replace(':z', '12').replace(':x', '1').replace(':y', '1');
test('every editor and admin endpoint refuses visitors, guests and players (and editors, the admin ones), before anything runs', async () => {
  const guarded = T.app.routeList.filter(r => r.role && r.method !== 'HEAD' && r.method !== 'OPTIONS');
  const editorRoutes = guarded.filter(r => r.role === 'editor'), adminRoutes = guarded.filter(r => r.role === 'admin');
  assert.ok(editorRoutes.length >= 10, `editor routes: ${editorRoutes.length}`);
  assert.ok(adminRoutes.length >= 8, `admin routes: ${adminRoutes.length}`);
  for (const r of guarded) {
    const url = fill(r.url);
    // (a body that isn't even valid: the role is checked first, so it's never read)
    const opts = { raw: '{"not": json', headers: { 'content-type': 'application/json' } };
    const a = await anon.req(r.method, url, opts);
    assert.equal(a.status, 401, `${r.method} ${url} as a visitor: ${a.status} ${a.text}`);
    const g = await guest.req(r.method, url, opts);
    assert.equal(g.status, 403, `${r.method} ${url} as a guest: ${g.status} ${g.text}`);
    const p = await pl.req(r.method, url, opts);
    assert.equal(p.status, 403, `${r.method} ${url} as a player: ${p.status} ${p.text}`);
    assert.equal(p.body.error.code, 'FORBIDDEN');
    if (r.role === 'admin') {
      const e = await ed.req(r.method, url, opts);
      assert.equal(e.status, 403, `${r.method} ${url} as an editor: ${e.status}`);
    } else {
      // (an editor, or an admin, gets past the role: whatever comes next — the bad body, or no such item)
      const e = await ed.req(r.method, url, opts);
      assert.ok(![401, 403].includes(e.status), `${r.method} ${url} as an editor: ${e.status} ${e.text}`);
      const b = await boss.req(r.method, url, opts);
      assert.ok(![401, 403].includes(b.status), `${r.method} ${url} as an admin: ${b.status} ${b.text}`);
    }
  }
  // the upload limit: a player's big import is refused unread
  const big = await pl.post('/api/v1/content/import', undefined, { raw: JSON.stringify({ format: 'world-content', version: 2, entries: [], pad: 'x'.repeat(5_000_000) }), headers: { 'content-type': 'application/json' } });
  assert.equal(big.status, 403);
});

test('Better Auth\'s own admin endpoints are closed to browsers, however the path is written', async () => {
  for (const p of ['/api/auth/admin/set-role', '/api/auth/admin/list-users', '/api/auth/%61dmin/set-role', '/api/auth//admin/set-role', '/api/auth/ADMIN/set-role', '/api/auth/admin/impersonate-user']) {
    const r = await boss.post(p, { userId: 'x', role: 'admin' });
    assert.equal(r.status, 403, `${p}: ${r.status} ${r.text}`);
    const g = await boss.get(p);
    assert.equal(g.status, 403, `GET ${p}: ${g.status}`);
  }
  // (a player can't make themselves an admin through the account update either)
  await pl.post('/api/auth/update-user', { role: 'admin' });
  assert.equal((await pl.get('/api/v1/me')).body.user.role, 'player');
});

test('the admin API: find, view, change a role (logged, never no admin), suspend, ban, lift, sign out everywhere', async () => {
  const plId = await idOf('pl@example.com'), bossId = await idOf('boss@example.com');
  // find
  const found = await boss.get('/api/v1/admin/players?q=pla');
  assert.equal(found.status, 200, found.text);
  assert.deepEqual(found.body.players.map((p: any) => p.id), [plId]);
  assert.equal((await boss.get('/api/v1/admin/players?q=100%25')).status, 200, 'wildcards are matched as text');
  // view (and that's logged too)
  const v = await boss.get(`/api/v1/admin/players/${plId}`);
  assert.equal(v.status, 200, v.text);
  assert.equal(v.body.email, 'pl@example.com'); assert.equal(v.body.role, 'player'); assert.ok(v.body.sessions >= 1);
  assert.deepEqual(v.body.providers, ['credential']);
  assert.equal((await boss.get('/api/v1/admin/players/nobody')).status, 404);
  // a role: needs a reason; then the player is an editor (the server checks it on the next request)
  assert.equal((await boss.post(`/api/v1/admin/players/${plId}/role`, { role: 'editor' })).status, 400);
  assert.equal((await boss.post(`/api/v1/admin/players/${plId}/role`, { role: 'editor', reason: 'Builds the Bay Area quests' })).status, 200);
  assert.equal((await pl.get('/api/v1/me')).body.user.role, 'editor');
  assert.equal((await pl.get('/api/v1/content/stats')).status, 200, 'the editor endpoints open to them');
  await boss.post(`/api/v1/admin/players/${plId}/role`, { role: 'player', reason: 'Back to playing' });
  assert.equal((await pl.get('/api/v1/content/stats')).status, 403);
  // a guest can't have a role; the only admin can't step down
  const guestId = (await guest.get('/api/v1/me')).body.user.id;
  assert.equal((await boss.post(`/api/v1/admin/players/${guestId}/role`, { role: 'editor', reason: 'Testing it' })).status, 400);
  const alone = await boss.post(`/api/v1/admin/players/${bossId}/role`, { role: 'player', reason: 'Stepping down' });
  assert.equal(alone.status, 409); assert.match(alone.body.error.message, /only admin/);
  // suspend for 3 days: signed out, can't sign in, says why
  assert.equal((await boss.post(`/api/v1/admin/players/${bossId}/suspend`, { days: 1, reason: 'Myself' })).status, 400, 'not themselves');
  const s = await boss.post(`/api/v1/admin/players/${plId}/suspend`, { days: 3, reason: 'Abusive names' });
  assert.equal(s.status, 200, s.text);
  assert.equal((await pl.get('/api/v1/me')).status, 401, 'signed out');
  const again = await new Player(T.app, '10.2.0.9').post('/api/auth/sign-in/email', { email: 'pl@example.com', password: 'correct horse battery' });
  assert.equal(again.status, 403); assert.equal(again.body.error.code, 'BANNED'); assert.match(again.body.error.message, /suspended or banned/);
  const sv = await boss.get(`/api/v1/admin/players/${plId}`);
  assert.equal(sv.body.banned, true); assert.equal(sv.body.banReason, 'Abusive names');
  assert.ok(Math.abs(new Date(sv.body.banExpires).getTime() - Date.now() - 3 * 86400e3) < 60e3);
  // lift it; ban for good; lift that
  assert.equal((await boss.post(`/api/v1/admin/players/${plId}/unban`, { reason: 'Appeal accepted' })).status, 200);
  const back = new Player(T.app, '10.2.0.10');
  assert.equal((await back.post('/api/auth/sign-in/email', { email: 'pl@example.com', password: 'correct horse battery' })).status, 200);
  assert.equal((await boss.post(`/api/v1/admin/players/${plId}/ban`, { reason: 'Cheating on leaderboards' })).status, 200);
  assert.equal((await back.get('/api/v1/me')).status, 401);
  assert.equal((await boss.get(`/api/v1/admin/players/${plId}`)).body.banExpires, null, 'for good');
  await boss.post(`/api/v1/admin/players/${plId}/unban`, { reason: 'Second chance' });
  // sign out everywhere
  const p1 = new Player(T.app, '10.2.0.11'), p2 = new Player(T.app, '10.2.0.12');
  for (const p of [p1, p2]) assert.equal((await p.post('/api/auth/sign-in/email', { email: 'pl@example.com', password: 'correct horse battery' })).status, 200);
  assert.equal((await boss.post(`/api/v1/admin/players/${plId}/sign-out`, { reason: 'Lost their phone' })).status, 200);
  assert.equal((await p1.get('/api/v1/me')).status, 401); assert.equal((await p2.get('/api/v1/me')).status, 401);
  // the log: every action, by whom, why — newest first; for one player
  const log = await boss.get(`/api/v1/admin/audit?targetId=${plId}`);
  assert.equal(log.status, 200, log.text);
  assert.deepEqual(log.body.entries.map((e: any) => e.action).reverse(), ['view-player', 'set-role', 'set-role', 'suspend', 'view-player', 'unban', 'ban', 'view-player', 'unban', 'sign-out-everywhere']);
  for (const e of log.body.entries) assert.equal(e.actorName, 'The Boss');
  assert.deepEqual(log.body.entries.find((e: any) => e.action === 'set-role').details, { from: 'editor', to: 'player' });
  assert.equal((await ed.get('/api/v1/admin/audit')).status, 403);
});

test('a second admin: then the first can step down', async () => {
  const edId = await idOf('ed@example.com'), bossId = await idOf('boss@example.com');
  assert.equal((await boss.post(`/api/v1/admin/players/${edId}/role`, { role: 'admin', reason: 'Co-owner' })).status, 200);
  assert.equal((await ed.get('/api/v1/admin/players?q=boss')).status, 200);
  assert.equal((await boss.post(`/api/v1/admin/players/${bossId}/role`, { role: 'editor', reason: 'Stepping down' })).status, 200);
  assert.equal((await boss.get('/api/v1/admin/players?q=x')).status, 403);
  assert.equal((await boss.get('/api/v1/content/stats')).status, 200, 'still an editor');
  // (ADMIN_EMAIL made them an admin once: stepping down stays stepped down, a restart too)
  const { promoteOwner } = await import('../src/owner.ts');
  assert.equal(await promoteOwner(T.app.deps.db, T.app.deps.config), 0);
  assert.equal((await boss.get('/api/v1/me')).body.user.role, 'editor');
});
