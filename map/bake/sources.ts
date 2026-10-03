// The bake's inputs, fetched once into .cache/map/<region>/: the region's OpenStreetMap data, clipped to
// it with osmium. From the region's Geofabrik extract when it can be downloaded; otherwise rebuilt from
// Overture Maps (map/bake/osmBridge.ts) — the manifest records which.
//
//   const osm = await osmExtract(region, { cacheDir, log }) → { file (.osm.pbf), source, url, date }
//   run(cmd, args) — a command-line tool (osmium, gdal…, java), failing loudly

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { overtureToOsm } from './osmBridge.ts';

export function run(cmd: string, args: string[], { log = null as ((s: string) => void) | null, env = {} as Record<string, string>, quiet = false } = {}) {
  log?.(`  $ ${cmd} ${args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, ...env } });
  if (r.error) throw new Error(`${cmd}: ${r.error.message} (is it installed? see MAP_README.md)`);
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}):\n${(r.stderr || r.stdout).slice(-3000)}`);
  if (!quiet && r.stderr?.trim()) log?.(r.stderr.trim().split('\n').slice(-3).map(l => `    ${l}`).join('\n'));
  return r.stdout;
}

async function download(url: string, file: string, log) {
  if (fs.existsSync(file)) return true;
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
    if (!head.ok) throw new Error(`HTTP ${head.status}`);
    log(`  downloading ${url} (${(Number(head.headers.get('content-length') ?? 0) / 1e6).toFixed(0)} MB)…`);
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const out = fs.createWriteStream(file + '.part');
    for await (const chunk of r.body as any) out.write(chunk);
    await new Promise(res => out.end(res));
    fs.renameSync(file + '.part', file);
    return true;
  } catch (e) {
    log(`  can't download ${url}: ${e.cause?.code ?? e.message}`);
    return false;
  }
}

export async function osmExtract(region, { cacheDir, log }) {
  const [w, s, e, n] = region.bbox, pad = 0.003;   // (a margin: roads leaving the region keep their ends)
  const clipped = path.join(cacheDir, `${region.id}.osm.pbf`), info = clipped + '.json';
  if (fs.existsSync(clipped) && fs.existsSync(info)) return { file: clipped, ...JSON.parse(fs.readFileSync(info, 'utf8')) };
  let whole: string | null = null, source = 'geofabrik', url = region.osm.extract;
  if (url) {
    const f = path.join(cacheDir, '..', 'osm', path.basename(new URL(url).pathname));
    if (await download(url, f, log)) whole = f;
  }
  if (!whole) {
    if (region.osm.fallback !== 'overture') throw new Error(`no OpenStreetMap extract for ${region.id}: download ${url} by hand into .cache/map/osm/`);
    log('  falling back to OpenStreetMap data rebuilt from Overture Maps');
    const xml = await overtureToOsm({ region, cacheDir, log });
    whole = xml.replace(/\.osm$/, '.osm.pbf');
    if (!fs.existsSync(whole)) run('osmium', ['cat', xml, '-o', whole, '--overwrite'], { log });
    source = 'overture'; url = `https://overturemaps-us-west-2.s3.amazonaws.com/release/${region.overture.release}/`;
  }
  run('osmium', ['extract', '-b', `${w - pad},${s - pad},${e + pad},${n + pad}`, '--strategy', 'complete_ways', whole, '-o', clipped, '--overwrite'], { log });
  const meta = { source, url, date: fs.statSync(whole).mtime.toISOString().slice(0, 10) };
  fs.writeFileSync(info, JSON.stringify(meta));
  return { file: clipped, ...meta };
}
