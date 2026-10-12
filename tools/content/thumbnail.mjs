// Studio thumbnails (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): each part seen as a player would want to see it — on
// the outside of a car (body panels, aero, wheels, the exhaust, cosmetics), fitted to a car it goes on (the reference
// car if it fits, else the first) with whatever it needs, from three-quarters on from the end it's at; anything else
// (what's under the bonnet or inside) on its own — on a studio backdrop with a soft floor shadow. Drawn without a
// browser (tools/content/icon.mjs's renderer), as WebP, into assets/thumbs/<id>.webp; a thumbnail is made again only
// when something it shows changes (data/content/thumbs.json: each one's key — the models in it, their looks, the car).
// The content manager shows them; the site serves them versioned like the models (garage/contentBundle.js).
//
//   const r = await makeThumbnails({ only, all, log })   → { made: [id], kept: n, none: [id] }

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadProject } from './project.mjs';
import { readModel } from './io.mjs';
import { inspect } from './inspect.mjs';
import { renderInfo } from './icon.mjs';
import { ROOT, readJson, typeForPart } from './rules.mjs';
import { formatJson } from './json.mjs';
import { fitWithNeeds, forCar, REFERENCE_CAR } from '../../garage/balance.js';
import { placed } from '../generators/lib/fitcheck.js';
import { resolveLook } from '../../garage/visual.js';
import { partShape } from '../../garage/partShape.js';
import { tyreFit } from '../../garage/tyres.js';

export const W = 360, H = 225, VERSION = 1;
const ON_CAR = new Set(['aero', 'body', 'wheels', 'exhaust', 'cosmetic']);
const INDEX = 'data/content/thumbs.json';
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const apply = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const RUBBER = { getName: () => 'rubber' };
// (the backdrop: a light studio wall fading into the floor)
const BACKDROP = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3f5f7"/><stop offset="0.62" stop-color="#dfe4e8"/><stop offset="1" stop-color="#c7ced4"/></linearGradient>
<radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#2a3138" stop-opacity="0.42"/><stop offset="1" stop-color="#2a3138" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/><ellipse cx="${W / 2}" cy="${H * 0.8}" rx="${W * 0.44}" ry="${H * 0.09}" fill="url(#s)"/></svg>`);

const docs = new Map();
async function infoOf(root, file) {
  if (!docs.has(file)) docs.set(file, inspect(await readModel(path.join(root, file))));
  return docs.get(file);
}
const fileHash = (root, f) => { const full = path.join(root, f); return fs.existsSync(full) ? sha(fs.readFileSync(full)) : 'none'; };

// What a part's thumbnail shows: { tris, view, key } or null (nothing to show: no model)
async function scene(root, db, rules, part) {
  const own = partShape(part, db.parts).model;
  if (!own) return null;
  const tris = [], models = [], add = (info, m, look) => { for (const t of info.triangles) tris.push({ p: m ? t.p.map(v => apply(m, v)) : t.p, uv: t.uv, mat: t.mat, material: t.material, look }); };
  const carId = ON_CAR.has(part.category) ? (forCar(db, REFERENCE_CAR, part) ? REFERENCE_CAR : Object.keys(db.cars).sort().find(c => forCar(db, c, part))) : null;
  const fit = carId ? fitWithNeeds(db, carId, part.id) : null;
  let view, paint = '#3f6f8f';
  if (fit?.ok) {
    const car = db.cars[carId], { parts } = await placed(db, car, fit.garage);
    add(await infoOf(root, car.model.file), null, null);
    models.push(car.model.file);
    for (const e of parts) { add(await infoOf(root, e.model), e.matrix, e.look ?? null); models.push(`${e.model}:${JSON.stringify(e.look ?? null)}`); }
    // (the tyres: the game makes them from their size — here a plain ring on each wheel)
    const build = fit.garage.build, owned = fit.garage.state.parts, spec = fit.garage.stats().spec;
    for (const s of car.sockets.filter(x => x.slot === 'tyre')) {
      const tyre = db.parts[owned[build.sockets[s.name]]?.partId], wheel = car.sockets.find(x => x.name === s.node), rim = db.parts[owned[build.sockets[wheel?.name]]?.partId]?.rim;
      if (!tyre?.tyreSize || !rim || !wheel) continue;
      const f = tyreFit(rim, tyre.tyreSize), corner = Object.entries(car.model.sockets ?? {}).find(([, n]) => n === wheel.name)?.[0];
      const off = (spec?.wheels?.offsets?.[corner] ?? 0) * Math.sign(wheel.position[0] || 1);
      tris.push(...ring([wheel.position[0] + off, wheel.position[1], wheel.position[2]], f.rimRadius, f.radius, f.width).map(p => ({ p, mat: RUBBER })));
      models.push(`tyre:${tyre.id}:${rim.diameter}`);
    }
    const at = car.sockets.find(s => s.slot === part.slot)?.position ?? [0, 0, 1];
    view = { azimuth: at[2] >= -0.2 ? 38 : 148, elevation: 13 };
    paint = car.paint?.colour ?? paint;
  } else {
    const { look } = resolveLook(part, db.parts);
    add(await infoOf(root, own), null, look ?? null);
    models.push(`${own}:${JSON.stringify(look ?? null)}`);
    const type = typeForPart(part, rules);
    view = { ...rules.icon, ...(rules.types[type]?.icon ?? {}) };
  }
  const key = sha(JSON.stringify({ v: VERSION, carId: fit?.ok ? carId : null, view, paint, models: models.map(m => { const [f, ...rest] = m.split(':'); return f.endsWith('.glb') ? `${fileHash(root, f)}:${rest.join(':')}` : m; }) }));
  return { tris, view, paint, key, onCar: !!fit?.ok };
}

// A tyre as a plain ring about x: its tread and both walls
function ring(c, r0, r1, w, n = 28) {
  const out = [], P = (r, a, x) => [c[0] + x, c[1] + Math.sin(a) * r, c[2] + Math.cos(a) * r];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
    for (const [ra, rb, xa, xb] of [[r1, r1, -w / 2, w / 2], [r0, r1, w / 2, w / 2], [r0, r1, -w / 2, -w / 2]]) {
      const q = [P(ra, a, xa), P(rb, a, xb), P(rb, b, xb), P(ra, b, xa)];
      out.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
    }
  }
  return out;
}

export async function renderThumbnail(root, db, rules, part) {
  const s = await scene(root, db, rules, part);
  if (!s) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of s.tris) for (const p of t.p) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  const info = { triangles: s.tris, bounds: { min, max, size: max.map((v, k) => v - min[k]), centre: max.map((v, k) => (v + min[k]) / 2) } };
  // (a car: square, then its middle band — a car is wider than it's tall; a part on its own: as tall as the frame, in
  // the middle of it)
  const size = s.onCar ? W : Math.round(H * 0.96), img = await renderInfo(info, { rules, type: 'car', size, paintColour: s.paint, view: s.view, raw: true });
  const raw = sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } });
  const png = s.onCar ? await raw.extract({ left: 0, top: Math.round((W - H) / 2 + H * 0.06), width: W, height: H }).png().toBuffer() : await raw.png().toBuffer();
  const at = s.onCar ? { left: 0, top: 0 } : { left: Math.round((W - size) / 2), top: Math.round((H - size) / 2) };
  return { key: s.key, webp: await sharp(BACKDROP).composite([{ input: png, ...at }]).webp({ quality: 80 }).toBuffer() };
}

export async function makeThumbnails({ root = ROOT, only = null, all = false, log = () => {} } = {}) {
  const { db, rules } = await loadProject(root), index = fs.existsSync(path.join(root, INDEX)) ? readJson(INDEX, root) : { _note: '', thumbs: {} };
  index._note = 'Each part\'s studio thumbnail (assets/thumbs/<id>.webp) and the key of what it shows: made again by npm run content -- thumbnails when that changes (tools/content/thumbnail.mjs). Not to edit by hand.';
  const out = { made: [], kept: 0, none: [] };
  const list = Object.values(db.parts).filter(p => !p.retired && (!only || only.includes(p.id) || only.includes(p.generated?.family)));
  let n = 0;
  for (const part of list) {
    if (++n % 50 === 0) log(`  ${n}/${list.length}…`);
    const s = await scene(root, db, rules, part).catch(err => { log(`  ${part.id}: ${err.message}`); return null; });
    const file = `assets/thumbs/${part.id}.webp`;
    if (!s) { out.none.push(part.id); if (index.thumbs[part.id]) { delete index.thumbs[part.id]; fs.rmSync(path.join(root, file), { force: true }); } continue; }
    if (!all && index.thumbs[part.id] === s.key && fs.existsSync(path.join(root, file))) { out.kept++; continue; }
    const r = await renderThumbnail(root, db, rules, part);
    fs.mkdirSync(path.join(root, 'assets/thumbs'), { recursive: true });
    fs.writeFileSync(path.join(root, file), r.webp);
    index.thumbs[part.id] = r.key;
    out.made.push(part.id);
  }
  // (a part that's gone: its thumbnail too)
  for (const id of Object.keys(index.thumbs)) if (!db.parts[id] || db.parts[id].retired) { delete index.thumbs[id]; fs.rmSync(path.join(root, `assets/thumbs/${id}.webp`), { force: true }); }
  index.thumbs = Object.fromEntries(Object.entries(index.thumbs).sort());
  fs.writeFileSync(path.join(root, INDEX), formatJson(index) + '\n');
  return out;
}
