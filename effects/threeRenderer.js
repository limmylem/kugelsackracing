// Draws the effects (effects/director.js) with three.js, in the test worlds.
//
//  - Particles: camera-facing quads, one instanced draw for the lit ones (smoke, steam, dust: a soft puff
//    shaded as a ball by the scene's key light and sky; chips of debris, gravel and grass; glittering
//    glass) and one, added on top (additive), for the glowing ones (sparks: streaks along their motion;
//    flames). Glowing ones are brighter at night. Each frame only the live particles are written.
//  - Soft particles (the quality's `soft`): the scene is drawn into a render target with its depth, copied
//    to the screen, then the particles are drawn over it reading that depth — hidden behind what's in
//    front of them, and fading out where they meet a surface (no hard line where smoke meets the road).
//    Without it the particles go straight into the scene's depth (cheaper, hard edges).
//  - Marks: skid marks and drips, flat on the ground; they fade on the graphics card (by when each was
//    made), so only new ones are uploaded.
//  - Lights: a few small flickering point lights where sparks fly (the quality's `lights`).
//
// render(scene, camera) draws the scene and the effects (in place of renderer.render).

import * as THREE from 'three';
import { STYLES } from './particles.js';

const GLOWING = new Set([STYLES.indexOf('spark'), STYLES.indexOf('flame')]);

const VERTEX = /* glsl */`
  attribute vec2 corner;
  attribute vec4 iA;      // position, size
  attribute vec4 iB;      // velocity, style + seed (fraction)
  attribute vec4 iC;      // colour, alpha
  uniform float uTime;
  varying vec2 vUv; varying vec4 vColour; varying float vStyle; varying float vSeed; varying float vViewZ; varying float vSize; varying vec3 vLightV;
  uniform vec3 uLightDir;
  void main() {
    float style = floor(iB.w + 0.001), seed = fract(iB.w);
    vec4 mv = modelViewMatrix * vec4(iA.xyz, 1.0);
    float size = iA.w;
    vec2 off;
    if (style == 1.0) {
      // a spark: a streak along its motion (as it moves on the screen)
      vec3 vv = mat3(viewMatrix) * iB.xyz;
      float len = length(vv.xy);
      vec2 d = len > 1e-3 ? vv.xy / len : vec2(1.0, 0.0), n = vec2(-d.y, d.x);
      off = d * corner.x * (size + len * 0.045) + n * corner.y * size;
    } else {
      // turned a little (and tumbling, the bits)
      float a = seed * 6.2832 + (style >= 3.0 ? uTime * (2.0 + seed * 6.0) : seed * 0.0);
      float c = cos(a), s = sin(a);
      off = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    }
    mv.xy += off;
    gl_Position = projectionMatrix * mv;
    vUv = corner; vColour = iC; vStyle = style; vSeed = seed; vViewZ = mv.z; vSize = size;
    vLightV = normalize(mat3(viewMatrix) * uLightDir);
  }`;

// (colours come as they look on screen, sRGB: the shaders light them in linear, and three writes them out
// for wherever they're drawn — the screen, or the scene's render target)
const TO_LINEAR = /* glsl */`vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }`;

const FRAGMENT = /* glsl */`
  #include <packing>
  ${TO_LINEAR}
  uniform vec3 uLight; uniform vec3 uAmbient; uniform float uNight; uniform float uNightGlow; uniform float uGlow[5]; uniform float uTime;
  uniform sampler2D uDepth; uniform vec2 uResolution; uniform float uNear; uniform float uFar; uniform float uSoft;
  varying vec2 vUv; varying vec4 vColour; varying float vStyle; varying float vSeed; varying float vViewZ; varying float vSize; varying vec3 vLightV;
  void main() {
    float r = length(vUv), a = vColour.a;
    vec3 col = toLinear(vColour.rgb);
    int st = int(vStyle + 0.5);
    if (st == 0) {                       // puff: a soft, lumpy ball, lit from the key light and the sky
      float ang = atan(vUv.y, vUv.x), lump = 0.12 * sin(ang * 3.0 + vSeed * 40.0) + 0.08 * sin(ang * 7.0 - vSeed * 23.0);
      float rl = r * (1.0 + lump);
      if (rl > 1.0) discard;
      a *= smoothstep(1.0, 0.15, rl) * (0.85 + 0.15 * sin(vUv.x * 9.0 + vSeed * 31.0) * sin(vUv.y * 7.0 - vSeed * 17.0));
      vec3 n = vec3(vUv * 0.8, sqrt(max(0.0, 1.0 - r * r * 0.64)));
      float lit = 0.55 + 0.45 * dot(n, vLightV);
      col *= uAmbient + uLight * max(0.0, lit) * 0.75;
    } else if (st == 1) {                // spark: a hot streak, white at its core, its colour at the edges
      float across = abs(vUv.y), along = abs(vUv.x);
      a *= (1.0 - smoothstep(0.3, 1.0, across)) * (1.0 - smoothstep(0.55, 1.0, along));
      float core = pow(1.0 - across, 3.0) * (1.0 - along * 0.5);
      col = mix(col, vec3(1.0, 0.97, 0.88), core * 0.7) * uGlow[1] * (1.0 + uNight * uNightGlow);
    } else if (st == 2) {                // flame: a flickering glowing tongue, yellow inside
      float ang = atan(vUv.y, vUv.x), rl = r * (1.0 + 0.25 * sin(ang * 5.0 + vSeed * 50.0 + uTime * 20.0));
      if (rl > 1.0) discard;
      a *= smoothstep(1.0, 0.0, rl);
      col = mix(col, vec3(1.0, 0.85, 0.4), (1.0 - rl) * 0.6) * uGlow[2] * (1.0 + uNight * uNightGlow * 0.5);
    } else if (st == 3) {                // shard: a small glittering chip
      if (abs(vUv.x) + abs(vUv.y) > 1.0) discard;
      float glint = step(0.92, fract(vSeed * 37.0 + uTime * (3.0 + vSeed * 5.0)));
      col = col * (uAmbient + uLight * 0.6) + vec3(glint) * (0.4 + 0.6 * length(uLight));
    } else {                             // chip: a small flake, catching the light as it tumbles
      if (max(abs(vUv.x), abs(vUv.y * 1.6)) > 1.0) discard;
      float tilt = 0.6 + 0.4 * sin(uTime * (3.0 + vSeed * 7.0) + vSeed * 20.0);
      col *= uAmbient + uLight * tilt * 0.8;
    }
    // soft: hidden behind the scene, fading where it meets a surface
    if (uSoft > 0.0) {
      float depth = texture2D(uDepth, gl_FragCoord.xy / uResolution).x;
      float scene = -perspectiveDepthToViewZ(depth, uNear, uFar), here = -vViewZ;
      float k = clamp((scene - here) / max(0.02, vSize * uSoft), 0.0, 1.0);
      if (k <= 0.0) discard;
      a *= st == 0 || st == 2 ? k : step(0.001, k);
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const MARK_VERTEX = /* glsl */`
  attribute vec4 mColour;      // colour, alpha
  attribute vec4 mTime;        // born, fade, round, unused
  attribute vec2 mUv;
  uniform float uTime;
  varying vec4 vColour; varying vec2 vUv; varying float vRound;
  void main() {
    float age = uTime - mTime.x, f = mTime.y;
    float t = clamp((age - f * 0.6667) / (f * 0.3333), 0.0, 1.0);
    vColour = vec4(mColour.rgb, age < f ? mColour.a * (1.0 - t * t * (3.0 - 2.0 * t)) : 0.0);
    vUv = mUv; vRound = mTime.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const MARK_FRAGMENT = /* glsl */`
  ${TO_LINEAR}
  uniform vec3 uShade;
  varying vec4 vColour; varying vec2 vUv; varying float vRound;
  void main() {
    float a = vColour.a;
    if (vRound > 0.5) { float r = length(vUv); if (r > 1.0) discard; a *= smoothstep(1.0, 0.6, r); }
    if (a < 0.003) discard;
    gl_FragColor = vec4(toLinear(vColour.rgb) * uShade, a);
    #include <colorspace_fragment>
  }`;

export function createThreeEffects(director, { renderer, scene }) {
  const P = director.particles, cap = P.capacity;
  const fx = new THREE.Scene();                   // the particles: drawn after the scene
  const uniforms = {
    uTime: { value: 0 }, uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) }, uLight: { value: new THREE.Color(1, 1, 1) }, uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uNight: { value: 0 }, uNightGlow: { value: director.cfg.night.glow }, uGlow: { value: [0, 1, 1, 0, 0] },
    uDepth: { value: null }, uResolution: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 2000 }, uSoft: { value: 0 },
  };
  for (const e of P.effects) uniforms.uGlow.value[e.styleId] = Math.max(uniforms.uGlow.value[e.styleId], e.glow);

  // two batches: lit (normal blending), glowing (additive)
  const batch = additive => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = n => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', attr(4)); geo.setAttribute('iB', attr(4)); geo.setAttribute('iC', attr(4));
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = additive ? 3 : 2;
    fx.add(mesh);
    return { geo, mat, mesh, A: geo.attributes.iA, B: geo.attributes.iB, C: geo.attributes.iC };
  };
  const lit = batch(false), glow = batch(true);

  // marks on the road
  const M = director.marks, mcap = M.capacity;
  const mgeo = new THREE.BufferGeometry();
  const mattr = (n, usage = true) => { const a = new THREE.BufferAttribute(new Float32Array(mcap * 4 * n), n); if (usage) a.setUsage(THREE.DynamicDrawUsage); return a; };
  mgeo.setAttribute('position', mattr(3)); mgeo.setAttribute('mColour', mattr(4)); mgeo.setAttribute('mTime', mattr(4));
  const uv = new Float32Array(mcap * 8);
  for (let i = 0; i < mcap; i++) uv.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
  mgeo.setAttribute('mUv', new THREE.BufferAttribute(uv, 2));
  const idx = new Uint32Array(mcap * 6);
  for (let i = 0; i < mcap; i++) idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
  mgeo.setIndex(new THREE.BufferAttribute(idx, 1));
  mgeo.setDrawRange(0, 0);
  const markUniforms = { uTime: { value: 0 }, uShade: { value: new THREE.Color(1, 1, 1) } };
  const marks = new THREE.Mesh(mgeo, new THREE.ShaderMaterial({ uniforms: markUniforms, vertexShader: MARK_VERTEX, fragmentShader: MARK_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  marks.frustumCulled = false;
  marks.renderOrder = 1;
  scene.add(marks);
  let markVersion = -1;

  // spark lights: a fixed few (changing how many lights a scene has recompiles every material)
  let lights = [];
  const makeLights = n => {
    for (const l of lights) l.removeFromParent();
    lights = Array.from({ length: n }, () => { const l = new THREE.PointLight(0xffb060, 0, 5, 2); scene.add(l); return l; });
  };
  makeLights(P.Q.lights);

  // the scene drawn into a target with its depth, for soft particles
  let target = null;
  const copy = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
  const copyScene = new THREE.Scene(), copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  copy.frustumCulled = false;
  copyScene.add(copy);
  const size = new THREE.Vector2();
  const ensureTarget = () => {
    renderer.getDrawingBufferSize(size);
    if (target && target.width === size.x && target.height === size.y) return target;
    target?.dispose(); target?.depthTexture?.dispose();
    target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0, depthBuffer: true });
    target.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType);
    copy.material.map = target.texture;
    copy.material.needsUpdate = true;
    return target;
  };

  const stats = { drawn: 0, glowing: 0, marks: 0, uploadMs: 0, sceneMs: 0, fxMs: 0 };      // (ms: the CPU's side of it)

  // Each frame: the particles and marks as they are now, and how the scene is lit (lighting.js lightAt:
  // key, ambient, night)
  function update(light, dt) {
    const t0 = performance.now();
    uniforms.uTime.value += dt;
    markUniforms.uTime.value = M.time;
    if (light) {
      uniforms.uLightDir.value.set(...light.key.dir);
      uniforms.uLight.value.setRGB(...light.key.colour).multiplyScalar(light.key.intensity * 0.55);
      uniforms.uAmbient.value.setRGB(...light.ambient.sky).multiplyScalar(light.ambient.intensity * 0.6);
      uniforms.uNight.value = light.night;
      const shade = Math.min(1, light.key.intensity * 0.45 + light.ambient.intensity * 0.6);
      markUniforms.uShade.value.setRGB(shade, shade, shade);
    }
    // particles: each into its batch
    let nl = 0, ng = 0;
    const la = lit.A.array, lb = lit.B.array, lc = lit.C.array, ga = glow.A.array, gb = glow.B.array, gc = glow.C.array;
    for (let k = 0; k < P.count; k++) {
      const i = P.list[k], st = P.style[i], g = GLOWING.has(st), j = (g ? ng++ : nl++) * 4, A = g ? ga : la, B = g ? gb : lb, C = g ? gc : lc;
      A[j] = P.pos[i * 3]; A[j + 1] = P.pos[i * 3 + 1]; A[j + 2] = P.pos[i * 3 + 2]; A[j + 3] = P.size[i];
      B[j] = P.vel[i * 3]; B[j + 1] = P.vel[i * 3 + 1]; B[j + 2] = P.vel[i * 3 + 2]; B[j + 3] = st + Math.min(0.999, P.seed[i]);
      C[j] = P.colour[i * 3]; C[j + 1] = P.colour[i * 3 + 1]; C[j + 2] = P.colour[i * 3 + 2]; C[j + 3] = P.alpha[i];
    }
    for (const [b, n] of [[lit, nl], [glow, ng]]) {
      b.geo.instanceCount = n;
      for (const a of [b.A, b.B, b.C]) { a.clearUpdateRanges(); if (n) { a.addUpdateRange(0, n * 4); a.needsUpdate = true; } }
    }
    // marks: the new ones (all of them after a shift or a clear)
    const pos = mgeo.attributes.position, col = mgeo.attributes.mColour, tim = mgeo.attributes.mTime;
    let slots = M.takeChanges();
    if (M.version !== markVersion) { markVersion = M.version; slots = Array.from({ length: M.count }, (_, i) => i); for (const a of [pos, col, tim]) a.array.fill(0); }
    for (const i of slots) {
      pos.array.set(M.pos.subarray(i * 12, i * 12 + 12), i * 12);
      for (let c = 0; c < 4; c++) {
        col.array.set([M.colour[i * 3], M.colour[i * 3 + 1], M.colour[i * 3 + 2], M.alpha[i * 2 + (c < 2 ? 0 : 1)]], (i * 4 + c) * 4);
        tim.array.set([M.born[i], M.fade[i], M.round[i], 0], (i * 4 + c) * 4);
      }
    }
    if (slots.length) {
      for (const a of [pos, col, tim]) { a.clearUpdateRanges(); a.needsUpdate = true; }
      if (slots.length < 64) for (const i of slots) { pos.addUpdateRange(i * 12, 12); col.addUpdateRange(i * 16, 16); tim.addUpdateRange(i * 16, 16); }
    }
    mgeo.setDrawRange(0, M.count * 6);
    // spark lights
    if (lights.length !== P.Q.lights) makeLights(P.Q.lights);
    lights.forEach((l, k) => {
      const s = director.lights[k];
      l.visible = !!s;
      if (s) { l.position.set(...s.position); l.color.setRGB(...s.colour); l.intensity = s.intensity * (2 + 3 * (light?.night ?? 0)) * (0.7 + 0.6 * Math.random()); }
    });
    Object.assign(stats, { drawn: nl, glowing: ng, marks: M.count });
    stats.uploadMs += ((performance.now() - t0) - stats.uploadMs) * 0.1;
  }

  // The scene and the effects (in place of renderer.render(scene, camera))
  function render(sceneToDraw, camera) {
    const t0 = performance.now(), soft = P.Q.soft && renderer.capabilities.isWebGL2;
    uniforms.uSoft.value = soft ? 0.6 : 0;
    if (soft) {
      const t = ensureTarget();
      renderer.setRenderTarget(t);
      renderer.render(sceneToDraw, camera);
      renderer.setRenderTarget(null);
      uniforms.uDepth.value = t.depthTexture;
      uniforms.uResolution.value.set(t.width, t.height);
      uniforms.uNear.value = camera.near; uniforms.uFar.value = camera.far;
      renderer.render(copyScene, copyCamera);
      for (const b of [lit, glow]) { b.mat.depthTest = false; }
    } else {
      renderer.render(sceneToDraw, camera);
      for (const b of [lit, glow]) { b.mat.depthTest = true; }
    }
    const t1 = performance.now(), auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(fx, camera);
    renderer.autoClear = auto;
    const t2 = performance.now();
    stats.sceneMs += ((t1 - t0) - stats.sceneMs) * 0.1;
    stats.fxMs += ((t2 - t1) - stats.fxMs) * 0.1;
  }

  function dispose() {
    for (const b of [lit, glow]) { b.geo.dispose(); b.mat.dispose(); }
    marks.removeFromParent(); mgeo.dispose(); marks.material.dispose();
    for (const l of lights) l.removeFromParent();
    target?.dispose(); target?.depthTexture?.dispose();
    copy.geometry.dispose(); copy.material.dispose();
  }

  return { update, render, dispose, stats, marks, get lights() { return lights; } };
}
