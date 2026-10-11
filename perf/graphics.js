// The graphics pipeline (Phase 8 Step 2; docs/PERFORMANCE.md): the graphics settings (perf/quality.js) on the renderer
// — the picture's resolution (dynamic resolution holding the frame rate), the frame rate cap, power saver, and the
// finishing passes: anti-aliasing (msaa: 4 samples; fxaa: a pass over the finished picture), bloom and motion blur (the
// picture's edges streaking with speed). With none of them the scene goes straight to the screen (the cheapest); the
// passes' code is only loaded once one is wanted.
//
//   const GX = createGraphics({ renderer, cfg: data/performance.json quality })
//   GX.set(G)                       the settings (graphicsOf) — anything changed takes effect from the next frame
//   GX.due(now) → whether to draw this frame (the cap: fpsCap, or power saver's)
//   GX.render(fxDraw, scene, camera, { speed })     the frame (fxDraw: effects/threeRenderer.js — the scene and its effects)
//   GX.frameDone(frameMs, now)      dynamic resolution's measure      GX.stats → { scale, pixelRatio, fpsLimit, targetMs, post, onBattery }
//   GX.resize()                     the window changed size

import { createFrameCap, createDynamicResolution } from './quality.js';

// the motion blur: towards the middle of the picture, more the further out (the world rushing past the edges)
const SPEED_BLUR = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv;
    void main() {
      vec2 d = vUv - vec2(0.5, 0.55);
      float k = uStrength * smoothstep(0.18, 0.7, length(d)) * 0.07;
      vec4 acc = vec4(0.0);
      for (int i = 0; i < 8; i++) acc += texture2D(tDiffuse, vUv - d * k * (float(i) / 7.0));
      gl_FragColor = acc / 8.0;
    }`,
};

export function createGraphics({ renderer, cfg }) {
  let G = null, post = null, loading = null, wantKey = '', onBattery = false, displayMs = 1000 / 60;
  const cap = createFrameCap(), dyn = createDynamicResolution(cfg.dynamic);
  // (the screen's own rate: the median of the frames it gives, measured while nothing's capped)
  const gaps = [];
  let lastRaf = null;
  // (on battery: power saver's — where the browser says)
  globalThis.navigator?.getBattery?.().then(b => { const f = () => { onBattery = !b.charging; }; f(); b.addEventListener('chargingchange', f); }).catch(() => {});

  const saving = () => G && (G.powerSaver === 'always' || (G.powerSaver === 'battery' && onBattery));
  const fpsLimit = () => { const c = G?.fpsCap ?? 0; return saving() ? Math.min(c || Infinity, cfg.powerSaver.fps) : c; };
  const targetMs = () => { const f = fpsLimit(); return f > 0 ? Math.max(1000 / f, displayMs) : Math.max(1000 / 60, displayMs); };
  const maxScale = () => Math.min(G?.resolution ?? 1, saving() ? cfg.powerSaver.resolution : Infinity);
  const pixelRatio = () => Math.min(globalThis.devicePixelRatio ?? 1, G?.maxPixelRatio ?? 2) * (G?.dynamicResolution ? Math.min(dyn.scale, maxScale()) : maxScale());
  let appliedRatio = 0;
  function applyRatio() {
    const r = Math.round(pixelRatio() * 100) / 100;
    if (Math.abs(r - appliedRatio) < 0.005) return;
    appliedRatio = r;
    renderer.setPixelRatio(r);
    post?.setSizes();
  }

  // the finishing passes (loaded and made when first wanted; made again when the anti-aliasing changes)
  const needsPost = () => !!G && (G.antialias !== 'off' || G.bloom || G.motionBlur);
  async function makePost() {
    const [{ EffectComposer }, { Pass }, { ShaderPass }, { OutputPass }, { UnrealBloomPass }, { FXAAShader }, THREE] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/Pass.js'), import('three/addons/postprocessing/ShaderPass.js'),
      import('three/addons/postprocessing/OutputPass.js'), import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/shaders/FXAAShader.js'), import('three')]);
    const size = renderer.getSize(new THREE.Vector2());
    const samples = G.antialias === 'msaa' && renderer.capabilities.isWebGL2 ? 4 : 0;
    const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples });
    const composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    // (the scene and its effects, drawn into the composer's picture)
    class ScenePass extends Pass {
      constructor() { super(); this.needsSwap = false; this.job = null; }
      render(r, writeBuffer, readBuffer) { const j = this.job; if (j) j.fxDraw.render(j.scene, j.camera, readBuffer); }
    }
    const scene = new ScenePass(), bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.35, 0.92);
    const blur = new ShaderPass(SPEED_BLUR), output = new OutputPass(), fxaa = new ShaderPass(FXAAShader);
    for (const p of [scene, bloom, blur, output, fxaa]) composer.addPass(p);
    return { composer, rt, samples, scene, bloom, blur, output, fxaa, fxaaShader: FXAAShader, setSizes() {
      const s = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr); composer.setSize(s.x, s.y);
      fxaa.material.uniforms.resolution.value.set(1 / (s.x * pr), 1 / (s.y * pr));
    } };
  }
  function syncPost() {
    if (!needsPost()) return;
    const key = G.antialias === 'msaa' ? 'msaa' : 'plain';
    if (post && wantKey === key) {
      post.bloom.enabled = !!G.bloom; post.blur.enabled = !!G.motionBlur; post.fxaa.enabled = G.antialias === 'fxaa';
      return;
    }
    if (loading) return;
    wantKey = key;
    loading = makePost().then(p => { post?.composer.dispose?.(); post?.rt.dispose(); post = p; loading = null; p.setSizes(); syncPost(); }, e => { console.warn('post-processing:', e); loading = null; });
  }

  const GX = {
    get settings() { return G; },
    // (the frame time wanted: the cap's, else the screen's — at least 60 a second's worth)
    get targetMs() { return targetMs(); },
    set(next) {
      G = next;
      if (!G.dynamicResolution) dyn.reset(1);
      applyRatio();
      syncPost();
    },
    due(now) {
      // (the median worked out every 120 frames, not every frame: no garbage)
      if (lastRaf != null && !(fpsLimit() > 0)) { gaps.push(now - lastRaf); if (gaps.length >= 120) { gaps.sort((a, b) => a - b); displayMs = Math.max(4, gaps[60]); gaps.length = 0; } }
      lastRaf = now;
      return cap.due(now, fpsLimit());
    },
    render(fxDraw, scene, camera, { speed = 0 } = {}) {
      fxDraw.samples = G?.antialias === 'msaa' ? 4 : 0;
      if (!post || !needsPost() || loading) { fxDraw.render(scene, camera, null); return; }
      const J = post.scene.job ??= {};
      J.fxDraw = fxDraw; J.scene = scene; J.camera = camera;
      post.blur.uniforms.uStrength.value = Math.min(1, Math.max(0, (speed - 12) / 45));
      post.composer.render();
    },
    frameDone(frameMs, now) {
      if (!G?.dynamicResolution) return;
      dyn.update(frameMs, targetMs(), now, { min: Math.min(G.minResolution, maxScale()), max: maxScale() });
      applyRatio();
    },
    resize() { appliedRatio = 0; applyRatio(); post?.setSizes(); },
    get stats() { return { scale: G?.dynamicResolution ? Math.min(dyn.scale, maxScale()) : maxScale(), pixelRatio: appliedRatio, fpsLimit: fpsLimit(), targetMs: targetMs(), displayMs, post: post && needsPost() ? [G.antialias !== 'off' && G.antialias, G.bloom && 'bloom', G.motionBlur && 'motion blur'].filter(Boolean).join(' + ') : 'none', onBattery, saving: !!saving() }; },
  };
  return GX;
}

// Live reflections (the graphics settings' reflections: live — ultra): what's round the car in a small cube map, one
// face drawn every other frame (a whole turn in 12 frames), for paint and chrome to reflect
//   const L = createLiveReflections(THREE, renderer)   L.texture   L.update(scene, [x, y, z], hide?)   L.dispose()
export function createLiveReflections(THREE, renderer, { size = 128, far = 400 } = {}) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cube = new THREE.CubeCamera(0.5, far, rt);
  let face = 0, tick = 0, ready = false;
  return {
    texture: rt.texture,
    update(scene, at, hide = null) {
      if (tick++ % 2) return;
      if (!ready) { cube.coordinateSystem = renderer.coordinateSystem; cube.updateCoordinateSystem(); ready = true; }
      cube.position.set(at[0], at[1], at[2]); cube.updateMatrixWorld(true);
      const was = renderer.getRenderTarget(), wasFace = renderer.getActiveCubeFace(), wasMip = renderer.getActiveMipmapLevel();
      hide?.(true);
      // (the sun's shadows as the frame's own: not drawn again for a face)
      const auto = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(rt, face);
      renderer.render(scene, cube.children[face]);
      renderer.shadowMap.autoUpdate = auto;
      hide?.(false);
      renderer.setRenderTarget(was, wasFace, wasMip);
      face = (face + 1) % 6;
      if (face === 0) rt.texture.needsPMREMUpdate = true;
    },
    dispose() { rt.dispose(); },
  };
}
