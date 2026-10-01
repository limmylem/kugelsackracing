// Sample models for trying (and testing) the content pipeline: a spoiler and a five-spoke rim made to
// the rules, and broken ones — the same spoiler made in centimetres, one with its origin left where it
// sat on the car, one with every general mistake (a camera, a light, an unnamed material, no normals),
// and the starter car's body with its sockets misnamed.

import path from 'node:path';
import { Document } from '@gltf-transform/core';
import { KHRLightsPunctual } from '@gltf-transform/extensions';
import { ModelBuilder, box, extrude, lathe, rotated } from './shapes.mjs';
import { readModel } from './io.mjs';
import { ROOT } from './rules.mjs';

// A wing on two feet: 1.36 m wide, its origin at the bottom of the feet, in the middle (the feet start
// 6 mm up: the starter car's boot lid is crowned, 4.5 mm above its spoiler socket where they stand)
export async function sampleSpoiler({ finishes } = {}) {
  const m = new ModelBuilder(), lift = 0.006;
  const airfoil = [[0.2, 0.0], [0.19, 0.03], [0.1, 0.05], [-0.05, 0.045], [-0.15, 0.025], [-0.16, 0.0]].map(([z, y]) => [y, z]);
  m.add(extrude(airfoil.map(([y, z]) => [y + 0.2, z - 0.02]), -0.68, 0.68, 'x'), { material: 'paint', node: 'wing' });
  for (const side of [-1, 1]) {
    m.add(box([side * 0.44 - 0.02, lift, -0.06], [side * 0.44 + 0.02, 0.21, 0.06]), { colour: 'black', node: 'feet' });
    m.add(box([side * 0.44 - 0.05, lift, -0.09], [side * 0.44 + 0.05, lift + 0.012, 0.09]), { colour: 'black', node: 'feet' });
    m.add(box([side * 0.68 - (side > 0 ? 0.012 : 0), 0.16, -0.21], [side * 0.68 + (side < 0 ? 0.012 : 0), 0.31, 0.22]), { colour: 'black', node: 'end_plates' });
  }
  return m.document({ root: 'spoiler_ducktail', finishes });
}

// A 15" five-spoke rim (no tyre): its centre at the origin, turning round x, its face towards +x
export async function sampleRim({ finishes } = {}) {
  const m = new ModelBuilder(), R = 0.1905;
  // the barrel and its lips (a ring round x)
  m.add(lathe([[R - 0.02, -0.07], [R + 0.008, -0.07], [R + 0.008, -0.058], [R - 0.004, -0.052], [R - 0.004, 0.055], [R + 0.008, 0.062], [R + 0.008, 0.075], [R - 0.02, 0.075], [R - 0.02, -0.07]], 32, 'x'), { colour: 'silver', node: 'rim' });
  // the hub, and five spokes out to the barrel
  m.add(lathe([[0, 0.02], [0.06, 0.02], [0.06, 0.068], [0.03, 0.074], [0, 0.074]], 20, 'x'), { colour: 'silver', node: 'rim' });
  for (let i = 0; i < 5; i++) m.add(rotated(box([0.035, -0.022, 0.05], [0.062, 0.022, R - 0.012]), 'x', i * Math.PI * 2 / 5), { colour: 'silver', node: 'rim' });
  // wheel nuts
  for (let i = 0; i < 4; i++) m.add(rotated(box([0.068, -0.008, 0.035], [0.08, 0.008, 0.05]), 'x', Math.PI / 4 + i * Math.PI / 2), { colour: 'dark', node: 'rim' });
  return m.document({ root: 'rim_5spoke', finishes });
}

// A race wing: a wide carbon plane on swan-neck mounts, 1.5 m, its origin at the bottom of the feet
export async function sampleGtWing({ finishes } = {}) {
  const m = new ModelBuilder(), lift = 0.006, H = 0.34;
  const plane = [[0.16, 0], [0.15, 0.022], [0.06, 0.04], [-0.08, 0.035], [-0.16, 0.012], [-0.17, 0]].map(([z, y]) => [y + H, z - 0.04]);
  m.add(extrude(plane, -0.75, 0.75, 'x'), { material: 'carbon', node: 'wing' });
  m.add(extrude([[H + 0.045, -0.2], [H + 0.07, -0.2], [H + 0.07, -0.1], [H + 0.045, -0.1]], -0.74, 0.74, 'x'), { material: 'carbon', node: 'wing' });       // (the gurney flap)
  for (const side of [-1, 1]) {
    // swan necks: from the feet up and over, holding the wing from above
    m.add(box([side * 0.42 - 0.012, lift, -0.07], [side * 0.42 + 0.012, H + 0.09, -0.03]), { colour: 'black', node: 'mounts' });
    m.add(box([side * 0.42 - 0.012, H + 0.06, -0.07], [side * 0.42 + 0.012, H + 0.09, 0.02]), { colour: 'black', node: 'mounts' });
    m.add(box([side * 0.42 - 0.045, lift, -0.11], [side * 0.42 + 0.045, lift + 0.012, 0.0]), { colour: 'black', node: 'mounts' });
    m.add(box([side * 0.75 - (side > 0 ? 0.01 : 0), H - 0.05, -0.26], [side * 0.75 + (side < 0 ? 0.01 : 0), H + 0.12, 0.17]), { material: 'carbon', node: 'end_plates' });
  }
  return m.document({ root: 'wing_gt', finishes });
}

// The stock bonnet with two louvred vents on top
export async function sampleVentedBonnet({ finishes } = {}) {
  const doc = await readModel(path.join(ROOT, 'assets/parts/stock/starter_car/bonnet.glb')), m = new ModelBuilder();
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const z = 0.5 + i * 0.07;
    m.add(box([side * 0.3 - 0.17, 0.008, z], [side * 0.3 + 0.17, 0.022, z + 0.035]), { material: 'matte_black', node: 'vents' });
  }
  const top = doc.getRoot().listScenes()[0].listChildren()[0];
  await m.addTo(doc, top, { finishes });
  top.setName('bonnet_vented');
  return doc;
}

// The stock front bumper with a splitter under it
export async function sampleSplitterBumper({ finishes } = {}) {
  const doc = await readModel(path.join(ROOT, 'assets/parts/stock/starter_car/bumper_front.glb')), m = new ModelBuilder();
  m.add(box([-0.8, -0.118, -0.12], [0.8, -0.1, 0.16]), { material: 'carbon', node: 'splitter' });
  for (const side of [-1, 1]) m.add(box([side * 0.55 - 0.01, -0.1, -0.05], [side * 0.55 + 0.01, -0.06, 0.1]), { material: 'carbon', node: 'splitter' });
  const top = doc.getRoot().listScenes()[0].listChildren()[0];
  await m.addTo(doc, top, { finishes });
  top.setName('bumper_front_splitter');
  return doc;
}

// The broken ones: { file name → Document }
export async function brokenModels({ finishes } = {}) {
  const out = {};
  // made in centimetres: everything ×100
  const cm = await sampleSpoiler({ finishes });
  cm.getRoot().listScenes()[0].listChildren()[0].setScale([100, 100, 100]);
  out['spoiler_centimetres.glb'] = cm;
  // the origin left where it sat on the car (the boot, at the back of the car)
  const off = await sampleSpoiler({ finishes });
  off.getRoot().listScenes()[0].listChildren()[0].setTranslation([0.35, 0.95, -1.85]);
  out['spoiler_no_origin.glb'] = off;
  // every general mistake: a camera, a light, a material called Material.001, no normals
  const messy = await sampleSpoiler({ finishes });
  const r = messy.getRoot(), scene = r.listScenes()[0];
  scene.addChild(messy.createNode('Camera').setCamera(messy.createCamera('Camera').setType('perspective').setYFov(0.8).setZNear(0.1).setZFar(100)).setTranslation([2, 1, 3]));
  const lights = messy.createExtension(KHRLightsPunctual);
  scene.addChild(messy.createNode('Light').setExtension('KHR_lights_punctual', lights.createLight('Sun').setType('directional')));
  r.listMaterials().find(m => m.getName() === 'paint').setName('Material.001');
  for (const mesh of r.listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute('NORMAL', null);
  out['spoiler_messy.glb'] = messy;
  // the starter car's body, sockets misnamed: a typo, wrong capitals, and one left out
  const car = await readModel(path.join(ROOT, 'assets/cars/starter_car/body.glb'));
  const node = n => car.getRoot().listNodes().find(x => x.getName() === n);
  node('socket_wheel_FL').setName('socket_whel_FL');
  node('socket_mirror_right').setName('Socket_Mirror_Right');
  node('socket_wheel_RR').setTranslation(node('socket_wheel_RR').getTranslation().map((v, k) => k === 2 ? v + 0.06 : v));
  out['car_renamed_sockets.glb'] = car;
  return out;
}
export const emptyDocument = () => new Document();
