// Voice chat's rules (mp/voice.js; docs/FREE_ROAM.md "Voice chat"): a party hears itself wherever it is; otherwise the
// players near (both in proximity voice), louder the nearer; nobody blocked, nobody with their microphone off; each
// player's switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { voiceMode, hears, voicesFor, voiceGain } from '../../mp/voice.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../../data/roam.json', import.meta.url), 'utf8'));
const V = cfg.voice;
const who = (uid, o = {}) => ({ uid, name: uid, region: 'adelaide', pos: [0, 0], party: null, voiceParty: true, voiceNearby: true, mic: true, session: `s-${uid}`, track: `t-${uid}`, at: 0, ...o });

test('the settings: a party with party voice on is in party voice; otherwise proximity voice, if it\'s on', () => {
  assert.equal(voiceMode(who('a')), 'near');
  assert.equal(voiceMode(who('a', { party: 'p1' })), 'party');
  assert.equal(voiceMode(who('a', { party: 'p1', voiceParty: false })), 'near', 'party voice off: back to proximity voice');
  assert.equal(voiceMode(who('a', { voiceNearby: false })), 'off');
  assert.equal(voiceMode(who('a', { party: 'p1', voiceParty: false, voiceNearby: false })), 'off');
  assert.ok(V.nearbyM >= 500 && V.fullM < V.nearbyM, 'a large range: far enough to talk to someone stuck down the road');
});

test('proximity voice: heard within nearbyM, in the same region, both in it; not further, not in another region', () => {
  const me = who('me');
  assert.deepEqual(hears(me, who('b', { pos: [300, 400] }), { cfg }), { d: 500, party: false });
  assert.equal(hears(me, who('b', { pos: [V.nearbyM + 1, 0] }), { cfg }), null, 'too far');
  assert.equal(hears(me, who('b', { region: 'mk' }), { cfg }), null, 'another region');
  assert.equal(hears(me, who('b', { voiceNearby: false }), { cfg }), null, 'they have proximity voice off');
  assert.equal(hears(who('me', { voiceNearby: false }), who('b'), { cfg }), null, 'I have it off');
  assert.equal(hears(me, who('b', { party: 'p1' }), { cfg }), null, 'they\'re in party voice');
});

test('party voice: the party at full volume wherever each is (another region too); nobody else, not another party', () => {
  const me = who('me', { party: 'p1' });
  assert.deepEqual(hears(me, who('b', { party: 'p1', pos: [50000, 0], region: 'mk' }), { cfg }), { d: null, party: true });
  assert.equal(hears(me, who('c', { pos: [5, 0] }), { cfg }), null, 'a stranger beside me isn\'t heard in party voice');
  assert.equal(hears(me, who('d', { party: 'p2' }), { cfg }), null, 'another party');
  assert.equal(hears(me, who('b', { party: 'p1', voiceParty: false }), { cfg }), null, 'a member with party voice off');
  assert.equal(voiceGain(null, cfg), 1);
});

test('never heard: someone blocked (either way: the block list has both), a microphone off, not connected, yourself', () => {
  const me = who('me');
  assert.equal(hears(me, who('b'), { cfg, blocked: new Set(['b']) }), null);
  assert.equal(hears(me, who('b', { mic: false }), { cfg }), null);
  assert.equal(hears(me, who('b', { session: null }), { cfg }), null);
  assert.equal(hears(me, who('me'), { cfg }), null);
});

test('the voices a player hears: the nearest first, at most maxPeers', () => {
  const others = Array.from({ length: V.maxPeers + 5 }, (_, i) => who(`p${i}`, { pos: [(V.maxPeers + 5 - i) * 10, 0] }));
  const list = voicesFor(who('me'), [who('me'), ...others], { cfg });
  assert.equal(list.length, V.maxPeers);
  assert.ok(list.every((v, i) => i === 0 || v.d >= list[i - 1].d));
  assert.equal(list[0].uid, `p${V.maxPeers + 4}`);
});

test('the volume: full near, fading smoothly to nothing at nearbyM', () => {
  assert.equal(voiceGain(0, cfg), 1);
  assert.equal(voiceGain(V.fullM, cfg), 1);
  assert.equal(voiceGain(V.nearbyM, cfg), 0);
  assert.equal(voiceGain(V.nearbyM + 100, cfg), 0);
  let last = 1;
  for (let d = V.fullM; d <= V.nearbyM; d += 10) { const g = voiceGain(d, cfg); assert.ok(g <= last + 1e-9 && g >= 0, `${d} m: ${g}`); last = g; }
  const mid = voiceGain((V.fullM + V.nearbyM) / 2, cfg);
  assert.ok(mid > 0.4 && mid < 0.6, `halfway: ${mid}`);
});
