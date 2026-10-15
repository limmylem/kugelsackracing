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

// ---------- version 2 ----------
import { playerFacing } from '../script/draft.mjs';

test('v2: a commit that only touches tests, docs, tools, workflows or this tool is left out', () => {
  assert.equal(playerFacing({ subject: 'x', files: ['tests/a.mjs', 'docs/A.md', '.github/workflows/x.yml'] }), false);
  assert.equal(playerFacing({ subject: 'x', files: ['devlog/capture/capture.mjs', 'DEVLOG.md'] }), false);
  assert.equal(playerFacing({ subject: 'x', files: ['server/tools/mp-browser-race.ts'] }), false);
  assert.equal(playerFacing({ subject: 'x', files: ['docs/A.md', 'garage/view.js'] }), true);
  const d = draft({ date: '2026-10-11', commits: [
    { hash: 'a', subject: 'Devlog tool: the other player\'s name shown over their car', files: ['devlog/capture/capture.mjs'] },
    { hash: 'b', subject: 'Adelaide, a whole city baked like San Francisco: the Regions list travels there', files: ['assets/map/adelaide.pmtiles', 'data/regions.json', 'docs/MAP.md'] },
  ] });
  assert.ok(!d.captions.some(c => /other player's name/.test(c)), d.captions.join(' / '));
  assert.ok(d.captions.some(c => /Adelaide/.test(c)), d.captions.join(' / '));
});

test('v2: never a caption cut mid-phrase', () => {
  assert.equal(clean('Regions: back to one you were in works again, the garage and the Real world button go back to the region you were last in'), 'Regions: back to one you were in works again');
  assert.equal(clean('The game opens where you left off, not always San Francisco: the last region kept in the browser'), 'The game opens where you left off');
  // (one long clause with no break: left out rather than cut)
  assert.equal(clean('the lobby writes the players pings into their cells instead of drawing itself again every few seconds'), '');
  for (const s of ['the garage and the', 'a fix for the', 'works with']) assert.ok(!/\b(and|the|for|with)$/.test(clean(s)), clean(s));
});

test('v2: the highlights come first, as written, and a HOOK: line sets the title', () => {
  const d = draft({ date: '2026-10-11', highlights: ['HOOK: A whole new city to race', 'Adelaide is in the game', 'engines sound real now'], commits: [
    { hash: 'a', subject: 'The garage\'s full fix of the whole car works again', files: ['garage/fix.js'] },
    { hash: 'b', subject: 'Adelaide, a whole city baked like San Francisco', files: ['assets/map/a.pmtiles'] },
  ] });
  assert.equal(d.hook, 'A whole new city to race');
  assert.deepEqual(d.captions.slice(0, 2), ['Adelaide is in the game', 'Engines sound real now']);
  assert.ok(d.captions.some(c => /garage/i.test(c)), 'commits fill the rest');
  assert.equal(d.captions.filter(c => /Adelaide/.test(c)).length, 1, 'no commit repeats a highlight');
});

import { focusLines } from '../script/draft.mjs';
test('what the video is about, as typed on the admin page (| or a line each): used as the highlights, HOOK sets the title', () => {
  const lines = focusLines('HOOK: Build your own car parts | A family builder on the admin page\nVoice chat in races\n# a note\n');
  assert.deepEqual(lines, ['HOOK: Build your own car parts', 'A family builder on the admin page', 'Voice chat in races']);
  const d = draft({ commits: [], highlights: lines, date: '2026-10-15' });
  assert.equal(d.hook, 'Build your own car parts');
  assert.deepEqual(d.captions.slice(0, 2), ['A family builder on the admin page', 'Voice chat in races']);
});
