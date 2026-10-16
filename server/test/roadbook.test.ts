// The ROADBOOK on the server (docs/ROADBOOK.md; roadbook/service.ts, routes/roadbook.ts): a season only admins see
// while it's tested, started when sign-ups open (what was tested cleared); challenges hearing the game's own systems (a
// part fitted, a photo saved — never the game's say-so); chapters opening on points; an Expedition driven stage by stage
// through pings, kept between sessions; a teleport earning nothing; Season Tokens with their history; the shop (too few
// tokens, bought once, the same request sent twice); an owners-only finish refused until bought; the season's end turning
// tokens into cash once; the Personal History; the admin page's versions.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, makeStaff } from './helpers.ts';

let T: Awaited<ReturnType<typeof testApp>>, ann: Player, admin: Player, annId: string;
let now = Date.UTC(2026, 9, 20, 12);
const q = async (s: ReturnType<typeof sql>) => (await T.app.deps.db.execute(s)).rows as any[];
const act = (p: Player, action: string, args: object) => p.post(`/api/v1/player/actions/${action}`, { args });
const book = async (p: Player) => (await p.get('/api/v1/roadbook')).body;
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const exp = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../data/seasons/after_hours/expeditions/midnight_run.json'), 'utf8'));
// (what the game's systems report is heard just after their answer: wait for it)
async function until<T>(f: () => Promise<T>, ok: (x: T) => boolean, what: string) {
  for (let i = 0; i < 100; i++) { const x = await f(); if (ok(x)) return x; await new Promise(r => setTimeout(r, 30)); }
  throw new Error(`never: ${what}`);
}
const R = 6371008.8, rad = Math.PI / 180;
const metres = (a: any, b: any) => 2 * R * Math.asin(Math.sqrt(Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2));
// a drive from a to b at speed, as the game pings it: samples every half second, ten to a ping, the server's clock moving on
let clientT = 1000;
async function drive(p: Player, a: any, b: any, speed = 25) {
  const d = metres(a, b), n = Math.max(1, Math.ceil(d / (speed / 2))), s: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) { clientT += 500; s.push([a.lat + (b.lat - a.lat) * i / n, a.lon + (b.lon - a.lon) * i / n, clientT]); }
  const out: any[] = [];
  for (let i = 0; i < s.length; i += 10) {
    const part = s.slice(i, i + 10);
    now += part.length * 500;
    const r = await p.post('/api/v1/roadbook/ping', { samples: part });
    assert.equal(r.status, 200, r.text);
    out.push(r.body);
  }
  return { awards: out.flatMap(o => o.awards), events: out.flatMap(o => o.events), last: out.at(-1) };
}
let at = { lat: -34.9238, lon: 138.5999 };
const goTo = async (p: Player, b: any, speed = 25) => { const r = await drive(p, at, b, speed); at = { lat: b.lat, lon: b.lon }; return r; };

before(async () => {
  T = await testApp('roadbook', { clock: () => now });
  [ann, admin] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.8.1.1' }),
    signUp(T.app, T.outbox, { email: 'adm@example.com', name: 'Ada Boss', ip: '10.8.1.4' }),
  ]);
  await makeStaff(T.app, admin, 'adm@example.com', 'admin');
  await ann.get('/api/v1/player'); await admin.get('/api/v1/player');
  annId = (await q(sql`select id from users where email = 'ann@example.com'`))[0].id;
});
after(async () => { await T?.close(); });

test('testing: only admins see the season; opening the beta starts it, for 8 weeks, and clears what was tested', async () => {
  assert.equal((await book(ann)).season, null, 'a player sees no season yet');
  const a = await book(admin);
  assert.equal(a.season.status, 'testing');
  // (an admin tests it: tokens given, a purchase)
  assert.equal((await admin.post('/api/v1/roadbook/dev/tokens', { amount: 300 })).status, 200);
  assert.equal((await admin.post('/api/v1/roadbook/shop/buy', { itemId: 'ah_badge' })).status, 200);
  // the beta opens (the Launch tab's switch: closed, then open)
  assert.equal((await admin.put('/api/v1/admin/settings/closedBeta', { key: 'closedBeta', value: { on: true }, reason: 'testing the switch' })).status, 200);
  assert.equal((await admin.put('/api/v1/admin/settings/closedBeta', { key: 'closedBeta', value: { on: false }, reason: 'the open beta' })).status, 200);
  const b = await book(ann);
  assert.equal(b.season.status, 'live');
  assert.equal(Date.parse(b.season.endsAt) - Date.parse(b.season.startedAt), 56 * 86_400_000);
  const c = await book(admin);
  assert.equal(c.tokens, 0, 'the testing tokens cleared');
  assert.equal(c.shop.find((i: any) => i.id === 'ah_badge').owned, false, 'and the testing purchase');
});

test('challenges hear the game\'s own systems: a part fitted, a photo saved — tokens in the history with their reasons', async () => {
  const b = await act(ann, 'buyPart', { partId: 'cold_air_intake' }), car = b.body.updatedState.currentCar;
  assert.equal((await act(ann, 'installPart', { carInstanceId: car, instanceId: b.body.instanceIds[0] })).status, 200);
  const r = await until(() => book(ann), x => x.challenges.find((c: any) => c.id === 'ah_fit_part').done, 'the fitted part heard');
  assert.equal(r.tokens, 20);
  assert.equal(r.points, 40);
  assert.deepEqual(r.tokenHistory.map((t: any) => [t.amount, t.reason]), [[20, 'Challenge: First mod']]);
  assert.equal((await ann.post('/api/v1/player/photos', { image: JPEG })).status, 200);
  await until(() => book(ann), x => x.challenges.find((c: any) => c.id === 'ah_photo').done, 'the photo heard');
  // (the game can't report events itself: only the development commands can, and they're an admin's on the live server)
  assert.equal((await ann.post('/api/v1/roadbook/event', { type: 'race_finished', data: { win: true } })).status, 404);
});

test('a chapter opens on points without every challenge done; a challenge met while its chapter was closed completes as it opens', async () => {
  // (4 more parts: chapter 2's "garage hours" counted, not yet paid)
  for (let i = 0; i < 4; i++) { const b = await act(ann, 'buyPart', { partId: 'cold_air_intake' }); assert.equal(b.status, 200, b.text); }
  const spare = Object.entries<any>((await ann.get('/api/v1/player')).body.profile.parts).filter(([, p]) => p.partId === 'cold_air_intake' && !p.installedOn).map(([id]) => id);
  const car = (await ann.get('/api/v1/player')).body.profile.currentCar;
  for (const id of spare.slice(0, 4)) assert.equal((await act(ann, 'installPart', { carInstanceId: car, instanceId: id })).status, 200);
  let r = await until(() => book(ann), x => x.challenges.find((c: any) => c.id === 'ah_fit_5').have === 5, 'five parts');
  assert.equal(r.challenges.find((c: any) => c.id === 'ah_fit_5').done, false);
  assert.equal(r.chapters[1].open, false);
  // a race finished (the development command: as the server's quest check reports it) — 110 points; the drive below
  // takes it past 120 and chapter 2 opens
  await ann.post('/api/v1/roadbook/dev/event', { type: 'race_finished', data: { questType: 'sprint', medal: 'gold', place: 1, win: true } });
  r = await book(ann);
  assert.equal(r.points, 110);
  await goTo(ann, { lat: -34.9238, lon: 138.6299 });         // (a warm-up drive in town, ~2.7 km)
  const big = { lat: -34.9238 - 0.2, lon: 138.6299 };       // (and on: 25 km in all)
  await goTo(ann, big, 60); await goTo(ann, { lat: -34.9238, lon: 138.6299 }, 60);
  r = await book(ann);
  assert.ok(r.challenges.find((c: any) => c.id === 'ah_drive_25').done, `${JSON.stringify(r.challenges.find((c: any) => c.id === 'ah_drive_25'))}`);
  assert.equal(r.chapters[1].open, true);
  assert.equal(r.challenges.find((c: any) => c.id === 'ah_fit_5').done, true, 'garage hours completed as its chapter opened');
  assert.ok(r.chapters[0].milestone, 'chapter 1 all done: its milestone');
  assert.ok(r.tokenHistory.some((t: any) => t.reason === 'Chapter finished: First Night Out' && t.amount === 100));
});

test('the Midnight Run: driven stage by stage, kept between sessions; a teleport earns nothing; the clue\'s place hidden until near', async () => {
  assert.equal((await ann.post('/api/v1/roadbook/expeditions/midnight_run/start')).status, 200);
  const S = exp.stages;
  // a teleport straight onto the meeting spot: nothing
  clientT += 500; now += 60_000;
  let r = await ann.post('/api/v1/roadbook/ping', { samples: [[S[0].location.lat, S[0].location.lon, clientT], [S[0].location.lat, S[0].location.lon, clientT + 500]] });
  clientT += 500;
  assert.equal(r.body.awards.length, 0);
  at = { lat: S[0].location.lat, lon: S[0].location.lon };
  // drive away and back: now it counts
  await goTo(ann, { lat: at.lat + 0.004, lon: at.lon });
  const d = await goTo(ann, S[0].location);
  assert.ok(d.awards.some((a: any) => a.key === 'xs:midnight_run:meet' && a.tokens === 150), JSON.stringify(d.awards));
  let v = (await book(ann)).expeditions[0];
  assert.equal(v.stage.id, 'clue');
  assert.deepEqual(v.stage.targets, [], 'the clue\'s place isn\'t given away');
  assert.equal(v.timeOfDay, 0, 'the Midnight Run: at midnight');
  assert.equal(v.stage.timeOfDay, 0, '…every stage of it');
  assert.ok(v.stage.clue && v.stage.hint === null);
  // (another session: the next day)
  now += 86_400_000;
  v = (await book(ann)).expeditions[0];
  assert.equal(v.stage.id, 'clue', 'kept');
  assert.ok(v.stage.hint, 'the hint, its time come');
  await goTo(ann, { lat: S[1].location.lat - 0.002, lon: S[1].location.lon }, 25);       // (near: within 150 m? not yet: ~220 m)
  await goTo(ann, { lat: S[1].location.lat - 0.0011, lon: S[1].location.lon }, 25);      // (~120 m: shown)
  v = (await book(ann)).expeditions[0];
  assert.equal(v.stage.targets.length, 1, 'shown once near');
  await goTo(ann, S[1].location);
  for (const it of S[2].items) await goTo(ann, it);
  v = (await book(ann)).expeditions[0];
  assert.equal(v.stage.id, 'hill_run');
  for (const c of S[3].checkpoints) await goTo(ann, c, 30);
  await goTo(ann, S[4].location, 30);
  const B = await book(ann);
  assert.equal(B.expeditions[0].done, true);
  const xs = B.tokenHistory.filter((t: any) => /^The Midnight Run/.test(t.reason));
  assert.equal(xs.length, 5);
  assert.equal(xs.reduce((a: number, t: any) => a + t.amount, 0), 150 * 4 + 400);
  assert.ok(B.history.expeditions.some((x: any) => x.id === 'midnight_run'));
  assert.ok(B.history.places.some((p: any) => p.id === 'adl_mount_lofty'), 'the summit, discovered on the way');
});

test('the shop: too few tokens refused; bought once — the same request again does it once, another asks refused; tokens spent once', async () => {
  const have = (await book(ann)).tokens;
  const big = (await book(ann)).shop.find((i: any) => i.id === 'ah_collection');
  if (have < big.price) {
    const r = await ann.post('/api/v1/roadbook/shop/buy', { itemId: 'ah_collection' });
    assert.equal(r.status, 409); assert.match(r.body.error.message, /you have \d+/);
  }
  const key = 'buy-paint-once-0001';
  const r1 = await ann.post('/api/v1/roadbook/shop/buy', { itemId: 'ah_paint_midnight' }, { key });
  assert.equal(r1.status, 200, r1.text);
  const r2 = await ann.post('/api/v1/roadbook/shop/buy', { itemId: 'ah_paint_midnight' }, { key });
  assert.equal(r2.status, 200); assert.equal(r2.headers['idempotent-replayed'], 'true');
  const r3 = await ann.post('/api/v1/roadbook/shop/buy', { itemId: 'ah_paint_midnight' });
  assert.equal(r3.status, 409); assert.match(r3.body.error.message, /already/);
  const after = await book(ann);
  assert.equal(after.tokens, have - 250);
  assert.equal(after.tokenHistory.filter((t: any) => t.reason === 'Bought: Midnight metallic paint').length, 1);
  assert.ok(after.owned.unlocks.finishes.includes('midnight_metallic'));
});

test('the development commands: the next stage\'s place, and arriving there as if driven (the debug teleport) — a stage done', async () => {
  let t = (await admin.get('/api/v1/roadbook/dev/next-target')).body.target;
  assert.deepEqual(t, { expedition: 'midnight_run', start: true });
  assert.equal((await admin.post('/api/v1/roadbook/expeditions/midnight_run/start')).status, 200);
  t = (await admin.get('/api/v1/roadbook/dev/next-target')).body.target;
  assert.equal(t.stage, 'meet');
  const r = await admin.post('/api/v1/roadbook/dev/arrive', { lat: t.lat, lon: t.lon });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.awards.some((a: any) => a.key === 'xs:midnight_run:meet'));
  assert.equal((await admin.get('/api/v1/roadbook/dev/next-target')).body.target.stage, 'clue');
});

test('an owners-only finish: refused to someone who hasn\'t bought it, fine for an owner', async () => {
  const car = (await admin.get('/api/v1/player')).body.profile.currentCar;
  const no = await act(admin, 'setPaint', { carInstanceId: car, paint: { colour: '#221133', finish: 'midnight_metallic' } });
  assert.equal(no.status, 409); assert.match(no.body.error.message, /season shop/);
  const annCar = (await ann.get('/api/v1/player')).body.profile.currentCar;
  assert.equal((await act(ann, 'setPaint', { carInstanceId: annCar, paint: { colour: '#221133', finish: 'midnight_metallic' } })).status, 200);
});

test('Personal History: distance, by car, places, parts fitted, medals — and it outlives the season', async () => {
  const h = (await ann.get('/api/v1/roadbook/history')).body;
  assert.ok(h.distanceKm > 40, `${h.distanceKm}`);
  assert.ok(h.places.length >= 3);
  assert.equal(h.cars.partsFitted, 5);
  assert.ok(h.wins >= 1);
  assert.ok(Array.isArray(h.personalRecords));
});

test('the season\'s end: a warning before it; tokens left turned into cash at the rate shown, once; the shop closed; the history kept', async () => {
  const v = await book(ann);
  assert.equal(v.season.warning, false);
  now = Date.parse(v.season.endsAt) - 3 * 86_400_000;
  assert.equal((await book(ann)).season.warning, true, 'the warning in the last week');
  const tokens = (await book(ann)).tokens, rate = v.season.conversion.cashPerToken;
  const money = async () => Number((await q(sql`select balance from player_economy where user_id = ${annId}`))[0].balance);
  const m0 = await money();
  now = Date.parse(v.season.endsAt) + 1000;
  await T.app.roadbook.sweep();
  assert.equal(await money(), m0 + tokens * rate);
  await T.app.roadbook.sweep(); await book(ann);
  assert.equal(await money(), m0 + tokens * rate, 'once');
  const after = await book(ann);
  assert.equal(after.season.status, 'ended');
  assert.equal(after.tokens, 0);
  assert.equal((await ann.post('/api/v1/roadbook/shop/buy', { itemId: 'ah_badge' })).status, 409);
  assert.ok(after.owned.items.some((i: any) => i.id === 'ah_paint_midnight'), 'what was bought is kept');
  assert.ok((await ann.get('/api/v1/roadbook/history')).body.distanceKm > 40);
  const L = await q(sql`select kind, reason from ledger where user_id = ${annId} and ref->>'reward' = 'season-end:after_hours'`);
  assert.equal(L.length, 1); assert.match(L[0].reason, /Season Tokens left/);
});

test('the admin page: the settings as versions — a broken change refused, a good one live at once, a rollback', async () => {
  const a = (await admin.get('/api/v1/admin/roadbook')).body;
  assert.equal(a.version, 1);
  const bad = structuredClone(a.data);
  bad.seasons.after_hours.shop.items[0].price = -1;
  const r = await admin.post('/api/v1/admin/roadbook/config', { data: bad, reason: 'a bad price', basedOn: 1 });
  assert.equal(r.status, 400); assert.match(r.text, /price/);
  const good = structuredClone(a.data);
  good.seasons.after_hours.shop.items[0].price = 120;
  const g = await admin.post('/api/v1/admin/roadbook/config', { data: good, reason: 'the badge a little dearer', basedOn: 1 });
  assert.equal(g.status, 200, g.text);
  assert.equal((await admin.get('/api/v1/admin/roadbook')).body.data.seasons.after_hours.shop.items[0].price, 120);
  assert.equal((await admin.post('/api/v1/admin/roadbook/config', { data: good, reason: 'from an old copy', basedOn: 1 })).status, 409, 'edited from an old version');
  assert.equal((await admin.post('/api/v1/admin/roadbook/rollback', { version: 1, reason: 'back as it was' })).status, 200);
  assert.equal((await admin.get('/api/v1/admin/roadbook')).body.data.seasons.after_hours.shop.items[0].price, 100);
  assert.equal((await ann.get('/api/v1/admin/roadbook')).status, 403);
  const v = (await admin.get('/api/v1/admin/roadbook')).body;
  assert.equal(v.versions[0].actor, 'Ada Boss', 'who made each version, by name');
});

test('a new season with a start date: live from that date (no testing first); everyone sees it', async () => {
  const a = (await admin.get('/api/v1/admin/roadbook')).body, data = structuredClone(a.data);
  data.seasons.test_two = { season: { id: 'test_two', name: 'Second Gear', start: new Date(now - 86_400_000).toISOString(), lengthDays: 28, warningDays: 7, conversion: { cashPerToken: 1 },
    chapters: [{ id: 'one', name: 'One', unlockAt: 0, milestoneTokens: 0 }], challenges: [], expeditions: [] }, shop: { items: [] }, expeditions: {} };
  data.current = 'test_two';
  const r = await admin.post('/api/v1/admin/roadbook/config', { data, reason: 'the next season', basedOn: a.version });
  assert.equal(r.status, 200, r.text);
  const b = await book(ann);
  assert.equal(b.season.id, 'test_two');
  assert.equal(b.season.status, 'live');
  assert.equal(Date.parse(b.season.endsAt) - Date.parse(b.season.startedAt), 28 * 86_400_000);
  // (a place without numbers for its latitude isn't at 0,0: refused)
  const bad = structuredClone(data); bad.places[0].lat = null;
  assert.equal((await admin.post('/api/v1/admin/roadbook/config', { data: bad, reason: 'a broken place', basedOn: a.version + 1 })).status, 400);
});
