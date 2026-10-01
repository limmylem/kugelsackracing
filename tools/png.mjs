// A small PNG reader (8-bit greyscale / RGB / RGBA / palette, not interlaced): enough to read texture
// atlases in the build scripts without a dependency. decodePng(bytes) → { width, height, pixel(x, y) → [r, g, b, a] }

import zlib from 'node:zlib';

export function decodePng(bytes) {
  const buf = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let width, height, depth, type, interlace, palette = null, alpha = null;
  const idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') alpha = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (bit depth ${depth}${interlace ? ', interlaced' : ''})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`unsupported PNG colour type ${type}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels, out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= channels && y ? out[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      out[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  const pixel = (x, y) => {
    const i = y * stride + x * channels;
    if (type === 3) { const k = out[i]; return [palette[3 * k], palette[3 * k + 1], palette[3 * k + 2], alpha && k < alpha.length ? alpha[k] : 255]; }
    if (type === 0) return [out[i], out[i], out[i], 255];
    if (type === 4) return [out[i], out[i], out[i], out[i + 1]];
    return [out[i], out[i + 1], out[i + 2], type === 6 ? out[i + 3] : 255];
  };
  return { width, height, pixel };
}
