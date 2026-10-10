// The editor's map view: the whole Earth (MapLibre GL — a globe zoomed out, streets and buildings close
// in, tilted for a 3D look), so content can be placed anywhere. OpenFreeMap's world map when it can be
// reached (as the Phase 0 world's minimap uses), else the baked region's own map (then only that region
// shows). The terrain (open elevation tiles) gives a height anywhere; inside a baked region the editor
// takes heights from its roads instead (editor/roads.js), and the 3D view from the world itself.
//
// Controls: drag to pan, right-drag to turn and tilt, the wheel to zoom; W A S D pan, Q / E turn,
// R / F tilt, Z / X zoom (Shift: faster).
//
//   const V = await createMapView({ container, regionManifest, regionBase, onClick, onPick, onDrag })
//   V.setItems(features)   V.flyTo(lat, lon, zoom)   V.where() → { lat, lon, zoom, km }   V.heightAt(lat, lon)
//   V.frame(dt)   V.show(on)   V.dispose()

import { maplibre, regionStyle, contentLayers } from '../map/build/render/maps.js';

const WORLD_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const TERRAIN = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen / AWS Terrain Tiles' };

async function reachable(url, ms = 4000) {
  try { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); const r = await fetch(url, { signal: c.signal }); clearTimeout(t); return r.ok; } catch { return false; }
}

export async function createMapView({ container, regionManifest = null, regionBase = null, start = null, onClick, onPick, onDrag, onMove }) {
  const ml = await maplibre();
  const world = await reachable(WORLD_STYLE);
  const style = world ? WORLD_STYLE : regionManifest ? await regionStyle(regionManifest, regionBase) : { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfe6ec' } }] };
  const center = start ?? (regionManifest ? { lat: regionManifest.spawn.lat, lon: regionManifest.spawn.lon } : { lat: 20, lon: 0 });
  const map = new ml.Map({ container, style, center: [center.lon, center.lat], zoom: start?.zoom ?? 15, pitch: 45, maxPitch: 80, attributionControl: { compact: true }, fadeDuration: 0, keyboard: false });
  const content = contentLayers(map, { prefix: 'ed' });
  let terrainOn = false;
  // (OpenFreeMap's style names a few icons its sprite hasn't got — a blank one stands in — and its US road shields'
  // filters read a number its tiles leave empty: both only warned in the console, so the shields go and the icons are blank)
  map.on('styleimagemissing', e => { if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }); });
  map.on('style.load', () => { for (const l of map.getStyle()?.layers ?? []) if (/shield/i.test(l.id)) map.removeLayer(l.id); });
  map.on('load', () => {
    try { map.setProjection?.({ type: 'globe' }); } catch { /* an older MapLibre: flat */ }
    if (world) { try { map.addSource('terrain', TERRAIN); } catch { /* none */ } }
    // the baked region, outlined: the 3D view (and the game) is there
    if (regionManifest?.bbox) {
      const [w, s, e, n] = regionManifest.bbox;
      map.addSource('region', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] } } });
      map.addLayer({ id: 'region-edge', type: 'line', source: 'region', paint: { 'line-color': '#ff7a1a', 'line-width': 2, 'line-dasharray': [3, 2] } });
    }
  });

  // clicks: on a marker, pick it (and drag it if it's the one selected); elsewhere, the place
  let dragging = null, selected = null;
  const pointAt = e => map.queryRenderedFeatures(e.point, { layers: content.layers.filter(l => map.getLayer(l)) })[0] ?? null;
  map.on('mousedown', e => {
    const f = pointAt(e);
    if (f && !f.properties.cluster && f.properties.id === selected && e.originalEvent.button === 0) { dragging = { id: selected, moved: false }; map.dragPan.disable(); e.preventDefault(); }
  });
  map.on('mousemove', e => { if (dragging) { dragging.moved = true; onDrag?.(dragging.id, { lat: e.lngLat.lat, lon: e.lngLat.lng }, false); } });
  map.on('mouseup', e => { if (dragging) { const d = dragging; dragging = null; map.dragPan.enable(); if (d.moved) onDrag?.(d.id, { lat: e.lngLat.lat, lon: e.lngLat.lng }, true); } });
  map.on('click', e => {
    const f = pointAt(e);
    if (f?.properties.cluster) return;                 // (contentLayers zooms in)
    if (f) onPick?.(f.properties.id); else onClick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }, e.originalEvent);
  });
  map.on('moveend', () => onMove?.());

  // the keyboard flies the map
  const keys = new Set();
  const onKey = e => {
    if (container.style.display === 'none' || e.target?.closest?.('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.type === 'keydown') keys.add(e.code); else keys.delete(e.code);
  };
  addEventListener('keydown', onKey); addEventListener('keyup', onKey);
  const onBlur = () => keys.clear(); addEventListener('blur', onBlur);

  return {
    map, world,
    frame(dt) {
      if (!keys.size) return;
      const f = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1, px = 600 * dt * f;
      let dx = 0, dy = 0;
      if (keys.has('KeyW')) dy -= px; if (keys.has('KeyS')) dy += px; if (keys.has('KeyA')) dx -= px; if (keys.has('KeyD')) dx += px;
      if (dx || dy) map.panBy([dx, dy], { duration: 0 });
      if (keys.has('KeyQ')) map.setBearing(map.getBearing() - 60 * dt * f); if (keys.has('KeyE')) map.setBearing(map.getBearing() + 60 * dt * f);
      if (keys.has('KeyR')) map.setPitch(Math.min(80, map.getPitch() + 40 * dt)); if (keys.has('KeyF')) map.setPitch(Math.max(0, map.getPitch() - 40 * dt));
      if (keys.has('KeyZ')) map.setZoom(map.getZoom() + 1.5 * dt * f); if (keys.has('KeyX')) map.setZoom(map.getZoom() - 1.5 * dt * f);
    },
    setItems(features, sel) { selected = sel; content.set(features); },
    flyTo(lat, lon, zoom = null) { map.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(map.getZoom(), 15), essential: true, duration: 1600 }); },
    jumpTo(lat, lon, zoom = null) { map.jumpTo({ center: [lon, lat], zoom: zoom ?? map.getZoom() }); },
    where() {
      const c = map.getCenter(), b = map.getBounds(), ne = b.getNorthEast(), cKm = Math.hypot((ne.lat - c.lat) * 111, (ne.lng - c.lng) * 111 * Math.cos(c.lat * Math.PI / 180));
      return { lat: c.lat, lon: c.lng, zoom: map.getZoom(), km: Math.min(20000, cKm), bearing: map.getBearing() };
    },
    // the terrain (on for a moment if it's off) under a place: metres above sea level, or null
    async heightAt(lat, lon) {
      if (!world || !map.getSource('terrain')) return null;
      if (!terrainOn) { map.setTerrain({ source: 'terrain', exaggeration: 1 }); terrainOn = true; await new Promise(r => map.once('idle', r)); }
      const h = map.queryTerrainElevation?.([lon, lat]);
      return Number.isFinite(h) ? Math.round(h * 100) / 100 : null;
    },
    setTerrain(on) { if (!world || !map.getSource('terrain')) return false; map.setTerrain(on ? { source: 'terrain', exaggeration: 1 } : null); terrainOn = on; return true; },
    show(on) { container.style.display = on ? 'block' : 'none'; if (on) map.resize(); },
    dispose() { removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('blur', onBlur); map.remove(); },
  };
}
