// Checks every car and part file (npm run check): each against its JSON schema (data/schemas), then
// what a schema can't see — the index files list every file, ids match their files, stock parts go in
// their sockets, blockedBy names real sockets, a component carries at most one system block, every
// modifier's targets exist, the model has the sockets and nodes the car names (and its sockets are where
// car.json puts them), every part's model file is there, what parts hide exists, the split models
// aren't older than their source (npm run build:car), and every car's stock build is valid. Exits
// with code 1 if anything is wrong.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Garage, SCHEMAS, loadGarageData } from '../garage/data.js';
import { SYSTEM_BLOCKS, getPath } from '../garage/stats.js';
import { takes } from '../garage/validate.js';
import { modelRig, socketsFromGlb } from '../physics/sockets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const problems = [], warnings = [];

let loaded;
try { loaded = await loadGarageData(readJson); } catch (e) { console.error(`Couldn't load the data: ${e.message}`); process.exit(1); }
const { db } = loaded;
problems.push(...loaded.problems);

// the index files list exactly the files there are
const files = (dir, test) => fs.readdirSync(path.join(root, dir), { recursive: true }).map(String).filter(test).map(f => f.split(path.sep).join('/')).sort();
const listed = { cars: (await readJson('data/cars/index.json')).cars.slice().sort(), parts: (await readJson('data/parts/index.json')).parts.slice().sort() };
const onDisk = { cars: files('data/cars', f => f.endsWith('/car.json')), parts: files('data/parts', f => f.endsWith('.json') && f !== 'index.json') };
for (const kind of ['cars', 'parts']) {
  for (const f of onDisk[kind]) if (!listed[kind].includes(f)) {
    problems.push({ file: `data/${kind}/index.json`, path: kind, message: `doesn't list ${f}` });
    // (and check the unlisted file too, so its own problems show up now)
    const file = `data/${kind}/${f}`;
    try { for (const e of loaded.validator.validate(kind === 'cars' ? 'car.schema.json' : 'part.schema.json', await readJson(file))) problems.push({ file, path: e.path, message: e.message }); }
    catch (e) { problems.push({ file, path: '', message: `isn't valid JSON: ${e.message}` }); }
  }
  for (const f of listed[kind]) if (!onDisk[kind].includes(f)) problems.push({ file: `data/${kind}/index.json`, path: kind, message: `lists ${f}, which isn't there` });
}

for (const part of Object.values(db.parts)) {
  const file = `data/parts/${part.category}/${part.id}.json`, blocks = SYSTEM_BLOCKS.filter(b => part[b]).concat(part.aero ? ['aero'] : []);
  if (blocks.length > 1) problems.push({ file, path: '', message: `carries ${blocks.join(' and ')}: a component carries one system block` });
  // its model (or its base part's) is there
  if (part.model && !fs.existsSync(path.join(root, part.model))) problems.push({ file, path: 'model', message: `${part.model} isn't there` });
  for (const [carId, v] of Object.entries(part.byCar ?? {})) {
    if (!fs.existsSync(path.join(root, v.model))) problems.push({ file, path: `byCar.${carId}.model`, message: `${v.model} isn't there` });
    if (!db.cars[carId]) problems.push({ file, path: `byCar.${carId}`, message: `there's no car "${carId}"` });
  }
  if (part.tyre && !part.tyreSize) warnings.push({ file, path: 'tyreSize', message: 'a tyre with no size can\'t be drawn' });
}

// engines' sound configs: each against its schema, for an engine there is, every file it names there
// (npm run sounds makes them); every engine's sound config there
const soundDir = 'data/sounds/engines', soundConfigs = fs.existsSync(path.join(root, soundDir)) ? files(soundDir, f => f.endsWith('.json')) : [];
for (const f of soundConfigs) {
  const file = `${soundDir}/${f}`, cfg = await readJson(file);
  for (const e of loaded.validator.validate('engine-sound.schema.json', cfg)) problems.push({ file, path: e.path, message: e.message });
  if (!db.parts[cfg.engine]?.engine) problems.push({ file, path: 'engine', message: `names ${cfg.engine}, which isn't an engine part` });
  const named = [...(cfg.layers ?? []).flatMap(L => [L.on, L.off]), cfg.intake?.file, cfg.shift?.file, cfg.limiter?.file, cfg.damage?.bang, cfg.damage?.bent].filter(Boolean);
  const missing = named.filter(n => !fs.existsSync(path.join(root, n)));
  if (missing.length) problems.push({ file, path: 'layers', message: `${missing.length} of its sound files aren't there (npm run sounds makes them): ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}` });
  (cfg.layers ?? []).forEach((L, i) => { if (i && L.rpm <= cfg.layers[i - 1].rpm) problems.push({ file, path: `layers.${i}.rpm`, message: 'the rpm points go up in order' }); });
}
// the crash sounds: against their schema, every file there
{
  const file = 'data/sounds/crash.json', cfg = await readJson(file);
  for (const e of loaded.validator.validate('crash-sound.schema.json', cfg)) problems.push({ file, path: e.path, message: e.message });
  { const file = 'data/sounds/mechanical.json', cfg = await readJson(file); for (const e of loaded.validator.validate('mechanical-sound.schema.json', cfg)) problems.push({ file, path: e.path, message: e.message }); }
  const named = [...Object.values(cfg.impacts ?? {}).flatMap(c => Object.values(c).flat()), ...Object.values(cfg.scrape?.files ?? {}), ...(cfg.glass?.files ?? []), ...(cfg.light?.files ?? []), ...(cfg.tear?.files ?? []), ...Object.values(cfg.clatter?.files ?? {}).flat(), ...(cfg.rattle ? [cfg.rattle.file] : [])];
  const missing = named.filter(n => !fs.existsSync(path.join(root, n)));
  if (missing.length) problems.push({ file, path: 'impacts', message: `${missing.length} of its sound files aren't there (npm run sounds makes them): ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}` });
  for (const m of Object.values(cfg.materials ?? {})) if (!cfg.impacts?.[m]) problems.push({ file, path: 'materials', message: `sounds like "${m}", which has no impacts` });
}
for (const part of Object.values(db.parts)) if (part.engine?.sound && !fs.existsSync(path.join(root, part.engine.sound))) problems.push({ file: `data/parts/${part.category}/${part.id}.json`, path: 'engine.sound', message: `${part.engine.sound} isn't there` });

for (const car of Object.values(db.cars)) {
  const file = `data/cars/${car.id}/car.json`, names = car.sockets.map(s => s.name);
  for (const s of car.sockets) {
    if (names.indexOf(s.name) !== names.lastIndexOf(s.name)) problems.push({ file, path: `sockets.${s.name}`, message: 'is listed twice' });
    for (const b of s.blockedBy) if (!names.includes(b)) problems.push({ file, path: `sockets.${s.name}.blockedBy`, message: `names ${b}, which isn't a socket` });
    for (const id of s.stock) if (db.parts[id] && !takes(car, s, db.parts[id])) problems.push({ file, path: `sockets.${s.name}.stock`, message: `${id} is ${db.parts[id].slot}, not ${s.slot}` });
    if (s.required && !s.stock.length) warnings.push({ file, path: `sockets.${s.name}`, message: 'is required but has no stock part' });
  }
  // the model: its file, the sockets and nodes the car names, and socket positions that match the nodes
  const glbFile = path.join(root, car.model.file);
  if (!fs.existsSync(glbFile)) problems.push({ file, path: 'model.file', message: `${car.model.file} isn't there` });
  else {
    const glb = fs.readFileSync(glbFile), buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
    try { socketsFromGlb(buf, car.model); } catch (e) { problems.push({ file, path: 'model.sockets', message: e.message }); }
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, new DataView(buf).getUint32(12, true))));
    const nodeNames = new Set(json.nodes.map(n => n.name));
    if (car.model.steeringWheel && !nodeNames.has(car.model.steeringWheel)) problems.push({ file, path: 'model.steeringWheel', message: `the model has no node "${car.model.steeringWheel}"` });
    try { modelRig(buf, car.model); } catch (e) { problems.push({ file, path: 'model.sockets', message: e.message }); }
    if (car.model.paintMaterial && !json.materials?.some(m => m.name === car.model.paintMaterial)) problems.push({ file, path: 'model.paintMaterial', message: `the model has no material "${car.model.paintMaterial}"` });
    // a socket the model has must be where the model has it (parts' mass sits at the position)
    for (const s of car.sockets.filter(s => nodeNames.has(s.name))) {
      const at = socketsFromGlb(buf, { ...car.model, sockets: { at: s.name } }).at;
      if (Math.hypot(...at.map((v, k) => v - s.position[k])) > 0.001) problems.push({ file, path: `sockets.${s.name}.position`, message: `is [${s.position.join(', ')}] but the model has it at [${at.map(v => +v.toFixed(4)).join(', ')}]` });
    }
    // a socket marked mirrored is the one the model turns 180° round y (and the other way round)
    for (const s of car.sockets.filter(s => nodeNames.has(s.name))) {
      const r = json.nodes.find(n => n.name === s.name).rotation ?? [0, 0, 0, 1], turned = Math.abs(Math.abs(r[1]) - 1) < 1e-6;
      if (!!s.mirrored !== turned) problems.push({ file, path: `sockets.${s.name}.mirrored`, message: turned ? 'the model turns this socket 180° round y: mark it mirrored' : 'the model doesn\'t turn this socket round: it isn\'t mirrored' });
    }
    const missing = car.sockets.filter(s => !nodeNames.has(s.node ?? s.name)).map(s => s.name);
    if (missing.length) warnings.push({ file, path: 'sockets', message: `the model has no nodes yet for ${missing.length} sockets (parts there are drawn at their car.json position): ${missing.join(', ')}` });
    const unused = [...nodeNames].filter(n => n.startsWith('socket_') && !car.sockets.some(s => s.name === n || s.node === n) && !Object.values(car.model.sockets).includes(n) && n !== car.model.steeringWheel);
    if (unused.length) warnings.push({ file, path: 'sockets', message: `the model has ${unused.length} sockets the car doesn't use yet: ${unused.join(', ')}` });
    // where parts are drawn: a socket's node is in the model or another socket; what parts hide is there
    const socketNames = new Set(car.sockets.map(s => s.name));
    for (const s of car.sockets) if (s.node && !nodeNames.has(s.node) && !socketNames.has(s.node)) problems.push({ file, path: `sockets.${s.name}.node`, message: `the model has no node "${s.node}"` });
    for (const part of Object.values(db.parts)) for (const h of part.hides || [])
      if (!socketNames.has(h) && !nodeNames.has(h)) warnings.push({ file: `data/parts/${part.category}/${part.id}.json`, path: 'hides', message: `"${h}" is neither a socket nor a node of ${car.name}'s model` });
    // the split models are older than the model they're made from: run the build again
    const source = car.model.source && path.join(root, car.model.source);
    if (source && !fs.existsSync(source)) problems.push({ file, path: 'model.source', message: `${car.model.source} isn't there` });
    else if (source && fs.statSync(source).mtimeMs > fs.statSync(glbFile).mtimeMs + 1000) warnings.push({ file, path: 'model.file', message: `${car.model.source} is newer than ${car.model.file}: run npm run build:car -- ${car.id}` });
  }
  // every car's stock build is valid, and every modifier aims at something in its spec
  const garage = new Garage(db, null, car.id), result = garage.validate();
  for (const e of result.errors) problems.push({ file, path: 'stock build', message: e.message });
  for (const w of result.warnings) warnings.push({ file, path: 'stock build', message: w.message });
  const spec = result.stats?.spec;
  if (spec) {
    for (const part of Object.values(db.parts)) {
      const pf = `data/parts/${part.category}/${part.id}.json`;
      for (const [i, e] of (part.effects || []).entries())
        if (getPath(spec, e.target) === undefined) problems.push({ file: pf, path: `effects[${i}].target`, message: `${e.target} isn't in ${car.name}'s spec` });
      // a setting's targets are there (in the spec, or the part's own block once fitted)
      for (const [name, t] of Object.entries(part.tuning || {})) for (const [i, a] of t.apply.entries())
        if (a.target && getPath(spec, a.target) === undefined && getPath(part, a.target) === undefined) problems.push({ file: pf, path: `tuning.${name}.apply[${i}].target`, message: `${a.target} isn't in ${car.name}'s spec` });
    }
    for (const [category, list] of Object.entries(db.condition.categories)) for (const [i, c] of list.entries())
      if (getPath(spec, c.target) === undefined) problems.push({ file: 'data/condition.json', path: `categories.${category}[${i}].target`, message: `${c.target} isn't in ${car.name}'s spec` });
  }
}

const nParts = Object.keys(db.parts).length, nCars = Object.keys(db.cars).length;
for (const w of warnings) console.log(`  note  ${w.file}${w.path ? ` · ${w.path}` : ''}: ${w.message}`);
for (const p of problems) console.log(`  ERROR ${p.file}${p.path ? ` · ${p.path}` : ''}: ${p.message}`);
const counts = `${nCars} car${nCars > 1 ? 's' : ''}, ${nParts} parts`;
console.log(problems.length ? `\n${problems.length} problem${problems.length > 1 ? 's' : ''} in the data (${counts})` : `\nAll data files are valid: ${counts}, ${Object.keys(db.finishes).length} finishes, ${SCHEMAS.length} schemas`);
process.exit(problems.length ? 1 : 0);
