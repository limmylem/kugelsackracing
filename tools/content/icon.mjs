// Part icons, drawn without a browser: a small software renderer (orthographic, z-buffered, flat
// shaded like the game) that draws a model from its type's angle (data/content/model-rules.json icon:
// azimuth round +y from the front, elevation) under the same lights every time, with the paint in one
// colour so all icons match, onto a transparent PNG (supersampled for smooth edges).
//
//   const png = await renderIcon(doc, { rules, type })     → PNG bytes (a Buffer)

import sharp from 'sharp';
import { inspect } from './inspect.mjs';

const SS = 3;                     // supersampling
const PAD = 0.08;                 // margin round the model, of the size

export async function renderIcon(doc, { rules, type, size, paintColour, look = null }) {
  const view = { ...rules.icon, ...(type === 'car' ? rules.car.icon : rules.types[type]?.icon) };
  const S = (size ?? view.size) * SS, info = inspect(doc);
  const rgba = new Float32Array(S * S * 4), depth = new Float32Array(S * S).fill(Infinity);
  if (!info.triangleCount) return encode(rgba, S);

  // the camera: looking at the model's middle from azimuth / elevation
  const az = view.azimuth * Math.PI / 180, el = view.elevation * Math.PI / 180;
  const back = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];      // towards the camera
  const right = norm(cross([0, 1, 0], back)), up = cross(back, right), c = info.bounds.centre;
  const proj = p => { const d = sub(p, c); return [dot(d, right), dot(d, up), -dot(d, back)]; };
  const pts = info.triangles.map(t => t.p.map(proj));
  let ext = 0;
  for (const t of pts) for (const p of t) ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1]));
  const k = S * (1 - 2 * PAD) / 2 / (ext || 1), toPx = p => [S / 2 + p[0] * k, S / 2 - p[1] * k, p[2]];

  // lights (in the camera's frame, so every icon is lit the same)
  const key = norm(add(add(scale(right, -0.55), scale(up, 0.85)), scale(back, 0.6))), fill = norm(add(add(scale(right, 0.8), scale(up, 0.15)), scale(back, 0.5)));
  const half = norm(add(key, back));
  const materials = await materialLook(info, rules, paintColour ?? view.paintColour, look);

  info.triangles.forEach((tri, ti) => {
    const P = pts[ti].map(toPx), m = materials.get(tri.mat) ?? materials.get(null);
    let n = norm(cross(sub(tri.p[1], tri.p[0]), sub(tri.p[2], tri.p[0])));
    if (dot(n, back) < 0) n = scale(n, -1);          // (both sides drawn)
    const diffuse = 0.36 + 0.64 * Math.max(0, dot(n, key)) + 0.22 * Math.max(0, dot(n, fill));
    const refl = sub(scale(n, 2 * dot(n, back)), back), env = 0.25 + 0.75 * (refl[1] + 1) / 2;
    const spec = (1 - m.roughness) * (0.2 + 0.8 * m.metalness) * Math.max(0, dot(n, half)) ** (2 / (m.roughness ** 2 + 0.02));
    const shade = colour => colour.map(v => Math.min(1, v * diffuse * (1 - 0.65 * m.metalness) + v * env * 0.9 * m.metalness + spec));
    const flat = m.texture ? null : shade(m.colour);
    // (the texture: sampled per pixel, the UVs interpolated across the triangle)
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxX = Math.min(S - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxY = Math.min(S - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const area = edge(P[0], P[1], P[2]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const q = [x + 0.5, y + 0.5], w0 = edge(P[1], P[2], q) / area, w1 = edge(P[2], P[0], q) / area, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2], i = y * S + x;
      if (z >= depth[i]) continue;
      depth[i] = z;
      let col = flat;
      if (!col) {
        const uv = tri.uv ? [0, 1].map(j => w0 * tri.uv[0][j] + w1 * tri.uv[1][j] + w2 * tri.uv[2][j]) : [0, 0];
        col = shade(sample(m.texture, uv).map((v, j) => v * m.colour[j]));
      }
      rgba[i * 4] = col[0]; rgba[i * 4 + 1] = col[1]; rgba[i * 4 + 2] = col[2]; rgba[i * 4 + 3] = 1;
    }
  });
  return encode(rgba, S);
}

// Each material's colour (sRGB 0–1), metalness, roughness and texture, as the icon draws it: the paint
// in the icon colour, a finish material in its finish, a part's look (a variant's finish) over it all
async function materialLook(info, rules, paintColour, look) {
  const out = new Map([[null, { colour: [0.6, 0.6, 0.6], metalness: 0, roughness: 0.7 }]]), images = new Map();
  const finishOf = id => id && rules.finishes[id] ? { ...rules.finishes[id], colour: rules.finishes[id].colour ?? null } : null;
  for (const tri of info.triangles) {
    const mat = tri.mat;
    if (!mat || out.has(mat)) continue;
    const name = mat.getName(), own = look?.materials?.[name] ?? {}, lookFinish = finishOf(own.finish ?? look?.finish), lookColour = own.colour ?? look?.colour;
    let entry;
    if (name === 'paint' && !lookFinish && !lookColour) entry = { colour: hex(paintColour), metalness: 0.1, roughness: 0.4 };
    else if (lookFinish || lookColour) entry = { colour: hex(lookColour ?? lookFinish?.colour ?? (name === 'paint' ? paintColour : '#b8bdc4')), metalness: lookFinish?.metalness ?? 0.1, roughness: lookFinish?.roughness ?? 0.45, keep: lookFinish?.keepTexture };
    else if (rules.finishes[name]) { const f = rules.finishes[name]; entry = { colour: hex(f.colour ?? '#c0c4c9'), metalness: f.metalness ?? 0, roughness: f.roughness ?? 0.5 }; }
    else {
      const t = mat.getBaseColorTexture(), fac = mat.getBaseColorFactor();
      entry = { colour: fac.slice(0, 3).map(toSrgb), metalness: mat.getMetallicFactor(), roughness: mat.getRoughnessFactor() };
      if (t?.getImage()) {
        if (!images.has(t)) { const { data, info: i } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); images.set(t, { data, width: i.width, height: i.height }); }
        entry.texture = images.get(t);
      }
    }
    if (entry.keep === false) delete entry.texture;
    out.set(mat, entry);
  }
  return out;
}
function sample(t, [u, v]) {
  const x = Math.min(t.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * t.width))), y = Math.min(t.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * t.height)));
  const o = (y * t.width + x) * 4;
  return [t.data[o] / 255, t.data[o + 1] / 255, t.data[o + 2] / 255];
}

// supersampled → the icon size, alpha-weighted; a faint light edge so dark parts show on the dark UI
async function encode(rgba, S) {
  const s = S / SS, out = Buffer.alloc(s * s * 4), alpha = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) { const i = ((y * SS + dy) * S + x * SS + dx) * 4, w = rgba[i + 3]; r += rgba[i] * w; g += rgba[i + 1] * w; b += rgba[i + 2] * w; a += w; }
    const o = (y * s + x) * 4;
    alpha[y * s + x] = a / SS / SS;
    if (a) { out[o] = Math.round(r / a * 255); out[o + 1] = Math.round(g / a * 255); out[o + 2] = Math.round(b / a * 255); out[o + 3] = Math.round(a / SS / SS * 255); }
  }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = y * s + x;
    if (alpha[i] > 0.02) continue;
    let near = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < s && Y < s) near = Math.max(near, alpha[Y * s + X]); }
    if (near > 0.3) { const o = i * 4; out[o] = out[o + 1] = out[o + 2] = 200; out[o + 3] = 46; }
  }
  return sharp(out, { raw: { width: s, height: s, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

const edge = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const toSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
const sub = (a, b) => a.map((v, i) => v - b[i]), add = (a, b) => a.map((v, i) => v + b[i]), scale = (a, k) => a.map(v => v * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => scale(a, 1 / (Math.hypot(...a) || 1));
