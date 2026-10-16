// Map v4's street lamps in the game (MAP_README.md, "Lamps"): the tiles' `lamps` lists (map/model/lamps.ts: [x, y (its
// foot), z, height, yaw (its arm's way, over the road), flags (1 estimated, 2 tunnel, 4 junction), its pool's height and
// slope (dy/dx, dy/dz)], in the tile's frame)
// drawn cheaply, a handful of draw calls a tile whatever the count:
//   poles and arms   instanced, grey (a tunnel's lamps: on the wall, no pole)
//   heads            instanced, lit from inside after dark (one shared material: its colour follows the night)
//   glows            one point sprite each, additive, after dark
//   pools            a soft disc of light on the road under each head, additive, after dark
// and the nearest few (manifest.lamps.realLights) as real lights, fading in and out over fadeDistance m so none pops.
// The lights are made once and kept (three.js compiles its shaders for a count of lights: never added or removed),
// switched off by day.
//
//   const L = lampObjects(tile, cfg)  → { group, count, setDetail(d), dispose() }   (one tile's, cfg = manifest.lamps)
//   const R = lampLights(scene, cfg)   → R.frame(camera, night, tiles)   (each frame: tiles = the loaded tiles' lamp
//                                        objects, night 0..1)   R.dispose()

import * as THREE from 'three';

const TUNNEL = 2;
const D = {
  height: 8, arm: 1.6, tunnelHeight: 4.6, colour: '#ffd9a0', realLights: 6, realLightRange: 32, realLightIntensity: 30,
  fadeDistance: 25, poolRadius: 8, glowSize: 1.3,
};

let S: any = null;
// the shared shapes, materials and the night they're lit for
function shared(cfg: any) {
  if (S) return S;
  const C = { ...D, ...cfg }, warm = new THREE.Color(C.colour);
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 1, 6); pole.translate(0, 0.5, 0);
  // (an arm a metre long along +z from the pole's top, the head at its end: scaled by the arm's length)
  const arm = new THREE.BoxGeometry(0.07, 0.07, 1); arm.translate(0, 0, 0.5);
  const head = new THREE.BoxGeometry(0.32, 0.12, 0.6); head.translate(0, -0.06, 0);
  const pool = new THREE.CircleGeometry(1, 20); pool.rotateX(-Math.PI / 2);
  const glowTex = radial(64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,235,200,0.55)'], [1, 'rgba(255,220,170,0)']]);
  const poolTex = radial(64, [[0, 'rgba(255,255,255,0.9)'], [0.55, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  S = {
    C, warm, pole, arm, head, pool,
    metal: new THREE.MeshLambertMaterial({ color: '#7d8389' }),
    // (by day a grey lens; after dark the lamp's own colour, unlit by the scene)
    lens: new THREE.MeshBasicMaterial({ color: '#9aa0a6' }),
    glow: new THREE.PointsMaterial({ map: glowTex, color: warm, size: C.glowSize * 2.4, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    pools: new THREE.MeshBasicMaterial({ map: poolTex, color: C.poolColour ? new THREE.Color(C.poolColour) : warm, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
    night: -1,
  };
  return S;
}
function radial(n: number, stops: [number, string][]) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (const [t, col] of stops) gr.addColorStop(t, col);
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// the night (0 day … 1 night) on the shared materials: once a frame, only when it's changed
function setNight(night: number) {
  if (!S || Math.abs(S.night - night) < 0.004) return;
  S.night = night;
  S.lens.color.set('#9aa0a6').lerp(S.warm, night).multiplyScalar(1 + night * 1.5);
  S.glow.opacity = Math.min(1, night * 1.1); S.glow.visible = night > 0.02;
  // (Map v5's lamps are brighter: their pools as strong as poolOpacity — the manifest's lamps; Map v4's 0.26)
  S.pools.opacity = Math.min(1, (S.C.poolOpacity ?? 0.26) * night); S.pools.visible = night > 0.02;
}

export function lampObjects(tile: any, cfg: any) {
  const L = tile.lists.lamps?.data as Float32Array | undefined, STRIDE = tile.lists.lamps?.stride ?? 9, n = L ? L.length / STRIDE : 0, group = new THREE.Group();
  group.name = 'lamps';
  if (!n) return { group, count: 0, heads: new Float32Array(0), setDetail() {}, dispose() {} };
  const Sh = shared(cfg), C = Sh.C, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tilt = new THREE.Vector3(), qt = new THREE.Quaternion();
  const poles = new THREE.InstancedMesh(Sh.pole, Sh.metal, n), arms = new THREE.InstancedMesh(Sh.arm, Sh.metal, n), heads = new THREE.InstancedMesh(Sh.head, Sh.lens, n), pools = new THREE.InstancedMesh(Sh.pool, Sh.pools, n);
  // (each head's place in the tile's frame: the real lights' and the glows')
  const at = new Float32Array(n * 3);
  let np = 0;
  for (let k = 0; k < n; k++) {
    const x = L![k * STRIDE], y = L![k * STRIDE + 1], z = L![k * STRIDE + 2], h = L![k * STRIDE + 3] || C.height, yaw = L![k * STRIDE + 4], tunnel = (L![k * STRIDE + 5] & TUNNEL) !== 0;
    const reach = tunnel ? 0.25 : C.arm, sx = Math.sin(yaw), sz = Math.cos(yaw);
    q.setFromAxisAngle(up, yaw);
    if (!tunnel) { poles.setMatrixAt(np++, m4.compose(p.set(x, y, z), q, s.set(1, h, 1))); }
    arms.setMatrixAt(k, m4.compose(p.set(x, y + h, z), q, s.set(1, 1, reach)));
    const hx = x + sx * reach, hz = z + sz * reach, hy = y + h;
    heads.setMatrixAt(k, m4.compose(p.set(hx, hy, hz), q, s.set(1, 1, 1)));
    // (the pool on the road under the head, tilted to its slope — older lists without it: on the foot's ground)
    const py = STRIDE >= 9 ? L![k * STRIDE + 6] : y, gx = STRIDE >= 9 ? L![k * STRIDE + 7] : 0, gz = STRIDE >= 9 ? L![k * STRIDE + 8] : 0;
    qt.setFromUnitVectors(up, tilt.set(-gx, 1, -gz).normalize());
    pools.setMatrixAt(k, m4.compose(p.set(hx, py + 0.07, hz), qt, s.set(C.poolRadius, 1, C.poolRadius)));
    at[k * 3] = hx; at[k * 3 + 1] = hy - 0.15; at[k * 3 + 2] = hz;
  }
  poles.count = np;
  const glowGeo = new THREE.BufferGeometry(); glowGeo.setAttribute('position', new THREE.BufferAttribute(at.slice(), 3)); glowGeo.computeBoundingSphere();
  const glows = new THREE.Points(glowGeo, Sh.glow);
  poles.castShadow = true;
  pools.renderOrder = 2; glows.renderOrder = 4;
  for (const o of [poles, arms, heads, pools]) { o.computeBoundingSphere(); o.matrixAutoUpdate = false; }
  glows.matrixAutoUpdate = false;
  group.add(poles, arms, heads, pools, glows);
  return {
    group, count: n, heads: at,
    // (the poles and heads as far as the trees; the glows further: they're what you see of a street at night)
    setDetail(d: number) { poles.visible = arms.visible = heads.visible = d < 700; pools.visible = d < 600; glows.visible = d < 1400; },
    dispose() { for (const o of [poles, arms, heads, pools]) o.dispose(); glowGeo.dispose(); group.removeFromParent(); },
  };
}

export function lampLights(scene: THREE.Scene, cfg: any) {
  const C = { ...D, ...cfg }, warm = new THREE.Color(C.colour), lights: THREE.SpotLight[] = [];
  for (let k = 0; k < C.realLights; k++) {
    const l = new THREE.SpotLight(warm, 0, C.realLightRange, Math.PI * 0.36, 0.65, 1.6);
    l.castShadow = false; l.name = `street lamp ${k}`;
    scene.add(l, l.target);
    lights.push(l);
  }
  const cand: { x: number; y: number; z: number; d: number }[] = [];
  return {
    lights,
    // tiles: [{ group (the tile's lamp group, placed in the scene), heads }]
    frame(camera: THREE.Camera, night: number, tiles: Iterable<{ group: THREE.Object3D; heads: Float32Array }>) {
      setNight(night);
      cand.length = 0;
      const c = camera.position;
      if (night > 0.02) for (const t of tiles) {
        const H = t.heads;
        if (!H.length || !t.group.parent) continue;
        t.group.updateWorldMatrix(true, false);
        const e = t.group.matrixWorld.elements, ox = e[12], oy = e[13], oz = e[14];
        for (let k = 0; k < H.length; k += 3) {
          const x = H[k] + ox, z = H[k + 2] + oz, d = (x - c.x) ** 2 + (z - c.z) ** 2;
          if (d > 250 * 250) continue;
          cand.push({ x, y: H[k + 1] + oy, z, d });
        }
      }
      cand.sort((a, b) => a.d - b.d);
      // (the last one fades by how close the next lamp out is: none switches on or off at once)
      const edge = cand[lights.length] ? Math.sqrt(cand[lights.length].d) : Infinity;
      lights.forEach((l, k) => {
        const L = cand[k];
        if (!L) { l.intensity = 0; return; }
        const fade = Math.min(1, Math.max(0, (edge - Math.sqrt(L.d)) / C.fadeDistance));
        l.position.set(L.x, L.y, L.z); l.target.position.set(L.x, L.y - 10, L.z);
        l.intensity = C.realLightIntensity * night * fade;
      });
    },
    dispose() { for (const l of lights) { l.removeFromParent(); l.target.removeFromParent(); l.dispose(); } },
  };
}
