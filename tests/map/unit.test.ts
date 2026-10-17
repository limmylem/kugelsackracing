// Map v3's format modules, quickly (node --test tests/map/unit.test.ts): the projection against PROJ, the
// tile format's round trip on its fixed position grid, the terrain meshes' skirts, the road graph.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { transverseMercator } from '../../map/format/projection.ts';
import { encodeTile, decodeTile } from '../../map/format/tileFormat.ts';
import { terrainMeshes } from '../../map/format/terrainMesh.ts';
import { gridFor, rasterExtent } from '../../map/format/grid.ts';
import { encodeGraph, nearestSeg } from '../../map/format/graph.ts';

await MeshoptEncoder.ready; await MeshoptDecoder.ready;

test('the transverse Mercator agrees with PROJ (cs2cs) to a tenth of a millimetre', () => {
  const P = transverseMercator(37.7715, -122.4375);
  // (cs2cs +proj=longlat +datum=WGS84 +to +proj=tmerc +lat_0=37.7715 +lon_0=-122.4375 +k=1 +ellps=WGS84)
  for (const [lat, lon, e, n] of [[37.7942, -122.3954, 3708.0564, 2520.3617], [37.705, -122.52, -7275.1093, -7377.7333], [37.838, -122.355, 7262.0899, 7384.2274]]) {
    const [x, z] = P.toXZ(lat, lon);
    assert.ok(Math.abs(x - e) < 1e-4 && Math.abs(-z - n) < 1e-4, `${x}, ${-z}`);
    const [la, lo] = P.toLatLon(x, z);
    assert.ok(Math.abs(la - lat) < 1e-9 && Math.abs(lo - lon) < 1e-9);
  }
});

test('the grid: tiles share their edge points; the raster extent is its points as pixel centres', () => {
  const g = gridFor([-700, -300, 900, 200], 512, 2);
  assert.deepEqual([g.i0, g.j0, g.i1, g.j1], [-2, -1, 1, 0]);
  assert.equal(g.W, 4 * 256 + 1); assert.equal(g.H, 2 * 256 + 1);
  const { te, ts } = rasterExtent(g);
  assert.deepEqual(ts, [g.W, g.H]);
  assert.equal(te[0], g.x0 - 1); assert.equal(te[3], -g.z0 + 1);
});

test('a tile comes back on the fixed 1 cm grid: the same world point from two tiles is the same point', async () => {
  const mk = (cx: number) => ({ header: { key: 't', positionQuantum: 0.01, terrain: { palette: [[1, 2, 3]], lodErrors: [0.04] } }, meshes: { roads: { positions: Float32Array.from([1000 - cx, 5.123, 3, 1002.5 - cx, 5.2, 3.333, 1001 - cx, 5.15, 7]), colours: new Uint8Array(12), indices: Uint32Array.from([0, 1, 2]), surfaces: Uint8Array.from([0]) } }, lists: {}, grids: {}, heightfield: null });
  const a = await decodeTile(zlib.gzipSync(encodeTile(mk(768) as any, MeshoptEncoder)), MeshoptDecoder), b = await decodeTile(encodeTile(mk(1280) as any, MeshoptEncoder), MeshoptDecoder);
  for (let k = 0; k < 9; k += 3) {
    assert.ok(Math.abs(a.meshes.roads.positions[k] + 768 - (b.meshes.roads.positions[k] + 1280)) < 1e-6, 'the shared x differs');
    assert.ok(Math.abs(a.meshes.roads.positions[k + 1] - b.meshes.roads.positions[k + 1]) < 1e-6);
  }
});

test('a quantised list keeps heights past int16\'s reach: a tree at 700 m, a barrier at 400 m (once 655 m and 327 m)', async () => {
  const t = { header: { key: 't' }, meshes: {}, grids: {}, heightfield: null, lists: {
    trees: { stride: 5, quantum: 0.02, data: Float32Array.from([10.5, 700.13, -20.25, 0.9, 8, -200, 690.5, 240, 1, 3]) },
    barrier_guard: { stride: 8, quantum: 0.01, data: Float32Array.from([1, 400.12, 2, 3, 401.5, 4, 0.8, 0]) },
    low: { stride: 2, quantum: 0.02, data: Float32Array.from([1.5, 30.26]) } } };
  const d = await decodeTile(encodeTile(t as any, MeshoptEncoder), MeshoptDecoder);
  for (const [name, L] of Object.entries<any>(t.lists)) for (let k = 0; k < L.data.length; k++) assert.ok(Math.abs(d.lists[name].data[k] - L.data[k]) <= L.quantum / 2 + 1e-4, `${name}[${k}]: ${d.lists[name].data[k]} for ${L.data[k]}`);
});

test('terrain meshes: cut from the heightfield, with skirts round the edges, normals untouched', async () => {
  const n = 16, N1 = n + 1, heights = new Float32Array(N1 * N1).map((_, k) => Math.round(Math.sin(k / 7) * 300) / 100);
  const t = await decodeTile(encodeTile({ header: { key: 't', terrain: { palette: [[9, 9, 9]], lodErrors: [0.01] } }, meshes: {}, lists: {}, grids: {}, heightfield: { n, size: 32, heights, quantum: 0.01 } } as any, MeshoptEncoder), MeshoptDecoder);
  const m: any = (terrainMeshes(t) as any).terrain0;
  assert.ok(m.skirtFrom > 0 && m.skirtFrom < m.indices.length, 'no skirt');
  // every surface vertex a grid point at its height
  const surf = new Set<number>(Array.from(m.indices.slice(0, m.skirtFrom)));
  for (const v of surf) { const c = Math.round((m.positions[v * 3] + 16) / 2), r = Math.round((m.positions[v * 3 + 2] + 16) / 2); assert.ok(Math.abs(m.positions[v * 3 + 1] - t.heightfield.heights[r + c * N1]) < 1e-5); }
  // skirt triangles never use a surface vertex (so the surface's smooth normals are its own)
  for (let k = m.skirtFrom; k < m.indices.length; k++) assert.ok(!surf.has(m.indices[k]));
});

test('the road graph: OSM nodes kept with their ids and coordinates; nearest segment', () => {
  const nodes = [{ id: 11, lat: 1, lon: 2, x: 0, z: 0, h: 5 }, { id: 12, lat: 1.1, lon: 2.1, x: 10, z: 0, h: 6 }];
  const segs = [{ id: 0, from: 0, to: 1, osmWay: 99, name: 'Main St', cls: 'primary', rank: 7, link: false, lanes: 2, lanesEstimated: true, oneway: 0, maxspeed: 40, width: 6.8, widthEstimated: true, structure: 'ground', layer: 0, surface: 'tarmac', xs: [0, 5, 10], zs: [0, 0.5, 0], h: [5, 5.5, 6], orig: [true, false, true], osmNodes: [11, null, 12], lat: [1, NaN, 1.1], lon: [2, NaN, 2.1] }];
  const G = encodeGraph('t', nodes, segs);
  assert.deepEqual(G.segs[0].osm, [[0, 11, 1, 2], [2, 12, 1.1, 2.1]]);
  assert.equal(G.segs[0].points.length, 9);
  assert.equal(nearestSeg(G, 5, 3)?.seg.name, 'Main St');
  assert.equal(nearestSeg(G, 5, 80), null);
});

test('buildings: walls face out and roofs up, whichever way round the footprint is drawn', async () => {
  const { extrude } = await import('../../map/bake/extrude.ts');
  const cfg = JSON.parse((await import('node:fs')).readFileSync(new URL('../../data/map/bake.json', import.meta.url), 'utf8')).buildings;
  const square = [[0, 0], [20, 0], [20, 12], [0, 12]];
  for (const ring of [square, [...square].reverse()]) for (const rs of [undefined, 'gabled']) {
    const e: any = extrude({ id: 1, rings: [ring.map(p => [...p])], props: { h: 10, rs, rh: 3 } }, () => 0, cfg);
    const check = (m, wantOut: boolean) => {
      const P = m.positions, I = m.indices;
      for (let k = 0; k < I.length; k += 3) {
        const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
        const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        // (three.js draws anticlockwise faces: the normal must point away from the building's middle)
        const mid = [(P[a] + P[b] + P[c]) / 3 - 10, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - 6];
        if (wantOut) assert.ok(n[0] * mid[0] + n[2] * mid[2] > 0 || Math.hypot(n[0], n[2]) < 1e-9, `a wall faces in (${rs ?? 'flat'})`);
        else assert.ok(n[1] >= -1e-9, `a roof faces down (${rs ?? 'flat'})`);
      }
    };
    check(e.walls, true); check(e.roof, false);
  }
});

test('a ground piece inside a bridge or a tunnel (OSM tagging gaps) is baked as part of it; a real ground road is not', async () => {
  const { relabelStructures } = await import('../../map/bake/roads.ts');
  const seg = (id: number, from: number, to: number, structure: string, len = 50, layer = 0) => ({ id, from, to, s: [0, len], structure, layer });
  const graph = (segs: any[], n: number) => Array.from({ length: n }, (_, k) => ({ segs: segs.filter(g => g.from === k || g.to === k).map(g => g.id) }));
  // a viaduct: ground 6-0 (where it comes down), bridge 0-1, ground 1-2 (an untagged gap), bridge 2-3, ground 3-4 and 4-5
  // (it comes down and a street meets it at 4: real ground roads)
  const v = [seg(0, 0, 1, 'bridge', 300, 1), seg(1, 1, 2, 'ground'), seg(2, 2, 3, 'bridge', 300, 1), seg(3, 3, 4, 'ground'), seg(4, 4, 5, 'ground'), seg(5, 4, 7, 'ground'), seg(6, 6, 0, 'ground')];
  assert.equal(relabelStructures(graph(v, 8), v), 1);
  assert.equal(v[1].structure, 'bridge'); assert.equal(v[1].layer, 1);
  assert.equal(v[3].structure, 'ground', 'its end on a street: ground');
  // a tunnel with two ground pieces in a row inside it
  const t = [seg(0, 0, 1, 'tunnel', 200, -1), seg(1, 1, 2, 'ground', 40), seg(2, 2, 3, 'ground', 40), seg(3, 3, 4, 'tunnel', 200, -1)];
  assert.equal(relabelStructures(graph(t, 5), t), 2);
  assert.ok(t.every(g => g.structure === 'tunnel' && g.layer === -1));
  // a long stretch of ground between two bridges (an island) stays ground; so does a bridge to a tunnel
  const l = [seg(0, 0, 1, 'bridge', 100), seg(1, 1, 2, 'ground', 900), seg(2, 2, 3, 'bridge', 100)];
  assert.equal(relabelStructures(graph(l, 4), l), 0);
  const m = [seg(0, 0, 1, 'bridge', 100), seg(1, 1, 2, 'ground', 60), seg(2, 2, 3, 'tunnel', 100)];
  assert.equal(relabelStructures(graph(m, 4), m), 0);
});

test('a tree\'s canopy as drawn: a surface through it, not one under its rounded edge; a tree too big for its spot drawn smaller', async () => {
  const { canopyAt, crownThrough, fitScale } = await import('../../map/model/vegetation.ts');
  // (a broadleaf of sc 3: an ellipsoid round 3.75 m, 2.1 m high either side, 2.25 m round; a conifer's cone 0.35 sc up)
  assert.deepEqual(canopyAt(0, 3, 0)!.map(v => +v.toFixed(2)), [1.65, 5.85]);
  assert.equal(canopyAt(0, 3, 2.25), null);
  assert.deepEqual(canopyAt(1, 2, 0)!.map(v => +v.toFixed(2)), [0.7, 5.9]);
  // a footpath 2 m up a bank from the tree's foot, from 1 m out: through a sc-3 broadleaf's canopy half way out (it
  // spans 1.93-5.57 m there), clear of a sc-2.4 one's (its rings at 0.9 m, inside the bank, and 1.62 m: 2.27-3.73 m)
  const bank = (x: number, z: number) => (Math.hypot(x, z) >= 1 ? [2] : []);
  assert.ok(crownThrough(0, 3, 0, 0, 0, bank));
  assert.ok(!crownThrough(0, 2.4, 0, 0, 0, bank));
  assert.ok(Math.abs(fitScale(0.75, s => !crownThrough(0, s * 4, 0, 0, 0, bank)) - 0.6) < 1e-9);
  // a road under it (at its foot) or a deck over its top: not through it; one through it nowhere it can shrink out of: left out
  assert.ok(!crownThrough(0, 3, 0, 0, 0, () => [0.1, 6.5]));
  assert.equal(fitScale(1, s => !crownThrough(0, s * 4, 0, 0, 0, () => [s * 4 * 1.25])), 0);
});

test('a junction patch\'s outline without hairpins: a sliver running out and back taken out, near-duplicate points merged', async () => {
  const { despike } = await import('../../map/model/topology.ts');
  const cos170 = Math.cos(170 * Math.PI / 180);
  // a 10 m square with a 1 m spike out of its top edge 4 mm wide, and a point 3 mm from the corner after it
  const ring = [[0, 0], [10, 0], [10, 10], [6, 10], [6.002, 11], [6.004, 10], [0, 10], [0, 10.003]];
  const out = despike(ring, cos170, 0.01);
  assert.ok(out.every(p => p[1] <= 10.0031), `spike left: ${JSON.stringify(out)}`);
  assert.ok([[0, 0], [10, 0], [10, 10]].every(c => out.some(p => p[0] === c[0] && p[1] === c[1])));
  assert.ok(out.length <= 5, `${out.length} points: ${JSON.stringify(out)}`);
  // a clean ring is left as it is
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(despike(sq, cos170, 0.01), sq);
});
