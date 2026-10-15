// Phase 8 Step 4's game logic, without a browser: the driving tutorial (each step done by driving it; the assists its
// driving suggests), the driving school's lessons (measured from made-up drives, medals as the server works them out),
// choosing a starter car (once, only at the start), settings (merged, what follows the player between devices, hold or
// toggle), the race music's intensity and layers, photo filters, share links, the news' patch notes and its text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTutorial, STEPS } from '../../play/tutorialLogic.js';
import { createLesson, medalOf, COURSES } from '../../play/schoolLogic.js';
import { sampleOf } from '../../play/onboarding.js';
import { raceIntensity, RACE_LAYERS, PIECES } from '../../audio/music.js';
import { applyFilter, FILTERS } from '../../play/photoMode.js';
import { shareLink, readDeepLink } from '../../ui/share.js';
import { patchNotesToShow, renderBody } from '../../ui/news.js';
import { medalFor } from '../../server/src/routes/launch.ts';

const school = JSON.parse(fs.readFileSync('data/school.json', 'utf8'));
const lesson = id => school.lessons.find(l => l.id === id);

test('the tutorial: each step done by driving it, in order; the advice follows the driving', () => {
  const T = createTutorial({ aids: { tc: false, abs: true, esc: false, countersteer: true, steering: true } });
  const drive = (n, s) => { for (let i = 0; i < n; i++) T.update({ dt: 0.05, ...s }); };
  assert.equal(T.step, 'throttle');
  drive(20, { kmh: 45, throttle: 1, wheelspin: true });                       // (spinning the wheels on the way)
  assert.equal(T.step, 'braking');
  drive(10, { kmh: 50, brake: 1 }); drive(2, { kmh: 1, brake: 1 });
  assert.equal(T.step, 'cornering');
  const turn = (kmh, grip) => { drive(45, { kmh, yawRate: 0.5, gripUsed: grip }); drive(4, { kmh, yawRate: 0 }); };
  turn(30, 0.4); turn(30, 0.4);
  assert.equal(T.step, 'line');
  turn(45, 0.7);
  assert.equal(T.step, 'tyres');
  drive(30, { kmh: 60, gripUsed: 0.95 });
  assert.equal(T.step, 'assists');
  const advice = T.advice();
  assert.ok(advice.some(a => a.aid === 'tc' && a.on), 'wheelspin: traction control suggested');
  T.update({ dt: 0.05, kmh: 0, ack: true });
  assert.equal(T.done, true);
  assert.equal(STEPS.length, 6);
  // a clean driver is offered an aid off
  const C = createTutorial({ aids: { steering: true } });
  for (let i = 0; i < 2000; i++) C.update({ dt: 0.05, kmh: 50 });
  assert.deepEqual(C.advice(), [{ aid: 'steering', on: false, why: 'clean' }]);
  assert.equal(createTutorial().skip().done, true);
});

test('the driving school: each lesson measured from a drive; medals as the server gives them; impossible runs refused', () => {
  // braking zone: up to speed, then stop 1 m short of the line → gold
  const B = createLesson(lesson('braking-zone'));
  let t = 0, z = 0;
  const step = s => B.update({ t: t += 0.05, dt: 0.05, ...s });
  for (; z < 80; z += 2) step({ pos: [0, z], kmh: 100, brake: 0 });
  assert.equal(B.state().phase, 'run');
  for (; z < 119; z += 1) step({ pos: [0, z], kmh: 50, brake: 1 });
  const r = step({ pos: [0, 119], kmh: 0, brake: 1 });
  assert.equal(r.done, true); assert.equal(r.value, 1);
  assert.equal(medalOf(lesson('braking-zone'), r.value), 'gold');
  // threshold braking: too slow when braking → failed
  const T = createLesson(lesson('threshold-braking'));
  T.update({ t: 0, pos: [0, 0], kmh: 100, brake: 0 }); const f = T.update({ t: 1, pos: [0, 20], kmh: 60, brake: 1 });
  assert.equal(f.failed, true); assert.equal(f.tip, 'school.fail.tooSlow');
  // cornering: through every gate in 20.5 s → silver; missing one fails
  const L = createLesson(lesson('cornering-line')), G = COURSES.hairpins.gates;
  let prev = [0, 0], tt = 0; L.update({ t: 0, pos: [0, 0], kmh: 0 }); L.update({ t: 0.1, pos: [0, 6], kmh: 30 });
  for (const g of G) { for (let k = 1; k <= 10; k++) { tt += 20.5 / G.length / 10; L.update({ t: 0.1 + tt, pos: [prev[0] + (g[0] - prev[0]) * k / 10, prev[1] + (g[1] - prev[1]) * k / 10], kmh: 80 }); } prev = g; }
  assert.equal(L.state().done, true);
  assert.equal(medalOf(lesson('cornering-line'), L.state().value), 'silver');
  const M = createLesson(lesson('cornering-line'));
  M.update({ t: 0, pos: [0, 0], kmh: 0 }); M.update({ t: 1, pos: [0, 6], kmh: 30 }); M.update({ t: 2, pos: [0, 59], kmh: 60 }); M.update({ t: 3, pos: [-30, 140], kmh: 60 });
  assert.equal(M.state().failed, true);
  // drift: 8 s of slide on the circle in 30 s → gold
  const D = createLesson(lesson('drift-intro')), c = COURSES.skidpad.circle;
  for (let i = 0; i <= 620; i++) { const a = i / 50; D.update({ t: i * 0.05, dt: 0.05, pos: [c.at[0] + c.r * Math.cos(a), c.at[1] + c.r * Math.sin(a)], kmh: 40, rearSlipDeg: i < 160 ? 25 : 2 }); }
  assert.equal(D.state().done, true); assert.ok(Math.abs(D.state().value - 8) <= 0.1, String(D.state().value)); assert.equal(medalOf(lesson('drift-intro'), D.state().value), 'gold');
  // slalom: two cones hit
  const S = createLesson(lesson('car-control')), cones = COURSES.slalom.cones;
  S.update({ t: 0, pos: [0, 0], kmh: 0 }); S.update({ t: 1, pos: [0, 25], kmh: 50 });
  let time = 1;
  for (let zz = 30; zz <= COURSES.slalom.finish + 2; zz += 1) { time += 0.1; const near = cones.find(k => Math.abs(k[1] - zz) < 0.6); S.update({ t: time, pos: [near && (near === cones[3] || near === cones[6]) ? near[0] : near ? -near[0] * 2 : 0, zz], kmh: 50 }); }
  assert.equal(S.state().done, true); assert.equal(S.state().value, 2);
  // the server's medal: the same thresholds; outside a lesson's bounds: not a real run
  for (const l of school.lessons) for (const m of ['bronze', 'silver', 'gold']) assert.equal(medalFor(l, l.medals[m]), m, `${l.id} ${m}`);
  assert.equal(medalFor(lesson('threshold-braking'), 10), 'invalid');
  // every lesson has its words and its course
  const en = JSON.parse(fs.readFileSync('locales/en.json', 'utf8'));
  for (const l of school.lessons) { for (const k of ['title', 'text', 'lesson']) assert.ok(en[`school.lesson.${l.id}.${k}`], `${l.id} ${k}`); if (l.setup.course) assert.ok(COURSES[l.setup.course], l.setup.course); }
});

test('the lesson frame: the car\'s position from the lesson\'s start, turned with its heading', () => {
  const s = sampleOf({ speed: 10, position: [10, 0, 5], wheels: [] }, 0.1, { origin: [10, 0], headingRad: Math.PI / 2 });
  assert.ok(Math.abs(s.pos[0] - -5) < 1e-9 && Math.abs(s.pos[1]) < 1e-9, JSON.stringify(s.pos));
  assert.equal(s.kmh, 36);
});

test('choosing a starter car: once, only at the very start, only one of the choices', async () => {
  const { LocalPlayerService } = await import('../../garage/player/service.js');
  const { MemoryStorage } = await import('../../garage/player/storage.js');
  const { loadGarageData } = await import('../../garage/data.js');
  const { db } = await loadGarageData(p => JSON.parse(fs.readFileSync(p, 'utf8')));
  const S = new LocalPlayerService({ db, storage: new MemoryStorage() });
  await S.init();
  assert.equal((await S.chooseStarter('apex_v8')).ok, false, 'not a choice');
  const r = await S.chooseStarter('hana_roadster');
  assert.equal(r.ok, true, r.error);
  assert.equal(S.profile.cars[S.profile.currentCar].carId, 'hana_roadster');
  assert.equal(Object.keys(S.profile.cars).length, 1);
  assert.equal((await S.chooseStarter('starter_car')).ok, false, 'once');
});

test('settings: saved over the defaults; the graphics stay on the device; hold or toggle', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const { defaultSettings, loadSettings, saveSettings, portable, mergeSettings, onSave } = await import('../../testtrack/settings.js');
  const spec = JSON.parse(fs.readFileSync('data/cars/starter_car/car.json', 'utf8'));
  const { Garage } = await import('../../garage/data.js');
  const { loadGarageData } = await import('../../garage/data.js');
  const { db } = await loadGarageData(p => JSON.parse(fs.readFileSync(p, 'utf8')));
  const S = defaultSettings(new Garage(db, null, 'starter_car').stats().spec);
  assert.equal(S.a11y.flashing, 'reduced', 'flashing reduced by default');
  assert.equal(S.privacy.analytics, null, 'statistics not until asked');
  let heard = 0; const off = onSave(() => heard++);
  S.graphics = { preset: 'ultra' }; S.language = 'en-AU';
  saveSettings(S);
  assert.equal(heard, 1); off();
  assert.ok(S.updatedAt > 0);
  assert.equal(portable(S).graphics, undefined);
  assert.equal(portable(S).language, 'en-AU');
  const M = mergeSettings(defaultSettings(new Garage(db, null, 'starter_car').stats().spec), { palette: 'colourblind', a11y: { textSize: 1.4 } });
  assert.equal(M.a11y.colours, 'deuteranopia', 'the older colour-blind palette carried over');
  assert.equal(M.a11y.textSize, 1.4); assert.equal(M.a11y.flashing, 'reduced', 'the rest of the group from the defaults');
  void spec; void loadSettings;
  // hold or toggle: a toggled handbrake stays on after the key's let go
  const { InputManager } = await import('../../testtrack/input.js');
  globalThis.addEventListener ??= () => {};
  const I = new InputManager({ ...S, toggles: { handbrake: true } }, () => []);
  I.enabled = true;
  const key = (code, down) => I.onKey({ code, target: null, repeat: false, timeStamp: 0, preventDefault() {} }, down);
  key('Space', true); key('Space', false);
  assert.equal(I.keyboardState().handbrake, true, 'toggled on');
  key('Space', true); key('Space', false);
  assert.equal(I.keyboardState().handbrake, false, 'and off');
});

test('the race music: builds with the last lap and a close race; its layers come in with the intensity', () => {
  assert.ok(raceIntensity({ lap: 1, laps: 3 }) < 0.4);
  assert.ok(raceIntensity({ lap: 3, laps: 3 }) > raceIntensity({ lap: 2, laps: 3 }));
  assert.ok(raceIntensity({ lap: 1, laps: 3, gapAhead: 0.3 }) > raceIntensity({ lap: 1, laps: 3, gapAhead: 5 }));
  assert.ok(raceIntensity({ lap: 3, laps: 3, gapBehind: 0.2 }) >= 0.95);
  assert.deepEqual(Object.entries(RACE_LAYERS).filter(([, v]) => v === 0).map(([k]) => k), ['kick', 'bass', 'pad']);
  for (const p of Object.values(PIECES)) assert.ok(p.bpm > 60 && p.chords.length >= 3);
});

test('photo filters: the same colour change on the saved photo as on the screen', () => {
  const px = () => ({ data: new Uint8ClampedArray([200, 100, 50, 255]) });
  assert.deepEqual([...applyFilter(px(), 'none').data], [200, 100, 50, 255]);
  const m = applyFilter(px(), 'mono').data;
  assert.equal(m[0], m[1]); assert.equal(m[1], m[2]);
  const w = applyFilter(px(), 'warm').data;
  assert.ok(w[0] > 200 && w[2] < 50);
  for (const [k, M] of Object.entries(FILTERS)) if (M) assert.equal(M.length, 4, k);
});

test('share links: made and read back, anything odd refused', () => {
  const code = 'ABCDEFGHJKMNPQRSTVWXYZ2345';
  for (const L of [{ kind: 'track', code }, { kind: 'challenge', code, ms: 93412, by: 'Ann', carClass: 'C' }, { kind: 'quest', id: 'q_123' }, { kind: 'region', id: 'adelaide' }, { kind: 'place', lat: -34.9275, lon: 138.6 }]) {
    const u = shareLink(L, 'https://ognistrada.com');
    assert.ok(u.startsWith('https://ognistrada.com/?'), u);
    assert.deepEqual(readDeepLink(new URL(u).search), L.kind === 'challenge' ? { ...L } : L, u);
  }
  assert.equal(readDeepLink('?quest=<script>'), null);
  assert.equal(readDeepLink('?track=short'), null);
  assert.equal(readDeepLink('?track=ABCDEFGHJKMNPQRSTVWXYZ2345&beat=-5').kind, 'track', 'a bad time: just the track');
  assert.equal(readDeepLink('?at=200,10'), null);
});

test('news: patch notes after an update, once; its text plain with lists, never HTML', () => {
  const items = [{ id: 'a', kind: 'patch', version: 'v2', startsAt: '2026-10-12T00:00:00Z' }, { id: 'b', kind: 'news', startsAt: '2026-10-12T00:00:00Z' }];
  assert.deepEqual(patchNotesToShow(items, { version: 'v2', lastVersion: 'v1' }).map(i => i.id), ['a']);
  assert.deepEqual(patchNotesToShow(items, { version: 'v2', lastVersion: 'v2' }), []);
  assert.equal(renderBody('Faster now\n- one <b>\n- two'), '<p>Faster now</p><ul><li>one &lt;b&gt;</li><li>two</li></ul>');
});
