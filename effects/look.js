// The driving view's look (2026-10-12; docs/PERFORMANCE.md "The look"): the picture's tone mapping, the sky drawn
// round the world, the sky as the cars reflect it, and the soft shadows right under the cars. All of it cheap enough
// for every graphics preset: a few sums a pixel for the tone mapping and the sky, the reflections only made again when
// the light changes (and not at all with reflections off), every car's shadow in one draw.
//
//   neutralToneMapping(THREE, renderer, exposure)  Khronos PBR Neutral (three.js's own from r162; this is r160): colours
//                                                   as they are up to about 0.8, only the brightest rolled off to white —
//                                                   paint keeps its colour, the sun on clear coat doesn't clip
//   skyDome(THREE) → mesh                          the sky round the camera (add it to a scene); setSky(mesh, look)
//   createSkyReflections(THREE, renderer) → { texture, update(look) → whether it was made again, dispose() }
//   skyLook({ zenith, horizon, ground, sunDir, sunColour, sun, glow }) → the sky's settings (three.js colours, linear)
//   createContactShadows(THREE) → { mesh, update(cars, opacity) }     cars: CarVisuals (each one's own size, found once)

const NEUTRAL = /* glsl */`
vec3 CustomToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}`;

export function neutralToneMapping(THREE, renderer, exposure = 1) {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment, plain = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (chunk.includes(plain)) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(plain, NEUTRAL);
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = exposure;
}

// ---------- the sky ----------

const SKY_VERTEX = /* glsl */`
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAGMENT = /* glsl */`
  uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColour;
  uniform float uSun, uGlow, uBelow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y, c = dot(d, uSunDir);
    // (the horizon's haze up to the zenith's blue, most of the change low down)
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    // (the glow round the sun, and its disc: brighter than white — the tone mapping and the bloom take it from there)
    float s = max(c, 0.0);
    sky += uSunColour * uGlow * (0.22 * pow(s, 6.0) + 0.5 * pow(s, 90.0));
    sky += uSunColour * uSun * smoothstep(0.99955, 0.99975, c);
    // below the horizon: the ground (what a car reflects) or the haze (the dome: the world's edge fades into it)
    vec3 below = mix(uHorizon, uGround, uBelow);
    vec3 col = h >= 0.0 ? sky : mix(uHorizon, below, smoothstep(0.0, 0.06, -h));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const skyUniforms = THREE => ({
  uZenith: { value: new THREE.Color(0.3, 0.55, 0.9) }, uHorizon: { value: new THREE.Color(0.75, 0.85, 0.95) }, uGround: { value: new THREE.Color(0.2, 0.2, 0.2) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColour: { value: new THREE.Color(1, 1, 1) }, uSun: { value: 0 }, uGlow: { value: 0 }, uBelow: { value: 0 },
});

// the settings of a sky: colours as three.js colours (linear); sunDir toward the sun (unit); sun: the disc's brightness
// (× the sun's colour), glow: the haze round it
export function skyLook({ zenith, horizon, ground, sunDir, sunColour, sun = 0, glow = 0 }) {
  return { zenith, horizon, ground, sunDir, sunColour, sun, glow };
}
function setUniforms(u, look) {
  u.uZenith.value.copy(look.zenith); u.uHorizon.value.copy(look.horizon); u.uGround.value.copy(look.ground);
  u.uSunDir.value.copy(look.sunDir).normalize(); u.uSunColour.value.copy(look.sunColour);
  u.uSun.value = look.sun; u.uGlow.value = look.glow;
}

// The sky round the camera: a ball as far out as the camera sees (just inside its far plane), drawn first, behind
// everything (it writes no depth), with no fog of its own (it's what the fog fades into)
export function skyDome(THREE) {
  const mat = new THREE.ShaderMaterial({ name: 'sky', uniforms: skyUniforms(THREE), vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.castShadow = mesh.receiveShadow = false;
  // (moved to each camera as it draws: the player's, a reflection's cube faces; three.js works out where it is on the
  // screen after this)
  mesh.onBeforeRender = (r, s, camera) => {
    camera.getWorldPosition(mesh.position);
    mesh.scale.setScalar(camera.far * 0.9);
    mesh.updateMatrixWorld();
  };
  return mesh;
}
export function setSky(dome, look) { setUniforms(dome.material.uniforms, look); }

// The sky as the cars reflect it (the graphics settings' reflections: sky): the same sky with the ground below, made
// into an environment map — again only when the light has changed (a new time of day, another world)
export function createSkyReflections(THREE, renderer) {
  const scene = new THREE.Scene(), u = skyUniforms(THREE), pmrem = new THREE.PMREMGenerator(renderer);
  u.uBelow.value = 1;
  const geo = new THREE.SphereGeometry(10, 48, 24), mat = new THREE.ShaderMaterial({ name: 'sky (reflected)', uniforms: u, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false, fog: false });
  scene.add(new THREE.Mesh(geo, mat));
  let texture = null, key = '';
  const keyOf = look => [look.zenith, look.horizon, look.ground, look.sunColour].map(c => c.toArray().map(x => x.toFixed(3)).join(',')).join('|') + `|${look.sunDir.toArray().map(x => x.toFixed(3)).join(',')}|${look.sun.toFixed(2)}|${look.glow.toFixed(2)}`;
  return {
    get texture() { return texture; },
    update(look) {
      const k = keyOf(look);
      if (k === key && texture) return false;
      key = k;
      setUniforms(u, look);
      const old = texture;
      texture = pmrem.fromScene(scene, 0, 0.1, 100).texture;
      old?.dispose();
      return true;
    },
    dispose() { texture?.dispose(); texture = null; pmrem.dispose(); geo.dispose(); mat.dispose(); },
  };
}

// ---------- the cars' contact shadows ----------

// Right under each car, a soft dark patch where its body shades the ground (what ambient occlusion would give): the
// car sits on the road rather than floating over it, with or without the sun's shadows. One draw for every car: an
// instance each, laid on the ground under its four wheels as they ride (its body's roll and pitch don't tilt it).
export function createContactShadows(THREE, max = 64) {
  // (a rounded rectangle, darkest in the middle, fading out to its edges)
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = Math.abs((i + 0.5) / N * 2 - 1), y = Math.abs((j + 0.5) / N * 2 - 1);
    const qx = Math.max(x - 0.55, 0), qy = Math.max(y - 0.7, 0), d = Math.hypot(qx / 0.45, qy / 0.3);
    const a = Math.max(0, 1 - d) ** 1.6 * (1 - 0.25 * Math.max(x, y) ** 2);
    data.set([0, 0, 0, Math.round(255 * Math.min(1, a))], (j * N + i) * 4);
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ name: 'contact shadow', color: 0x000000, map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.name = 'contact shadows';
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 1;
  mesh.count = 0;
  const sizes = new WeakMap(), m4 = new THREE.Matrix4(), s4 = new THREE.Matrix4();
  const P = { FL: new THREE.Vector3(), FR: new THREE.Vector3(), RL: new THREE.Vector3(), RR: new THREE.Vector3() };
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), C = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  // (a car's footprint, from its body's box in its own frame, and how far the box's middle is ahead of its wheels' — a
  // long overhang front or back — once: the body doesn't change size)
  const sizeOf = vis => {
    let s = sizes.get(vis);
    if (s) return s;
    vis.group.updateMatrixWorld(true);
    const box = new THREE.Box3(), inv = new THREE.Matrix4().copy(vis.group.matrixWorld).invert();
    vis.root.traverse(o => {
      if (!o.isMesh || !o.geometry?.attributes.position || o.name?.startsWith('gizmo ')) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld)));
    });
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3()), wheels = new THREE.Vector3();
    let n = 0;
    for (const k of ['FL', 'FR', 'RL', 'RR']) { const w = vis.wheels?.[k]; if (w?.parent) { wheels.add(w.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)); n++; } }
    s = { width: size.x * 1.08 + 0.25, length: size.z * 1.04 + 0.35, ahead: n ? mid.z - wheels.z / n : 0 };
    sizes.set(vis, s);
    return s;
  };
  return {
    mesh,
    // the cars to shade under (hidden ones, and ones off their wheels, left out); opacity: how dark
    update(cars, opacity = 0.6) {
      mat.opacity = opacity;
      let n = 0;
      for (const vis of cars) {
        if (n >= max) break;
        if (!vis?.group?.visible || !vis.group.parent || vis.disposed) continue;
        let o = vis.group, shown = true;
        while (o) { if (!o.visible) { shown = false; break; } o = o.parent; }
        if (!shown) continue;
        const s = sizeOf(vis);
        if (!s) continue;
        // (each wheel's bottom, in the world: the ground under the car as it is now)
        let ok = true;
        for (const k of ['FL', 'FR', 'RL', 'RR']) {
          const w = vis.wheels?.[k];
          if (!w || !w.parent || vis.wheelOff?.(k)) { ok = false; break; }
          w.getWorldPosition(P[k]);
          P[k].y -= vis.wheelRadius?.(k) ?? 0.3;
        }
        if (ok) {
          C.copy(P.FL).add(P.FR).add(P.RL).add(P.RR).multiplyScalar(0.25);
          Z.copy(a.copy(P.FL).add(P.FR)).sub(b.copy(P.RL).add(P.RR)).normalize();
          X.copy(a.copy(P.FL).add(P.RL)).sub(b.copy(P.FR).add(P.RR)).normalize();
          Y.crossVectors(Z, X).normalize();
          if (Y.y < 0) Y.negate();
          X.crossVectors(Y, Z).normalize();
        } else {
          // (a wheel off: under the body, flat)
          vis.group.getWorldPosition(C);
          C.y -= 0.35;
          Z.set(0, 0, 1).applyQuaternion(vis.group.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
          Y.set(0, 1, 0); X.crossVectors(Y, Z).normalize();
        }
        // (under the middle of the body, a hair above the ground)
        m4.makeBasis(X, Y, Z).setPosition(C.addScaledVector(Z, s.ahead).addScaledVector(Y, 0.015));
        s4.makeScale(s.width, 1, s.length);
        mesh.setMatrixAt(n++, m4.multiply(s4));
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = n > 0;
      mesh.visible = n > 0;
    },
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); mesh.dispose?.(); },
  };
}
