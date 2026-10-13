// Map v4's debug views and bad-spot tools (MAP_README.md, "Debug views"), on the streamed world:
//   colliders   every physics collider near the car as a wireframe, by kind: terrain green, road white,
//               building orange, barrier red, tree brown, anything else magenta (drawn from the very pieces the
//               physics holds: map/render/physics.ts)
//   roads       the road surface model (v4 tiles): road edges coloured by class, junction patches cyan, trim
//               points, bridges yellow and tunnels purple
//   mask        the exclusion mask (v4 tiles): what keeps trees and props off roads, bridges and under decks
//   lamps       street lamps (v4 tiles): mapped (OSM) white, estimated orange, the nearest-N real lights ringed
//   seams       tile borders, and any height or road-edge mismatch where two loaded tiles meet (red)
// Shift+F3 cycles them. Shift+F4 logs a bad spot (position, heading, tile, a note) to known-bad-spots.json —
// written into data/map/ through the dev server when there is one, else kept in the browser (Shift+F4 offers the
// file to save). Shift+F2 takes the car to the next saved bad spot (and data/map/known-bad-spots.json's).
//
//   const D = createMapDebug(w)   D.frame()   D.view (name)   D.cycle()   D.logBadSpot(note)   D.nextBadSpot()

import * as THREE from 'three';

export const VIEWS = ['off', 'colliders', 'roads', 'mask', 'lamps', 'seams'];
const KIND_COLOUR: Record<string, number> = { terrain: 0x3fbf3f, road: 0xf0f0f0, building: 0xff9a2e, barrier: 0xff3030, tree: 0x9a5b2a, other: 0xff40ff };
const CLASS_COLOUR: Record<string, number> = { motorway: 0xe0457b, trunk: 0xf08a3c, primary: 0xf2c94c, secondary: 0x9be15d, tertiary: 0x4fd1c5, residential: 0xf5f5f5, unclassified: 0xc0c0c0, service: 0x8a8a8a, living_street: 0xd0b0ff, track: 0xa07850 };
const BAD_KEY = 'map.knownBadSpots';

// a piece's wireframe (tile-local line segments)
export function pieceLines(shape: any, out: number[], near: ((x: number, z: number) => boolean) | null = null) {
  const L = (a: number[], b: number[]) => out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  if (!shape) return;
  if (shape.type === 'trimesh') {
    const P = shape.positions, I = shape.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      if (near && !near(P[a], P[a + 2])) continue;
      out.push(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], P[c], P[c + 1], P[c + 2], P[a], P[a + 1], P[a + 2]);
    }
  } else if (shape.type === 'heightfield') {
    // (every other row and column: a 4 m grid, near the car)
    const hf = shape.hf, n = hf.n, N1 = n + 1, cell = hf.size / n, half = hf.size / 2, H = hf.heights, every = 2;
    const at = (c: number, r: number) => [-half + c * cell, H[r + c * N1], -half + r * cell];
    for (let c = 0; c <= n; c += every) for (let r = 0; r + every <= n; r += every) { const a = at(c, r); if (near && !near(a[0], a[2])) continue; L(a, at(c, r + every)); }
    for (let r = 0; r <= n; r += every) for (let c = 0; c + every <= n; c += every) { const a = at(c, r); if (near && !near(a[0], a[2])) continue; L(a, at(c + every, r)); }
  } else if (shape.type === 'prism') {
    const p = shape.points, n = p.length / 6;
    for (let q = 0; q < n; q++) { const a = [p[q * 6], p[q * 6 + 1], p[q * 6 + 2]], b = [p[q * 6 + 3], p[q * 6 + 4], p[q * 6 + 5]], q2 = (q + 1) % n, c = [p[q2 * 6], p[q2 * 6 + 1], p[q2 * 6 + 2]], d = [p[q2 * 6 + 3], p[q2 * 6 + 4], p[q2 * 6 + 5]]; L(a, b); L(a, c); L(b, d); }
  } else if (shape.type === 'box') {
    const [hx, hy, hz] = shape.halfExtents, q = new THREE.Quaternion(shape.rotation.x, shape.rotation.y, shape.rotation.z, shape.rotation.w), c = new THREE.Vector3(...shape.centre);
    const v = [-1, 1].flatMap(sx => [-1, 1].flatMap(sy => [-1, 1].map(sz => new THREE.Vector3(sx * hx, sy * hy, sz * hz).applyQuaternion(q).add(c).toArray())));
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) L(v[a], v[b]);
  } else if (shape.type === 'cylinder') {
    const [x, y, z] = shape.centre, r = shape.radius, h = shape.half, n = 8;
    for (let k = 0; k < n; k++) {
      const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
      for (const yy of [y - h, y + h]) L([x + Math.cos(a0) * r, yy, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, yy, z + Math.sin(a1) * r]);
      if (k % 2 === 0) L([x + Math.cos(a0) * r, y - h, z + Math.sin(a0) * r], [x + Math.cos(a0) * r, y + h, z + Math.sin(a0) * r]);
    }
  }
}

function lineMesh(groups: Map<number, number[]>, opacity = 1) {
  const g = new THREE.Group();
  for (const [colour, pts] of groups) {
    if (!pts.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity, depthTest: true }));
    m.renderOrder = 10; m.frustumCulled = false;
    g.add(m);
  }
  return g;
}
const disposeGroup = (g: any) => g?.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });

export function createMapDebug(w: any, { travelTo }: { travelTo: (w: any, place: any) => void }) {
  let view = 'off', built = new Map<string, any>(), lastKey = '', timer = 0, spotIndex = -1;
  const S = w.stream, T = S.manifest.grid.tileSize, holder = new THREE.Group();
  holder.name = 'map debug';
  S.world.add(holder);
  const note = document.createElement('div');
  note.style.cssText = 'position:fixed;left:8px;bottom:28px;z-index:40;font:600 11px/1.4 "JetBrains Mono",monospace;color:#fff;background:rgba(80,20,90,.75);padding:2px 9px;border-radius:9px;pointer-events:none;display:none';
  document.body.appendChild(note);

  const clear = () => { for (const g of built.values()) { disposeGroup(g); g.removeFromParent(); } built.clear(); };
  // one tile's drawing for the view on
  function buildTile(e: any) {
    const g = new THREE.Group(), d = e.data;
    g.position.set((e.i + 0.5) * T, 0, (e.j + 0.5) * T);
    const by = new Map<number, number[]>(), put = (c: number) => by.get(c) ?? by.set(c, []).get(c)!;
    if (view === 'colliders') {
      // (the pieces the physics holds now; roads and the heightfield only near the car — they're big)
      const car = S.toWorld(...(() => { const p = w.sim.vehicle.body.translation(); return [p.x, p.z]; })()), cx = (e.i + 0.5) * T, cz = (e.j + 0.5) * T;
      const near = (x: number, z: number) => Math.hypot(x + cx - car[0], z + cz - car[1]) < 160;
      for (const p of (e.pieces ?? []).slice(0, e.added ?? 0)) pieceLines(p.shape, put(KIND_COLOUR[p.userData?.kind] ?? KIND_COLOUR.other), p.shape?.type === 'heightfield' || p.shape?.type === 'trimesh' ? near : null);
    } else if (view === 'roads' && d.lists.roadEdges) {
      // [ax, ay, az, bx, by, bz, classIndex, kind] per edge piece (kind: 0 road edge, 1 junction patch, 2 trim, 3 bridge, 4 tunnel)
      const E = d.lists.roadEdges.data, classes = d.header.roadClasses ?? [];
      for (let k = 0; k < E.length; k += 8) {
        const kind = E[k + 7], colour = kind === 1 ? 0x30e0ff : kind === 2 ? 0xff40ff : kind === 3 ? 0xffe000 : kind === 4 ? 0xa060ff : CLASS_COLOUR[classes[E[k + 6]]] ?? 0xffffff;
        put(colour).push(E[k], E[k + 1] + 0.08, E[k + 2], E[k + 3], E[k + 4] + 0.08, E[k + 5]);
      }
    } else if (view === 'mask' && d.grids.exclusion) {
      // (each masked cell's outline, at the ground)
      const G = d.grids.exclusion, n = G.n, cell = G.cell, half = T / 2, hf = d.heightfield;
      const groundAt = (x: number, z: number) => { if (!hf) return 0; const N1 = hf.n + 1, c = Math.min(hf.n, Math.max(0, Math.round((x + half) / (T / hf.n)))), r = Math.min(hf.n, Math.max(0, Math.round((z + half) / (T / hf.n)))); return hf.heights[r + c * N1]; };
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const v = G.data[r * n + c];
        if (!v) continue;
        const x = -half + (c + 0.5) * cell, z = -half + (r + 0.5) * cell, y = groundAt(x, z) + 0.15, s = cell * 0.42;
        const colour = v === 2 ? 0xffe000 : v === 3 ? 0x30a0ff : 0xff3030;      // 1 road, 2 under a deck, 3 railway / other
        put(colour).push(x - s, y, z - s, x + s, y, z + s, x - s, y, z + s, x + s, y, z - s);
      }
    } else if (view === 'lamps' && d.lists.lamps) {
      const Lp = d.lists.lamps.data, st = d.lists.lamps.stride;
      for (let k = 0; k < Lp.length; k += st) {
        const x = Lp[k], y = Lp[k + 1], z = Lp[k + 2], h = Lp[k + 3], est = Lp[k + 5] & 1;
        const c = put(est ? 0xffa030 : 0xffffff);
        c.push(x, y, z, x, y + h, z);
        for (let a = 0; a < 6; a++) { const a0 = a / 6 * Math.PI * 2, a1 = (a + 1) / 6 * Math.PI * 2; c.push(x + Math.cos(a0) * 0.6, y + h, z + Math.sin(a0) * 0.6, x + Math.cos(a1) * 0.6, y + h, z + Math.sin(a1) * 0.6); }
      }
    } else if (view === 'seams') {
      // the tile's border, at the heights of its own edge, and red where a loaded neighbour's edge differs
      const hf = d.heightfield;
      if (hf) {
        const n = hf.n, N1 = n + 1, cell = T / n, half = T / 2, H = hf.heights;
        const edge = (side: number, q: number) => side === 0 ? [0, q] : side === 1 ? [n, q] : side === 2 ? [q, 0] : [q, n];
        const nb = [S.tiles.get(`${e.i - 1}_${e.j}`), S.tiles.get(`${e.i + 1}_${e.j}`), S.tiles.get(`${e.i}_${e.j - 1}`), S.tiles.get(`${e.i}_${e.j + 1}`)];
        for (let side = 0; side < 4; side++) {
          const o = nb[side]?.data?.heightfield;
          for (let q = 0; q < n; q++) {
            const [c0, r0] = edge(side, q), [c1, r1] = edge(side, q + 1);
            const a = [-half + c0 * cell, H[r0 + c0 * N1] + 0.1, -half + r0 * cell], b = [-half + c1 * cell, H[r1 + c1 * N1] + 0.1, -half + r1 * cell];
            let bad = false;
            if (o) { const [oc0, or0] = edge(side ^ 1, q); bad = Math.abs(o.heights[or0 + oc0 * N1] - H[r0 + c0 * N1]) > 0.005; }
            put(bad ? 0xff2020 : 0x40ffff).push(...a, ...b);
          }
        }
      }
      // (v4: the road edge vertices on the border, matched against the neighbour's)
      const B = d.lists.roadBorder?.data;
      if (B) for (let k = 0; k < B.length; k += 4) { const [x, y, z, ok] = [B[k], B[k + 1], B[k + 2], B[k + 3]]; put(ok ? 0x40ff40 : 0xff2020).push(x, y, z, x, y + 1.5, z); }
    }
    const lines = lineMesh(by);
    g.add(lines);
    return g;
  }
  function frame(dt = 1 / 60) {
    if (view === 'off') return;
    timer -= dt;
    // (rebuilt when the tiles near the car change, or every few seconds for the colliders — they come in a few a frame)
    const p = w.sim.vehicle.body.translation(), [wx, wz] = S.toWorld(p.x, p.z), near = [...S.tiles.values()].filter((e: any) => e.state === 'ready' && Math.hypot(Math.max(0, Math.abs(wx - (e.i + 0.5) * T) - T / 2), Math.max(0, Math.abs(wz - (e.j + 0.5) * T) - T / 2)) < (view === 'colliders' ? 200 : 400));
    const key = `${view}|${near.map((e: any) => `${e.key}:${e.added ?? 0}`).join(',')}|${view === 'colliders' ? `${Math.round(wx / 60)},${Math.round(wz / 60)}` : ''}`;
    if (key === lastKey && timer > 0) return;
    lastKey = key; timer = 3;
    clear();
    for (const e of near) { const g = buildTile(e); holder.add(g); built.set(e.key, g); }
  }
  function setView(v: string) {
    view = v; lastKey = ''; clear();
    note.style.display = v === 'off' ? 'none' : 'block';
    note.textContent = `debug view: ${v} (Shift+F3)${v === 'colliders' ? ' · terrain green · road white · building orange · barrier red · tree brown · other magenta' : v === 'lamps' ? ' · mapped white · estimated orange' : v === 'mask' ? ' · road red · under a deck yellow · railway blue' : v === 'seams' ? ' · matched cyan/green · mismatch red' : ''}`;
  }

  // ---------- bad spots ----------
  const local = () => { try { return JSON.parse(localStorage.getItem(BAD_KEY) ?? '[]'); } catch { return []; } };
  const devServer = () => ['localhost', '127.0.0.1'].includes(location.hostname);
  async function fileSpots() { try { const r = await fetch('data/map/known-bad-spots.json', { cache: 'no-cache' }); return r.ok ? (await r.json()).spots ?? [] : []; } catch { return []; } }
  async function logBadSpot(text: string | null = null) {
    const p = w.sim.vehicle.body.translation(), q = w.sim.vehicle.body.rotation(), [wx, wz] = S.toWorld(p.x, p.z), where = S.where(p.x, p.z);
    const heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180 / Math.PI, bearing = ((180 - heading) % 360 + 360) % 360;
    const note = text ?? globalThis.prompt?.('What is wrong here? (a short note)') ?? '';
    const [lat, lon] = S.projection.toLatLon(wx, wz);
    const spot = { region: S.manifest.region, map: S.manifest.map ?? 'v3', roads: S.manifest.roadModel?.version ?? null, lat: +lat.toFixed(7), lon: +lon.toFixed(7), xz: [+wx.toFixed(2), +wz.toFixed(2)], y: +p.y.toFixed(2), bearing: +bearing.toFixed(1), tile: `${where.tile[0]}_${where.tile[1]}`, road: where.road ?? null, note, at: new Date().toISOString() };
    const mine = [...local(), spot];
    try { localStorage.setItem(BAD_KEY, JSON.stringify(mine)); } catch { /* not kept */ }
    let saved = false;
    if (devServer()) {
      // (the dev server writes data/map/known-bad-spots.json: npm start)
      const all = await fileSpots();
      const body = { _note: 'Known bad spots on the map (MAP_README.md, "Bad spots"): logged in the game with Shift+F4, replayed with Shift+F2, driven through by the regression test (npm run test:map -- --only badspots).', spots: [...all, spot] };
      try { const r = await fetch('data/map/known-bad-spots.json', { method: 'PUT', body: JSON.stringify(body, null, 1) }); saved = r.ok; } catch { /* no dev server */ }
    }
    flash(saved ? `Bad spot saved to data/map/known-bad-spots.json (${spot.road ?? spot.tile})` : `Bad spot kept in this browser (${mine.length}): Shift+F4 twice quickly to save the file`);
    return spot;
  }
  let lastLog = 0;
  function download() {
    const blob = new Blob([JSON.stringify({ spots: local() }, null, 1)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'known-bad-spots.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function nextBadSpot() {
    const all = [...await fileSpots(), ...local()].filter((s: any) => !s.region || s.region === S.manifest.region);
    if (!all.length) { flash('No bad spots saved for this region'); return null; }
    spotIndex = (spotIndex + 1) % all.length;
    const s = all[spotIndex];
    travelTo(w, { xz: s.xz, heading: s.bearing != null ? 180 - s.bearing : undefined });
    flash(`Bad spot ${spotIndex + 1}/${all.length}: ${s.note || s.road || s.tile}`);
    return s;
  }
  function flash(t: string) { w.flashNote?.(t) ?? console.log(t); note.style.display = 'block'; note.textContent = t; setTimeout(() => setView(view), 3500); }

  const onKey = (e: KeyboardEvent) => {
    if (!e.shiftKey || (e.target as any)?.tagName === 'INPUT' || !w.shown) return;
    if (e.code === 'F3') { e.preventDefault(); e.stopImmediatePropagation(); setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]); }
    else if (e.code === 'F4') { e.preventDefault(); e.stopImmediatePropagation(); const now = performance.now(); if (now - lastLog < 600) download(); else logBadSpot(); lastLog = now; }
    else if (e.code === 'F2') { e.preventDefault(); e.stopImmediatePropagation(); nextBadSpot(); }
  };
  addEventListener('keydown', onKey, true);
  return {
    frame, cycle: () => setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]), setView, logBadSpot, nextBadSpot, download,
    get view() { return view; }, get spots() { return local(); },
    dispose() { clear(); holder.removeFromParent(); note.remove(); removeEventListener('keydown', onKey, true); },
  };
}
