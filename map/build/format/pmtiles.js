// @ts-nocheck — the PMTiles reader, ported as it was from world/pmtiles.js (tested there)
// PMTiles (version 3): every map tile of a region in one file, read a piece at a time with HTTP range
// requests, so the whole world's map is one static file on any host or CDN — no tile server. The file is
// a 127-byte header, a root directory (tile id → where its bytes are), the region's metadata (JSON:
// layers, attribution, how it was built), leaf directories when there are many tiles, then the tiles.
// Tile ids run along a Hilbert curve zoom by zoom, so neighbouring tiles sit near each other in the file.
//
//   const pm = await openPmtiles(source)  source: { read(offset, length) → Promise<Uint8Array> }
//   await pm.tile(z, x, y) → the tile's bytes (decompressed), or null
//   pm.header, pm.metadata
//   writePmtiles({ tiles: [{ z, x, y, data }], metadata, ... }) → Uint8Array (the map pipeline)
//
// Compression is gzip throughout (gzip / gunzip passed in, or the platform's CompressionStream).
export const MAGIC = 'PMTiles', HEADER = 127, ROOT_MAX = 16384;
export const COMPRESSION = { unknown: 0, none: 1, gzip: 2, brotli: 3, zstd: 4 };
export const TILE_TYPE = { unknown: 0, mvt: 1, png: 2, jpeg: 3, webp: 4, avif: 5 };
// ---------- tile ids (Hilbert order, zoom by zoom) ----------
const ZOOM_START = Array.from({ length: 27 }, (_, z) => (4 ** z - 1) / 3);
export function zxyToTileId(z, x, y) {
    if (z > 26)
        throw new Error('zoom too deep');
    const n = 2 ** z;
    if (x < 0 || y < 0 || x >= n || y >= n)
        throw new Error(`tile ${z}/${x}/${y} outside its zoom`);
    let d = 0, tx = x, ty = y;
    for (let s = n / 2; s > 0; s /= 2) {
        const rx = (tx & s) > 0 ? 1 : 0, ry = (ty & s) > 0 ? 1 : 0;
        d += s * s * ((3 * rx) ^ ry);
        if (ry === 0) {
            if (rx === 1) {
                tx = s - 1 - tx;
                ty = s - 1 - ty;
            }
            [tx, ty] = [ty, tx];
        }
    }
    return ZOOM_START[z] + d;
}
export function tileIdToZxy(id) {
    let z = 0;
    while (z < 26 && ZOOM_START[z + 1] <= id)
        z++;
    const n = 2 ** z;
    let t = id - ZOOM_START[z], x = 0, y = 0;
    for (let s = 1; s < n; s *= 2) {
        const rx = 1 & (t / 2), ry = 1 & (t ^ rx);
        if (ry === 0) {
            if (rx === 1) {
                x = s - 1 - x;
                y = s - 1 - y;
            }
            [x, y] = [y, x];
        }
        x += s * rx;
        y += s * ry;
        t = Math.floor(t / 4);
    }
    return [z, x, y];
}
// ---------- gzip (the platform's streams; Node 18+, browsers, workers) ----------
async function streamThrough(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
}
export const gunzip = bytes => streamThrough(bytes, new DecompressionStream('gzip'));
export const gzip = bytes => streamThrough(bytes, new CompressionStream('gzip'));
// ---------- varints (directories) ----------
function readVarint(b, p) {
    let v = 0, shift = 0, x;
    do {
        x = b[p.i++];
        v += (x & 0x7f) * 2 ** shift;
        shift += 7;
    } while (x & 0x80);
    return v;
}
function writeVarint(out, v) { while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
} out.push(v); }
export function encodeDirectory(entries) {
    const out = [];
    writeVarint(out, entries.length);
    let last = 0;
    for (const e of entries) {
        writeVarint(out, e.tileId - last);
        last = e.tileId;
    }
    for (const e of entries)
        writeVarint(out, e.runLength);
    for (const e of entries)
        writeVarint(out, e.length);
    entries.forEach((e, i) => writeVarint(out, i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1));
    return Uint8Array.from(out);
}
export function decodeDirectory(bytes) {
    const p = { i: 0 }, n = readVarint(bytes, p), entries = new Array(n);
    let last = 0;
    for (let i = 0; i < n; i++) {
        last += readVarint(bytes, p);
        entries[i] = { tileId: last, runLength: 0, length: 0, offset: 0 };
    }
    for (let i = 0; i < n; i++)
        entries[i].runLength = readVarint(bytes, p);
    for (let i = 0; i < n; i++)
        entries[i].length = readVarint(bytes, p);
    for (let i = 0; i < n; i++) {
        const v = readVarint(bytes, p);
        entries[i].offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
    }
    return entries;
}
// The entry holding a tile id (a tile, or a leaf directory: runLength 0), or null
export function findEntry(entries, tileId) {
    let lo = 0, hi = entries.length - 1;
    while (lo <= hi) {
        const m = (lo + hi) >> 1, d = tileId - entries[m].tileId;
        if (d > 0)
            lo = m + 1;
        else if (d < 0)
            hi = m - 1;
        else
            return entries[m];
    }
    if (hi >= 0) {
        const e = entries[hi];
        if (e.runLength === 0)
            return e;
        if (tileId - e.tileId < e.runLength)
            return e;
    }
    return null;
}
// ---------- the header ----------
const u64 = (v, o) => Number(v.getBigUint64(o, true));
export function readHeader(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (new TextDecoder().decode(bytes.subarray(0, 7)) !== MAGIC)
        throw new Error('not a PMTiles file');
    if (bytes[7] !== 3)
        throw new Error(`PMTiles version ${bytes[7]} (only 3 is read)`);
    const e7 = o => v.getInt32(o, true) / 1e7;
    return {
        rootOffset: u64(v, 8), rootLength: u64(v, 16), metadataOffset: u64(v, 24), metadataLength: u64(v, 32), leafOffset: u64(v, 40), leafLength: u64(v, 48),
        tileDataOffset: u64(v, 56), tileDataLength: u64(v, 64), addressedTiles: u64(v, 72), tileEntries: u64(v, 80), tileContents: u64(v, 88),
        clustered: bytes[96] === 1, internalCompression: bytes[97], tileCompression: bytes[98], tileType: bytes[99], minZoom: bytes[100], maxZoom: bytes[101],
        minLon: e7(102), minLat: e7(106), maxLon: e7(110), maxLat: e7(114), centerZoom: bytes[118], centerLon: e7(119), centerLat: e7(123),
    };
}
function writeHeader(h) {
    const b = new Uint8Array(HEADER), v = new DataView(b.buffer);
    b.set(new TextEncoder().encode(MAGIC));
    b[7] = 3;
    [h.rootOffset, h.rootLength, h.metadataOffset, h.metadataLength, h.leafOffset, h.leafLength, h.tileDataOffset, h.tileDataLength, h.addressedTiles, h.tileEntries, h.tileContents]
        .forEach((x, i) => v.setBigUint64(8 + i * 8, BigInt(x), true));
    b[96] = 1;
    b[97] = COMPRESSION.gzip;
    b[98] = COMPRESSION.gzip;
    b[99] = TILE_TYPE.mvt;
    b[100] = h.minZoom;
    b[101] = h.maxZoom;
    const e7 = (o, x) => v.setInt32(o, Math.round(x * 1e7), true);
    e7(102, h.minLon);
    e7(106, h.minLat);
    e7(110, h.maxLon);
    e7(114, h.maxLat);
    b[118] = h.centerZoom;
    e7(119, h.centerLon);
    e7(123, h.centerLat);
    return b;
}
// ---------- reading ----------
// source.read(offset, length) → Promise<Uint8Array>; unzip: gunzip by default
export async function openPmtiles(source, { unzip = gunzip } = {}) {
    const first = await source.read(0, ROOT_MAX), header = readHeader(first);
    const inflate = async (bytes, c) => c === COMPRESSION.gzip ? unzip(bytes) : c <= COMPRESSION.none ? bytes : Promise.reject(new Error(`compression ${c} isn't read`));
    const dirBytes = async (offset, length) => offset + length <= first.length ? first.subarray(offset, offset + length) : source.read(offset, length);
    const root = decodeDirectory(await inflate(await dirBytes(header.rootOffset, header.rootLength), header.internalCompression));
    const leaves = new Map(); // (leaf directories read, by offset: kept, there are few)
    const leaf = async (e) => {
        const key = e.offset;
        if (!leaves.has(key))
            leaves.set(key, (async () => decodeDirectory(await inflate(await source.read(header.leafOffset + e.offset, e.length), header.internalCompression)))());
        return leaves.get(key);
    };
    const metadata = header.metadataLength ? JSON.parse(new TextDecoder().decode(await inflate(await dirBytes(header.metadataOffset, header.metadataLength), header.internalCompression))) : {};
    return {
        header, metadata,
        // where a tile's bytes are in the file: { offset, length } or null
        async locate(z, x, y) {
            const id = zxyToTileId(z, x, y);
            let dir = root;
            for (let depth = 0; depth < 4; depth++) {
                const e = findEntry(dir, id);
                if (!e)
                    return null;
                if (e.runLength > 0)
                    return { offset: header.tileDataOffset + e.offset, length: e.length };
                dir = await leaf(e);
            }
            return null;
        },
        async tile(z, x, y) {
            if (z < header.minZoom || z > header.maxZoom)
                return null;
            const at = await this.locate(z, x, y);
            if (!at)
                return null;
            return inflate(await source.read(at.offset, at.length), header.tileCompression);
        },
    };
}
// A source over HTTP range requests (a static host, a CDN, the dev server)
export function httpSource(url, { fetchFn = fetch } = {}) {
    return {
        async read(offset, length) {
            const r = await fetchFn(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
            if (!r.ok)
                throw new Error(`${url}: HTTP ${r.status}`);
            const b = new Uint8Array(await r.arrayBuffer());
            // (a host that ignores ranges sends the whole file)
            return r.status === 200 && b.length > length ? b.subarray(offset, offset + length) : b;
        },
    };
}
// ---------- writing (the map pipeline) ----------
// tiles: [{ z, x, y, data (MVT bytes, not yet compressed) }]; metadata: JSON; bounds: [w, s, e, n];
// center: [lon, lat, zoom]. Identical tiles are stored once.
export async function writePmtiles({ tiles, metadata = {}, bounds, center, zip = gzip }) {
    const sorted = tiles.map(t => ({ ...t, tileId: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.tileId - b.tileId);
    const blobs = [], byContent = new Map(), entries = [];
    let offset = 0;
    for (const t of sorted) {
        const packed = await zip(t.data), key = await hash(packed);
        let at = byContent.get(key);
        if (!at) {
            at = { offset, length: packed.length };
            byContent.set(key, at);
            blobs.push(packed);
            offset += packed.length;
        }
        const last = entries.at(-1);
        if (last && last.offset === at.offset && last.tileId + last.runLength === t.tileId)
            last.runLength++;
        else
            entries.push({ tileId: t.tileId, offset: at.offset, length: at.length, runLength: 1 });
    }
    // the directories: everything in the root if it fits, else leaves of `size` entries listed in the root
    let root, leafBytes = new Uint8Array(0);
    for (let size = 0;; size = size ? size * 2 : 4096) {
        if (!size) {
            root = await zip(encodeDirectory(entries));
            if (HEADER + root.length <= ROOT_MAX)
                break;
            continue;
        }
        const leafDirs = [], rootEntries = [];
        let lo = 0;
        for (let i = 0; i < entries.length; i += size) {
            const d = await zip(encodeDirectory(entries.slice(i, i + size)));
            rootEntries.push({ tileId: entries[i].tileId, offset: lo, length: d.length, runLength: 0 });
            leafDirs.push(d);
            lo += d.length;
        }
        root = await zip(encodeDirectory(rootEntries));
        if (HEADER + root.length <= ROOT_MAX) {
            leafBytes = concat(leafDirs);
            break;
        }
    }
    const meta = await zip(new TextEncoder().encode(JSON.stringify(metadata)));
    const zooms = sorted.map(t => t.z);
    const h = {
        rootOffset: HEADER, rootLength: root.length, metadataOffset: HEADER + root.length, metadataLength: meta.length,
        leafOffset: HEADER + root.length + meta.length, leafLength: leafBytes.length, tileDataOffset: HEADER + root.length + meta.length + leafBytes.length, tileDataLength: offset,
        addressedTiles: sorted.length, tileEntries: entries.length, tileContents: blobs.length, minZoom: Math.min(...zooms), maxZoom: Math.max(...zooms),
        minLon: bounds[0], minLat: bounds[1], maxLon: bounds[2], maxLat: bounds[3], centerLon: center[0], centerLat: center[1], centerZoom: center[2],
    };
    return concat([writeHeader(h), root, meta, leafBytes, ...blobs]);
}
async function hash(bytes) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(d.subarray(0, 12), b => b.toString(16).padStart(2, '0')).join('');
}
function concat(parts) {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
