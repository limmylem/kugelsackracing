// The Blender add-on's copy of the model rules, and the add-on as a zip to install (Phase 8 Step 3; docs/CONTENT_PIPELINE.md):
//  - tools/blender/ognistrada_tools/model_rules.json: data/content/model-rules.json with the finishes' names (the
//    add-on checks material names against them) — written by npm run guide too, and a unit test says if it's out of
//    date (tests/unit/blender.test.mjs)
//  - --zip: tools/blender/dist/ognistrada_tools.zip, for Blender › Edit › Preferences › Add-ons › Install from Disk
//
//   npm run blender-addon            (node tools/blender/build.mjs --zip)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { formatJson } from '../content/json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ADDON = path.join(ROOT, 'tools/blender/ognistrada_tools');

// The rules as the add-on reads them
export function addonRules(root = ROOT) {
  const rules = JSON.parse(fs.readFileSync(path.join(root, 'data/content/model-rules.json'), 'utf8'));
  rules.finishNames = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'data/finishes.json'), 'utf8')).finishes).sort();
  rules._copy = 'A copy of data/content/model-rules.json (and the finishes\' names) for the Blender add-on: written by npm run guide / npm run blender-addon — edit that file, not this one.';
  return formatJson(rules) + '\n';
}
export function writeAddonRules(root = ROOT) {
  const file = path.join(root, 'tools/blender/ognistrada_tools/model_rules.json'), text = addonRules(root);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { fs.writeFileSync(file, text); return true; }
  return false;
}

// A zip of the add-on's folder (deflated, no dependencies)
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipFolder(dir, prefix) {
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.') && f !== '__pycache__').sort(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = fs.readFileSync(path.join(dir, f)), packed = zlib.deflateRawSync(data), name = Buffer.from(`${prefix}/${f}`), crc = crc32(data);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0, 6); head.writeUInt16LE(8, 8); head.writeUInt32LE(0, 10);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(head, name, packed); central.push(cen, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = writeAddonRules();
  console.log(changed ? 'Wrote tools/blender/ognistrada_tools/model_rules.json' : 'model_rules.json is up to date');
  if (process.argv.includes('--zip')) {
    const out = path.join(ROOT, 'tools/blender/dist/ognistrada_tools.zip');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, zipFolder(ADDON, 'ognistrada_tools'));
    console.log(`Wrote ${path.relative(ROOT, out)}: in Blender, Edit › Preferences › Add-ons › Install from Disk, pick it, and tick "Ognistrada tools". The panel is in the 3D View's sidebar (N) › Ognistrada.`);
  }
}
