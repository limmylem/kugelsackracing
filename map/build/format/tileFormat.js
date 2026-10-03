// Map v3's tile files (.m3t; ported from v2's world/tileFormat.js): one 512 m square of the world — what's drawn and what's collided
// with — in one small binary file, built offline (tools/world/bake.mjs) and only read by the game.
// The physics uses the very same arrays the drawing does (the road mesh is the road collider; the
// terrain's height grid is both the heightfield and what the terrain meshes are cut from), so what you
// see and what the car drives on can't drift apart.
//
// Layout: "DWT2", the header's length (u32), the header (JSON), padding to 4 bytes, then the buffers;
// the whole gzipped on disk (the baker), unpacked by decodeTile.
// Each mesh is meshoptimizer-compressed (vertex and index codecs): positions as int16 on a per-mesh
// scale and offset (about a centimetre), colours as rgba bytes, texture coordinates as int16 / 256;
// instance lists and physics shapes as float32 lists, or int16 multiples of a quantum (vertex codec
// too); byte grids (surfaces underfoot, terrain colours); the height grid as u16 centimetres. The
// terrain's meshes aren't stored: world/terrainMesh.js cuts them from the height grid.
//
//   encodeTile(tile, encoder) → Uint8Array   (Node: meshoptimizer's MeshoptEncoder)
//   await decodeTile(bytes, decoder) → tile  (the page / worker: meshopt_decoder; Node: meshoptimizer)
//
// tile: { header: {...}, meshes: { name: { positions (Float32Array xyz), colours? (Uint8Array rgba),
//   uvs? (Float32Array uv), indices (Uint32Array), surfaces? (Uint8Array per triangle) } },
//   lists: { name: { stride, data (Float32Array) } }, grids: { name: { n, data (Uint8Array) } },
//   heightfield: { n, size, heights (Float32Array, column-major: columns east, rows south) } }
export const MAGIC = 'MAP3', FORMAT_VERSION = 3;
const align4 = n => (n + 3) & ~3;
// ---------- writing ----------
export function encodeTile(tile, E) {
    const parts = [], H = { ...tile.header, format: FORMAT_VERSION, meshes: {}, lists: {}, grids: {} };
    let at = 0;
    const put = bytes => { const o = at; parts.push(bytes); const pad = align4(bytes.length) - bytes.length; if (pad)
        parts.push(new Uint8Array(pad)); at += align4(bytes.length); return { at: o, len: bytes.length }; };
    for (const [name, m] of Object.entries(tile.meshes ?? {})) {
        const n = m.positions.length / 3;
        if (!n || !m.indices.length)
            continue;
        // positions → int16 on this mesh's own scale
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < m.positions.length; i++) {
            const k = i % 3;
            if (m.positions[i] < lo[k])
                lo[k] = m.positions[i];
            if (m.positions[i] > hi[k])
                hi[k] = m.positions[i];
        }
        let scale = lo.map((l, k) => Math.max((hi[k] - l) / 65000, 1e-4)), offset = lo.map((l, k) => l + 32500 * scale[k]);
        // (Map v3: on one fixed grid — `positionQuantum` m, offsets whole multiples of it — so a point two
        // tiles share comes back exactly the same from both: no cracks where a mesh is split between tiles)
        const q = tile.header.positionQuantum;
        if (q) {
            const fixed = [q, q, q], off = lo.map((l, k) => Math.round((l + hi[k]) / 2 / q) * q);
            if (lo.every((l, k) => Math.abs(l - off[k]) / q < 32000 && Math.abs(hi[k] - off[k]) / q < 32000)) {
                scale = fixed;
                offset = off;
            }
        }
        const hasC = !!m.colours, hasUV = !!m.uvs, stride = 8 + (hasC ? 4 : 0) + (hasUV ? 4 : 0);
        const vb = new Uint8Array(n * stride), dv = new DataView(vb.buffer);
        for (let v = 0; v < n; v++) {
            const o = v * stride;
            for (let k = 0; k < 3; k++)
                dv.setInt16(o + k * 2, Math.round((m.positions[v * 3 + k] - offset[k]) / scale[k]), true);
            let p = o + 8;
            if (hasC) {
                vb.set(m.colours.subarray(v * 4, v * 4 + 4), p);
                p += 4;
            }
            if (hasUV)
                for (let k = 0; k < 2; k++)
                    dv.setInt16(p + k * 2, Math.max(-32768, Math.min(32767, Math.round(m.uvs[v * 2 + k] * 256))), true);
        }
        // (triangles and vertices in the order the codecs compress best, unless the triangles carry surfaces)
        let indices = m.indices, order = null;
        if (!m.surfaces && E.reorderMesh) {
            indices = Uint32Array.from(m.indices);
            const [remap] = E.reorderMesh(indices, true, true);
            order = remap;
        }
        if (order) {
            const vb2 = new Uint8Array(vb.length);
            for (let v = 0; v < n; v++)
                if (order[v] !== 0xffffffff)
                    vb2.set(vb.subarray(v * stride, v * stride + stride), order[v] * stride);
            vb.set(vb2);
        }
        const idx32 = n > 65535, ib = idx32 ? Uint32Array.from(indices) : Uint16Array.from(indices);
        const evb = E.encodeVertexBuffer(vb, n, stride), eib = E.encodeIndexBuffer(new Uint8Array(ib.buffer), ib.length, idx32 ? 4 : 2);
        H.meshes[name] = { count: n, stride, scale, offset, colours: hasC, uvs: hasUV, vb: put(evb), ib: put(eib), indexCount: ib.length, idx32,
            ...(m.surfaces && { surfaces: put(m.surfaces) }) };
    }
    for (const [name, L] of Object.entries(tile.lists ?? {})) {
        const count = L.data.length / L.stride;
        if (!count)
            continue;
        if (L.quantum) {
            // (as whole multiples of the list's quantum, int16: coordinates to a couple of centimetres)
            const n = L.data.length + (L.data.length % 2), q = new Int16Array(n);
            for (let k = 0; k < L.data.length; k++)
                q[k] = Math.max(-32768, Math.min(32767, Math.round(L.data[k] / L.quantum)));
            H.lists[name] = { count, stride: L.stride, quantum: L.quantum, length: L.data.length, data: put(E.encodeVertexBuffer(new Uint8Array(q.buffer), n / 2, 4)) };
            continue;
        }
        H.lists[name] = { count, stride: L.stride, data: put(E.encodeVertexBuffer(new Uint8Array(L.data.buffer, L.data.byteOffset, L.data.byteLength), count, L.stride * 4)) };
    }
    for (const [name, G] of Object.entries(tile.grids ?? {})) {
        const padded = new Uint8Array(align4(G.data.length));
        padded.set(G.data);
        H.grids[name] = { n: G.n, cell: G.cell, names: G.names, length: G.data.length, data: put(E.encodeVertexBuffer(padded, padded.length / 4, 4)) };
    }
    if (tile.heightfield) {
        const hf = tile.heightfield, q = new Uint16Array(hf.heights.length + (hf.heights.length % 2));
        let lo = Infinity, hi = -Infinity;
        for (const h of hf.heights) {
            if (h < lo)
                lo = h;
            if (h > hi)
                hi = h;
        }
        // (on the bake's own step when it gives one, so the heights come back exactly as baked)
        const scale = hf.quantum && (hi - lo) / hf.quantum < 65000 ? hf.quantum : Math.max((hi - lo) / 65000, 0.001);
        if (hf.quantum)
            lo = Math.round(lo / scale) * scale;
        for (let i = 0; i < hf.heights.length; i++)
            q[i] = Math.round((hf.heights[i] - lo) / scale);
        H.heightfield = { n: hf.n, size: hf.size, offset: lo, scale, data: put(E.encodeVertexBuffer(new Uint8Array(q.buffer), q.length / 2, 4)) };
    }
    const json = new TextEncoder().encode(JSON.stringify(H)), head = new Uint8Array(8 + align4(json.length));
    head.set(new TextEncoder().encode(MAGIC));
    new DataView(head.buffer).setUint32(4, json.length, true);
    head.set(json, 8);
    const out = new Uint8Array(head.length + at);
    out.set(head);
    let o = head.length;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
// what each quantised height and position comes back as (exactly what the reader gets): the baker
// uses these so its own checks see the same numbers the game will
export const dequantise = (v, scale, offset) => v * scale + offset;
// ---------- reading ----------
// (tile files are stored gzipped — the codecs' output squeezes by almost half again — and unpacked here
// with the browser's own (and Node's) DecompressionStream; plain ones are read as they are)
export const isGzip = u8 => u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
export async function gunzip(u8) {
    if (!isGzip(u8))
        return u8;
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function decodeTile(bytes, D) {
    if (D.ready)
        await D.ready;
    const u8 = await gunzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (new TextDecoder().decode(u8.subarray(0, 4)) !== MAGIC)
        throw new Error('not a baked world tile');
    const len = new DataView(u8.buffer, u8.byteOffset).getUint32(4, true), H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + len)));
    if (H.format !== FORMAT_VERSION)
        throw new Error(`tile format ${H.format}: this game reads ${FORMAT_VERSION} (bake again)`);
    const base = 8 + align4(len), slice = r => u8.subarray(base + r.at, base + r.at + r.len);
    const tile = { header: H, meshes: {}, lists: {}, grids: {}, heightfield: null };
    for (const [name, M] of Object.entries(H.meshes)) {
        const vb = new Uint8Array(M.count * M.stride);
        D.decodeVertexBuffer(vb, M.count, M.stride, slice(M.vb));
        const ib = M.idx32 ? new Uint32Array(M.indexCount) : new Uint16Array(M.indexCount);
        D.decodeIndexBuffer(new Uint8Array(ib.buffer), M.indexCount, M.idx32 ? 4 : 2, slice(M.ib));
        const dv = new DataView(vb.buffer), positions = new Float32Array(M.count * 3), colours = M.colours ? new Uint8Array(M.count * 4) : null, uvs = M.uvs ? new Float32Array(M.count * 2) : null;
        for (let v = 0; v < M.count; v++) {
            const o = v * M.stride;
            for (let k = 0; k < 3; k++)
                positions[v * 3 + k] = dv.getInt16(o + k * 2, true) * M.scale[k] + M.offset[k];
            let p = o + 8;
            if (colours) {
                colours.set(vb.subarray(p, p + 4), v * 4);
                p += 4;
            }
            if (uvs)
                for (let k = 0; k < 2; k++)
                    uvs[v * 2 + k] = dv.getInt16(p + k * 2, true) / 256;
        }
        tile.meshes[name] = { positions, colours, uvs, indices: (M.idx32 ? ib : Uint32Array.from(ib)), surfaces: M.surfaces ? slice(M.surfaces).slice() : null };
    }
    for (const [name, L] of Object.entries(H.lists)) {
        if (L.quantum) {
            const n = L.length + (L.length % 2), q = new Int16Array(n);
            D.decodeVertexBuffer(new Uint8Array(q.buffer), n / 2, 4, slice(L.data));
            const data = new Float32Array(L.length);
            for (let k = 0; k < L.length; k++)
                data[k] = q[k] * L.quantum;
            tile.lists[name] = { stride: L.stride, data };
            continue;
        }
        const data = new Float32Array(L.count * L.stride);
        D.decodeVertexBuffer(new Uint8Array(data.buffer), L.count, L.stride * 4, slice(L.data));
        tile.lists[name] = { stride: L.stride, data };
    }
    for (const [name, G] of Object.entries(H.grids)) {
        const length = G.length ?? G.n * G.n, data = new Uint8Array(align4(length));
        D.decodeVertexBuffer(data, data.length / 4, 4, slice(G.data));
        tile.grids[name] = { n: G.n, cell: G.cell, names: G.names, data: length === data.length ? data : data.slice(0, length) };
    }
    if (H.heightfield) {
        const F = H.heightfield, count = (F.n + 1) * (F.n + 1), q = new Uint16Array(count + (count % 2));
        D.decodeVertexBuffer(new Uint8Array(q.buffer), q.length / 2, 4, slice(F.data));
        const heights = new Float32Array(count);
        for (let i = 0; i < count; i++)
            heights[i] = q[i] * F.scale + F.offset;
        tile.heightfield = { n: F.n, size: F.size, heights };
    }
    return tile;
}
// the heights a heightfield comes back with (the baker's own copy, quantised as the file stores them)
export function quantisedHeights(heights) {
    let lo = Infinity, hi = -Infinity;
    for (const h of heights) {
        if (h < lo)
            lo = h;
        if (h > hi)
            hi = h;
    }
    const scale = Math.max((hi - lo) / 65000, 0.001);
    return Float32Array.from(heights, h => Math.round((h - lo) / scale) * scale + lo);
}
// positions as the file gives them back
export function quantisedPositions(positions) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
        const k = i % 3;
        if (positions[i] < lo[k])
            lo[k] = positions[i];
        if (positions[i] > hi[k])
            hi[k] = positions[i];
    }
    const scale = lo.map((l, k) => Math.max((hi[k] - l) / 65000, 1e-4)), offset = lo.map((l, k) => l + 32500 * scale[k]);
    return Float32Array.from(positions, (p, i) => Math.round((p - offset[i % 3]) / scale[i % 3]) * scale[i % 3] + offset[i % 3]);
}
