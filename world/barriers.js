// Railings, walls and fences, from the lines the baker lays them along (each a run of straight pieces:
// [x0, y0, z0, x1, y1, z1] at the foot, y the ground or road edge there) — to what the game draws and
// what a car hits. Pure: the game, the rail tests and the baker share it, so what's drawn and what's
// solid come from the same pieces.
//
// The colliders are boxes a piece long, at least minThickness thick and extraHeight taller than what's
// drawn, each overhanging its piece by its own thickness at both ends: consecutive pieces overlap at
// every joint and round every bend (up to a hairpin), so there's never a gap to slip through; the cars
// also use continuous collision detection, so even at 300 km/h they can't step through one between two
// physics steps.
//
//   barrierBoxes(type, pieces, cfg) → [{ centre: [x, y, z], halfExtents: [hx, hy, hz], rotation: quat }]
//   barrierInstances(type, pieces, cfg) → { rails: [{ position, yaw, pitch, length }], posts: [[x, y, z]] }

const quatYawPitch = (yaw, pitch) => {
  // yaw about +y, then pitch about the piece's own sideways axis (local +z after yaw: the box's x is along it)
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return { x: sy * sp, y: sy * cp, z: cy * sp, w: cy * cp };
};

// the shape of a type: what's drawn, and the collider round it
export function barrierShape(type, cfg) {
  const T = cfg.types[type] ?? cfg.types.wall;
  return { height: T.height, thickness: T.thickness, colliderThickness: Math.max(cfg.minThickness, T.thickness), colliderHeight: T.height + cfg.extraHeight, colour: T.colour, post: T.post ?? 0, material: T.material ?? 'concrete' };
}

export function barrierBoxes(type, pieces, cfg) {
  const S = barrierShape(type, cfg), out = [];
  for (let k = 0; k + 5 < pieces.length; k += 6) {
    const x0 = pieces[k], y0 = pieces[k + 1], z0 = pieces[k + 2], x1 = pieces[k + 3], y1 = pieces[k + 4], z1 = pieces[k + 5];
    const dx = x1 - x0, dz = z1 - z0, flat = Math.hypot(dx, dz);
    if (flat < 0.05) continue;
    const len = Math.hypot(flat, y1 - y0), yaw = Math.atan2(-dz, dx), pitch = Math.atan2(y1 - y0, flat);
    // (sunk a little into the ground, so nothing slides under it on uneven ground)
    const sink = 0.25, hy = (S.colliderHeight + sink) / 2;
    out.push({ centre: [(x0 + x1) / 2, (y0 + y1) / 2 - sink + hy, (z0 + z1) / 2], halfExtents: [len / 2 + S.colliderThickness, hy, S.colliderThickness / 2], rotation: quatYawPitch(yaw, pitch), material: S.material });
  }
  return out;
}

export function barrierInstances(type, pieces, cfg) {
  const S = barrierShape(type, cfg), rails = [], posts = [];
  let carry = 0;
  for (let k = 0; k + 5 < pieces.length; k += 6) {
    const x0 = pieces[k], y0 = pieces[k + 1], z0 = pieces[k + 2], x1 = pieces[k + 3], y1 = pieces[k + 4], z1 = pieces[k + 5];
    const dx = x1 - x0, dz = z1 - z0, flat = Math.hypot(dx, dz);
    if (flat < 0.05) continue;
    const len = Math.hypot(flat, y1 - y0);
    rails.push({ position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], yaw: Math.atan2(-dz, dx), pitch: Math.atan2(y1 - y0, flat), length: len });
    if (S.post) {
      for (let s = carry; s < len; s += S.post) { const t = s / len; posts.push([x0 + dx * t, y0 + (y1 - y0) * t, z0 + dz * t]); }
      carry = (carry - len) % S.post; if (carry < 0) carry += S.post;
    }
  }
  return { rails, posts };
}
export { quatYawPitch };
