// A small 2D plotter for map debugging: a world-frame window drawn top down (north up) into an RGB image —
// triangles filled, lines, points — and written as a PNG. No dependencies.
//
//   const P = plot(x0, z0, size, px)   P.tri(ax, az, bx, bz, cx, cz, rgb)   P.line(ax, az, bx, bz, rgb)   P.dot(x, z, rgb, r)   P.save(file)

import fs from 'node:fs';
import zlib from 'node:zlib';

export function plot(x0: number, z0: number, size: number, px = 900) {
  const W = px, H = px, img = new Uint8Array(W * H * 3).fill(255), k = px / size;
  const X = (x: number) => (x - x0) * k, Y = (z: number) => (z - z0) * k;
  const set = (x: number, y: number, c: number[]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; };
  return {
    fill(c: number[]) { for (let i = 0; i < W * H; i++) { img[i * 3] = c[0]; img[i * 3 + 1] = c[1]; img[i * 3 + 2] = c[2]; } },
    tri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, c: number[]) {
      const A = [X(ax), Y(az)], B = [X(bx), Y(bz)], Cc = [X(cx), Y(cz)];
      const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], Cc[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], Cc[0]))), minY = Math.max(0, Math.floor(Math.min(A[1], B[1], Cc[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], Cc[1])));
      const d = (B[1] - Cc[1]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[1] - Cc[1]);
      if (Math.abs(d) < 1e-12) return;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const l1 = ((B[1] - Cc[1]) * (x + 0.5 - Cc[0]) + (Cc[0] - B[0]) * (y + 0.5 - Cc[1])) / d, l2 = ((Cc[1] - A[1]) * (x + 0.5 - Cc[0]) + (A[0] - Cc[0]) * (y + 0.5 - Cc[1])) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) set(x, y, c);
      }
    },
    line(ax: number, az: number, bx: number, bz: number, c: number[]) {
      const A = [X(ax), Y(az)], B = [X(bx), Y(bz)], n = Math.ceil(Math.max(Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1]))) + 1;
      for (let q = 0; q <= n; q++) set(Math.round(A[0] + (B[0] - A[0]) * q / n), Math.round(A[1] + (B[1] - A[1]) * q / n), c);
    },
    dot(x: number, z: number, c: number[], r = 2) { const cx = Math.round(X(x)), cy = Math.round(Y(z)); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= r * r) set(cx + a, cy + b, c); },
    save(file: string) {
      const raw = Buffer.alloc(H * (W * 3 + 1));
      for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
      const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
      fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
    },
  };
}
let table: Int32Array | null = null;
function crc32(buf: Buffer) {
  if (!table) { table = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; } }
  let c = -1; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
