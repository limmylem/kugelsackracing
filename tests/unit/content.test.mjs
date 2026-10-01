// Unit tests for the content pipeline (tools/content): the model checker on good and broken models, the
// auto-fixer (never losing a socket), importing into a copy of the game's data (a part, a broken model,
// a car), icons, the variant generator's stable ids and retiring, and the balance report.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { checkModel } from '../../tools/content/check.mjs';
import { autoFix } from '../../tools/content/fix.mjs';
import { inspect } from '../../tools/content/inspect.mjs';
import { modelIO, readModel } from '../../tools/content/io.mjs';
import { renderIcon } from '../../tools/content/icon.mjs';
import { importFile } from '../../tools/content/importer.mjs';
import { loadProject } from '../../tools/content/project.mjs';
import { ROOT, loadRules, typeFromName } from '../../tools/content/rules.mjs';
import { brokenModels, sampleRim, sampleSpoiler } from '../../tools/content/samples.mjs';
import { ModelBuilder, box } from '../../tools/content/shapes.mjs';
import { planVariants, writeVariants } from '../../tools/content/variants.mjs';
import { addToIndex } from '../../tools/content/importer.mjs';
import { writeJson } from '../../tools/content/json.mjs';
import { balanceRows } from '../../tools/content/balance.mjs';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';

const project = await loadProject(), rules = loadRules(), { finishes } = rules;
const check = (doc, type, extra = {}) => checkModel(inspect(doc), { rules, type, db: project.db, knownSockets: project.knownSockets, file: 'x.glb', estimateMass: true, ...extra });
const failed = r => r.findings.filter(f => f.level === 'fail');
const broken = await brokenModels({ finishes });
// a scratch copy of the game's data (and a place for imports to write), thrown away after
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-world-content-'));
  fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'incoming'));
  return dir;
}
const writeGlb = async (doc, file) => fs.writeFileSync(file, await (await modelIO()).writeBinary(doc));

test('file names say what a model is', () => {
  assert.equal(typeFromName('spoiler_ducktail.glb', rules), 'spoiler');
  assert.equal(typeFromName('incoming/rim_5spoke.glb', rules), 'rim');
  assert.equal(typeFromName('bumper_front_lip.glb', rules), 'bumper_front');
  assert.equal(typeFromName('wing_gt.glb', rules), 'spoiler');
  assert.equal(typeFromName('car_roadster.glb', rules), 'car');
  assert.equal(typeFromName('thing.glb', rules), null);
});

test('the checker: good models pass; every model the game uses passes', async () => {
  assert.equal(check(await sampleSpoiler({ finishes }), 'spoiler').verdict, 'pass');
  assert.equal(check(await sampleRim({ finishes }), 'rim').verdict, 'pass');
  const body = await readModel(path.join(ROOT, 'assets/cars/starter_car/body.glb'));
  assert.equal(check(body, 'car', { car: project.db.cars.starter_car }).verdict, 'pass');
});

test('the checker catches a broken model and says how to fix it: wrong scale, no origin, renamed sockets, and the rest', () => {
  let r = check(broken['spoiler_centimetres.glb'], 'spoiler');
  assert.deepEqual(failed(r).map(f => f.check), ['size']);
  assert.match(failed(r)[0].text, /100× too big, so it was probably made in centimetres/);
  assert.match(failed(r)[0].fix, /--scale 0\.01/);

  r = check(broken['spoiler_no_origin.glb'], 'spoiler');
  assert.deepEqual(failed(r).map(f => f.check), ['origin']);
  assert.match(failed(r)[0].text, /its bottom is 0\.95\d* m above the origin/);
  assert.match(failed(r)[0].text, /as if the origin was left at the scene's centre/);
  assert.match(failed(r)[0].fix, /--place-origin/);

  r = check(broken['spoiler_messy.glb'], 'spoiler');
  assert.deepEqual(failed(r).map(f => f.check).sort(), ['extras', 'materials', 'normals']);
  assert.match(failed(r).find(f => f.check === 'extras').text, /1 camera and 1 light/);
  assert.match(failed(r).find(f => f.check === 'materials').text, /"Material\.001"/);

  r = check(broken['car_renamed_sockets.glb'], 'car', { car: project.db.cars.starter_car });
  const texts = failed(r).map(f => f.text).join('\n');
  assert.match(texts, /"socket_whel_FL" .* probably socket_wheel_FL misspelled/);
  assert.match(texts, /"Socket_Mirror_Right" .* probably socket_mirror_right \(the capitals are different\)/);
  assert.match(texts, /socket_wheel_RL and socket_wheel_RR don't mirror each other/);
  assert.ok(failed(r).every(f => f.fix), 'every problem says how to fix it');
});

test('the checker: a car facing the wrong way, and its wheels off the ground', async () => {
  const body = await readModel(path.join(ROOT, 'assets/cars/starter_car/body.glb'));
  body.getRoot().listScenes()[0].listChildren()[0].setRotation([0, 1, 0, 0]);       // turned 180°
  let r = check(body, 'car', { car: project.db.cars.starter_car });
  assert.ok(failed(r).some(f => f.check === 'axes' && /faces −Z/.test(f.text)));
  const low = await readModel(path.join(ROOT, 'assets/cars/starter_car/body.glb'));
  for (const k of ['FL', 'FR', 'RL', 'RR']) { const n = low.getRoot().listNodes().find(x => x.getName() === `socket_wheel_${k}`); n.setTranslation(n.getTranslation().map((v, i) => i === 1 ? v + 0.08 : v)); }
  r = check(low, 'car', { car: project.db.cars.starter_car });
  assert.match(failed(r).find(f => f.check === 'wheels').text, /would float 0\.08\d? m above the ground/);
});

test('the fixer: removes what a game model mustn\'t have, keeps every empty socket node where it was, compresses', async () => {
  const body = await readModel(path.join(ROOT, 'assets/cars/starter_car/body.glb'));
  const before = inspect(body).sockets.map(s => [s.name, s.position.map(v => +v.toFixed(5))]);
  const did = await autoFix(body, { rules, type: 'car' });
  assert.ok(did.includes('compressed the geometry (meshopt)'));
  // (written and read back: the sockets survive pruning and compression)
  const back = await (await modelIO()).readBinary(await (await modelIO()).writeBinary(body));
  assert.deepEqual(inspect(back).sockets.map(s => [s.name, s.position.map(v => +v.toFixed(5))]), before);
  assert.ok(back.getRoot().listExtensionsUsed().some(e => e.extensionName === 'EXT_meshopt_compression'));

  const messy = broken['spoiler_messy.glb'];
  const fixed = await autoFix(messy, { rules, type: 'spoiler', materials: { 'Material.001': 'paint' } });
  assert.ok(fixed.some(d => /removed 1 camera, 1 light/.test(d)) && fixed.some(d => /added normals/.test(d)));
  assert.equal(check(messy, 'spoiler').verdict, 'pass');
  assert.ok(!messy.getRoot().listNodes().some(n => /Camera|Light/.test(n.getName())), 'the camera and light nodes go too');

  const cm = broken['spoiler_centimetres.glb'];
  await autoFix(cm, { rules, type: 'spoiler', scale: 0.01 });
  assert.equal(check(cm, 'spoiler').verdict, 'pass');
  const off = broken['spoiler_no_origin.glb'];
  await autoFix(off, { rules, type: 'spoiler', placeOrigin: true });
  assert.equal(check(off, 'spoiler').verdict, 'pass');
});

test('the fixer: surfaces textured in the paint colour go into the paint material', async () => {
  const m = new ModelBuilder();
  m.add(box([-0.7, 0, -0.1], [0.7, 0.05, 0.1]), { colour: 'green', node: 'lid' });     // (#3dae6a: "the paint")
  m.add(box([-0.2, 0.05, -0.05], [0.2, 0.1, 0.05]), { colour: 'black', node: 'lid' });
  const doc = await m.document({ root: 'spoiler_lip' });
  const did = await autoFix(doc, { rules, type: 'spoiler', paint: { colour: '#3dae6a', tolerance: 30 }, compress: false });
  assert.ok(did.some(d => /put 12 triangles textured like #3dae6a in the "paint" material/.test(d)), did.join('; '));
  const mats = inspect(doc).primitives.map(p => `${p.material}:${p.triangles}`).sort();
  assert.deepEqual(mats, ['car_atlas:12', 'paint:12']);
});

test('icons: a transparent PNG of the model, the icon size', async () => {
  const png = await renderIcon(await sampleRim({ finishes }), { rules, type: 'rim' });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [256, 256, 4]);
  assert.equal(data[3], 0, 'the corner is transparent');
  const mid = (128 * 256 + 128) * 4 + 3;
  assert.ok(data.filter((v, i) => i % 4 === 3 && v === 255).length > 256 * 256 * 0.2, 'the rim fills a good part of it');
  assert.ok(data[mid] >= 0);
});

test('importing a part: model, icon and a starting definition with its price and stats to do; the original moves; importing again keeps what was filled in', async () => {
  const root = scratch();
  try {
    const file = path.join(root, 'incoming/spoiler_test_lip.glb');
    await writeGlb(await sampleSpoiler({ finishes }), file);
    const r = await importFile(file, await loadProject(root));
    assert.ok(r.ok, r.message);
    assert.equal(r.id, 'spoiler_test_lip');
    assert.equal(r.part.name, 'Test lip spoiler');
    for (const f of ['assets/parts/aero/spoiler_test_lip.glb', 'assets/icons/parts/spoiler_test_lip.png', 'data/parts/aero/spoiler_test_lip.json']) assert.ok(fs.existsSync(path.join(root, f)), f);
    assert.ok(fs.existsSync(path.join(root, 'incoming/imported/spoiler_test_lip.glb')) && !fs.existsSync(file));
    const after = await loadProject(root), part = after.db.parts.spoiler_test_lip;
    assert.deepEqual(after.problems, [], 'the new part file is valid');
    assert.deepEqual(part.todo, ['price', 'aero']);
    assert.equal(part.slot, 'spoiler');
    assert.ok(part.mass > 1 && part.mass < 25, `${part.mass}`);
    assert.deepEqual(part.bounds.min.map(v => +v.toFixed(3)), [-0.68, 0.006, -0.21]);
    // the model in the game's format, compressed, and it still passes
    const model = await readModel(path.join(root, part.model));
    assert.ok(model.getRoot().listExtensionsUsed().some(e => e.extensionName === 'EXT_meshopt_compression'));
    assert.equal(check(model, 'spoiler').verdict, 'pass');
    // filled in, then the model imported again: the price stays
    const def = JSON.parse(fs.readFileSync(path.join(root, 'data/parts/aero/spoiler_test_lip.json')));
    fs.writeFileSync(path.join(root, 'data/parts/aero/spoiler_test_lip.json'), JSON.stringify({ ...def, price: 520, todo: undefined }));
    await writeGlb(await sampleSpoiler({ finishes }), file);
    const again = await importFile(file, await loadProject(root));
    assert.ok(again.ok && again.notes.some(n => /already a part/.test(n)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/parts/aero/spoiler_test_lip.json'))).price, 520);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('importing a broken model: it stays in incoming/ and nothing is written', async () => {
  const root = scratch();
  try {
    const file = path.join(root, 'incoming/spoiler_thing.glb');
    const doc = (await brokenModels({ finishes }))['spoiler_messy.glb'];     // (a material the fixer can't name for itself)
    await writeGlb(doc, file);
    const r = await importFile(file, await loadProject(root));
    assert.equal(r.ok, false);
    assert.match(r.message, /still has problems/);
    assert.ok(fs.existsSync(file));
    assert.ok(!fs.existsSync(path.join(root, 'data/parts/aero/spoiler_thing.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('importing a car: its car.json from the starter car\'s, its own body parts, split into body and part models', async () => {
  const root = scratch();
  try {
    fs.cpSync(path.join(ROOT, 'assets'), path.join(root, 'assets'), { recursive: true });
    const file = path.join(root, 'incoming/car_twin.glb');
    fs.copyFileSync(path.join(ROOT, 'data/cars/starter_car/starter_car_v2.glb'), file);
    const r = await importFile(file, await loadProject(root));
    assert.ok(r.ok, r.message);
    const after = await loadProject(root), car = after.db.cars.twin;
    assert.deepEqual(after.problems, []);
    assert.equal(car.model.file, 'assets/cars/twin/body.glb');
    assert.ok(fs.existsSync(path.join(root, 'assets/cars/twin/body.glb')));
    assert.ok(car.sockets.find(s => s.name === 'socket_bonnet').stock[0] === 'stock_bonnet_twin');
    assert.equal(after.db.parts.stock_bonnet_twin.model, 'assets/parts/stock/twin/bonnet_twin.glb');
    // (the starter car's shared parts keep their own models)
    assert.equal(after.db.parts.stock_wheel_15.model, 'assets/parts/stock/starter_car/wheel_stock.glb');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('variants: every combination with a predictable id, prices and stats by the table\'s rules; ids never change, dropped variants are retired', async () => {
  const root = scratch();
  try {
    const table = {
      base: 'stock_wheel_15', id: '{base}_{finish}_{tier}', name: '15" wheel, {finish} ({tier})', price: { base: 100, round: 5 },
      groups: {
        finish: { chrome: { priceFactor: 1.5, look: { finish: 'chrome' } }, black: { name: 'satin black', look: { finish: 'matte_black' } } },
        tier: { cast: {}, forged: { priceFactor: 2, multiply: { mass: 0.75 }, set: { tier: 'race' } } },
      },
    };
    const io = { writeJson, addToIndex };
    let p = await loadProject(root);
    const plan = planVariants(table, p.db).plan;
    assert.deepEqual(plan.map(x => x.id), ['stock_wheel_15_chrome_cast', 'stock_wheel_15_chrome_forged', 'stock_wheel_15_black_cast', 'stock_wheel_15_black_forged']);
    const forged = plan.find(x => x.id === 'stock_wheel_15_chrome_forged').part;
    assert.equal(forged.price, 300);
    assert.equal(forged.mass, 5.25);
    assert.equal(forged.tier, 'race');
    assert.equal(forged.variantOf, 'stock_wheel_15');
    assert.deepEqual(forged.look, { finish: 'chrome' });
    assert.equal(plan.find(x => x.id === 'stock_wheel_15_black_cast').part.name, '15" wheel, satin black (cast)');
    let r = writeVariants(table, { root, db: p.db, tableId: 'test_wheels' }, io);
    assert.equal(r.made.length, 4);
    p = await loadProject(root);
    assert.deepEqual(p.problems, []);
    // again: nothing changes
    r = writeVariants(table, { root, db: p.db, tableId: 'test_wheels' }, io);
    assert.equal(r.unchanged.length, 4);
    // a finish dropped: its variants are retired, not deleted; the rest keep their ids
    delete table.groups.finish.black;
    p = await loadProject(root);
    r = writeVariants(table, { root, db: p.db, tableId: 'test_wheels' }, io);
    assert.deepEqual(r.retired.sort(), ['stock_wheel_15_black_cast', 'stock_wheel_15_black_forged']);
    p = await loadProject(root);
    assert.equal(p.db.parts.stock_wheel_15_black_cast.retired, true);
    assert.ok(p.db.parts.stock_wheel_15_chrome_cast && !p.db.parts.stock_wheel_15_chrome_cast.retired);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the balance report: what each part does on the starter car, what it needs first, and what\'s unfinished', () => {
  const db = structuredClone(project.db);
  db.parts.test_todo = { ...db.parts.cold_air_intake, id: 'test_todo', todo: ['price'] };
  const { rows } = balanceRows(db);
  const intake = rows.find(r => r.id === 'cold_air_intake');
  assert.ok(intake.power > 0 && intake.perHp > 0);
  assert.ok(rows.find(r => r.id === 'test_todo').flags.some(f => /to do: price/.test(f)));
  const turbo = rows.find(r => r.id === 'turbo_kit');
  assert.ok(turbo.fits, turbo.flags.join('; '));
  assert.ok(turbo.needs.length, 'a turbo is fitted with what it needs');
});

test('the shop doesn\'t sell a part whose price and stats are still to do', async () => {
  const db = structuredClone(project.db);
  db.parts.cold_air_intake.todo = ['price'];
  const service = new LocalPlayerService({ db, storage: new MemoryStorage() });
  await service.init();
  const r = await service.buyPart('cold_air_intake');
  assert.equal(r.ok, false);
  assert.match(r.error, /isn't for sale yet: its price is still to be filled in/);
});
