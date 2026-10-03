// Map v3's grids, in the region's projected metres (map/format/projection.ts: x east, z south).
//
// Tiles: squares of `tileSize` m; tile (i, j) covers x ∈ [i·T, (i+1)·T), z ∈ [j·T, (j+1)·T).
// Heights: one region-wide grid of points every `cell` m, from (x0, z0) = (i0·T, j0·T), W × H points —
// every tile's heightfield is the (T/cell + 1)² points of it over the tile, so two neighbours share
// their edge row exactly: no seams, in what's drawn or in what's collided with.
// The same grid as a north-up raster (GDAL): point (c, r) is pixel (c, r)'s centre, at easting
// x0 + c·cell, northing −(z0 + r·cell).
export function gridFor(bounds, tileSize, cell) {
    const [xa, za, xb, zb] = bounds;
    const i0 = Math.floor(xa / tileSize), j0 = Math.floor(za / tileSize), i1 = Math.floor(xb / tileSize), j1 = Math.floor(zb / tileSize);
    const per = tileSize / cell;
    return { tileSize, cell, i0, j0, i1, j1, x0: i0 * tileSize, z0: j0 * tileSize, W: (i1 - i0 + 1) * per + 1, H: (j1 - j0 + 1) * per + 1 };
}
// GDAL's -te (xmin ymin xmax ymax, northing up) and -ts for the grid as a raster of pixel centres
export function rasterExtent(g) {
    const h = g.cell / 2;
    return { te: [g.x0 - h, -(g.z0 + (g.H - 1) * g.cell) - h, g.x0 + (g.W - 1) * g.cell + h, -g.z0 + h], ts: [g.W, g.H] };
}
// a tile's points in the region grid: column / row of its first point
export const tileOrigin = (g, i, j) => [(i - g.i0) * (g.tileSize / g.cell), (j - g.j0) * (g.tileSize / g.cell)];
