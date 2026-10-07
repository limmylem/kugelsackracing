// The world frame players share (Phase 7 Step 1; docs/MULTIPLAYER.md). Each game runs its physics near a floating
// origin (Map v3's: a whole number of map tiles, moved as the car travels — map/render/streamer.ts), so two players'
// physics coordinates differ. On the wire every position is in the WORLD frame: the region's own map frame
// (metres east and south of its corner; a test world's frame is the world itself, origin 0). The origin only ever
// moves by whole tiles and never turns, so sim = world − origin exactly, both ways, for everyone.
//
//   const fr = createFrame(() => origin)     origin: [x, y, z] m, or [x, z] (Map v3's), or null (0)
//   fr.toWorld([x, y, z]) / fr.toSim([x, y, z])      (rotations and velocities are the same in both)

export function createFrame(originOf = () => null) {
  const o = () => { const v = originOf(); return !v ? [0, 0, 0] : v.length === 2 ? [v[0], 0, v[1]] : v; };
  return {
    toWorld(p) { const c = o(); return [p[0] + c[0], p[1] + c[1], p[2] + c[2]]; },
    toSim(p) { const c = o(); return [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; },
    get origin() { return o(); },
  };
}
