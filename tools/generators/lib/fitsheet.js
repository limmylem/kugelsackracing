// The fit sheet: every car with generated parts on it, as the game would build it — each part fitted
// through the garage (its fits, requires and sockets, as in the shop), then drawn where the game draws
// it: on its socket, a car's own version where it has one, tyres made to fit the rims, brake kits at
// every wheel inside the rim. Two views outside (front, back) and a cutaway (no roof or bonnet: the
// cabin and the engine bay), so how they fit can be looked over (docs/generated_fit.png).

import path from 'node:path';
import { mergeDocuments } from '@gltf-transform/functions';
import sharp from 'sharp';
import { Garage } from '../../../garage/data.js';
import { partShape } from '../../../garage/partShape.js';
import { resolveLook } from '../../../garage/visual.js';
import { tyreFit } from '../../../garage/tyres.js';
import { renderIcon } from '../../content/icon.mjs';
import { readModel } from '../../content/io.mjs';
import { fitWithNeeds } from '../../content/balance.mjs';
import { ModelBuilder, lathe } from '../../content/shapes.mjs';
import { ROOT } from '../../content/rules.mjs';

const TILE = 430;
// What goes on each car to look at: [outside, cutaway] — the first of each list that fits (the game decides)
const OUTSIDE = [
  ['wheels', ['rim_offroad6_18', 'rim_beadlock_17_black', 'rim_mesh20_20', 'rim_star7_19', 'rim_twist5_18', 'rim_split5_17', 'rim_rally']],
  ['brakes', ['brakes_race']],
  ['spoiler', ['{car}_gt_wing', '{car}_rear_wing', '{car}_roof_wing', '{car}_active_wing', '{car}_wing', 'basic_wing']],
  ['front_lip', ['{car}_front_lip', '{car}_front_splitter']], ['canards', ['{car}_canards']], ['mud_flaps', ['{car}_mud_flaps']], ['aero_kit', ['{car}_aero_kit']],
  ['fog_lights', ['fog_lights_round']], ['exhaust', ['catback_quad']],
  ['bull_bar', ['{car}_bull_bar']], ['winch', ['{car}_winch']], ['snorkel', ['{car}_snorkel']], ['roof_rack', ['{car}_roof_rack']], ['light_bar', ['{car}_light_bar']],
  ['rock_sliders', ['{car}_rock_sliders']], ['lift_kit', ['{car}_lift_kit_4in']], ['rally_lights', ['{car}_rally_lights']],
];
const CUTAWAY = [
  ['roll_cage', ['roll_cage_welded']], ['seat', ['bucket_seat_race']], ['steering_wheel', ['steering_wheel_flat_race']], ['gauges', ['gauge_pod']], ['harness', ['race_harness']], ['shifter', ['short_shifter']],
  ['strut_brace', ['strut_brace']], ['forced induction', ['{car}_supercharger', '{car}_turbo_kit', '{car}_big_turbo', 'turbo_large']], ['intercooler', ['intercooler_race']], ['radiator', ['radiator_race']], ['intake', ['intake_filter_street']],
  ['brakes', ['brakes_sport']], ['wheels', ['rim_meshdish_17', 'rim_10spoke_19', 'rim_monoblock_20', 'rim_6spoke_16']],
];
const HIDE_IN_CUTAWAY = new Set(['bonnet', 'boot', 'door_left', 'door_right', 'roof', 'engine_cover', 'mirror_left', 'fender_left']);

// A garage for the car with what fits from the list fitted (and what each needs): { garage, fitted, missed }
function buildFor(db, carId, wanted) {
  let g = new Garage(db, null, carId);
  const fitted = [], missed = [];
  for (const [slot, ids] of wanted) {
    const options = ids.map(i => i.replace('{car}', carId)).filter(i => db.parts[i]);
    if (!options.length) continue;
    let done = false;
    for (const id of options) {
      const r = fitWithNeeds(db, carId, id, { base: g });
      if (r.ok) { g = r.garage; fitted.push(id); done = true; break; }
    }
    if (!done && options.some(i => i.startsWith(carId) || !ids.some(x => x.includes('{car}')))) missed.push(`${slot}: ${options[0]}`);
  }
  return { garage: g, fitted, missed };
}

const docs = new Map();
const load = async file => { if (!docs.has(file)) docs.set(file, await readModel(path.join(ROOT, file))); return docs.get(file); };

// The car's body and every part in the build, placed as the game places them
async function assemble(db, car, garage, { cutaway = false } = {}) {
  const doc = await readModel(path.join(ROOT, car.model.file)), root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  const bodyPrims = new Set(root.listMeshes().flatMap(m => m.listPrimitives()));
  const nodes = new Map(root.listNodes().map(n => [n.getName(), n]));
  const nodeAt = (name, s) => {
    if (nodes.has(name)) return nodes.get(name);
    const n = doc.createNode(name).setTranslation(s.position);
    scene.addChild(n); nodes.set(name, n);
    return n;
  };
  // (another model's scene into this one, under a node: with a scale)
  const put = async (src, parent, { scale = [1, 1, 1] } = {}) => {
    const map = mergeDocuments(doc, src), wrap = doc.createNode('part').setScale(scale);
    for (const s of src.getRoot().listScenes()) for (const n of s.listChildren()) { const m = map.get(n); for (const sc of root.listScenes()) if (sc !== scene) sc.removeChild(m); wrap.addChild(m); }
    for (const sc of root.listScenes()) if (sc !== scene) sc.dispose();
    parent.addChild(wrap);
  };
  const owned = garage.state.parts, wheelSockets = Object.entries(car.model.sockets).filter(([k]) => /^(FL|FR|RL|RR)$/.test(k));
  for (const s of car.sockets) {
    const inst = garage.build.sockets?.[s.name], part = inst && db.parts[owned[inst]?.partId];
    if (!part || (cutaway && HIDE_IN_CUTAWAY.has(s.slot))) continue;
    if (part.tyreSize) {
      // a tyre made to fit the rim on its wheel (as the game makes it)
      const rimId = garage.build.sockets[s.node], rim = rimId && db.parts[owned[rimId]?.partId];
      if (!rim?.rim) continue;
      const f = tyreFit(rim.rim, part.tyreSize), R = f.rimRadius, W = f.width / 2, H = f.sidewall;
      const mb = new ModelBuilder().add(lathe([[R, -W], [R + H * 0.85, -W], [R + H, -W * 0.8], [R + H, W * 0.8], [R + H * 0.85, W], [R, W], [R, -W]], 24, 'x'), { material: 'rubber' });
      await put(await mb.document({ root: 'tyre', finishes: {} }), nodeAt(s.node, s));
      continue;
    }
    const { model, look } = resolveLook(part, db.parts, null, car.id), shape = partShape(part, db.parts, car.id);
    if (!model) continue;
    const src = await load(model), k = look?.scale ?? 1, scale = typeof k === 'number' ? [k, k, k] : k;
    if (look?.drawAt === 'wheels') {
      // at every wheel's hub, fitted inside its rim; mirrored on the right (calipers behind the axle)
      const reach = Math.max(...[1, 2].flatMap(i => [Math.abs(shape.bounds.min[i]), Math.abs(shape.bounds.max[i])]));
      for (const [corner, name] of wheelSockets) {
        const rimId = garage.build.sockets[name], rim = rimId && db.parts[owned[rimId]?.partId], d = rim?.rim?.diameter;
        const f = d ? Math.min(1, (d * 0.0254 / 2 - 0.034) / reach) : 1;
        await put(src, nodeAt(name, car.sockets.find(x => x.name === name)), { scale: [1, f, corner.endsWith('R') ? -f : f] });
      }
      continue;
    }
    await put(src, nodeAt(s.node ?? s.name, s), { scale });
  }
  return { doc, bodyPrims };
}

export async function fitSheet(project, file = 'docs/generated_fit.png') {
  const { db, rules } = project, rows = [], report = [];
  for (const car of Object.values(db.cars)) {
    const out = buildFor(db, car.id, OUTSIDE), cut = buildFor(db, car.id, CUTAWAY);
    const a = await assemble(db, car, out.garage), b = await assemble(db, car, cut.garage, { cutaway: true });
    const belt = (car.sockets.find(s => s.name === 'socket_mirror_left')?.position[1] ?? 0.9) - 0.04;
    const tiles = [
      await renderIcon(a.doc, { rules, type: 'car', size: TILE, view: { azimuth: 38, elevation: 16 } }),
      await renderIcon(a.doc, { rules, type: 'car', size: TILE, view: { azimuth: 220, elevation: 16 } }),
      await renderIcon(b.doc, { rules, type: 'car', size: TILE, view: { azimuth: 58, elevation: 42 }, keep: t => !(b.bodyPrims.has(t.prim) && Math.min(...t.p.map(q => q[1])) > belt) }),
    ];
    rows.push({ car, tiles, fitted: [...new Set([...out.fitted, ...cut.fitted])], missed: [...out.missed, ...cut.missed] });
    report.push({ car: car.id, fitted: [...new Set([...out.fitted, ...cut.fitted])], missed: [...out.missed, ...cut.missed] });
  }
  // the sheet: a row per car, its name and what's on it
  const PAD = 16, LABEL = 62, W = PAD * 2 + 3 * TILE, H = PAD + 46 + rows.length * (TILE + LABEL);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const text = [`<text x="${PAD}" y="${PAD + 24}" font-size="24" font-weight="700" fill="#e8edf2">Generated parts on every car (fitted through the garage) — outside, back, cutaway</text>`];
  const comps = [];
  rows.forEach((r, i) => {
    const y = PAD + 46 + i * (TILE + LABEL);
    text.push(`<rect x="${PAD}" y="${y}" width="${3 * TILE}" height="${TILE + LABEL - 8}" rx="10" fill="#1d2329"/>`);
    text.push(`<text x="${PAD + 12}" y="${y + TILE + 18}" font-size="17" font-weight="700" fill="#7fc4ff">${esc(r.car.name)}</text>`);
    text.push(`<text x="${PAD + 12}" y="${y + TILE + 38}" font-size="11" fill="#9aa6b2">${esc(r.fitted.join(' · ').slice(0, 230))}</text>`);
    if (r.missed.length) text.push(`<text x="${PAD + 12}" y="${y + TILE + 52}" font-size="11" fill="#ffb35a">didn't fit: ${esc(r.missed.join(', '))}</text>`);
    r.tiles.forEach((png, k) => comps.push({ input: png, left: PAD + k * TILE, top: y }));
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#14181c"/><g font-family="DejaVu Sans, Arial, sans-serif">${text.join('')}</g></svg>`;
  await sharp(Buffer.from(svg)).composite(comps).png({ compressionLevel: 9 }).toFile(path.join(ROOT, file));
  return { file, report };
}
