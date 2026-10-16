// Map v4's bake: tiles encoded (meshoptimizer) and gzipped in worker threads while the main thread builds the next
// ones — the slowest part of a bake, spread over the machine's cores. Each tile's bytes come back with its sha-256
// so the manifest's version is the same however the work was split.
//
//   const pool = await encodePool({ workers, gzipLevel })
//   await pool.write(tile, file) → { bytes, sha }      await pool.close()

import { Worker } from 'node:worker_threads';
import os from 'node:os';

// every typed array in a tile, for the transfer list
function buffers(o: any, out: Set<ArrayBuffer> = new Set()) {
  if (!o || typeof o !== 'object') return out;
  if (ArrayBuffer.isView(o)) { if (o.buffer instanceof ArrayBuffer && o.byteOffset === 0 && o.byteLength === o.buffer.byteLength) out.add(o.buffer); return out; }
  for (const v of Object.values(o)) buffers(v, out);
  return out;
}

export async function encodePool({ workers = 0, gzipLevel = 6 }: { workers?: number; gzipLevel?: number } = {}) {
  const n = workers > 0 ? workers : Math.max(1, os.cpus().length - 1);
  const pool = Array.from({ length: n }, () => new Worker(new URL('./encodeWorker.ts', import.meta.url)));
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>(), busy = new Map<Worker, number>();
  let next = 0;
  for (const w of pool) {
    busy.set(w, 0);
    w.on('message', m => { busy.set(w, busy.get(w)! - 1); const p = waiting.get(m.id); waiting.delete(m.id); if (m.error) p?.reject(new Error(m.error)); else p?.resolve(m); });
    w.on('error', e => { for (const p of waiting.values()) p.reject(e); });
  }
  return {
    workers: n,
    // (to the least busy worker; never more than 3 waiting on one, so the main thread's memory stays bounded)
    async write(tile: any, file: string) {
      for (;;) { const least = Math.min(...busy.values()); if (least < 3) break; await new Promise(r => setTimeout(r, 2)); }
      const w = pool.reduce((a, b) => (busy.get(a)! <= busy.get(b)! ? a : b)), id = next++;
      busy.set(w, busy.get(w)! + 1);
      const done = new Promise<{ bytes: number; sha: string }>((resolve, reject) => waiting.set(id, { resolve, reject }));
      w.postMessage({ id, tile, file, level: gzipLevel }, [...buffers(tile)]);
      return done;
    },
    async close() { while (waiting.size) await new Promise(r => setTimeout(r, 5)); await Promise.all(pool.map(w => w.terminate())); },
  };
}
