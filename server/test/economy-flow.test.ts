// The economy at length (Phase 6 Step 2): thousands of random actions by several players at once (buying,
// selling, fitting, taking off, crashing, repairing, quests started, quit and refunded, admins' grants) —
// then every balance is its ledger's sum, none below zero, every part in at most one place and every build
// whole; the full garage flow through the server matching the game's own local service step for step; a
// guest's economy moving to the account they make; the admin's tools (a player's ledger and items, grants,
// removals, reversals, the settings' versions and rollback, the dashboard).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, linkIn, path as urlPath, birth, makeStaff } from './helpers.ts';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { loadGarageData } from '../../garage/data.js';
import { REPO_DIR } from '../src/config.ts';

let T: Awaited<ReturnType<typeof testApp>>, admin: Player;
const act = (p: Player, action: string, args: object) => p.post(`/api/v1/player/actions/${action}`, { args });
const profile = async (p: Player) => (await p.get('/api/v1/player')).body.profile;
const uid = async (email: string) => ((await T.app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any).id as string;
let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

before(async () => {
  T = await testApp('ecoflow');
  admin = await signUp(T.app, T.outbox, { email: 'boss@example.com', name: 'Boss Hog', ip: '10.8.0.99' });
  await makeStaff(T.app, admin, 'boss@example.com', 'admin');
});
after(async () => { await T?.close(); });

test('thousands of random actions by six players at once: every balance its ledger\'s sum, none below zero, every part in one place', async () => {
  const players = await Promise.all(Array.from({ length: 6 }, (_, k) => signUp(T.app, T.outbox, { email: `r${k}@example.com`, name: `Random Racer ${'abcdef'[k]}`, ip: `10.8.0.${k + 1}` })));
  const { db: game } = await T.app.economyConfig.gameDb();
  const cheap = Object.values<any>(game.parts).filter(p => !p.retired && !p.todo?.length && p.price < 1500).map(p => p.id);
  let done = 0, refused = 0;
  const actions = 400;
  await Promise.all(players.map(async (p, k) => {
    const id = await uid(`r${k}@example.com`);
    let drive: string | null = null;
    for (let n = 0; n < actions; n++) {
      const pr = await profile(p), car = pr.currentCar, parts = Object.values<any>(pr.parts), mine = parts.filter(x => x.installedOn?.car === car), spare = parts.filter(x => !x.installedOn);
      const r = rnd();
      let res;
      if (r < 0.22) res = await act(p, 'buyPart', { partId: pick(cheap) });
      else if (r < 0.32 && spare.length) res = await act(p, 'sellPart', { instanceId: pick(spare).instanceId });
      else if (r < 0.44 && spare.length) res = await act(p, 'installPart', { carInstanceId: car, instanceId: pick(spare).instanceId });
      else if (r < 0.52 && mine.length) res = await act(p, 'removePart', { carInstanceId: car, which: pick(mine).installedOn.socket });
      else if (r < 0.66 && mine.length) {
        drive ??= (await p.post('/api/v1/player/drives', { carInstanceId: car, mode: 'free' })).body.sessionId;
        const x = pick(mine);
        res = await act(p, 'damageCar', { sessionId: drive, carInstanceId: car, report: { parts: { [x.instanceId]: { condition: Math.max(0, x.condition - rnd() * 40) } }, shell: { condition: Math.max(0, (pr.cars[car].damage?.condition ?? 100) - rnd() * 20) } } });
      } else if (r < 0.76 && mine.some(x => x.condition < 100)) res = await act(p, 'repairPart', { instanceId: pick(mine.filter(x => x.condition < 100)).instanceId });
      else if (r < 0.8) res = await act(p, 'repairCar', { carInstanceId: car, opts: { kind: rnd() < 0.5 ? 'quick' : 'full' } });
      else if (r < 0.84) res = await act(p, 'basicRepair', { carInstanceId: car });
      else if (r < 0.9) { const s = await act(p, 'startQuest', { questId: (await p.get('/api/v1/tracks/today')).body.daily.events[0].id, trackCode: (await p.get('/api/v1/tracks/today')).body.daily.code }); res = s; if (s.status === 200) await act(p, rnd() < 0.5 ? 'refundQuest' : 'failQuest', { sessionId: s.body.sessionId }); }
      else if (r < 0.93) res = await admin.post(`/api/v1/admin/players/${id}/money`, { amount: Math.round(rnd() * 3000) + 1, reason: 'Random test grant' });
      else if (r < 0.95) { const e = (await p.get('/api/v1/player')).body.profile.money; res = e > 10 ? await admin.post(`/api/v1/admin/players/${id}/money`, { amount: -Math.round(e * rnd()) - 1, reason: 'Random test removal' }) : null; }
      else res = await act(p, 'buyPart', { partId: pick(cheap), quantity: 20 });  // (often more than they can afford)
      if (!res) continue;
      if (res.status === 200) done++; else { refused++; assert.ok([409].includes(res.status), `${res.status} ${res.text}`); }
    }
  }));
  assert.ok(done > 1000, `${done} done, ${refused} refused`);
  // the books: every balance its ledger's sum and its last row's balance; none below zero
  assert.deepEqual(await T.app.economy.ledgerCheck(), []);
  const db = T.app.deps.db;
  const neg = (await db.execute(sql`select count(*)::int as n from ledger where balance_after < 0`)).rows[0] as any;
  assert.equal(neg.n, 0);
  const last = (await db.execute(sql`select e.user_id from player_economy e where e.balance <> (select balance_after from ledger l where l.user_id = e.user_id order by id desc limit 1)`)).rows;
  assert.equal(last.length, 0);
  // every slot's part the player's, on the player's car; no copy twice
  const orphans = (await db.execute(sql`select count(*)::int as n from car_build_slots s left join owned_parts p on p.user_id = s.user_id and p.instance_id = s.part_instance_id left join owned_cars c on c.user_id = s.user_id and c.instance_id = s.car_instance_id where p.instance_id is null or c.instance_id is null`)).rows[0] as any;
  assert.equal(orphans.n, 0);
  // every profile whole by the game's own check: nothing to put right
  for (let k = 0; k < 6; k++) { const r = await players[k].get('/api/v1/player'); assert.deepEqual(r.body.notices, [], `player ${k}`); }
  console.log(`  (${done} actions done, ${refused} refused)`);
});

test('the full garage flow through the server matches the game\'s own local service, step by step', async () => {
  const p = await signUp(T.app, T.outbox, { email: 'flow@example.com', name: 'Flow Rider', ip: '10.8.1.1' });
  const server0 = await profile(p);
  // the same rules, locally, from the same starting profile (and the same settings)
  const { db: base } = await loadGarageData(async (f: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, f), 'utf8')));
  const { db: game, quests } = await T.app.economyConfig.gameDb();
  const local: any = new (LocalPlayerService as any)({ db: { ...base, economy: game.economy }, storage: new MemoryStorage(server0), quests: { config: quests }, now: () => new Date().toISOString() });
  await local.init();
  const car = server0.currentCar, ids: Record<string, string> = {};
  const fill = (o: any): any => JSON.parse(JSON.stringify(o).replace(/\$(intake|filterSocket|filter)/g, (_, k) => ids[k]));
  // (each step as the server's action, and as the local service's call)
  const steps: [string, any][] = [
    ['buyPart', { partId: 'cold_air_intake' }],
    ['installPart', { carInstanceId: car, instanceId: '$intake' }],
    ['damageCar', { carInstanceId: car, report: { parts: { $intake: { condition: 40 } }, shell: { condition: 70 } } }],
    ['repairPart', { instanceId: '$intake' }],
    ['repairBody', { carInstanceId: car }],
    ['buyPart', { partId: 'intake_filter_street' }],
    ['installPart', { carInstanceId: car, instanceId: '$filter' }],      // (a swap: the intake comes off)
    ['removePart', { carInstanceId: car, which: '$filterSocket' }],
    ['sellPart', { instanceId: '$intake' }],
  ];
  const localCall = (a: string, x: any) => ({
    buyPart: () => local.buyPart(x.partId), installPart: () => local.installPart(x.carInstanceId, x.instanceId), damageCar: () => local.damageCar(x.carInstanceId, x.report),
    repairPart: () => local.repairPart(x.instanceId), repairBody: () => local.repairBody(x.carInstanceId), removePart: () => local.removePart(x.carInstanceId, x.which), sellPart: () => local.sellPart(x.instanceId),
  } as any)[a]();
  const drive = (await p.post('/api/v1/player/drives', { carInstanceId: car, mode: 'free' })).body.sessionId;
  for (const [action, raw] of steps) {
    const args = fill(raw);
    const s = await act(p, action, { ...args, ...(action === 'damageCar' ? { sessionId: drive } : {}) });
    const l = await localCall(action, args);
    assert.equal(s.status === 200, !!l.ok, `${action}: server ${s.status} ${s.body?.error?.message ?? ''} / local ${l.error ?? 'ok'}`);
    if (action === 'buyPart') { ids[ids.intake ? 'filter' : 'intake'] = s.body.instanceIds[0]; assert.deepEqual(s.body.instanceIds, l.instanceIds, 'the same new ids'); }
    if (!l.ok) { assert.equal(s.body.error.message, l.error, `${action}: the same refusal`); continue; }
    if (action === 'installPart' && args.instanceId === ids.filter) ids.filterSocket = s.body.updatedState.parts[ids.filter].installedOn.socket;
    const sv = s.body.updatedState, lv = l.updatedState;
    assert.ok(sv && lv, `${action}: ${JSON.stringify(s.body).slice(0, 200)} / ${JSON.stringify(l).slice(0, 200)}`);
    assert.equal(sv.money, lv.money, `${action}: money`);
    assert.deepEqual(Object.keys(sv.parts).sort(), Object.keys(lv.parts).sort(), `${action}: parts`);
    for (const [k, x] of Object.entries<any>(sv.parts)) { assert.equal(x.condition, lv.parts[k].condition, `${action}: ${k} condition`); assert.deepEqual(x.installedOn, lv.parts[k].installedOn, `${action}: ${k} place`); }
    assert.deepEqual(sv.cars[car].damage ?? null, lv.cars[car].damage ?? null, `${action}: the body`);
  }
  assert.deepEqual(await T.app.economy.ledgerCheck(), []);
});

test('a guest plays, then makes an account: their money, cars and parts come with them', async () => {
  const g = new Player(T.app, '10.8.2.1');
  await g.post('/api/auth/sign-in/anonymous', {});
  await g.post('/api/v1/me/terms', { termsVersion: T.config.termsVersion, birthDate: birth(20) });
  const bought = await act(g, 'buyPart', { partId: 'cold_air_intake' });
  assert.equal(bought.status, 200, bought.text);
  const before = await profile(g), guestId = (await g.get('/api/v1/me')).body.user.id;
  await g.post('/api/auth/sign-up/email', { email: 'gina@example.com', password: 'correct horse battery', name: 'Gina Grip', acceptTerms: T.config.termsVersion, birthDate: birth(20) });
  await g.get(urlPath(linkIn(T.outbox.find(m => m.to === 'gina@example.com')!)));
  const me = (await g.get('/api/v1/me')).body.user;
  assert.equal(me.isGuest, false); assert.notEqual(me.id, guestId);
  const after = await profile(g);
  assert.equal(after.money, before.money);
  assert.deepEqual(Object.keys(after.parts).sort(), Object.keys(before.parts).sort());
  const L = (await g.get('/api/v1/player/ledger')).body.entries;
  assert.deepEqual(L.map((e: any) => e.kind).reverse(), ['start', 'purchase']);
  assert.deepEqual(await T.app.economy.ledgerCheck(), []);
  // (and deleting the account takes its ledger with it)
  const del = await g.del('/api/v1/me', { confirm: 'DELETE', password: 'correct horse battery' });
  assert.equal(del.status, 200, del.text);
  assert.equal(((await T.app.deps.db.execute(sql`select count(*)::int as n from ledger where user_id = ${me.id}`)).rows[0] as any).n, 0);
});

test('the admin\'s tools: a player\'s books and items, grants and removals, a reversal, items given and taken, the settings and the dashboard', async () => {
  const p = await signUp(T.app, T.outbox, { email: 'mo@example.com', name: 'Mo Money', ip: '10.8.3.1' }), id = await uid('mo@example.com');
  const buy = await act(p, 'buyPart', { partId: 'cold_air_intake' });
  // a player can't use them
  assert.equal((await p.post(`/api/v1/admin/players/${id}/money`, { amount: 1000000, reason: 'I want it' })).status, 403);
  assert.equal((await p.get(`/api/v1/admin/players/${id}/economy`)).status, 403);
  // a reason always
  assert.equal((await admin.post(`/api/v1/admin/players/${id}/money`, { amount: 500 })).status, 400);
  const g = await admin.post(`/api/v1/admin/players/${id}/money`, { amount: 500, reason: 'Sorry about the outage' });
  assert.equal(g.status, 200, g.text);
  // below zero: refused
  assert.equal((await admin.post(`/api/v1/admin/players/${id}/money`, { amount: -10_000_000, reason: 'Too much' })).status, 409);
  // reverse the purchase: the money back (once); a reversal isn't reversed
  const view = await admin.get(`/api/v1/admin/players/${id}/economy`);
  assert.equal(view.status, 200, view.text);
  const purchase = view.body.ledger.find((e: any) => e.kind === 'purchase');
  const rev = await admin.post(`/api/v1/admin/ledger/${purchase.id}/reverse`, { reason: 'Bought by mistake' });
  assert.equal(rev.status, 200, rev.text);
  assert.equal((await admin.post(`/api/v1/admin/ledger/${purchase.id}/reverse`, { reason: 'Again' })).status, 409);
  assert.equal((await admin.post(`/api/v1/admin/ledger/${rev.body.ledgerId}/reverse`, { reason: 'Undo' })).status, 409);
  // items: given, taken
  const give = await admin.post(`/api/v1/admin/players/${id}/items`, { give: { partId: 'intake_race' }, reason: 'A prize' });
  assert.equal(give.status, 200, give.text);
  const pr = await profile(p);
  assert.ok(Object.values<any>(pr.parts).some(x => x.partId === 'intake_race'));
  const spare = buy.body.instanceIds[0];
  assert.equal((await admin.post(`/api/v1/admin/players/${id}/items`, { remove: { instanceId: spare }, reason: 'Duplicated by a bug' })).status, 200);
  assert.ok(!(await profile(p)).parts[spare]);
  const v2 = (await admin.get(`/api/v1/admin/players/${id}/economy`)).body;
  assert.deepEqual(v2.ledger.map((e: any) => e.kind).reverse(), ['start', 'purchase', 'grant', 'reversal']);
  assert.ok(v2.ledger.find((e: any) => e.kind === 'purchase').reversed);
  assert.equal(v2.ledger.find((e: any) => e.kind === 'grant').actor, 'Boss Hog');
  const hist = await admin.get(`/api/v1/admin/players/${id}/items/${spare}/history`);
  assert.ok(hist.body.history.length >= 2, JSON.stringify(hist.body));
  // every one in the admins' log, with its reason
  const audit = (await admin.get(`/api/v1/admin/audit?targetId=${id}`)).body.entries.map((e: any) => [e.action, e.reason]);
  for (const a of ['grant-money', 'reverse-transaction', 'give-item', 'remove-item']) assert.ok(audit.some((x: any) => x[0] === a && x[1]), a);
  // the settings: a change (who, why), the game's prices follow, a rollback
  const cfg = (await admin.get('/api/v1/admin/economy/config')).body;
  const data = JSON.parse(JSON.stringify(cfg.current.data));
  data.economy.sell.ratio = Math.round((data.economy.sell.ratio * 0.9) * 100) / 100;
  assert.equal((await admin.post('/api/v1/admin/economy/config', { data, reason: 'Test: a lower sell ratio', basedOn: cfg.active + 5 })).status, 409, 'not the active version');
  const bad = JSON.parse(JSON.stringify(data)); bad.economy.startingMoney = 'lots';
  assert.equal((await admin.post('/api/v1/admin/economy/config', { data: bad, reason: 'Broken', basedOn: cfg.active })).status, 400);
  const ch = await admin.post('/api/v1/admin/economy/config', { data, reason: 'Test: a lower sell ratio', basedOn: cfg.active });
  assert.equal(ch.status, 200, ch.text);
  await new Promise(r => setTimeout(r, 5100));      // (the server asks again every few seconds)
  assert.equal((await p.get('/api/v1/player/config')).body.economy.sell.ratio, data.economy.sell.ratio);
  const rb = await admin.post(`/api/v1/admin/economy/config/${cfg.active}/rollback`, { reason: 'Back again' });
  assert.equal(rb.status, 200, rb.text);
  const hist2 = (await admin.get('/api/v1/admin/economy/config')).body.history;
  assert.deepEqual(hist2.slice(0, 2).map((h: any) => h.reason), [`Back to version ${cfg.active}: Back again`, 'Test: a lower sell ratio']);
  // the dashboard
  const dash = await admin.get('/api/v1/admin/economy/dashboard');
  assert.equal(dash.status, 200, dash.text);
  assert.ok(dash.body.totalMoney > 0 && dash.body.players > 0 && dash.body.days.length > 0 && dash.body.byLevel.length > 0);
  assert.equal(dash.body.ledgerMismatches, 0);
  assert.ok(dash.body.alerts.some((a: any) => a.kind === 'admin'));
});
