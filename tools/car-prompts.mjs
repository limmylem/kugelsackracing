// Prompts for making each car's model in Claude Design (docs/car_prompts.md), written from the game's own data so every
// name, socket and size in them is exact: each car's sockets (car.json, with the turns its model's socket nodes have),
// the stock parts its model carries (the ones whose models the import's split makes: assets/parts/stock/<car>/), their
// sizes (their bounds), the wheels and tyres (the stock parts), the body's own nodes (the glass and lights that break),
// and a look for each — fictional, in the spirit of a modern racing game's cars. The model it makes goes in through
// npm run import like any car's, and is split into its body and its parts, so the garage can take it apart.
//
//   npm run car-prompts                (writes docs/car_prompts.md)
//   npm run car-prompts -- kaze_gt     (just that car's prompt, to the console)

import fs from 'node:fs';
import path from 'node:path';
import { getBounds } from '@gltf-transform/functions';
import { readModel } from './content/io.mjs';
import { ROOT, readJson } from './content/rules.mjs';
import { tyreFit } from '../garage/tyres.js';

// How to model it so it looks real (every car's prompt): what makes a racing game's car look like a car, not a toy —
// smooth surfaces built from the car's own lines, bevelled edges and panel gaps, real light units and wheels
const REALISM = [
  'How to model it so it looks real (this matters most — the car must not look blocky or like a toy):',
  '- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car\'s lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.',
  '- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.',
  '- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen\'s edge.',
  '- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing\'s black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.',
  '- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.',
  '- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.',
  '- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.',
  '- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.',
  '- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.',
];

// The follow-ups: sent one by one after the first model, each a pass over one thing (the doc's own section)
const KEEP = ' Keep every node name, socket position, part size and material name exactly as they are, and the glb\'s structure the same.';
const FOLLOW_UPS = [
  ['1. The shape', 'Make the body\'s shape more realistic. Compare it with photos of real cars of this kind from the side, front, rear and three-quarters: fix the proportions (the overhangs, the glasshouse, the wheel arches round the wheels with a small even gap), make every surface curved and smooth (no flat or faceted areas: more vertices where it curves, subdivided), round off every corner, add the shoulder line and the tumblehome, flare the arches with rolled lips.' + KEEP],
  ['2. Panel gaps and edges', 'Add the details that make it look manufactured: a 4 mm shut line round every panel (bonnet, boot, doors, wings, bumpers) with the edges turned in, a 2–5 mm bevel on every edge, black rubber seals round the glass, the black frit band round the windscreen, door handles, a fuel filler flap, wiper arms, washer jets, a fictional number plate in its recess.' + KEEP],
  ['3. The lights', 'Make the headlights and tail lights look like real light units: a chrome reflector bowl or a projector lens behind a clear outer lens with thickness, a black inner surround, the indicator and side lamp in their own sections, LED strips or bulbs inside; the tail lights with a deep red lens, inner segments, the reversing light and indicator. Add a third brake light and the side repeaters.' + KEEP],
  ['4. The wheels', 'Make the wheels look real: shape each spoke (tapered, with depth and rounded edges), add the outer lip, the wheel nuts and centre cap, the barrel behind the spokes and a ventilated brake disc behind them; a rounded sidewall on the tyre. Line the wheel arches in black and show the suspension behind the wheels.' + KEEP],
  ['5. Grilles, intakes and underneath', 'Give every grille and intake real depth: slats or a honeycomb mesh with black behind it, never a flat shape; add the tow hook cover, fog lights or reflectors where they suit; model the underside (floor, exhaust pipe running back, fuel tank, suspension arms) in dark finishes.' + KEEP],
  ['6. The interior', 'Make the interior look real through the windows: a dashboard with instrument dials, vents and a centre stack; door cards with handles and armrests; seats with bolsters, seams and headrests; a gear lever and handbrake; the headlining, sun visors and a rear-view mirror.' + KEEP],
  ['7. The materials', 'Tune the materials so it looks like a photo: the paint glossy (roughness about 0.1, like clear-coated paint), chrome mirror-like (metalness 1, roughness about 0.05), the glass clear and slightly tinted, the rubber and black plastics rough (0.6–0.8), the lenses clear with the lamps behind them. Show me the car close up from the front three-quarters in daylight.' + KEEP],
];

// Each car's look: what Claude Design is asked for. Fictional cars, each with a character of its own (no real car's
// shape, lights, grille or badge); the size, the sockets and the parts come from the data.
const LOOKS = {
  starter_car: {
    kind: 'an honest, slightly boxy 1980s two-door economy coupe, the car every player starts with',
    look: [
      'Crisp, mostly flat panels with soft radii; an upright glasshouse with thin pillars and a near-vertical rear window over a short notchback boot.',
      'Front: rectangular headlights in black surrounds, a slatted grille between them with a small round badge, an indicator under each headlight, a body-colour bumper with a black rubbing strip and a slim lower intake.',
      'Rear: wide rectangular tail lights (red with amber indicators and a clear reversing section), the number plate recessed between them, a single exhaust tip.',
      'Wheels: plain 15" eight-hole steel-look wheels in silver with a small centre cap.',
      'Inside: a simple dashboard with a two-dial binnacle, cloth seats, a thin-rimmed three-spoke steering wheel.',
    ],
  },
  kaze_gt: {
    kind: 'a light 1990s-style 2+2 sports coupe',
    look: [
      'A long bonnet, a low nose, the cabin set back, a flowing roofline into a short boot with a small integrated lip; strong front and rear wheel arches with a crisp shoulder line between them.',
      'Front: slim swept-back headlights (projector lamps and a running-light strip in each), a wide lower grille opening with a fine black mesh, small corner intakes.',
      'Rear: slim horizontal tail lights reaching round the corners, a black diffuser-style lower valance, twin round exhaust tips.',
      'Wheels: 17" five split-spoke wheels in silver.',
      'Inside: a driver-focused dashboard with a hooded three-dial binnacle, sports seats with side bolsters, a leather three-spoke wheel.',
    ],
  },
  hana_roadster: {
    kind: 'a small, light two-seat roadster with a folding fabric soft top',
    look: [
      'Rounded, friendly, compact: a short nose, a low windscreen in a slim frame, the cockpit set well back, a short rounded tail; smooth curved wings over each wheel.',
      'Front: oval headlights with a chrome-ringed projector in each, a small oval grille "mouth" with fine mesh, a slim lower lip.',
      'Rear: round tail lights (two each side), a recessed number plate, a single exhaust tip.',
      'Wheels: 16" six-spoke wheels.',
      'Inside: a simple, sporty cockpit open to the sky: a round-dial instrument pod, bucket seats, a small three-spoke wheel. The soft top is its own part (raised), so the cockpit must look finished without it.',
    ],
  },
  ridgeback_4x4: {
    kind: 'a tough, upright body-on-frame four-wheel-drive off-roader',
    look: [
      'Square, flat-sided and tall, with high ground clearance, a near-vertical windscreen, a long roof and a flat tail with a side-hinged rear door look; black plastic wheel-arch flares and lower cladding all round.',
      'Front: big rectangular headlights, a tall grille of thick horizontal bars, a steel bumper with a skid plate and recovery points.',
      'Rear: tall vertical tail lights at the corners, a spare-wheel carrier on the tail, a step bumper.',
      'Wheels: 17" six-spoke wheels on chunky all-terrain tyres.',
      'Inside: an upright, practical dashboard, high-backed seats, a large four-spoke wheel.',
    ],
  },
  vortex_r: {
    kind: 'an aggressive turbocharged hot hatch',
    look: [
      'Compact and wide: short overhangs, flared arches over big wheels, a steeply raked windscreen, a roof spoiler over a near-vertical hatch.',
      'Front: sharp angular headlights with LED-style running lights, a honeycomb mesh grille, big corner intakes, a splitter-style lower lip.',
      'Rear: tail lights wrapping round the corners, a black diffuser with a centre twin exhaust.',
      'Wheels: 18" ten-spoke wheels in dark grey.',
      'Inside: sporty bucket seats, a flat-bottomed three-spoke wheel, a dashboard with a digital-style instrument panel.',
    ],
  },
  brute_500: {
    kind: 'a big, 1970s-inspired V8 muscle car',
    look: [
      'Long and wide: a very long bonnet with a raised power bulge, a fastback roof sweeping down to a short deck with a ducktail lip, strong haunches over the rear wheels.',
      'Front: a full-width black grille with twin round headlights each side set into it, a chrome-edged bumper.',
      'Rear: a full-width tail-light bar, a chrome bumper, twin exhaust tips either side.',
      'Wheels: 19" five-spoke "star" wheels.',
      'Inside: a long dashboard with deep round dials, wide seats, a large three-spoke wheel with a big centre pad.',
    ],
  },
  strada_evo: {
    kind: 'a 1990s rally-homologation four-wheel-drive saloon',
    look: [
      'A practical three-box saloon made aggressive: boxy, flared front and rear arches, a bonnet with a big air vent, a tall boot lid (the spoiler is a part of its own: leave socket_spoiler empty).',
      'Front: rectangular headlights with twin round projectors in each, a small upper grille, a big lower intake with a mesh, fog-light recesses.',
      'Rear: rectangular tail lights, a black lower valance, a single large exhaust.',
      'Wheels: 17" six-spoke wheels in white or gold.',
      'Inside: bucket seats, a three-spoke wheel, a dashboard with a boost gauge.',
    ],
  },
  apex_v8: {
    kind: 'a mid-engined V8 supercar',
    look: [
      'Very low and wide, a wedge: a short sloping nose, the cabin pushed forward, a long engine cover behind it (its own part), big intakes in the sides ahead of the rear wheels, flying-buttress rear pillars.',
      'Front: slim slit-like headlights high on the wings, a low splitter, two large intakes.',
      'Rear: a full-width light bar, louvres in the engine cover, a big diffuser with the exhaust tips in its middle.',
      'Wheels: 20" ten-spoke wheels in black with a polished lip.',
      'Inside: a race-inspired cockpit: carbon-shell seats, a flat-bottomed wheel, a digital instrument pod.',
    ],
  },
};

// what each kind of part under a socket is, and how it hangs there
const ROLE = {
  bonnet: 'the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge',
  boot: 'the boot lid, hinged at its front edge (the socket), its underside modelled too',
  engine_cover: 'the engine cover over the mid engine, hinged at its front edge (the socket), with its louvres; its underside modelled too',
  bumper_front: 'the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate',
  bumper_rear: 'the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser',
  door_left: 'the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body\'s)',
  door_right: 'the right door, as the left one mirrored',
  fender_left: 'the left front wing, from the front bumper to the door, over the front wheel with its arch lip',
  fender_right: 'the right front wing, as the left one mirrored',
  skirt_left: 'the left sill cover, between the wheel arches under the door',
  skirt_right: 'the right sill cover, as the left one mirrored',
  mirror_left: 'the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X',
  mirror_right: 'the right door mirror, as the left one mirrored — reaching out to −X',
  seat: 'a seat: its base\'s middle at the socket, facing +Z',
  steering_wheel: 'the steering wheel: its rim in the socket\'s X–Y plane centred on the socket, the driver on the socket\'s −Z side (the socket is turned to tilt it), the boss and a fictional badge',
  engine: 'the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket',
  exhaust: 'the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal"',
  wheel: 'the wheel: the axle along the socket\'s X, the wheel\'s outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part\'s size, so the tyre only needs to be the right size',
  roof: 'the folding fabric soft top, raised: from the windscreen\'s top frame back to behind the seats, with its small rear window',
};

const fm = v => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
const xyz = p => `(${p.map(fm).join(', ')})`;
const size = b => b ? `about ${fm(b.max[0] - b.min[0])} × ${fm(b.max[1] - b.min[1])} × ${fm(b.max[2] - b.min[2])} m, from ${xyz(b.min)} to ${xyz(b.max)} in the socket's frame` : 'its own size';

async function promptFor(id, rules) {
  const car = readJson(`data/cars/${id}/car.json`), L = LOOKS[id];
  const partFile = Object.fromEntries(readJson('data/parts/index.json').parts.map(f => [path.basename(f, '.json'), `data/parts/${f}`]));
  const part = pid => partFile[pid] ? readJson(partFile[pid]) : null;
  // (each socket node the model has now: where it is — a node only drawn at, like the exhaust's tip, isn't a car.json
  // socket of its own — and its turn: the right-hand wheels' 180°, the steering column's tilt)
  const turns = {}, at = {};
  let shell = null;
  try {
    const doc = await readModel(path.join(ROOT, car.model.file));
    const sh = doc.getRoot().listNodes().find(n => n.getName() === 'body_shell');
    if (sh) shell = getBounds(sh);
    for (const n of doc.getRoot().listNodes()) {
      if (/^socket_/.test(n.getName())) at[n.getName()] = n.getTranslation();
      const [x, y, z, w] = n.getRotation();
      if (!/^socket_/.test(n.getName()) || (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4 && Math.abs(z) < 1e-4)) continue;
      turns[n.getName()] = Math.abs(y) > 0.99 ? 'turned 180° round Y' : Math.abs(x) > 1e-4 && Math.abs(y) < 1e-4 && Math.abs(z) < 1e-4 ? `tilted ${fm(2 * Math.atan2(x, w) * 180 / Math.PI)}° round X (its top towards the driver)` : `rotation (quaternion x, y, z, w) [${[x, y, z, w].map(fm).join(', ')}]`;
    }
  } catch { /* (no model yet: the rule for the wheels below still says it) */ }
  // the socket nodes (a socket drawn at another's node — a tyre on its wheel — has none of its own), and the parts
  // the model carries under them: the stock parts whose models the split makes for this car
  const names = new Set(car.sockets.map(s => s.name)), nodes = new Map();
  for (const s of car.sockets) {
    if (s.node && names.has(s.node)) continue;
    const node = s.node ?? s.name, stock = s.stock?.[0], p = stock && part(stock);
    const mine = p && (p.model ?? '').startsWith(`assets/parts/stock/${id}/`);
    if (!nodes.has(node)) nodes.set(node, { name: node, position: names.has(node) ? s.position : at[node] ?? s.position, slot: s.slot, part: mine ? p : null });
  }
  // the wheels: the stock rim and tyre
  const FL = car.sockets.find(s => s.name === car.model.sockets.FL), RL = car.sockets.find(s => s.name === car.model.sockets.RL);
  const rim = part(FL.stock[0])?.rim, tyreSock = car.sockets.find(s => s.node === FL.name && s.slot === 'tyre'), tyre = tyreSock && part(tyreSock.stock[0])?.tyreSize;
  const fit = rim && tyre ? tyreFit(rim, tyre) : null;
  const track = FL.position[0] * 2;
  // (its size: its design's, else its body's now)
  const designFile = path.join(ROOT, `data/cars/${id}/design.json`), design = fs.existsSync(designFile) ? JSON.parse(fs.readFileSync(designFile, 'utf8')) : null;
  const dims = design ? [design.length, design.width, design.height] : shell ? [shell.max[2] - shell.min[2], shell.max[0] - shell.min[0], shell.max[1]] : null;
  const body = ['body_shell', ...(car.model.breakables ?? []).map(b => b.node), 'dashboard'];
  const carried = [...nodes.values()].filter(n => n.part), empty = [...nodes.values()].filter(n => !n.part);
  const budget = Math.round(rules.car.triangles * 0.9 / 1000) * 1000;

  const lines = [
    `Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the ${car.name}, ${L.kind}. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.`,
    '',
    'The look:',
    ...L.look.map(l => `- ${l}`),
    `- Its factory paint: ${car.paint.colour} (the "paint" material's colour; the player can change it).`,
    '',
    `Size and stance (metres; the ground at y = 0): ${dims ? `about ${fm(dims[0])} m long, ${fm(dims[1])} m wide (without mirrors) and ${fm(dims[2])} m tall` : ''}${design ? `, ${fm(design.clearance)} m ground clearance; the belt line (the bottom of the side windows) about ${fm(design.beltline)} m up, the bonnet ${fm(design.bonnet.front)} m up at the nose rising to ${fm(design.bonnet.back)} m at the windscreen's foot (z = ${fm(design.bonnet.rear)}), the roof ${fm(design.roof.height)} m up from z = ${fm(design.roof.front)} to ${fm(design.roof.rear)}, the ${design.engineCover != null ? 'tail deck' : 'boot lid'} ${fm(design.deck.height)} m up from z = ${fm(design.deck.front)} back to the tail` : ''}. The wheel centres (exactly): front axle at z = ${fm(FL.position[2])}, rear axle at z = ${fm(RL.position[2])}, x = ±${fm(track / 2)}, y = ${fm(FL.position[1])}${fit ? ` — each wheel ${fm(fit.radius * 2)} m across: a ${rim.diameter}" rim in a ${fit.label} tyre (${Math.round(fit.width * 1000)} mm wide)` : ''}. The tyres' bottoms touch y = 0.`,
    '',
    'Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car\'s LEFT (as you sit in it), so −X is its right.',
    '',
    ...REALISM,
    '',
    'How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):',
    `1. One root node named "${id}".`,
    `2. The body, as meshes directly under the root, named exactly: ${body.map(n => `"${n}"`).join(', ')}.`,
    '   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills\' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.',
    '   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body\'s, not the door\'s).',
    '   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.',
    '   - "dashboard": the dashboard and instruments.',
    '3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.',
    '4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket\'s empty, modelled in the empty\'s own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.',
    '',
    'The parts to model, each under its socket:',
    // (a part in several sockets — the wheels, the seats — once, with each of its sockets)
    ...[...Map.groupBy(carried, n => n.part.id).values()].map(list => {
      const n = list[0], where = list.map(x => `${x.name} at ${xyz(x.position)}${turns[x.name] ? ` (${turns[x.name]})` : ''}`).join(', ');
      return `- ${where}: ${ROLE[n.part.slot] ?? ROLE[n.slot] ?? n.part.name}${list.length > 1 ? ' — the same model under each of these sockets' : ''} — "${n.part.name}", ${size(n.part.bounds)}.`;
    }),
    '',
    'The empty sockets (no mesh under them: for parts fitted in the game):',
    empty.map(n => `${n.name} ${xyz(n.position)}${turns[n.name] ? ` ${turns[n.name]}` : ''}`).join('; ') + '.',
    '',
    'Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels\' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.',
    '',
    'Rules:',
    `- Up to ${budget.toLocaleString('en-GB')} triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.`,
    '- Left and right mirror each other exactly (the left parts at +X, the right at −X).',
    '- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.',
    '- Export as glTF Binary (.glb), +Y up.',
    `Save it as car_${id}.glb.`,
  ];
  return lines.join('\n');
}

const rules = readJson('data/content/model-rules.json');
const ids = readJson('data/cars/index.json').cars.map(f => f.split('/')[0]);
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (only.length) { for (const id of only) console.log(await promptFor(id, rules), '\n'); process.exit(0); }
const out = [
  '# Car prompts for Claude Design',
  '',
  'One prompt for each car: paste it into Claude Design, and it makes the car\'s whole model as one `.glb` — the body with its glass and lights, every stock part (bonnet, bumpers, wings, doors, sills, mirrors, boot or engine cover, seats, steering wheel, engine, exhaust tip, wheels, a soft top) under its socket, and the empty sockets the upgrades go on. `npm run import` then splits it into the body and a model per part, exactly as for a hand-made car, so every part can be taken off, swapped and upgraded in the garage ([the modelling guide](MODELLING_GUIDE.md)).',
  '',
  'To put a car in the game:',
  '',
  '1. Paste its prompt into Claude Design. Look at what it made (front, back, both sides, underneath; with a panel hidden: is the car behind it finished?). Ask it for changes until it\'s right — but keep the node names, socket positions and sizes as they are.',
  '2. Download the `.glb`, named as the prompt says (`car_<id>.glb`), and put it in `incoming/`.',
  '3. Run `npm run import -- incoming/car_<id>.glb` (or ask Claude Code to). It checks the model against the rules (sizes, the sockets, the wheels on the ground, left and right mirroring, the paint material, the triangle budget), fixes what it can, says what to change if anything fails, then splits the car into its parts.',
  '4. Look at it in the garage (`dev/garage.html`) and on the road (`dev/world.html`), and its parts in the part preview (`dev/parts.html`).',
  '',
  'Socket positions and the wheels\' size are exact: they\'re what the car\'s physics and every part are fitted to. The parts\' sizes are the current ones (the placeholder boxes): a little bigger or smaller is fine; the import measures each part again. The **Starter coupe** is the physics reference car: its tests measure its parts\' sizes, so after its new model is imported its reference figures are checked and updated with it.',
  '',
  '## Making it look more real: follow-up prompts',
  '',
  'One prompt rarely gets a racing-game car first time. After the first model, send these one at a time in the same Claude Design conversation, looking at the car after each (close up, from every side), and repeat any that still needs it. Each keeps the names, sockets and sizes.',
  '',
  ...FOLLOW_UPS.flatMap(([title, text]) => [`**${title}**`, '', '```text', text, '```', '']),
  `_Written by \`npm run car-prompts\` (\`tools/car-prompts.mjs\`) from each car's data: change the data (or the looks in the tool) and run it again, rather than editing this file._`,
  '',
];
for (const id of ids) {
  const car = readJson(`data/cars/${id}/car.json`);
  out.push(`## ${car.name} (\`car_${id}.glb\`)`, '', '```text', await promptFor(id, rules), '```', '');
}
fs.writeFileSync(path.join(ROOT, 'docs/car_prompts.md'), out.join('\n'));
console.log(`wrote docs/car_prompts.md (${ids.length} cars)`);
