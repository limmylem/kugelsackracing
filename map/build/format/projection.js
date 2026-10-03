// Map v3's flat frame: a transverse Mercator projection centred on the region (WGS84 ellipsoid, scale 1
// on the central meridian, false origin at the region's centre), in metres — x east, z SOUTH (the
// game's three.js / Rapier frame), y up. Over a city-sized region its scale error is a few parts per
// million (millimetres per kilometre), so distances and shapes are true; GDAL is given the very same
// projection (proj4 string below), so elevation rasters land on exactly this grid.
//
// Krüger's series to the 6th order in n (Karney 2011): agrees with PROJ's exact tmerc to well under a
// millimetre within hundreds of kilometres of the central meridian.
//
//   const P = transverseMercator(lat0, lon0)
//   P.toXZ(lat, lon) → [x, z]; P.toLatLon(x, z) → [lat, lon]; P.proj4 (for GDAL / PROJ)
const A = 6378137, F = 1 / 298.257223563;
const N = F / (2 - F), N2 = N * N, N3 = N2 * N, N4 = N3 * N, N5 = N4 * N, N6 = N5 * N;
const AA = A / (1 + N) * (1 + N2 / 4 + N4 / 64 + N6 / 256);
const ALPHA = [
    N / 2 - 2 * N2 / 3 + 5 * N3 / 16 + 41 * N4 / 180 - 127 * N5 / 288 + 7891 * N6 / 37800,
    13 * N2 / 48 - 3 * N3 / 5 + 557 * N4 / 1440 + 281 * N5 / 630 - 1983433 * N6 / 1935360,
    61 * N3 / 240 - 103 * N4 / 140 + 15061 * N5 / 26880 + 167603 * N6 / 181440,
    49561 * N4 / 161280 - 179 * N5 / 168 + 6601661 * N6 / 7257600,
    34729 * N5 / 80640 - 3418889 * N6 / 1995840,
    212378941 * N6 / 319334400,
];
const BETA = [
    N / 2 - 2 * N2 / 3 + 37 * N3 / 96 - N4 / 360 - 81 * N5 / 512 + 96199 * N6 / 604800,
    N2 / 48 + N3 / 15 - 437 * N4 / 1440 + 46 * N5 / 105 - 1118711 * N6 / 3870720,
    17 * N3 / 480 - 37 * N4 / 840 - 209 * N5 / 4480 + 5569 * N6 / 90720,
    4397 * N4 / 161280 - 11 * N5 / 504 - 830251 * N6 / 7257600,
    4583 * N5 / 161280 - 108847 * N6 / 3991680,
    20648693 * N6 / 638668800,
];
const E = Math.sqrt(F * (2 - F)), RAD = Math.PI / 180;
// (x east, y north) on the central meridian, from the equator
function forward(lat, dlon) {
    const phi = lat * RAD, lam = dlon * RAD;
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - E * Math.atanh(E * Math.sin(phi)));
    const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let x = eta, y = xi;
    for (let j = 1; j <= 6; j++) {
        const a = ALPHA[j - 1];
        x += a * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
        y += a * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    }
    return [AA * x, AA * y];
}
function inverse(x, y) {
    const xi = y / AA, eta = x / AA;
    let xp = xi, ep = eta;
    for (let j = 1; j <= 6; j++) {
        const b = BETA[j - 1];
        xp -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        ep -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const tauP = Math.sin(xp) / Math.sqrt(Math.sinh(ep) ** 2 + Math.cos(xp) ** 2), lam = Math.atan2(Math.sinh(ep), Math.cos(xp));
    // τ from τ′ (Newton)
    let tau = tauP;
    for (let k = 0; k < 6; k++) {
        const s = Math.sinh(E * Math.atanh(E * tau / Math.sqrt(1 + tau * tau))), tp = tau * Math.sqrt(1 + s * s) - s * Math.sqrt(1 + tau * tau);
        const d = (tauP - tp) / Math.sqrt(1 + tp * tp) * (1 + (1 - E * E) * tau * tau) / ((1 - E * E) * Math.sqrt(1 + tau * tau));
        tau += d;
        if (Math.abs(d) < 1e-14)
            break;
    }
    return [Math.atan(tau) / RAD, lam / RAD];
}
export function transverseMercator(lat0, lon0) {
    const [, y0] = forward(lat0, 0);
    return {
        lat0, lon0,
        toXZ(lat, lon) { const [x, y] = forward(lat, lon - lon0); return [x, -(y - y0)]; },
        toLatLon(x, z) { const [lat, dlon] = inverse(x, -z + y0); return [lat, dlon + lon0]; },
        proj4: `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +towgs84=0,0,0 +units=m +no_defs +type=crs`,
    };
}
