// Overture Maps data for a box, straight from its public GeoParquet files (AWS S3, no account): only the
// row groups whose extent meets the box are read, over HTTP range requests, and only the columns asked
// for. What each file's row groups cover is kept in the cache (.cache/world/overture/<release>/), so the
// next build of the same release knows at once which parts of which files to read.
//
//   await overtureRows({ release, theme: 'buildings', type: 'building', bbox: [w, s, e, n], columns })
//     → [{ ...row, geometry: GeoJSON geometry }] (inside or touching the box)
//   await latestRelease() → '2026-09-23.1'

import fs from 'node:fs';
import path from 'node:path';
import { asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetReadObjects, parquetSchema } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

export const BUCKET = 'https://overturemaps-us-west-2.s3.amazonaws.com';
const CONCURRENCY = 12;

async function listKeys(prefix) {
  const keys = [];
  let token = null;
  do {
    const url = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
    const xml = await (await retry(() => fetch(url))).text();
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key><LastModified>[^<]*<\/LastModified><ETag>[^<]*<\/ETag>(?:<Checksum[^>]*>[^<]*<\/Checksum[^>]*>)*<Size>(\d+)<\/Size>/g)) keys.push({ key: m[1], size: +m[2] });
    if (!keys.length) for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push({ key: m[1], size: null });
    token = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? null;
  } while (token);
  return keys.filter(k => k.key.endsWith('.parquet') || !k.key.endsWith('/'));
}
// The newest release in the bucket
export async function latestRelease() {
  const xml = await (await retry(() => fetch(`${BUCKET}/?list-type=2&prefix=release/&delimiter=/`))).text();
  return [...xml.matchAll(/<Prefix>release\/([^<]+)\/<\/Prefix>/g)].map(m => m[1]).sort().at(-1);
}
async function retry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { const r = await fn(); if (r?.ok === false && r.status >= 500) throw new Error(`HTTP ${r.status}`); return r; }
    catch (e) { if (i >= tries) throw e; await new Promise(r => setTimeout(r, 1000 * 2 ** i)); }
  }
}
// (a few at a time)
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
const statOf = (rg, name) => {
  const c = rg.columns.find(c => c.meta_data?.path_in_schema?.join('.') === name)?.meta_data?.statistics;
  const v = c?.min_value ?? c?.min, w = c?.max_value ?? c?.max;
  return [typeof v === 'number' ? v : Number(v), typeof w === 'number' ? w : Number(w)];
};
// Every file's row groups and their extents: [{ key, groups: [{ start, rows, box: [w, s, e, n] }] }]
async function fileIndex(release, theme, type, cacheDir, log) {
  const file = path.join(cacheDir, 'overture', release, `${theme}-${type}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = await listKeys(`release/${release}/theme=${theme}/type=${type}/`);
  log?.(`  indexing ${keys.length} ${theme}/${type} files (once per release)…`);
  const index = await pool(keys, CONCURRENCY, async ({ key, size }) => {
    const buf = await retry(() => asyncBufferFromUrl({ url: `${BUCKET}/${key}`, byteLength: size ?? undefined }));
    const md = await retry(() => parquetMetadataAsync(buf));
    let start = 0;
    const groups = md.row_groups.map(rg => {
      const rows = Number(rg.num_rows), [xmin] = statOf(rg, 'bbox.xmin'), [, xmax] = statOf(rg, 'bbox.xmax'), [ymin] = statOf(rg, 'bbox.ymin'), [, ymax] = statOf(rg, 'bbox.ymax');
      const g = { start, rows, box: [xmin, ymin, xmax, ymax] };
      start += rows;
      return g;
    });
    return { key, size: buf.byteLength, groups, columns: parquetSchema(md).children.map(c => c.element.name) };
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(index));
  return index;
}
const meets = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export async function overtureRows({ release, theme, type, bbox, columns, cacheDir = '.cache/world', log = null }) {
  const index = await fileIndex(release, theme, type, cacheDir, log);
  const jobs = [];
  for (const f of index) {
    // (neighbouring row groups that both meet the box are read together)
    let run = null;
    for (const g of f.groups) {
      const hit = g.box.every(Number.isFinite) ? meets(g.box, bbox) : true;
      if (hit && run && run.end === g.start) run.end += g.rows;
      else if (hit) jobs.push(run = { f, start: g.start, end: g.start + g.rows });
      else run = null;
    }
  }
  // (only the columns this type has: a building part has no class, say)
  const has = new Set(index[0]?.columns ?? []);
  const want = columns ? [...new Set([...columns, 'bbox', 'geometry'])].filter(c => !has.size || has.has(c)) : undefined;
  const out = [];
  let done = 0;
  await pool(jobs, CONCURRENCY, async job => {
    const file = cachedAsyncBuffer(await retry(() => asyncBufferFromUrl({ url: `${BUCKET}/${job.f.key}`, byteLength: job.f.size })));
    const rows = await retry(() => parquetReadObjects({ file, columns: want, rowStart: job.start, rowEnd: job.end, compressors }));
    for (const r of rows) { const b = r.bbox; if (!b || meets([b.xmin, b.ymin, b.xmax, b.ymax], bbox)) out.push(r); }
    log?.(`  ${theme}/${type}: ${++done} of ${jobs.length} parts read`, true);
  });
  return out;
}
