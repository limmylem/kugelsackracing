// Compressed textures (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): a model's textures that are at least `from` pixels
// on their longer side made KTX2 (Basis Universal, ktx2-encoder) — colour (base colour, emissive) as ETC1S, in sRGB;
// normal maps as UASTC tuned for normals; the rest (roughness, metalness, occlusion) as UASTC, linear — with
// mipmaps. They stay compressed on the graphics card (a quarter to an eighth of the memory) and the game's loader
// decodes them (garage/visual.js: the transcoder is fetched only when a model has one). Smaller textures (the game's
// palettes) stay PNG: compressing them saves nothing.
//
//   const done = await compressTextures(doc, rules.ktx2)   → ['body_paint.png 2048×2048 → KTX2 (ETC1S): 1.9 MB → 410 KB', …]

import sharp from 'sharp';
import { KHRTextureBasisu } from '@gltf-transform/extensions';

const SLOT_KIND = { baseColorTexture: 'colour', emissiveTexture: 'colour', normalTexture: 'normal' };
const kb = n => n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

export async function compressTextures(doc, { from = 512, quality = 160 } = {}) {
  const root = doc.getRoot(), done = [];
  const todo = root.listTextures().filter(t => ['image/png', 'image/jpeg', 'image/webp'].includes(t.getMimeType()) && Math.max(...(t.getSize() ?? [0, 0])) >= from);
  if (!todo.length) return done;
  const { encodeToKTX2 } = await import('ktx2-encoder');
  for (const t of todo) {
    const slots = new Set(doc.getGraph().listParentEdges(t).filter(e => e.getParent() !== root).map(e => e.getName()));
    const kind = [...slots].some(s => SLOT_KIND[s] === 'normal') ? 'normal' : [...slots].every(s => SLOT_KIND[s] === 'colour') && slots.size ? 'colour' : 'data';
    const before = t.getImage().byteLength, size = t.getSize();
    const options = {
      isUASTC: kind !== 'colour', isNormalMap: kind === 'normal', isSetKTX2SRGBTransferFunc: kind === 'colour', generateMipmap: true,
      qualityLevel: quality, needSupercompression: kind !== 'colour', enableDebug: false,
      imageDecoder: async buf => { const { data, info } = await sharp(Buffer.from(buf)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { width: info.width, height: info.height, data: new Uint8Array(data) }; },
    };
    // (the encoder talks to the console as it works: kept quiet)
    const log = console.log;
    let out;
    try { console.log = () => {}; out = await encodeToKTX2(t.getImage(), options); }
    finally { console.log = log; }
    t.setImage(out).setMimeType('image/ktx2');
    if (t.getURI()) t.setURI(t.getURI().replace(/\.(png|jpe?g|webp)$/i, '.ktx2'));
    done.push(`${t.getName() || t.getURI() || 'texture'} ${size.join('×')} → KTX2 (${kind === 'colour' ? 'ETC1S' : 'UASTC'}): ${kb(before)} → ${kb(out.byteLength)}`);
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  return done;
}
