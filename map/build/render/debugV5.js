// Map v5's debug views (MAP_README.md, "Debug views"), after Map v4's in map/render/debug.ts's Shift+F3 cycle — each
// drawn from what the tile itself holds, near the car:
//   xsection    the road mesh's triangles by their part of the cross-section: road white, kerb yellow, verge green,
//               footpath cyan, island grey, garden brown (meshes.roads' surfaces)
//   surface     what the tyres feel: the road collision mesh by surface (as xsection's colours, gravel and dirt
//               orange) and the ground's surface grid round it (grass green, sand yellow, gravel orange, tarmac white)
//   elevation   the terrain's source, every 8 m: GA LiDAR 5 m green, Copernicus orange, blended yellow, sea blue
//   clearance   under each bridge deck, a line down to the ground: green 5 m clear or more, yellow 4.3 m, red less;
//               tunnels' edges purple
//   buildings   each building's type at its roof: a marker in its type's colour, pale where the type is estimated,
//               ringed where it's a landmark (lists.buildingInfo)
//   brands      each chain's sign bands and site pieces (pylon, canopy, pumps…) in its parody's colour, named
//   furniture   every piece of street furniture by kind; estimated ones (flags & 1) ringed orange
//
//   v5View(view, tile entry, put(colour) → line points, ctx) → true if it drew the view; V5_VIEWS, V5_LEGENDS
import * as THREE from 'three';
import { FURN } from "../format/furniture.js";
export const V5_VIEWS = ['xsection', 'surface', 'elevation', 'clearance', 'buildings', 'brands', 'furniture'];
export const V5_LEGENDS = {
    xsection: 'road white · kerb yellow · verge green · footpath cyan · island grey · garden brown',
    surface: 'tyre surfaces: tarmac white · concrete/footpath cyan · kerb yellow · grass green · gravel/dirt orange · sand yellow',
    elevation: 'terrain from: GA LiDAR 5 m green · Copernicus 30 m orange · blended yellow · sea blue',
    clearance: 'under bridges: ≥5 m green · ≥4.3 m yellow · less red · tunnels purple',
    buildings: 'type at the roof (pale: estimated, ringed: landmark) · house tan · shop pink · office blue · apartment violet · industrial grey · school green · church white',
    brands: 'chains: sign bands and site pieces in the parody\'s colour',
    furniture: 'traffic lights red · signs white · bus stops green · poles grey · street furniture blue · chains\' pieces pink · rail yellow · estimated ringed orange',
};
const SURF_COLOUR = { tarmac: 0xf0f0f0, concrete: 0x40e0ff, footpath: 0x40e0ff, cobbles: 0xc0a0ff, kerb: 0xffe040, gravel: 0xff9a30, dirt: 0xa0682a, grass: 0x40d040, sand: 0xf0d060 };
const TYPE_COLOUR = { house: 0xd9b48a, terrace: 0xc99a6a, apartment: 0xa070f0, shop: 0xff70b0, mall: 0xff3090, petrol: 0xff4040, office: 0x5090ff, tower: 0x3060e0, warehouse: 0x909090, industrial: 0x707070, school: 0x40c060, church: 0xffffff, hospital: 0xff6060, station: 0xffd040, plain: 0xb0b0b0, garage: 0x806040, canopy: 0xffa040 };
const KIND_COLOUR = (k) => k === FURN.trafficLight ? 0xff3030 : [FURN.stop, FURN.giveWay, FURN.speed, FURN.oneWay, FURN.roundabout, FURN.noEntry].includes(k) ? 0xffffff : [FURN.busStop, FURN.shelter].includes(k) ? 0x40e060 : [FURN.powerPole, FURN.pylon].includes(k) ? 0x9a9a9a : k >= FURN.pylonSign && k <= FURN.trolleyBay ? 0xff70b0 : [FURN.boomGate, FURN.catenaryMast].includes(k) ? 0xffe040 : 0x4090ff;
const pale = (c) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, m = (v) => Math.round(v + (255 - v) * 0.6); return (m(r) << 16) | (m(g) << 8) | m(b); };
const hexNum = (h) => parseInt((h ?? '#ff70b0').slice(1), 16);
// (a marker: a post up from y, and a ring at its top)
function marker(pts, x, y, z, h, r) {
    pts.push(x, y, z, x, y + h, z);
    for (let a = 0; a < 8; a++) {
        const a0 = a / 8 * Math.PI * 2, a1 = (a + 1) / 8 * Math.PI * 2;
        pts.push(x + Math.cos(a0) * r, y + h, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y + h, z + Math.sin(a1) * r);
    }
}
// (a name over a spot: a sprite, drawn once a name)
const labelCache = new Map();
function label(text, colour) {
    const key = `${text}|${colour}`;
    if (!labelCache.has(key)) {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 48;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(20,10,30,.75)';
        g.fillRect(0, 0, 256, 48);
        g.fillStyle = colour;
        g.font = 'bold 24px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text.slice(0, 20), 128, 25);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        labelCache.set(key, new THREE.SpriteMaterial({ map: t, depthTest: false }));
    }
    const s = new THREE.Sprite(labelCache.get(key));
    s.scale.set(8, 1.5, 1);
    s.renderOrder = 11;
    return s;
}
export function v5View(view, e, put, ctx) {
    const d = e.data, T = ctx.T, half = T / 2, hf = d.heightfield;
    const groundAt = (x, z) => { if (!hf)
        return 0; const N1 = hf.n + 1, c = Math.min(hf.n, Math.max(0, Math.round((x + half) / (T / hf.n)))), r = Math.min(hf.n, Math.max(0, Math.round((z + half) / (T / hf.n)))); return hf.heights[r + c * N1]; };
    // (a mesh's triangles' edges by their surface, near the car)
    const bySurface = (m, names, lift) => {
        if (!m?.surfaces)
            return;
        const P = m.positions, I = m.indices;
        for (let t = 0; t < I.length; t += 3) {
            const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
            if (!ctx.near(P[a], P[a + 2]))
                continue;
            const pts = put(SURF_COLOUR[names[m.surfaces[t / 3]]] ?? 0xff40ff);
            pts.push(P[a], P[a + 1] + lift, P[a + 2], P[b], P[b + 1] + lift, P[b + 2], P[b], P[b + 1] + lift, P[b + 2], P[c], P[c + 1] + lift, P[c + 2], P[c], P[c + 1] + lift, P[c + 2], P[a], P[a + 1] + lift, P[a + 2]);
        }
    };
    const surfaceNames = d.header.surfaceNames ?? [];
    if (view === 'xsection') {
        bySurface(d.meshes.roads, surfaceNames, 0.04);
        return true;
    }
    if (view === 'surface') {
        bySurface(d.meshes.roadCollision, surfaceNames, 0.06);
        // (the ground's own, every other cell)
        const G = d.grids.surface;
        if (G)
            for (let r = 0; r < G.n; r += 2)
                for (let c = 0; c < G.n; c += 2) {
                    const x = -half + (c + 0.5) * G.cell, z = -half + (r + 0.5) * G.cell;
                    if (!ctx.near(x, z))
                        continue;
                    const name = G.names?.[G.data[r * G.n + c]], y = groundAt(x, z) + 0.1, s = G.cell * 0.3;
                    put(SURF_COLOUR[name] ?? 0xff40ff).push(x - s, y, z, x + s, y, z, x, y, z - s, x, y, z + s);
                }
        return true;
    }
    if (view === 'elevation') {
        const G = d.grids.dem;
        if (!G)
            return true;
        const colour = { lidar: 0x40e060, copernicus: 0xff9a30, blend: 0xffe040, sea: 0x3080ff };
        const every = Math.max(1, Math.round(8 / G.cell));
        for (let r = 0; r < G.n; r += every)
            for (let c = 0; c < G.n; c += every) {
                const x = -half + c * G.cell, z = -half + r * G.cell, y = groundAt(x, z) + 0.2, s = G.cell * every * 0.35;
                put(colour[G.names?.[G.data[r * G.n + c]]] ?? 0xff40ff).push(x - s, y, z - s, x + s, y, z + s, x - s, y, z + s, x + s, y, z - s);
            }
        return true;
    }
    if (view === 'clearance') {
        const E = d.lists.roadEdges?.data;
        if (!E)
            return true;
        for (let k = 0; k < E.length; k += 8) {
            const kind = Math.round(E[k + 7]);
            if (kind === 4) {
                put(0xa060ff).push(E[k], E[k + 1] + 0.1, E[k + 2], E[k + 3], E[k + 4] + 0.1, E[k + 5]);
                continue;
            }
            if (kind !== 3)
                continue;
            const x = (E[k] + E[k + 3]) / 2, y = (E[k + 1] + E[k + 4]) / 2, z = (E[k + 2] + E[k + 5]) / 2, g = groundAt(x, z), gap = y - g;
            // (and a cross at the deck, so it reads from above too)
            put(gap >= 5 ? 0x40e060 : gap >= 4.3 ? 0xffe040 : 0xff3030).push(x, y, z, x, g, z, x - 0.8, y + 0.1, z - 0.8, x + 0.8, y + 0.1, z + 0.8, x - 0.8, y + 0.1, z + 0.8, x + 0.8, y + 0.1, z - 0.8);
        }
        return true;
    }
    if (view === 'buildings') {
        const L = d.lists.buildingInfo, types = d.header.buildingTypes ?? [];
        if (!L)
            return true;
        for (let k = 0; k < L.data.length; k += L.stride) {
            const x = L.data[k], top = L.data[k + 1], z = L.data[k + 2], type = types[L.data[k + 3]], f = L.data[k + 4];
            const c = TYPE_COLOUR[type] ?? 0xff40ff;
            marker(put(f & 1 ? pale(c) : c), x, top, z, 4, f & 2 ? 3 : 1.2);
        }
        return true;
    }
    if (view === 'brands') {
        const brands = ctx.manifest.brands ?? [], at = [];
        const S = d.lists.shopSigns;
        if (S)
            for (let k = 0; k < S.data.length; k += S.stride) {
                const b = S.data[k + 6];
                if (b >= 0)
                    at.push([S.data[k], S.data[k + 1], S.data[k + 2], b]);
            }
        const F = d.lists.furniture;
        if (F)
            for (let k = 0; k < F.data.length; k += F.stride) {
                const kind = F.data[k + 4];
                if (kind >= FURN.pylonSign && kind <= FURN.trolleyBay)
                    at.push([F.data[k], F.data[k + 1], F.data[k + 2], F.data[k + 5]]);
            }
        const named = new Set();
        for (const [x, y, z, b] of at) {
            const B = brands[b], c = hexNum(B?.colours?.primary);
            marker(put(c), x, y, z, 6, 1.5);
            // (its name once a tile, over its first piece)
            if (B && !named.has(b)) {
                named.add(b);
                const s = label(B.name, B.colours?.secondary ?? '#ffffff');
                s.position.set(x, y + 8, z);
                ctx.group.add(s);
            }
        }
        return true;
    }
    if (view === 'furniture') {
        const F = d.lists.furniture;
        if (!F)
            return true;
        for (let k = 0; k < F.data.length; k += F.stride) {
            const x = F.data[k], y = F.data[k + 1], z = F.data[k + 2], kind = F.data[k + 4], est = F.data[k + 7] & 1;
            if (!ctx.near(x, z))
                continue;
            marker(put(KIND_COLOUR(kind)), x, y, z, 3, 0.4);
            if (est)
                marker(put(0xffa030), x, y, z, 0.05, 0.8);
        }
        return true;
    }
    return false;
}
