// The baked world's pure pieces: the tile format (world/tileFormat.js) round trip, gzipped; the terrain
// meshes cut from a tile's height grid (world/terrainMesh.js); the railings' colliders
// (world/barriers.js) — thick, taller than drawn, overlapping at every joint.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { encodeTile, decodeTile } from '../../world/tileFormat.js';
import { terrainMeshes } from '../../world/terrainMesh.js';
import { barrierBoxes, barrierInstances, barrierShape } from '../../world/barriers.js';
import { projection } from '../../world/projection.js';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;

const CFG = { minThickness: 0.35, extraHeight: 0.35, types: { guard_rail: { height: 0.8, thickness: 0.1, extraHeight: 1.2, colour: '#bbbbbb', post: 2 }, wall: { height: 1.8, thickness: 0.35, colour: '#a89a86' } } };

function sampleTile() {
  const n = 16, N1 = n + 1, heights = new Float32Array(N1 * N1);
  for (let c = 0; c < N1; c++) for (let r = 0; r < N1; r++) heights[r + c * N1] = Math.round((10 + Math.sin(c / 3) * 4 + r * 0.25) * 100) / 100;
  const terrain = new Uint8Array(N1 * N1).map((_, k) => k % 3);
  return {
    header: { key: '0_0', size: 32, terrain: { palette: [[10, 20, 30], [40, 50, 60], [70, 80, 90]], lodErrors: [0.01, 1] } },
    meshes: { roads: { positions: Float32Array.from([0, 1, 0, 4, 1, 0, 4, 1.2, 4, 0, 1.2, 4]), colours: Uint8Array.from({ length: 16 }, (_, k) => k * 10), indices: Uint32Array.from([0, 2, 1, 0, 3, 2]), surfaces: Uint8Array.from([1, 2]) } },
    lists: { trees: { stride: 5, quantum: 0.02, data: Float32Array.from([1.23, 4.56, -7.89, 1, 0]) }, labels: { stride: 6, data: Float32Array.from([1, 2, 3, 0.5, 0, 4]) } },
    grids: { surface: { n: 4, cell: 8, names: ['tarmac', 'grass'], data: Uint8Array.from({ length: 16 }, (_, k) => k % 2) }, terrain: { n: N1, cell: 2, data: terrain } },
    heightfield: { n, size: 32, heights, quantum: 0.01 },
  };
}

test('a tile comes back as baked, gzipped or not', async () => {
  const t = sampleTile(), raw = encodeTile(t, MeshoptEncoder);
  for (const bytes of [raw, zlib.gzipSync(raw)]) {
    const d = await decodeTile(bytes, MeshoptDecoder);
    // heights exactly (on the bake's own centimetre)
    t.heightfield.heights.forEach((h, k) => assert.ok(Math.abs(d.heightfield.heights[k] - h) < 1e-4));
    // positions to a fraction of a millimetre, triangles and their surfaces as they were
    t.meshes.roads.positions.forEach((p, k) => assert.ok(Math.abs(d.meshes.roads.positions[k] - p) < 1e-3));
    // (the index codec may start a triangle at another of its corners: same triangle, same winding)
    const tris = I => Array.from({ length: I.length / 3 }, (_, t) => { const a = [...I.slice(t * 3, t * 3 + 3)], k = a.indexOf(Math.min(...a)); return [...a.slice(k), ...a.slice(0, k)].join(); });
    assert.deepEqual(tris(d.meshes.roads.indices), tris([0, 2, 1, 0, 3, 2]));
    assert.deepEqual([...d.meshes.roads.surfaces], [1, 2]);
    // lists: quantised to their step, float ones exact
    t.lists.trees.data.forEach((v, k) => assert.ok(Math.abs(d.lists.trees.data[k] - v) <= 0.01 + 1e-6));
    assert.deepEqual([...d.lists.labels.data], [...t.lists.labels.data]);
    // byte grids of any size (the terrain's colours: 17² points, not a multiple of 4)
    assert.deepEqual([...d.grids.terrain.data], [...t.grids.terrain.data]);
    assert.deepEqual(d.grids.surface.names, ['tarmac', 'grass']);
  }
});

test('the terrain meshes are cut from the very heights the physics gets', async () => {
  const d = await decodeTile(encodeTile(sampleTile(), MeshoptEncoder), MeshoptDecoder), m = terrainMeshes(d);
  assert.ok(m.terrain0 && m.terrain1);
  const hf = d.heightfield, N1 = hf.n + 1, cell = hf.size / hf.n;
  for (const mesh of [m.terrain0, m.terrain1]) {
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const c = Math.round((mesh.positions[v * 3] + hf.size / 2) / cell), r = Math.round((mesh.positions[v * 3 + 2] + hf.size / 2) / cell);
      // every vertex is a grid point, at the grid's own height, with its point's colour
      assert.equal(mesh.positions[v * 3 + 1], hf.heights[r + c * N1]);
      assert.deepEqual([...mesh.colours.subarray(v * 4, v * 4 + 3)], d.header.terrain.palette[d.grids.terrain.data[r * N1 + c]]);
    }
    // facing up (x east, z south: anticlockwise seen from above)
    const P = mesh.positions, I = mesh.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ny = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]);
      assert.ok(ny > 0, 'a terrain triangle faces down');
    }
  }
  // the finer level has more triangles
  assert.ok(m.terrain0.indices.length > m.terrain1.indices.length);
});

test('railing colliders: thick, taller than drawn, no gaps at joints and bends', () => {
  // a run round a right-angle bend, the second half on a slope, 7 numbers a piece
  const pieces = [0, 0, 0, 4, 0, 0, 1.0, 4, 0, 0, 8, 0, 0, 1.0, 8, 0, 0, 8, 1, 4, 1.4];
  for (const type of ['guard_rail', 'wall']) {
    const S = barrierShape(type, CFG), boxes = barrierBoxes(type, pieces, CFG);
    assert.equal(boxes.length, 3);
    for (const [k, b] of boxes.entries()) {
      assert.ok(b.halfExtents[2] * 2 >= 0.3, 'at least 0.3 m thick');
      const drawn = pieces[k * 7 + 6];
      // its top over the piece's foot, above what's drawn there
      assert.ok(b.centre[1] + b.halfExtents[1] - (pieces[k * 7 + 1] + pieces[k * 7 + 4]) / 2 > drawn + 0.3, 'taller than drawn');
      // overhanging its piece at both ends by its thickness: neighbours overlap
      const len = Math.hypot(pieces[k * 7 + 3] - pieces[k * 7], pieces[k * 7 + 4] - pieces[k * 7 + 1], pieces[k * 7 + 5] - pieces[k * 7 + 2]);
      assert.ok(Math.abs(b.halfExtents[0] - (len / 2 + S.colliderThickness)) < 1e-9);
    }
    // the drawn rails: one a piece, as tall as the bake says
    const { rails, posts } = barrierInstances(type, pieces, CFG);
    assert.deepEqual(rails.map(r => r.height), [1.0, 1.0, 1.4]);
    if (S.post) assert.ok(posts.length >= 6 && posts.every(p => p.length === 4));
  }
  // the guard rail's own extra height (1.2 m) over the default (0.35)
  assert.equal(barrierShape('guard_rail', CFG).colliderHeight, 0.8 + 1.2);
  assert.equal(barrierShape('wall', CFG).colliderHeight, 1.8 + 0.35);
});

test('the region frame: there and back, to the millimetre', () => {
  const P = projection(37.7942, -122.3954);
  for (const [lat, lon] of [[37.7942, -122.3954], [37.81, -122.47], [37.71, -122.5]]) {
    const [x, z] = P.toXZ(lat, lon), [la, lo] = P.toLatLon(x, z);
    assert.ok(Math.abs(la - lat) < 1e-8 && Math.abs(lo - lon) < 1e-8);
  }
  // east is +x, north is −z
  assert.ok(P.toXZ(37.7942, -122.39)[0] > 0 && P.toXZ(37.80, -122.3954)[1] < 0);
});
