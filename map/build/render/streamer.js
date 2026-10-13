// Map v3's streamer (ported from v2's world/streamer.js): the baked map, streamed round the car (the game side of map/bake/bake.ts): which tiles are wanted
// (all within a radius, nearest first, and ahead of the car by how fast it's going), loading them in Web
// Workers (map/render/worker.ts: fetch or the IndexedDB cache, decode), adding what they look like
// (world/tileObjects.js) and their collision — the heightfield, the road, car park and tunnel-roof meshes,
// each building's convex pieces, every railing's chained boxes, the tree trunks: the same baked arrays —
// to the physics a few milliseconds' worth a frame, and dropping tiles left far behind.
//
// The physics runs near its origin (Phase 1 Step 7's floating origin): when the car is more than
// REBASE m out, the origin moves a whole number of tiles to the car's tile and the simulation is
// re-expressed there between two steps (physics/sim.js shiftOrigin); the drawn world moves with it.
//
//   const W = await createWorldStream({ manifestUrl, scene, sim, RAPIER })
//   each frame: W.update(carPosition (sim), velocity, dt) → { shifted: [tx, 0, tz] | null }
//   W.readyAround(x, z, r) (physics there?), W.surfaceAt(x, z), W.placeOnGround(x, z, yFrom), W.where(x, z)
//   W.status (for the overlay), W.toWorld / W.toSim
//   W.carve(id, { polys: [[[x, z], …], …] (the map's frame), below(x, z) → the built surface's height there,
//   surfaces: [a surface's name for each outline] } | null): something built set into the ground (a garage —
//   play/garageBuilding.js): inside its outlines the drawn ground, cover and car parks are left out (objects.ts ground
//   holes); the physics' ground is lowered under it and the car parks', paths' and cover's collision taken out there
//   (roads kept: what's built joins them), and trees and railings standing in it (neither drawn nor solid), in the tiles
//   in now and as they load; and the tyres' surface there is its own
//
// Headless (the streaming tests, in Node): options { headless: true, manifest, loadTile(key, url) →
// Promise<the worker's message>, now() } — the same planning and physics, nothing drawn, no workers,
// the clock the test's.
import * as THREE from 'three';
import { materials, srgbVertexColours, tileObjects, setGroundHoles, setGroundHoleOrigin, groundHolesOwner } from "./objects.js";
import { tileColliders } from "./physics.js";
import { transverseMercator } from "../format/projection.js";
export const REBASE = 1536;
const DEFAULTS = { loadRadius: 1400, unloadRadius: 2100, physicsRadius: 750, physicsDrop: 1100, lookAhead: 4, maxLoads: 4, workers: 2, budgetMs: 4 };
export async function createWorldStream({ manifestUrl, scene, sim, RAPIER, options = {} }) {
    const O = { ...DEFAULTS, ...options }, clock = O.now ?? (() => performance.now());
    const manifest = O.manifest ?? await (await fetch(manifestUrl, { cache: 'no-cache' })).json();
    const failedAt = new Map(); // key → when its last load failed (tried again after a pause)
    // (relative to the page's base, as fetch resolves it: dev pages set <base href="../">)
    const base = O.manifest ? '' : new URL('.', new URL(manifestUrl, globalThis.document?.baseURI ?? location.href)).href, T = manifest.grid.tileSize, half = T / 2;
    const P = transverseMercator(manifest.projection.lat0, manifest.projection.lon0);
    const byKey = new Map(manifest.tiles.map(t => [`${t.i}_${t.j}`, t]));
    // the physics' origin, in the world's frame: tile-aligned, at the spawn's tile to begin with
    const [sx, sz] = manifest.spawn.xz;
    let origin = [Math.floor(sx / T) * T, Math.floor(sz / T) * T];
    const world = new THREE.Group();
    world.name = 'baked world';
    world.position.set(-origin[0], 0, -origin[1]);
    scene.add(world);
    const surfaces = Object.entries(manifest.surfaces).map(([name, s]) => ({ name, ...s }));
    // ---------- workers ----------
    const workers = O.loadTile ? [] : Array.from({ length: O.workers }, () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
    const waiting = new Map();
    let nextWorker = 0;
    for (const w of workers)
        w.onmessage = e => { const m = e.data; if (m.type === 'prefetched')
            return; const r = waiting.get(m.key); waiting.delete(m.key); r?.(m); };
    const fetchTile = t => { const key = `${t.i}_${t.j}`, url = `${base}tiles/${key}.m3t`; return O.loadTile ? O.loadTile(key, url) : new Promise(resolve => { waiting.set(key, resolve); workers[nextWorker++ % workers.length].postMessage({ type: 'load', key, url, version: manifest.version }); }); };
    // ---------- the far world: the whole region, drawn wherever detailed tiles haven't come in ----------
    // (a mask of the detailed tiles in, one texel a tile, read by the far meshes' shader to leave a hole
    // for each)
    const tx = manifest.tiles.map(t => t.i), tz = manifest.tiles.map(t => t.j);
    const mi0 = Math.min(...tx) - 1, mj0 = Math.min(...tz) - 1, mw = Math.max(...tx) - mi0 + 2, mh = Math.max(...tz) - mj0 + 2;
    const maskData = new Uint8Array(mw * mh), mask = new THREE.DataTexture(maskData, mw, mh, THREE.RedFormat, THREE.UnsignedByteType);
    mask.magFilter = mask.minFilter = THREE.NearestFilter;
    mask.needsUpdate = true;
    const maskUniforms = { uMask: { value: mask }, uMaskInfo: { value: new THREE.Vector4(mi0, mj0, mw, mh) }, uTile: { value: T }, uOrigin: { value: new THREE.Vector2(...origin) } };
    const setMask = (e, on) => { const c = e.i - mi0, r = e.j - mj0; if (c >= 0 && r >= 0 && c < mw && r < mh) {
        maskData[r * mw + c] = on ? 255 : 0;
        mask.needsUpdate = true;
    } };
    const masked = m => {
        const out = m.clone();
        const inner = m.onBeforeCompile;
        out.onBeforeCompile = (sh, r) => {
            inner?.(sh, r);
            Object.assign(sh.uniforms, maskUniforms);
            sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFarPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFarPos; uniform sampler2D uMask; uniform vec4 uMaskInfo; uniform float uTile; uniform vec2 uOrigin;')
                .replace('void main() {', 'void main() {\n  vec2 g = floor((vFarPos.xz + uOrigin) / uTile) - uMaskInfo.xy;\n  if (g.x >= 0.0 && g.y >= 0.0 && g.x < uMaskInfo.z && g.y < uMaskInfo.w && texture2D(uMask, (g + 0.5) / uMaskInfo.zw).r > 0.5) discard;');
        };
        const innerKey = m.customProgramCacheKey?.bind(m);
        out.customProgramCacheKey = () => `far-${m.type}-${innerKey ? innerKey() : ''}`;
        return out;
    };
    let waitingFar = 0;
    const far = new THREE.Group();
    far.name = 'far world';
    world.add(far);
    if (!O.headless) {
        const M = materials(), mats = { terrain: masked(M.terrain), blocks: masked(srgbVertexColours(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }))), landmark_walls: masked(M.walls.block), landmark_roofs: masked(M.roofs) };
        // the sea, out to the horizon (under everything: the land and the tiles' own water sit on it)
        const [bx, bz] = [(Math.min(...tx) + Math.max(...tx) + 1) * T / 2, (Math.min(...tz) + Math.max(...tz) + 1) * T / 2];
        const sea = new THREE.Mesh(new THREE.CircleGeometry(60000, 48).rotateX(-Math.PI / 2), M.water.clone());
        sea.material.opacity = 1;
        sea.material.transparent = false;
        sea.material.depthWrite = true;
        sea.position.set(bx, -0.06, bz);
        sea.renderOrder = -1;
        far.add(sea);
        for (const c of manifest.far?.chunks ?? []) {
            const key = `far_${c.a}_${c.b}`;
            waitingFar++;
            new Promise(resolve => { waiting.set(key, resolve); workers[nextWorker++ % workers.length].postMessage({ type: 'load', key, url: `${base}far/${c.a}_${c.b}.m3t`, version: manifest.version }); }).then((m) => {
                waitingFar--;
                if (m.type !== 'tile')
                    return;
                const g = new THREE.Group();
                g.position.set((c.a + 0.5) * manifest.far.size, 0, (c.b + 0.5) * manifest.far.size);
                for (const [name, mesh] of Object.entries(m.tile.meshes)) {
                    const geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
                    geo.setAttribute('color', new THREE.BufferAttribute(mesh.colours, 4, true));
                    if (mesh.uvs)
                        geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
                    if (mesh.normals)
                        geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
                    else if (name === 'terrain')
                        geo.computeVertexNormals();
                    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
                    geo.computeBoundingSphere();
                    const obj = new THREE.Mesh(geo, mats[name] ?? mats.blocks);
                    obj.name = `far ${name}`;
                    obj.matrixAutoUpdate = false;
                    obj.position.set(0, 0, 0);
                    g.add(obj);
                }
                far.add(g);
            });
        }
    }
    // ---------- tiles ----------
    const tiles = new Map(); // key → { i, j, state, obj, data, physics, queue, added, ... }
    const stats = { loaded: 0, fetched: 0, cached: 0, bytes: 0, loadMs: [], errors: 0, lastError: null, colliders: 0, firstDrivable: null, started: clock() };
    const centreOf = t => [(t.i + 0.5) * T, (t.j + 0.5) * T];
    const distTo = (t, x, z) => { const [cx, cz] = centreOf(t); return Math.hypot(Math.max(0, Math.abs(x - cx) - half), Math.max(0, Math.abs(z - cz) - half)); };
    let physicsQueue = [];
    // ---------- carving: something built set into the ground ----------
    // (its outlines and the built surface's height; the heightfields' points within CARVE_MARGIN of an outline — every
    // cell's corners round it — lowered to under that surface, from the heights as baked: a carving taken away puts them
    // back. A tile's heightfield collider already made is made again.)
    const carvings = new Map(), bakedHeights = new WeakMap(), CARVE_MARGIN = 3, me = {};
    const boxOf = polys => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of polys)
        for (const [x, z] of p) {
            b[0] = Math.min(b[0], x);
            b[1] = Math.min(b[1], z);
            b[2] = Math.max(b[2], x);
            b[3] = Math.max(b[3], z);
        } return b; };
    const touches = (c, e) => !!c && c.box[0] - CARVE_MARGIN < (e.i + 1) * T && c.box[2] + CARVE_MARGIN > e.i * T && c.box[1] - CARVE_MARGIN < (e.j + 1) * T && c.box[3] + CARVE_MARGIN > e.j * T;
    const near = (poly, x, z, r) => {
        let inside = false;
        for (let k = 0, a = poly[poly.length - 1]; k < poly.length; a = poly[k++]) {
            const c = poly[k];
            if ((c[1] > z) !== (a[1] > z) && x < (a[0] - c[0]) * (z - c[1]) / (a[1] - c[1]) + c[0])
                inside = !inside;
            const dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
            if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < r)
                return true;
        }
        return inside;
    };
    // (a tile's heightfield as baked, then every carving touching it: whether it changed)
    function carveTile(e) {
        const hf = e.data?.heightfield;
        if (!hf)
            return false;
        const on = [...carvings.values()].filter(c => touches(c, e));
        let base = bakedHeights.get(e.data);
        if (!base && !on.length)
            return false;
        if (!base)
            bakedHeights.set(e.data, base = hf.heights.slice());
        hf.heights.set(base);
        const N1 = hf.n + 1, cell = T / hf.n, x0 = e.i * T, z0 = e.j * T;
        for (const c of on) {
            const c0 = Math.max(0, Math.floor((c.box[0] - CARVE_MARGIN - x0) / cell)), c1 = Math.min(hf.n, Math.ceil((c.box[2] + CARVE_MARGIN - x0) / cell));
            const r0 = Math.max(0, Math.floor((c.box[1] - CARVE_MARGIN - z0) / cell)), r1 = Math.min(hf.n, Math.ceil((c.box[3] + CARVE_MARGIN - z0) / cell));
            for (let cc = c0; cc <= c1; cc++)
                for (let rr = r0; rr <= r1; rr++) {
                    const x = x0 + cc * cell, z = z0 + rr * cell;
                    if (!c.polys.some(p => near(p, x, z, CARVE_MARGIN)))
                        continue;
                    const y = c.below(x, z);
                    if (y != null)
                        hf.heights[rr + cc * N1] = Math.min(hf.heights[rr + cc * N1], y - 0.15);
                }
        }
        return true;
    }
    // (a tile's car parks, paths and cover — collision on top of the ground — less their triangles touching a carving's
    // outline: what's built there is driven on instead (they're not drawn there either). Roads are kept. In
    // tileColliders' order: the heightfield, then these.)
    const GROUND_MESHES = ['roads', 'paved', 'paths', 'cover'], CARVED_MESHES = new Set(['paved', 'paths', 'cover']);
    const groundOrder = d => { const out = []; let k = d.heightfield ? 1 : 0; for (const n of GROUND_MESHES)
        if (d.meshes[n])
            out.push([n, k++]); return out; };
    const insidePoly = (poly, x, z) => { let c = false; for (let k = 0, a = poly[poly.length - 1]; k < poly.length; a = poly[k++]) {
        const b = poly[k];
        if ((b[1] > z) !== (a[1] > z) && x < (a[0] - b[0]) * (z - b[1]) / (a[1] - b[1]) + b[0])
            c = !c;
    } return c; };
    const crosses = (ax, az, bx, bz, cx, cz, dx, dz) => { const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx), d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax); return d1 * d2 < 0 && d3 * d4 < 0; };
    const touchesPoly = (xs, zs, poly) => {
        for (let q = 0; q < 3; q++)
            if (insidePoly(poly, xs[q], zs[q]))
                return true;
        if (insidePoly(poly, (xs[0] + xs[1] + xs[2]) / 3, (zs[0] + zs[1] + zs[2]) / 3))
            return true;
        for (const [px, pz] of poly)
            if (insidePoly([[xs[0], zs[0]], [xs[1], zs[1]], [xs[2], zs[2]]], px, pz))
                return true;
        for (let k = 0, a = poly[poly.length - 1]; k < poly.length; a = poly[k++])
            for (let q = 0; q < 3; q++)
                if (crosses(a[0], a[1], poly[k][0], poly[k][1], xs[q], zs[q], xs[(q + 1) % 3], zs[(q + 1) % 3]))
                    return true;
        return false;
    };
    function carvedMesh(e, name) {
        const m = e.data.meshes[name], on = [...carvings.values()].filter(c => touches(c, e));
        if (!on.length)
            return null;
        const cx = (e.i + 0.5) * T, cz = (e.j + 0.5) * T, Pp = m.positions, I = m.indices, keep = [];
        let dropped = 0;
        for (let n = 0; n + 2 < I.length; n += 3) {
            const a = I[n] * 3, b = I[n + 1] * 3, c = I[n + 2] * 3, xs = [Pp[a] + cx, Pp[b] + cx, Pp[c] + cx], zs = [Pp[a + 2] + cz, Pp[b + 2] + cz, Pp[c + 2] + cz];
            const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
            if (on.some(cv => x1 >= cv.box[0] && x0 <= cv.box[2] && z1 >= cv.box[1] && z0 <= cv.box[3] && cv.polys.some(p => touchesPoly(xs, zs, p))))
                dropped++;
            else
                keep.push(I[n], I[n + 1], I[n + 2]);
        }
        if (!dropped)
            return null;
        // (none left: one triangle far under the world — a trimesh can't be empty)
        return keep.length ? { desc: RAPIER.ColliderDesc.trimesh(Pp, new Uint32Array(keep)), userData: { material: 'ground' } } : { desc: RAPIER.ColliderDesc.trimesh(new Float32Array([0, -9000, 0, 1, -9000, 0, 0, -9000, 1]), new Uint32Array([0, 1, 2])), userData: { material: 'ground' } };
    }
    // (a tile's ground pieces as the carvings now have them: the heightfield and the carved meshes)
    function groundPiecesNow(e) {
        const d = e.data, out = [], hf = d.heightfield;
        if (hf)
            out.push([0, { desc: RAPIER.ColliderDesc.heightfield(hf.n, hf.n, hf.heights, { x: hf.size, y: 1, z: hf.size }), userData: { material: 'ground' } }]);
        for (const [name, k] of groundOrder(d)) {
            if (!CARVED_MESHES.has(name))
                continue;
            const cut = carvedMesh(e, name);
            if (cut) {
                e.carvedMeshes = (e.carvedMeshes ?? new Set()).add(name);
                out.push([k, cut]);
            }
            else if (e.carvedMeshes?.has(name)) {
                e.carvedMeshes.delete(name);
                const m = d.meshes[name];
                out.push([k, { desc: RAPIER.ColliderDesc.trimesh(m.positions, m.indices), userData: { material: 'ground' } }]);
            }
        }
        return out;
    }
    // (a tile's trees and railings standing inside a carving: their collision swapped for nothing — they're not drawn there
    // either — and back when it goes. Buildings are kept.)
    const hiddenPiece = () => ({ desc: RAPIER.ColliderDesc.ball(0.05).setTranslation(0, -9000, 0), userData: {} });
    const standsIn = (e, piece) => {
        const t = piece.desc.translation, x = t.x + (e.i + 0.5) * T, z = t.z + (e.j + 0.5) * T;
        for (const c of carvings.values())
            if (x >= c.box[0] && x <= c.box[2] && z >= c.box[1] && z <= c.box[3] && c.polys.some(p => insidePoly(p, x, z)))
                return true;
        return false;
    };
    function standingNow(e) {
        const out = [], base = e.basePieces;
        if (!base)
            return out;
        e.hiddenPieces ??= new Set();
        for (let k = e.groundPieces; k < base.length; k++) {
            if (base[k]?.userData?.sound === 'building' || !base[k]?.desc?.translation)
                continue;
            const hide = carvings.size > 0 && standsIn(e, base[k]);
            if (hide === e.hiddenPieces.has(k))
                continue;
            if (hide)
                e.hiddenPieces.add(k);
            else
                e.hiddenPieces.delete(k);
            out.push([k, hide ? hiddenPiece() : base[k]]);
        }
        return out;
    }
    // (its colliders, made already or still to come: made again as the carvings now have them)
    function refreshGround(e) {
        if (!e.data || !e.physics)
            return;
        for (const [k, piece] of [...groundPiecesNow(e), ...standingNow(e)]) {
            if (k < (e.added ?? 0)) {
                if (sim.replaceInStatic)
                    sim.replaceInStatic(e.physics, k, piece);
            }
            else if (e.pieces?.[k])
                e.pieces[k] = piece;
        }
    }
    // (the tyres' surface inside a carving: its own)
    const carvedSurface = (wx, wz) => {
        for (const c of carvings.values()) {
            if (wx < c.box[0] || wx > c.box[2] || wz < c.box[1] || wz > c.box[3])
                continue;
            for (let k = 0; k < c.polys.length; k++)
                if (c.surfaces[k] && insidePoly(c.polys[k], wx, wz))
                    return surfaces.find(s => s.name === c.surfaces[k]) ?? null;
        }
        return null;
    };
    const pushHoles = () => { if (!O.headless)
        setGroundHoles(me, [...carvings.values()].flatMap(c => c.polys), origin); };
    function carve(id, c) {
        const before = carvings.get(id);
        if (c?.polys?.length)
            carvings.set(id, { polys: c.polys, below: c.below, surfaces: c.surfaces ?? [], box: boxOf(c.polys) });
        else
            carvings.delete(id);
        const now = carvings.get(id);
        for (const e of tiles.values())
            if (e.state === 'ready' && (touches(before, e) || touches(now, e)) && carveTile(e))
                refreshGround(e);
        pushHoles();
    }
    function load(t) {
        const key = `${t.i}_${t.j}`, entry = { ...t, key, state: 'loading', obj: null, data: null, physics: null, colliders: 0 };
        tiles.set(key, entry);
        const t0 = clock();
        fetchTile(t).then(m => {
            if (tiles.get(key) !== entry)
                return;
            if (m.type === 'error') {
                stats.errors++;
                stats.lastError = m.error;
                tiles.delete(key);
                failedAt.set(key, clock());
                return;
            }
            entry.data = m.tile;
            entry.state = 'ready';
            carveTile(entry);
            if (!O.headless) {
                entry.obj = tileObjects(m.tile, { barriers: manifest.barriers });
                const [cx, cz] = centreOf(t);
                entry.obj.group.position.set(cx, 0, cz);
                entry.obj.group.updateMatrixWorld(true);
                for (const c of entry.obj.group.children)
                    c.updateMatrix?.();
                world.add(entry.obj.group);
            }
            setMask(entry, true);
            stats.loaded++;
            stats.bytes += m.bytes;
            m.cached ? stats.cached++ : stats.fetched++;
            stats.loadMs.push(clock() - t0);
            if (stats.loadMs.length > 50)
                stats.loadMs.shift();
        });
    }
    function unload(entry) {
        setMask(entry, false);
        dropPhysics(entry);
        entry.obj?.dispose();
        tiles.delete(entry.key);
    }
    // ---------- physics: built a piece at a time ----------
    // the tile's colliders (world/tilePhysics.js), ground and roads first
    function physicsPieces(entry) {
        const { pieces, ground } = tileColliders(entry.data, RAPIER, manifest.barriers);
        entry.groundPieces = ground;
        // (the ground as the carvings have it: the heightfield's already lowered; car parks, paths and cover cut)
        entry.carvedMeshes = null;
        entry.basePieces = pieces.slice();
        entry.hiddenPieces = new Set();
        for (const [k, piece] of groundPiecesNow(entry))
            if (k > 0 || !entry.data.heightfield)
                pieces[k] = piece;
        // (and its trees and railings: none standing inside a carving)
        for (const [k, piece] of standingNow(entry))
            pieces[k] = piece;
        return pieces;
    }
    function wantPhysics(entry) {
        if (entry.physics || entry.state !== 'ready')
            return;
        const [cx, cz] = centreOf(entry);
        entry.physics = sim.addStatic({ position: [cx - origin[0], 0, cz - origin[1]] }, []);
        entry.pieces = physicsPieces(entry);
        entry.added = 0;
        physicsQueue.push(entry);
    }
    function dropPhysics(entry) {
        if (!entry.physics)
            return;
        sim.removeStatic(entry.physics);
        stats.colliders -= entry.added ?? 0;
        entry.physics = null;
        entry.pieces = null;
        entry.added = 0;
        entry.basePieces = null;
        entry.hiddenPieces = null;
        entry.carvedMeshes = null;
        physicsQueue = physicsQueue.filter(e => e !== entry);
    }
    const groundReady = entry => !!entry?.physics && entry.added >= entry.groundPieces;
    const entryAt = (wx, wz) => tiles.get(`${Math.floor(wx / T)}_${Math.floor(wz / T)}`);
    // ---------- the graphics settings (Phase 8 Step 2: perf/quality.js) ----------
    // render distance: how far tiles are loaded (never less than the physics needs: what it drives on is the same on every
    // setting) and how far each tile's detail reaches; scenery: the share of trees drawn
    let detailScale = 1, scenery = 1;
    const RANGE = { loadRadius: O.loadRadius, unloadRadius: O.unloadRadius };
    function setGraphics({ renderDistance = RANGE.loadRadius, scenery: sc = 1 } = {}) {
        detailScale = renderDistance / RANGE.loadRadius;
        O.loadRadius = Math.max(renderDistance, O.physicsDrop + 150);
        O.unloadRadius = Math.max(O.loadRadius * 1.5, O.physicsDrop + 400);
        scenery = sc;
        lastPlan = -Infinity;
    }
    // ---------- each frame ----------
    let lastPlan = -Infinity;
    function update(pos, vel, dt = 1 / 60) {
        const wx = pos[0] + origin[0], wz = pos[2] + origin[1], speed = Math.hypot(vel[0], vel[2]);
        const ax = wx + vel[0] * O.lookAhead, az = wz + vel[2] * O.lookAhead; // (where the car will be soon)
        const now = clock();
        if (now - lastPlan > 200) {
            lastPlan = now;
            // what's wanted, nearest (to now, or to soon) first
            const want = manifest.tiles.map(t => ({ t, d: Math.min(distTo(t, wx, wz), distTo(t, ax, az) * 0.8) })).filter(x => x.d < O.loadRadius).sort((a, b) => a.d - b.d);
            const loading = [...tiles.values()].filter(e => e.state === 'loading').length;
            let room = O.maxLoads - loading;
            for (const { t } of want) {
                if (room <= 0)
                    break;
                const k = `${t.i}_${t.j}`;
                if (!tiles.has(k) && !(now - (failedAt.get(k) ?? -1e9) < 3000)) {
                    load(t);
                    room--;
                }
            }
            for (const e of [...tiles.values()])
                if (e.state === 'ready' && Math.min(distTo(e, wx, wz), distTo(e, ax, az)) > O.unloadRadius)
                    unload(e);
        }
        // physics: near now and near soon (further ahead the faster it goes), dropped once well behind
        const reach = O.physicsRadius + speed * 2;
        for (const e of tiles.values()) {
            if (e.state !== 'ready')
                continue;
            const d = Math.min(distTo(e, wx, wz), distTo(e, ax, az));
            if (d < reach)
                wantPhysics(e);
            else if (d > O.physicsDrop + speed * 2)
                dropPhysics(e);
            e.obj?.setDetail(distTo(e, wx, wz) / detailScale);
            if (e.obj && e.scenery !== scenery) {
                e.obj.setScenery?.(scenery);
                e.scenery = scenery;
            }
        }
        // a few milliseconds of colliders, the car's own tile and those ahead first
        physicsQueue.sort((a, b) => Math.min(distTo(a, wx, wz), distTo(a, ax, az)) - Math.min(distTo(b, wx, wz), distTo(b, ax, az)));
        const end = performance.now() + O.budgetMs;
        while (physicsQueue.length && performance.now() < end) {
            // (every waiting tile's ground and roads before anyone's buildings and railings)
            const e = physicsQueue.find(q => q.physics && q.added < q.groundPieces) ?? physicsQueue[0];
            if (!e.physics) {
                physicsQueue.shift();
                continue;
            }
            const piece = e.pieces[e.added];
            if (piece) {
                sim.addToStatic(e.physics, [piece]);
                e.added++;
                stats.colliders++;
            }
            if (e.added >= e.pieces.length)
                physicsQueue.splice(physicsQueue.indexOf(e), 1);
        }
        // the floating origin: a whole number of tiles, to the car's
        let shifted = null;
        if (Math.hypot(pos[0], pos[2]) > REBASE) {
            const next = [Math.floor(wx / T) * T, Math.floor(wz / T) * T], t = [origin[0] - next[0], 0, origin[1] - next[1]];
            sim.shiftOrigin({ x: 0, y: 0, z: 0, w: 1 }, t);
            origin = next;
            world.position.set(-origin[0], 0, -origin[1]);
            maskUniforms.uOrigin.value.set(origin[0], origin[1]);
            if (!O.headless && groundHolesOwner() === me)
                setGroundHoleOrigin(origin);
            shifted = t;
        }
        // (the ground's holes: this world's, while it's the one being driven)
        if (!O.headless && groundHolesOwner() !== me)
            pushHoles();
        return { shifted };
    }
    // Where the player may go next (a quest's start on its card, a fast-travel target): the tiles within radiusM of it
    // (the world frame) fetched into the workers' cache now — nothing decoded or drawn — nearest first
    const prefetched = new Set();
    function prefetch(wx, wz, radiusM = 600) {
        if (O.loadTile || !workers.length)
            return 0;
        const urls = manifest.tiles.map(t => ({ t, d: distTo(t, wx, wz) })).filter(x => x.d < radiusM && !tiles.has(`${x.t.i}_${x.t.j}`)).sort((a, b) => a.d - b.d)
            .map(({ t }) => `${base}tiles/${t.i}_${t.j}.m3t`).filter(u => !prefetched.has(u));
        if (!urls.length)
            return 0;
        for (const u of urls)
            prefetched.add(u);
        workers[workers.length - 1].postMessage({ type: 'prefetch', urls, version: manifest.version });
        return urls.length;
    }
    return {
        manifest, projection: P, world, stats, update, setGraphics, prefetch, carve,
        get origin() { return origin; },
        toWorld: (x, z) => [x + origin[0], z + origin[1]],
        toSim: (x, z) => [x - origin[0], z - origin[1]],
        // is there solid ground (terrain, roads) everywhere within r m of a place (sim frame)?
        readyAround(x, z, r = 0) {
            const wx = x + origin[0], wz = z + origin[1];
            for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
                const e = entryAt(wx + dx, wz + dz);
                if (!e) {
                    if (!byKey.has(`${Math.floor((wx + dx) / T)}_${Math.floor((wz + dz) / T)}`))
                        continue;
                    return false;
                }
                if (!groundReady(e))
                    return false;
            }
            return true;
        },
        // the ground's height there (sim frame; the tile's heightfield, bilinear), null where it isn't in yet
        heightAt(x, z) {
            const wx = x + origin[0], wz = z + origin[1], e = entryAt(wx, wz), hf = e?.data?.heightfield;
            if (!hf)
                return null;
            const N1 = hf.n + 1, cell = T / hf.n, fc = Math.min(hf.n - 1e-6, Math.max(0, (wx - e.i * T) / cell)), fr = Math.min(hf.n - 1e-6, Math.max(0, (wz - e.j * T) / cell));
            const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r, H = hf.heights, h = (cc, rr) => H[rr + cc * N1];
            return (h(c, r) * (1 - tx) + h(c + 1, r) * tx) * (1 - tz) + (h(c, r + 1) * (1 - tx) + h(c + 1, r + 1) * tx) * tz;
        },
        // tyre grip there: { name, grip, rollingResistance, … }
        surfaceAt(x, z) {
            const wx = x + origin[0], wz = z + origin[1], carved = carvings.size ? carvedSurface(wx, wz) : null;
            if (carved)
                return carved;
            const e = entryAt(wx, wz), G = e?.data?.grids.surface;
            if (!G)
                return surfaces[0];
            const lx = wx - (e.i * T), lz = wz - (e.j * T), c = Math.min(G.n - 1, Math.max(0, Math.floor(lx / G.cell))), r = Math.min(G.n - 1, Math.max(0, Math.floor(lz / G.cell)));
            const name = G.names[G.data[r * G.n + c]];
            return surfaces.find(s => s.name === name) ?? surfaces[0];
        },
        // where a place is, for the HUD: its tile, the elevation data there, the nearest named road
        where(x, z) {
            const wx = x + origin[0], wz = z + origin[1], e = entryAt(wx, wz), out = { tile: [Math.floor(wx / T), Math.floor(wz / T)], dem: e?.data?.header.dem ?? null, road: null, segment: null, latLon: P.toLatLon(wx, wz) };
            // (the nearest road piece within 25 m: the tile's road list, [ax, az, bx, bz, name, rank, segment])
            const S = e?.data?.lists.roads?.data, names = e?.data?.header.names;
            if (S) {
                let best = 25;
                const lx = wx - (e.i + 0.5) * T, lz = wz - (e.j + 0.5) * T;
                for (let k = 0; k < S.length; k += 7) {
                    if (S[k + 4] < 0)
                        continue;
                    const ax = S[k], az = S[k + 1], dx = S[k + 2] - ax, dz = S[k + 3] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / l2)), d = Math.hypot(lx - ax - dx * t, lz - az - dz * t);
                    if (d < best) {
                        best = d;
                        out.road = names[S[k + 4]];
                        out.segment = Math.round(S[k + 6]);
                    }
                }
            }
            return out;
        },
        // the first solid surface below a point (sim frame), or null
        groundBelow(x, z, fromY, reach = 600) {
            const hit = sim.vehicle.world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), reach, true, undefined, undefined, undefined, sim.vehicle.body);
            return hit ? fromY - hit.timeOfImpact : null;
        },
        get status() {
            const list = [...tiles.values()], ms = stats.loadMs.slice().sort((a, b) => a - b);
            return { tiles: list.filter(e => e.state === 'ready').length, loading: list.filter(e => e.state === 'loading').length, physics: list.filter(e => e.physics).length, building: physicsQueue.length,
                colliders: stats.colliders, bytes: stats.bytes, fetched: stats.fetched, cached: stats.cached, tileMs: ms.length ? ms[ms.length >> 1] : null, errors: stats.errors, lastError: stats.lastError };
        },
        // the tiles in the physics (the tests)
        get tiles() { return tiles; },
        dispose() { for (const e of [...tiles.values()])
            unload(e); for (const w of workers)
            w.terminate(); world.removeFromParent(); },
    };
}
