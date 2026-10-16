// The admin page's ROADBOOK tab (admin/roadbook.js; docs/ROADBOOK.md): its pure helpers against the repository's ROADBOOK
// files — the forms' round trips give the files back exactly, a new season and a new Expedition pass the checks, a
// pasted "lat, lon" splits, the changes between two versions are found by id.
// npm run test:unit

import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadRoadbook } from '../../roadbook/data.js';
import { bundleProblems, EVENTS } from '../../roadbook/engine.js';
import * as T from '../../admin/roadbook.js';

const all = await loadRoadbook(async f => JSON.parse(fs.readFileSync(f, 'utf8')));
const json = x => JSON.stringify(x);
const ok = (name, fn) => test(name, fn);

ok('the files pass the checks as they are', () => assert.deepEqual(bundleProblems(all), []));
ok('nothing "worth a look" in the files', () => assert.deepEqual(T.extraProblems(all), []));
ok('cleanBundle leaves the files unchanged', () => assert.equal(json(T.cleanBundle(all)), json(all)));
ok('no changes between the files and a copy', () => assert.deepEqual(T.diffPaths(all, T.clone(all)), []));
ok('every event has words', () => { for (const e of EVENTS) assert.ok(T.EVENT_INFO[e]?.label, e); });

// the forms' round trip: each challenge's goal through its rows and kind, each item's grants through their rows
ok('form state → bundle round trip', () => {
  const work = T.clone(all);
  for (const s of Object.values(work.seasons)) {
    for (const ch of s.season.challenges) {
      const g = ch.goal, kind = T.goalKind(g), rows = T.whereToRows(g.where);
      const back = { ...g };
      const w = T.whereFromRows(rows);
      if (w) back.where = w; else delete back.where;
      T.setGoalKind(back, kind);   // (the same kind: nothing changes)
      assert.equal(json(back), json(g), ch.id);
      ch.goal = back;
    }
    for (const it of s.shop.items) { const g = T.grantsFromRows(T.grantsToRows(it.grants)); assert.deepEqual(g, it.grants, it.id); it.grants = g; }
    for (const x of Object.values(s.expeditions)) for (const st of x.stages) { const before = json(st); T.setStageType(st, st.type, {}); assert.equal(json(st), before, st.id); }
  }
  const out = T.cleanBundle(work);
  assert.equal(json(out), json(all));
  assert.deepEqual(bundleProblems(out), []);
});

ok('where values: lists, booleans, numbers', () => {
  assert.deepEqual(T.whereFromRows([{ key: 'win', value: 'true' }, { key: 'questType', value: 'time_trial, checkpoint' }, { key: 'place', value: '1' }, { key: '', value: 'x' }, { key: 'medal', value: '' }]),
    { win: true, questType: ['time_trial', 'checkpoint'], place: 1 });
  assert.equal(T.whereFromRows([]), undefined);
  assert.deepEqual(T.whereToRows({ questType: ['a', 'b'], win: false }), [{ key: 'questType', value: 'a, b' }, { key: 'win', value: 'false' }]);
});

ok('goal kinds switch cleanly', () => {
  const g = { event: 'distance_driven', count: 2 };
  assert.deepEqual(T.setGoalKind(g, 'sum'), { event: 'distance_driven', sum: 'metres', target: 10000 });
  assert.deepEqual(T.setGoalKind(g, 'streak'), { event: 'distance_driven', streak: 3 });
  const p = { event: 'place_discovered', where: { hidden: true } };
  assert.deepEqual(T.setGoalKind(p, 'unique'), { event: 'place_discovered', where: { hidden: true }, unique: 'place', count: 3 });
  assert.deepEqual(T.setGoalKind(p, 'count'), { event: 'place_discovered', where: { hidden: true }, count: 3 });
});

ok('lat, lon pasted', () => {
  assert.deepEqual(T.parseLatLon('-34.92857, 138.60074'), { lat: -34.92857, lon: 138.60074 });
  assert.deepEqual(T.parseLatLon('-34.928572123456,138.600741234567'), { lat: -34.928572, lon: 138.600741 });
  assert.deepEqual(T.parseLatLon('(-34.9 138.6)'), { lat: -34.9, lon: 138.6 });
  assert.deepEqual(T.parseLatLon('34.9285° S, 138.6007° E'), { lat: -34.9285, lon: 138.6007 });
  assert.deepEqual(T.parseLatLon('34°55\'42.9"S 138°36\'02.7"E'), { lat: -34.928583, lon: 138.60075 });
  assert.deepEqual(T.parseLatLon('https://www.google.com/maps/@-34.9214,138.6007,15z'), { lat: -34.9214, lon: 138.6007 });
  assert.deepEqual(T.parseLatLon('−34.9, 138.6'), { lat: -34.9, lon: 138.6 });
  assert.equal(T.parseLatLon('-34.92'), null);
  assert.equal(T.parseLatLon('95, 10'), null);
  assert.equal(T.parseLatLon('hello'), null);
  assert.equal(T.numOrText('-34.9'), -34.9);
  assert.equal(T.numOrText('-'), '-');
});

ok('ids from names', () => {
  assert.equal(T.slug('The Midnight Run'), 'the_midnight_run');
  assert.equal(T.slug('Hat-trick!'), 'hat_trick');
  assert.equal(T.slug('Café Racer'), 'cafe_racer');
  assert.equal(T.uniqueId('a', new Set(['a', 'a_2'])), 'a_3');
  assert.equal(T.prefixOf('after_hours'), 'ah');
  assert.equal(T.regionPrefix(all.places, 'adelaide'), 'adl');
});

ok('a new season passes the checks', () => {
  const work = T.clone(all);
  assert.equal(T.addSeason(work, 'neon_summer', 'Neon Summer'), null);
  assert.match(T.addSeason(work, 'neon_summer', 'Again'), /already/);
  assert.match(T.addSeason(work, 'Bad Id', 'X'), /small letters/);
  assert.deepEqual(bundleProblems(work), []);
  work.current = 'neon_summer';
  assert.deepEqual(bundleProblems(work), []);
  const d = T.diffPaths(all, work);
  assert.deepEqual(d.map(T.describeChange), ['current: "after_hours" → "neon_summer"', 'neon_summer: added']);
});

ok('a new Expedition: flagged until its place is set, then fine', () => {
  const work = T.clone(all);
  assert.equal(T.addExpedition(work, 'after_hours', 'harbour_lights', 'Harbour Lights', 'adelaide'), null);
  assert.ok(work.seasons.after_hours.season.expeditions.includes('harbour_lights'));
  assert.ok(bundleProblems(work).some(p => /latitude and longitude/.test(p)));
  const st = work.seasons.after_hours.expeditions.harbour_lights.stages[0];
  Object.assign(st.location, T.parseLatLon('-34.84312, 138.50456'));
  assert.deepEqual(bundleProblems(work), []);
  // (a stage switched to checkpoints and back keeps its place)
  const stash = {};
  T.setStageType(st, 'checkpoints', stash);
  assert.deepEqual(Object.keys(st).sort(), ['checkpoints', 'id', 'name', 'points', 'radius', 'text', 'timeLimitSec', 'tokens', 'type']);
  assert.ok(bundleProblems(work).some(p => /latitude and longitude/.test(p)));
  T.setStageType(st, 'reach', stash);
  assert.equal(st.location.lat, -34.84312);
  assert.deepEqual(bundleProblems(work), []);
});

ok('a place with no numbers for its latitude: refused (not put at 0,0), and the tab says so too', () => {
  const work = T.clone(all);
  work.places[0].lat = null;
  assert.ok(bundleProblems(work).some(p => /latitude and longitude/.test(p)));
  assert.ok(T.extraProblems(work).some(p => /must be numbers/.test(p)));
});

ok('the changes list: by id, readable', () => {
  const work = T.clone(all);
  const chs = work.seasons.after_hours.season.challenges;
  chs.find(c => c.id === 'ah_win_10').points = 130;
  chs.splice(2, 0, { id: 'ah_new', chapter: 'first_night_out', style: 'racing', name: 'New', description: '', goal: { event: 'race_finished', count: 1 }, points: 10, tokens: 5 });
  work.places = work.places.filter(p => p.id !== 'adl_airport');
  const lines = T.diffPaths(all, work).map(T.describeChange);
  assert.deepEqual(lines, ['after_hours › challenges › ah_new: added (New)', 'after_hours › challenges › ah_win_10 › points: 120 → 130', 'places › adl_airport: removed (Adelaide Airport)']);
  const moved = T.clone(all); moved.seasons.after_hours.season.chapters.reverse();
  assert.deepEqual(T.diffPaths(all, moved).map(T.describeChange), ['after_hours › chapters: in a new order']);
});

ok('broken settings are checked without throwing', () => {
  const r = T.checkBundle({ current: 'x', seasons: { x: null } });
  assert.ok(r.problems.length >= 1);
});

ok('season points and days left', () => {
  assert.equal(T.seasonPoints(all, 'after_hours'), 40 * 3 + 30 + 80 + 60 + 60 + 60 + 50 + 120 + 120 + 100 + 150 + 250);
  assert.equal(T.daysLeft(new Date(Date.UTC(2026, 0, 10)).toISOString(), Date.UTC(2026, 0, 1)), 9);
  assert.equal(T.daysLeft(new Date(Date.UTC(2026, 0, 1)).toISOString(), Date.UTC(2026, 0, 5)), 0);
});


ok('an Expedition\'s time of day: every half hour to choose from, in words; the Midnight Run\'s midnight passes the checks', () => {
  assert.equal(T.TIME_CHOICES.length, 48);
  assert.equal(T.hourText(0), '00:00 (midnight)');
  assert.equal(T.hourText(12), '12:00 (noon)');
  assert.equal(T.hourText(6.5), '06:30 (dawn)');
  assert.equal(all.seasons.after_hours.expeditions.midnight_run.timeOfDay, 0);
  const work = T.clone(all);
  work.seasons.after_hours.expeditions.midnight_run.stages[4].timeOfDay = 5.5;
  assert.deepEqual(bundleProblems(work), []);
  assert.equal(json(T.cleanBundle(work)).includes('"timeOfDay":5.5'), true, 'kept when saved');
});
