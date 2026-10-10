// A baked tile's collision, from its decoded arrays (world/tileFormat.js) — the same ones it's drawn
// from: the heightfield; the road, car park and tunnel-roof meshes as triangle meshes; each building's
// convex pieces, foot to eaves; every railing and wall as chained boxes (world/barriers.js: thick,
// taller than drawn, overlapping at the joints); tree trunks as cylinders. Ground first (what the car
// needs before anything else). Pure apart from Rapier: the game (world/streamer.js) and the tests use it.
//
//   tileColliders(tile, RAPIER, barriersCfg) → { pieces: [{ desc, userData }], ground (how many of the
//   first pieces are the ground and roads) }
import { barrierBoxes } from "../format/barriers.js";
export function tileColliders(d, RAPIER, B) {
    const out = [];
    if (d.heightfield)
        out.push({ desc: RAPIER.ColliderDesc.heightfield(d.heightfield.n, d.heightfield.n, d.heightfield.heights, { x: d.heightfield.size, y: 1, z: d.heightfield.size }), userData: { material: 'ground' } });
    for (const name of ['roads', 'paved', 'paths', 'cover']) {
        const m = d.meshes[name];
        if (m)
            out.push({ desc: RAPIER.ColliderDesc.trimesh(m.positions, m.indices), userData: { material: 'ground' } });
    }
    const ground = out.length;
    // buildings: each convex piece, foot to eaves
    const H = d.lists.hulls?.data;
    if (H)
        for (let k = 0; k < H.length;) {
            const n = H[k], y0 = H[k + 1], y1 = H[k + 2], pts = new Float32Array(n * 6);
            for (let q = 0; q < n; q++) {
                const x = H[k + 3 + q * 2], z = H[k + 4 + q * 2];
                pts.set([x, y0, z, x, y1, z], q * 6);
            }
            k += 3 + n * 2;
            const desc = RAPIER.ColliderDesc.convexHull(pts);
            if (desc)
                out.push({ desc, userData: { material: 'concrete', sound: 'building' } });
        }
    // railings and walls
    for (const [name, L] of Object.entries(d.lists)) {
        if (!name.startsWith('barrier_'))
            continue;
        for (const b of barrierBoxes(name.slice(8), L.data, B, L.stride))
            out.push({ desc: RAPIER.ColliderDesc.cuboid(...b.halfExtents).setTranslation(...b.centre).setRotation(b.rotation).setFriction(B.friction).setRestitution(B.restitution), userData: { material: b.material } });
    }
    // tree trunks
    const Tr = d.lists.trees?.data;
    if (Tr)
        for (let k = 0; k < Tr.length; k += 5) {
            const h = Tr[k + 3] * 4 * 0.6;
            out.push({ desc: RAPIER.ColliderDesc.cylinder(h / 2 + 0.5, 0.25).setTranslation(Tr[k], Tr[k + 1] + h / 2 - 0.5, Tr[k + 2]), userData: { material: 'wood', sound: 'tree' } });
        }
    return { pieces: out, ground };
}
