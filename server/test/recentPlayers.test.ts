// Phase 7 Step 5, small-group play: recent players (GET /api/v1/mp/recent-players; server/src/mp/recent.ts) — who a
// signed-in player raced with or met in a free-roam challenge, newest first, each once, with where and the friend state;
// never a blocked player (either way), a guest or an NPC; and "Add friend" from it (POST /friends { id }).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, signUp, Player } from './helpers.ts';

let T: Awaited<ReturnType<typeof testApp>>;
before(async () => { T = await testApp('recent'); });
after(async () => { await T?.close(); });
const db = () => (T.app as any).deps.db, mp = () => (T.app as any).mp;
let n = 0;
const player = (name: string) => signUp(T.app, T.outbox, { email: `${name.toLowerCase().replace(/\W/g, '')}${++n}@example.com`, name, ip: `10.81.${n}.1` });
const idOf = async (name: string) => ((await db().execute(sql`select id from users where name = ${name}`)).rows[0] as any).id as string;

// a race as the race server reports it: its players (people only — NPCs are in the results, never in mp_race_players)
async function race(id: string, minsAgo: number, venue: object, uids: string[], npcs = 0) {
  const results = [...uids.map((uid, i) => ({ uid, name: uid, place: i + 1, status: 'finished' })), ...Array.from({ length: npcs }, (_, i) => ({ uid: `npc-${id}-${i}`, name: `NPC ${i}`, npc: true, place: uids.length + i + 1, status: 'finished' }))];
  await db().execute(sql`insert into mp_races (id, kind, ranked, venue, settings, km, humans, npcs, state, provisional, created_at)
    values (${id}, 'quick', false, ${JSON.stringify(venue)}::jsonb, '{}'::jsonb, 2, ${uids.length}, ${npcs}, 'provisional', ${JSON.stringify(results)}::jsonb, now() - make_interval(mins => ${minsAgo}))`);
  for (const [i, uid] of uids.entries()) await db().execute(sql`insert into mp_race_players (race_id, user_id, provisional_place, status) values (${id}, ${uid}, ${i + 1}, 'finished')`);
}
async function challenge(id: string, minsAgo: number, uids: string[]) {
  await db().execute(sql`insert into roam_challenges (id, type, players, group_key, record, created_at) values (${id}, 'sprint', ${sql.raw(`ARRAY[${uids.map(u => `'${u}'`).join(',')}]::text[]`)}, ${id}, '{}'::jsonb, now() - make_interval(mins => ${minsAgo}))`);
  for (const uid of uids) await db().execute(sql`insert into roam_challenge_players (challenge_id, user_id, status) values (${id}, ${uid}, 'finished')`);
}

test('recent players: newest first, each once, where and the friend state; blocked either way, guests and NPCs never listed', async () => {
  const ada = await player('Ada Apex');
  const boP = await player('Bo Brake');
  for (const name of ['Cy Clutch', 'Di Diff', 'Ed Exhaust', 'Fi Flag', 'Gus Grip']) await player(name);
  const [me, bo, cy, di, ed, fi, gus] = await Promise.all(['Ada Apex', 'Bo Brake', 'Cy Clutch', 'Di Diff', 'Ed Exhaust', 'Fi Flag', 'Gus Grip'].map(idOf));
  // (a guest who raced with her)
  await db().execute(sql`insert into users (id, name, email, email_verified, is_anonymous, terms_version, terms_accepted_at) values ('guest-recent-1', 'Guest 1234', 'guest-recent-1@guest.invalid', false, true, 'x', now())`);
  await db().execute(sql`insert into track_courses (code, version, hash, course, info) values ('TESTRING', 1, 'h', '{}'::jsonb, '{"name":"Test Ring"}'::jsonb)`);
  await race('r-old', 300, { kind: 'track', code: 'TESTRING' }, [me, gus, bo], 2);
  await race('r-mid', 120, { kind: 'track', code: 'TESTRING' }, [me, cy, di, fi, 'guest-recent-1'], 3);
  await race('r-new', 30, { kind: 'route', id: 'route_nowhere' }, [me, gus]);
  await challenge('c-1', 10, [ed, me]);
  await race('r-others', 5, { kind: 'track', code: 'TESTRING' }, [bo, cy]);   // (not hers)
  // friends: Bo accepted; Ada asked Ed; Fi asked Ada; Ada blocked Cy; Di blocked Ada
  await mp().requestFriend(bo, { id: me }); await mp().acceptFriend(me, bo);
  await mp().requestFriend(me, { id: ed });
  await mp().requestFriend(fi, { id: me });
  await mp().block(me, cy); await mp().block(di, me);

  const r = await ada.get('/api/v1/mp/recent-players');
  assert.equal(r.status, 200, r.text);
  const list = r.body.players;
  assert.deepEqual(list.map((p: any) => p.name), ['Ed Exhaust', 'Gus Grip', 'Fi Flag', 'Bo Brake'], 'newest first, each once; nobody blocked either way, no guest, no NPC, not others\' races');
  const by = Object.fromEntries(list.map((p: any) => [p.name, p]));
  assert.equal(by['Ed Exhaust'].where, 'free roam'); assert.equal(by['Ed Exhaust'].friend, 'outgoing');
  assert.equal(by['Gus Grip'].where, 'a race', 'the newest meeting (a route that\'s gone: no name)'); assert.equal(by['Gus Grip'].friend, 'none');
  assert.equal(by['Fi Flag'].where, 'Test Ring'); assert.equal(by['Fi Flag'].friend, 'incoming');
  assert.equal(by['Bo Brake'].friend, 'friend');
  assert.ok(Date.parse(by['Gus Grip'].at) > Date.parse(by['Bo Brake'].at));
  assert.deepEqual(Object.keys(list[0]).sort(), ['at', 'friend', 'id', 'name', 'where'], 'their public name only: no email');

  // "Add friend" from the list: the friend request endpoint, then shown as sent
  assert.equal((await ada.post('/api/v1/friends', { id: gus })).body.status, 'outgoing');
  assert.equal((await ada.get('/api/v1/mp/recent-players')).body.players.find((p: any) => p.id === gus).friend, 'outgoing');
  // (unblocked: Cy back on the list)
  await mp().unblock(me, cy);
  assert.ok((await ada.get('/api/v1/mp/recent-players')).body.players.some((p: any) => p.id === cy));
  // the other side sees her (and a guest, or nobody signed in, sees nothing)
  // (the other side: Bo sees Cy from the newest race, then Ada — a friend — and Gus from the same old one)
  const boList = (await boP.get('/api/v1/mp/recent-players')).body.players.map((p: any) => `${p.name}:${p.friend}`);
  assert.equal(boList[0], 'Cy Clutch:none'); assert.deepEqual(boList.slice(1).sort(), ['Ada Apex:friend', 'Gus Grip:none']);
  const g = new Player(T.app, '10.81.200.1');
  if ((await g.post('/api/auth/sign-in/anonymous', {})).status === 200) {
    await g.post('/api/v1/me/terms', { termsVersion: T.config.termsVersion, birthDate: '1990-01-01' }).catch(() => null);
    const gr = await g.get('/api/v1/mp/recent-players');
    if (gr.status === 200) assert.deepEqual(gr.body.players, []);
  }
  assert.equal((await new Player(T.app, '10.81.201.1').get('/api/v1/mp/recent-players')).status, 401);
});

test('recent players: at most 20, from the last month', async () => {
  const zed = await player('Zed Zoom'), me = await idOf('Zed Zoom');
  const others: string[] = [];
  for (let i = 0; i < 23; i++) { await player(`Racer ${i}`); others.push(await idOf(`Racer ${i}`)); }
  for (let i = 0; i < 22; i++) await race(`z-${i}`, 100 - i, { kind: 'track', code: 'TESTRING' }, [me, others[i]]);
  await race('z-ancient', 60 * 24 * 40, { kind: 'track', code: 'TESTRING' }, [me, others[22]]);
  const list = (await zed.get('/api/v1/mp/recent-players')).body.players;
  assert.equal(list.length, 20);
  assert.equal(list[0].name, 'Racer 21');
  assert.ok(!list.some((p: any) => p.name === 'Racer 22'), 'not from over a month ago');
});
