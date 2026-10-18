// A garage in the real world (world content of kind garage): a drive-through building like a petrol station beside
// the road — a forecourt off the road, an IN driveway off the road into its lane and an OUT driveway back onto it, a
// canopy on four posts over the lane, the workshop behind (roller doors facing the lane), a tall sign by the road. The
// road stays clear: driving by, you pass it; pulling in and through under the canopy opens your garage
// (play/contentLayer.js), and leaving it you come out on the road beside the way out. A paid tow (garage/player/service.js
// towCar) brings you out of the nearest one.
//
// Each garage fits itself to where it stands (settle(), play/garageFit.js), once the map round it is in: the road beside
// it as it really is (its edge, straight or curving, its surface's height — the tile's road mesh) and the ground (the
// tile's heightfield). It leans with the road's slope; its floor sits just above the highest ground under the forecourt;
// its driveways leave the road's real edge running along it, on the road's own surface, and rise smoothly into the lane
// in the roads' own asphalt, over the ground beside them. The forecourt, driveways, posts, workshop and sign are solid.
//
// The frame: the item's place is on the road (the editor snaps it there) and its heading is the road's way — local
// −z; across, +x, is its right, where the garage stands (SIDE m from the road's middle to the lane's; turn the item
// round to have it on the other side) — the item's place (lat, lon, alt) and heading put it in the world.
//
//   const G = createGarageBuilding({ THREE, RAPIER, sim, stream, item, ground? })   G.group (in stream.world)
//   G.settle() → settled? (each frame till it is)   G.exit(side) → { wx, wz, lat, lon, bearing } (fitted, once settled)
//   G.dispose()
//   (ground: { ready(wx, wz, r), road(wx, wz) → y | null, terrain(wx, wz) → y | null } in the world's frame — by
//   default the stream's tiles: groundOf(stream))
//   garageFrame(item, projection) → { local(wx, wz) → { x, z }, out(side) → { wx, wz, bearing } }
//   inLane({ x, z }) → under the canopy, in the lane      FOOTPRINT: what it covers (tools/place-garages.mjs)

import { fitGarage } from './garageFit.js';

export const SIDE = 13;                                          // m: the road's middle to the lane's
export const LANE = { halfWidth: 4.8, halfLength: 5.6 };       // (the drive-through zone, under the canopy)
const CANOPY = { halfWidth: 6.6, halfLength: 6.2, low: 5, high: 5.7 }, POST = { x: 5.7, z: 4.2, size: 0.5 };
const LANE_END = CANOPY.halfLength + 2;
// (in the building's frame — x from the lane's middle, y from its floor; the road's edge is about SIDE − 5 to its left):
// the forecourt from a little off the road to behind the workshop, the workshop, the tall sign at its road side
const COURT = { x0: -LANE.halfWidth - 1.2, x1: 19, z0: -16, z1: 16 };
const SHOP = { x0: 8.2, x1: 18, z0: -9, z1: 7.5, h: 6.2 }, SIGN = { x: 5.8, h: 8, half: 2.3 };   // (the sign: on the verge between the driveways — x from the road's middle)
// (the driveways: their far edges leave the road this far past the lane's ends, their near edges this far)
const DRIVE = { far: 15, near: 6.5, steps: 40 };
const EXIT_M = 18, OUT_X = 2.5;    // (out of the garage before it's fitted: on the road by the way out, in its lane)
// (what it covers, in the road's frame: from the road's edge to behind the workshop, as far along as the driveways go)
export const FOOTPRINT = { x0: 4.6, x1: COURT.x1 + SIDE, z0: -(LANE_END + DRIVE.far), z1: LANE_END + DRIVE.far };
const DIMS = { SIDE, LANE_HALF: LANE.halfWidth, LANE_END, COURT, FAR: DRIVE.far, NEAR: DRIVE.near, STEPS: DRIVE.steps };

// the map round a place, from the stream's tiles (world frame): loaded yet?, the road surface's height (the tile's road
// mesh: only its drivable top — not the skirt dipping past its edge), the ground's (its heightfield)
export function groundOf(S) {
  if (!S?.tiles || !S.manifest?.grid) return null;
  const T = S.manifest.grid.tileSize, known = new Set(S.manifest.tiles.map(t => `${t.i}_${t.j}`)), CELL = 4, grids = { roads: new WeakMap(), water: new WeakMap() };
  const keyAt = (wx, wz) => `${Math.floor(wx / T)}_${Math.floor(wz / T)}`;
  const gridOf = (d, name = 'roads') => {
    let g = grids[name].get(d);
    if (g) return g;
    grids[name].set(d, g = new Map());
    const m = d.meshes?.[name];
    if (!m) return g;
    const p = m.positions, I = m.indices;
    for (let n = 0; n + 2 < I.length; n += 3) {
      const a = I[n] * 3, b = I[n + 1] * 3, c = I[n + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
      if (len < 1e-6 || Math.abs(ny) / len < 0.95) continue;
      for (let gx = Math.floor(Math.min(p[a], p[b], p[c]) / CELL); gx <= Math.floor(Math.max(p[a], p[b], p[c]) / CELL); gx++)
        for (let gz = Math.floor(Math.min(p[a + 2], p[b + 2], p[c + 2]) / CELL); gz <= Math.floor(Math.max(p[a + 2], p[b + 2], p[c + 2]) / CELL); gz++) {
          const k = `${gx},${gz}`; (g.get(k) ?? g.set(k, []).get(k)).push(n);
        }
    }
    return g;
  };
  return {
    ready(wx, wz, r) {
      for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) { const k = keyAt(wx + dx, wz + dz); if (known.has(k) && !S.tiles.get(k)?.data) return false; }
      return true;
    },
    road(wx, wz) { return surface('roads', wx, wz); },
    // the water's surface (a river's, a lake's, the sea's in the tile) — the boat kit (physics/boat.js)
    water(wx, wz) { return surface('water', wx, wz); },
    terrain(wx, wz) { if (!S.heightAt) return null; const [x, z] = S.toSim(wx, wz); return S.heightAt(x, z); },
  };
  // (the highest of a tile mesh's flat triangles over a point)
  function surface(name, wx, wz) {
    const e = S.tiles.get(keyAt(wx, wz)), d = e?.data;
    if (!d?.meshes?.[name]) return null;
    const lx = wx - (e.i + 0.5) * T, lz = wz - (e.j + 0.5) * T, list = gridOf(d, name).get(`${Math.floor(lx / CELL)},${Math.floor(lz / CELL)}`);
    if (!list) return null;
    const p = d.meshes[name].positions, I = d.meshes[name].indices;
    let best = null;
    for (const n of list) {
      const a = I[n] * 3, b = I[n + 1] * 3, c = I[n + 2] * 3;
      const area = (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2]);
      if (Math.abs(area) < 1e-9) continue;
      const w1 = ((p[b] - lx) * (p[c + 2] - lz) - (p[c] - lx) * (p[b + 2] - lz)) / area, w2 = ((p[c] - lx) * (p[a + 2] - lz) - (p[a] - lx) * (p[c + 2] - lz)) / area, w3 = 1 - w1 - w2;
      if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
      const y = w1 * p[a + 1] + w2 * p[b + 1] + w3 * p[c + 1];
      if (best == null || y > best) best = y;
    }
    return best;
  }
}

// where a place is in a garage's frame, and where you come out of it
export function garageFrame(item, P) {
  const [cx, cz] = P.toXZ(item.location.lat, item.location.lon), h = (item.location.heading ?? 0) * Math.PI / 180;
  // (forward — the way through, local −z — is the bearing's direction: x east, z south; across, local +x, is its right)
  const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
  return {
    cx, cz,
    local(wx, wz) { const dx = wx - cx, dz = wz - cz; return { x: dx * rx + dz * rz, z: -(dx * fx + dz * fz) }; },
    // (side −1: out of the front, going the way through — onto the road by the exit; +1: out of the back, the other way)
    out(side = -1) {
      const s = side < 0 ? 1 : -1, wx = cx + rx * OUT_X * s + fx * EXIT_M * s, wz = cz + rz * OUT_X * s + fz * EXIT_M * s, [lat, lon] = P.toLatLon(wx, wz);
      return { wx, wz, lat, lon, bearing: ((item.location.heading ?? 0) + (s > 0 ? 0 : 180)) % 360 };
    },
  };
}
export const inLane = p => Math.abs(p.x - SIDE) < LANE.halfWidth && Math.abs(p.z) < LANE.halfLength;

// the sign's face (a canvas: the word, a spanner, the drive-through arrow)
function signTexture(THREE, text, { w = 512, h = 256, sub = '' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#1b3fa6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e3121e'; g.fillRect(0, h - h * 0.16, w, h * 0.16);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  // (the word as big as fits: never cut off at the edges)
  let size = Math.round(h * 0.36);
  const font = px => `italic 900 ${px}px Saira, 'Barlow Condensed', Arial Black, sans-serif`;
  g.font = font(size);
  while (size > 8 && g.measureText(text).width > w * 0.86) g.font = font(size -= 2);
  g.fillText(text, w / 2, h * (sub ? 0.38 : 0.44));
  if (sub) { let s2 = Math.round(h * 0.13); g.font = `700 ${s2}px Barlow, Arial, sans-serif`; while (s2 > 6 && g.measureText(sub).width > w * 0.9) g.font = `700 ${s2 -= 1}px Barlow, Arial, sans-serif`; g.fillText(sub, w / 2, h * 0.68); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// a word painted on the ground (white, a transparent canvas)
function groundWord(THREE, word) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 96px Barlow, Arial Black, sans-serif';
  g.fillText(word, 128, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

let carveCount = 0;
export function createGarageBuilding({ THREE, RAPIER = null, sim = null, stream: S, item, ground = groundOf(S) }) {
  const P = S.projection, F = garageFrame(item, P), h = (item.location.heading ?? 0) * Math.PI / 180, alt = item.location.alt ?? 0;
  const rx = Math.cos(h), rz = Math.sin(h), fx = Math.sin(h), fz = -Math.cos(h);
  // (the garage's frame — x right, z back — into the world's, and back)
  const toWorld = (x, z) => [F.cx + rx * x - fx * z, F.cz + rz * x - fz * z];
  // the garage, turned to its heading (y: the road's height at its place) → leaning with the road → the building (SIDE
  // m right, its floor at the fitted height); the driveways in the turned frame, not leaning (each follows the road)
  const group = new THREE.Group();
  group.name = `garage:${item.id}`;
  group.position.set(F.cx, alt, F.cz);
  group.rotation.y = -h;
  const tilt = new THREE.Group(); group.add(tilt);
  const B = new THREE.Group(); B.position.x = SIDE; tilt.add(B);
  const D = new THREE.Group(); group.add(D);
  const disposables = [];
  // (the driveways and lane the same asphalt as the roads they join: data/world/bake.json roads, map/render/objects.ts)
  const asphalt = (extra = {}) => { const m = new THREE.MeshLambertMaterial({ color: '#4a4c4f', flatShading: true, ...extra }); disposables.push(m); return m; };
  const material = (colour, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.75, metalness: 0.05, ...extra }); disposables.push(m); return m; };
  const M = {
    concrete: material(0x8d9196, { roughness: 0.95 }), lane: asphalt(), white: material(0xf1f2f4, { roughness: 0.5 }),
    red: material(0xd8141f, { roughness: 0.45 }), blue: material(0x1b3fa6, { roughness: 0.5 }), post: material(0xc9ccd1, { metalness: 0.4, roughness: 0.35 }),
    wall: material(0xd9d5cc, { roughness: 0.85 }), door: material(0x5c6168, { metalness: 0.3, roughness: 0.55 }), dark: material(0x24272c, { roughness: 0.8 }),
    glass: material(0x9fc3dd, { roughness: 0.1, metalness: 0.2, emissive: 0x223344, emissiveIntensity: 0.4 }),
    light: material(0xffffff, { emissive: 0xfff4dc, emissiveIntensity: 1.6, roughness: 0.3 }),
    drive: asphalt({ side: THREE.DoubleSide }), line: material(0xf1f2f4, { roughness: 0.5, side: THREE.DoubleSide }),
    retaining: material(0xa3a29c, { roughness: 0.95, side: THREE.DoubleSide }),
    verge: (() => { const m = new THREE.MeshLambertMaterial({ color: '#6f8f4e', flatShading: true }); disposables.push(m); return m; })(), kerb: material(0xb9bcc0, { roughness: 0.9, side: THREE.DoubleSide }),
  };
  const BOX = new THREE.BoxGeometry(1, 1, 1); disposables.push(BOX);
  const box = (m, x0, y0, z0, x1, y1, z1, parent = B) => { const o = new THREE.Mesh(BOX, m); o.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); o.scale.set(x1 - x0, y1 - y0, z1 - z0); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
  const plane = (tex, w, hgt, x, y, z, yaw, parent = B) => { const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); disposables.push(m, tex); const o = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), m); disposables.push(o.geometry); o.position.set(x, y, z); o.rotation.y = yaw; parent.add(o); return o; };
  // (a painted arrow at x, y, z pointing at angle a — 0 is local −z, the way through)
  const arrow = (parent, x, y, z, a) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = -a; parent.add(g);
    const bar = (cx, cz, len, yaw) => { const o = new THREE.Mesh(BOX, M.white); o.position.set(cx, 0.0075, cz); o.scale.set(0.3, 0.015, len); o.rotation.y = yaw; g.add(o); };
    bar(0, 0.1, 2, 0); bar(-0.42, -0.75, 1.5, -Math.PI / 4); bar(0.42, -0.75, 1.5, Math.PI / 4);
  };

  // the forecourt (deep enough to stand over falling ground), the lane marked in blue, arrows the way through
  const forecourt = box(M.concrete, COURT.x0, -3, COURT.z0, COURT.x1, 0.04, COURT.z1);
  box(M.lane, -LANE.halfWidth, 0.04, -LANE_END, LANE.halfWidth, 0.06, LANE_END);
  for (const x of [-LANE.halfWidth, LANE.halfWidth - 0.25]) box(M.blue, x, 0.06, -LANE_END, x + 0.25, 0.07, LANE_END);
  for (const z of [-3, 3]) arrow(B, 0, 0.06, z, 0);
  // the canopy: a white slab under a red and blue fascia, lights underneath, on four posts
  box(M.white, -CANOPY.halfWidth, CANOPY.low, -CANOPY.halfLength, CANOPY.halfWidth, CANOPY.low + 0.15, CANOPY.halfLength);
  box(M.red, -CANOPY.halfWidth - 0.05, CANOPY.low + 0.15, -CANOPY.halfLength - 0.05, CANOPY.halfWidth + 0.05, CANOPY.high - 0.2, CANOPY.halfLength + 0.05);
  box(M.blue, -CANOPY.halfWidth - 0.05, CANOPY.high - 0.2, -CANOPY.halfLength - 0.05, CANOPY.halfWidth + 0.05, CANOPY.high, CANOPY.halfLength + 0.05);
  for (const x of [-3.2, 0, 3.2]) for (const z of [-3.6, 0, 3.6]) box(M.light, x - 0.7, CANOPY.low - 0.04, z - 0.35, x + 0.7, CANOPY.low, z + 0.35);
  for (const x of [-POST.x, POST.x]) for (const z of [-POST.z, POST.z]) {
    box(M.post, x - POST.size / 2, 0, z - POST.size / 2, x + POST.size / 2, CANOPY.low, z + POST.size / 2);
    box(M.red, x - 0.35, 0, z - 0.35, x + 0.35, 0.9, z + 0.35);          // (bollards round the foot)
  }
  // the canopy's name boards, both ends: GARAGE · drive through
  const board = () => signTexture(THREE, 'GARAGE', { w: 1024, h: 160, sub: '' });
  plane(board(), 6, 0.95, 0, CANOPY.low + 0.6, -CANOPY.halfLength - 0.07, Math.PI);
  plane(board(), 6, 0.95, 0, CANOPY.low + 0.6, CANOPY.halfLength + 0.07, 0);
  // the workshop: walls, two roller doors and a glass office facing the lane, a red band, a flat roof
  box(M.wall, SHOP.x0, 0, SHOP.z0, SHOP.x1, SHOP.h, SHOP.z1);
  box(M.red, SHOP.x0 - 0.06, SHOP.h - 1.1, SHOP.z0 - 0.06, SHOP.x1 + 0.06, SHOP.h - 0.5, SHOP.z1 + 0.06);
  box(M.dark, SHOP.x0 - 0.2, SHOP.h, SHOP.z0 - 0.2, SHOP.x1 + 0.2, SHOP.h + 0.3, SHOP.z1 + 0.2);
  for (const z of [-6.6, -1.6]) {
    box(M.door, SHOP.x0 - 0.08, 0, z - 2.1, SHOP.x0, 4.3, z + 2.1);
    for (let y = 0.4; y < 4.2; y += 0.38) box(M.dark, SHOP.x0 - 0.1, y, z - 2.1, SHOP.x0 - 0.08, y + 0.05, z + 2.1);
  }
  box(M.glass, SHOP.x0 - 0.06, 0.9, 2.2, SHOP.x0, 3.4, 6.6);
  plane(signTexture(THREE, 'GARAGE', { w: 768, h: 192, sub: 'REPAIRS · PARTS · TUNING' }), 7, 1.75, SHOP.x0 - 0.12, SHOP.h - 2.1, 0.5, -Math.PI / 2);
  // the tall sign by the road, on the verge between the driveways (out of every driving line), facing along the road both
  // ways (placed on the verge's middle when fitted)
  const signG = new THREE.Group(); signG.position.x = SIGN.x; group.add(signG);
  box(M.post, -0.2, 0, -0.2, 0.2, SIGN.h - 2.4, 0.2, signG);
  box(M.blue, -SIGN.half, SIGN.h - 2.6, -0.18, SIGN.half, SIGN.h, 0.18, signG);
  const pole = () => signTexture(THREE, 'GARAGE', { w: 720, h: 400, sub: 'DRIVE THROUGH' });
  plane(pole(), SIGN.half * 2 - 0.1, 2.5, 0, SIGN.h - 1.3, -0.2, Math.PI, signG);
  plane(pole(), SIGN.half * 2 - 0.1, 2.5, 0, SIGN.h - 1.3, 0.2, 0, signG);
  S.world.add(group);

  // the driveways, from the fit: asphalt between their edges (a skirt down each side, for where the ground falls away),
  // white lines just inside the edges once off the road, an arrow and a word each
  function driveways(fit) {
    const ribbon = (m, rows, u0, u1, lift = 0, skirt = false) => {
      const pos = [], idx = [], at = (r, u) => [0, 1, 2].map(i => r.a[i] + (r.b[i] - r.a[i]) * u + (i === 1 ? lift : 0));
      rows.forEach((r, k) => { pos.push(...at(r, u0), ...at(r, u1)); if (k) { const q = k * 2; idx.push(q - 2, q - 1, q, q - 1, q + 1, q); } });
      // (its sides down to the ground under them)
      if (skirt) for (const u of [u0, u1]) { const base = pos.length / 3; rows.forEach((r, k) => { const [x, y, z] = at(r, u), g = u < 0.5 ? r.ga : r.gb; pos.push(x, y, z, x, Math.min(y - 0.3, (g ?? y - 3) - 0.3), z); if (k) { const q = base + k * 2; idx.push(q - 2, q, q - 1, q - 1, q, q + 1); } }); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); disposables.push(g);
      const o = new THREE.Mesh(g, m); o.receiveShadow = true; D.add(o); return o;
    };
    for (const { zs, word, rows } of fit.driveways) {
      ribbon(M.drive, rows, 0, 1, 0.004, true);
      const inner = rows.filter(r => r.t >= 0.3);
      ribbon(M.line, inner, 0.025, 0.045, 0.012); ribbon(M.line, inner, 0.955, 0.975, 0.012);
      // (the way along it — in towards the lane, out towards the road — on its middle line)
      const mid = t => { const r = rows[Math.round(t * (rows.length - 1))]; return [0, 1, 2].map(i => (r.a[i] + r.b[i]) / 2); };
      const along = t => { const p0 = mid(t - 0.04), p1 = mid(t + 0.04), s = zs > 0 ? 1 : -1; return Math.atan2((p1[0] - p0[0]) * s, -(p1[2] - p0[2]) * s); };
      const am = mid(0.62); arrow(D, am[0], am[1] + 0.008, am[2], along(0.62));
      const t = groundWord(THREE, word); disposables.push(t);
      const wm = new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false }); disposables.push(wm);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), wm); disposables.push(w.geometry);
      const wp = mid(0.4); w.position.set(wp[0], wp[1] + 0.02, wp[2]); w.rotation.set(-Math.PI / 2, -along(0.4), 0, 'YXZ'); D.add(w);
    }
  }

  // set into the ground: its outlines (the forecourt, each driveway) and its surface's height handed to the stream, which
  // leaves the drawn ground out inside them and lowers the physics' ground under them; where the ground beside it stands
  // higher than its surface (a bank), a concrete retaining wall up to it
  function carveIn(road, terrain) {
    const cp = Math.cos(fit.pitch), sp = Math.sin(fit.pitch);
    const lean = (xb, yb, zb) => { const y = fit.floorY + yb; return [SIDE + xb, y * cp - zb * sp, y * sp + zb * cp]; };
    const courtX = SIDE + COURT.x0, courtTop = z => (fit.floorY + 0.04) * cp - (z / cp) * sp;
    const court = [[COURT.x0, COURT.z0], [COURT.x1, COURT.z0], [COURT.x1, COURT.z1], [COURT.x0, COURT.z1]].map(([x, z]) => { const p = lean(x, 0.04, z); return [p[0], p[2]]; });
    const ribbons = fit.driveways.map(({ rows }) => { const k = rows.filter((_, i) => i % 2 === 0 || i === rows.length - 1); return [...k.map(r => [r.a[0], r.a[2]]), ...k.reverse().map(r => [r.b[0], r.b[2]])]; });
    const lane = [[-LANE.halfWidth, -LANE_END], [LANE.halfWidth, -LANE_END], [LANE.halfWidth, LANE_END], [-LANE.halfWidth, LANE_END]].map(([x, z]) => { const p = lean(x, 0.06, z); return [p[0], p[2]]; });
    // the verge: between the driveways along the road — from the road's edge to the forecourt, between their near edges —
    // flat grass at the garage's level with a kerb round it (no bank left there for the driving line to run into)
    const nearTo = rows => { const out = []; for (let k = 0; k < rows.length; k++) { const p = rows[k].b; if (p[0] >= courtX) { const q = rows[k - 1].b, t = (courtX - q[0]) / (p[0] - q[0]); out.push([courtX, q[2] + (p[2] - q[2]) * t]); break; } out.push([p[0], p[2]]); } return out; };
    const inNear = nearTo(fit.driveways.find(d => d.zs > 0).rows), outNear = nearTo(fit.driveways.find(d => d.zs < 0).rows), roadSide = [];
    for (let z = Math.floor(inNear[0][1]); z > outNear[0][1]; z--) roadSide.push([fit.edge(z).x - 0.05, z]);
    const verge = [...inNear.slice().reverse(), ...roadSide, ...outNear];
    const vergeY = (x, z) => { const e = fit.edge(z), f = Math.max(0, Math.min(1, (x - e.x) / Math.max(0.5, courtX - e.x))); return e.y + (courtTop(z) - e.y) * f + 0.1; };
    // (the driveways, the lane, the verge: tarmac, tarmac, grass; the forecourt concrete — what the tyres find there: the
    // first outline a place is in)
    const polys = [...ribbons, lane, verge, court], surfaces = [...ribbons.map(() => 'tarmac'), 'tarmac', 'grass', 'concrete'];
    // (the surface's height near a place: the nearest of the forecourt's, driveways' and verge's points — garage frame)
    const samples = [];
    for (let xb = COURT.x0; xb <= COURT.x1 + 1e-9; xb += 1.5) for (let zb = COURT.z0; zb <= COURT.z1 + 1e-9; zb += 1.5) samples.push(lean(xb, 0.04, zb));
    for (const { rows } of fit.driveways) for (const r of rows) for (const u of [0, 0.5, 1]) samples.push([0, 1, 2].map(i => r.a[i] + (r.b[i] - r.a[i]) * u));
    for (const [x, z] of verge) samples.push([x, vergeY(x, z), z]);
    const surface = (x, z) => { let best = null, bd = Infinity; for (const p of samples) { const d = (p[0] - x) ** 2 + (p[2] - z) ** 2; if (d < bd) { bd = d; best = p[1]; } } return best; };
    const inside = (poly, x, z) => { let c = false; for (let k = 0, a = poly[poly.length - 1]; k < poly.length; a = poly[k++]) { const b = poly[k]; if ((b[1] > z) !== (a[1] > z) && x < (a[0] - b[0]) * (z - b[1]) / (a[1] - b[1]) + b[0]) c = !c; } return c; };
    const inGarage = (x, z) => road(x, z) != null || polys.some(p => inside(p, x, z));

    // the verge: grass on top, a concrete kerb down its sides; solid (a kerb a car climbs)
    const contour = verge.map(([x, z]) => new THREE.Vector2(x, z)), tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const vpos = [], vidx = [];
    verge.forEach(([x, z]) => vpos.push(x, vergeY(x, z), z));
    for (const t of tris) vidx.push(...t);
    const vg = new THREE.BufferGeometry(); vg.setAttribute('position', new THREE.Float32BufferAttribute(vpos, 3)); vg.setIndex(vidx); vg.computeVertexNormals(); disposables.push(vg);
    const vm = new THREE.Mesh(vg, M.verge); vm.receiveShadow = true; D.add(vm);
    const kpos = [], kidx = [];
    verge.forEach(([x, z], k) => { const [x2, z2] = verge[(k + 1) % verge.length], q = kpos.length / 3; kpos.push(x, vergeY(x, z), z, x, vergeY(x, z) - 0.3, z, x2, vergeY(x2, z2), z2, x2, vergeY(x2, z2) - 0.3, z2); kidx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); });
    const kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.Float32BufferAttribute(kpos, 3)); kg.setIndex(kidx); kg.computeVertexNormals(); disposables.push(kg);
    D.add(new THREE.Mesh(kg, M.kerb));
    vergeTop = { positions: new Float32Array(vpos), indices: new Uint32Array(vidx) };
    { const e = fit.edge(0); signY = vergeY((e.x + courtX) / 2, 0); }

    // the retaining walls: along the garage's outline wherever the ground just outside it (not the road, nothing of the
    // garage) stands higher than its surface — the ground as baked, before it's carved — each with a ledge behind it at
    // the ground's height (the physics' ground is lowered a little past the outline: no hidden trench there)
    const pos = [], idx = [];
    polys.forEach(poly => {
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-3) continue;
        const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        let nx = dz, nz = -dx;
        if (inside(poly, mx + nx * 0.05, mz + nz * 0.05)) { nx = -nx; nz = -nz; }
        const n = Math.max(1, Math.ceil(len / 0.75));
        let prev = null;
        for (let q = 0; q <= n; q++) {
          const x = a[0] + (b[0] - a[0]) * q / n, z = a[1] + (b[1] - a[1]) * q / n, px = x + nx * 0.5, pz = z + nz * 0.5;
          let cur = null;
          if (!inGarage(px, pz)) {
            const y = surface(x, z), t = terrain(px, pz);
            if (t != null && t + 0.06 > y + 0.05) cur = { x, z, y, top: t + 0.06 };
          }
          if (cur && prev) {
            const qi = pos.length / 3;
            pos.push(prev.x, prev.y - 0.1, prev.z, prev.x, prev.top, prev.z, cur.x, cur.y - 0.1, cur.z, cur.x, cur.top, cur.z);
            idx.push(qi, qi + 1, qi + 2, qi + 1, qi + 3, qi + 2);
            const sl = Math.hypot(cur.x - prev.x, cur.z - prev.z) + 0.05, yaw = Math.atan2(cur.x - prev.x, cur.z - prev.z), cx = (prev.x + cur.x) / 2, cz = (prev.z + cur.z) / 2;
            wallBoxes.push({ x: cx, z: cz, len: sl, w: 0.15, y0: Math.min(prev.y, cur.y) - 0.1, y1: Math.max(prev.top, cur.top), yaw });
            // (the ledge: out from the wall as far as the lowered ground goes, unless something of the garage or the road is there)
            let ext = 0;
            for (let e = 0.5; e <= 3.5; e += 0.5) { if (inGarage(cx + nx * e, cz + nz * e)) break; ext = e; }
            if (ext > 0) { const top = Math.min(prev.top, cur.top) - 0.09; wallBoxes.push({ x: cx + nx * ext / 2, z: cz + nz * ext / 2, len: sl, w: ext / 2, y0: top - 0.6, y1: top, yaw }); }
          }
          prev = cur;
        }
      }
    });
    if (idx.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); disposables.push(g);
      const wall = new THREE.Mesh(g, M.retaining); wall.receiveShadow = true; wall.castShadow = true; D.add(wall);
    }
    const toW = ([x, z]) => toWorld(x, z);
    carving = { polys: polys.map(p => p.map(toW)), surfaces, below: (wx, wz) => { const l = F.local(wx, wz), y = surface(l.x, l.z); return y == null ? null : y0 + y; } };
    if (group.visible) S.carve(carveKey, carving);
  }

  // fitted, once the map round it is in: leaning, the floor's height, the driveways — and what the car drives on and
  // hits (the forecourt and driveways, the posts, the workshop, the sign's pole; not the lane's air: that's driven through)
  let handles = [], settled = false, fit = null, y0 = alt, carving = null, wallBoxes = [], vergeTop = null, signY = null;
  const carveKey = `garage:${item.id}:${++carveCount}`;
  function settle() {
    if (settled) return true;
    if (ground && !ground.ready(F.cx, F.cz, 60)) return false;
    // (the road's height at its place: the garage's y; everything fitted relative to it)
    const [wx0, wz0] = toWorld(0, 0);
    y0 = ground?.road(wx0, wz0) ?? alt;
    const rel = f => (x, z) => { const [wx, wz] = toWorld(x, z), y = f(wx, wz); return y == null ? null : y - y0; };
    // (no map to fit to — a test page: a straight road 9.2 m wide at the garage's height)
    const canCarve = !!(ground && S.carve), road = ground ? rel(ground.road) : (x => Math.abs(x) <= 4.6 ? 0 : null), terrain = ground ? rel(ground.terrain) : () => null;
    fit = fitGarage({ road, terrain, dims: DIMS, carve: canCarve });
    group.position.y = y0; tilt.rotation.x = fit.pitch; B.position.y = fit.floorY;
    // (its sides down to the lowest ground under it)
    forecourt.scale.y = fit.courtDepth + 0.04; forecourt.position.y = (0.04 - fit.courtDepth) / 2;
    group.updateMatrixWorld(true);
    driveways(fit);
    if (canCarve) carveIn(road, terrain);
    // (the sign on the verge's middle: halfway from the road's edge to the forecourt, on the verge — else the ground)
    const e0 = fit.edge(0), sx0 = (e0.x + SIDE + COURT.x0) / 2;
    signG.position.set(sx0, signY ?? terrain(sx0, 0) ?? e0.y, 0);
    if (RAPIER && sim) {
      const [sx, sz] = S.toSim(F.cx, F.cz);   // (the sim's frame now: its origin moves with the car)
      const cuboid = (x0, ya, z0, x1, yb, z1) => RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (yb - ya) / 2, (z1 - z0) / 2).setTranslation(SIDE + (x0 + x1) / 2, fit.floorY + (ya + yb) / 2, (z0 + z1) / 2);
      const descs = [cuboid(COURT.x0, -0.8, COURT.z0, COURT.x1, 0.04, COURT.z1)];
      for (const x of [-POST.x, POST.x]) for (const z of [-POST.z, POST.z]) descs.push(cuboid(x - 0.35, 0, z - 0.35, x + 0.35, CANOPY.low, z + 0.35));
      descs.push(cuboid(SHOP.x0, 0, SHOP.z0, SHOP.x1, SHOP.h, SHOP.z1));
      // (the driveways' tops, as drawn: in the turned frame, not leaning)
      const drives = fit.driveways.map(({ rows }) => {
        const v = new Float32Array(rows.length * 6), ix = [];
        rows.forEach((r, k) => { v.set([...r.a, ...r.b], k * 6); if (k) { const q = k * 2; ix.push(q - 2, q - 1, q, q - 1, q + 1, q); } });
        return RAPIER.ColliderDesc.trimesh(v, new Uint32Array(ix));
      });
      for (const b of wallBoxes) drives.push(RAPIER.ColliderDesc.cuboid(b.w, (b.y1 - b.y0) / 2, b.len / 2).setTranslation(b.x, (b.y0 + b.y1) / 2, b.z).setRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) }));
      // (the sign's pole)
      drives.push(RAPIER.ColliderDesc.cuboid(0.25, SIGN.h / 2, 0.25).setTranslation(signG.position.x, signG.position.y + SIGN.h / 2, 0));
      // (the verge's top: a kerb's height over what's round it)
      if (vergeTop?.indices.length) drives.push(RAPIER.ColliderDesc.trimesh(vergeTop.positions, vergeTop.indices));
      const yaw = { x: 0, y: Math.sin(-h / 2), z: 0, w: Math.cos(-h / 2) }, q = tilt.getWorldQuaternion(new THREE.Quaternion());
      try {
        handles.push(sim.addStatic({ position: [sx, y0, sz], rotation: { x: q.x, y: q.y, z: q.z, w: q.w } }, descs));
        handles.push(sim.addStatic({ position: [sx, y0, sz], rotation: yaw }, drives));
      } catch (e) { console.warn(`A garage's walls: ${e.message}`); }
    }
    return (settled = true);
  }
  settle();
  return {
    item, group, frame: F, settle,
    get fit() { return fit; },
    // (its static bodies: the building, leaning; the driveways and retaining walls — for looking into what's hit)
    get handles() { return handles; },
    // where you come out (side −1: the way through, onto the road by the way out; +1: back out of it): on the road as
    // it really is, once fitted
    exit(side = -1) {
      const e = fit?.exits[side < 0 ? -1 : 1];
      if (!e) return F.out(side);
      const [wx, wz] = toWorld(e.x, e.z), dwx = rx * e.dx - fx * e.dz, dwz = rz * e.dx - fz * e.dz, [lat, lon] = P.toLatLon(wx, wz);
      return { wx, wz, lat, lon, bearing: ((Math.atan2(dwx, -dwz) * 180 / Math.PI) + 360) % 360 };
    },
    // (shown or not — the game's while the editor draws its own: hidden, it's not set into the ground either)
    visible(on) {
      if (group.visible === on) return;
      group.visible = on;
      if (carving) S.carve(carveKey, on ? carving : null);
    },
    dispose() {
      if (carving) S.carve?.(carveKey, null);
      group.removeFromParent();
      for (const hd of handles) sim.removeStatic(hd);
      for (const d of disposables) d.dispose?.();
    },
  };
}
