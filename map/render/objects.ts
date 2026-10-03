// What a baked tile looks like (three.js): its decoded meshes (world/tileWorker.js) made into a few
// shared-material meshes — terrain at three levels of detail, roads, car parks, markings, water, walls by
// window pattern, roofs — with its trees and railings drawn as instances, and its street names painted on
// the roads and signs at its junctions. No geometry is worked out here beyond placing instances: it's
// all baked (tools/world/bakeTile.mjs).
//
//   const t = tileObjects(tile, { barriers: manifest.barriers })
//   t.group (in the tile's own frame: its middle at 0), t.setDetail(distance), t.dispose()

import * as THREE from 'three';
import { barrierInstances, barrierShape, quatYawPitch } from '../format/barriers.ts';

// ---------- shared materials (one each for the whole world) ----------
let M = null;
function windowTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  const win = (x, y, w, h) => { g.fillStyle = '#4b5966'; g.fillRect(x, y, w, h); g.fillStyle = '#6f8090'; g.fillRect(x, y, w, h * 0.35); };
  // one repeat: a bay wide (3 m), a storey high (3 m); y is up the wall (the texture's bottom is the floor)
  if (kind === 'tower') { g.fillStyle = '#5d7184'; g.fillRect(0, 10, 64, 40); g.fillStyle = '#7a8fa3'; g.fillRect(0, 10, 64, 12); g.fillStyle = '#c9ced3'; for (let x = 0; x < 64; x += 21) g.fillRect(x, 10, 3, 40); }
  else if (kind === 'house') { win(10, 18, 16, 22); win(38, 18, 16, 22); }
  else if (kind === 'plain') { win(24, 22, 16, 10); }
  else { win(8, 16, 18, 26); win(38, 16, 18, 26); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.flipY = true;
  return t;
}
// the baked colours are sRGB (as written in data/world/bake.json): into linear for the lighting
export function srgbVertexColours(m) {
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { before?.(sh, r); sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\n  vColor.rgb = pow(vColor.rgb, vec3(2.2));\n#endif'); };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `srgb-${key ? key() : ''}`;
  return m;
}
export function materials() {
  if (M) return M;
  const lambert = o => srgbVertexColours(new THREE.MeshLambertMaterial({ vertexColors: true, ...o }));
  M = {
    terrain: lambert({}),
    roads: lambert({ flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    paved: lambert({ flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    markings: lambert({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    cover: lambert({}),
    water: new THREE.MeshPhongMaterial({ color: '#3f7fb0', specular: '#9fc4e0', shininess: 60, transparent: true, opacity: 0.88, depthWrite: false }),
    roofs: lambert({ flatShading: true }),
    walls: Object.fromEntries(['house', 'block', 'tower', 'plain'].map(k => [k, lambert({ flatShading: true, map: windowTexture(k) })])),
    canopy: new THREE.MeshLambertMaterial({ color: '#4d7a37', flatShading: true }),
    conifer: new THREE.MeshLambertMaterial({ color: '#3d6534', flatShading: true }),
    trunk: new THREE.MeshLambertMaterial({ color: '#6b4f36' }),
    barrier: {},
    post: new THREE.MeshLambertMaterial({ color: '#8d9296' }),
    signPost: new THREE.MeshLambertMaterial({ color: '#7d8287' }),
  };
  return M;
}

// ---------- shared shapes ----------
let G = null;
function shapes() {
  if (G) return G;
  const canopy = new THREE.IcosahedronGeometry(1, 0); canopy.translate(0, 1, 0);
  const conifer = new THREE.ConeGeometry(1, 2.6, 7); conifer.translate(0, 1.3, 0);
  const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1, 6); trunk.translate(0, 0.5, 0);
  G = { canopy, conifer, trunk, rails: {}, post: (() => { const b = new THREE.BoxGeometry(0.1, 1, 0.1); b.translate(0, 0.5, 0); return b; })() };
  return G;
}
// a railing type's piece, a metre long along x, from its foot up
function railShape(type, S) {
  const g = shapes();
  if (g.rails[type]) return g.rails[type];
  let geo;
  if (type === 'guard_rail') { geo = new THREE.BoxGeometry(1, 0.32, 0.08); geo.translate(0, 0.71, 0); }
  else if (type === 'fence') { const a = new THREE.BoxGeometry(1, 0.06, 0.05); a.translate(0, S.height * 0.85, 0); const b = new THREE.BoxGeometry(1, 0.06, 0.05); b.translate(0, S.height * 0.4, 0); geo = mergeBoxes([a, b]); }
  else if (type === 'jersey_barrier') { const a = new THREE.BoxGeometry(1, 0.3, S.thickness); a.translate(0, 0.15, 0); const b = new THREE.BoxGeometry(1, S.height - 0.3, S.thickness * 0.45); b.translate(0, 0.3 + (S.height - 0.3) / 2, 0); geo = mergeBoxes([a, b]); }
  else { geo = new THREE.BoxGeometry(1, S.height, S.thickness); geo.translate(0, S.height / 2, 0); }
  return (g.rails[type] = geo);
}
function mergeBoxes(list) {
  const pos = [], idx = [];
  for (const g of list) { const base = pos.length / 3; pos.push(...g.attributes.position.array); for (const i of g.index.array) idx.push(base + i); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setIndex(idx); out.computeVertexNormals();
  return out;
}

// ---------- text (street names, signs): one atlas a tile ----------
// items: [{ text, plate }] → { texture, rects: Map('text|road' or 'text|plate' → { u0, v0, u1, v1, aspect }) }
function textAtlas(items: any[]) {
  const h = 48, W = 1024, font = `600 ${h * 0.62}px Barlow, system-ui, sans-serif`, c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = font;
  const unique = [...new Map(items.map(i => [`${i.text}|${i.plate ? 'plate' : 'road'}`, i])).entries()];
  let x = 0, y = 0;
  const placed = unique.map(([key, i]) => {
    const w = Math.min(W, Math.ceil(g.measureText(i.text).width + h * 0.6));
    if (x + w > W) { x = 0; y += h; }
    const at = { key, i, x, y, w };
    x += w;
    return at;
  });
  c.width = W; c.height = Math.max(h, 2 ** Math.ceil(Math.log2(y + h)));
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const rects = new Map();
  for (const { key, i, x: px, y: py, w } of placed) {
    if (i.plate) { g.fillStyle = '#1f6b3a'; g.fillRect(px, py, w, h); g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.strokeRect(px + 2, py + 2, w - 4, h - 4); }
    else { g.lineWidth = h * 0.12; g.strokeStyle = '#1d1f22'; g.strokeText(i.text, px + w / 2, py + h / 2); }
    g.fillStyle = '#ffffff'; g.fillText(i.text, px + w / 2, py + h / 2);
    rects.set(key, { u0: px / W, u1: (px + w) / W, v0: 1 - (py + h) / c.height, v1: 1 - py / c.height, aspect: w / h });
  }
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return { texture, rects };
}

function geometryOf(m, { normals = false } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  if (m.colours) g.setAttribute('color', new THREE.BufferAttribute(m.colours, 4, true));
  if (m.uvs) g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  if (normals && m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export function tileObjects(tile: any, { barriers: B }: any) {
  const mat = materials(), group = new THREE.Group(), owned = [];
  group.name = `tile ${tile.header.key}`;
  const mesh = (name: string, material: any, o: any = {}) => {
    const m = tile.meshes[name];
    if (!m) return null;
    const g = geometryOf(m, o), obj = new THREE.Mesh(g, material);
    obj.name = name; obj.receiveShadow = true; obj.castShadow = !!o.shadow; obj.matrixAutoUpdate = false;
    if (o.order) obj.renderOrder = o.order;
    owned.push(g); group.add(obj);
    return obj;
  };
  const terrain = [0, 1, 2].map(k => mesh(`terrain${k}`, mat.terrain, { normals: true }));
  const near = [mesh('roads', mat.roads), mesh('paved', mat.paved), mesh('paths', mat.paved), mesh('cover', mat.cover, { normals: true }), mesh('markings', mat.markings, { order: 1 })].filter(Boolean);
  mesh('water', mat.water, { normals: true, order: 2 });
  const buildings = [mesh('roofs', mat.roofs, { shadow: true }), ...['house', 'block', 'tower', 'plain'].map(k => mesh(`walls_${k}`, mat.walls[k], { shadow: true }))].filter(Boolean);
  // trees
  const trees = new THREE.Group(), T = tile.lists.trees;
  if (T) {
    const kinds = [[], []];
    for (let k = 0; k < T.data.length; k += 5) kinds[T.data[k + 4] ? 1 : 0].push(k);
    const sh = shapes(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    kinds.forEach((list, kind) => {
      if (!list.length) return;
      const top = new THREE.InstancedMesh(kind ? sh.conifer : sh.canopy, kind ? mat.conifer : mat.canopy, list.length), trunk = new THREE.InstancedMesh(sh.trunk, mat.trunk, list.length);
      list.forEach((k, n) => {
        const sc = T.data[k + 3] * 4;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 2.39);
        m4.compose(p.set(T.data[k], T.data[k + 1] + sc * (kind ? 0.35 : 0.55), T.data[k + 2]), q, s.set(sc * (kind ? 0.55 : 0.75), sc * (kind ? 1 : 0.7), sc * (kind ? 0.55 : 0.75)));
        top.setMatrixAt(n, m4);
        m4.compose(p.set(T.data[k], T.data[k + 1], T.data[k + 2]), q, s.set(1, sc * (kind ? 0.5 : 0.6), 1));
        trunk.setMatrixAt(n, m4);
      });
      top.castShadow = true; trees.add(top, trunk);
    });
    group.add(trees);
  }
  // railings and walls
  const rails = new THREE.Group();
  for (const [name, L] of Object.entries<any>(tile.lists)) {
    if (!name.startsWith('barrier_')) continue;
    const type = name.slice(8), S = barrierShape(type, B), { rails: R, posts } = barrierInstances(type, L.data, B, L.stride);
    if (!R.length) continue;
    mat.barrier[type] ??= new THREE.MeshLambertMaterial({ color: S.colour });
    const inst = new THREE.InstancedMesh(railShape(type, S), mat.barrier[type], R.length), m4 = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3();
    R.forEach((r, n) => { const q = quatYawPitch(r.yaw, r.pitch); m4.compose(p.set(r.position[0], r.position[1], r.position[2]), new THREE.Quaternion(q.x, q.y, q.z, q.w), s.set(r.length + 0.02, r.height / S.height, 1)); inst.setMatrixAt(n, m4); });
    inst.castShadow = true; rails.add(inst);
    if (posts.length) {
      const P = new THREE.InstancedMesh(shapes().post, mat.post, posts.length);
      posts.forEach((pt, n) => { m4.compose(p.set(pt[0], pt[1], pt[2]), new THREE.Quaternion(), s.set(1, pt[3] * 0.95, 1)); P.setMatrixAt(n, m4); });
      rails.add(P);
    }
  }
  group.add(rails);
  // street names on the roads, signs at junctions (made when near)
  let labels = null;
  const makeLabels = () => {
    labels = new THREE.Group();
    const names = tile.header.names, Lb = tile.lists.labels?.data ?? [], Sg = tile.lists.signs?.data ?? [];
    // every text the tile shows, in one atlas: one mesh of names on the roads, one of sign plates
    const want = [];
    for (let k = 0; k < Lb.length; k += 6) want.push({ text: names[Lb[k + 4]] });
    for (let k = 0; k < Sg.length; k += 6) want.push({ text: names[Sg[k + 4]], plate: true }, { text: names[Sg[k + 5]], plate: true });
    const atlas = textAtlas(want);
    const quads = (list, flat) => {
      const pos = [], uv = [], idx = [];
      for (const q of list) {
        const r = atlas.rects.get(q.key), c = Math.cos(q.yaw), sn = Math.sin(q.yaw), base = pos.length / 3;
        for (const [lx, ly] of [[-q.w / 2, -q.h / 2], [q.w / 2, -q.h / 2], [q.w / 2, q.h / 2], [-q.w / 2, q.h / 2]]) {
          // flat on the road (the text's up along −z before turning), or standing (its up along +y)
          const x = flat ? lx : lx, y = flat ? 0 : ly, z = flat ? -ly : 0;
          pos.push(q.at[0] + x * c + z * sn, q.at[1] + y, q.at[2] - x * sn + z * c);
        }
        uv.push(r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere();
      return g;
    };
    const roadNames = [], plates = [];
    for (let k = 0; k < Lb.length; k += 6) {
      const key = `${names[Lb[k + 4]]}|road`, r = atlas.rects.get(key), size = Math.min(Lb[k + 5] * 2 * 0.8, 3.2) / 1.5;
      roadNames.push({ key, at: [Lb[k], Lb[k + 1] + 0.03, Lb[k + 2]], yaw: Lb[k + 3], w: Math.min(size * r.aspect, 40), h: size });
    }
    for (let k = 0; k < Sg.length; k += 6) [[Sg[k + 4], 0], [Sg[k + 5], Math.PI / 2]].forEach(([n, turn], level) => {
      const key = `${names[n]}|plate`;
      // (a face each way, back to back: the text reads right from both sides, never mirrored)
      for (const back of [0, Math.PI]) {
        const yaw = Sg[k + 3] + turn + back;
        plates.push({ key, at: [Sg[k] + Math.sin(yaw) * 0.01, Sg[k + 1] + 2.75 - level * 0.42, Sg[k + 2] + Math.cos(yaw) * 0.01], yaw, w: 0.38 * atlas.rects.get(key).aspect, h: 0.38 });
      }
    });
    if (roadNames.length) { const m = new THREE.Mesh(quads(roadNames, true), new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })); m.renderOrder = 3; labels.add(m); }
    if (plates.length) labels.add(new THREE.Mesh(quads(plates, false), new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.5, transparent: false })));
    if (Sg.length) {
      const posts = new THREE.InstancedMesh(shapes().post, mat.signPost, Sg.length / 6), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(0.8, 3, 0.8), p = new THREE.Vector3();
      for (let k = 0; k < Sg.length; k += 6) posts.setMatrixAt(k / 6, m4.compose(p.set(Sg[k], Sg[k + 1], Sg[k + 2]), q, sc));
      labels.add(posts);
    }
    labels.userData.atlas = atlas.texture;
    group.add(labels);
  };
  return {
    group, header: tile.header,
    counts: () => ({ meshes: group.children.length }),
    // what to draw at this distance (m) from the camera
    setDetail(d) {
      const lod = d < 650 ? 0 : d < 1700 ? 1 : 2;
      terrain.forEach((t, k) => { if (t) t.visible = k === lod; });
      for (const m of near) m.visible = d < 1400;
      for (const m of buildings) m.visible = d < 3000;
      trees.visible = d < 700; rails.visible = d < 900;
      if (d < 360 && !labels) makeLabels();
      if (labels) labels.visible = d < 360;
    },
    dispose() {
      for (const g of owned) g.dispose();
      trees.traverse((o: any) => o.dispose?.()); rails.traverse((o: any) => o.dispose?.());
      labels?.traverse(o => { if (!o.isInstancedMesh) o.geometry?.dispose?.(); if (o.material?.map) o.material.dispose(); });
      labels?.userData.atlas?.dispose();
      group.removeFromParent();
    },
  };
}
