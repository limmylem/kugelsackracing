// Unit tests for the ROADBOOK's season-shop unlocks in the client (docs/ROADBOOK.md): which finishes the garage offers
// (garage/seasonUnlocks.js — locked ones only to their owners, none with no ROADBOOK), that no car or part comes in a
// locked finish (garage/data.js, the used lot, the dealership), photo mode's shop filter (play/photoMode.js), the
// badges on the player's card (garage/profileCard.js), and a refused paint put back (garage/player/remote.js).
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../harness.mjs';
import { loadGarageData } from '../../garage/data.js';
import { finishLock, seasonFinishes, badgesOf, seasonName } from '../../garage/seasonUnlocks.js';
import { usedLot } from '../../garage/shop.js';
import { dealerList } from '../../garage/dealer.js';
import { FILTERS, SHOP_FILTERS, filtersFor, applyFilter } from '../../play/photoMode.js';
import { badgeChips, profileCard } from '../../garage/profileCard.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { RemotePlayerService } from '../../garage/player/remote.js';

const { db, problems } = await loadGarageData(async rel => load(rel));
const shopItems = load('data/seasons/index.json').seasons.flatMap(s => load(`data/seasons/${s}/shop.json`).items.map(it => ({ ...it, season: s })));
const locked = Object.entries(db.finishes).filter(([, f]) => f.locked).map(([id]) => id);
// a ROADBOOK store as roadbook/client.js has it (view: null — no server, nobody signed in)
const store = (owned = null, season = { id: 'after_hours', name: 'After Hours' }) => ({
  view: owned ? { season, owned: { items: [], unlocks: owned } } : null,
  owns(kind, id) { return !!this.view?.owned?.unlocks?.[kind]?.includes(id); },
  lockedBy(kind, id) { const it = shopItems.find(x => x.grants?.[kind]?.includes(id)); return it ? { id: it.id, name: it.name, price: it.price, season: it.season } : null; },
});

test('the season shop\'s finishes: every locked one sold by an item; hidden with no ROADBOOK; locked with where it\'s from; owners\' as any other', () => {
  assert.ok(locked.length >= 5, 'the After Hours finishes are locked');
  for (const id of locked) assert.ok(shopItems.some(it => it.grants?.finishes?.includes(id)), `${id}: a shop item grants it`);
  // anyone's finishes: never locked
  assert.equal(finishLock(db.finishes, 'gloss', store()), null);
  assert.equal(finishLock(db.finishes, 'chrome', store({})), null);
  // no ROADBOOK: not shown at all
  assert.deepEqual(finishLock(db.finishes, 'midnight_metallic', store()), { hidden: true });
  assert.deepEqual(seasonFinishes(db.finishes, store(), { paint: true }), []);
  assert.deepEqual(seasonFinishes(db.finishes, null, { paint: false }), []);
  // signed in, nothing bought: shown locked, with the item, its price and the season's name
  const none = store({ finishes: [] }), paint = seasonFinishes(db.finishes, none, { paint: true }), part = seasonFinishes(db.finishes, none, { paint: false });
  assert.deepEqual(paint.map(f => f.id).sort(), ['afterglow_pearl', 'midnight_metallic']);
  assert.deepEqual(part.map(f => f.id).sort(), ['afterglow_anodised', 'neon_chrome', 'violet_chrome']);
  const mm = paint.find(f => f.id === 'midnight_metallic');
  assert.equal(mm.owned, false); assert.equal(mm.name, 'Midnight metallic'); assert.equal(mm.season, 'After Hours');
  assert.deepEqual(mm.item, { id: 'ah_paint_midnight', name: 'Midnight metallic paint', price: 250, season: 'after_hours' });
  // owned: usable; the rest still locked
  const some = store({ finishes: ['midnight_metallic', 'violet_chrome'] });
  assert.equal(finishLock(db.finishes, 'midnight_metallic', some).owned, true);
  assert.equal(finishLock(db.finishes, 'neon_chrome', some).owned, false);
  assert.deepEqual(seasonFinishes(db.finishes, some, { paint: false }).filter(f => f.owned).map(f => f.id), ['violet_chrome']);
  // the season's name: the view's for the season on now, else from its id
  assert.equal(seasonName('after_hours', null), 'After Hours');
  assert.equal(seasonName('after_hours', store({}, { id: 'after_hours', name: 'After Hours!' })), 'After Hours!');
});

test('no car or part comes in a locked finish: the data, the used lot, the dealership — and the data check says so', async () => {
  assert.deepEqual(problems.filter(p => /season-shop/.test(p.message)), []);
  for (const car of Object.values(db.cars)) assert.ok(!db.finishes[car.paint?.finish]?.locked, `${car.id}'s factory paint`);
  for (const p of Object.values(db.parts)) for (const f of [p.look?.finish, ...Object.values(p.look?.materials ?? {}).map(m => m.finish)]) assert.ok(!db.finishes[f]?.locked, `${p.id}: ${f}`);
  for (const l of usedLot(db, '2026-10-16')) { assert.equal(l.paint, undefined, 'a used car comes in its factory paint'); assert.ok(!db.finishes[db.cars[l.carId].paint?.finish]?.locked, l.id); }
  for (const c of dealerList(db).flatMap(g => g.cars)) assert.ok(!db.finishes[c.def.paint?.finish]?.locked, c.id);
  // a car or part that did: refused by the data check
  const firstCar = load('data/cars/index.json').cars[0], firstPart = load('data/parts/index.json').parts?.[0];
  const sneaky = await loadGarageData(async rel => {
    const x = load(rel);
    if (rel === `data/cars/${firstCar}`) return { ...x, paint: { colour: '#1a1230', finish: 'midnight_metallic' } };
    if (firstPart && rel === `data/parts/${firstPart}`) return { ...x, look: { ...(x.look ?? {}), finish: 'neon_chrome' } };
    return x;
  });
  const said = sneaky.problems.filter(p => /season-shop finish/.test(p.message));
  assert.ok(said.some(p => p.path === 'paint.finish' && /midnight_metallic/.test(p.message)), JSON.stringify(sneaky.problems.slice(0, 5)));
  if (firstPart) assert.ok(said.some(p => p.path === 'look.finish' && /neon_chrome/.test(p.message)));
});

test('photo mode\'s After Hours filter: only its owners are offered it; a cool, high-contrast grade', () => {
  assert.ok(SHOP_FILTERS.has('after_hours') && FILTERS.after_hours.length === 4 && FILTERS.after_hours.every(r => r.length === 5));
  assert.ok(shopItems.some(it => it.grants?.photoFilters?.includes('after_hours')), 'the shop sells it');
  assert.ok(!filtersFor().includes('after_hours'));
  assert.ok(!filtersFor(id => id !== 'after_hours').includes('after_hours'));
  assert.deepEqual(filtersFor(), Object.keys(FILTERS).filter(f => f !== 'after_hours'), 'everyone else\'s, in order');
  assert.ok(filtersFor(id => id === 'after_hours').includes('after_hours'));
  const px = (...rgb) => applyFilter({ data: new Uint8ClampedArray([...rgb, 255]) }, 'after_hours').data;
  const grey = px(128, 128, 128);
  assert.ok(grey[2] > grey[0] && grey[0] > grey[1], `cool and violet: blue up, green held back (${[...grey]})`);
  const dark = px(40, 40, 40), light = px(220, 220, 220);
  assert.ok(dark[0] < 40 && dark[1] < 40, 'blacks crushed'); assert.ok(dark[2] >= 40, 'shadows left blue');
  assert.ok(light[0] > 220 && light[2] > 220, 'highlights brighter: more contrast');
  assert.equal(px(0, 0, 0)[3], 255, 'alpha kept');
});

test('badges on the player\'s card: a chip each, the name its tooltip, the collector\'s gold', () => {
  assert.equal(badgeChips([]), ''); assert.equal(badgeChips(null), '');
  const R = store({ badges: ['after_hours', 'after_hours_collector'] }), badges = badgesOf(R);
  assert.deepEqual(badges, [{ id: 'after_hours', name: 'After Hours badge', season: 'after_hours' }, { id: 'after_hours_collector', name: 'After Hours collection', season: 'after_hours' }]);
  assert.deepEqual(badgesOf(store()), []);
  const html = badgeChips(badges);
  assert.match(html, /class="pc-badge " [^>]*title="After Hours badge"[^>]*style="--badge:#8a5cff"/);
  assert.match(html, /class="pc-badge gold" [^>]*title="After Hours collection"/);
  assert.equal((html.match(/role="listitem"/g) ?? []).length, 2);
  assert.ok(!badgeChips([{ id: 'x', name: '<b>', season: 's' }]).includes('<b>'), 'escaped');
  const s = { level: 3, xp: 900, from: 800, to: 1200, share: 0.25, max: 50, rank: null, next: null, ranks: [], money: 0, worth: 0, cars: 1, spare: 0, entered: 0, finished: 0, dnfs: 0, completed: 0, medals: { gold: 0, silver: 0, bronze: 0 }, series: 0, since: null };
  assert.match(profileCard({ s, me: null, price: n => `$${n}`, badges }), /pc-badges/);
  assert.doesNotMatch(profileCard({ s, me: null, price: n => `$${n}` }), /pc-badges/);
});

test('a paint the server refuses (a season-shop finish, no profile sent back): put back as it was, here and in the local copy', async () => {
  const local = new LocalPlayerService({ db, storage: new MemoryStorage() });
  await local.init();
  const theirs = (await local.getProfile()).updatedState, car = theirs.currentCar, was = structuredClone(theirs.cars[car].paint ?? null);
  for (const reachable of [true, false]) {
    let gets = 0;
    const api = {
      async get(path) { assert.equal(path, '/player'); if (gets++ && !reachable) throw new Error('offline'); return { profile: structuredClone(theirs), rev: 7, notices: [] }; },
      async post() { throw Object.assign(new Error('That finish is from a ROADBOOK season shop: buy it there first.'), { code: 'REFUSED', status: 409 }); },
      on: () => () => {}, watch() {},
    };
    const P = new RemotePlayerService({ api, db });
    try {
      await P.init();
      const seen = [];
      P.on(e => seen.push([e.what, e.profile.cars[car].paint?.finish ?? null]));
      const r = await P.setPaint(car, { colour: '#1a1230', finish: 'midnight_metallic' });
      assert.equal(r.ok, false); assert.match(r.error, /season shop/);
      assert.deepEqual(seen[0], ['paint', 'midnight_metallic'], 'shown at once');
      assert.deepEqual(seen.at(-1), ['rollback', was?.finish ?? null], `put back (server ${reachable ? 'asked again' : 'unreachable'})`);
      assert.deepEqual(P.profile.cars[car].paint ?? null, was);
      await P.shadowReady;
      assert.deepEqual((await P.shadow.getProfile()).updatedState.cars[car].paint ?? null, was, 'the next change starts from the server\'s profile');
    } finally { P.dispose(); }
  }
});
