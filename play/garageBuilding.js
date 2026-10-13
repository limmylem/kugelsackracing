// A garage in the real world (world content of kind garage): a drive-through building like a petrol station beside
// the road — a forecourt off the road, a canopy on four posts over its lane, the workshop behind (roller doors facing
// the lane), a tall sign by the road. The road stays clear: driving by, you pass it; pulling in and through under the
// canopy opens your garage (play/contentLayer.js), and leaving it you come out of the far end of the lane. A paid tow
// (garage/player/service.js towCar) brings you out of the nearest one.
//
// The frame: the item's place is on the road (the editor snaps it there) and its heading is the road's way — local
// −z; across, +x, is its right, where the garage stands (SIDE m from the road's middle to the lane's; turn the item
// round to have it on the other side); the ground at y 0 — the item's place (lat, lon, alt) and heading put it in the
// world.
//
//   const G = createGarageBuilding({ THREE, RAPIER, sim, stream, item })   G.group (in stream.world)   G.dispose()
//   garageFrame(item, projection) → { local(wx, wz) → { x, z }, out(side) → { wx, wz, bearing } }
//   inLane({ x, z }) → under the canopy, in the lane      FOOTPRINT: what it covers (tools/place-garages.mjs)

export const SIDE = 13;                                          // m: the road's middle to the lane's
export const LANE = { halfWidth: 4.8, halfLength: 5.6 };       // (the drive-through zone, under the canopy)
const CANOPY = { halfWidth: 6.6, halfLength: 6.2, low: 5, high: 5.7 }, POST = { x: 5.7, z: 4.2, size: 0.5 };
// (in the lane's frame — x from the lane's middle; the road's edge is about SIDE − 5 to its left)
const SHOP = { x0: 8.2, x1: 18, z0: -9, z1: 7.5, h: 6.2 }, SIGN = { x: 6.4 - SIDE, z: -12.5, h: 8, half: 2.3 };
const COURT = { x0: 4.6 - SIDE, x1: 19, z0: -16, z1: 16 };
const EXIT_M = 15;                                                  // (out of the lane: this far past its middle)
// (what it covers, in the road's frame: the forecourt from the road's edge to behind the workshop)
export const FOOTPRINT = { x0: COURT.x0 + SIDE, x1: COURT.x1 + SIDE, z0: COURT.z0, z1: COURT.z1 };

// where a place is in a garage's frame, and where you come out of it
export function garageFrame(item, P) {
  const [cx, cz] = P.toXZ(item.location.lat, item.location.lon), h = (item.location.heading ?? 0) * Math.PI / 180;
  // (forward — the way through, local −z — is the bearing's direction: x east, z south; across, local +x, is its right)
  const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
  return {
    cx, cz,
    local(wx, wz) { const dx = wx - cx, dz = wz - cz; return { x: dx * rx + dz * rz, z: -(dx * fx + dz * fz) }; },
    // (side −1: out of the front, going the way through; +1: out of the back, the other way)
    out(side = -1) {
      const s = side < 0 ? 1 : -1, wx = cx + rx * SIDE + fx * EXIT_M * s, wz = cz + rz * SIDE + fz * EXIT_M * s, [lat, lon] = P.toLatLon(wx, wz);
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

export function createGarageBuilding({ THREE, RAPIER = null, sim = null, stream: S, item }) {
  const P = S.projection, F = garageFrame(item, P), h = (item.location.heading ?? 0) * Math.PI / 180, alt = item.location.alt ?? 0;
  const group = new THREE.Group();
  group.name = `garage:${item.id}`;
  group.position.set(F.cx, alt, F.cz);
  // (local −z along the bearing: a yaw of −bearing)
  group.rotation.y = -h;
  // (the building in its lane's frame: SIDE m to the road's right)
  const B = new THREE.Group(); B.position.x = SIDE; group.add(B);
  const disposables = [];
  const material = (colour, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.75, metalness: 0.05, ...extra }); disposables.push(m); return m; };
  const M = {
    concrete: material(0x8d9196, { roughness: 0.95 }), lane: material(0x3a3d42, { roughness: 0.9 }), white: material(0xf1f2f4, { roughness: 0.5 }),
    red: material(0xd8141f, { roughness: 0.45 }), blue: material(0x1b3fa6, { roughness: 0.5 }), post: material(0xc9ccd1, { metalness: 0.4, roughness: 0.35 }),
    wall: material(0xd9d5cc, { roughness: 0.85 }), door: material(0x5c6168, { metalness: 0.3, roughness: 0.55 }), dark: material(0x24272c, { roughness: 0.8 }),
    glass: material(0x9fc3dd, { roughness: 0.1, metalness: 0.2, emissive: 0x223344, emissiveIntensity: 0.4 }),
    light: material(0xffffff, { emissive: 0xfff4dc, emissiveIntensity: 1.6, roughness: 0.3 }),
  };
  const BOX = new THREE.BoxGeometry(1, 1, 1); disposables.push(BOX);
  const box = (m, x0, y0, z0, x1, y1, z1) => { const o = new THREE.Mesh(BOX, m); o.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); o.scale.set(x1 - x0, y1 - y0, z1 - z0); o.castShadow = true; o.receiveShadow = true; B.add(o); return o; };
  const plane = (tex, w, hgt, x, y, z, yaw) => { const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); disposables.push(m, tex); const o = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), m); disposables.push(o.geometry); o.position.set(x, y, z); o.rotation.y = yaw; B.add(o); return o; };

  // the forecourt (deep enough to sit on uneven ground), the lane marked in blue, arrows the way through
  box(M.concrete, COURT.x0, -1.5, COURT.z0, COURT.x1, 0.04, COURT.z1);
  box(M.lane, -LANE.halfWidth, 0.04, -CANOPY.halfLength - 2, LANE.halfWidth, 0.06, CANOPY.halfLength + 2);
  for (const x of [-LANE.halfWidth, LANE.halfWidth - 0.25]) box(M.blue, x, 0.06, -CANOPY.halfLength - 2, x + 0.25, 0.07, CANOPY.halfLength + 2);
  // (painted arrows the way through, −z: a shaft and a head of two bars at 45°)
  for (const z of [-3, 3]) {
    box(M.white, -0.15, 0.06, z - 0.9, 0.15, 0.075, z + 1.1);
    for (const side of [-1, 1]) { const o = box(M.white, -0.13, 0.06, -0.75, 0.13, 0.075, 0.75); o.position.set(side * 0.42, 0.0675, z - 0.75); o.rotation.y = side * Math.PI / 4; }
  }
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
  // the tall sign by the road: both faces
  box(M.post, SIGN.x - 0.2, 0, SIGN.z - 0.2, SIGN.x + 0.2, SIGN.h - 2.4, SIGN.z + 0.2);
  box(M.blue, SIGN.x - SIGN.half, SIGN.h - 2.6, SIGN.z - 0.18, SIGN.x + SIGN.half, SIGN.h, SIGN.z + 0.18);
  const pole = () => signTexture(THREE, 'GARAGE', { w: 720, h: 400, sub: 'DRIVE THROUGH' });
  plane(pole(), SIGN.half * 2 - 0.1, 2.5, SIGN.x, SIGN.h - 1.3, SIGN.z - 0.2, Math.PI);
  plane(pole(), SIGN.half * 2 - 0.1, 2.5, SIGN.x, SIGN.h - 1.3, SIGN.z + 0.2, 0);
  S.world.add(group);

  // what the car hits: the posts, the workshop, the sign's pole (not the lane — that's driven through)
  let handle = null;
  if (RAPIER && sim) {
    const [sx, sz] = S.toSim(F.cx, F.cz), half = h / 2;
    const cuboid = (x0, y0, z0, x1, y1, z1) => RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2).setTranslation(SIDE + (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);   // (the lane's frame, SIDE m right of the road)
    const descs = [];
    for (const x of [-POST.x, POST.x]) for (const z of [-POST.z, POST.z]) descs.push(cuboid(x - 0.35, 0, z - 0.35, x + 0.35, CANOPY.low, z + 0.35));
    descs.push(cuboid(SHOP.x0, 0, SHOP.z0, SHOP.x1, SHOP.h, SHOP.z1), cuboid(SIGN.x - 0.25, 0, SIGN.z - 0.25, SIGN.x + 0.25, SIGN.h, SIGN.z + 0.25));
    try { handle = sim.addStatic({ position: [sx, alt, sz], rotation: { x: 0, y: Math.sin(-half), z: 0, w: Math.cos(-half) } }, descs); }
    catch (e) { console.warn(`A garage's walls: ${e.message}`); }
  }
  return {
    item, group, frame: F,
    dispose() {
      group.removeFromParent();
      if (handle) sim.removeStatic(handle);
      for (const d of disposables) d.dispose?.();
    },
  };
}
