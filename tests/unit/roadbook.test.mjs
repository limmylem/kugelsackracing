// The ROADBOOK's rules (roadbook/engine.js, expedition.js, geo.js; docs/ROADBOOK.md): challenges counting events,
// chapters opening on points (not every challenge needed), milestones, streaks, an Expedition driven stage by stage
// (saved and picked up again), the track's checks on what was driven, and the data files being right.
// npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadRoadbook } from '../../roadbook/data.js';
import { applyEvent, applyPing, bundleProblems, challengeProgress, newProgress, openChapters, seasonView, startExpedition, unlocksOf } from '../../roadbook/engine.js';
import { createTrack, metresBetween, trackSamples } from '../../roadbook/geo.js';
import { stageTargets } from '../../roadbook/expedition.js';

const all = await loadRoadbook(async f => JSON.parse(fs.readFileSync(f, 'utf8')));
const { season, bundle } = seasonView(all);
const ev = (P, type, data = {}) => applyEvent(bundle, season, P, { type, data });

// a drive from a to b: samples every half second at speed (m/s), starting at clientT
function drive(a, b, { speed = 20, t0 = 0, step = 500 } = {}) {
  const d = metresBetween(a, b), n = Math.max(1, Math.ceil(d / (speed * step / 1000))), out = [];
  for (let i = 0; i <= n; i++) out.push([a.lat + (b.lat - a.lat) * i / n, a.lon + (b.lon - a.lon) * i / n, t0 + i * step]);
  return out;
}
// pings of at most 10 samples, the server's clock moving with the client's
function pingAll(P, samples, now0 = 1e12, history = { places: {} }) {
  const awards = [], events = [];
  for (let i = 0; i < samples.length; i += 10) {
    const part = samples.slice(i, i + 10), now = now0 + part[part.length - 1][2];
    const r = applyPing(bundle, season, P, history, { samples: part, carId: 'starter_car' }, now);
    awards.push(...r.awards); events.push(...r.events);
  }
  return { awards, events };
}

test('the files are right: the season, its shop and its Expedition', () => {
  assert.deepEqual(bundleProblems(all), []);
  assert.equal(season.chapters.length, 3);
  assert.ok(season.challenges.length >= 10 && season.challenges.length <= 15);
  assert.equal(all.seasons.after_hours.shop.items.length, 6);
  const broken = structuredClone(all);
  broken.seasons.after_hours.season.challenges[0].goal.event = 'nonsense';
  broken.seasons.after_hours.shop.items[0].price = -5;
  const p = bundleProblems(broken);
  assert.ok(p.some(x => /no event "nonsense"/.test(x)) && p.some(x => /price/.test(x)), p.join('\n'));
});

test('challenges count events; a chapter opens on points, without every challenge done; a challenge met in a closed chapter completes when it opens', () => {
  const P = newProgress(season);
  assert.deepEqual(openChapters(season, P), ['first_night_out']);
  // (fitting 5 parts: chapter 1's "first mod" now; chapter 2's "garage hours" counted, not yet paid — its chapter's closed)
  let awards = [];
  for (let i = 0; i < 5; i++) awards.push(...ev(P, 'part_installed', { partId: 'x' }).awards);
  assert.deepEqual(awards.map(a => a.key), ['ch:ah_fit_part']);
  assert.deepEqual(challengeProgress(season.challenges.find(c => c.id === 'ah_fit_5'), P.challenges.ah_fit_5), { have: 5, need: 5 });
  assert.equal(P.challenges.ah_fit_5.done, undefined);
  // 3 of chapter 1's 4 challenges: 120 points — chapter 2 opens (the photo not needed), and garage hours completes at once
  awards = [...ev(P, 'race_finished', { win: null, questType: 'time_trial', medal: 'silver' }).awards, ...ev(P, 'distance_driven', { metres: 25000 }).awards];
  assert.equal(P.points, 120 + 60);
  assert.deepEqual(openChapters(season, P), ['first_night_out', 'the_underground']);
  assert.ok(awards.some(a => a.key === 'ch:ah_fit_5' && a.tokens === 40));
  // the milestone: chapter 1's tokens once all its challenges are done
  awards = ev(P, 'photo_saved').awards;
  assert.deepEqual(awards.map(a => [a.key, a.tokens]), [['ch:ah_photo', 15], ['ms:first_night_out', 100]]);
  assert.deepEqual(ev(P, 'photo_saved').awards, [], 'paid once');
});

test('a streak: wins in a row, a loss starts it again, a race with no one to beat doesn\'t count either way', () => {
  const P = newProgress(season);
  P.points = 200;                                                   // (chapter 2 open)
  const race = win => ev(P, 'race_finished', { win, questType: 'sprint', medal: win ? 'gold' : 'bronze' });
  race(true); race(true); race(false);
  assert.equal(P.challenges.ah_win_streak_3.streak, 0);
  race(true); ev(P, 'race_finished', { win: null, questType: 'time_trial' }); race(true);
  const a = race(true).awards;
  assert.ok(a.some(x => x.key === 'ch:ah_win_streak_3'), 'three wins with a time trial between them');
});

test('the track: what was driven counts; a jump (teleport) counts nothing and nothing is believed until driven a little; a ping sent twice counts once', () => {
  const a = { lat: -34.9238, lon: 138.5999 }, b = { lat: -34.9238, lon: 138.6099 };
  const s = drive(a, b);
  let r = { track: createTrack() }, metres = 0;
  for (let i = 0; i < s.length; i += 10) { r = trackSamples(r.track, s.slice(i, i + 10), 1e12 + s[Math.min(i + 9, s.length - 1)][2]); metres += r.metres; }
  assert.ok(Math.abs(metres - metresBetween(a, b)) < 2, `${metres}`);
  assert.ok(r.points.at(-1).trusted);
  // the same ping again: nothing
  assert.equal(trackSamples(r.track, s.slice(-10), 1e12 + 61_000).metres, 0);
  // a jump 10 km away in half a second: not driven, not believed
  const far = { lat: -34.99, lon: 138.6 }, t = r.track.clientT;
  r = trackSamples(r.track, [[far.lat, far.lon, t + 500], [far.lat, far.lon + 0.0001, t + 1000]], 1e12 + 62_000);
  assert.ok(r.metres < 20 && r.points.every(p => !p.trusted));
  // more time in the samples than has passed on the server: not believed
  const r2 = trackSamples(r.track, drive(far, a, { t0: t + 1500 }), 1e12 + 63_000);
  assert.equal(r2.metres, 0);
});

test('places: discovered once by driving there (a hidden one pays its tokens once); not by teleporting there', () => {
  const P = newProgress(season), lofty = bundle.places.find(p => p.id === 'adl_mount_lofty'), osmond = bundle.places.find(p => p.id === 'adl_mount_osmond');
  const from = { lat: osmond.lat + 0.01, lon: osmond.lon };
  const { events, awards } = pingAll(P, drive(from, osmond));
  assert.ok(events.some(e => e.type === 'place_discovered' && e.data.place === 'adl_mount_osmond'));
  assert.ok(awards.some(a => a.key === 'pl:adl_mount_osmond' && a.tokens === season.discoveries.hiddenTokens));
  // teleported onto Mount Lofty: no
  const t = P.track.clientT;
  const r = applyPing(bundle, season, P, { places: {} }, { samples: [[lofty.lat, lofty.lon, t + 500], [lofty.lat, lofty.lon, t + 1000]] }, 1e12 + 1e6);
  assert.ok(!r.events.some(e => e.type === 'place_discovered'));
});

test('the Midnight Run: each stage by driving to it, saved and picked up again; the clue, the flyers, the timed hill run (late starts it again), the finale', () => {
  const exp = bundle.expeditions.midnight_run, P = newProgress(season);
  assert.ok(startExpedition(bundle, season, P, 'midnight_run', 0).ok);
  let now = 1e12, t = 0, awards = [];
  const go = (to, speed = 25) => {
    const from = P.track.lat === null ? { lat: to.lat + 0.005, lon: to.lon } : { lat: P.track.lat, lon: P.track.lon };
    const s = drive(from, to, { speed, t0: t + 500 }); t = s.at(-1)[2];
    const r = pingAll(P, s, now); awards.push(...r.awards);
    return r;
  };
  const stage = () => exp.stages[P.expeditions.midnight_run.stage]?.id;
  go(exp.stages[0].location);
  assert.equal(stage(), 'clue');
  // saved and picked up again: the state is plain data
  P.expeditions.midnight_run = JSON.parse(JSON.stringify(P.expeditions.midnight_run));
  go(exp.stages[1].location);
  assert.equal(stage(), 'flyers');
  go(exp.stages[2].items[0]); go(exp.stages[2].items[1]);
  assert.deepEqual(P.expeditions.midnight_run.collected, ['flyer_west', 'flyer_mid']);
  assert.equal(stageTargets(exp.stages[2], P.expeditions.midnight_run).length, 1);
  go(exp.stages[2].items[2]);
  assert.equal(stage(), 'hill_run');
  // the hill run too slowly (5 m/s): out of time, back to the start
  const cps = exp.stages[3].checkpoints;
  const notices = [];
  notices.push(...go(cps[0], 25).events); for (const c of cps.slice(1)) notices.push(...go(c, 5).events);
  assert.equal(stage(), 'hill_run');
  assert.ok(notices.some(e => e.type === 'notice' && e.data.kind === 'failed'), 'out of time');
  // at speed
  go(cps[0], 30); for (const c of cps.slice(1)) go(c, 30);
  assert.equal(stage(), 'lookout');
  assert.ok(P.expeditions.midnight_run.times.hill_run < exp.stages[3].timeLimitSec * 1000);
  go(exp.stages[4].location);
  assert.equal(P.expeditions.midnight_run.done, true);
  const keys = awards.map(a => a.key);
  for (const s of exp.stages) assert.equal(keys.filter(k => k === `xs:midnight_run:${s.id}`).length, 1, s.id);
  assert.ok(P.challenges.ah_midnight_run.n === 1, 'the challenge heard it');
});

test('what owning items unlocks: their grants together', () => {
  const u = unlocksOf(all, ['ah_paint_midnight', 'ah_collection']);
  assert.deepEqual([...u.finishes].sort(), ['afterglow_anodised', 'afterglow_pearl', 'midnight_metallic']);
  assert.deepEqual([...u.badges], ['after_hours_collector']);
});
