// A garage fitted to where it stands (play/garageBuilding.js, play/garageFit.js): its driveways leave the road's real
// edge — straight or curving — and rise smoothly into the lane with no step; it leans with the road however steep; the
// forecourt and driveways are solid and the road beside it stays clear; where a bank stands higher it's set into the
// ground (its outline handed to the stream to carve, a retaining wall where the bank is).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

// (no page here: a canvas that draws nothing, for the signs)
const ctx = new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : () => {}, set: () => true });
globalThis.document ??= { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
const { createGarageBuilding, SIDE } = await import('../../play/garageBuilding.js');
await RAPIER.init();

// a world: a road (its middle along x(z) in the garage's frame, 9.2 m wide, climbing at grade), the ground beside it
function world({ heading = 0, grade = 0, curve = 0, bank = 0 }) {
  const h = heading * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h), alt = 100;
  const local = (wx, wz) => ({ x: wx * rx + wz * rz, z: -(wx * fx + wz * fz) });
  const mid = z => -curve * z * z;       // (the road's middle bends away to the left — from the garage — either way)
  const plane = (wx, wz) => alt + grade * (wx * fx + wz * fz);
  const ground = {
    ready: () => true,
    road: (wx, wz) => { const p = local(wx, wz); return Math.abs(p.x - mid(p.z)) <= 4.6 ? plane(wx, wz) : null; },
    terrain: (wx, wz) => { const p = local(wx, wz); return plane(wx, wz) - 0.1 + (p.x - mid(p.z) > 6 ? bank : 0); },
  };
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const sim = { addStatic(pose, descs) { const body = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...pose.position).setRotation(pose.rotation)); descs.forEach(d => physics.createCollider(d, body)); return { body }; }, removeStatic() {} };
  const carved = new Map();
  const stream = { world: new THREE.Group(), projection: { toXZ: () => [0, 0], toLatLon: (x, z) => [z, x] }, toSim: (x, z) => [x, z], carve: (id, c) => c ? carved.set(id, c) : carved.delete(id) };
  const G = createGarageBuilding({ THREE, RAPIER, sim, stream, item: { id: 'garage_test', location: { lat: 0, lon: 0, alt, heading } }, ground });
  physics.step();
  // (the height of what the car stands on over the road's plane, at a place in the garage's frame: x right, z back)
  const above = (lx, lz) => { const x = rx * lx - fx * lz, z = rz * lx - fz * lz, hit = physics.castRay(new RAPIER.Ray({ x, y: alt + 40, z }, { x: 0, y: -1, z: 0 }), 100, true); return hit ? alt + 40 - hit.timeOfImpact - plane(x, z) : null; };
  // (anything solid along a line in the garage's frame, from a to b, h m over what's driven on there)
  const blocked = (a, b, h) => {
    const at = (lx, lz) => [rx * lx - fx * lz, rz * lx - fz * lz], [x0, z0] = at(a[0], a[1]), [x1, z1] = at(b[0], b[1]);
    const y0 = alt + (above(a[0], a[1]) ?? 0) + h, y1 = alt + (above(b[0], b[1]) ?? 0) + h, d = { x: x1 - x0, y: y1 - y0, z: z1 - z0 }, len = Math.hypot(d.x, d.y, d.z);
    const hit = physics.castRay(new RAPIER.Ray({ x: x0, y: y0, z: z0 }, { x: d.x / len, y: d.y / len, z: d.z / len }), len, true);
    return hit ? { at: [a[0] + (b[0] - a[0]) * hit.timeOfImpact / len, a[1] + (b[1] - a[1]) * hit.timeOfImpact / len] } : null;
  };
  return { G, above, carved, mid, blocked };
}

for (const [heading, grade] of [[0, 0], [90, 0.2], [200, -0.08]]) {
  test(`a straight road heading ${heading}° at a ${grade * 100}% slope: the driveways off its edge with no step, the forecourt solid, the road clear`, () => {
    const { G, above } = world({ heading, grade });
    assert.ok(G.fit.found, 'the road found');
    assert.ok(Math.abs(Math.tan(G.fit.pitch) - grade) < 0.01, `leaning with the road: ${Math.tan(G.fit.pitch)}`);
    for (const [name, lx, lz] of [['the lane\'s back', SIDE, 7], ['the lane\'s front', SIDE, -7], ['under the canopy', SIDE, 0], ['the back of the forecourt', SIDE + 17, 14]]) {
      const y = above(lx, lz);
      assert.ok(y != null && Math.abs(y - G.fit.floorY - 0.04) < 0.05, `${name}: ${y} m over the road`);
    }
    for (const { word, rows } of G.fit.driveways) {
      // (starting on the road's edge, and along the middle with no step)
      assert.ok(Math.abs(rows[0].a[0] - 4.3) < 0.15 && Math.abs(rows[0].b[0] - 4.3) < 0.15, `${word} starts on the road's edge: ${rows[0].a[0]}, ${rows[0].b[0]}`);
      let last = null;
      // (between rows: a ray straight down a shared edge of the surface's triangles can slip between them)
      for (let k = 0; k + 1 < rows.length; k++) {
        const r = rows[k], n = rows[k + 1], x = (r.a[0] + r.b[0] + n.a[0] + n.b[0]) / 4, z = (r.a[2] + r.b[2] + n.a[2] + n.b[2]) / 4;
        if (x < 4.7) continue;     // (on the road: the road's own collision there)
        const y = above(x, z);
        assert.ok(y != null, `${word} solid at ${x.toFixed(1)}, ${z.toFixed(1)} (row ${k})`);
        if (last) { const run = Math.hypot(x - last.x, z - last.z); assert.ok(Math.abs(y - last.y) <= 0.12 * run + 0.02, `${word}: no step (${last.y.toFixed(3)} → ${y.toFixed(3)} over ${run.toFixed(2)} m)`); }
        last = { x, z, y };
      }
      assert.ok(G.fit.quality.grade < 0.1, `gentle: ${G.fit.quality.grade}`);
    }
    for (const lz of [-25, -15, 0, 15, 25]) assert.equal(above(0, lz), null, 'nothing over the road');
  });
}

test('a road curving away: each driveway starts on the road\'s real edge, wherever it has got to', () => {
  const { G, mid } = world({ curve: 0.008 });
  assert.ok(G.fit.found);
  for (const { word, rows } of G.fit.driveways) for (const e of ['a', 'b']) {
    const [x, , z] = rows[0][e], edge = mid(z) + 4.6;
    assert.ok(Math.abs(x - (edge - 0.3)) < 0.25, `${word} ${e} at x ${x.toFixed(2)} — the road's edge there is ${edge.toFixed(2)}`);
  }
  // (and you come out on the road, in its nearside lane)
  const out = G.fit.exits[-1];
  assert.ok(Math.abs(out.x - (mid(out.z) + 4.6 - 2.3)) < 0.3, `out at ${out.x.toFixed(2)}, ${out.z}`);
});

test('a bank beside the road: set into the ground — its outline carved, a retaining wall, the floor near the road\'s level', () => {
  const { G, carved, above } = world({ bank: 0.8 });
  assert.ok(G.fit.floorY <= 0.3 + 1e-9, `the floor at ${G.fit.floorY}`);
  assert.ok(G.fit.quality.cut > 0.5, `ground cut away: ${G.fit.quality.cut}`);
  assert.equal(carved.size, 1, 'its outline handed to the stream');
  const c = [...carved.values()][0];
  assert.equal(c.polys.length, 5, 'both driveways, the lane, the verge between them and the forecourt');
  assert.deepEqual(c.surfaces, ['tarmac', 'tarmac', 'tarmac', 'grass', 'concrete'], 'tarmac driveways and lane, a grass verge, a concrete forecourt');
  assert.ok(Math.abs(c.below(SIDE, 0) - (100 + G.fit.floorY + 0.04)) < 0.1, `the surface under the canopy: ${c.below(SIDE, 0)}`);
  assert.ok(G.group.getObjectByProperty('type', 'Mesh') && G.group.children.some(g => g.children?.some(m => m.material?.color?.getHex() === 0xa3a29c)), 'a retaining wall');
  assert.ok(above(SIDE, 0) != null, 'still solid under the canopy');
  G.dispose();
  assert.equal(carved.size, 0, 'taken away again when it goes');
});

test('a bank beside the road: the driving lines in and out are clear — nothing solid at bumper height from the road, round the inside of each curve, through the lane and out', () => {
  const { G, blocked } = world({ bank: 0.8 });
  const lines = [];
  for (const u of [0.5, 0.99]) {   // (the middle, and hugging the inside of the curve: a car's side at its edge)
    const IN = G.fit.driveways.find(d => d.zs > 0).rows, OUT = G.fit.driveways.find(d => d.zs < 0).rows;
    const along = rows => rows.map(r => [r.a[0] + (r.b[0] - r.a[0]) * u, r.a[2] + (r.b[2] - r.a[2]) * u]);
    const lane = []; for (let z = 8; z >= -8; z -= 1) lane.push([SIDE, z]);
    lines.push([u, [...along(IN), ...lane, ...along(OUT).reverse()]]);
  }
  for (const [u, pts] of lines) for (const h of [0.2, 0.45]) for (let k = 0; k + 1 < pts.length; k++) {
    const b = blocked(pts[k], pts[k + 1], h);
    assert.equal(b, null, `the ${u === 0.5 ? 'middle' : 'inside'} line, ${h} m up: something solid at ${b?.at.map(v => v.toFixed(1))}`);
  }
});

