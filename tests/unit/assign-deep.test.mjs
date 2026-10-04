// garage/session.js assignDeep: copying a car's stats into the live spec in place. Every car but the
// starter has stats that are deliberately empty (undefined) — copying them must not throw (it did:
// JSON can't hold undefined, so no world could start once such a car was in the save).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignDeep } from '../../garage/session.js';
import { harness } from '../harness.mjs';

test('assignDeep copies empty (undefined) values without throwing', () => {
  const t = { a: 1, b: { c: 2 }, d: [1, { e: 3 }] };
  assignDeep(t, { a: undefined, b: { c: undefined, f: 5 }, d: [1, { e: undefined }], g: undefined });
  assert.equal(t.a, undefined); assert.equal(t.b.c, undefined); assert.equal(t.b.f, 5); assert.equal(t.d[1].e, undefined);
});

test('switching the live spec between every car works', async () => {
  const H = await harness(), ids = Object.keys(H.db.cars);
  const spec = structuredClone(H.garage(null, ids[0]).stats().spec);
  for (const id of [...ids, ids[0]]) {
    const next = H.garage(null, id).stats().spec;
    assignDeep(spec, next);
    assert.equal(spec.mass ?? spec.chassis?.mass, next.mass ?? next.chassis?.mass, id);
  }
});
