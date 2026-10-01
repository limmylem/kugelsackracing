// The model checks: for a part (by its type's rules: size, origin, triangles…) or a car body (its
// sockets, which way it faces, its size, its wheels on the ground…), each a PASS, WARN or FAIL with
// what's wrong in plain words and how to fix it. From inspect(doc) (./inspect.mjs).
//
//   checkModel(info, { rules, type, scale, car, db, knownSockets }) → { type, findings, verdict }
//   formatReport(file, result) → the lines to print

import { allowedMaterial, allowedMaterialList } from './rules.mjs';
import { fmtM, sizeText } from './inspect.mjs';
import { tyreFit } from '../../garage/tyres.js';

const AXES = [['x', 'wide'], ['y', 'tall'], ['z', 'long']];     // (across the car, up, front to back)
const BLENDER_SCALE = 'In Blender: Scene properties › Units › Unit Scale 1.0, select everything, Ctrl+A › All Transforms, then export again.';
const ORIGIN_HOW = 'In Blender: select the vertex (or edge) at that point, Shift+S › Cursor to Selected, Object › Set Origin › Origin to 3D Cursor, then move the object to 0, 0, 0.';

export function checkModel(info, ctx) {
  const findings = [], add = (level, check, text, fix) => findings.push({ level, check, text, fix });
  const f = {
    pass: (check, text) => add('pass', check, text),
    warn: (check, text, fix) => add('warn', check, text, fix),
    fail: (check, text, fix) => add('fail', check, text, fix),
  };
  common(info, ctx, f);
  if (info.triangleCount) {
    if (ctx.type === 'car') car(info, ctx, f);
    else part(info, ctx, f);
  }
  const verdict = findings.some(x => x.level === 'fail') ? 'fail' : findings.some(x => x.level === 'warn') ? 'warn' : 'pass';
  return { type: ctx.type, findings, verdict };
}

// ---------- every model ----------

function common(info, { rules, type }, f) {
  const budget = type === 'car' ? rules.car.triangles : rules.types[type]?.triangles;
  if (!info.triangleCount) f.fail('contents', "There's nothing to draw: the file has no triangles (an empty scene).", 'Export again with the mesh in the scene (in Blender, untick "Selected objects" or select the model first).');
  else { const meshes = new Set(info.primitives.map(p => p.mesh)).size; f.pass('contents', `Loads: ${info.triangleCount.toLocaleString('en-GB')} triangles in ${meshes} mesh${meshes === 1 ? '' : 'es'}${info.scenes > 1 ? `, ${info.scenes} scenes` : ''}.`); }
  if (info.scenes > 1) f.warn('contents', `It has ${info.scenes} scenes; the game only shows the first.`, 'Put everything in one scene before exporting.');
  const extras = [[info.cameras, 'camera'], [info.lights, 'light'], [info.animations, 'animation'], [info.skins, 'skin (armature)']].filter(([n]) => n).map(([n, w]) => `${n} ${w}${n > 1 ? 's' : ''}`);
  if (extras.length) f.fail('extras', `It has ${list(extras)}: a game model is only meshes and (for a car) its socket nodes.`, 'Delete them before exporting (or untick Cameras, Punctual Lights, Animation and Skinning in the glTF exporter). npm run fix-model / npm run import remove them for you.');
  else f.pass('extras', 'No cameras, lights, animations or skins.');
  if (info.otherModes) f.warn('contents', `${info.otherModes} part${info.otherModes > 1 ? 's are' : ' is'} lines or points, which the game doesn't draw.`, 'Delete loose edges and vertices (Blender: Select › Select Loose, then delete).');

  // materials
  const used = new Set(info.primitives.map(p => p.material));
  const bad = [...used].filter(n => n !== '(no material)' && !allowedMaterial(n, rules));
  if (used.has('(no material)')) f.fail('materials', 'Some of it has no material at all.', 'Give every face a material: paint, car_atlas or a finish.');
  if (bad.length) f.fail('materials', `${bad.length === 1 ? 'Material' : 'Materials'} ${list(bad.map(n => `"${n}"`))} ${bad.length === 1 ? "isn't a name" : "aren't names"} the game knows, so ${bad.length === 1 ? 'it' : 'they'} can't be painted or finished.`, `Rename ${bad.length === 1 ? 'it' : 'each'} to one of: ${allowedMaterialList(rules).join(', ')}. "paint" is the surface that takes the car's colour.`);
  else if (!used.has('(no material)')) f.pass('materials', `Materials: ${[...used].join(', ')}.`);

  // textures
  const max = rules.textureMaxSize, big = info.textures.filter(t => t.size && Math.max(...t.size) > max), odd = info.textures.filter(t => t.size && t.size.some(v => (v & (v - 1)) !== 0));
  const unknown = info.textures.filter(t => !t.size);
  if (big.length) f.warn('textures', `${list(big.map(t => `${t.name} (${t.size.join('×')})`))} ${big.length > 1 ? 'are' : 'is'} bigger than ${max}×${max}.`, 'npm run import / npm run fix-model shrink it. Or save it smaller before exporting.');
  if (odd.length) f.warn('textures', `${list(odd.map(t => `${t.name} (${t.size.join('×')})`))}: a texture's sides should be powers of two (64, 128 … 1024).`, 'Resize it to a power of two.');
  if (unknown.length) f.warn('textures', `Can't read the size of ${list(unknown.map(t => `${t.name} (${t.mime})`))}.`, 'Use PNG or JPEG textures.');
  if (!big.length && !odd.length && !unknown.length) f.pass('textures', info.textures.length ? `Textures: ${info.textures.map(t => `${t.name} ${t.size.join('×')}`).join(', ')}.` : 'No textures.');

  // normals and texture coordinates
  const noNormals = info.primitives.filter(p => !p.normals), noUVs = info.primitives.filter(p => p.textured && !p.uvs);
  if (noNormals.length) f.fail('normals', `${list([...new Set(noNormals.map(p => p.mesh))])} ${noNormals.length > 1 ? 'have' : 'has'} no normals, so it can't be lit.`, 'Export with normals on (glTF exporter › Data › Mesh › Normals). npm run import / npm run fix-model add flat ones.');
  else f.pass('normals', 'Every mesh has normals.');
  if (noUVs.length) f.fail('uvs', `${list([...new Set(noUVs.map(p => `${p.mesh} (${p.material})`))])} ${noUVs.length > 1 ? 'use' : 'uses'} a texture but ${noUVs.length > 1 ? 'have' : 'has'} no texture coordinates (UVs), so the texture can't go on.`, 'Unwrap it (Blender: U › Smart UV Project, then place the faces on the palette colour) and export with UVs on, or give it an untextured material (paint or a finish).');
  else f.pass('uvs', info.primitives.some(p => !p.uvs) ? 'Textured meshes have UVs (untextured ones need none).' : 'Every mesh has UVs.');

  // triangle budget
  if (budget && info.triangleCount) {
    const n = info.triangleCount, what = type === 'car' ? 'a car body' : `a ${rules.types[type].label.toLowerCase()}`;
    if (n > budget * 2) f.fail('triangles', `${n.toLocaleString('en-GB')} triangles: far over the budget for ${what} (${budget.toLocaleString('en-GB')}).`, 'Simplify it (Blender: Decimate modifier, or remove hidden faces) to get under the budget.');
    else if (n > budget) f.warn('triangles', `${n.toLocaleString('en-GB')} triangles: over the budget for ${what} (${budget.toLocaleString('en-GB')}).`, 'Simplify it if you can: every triangle is drawn on every car that has it.');
    else f.pass('triangles', `${n.toLocaleString('en-GB')} triangles (budget ${budget.toLocaleString('en-GB')}).`);
  }
}

// ---------- a part ----------

function part(info, { rules, type, scale = 1, file, estimateMass = false }, f) {
  const t = rules.types[type];
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  const b = { min: info.bounds.min.map((v, k) => v * s[k]), max: info.bounds.max.map((v, k) => v * s[k]) };
  b.size = b.max.map((v, k) => v - b.min[k]);
  const scaled = s.some(v => v !== 1) ? ` (drawn ×${s.map(v => +v.toFixed(3)).join('/')})` : '';

  // size, per axis — and if it's all out by one factor, which unit it was probably made in
  const out = AXES.filter(([a], k) => t.size[a] && (b.size[k] < t.size[a][0] || b.size[k] > t.size[a][1]));
  if (!out.length) f.pass('size', `Size ${sizeText(b.size)}${scaled} is right for ${a(t.label)}.`);
  else {
    const guess = unitGuess(b.size, t.size), cmd = `npm run fix-model -- ${file ?? '<file>'} --scale ${guess ? +(1 / guess.factor).toPrecision(4) : '<factor>'}`;
    const what = out.map(([ax, word]) => `${fmtM(b.size['xyz'.indexOf(ax)])} m ${word}`), should = out.map(([ax, word]) => `${t.size[ax][0]}–${t.size[ax][1]} m ${word}`);
    f.fail('size', `It's ${list(what)}; ${a(t.label)} is ${list(should)}.${guess ? ` Everything is ${guess.words}, so it was probably ${guess.cause}.` : ''}`,
      guess ? `Export it in metres. ${BLENDER_SCALE} Or scale it here: ${cmd}` : `Model it at its real size in metres (${Object.entries(t.size).map(([ax, r]) => `${AXES.find(x => x[0] === ax)[1]} ${r[0]}–${r[1]} m`).join(', ')}), with +y up and +z the car's front.`);
  }

  // origin: where the socket is, by the type's rule on each axis (at the right scale, if it's in the
  // wrong unit: that's one mistake, not two)
  const unit = out.length ? unitGuess(b.size, t.size)?.factor ?? 1 : 1;
  const tol = t.originTolerance ?? rules.originTolerance, off = [], where = [];
  for (const [ax, word] of AXES) {
    const k = 'xyz'.indexOf(ax), rule = t.origin[ax] ?? 'within', lo = b.min[k] / unit, hi = b.max[k] / unit, c = (lo + hi) / 2;
    const d = rule === 'centre' ? c : rule === 'min' ? lo : rule === 'max' ? hi : rule === 'within' ? (lo - tol > 0 ? lo : hi + tol < 0 ? hi : 0) : 0;
    if (Math.abs(d) <= tol) continue;
    off.push(d);
    where.push(originWords(ax, rule, d));
  }
  if (!where.length) f.pass('origin', `The origin is at ${t.attach}.`);
  else {
    const dist = Math.hypot(...off);
    f.fail('origin', `The origin (where it attaches) should be at ${t.attach}, but ${list(where)}${dist > 0.3 ? ` — ${fmtM(dist)} m off, as if the origin was left at the scene's centre` : ''}.`,
      `Move the origin to that point. ${ORIGIN_HOW} Or let the fixer put it there: npm run fix-model -- ${file ?? '<file>'} --place-origin`);
  }

  if (type === 'rim' && Math.abs(b.size[1] - b.size[2]) > 0.02 * Math.max(b.size[1], b.size[2]))
    f.warn('shape', `It isn't round: ${fmtM(b.size[1])} m tall but ${fmtM(b.size[2])} m long.`, 'A rim turns about the x axis (the axle): make it round in y and z, with its outer face towards +x.');
  if (!info.closed && estimateMass) f.warn('shape', "The mesh has holes (open edges), so its volume, and the mass the importer estimates from it, can't be trusted.", 'Close the holes (Blender: select the open edges › F), or set the mass by hand in the part file.');
  else if (!info.closed) f.pass('shape', 'Open mesh (fine: its mass is set in its part file).');
  else if (!out.length) f.pass('shape', `Closed mesh: ${(info.volume * 1000 * s[0] * s[1] * s[2]).toFixed(1)} litres.`);
}

// the factor everything's out by, if a common unit mistake explains it
function unitGuess(size, ranges) {
  const tries = [[100, '100× too big', 'made in centimetres'], [1000, '1000× too big', 'made in millimetres'], [39.37, 'about 39× too big', 'made in inches'], [10, '10× too big', 'made in decimetres (or scaled by 10)'],
    [0.01, '100× too small', 'scaled by 0.01 twice (centimetres converted to metres again)'], [0.0254, 'about 39× too small', 'scaled down twice'], [0.1, '10× too small', 'scaled down by 10']];
  for (const [factor, words, cause] of tries) {
    const fits = AXES.every(([ax], k) => !ranges[ax] || (size[k] / factor >= ranges[ax][0] * 0.9 && size[k] / factor <= ranges[ax][1] * 1.1));
    if (fits) return { factor, words, cause };
  }
  return null;
}
function originWords(ax, rule, d) {
  const cm = `${fmtM(Math.abs(d))} m`;
  const side = { x: d > 0 ? 'left of' : 'right of', y: d > 0 ? 'above' : 'below', z: d > 0 ? 'in front of' : 'behind' }[ax];
  const part = { centre: { x: 'its middle', y: 'its middle', z: 'its middle' }, min: { x: 'its right-hand edge', y: 'its bottom', z: 'its back' }, max: { x: 'its left-hand edge', y: 'its top', z: 'its front' }, within: { x: 'the whole model', y: 'the whole model', z: 'the whole model' } }[rule][ax];
  return `${part} is ${cm} ${side} the origin`;
}

// ---------- a car ----------

function car(info, { rules, car: def, db, knownSockets = [] }, f) {
  const R = rules.car, names = new Set(info.sockets.map(s => s.name)), at = n => info.sockets.find(s => s.name === n);
  const known = new Set([...R.requiredSockets, ...R.expectedSockets, ...knownSockets]);

  // sockets there, and spelled right
  // (an expected socket its car.json has no use for, e.g. a boot on a car without one, isn't missing)
  const uses = Array.isArray(def?.sockets) ? new Set(def.sockets.map(s => s.name)) : null;
  const missing = R.requiredSockets.filter(n => !names.has(n)), missingExpected = R.expectedSockets.filter(n => !names.has(n) && (!uses || uses.has(n)));
  const unknown = [...names].filter(n => !known.has(n));
  const typos = unknown.map(n => ({ n, close: closest(n, [...known]) })).filter(x => x.close);
  for (const { n, close } of typos) f.fail('sockets', `"${n}" isn't a socket name the game knows: it's probably ${close} ${close.toLowerCase() === n.toLowerCase() ? '(the capitals are different)' : 'misspelled'}.`, `Rename the node to exactly ${close} (names are case-sensitive).`);
  const stillMissing = missing.filter(n => !typos.some(t => t.close === n));
  if (stillMissing.length) f.fail('sockets', `It has no ${list(stillMissing)}: every car needs these to put its wheels on.`, `Add an empty (Blender: Add › Empty › Plain Axes) named exactly ${list(stillMissing)} at the centre of each wheel, at ride height.`);
  const missingOther = missingExpected.filter(n => !typos.some(t => t.close === n));
  if (missingOther.length) f.warn('sockets', `No ${list(missingOther)}: parts that go there are drawn where car.json puts the socket instead.`, 'Add an empty for each at the point the part attaches (see docs/MODELLING_GUIDE.md › Sockets).');
  const odd = unknown.filter(n => !typos.some(t => t.n === n));
  if (odd.length) f.warn('sockets', `${list(odd.map(n => `"${n}"`))} ${odd.length > 1 ? "aren't sockets" : "isn't a socket"} the game knows.`, 'Rename it to a socket from the guide, or add the socket to car.json if it\'s a new one.');
  if (!missing.length && !typos.length) f.pass('sockets', `All ${R.requiredSockets.length} wheel sockets${missingOther.length ? '' : ` and the ${R.expectedSockets.filter(n => !uses || uses.has(n)).length} part sockets`} are there.`);

  // which way it faces: the front wheels in front (+z), the left wheels on the left (+x), y up
  const [FL, FR, RL, RR] = ['FL', 'FR', 'RL', 'RR'].map(k => at(`socket_wheel_${k}`));
  const size = info.bounds.size;
  let facing = true;
  if (size[1] > size[2] && size[1] > size[0]) { facing = false; f.fail('axes', `It's taller (${fmtM(size[1])} m) than it is long: it was probably exported with Z up.`, 'Export with +Y up (glTF exporter › Transform › +Y Up ticked) and the car facing +Z.'); }
  else if (size[0] > size[2]) { facing = false; f.fail('axes', `It's wider (${fmtM(size[0])} m) than it is long (${fmtM(size[2])} m): it's facing sideways.`, 'Turn it so its front points along +Z (Blender: rotate 90° round the vertical axis, apply the rotation).'); }
  if (FL && RL && FL.position[2] < RL.position[2]) { facing = false; f.fail('axes', 'The front wheels are behind the rear ones: the car faces −Z.', 'Turn it 180° round the vertical axis so it faces +Z, and apply the rotation.'); }
  if (FL && FR && FL.position[0] < FR.position[0]) { facing = false; f.fail('axes', 'The left wheels are on the right: +X must be the car\'s left (as you sit in it).', 'The model is mirrored, or the left and right wheel sockets are swapped: socket_wheel_FL goes at the front wheel on the car\'s left (+X).'); }
  if (facing) f.pass('axes', 'Faces +Z with Y up and +X to its left.');

  // size
  const dims = { length: size[2], width: size[0], height: size[1] }, wrong = Object.entries(dims).filter(([k, v]) => v < R.size[k][0] || v > R.size[k][1]);
  if (wrong.length) {
    const guess = unitGuess([dims.width, dims.height, dims.length], { x: R.size.width, y: R.size.height, z: R.size.length });
    f.fail('size', `It's ${list(wrong.map(([k, v]) => `${fmtM(v)} m ${k === 'length' ? 'long' : k === 'width' ? 'wide' : 'tall'} (a car is ${R.size[k][0]}–${R.size[k][1]} m)`))}.${guess ? ` Everything is ${guess.words}: it was probably ${guess.cause}.` : ''}`, guess ? `Export it in metres. ${BLENDER_SCALE}` : 'Model it at its real size in metres.');
  } else f.pass('size', `${fmtM(dims.length)} m long, ${fmtM(dims.width)} m wide, ${fmtM(dims.height)} m tall.`);
  if (FL && FR && RL && RR) {
    const wb = (FL.position[2] + FR.position[2]) / 2 - (RL.position[2] + RR.position[2]) / 2, track = Math.abs(FL.position[0] - FR.position[0]);
    if (wb < R.wheelbase[0] || wb > R.wheelbase[1]) f.warn('size', `The wheelbase (front to rear axle) is ${fmtM(wb)} m; cars are ${R.wheelbase[0]}–${R.wheelbase[1]} m.`, 'Check the wheel sockets are at the wheel centres.');
    if (track < R.track[0] || track > R.track[1]) f.warn('size', `The track (left to right wheel) is ${fmtM(track)} m; cars are ${R.track[0]}–${R.track[1]} m.`, 'Check the wheel sockets are at the wheel centres.');
  }

  // left and right mirror each other
  const pairs = [];
  for (const n of names) {
    const m = n.match(/^(.*_)(FL|RL|left)$/);
    if (!m) continue;
    const other = m[1] + { FL: 'FR', RL: 'RR', left: 'right' }[m[2]];
    if (names.has(other)) pairs.push([n, other]);
  }
  const tol = R.mirrorTolerance, bad = [];
  for (const [l, r] of pairs) {
    const a = at(l).position, b = at(r).position, d = Math.max(Math.abs(a[0] + b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    if (d > tol) bad.push({ l, r, d, a, b });
  }
  for (const x of bad) (x.d > tol * 3 ? f.fail : f.warn)('mirror', `${x.l} and ${x.r} don't mirror each other: they're at [${x.a.map(fmtM).join(', ')}] and [${x.b.map(fmtM).join(', ')}] (${fmtM(x.d)} m out).`, `Put ${x.r} at [${[-x.a[0], x.a[1], x.a[2]].map(fmtM).join(', ')}] — the same place as ${x.l}, with x the other way.`);
  if (pairs.length && !bad.length) f.pass('mirror', `${pairs.length} left / right socket pairs mirror each other.`);
  // wheel sockets face outwards (their +x away from the middle: the right-hand ones are turned 180°)
  const inward = [FL, FR, RL, RR].filter(s => s && Math.sign(s.axes[0][0]) !== Math.sign(s.position[0]) && Math.abs(s.position[0]) > 0.1);
  if (inward.length) f.fail('mirror', `${list(inward.map(s => s.name))} ${inward.length > 1 ? 'face' : 'faces'} inwards: a wheel socket's +X points out of the car (the right-hand ones are turned 180° round Y), so one wheel model fits all four.`, 'Turn the right-hand wheel sockets (socket_wheel_FR, socket_wheel_RR) 180° round their vertical axis, and leave the left ones unturned.');

  // the wheels on the ground: a wheel socket's height is the stock wheel's radius
  const radius = stockRadius(def, db), wheels = [FL, FR, RL, RR].filter(Boolean);
  if (wheels.length) {
    const r = radius?.value, off = r ? wheels.map(s => s.position[1] - r) : null, worst = off ? off.reduce((m, v) => Math.abs(v) > Math.abs(m) ? v : m, 0) : 0;
    if (!r) {
      const ys = wheels.map(s => s.position[1]), bad2 = ys.filter(y => y < R.wheelRadius[0] || y > R.wheelRadius[1]);
      if (bad2.length) f.fail('wheels', `The wheel sockets are ${list(ys.map(fmtM))} m up: a wheel's centre is its radius above the ground (${R.wheelRadius[0]}–${R.wheelRadius[1]} m).`, 'Put the wheel sockets at the wheel centres, with the car standing on the ground (y = 0).');
      else f.pass('wheels', `Wheel centres ${fmtM(Math.min(...ys))}–${fmtM(Math.max(...ys))} m up.`);
    } else if (Math.abs(worst) > R.wheelHeightTolerance * 2.5) f.fail('wheels', `The stock wheels (${radius.label}, ${fmtM(r)} m radius) would ${worst > 0 ? 'float' : 'sink'} ${fmtM(Math.abs(worst))} m ${worst > 0 ? 'above' : 'into'} the ground: the wheel sockets are ${list([...new Set(wheels.map(s => fmtM(s.position[1])))])} m up.`, `Move the wheel sockets to y = ${fmtM(r)} (the wheel's centre with the car on the ground), or change the stock tyres in car.json.`);
    else if (Math.abs(worst) > R.wheelHeightTolerance) f.warn('wheels', `The stock wheels would sit ${fmtM(Math.abs(worst))} m ${worst > 0 ? 'above' : 'into'} the ground.`, `Move the wheel sockets to y = ${fmtM(r)}.`);
    else f.pass('wheels', `The stock wheels (${radius.label}) sit on the ground.`);
  }
  // (a whole car, wheels and all: its lowest point is on the ground)
  const wheelMeshes = info.primitives.some(p => /wheel|tyre|tire/i.test(p.mesh));
  if (wheelMeshes && Math.abs(info.bounds.min[1]) > R.groundTolerance) f.warn('ground', `Its lowest point is ${fmtM(info.bounds.min[1])} m ${info.bounds.min[1] > 0 ? 'above' : 'below'} y = 0.`, 'Stand the car on the ground: the bottoms of the tyres at y = 0.');

  // the paint
  const paint = def?.model?.paintMaterial ?? R.paintMaterial;
  if (!info.materials.some(m => m.name === paint)) f.fail('paint', `No material is called "${paint}", so the car can't be painted.`, `Name the body's painted surfaces' material "${paint}".`);
  else f.pass('paint', `Paint material "${paint}" is there.`);
}

// The stock wheel's radius (its rim and tyre in car.json): { value, label } or null
function stockRadius(def, db) {
  if (!def || !db) return null;
  const wheel = def.sockets.find(s => s.name === def.model?.sockets?.FL), tyreSock = def.sockets.find(s => s.node === wheel?.name && s.slot === 'tyre');
  const rim = db.parts[wheel?.stock?.[0]]?.rim, tyre = db.parts[tyreSock?.stock?.[0]]?.tyreSize;
  if (!rim || !tyre) return null;
  const fit = tyreFit(rim, tyre);
  return { value: fit.radius, label: fit.label };
}

// ---------- helpers ----------

export function closest(name, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    if (c.toLowerCase() === name.toLowerCase()) return c;
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= Math.max(2, Math.floor(best?.length / 6)) ? best : null;
}
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : Infinity);
  return d[a.length][b.length];
}
const list = xs => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '';
const a = w => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w.toLowerCase()}`;

// ---------- the report ----------

const COLOURS = { pass: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m', dim: '\x1b[2m', off: '\x1b[0m', bold: '\x1b[1m' };
export function formatReport(file, result, { colour = false, quiet = false, title = '' } = {}) {
  const c = (k, s) => colour ? `${COLOURS[k]}${s}${COLOURS.off}` : s;
  const counts = ['fail', 'warn'].map(l => [l, result.findings.filter(x => x.level === l).length]).filter(([, n]) => n);
  const lines = [`${c(result.verdict, c('bold', result.verdict.toUpperCase().padEnd(4)))}  ${file}${title ? c('dim', `  (${title})`) : ''}${counts.length ? c('dim', `  — ${counts.map(([l, n]) => `${n} ${l === 'fail' ? 'problem' : 'warning'}${n > 1 ? 's' : ''}`).join(', ')}`) : ''}`];
  for (const x of result.findings) {
    if (quiet && x.level === 'pass') continue;
    lines.push(`   ${c(x.level, x.level.toUpperCase().padEnd(4))}  ${x.text}`);
    if (x.fix) lines.push(`         ${c('dim', 'How to fix:')} ${x.fix}`);
  }
  return lines.join('\n');
}
