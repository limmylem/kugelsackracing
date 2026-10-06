// Generated tracks' quality, variety and identity (Phase 5 Step 4), the quick checks (npm run test:unit; the
// 10,000-a-preset report: npm run track-variety): the quality score (track/quality.js) — deterministic,
// its parts, the config's weights; how alike two layouts are; the day's, the week's and the quick races'
// tracks through their gates (a seed under it skipped for the next derived one, the same everywhere; the
// day's not like the days before); the names of tracks and their corners from the seed; an event's
// conditions (time of day and weather) over its theme's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateTrack } from '../../track/generate.js';
import { dressTrack } from '../../track/dress.js';
import { qualityOf, aiCloseness, layoutSignature, similarity } from '../../track/quality.js';
import { dailyTrack, weeklyTrack, quickTrack, dayKey, eventsFor } from '../../track/events/model.js';
import { trackName, cornerNames } from '../../track/names.js';
import { themeEnvironment, eventConditions } from '../../track/renderDress.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const TC = json('data/tracks.json'), E = json('data/trackEvents.json');
const preset = id => TC.presets.find(p => p.id === id);
const made = (id, seed) => { const g = generateTrack({ seed, params: preset(id).params }); return { g, plan: dressTrack(g, TC) }; };

test('the quality score: the same for the same track, 0–100 from parts 0–1, weighted as the config says', () => {
  const { g, plan } = made('mixed_gp', 5), q = qualityOf(g, plan, TC);
  const again = made('mixed_gp', 5), q2 = qualityOf(again.g, again.plan, TC);
  assert.deepEqual(q, q2, 'deterministic');
  assert.ok(q.score >= 0 && q.score <= 100 && q.gate === q.score, 'without an AI race: the score is the gate');
  for (const [k, v] of Object.entries(q.parts)) assert.ok(v >= 0 && v <= 1, `${k} ${v}`);
  for (const k of ['variety', 'flow', 'overtaking', 'elevation', 'safety']) assert.ok(k in q.parts, k);
  // a close AI race lifts the score, a strung-out one lowers it — the gate (the same on every machine) as it was
  const hi = qualityOf(g, plan, TC, { ai: 1 }), lo = qualityOf(g, plan, TC, { ai: 0 });
  assert.ok(hi.score >= q.score && lo.score <= q.score && hi.gate === q.gate && lo.gate === q.gate && hi.parts.ai === 1);
  // the weights: only safety's → the score is safety's part
  const only = structuredClone(TC); for (const k of Object.keys(only.quality.weights)) only.quality.weights[k] = k === 'safety' ? 1 : 0;
  assert.ok(Math.abs(qualityOf(g, plan, only).score - 100 * q.parts.safety) < 0.6);
  // the AI race's closeness: bunched finishers and passes high; a procession strung out, low
  const close = aiCloseness([{ status: 'finished', time: 100 }, { status: 'finished', time: 101 }, { status: 'finished', time: 102.5 }], { raceTime: 100, overtakes: 4, cars: 3 }, TC);
  const apart = aiCloseness([{ status: 'finished', time: 100 }, { status: 'finished', time: 115 }, { status: 'dnf', time: null }], { raceTime: 100, overtakes: 0, cars: 3 }, TC);
  assert.ok(close > 0.8 && apart < 0.2, `${close} ${apart}`);
});

test('how alike two layouts are: a circuit is itself backwards and from any start; different seeds differ', () => {
  const a = layoutSignature(made('mixed_gp', 11).g);
  assert.ok(similarity(a, a) > 0.99);
  const turned = { ...a, bins: a.bins.map((_, i) => a.bins[(i + 17) % a.bins.length]) }, backwards = { ...a, bins: a.bins.slice().reverse().map(v => -v) };
  assert.ok(similarity(a, turned) > 0.99 && similarity(a, backwards) > 0.99);
  const sprint = layoutSignature(made('mountain_hillclimb', 11).g);
  assert.equal(similarity(a, sprint), 0, 'a circuit is nothing like a sprint');
  const many = Array.from({ length: 24 }, (_, k) => layoutSignature(made('mixed_gp', 100 + k).g));
  let most = 0, sum = 0, pairs = 0;
  for (let i = 0; i < many.length; i++) for (let j = i + 1; j < many.length; j++) { const s = similarity(many[i], many[j]); most = Math.max(most, s); sum += s; pairs++; }
  assert.ok(most < TC.variety.similarity.duplicate && sum / pairs < 0.6, `the most alike ${most}, on average ${sum / pairs}`);
});

test('the day\'s and the week\'s tracks: generator v3 through the gate from the rules\' dates, unlike the days before; the old days as they were', async () => {
  const D = E.daily.rules.at(-1), W = E.weekly.rules.at(-1), min = TC.quality.min;
  assert.equal(D.version, 3); assert.ok(D.quality);
  // (before the rule: version 2, no gate — the days already played keep their tracks)
  const before = dailyTrack(Date.parse(`${D.from}T00:00:00Z`) - 864e5, E, TC);
  assert.equal(before.version, 2); assert.equal(before.quality, null);
  const t0 = Date.parse(`${D.from}T12:00:00Z`), days = [];
  for (let d = 0; d < 21; d++) {
    const t = dailyTrack(t0 + d * 864e5, E, TC);
    assert.equal(t.version, 3); assert.ok(t.quality.gate >= min.daily, `${dayKey(t0 + d * 864e5)}: ${t.quality.gate}`);
    for (const s of t.skipped) assert.match(s.why, /^(score|too like|no track)/);
    days.push(t);
  }
  // every day differs from the days before it
  for (let d = 1; d < days.length; d++) for (let e = Math.max(0, d - D.similar.recent); e < d; e++) {
    const s = similarity(layoutSignature(days[d].gen), layoutSignature(days[e].gen));
    assert.ok(s < TC.variety.similarity.duplicate, `${days[d].key} like ${days[e].key} (${s})`);
  }
  // deterministic: a fresh copy of the model (no memory of these) makes the same tracks
  const fresh = await import(`../../track/events/model.js?fresh=${Date.now()}`);
  for (const d of [0, 6, 13]) { const a = days[d], b = fresh.dailyTrack(t0 + d * 864e5, E, TC); assert.equal(b.code, a.code); assert.deepEqual(b.skipped, a.skipped); }
  // a stricter gate: seeds under it skipped for the next derived seed — the same ones in two fresh copies
  const strict = structuredClone(TC); strict.quality.min.daily = 86;
  const s1 = await import(`../../track/events/model.js?strict1=${Date.now()}`), s2 = await import(`../../track/events/model.js?strict2=${Date.now()}`);
  let skips = 0;
  for (let d = 0; d < 6; d++) {
    const a = s1.dailyTrack(t0 + d * 864e5, E, strict), b = s2.dailyTrack(t0 + d * 864e5, E, strict);
    assert.equal(a.code, b.code); assert.deepEqual(a.skipped, b.skipped); assert.ok(a.quality.gate >= 86);
    skips += a.skipped.filter(s => /^score/.test(s.why)).length;
  }
  assert.ok(skips > 0, 'the stricter gate turned some seeds down');
  // the week's: version 3 and its own gate from its rule's week
  const w0 = Date.parse(`${W.from}T12:00:00Z`);
  for (let k = 0; k < 6; k++) { const w = weeklyTrack(w0 + k * 7 * 864e5, E, TC); assert.equal(w.version, 3); assert.ok(w.quality.gate >= min.weekly, `${w.key}: ${w.quality.gate}`); }
});

test('quick races: the first derived seed through the quick gate, the same every time', () => {
  for (const P of TC.presets) for (const seed of [1, 77, 4242]) {
    const a = quickTrack(P.id, seed, TC), b = quickTrack(P.id, seed, TC);
    assert.equal(a.code, b.code);
    assert.ok(a.quality.gate >= TC.quality.min.quick, `${P.id} ${seed}: ${a.quality.gate}`);
  }
});

test('names: the track\'s from its seed and theme; its notable corners each named once', () => {
  assert.equal(trackName(1234, { theme: 'forest' }), trackName(1234, { theme: 'forest' }));
  const names = new Set(Array.from({ length: 60 }, (_, s) => trackName(s * 7919, { theme: 'coastal' })));
  assert.ok(names.size > 30, `${names.size} names of 60 seeds`);
  assert.match(trackName(5, { theme: 'mountain', layout: 'p2p' }), / (Hillclimb|Pass|Climb|Sprint|Road|Run)$/);
  assert.match(trackName(5, { theme: 'street' }), / (Street Circuit|Grand Prix|Circuit|Street Race)$/);
  let signatures = 0;
  for (let s = 1; s <= 30; s++) {
    const { g, plan } = made(s % 2 ? 'mixed_gp' : 'short_technical', s), C = cornerNames(g, plan), again = cornerNames(g, plan);
    assert.deepEqual(C, again);
    assert.ok(C.length >= 2 && C.length <= 6, `${C.length} named corners`);
    assert.equal(new Set(C.map(c => c.n)).size, C.length, 'each corner once');
    assert.ok(C.every(c => c.name && Number.isFinite(c.x) && Number.isFinite(c.z)));
    if (['long_hairpin', 'fast_esses', 'banked_corner'].includes(g.track.signature?.kind) && C.some(c => c.kind === 'signature')) signatures++;
  }
  assert.ok(signatures >= 5, `${signatures} signature corners named`);
});

test('conditions: an event\'s time of day and weather over the theme\'s; floodlights on circuits after dark; rain wet, its grip only through the hook', () => {
  const C = TC.conditions, look = { time: 'afternoon', weather: 'clear', sky: '#88aadd' };
  const own = themeEnvironment(look, { conditions: C });
  assert.equal(own.time, 'afternoon'); assert.equal(own.hours, C.times.afternoon.hours); assert.equal(own.floodlit, null); assert.equal(own.rain, 0);
  const night = themeEnvironment(look, { time: 'night', conditions: C, closed: true });
  assert.ok(night.night && night.floodlit, 'a circuit at night: floodlit');
  assert.equal(themeEnvironment(look, { time: 'night', conditions: C, closed: false }).floodlit, null, 'a mountain road: no floodlights');
  assert.ok(themeEnvironment(look, { time: 'dusk', conditions: C }).warm > 0, 'dusk: warm');
  const wet = themeEnvironment(look, { weather: 'rain', conditions: C });
  assert.ok(wet.rain > 0 && wet.wet && wet.grip < 1 && wet.sunScale < 1);
  assert.equal(wet.applyGrip, !!C.applyGrip, 'the grip changes only when the config says');
  // a quest's conditions: any → the theme's; day on a dusk theme → midday; night → night
  assert.deepEqual(eventConditions({ timeOfDay: 'any', weather: 'any' }, look, C), { time: null, weather: null });
  assert.deepEqual(eventConditions({ timeOfDay: 'night', weather: 'rain' }, look, C), { time: 'night', weather: 'rain' });
  assert.equal(eventConditions({ timeOfDay: 'day' }, { ...look, time: 'dusk' }, C).time, 'midday');
  assert.equal(eventConditions({ timeOfDay: 'day' }, look, C).time, 'afternoon');
  // the day's events: their own time of day and weather now and then (by the config's weights, from the
  // code: the same for everyone), the theme's own most days
  const seen = new Set(); let ownDays = 0, n = 0;
  for (let d = 0; d < 20; d++) {
    const t = dailyTrack(Date.UTC(2026, 9, 1) + d * 864e5, E, TC), a = eventsFor(t, E), b = eventsFor(t, E);
    assert.deepEqual(a.map(e => e.conditions), b.map(e => e.conditions));
    for (const e of a) { n++; if (e.conditions.timeOfDay === 'any' && e.conditions.weather === 'any') ownDays++; seen.add(e.conditions.timeOfDay); seen.add(e.conditions.weather); }
  }
  assert.ok(ownDays > n / 3 && ownDays < n, `${ownDays} of ${n} events in the theme's own conditions`);
  assert.ok(seen.has('night') && seen.has('rain'), [...seen].join(' '));
  // every theme looks right at every time of day: a time and hours for each
  for (const t of Object.keys(C.times)) for (const th of Object.values(TC.themes).filter(x => x?.look)) {
    const env = themeEnvironment(th.look, { time: t, conditions: C, closed: true });
    assert.ok(env.hours > 0 && env.hours < 24 && env.sky);
  }
});
