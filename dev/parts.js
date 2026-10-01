// The part preview (dev/parts.html): every part by category (variants under their base), searchable;
// one part alone or fitted to any car at its socket (its variants a click away); sockets, wireframe,
// bounds and triangle counts; paint and finish tests; and a fit check — whether the part's mesh cuts
// into the car's body or the other parts fitted.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Garage, loadGarageData } from '../garage/data.js';
import { ModelCache, createCarVisual, finishMaterial, placeholderBox, placeholderWing, resolveLook, setEnvironment, skyEnvironment, tyreModel } from '../garage/visual.js';
import { tyreFit } from '../garage/tyres.js';
import { iconFor } from '../garage/workshop.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const icon = (n, extra = '') => `<span class="icon" ${extra}>${n}</span>`;
const readJson = async f => { const r = await fetch(`../${f}`, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); };
const { db, problems } = await loadGarageData(readJson);
if (problems.length) console.warn('data problems', problems);
const rules = await readJson('data/content/model-rules.json').catch(() => null);

// ---------- the 3D view ----------
const view = $('view'), renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
view.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.02, 200);
scene.background = new THREE.Color('#15191d');
const env = skyEnvironment(renderer);
setEnvironment(env);
scene.environment = env;
scene.add(new THREE.HemisphereLight('#dfe8f0', '#2a2d31', 1.1));
const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(3, 6, 4); scene.add(sun);
const grid = new THREE.GridHelper(10, 40, '#3a424b', '#262c33'); scene.add(grid);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const models = new ModelCache();
const resize = () => { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// ---------- state ----------
const ui = { part: null, mode: 'alone', car: Object.keys(db.cars)[0], q: '', sockets: false, wire: false, bounds: false, stats: true, paint: '#6d9a91', paintFinish: 'gloss', partFinish: '' };
let shown = null;          // { group, dispose(), triangles, visual, targets, fit }
let token = 0;

for (const c of Object.values(db.cars)) $('car').add(new Option(c.name, c.id));
for (const [id, f] of Object.entries(db.finishes)) {
  if (['gloss', 'matte', 'metallic', 'pearl'].includes(id)) $('paintFinish').add(new Option(f.name ?? id, id));
  $('partFinish').add(new Option(f.name ?? id, id));
}

// ---------- the list ----------
function drawList() {
  const q = ui.q.trim().toLowerCase(), parts = Object.values(db.parts);
  const match = p => !q || p.name.toLowerCase().includes(q) || p.id.includes(q) || p.category.includes(q);
  const cats = [...new Set(parts.map(p => p.category))].sort();
  const row = (p, variant) => `<button class="item ${ui.part === p.id ? 'on' : ''} ${variant ? 'variant' : ''}" data-part="${p.id}" title="${esc(p.id)}">
      ${p.icon ? `<img src="../${esc(p.icon)}" alt="" loading="lazy">` : `<span class="ph">${icon(iconFor(p.slot === 'wheels' ? 'wheel' : p.slot))}</span>`}
      <span class="nm">${esc(p.name)}</span>${p.todo?.length ? '<span class="tag">TO DO</span>' : p.retired ? '<span class="tag" style="color:var(--c-text-3)">RETIRED</span>' : ''}</button>`;
  $('list').innerHTML = cats.map(cat => {
    const inCat = parts.filter(p => p.category === cat), bases = inCat.filter(p => !p.variantOf || !db.parts[p.variantOf] || db.parts[p.variantOf].category !== cat);
    const rows = bases.flatMap(b => { const vs = inCat.filter(p => p.variantOf === b.id && p !== b); return (match(b) || vs.some(match)) ? [row(b, false), ...vs.filter(match).map(v => row(v, true))] : []; });
    return rows.length ? `<div class="cat"><div class="label">${esc(cat)} · ${inCat.length}</div>${rows.join('')}</div>` : '';
  }).join('') || '<div class="secondary-text">No parts match.</div>';
}
$('list').addEventListener('click', e => { const b = e.target.closest('[data-part]'); if (b) pick(b.dataset.part); });
$('search').addEventListener('input', e => { ui.q = e.target.value; drawList(); });

// ---------- controls ----------
$('mode').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (!b) return; ui.mode = b.dataset.mode; for (const x of $('mode').children) x.classList.toggle('on', x === b); show(); });
$('car').addEventListener('change', e => { ui.car = e.target.value; show(); });
for (const k of ['sockets', 'wire', 'bounds', 'stats']) $(k).addEventListener('change', e => { ui[k] = e.target.checked; applyToggles(); });
$('paint').addEventListener('input', e => { ui.paint = e.target.value; restyle(); });
$('paintFinish').addEventListener('change', e => { ui.paintFinish = e.target.value; restyle(); });
$('partFinish').addEventListener('change', e => { ui.partFinish = e.target.value; show(); });

function pick(id) {
  ui.part = id;
  const url = new URL(location.href); url.searchParams.set('part', id); history.replaceState(null, '', url);
  drawList(); show();
}

// ---------- showing a part ----------
async function show() {
  const part = db.parts[ui.part], my = ++token;
  if (!part) return;
  shown?.dispose(); shown = null;
  for (const h of fitMarks.splice(0)) { h.removeFromParent(); h.geometry.dispose(); }
  const look = partLook(part);
  const s = ui.mode === 'car' ? await onCar(part, look, my) : await alone(part, look, my);
  if (!s || my !== token) { s?.dispose(); return; }
  shown = s;
  scene.add(s.group);
  frame(s.focus ?? s.group);
  applyToggles();
  drawInfo(part, look);
  if (ui.mode === 'car') runFitCheck();
}
// its look, with the finish being tried
function partLook(part) {
  const r = resolveLook(part, db.parts);
  if (ui.partFinish) r.look = { ...(r.look ?? {}), finish: ui.partFinish };
  return r;
}

// alone: the model (or its tyre, or placeholder) at the origin, its socket's frame
async function alone(part, { model, bounds, placeholder, look }, my) {
  const group = new THREE.Group();
  let obj, url = null;
  if (part.tyreSize) obj = tyreModel(tyreFit({ diameter: 15, width: 6 }, part.tyreSize));
  else if (model) { url = model; obj = await models.acquire(`../${model}`).catch(err => { console.error(err); url = null; return placeholderBox(bounds, true); }); }
  else if (placeholder?.width) obj = placeholderWing(placeholder);
  else obj = placeholderBox(bounds, false);
  if (my !== token) { if (url) models.release(`../${url}`); return null; }
  style(obj, look);
  group.add(obj);
  return { group, focus: obj, dispose: () => { group.removeFromParent(); if (url) models.release(`../${url}`); }, targets: [], note: model ? null : part.tyreSize ? 'A tyre is made to fit its rim (drawn here on a 15" rim).' : 'No model: drawn as its placeholder.' };
}
// materials as the game draws them: the paint in the paint colour and finish, the part's look over it
function style(obj, look) {
  obj.traverse(o => {
    if (!o.isMesh || o.userData.owned) return;
    o.userData.source ??= o.material;
    const one = src => {
      const per = look?.materials?.[src.name] ?? {}, finish = per.finish ?? look?.finish, colour = per.colour ?? look?.colour;
      if (src.name === 'paint' && !finish && !colour) return finishMaterial(src, db.finishes[ui.paintFinish], ui.paint);
      if (finish || colour) return finishMaterial(src, db.finishes[finish], colour ?? (src.name === 'paint' && !db.finishes[finish]?.colour ? ui.paint : undefined));
      return src;
    };
    o.material = Array.isArray(o.userData.source) ? o.userData.source.map(one) : one(o.userData.source);
  });
  if (look?.scale) { const k = look.scale; obj.scale.set(...(typeof k === 'number' ? [k, k, k] : k)); }
}

// on a car: its stock build, with the part in its socket(s) — fitted properly if it can be, else put
// there anyway with why it wouldn't go on
async function onCar(part, look, my) {
  const car = db.cars[ui.car], g = new Garage(db, null, car.id), r = g.install(part.id, { auto: true });
  let build = g.build, owned = g.state.parts, targets = g.socketsFor(part.id);
  if (!r.ok) {
    const id = 'preview_copy', sockets = { ...g.build.sockets };
    owned = { ...g.state.parts, [id]: { instanceId: id, partId: part.id, condition: 100 } };
    for (const s of targets) sockets[s] = id;
    build = { ...g.build, sockets };
  }
  const paint = { colour: ui.paint, finish: ui.paintFinish };
  const visual = await createCarVisual({ car: { ...car, model: { ...car.model, file: `../${car.model.file}` } }, finishes: db.finishes, models: { acquire: (k, make) => models.acquire(k.startsWith('../') || k.startsWith('tyre:') ? k : `../${k}`, make), release: k => models.release(k.startsWith('../') || k.startsWith('tyre:') ? k : `../${k}`) }, paint });
  // (the part being tried in another finish: its look, just here)
  const parts = ui.partFinish ? { ...db.parts, [part.id]: { ...part, look: { ...(part.look ?? {}), finish: ui.partFinish } } } : db.parts;
  await visual.applyBuild(build, { parts, owned });
  if (my !== token) { visual.dispose(); return null; }
  const focus = targets.map(s => visual.partObject(s)).filter(Boolean);
  return { group: visual.group, visual, focus: focus[0] ? focus : visual.group, targets, fitted: r, dispose: () => { visual.dispose(); } };
}

function frame(target) {
  const box = new THREE.Box3();
  for (const t of [target].flat()) box.expandByObject(t);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.25, box.getSize(new THREE.Vector3()).length() / 2);
  const whole = ui.mode === 'car' ? new THREE.Box3().setFromObject(shown?.group ?? target) : box;
  const car = whole.getSize(new THREE.Vector3()).length() / 2;
  controls.target.copy(c);
  const d = (ui.mode === 'car' ? Math.max(r * 3.2, car * 0.9) : r * 2.6) / Math.tan(camera.fov * Math.PI / 360);
  camera.position.copy(c).add(new THREE.Vector3(0.9, 0.55, 1.1).normalize().multiplyScalar(d));
  camera.near = d / 100; camera.far = d * 20; camera.updateProjectionMatrix();
  grid.position.y = ui.mode === 'car' ? 0 : box.min.y;
}

// ---------- toggles ----------
const helpers = [], fitMarks = [];
function applyToggles() {
  for (const h of helpers.splice(0)) { h.removeFromParent(); h.geometry?.dispose(); }
  if (!shown) return;
  const objs = ui.mode === 'car' ? [shown.visual.root] : [shown.group];
  for (const o of objs) o.traverse(m => { if (m.isMesh) for (const mat of [m.material].flat()) mat.wireframe = ui.wire; });
  if (ui.mode === 'car') shown.visual.showSockets(ui.sockets);
  else if (ui.sockets) { const a = new THREE.AxesHelper(0.25); a.material.depthTest = false; a.renderOrder = 999; scene.add(a); helpers.push(a); }
  if (ui.bounds) for (const t of [shown.focus].flat()) { const b = new THREE.Box3Helper(new THREE.Box3().setFromObject(t), '#ffd27a'); scene.add(b); helpers.push(b); }
  hud();
}
function restyle() { if (!shown) return; if (ui.mode === 'car') shown.visual.setPaint({ colour: ui.paint, finish: ui.paintFinish }); else style(shown.focus, partLook(db.parts[ui.part]).look); }
function triangles(obj) { let n = 0; for (const o of [obj].flat()) o?.traverse(m => { if (m.isMesh && m.visible) n += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; }); return Math.round(n); }
function hud() {
  if (!ui.stats || !shown) { $('hud').style.display = 'none'; return; }
  $('hud').style.display = '';
  const part = db.parts[ui.part], t = triangles(shown.focus), type = rules && Object.entries(rules.types).find(([, x]) => x.slot === part.slot);
  const size = new THREE.Box3(); for (const o of [shown.focus].flat()) size.expandByObject(o);
  const s = size.getSize(new THREE.Vector3());
  $('hud').textContent = `${t.toLocaleString('en-GB')} triangles${type ? ` (budget ${type[1].triangles.toLocaleString('en-GB')})` : ''}${ui.mode === 'car' ? ` · whole car ${triangles(shown.visual.root).toLocaleString('en-GB')}` : ''}\n${s.x.toFixed(3)} × ${s.y.toFixed(3)} × ${s.z.toFixed(3)} m`;
}

// ---------- the details ----------
function drawInfo(part, { model, look }) {
  $('title').textContent = part.name;
  $('where').textContent = `${part.category} · ${part.slot}${part.tier ? ` · ${part.tier}` : ''}`;
  const base = part.variantOf ? db.parts[part.variantOf] : part, family = [base, ...Object.values(db.parts).filter(p => p.variantOf === base.id && p !== base)];
  const fit = shown?.fitted;
  const notes = [];
  if (part.todo?.length) notes.push(['warn', 'pending', `To do: ${part.todo.join(', ')}. The shop lists it but won't sell it yet.`]);
  if (part.retired) notes.push(['warn', 'inventory_2', 'Retired: not sold any more; owned copies still work.']);
  if (shown?.note) notes.push(['', 'info', shown.note]);
  if (ui.mode === 'car') {
    if (fit?.ok) notes.push(['good', 'check_circle', `Goes on the ${db.cars[ui.car].name}${fit.ops?.some(o => o.op === 'remove' && !shown.targets.includes(o.socket)) ? ' (taking off what\'s in the way, then putting it back)' : ''}.`]);
    else if (fit) notes.push(['bad', 'block', `Wouldn't go on the ${db.cars[ui.car].name}: ${fit.errors[0]?.message ?? '?'} Shown in its socket anyway.`]);
  }
  $('info').innerHTML = `
    ${part.icon ? `<img class="big-icon" src="../${esc(part.icon)}" alt="">` : ''}
    <div class="kv"><span>id</span><span>${esc(part.id)}</span><span>price</span><span>$${part.price.toLocaleString('en-GB')}</span><span>mass</span><span>${part.mass} kg</span>
      <span>model</span><span>${esc(model || '—')}${part.variantOf ? ` (of ${esc(part.variantOf)})` : ''}</span><span>look</span><span>${esc(look ? JSON.stringify(look) : '—')}</span>
      <span>fits</span><span>${esc((part.fits ?? []).flat().join(', ') || '—')}</span><span>requires</span><span>${esc((part.requires ?? []).flat().join(', ') || '—')}</span></div>
    ${notes.map(([k, ic, t]) => `<div class="note ${k}">${icon(ic)}<span>${esc(t)}</span></div>`).join('')}
    ${family.length > 1 ? `<div class="label">Variants · ${family.length}</div><div class="chips">${family.map(p => `<button class="chip ${p.id === part.id ? 'on' : ''}" data-part="${p.id}">${esc(p.name.replace(base.name, '').replace(/^[,\s]+/, '') || 'base')}</button>`).join('')}</div>` : ''}
    <div id="fit"></div>`;
  $('info').querySelectorAll('[data-part]').forEach(b => b.onclick = () => pick(b.dataset.part));
}

// ---------- the fit check ----------
// The part's triangles against everything else on the car (not what it hangs with: a rim's own tyre):
// an edge of one passing through the other by more than a few millimetres is a clash
const TOL = 0.003;
function runFitCheck() {
  const el = $('fit'), s = shown;
  if (!el || !s?.visual) return;
  const mine = [s.focus].flat().filter(o => o?.isObject3D);
  if (!mine.length) { el.innerHTML = '<div class="note">' + icon('info') + '<span>Nothing drawn for this part: no fit check.</span></div>'; return; }
  s.visual.group.updateMatrixWorld(true);
  const partTris = mine.flatMap(o => { const list = []; o.traverse(m => { if (m.isMesh && isShown(m)) list.push(...trianglesOf(m)); }); return list; });
  const box = new THREE.Box3(); for (const t of partTris) for (const p of t.p) box.expandByPoint(p);
  box.expandByScalar(0.01);
  const skip = new Set(mine), homes = new Set(mine.map(o => o.parent));
  const others = [];
  s.visual.root.traverse(o => {
    if (!o.isMesh || !o.visible || [...skip].some(m => isUnder(o, m)) || o.name.startsWith('gizmo')) return;
    if ([...homes].some(h => isUnder(o, h))) return;          // (what hangs on the same wheel: its tyre)
    if (!isShown(o)) return;
    for (const t of trianglesOf(o)) if (t.box.intersectsBox(box)) others.push({ ...t, owner: ownerName(o, s.visual) });
  });
  const hits = new Map(), bad = [];
  for (const a of partTris) {
    let hit = false;
    for (const b of others) {
      if (!a.box.intersectsBox(b.box)) continue;
      if (crosses(a.p, b.p) || crosses(b.p, a.p)) { hits.set(b.owner, (hits.get(b.owner) ?? 0) + 1); hit = true; }
    }
    if (hit) bad.push(a);
  }
  // the clashing triangles in red
  if (bad.length) {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(bad.flatMap(t => t.p.flatMap(p => [p.x, p.y, p.z])), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ff3b3b', depthTest: false, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    m.renderOrder = 997; scene.add(m); fitMarks.push(m);
  }
  el.innerHTML = `<div class="label">Fit check</div>` + (hits.size
    ? `<div class="note warn">${icon('warning')}<span>Cuts into ${[...hits].map(([n, k]) => `${esc(n)} (${k} triangle${k > 1 ? 's' : ''})`).join(', ')}. The part's clashing faces are red.</span></div>`
    : `<div class="note good">${icon('check_circle')}<span>Clear: it doesn't cut into the body or the other parts (${partTris.length} of its triangles against ${others.length} nearby).</span></div>`);
}
function trianglesOf(o) {
  const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count, out = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const p = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld));
    out.push({ p, box: new THREE.Box3().setFromPoints(p) });
  }
  return out;
}
// an edge of triangle a passing through triangle b (not just touching it)
function crosses(a, b) {
  const n = new THREE.Vector3().subVectors(b[1], b[0]).cross(new THREE.Vector3().subVectors(b[2], b[0]));
  if (n.lengthSq() < 1e-14) return false;
  n.normalize();
  const d = n.dot(b[0]);
  for (let k = 0; k < 3; k++) {
    const p = a[k], q = a[(k + 1) % 3], dp = n.dot(p) - d, dq = n.dot(q) - d;
    if (dp * dq >= 0 || Math.min(Math.abs(dp), Math.abs(dq)) < TOL) continue;
    const x = new THREE.Vector3().lerpVectors(p, q, dp / (dp - dq));
    if (inside(x, b)) return true;
  }
  return false;
}
function inside(x, [a, b, c]) {
  const v0 = new THREE.Vector3().subVectors(c, a), v1 = new THREE.Vector3().subVectors(b, a), v2 = new THREE.Vector3().subVectors(x, a);
  const d00 = v0.dot(v0), d01 = v0.dot(v1), d02 = v0.dot(v2), d11 = v1.dot(v1), d12 = v1.dot(v2), inv = 1 / (d00 * d11 - d01 * d01);
  const u = (d11 * d02 - d01 * d12) * inv, v = (d00 * d12 - d01 * d02) * inv;
  return u > 0.01 && v > 0.01 && u + v < 0.99;
}
const isUnder = (o, top) => { for (let x = o; x; x = x.parent) if (x === top) return true; return false; };
const isShown = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
function ownerName(o, visual) {
  for (const [socket, e] of visual.attached) if (e.object && isUnder(o, e.object)) return e.part?.name ?? socket;
  return `the body (${o.name || o.parent?.name || 'mesh'})`;
}

drawList();
const first = new URL(location.href).searchParams.get('part');
pick(first && db.parts[first] ? first : Object.values(db.parts).find(p => resolveLook(p, db.parts).model)?.id ?? Object.keys(db.parts)[0]);
