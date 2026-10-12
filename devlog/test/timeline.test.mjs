// The video's plan (remotion/timeline.js): its length, the hook and end card, the cuts, the script's text format
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, parseScript, LIMITS, HOOK_SECONDS, END_SECONDS } from '../remotion/timeline.js';

const clips = [{ src: 'clips/a.mp4', seconds: 4 }, { src: 'clips/b.mp4', seconds: 4 }, { src: 'clips/c.mp4', seconds: 6 }];
const fps = 30;

test('always 20–45 seconds, hook first (2 s), end card last (3 s)', () => {
  for (const captions of [[], ['one'], ['a few words here', 'and a few more words'], Array.from({ length: 30 }, (_, i) => `caption number ${i} with quite a lot of words in it`)]) {
    const P = plan({ script: { hook: 'Hook', captions }, clips, fps });
    assert.ok(P.frames >= LIMITS.min * fps && P.frames <= LIMITS.max * fps + 1, `${captions.length} captions: ${P.frames / fps} s`);
    assert.deepEqual(P.hook, { from: 0, to: HOOK_SECONDS * fps });
    assert.equal(P.end.to, P.frames);
    assert.equal(P.end.to - P.end.from, END_SECONDS * fps);
    // captions one after another, from the hook's end
    let at = P.hook.to;
    for (const c of P.captions) { assert.equal(c.from, at); assert.ok(c.to > c.from); at = c.to; }
    assert.ok(at <= P.end.from);
  }
});

test('too many captions: the last ones left out, with a warning', () => {
  const P = plan({ script: { hook: 'Hook', captions: Array.from({ length: 30 }, (_, i) => `caption ${i}`) }, clips, fps });
  assert.ok(P.captions.length < 30);
  assert.ok(P.warnings.some(w => /left out/.test(w)));
});

test('the cuts cover the whole video, quickly, each inside its clip', () => {
  const P = plan({ script: { hook: 'Hook', captions: ['one two three', 'four five six seven', 'eight'] }, clips, fps });
  assert.equal(P.cuts[0].from, 0);
  assert.equal(P.cuts[0].to, P.hook.to, 'a cut where the hook ends');
  for (let i = 1; i < P.cuts.length; i++) assert.equal(P.cuts[i].from, P.cuts[i - 1].to);
  assert.equal(P.cuts.at(-1).to, P.frames);
  for (const c of P.cuts.slice(1, -1)) assert.ok(c.to - c.from <= 2.5 * fps, 'a cut at least every 2.5 s');
  for (const c of P.cuts) assert.ok(c.trimBefore + (c.to - c.from) <= clips[c.clip].seconds * fps, 'inside its clip');
  // (the same script: the same cuts)
  assert.deepEqual(plan({ script: { hook: 'Hook', captions: ['one two three', 'four five six seven', 'eight'] }, clips, fps }).cuts, P.cuts);
});

test('no clips: still a video (captions on a plain background)', () => {
  const P = plan({ script: { hook: 'Hook', captions: ['x'] }, clips: [], fps });
  assert.equal(P.cuts.length, 0);
  assert.ok(P.frames >= LIMITS.min * fps);
});

test('the script: HOOK:, captions, END:, notes; or one line with |', () => {
  assert.deepEqual(parseScript('# a note\nHOOK: Big news\nFirst caption\n- second caption\n\nEND: Play now\n# more notes'), { hook: 'Big news', captions: ['First caption', 'second caption'], end: 'Play now' });
  assert.deepEqual(parseScript('Big news | First caption | second caption'), { hook: 'Big news', captions: ['First caption', 'second caption'], end: '' });
  assert.deepEqual(parseScript('Big news | First | END: Play now'), { hook: 'Big news', captions: ['First'], end: 'Play now' });
  assert.deepEqual(parseScript('Just a hook'), { hook: 'Just a hook', captions: [], end: '' });
  assert.equal(parseScript('').hook, '');
});
