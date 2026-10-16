// Another player's car's damage sounds (audio/remoteDamage.js; play/multiplayer.js damageSoundOf): a radiator leak it
// sent steams from its engine bay until the coolant would be gone, a panel it says hangs loose flaps once it's moving,
// both into its own voice (heard from where it is, only while heard in full); a repair stops them; an undamaged car
// makes nothing; dispose lets everything go. Web Audio: tests/fakeAudio.mjs.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { installFakeAudio } = await import('../fakeAudio.mjs');
const F = installFakeAudio();
const { createAudioSystem } = await import('../../audio/system.js');
const { createCarVoice } = await import('../../audio/car.js');
const { createRemoteDamage, remoteSteam } = await import('../../audio/remoteDamage.js');
const { damageSoundOf } = await import('../../play/multiplayer.js');
const A = await createAudioSystem({ context: new F.classes.AudioContext() });
const settle = () => new Promise(r => setTimeout(r, 30));

test('what another car sent: its radiator\'s leak, its loose panels, until a repair', () => {
  const leak = { kind: 'damage', crash: { s: 20, hits: {}, mech: { socket_engine: { coolant: 0.9, leak: 0.004 } } } };
  assert.deepEqual([damageSoundOf([], null).leak, damageSoundOf([], null).loose], [0, 0]);
  const r = damageSoundOf([leak, { kind: 'parts', socket: 'bumper_front', to: 'loose' }, { kind: 'parts', socket: 'bonnet', to: 'loose' }, { kind: 'parts', socket: 'bonnet', to: 'detached' }], null);
  assert.equal(r.leak, 0.004); assert.equal(r.coolant, 0.9);
  assert.equal(r.loose, 1, 'the bumper hangs; the bonnet fell off');
  const fixed = damageSoundOf([leak, { kind: 'parts', socket: 'bumper_front', to: 'loose' }, { kind: 'repair' }], null);
  assert.deepEqual([fixed.leak, fixed.loose], [0, 0]);
  // steam while there's coolant to lose, less at speed
  const d = { leak: 0.004, coolant: 0.9 };
  assert.ok(remoteSteam(d, 1, 0) > 0.5);
  assert.ok(remoteSteam(d, 1, 30) < remoteSteam(d, 1, 0));
  assert.equal(remoteSteam(d, 0.9 / 0.004, 0), 0, 'the coolant gone: no more steam');
  assert.equal(remoteSteam({ leak: 0, coolant: 1 }, 1, 0), 0);
});

test('its steam and flapping panel: heard through its voice, nothing made undamaged, let go on dispose', async () => {
  const before = F.live().nodes;
  const voice = createCarVoice(A, { spec: { engine: null, audio: null }, role: 'other' });
  const D = createRemoteDamage(A, () => voice.extra);
  D.update({ steam: 0, flap: 0, speed: 20 });
  await settle();
  assert.equal(D.made, false, 'undamaged: nothing made');
  D.update({ steam: 0.8, flap: 1, speed: 20 });
  await settle(); D.update({ steam: 0.8, flap: 1, speed: 20 });
  assert.ok(D.made);
  const L = D.levels;
  assert.ok(L.steam > 0, `steam ${L.steam}`);
  assert.ok(L.flap > 0, `a panel flapping at 20 m/s: ${L.flap}`);
  // (into the voice's own chain: positioned with it)
  const reaches = (from, to, seen = new Set()) => from === to || (!seen.has(from) && (seen.add(from), [...from.outs].some(n => reaches(n, to, seen))));
  const sources = F.all().filter(n => n.buffer && n.loop && !n.dead && n.started && !n.stopped);
  assert.ok(sources.some(s => reaches(s, voice.extra)), 'its sounds go into its voice');
  D.update({ steam: 0, flap: 1, speed: 2 });
  assert.equal(D.levels.flap, 0, 'too slow to flap');
  D.dispose(); voice.dispose();
  await settle();
  assert.ok(F.live().nodes <= before, `everything let go (${F.live().nodes} nodes, ${before} before)`);
});
