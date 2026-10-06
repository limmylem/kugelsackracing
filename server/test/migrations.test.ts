// Phase 6 Step 5: safe deploys (docs/OPERATIONS.md) — a deploy migrates the database while the previous version still
// serves, and a rollback runs the previous version against the new schema. So every migration from here on only adds:
// new tables, new nullable (or defaulted) columns, new indexes — never a drop, a rename, a type change or a new
// NOT NULL on a column the old version writes without it. Removing something takes two releases: stop using it, then
// (after the next release has settled) drop it in a migration added to ALLOWED_DESTRUCTIVE with its reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../drizzle/', import.meta.url);
const journal = JSON.parse(fs.readFileSync(new URL('meta/_journal.json', dir), 'utf8')).entries as { idx: number; tag: string; when: number }[];
// (before this rule: 0003 and 0004 changed indexes and a table while nothing was live)
const RULE_FROM = 10;
const ALLOWED_DESTRUCTIVE: Record<string, string> = {};

const DESTRUCTIVE: [RegExp, string][] = [
  [/\bdrop\s+table\b/i, 'drops a table'], [/\bdrop\s+column\b/i, 'drops a column'], [/\brename\b/i, 'renames something'],
  [/\balter\s+column\s+"?\w+"?\s+(set\s+data\s+)?type\b/i, 'changes a column\'s type'], [/\bset\s+not\s+null\b/i, 'makes a column NOT NULL'],
  [/\btruncate\b/i, 'empties a table'], [/\bdelete\s+from\b/i, 'deletes rows'], [/\bdrop\s+(index|constraint|trigger|function|view)\b(?!\s+if\s+exists\s+"?\w+_old)/i, 'drops something the old version may rely on'],
];

test('every migration is in the journal, in order, with its file', () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  assert.deepEqual(journal.map(e => `${e.tag}.sql`), files);
  journal.forEach((e, i) => { assert.equal(e.idx, i); if (i) assert.ok(e.when > journal[i - 1].when, `${e.tag} after ${journal[i - 1].tag}`); });
});

test('migrations from 0010 on only add: the running version and a rollback keep working while a deploy migrates', () => {
  for (const e of journal.filter(e => e.idx >= RULE_FROM)) {
    const text = fs.readFileSync(new URL(`${e.tag}.sql`, dir), 'utf8').replace(/--[^\n]*/g, '');
    if (ALLOWED_DESTRUCTIVE[e.tag]) continue;
    for (const [re, what] of DESTRUCTIVE) assert.ok(!re.test(text), `${e.tag} ${what}: split it over two releases (docs/OPERATIONS.md)`);
    // a new column the old version doesn't write: nullable, or with a default
    for (const m of text.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+([^;,]*)/gi)) assert.ok(!/not\s+null/i.test(m[2]) || /default/i.test(m[2]), `${e.tag}: new column ${m[1]} is NOT NULL without a default`);
    // and can be run twice (a retried deploy)
    for (const m of text.matchAll(/create\s+(table|index|unique\s+index)\s+(?!if\s+not\s+exists)/gi)) assert.fail(`${e.tag}: ${m[0].trim()} without IF NOT EXISTS`);
  }
});
