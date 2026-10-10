// Development server: serves the game's files (like `python3 -m http.server`, with byte ranges, as a
// static host or CDN serves the world's .pmtiles map) and lets the tuning
// panel save back into the data: car definitions, part definitions and tuning presets (PUT, from this
// machine only).
//
//   node tools/serve.mjs [port]      (npm start; default port 7690, all network interfaces like before)
//   HOST=127.0.0.1 node tools/serve.mjs    to serve this machine only
//
// Writes are limited to data/cars/<car>/car.json, data/parts/<category>/<part>.json and
// data/presets/<name>.json, must be valid JSON, and the previous version of a file is kept in
// data/.backup/ (the newest 20 of each).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = +(process.argv[2] || process.env.PORT || 7690), host = process.env.HOST || '0.0.0.0';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.opus': 'audio/ogg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.pbf': 'application/x-protobuf', '.pmtiles': 'application/vnd.pmtiles', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.ico': 'image/x-icon',
};
const WRITABLE = /^\/data\/(cars\/[a-z0-9_]+\/car|parts\/[a-z0-9_]+\/[a-z0-9_]+|presets\/[A-Za-z0-9][A-Za-z0-9 _.-]{0,60})\.json$/;
const local = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), rel = decodeURIComponent(url.pathname);
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) return send(res, 403, 'Forbidden');

  if (req.method === 'PUT') {
    if (!WRITABLE.test(rel)) return send(res, 403, 'Only car, part and preset files in data/ can be saved');
    if (!local(req)) return send(res, 403, 'Saving is only allowed from this machine');
    let body = '';
    try {
      for await (const chunk of req) { body += chunk; if (body.length > 1e6) return send(res, 413, 'Too big'); }
      JSON.parse(body);
    } catch { return send(res, 400, 'Not valid JSON'); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) backup(file);
    fs.writeFileSync(file, body.endsWith('\n') ? body : body + '\n');
    console.log(`saved ${rel}`);
    return send(res, 200, 'Saved');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

  let target = file, stat;
  try { stat = fs.statSync(target); if (stat.isDirectory()) { target = path.join(target, 'index.html'); stat = fs.statSync(target); } } catch { return send(res, 404, 'Not found'); }
  // a byte range of a file (the world's map tiles are read this way: world/pmtiles.js)
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = stat.size, start = range[1] ? +range[1] : Math.max(0, size - +range[2]), end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
    if (start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(target, { start, end }).pipe(res);
  }
  fs.readFile(target, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const type = TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
    // car specs, scenes and code change while tuning: always fetch them fresh
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

function backup(file) {
  const dir = path.join(root, 'data', '.backup'), base = path.relative(path.join(root, 'data'), file).replace(/\.json$/, '').split(path.sep).join('.');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(dir, `${base}.${stamp}.json`));
  const old = fs.readdirSync(dir).filter(f => f.startsWith(base + '.')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 20))) fs.unlinkSync(path.join(dir, f));
}

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

server.listen(port, host, () => console.log(`Drive world on http://localhost:${port} (saving cars, parts and presets from this machine into data/)`));
