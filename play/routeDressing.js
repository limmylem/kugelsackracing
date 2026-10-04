// A route dressed on the road for driving it (Phase 4 Step 2): checkpoint gates, the start and finish arch,
// racing-line arrows on the road and warning signs before the corners — each as the route asks
// (course.guides). Built in 512 m pieces by where they stand, made as the car comes within reach and
// thrown away as it leaves (shared shapes and materials: nothing grows however far the route goes).
//
//   const D = createRouteDressing({ THREE, parent, compiled, guides })   parent: the world group (world frame)
//   D.update(x, z)   the car's place (world frame): pieces in and out     D.stats    D.dispose()

import { corners } from '../route/stats.js';
import { at } from '../route/geometry.js';
import { headingOf } from '../route/grid.js';

const CHUNK = 512, NEAR = 900, FAR = 1300;

function bannerTexture(THREE, text, colours) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const x = c.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? colours[0] : colours[1]; x.fillRect(i * 32, j * 32, 32, 32); }
  if (text) { x.fillStyle = colours[2]; x.fillRect(96, 6, 320, 52); x.fillStyle = '#fff'; x.font = '700 32px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 34); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace ?? t.colorSpace;
  return t;
}
function signTexture(THREE, way) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffd400'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#111';
  for (const o of [0, 40]) { x.beginPath(); const d = way === 'left' ? -1 : 1, cx = 44 + o; x.moveTo(cx - 18 * d, 24); x.lineTo(cx + 14 * d, 64); x.lineTo(cx - 18 * d, 104); x.lineTo(cx - 4 * d, 104); x.lineTo(cx + 28 * d, 64); x.lineTo(cx - 4 * d, 24); x.closePath(); x.fill(); }
  return new THREE.CanvasTexture(c);
}

export function createRouteDressing({ THREE, parent, compiled: c, guides = {} }) {
  const G = { arrows: true, signs: true, gates: true, arch: true, ...guides };
  const root = new THREE.Group(); root.name = 'route-dressing';
  parent.add(root);
  // shared: shapes and materials, made once
  const post = new THREE.BoxGeometry(0.35, 1, 0.35), plate = new THREE.PlaneGeometry(1.2, 1.2), beam = new THREE.BoxGeometry(1, 0.9, 0.15);
  const arrowShape = new THREE.Shape([new THREE.Vector2(-0.9, -0.6), new THREE.Vector2(0, 0.4), new THREE.Vector2(0.9, -0.6), new THREE.Vector2(0.9, -0.1), new THREE.Vector2(0, 0.9), new THREE.Vector2(-0.9, -0.1)]);
  const arrow = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2);
  const M = {
    post: new THREE.MeshLambertMaterial({ color: 0xdedcd6 }),
    arrow: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    cp: new THREE.MeshLambertMaterial({ map: bannerTexture(THREE, 'CHECKPOINT', ['#1b1b1b', '#ffd400', '#d18a00']) }),
    bonus: new THREE.MeshLambertMaterial({ map: bannerTexture(THREE, 'BONUS', ['#1b1b1b', '#38e1ff', '#0b7fa0']) }),
    start: new THREE.MeshLambertMaterial({ map: bannerTexture(THREE, c.loop ? 'START · FINISH' : 'START', ['#111', '#f4f4f0', '#e8433a']) }),
    finish: new THREE.MeshLambertMaterial({ map: bannerTexture(THREE, 'FINISH', ['#111', '#f4f4f0', '#e8433a']) }),
    left: new THREE.MeshLambertMaterial({ map: signTexture(THREE, 'left'), side: THREE.DoubleSide }),
    right: new THREE.MeshLambertMaterial({ map: signTexture(THREE, 'right'), side: THREE.DoubleSide }),
  };
  // what stands where (world frame), each in the piece of the map it's in
  const items = [];
  const gate = (g, mat) => items.push({ kind: 'gate', x: g.x, z: g.z, h: g.h, heading: g.heading, width: g.width, mat });
  if (G.arch) { gate(c.start, M.start); if (!c.loop) gate(c.finish, M.finish); }
  if (G.gates) for (const g of c.gates) gate(g, g.required ? M.cp : M.bonus);
  if (G.signs) for (const k of corners(c.line, c.loop)) {
    if (k.radius > 60) continue;
    const s = k.from - 45, p = at(c.line, s, c.loop);
    if (!c.loop && s < 0) continue;
    // (on the outside of the bend: where a driver looks)
    const side = k.way === 'left' ? -1 : 1, o = p.w / 2 + 1.5;
    items.push({ kind: 'sign', x: p.x - p.dz * o * side, z: p.z + p.dx * o * side, h: p.h, heading: headingOf(p.dx, p.dz), mat: k.way === 'left' ? M.left : M.right });
  }
  if (G.arrows) for (let s = (c.grid?.startS ?? 0) + 20; s < (c.loop ? c.length : c.grid?.finishS ?? c.length); s += 30) { const p = at(c.line, s, c.loop); items.push({ kind: 'arrow', x: p.x, z: p.z, h: p.h, heading: headingOf(p.dx, p.dz) }); }
  const chunks = new Map();
  for (const it of items) { const key = `${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`; (chunks.get(key) ?? chunks.set(key, { items: [], group: null }).get(key)).items.push(it); }

  function build(ch) {
    const g = new THREE.Group();
    const arrows = ch.items.filter(i => i.kind === 'arrow');
    if (arrows.length) {
      const im = new THREE.InstancedMesh(arrow, M.arrow, arrows.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      // (the shape points to -z: turned to point along)
      arrows.forEach((a, k) => { q.setFromAxisAngle(up, (a.heading + 180) * Math.PI / 180); m.compose(new THREE.Vector3(a.x, a.h + 0.06, a.z), q, new THREE.Vector3(1.4, 1, 1.4)); im.setMatrixAt(k, m); });
      g.add(im);
    }
    for (const it of ch.items) {
      if (it.kind === 'gate') {
        const r = it.heading * Math.PI / 180, ax = Math.cos(r), az = -Math.sin(r);
        for (const sd of [-1, 1]) { const p = new THREE.Mesh(post, M.post); p.scale.y = 5.6; p.position.set(it.x + ax * sd * it.width / 2, it.h + 2.8, it.z + az * sd * it.width / 2); g.add(p); }
        const b = new THREE.Mesh(beam, it.mat); b.scale.x = it.width; b.position.set(it.x, it.h + 5.2, it.z); b.rotation.y = r; g.add(b);      // (its length across the road)
      } else if (it.kind === 'sign') {
        const p = new THREE.Mesh(post, M.post); p.scale.set(0.4, 2.2, 0.4); p.position.set(it.x, it.h + 1.1, it.z); g.add(p);
        const s = new THREE.Mesh(plate, it.mat); s.position.set(it.x, it.h + 2.6, it.z); s.rotation.y = it.heading * Math.PI / 180 + Math.PI; g.add(s);
      }
    }
    return g;
  }
  const stats = { chunks: chunks.size, loaded: 0, objects: 0, items: items.length };
  return {
    stats,
    update(x, z) {
      for (const [key, ch] of chunks) {
        const [i, j] = key.split(',').map(Number), d = Math.hypot((i + 0.5) * CHUNK - x, (j + 0.5) * CHUNK - z);
        if (!ch.group && d < NEAR) { ch.group = build(ch); root.add(ch.group); }
        else if (ch.group && d > FAR) { root.remove(ch.group); ch.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); ch.group = null; }
      }
      stats.loaded = [...chunks.values()].filter(ch => ch.group).length;
      stats.objects = 0; root.traverse(() => stats.objects++);
    },
    dispose() {
      parent.remove(root);
      for (const ch of chunks.values()) if (ch.group) ch.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
      for (const geo of [post, plate, beam, arrow]) geo.dispose();
      for (const m of Object.values(M)) { m.map?.dispose(); m.dispose(); }
    },
  };
}
