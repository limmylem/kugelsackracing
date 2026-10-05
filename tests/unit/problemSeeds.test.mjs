// The problem seeds (Phase 5 Step 4: tests/fixtures/problem-seeds.json — tools/problem-seeds.mjs finds
// them): tracks that were bad or felt wrong, with what was wrong. Version 2 still makes each exactly as it
// was (its code, its hash: old codes keep their tracks); generator version 3 makes a good track from the
// same seed and parameters — through the quality gate, and none of what was wrong (stop-start sections,
// no overtaking chance, a corner class missing that its style should have, a dangerous spot).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateTrack, decode } from '../../track/generate.js';
import { dressTrack } from '../../track/dress.js';
import { qualityOf } from '../../track/quality.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const cfg = json('data/tracks.json'), F = json('tests/fixtures/problem-seeds.json');
// (what counts as each kind of problem in the score's notes; a technical style may lack fast corners)
const KINDS = { stopStart: /stop-start/, overtaking: /no real overtaking/, slow: /no slow corners/, danger: /another part of the track|of run-off at/ };

test('the problem seeds: version 2 still makes each as it was', () => {
  assert.ok(F.seeds.length >= 16, 'the list');
  for (const s of F.seeds) {
    const g = generateTrack({ code: s.code });
    assert.equal(g.version, 2); assert.equal(g.hash, s.hash, `${s.id}: version 2's track changed`);
    assert.ok(s.wrong.length, `${s.id}: what was wrong with it`);
  }
});

test('the problem seeds: version 3 makes a good track from each — through the gate, none of what was wrong', () => {
  for (const s of F.seeds) {
    const d = decode(s.code), g = generateTrack({ seed: d.seed, params: { ...d.params, signatures: true }, version: 3 });
    assert.ok(g.ok, `${s.id}: no version-3 track (${g.error})`);
    const q = qualityOf(g, dressTrack(g, cfg), cfg);
    assert.ok(q.gate >= cfg.quality.min.daily, `${s.id}: a quality score of ${q.gate} (the day's tracks need ${cfg.quality.min.daily}; version 2's was ${s.gate})`);
    assert.ok(q.gate > (s.gate ?? 0) + 10, `${s.id}: ${q.gate} isn't much better than version 2's ${s.gate}`);
    for (const [k, re] of Object.entries(KINDS)) if (s.wrong.some(w => re.test(w))) assert.ok(!q.notes.some(n => re.test(n)), `${s.id}: still ${k} (${q.notes.join('; ')})`);
  }
});
