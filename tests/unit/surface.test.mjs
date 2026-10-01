// Unit tests for the real world's collision (realworld/surface.js): roads built from map data onto
// terrain, checked by casting rays at the result in Rapier, as the car's wheels do.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { chunk, chunkAt, mPerDegLat, mPerDegLon } from '../../realworld/chunks.js';
import { buildChunk } from '../../realworld/surface.js';
import { readFileSync } from 'node:fs';
import { roadInfo, metres, readOverpass } from '../../realworld/osm.js';
import { LocalFrame } from '../../physics/geo.js';
import { createSimulation } from '../../physics/sim.js';

const H = await harness(), R = H.RAPIER;
const C0 = chunkAt(47.0, 8.0);
const RAD = Math.PI / 180;

// A road through local points [east, north] (metres from a chunk's centre); ids: its map nodes
let nextId = 1;
function road(c, pts, tags, ids = null) {
  const lat = [], lon = [], nodes = [];
  pts.forEach(([e, n], k) => { lat.push(c.latC + n / mPerDegLat(c.latC)); lon.push(c.lonC + e / mPerDegLon(c.latC)); nodes.push(ids?.[k] ?? 1e6 + nextId++); });
  return { id: nextId++, nodes, lat: Float64Array.from(lat), lon: Float64Array.from(lon), tags };
}
const line = (a, b, step = 25) => { const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)), out = []; for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return out; };
// terrain from a function of local metres (east, north) round C0, as heights above the ellipsoid
const ground = (fn, c = C0) => (lat, lon) => 400 + fn((lon - c.lonC) * mPerDegLon(c.latC), (lat - c.latC) * mPerDegLat(c.latC));

// Chunks in one Rapier world, in the first one's frame; top(x, z) casts down from high up, rayUp
// looks for a roof
function world(results) {
  const w = new R.World({ x: 0, y: -9.81, z: 0 }), ref = results[0].frame, F = new LocalFrame(ref.lat * RAD, ref.lon * RAD, ref.height);
  for (const r of results) {
    const T = new LocalFrame(r.frame.lat * RAD, r.frame.lon * RAD, r.frame.height).transformTo(F);
    const body = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(...T.translation).setRotation(T.rotation));
    w.createCollider(R.ColliderDesc.heightfield(r.heightfield.n, r.heightfield.n, r.heightfield.heights, { x: r.heightfield.size, y: 1, z: r.heightfield.size }), body);
    for (const m of Object.values(r.meshes)) if (m.indices.length) w.createCollider(R.ColliderDesc.trimesh(m.vertices, m.indices), body);
  }
  w.step();
  const cast = (x, y, z, dy, reach) => { const hit = w.castRay(new R.Ray({ x, y, z }, { x: 0, y: dy, z: 0 }), reach, true); return hit ? y + dy * hit.timeOfImpact : null; };
  return { w, top: (x, z, from = 500) => cast(x, from, z, -1, 1000), down: (x, y, z) => cast(x, y, z, -1, 50), up: (x, y, z) => cast(x, y, z, 1, 50) };
}
const build = (roads, terrain, c = C0, options = {}) => buildChunk({ chunk: c, terrain, roads, options: { debug: true, ...options } });

test('map tags: road widths, bridges, tunnels, layers', () => {
  assert.equal(metres('7.5 m'), 7.5); assert.equal(metres("12'"), 12 * 0.3048); assert.equal(metres('wide'), null);
  const m = roadInfo({ highway: 'motorway', lanes: '3' });
  assert.ok(m.oneway && Math.abs(m.width - (3 * 3.6 + 3)) < 1e-9);
  assert.equal(roadInfo({ highway: 'residential', width: '6' }).width, 6);
  assert.deepEqual([roadInfo({ highway: 'primary', bridge: 'yes' }).kind, roadInfo({ highway: 'primary', bridge: 'yes' }).layer], ['bridge', 1]);
  assert.deepEqual([roadInfo({ highway: 'primary', tunnel: 'yes' }).kind, roadInfo({ highway: 'primary', tunnel: 'yes' }).layer], ['tunnel', -1]);
  assert.equal(roadInfo({ highway: 'service', tunnel: 'building_passage' }).kind, 'ground');
  assert.equal(roadInfo({ highway: 'track', tracktype: 'grade3' }).surface, 'dirt');
});

test('a road on a hillside: level across (just its camber), the ground cut and filled to meet its edges', () => {
  const slope = ground((e, n) => 0.12 * n);                       // 12% up to the north
  const ew = road(C0, line([-700, 0], [700, 0]), { highway: 'primary' });
  const r = build([ew], slope), W = world([r]), hw = roadInfo(ew.tags).halfWidth;
  for (const x of [-301.3, -118.7, 1.1, 91.7, 248.9]) {       // (not exactly on a map node: a ray right on a triangle edge can slip through)
    const crown = W.top(x, 0);
    assert.ok(Math.abs(crown - r.debug.groundAt(x, 0)) < 0.05, `crown ${crown} on the ground ${r.debug.groundAt(x, 0)}`);
    for (const d of [-hw + 0.2, hw - 0.2]) assert.ok(Math.abs(W.top(x, d) - (crown - 0.02 * Math.abs(d))) < 0.02, `level across at ${x}, ${d}`);
    // uphill side: the ground's cut back to the edge; downhill: filled up to it (no lip, no drop)
    for (const d of [-(hw + 0.6), hw + 0.6]) assert.ok(Math.abs(W.top(x, d) - (crown - 0.02 * hw)) < 0.12, `edge at ${x}, ${d}: ${W.top(x, d)} vs ${crown - 0.02 * hw}`);
    // and further out it's back to the hillside
    assert.ok(Math.abs(W.top(x, -40) - r.debug.groundAt(x, -40)) < 0.01);
  }
});

test('a junction on a slope: the major road has no bump where the minor one joins it', () => {
  const slope = ground((e, n) => 0.06 * n + 0.04 * e);
  const ew = road(C0, line([-600, 0], [600, 0], 20), { highway: 'secondary' }, null);
  const mid = Math.round(ew.nodes.length / 2) - 1, [e0, n0] = [(ew.lon[mid] - C0.lonC) * mPerDegLon(C0.latC), (ew.lat[mid] - C0.latC) * mPerDegLat(C0.latC)];
  const ns = road(C0, [[e0, n0], ...line([e0, n0 + 20], [e0, n0 + 600]).slice(0)], { highway: 'residential' }, [ew.nodes[mid]]);
  ns.lat[0] = ew.lat[mid]; ns.lon[0] = ew.lon[mid];
  const r = build([ew, ns], slope), W = world([r]), way = r.debug.ways.find(w => w.id === ew.id);
  const profile = x => { const p = way.points; for (let i = 1; i < p.length; i++) if (p[i][0] >= x) { const t = (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t; } };
  const [x0, , z0] = r.debug.ways.find(w => w.id === ns.id).points[0];
  let worst = 0;
  for (let x = x0 - 25; x <= x0 + 25; x += 0.5)
    for (const d of [-2.5, 0, 2.5]) worst = Math.max(worst, Math.abs(W.top(x, z0 + d) - (profile(x) - 0.02 * Math.abs(d))));
  assert.ok(worst < 0.02, `the major road's surface moves ${worst.toFixed(3)} m across the junction`);
});

test('an overpass on flat ground: the bridge clears the road under it, with ramps, and the ground stays clear under it', () => {
  const flat = ground(() => 0);
  const ew = road(C0, line([-700, 0], [700, 0]), { highway: 'primary' });
  const south = road(C0, line([0, -700], [0, -45]), { highway: 'motorway' }), bridge = road(C0, line([0, -45], [0, 45], 15), { highway: 'motorway', bridge: 'yes', layer: '1' }), north = road(C0, line([0, 45], [0, 700]), { highway: 'motorway' });
  bridge.nodes[0] = south.nodes.at(-1); bridge.nodes[bridge.nodes.length - 1] = north.nodes[0];
  bridge.lat[0] = south.lat.at(-1); bridge.lon[0] = south.lon.at(-1); bridge.lat[bridge.lat.length - 1] = north.lat[0]; bridge.lon[bridge.lon.length - 1] = north.lon[0];
  const r = build([ew, south, bridge, north], flat), W = world([r]);
  const deck = W.top(0, 0), below = W.down(0, 2, 0);
  assert.ok(Math.abs(below) < 0.05, `the road under the bridge is still at ground level (${below})`);
  assert.ok(deck - below > 4.8, `the bridge is ${(deck - below).toFixed(2)} m over the road`);
  assert.ok(W.up(3, 0.3, 0) - 0.3 > 3.8, 'a car fits under it');
  // ramps: never steeper than the grade (plus rounding)
  let steepest = 0, prev = null;
  for (let n = -400; n <= 400; n += 4) { const y = W.top(0, -n); if (prev !== null) steepest = Math.max(steepest, Math.abs(y - prev) / 4); prev = y; }
  assert.ok(steepest < 0.055, `steepest ramp ${steepest.toFixed(3)}`);
  // under the deck, away from the road beneath, the ground is well below it
  const hf = r.heightfield, N1 = hf.n + 1, cell = hf.size / hf.n, i = Math.round(hf.size / 2 / cell), j = Math.round((hf.size / 2 - 25) / cell);
  assert.ok(hf.heights[j + i * N1] < W.top(0, -25) - 2.9, 'ground under the bridge');
});

test('a tunnel through a hill: under the ground, walls and a roof, open at both ends', () => {
  const hill = ground((e, n) => 45 * Math.exp(-(e * e + n * n) / (2 * 200 * 200)));
  const south = road(C0, line([0, -700], [0, -250]), { highway: 'primary' }), tunnel = road(C0, line([0, -250], [0, 250], 20), { highway: 'primary', tunnel: 'yes' }), north = road(C0, line([0, 250], [0, 700]), { highway: 'primary' });
  tunnel.nodes[0] = south.nodes.at(-1); tunnel.nodes[tunnel.nodes.length - 1] = north.nodes[0];
  tunnel.lat[0] = south.lat.at(-1); tunnel.lon[0] = south.lon.at(-1); tunnel.lat[tunnel.lat.length - 1] = north.lat[0]; tunnel.lon[tunnel.lon.length - 1] = north.lon[0];
  const r = build([south, tunnel, north], hill), W = world([r]);
  assert.ok(r.meshes.cover.indices.length > 0, 'it has a roof');
  const road0 = W.down(0, r.debug.ways.find(w => w.id === tunnel.id).points.find(p => Math.abs(p[2]) < 11)[1] + 1.5, 0);
  assert.ok(road0 < r.debug.groundAt(0, 0) - 6.5, `the tunnel runs ${(r.debug.groundAt(0, 0) - road0).toFixed(1)} m under the hilltop`);
  assert.ok(Math.abs(W.top(0, 0) - r.debug.groundAt(0, 0)) < 0.3, 'from above: the hill');
  // drive through it: the road is under the wheels all the way, nothing in the way above
  let prev = null, steepest = 0;
  const along = r.debug.ways.flatMap(w => w.points).sort((p, q) => p[2] - q[2]);
  const profileAt = z => { for (let i = 1; i < along.length; i++) if (along[i][2] >= z) { const t = (z - along[i - 1][2]) / ((along[i][2] - along[i - 1][2]) || 1); return along[i - 1][1] + (along[i][1] - along[i - 1][1]) * t; } };
  for (let n = -480; n <= 480; n += 4) {
    const ahead = profileAt(-n);
    const y = W.down(0, ahead + 1.5, -n);
    assert.ok(Math.abs(y - ahead) < 0.1, `road under the wheels ${n} m north (${y} vs ${ahead})`);
    const roof = W.up(0, y + 0.3, -n);
    assert.ok(roof === null || roof - y > 4, `headroom ${n} m north: ${roof === null ? 'open' : (roof - y).toFixed(2)}`);
    if (prev !== null && Math.abs(n) < 250) steepest = Math.max(steepest, Math.abs(y - prev) / 4);   // (outside it the roads follow the hill)
    prev = y;
  }
  assert.ok(steepest < 0.055, `steepest in the tunnel ${steepest.toFixed(3)}`);
  // its sides are walls
  const inside = W.down(0, road0 + 1.5, 0);
  const wall = new R.Ray({ x: 0, y: inside + 1, z: 0 }, { x: 1, y: 0, z: 0 });
  assert.ok(W.w.castRay(wall, 12, true), 'a wall beside the tunnel');
});

test('neighbouring chunks agree where they meet', () => {
  const hills = ground((e, n) => 12 * Math.sin(e / 90) * Math.cos(n / 130) + 0.03 * e);
  const C1 = chunk(C0.j, C0.i + 1), east = (C0.lon1 - C0.lonC) * mPerDegLon(C0.latC);
  const diagonal = road(C0, line([east - 500, -300], [east + 500, 250], 30), { highway: 'secondary' });
  const a = build([diagonal], hills, C0), b = build([diagonal], hills, C1);
  // the terrain: each chunk on its own, points of a's moved into b's frame must be on b's
  const A = world([a]), B = world([b]);
  const toB = new LocalFrame(a.frame.lat * RAD, a.frame.lon * RAD, a.frame.height).transformTo(new LocalFrame(b.frame.lat * RAD, b.frame.lon * RAD, b.frame.height));
  const inB = p => toB.rows.map((row, k) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + toB.translation[k]);
  const way = a.debug.ways[0].points, offRoad = (x, z) => way.every(p => Math.hypot(p[0] - x, p[2] - z) > 25);
  let worst = 0, n = 0;
  for (let z = -450; z <= 450; z += 5) for (let x = east - 3; x <= east + 3; x += 1.5) {
    if (!offRoad(x, z)) continue;
    const ya = A.top(x, z), q = inB([x, ya, z]), yb = B.top(q[0], q[2]);
    worst = Math.max(worst, Math.abs(yb - q[1])); n++;
  }
  assert.ok(n > 200 && worst < 0.01, `the terrain of the two chunks differs by up to ${worst.toFixed(4)} m at their border (${n} points)`);
  // the road across the border, both chunks loaded: smooth and on its profile all the way
  const both = world([a, b]), crossing = way.filter(p => Math.abs(p[0] - east) < 60);
  let jump = 0, off = 0, prev = null;
  for (let i = 1; i < crossing.length; i++) {
    const [x0, y0, z0] = crossing[i - 1], [x1, y1, z1] = crossing[i];
    for (let t = 0; t < 1; t += 0.05) {
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = both.top(x, z);
      off = Math.max(off, Math.abs(y - (y0 + (y1 - y0) * t)));
      if (prev !== null) jump = Math.max(jump, Math.abs(y - prev));
      prev = y;
    }
  }
  assert.ok(off < 0.02 && jump < 0.05, `across the border the road is off its profile by ${off.toFixed(3)} m, steps ${jump.toFixed(3)} m`);
});

test('driving flat out along a real-world road: the car stays on it, smoothly, across chunks', () => {
  const rolling = ground((e, n) => 6 * Math.sin(e / 300) + 0.01 * n);
  const cs = [chunk(C0.j, C0.i - 1), C0, chunk(C0.j, C0.i + 1)];
  const long = road(C0, line([-1600, 0], [1600, 0], 40), { highway: 'trunk' });
  const results = cs.map(c => build([long], rolling, c));
  const spec = H.garage().stats().spec, sockets = H.socketsOf(spec);
  const sim = createSimulation(R, { settings: H.settings, spec, sockets, track: { spawn: { position: [0, 0, 0], headingDeg: 90 } } });
  const F = new LocalFrame(results[1].frame.lat * RAD, results[1].frame.lon * RAD, results[1].frame.height);
  for (const r of results) {
    const T = new LocalFrame(r.frame.lat * RAD, r.frame.lon * RAD, r.frame.height).transformTo(F);
    const descs = [R.ColliderDesc.heightfield(r.heightfield.n, r.heightfield.n, r.heightfield.heights, { x: r.heightfield.size, y: 1, z: r.heightfield.size }), ...Object.values(r.meshes).filter(m => m.indices.length).map(m => R.ColliderDesc.trimesh(m.vertices, m.indices))];
    sim.addStatic({ position: T.translation, rotation: T.rotation }, descs);
  }
  const start = results[1].debug.groundAt(-1300, 0);
  sim.resetCar({ position: [-1300, start + spec.spawnHeight, 0], headingDeg: 90 });
  for (let i = 0; i < 120; i++) sim.step({ throttle: 0, brake: 1, steer: 0 });   // (settle on the road first)
  let top = 0, airborne = 0, worstJerk = 0, lastVy = null;
  for (let i = 0; i < 120 * 40; i++) {
    sim.step({ throttle: 1, brake: 0, steer: 0 });
    const v = sim.vehicle, p = v.body.translation(), vy = v.body.linvel().y;
    if (!Number.isFinite(p.y)) assert.fail('the car went NaN');
    top = Math.max(top, v.forwardSpeed() * 3.6);
    if (!v.wheels.some(w => w.grounded)) airborne++;
    if (lastVy !== null) worstJerk = Math.max(worstJerk, Math.abs(vy - lastVy) * 120);
    lastVy = vy;
    if (p.x > 1450) break;
    assert.ok(Math.abs(p.z) < 3 && p.y > results[1].debug.groundAt(p.x, 0) - 1, `on the road at ${p.x.toFixed(0)} m (${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  }
  assert.ok(top > 150, `top speed on the way ${top.toFixed(0)} km/h`);
  assert.equal(airborne, 0, `all four wheels off the road for ${airborne} steps`);
  assert.ok(worstJerk < 25, `worst vertical kick ${worstJerk.toFixed(1)} m/s²`);
});

test('real map data (Manhattan by the Queensboro Bridge): smooth profiles, and every crossing clears', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/osm_manhattan_queensboro.json', import.meta.url)));
  const c = chunk(...fixture.chunk), roads = readOverpass(fixture).roads, t0 = performance.now();
  const r = buildChunk({ chunk: c, terrain: () => 10, roads, options: { debug: true } });
  const ms = performance.now() - t0, ways = r.debug.ways, inChunk = p => Math.abs(p[0]) < 500 && Math.abs(p[2]) < 500;
  assert.ok(ms < 4000, `built in ${Math.round(ms)} ms`);
  assert.ok(r.stats.bridges > 10 && r.stats.tunnels > 5 && r.meshes.walls.indices.length > 0 && r.meshes.roads.indices.length > 50000);
  // no road zigzags up and down from one point to the next
  let zig = 0, where = null;
  for (const w of ways) for (let i = 1; i + 1 < w.points.length; i++) {
    const [a, b, d] = [w.points[i - 1], w.points[i], w.points[i + 1]];
    if (!inChunk(b)) continue;
    const s1 = (b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[2] - a[2]) || 1), s2 = (d[1] - b[1]) / (Math.hypot(d[0] - b[0], d[2] - b[2]) || 1);
    if (Math.abs(s2 - s1) > zig) { zig = Math.abs(s2 - s1); where = `${w.info.name ?? w.info.highway} at ${b.map(x => x.toFixed(0))}`; }
  }
  assert.ok(zig < 0.08, `the grade jumps by ${zig.toFixed(3)} from one point to the next (${where})`);
  // where roads on different layers cross (not where they join), the upper one clears the lower
  let worst = Infinity, at = null;
  for (const a of ways) for (const b of ways) {
    if (a.info.layer <= b.info.layer) continue;
    const joined = a.points.some(p => b.points.some(q => Math.hypot(p[0] - q[0], p[2] - q[2]) < 30 && Math.abs(p[1] - q[1]) < 0.5));
    if (joined) continue;
    for (const p of a.points) {
      if (!inChunk(p)) continue;
      for (const q of b.points) if (Math.hypot(p[0] - q[0], p[2] - q[2]) < 2 && p[1] - q[1] < worst) { worst = p[1] - q[1]; at = `${a.info.name ?? a.info.highway} over ${b.info.name ?? b.info.highway}`; }
    }
  }
  // (full clearance where there's room; where a ramp has to meet a street junction close by, at least
  // room for the car)
  assert.ok(worst > 2.8, `${at}: only ${worst.toFixed(2)} m apart`);
});

test('a long bridge across two chunks: both build the same deck where they meet', () => {
  const valley = ground((e, n) => -25 * Math.exp(-((e - 500) ** 2) / (2 * 400 * 400)));
  const east = (C0.lon1 - C0.lonC) * mPerDegLon(C0.latC), C1 = chunk(C0.j, C0.i + 1);
  const west = road(C0, line([east - 1800, 30], [east - 900, 30]), { highway: 'primary' });
  const span = road(C0, line([east - 900, 30], [east + 900, 30], 450), { highway: 'primary', bridge: 'yes' });     // (a few long pieces, like real bridge ways)
  const eastRoad = road(C0, line([east + 900, 30], [east + 1800, 30]), { highway: 'primary' });
  span.nodes[0] = west.nodes.at(-1); span.lat[0] = west.lat.at(-1); span.lon[0] = west.lon.at(-1);
  const last = span.nodes.length - 1; span.nodes[last] = eastRoad.nodes[0]; span.lat[last] = eastRoad.lat[0]; span.lon[last] = eastRoad.lon[0];
  const all = [west, span, eastRoad];
  const a = build(all, valley, C0), b = build(all, valley, C1), both = world([a, b]);
  const deckA = a.debug.ways.find(w => w.id === span.id).points, deckB = b.debug.ways.find(w => w.id === span.id).points;
  // the same points, in a's frame: compare heights near the border
  const toA = new LocalFrame(b.frame.lat * RAD, b.frame.lon * RAD, b.frame.height).transformTo(new LocalFrame(a.frame.lat * RAD, a.frame.lon * RAD, a.frame.height));
  const inA = p => toA.rows.map((row, k) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + toA.translation[k]);
  let worst = 0;
  for (const p of deckB.map(inA)) {
    if (Math.abs(p[0] - east) > 60) continue;
    const q = deckA.reduce((best, x) => Math.hypot(x[0] - p[0], x[2] - p[2]) < Math.hypot(best[0] - p[0], best[2] - p[2]) ? x : best);
    if (Math.hypot(q[0] - p[0], q[2] - p[2]) < 0.5) worst = Math.max(worst, Math.abs(q[1] - p[1]));
  }
  assert.ok(worst < 0.02, `the two chunks' decks differ by ${worst.toFixed(3)} m at their border`);
  // and driving across the border on it, no step
  let jump = 0, prev = null;
  for (let x = east - 40; x <= east + 40; x += 0.5) { const y = both.top(x, -30); if (prev !== null) jump = Math.max(jump, Math.abs(y - prev)); prev = y; }
  assert.ok(jump < 0.05, `a ${jump.toFixed(3)} m step on the deck at the border`);
});
