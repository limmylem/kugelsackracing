// The terrain's meshes for a baked tile, cut from its height grid — the very grid the physics' heightfield
// is — by RTIN (Martini) at a few error bounds (near, mid, far), and coloured from the tile's terrain
// colour grid (land use, rock, beach, under water). Made where the tile is decoded (the tile worker; Node
// for the tests), so the file carries the heights once instead of three meshes of them.
//
//   terrainMeshes(tile) → { terrain0, terrain1, terrain2 }: { positions, colours, indices }, tile-local
//   (x east, z south from the tile's middle)
import Martini from '../vendor/martini.js';
const cutters = new Map();
export function terrainMeshes(tile, errors = tile.header.terrain?.lodErrors ?? [0.08, 0.6, 3]) {
    const hf = tile.heightfield, G = tile.grids.terrain, pal = tile.header.terrain?.palette ?? [[128, 128, 128]];
    if (!hf)
        return {};
    const N1 = hf.n + 1, cell = hf.size / hf.n, half = hf.size / 2, H = hf.heights;
    // (the grid row by row for the cutter: rows south, columns east; the heightfield is column by column)
    const rows = new Float32Array(N1 * N1);
    for (let c = 0; c < N1; c++)
        for (let r = 0; r < N1; r++)
            rows[r * N1 + c] = H[r + c * N1];
    if (!cutters.has(N1))
        cutters.set(N1, new Martini(N1));
    const cut = cutters.get(N1).createTile(rows), out = {};
    errors.forEach((err, k) => {
        const { vertices, triangles } = cut.getMesh(err), nv = vertices.length / 2;
        const positions = new Float32Array(nv * 3), colours = new Uint8Array(nv * 4);
        for (let v = 0; v < nv; v++) {
            const c = vertices[v * 2], r = vertices[v * 2 + 1], col = pal[G ? G.data[r * N1 + c] : 0] ?? pal[0];
            positions[v * 3] = -half + c * cell;
            positions[v * 3 + 1] = H[r + c * N1];
            positions[v * 3 + 2] = -half + r * cell;
            colours[v * 4] = col[0];
            colours[v * 4 + 1] = col[1];
            colours[v * 4 + 2] = col[2];
            colours[v * 4 + 3] = 255;
        }
        out[`terrain${k}`] = { positions, colours, uvs: null, indices: Uint32Array.from(triangles), surfaces: null };
    });
    return out;
}
