// Map v3's maps (ported from v2's world/worldMap.js): a round minimap in the corner, turning with the car, and the full
// map (Tab) with quick travel to the region's test spots. Both are MapLibre GL JS drawing the region's
// own map tiles — the same PMTiles file Planetiler made from the very OSM data the tiles were baked from (map.pmtiles),
// read through world/pmtiles.js with range requests, no tile server — so the map and the world agree
// street for street.
//
//   const maps = await createWorldMaps({ manifest, base, onTravel(spot) })
//   maps.update(lat, lon, bearingDeg, speed)  each frame (redrawn only when the car has moved or turned)
//   maps.toggle() → open?, maps.open, maps.show(on), maps.dispose()
//   maps.setContent(features, onPick)  world content near the player (play/contentLayer.js): marked on both,
//   clustered on the full map when zoomed out; onPick(id) when one's clicked; a quest's state (properties
//   state: new | attempted | completed, medal) in its colour and mark
//   maps.setLines(features)  a quest's route and the guide line to its start, on both
//   maps.side, maps.onOpen(fn(open)), maps.close(), maps.flyTo(lat, lon)  the full map's panel (quest finding)
//
// Also for the editor (editor/mapView.js): maplibre() loads MapLibre, regionStyle() the region's map style.

import { openPmtiles, httpSource } from '../format/pmtiles.ts';

const VERSION = '6.11.2', CDN = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VERSION}/dist`;
const GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', FONT = ['Open Sans Semibold'];
const files = new Map<string, any>();
let lib: any = null;

// MapLibre, once (its stylesheet too), with the world's PMTiles protocol: wpm://<file url>/{z}/{x}/{y}
export function maplibre() {
  return lib ??= (async () => {
    if (!document.getElementById('maplibreCss')) { const l = document.createElement('link'); l.id = 'maplibreCss'; l.rel = 'stylesheet'; l.href = `${CDN}/maplibre-gl.css`; document.head.appendChild(l); }
    const m = await import(`${CDN}/maplibre-gl.mjs`), ml = m.default ?? m;
    ml.addProtocol('wpm', async params => {
      const [, file, z, x, y] = params.url.match(/^wpm:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/);
      const url = decodeURIComponent(file);
      if (!files.has(url)) files.set(url, openPmtiles(httpSource(url)));
      const bytes = await (await files.get(url)).tile(+z, +x, +y);
      return { data: bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : new ArrayBuffer(0) };
    });
    return ml;
  })();
}

// the map's look: the schema's layers (world/schema.js), quiet colours, roads by class, names
export function style(tilesUrl: string, header: any) {
  // (the layers map/bake/planetiler.yml makes: water, landuse, buildings, rail, roads, places — k kind, n name)
  const src = 'world', byKind = (pairs: [string[], any][], fallback: any) => ['match', ['get', 'k'], ...pairs.flatMap(([kinds, v]) => [kinds, v]), fallback];
  const width = (base: any, add = 0) => ['interpolate', ['exponential', 1.6], ['zoom'], 12, ['+', add, ['*', base, 0.35]], 16, ['+', add, ['*', base, 2.2]], 19, ['+', add, ['*', base, 9]]];
  const major = ['motorway', 'trunk', 'motorway_link', 'trunk_link'], main = ['primary', 'secondary', 'primary_link', 'secondary_link'], minor = ['tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'road', 'busway'];
  const drivable = ['in', ['get', 'k'], ['literal', [...major, ...main, ...minor, 'service', 'track']]];
  const roadWidth = byKind([[major, 4.5], [main, 3.6], [minor, 2.4]], 1.4);
  return {
    version: 8, glyphs: GLYPHS,
    sources: { [src]: { type: 'vector', tiles: [tilesUrl], minzoom: header.minZoom, maxzoom: header.maxZoom, bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat] } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e8e4da' } },
      { id: 'landuse', type: 'fill', source: src, 'source-layer': 'landuse', paint: { 'fill-color': byKind([[['park', 'grass', 'garden', 'recreation_ground', 'golf_course', 'meadow', 'village_green', 'cemetery', 'pitch', 'grassland', 'playground'], '#c6dfa6'], [['forest', 'wood', 'nature_reserve', 'scrub', 'heath'], '#a9cb8f'], [['sand', 'beach'], '#f0e3b8'], [['industrial', 'railway', 'commercial', 'retail'], '#e2dbd2'], [['parking', 'fuel'], '#dcd8d0']], '#ebe6dc') } },
      { id: 'water', type: 'fill', source: src, 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#9ec5e2' } },
      { id: 'waterways', type: 'line', source: src, 'source-layer': 'water', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#9ec5e2', 'line-width': 1.5 } },
      { id: 'buildings', type: 'fill', source: src, 'source-layer': 'buildings', minzoom: 13, paint: { 'fill-color': '#d3c9bb', 'fill-outline-color': '#bcb09f' } },
      { id: 'paths', type: 'line', source: src, 'source-layer': 'roads', minzoom: 15, filter: ['in', ['get', 'k'], ['literal', ['footway', 'path', 'cycleway', 'pedestrian', 'steps']]], paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-dasharray': [2, 1.5] } },
      { id: 'rail', type: 'line', source: src, 'source-layer': 'rail', filter: ['!=', ['get', 'tn'], 1], paint: { 'line-color': '#a3a3a3', 'line-width': 1.2, 'line-dasharray': [3, 2] } },
      { id: 'roads-casing', type: 'line', source: src, 'source-layer': 'roads', filter: ['all', drivable, ['!=', ['get', 'tn'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', ['==', ['get', 'br'], 1], 2, 0] }, paint: { 'line-color': '#b3aa9c', 'line-width': width(roadWidth, 1.2) } },
      { id: 'roads', type: 'line', source: src, 'source-layer': 'roads', filter: ['all', drivable, ['!=', ['get', 'tn'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', ['==', ['get', 'br'], 1], 2, 0] }, paint: { 'line-color': byKind([[major, '#f1a35c'], [main, '#f8d27f'], [minor, '#ffffff']], '#f7f5f1'), 'line-width': width(roadWidth) } },
      { id: 'tunnels', type: 'line', source: src, 'source-layer': 'roads', filter: ['all', drivable, ['==', ['get', 'tn'], 1]], paint: { 'line-color': '#c9c2b5', 'line-width': width(2.4), 'line-dasharray': [1, 1] } },
      { id: 'road-names', type: 'symbol', source: src, 'source-layer': 'roads', minzoom: 14, filter: ['all', drivable, ['has', 'n']], layout: { 'symbol-placement': 'line', 'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 14], 'text-rotation-alignment': 'map', 'symbol-spacing': 280 }, paint: { 'text-color': '#3b3a36', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } },
      { id: 'places', type: 'symbol', source: src, 'source-layer': 'places', maxzoom: 15.5, layout: { 'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': ['match', ['get', 'k'], 'city', 15, 12], 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 }, paint: { 'text-color': '#6d6455', 'text-halo-color': '#f4f1ea', 'text-halo-width': 1.5 } },
    ],
  };
}

const css = `
#worldMini { position: fixed; top: 12px; right: 12px; width: 190px; height: 190px; border-radius: 50%; overflow: hidden; z-index: 21; border: 3px solid rgba(15, 20, 30, .75); box-shadow: 0 4px 14px rgba(0, 0, 0, .35); background: #e8e4da; cursor: pointer; }
#worldMini .maplibregl-canvas { outline: none; }
#worldMiniCar, #worldFullCar { position: absolute; left: 50%; top: 50%; width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 18px solid #e2462f; transform: translate(-50%, -60%); filter: drop-shadow(0 1px 1px #0008); pointer-events: none; z-index: 2; }
#worldMiniN { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); font: 700 11px system-ui, sans-serif; color: #e2462f; text-shadow: 0 0 3px #fff; z-index: 2; pointer-events: none; transform-origin: 50% 91px; }
#worldFull { position: fixed; inset: 5vh 5vw; z-index: 45; display: none; border-radius: 12px; overflow: hidden; background: #e8e4da; box-shadow: 0 10px 40px rgba(0, 0, 0, .5); }
#worldFullMap { position: absolute; inset: 0; }
#worldFullSide { position: absolute; top: 12px; left: 12px; z-index: 3; width: 250px; max-height: calc(100% - 24px); overflow: auto; background: rgba(15, 20, 30, .86); color: #fff; border-radius: 10px; padding: 10px 12px; font: 13px/1.4 system-ui, sans-serif; }
#worldFullSide h3 { margin: 0 0 6px; font-size: 14px; }
#worldFullSide button { display: block; width: 100%; text-align: left; margin: 3px 0; padding: 6px 8px; border: 0; border-radius: 7px; background: rgba(255, 255, 255, .1); color: #fff; font: inherit; cursor: pointer; }
#worldFullSide button:hover { background: rgba(94, 200, 255, .35); }
#worldFullSide small { opacity: .7; }
.worldCarMarker { width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 20px solid #e2462f; filter: drop-shadow(0 1px 2px #000a); }
@media (max-width: 560px) { #worldMini { width: 130px; height: 130px; } #worldFullSide { width: 180px; } }`;

// the region's map style (its own PMTiles), for any MapLibre map
export async function regionStyle(manifest: any, base: string) {
  await maplibre();
  const fileUrl = new URL(manifest.files.map, base).href;
  if (!files.has(fileUrl)) files.set(fileUrl, openPmtiles(httpSource(fileUrl)));
  const pm = await files.get(fileUrl);
  return style(`wpm://${encodeURIComponent(fileUrl)}/{z}/{x}/{y}`, pm.header);
}

// World content on a map: a GeoJSON source (clustered when zoomed out) and its layers — colour by kind,
// the cluster's count — kept up to date by setContent; clicks on one call onPick(id)
const KIND_COLOUR = ['match', ['get', 'kind'], 'quest', '#ffb02e', 'poi', '#4fc3f7', 'spawn', '#7ee08a', 'route', '#e05cff', 'venue', '#ff5a5f', '#ccc'];
// a quest's colour by how far the player's got with it: new (bright), tried, done (its medal's colour)
const MEDAL_COLOUR = ['match', ['get', 'medal'], 'gold', '#f2c230', 'silver', '#c9d1d9', 'bronze', '#cd7f32', '#8fd18a'];
const POINT_COLOUR = ['case', ['==', ['get', 'state'], 'completed'], MEDAL_COLOUR, ['==', ['get', 'state'], 'attempted'], '#c7832a', KIND_COLOUR];
export function contentLayers(map: any, { cluster = true, labels = true, prefix = 'content' } = {}) {
  const src = `${prefix}-src`, empty = { type: 'FeatureCollection', features: [] };
  let data: any = empty, pick: ((id: string) => void) | null = null;
  const add = () => {
    if (map.getSource(src)) return;
    map.addSource(src, { type: 'geojson', data, cluster, clusterRadius: 44, clusterMaxZoom: 14 });
    map.addLayer({ id: `${prefix}-clusters`, type: 'circle', source: src, filter: ['has', 'point_count'], paint: { 'circle-color': '#ffb02e', 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 100, 22, 1000, 28] } });
    map.addLayer({ id: `${prefix}-count`, type: 'symbol', source: src, filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT, 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#1b1b1b' } });
    map.addLayer({ id: `${prefix}-points`, type: 'circle', source: src, filter: ['!', ['has', 'point_count']], paint: { 'circle-color': POINT_COLOUR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 9], 'circle-stroke-color': ['case', ['boolean', ['get', 'selected'], false], '#ff3d3d', '#ffffff'], 'circle-stroke-width': ['case', ['boolean', ['get', 'selected'], false], 3.5, 2], 'circle-opacity': ['case', ['==', ['get', 'status'], 'draft'], 0.75, 1] } });
    // (a quest's state: ✓ done, its medal's colour; • tried)
    map.addLayer({ id: `${prefix}-marks`, type: 'symbol', source: src, filter: ['all', ['!', ['has', 'point_count']], ['has', 'state'], ['!=', ['get', 'state'], 'new']], layout: { 'text-field': ['match', ['get', 'state'], 'completed', '✓', '•'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 16, 13], 'text-allow-overlap': true }, paint: { 'text-color': '#1b1b1b' } });
    if (labels) map.addLayer({ id: `${prefix}-labels`, type: 'symbol', source: src, minzoom: 13, filter: ['!', ['has', 'point_count']], layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#1b1b1b', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
    map.on('click', `${prefix}-points`, (e: any) => { const f = e.features?.[0]; if (f && pick) pick(f.properties.id); });
    map.on('click', `${prefix}-clusters`, (e: any) => { const f = e.features?.[0]; if (!f) return; map.getSource(src).getClusterExpansionZoom(f.properties.cluster_id).then((z: number) => map.easeTo({ center: f.geometry.coordinates, zoom: z })).catch(() => map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 })); });
    for (const l of [`${prefix}-points`, `${prefix}-clusters`]) { map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; }); }
  };
  if (map.isStyleLoaded()) add(); else map.once('load', add);
  map.on('styledata', () => { if (map.isStyleLoaded() && !map.getSource(src)) add(); });
  return {
    set(features: any[], onPick?: (id: string) => void) {
      data = { type: 'FeatureCollection', features };
      if (onPick) pick = onPick;
      map.getSource(src)?.setData(data);
    },
    get layers() { return [`${prefix}-points`, `${prefix}-clusters`]; },
  };
}

// Lines on a map: a quest's route (its colour) and the guide to its start ("Set route": dashed)
export function lineLayers(map: any, prefix = 'lines') {
  const src = `${prefix}-src`;
  let data: any = { type: 'FeatureCollection', features: [] };
  const add = () => {
    if (map.getSource(src)) return;
    map.addSource(src, { type: 'geojson', data });
    const before = map.getLayer(`${prefix.replace(/-lines$/, '')}-points`) ? `${prefix.replace(/-lines$/, '')}-points` : undefined;
    map.addLayer({ id: `${prefix}-route`, type: 'line', source: src, filter: ['==', ['get', 'kind'], 'route'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'colour'], '#e05cff'], 'line-width': ['coalesce', ['get', 'width'], 4], 'line-opacity': 0.85 } }, before);
    map.addLayer({ id: `${prefix}-guide`, type: 'line', source: src, filter: ['==', ['get', 'kind'], 'guide'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'colour'], '#1fb6ff'], 'line-width': ['coalesce', ['get', 'width'], 4], 'line-dasharray': [1.2, 1] } }, before);
  };
  if (map.isStyleLoaded()) add(); else map.once('load', add);
  map.on('styledata', () => { if (map.isStyleLoaded() && !map.getSource(src)) add(); });
  return { set(features: any[]) { data = { type: 'FeatureCollection', features }; map.getSource(src)?.setData(data); } };
}

export async function createWorldMaps({ manifest, base, onTravel }: { manifest: any; base: string; onTravel?: (spot: any) => void }) {
  if (!document.getElementById('worldMapCss')) { const s = document.createElement('style'); s.id = 'worldMapCss'; s.textContent = css; document.head.appendChild(s); }
  const ml = await maplibre(), fileUrl = new URL(manifest.files.map, base).href;
  if (!files.has(fileUrl)) files.set(fileUrl, openPmtiles(httpSource(fileUrl)));
  const pm = await files.get(fileUrl), st = style(`wpm://${encodeURIComponent(fileUrl)}/{z}/{x}/{y}`, pm.header);
  const [lat0, lon0] = [manifest.spawn.lat, manifest.spawn.lon];
  // the minimap: the car in the middle, the way it's going up
  const mini = document.createElement('div');
  mini.id = 'worldMini'; mini.title = 'Map and quick travel (Tab)';
  mini.innerHTML = '<div id="worldMiniCar"></div><div id="worldMiniN">N</div>';
  document.body.appendChild(mini);
  const miniMap = new ml.Map({ container: mini, style: st, center: [lon0, lat0], zoom: 16, interactive: false, attributionControl: false, fadeDuration: 0, pitchWithRotate: false });
  const miniContent = contentLayers(miniMap, { cluster: false, labels: false, prefix: 'mini' });
  const miniLines = lineLayers(miniMap, 'mini-lines');
  let fullLines: any = null, linesNow: any[] = [];
  let fullContent: any = null, contentNow: any[] = [], onPickNow: any = null;
  const north = mini.querySelector('#worldMiniN') as HTMLElement;
  // the full map: north up, the car marked, the test spots to travel to
  const full = document.createElement('div');
  full.id = 'worldFull';
  full.innerHTML = `<div id="worldFullMap"></div><div id="worldFullSide"><h3>${manifest.name}</h3><small>Tab or Esc closes · click a place, or press its number, to go there</small><div id="worldSpots"></div></div>`;
  document.body.appendChild(full);
  let fullMap = null, carMarker = null, last = null, open = false;
  const openers = new Set<(on: boolean) => void>();
  const spots = manifest.spots ?? [];
  const list = full.querySelector('#worldSpots');
  spots.forEach((s, k) => {
    const b = document.createElement('button');
    b.innerHTML = `${k + 1}. ${s.name} <small>${s.kind}</small>`;
    b.onclick = () => { set(false); onTravel?.(s); };
    list.appendChild(b);
  });
  const keys = e => {
    if (!open) return;
    if (e.code === 'Escape') { set(false); e.preventDefault(); return; }
    const k = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (k && spots[+k - 1]) { set(false); onTravel?.(spots[+k - 1]); }
  };
  addEventListener('keydown', keys);
  mini.onclick = () => set(true);
  function set(on) {
    open = on;
    full.style.display = on ? 'block' : 'none';
    for (const fn of openers) fn(on);
    if (on && !fullMap) {
      fullMap = new ml.Map({ container: full.querySelector('#worldFullMap'), style: st, center: last ? [last.lon, last.lat] : [lon0, lat0], zoom: 14, attributionControl: { compact: true, customAttribution: manifest.attribution?.map(a => a.text ?? a.name).join(' · ') } });
      fullMap.on('click', e => { if (e.originalEvent.shiftKey) { set(false); onTravel?.({ name: 'there', lat: e.lngLat.lat, lon: e.lngLat.lng }); } });
      fullContent = contentLayers(fullMap, { prefix: 'full' });
      fullLines = lineLayers(fullMap, 'full-lines'); fullLines.set(linesNow);
      fullContent.set(contentNow, id => { set(false); onPickNow?.(id); });
      const el = document.createElement('div'); el.className = 'worldCarMarker';
      carMarker = new ml.Marker({ element: el, rotationAlignment: 'map' }).setLngLat(last ? [last.lon, last.lat] : [lon0, lat0]).addTo(fullMap);
    }
    if (on && last) { fullMap.resize(); fullMap.jumpTo({ center: [last.lon, last.lat] }); carMarker.setLngLat([last.lon, last.lat]).setRotation(last.bearing); }
  }
  return {
    get open() { return open; },
    // the full map's side panel (play/questFinder.js draws the quest filters and fast travel there), and
    // a callback each time the full map opens or closes
    get side() { return full.querySelector('#worldFullSide') as HTMLElement; },
    onOpen(fn: (on: boolean) => void) { openers.add(fn); return () => openers.delete(fn); },
    close() { set(false); },
    flyTo(lat: number, lon: number) { fullMap?.flyTo({ center: [lon, lat], zoom: 15 }); },
    toggle() { set(!open); return open; },
    show(on) { mini.style.display = on ? '' : 'none'; if (!on) set(false); },
    update(lat, lon, bearing, speed = 0) {
      const zoom = 16.6 - Math.min(1.8, speed / 40);
      if (last && Math.abs(last.lat - lat) < 2e-6 && Math.abs(last.lon - lon) < 2e-6 && Math.abs(last.bearing - bearing) < 1 && Math.abs(last.zoom - zoom) < 0.05) return;
      last = { lat, lon, bearing, zoom };
      miniMap.jumpTo({ center: [lon, lat], bearing, zoom });
      north.style.transform = `translateX(-50%) rotate(${-bearing}deg)`;
      if (open) carMarker?.setLngLat([lon, lat]).setRotation(bearing);
    },
    // world content near the player (GeoJSON point features: id, kind, name, status)
    setContent(features: any[], onPick?: (id: string) => void) {
      contentNow = features; if (onPick) onPickNow = onPick;
      miniContent.set(features);
      fullContent?.set(features, id => { set(false); onPickNow?.(id); });
    },
    // lines on both maps (GeoJSON LineStrings with kind: 'route' | 'guide', and optionally colour and width — the
    // accessibility settings): a quest's route, the way to its start
    setLines(features: any[]) { linesNow = features; miniLines.set(features); fullLines?.set(features); },
    get miniMap() { return miniMap; },
    dispose() { removeEventListener('keydown', keys); miniMap.remove(); fullMap?.remove(); mini.remove(); full.remove(); },
  };
}
