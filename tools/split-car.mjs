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
//    tyre from its tyre part's size, so the tyre is cut off here (its faces are the ones textured like
//    the tread) and its measured size is checked against the stock tyre and rim parts
// and sets each stock part's model and bounds (its extent in the socket's frame, for placeholders) in
// its data/parts file. Run it again whenever the source model changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, getBounds, prune } from '@gltf-transform/functions';
import { tyreFit } from '../garage/tyres.js';
import { formatJson } from './content/json.mjs';

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

// The part meshes: what hangs under each socket's node (its own name, or `node` — but not a socket
// drawn at another car.json socket, like a tyre on its wheel), by stock part
const nodeNamed = (doc, name) => doc.getRoot().listNodes().find(n => n.getName() === name);
const socketNames = new Set(car.sockets.map(s => s.name)), nodeOf = s => s.node ?? s.name;
const byPart = new Map();        // stock part id → { sockets: [their nodes], nodes: [the mesh nodes] }
for (const s of car.sockets) {
  if (s.node && socketNames.has(s.node)) continue;
  const node = nodeNamed(source, nodeOf(s)), stock = s.stock?.[0];
  if (!node || !stock || !node.listChildren().length) continue;
  if (node.listChildren().length > 1) console.warn(`  note: ${nodeOf(s)} holds ${node.listChildren().length} nodes; only ${node.listChildren()[0].getName()} goes in ${stock}'s model`);
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
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(path.join(root, file), bytes);
  written.push(`${file} (${(bytes.byteLength / 1024).toFixed(1)} KB)`);
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
  await write(doc, `${partsDir}/${name}.glb`);
  partUpdates[partId] = { model: `${partsDir}/${name}.glb`, bounds: { min: b.min.map(round), max: b.max.map(round) } };
}

// 3. the data: the car's body and each stock part's model and bounds
if (!dryRun) {
  setJson(carFile, c => { c.model.file = bodyOut; });
  for (const [id, u] of Object.entries(partUpdates)) {
    // (a part another car's model already draws — the same engine in two cars — keeps that model)
    const was = part(id).model;
    if (was && !was.startsWith(`${partsDir}/`)) { console.warn(`  note: ${id} is drawn with ${was} (another car's): kept; this car's is at ${u.model}`); delete partUpdates[id]; continue; }
    setJson(partFile[id], p => { p.model = u.model; p.bounds = u.bounds; });
  }
}
console.log(`${car.name}: split ${rel(path.join(root, car.model.source))}\n${written.map(w => `  ${w}`).join('\n')}\n${Object.entries(partUpdates).map(([id, u]) => `  ${id} → ${u.model}`).join('\n')}`);

// ---------- helpers ----------

function isUnder(n, top) { for (let x = n; x; x = x.getParentNode()) if (x === top) return true; return false; }
function disposeTree(n) { for (const c of n.listChildren()) disposeTree(c); n.dispose(); }

// Keep a wheel's rim only: the tyre is the triangles textured like the tread (the outermost vertices),
// every one of whose corners is. Checks the cut-off tyre's size against the stock rim and tyre parts.
function cutTyre(doc, node, partId, def, sockets) {
  const prim = node.getMesh().listPrimitives()[0];
  if (prim.getIndices()) throw new Error(`${partId}: an indexed wheel mesh isn't handled yet`);
  const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0')?.getArray();
  if (!UV) throw new Error(`${partId}: the wheel has no texture coordinates to tell its tyre by`);
  const n = P.length / 3, radius = i => Math.hypot(P[3 * i + 1], P[3 * i + 2]);
  let outer = 0; for (let i = 1; i < n; i++) if (radius(i) > radius(outer)) outer = i;
  const isTyre = i => Math.abs(UV[2 * i] - UV[2 * outer]) < 1e-4 && Math.abs(UV[2 * i + 1] - UV[2 * outer + 1]) < 1e-4;
  const keep = [], tyre = [];
  for (let t = 0; t < n / 3; t++) ([0, 1, 2].every(k => isTyre(3 * t + k)) ? tyre : keep).push(t);
  if (!tyre.length) { console.warn(`  note: ${partId}: found no tyre on the wheel to cut off`); return; }
  for (const semantic of prim.listSemantics()) {
    const acc = prim.getAttribute(semantic), size = acc.getElementSize(), src = acc.getArray();
    const out = new src.constructor(keep.length * 3 * size);
    keep.forEach((t, j) => out.set(src.subarray(t * 3 * size, (t + 1) * 3 * size), j * 3 * size));
    prim.setAttribute(semantic, doc.createAccessor().setType(acc.getType()).setArray(out).setBuffer(acc.getBuffer()).setNormalized(acc.getNormalized()));
  }
  // what was cut off, against the parts' sizes
  const verts = tyre.flatMap(t => [3 * t, 3 * t + 1, 3 * t + 2]), rs = verts.map(radius), xs = verts.map(i => Math.abs(P[3 * i]));
  const inner = Math.min(...rs), out = Math.max(...rs), width = 2 * Math.max(...xs);
  // (the stock tyre: the part in a socket drawn at this wheel's socket)
  const tyreSocket = car.sockets.find(s => s.node && sockets.includes(s.node) && s.stock?.length);
  const stockTyre = tyreSocket && part(tyreSocket.stock[0]);
  const fit = stockTyre?.tyreSize && tyreFit(def.rim, stockTyre.tyreSize);
  console.log(`  ${partId}: cut off the tyre (${tyre.length} of ${n / 3} triangles): rim ${(inner * 2 / 0.0254).toFixed(2)}", tyre ${(width * 1000).toFixed(0)} mm wide, ${(out * 1000).toFixed(1)} mm radius` +
    (fit ? ` — the parts say ${fit.label}: rim ${def.rim.diameter}", ${(fit.width * 1000).toFixed(0)} mm, ${(fit.radius * 1000).toFixed(1)} mm` : ''));
  if (fit && (Math.abs(fit.rimRadius - inner) > 0.003 || Math.abs(fit.radius - out) > 0.003 || Math.abs(fit.width - width) > 0.006))
    console.warn(`  note: the stock tyre and rim parts don't match the modelled wheel: the game's tyres won't look like the model's`);
}

function setJson(file, edit) {
  const full = path.join(root, file), text = fs.readFileSync(full, 'utf8'), obj = JSON.parse(text);
  edit(obj);
  fs.writeFileSync(full, formatJson(obj) + '\n');
}
