// Phase 4 Step 5: the economy simulation (tools/economy/sim.mjs) — a short run on the game's own rules,
// with made-up crash bills (the full run, npm run economy-sim, measures the real ones with the crash suite).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { harness } from '../harness.mjs';
import { makePool, simulate } from '../../tools/economy/sim.mjs';
import { evaluate, textReport, htmlReport, questPay } from '../../tools/economy/report.mjs';
import { rewardsOf } from '../../content/quests.js';

const config = JSON.parse(fs.readFileSync(new URL('../../data/quests.json', import.meta.url)));
const H = await harness(), db = H.db;
const crashTable = Object.fromEntries(Object.keys(db.cars).map(id => [id, { 30: 60, 60: 450, 100: 900, 150: 1300 }]));

test('the quest pool: the same from the same seed, every quest rated and priced by the rules, series of quests', () => {
  const a = makePool(db.economy, config, 3), b = makePool(db.economy, config, 3), S = db.economy.simulation.pool;
  assert.deepEqual(a, b);
  assert.equal(a.quests.filter(q => !q.track).length, S.quests);
  // (track events, Phase 5 Step 3: on tracks of every kind, never in a series)
  const tracks = a.quests.filter(q => q.track);
  assert.ok(tracks.length >= S.tracks.count && new Set(tracks.map(q => q.track.kind)).size === Object.keys(S.tracks.kinds).length);
  assert.ok(a.series.every(s => s.quests.every(id => !id.startsWith('trk_'))));
  for (const q of a.quests) { assert.ok(q.rating.stars >= 1 && q.rating.stars <= 5 && q.rating.km > 0); assert.ok(rewardsOf(q, db.economy).money > 0); }
  assert.ok(a.series.length > 0 && a.series.every(s => s.quests.length === S.seriesOf));
  assert.notDeepEqual(makePool(db.economy, config, 4).quests.map(q => q.rating), a.quests.map(q => q.rating), 'another seed, another pool');
});

test('a bot\'s hour: it earns, crashes and pays for repairs, buys an upgrade, levels up, and never gets stuck', () => {
  const pool = makePool(db.economy, config, 7);
  const R = simulate({ db, config, pool, crashTable, skill: 0.55, hours: 1, seed: 7 });
  assert.ok(R.runs > 3, `${R.runs} quests`);
  assert.equal(R.stuck, 0);
  assert.ok(R.earned > 0 && R.level >= 2, `earned ${R.earned}, level ${R.level}`);
  assert.ok(R.spend.parts > 0 && R.firstUpgrade != null, 'an upgrade bought');
  assert.ok(R.samples.length > R.runs && R.samples.every((s, i) => !i || s.t >= R.samples[i - 1].t), 'money over time, in order');
  // the money adds up: what it started with, earned, spent
  const spent = R.spend.repairs + R.spend.parts + R.spend.cars + R.spend.fees;
  assert.ok(Math.abs(db.economy.startingMoney + R.earned + R.spend.fees - spent - R.money) < 2, 'starting + earned − spent = what it has');
  // the same seed: the same run
  assert.deepEqual(simulate({ db, config, pool, crashTable, skill: 0.55, hours: 1, seed: 7 }).samples, R.samples);
  // more skill earns more
  const better = simulate({ db, config, pool, crashTable, skill: 0.9, hours: 1, seed: 7 });
  assert.ok(better.earned > R.earned * 0.9);
});

test('the report: each target checked, and the text and the page say so', () => {
  const pool = makePool(db.economy, config, 7), runs = {};
  for (const [k, s] of Object.entries(db.economy.simulation.skills)) runs[k] = simulate({ db, config, pool, crashTable, skill: s, hours: 0.5, seed: 7 });
  const checks = evaluate(runs, db.economy);
  assert.deepEqual(checks.map(c => c.id), ['firstUpgrade', 'secondCar', 'repairs', 'skill', 'stuck', 'questPay', 'levels', 'multiplayerPay']);
  for (const c of checks) assert.equal(typeof c.pass, 'boolean');
  assert.equal(checks.find(c => c.id === 'stuck').pass, true);
  const text = textReport(runs, checks, db.economy), html = htmlReport(runs, checks, db.economy);
  assert.match(text, /Economy simulation/); assert.match(text, /Income an hour/);
  assert.match(html, /<svg/); assert.match(html, /Money over time/); assert.match(html, /prefers-color-scheme:dark/);
  assert.ok(Array.isArray(questPay(runs, db.economy)));
});
