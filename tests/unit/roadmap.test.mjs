// The roadmap (docs/ROADMAP.md): the admin page's Roadmap tab's helpers (admin/roadmap.js) — the board's order, what an
// item is sent back as — and that its statuses and kinds are the server's (server/src/routes/roadmap.ts).
// npm run test:unit

import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { KINDS, STATUSES, STATUS_LABEL, bodyOf, sortItems } from '../../admin/roadmap.js';

test('the admin tab\'s kinds and statuses are the server\'s, each status with a label', () => {
  const src = fs.readFileSync(new URL('../../server/src/routes/roadmap.ts', import.meta.url), 'utf8');
  const list = name => JSON.parse(src.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'));
  assert.deepEqual(KINDS, list('KINDS'));
  assert.deepEqual(STATUSES, list('STATUSES'));
  for (const s of STATUSES) assert.ok(STATUS_LABEL[s], s);
  const en = JSON.parse(fs.readFileSync(new URL('../../locales/en.json', import.meta.url), 'utf8'));
  for (const s of STATUSES) assert.ok(en[`roadmap.status.${s}`], `the game's words for ${s}`);
  for (const k of KINDS) assert.ok(en[`roadmap.kind.${k}`], `the game's words for ${k}`);
});

test('the board\'s order: waiting, being worked on, planned, open by votes, done, rejected', () => {
  const it = (id, status, votes = 0, createdAt = '2026-10-01') => ({ id, status, votes, createdAt });
  const order = sortItems([it('d', 'done', 9), it('o1', 'open', 1), it('r', 'rejected'), it('o5', 'open', 5), it('w', 'working'), it('p', 'pending'), it('pl', 'planned'),
    it('o5new', 'open', 5, '2026-10-05')]).map(i => i.id);
  assert.deepEqual(order, ['p', 'w', 'pl', 'o5new', 'o5', 'o1', 'd', 'r']);
});

test('what an item is sent back as: only what the server takes, the change on top', () => {
  const item = { id: 'x', kind: 'idea', title: 'Drag strips', body: 'At the airport', status: 'pending', note: null, votes: 3, author: 'Pia', mine: false };
  assert.deepEqual(bodyOf(item, { status: 'open' }), { kind: 'idea', title: 'Drag strips', body: 'At the airport', status: 'open', note: null });
  assert.deepEqual(bodyOf({ ...item, body: undefined }), { kind: 'idea', title: 'Drag strips', body: '', status: 'pending', note: null });
});
