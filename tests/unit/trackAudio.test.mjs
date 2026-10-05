// The sounds of a generated track (Phase 5 Step 4), their mixes (testtrack/soundMix.js): the tyres on what
// they're on — a squeal sliding on tarmac, a rumble across a kerb at the rate its stripes pass, a swish on
// grass, a crunch on gravel; the theme's ambience (birds, wind, sea, city) and the crowd by the grandstands,
// its cheer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tyreMix, ambienceMix } from '../../testtrack/soundMix.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const S = json('data/tracks.json').surfaces, A = json('data/sounds/ambient.json');
const wheels = (surface, slip = 0, n = 4) => Array.from({ length: n }, () => ({ grounded: true, surface, slipSpeed: slip, load: 3500 }));

test('tyres: a squeal sliding on tarmac, a rumble on a kerb, a swish on grass, a crunch on gravel', () => {
  const grip = tyreMix(wheels('tarmac', 0.3), S, 30), slide = tyreMix(wheels('tarmac', 8), S, 30);
  assert.equal(grip.squeal, 0); assert.ok(slide.squeal > 0.9 && slide.pitch > 0.4);
  const kerb = tyreMix([...wheels('kerb', 0.3, 2), ...wheels('tarmac', 0.3, 2)], S, 30);
  assert.ok(kerb.rumble > 0.5 && kerb.squeal === 0 && Math.abs(kerb.rumbleRate - 30) < 1, JSON.stringify(kerb));
  assert.ok(tyreMix(wheels('sausage', 0.3, 1), S, 30).rumble >= kerb.rumble, 'a sausage kerb harder');
  assert.ok(tyreMix(wheels('kerb', 0.3), S, 1).rumble < 0.05, 'barely moving: no rumble');
  const grass = tyreMix(wheels('grass', 1), S, 25), gravel = tyreMix(wheels('gravel', 1), S, 25);
  assert.ok(grass.grass > 0.4 && grass.crunch === 0 && grass.squeal === 0, JSON.stringify(grass));
  assert.ok(gravel.crunch > 0.4 && gravel.grass === 0, JSON.stringify(gravel));
  assert.equal(tyreMix(wheels('gravel', 3).map(w => ({ ...w, grounded: false })), S, 25).crunch, 0, 'in the air: nothing');
});

test('ambience: each theme its own sounds, quieter at speed and inside; the crowd by the grandstands, cheering', () => {
  const at = theme => ambienceMix(A, theme, {}).layers;
  assert.ok(at('forest').birds > at('desert').birds && at('coastal').sea > 0.5 && at('street').city > 0.5 && at('mountain').wind > at('countryside').wind);
  assert.equal(at('forest').sea, 0); assert.equal(at('street').sea, 0);
  for (const th of Object.keys(A.themes)) assert.ok(Object.values(at(th)).some(v => v > 0.5), `${th}: something to hear`);
  const still = ambienceMix(A, 'coastal', { speed: 0 }), fast = ambienceMix(A, 'coastal', { speed: 60 }), inside = ambienceMix(A, 'coastal', { inside: true });
  assert.ok(fast.layers.sea < still.layers.sea && inside.layers.sea < still.layers.sea);
  const near = ambienceMix(A, 'street', { stand: 15 }), far = ambienceMix(A, 'street', { stand: 400 }), none = ambienceMix(A, 'street', {});
  assert.ok(near.crowd > 0.4 && far.crowd === 0 && none.crowd === 0);
  const cheer = ambienceMix(A, 'street', { stand: 15, cheer: 1 }), farCheer = ambienceMix(A, 'street', { stand: 400, cheer: 1 });
  assert.ok(cheer.cheer > 0.8 && farCheer.cheer === 0, 'a cheer heard by the grandstand, not across the track');
});
