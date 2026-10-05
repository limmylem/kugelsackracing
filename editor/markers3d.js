// World content as markers in the 3D world, for the editor and the game alike: a post with a diamond on
// top and an arrow on the ground the way it faces, coloured by kind. However many items there are, only
// the nearest (up to max) are drawn, as instances of a few shared meshes — three draw calls for all of
// them — fading out with distance; the nearest few also get their name on a label (canvas textures, made
// as they come near and disposed as they leave). Nothing is made per item but its label.
//
//   const M = createMarkers3d({ THREE, parent, place: item → [x, y, z] (parent's frame) })
//   M.setItems(items)                 the items near (as the content service gives them)
//   M.update(cameraPos)               each frame: fades, which are drawn, labels
//   M.pick(raycaster) → id | null     M.select(id)    M.stats    M.dispose()

const COLOURS = { quest: 0xffb02e, poi: 0x4fc3f7, spawn: 0x7ee08a, route: 0xe05cff, series: 0xffd166, venue: 0xff5a5f };
const SELECTED = 0xff3d3d;

export function createMarkers3d({ THREE, parent, place, max = 1500, near = 250, far = 2500, labels = 16, labelDist = 400, scale = 1 }) {
  const group = new THREE.Group();
  group.name = 'world-content';
  parent.add(group);
  // shared shapes (a marker's own size: 1 = 7 m tall)
  const post = new THREE.CylinderGeometry(0.12, 0.12, 6, 6).translate(0, 3, 0);
  const head = new THREE.OctahedronGeometry(1.1, 0).translate(0, 7, 0);
  const tri = new THREE.Shape(); tri.moveTo(0, 2.6); tri.lineTo(1.1, -0.6); tri.lineTo(0, 0); tri.lineTo(-1.1, -0.6); tri.closePath();
  const arrow = new THREE.ShapeGeometry(tri).rotateX(-Math.PI / 2).translate(0, 0.25, 0);
  // per-instance fade (an attribute the material multiplies its alpha by)
  const fading = mat => { mat.transparent = true; mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = instanceAlpha;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vAlpha;');
  }; return mat; };
  const make = (geo, mat) => {
    const m = new THREE.InstancedMesh(geo, fading(mat), max);
    m.count = 0; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    geo.setAttribute('instanceAlpha', new THREE.InstancedBufferAttribute(new Float32Array(max), 1));
    group.add(m);
    return m;
  };
  const posts = make(post, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const heads = make(head, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const arrows = make(arrow, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false }));
  const meshes = [posts, heads, arrows];

  let items = [], placed = [], shown = [], selected = null;
  const labelOf = new Map();               // id → { sprite, texture, name }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();

  function label(it) {
    let L = labelOf.get(it.id);
    if (L && L.name === it.name) return L;
    if (L) dropLabel(it.id);
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 48) : (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: 256, height: 48 }) : null);
    let texture;
    if (cv?.getContext) {
      const g = cv.getContext('2d');
      g.fillStyle = 'rgba(15,20,30,.78)'; g.beginPath(); g.roundRect?.(0, 4, 256, 40, 12); g.fill();
      g.fillStyle = '#fff'; g.font = '600 22px Barlow, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(it.name.length > 22 ? `${it.name.slice(0, 21)}…` : it.name, 128, 25);
      texture = new THREE.CanvasTexture(cv);
    } else texture = new THREE.Texture();            // (no canvas: the tests)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set(16 * scale, 3 * scale, 1); sprite.renderOrder = 5;
    group.add(sprite);
    L = { sprite, texture, name: it.name };
    labelOf.set(it.id, L);
    return L;
  }
  function dropLabel(id) { const L = labelOf.get(id); if (!L) return; group.remove(L.sprite); L.texture.dispose(); L.sprite.material.dispose(); labelOf.delete(id); }

  return {
    group,
    setItems(list) { items = list; placed = list.map(it => ({ it, p: place(it) })).filter(x => x.p); },
    select(id) { selected = id; },
    // which are drawn (the nearest, faded with distance), and the nearest few's labels
    update(cam) {
      const near2 = [];
      for (const x of placed) { const d = Math.hypot(x.p[0] - cam.x, x.p[1] - cam.y, x.p[2] - cam.z); if (d < far || x.it.id === selected) near2.push({ x, d }); }
      if (near2.length > max) near2.sort((a, b) => a.d - b.d).length = max;
      shown = near2.map(n => n.x.it.id);
      for (const m of meshes) m.count = near2.length;
      const alphaOf = m => m.geometry.getAttribute('instanceAlpha').array;
      const [aPost, aHead, aArrow] = meshes.map(alphaOf);
      near2.forEach(({ x, d }, k) => {
        const sel = x.it.id === selected, s = (sel ? 1.35 : 1) * scale * Math.max(1, d / 600);
        q.setFromAxisAngle(up, -(x.it.location?.heading ?? 0) * Math.PI / 180);
        m4.compose(v.set(x.p[0], x.p[1], x.p[2]), q, one.set(s, s, s));
        for (const m of meshes) m.setMatrixAt(k, m4);
        c.setHex(sel ? SELECTED : COLOURS[x.it.kind] ?? 0xcccccc);
        if (x.it.status === 'draft') c.lerp(new THREE.Color(0xffffff), 0.35);
        for (const m of meshes) m.setColorAt(k, c);
        const a = sel ? 1 : d <= near ? 1 : Math.max(0, 1 - (d - near) / (far - near));
        aPost[k] = a; aHead[k] = a; aArrow[k] = a;
      });
      for (const m of meshes) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.geometry.getAttribute('instanceAlpha').needsUpdate = true; }
      // labels: the nearest few within labelDist
      const want = new Set(near2.filter(n => n.d < labelDist || n.x.it.id === selected).sort((a, b) => a.d - b.d).slice(0, labels).map(n => n.x.it.id));
      for (const id of [...labelOf.keys()]) if (!want.has(id)) dropLabel(id);
      for (const { x, d } of near2) {
        if (!want.has(x.it.id)) continue;
        const L = label(x.it), s = scale * Math.max(1, d / 600);
        L.sprite.position.set(x.p[0], x.p[1] + 9.5 * s, x.p[2]);
        L.sprite.scale.set(16 * s, 3 * s, 1);
        L.sprite.material.opacity = x.it.id === selected ? 1 : Math.max(0.2, 1 - d / labelDist);
      }
    },
    pick(raycaster) {
      let best = null;
      for (const m of [heads, posts]) for (const h of raycaster.intersectObject(m, false)) if (h.instanceId != null && (!best || h.distance < best.distance)) best = h;
      return best ? shown[best.instanceId] ?? null : null;
    },
    get stats() { return { items: placed.length, drawn: posts.count, labels: labelOf.size, drawCalls: meshes.length + labelOf.size }; },
    dispose() {
      for (const id of [...labelOf.keys()]) dropLabel(id);
      for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); m.dispose?.(); }
      parent.remove(group);
    },
  };
}
