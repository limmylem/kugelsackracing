// Phase 4 Step 5 polish: the quest's sounds (play/questSounds.js: every event that should be heard has a
// sound, the results' come in order), the camera's glides between views (play/cameraBlend.js: smooth,
// continuous, cut when too far), the accessibility palettes and route guides (play/palette.js: the
// colour-blind palette reads apart for protanopia, deuteranopia and tritanopia), the first-time hints for
// quests (data/hints.json), and the settings that hold them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CUES, cueOf, resultCues } from '../../play/questSounds.js';
import { createCameraBlend, orbitPose, DEFAULT_TIMES } from '../../play/cameraBlend.js';
import { PALETTES, GUIDES, VISION, colourDistance, paletteOf, guideStyle } from '../../play/palette.js';
import { Hints } from '../../garage/hints.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));

test('quest sounds: every event a player should hear has a cue, and every cue is a playable sound', () => {
  const heard = [
    [{ type: 'count', n: 3 }, 'count'], [{ type: 'go' }, 'go'],
    [{ type: 'checkpoint', delta: null }, 'checkpoint'], [{ type: 'checkpoint', delta: -0.4 }, 'splitAhead'], [{ type: 'checkpoint', delta: 0.4 }, 'splitBehind'],
    [{ type: 'bonus' }, 'bonus'], [{ type: 'lap', best: false }, 'lap'], [{ type: 'lap', best: true }, 'lapBest'],
    [{ type: 'missed' }, 'wrong'], [{ type: 'jump' }, 'wrong'], [{ type: 'drift-lost' }, 'wrong'], [{ type: 'drift-bank', points: 300 }, 'bonus'],
    [{ type: 'finish' }, 'finish'], [{ type: 'fail' }, 'fail'],
  ];
  for (const [e, cue] of heard) assert.equal(cueOf(e), cue, e.type);
  // (quiet: where nothing should sound)
  for (const e of [{ type: 'place' }, { type: 'clock' }, { type: 'intro' }, { type: 'drift-bank', points: 0 }, null]) assert.equal(cueOf(e), null);
  for (const [name, notes] of Object.entries(CUES)) {
    assert.ok(notes.length, name);
    for (const n of notes) {
      assert.ok(n.f >= 60 && n.f <= 5000, `${name}: ${n.f} Hz is in the comfortable range`);
      assert.ok(n.len > 0 && n.len <= 1.5 && n.at >= 0 && n.at + n.len <= 2, `${name}: short`);
      assert.ok(n.gain > 0 && n.gain <= 0.7, `${name}: not too loud`);
      assert.ok(['sine', 'square', 'sawtooth', 'triangle'].includes(n.wave), name);
    }
  }
  // the ahead / behind chimes are told apart by pitch (going up vs going down), not just by colour
  const rise = c => CUES[c].at(-1).f - CUES[c][0].f;
  assert.ok(rise('splitAhead') > 0 && rise('splitBehind') < 0);
});

test('quest sounds: the results play the medal, a personal best, the money and a level-up, in turn; nothing for a DNF', () => {
  const gold = resultCues({ outcome: { status: 'finished', medal: 'gold' }, pay: { valid: true, money: 800, pb: true, levelUp: 4 } });
  assert.deepEqual(gold.map(c => c.cue), ['medalGold', 'personalBest', 'reward', 'levelUp']);
  for (let i = 1; i < gold.length; i++) assert.ok(gold[i].at > gold[i - 1].at, 'one after another');
  assert.ok(gold.at(-1).at < 4, 'all within a few seconds');
  assert.deepEqual(resultCues({ outcome: { status: 'finished', medal: 'bronze' }, pay: { valid: true, money: 0 } }).map(c => c.cue), ['medalBronze']);
  assert.deepEqual(resultCues({ outcome: { status: 'finished', medal: null }, pay: { valid: false, money: 500 } }), [], 'an unverified run pays nothing, so no coins');
  assert.deepEqual(resultCues({ outcome: { status: 'dnf' }, pay: {} }), []);
  // the gold fanfare is the longest, then silver, then bronze
  const length = c => Math.max(...CUES[c].map(n => n.at + n.len));
  assert.ok(length('medalGold') > length('medalSilver') && length('medalSilver') > length('medalBronze'));
});

const pose = (x, y = 0, z = 0) => ({ p: [x, y, z], look: [x, y, z + 10], fov: 60 });
const dist = (a, b) => Math.hypot(...a.p.map((v, k) => v - b.p[k]));

test('camera: the first view is straight there; a change of view glides there, eased, without a jump', () => {
  const B = createCameraBlend();
  assert.deepEqual(B.view('roam', pose(0), 1 / 60), pose(0));
  assert.equal(B.blending, false);
  // roam → intro: 1.1 s glide from x 0 to x 100
  const dt = 1 / 60, path = [];
  for (let i = 0; i < 90; i++) path.push(B.view('intro', pose(100), dt));
  assert.ok(path[0].p[0] > 0 && path[0].p[0] < 1, 'starts where the camera was');
  assert.deepEqual(path.at(-1).p, [100, 0, 0], 'ends on the new view');
  assert.equal(B.blending, false);
  // smooth: no step bigger than the eased curve's steepest (1.5× the average speed)
  const steps = path.slice(1).map((q, i) => dist(q, path[i])), avg = 100 / (DEFAULT_TIMES['roam>intro'] * 60);
  assert.ok(Math.max(...steps) <= avg * 1.5 + 1e-6, `largest step ${Math.max(...steps).toFixed(2)} m`);
  assert.ok(steps[0] < steps[30] && steps.at(-1) < steps[30], 'eased in and out');
  // the target moving as it glides (the car driving): it ends on the moving target
  const C = createCameraBlend();
  C.view('race', pose(0), dt);
  let out;
  for (let i = 0; i < 120; i++) out = C.view('results', pose(50 + i * 0.5), dt);
  assert.deepEqual(out.p, [50 + 119 * 0.5, 0, 0]);
});

test('camera: the same view moved (a teleport) or a new view too far away is cut to, not glided to', () => {
  const B = createCameraBlend({ cut: 400 });
  B.view('roam', pose(0), 0.016);
  assert.deepEqual(B.view('roam', pose(5000), 0.016).p, [5000, 0, 0], 'fast travel: no glide across the map');
  B.view('results', pose(5100), 0.016);
  assert.equal(B.blending, true, 'a new view near enough glides');
  B.reset(); B.view('results', pose(0), 0.016);
  assert.deepEqual(B.view('intro', pose(3000), 0.016).p, [3000, 0, 0], 'a restart back to a far start cuts');
  assert.equal(B.blending, false);
});

test('camera: the results orbit circles the car at a steady distance and height, looking at it', () => {
  const car = { x: 10, y: 3, z: -4, heading: 90 }, O = { radius: 8, height: 2.5, speed: 0.2 };
  const a = orbitPose(car, 0, O), b = orbitPose(car, 5, O);
  for (const q of [a, b]) {
    assert.ok(Math.abs(Math.hypot(q.p[0] - car.x, q.p[2] - car.z) - 8) < 1e-9);
    assert.equal(q.p[1], car.y + 2.5);
    assert.deepEqual([q.look[0], q.look[2]], [car.x, car.z]);
  }
  assert.ok(dist(a, b) > 1, 'it moves round');
});

test('accessibility: the colour-blind palette keeps good and bad, the arrow and its warning, apart for every kind of colour vision', () => {
  const C = PALETTES.colourblind, MIN = 40;   // ΔE (CIE76): ~40 is plainly different at a glance
  for (const v of VISION) {
    assert.ok(colourDistance(C.good, C.bad, v) >= MIN, `good / bad, ${v}: ${colourDistance(C.good, C.bad, v).toFixed(1)}`);
    assert.ok(colourDistance(C.arrow, C.arrowMissed, v) >= MIN, `arrow / missed, ${v}`);
    assert.ok(colourDistance(C.checkpoint[2], C.bonus[2], v) >= 25, `checkpoint / bonus gates, ${v}`);
    assert.ok(colourDistance(C.route, C.guide, v) >= 25, `route / guide lines, ${v}`);
  }
  // (why it's there: the standard red / green nearly merge for deuteranopia)
  assert.ok(colourDistance(PALETTES.standard.good, PALETTES.standard.bad, 'deuteranopia') < 20);
  // every palette has every colour; an unknown name falls back to the standard one
  const keys = Object.keys(PALETTES.standard).sort();
  for (const P of Object.values(PALETTES)) assert.deepEqual(Object.keys(P).sort(), keys);
  assert.equal(paletteOf('nope'), PALETTES.standard);
});

test('accessibility: "more visible" route guides are bigger and brighter in every way than normal ones', () => {
  const N = GUIDES.normal, B = GUIDES.bold;
  assert.ok(B.arrowOpacity > N.arrowOpacity && B.arrowScale > N.arrowScale && B.gateHeight > N.gateHeight && B.lineWidth > N.lineWidth && B.hudArrow > N.hudArrow);
  assert.ok(B.gateGlow && !N.gateGlow);
  assert.ok(B.arrowOpacity <= 1);
  assert.equal(guideStyle(undefined), N);
});

test('first-time hints for quests, medals, NPC races, pink slips and fast travel: one each, shown once, valid', async () => {
  const H = json('data/hints.json'), schema = json('data/schemas/hints.schema.json');
  const whens = ['questCard', 'medal', 'npcRace', 'pinkSlip', 'fastTravel'];
  for (const w of whens) {
    assert.ok(schema.properties.hints.items.properties.when.enum.includes(w), `schema has ${w}`);
    assert.equal(H.hints.filter(h => h.when === w && h.where === 'drive').length, 1, `one ${w} hint`);
  }
  assert.equal(new Set(H.hints.map(h => h.id)).size, H.hints.length, 'ids unique');
  // short enough to read in the few seconds a hint shows (testtrack/hintCard.js: 4 s + 1 s per 22 characters)
  for (const h of H.hints) assert.ok(h.text.length <= 170, `${h.id}: ${h.text.length} characters`);
  const seen = [], hints = new Hints(H, { seen: () => seen, mark: id => seen.push(id) });
  assert.equal(hints.note('questCard', 'drive').id, 'firstQuest');
  assert.equal(hints.note('questCard', 'drive'), null, 'once');
  assert.equal(hints.note('fastTravel', 'garage'), null, 'only where it belongs');
  assert.deepEqual(seen, ['firstQuest']);
});

test('settings: the accessibility settings have defaults, and an older save without them gets them', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { defaultSettings, loadSettings } = await import('../../testtrack/settings.js');
  const spec = { assists: { abs: { enabled: true }, tractionControl: { enabled: true, strength: 0.5 }, stability: { enabled: true }, countersteer: { enabled: false }, steering: { enabled: false }, drift: { enabled: false } }, brakes: { bias: 0.65, handbrake: { disengageClutch: true } } };
  const d = defaultSettings(spec);
  assert.deepEqual({ palette: d.palette, guides: d.guides, hudScale: d.hudScale, hints: d.hints }, { palette: 'standard', guides: 'normal', hudScale: 1, hints: true });
  store.set('driveWorld.settings.v1', JSON.stringify({ damage: 'visual' }));
  const s = loadSettings(spec);
  assert.equal(s.damage, 'visual');
  assert.equal(s.palette, 'standard');
  store.set('driveWorld.settings.v1', JSON.stringify({ palette: 'colourblind', guides: 'bold', hudScale: 1.3, hints: false }));
  assert.deepEqual((({ palette, guides, hudScale, hints }) => ({ palette, guides, hudScale, hints }))(loadSettings(spec)), { palette: 'colourblind', guides: 'bold', hudScale: 1.3, hints: false });
  delete globalThis.localStorage;
});
