// Map v5's landmarks (Step 6; MAP_README.md, 'Landmarks'):
//
//  · rankLandmarks: every building scored by how much it stands out — its height, its footprint, a Wikipedia or
//    Wikidata entry, a landmark's kind (a stadium, a cathedral, a station, a tower), a name — the top `top` of the
//    region flagged (props.v5.landmark: its rank), drawn in the far layer too: seen from anywhere in the region
//  · the hand-made ones (data/map/v5/landmarks/landmarks.json): a glTF model each, anchored by an OSM id (the
//    building it stands in for, hidden) or a lat/lon, turned `rotation` degrees, scaled `scale`, on the ground there;
//    a box collider if it gives one ([width, height, depth] m), else drawn only. Entries "enabled": false are kept as
//    examples (example-placeholder.gltf: a plain block, to copy)
//
//   rankLandmarks(buildings, cfg) → [{ id, name, score, h }] (best first)
//   overrides({ file, buildings, P, groundAt }) → { models: [{ file, x, y, z, yaw, scale, box }], hidden, missing }

import fs from 'node:fs';
import path from 'node:path';

const ringArea = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
const inRing = (r: number[][], x: number, z: number) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };

export function rankLandmarks(buildings: any[], cfg: any) {
  const L = cfg.landmarks, scored: { b: any; score: number }[] = [];
  for (const b of buildings) {
    const p = b.props, h = p.h ?? 0, A = ringArea(b.rings[0]);
    if (h < L.minHeight && !p.wd) continue;
    let score = Math.pow(Math.max(1, h), L.heightPower) * Math.sqrt(Math.max(1, A));
    if (p.wd) score *= L.wikiBonus;
    if (L.kinds.includes(String(p.b ?? '').toLowerCase())) score *= L.kindBonus;
    if (p.name) score *= L.nameBonus;
    scored.push({ b, score });
  }
  scored.sort((a, q) => q.score - a.score || a.b.id - q.b.id);
  // (one a landmark: its parts share it)
  const seen = new Set<number>(), out: { id: number; name: string | null; score: number; h: number }[] = [];
  for (const { b, score } of scored) {
    if (out.length >= L.top) break;
    const v5 = b.props.v5 ?? (b.props.v5 = {});
    if (!seen.has(b.id)) { seen.add(b.id); out.push({ id: b.id, name: b.props.name ?? null, score: Math.round(score), h: b.props.h }); }
    v5.landmark = out.length;
  }
  return out;
}

export function overrides({ file, buildings, P, groundAt, outDir }: { file: string; buildings: any[]; P: any; groundAt: (x: number, z: number) => number; outDir: string }) {
  const out = { models: [] as any[], hidden: 0, missing: [] as string[] };
  if (!fs.existsSync(file)) return out;
  const list = JSON.parse(fs.readFileSync(file, 'utf8')).landmarks ?? [];
  for (const e of list) {
    if (e.enabled === false) continue;
    const src = path.join(path.dirname(file), e.file);
    if (!fs.existsSync(src)) { out.missing.push(e.file); continue; }
    // (where: the building with that OSM id, or the lat/lon given)
    let x = NaN, z = NaN;
    const osmId = e.osm ? String(e.osm).replace(/^(way|relation)\//, '') : null;
    const hits = osmId ? buildings.filter(b => b.props.osm === osmId) : [];
    if (hits.length) { let sx = 0, sz = 0, n = 0; for (const b of hits) for (const q of b.rings[0]) { sx += q[0]; sz += q[1]; n++; } x = sx / n; z = sz / n; }
    if (e.lat != null && e.lon != null) [x, z] = P.toXZ(e.lat, e.lon);
    if (!Number.isFinite(x)) { out.missing.push(`${e.file} (no building ${e.osm})`); continue; }
    // (the generated building it stands for hidden: by its id, or the one it stands in)
    const hide = hits.length ? hits : buildings.filter(b => inRing(b.rings[0], x, z));
    for (const b of hide) { (b.props.v5 ??= {}).hidden = true; out.hidden++; }
    fs.mkdirSync(path.join(outDir, 'models'), { recursive: true });
    fs.copyFileSync(src, path.join(outDir, 'models', path.basename(e.file)));
    out.models.push({ file: `models/${path.basename(e.file)}`, x, y: groundAt(x, z) + (e.lift ?? 0), z, yaw: (e.rotation ?? 0) * Math.PI / 180, scale: e.scale ?? 1, box: e.box ?? null, name: e.name ?? null });
  }
  return out;
}
