// Map v5's street furniture in a tile (lists.furniture; map/model/furniture.ts makes it, map/render/furniture.ts draws
// it): one row of FURNITURE_STRIDE numbers per piece, in the tile's frame —
//   [x, y (its foot), z, yaw (the way it faces: +z turned by yaw about y), kind, a, b, flags]
// kind (FURN): what it is; a, b: its own (a traffic light's phase group and height; a speed sign's limit; a bus stop's
// shelter; a power pole's height; a chain's site's brand, the manifest's brands[a]); flags: 1 estimated (a placed
// canopy's also its size: along m × 256 + across m × 65536 — canopySize). And lists.wires: a power line's spans,
// [x1, y1, z1, x2, y2, z2].
export const FURNITURE_STRIDE = 8;
export const FURN = {
    trafficLight: 1, stop: 2, giveWay: 3, speed: 4, busStop: 5, shelter: 6, powerPole: 7, bench: 8, bin: 9, postBox: 10,
    hydrant: 11, bollard: 12, oneWay: 13, roundabout: 14, pylon: 15,
    // (a chain's site — map/model/buildingsV5.ts — a = its brand: the manifest's brands[a])
    pylonSign: 16, canopy: 17, pump: 18, menuBoard: 19, trolleyBay: 20,
};
export const FURN_NAMES = Object.fromEntries(Object.entries(FURN).map(([k, v]) => [v, k]));
// a placed canopy's size in its flags, and back ([along, across] m, whole metres; 18 × 11 if none)
export const canopyFlags = (estimated, along, across) => (estimated ? 1 : 0) + Math.round(along) * 256 + Math.round(across) * 65536;
export const canopySize = (flags) => [Math.floor(flags / 256) % 256 || 18, Math.floor(flags / 65536) % 256 || 11];
