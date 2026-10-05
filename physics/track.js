// Turns a world description (scenes/*.json) into plain data used by both the physics and the
// renderer, so what you see is exactly what the car drives on:
//  - trackShapes: fixed colliders (ground, terrain heightfield, boxes, ramps, bumps, tree trunks)
//  - trackProps: loose objects that can be knocked about (cones)
//  - roadCenterline: smooth centre line of a road (drawn; keeps trees off it; roads can be carved
//    into the terrain, see terrain.js carveRoads)
//  - surfaceMap: which surface (gravel, grass, …) is where, for tyre grip
//  - roadSpawn: a start position and heading on a road
// No rendering library; the same numbers come out in the page, a Web Worker or on a server.

import { add, rotate, quatFromAxisAngle, quatFromEulerDeg, quatMultiply, scale } from './math.js';
import { carveRoads, makeTerrain, terrainFromHeights } from './terrain.js';

const ROAD_STEP = 2;   // m between centre-line points used for carving and placing things on roads
const cache = new WeakMap(), lines = new WeakMap();
export function terrainOf(track) {
  // (a generated track's ground: its height grid, made by track/build.js)
  if (track.generated?.terrain) {
    if (!cache.has(track)) { const T = track.generated.terrain; cache.set(track, terrainFromHeights(T.n, T.size, T.heights)); }
    return cache.get(track);
  }
  if (!track.terrain) return null;
  if (!cache.has(track)) {
    const t = makeTerrain(track.terrain);
    if (track.terrain.carve) carveRoads(t, (track.roads || []).map(road => ({ road, line: roadLine(road) })), track.terrain.carve, ROAD_STEP);
    cache.set(track, t);
  }
  return cache.get(track);
}
// Cached centre line of a road at ROAD_STEP spacing
export function roadLine(road) {
  if (!lines.has(road)) lines.set(road, roadCenterline(road, ROAD_STEP));
  return lines.get(road);
}
const groundAt = (track, x, z) => terrainOf(track)?.heightAt(x, z) ?? 0;

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Centripetal Catmull-Rom through the road's points (closed loop or open), resampled every `step`
// metres: [{ x, z, tx, tz (unit tangent), curvature (1/m, + = turning left) }]
export function roadCenterline(road, step = 3) {
  const P = road.points, n = P.length, closed = road.closed;
  const get = i => closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))];
  const dense = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-6;
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    for (let k = 0; k < 24; k++) {
      const t = t1 + (t2 - t1) * k / 24;
      const lerp = (a, b, ta, tb) => [0, 1].map(d => ((tb - t) * a[d] + (t - ta) * b[d]) / (tb - ta));
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
      dense.push(lerp(B1, B2, t1, t2));
    }
  }
  if (!closed) dense.push(P[n - 1]);
  // resample by distance
  const out = [];
  let carry = 0;
  const total = closed ? dense.length : dense.length - 1;
  for (let i = 0; i < total; i++) {
    const a = dense[i], b = dense[(i + 1) % dense.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    for (; d < len; d += step) out.push([a[0] + (b[0] - a[0]) * d / len, a[1] + (b[1] - a[1]) * d / len]);
    carry = d - len;
  }
  const m = out.length;
  return out.map((p, i) => {
    const prev = out[closed ? (i - 1 + m) % m : Math.max(0, i - 1)], next = out[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
    const tx = next[0] - prev[0], tz = next[1] - prev[1], tl = Math.hypot(tx, tz) || 1;
    const h1 = Math.atan2(p[1] - prev[1], p[0] - prev[0]), h2 = Math.atan2(next[1] - p[1], next[0] - p[0]);
    const turn = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    return { x: p[0], z: p[1], tx: tx / tl, tz: tz / tl, curvature: turn / step };
  });
}

// Trees: seeded positions on the terrain, kept off roads, flat zones, props and the spawn point
export function treePositions(track) {
  const T = track.trees, terrain = terrainOf(track);
  if (!T || !terrain) return [];
  const rnd = mulberry32(T.seed), lines = (track.roads || []).map(r => roadCenterline(r, 6)), out = [];
  const spawn = roadSpawn(track) || track.spawn;
  const keepClear = [...trackProps(track).map(p => [p.position[0], p.position[2]]), [spawn.position[0], spawn.position[2]]];
  const reach = terrain.half - terrain.cell * 2;
  for (let tries = 0; out.length < T.count && tries < T.count * 20; tries++) {
    const x = (rnd() * 2 - 1) * reach, z = (rnd() * 2 - 1) * reach;
    if (lines.some(line => line.some(p => Math.hypot(p.x - x, p.z - z) < T.roadClearance))) continue;
    if ((track.terrain.flat || []).some(f => Math.hypot(f.centre[0] - x, f.centre[1] - z) < f.inner)) continue;
    if (keepClear.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < T.propClearance)) continue;
    const size = T.minSize + rnd() * (T.maxSize - T.minSize);
    out.push({ x, z, y: terrain.heightAt(x, z), size, kind: rnd() < T.coniferShare ? 'conifer' : 'broadleaf', turn: rnd() * Math.PI * 2 });
  }
  return out;
}

export function trackShapes(track) {
  const shapes = [], g = track.ground, terrain = terrainOf(track);
  const top = g?.top ?? 0, th = g?.thickness, flat = { x: 0, y: 0, z: 0, w: 1 };
  const groundBox = (cx, cz, hx, hz) => shapes.push({ kind: 'box', name: 'ground', centre: [cx, top - th / 2, cz], halfExtents: [hx, th / 2, hz], rotation: flat, colour: g.colour, ground: true });
  if (track.generated) {
    // a generated track (track/build.js): its ground and its road — the very arrays it's drawn from
    const G = track.generated;
    shapes.push({ kind: 'heightfield', name: 'terrain', terrain, colour: G.colours?.ground ?? '#6f8a55' });
    shapes.push({ kind: 'trimesh', name: 'road', positions: G.road.positions, indices: G.road.indices, colours: G.road.colours, ground: true, material: 'ground' });
  } else if (!g) { /* no fixed ground: the world streams its own (the real world) */ }
  else if (!terrain) groundBox(0, 0, g.size[0] / 2, g.size[1] / 2);
  else {
    // Flat ground only *around* the terrain (a slab underneath would poke up through its valleys)
    const i = terrain.half, o = g.size[0] / 2, m = (i + o) / 2, w = (o - i) / 2;
    groundBox(0, m, o, w); groundBox(0, -m, o, w); groundBox(m, 0, w, i); groundBox(-m, 0, w, i);
    shapes.push({ kind: 'heightfield', name: 'terrain', terrain, colour: track.terrain.colour });
  }

  for (const o of track.objects || []) {
    if (o.type === 'box') {
      shapes.push({ kind: 'box', name: o.name, centre: o.centre, halfExtents: o.halfExtents, rotation: quatFromEulerDeg(o.rotationDeg || [0, 0, 0]), colour: o.colour, ...(o.material && { material: o.material }) });
    } else if (o.type === 'ramp') {
      // A slab whose top surface starts at `start` and runs `length` metres along +z (turned by
      // `headingDeg`) at `angleDeg` (positive climbs), `thickness` deep underneath
      const heading = quatFromAxisAngle([0, 1, 0], (o.headingDeg || 0) * Math.PI / 180);
      const rot = quatMultiply(heading, quatFromAxisAngle([1, 0, 0], -o.angleDeg * Math.PI / 180));
      const along = rotate(rot, [0, 0, 1]), up = rotate(rot, [0, 1, 0]);
      const centre = add(add(o.start, scale(along, o.length / 2)), scale(up, -o.thickness / 2));
      shapes.push({ kind: 'box', name: o.name, centre, halfExtents: [o.width / 2, o.thickness / 2, o.length / 2], rotation: rot, colour: o.colour });
    } else if (o.type === 'bumps') {
      // Round bars lying across the lane, like speed bumps / kerbs
      for (let i = 0; i < o.count; i++) {
        shapes.push({
          kind: 'capsule', name: `${o.name} ${i + 1}`, centre: [o.start[0], 0, o.start[2] + i * o.spacing],
          radius: o.radius, halfHeight: o.width / 2, rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 2), colour: o.colour,
        });
      }
    } else throw new Error(`unknown track object type ${o.type}`);
  }

  // Tree trunks are solid (the canopies are only drawn)
  for (const t of treePositions(track)) {
    const r = track.trees.trunkRadius * t.size, hh = track.trees.trunkHeight * t.size / 2;
    shapes.push({ kind: 'capsule', name: 'tree', centre: [t.x, t.y + hh + r, t.z], radius: r, halfHeight: hh, rotation: { x: 0, y: 0, z: 0, w: 1 }, tree: t });
  }
  return shapes;
}

// Loose objects the car can knock about
export function trackProps(track) {
  const props = [];
  for (const p of track.props || []) {
    const positions = [];
    if (p.type === 'coneLine') {
      const h = (p.headingDeg || 0) * Math.PI / 180, dx = Math.sin(h), dz = Math.cos(h);
      for (let i = 0; i < p.count; i++) positions.push([p.start[0] + dx * p.spacing * i, p.start[1] + dz * p.spacing * i]);
    } else if (p.type === 'coneRing') {
      for (let i = 0; i < p.count; i++) {
        const a = i / p.count * Math.PI * 2;
        positions.push([p.centre[0] + Math.cos(a) * p.radius, p.centre[1] + Math.sin(a) * p.radius]);
      }
    } else throw new Error(`unknown prop type ${p.type}`);
    const c = track.cone;
    for (const [x, z] of positions)
      props.push({ kind: 'cone', position: [x, groundAt(track, x, z) + c.halfHeight + 0.02, z], halfHeight: c.halfHeight, radius: c.radius, mass: c.mass, friction: c.friction });
  }
  return props;
}

// Start position and heading on a road: spawn.onRoad = { road: index, at: metres along it }.
// Height comes from the (carved) ground. Null if the spawn is given as a plain position.
export function roadSpawn(track) {
  const o = track.spawn.onRoad;
  if (!o) return null;
  const road = track.roads[o.road ?? 0], line = roadLine(road), m = line.length;
  const i = ((Math.round(o.at / ROAD_STEP) % m) + m) % m, p = line[i];
  return { position: [p.x, terrainOf(track)?.heightAt(p.x, p.z) ?? 0, p.z], headingDeg: Math.atan2(p.tx, p.tz) * 180 / Math.PI };
}

// Which surface is where. track.surfaces names the surfaces ({ grip, rollingResistance, marks (skid
// marks' colour), sound, effects: what tyres throw up there — { spray, dust, clippings, smoke: false },
// effects/director.js }); roads say which one they are (road.surface), pads are open areas of one surface
// (track.pads: { surface, centre: [x, z], radius } or { surface, centre, halfExtents: [x, z],
// headingDeg }) and track.offRoad is everything else. Kept in 1 m cells, in 64 m tiles made only where
// something is painted, so a long straight in a big world costs little.
// Null when a world defines no surfaces: the car's own tyre numbers apply everywhere (dry tarmac).
// Worked out once per world (every simulation of it shares the map).
const surfaceMaps = new WeakMap();
export function surfaceMap(track) {
  if (!surfaceMaps.has(track)) surfaceMaps.set(track, buildSurfaceMap(track));
  return surfaceMaps.get(track);
}
function buildSurfaceMap(track) {
  const S = track.surfaces;
  if (!S) return null;
  const res = 1, TILE = 64, tiles = new Map(), list = [{ name: track.offRoad, ...S[track.offRoad] }];
  const key = (tx, tz) => (tx + 32768) * 65536 + tz + 32768;
  const paint = (x, z, id) => {
    const cx = Math.floor(x / res), cz = Math.floor(z / res), tx = Math.floor(cx / TILE), tz = Math.floor(cz / TILE), k = key(tx, tz);
    let t = tiles.get(k);
    if (!t) tiles.set(k, t = new Uint8Array(TILE * TILE));
    t[(cz - tz * TILE) * TILE + cx - tx * TILE] = id;
  };
  const cellCentre = c => (c + 0.5) * res;
  for (const pad of track.pads || []) {
    const id = list.push({ name: pad.surface, ...S[pad.surface] }) - 1, [px, pz] = pad.centre;
    if (pad.radius) {
      for (let x = Math.floor((px - pad.radius) / res); x <= Math.floor((px + pad.radius) / res); x++)
        for (let z = Math.floor((pz - pad.radius) / res); z <= Math.floor((pz + pad.radius) / res); z++)
          if (Math.hypot(cellCentre(x) - px, cellCentre(z) - pz) <= pad.radius) paint(cellCentre(x), cellCentre(z), id);
    } else {
      const h = (pad.headingDeg || 0) * Math.PI / 180, [hx, hz] = pad.halfExtents, reach = Math.hypot(hx, hz);
      for (let x = Math.floor((px - reach) / res); x <= Math.floor((px + reach) / res); x++)
        for (let z = Math.floor((pz - reach) / res); z <= Math.floor((pz + reach) / res); z++) {
          const dx = cellCentre(x) - px, dz = cellCentre(z) - pz, u = dx * Math.cos(h) - dz * Math.sin(h), w = dx * Math.sin(h) + dz * Math.cos(h);
          if (Math.abs(u) <= hx && Math.abs(w) <= hz) paint(cellCentre(x), cellCentre(z), id);
        }
    }
  }
  // painted along a line: [{ surface, points: [x, z, …] (flat), half (m either side of it) }] (a generated
  // track's road and verges, widest first so the road paints over its verges)
  for (const pl of track.paintLines || []) {
    const id = list.push({ name: pl.surface, ...S[pl.surface] }) - 1, r = pl.half, P = pl.points;
    for (let k = 0; k + 1 < P.length; k += 2) {
      const px = P[k], pz = P[k + 1];
      for (let x = Math.floor((px - r) / res); x <= Math.floor((px + r) / res); x++)
        for (let z = Math.floor((pz - r) / res); z <= Math.floor((pz + r) / res); z++)
          if (Math.hypot(cellCentre(x) - px, cellCentre(z) - pz) <= r) paint(cellCentre(x), cellCentre(z), id);
    }
  }
  for (const road of track.roads || []) {
    if (!road.surface) continue;
    // kerbs (road.kerbSurface): strips kerbWidth m wide either side on corners tighter than kerbCurvature
    if (road.kerbSurface) {
      const kid = list.push({ name: road.kerbSurface, ...S[road.kerbSurface] }) - 1, line = roadLine(road), m = line.length, half = road.width / 2;
      const bend = i => { let c = 0; for (let k = -3; k <= 3; k++) c += line[(i + k + m) % m].curvature; return Math.abs(c / 7); };
      line.forEach((p, i) => {
        if (bend(i) <= road.kerbCurvature) return;
        for (let off = half; off <= half + road.kerbWidth; off += 0.5) for (const side of [-1, 1]) {
          const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side, c = Math.floor(x / res), r = Math.floor(z / res);
          for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) paint(cellCentre(c + dc), cellCentre(r + dr), kid);
        }
      });
    }
    const id = list.push({ name: road.surface, ...S[road.surface] }) - 1, r = road.width / 2 + 0.3;
    for (const p of roadCenterline(road, 0.5)) {
      for (let x = Math.floor((p.x - r) / res); x <= Math.floor((p.x + r) / res); x++)
        for (let z = Math.floor((p.z - r) / res); z <= Math.floor((p.z + r) / res); z++)
          if (Math.hypot(cellCentre(x) - p.x, cellCentre(z) - p.z) <= r) paint(cellCentre(x), cellCentre(z), id);
    }
  }
  return {
    surfaces: list,
    at(x, z) {
      const cx = Math.floor(x / res), cz = Math.floor(z / res), tx = Math.floor(cx / TILE), tz = Math.floor(cz / TILE);
      const t = tiles.get(key(tx, tz));
      return list[t ? t[(cz - tz * TILE) * TILE + cx - tx * TILE] : 0];
    },
  };
}
