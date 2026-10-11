// Memory budgets (Phase 8 Step 2; docs/PERFORMANCE.md; data/performance.json tiers.*.memoryMB): what the graphics card
// holds (textures, meshes), the sound's decoded audio and the JavaScript heap, checked every few seconds against the
// budget of the tier the graphics preset is for; over one, the caches that can let go of something do — what was used
// longest ago first (the car models no car uses now, the model files kept for the next race) — until it fits.
//
//   const M = createMemoryBudget({ sources, budgets: () => ({ textures, meshes, audio, heap } MB), every: s })
//     sources: [{ name, kind: 'textures'|'meshes'|'audio'|'heap', bytes() → number, evict?(bytes) → bytes let go }]
//   M.frame(now)   (checks every `every` s)   M.check() → { kind: { mb, budgetMB, over, freedMB } }   M.last

// what a scene has on the graphics card (about): every geometry's buffers, every texture's pixels — each counted once
// (geometries and textures seen before remembered, so the walk is quick)
const geoBytes = new WeakMap(), texBytes = new WeakMap();
export function sceneBytes(scene) {
  const geos = new Set(), texs = new Set();
  scene.traverse(o => {
    if (o.geometry) geos.add(o.geometry);
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
    if (ms) for (const m of ms) for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); }
  });
  let meshes = 0, textures = 0;
  for (const g of geos) {
    let n = geoBytes.get(g);
    if (n === undefined) { n = g.index?.array.byteLength ?? 0; for (const a of Object.values(g.attributes)) n += a.array?.byteLength ?? 0; geoBytes.set(g, n); }
    meshes += n;
  }
  for (const t of texs) {
    let n = texBytes.get(t);
    if (n === undefined) { const im = t.image; n = (im?.width ?? 0) * (im?.height ?? 0) * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1) * (t.isCubeTexture ? 6 : 1); texBytes.set(t, n); }
    textures += n;
  }
  return { meshes, textures };
}

// The same, a little at a time (a big world has tens of thousands of objects: walked at once, a hitch every few
// seconds): M.step(maxObjects) walks on from where it left off → the totals once a whole walk is done, else null
const SLOTS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap', 'envMap', 'lightMap', 'specularMap', 'displacementMap'];
export function createSceneMeter(sceneOf, { pause = 4000 } = {}) {
  let stack = null, geos = null, texs = null, meshes = 0, textures = 0, last = { meshes: 0, textures: 0 }, doneAt = -Infinity;
  return {
    get last() { return last; },
    // (a walk at most every `pause` ms; each step a few hundred objects)
    step(max = 400) {
      if (!stack) { if (performance.now() - doneAt < pause) return last; const sc = sceneOf(); if (!sc) return last; stack = [sc]; geos = new Set(); texs = new Set(); meshes = 0; textures = 0; }
      for (let n = 0; n < max && stack.length; n++) {
        const o = stack.pop();
        const g = o.geometry;
        if (g && !geos.has(g)) { geos.add(g); let b = geoBytes.get(g); if (b === undefined) { b = g.index?.array.byteLength ?? 0; for (const a of Object.values(g.attributes)) b += a.array?.byteLength ?? 0; geoBytes.set(g, b); } meshes += b; }
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
        if (ms) for (const m of ms) for (const k of SLOTS) { const t = m[k]; if (t && t.isTexture && !texs.has(t)) { texs.add(t); let b = texBytes.get(t); if (b === undefined) { const im = t.image; b = (im?.width ?? 0) * (im?.height ?? 0) * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1) * (t.isCubeTexture ? 6 : 1); texBytes.set(t, b); } textures += b; } }
        for (let i = 0; i < o.children.length; i++) stack.push(o.children[i]);
      }
      if (stack.length) return null;
      stack = null; geos = texs = null; doneAt = performance.now();
      return (last = { meshes, textures });
    },
  };
}

export function createMemoryBudget({ sources, budgets, every = 5 }) {
  let at = 0;
  const M = {
    last: null,
    frame(now) { if (now - at < every * 1000) return; at = now; M.check(); },
    check() {
      const B = budgets(), out = {};
      for (const kind of ['textures', 'meshes', 'audio', 'heap']) {
        const S = sources.filter(s => s.kind === kind);
        let total = 0;
        for (const s of S) total += s.bytes() || 0;
        const budget = (B[kind] ?? Infinity) * 1048576;
        let freed = 0;
        if (total > budget) for (const s of S) { if (!s.evict || total - freed <= budget) continue; freed += s.evict(total - freed - budget) || 0; }
        out[kind] = { mb: +(total / 1048576).toFixed(1), budgetMB: B[kind] ?? null, over: total - freed > budget, freedMB: +(freed / 1048576).toFixed(1) };
        if (freed > 0 || total - freed > budget) console.info(`memory: ${kind} ${out[kind].mb} MB of ${B[kind]} MB${freed ? `, ${out[kind].freedMB} MB let go` : ''}${total - freed > budget ? ' — still over (what\'s in use can\'t be let go)' : ''}`);
      }
      return (M.last = out);
    },
  };
  return M;
}
