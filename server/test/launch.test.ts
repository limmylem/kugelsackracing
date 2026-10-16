// Phase 8 Step 4 (routes/launch.ts): settings following a player between devices (the newer copy wins, the graphics
// stay on their device), the profile (level, stats, medals, best times, crew, photos; private when they want), photos
// (only small real JPEG or WebP, a few each), crews, the driving school (a medal's reward paid once; a result no real
// run can measure refused), the guided first steps (once; skipping pays nothing), anonymous analytics (only with
// consent, no account in them, the admins' dashboard), news and patch notes (only published ones, in their window),
// the event calendar (going or not), and all of it in a player's data export and gone with their account.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, makeStaff } from './helpers.ts';
import { medalFor } from '../src/routes/launch.ts';

let T: Awaited<ReturnType<typeof testApp>>, ann: Player, ben: Player, admin: Player, annId: string;
const q = async (s: ReturnType<typeof sql>) => (await T.app.deps.db.execute(s)).rows as any[];
// a tiny real JPEG (a 1×1 white pixel)
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

before(async () => {
  T = await testApp('launch');
  [ann, ben, admin] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.9.1.1' }),
    signUp(T.app, T.outbox, { email: 'ben@example.com', name: 'Ben Brake', ip: '10.9.1.2' }),
    signUp(T.app, T.outbox, { email: 'adm@example.com', name: 'Ada Boss', ip: '10.9.1.4' }),
  ]);
  await makeStaff(T.app, admin, 'adm@example.com', 'admin');
  await ann.get('/api/v1/player'); await ben.get('/api/v1/player');
  annId = (await q(sql`select id from users where email = 'ann@example.com'`))[0].id;
});
after(async () => { await T?.close(); });

test('settings follow the player: saved, read on another device, the newer copy wins, the graphics stay on their device', async () => {
  assert.deepEqual((await ann.get('/api/v1/player/settings')).body, { data: null, changedAt: 0, updatedAt: null });
  const r = await ann.put('/api/v1/player/settings', { data: { language: 'en-AU', a11y: { textSize: 1.3 }, graphics: { preset: 'ultra' } }, changedAt: 2000 });
  assert.equal(r.body.saved, true);
  const back = (await ann.get('/api/v1/player/settings')).body;
  assert.equal(back.data.language, 'en-AU');
  assert.equal(back.data.graphics, undefined, 'the graphics aren\'t kept');
  const older = await ann.put('/api/v1/player/settings', { data: { language: 'en-US' }, changedAt: 1000 });
  assert.equal(older.body.saved, false);
  assert.equal(older.body.newer.data.language, 'en-AU', 'an older copy gets the newer one back');
  assert.equal((await ann.put('/api/v1/player/settings', { data: { language: 'en-US' }, changedAt: 3000 })).body.saved, true);
  assert.equal((await ann.put('/api/v1/player/settings', { data: { big: 'x'.repeat(60_000) }, changedAt: 4000 })).status, 413);
});

test('the driving school: a medal by the lesson\'s measure, its reward paid once, a better medal pays the difference up to its own; impossible results refused', async () => {
  const L = { better: 'lower', medals: { bronze: 6, silver: 3, gold: 1.2 }, bounds: [0, 200] };
  assert.equal(medalFor(L, 7), null); assert.equal(medalFor(L, 5), 'bronze'); assert.equal(medalFor(L, 1), 'gold'); assert.equal(medalFor(L, -1), 'invalid'); assert.equal(medalFor(L, NaN), 'invalid');
  const money = async () => Number((await q(sql`select balance from player_economy where user_id = ${annId}`))[0].balance);
  const m0 = await money();
  let r = (await ann.post('/api/v1/player/school/braking-zone', { value: 4 })).body;
  assert.equal(r.medal, 'bronze'); assert.deepEqual(r.paid, ['bronze']);
  assert.equal(await money(), m0 + 150);
  r = (await ann.post('/api/v1/player/school/braking-zone', { value: 4.5 })).body;
  assert.deepEqual(r.paid, [], 'the same medal again: nothing more');
  assert.equal(r.best, 4, 'the best stays the best');
  r = (await ann.post('/api/v1/player/school/braking-zone', { value: 1.0 })).body;
  assert.equal(r.medal, 'gold'); assert.deepEqual(r.paid, ['silver', 'gold']);
  assert.equal(await money(), m0 + 600, 'a gold has paid the gold\'s reward in all (150, then 450 more)');
  assert.equal((await ann.post('/api/v1/player/school/braking-zone', { value: 999 })).status, 400, 'not a real run');
  assert.equal((await ann.post('/api/v1/player/school/no-such', { value: 1 })).status, 404);
  const s = (await ann.get('/api/v1/player/school')).body;
  assert.equal(s.lessons.find((l: any) => l.id === 'braking-zone').medal, 'gold');
});

test('the guided first steps: done pays a small thanks once; skipped pays nothing and can still be done later', async () => {
  let r = (await ann.post('/api/v1/player/firsts/repair', { skipped: true })).body;
  assert.deepEqual(r, { step: 'repair', state: 'skipped', paid: false });
  r = (await ann.post('/api/v1/player/firsts/repair', { skipped: false })).body;
  assert.equal(r.paid, true);
  r = (await ann.post('/api/v1/player/firsts/repair', { skipped: false })).body;
  assert.equal(r.paid, false, 'once');
  assert.equal((await ann.post('/api/v1/player/firsts/nope', {})).status, 404);
  assert.equal((await ann.get('/api/v1/player/school')).body.firsts.repair, 'done');
});

test('photos: small real JPEG or WebP only, a few each; shown on a public profile, hidden on a private one', async () => {
  assert.equal((await ann.post('/api/v1/player/photos', { image: 'data:image/png;base64,iVBORw0KGgo=' })).status, 400);
  assert.equal((await ann.post('/api/v1/player/photos', { image: 'data:image/jpeg;base64,PHNjcmlwdD4=' })).status, 400, 'says JPEG, isn\'t');
  const p = await ann.post('/api/v1/player/photos', { image: JPEG, caption: 'Sunset at Glenelg', place: 'Adelaide' });
  assert.equal(p.status, 200);
  // (private until the player says: privacy by default — account/privacy.html)
  assert.equal((await ann.get('/api/v1/player/profile')).body.public, false, 'a profile starts private');
  assert.equal((await ben.get(`/api/v1/profiles/${annId}`)).status, 403);
  assert.equal((await ben.get(p.body.url)).status, 404, 'and its photos');
  await ann.put('/api/v1/player/profile', { public: true });
  const img = await ben.get(p.body.url);
  assert.equal(img.status, 200); assert.equal(img.headers['content-type'], 'image/jpeg');
  const prof = (await ben.get(`/api/v1/profiles/${annId}`)).body;
  assert.equal(prof.photos[0].caption, 'Sunset at Glenelg');
  assert.equal(prof.money, undefined, 'another player never sees your money');
  assert.ok(prof.medals.gold >= 1, 'the school\'s medals count');
  await ann.put('/api/v1/player/profile', { public: false, favouriteCars: ['starter_car'] });
  assert.equal((await ben.get(`/api/v1/profiles/${annId}`)).status, 403);
  assert.equal((await ben.get(p.body.url)).status, 404, 'a private profile\'s photos too');
  const mine = (await ann.get('/api/v1/player/profile')).body;
  assert.deepEqual(mine.favourites, ['starter_car']); assert.equal(typeof mine.money, 'number');
  await ann.put('/api/v1/player/profile', { public: true });
  for (let i = 1; i < 8; i++) assert.equal((await ann.post('/api/v1/player/photos', { image: JPEG })).status, 200);
  assert.equal((await ann.post('/api/v1/player/photos', { image: JPEG })).status, 409, 'eight at most');
  assert.equal((await ann.del(`/api/v1/player/photos/${p.body.id}`)).status, 200);
  assert.equal((await ben.del(`/api/v1/player/photos/${p.body.id}`)).status, 404);
});

test('crews: made with a tag, joined by its invite code, on the profile; the owner leaving hands it on', async () => {
  const c = await ann.post('/api/v1/crews', { name: 'Apex Hunters', tag: 'APX' });
  assert.equal(c.status, 200);
  assert.equal((await ben.post('/api/v1/crews', { name: 'Copycats', tag: 'apx' })).status, 409, 'tags are unique');
  assert.equal((await ben.post('/api/v1/crews/join', { code: 'wrong-code' })).status, 404);
  const j = await ben.post('/api/v1/crews/join', { code: c.body.inviteCode });
  assert.equal(j.body.members.length, 2);
  assert.equal((await ann.get('/api/v1/player/profile')).body.crew.tag, 'APX');
  assert.equal((await ben.get(`/api/v1/crews/${c.body.id}`)).body.inviteCode, undefined, 'only the owner sees the code');
  await ann.post('/api/v1/crews/leave', {});
  assert.equal((await ben.get(`/api/v1/crews/${c.body.id}`)).body.members[0].role, 'owner');
  await ben.post('/api/v1/crews/leave', {});
  assert.equal((await ben.get(`/api/v1/crews/${c.body.id}`)).status, 404, 'nobody left: gone');
});

test('analytics: only with consent, no account in it; the admins\' dashboard shows the tutorial, quits, retention, performance and errors', async () => {
  const anon = new Player(T.app, '10.9.1.9');
  const body = { consent: true, anon: 'browser-abc-123', session: 'sess-1', version: 'v-test', device: { tier: 'mid', browser: 'Chrome' }, events: [
    { kind: 'session_start' }, { kind: 'tutorial', name: 'throttle' }, { kind: 'tutorial', name: 'braking' }, { kind: 'quest_start', name: 'q1' },
    { kind: 'perf', props: { fps: 58, low1: 41 } }, { kind: 'error', name: 'TypeError: x is undefined', props: { fatal: false } }, { kind: 'quit', name: 'tutorial:braking' },
    { kind: 'error', name: 'WebGL context lost', props: { fatal: true } }, { kind: 'setting', name: 'accessibility', props: { text: 1.3, contrast: 'high', colours: 'standard', motion: 'reduced', cues: true } }] };
  assert.equal((await anon.post('/api/v1/analytics', { ...body, consent: false })).status, 400, 'no consent: refused');
  assert.equal((await anon.post('/api/v1/analytics', { ...body, events: [{ kind: 'nope' }] })).status, 400);
  assert.equal((await anon.post('/api/v1/analytics', body)).status, 204);
  const rows = await q(sql`select * from analytics_events`);
  assert.equal(rows.length, 9);
  assert.ok(rows.every(r => r.anon !== 'browser-abc-123' && r.anon.length === 22), 'the browser\'s id hashed again');
  assert.ok(!JSON.stringify(rows).includes('10.9.1.9'), 'no address');
  assert.equal((await ann.get('/api/v1/admin/analytics')).status, 403);
  const d = (await admin.get('/api/v1/admin/analytics?days=7')).body;
  assert.equal(d.totals.players, 1);
  assert.deepEqual(d.tutorial.map((x: any) => x.name).sort(), ['braking', 'throttle']);
  assert.equal(d.perf[0].fps, 58);
  assert.equal(d.errors[0].with_errors, 1);
  assert.equal(d.errors[0].crashed, 1, 'the graphics lost counts as a crash');
  assert.deepEqual([d.access.players, d.access.bigger_text, d.access.high_contrast, d.access.reduced_motion, d.access.colour_blind, d.access.sound_cues], [1, 1, 1, 1, 0, 1]);
  assert.equal(d.quits[0].name, 'tutorial:braking');
});

test('news, patch notes and maintenance: only published ones in their window; the calendar with who\'s going', async () => {
  assert.equal((await ann.post('/api/v1/admin/news', { kind: 'news', title: 'Nope', body: 'x' })).status, 403);
  const a = (await admin.post('/api/v1/admin/news', { kind: 'patch', title: 'Version 1.1', body: '- Faster loading', version: 'abc1234', published: true })).body;
  await admin.post('/api/v1/admin/news', { kind: 'news', title: 'A draft', body: 'Not yet', published: false });
  await admin.post('/api/v1/admin/news', { kind: 'maintenance', title: 'Later', body: 'Soon', published: true, startsAt: new Date(Date.now() + 86400e3).toISOString() });
  let n = (await ann.get('/api/v1/news')).body.items;
  assert.deepEqual(n.map((x: any) => x.title), ['Version 1.1']);
  await admin.put(`/api/v1/admin/news/${a.id}`, { ...a, published: false, startsAt: a.startsAt, endsAt: null });
  n = (await ann.get('/api/v1/news')).body.items;
  assert.equal(n.length, 0);
  const start = new Date(Date.now() + 3600e3), end = new Date(Date.now() + 7200e3);
  const e = (await admin.post('/api/v1/admin/calendar', { kind: 'tournament', title: 'Adelaide Cup', startsAt: start.toISOString(), endsAt: end.toISOString(), region: 'adelaide' })).body;
  assert.equal((await admin.post('/api/v1/admin/calendar', { kind: 'event', title: 'Backwards', startsAt: end.toISOString(), endsAt: start.toISOString() })).status, 400);
  await ann.post(`/api/v1/calendar/${e.id}/rsvp`, {});
  let cal = (await ann.get('/api/v1/calendar')).body.events.find((x: any) => x.id === e.id);
  assert.equal(cal.going, 1); assert.equal(cal.mine, true);
  await ann.del(`/api/v1/calendar/${e.id}/rsvp`);
  cal = (await ann.get('/api/v1/calendar')).body.events.find((x: any) => x.id === e.id);
  assert.equal(cal.going, 0);
  await ann.post(`/api/v1/calendar/${e.id}/rsvp`, {});
});

test('a player\'s export has all of it; deleting the account takes all of it', async () => {
  const ex = (await ann.get('/api/v1/me/export')).body;
  for (const k of ['settings', 'profile', 'drivingSchool', 'photos', 'eventsJoined']) assert.ok(k in ex, k);
  assert.ok(ex.drivingSchool.length >= 2 && ex.photos.length >= 1 && ex.eventsJoined.length === 1);
  assert.ok(!JSON.stringify(ex.photos).includes('/9j/'), 'the photos\' details, not the pictures');
  assert.equal((await ann.del('/api/v1/me', { confirm: 'DELETE', password: 'correct horse battery' })).status, 200);
  for (const t of ['player_settings', 'player_profiles', 'school_results', 'player_photos', 'crew_members', 'calendar_rsvps'])
    assert.equal((await q(sql`select count(*)::int as n from ${sql.raw(t)} where user_id = ${annId}`))[0].n, 0, t);
});
