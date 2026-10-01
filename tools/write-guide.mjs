// Writes the parts of the modelling docs that come from the model rules (data/content/model-rules.json),
// so they always say what the checker checks:
//  - docs/MODELLING_GUIDE.md: the tables between <!-- rules:start --> and <!-- rules:end -->
//  - docs/part_prompt_templates.md: a ready-to-use prompt for each part type (the whole file)
//
//   npm run guide              (npm run guide -- --check: exit 1 if either is out of date)

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadRules } from './content/rules.mjs';

const rules = loadRules(), check = process.argv.includes('--check');
const ORIGIN = { centre: 'middle', min: { x: 'right-hand edge', y: 'bottom', z: 'back' }, max: { x: 'left-hand edge', y: 'top', z: 'front' }, within: 'anywhere inside', any: 'anywhere' };
const originWords = o => ['x', 'y', 'z'].map(a => { const r = o[a] ?? 'within', w = typeof ORIGIN[r] === 'string' ? ORIGIN[r] : ORIGIN[r][a]; return `${a}: ${w}`; }).join(', ');
const range = r => r ? `${r[0]}–${r[1]}` : 'any';
const materials = `${rules.materials.names.map(n => `\`${n}\``).join(', ')}, \`light_*\`${rules.materials.finishes ? `, or a finish: ${Object.keys(rules.finishes).map(f => `\`${f}\``).join(', ')}` : ''}`;

// ---------- the guide's tables ----------
const tables = [
  '<!-- rules:start (written by npm run guide from data/content/model-rules.json: edit that file, not these tables) -->',
  '',
  '### Part types',
  '',
  'Name the file `<type>_<name>.glb` (or with one of the other names). Sizes are metres: wide = across the car (x), tall = up (y), long = front to back (z).',
  '',
  '| Type | File names | Goes in | Wide | Tall | Long | Origin | Triangles |',
  '|---|---|---|---|---|---|---|---|',
  ...Object.entries(rules.types).map(([k, t]) => `| ${t.label} | ${[k, ...(t.names ?? []).filter(n => n !== k)].map(n => `\`${n}_…\``).join(' ')} | ${t.category} / ${t.slot} | ${range(t.size.x)} | ${range(t.size.y)} | ${range(t.size.z)} | ${t.attach} | ${t.triangles.toLocaleString('en-GB')} |`),
  '',
  `The origin may be ${rules.originTolerance * 100} cm off (${Object.entries(rules.types).filter(([, t]) => t.originTolerance).map(([k, t]) => `${k}: ${t.originTolerance * 100} cm`).join(', ') || 'every type the same'}). Over the triangle budget is a warning; over twice it, a failure.`,
  '',
  '### Cars',
  '',
  `| | |`,
  `|---|---|`,
  `| File name | \`car_<id>.glb\` (the whole car, each part's mesh under its socket node) |`,
  `| Size | ${range(rules.car.size.length)} m long, ${range(rules.car.size.width)} m wide, ${range(rules.car.size.height)} m tall |`,
  `| Wheelbase / track | ${range(rules.car.wheelbase)} m / ${range(rules.car.track)} m |`,
  `| Wheel sockets | at each wheel's centre, ${range(rules.car.wheelRadius)} m up (the stock wheel's radius, give or take ${rules.car.wheelHeightTolerance * 100} cm) |`,
  `| Left / right sockets | mirror each other to ${rules.car.mirrorTolerance * 100} cm |`,
  `| Triangles | ${rules.car.triangles.toLocaleString('en-GB')} for the whole car |`,
  `| Paint | the body's painted surfaces use the material \`${rules.car.paintMaterial}\` |`,
  `| Must have | ${rules.car.requiredSockets.map(s => `\`${s}\``).join(', ')} |`,
  `| Should have | ${rules.car.expectedSockets.map(s => `\`${s}\``).join(', ')} |`,
  '',
  '### Materials and textures',
  '',
  `Material names: ${materials}. Textures at most ${rules.textureMaxSize}×${rules.textureMaxSize}, sides a power of two.`,
  '',
  '<!-- rules:end -->',
].join('\n');

// ---------- the prompts ----------
const prompts = [
  '# Part prompt templates',
  '',
  'Ready-to-use prompts for making each kind of part in Claude Design, following [the modelling guide](MODELLING_GUIDE.md). Copy one, fill in the bits in [brackets], and drop the .glb it makes into `incoming/`, then run `npm run import`.',
  '',
  '_Written by `npm run guide` from `data/content/model-rules.json`: change the rules there and run it again, rather than editing this file._',
  '',
  '## Every part: the shared rules',
  '',
  'Put this at the end of any prompt (the per-part prompts below already include it):',
  '',
  '```text',
  shared(),
  '```',
  '',
  ...Object.entries(rules.types).flatMap(([k, t]) => [
    `## ${t.label}`,
    '',
    '```text',
    `Make a low-poly 3D model of a ${t.label.toLowerCase()} for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).`,
    '',
    `Size: ${range(t.size.x)} m wide (across the car), ${range(t.size.y)} m tall and ${range(t.size.z)} m long (front to back).`,
    `Origin (the point it attaches by, at 0, 0, 0): ${t.attach}.`,
    `Triangles: under ${t.triangles.toLocaleString('en-GB')}.`,
    k === 'rim' ? 'Only the rim: no tyre (the game makes the tyre to fit). It turns about the X axis (the axle); its outer face points +X.' : '',
    /(door|fender|skirt|mirror)_(left|right)/.test(k) ? `This is the ${k.endsWith('left') ? 'left' : 'right'}-hand one (the car's ${k.endsWith('left') ? 'left, +X' : 'right, −X'}).` : '',
    ['bonnet', 'boot', 'bumper_front', 'bumper_rear', 'door_left', 'door_right', 'fender_left', 'fender_right', 'mirror_left', 'mirror_right', 'spoiler'].includes(k) ? 'Surfaces in the car\'s body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".' : 'Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car\'s body colour.',
    '',
    shared(),
    `Save it as ${k}_[name].glb.`,
    '```',
    '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '')),
  '## A whole car',
  '',
  '```text',
  `Make a low-poly 3D model of [the car] for a stylised racing game, ${range(rules.car.size.length)} m long, ${range(rules.car.size.width)} m wide and ${range(rules.car.size.height)} m tall, standing on the ground (y = 0), under ${rules.car.triangles.toLocaleString('en-GB')} triangles.`,
  '',
  'Axes: +Y up, the car\'s front towards +Z, its left (the driver\'s left as they sit in it) towards +X. Units: metres.',
  `Every part is its own mesh under an empty named for its socket: ${[...rules.car.requiredSockets, ...rules.car.expectedSockets].join(', ')}. Each empty sits where its part attaches (see the part types for where that is). The wheel sockets are at each wheel's centre; the right-hand ones (socket_wheel_FR, socket_wheel_RR) are turned 180° round Y so their +X points out of the car, like the left ones.`,
  'Left and right sockets mirror each other exactly (same y and z, x the other way).',
  `The body's painted surfaces use the material "paint"; glass "glass"; head and tail lights "light_head" and "light_tail"; everything else "car_atlas" (a palette texture) or a finish material.`,
  'No cameras, lights or animations. Flat-shaded, with normals. Export as glTF Binary (.glb) with +Y up.',
  'Save it as car_[id].glb.',
  '```',
  '',
].join('\n');
function shared() {
  return [
    'Rules:',
    '- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car\'s left.',
    `- Material names, exactly: ${materials.replace(/`/g, '"')}.`,
    `- Textures at most ${rules.textureMaxSize}×${rules.textureMaxSize}, square, a power of two.`,
    '- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.',
    '- Only meshes: no cameras, lights, animations, armatures or extra scenes.',
    '- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).',
  ].join('\n');
}

// ---------- write (or check) ----------
const guideFile = path.join(ROOT, 'docs/MODELLING_GUIDE.md'), promptFile = path.join(ROOT, 'docs/part_prompt_templates.md');
const guide = fs.readFileSync(guideFile, 'utf8'), a = guide.indexOf('<!-- rules:start'), b = guide.indexOf('<!-- rules:end -->');
if (a < 0 || b < 0) { console.error('docs/MODELLING_GUIDE.md has no <!-- rules:start --> … <!-- rules:end --> markers'); process.exit(1); }
const newGuide = guide.slice(0, a) + tables + guide.slice(b + '<!-- rules:end -->'.length);
const stale = [[guideFile, guide, newGuide], [promptFile, fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '', prompts]].filter(([, was, now]) => was !== now);
if (check) { for (const [f] of stale) console.log(`${path.relative(ROOT, f)} is out of date: npm run guide`); process.exit(stale.length ? 1 : 0); }
for (const [f, , now] of stale) { fs.writeFileSync(f, now); console.log(`wrote ${path.relative(ROOT, f)}`); }
if (!stale.length) console.log('The docs are up to date.');
