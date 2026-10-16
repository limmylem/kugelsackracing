// A worker thread of the bake's encode pool (map/bake/encodePool.ts): a tile encoded, gzipped, written; its size and
// sha-256 sent back.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MeshoptEncoder } from 'meshoptimizer';
import { encodeTile } from '../format/tileFormat.ts';

await MeshoptEncoder.ready;
parentPort!.on('message', ({ id, tile, file, level }) => {
  try {
    const bytes = zlib.gzipSync(encodeTile(tile, MeshoptEncoder), { level });
    fs.writeFileSync(file, bytes);
    parentPort!.postMessage({ id, bytes: bytes.length, sha: crypto.createHash('sha256').update(bytes).digest('hex') });
  } catch (e: any) { parentPort!.postMessage({ id, error: String(e?.stack ?? e) }); }
});
