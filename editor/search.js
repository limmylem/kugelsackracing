// Finding places for the editor: coordinates typed in ("37.79, -122.39", or degrees, minutes and seconds),
// the baked region's own places and test spots (no network needed), then OpenStreetMap's place search
// (Nominatim) for anywhere else on Earth. And bookmarks, kept in this browser.
//
//   await findPlaces(text, { regionManifest, projection }) → [{ name, detail, lat, lon, zoom }]
//   bookmarks.list() / add({ name, lat, lon, zoom, view }) / remove(index)

import { parseLatLon } from '../content/geo.js';
import { localStorageGet, localStorageSet } from '../content/client.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export async function findPlaces(text, { regionManifest = null, projection = null, fetchFn = (...a) => fetch(...a) } = {}) {
  const q = text.trim();
  if (!q) return [];
  const ll = parseLatLon(q);
  if (ll) return [{ name: `${ll.lat.toFixed(6)}, ${ll.lon.toFixed(6)}`, detail: 'coordinates', ...ll, zoom: 17 }];
  const out = [], low = q.toLowerCase();
  // the region's places (neighbourhoods, its test spots)
  if (regionManifest) {
    for (const s of regionManifest.spots ?? []) if (`${s.name} ${s.kind}`.toLowerCase().includes(low)) out.push({ name: s.name, detail: `${regionManifest.name} · ${s.kind}`, lat: s.lat, lon: s.lon, zoom: 17 });
    if (projection) for (const p of regionManifest.places ?? []) if (p.name.toLowerCase().includes(low)) { const [lat, lon] = projection.toLatLon(p.xz[0], p.xz[1]); out.push({ name: p.name, detail: `${regionManifest.name} · ${p.kind}`, lat, lon, zoom: 15 }); }
  }
  // anywhere else: OpenStreetMap's place search
  try {
    const r = await fetchFn(`${NOMINATIM}?format=jsonv2&limit=8&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
    if (r.ok) for (const p of await r.json()) out.push({ name: p.name || p.display_name.split(',')[0], detail: p.display_name, lat: +p.lat, lon: +p.lon, zoom: p.type === 'city' || p.type === 'administrative' ? 12 : p.class === 'highway' ? 17 : 15 });
  } catch { if (!out.length) out.push({ name: 'Place search unavailable', detail: 'OpenStreetMap\'s search can\'t be reached: type coordinates instead (lat, lon)', lat: null, lon: null }); }
  return out.slice(0, 12);
}

const KEY = 'kugelsack.editor.bookmarks';
export const bookmarks = {
  list() { try { return JSON.parse(localStorageGet(KEY) ?? '[]'); } catch { return []; } },
  add(b) { const l = bookmarks.list(); l.push({ name: b.name, lat: +b.lat.toFixed(7), lon: +b.lon.toFixed(7), zoom: b.zoom ?? 16, view: b.view ?? 'map' }); localStorageSet(KEY, JSON.stringify(l)); return l; },
  remove(i) { const l = bookmarks.list(); l.splice(i, 1); localStorageSet(KEY, JSON.stringify(l)); return l; },
};
