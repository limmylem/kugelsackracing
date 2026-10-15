// Map v5's chains and their parodies (Step 4; MAP_README.md, 'Brands and parodies'). The registry is
// data/map/v5/brands.json: every chain by its brand's Wikidata ID, the names it's known by (for finding it only — never
// drawn) and its parody (an invented name, colours, logo, site template).
//
//  · checkParodies(registry, nsi, threshold): every parody name against every real brand name — the registry's and the
//    name-suggestion-index's — normalised (case, accents, punctuation, spaces): the bake fails if any is within
//    `threshold` similarity (the larger of a trigram overlap and an edit-distance ratio), or holds as one of its words a
//    distinctive real name (seven letters or more) or any of its own chain's
//  · detectBrands({ registry, nsi, osm, places, cfg }): each place the map data has — OSM's points and areas, Overture's
//    places — matched in this order, each with its confidence:
//        OSM brand:wikidata                      1.0
//        Overture brand.wikidata                 0.95 (0.6 if its category disagrees: some of Overture's are wrong)
//        OSM brand (a known name)                0.9
//        Overture brand name                     0.85 (0.55 if its category disagrees)
//        the place's own name, by the name-suggestion-index or the registry's names
//                                                0.8 with an agreeing category, 0.5 on the name alone
//    kept at minConfidence or more (or a name on cfg.whitelist); the same chain twice within dedupe m is one outlet, and
//    for cfg.oneSite's categories (fuel) any two chains within siteDedupe m one site, the more confident's. Each outlet
//    says whether fuel's sold there (OSM amenity=fuel, Overture's gas station): a chain's shop alone gets no forecourt.
//
//   const R = loadRegistry(); checkParodies(R, nsi, 0.72) → { ok, worst: [{ parody, real, similarity }] }
//   detectBrands(...) → { outlets: [{ brand (registry index), x, z, confidence, source, category, name, fuel }], stats }

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const norm = (s: string) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const flat = (s: string) => norm(s).replace(/ /g, '');

export function loadRegistry(file = path.join(ROOT, 'data/map/v5/brands.json')) {
  const R = JSON.parse(fs.readFileSync(file, 'utf8'));
  R.byQid = new Map<string, number>(); R.byName = new Map<string, number>();
  R.brands.forEach((b: any, i: number) => { for (const q of b.wikidata) R.byQid.set(q, i); for (const n of b.real) R.byName.set(flat(n), i); });
  return R;
}
export function loadNsi(file = path.join(ROOT, '.cache/map/nsi/package/dist/json/nsi.min.json')) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// ---------- the parody names kept away from every real one ----------
function trigrams(s: string) { const t = new Set<string>(), p = `  ${s} `; for (let k = 0; k + 3 <= p.length; k++) t.add(p.slice(k, k + 3)); return t; }
function lev(a: string, b: string) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
export function similarity(a: string, b: string) {
  const x = flat(a), y = flat(b);
  if (!x || !y) return 0;
  const A = trigrams(x), B = trigrams(y); let i = 0; for (const t of A) if (B.has(t)) i++;
  const tri = i / (A.size + B.size - i), ed = 1 - lev(x, y) / Math.max(x.length, y.length);
  return Math.max(tri, ed);
}
export function realNames(R: any, nsi: any) {
  const out = new Set<string>();
  for (const b of R.brands) for (const n of b.real) out.add(n);
  if (nsi) for (const v of Object.values<any>(nsi.nsi)) for (const it of v.items) { if (it.tags?.brand) out.add(it.tags.brand); if (it.tags?.name) out.add(it.tags.name); }
  return [...out];
}
export function checkParodies(R: any, nsi: any, threshold: number) {
  const reals = realNames(R, nsi).map(n => ({ n, f: flat(n) })).filter(r => r.f.length >= 2), worst: { parody: string; real: string; similarity: number }[] = [];
  let ok = true;
  for (const b of R.brands) {
    const p = b.parody.name, pf = flat(p), words = new Set(norm(p).split(' '));
    let best = { real: '', similarity: 0 };
    for (const r of reals) {
      // (cheap first: lengths too far apart can't be close by either measure)
      if (Math.abs(r.f.length - pf.length) > Math.max(r.f.length, pf.length) * 0.6 && !pf.includes(r.f)) continue;
      // (a distinctive real name held whole — seven letters or more, a word of the parody's — is as bad as a near one)
      const s = r.f.length >= 7 && words.has(norm(r.n)) ? 1 : similarity(p, r.n);
      if (s > best.similarity) best = { real: r.n, similarity: s };
    }
    // (its own chain's names, whatever their length — "BP" in "Bright Fuel P…" — whole words only)
    for (const n of b.real) if (norm(n).split(' ').every(w => words.has(w))) best = { real: n, similarity: 1 };
    if (best.similarity >= threshold) ok = false;
    worst.push({ parody: p, ...best });
  }
  worst.sort((a, b) => b.similarity - a.similarity);
  return { ok, worst };
}

// ---------- chains in the map data ----------
export function detectBrands({ registry: R, nsi, osm, places, cfg }: { registry: any; nsi: any; osm: any; places: any[]; cfg: any }) {
  const C = cfg.brands, stats: Record<string, number> = { osmWikidata: 0, overtureWikidata: 0, osmBrand: 0, overtureBrand: 0, nsiName: 0, registryName: 0, lowConfidence: 0, outlets: 0, duplicates: 0 };
  // (the name-suggestion-index's names for the registry's chains: name → registry index)
  const nsiName = new Map<string, number>();
  if (nsi) for (const v of Object.values<any>(nsi.nsi)) for (const it of v.items) {
    const i = R.byQid.get(it.tags?.['brand:wikidata']); if (i === undefined) continue;
    for (const n of [it.tags.name, it.tags.brand, it.displayName, ...(it.matchNames ?? [])]) if (n) nsiName.set(flat(n), i);
  }
  const agrees = (i: number, osmTags: Record<string, string> | null, overtureCats: string[]) => {
    const cat = R.categories[R.brands[i].category];
    if (osmTags && cat.osm.some((kv: string) => { const [k, v] = kv.split('='); return osmTags[k] === v; })) return true;
    return overtureCats.some(c => cat.overture.includes(c));
  };
  const byName = (name: string) => { const f = flat(name); if (!f) return null; if (nsiName.has(f)) return { i: nsiName.get(f)!, how: 'nsiName' }; if (R.byName.has(f)) return { i: R.byName.get(f)!, how: 'registryName' }; // (a branch's name: the chain's name then a place, "BP Glen Osmond")
    for (const [k, i] of R.byName) if (k.length >= 3 && f.startsWith(k) && f.length > k.length) return { i, how: 'registryName' }; return null; };
  const found: { brand: number; x: number; z: number; confidence: number; source: string; category: string; name: string; fuel: boolean }[] = [];
  // (fuel sold there: OSM's amenity=fuel, Overture's gas station — a chain's shop alone, a 7-Eleven in the city, isn't a
  // petrol station)
  const FUEL = /gas_station|fuel|petrol|service_station|truck_stop/;
  const consider = (x: number, z: number, name: string, tags: Record<string, string> | null, ov: any | null) => {
    let hit: { i: number; c: number; how: string } | null = null;
    const cats = ov ? [ov.basic_category, ov.taxonomy?.primary, ...(ov.taxonomy?.hierarchy ?? [])].filter(Boolean) : [];
    if (tags?.['brand:wikidata'] && R.byQid.has(tags['brand:wikidata'])) hit = { i: R.byQid.get(tags['brand:wikidata'])!, c: 1, how: 'osmWikidata' };
    else if (ov?.brand?.wikidata && R.byQid.has(ov.brand.wikidata)) { const i = R.byQid.get(ov.brand.wikidata)!; hit = { i, c: agrees(i, null, cats) ? 0.95 : 0.6, how: 'overtureWikidata' }; }
    else if (tags?.brand && byName(tags.brand)) hit = { i: byName(tags.brand)!.i, c: 0.9, how: 'osmBrand' };
    else if (ov?.brand?.names?.primary && byName(ov.brand.names.primary)) { const i = byName(ov.brand.names.primary)!.i; hit = { i, c: agrees(i, null, cats) ? 0.85 : 0.55, how: 'overtureBrand' }; }
    else if (name) { const m = byName(name); if (m) hit = { i: m.i, c: agrees(m.i, tags, cats) ? 0.8 : 0.5, how: m.how }; }
    if (!hit) return;
    const whitelisted = (C.whitelist ?? []).some((w: string) => flat(w) === flat(name));
    if (hit.c < C.minConfidence && !whitelisted) { stats.lowConfidence++; return; }
    stats[hit.how]++;
    found.push({ brand: hit.i, x, z, confidence: hit.c, source: hit.how, category: R.brands[hit.i].category, name, fuel: tags?.amenity === 'fuel' || cats.some(c => FUEL.test(c)) });
  };
  for (const p of osm.points) if (p.tags.brand || p.tags['brand:wikidata'] || ((p.tags.amenity || p.tags.shop) && p.tags.name)) consider(p.x, p.z, p.tags.name ?? '', p.tags, null);
  for (const a of osm.areas) {
    const t = a.tags;
    if (!(t.brand || t['brand:wikidata'] || ((t.amenity || t.shop) && t.name))) continue;
    const r = a.parts[0][0]; let x = 0, z = 0; for (const q of r) { x += q.x; z += q.z; }
    consider(x / r.length, z / r.length, t.name ?? '', t, null);
  }
  for (const p of places) if (p.x != null && (p.operating_status ?? 'open') !== 'permanently_closed') consider(p.x, p.z, p.names?.primary ?? '', null, p);
  // (one outlet per chain within dedupe m: the most confident)
  found.sort((a, b) => b.confidence - a.confidence);
  const outlets: typeof found = [];
  // (and one chain a site, for the oneSite categories — a forecourt has one brand, though the data may name two)
  stats.sameSite = 0;
  for (const f of found) {
    const dup = outlets.find(o => o.brand === f.brand && Math.hypot(o.x - f.x, o.z - f.z) < C.dedupe);
    if (dup) { dup.fuel ||= f.fuel && Math.hypot(dup.x - f.x, dup.z - f.z) < C.siteDedupe; stats.duplicates++; continue; }
    const site = (C.oneSite ?? []).includes(f.category) && outlets.find(o => o.category === f.category && Math.hypot(o.x - f.x, o.z - f.z) < C.siteDedupe);
    if (site) { site.fuel ||= f.fuel; stats.sameSite++; continue; }
    outlets.push(f);
  }
  stats.outlets = outlets.length;
  return { outlets, stats };
}
