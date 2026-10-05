// A dressed track drawn (Phase 5 Step 2): its kerbs, barriers, catch fencing, the start gantry and its
// lights, the timing tower, the pits, signs and advertising, grandstands and their crowds, marshal posts,
// light towers, buildings, trees, rocks, the footbridge, and a backdrop beyond the ground (hills,
// mountains, mesas, the sea, a skyline) so the world doesn't end at its edge. Made from track/build2.js's
// data — the barriers from the very pieces their colliders are (map/build/format/barriers.js).
//
// Few draw calls: everything repeated is one InstancedMesh (a barrier type's pieces, a tree kind, rocks,
// posts); everything else of a kind merged into one mesh with its colours in its vertices (one shared
// palette material) or one texture atlas (the advertising, the signs). Levels of detail: trees near the
// camera are drawn fully, further off as a simple shape; a grandstand's crowd only from near enough.
//
//   const R = dressMeshes(THREE, data, { spectators: 'high' | 'low' | 'off' })
//   R.group (world frame) · R.layers: { kerbs, barriers, scenery, start, pits, signs, crowd, backdrop } (THREE.Group each)
//   R.update(camera)  each frame (levels of detail)      R.setLights({ red, green })  (track/lights.js)
//   R.stats() → { drawCalls, triangles, instances }      R.dispose()
//   themeEnvironment(look, { time, weather, conditions, closed }) → { sky, fog, sun, hemi, hours, warm, sunScale, grey, rain, wet, grip, floodlit, night }
//   eventConditions(quest.conditions, look, conditions) → { time, weather }   R.setNight(on) (floodlights: lamps lit, masts shown)

import { quatYawPitch } from '../map/build/format/barriers.js';
import { PIT } from './gen/v2.js';

const TAU = Math.PI * 2;
const HOURS = { morning: 9.5, midday: 13, afternoon: 15.5, evening: 17.2 };
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const rand = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// look: a theme's; time / weather: the event's (else the theme's own); conditions: data/tracks.json conditions
export function themeEnvironment(look, { time = null, weather = null, conditions = null, closed = true } = {}) {
  const el = (look.sun?.elevation ?? 40) * Math.PI / 180, az = (look.sun?.azimuth ?? 200) * Math.PI / 180;
  const tm = time ?? look.time, wx = weather ?? look.weather, Ct = conditions?.times?.[tm], W = conditions?.weather?.[wx];
  const fogScale = W?.fogScale ?? (wx === 'hazy' ? 0.7 : 1);
  const night = tm === 'night', floodlit = closed && (night || tm === 'dusk') && !!conditions?.floodlit;
  return {
    sky: look.sky, horizon: look.horizon ?? look.sky,
    fog: { colour: look.horizon ?? look.sky, near: (look.fog?.[0] ?? 600) * fogScale, far: (look.fog?.[1] ?? 3000) * fogScale },
    sun: { dir: [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)], colour: look.sun?.colour ?? '#ffffff', intensity: look.sun?.intensity ?? 1.8 },
    hemi: { sky: look.hemi?.[0] ?? '#ffffff', ground: look.hemi?.[1] ?? '#556655', intensity: look.hemi?.[2] ?? 1.1 },
    // (the game's day, effects/lighting.js: the hour the time of day is; its weather: the sun dimmer and the
    // sky greyer under cloud and rain, the fog nearer in haze and fog; dawn and dusk warmer)
    time: tm, hours: Ct?.hours ?? HOURS[tm] ?? 13, warm: Ct?.warm ?? 0, weather: wx,
    sunScale: W?.sunScale ?? (wx === 'overcast' ? 0.55 : wx === 'hazy' ? 0.85 : 1), grey: W?.grey ?? (wx === 'overcast' ? 0.45 : wx === 'hazy' ? 0.2 : 0),
    rain: W?.rain ?? 0, wet: !!W?.wet, grip: W?.grip ?? 1, applyGrip: !!conditions?.applyGrip,
    floodlit: floodlit ? conditions.floodlit : null, night,
  };
}
// An event's conditions (quest conditions: timeOfDay any / dawn / day / dusk / night, weather any / clear /
// cloudy / rain / fog) as a theme's time of day and weather (null: the theme's own)
export function eventConditions(q, look, conditions) {
  const t = q?.timeOfDay && q.timeOfDay !== 'any' ? (conditions?.event?.[q.timeOfDay] ?? null) : null;
  const time = q?.timeOfDay === 'day' ? (['dawn', 'dusk', 'night'].includes(look.time) ? 'midday' : look.time) : t;
  const weather = q?.weather && q.weather !== 'any' ? q.weather : null;
  return { time, weather };
}

export function dressMeshes(THREE, D, { spectators = 'high', floodMasts = true } = {}) {
  const look = D.look, root = new THREE.Group(); root.name = 'track-dressing';
  const layers = {};
  for (const k of ['kerbs', 'barriers', 'scenery', 'start', 'pits', 'signs', 'crowd', 'backdrop']) { const g = new THREE.Group(); g.name = `dress-${k}`; layers[k] = g; root.add(g); }
  const palette = new THREE.MeshLambertMaterial({ vertexColors: true });
  const disposables = [palette], updaters = [];
  const C = new THREE.Color(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();
  const rnd = rand(hash(D.dressHash ?? D.code));
  const pick = list => list[Math.floor(rnd() * list.length)];

  // ---------- merging: parts (a geometry, where, a colour) into one coloured mesh ----------
  const merge = parts => {
    let nv = 0, ni = 0;
    for (const p of parts) { nv += p.geo.attributes.position.count; ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ind = new Uint32Array(ni);
    let v = 0, k = 0;
    const nm = new THREE.Matrix3();
    for (const p of parts) {
      const g = p.geo, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, m = p.matrix;
      nm.getNormalMatrix(m);
      C.set(p.colour ?? '#ffffff');
      for (let i = 0; i < P.count; i++) {
        V.fromBufferAttribute(P, i).applyMatrix4(m); pos.set([V.x, V.y, V.z], (v + i) * 3);
        V.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([V.x, V.y, V.z], (v + i) * 3);
        col.set([C.r, C.g, C.b], (v + i) * 3);
        if (U) { const [u0, v0, u1, v1] = p.uv ?? [0, 0, 1, 1]; uv.set([u0 + U.getX(i) * (u1 - u0), v0 + U.getY(i) * (v1 - v0)], (v + i) * 2); }
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) ind[k++] = g.index.getX(i) + v; else for (let i = 0; i < P.count; i++) ind[k++] = i + v;
      v += P.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(ind, 1));
    out.computeBoundingSphere();
    return out;
  };
  const mat = (x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0) => new THREE.Matrix4().compose(V.set(x, y, z).clone(), Q.setFromEuler(E.set(pitch, yaw, 0, 'YXZ')).clone(), S.set(sx, sy, sz).clone());
  const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8), CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6), CONE = new THREE.ConeGeometry(0.5, 1, 7), ICO = new THREE.IcosahedronGeometry(0.5, 0), DOD = new THREE.DodecahedronGeometry(0.5, 0);
  disposables.push(BOX, CYL, CYL6, CONE, ICO, DOD);
  const addMesh = (layer, geo, material = palette, { shadow = false, name } = {}) => { const m = new THREE.Mesh(geo, material); m.castShadow = shadow; m.receiveShadow = true; if (name) m.name = name; layers[layer].add(m); disposables.push(geo); return m; };
  const addInstanced = (layer, geo, material, mats, colours = null, { shadow = false, name } = {}) => {
    if (!mats.length) return null;
    const m = new THREE.InstancedMesh(geo, material, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    if (colours) colours.forEach((c, i) => m.setColorAt(i, C.set(c)));
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere?.();
    m.castShadow = shadow; m.receiveShadow = true; if (name) m.name = name;
    layers[layer].add(m); disposables.push(geo);
    return m;
  };
  const yawOf = o => Math.atan2(o.fx ?? 0, o.fz ?? 1);

  // ---------- kerbs ----------
  if (D.kerbs?.render?.indices?.length) {
    const g = new THREE.BufferGeometry(), K = D.kerbs.render;
    g.setAttribute('position', new THREE.BufferAttribute(K.positions, 3)); g.setAttribute('color', new THREE.BufferAttribute(K.colours, 3, true)); g.setIndex(new THREE.BufferAttribute(K.indices, 1)); g.computeVertexNormals();
    const km = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    disposables.push(km); addMesh('kerbs', g, km, { name: 'kerbs' });
  }

  // ---------- barriers: each type's pieces instanced (the pieces their colliders are) ----------
  const BT = D.barriers?.cfg?.types ?? {};
  const byType = {};
  for (const run of D.barriers?.runs ?? []) for (let k = 0; k + 6 < run.pieces.length; k += 7) (byType[run.type] ??= []).push(run.pieces.subarray(k, k + 7));
  const pieceMat = (p, up, h, thick, extraLen = 0) => {
    const [x0, y0, z0, x1, y1, z1] = p, dx = x1 - x0, dz = z1 - z0, flat = Math.hypot(dx, dz), len = Math.hypot(flat, y1 - y0);
    const q = quatYawPitch(Math.atan2(-dz, dx), Math.atan2(y1 - y0, flat));
    return new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2 + up, (z0 + z1) / 2), new THREE.Quaternion(q.x, q.y, q.z, q.w), new THREE.Vector3(len + extraLen, h, thick));
  };
  const metal = new THREE.MeshLambertMaterial({ color: BT.armco?.colour ?? '#b9bec2' }); disposables.push(metal);
  if (byType.armco || byType.tyres) {
    // (a tyre wall stands in front of a rail: the rail drawn behind it too)
    const all = [...(byType.armco ?? []), ...(byType.tyres ?? [])];
    addInstanced('barriers', BOX.clone(), metal, all.flatMap(p => [pieceMat(p, 0.62, 0.32, 0.1, 0.05), pieceMat(p, 0.32, 0.08, 0.06, 0.05)]), null, { name: 'armco' });
    const posts = [];
    for (const p of all) posts.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1] + 0.4, p[2]), new THREE.Quaternion(), new THREE.Vector3(0.12, 0.9, 0.12)));
    addInstanced('barriers', BOX.clone(), metal, posts, null, { name: 'armco posts' });
  }
  for (const [type, colour] of [['concrete', BT.concrete?.colour], ['pitwall', BT.pitwall?.colour]]) {
    if (!byType[type]) continue;
    const m = new THREE.MeshLambertMaterial({ color: colour ?? '#c9c6bd' }); disposables.push(m);
    addInstanced('barriers', BOX.clone(), m, byType[type].map(p => pieceMat(p, BT[type].height / 2, BT[type].height, BT[type].thickness, 0.02)), null, { name: type, shadow: true });
  }
  if (byType.tyres) {
    // stacks of three tyres, two deep, every 0.66 m; a painted band every few stacks
    const parts = [];
    for (const dz of [-0.3, 0.3]) for (let s = 0; s < 3; s++) parts.push({ geo: CYL6, matrix: mat(0, 0.13 + s * 0.27, dz, 0, 0.64, 0.25, 0.64), colour: '#ffffff' });
    const stack = merge(parts), mats = [], cols = [], where = [];
    for (const p of byType.tyres) {
      const [x0, y0, z0, x1, y1, z1] = p, dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx) + Math.PI / 2;
      for (let a = 0.33; a < len; a += 0.66) { const t = a / len; mats.push(mat(x0 + dx * t, y0 + (y1 - y0) * t, z0 + dz * t, yaw)); where.push([x0 + dx * t, z0 + dz * t]); cols.push(rnd() < 0.18 ? (rnd() < 0.5 ? '#d8d8d4' : '#c23b2e') : '#202022'); }
    }
    // (near the camera every tyre; further off, the wall as one dark block a piece)
    const near = addInstanced('barriers', stack, palette, mats, cols, { name: 'tyre walls' });
    const blockM = new THREE.MeshLambertMaterial({ color: '#1d1d1f' }); disposables.push(blockM);
    addInstanced('barriers', BOX.clone(), blockM, byType.tyres.map(p => pieceMat(p, 0.36, 0.72, 1.0, -0.1)), null, { name: 'tyre walls far' });
    let last = null;
    updaters.push(cam => {
      if (last && (cam.position.x - last[0]) ** 2 + (cam.position.z - last[1]) ** 2 < 20 * 20) return;
      last = [cam.position.x, cam.position.z];
      let a = 0;
      for (let i = 0; i < where.length; i++) if ((where[i][0] - last[0]) ** 2 + (where[i][1] - last[1]) ** 2 < 220 * 220) { near.setMatrixAt(a, mats[i]); near.setColorAt(a++, C.set(cols[i])); }
      near.count = a; near.instanceMatrix.needsUpdate = true; near.instanceColor.needsUpdate = true;
    });
  }
  // catch fencing: posts, a top rail, and see-through mesh between
  if (D.barriers?.fences?.length) {
    const F = D.barriers.cfg.fence, H = F.height, posts = [], quadsP = [], quadsUV = [], idx = [];
    for (const f of D.barriers.fences) {
      let carry = 0;
      for (let k = 0; k + 5 < f.length; k += 3) {
        const x0 = f[k], y0 = f[k + 1] + 0.9, z0 = f[k + 2], x1 = f[k + 3], y1 = f[k + 4] + 0.9, z1 = f[k + 5], len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.01) continue;
        const b = quadsP.length / 3;
        quadsP.push(x0, y0, z0, x1, y1, z1, x1, y1 + H, z1, x0, y0 + H, z0);
        quadsUV.push(carry, 0, carry + len, 0, carry + len, H, carry, H);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        for (let a = (F.post - carry % F.post) % F.post; a < len; a += F.post) { const t = a / len; posts.push(new THREE.Matrix4().compose(new THREE.Vector3(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + H / 2, z0 + (z1 - z0) * t), new THREE.Quaternion(), new THREE.Vector3(0.1, H, 0.1))); }
        carry += len;
      }
    }
    const fpm = new THREE.MeshLambertMaterial({ color: F.colour }); disposables.push(fpm);
    addInstanced('barriers', CYL.clone(), fpm, posts, null, { name: 'fence posts' });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(quadsP, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(quadsUV, 2)); g.setIndex(idx); g.computeVertexNormals();
    const tex = fenceTexture(THREE), fm = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: F.colour, depthWrite: false });
    disposables.push(tex, fm); addMesh('barriers', g, fm, { name: 'fence mesh' });
  }

  const objs = D.objects ?? [];
  const of = k => objs.filter(o => o.k === k);
  // (the centreline point nearest a place, at about a height: a crossover's two passes told apart)
  const nearestCentre = (x, z, y) => { let b = 0, bd = Infinity; for (let i = 0; i < D.centre.x.length; i++) { const d = (D.centre.x[i] - x) ** 2 + (D.centre.z[i] - z) ** 2 + 9 * (D.centre.h[i] - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
  const C0 = D.centre, at = (i, u) => { const n = C0.x.length, a = (i - 1 + n) % n, b = (i + 1) % n, dx = C0.x[b] - C0.x[a], dz = C0.z[b] - C0.z[a], m = Math.hypot(dx, dz) || 1; return [C0.x[i] + dz / m * u, C0.z[i] - dx / m * u, dx / m, dz / m]; };

  // ---------- the start: the gantry and its lights, the timing tower ----------
  const lamps = { red: [], green: null };
  const gantryFrame = (o, parts) => {
    const i = o.i, [lx, lz, tx, tz] = at(i, o.left), [rx, rz] = at(i, -o.right), yaw = Math.atan2(tx, tz), top = o.y + 7.2;
    const span = o.left + o.right, cx = (lx + rx) / 2, cz = (lz + rz) / 2;
    parts.push({ geo: BOX, matrix: mat(lx, o.y + 3.75, lz, yaw, 0.8, 7.5, 0.8), colour: '#3b3f45' }, { geo: BOX, matrix: mat(rx, o.y + 3.75, rz, yaw, 0.8, 7.5, 0.8), colour: '#3b3f45' });
    parts.push({ geo: BOX, matrix: mat(cx, top, cz, yaw + Math.PI / 2, span, 1.0, 0.9), colour: '#2b2e33' });
    return { i, tx, tz, yaw, top };
  };
  for (const o of of('finish')) {
    // a sprint's finish: the gantry with a chequered banner across the road
    const parts = [], { tx, tz, yaw, top } = gantryFrame(o, parts), w = Math.min(D.width + 2, 16);
    for (let c = 0; c < 16; c++) for (let r = 0; r < 2; r++) { const off = (c - 7.5) * w / 16; parts.push({ geo: BOX, matrix: mat(o.x + tz * off, top - 1.0 - r * w / 16, o.z - tx * off, yaw, w / 16, w / 16, 0.12), colour: (c + r) % 2 ? '#f4f4f0' : '#111111' }); }
    addMesh('start', merge(parts), palette, { name: 'finish gantry', shadow: true });
  }
  for (const o of of('gantry')) {
    const parts = [], { tx, tz, yaw, top } = gantryFrame(o, parts);
    // the light panel over the road (its middle over the road's): five pods
    const pods = [];
    for (let p = 0; p < 5; p++) { const off = (2 - p) * 1.1, x = o.x + tz * off, z = o.z - tx * off; pods.push([x, z]); parts.push({ geo: BOX, matrix: mat(x, top - 1.6, z, yaw, 0.9, 2.2, 0.35), colour: '#16171a' }); }
    addMesh('start', merge(parts), palette, { name: 'gantry', shadow: true });
    const sphere = new THREE.SphereGeometry(0.22, 10, 8); disposables.push(sphere);
    for (let p = 0; p < 5; p++) {
      const m = new THREE.MeshBasicMaterial({ color: '#3a0a0a' }); disposables.push(m);
      const g = merge([0, 1].map(r => ({ geo: sphere, matrix: mat(pods[p][0] - tx * 0.2, top - 0.95 - r * 0.62, pods[p][1] - tz * 0.2, 0, 1, 1, 1), colour: '#ffffff' })));
      lamps.red.push(addMesh('start', g, m, { name: `light ${p + 1}` }));
    }
    const gm = new THREE.MeshBasicMaterial({ color: '#0b2a12' }); disposables.push(gm);
    lamps.green = addMesh('start', merge(pods.map(([x, z]) => ({ geo: sphere, matrix: mat(x - tx * 0.2, top - 2.2, z - tz * 0.2, 0, 1, 1, 1), colour: '#ffffff' }))), gm, { name: 'lights green' });
  }
  for (const o of of('tower')) {
    const yaw = yawOf(o), parts = [{ geo: BOX, matrix: mat(o.x, o.y + o.h / 2, o.z, yaw, 3.6, o.h, 3.6), colour: '#30343a' }];
    addMesh('start', merge(parts), palette, { name: 'timing tower', shadow: true });
    const tex = towerTexture(THREE, D), tm = new THREE.MeshBasicMaterial({ map: tex }); disposables.push(tex, tm);
    const plane = new THREE.PlaneGeometry(3.2, o.h - 2);
    const m = addMesh('start', plane, tm, { name: 'timing board' });
    m.position.set(o.x + o.fx * 1.82, o.y + o.h / 2 + 0.5, o.z + o.fz * 1.82); m.rotation.y = yaw;
  }

  // ---------- the pits: the garages behind their fronts, along the lane ----------
  if (D.dress?.pit) {
    const P0 = D.dress.pit, s = P0.side, W = D.width / 2, parts = [], n = C0.x.length;
    const front = W + PIT.front, back = W + PIT.back, deep = back - front;
    for (let i = P0.from; i < P0.to; i += 6) {
      const i2 = Math.min(P0.to, i + 6), [xa, za] = at(i, s * (front + back) / 2), [xb, zb] = at(i2, s * (front + back) / 2), len = Math.hypot(xb - xa, zb - za);
      if (len < 0.5) continue;
      const yaw = Math.atan2(xb - xa, zb - za) + Math.PI / 2, y = C0.h[i] - 0.4;
      parts.push({ geo: BOX, matrix: mat((xa + xb) / 2, y + 3.5, (za + zb) / 2, yaw, len, 7, deep), colour: '#d8d6d0' });
      parts.push({ geo: BOX, matrix: mat((xa + xb) / 2, y + 7.2, (za + zb) / 2, yaw, len + 0.3, 0.4, deep + 1.5), colour: '#5d636b' });
    }
    // garage doors on the front, every 12 m
    for (let g = 0; g < P0.garages; g++) {
      const i = Math.round(P0.from + (g + 0.5) * (P0.to - P0.from) / P0.garages), [x, z, tx, tz] = at(i, s * (front + 0.02));
      parts.push({ geo: BOX, matrix: mat(x, C0.h[i] + 2.1, z, Math.atan2(tx, tz) + Math.PI / 2, 8.5, 4.2, 0.12), colour: g % 2 ? '#2d3a4a' : '#34465a' });
    }
    if (parts.length) addMesh('pits', merge(parts), palette, { name: 'garages', shadow: true });
    void n;
  }

  // ---------- grandstands (and their crowds) ----------
  {
    const parts = [], crowds = [];
    const seatCol = pick(['#2f6fb5', '#c0392b', '#e0a020', '#3c8c4c', '#6b4bb0']);
    for (const o of of('grandstand')) {
      const yaw = yawOf(o), cs = Math.cos(yaw), sn = Math.sin(yaw);
      const local = (lx, ly, lz) => [o.x + lx * cs + lz * sn, o.y + ly, o.z - lx * sn + lz * cs];
      const rows = o.rows, step = o.deep / (rows + 1), rise = 0.55;
      parts.push({ geo: BOX, matrix: mat(...local(0, 0.6, 0), yaw, o.len, 1.2, o.deep), colour: '#8d8a84' });
      for (let r = 0; r < rows; r++) parts.push({ geo: BOX, matrix: mat(...local(0, 1.2 + r * rise + rise / 2, o.deep / 2 - (r + 0.5) * step - step / 2), yaw, o.len, rise, step), colour: r % 2 ? seatCol : C.set(seatCol).multiplyScalar(0.8).getStyle() });
      const backH = 1.2 + rows * rise + 2.5;
      parts.push({ geo: BOX, matrix: mat(...local(0, backH / 2, -o.deep / 2 + 0.2), yaw, o.len, backH, 0.4), colour: '#b7b3aa' });
      // the roof: on posts, over the seats
      for (let px = -o.len / 2 + 1; px <= o.len / 2 - 1; px += Math.max(8, o.len / 6)) parts.push({ geo: BOX, matrix: mat(...local(px, backH / 2, -o.deep / 2 + 0.6), yaw, 0.4, backH, 0.4), colour: '#6d6f73' });
      parts.push({ geo: BOX, matrix: mat(...local(0, backH + 0.2, -o.deep * 0.1), yaw, o.len + 1, 0.35, o.deep * 0.95), colour: '#e6e6e2' });
      // its crowd: a seat in every so many (the quality setting)
      const share = spectators === 'off' ? 0 : spectators === 'low' ? 0.25 : 0.6;
      if (share > 0) {
        const mats = [], cols = [], R = rand(hash(`${o.x},${o.z}`));
        for (let r = 0; r < rows; r++) for (let px = -o.len / 2 + 0.5; px < o.len / 2 - 0.4; px += 0.62) {
          if (R() > share) continue;
          const [x, y, z] = local(px + (R() - 0.5) * 0.1, 1.2 + (r + 1) * rise, o.deep / 2 - (r + 0.5) * step - step / 2);
          mats.push(mat(x, y, z, yaw)); cols.push(['#d64541', '#2e86de', '#f5f6fa', '#feca57', '#1dd1a1', '#222f3e', '#ff9f43', '#c8d6e5'][Math.floor(R() * 8)]);
        }
        crowds.push({ o, mats, cols });
      }
    }
    if (parts.length) addMesh('scenery', merge(parts), palette, { name: 'grandstands', shadow: true });
    const person = merge([{ geo: BOX, matrix: mat(0, 0.38, 0, 0, 0.42, 0.62, 0.3), colour: '#ffffff' }, { geo: BOX, matrix: mat(0, 0.82, 0, 0, 0.22, 0.24, 0.22), colour: '#e8c4a0' }]);
    disposables.push(person);
    for (const c of crowds) {
      const m = addInstanced('crowd', person.clone(), palette, c.mats, c.cols, { name: 'crowd' });
      if (m) updaters.push(cam => { m.visible = cam.position.distanceToSquared(V.set(c.o.x, c.o.y, c.o.z)) < 450 * 450; });
    }
  }

  // ---------- marshal posts, light towers, the footbridge ----------
  {
    const hut = merge([{ geo: BOX, matrix: mat(0, 1.15, 0, 0, 2, 2.3, 2), colour: '#f2f2ee' }, { geo: BOX, matrix: mat(0, 2.4, 0, 0, 2.4, 0.2, 2.4), colour: '#e66a1f' }, { geo: CYL, matrix: mat(0.8, 3.2, 0.8, 0, 0.06, 4, 0.06), colour: '#cccccc' }, { geo: BOX, matrix: mat(1.15, 4.7, 0.8, 0, 0.6, 0.4, 0.02), colour: '#f7d117' }]);
    addInstanced('scenery', hut, palette, of('marshal').map(o => mat(o.x, o.y, o.z, yawOf(o))), null, { name: 'marshal posts' });
    const tower = merge([{ geo: CYL, matrix: mat(0, 13, 0, 0, 0.6, 26, 0.6), colour: '#9ba1a8' }, { geo: BOX, matrix: mat(0, 26.3, 0.5, 0, 4, 1.8, 0.6), colour: '#d9dde2' }, { geo: BOX, matrix: mat(0, 26.3, 0.82, 0, 3.6, 1.4, 0.05), colour: '#fff7c9' }]);
    addInstanced('scenery', tower, palette, of('light').map(o => mat(o.x, o.y, o.z, yawOf(o))), null, { name: 'light towers', shadow: true });
    const fb = [];
    for (const o of of('footbridge')) {
      const i = o.i, [lx, lz, tx, tz] = at(i, o.left), [rx, rz] = at(i, -o.right), yaw = Math.atan2(tx, tz), cx = (lx + rx) / 2, cz = (lz + rz) / 2, top = C0.h[i] + 6.2;
      fb.push({ geo: BOX, matrix: mat(lx, C0.h[i] + 3.5, lz, yaw, 1.4, 7.5, 1.4), colour: '#c9c7c0' }, { geo: BOX, matrix: mat(rx, C0.h[i] + 3.5, rz, yaw, 1.4, 7.5, 1.4), colour: '#c9c7c0' });
      fb.push({ geo: BOX, matrix: mat(cx, top, cz, yaw + Math.PI / 2, o.left + o.right + 1.4, 1.0, 2.6), colour: '#e9e6df' });
      fb.push({ geo: BOX, matrix: mat(cx, top + 1.2, cz, yaw + Math.PI / 2, o.left + o.right + 1.4, 1.4, 2.4), colour: '#ffffff' });
    }
    if (fb.length) addMesh('scenery', merge(fb), palette, { name: 'footbridge', shadow: true });
    // a crossover's bridge (version 3): the deck's underside and edge beams under the upper pass (its road
    // is the deck's top: the same mesh as its collider), its abutments either side of the road below
    const br = [];
    for (const o of of('bridge')) {
      const yaw = Math.atan2(o.fx, o.fz), len = o.half * 2 + 6;
      // (the deck follows the pass's own heights: pieces along it)
      const steps = 8;
      for (let q = 0; q < steps; q++) {
        const a = -len / 2 + (q + 0.5) * len / steps, x = o.x + o.fx * a, z = o.z + o.fz * a, i = nearestCentre(x, z, o.y);
        const y = C0.h[i];
        br.push({ geo: BOX, matrix: mat(x, y - 0.75, z, yaw, o.width, 1.3, len / steps + 0.05), colour: '#9a978f' });
        for (const e of [-1, 1]) br.push({ geo: BOX, matrix: mat(x + o.fz * e * o.width / 2, y - 0.45, z - o.fx * e * o.width / 2, yaw, 0.5, 1.9, len / steps + 0.05), colour: '#b8b5ad' });
      }
      for (const e of [-1, 1]) {
        const x = o.x + o.fx * e * (o.half + 1.5), z = o.z + o.fz * e * (o.half + 1.5), h = Math.max(1, o.y - o.ground);
        br.push({ geo: BOX, matrix: mat(x, o.ground - 1 + h / 2, z, yaw, o.width, h, 3), colour: '#a9a69e' });
      }
    }
    if (br.length) addMesh('scenery', merge(br), palette, { name: 'bridge', shadow: true });
  }

  // ---------- buildings ----------
  {
    const parts = [], BC = look.building ?? ['#cccccc'], roof = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1);
    disposables.push(roof);
    for (const o of of('building')) {
      const yaw = yawOf(o), col = BC[Math.floor(rand(hash(`${o.x}${o.z}`))() * BC.length)];
      parts.push({ geo: BOX, matrix: mat(o.x, o.y + o.h / 2 - 0.5, o.z, yaw, o.w, o.h + 1, o.d), colour: col });
      if (o.style === 'city') {
        // window bands, a floor at a time
        for (let f = 1; f * 3.3 < o.h - 1; f++) parts.push({ geo: BOX, matrix: mat(o.x, o.y + f * 3.3, o.z, yaw, o.w + 0.12, 1.3, o.d + 0.12), colour: '#3d4b59' });
        parts.push({ geo: BOX, matrix: mat(o.x, o.y + o.h + 0.6, o.z, yaw, o.w * 0.5, 1.2, o.d * 0.5), colour: '#6b6f74' });
      } else {
        // a pitched roof
        parts.push({ geo: roof, matrix: new THREE.Matrix4().compose(new THREE.Vector3(o.x, o.y + o.h + o.d * 0.18, o.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2, 'YXZ')), new THREE.Vector3(o.d * 0.42, o.w + 0.4, o.d * 1.12)), colour: look.roof ?? '#5b3a2c' });
      }
    }
    if (parts.length) addMesh('scenery', merge(parts), palette, { name: 'buildings', shadow: true });
  }

  // ---------- rocks ----------
  {
    const rocks = of('rock'), byKind = {};
    for (const o of rocks) (byKind[o.kind] ??= []).push(o);
    const shapes = { boulder: [DOD, [1.4, 1.0, 1.2], 0.25], crag: [CONE, [2.2, 4.5, 2.0], 0.4], mesa: [CYL6, [12, 9, 11], 0.45] };
    for (const [kind, list] of Object.entries(byKind)) {
      const [geo, [sx, sy, sz], sink] = shapes[kind] ?? shapes.boulder, base = kind === 'boulder' ? 1.3 : kind === 'crag' ? 1 : 1;
      addInstanced('scenery', geo.clone(), new THREE.MeshLambertMaterial({ color: look.rock ?? '#8c8a86', flatShading: true }), list.map(o => mat(o.x, o.y + sy * base * o.size * (0.5 - sink), o.z, o.turn, sx * base * o.size, sy * base * o.size, sz * base * o.size)), list.map(() => C.set('#ffffff').multiplyScalar(0.82 + rnd() * 0.3).getStyle()), { name: `rocks ${kind}`, shadow: true });
    }
  }

  // ---------- trees: near the camera in full, further off simply ----------
  {
    const trees = of('tree'), byKind = {};
    for (const o of trees) (byKind[o.kind] ??= []).push(o);
    const TC = look.trees ?? {}, trunk = '#5b4532';
    const full = {
      broadleaf: k => merge([{ geo: CYL6, matrix: mat(0, 1.4, 0, 0, 0.42, 2.8, 0.42), colour: trunk }, { geo: ICO, matrix: mat(0, 4.3, 0, 0, 4.6, 3.9, 4.6), colour: TC[k] }, { geo: ICO, matrix: mat(0.6, 5.6, -0.4, 0.7, 3.2, 2.8, 3.2), colour: TC[k] }]),
      conifer: k => merge([{ geo: CYL6, matrix: mat(0, 1.0, 0, 0, 0.36, 2.0, 0.36), colour: trunk }, { geo: CONE, matrix: mat(0, 3.6, 0, 0, 4.2, 4.6, 4.2), colour: TC[k] }, { geo: CONE, matrix: mat(0, 6.2, 0, 0.4, 3.0, 3.8, 3.0), colour: TC[k] }, { geo: CONE, matrix: mat(0, 8.3, 0, 0.9, 1.8, 2.8, 1.8), colour: TC[k] }]),
      palm: k => merge([{ geo: CYL6, matrix: mat(0, 3.6, 0, 0, 0.36, 7.2, 0.36), colour: '#7a6248' }, ...[0, 1, 2, 3, 4, 5].map(a => ({ geo: CONE, matrix: mat(Math.cos(a) * 1.4, 7.0, Math.sin(a) * 1.4, -a + Math.PI / 2, 0.9, 3.4, 0.25, 1.25), colour: TC[k] }))]),
      shrub: k => merge([{ geo: ICO, matrix: mat(0, 0.8, 0, 0, 2.6, 1.8, 2.4), colour: TC[k] }]),
    };
    const far = {
      broadleaf: k => merge([{ geo: CONE, matrix: mat(0, 3.6, 0, 0, 5, 7.2, 5), colour: TC[k] }]),
      conifer: k => merge([{ geo: CONE, matrix: mat(0, 4.6, 0, 0, 4.4, 9.2, 4.4), colour: TC[k] }]),
      palm: k => merge([{ geo: CONE, matrix: mat(0, 4.2, 0, Math.PI, 3.2, 8.4, 3.2), colour: TC[k] }]),
      shrub: k => merge([{ geo: CONE, matrix: mat(0, 0.9, 0, 0, 2.6, 1.8, 2.6), colour: TC[k] }]),
    };
    for (const [kind, list] of Object.entries(byKind)) {
      const mk = full[kind] ?? full.broadleaf, mf = far[kind] ?? far.broadleaf;
      const mats = list.map(o => mat(o.x, o.y - 0.1, o.z, o.turn, o.size, o.size, o.size)), tint = list.map(() => C.set('#ffffff').multiplyScalar(0.8 + rnd() * 0.35).getStyle());
      const near = addInstanced('scenery', mk(kind), palette, mats, tint, { name: `trees ${kind}`, shadow: true });
      const away = addInstanced('scenery', mf(kind), palette, mats, tint, { name: `trees ${kind} far` });
      if (!near) continue;
      const P = list.map(o => [o.x, o.z]);
      let last = null;
      updaters.push(cam => {
        if (last && (cam.position.x - last[0]) ** 2 + (cam.position.z - last[1]) ** 2 < 25 * 25) return;
        last = [cam.position.x, cam.position.z];
        let a = 0, b = 0;
        for (let i = 0; i < P.length; i++) {
          const d2 = (P[i][0] - last[0]) ** 2 + (P[i][1] - last[1]) ** 2;
          if (d2 < 320 * 320) { near.setMatrixAt(a, mats[i]); near.setColorAt(a++, C.set(tint[i])); } else { away.setMatrixAt(b, mats[i]); away.setColorAt(b++, C.set(tint[i])); }
        }
        near.count = a; away.count = b;
        near.instanceMatrix.needsUpdate = away.instanceMatrix.needsUpdate = true; near.instanceColor.needsUpdate = away.instanceColor.needsUpdate = true;
      });
    }
  }

  // ---------- signs and advertising (one texture atlas) ----------
  {
    const atlas = signAtlas(THREE, D.dress?.brands ?? []), am = new THREE.MeshLambertMaterial({ map: atlas.texture, side: THREE.DoubleSide }); disposables.push(atlas.texture, am);
    const plane = new THREE.PlaneGeometry(1, 1), parts = [], legs = [];
    disposables.push(plane);
    const sign = (o, w, h, lift, uv) => { const yaw = yawOf(o); parts.push({ geo: plane, matrix: mat(o.x, o.y + lift + h / 2, o.z, yaw, w, h, 1), uv }); legs.push({ geo: BOX, matrix: mat(o.x, o.y + (lift + h) / 2, o.z - (o.fz ?? 0) * 0.06, yaw, 0.1, lift + h, 0.06), colour: '#7c8288' }); };
    for (const o of of('board')) sign(o, 6, 1.5, 0.95, atlas.brand(o.brand));
    for (const o of of('brakeboard')) sign(o, 1.3, 1.6, 0.9, atlas.cell(`${o.d}`));
    for (const o of of('cornersign')) sign(o, 1.2, 1.2, 1.1, atlas.cell(`T${o.n}`));
    for (const o of of('footbridge')) { const i = o.i, [, , tx, tz] = at(i, 0); for (const f of [1, -1]) parts.push({ geo: plane, matrix: mat(C0.x[i] - tx * f * 1.25, C0.h[i] + 7.4, C0.z[i] - tz * f * 1.25, Math.atan2(tx, tz) + (f > 0 ? Math.PI : 0), Math.min(o.left + o.right, 24), 1.3, 1), uv: atlas.brand(o.brand) }); }
    if (parts.length) { addMesh('signs', merge(parts), am, { name: 'signs' }); addMesh('signs', merge(legs), palette, { name: 'sign posts' }); }
  }

  // ---------- the backdrop: beyond the ground, so the world doesn't stop at its edge ----------
  {
    const T = D.terrain, half = T.size / 2, cx = (D.bounds[0] + D.bounds[2]) / 2, cz = (D.bounds[1] + D.bounds[3]) / 2;
    let lo = Infinity; for (const h of T.heights) lo = Math.min(lo, h);
    const kind = look.backdrop ?? 'hills', parts = [], R = rand(hash(`${D.code}:backdrop`)), g0 = look.ground?.[0] ?? '#5f7c47';
    // the ground beyond the height grid: a wide flat ring at its lowest edge
    const ring = new THREE.RingGeometry(half * 0.98, half * 9, 48, 1); ring.rotateX(-Math.PI / 2); disposables.push(ring);
    parts.push({ geo: ring, matrix: mat(0, lo - 0.5, 0), colour: g0 });
    const dist = half * 1.25, seaDir = R() * TAU;
    if (kind === 'sea') {
      const sea = new THREE.CircleGeometry(half * 9, 48); sea.rotateX(-Math.PI / 2); disposables.push(sea);
      parts.push({ geo: sea, matrix: mat(cx + Math.cos(seaDir) * half * 6.2, lo - 0.2, cz + Math.sin(seaDir) * half * 6.2), colour: '#2f6f9a' });
    }
    const count = kind === 'skyline' ? 90 : 28;
    for (let k = 0; k < count; k++) {
      const a = k / count * TAU + R() * 0.2, r = dist + R() * half * (kind === 'skyline' ? 1.2 : 0.9), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (kind === 'sea' && Math.cos(a - seaDir) > 0.35) continue;
      if (kind === 'skyline') parts.push({ geo: BOX, matrix: mat(x, lo + 30, z, a, 30 + R() * 40, 60 + R() * 160, 30 + R() * 40), colour: pick(['#8b97a5', '#9aa4ae', '#7d8794', '#a6aeb7']) });
      else if (kind === 'mesas') parts.push({ geo: CYL6, matrix: mat(x, lo + 30, z, R(), 160 + R() * 220, 70 + R() * 90, 160 + R() * 220), colour: '#b0704a' });
      else {
        const big = kind === 'mountains', h = big ? 280 + R() * 520 : 50 + R() * 110, w = big ? 700 + R() * 900 : 420 + R() * 520;
        parts.push({ geo: CONE, matrix: mat(x, lo + h / 2 - 5, z, R() * TAU, w, h, w * (0.7 + R() * 0.5)), colour: big ? '#6f7680' : C.set(g0).multiplyScalar(0.8).getStyle() });
        if (big) parts.push({ geo: CONE, matrix: mat(x, lo + h * 0.87 - 5, z, 0, w * 0.27, h * 0.27, w * 0.27 * (0.7 + R() * 0.5)), colour: '#f2f4f6' });
      }
    }
    const bd = addMesh('backdrop', merge(parts), palette, { name: 'backdrop' });
    bd.receiveShadow = false;
  }

  // ---------- floodlights (at night): the light towers' lamps lit; where the theme has none, masts at
  // the marshal posts (drawn only); lampsAt: where the light comes from (the scene's light pools) ----------
  const flood = new THREE.Group(); flood.name = 'floodlights'; flood.visible = false; layers.scenery.add(flood);
  const lampsAt = [];
  {
    const lit = new THREE.MeshBasicMaterial({ color: '#fff6d8' }); disposables.push(lit);
    const heads = [];
    for (const o of of('light')) { const y = (o.y ?? 0) + 26.3, yaw = yawOf(o); heads.push(mat(o.x + Math.sin(yaw) * 0.85, y, o.z + Math.cos(yaw) * 0.85, yaw, 3.6, 1.4, 0.06)); lampsAt.push([o.x, y, o.z]); }
    if (!of('light').length && floodMasts) {
      const mast = merge([{ geo: CYL, matrix: mat(0, 9, 0, 0, 0.35, 18, 0.35), colour: '#8f959c' }, { geo: BOX, matrix: mat(0, 18.2, 0.4, 0, 2.4, 1.2, 0.5), colour: '#c9cdd2' }]);
      const ms = [];
      for (const o of of('marshal')) { const yaw = yawOf(o), x = o.x - Math.sin(yaw) * 2.5, z = o.z - Math.cos(yaw) * 2.5; ms.push(mat(x, o.y ?? 0, z, yaw)); heads.push(mat(x + Math.sin(yaw) * 0.68, (o.y ?? 0) + 18.2, z + Math.cos(yaw) * 0.68, yaw, 2.2, 1.0, 0.06)); lampsAt.push([x, (o.y ?? 0) + 18, z]); }
      if (ms.length) { const m = new THREE.InstancedMesh(mast, palette, ms.length); ms.forEach((x, i) => m.setMatrixAt(i, x)); m.castShadow = false; flood.add(m); disposables.push(mast); }
    }
    if (heads.length) { const m = new THREE.InstancedMesh(BOX.clone(), lit, heads.length); heads.forEach((x, i) => m.setMatrixAt(i, x)); flood.add(m); }
  }

  return {
    group: root, layers, lampsAt,
    update(camera) { for (const u of updaters) u(camera); },
    // floodlights on or off (a circuit at night: track/renderDress.js themeEnvironment floodlit)
    setNight(on) { flood.visible = !!on; },
    setLights({ red = 0, green = false } = {}) {
      lamps.red.forEach((m, i) => m.material.color.set(i < red ? '#ff2a1a' : '#3a0a0a'));
      lamps.green?.material.color.set(green ? '#37ff6a' : '#0b2a12');
    },
    stats() {
      let drawCalls = 0, triangles = 0, instances = 0;
      root.traverse(o => { if (!o.isMesh || !o.visible || !o.parent?.visible) return; drawCalls++; const g = o.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3, c = o.isInstancedMesh ? o.count : 1; triangles += t * c; instances += c; });
      return { drawCalls, triangles: Math.round(triangles), instances };
    },
    dispose() { for (const d of disposables) d.dispose?.(); root.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); root.removeFromParent(); },
  };
}

// ---------- textures (drawn on a canvas: no files) ----------
function canvas(w, h) { if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } return new OffscreenCanvas(w, h); }
function fenceTexture(THREE) {
  const c = canvas(64, 64), g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(205,210,215,0.9)'; g.lineWidth = 2;
  for (let k = -64; k < 128; k += 21.33) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); g.beginPath(); g.moveTo(k + 64, 0); g.lineTo(k, 64); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
// the advertising (16 brands, 512 × 128 each) and the signs (300 / 200 / 100, T1–T40: 128 × 128) on one atlas
function signAtlas(THREE, brands) {
  const c = canvas(1024, 2048), g = c.getContext('2d');
  const BG = ['#d7262b', '#1d4fa3', '#f2c230', '#111111', '#1e8a4c', '#ffffff', '#ff7a00', '#6a2ca0'];
  brands.forEach((b, k) => {
    const x = (k % 2) * 512, y = Math.floor(k / 2) * 128, h = [...b].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7), bg = BG[h % BG.length], fg = bg === '#ffffff' || bg === '#f2c230' ? '#111111' : '#ffffff';
    g.fillStyle = bg; g.fillRect(x, y, 512, 128);
    g.fillStyle = fg; g.font = '900 54px Barlow, "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(b, x + 256, y + 66, 480);
    g.fillRect(x + 16, y + 112, 480, 5);
  });
  const cells = ['300', '200', '100', ...Array.from({ length: 40 }, (_, i) => `T${i + 1}`)], cellAt = {};
  cells.forEach((name, k) => {
    const x = (k % 8) * 128, y = 1024 + Math.floor(k / 8) * 128;
    cellAt[name] = [x, y];
    const board = name[0] !== 'T';
    g.fillStyle = board ? '#ffffff' : '#1a1a1a'; g.fillRect(x + 2, y + 2, 124, 124);
    if (board) { g.fillStyle = '#1d4fa3'; g.fillRect(x + 8, y + 8, 112, 112); }
    g.fillStyle = board ? '#ffffff' : '#f2c230'; g.font = `900 ${board ? 52 : 58}px Barlow, "Arial Black", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, x + 64, y + 66, 116);
  });
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  // (uv v runs up: the canvas's rows run down)
  const uvOf = (x, y, w, h) => [x / 1024, 1 - (y + h) / 2048, (x + w) / 1024, 1 - y / 2048];
  return { texture: t, brand: k => uvOf((k % 2) * 512, Math.floor(k / 2) * 128, 512, 128), cell: name => { const [x, y] = cellAt[name] ?? cellAt.T1; return uvOf(x, y, 128, 128); } };
}
function towerTexture(THREE, D) {
  const c = canvas(256, 1024), g = c.getContext('2d');
  g.fillStyle = '#101317'; g.fillRect(0, 0, 256, 1024);
  g.fillStyle = '#f2c230'; g.font = '900 40px Barlow, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('LAP', 128, 70);
  g.fillStyle = '#ffffff'; g.font = '900 64px Barlow, Arial, sans-serif'; g.fillText('1', 128, 140);
  g.font = '700 34px "JetBrains Mono", monospace'; g.textAlign = 'left';
  for (let p = 0; p < 10; p++) { g.fillStyle = p ? '#d8dde3' : '#3ccf7a'; g.fillText(`${String(p + 1).padStart(2, ' ')}  ${['#7', '#22', '#3', '#14', '#9', '#31', '#5', '#18', '#11', '#2'][p]}`, 30, 220 + p * 76); }
  g.fillStyle = '#d7262b'; g.fillRect(0, 990, 256, 34);
  void D;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
