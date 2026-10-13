// Splits a car's source model into the body and one model per stock part, so the game can put the car
// together from its parts (garage/visual.js):
//
//   npm run build:car -- starter_car          (node tools/split-car.mjs <carId> [--dry-run])
//
// Reads data/cars/<carId>/car.json: model.source is the whole car as modelled, with each part's mesh
// under its socket node. Writes
//  - assets/cars/<carId>/body.glb: the body shell, glass, lights, dashboard and every socket node,
//    with the part meshes taken out of the sockets (car.json model.file points at it)
//  - assets/parts/stock/<carId>/<name>.glb: each stock part's mesh, at the origin of its socket, with
//    its materials and the shared texture. Sockets that hold the same part share one file (the four
//    wheels: wheel_stock.glb; both seats: seat.glb). Wheels are the rim only: the game makes each
//    tyre from its tyre part's size, so the tyre is cut off here (its own primitive in the "rubber" material — as
//    docs/car_prompts.md asks for — or else its faces are the ones textured like the tread) and its measured size is
//    checked against the stock tyre and rim parts
// and sets each stock part's model and bounds (its extent in the socket's frame, for placeholders) in
// its data/parts file. Each model written is finished (tools/content/finish.mjs: its levels of detail, its big
// textures compressed), and a stock part that can come off in a crash gets its collision hulls. Run it again
// whenever the source model changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, getBounds, prune, unweldPrimitive } from '@gltf-transform/functions';
import { tyreFit } from '../garage/tyres.js';
import { formatJson } from './content/json.mjs';
import { loadRules } from './content/rules.mjs';
import { finishModel } from './content/finish.mjs';
import { collisionHulls } from './content/collision.mjs';
import { inspect } from './content/inspect.mjs';

// (--root: another copy of the game's folders, e.g. a test's)
const args = process.argv.slice(2), rootArg = args.indexOf('--root');
const root = rootArg >= 0 ? path.resolve(args[rootArg + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const carId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root'), dryRun = args.includes('--dry-run');
if (!carId) { console.error('usage: node tools/split-car.mjs <carId> [--dry-run] [--root dir]'); process.exit(2); }
const rel = p => path.relative(root, p).split(path.sep).join('/');
const readJson = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const carFile = `data/cars/${carId}/car.json`, car = readJson(carFile);
const partIndex = readJson('data/parts/index.json').parts, partFile = Object.fromEntries(partIndex.map(f => [path.basename(f, '.json'), `data/parts/${f}`]));
const part = id => readJson(partFile[id]);
if (!car.model.source) { console.error(`${carFile} has no model.source (the whole car as modelled) to split`); process.exit(2); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const quiet = doc => doc.setLogger(new Logger(Logger.Verbosity.WARN));
const source = quiet(await io.read(path.join(root, car.model.source)));
const bodyOut = `assets/cars/${carId}/body.glb`, partsDir = `assets/parts/stock/${carId}`;
const round = v => +v.toFixed(4);
const rules = loadRules(root);

// The part meshes: what hangs under each socket's node (its own name, or `node` — but not a socket
// drawn at another car.json socket, like a tyre on its wheel), by stock part
const nodeNamed = (doc, name) => doc.getRoot().listNodes().find(n => n.getName() === name);
const socketNames = new Set(car.sockets.map(s => s.name)), nodeOf = s => s.node ?? s.name;
const byPart = new Map();        // stock part id → { sockets: [their nodes], nodes: [the mesh nodes] }
for (const s of car.sockets) {
  if (s.node && socketNames.has(s.node)) continue;
  const node = nodeNamed(source, nodeOf(s)), stock = s.stock?.[0];
  if (!node || !stock || !node.listChildren().length) continue;
  // (a part made of several nodes straight under its socket — a rim and its tyre side by side — gathered into one)
  if (node.listChildren().length > 1) {
    const group = source.createNode(`${nodeOf(s).replace(/^socket_/, '')}_part`);
    for (const c of node.listChildren()) { node.removeChild(c); group.addChild(c); }
    node.addChild(group);
    console.log(`  ${nodeOf(s)}: its ${group.listChildren().length} nodes gathered into ${group.getName()} (${stock}'s model)`);
  }
  const e = byPart.get(stock) ?? { sockets: [], nodes: [] };
  e.sockets.push(nodeOf(s)); e.nodes.push(node.listChildren()[0].getName());
  byPart.set(stock, e);
}
// (socket nodes in the model that hold a mesh with no stock part to go in: they stay in the body)
const claimed = new Set([...byPart.values()].flatMap(e => e.sockets));
for (const n of source.getRoot().listNodes()) if (n.getName().startsWith('socket_') && n.listChildren().length && !claimed.has(n.getName()))
  console.warn(`  note: ${n.getName()} holds ${n.listChildren().map(c => c.getName()).join(', ')} but no car.json socket has a stock part for it: it stays in the body`);

const written = [];
async function write(doc, file) {
  await doc.transform(prune({ keepLeaves: true }));   // (empty socket nodes are the point of the body)
  if (dryRun) { written.push(`${file} (not written: --dry-run)`); return; }
  const did = await finishModel(doc, { rules });
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(path.join(root, file), bytes);
  written.push(`${file} (${(bytes.byteLength / 1024).toFixed(1)} KB${did.length ? `; ${did.join('; ')}` : ''})`);
}

// 1. the body: the source without the part meshes
{
  const doc = quiet(cloneDocument(source));
  for (const e of byPart.values()) for (const s of e.sockets) for (const c of nodeNamed(doc, s).listChildren()) disposeTree(c);
  await write(doc, bodyOut);
}

// 2. each stock part, alone at the origin of its socket
const partUpdates = {};
for (const [partId, e] of byPart) {
  const doc = quiet(cloneDocument(source)), node = nodeNamed(doc, e.nodes[0]);
  // sockets sharing a part should hold the same mesh
  for (const other of e.nodes.slice(1)) {
    const a = node.getMesh(), b = nodeNamed(doc, other).getMesh();
    if (a && b && a !== b && !a.equals(b)) console.warn(`  note: ${partId} is in ${e.sockets.join(', ')}, but ${other}'s mesh differs from ${e.nodes[0]}'s: using ${e.nodes[0]}'s`);
  }
  const def = part(partId);
  const name = e.nodes.length > 1 ? (node.getMesh()?.getName() || partId.replace(/^stock_/, '')) : partId.replace(/^stock_/, '');
  const scene = doc.getRoot().listScenes()[0];
  for (const c of scene.listChildren()) scene.removeChild(c);
  scene.addChild(node);                    // (keeps its own transform: it was relative to the socket)
  node.setName(name);
  for (const n of doc.getRoot().listNodes()) if (!isUnder(n, node)) n.dispose();
  for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
  if (def.rim) cutTyre(doc, node, partId, def, e.sockets);
  const b = getBounds(scene);
  const collision = def.detach?.detachable && rules.collision ? await collisionHulls(inspect(doc).triangles, rules.collision) : null;
  await write(doc, `${partsDir}/${name}.glb`);
  partUpdates[partId] = { model: `${partsDir}/${name}.glb`, bounds: { min: b.min.map(round), max: b.max.map(round) }, ...(collision ? { collision } : {}) };
}

// 3. the data: the car's body and each stock part's model and bounds
if (!dryRun) {
  setJson(carFile, c => { c.model.file = bodyOut; });
  for (const [id, u] of Object.entries(partUpdates)) {
    // (a part another car's model already draws — the same engine in two cars — keeps that model)
    const was = part(id).model;
    if (was && !was.startsWith(`${partsDir}/`)) { console.warn(`  note: ${id} is drawn with ${was} (another car's): kept; this car's is at ${u.model}`); delete partUpdates[id]; continue; }
    setJson(partFile[id], p => { p.model = u.model; p.bounds = u.bounds; if (u.collision) p.collision = u.collision; });
  }
}
console.log(`${car.name}: split ${rel(path.join(root, car.model.source))}\n${written.map(w => `  ${w}`).join('\n')}\n${Object.entries(partUpdates).map(([id, u]) => `  ${id} → ${u.model}`).join('\n')}`);

// ---------- helpers ----------

function isUnder(n, top) { for (let x = n; x; x = x.getParentNode()) if (x === top) return true; return false; }
function disposeTree(n) { for (const c of n.listChildren()) disposeTree(c); n.dispose(); }

// Keep a wheel's rim only: the tyre is its primitives in the "rubber" material (a model made from docs/car_prompts.md),
// or else the triangles textured like the tread (the outermost vertices), every one of whose corners is. Checks the
// cut-off tyre's size against the stock rim and tyre parts.
function cutTyre(doc, node, partId, def, sockets) {
  // (every mesh in the wheel — it may be a group: the rim and the tyre each a mesh of their own — with where it is in the
  // wheel's frame)
  const meshes = [];
  const walk = (n, m) => { if (n.getMesh()) meshes.push({ mesh: n.getMesh(), m }); for (const c of n.listChildren()) walk(c, mul4(m, c.getMatrix())); };
  walk(node, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const rubber = meshes.flatMap(({ mesh, m }) => mesh.listPrimitives().filter(p => /^(rubber|tyre|tire)$/i.test(p.getMaterial()?.getName() ?? '')).map(p => ({ mesh, m, p })));
  let tyreAt, tyreTris;              // (the tyre's corners, for its size: flat [x, y, z, …]; its triangles)
  if (rubber.length) {
    tyreAt = rubber.flatMap(({ m, p }) => { const a = p.getAttribute('POSITION').getArray(), out = []; for (let i = 0; i < a.length; i += 3) out.push(...apply4(m, a[i], a[i + 1], a[i + 2])); return out; });
    tyreTris = rubber.reduce((n, { p }) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
    for (const { mesh, p } of rubber) { mesh.removePrimitive(p); p.dispose(); }
  } else {
    if (!node.getMesh()) throw new Error(`${partId}: the wheel's tyre must be in the "rubber" material (or the wheel one mesh, its tyre textured like the tread)`);
    const mesh = node.getMesh(), prim = mesh.listPrimitives()[0];
    if (prim.getIndices()) unweldPrimitive(prim);
    const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0')?.getArray();
    if (!UV) throw new Error(`${partId}: the wheel has no texture coordinates to tell its tyre by (or model the tyre in the "rubber" material)`);
    const n = P.length / 3, radius = i => Math.hypot(P[3 * i + 1], P[3 * i + 2]);
    let outer = 0; for (let i = 1; i < n; i++) if (radius(i) > radius(outer)) outer = i;
    const isTyre = i => Math.abs(UV[2 * i] - UV[2 * outer]) < 1e-4 && Math.abs(UV[2 * i + 1] - UV[2 * outer + 1]) < 1e-4;
    const keep = [], tyre = [];
    for (let t = 0; t < n / 3; t++) ([0, 1, 2].every(k => isTyre(3 * t + k)) ? tyre : keep).push(t);
    if (!tyre.length) { console.warn(`  note: ${partId}: found no tyre on the wheel to cut off`); return; }
    tyreAt = tyre.flatMap(t => Array.from(P.subarray(9 * t, 9 * t + 9))); tyreTris = tyre.length;
    for (const semantic of prim.listSemantics()) {
      const acc = prim.getAttribute(semantic), size = acc.getElementSize(), src = acc.getArray();
      const out = new src.constructor(keep.length * 3 * size);
      keep.forEach((t, j) => out.set(src.subarray(t * 3 * size, (t + 1) * 3 * size), j * 3 * size));
      prim.setAttribute(semantic, doc.createAccessor().setType(acc.getType()).setArray(out).setBuffer(acc.getBuffer()).setNormalized(acc.getNormalized()));
    }
  }
  // what was cut off, against the parts' sizes
  const rs = [], xs = [];
  for (let i = 0; i < tyreAt.length; i += 3) { rs.push(Math.hypot(tyreAt[i + 1], tyreAt[i + 2])); xs.push(Math.abs(tyreAt[i])); }
  const inner = Math.min(...rs), out = Math.max(...rs), width = 2 * Math.max(...xs);
  // (the stock tyre: the part in a socket drawn at this wheel's socket)
  const tyreSocket = car.sockets.find(s => s.node && sockets.includes(s.node) && s.stock?.length);
  const stockTyre = tyreSocket && part(tyreSocket.stock[0]);
  const fit = stockTyre?.tyreSize && tyreFit(def.rim, stockTyre.tyreSize);
  console.log(`  ${partId}: cut off the tyre (${tyreTris} triangles${rubber.length ? ', its rubber' : ''}): rim ${(inner * 2 / 0.0254).toFixed(2)}", tyre ${(width * 1000).toFixed(0)} mm wide, ${(out * 1000).toFixed(1)} mm radius` +
    (fit ? ` — the parts say ${fit.label}: rim ${def.rim.diameter}", ${(fit.width * 1000).toFixed(0)} mm, ${(fit.radius * 1000).toFixed(1)} mm` : ''));
  if (fit && (Math.abs(fit.rimRadius - inner) > 0.003 || Math.abs(fit.radius - out) > 0.003 || Math.abs(fit.width - width) > 0.006))
    console.warn(`  note: the stock tyre and rim parts don't match the modelled wheel: the game's tyres won't look like the model's`);
}

// (column-major 4×4 matrices: a·b, and a point through one)
function mul4(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function apply4(m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; }

function setJson(file, edit) {
  const full = path.join(root, file), text = fs.readFileSync(full, 'utf8'), obj = JSON.parse(text);
  edit(obj);
  fs.writeFileSync(full, formatJson(obj) + '\n');
}
