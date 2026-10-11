// The script's draft from commit subjects (script/draft.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, score, casual, draft, scriptText, postCaption } from '../script/draft.mjs';
import { parseScript } from '../remotion/timeline.js';

test('commit subjects cleaned: labels, [skip ci], asides, the first part', () => {
  assert.equal(clean('Phase 8 Step 1: vehicle and world sound — done (docs/AUDIO.md)'), 'vehicle and world sound');
  assert.equal(clean('Phase 7 Step 5 (work in progress): the clutch no longer cooks, and a replaced one starts cold [skip ci]'), 'the clutch no longer cooks');
  assert.equal(clean('feat(cars): new turbo sound'), 'new turbo sound');
  assert.equal(clean('Phase 7 Step 5: done — the go-live record'), 'the go-live record');
});

test('behind-the-scenes work is left out; what players see is in', () => {
  assert.ok(score('Phase 7 Step 5: deploys wait for the fast checks') < 0);
  assert.ok(score('Phase 7 Step 5: the nightly backup uses PostgreSQL 18') < 0);
  assert.ok(score('docs: update README') < 0);
  assert.ok(score('Phase 8 Step 1: vehicle and world sound — done (docs/AUDIO.md)') > 0);
  assert.ok(score('multiplayer races in the game') > 0);
});

test('a casual voice, the same each time', () => {
  assert.match(casual('fix: the clutch no longer cooks'), /clutch no longer cooks/);
  assert.equal(casual('new drift camera'), casual('new drift camera'));
});

test('a draft: a hook, up to 5 captions in commit order, nothing twice; it reads back as written', () => {
  const commits = [
    { hash: 'a1', subject: 'Phase 8 Step 1 (in progress): the game\'s sound system — one AudioContext' },
    { hash: 'a2', subject: 'Phase 8 Step 1: vehicle and world sound — done (docs/AUDIO.md)' },
    { hash: 'a3', subject: 'ci: cache npm' },
    { hash: 'a4', subject: 'Rain on the real roads at night' },
    { hash: 'a5', subject: 'Race your friends online in free roam' },
  ];
  const d = draft({ commits, date: '2026-10-11' });
  assert.ok(d.hook);
  assert.ok(d.captions.length >= 2 && d.captions.length <= 5);
  assert.ok(!d.captions.some(c => /cache npm/.test(c)));
  assert.equal(d.captions.filter(c => /sound/i.test(c)).length, 1, 'two sound commits: one caption');
  const back = parseScript(scriptText(d, '2026-10-11'));
  assert.deepEqual(back, { hook: d.hook, captions: d.captions, end: d.end });
  const post = postCaption(back, d.topics);
  assert.match(post, /ognistrada\.com/);
  assert.match(post, /#gamedev/);
});

test('no commits: still something to say', () => {
  const d = draft({ commits: [], date: '2026-10-11' });
  assert.ok(d.hook && d.captions.length);
});
