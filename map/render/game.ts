// Map v3 in the game (ported from v2's testtrack/realWorld.js): a test world whose ground streams in from the baked tiles
// (world/streamer.js) instead of coming from a scene file. The car waits, held still, until the ground
// round where it's going to be is in the physics; if loading ever falls behind the car (it shouldn't:
// tiles ahead are loaded first, further ahead the faster it goes), the world pauses with a short
// "Loading area" note rather than letting the car fall through. R puts the car back on the nearest
// named road. The physics' origin follows the car (a whole tile at a time); the effects and the replay
// move with it. A small label says which world this is, which tile the car's in and the elevation data
// there. Where you are: the road, the neighbourhood, the city and a compass under the minimap; the full
// map (Tab, world/worldMap.js) travels to the region's test spots. F3: the performance overlay, against
// data/world/performance.json's targets.
//
//   await prepareTrack(track) (the scene file's `streamed`: the manifest's surfaces, its spawn)
//   await attachRealWorld(w, shared, { RAPIER })  → w.stream
//   realWorldFrame(w, shared, seconds) → { waiting, hold }  (each frame, before the physics)
//   resetToRoad(w), travelTo(w, { lat, lon } | { xz }), toggleWorldMap(w), togglePerf(w)

import { createWorldStream } from './streamer.ts';
import { createWorldMaps } from './maps.ts';

export async function prepareTrack(track) {
  const manifest = await (await fetch(track.mapV3.manifest, { cache: 'no-cache' })).json();
  track.surfaces = manifest.surfaces;
  track.offRoad = 'grass';
  track.name = track.name ?? manifest.name;
  // the physics' origin starts at the spawn's tile (world/streamer.js)
  const T = manifest.grid.tileSize, [sx, sz] = manifest.spawn.xz, ox = Math.floor(sx / T) * T, oz = Math.floor(sz / T) * T;
  track.spawn = { position: [sx - ox, 400, sz - oz], headingDeg: manifest.spawn.bearing != null ? 180 - manifest.spawn.bearing : 0 };
  track._manifest = manifest;
  return track;
}

function el(id, css) {
  let e = document.getElementById(id);
  if (!e) { e = document.createElement('div'); e.id = id; e.style.cssText = css; document.body.appendChild(e); }
  return e;
}

// Hold the car where it is (a kinematic body: the world keeps stepping, so ground arriving shows up to
// its queries) and let it go again as it was going
function hold(w) {
  if (w.held) return;
  const b = w.sim.vehicle.body, l = b.linvel(), a = b.angvel();
  w.held = { linvel: { x: l.x, y: l.y, z: l.z }, angvel: { x: a.x, y: a.y, z: a.z } };
  b.setBodyType(w.RAPIER.RigidBodyType.KinematicPositionBased, true);
}
function release(w, keepMotion = true) {
  if (!w.held) return;
  const b = w.sim.vehicle.body;
  b.setBodyType(w.RAPIER.RigidBodyType.Dynamic, true);
  if (keepMotion) { b.setLinvel(w.held.linvel, true); b.setAngvel(w.held.angvel, true); }
  w.held = null;
}

export async function attachRealWorld(w, shared, { RAPIER }) {
  const stream = await createWorldStream({ manifestUrl: w.track.mapV3.manifest, scene: w.scene, sim: w.sim, RAPIER });
  w.stream = stream;
  w.RAPIER = RAPIER;
  w.spawning = true;
  hold(w);
  w.camera.far = 16000; w.camera.updateProjectionMatrix();
  w.scene.fog.near = 1500; w.scene.fog.far = 13000;
  // every car keeps from tunnelling through anything at speed
  w.sim.vehicle.body.enableCcd(true);
  w.label = el('map3Label', 'position:fixed;left:8px;bottom:6px;z-index:40;font:600 11px/1.4 "JetBrains Mono",monospace;color:#fff;background:rgba(10,14,20,.62);padding:2px 9px;border-radius:9px;pointer-events:none;letter-spacing:.02em;max-width:46vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
  w.whereBox = el('map3Where', 'position:fixed;top:212px;right:12px;width:196px;z-index:21;text-align:center;color:#fff;font:13px/1.35 Barlow,system-ui,sans-serif;text-shadow:0 1px 3px #000c;pointer-events:none');
  w.perfBox = el('map3Perf', 'position:fixed;left:12px;bottom:34px;z-index:42;display:none;color:#fff;background:rgba(10,14,20,.82);border-radius:9px;padding:8px 11px;font:11px/1.5 "JetBrains Mono",monospace;pointer-events:none;min-width:250px');
  w.loading = el('map3Loading', 'position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);z-index:41;font:600 15px/1.5 Barlow,system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.78);padding:10px 18px;border-radius:10px;pointer-events:none;display:none;text-align:center');
  w.attribution = el('map3Attribution', 'position:fixed;right:8px;bottom:4px;z-index:40;font:10px/1.3 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;opacity:.85;max-width:60vw;text-align:right');
  w.attribution.innerHTML = 'Map © <a style="color:inherit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · © <a style="color:inherit" href="https://overturemaps.org" target="_blank" rel="noopener">Overture Maps Foundation</a> · Elevation: ' + stream.manifest.sources.elevation.map(d => d.name).join(', ') + ' · <a style="color:inherit" href="/account/credits.html" target="_blank" rel="noopener">Credits</a>';
  w.attribution.title = stream.manifest.attribution.map(a => `${a.name}: ${a.licence}`).join('\n');
  w.startedAt = performance.now();
  (globalThis as any).__map3 = w;          // (for the browser tests and the console)
  w.perf = { frameMs: 16.7, worstMs: 0, worstAt: 0, targets: null };
  fetch('data/map/performance.json', { cache: 'no-cache' }).then(r => r.json()).then(p => { w.perf.targets = p.targets; }).catch(() => {});
  // the neighbourhoods and the city, for where you are (smallest first)
  w.places = (stream.manifest.cities ?? []).map(p => ({ ...p, kind: p.level === 6 ? 'county' : 'locality' })).map(p => { const r = p.rings[0]; let a = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); x0 = Math.min(x0, r[i][0]); x1 = Math.max(x1, r[i][0]); z0 = Math.min(z0, r[i][1]); z1 = Math.max(z1, r[i][1]); } return { ...p, area: Math.abs(a / 2), box: [x0, z0, x1, z1] }; }).sort((p, q) => p.area - q.area);
  w.placePoints = (stream.manifest.places ?? []).filter(p => p.kind !== 'city' && p.kind !== 'town').map(p => ({ ...p, point: p.xz, kind: p.kind === 'neighbourhood' ? 'neighborhood' : p.kind === 'quarter' ? 'microhood' : p.kind === 'suburb' ? 'macrohood' : p.kind }));
  // the maps (MapLibre from its CDN: without it, no minimap — the world doesn't need it)
  createWorldMaps({ manifest: stream.manifest, base: new URL(w.track.mapV3.manifest, document.baseURI).href, onTravel: spot => travelTo(w, spot) })
    .then(m => { w.maps = m; if (!w.shown) m.show(false); }).catch(e => console.warn(`No world map: ${e.message}`));
  w.shown = true;
  return stream;
}

// where a place is (world frame): its neighbourhood and its city, from the manifest's places
const inRing = (x, z, r) => { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside; return inside; };
function placeOf(w, x, z) {
  let area = null, city = null, best = 1500;
  // the neighbourhood: the nearest one's middle (most are mapped as points), else an area round it
  // (a neighbourhood if one's near; the small ones — often a plaza — only if not)
  for (const kinds of [['neighborhood', 'macrohood', 'borough'], ['microhood']]) {
    for (const p of w.placePoints) { if (!kinds.includes(p.kind)) continue; const d = Math.hypot(p.point[0] - x, p.point[1] - z); if (d < best) { best = d; area = p.name; } }
    if (area) break;
  }
  for (const p of w.places) {
    if (x < p.box[0] || x > p.box[2] || z < p.box[1] || z > p.box[3] || !p.rings.some(r => inRing(x, z, r))) continue;
    if (!area && ['neighborhood', 'macrohood', 'borough'].includes(p.kind)) area = p.name;
    if (!city && ['locality', 'localadmin', 'county'].includes(p.kind)) city = p.name;
  }
  return { area, city: city ?? w.stream.manifest.name };
}

// travel: the car held high over a place (lat/lon or the world frame's xz) until its ground is in, then
// put down on its nearest road, as at the start
// (place.heading given: put down exactly there, facing that way — a start grid's slot — not on the
// nearest road)
export function travelTo(w, place) {
  const S = w.stream, [wx, wz] = place.xz ?? S.projection.toXZ(place.lat, place.lon), [x, z] = S.toSim(wx, wz);
  w.landAt = place.heading != null ? { wx, wz, heading: place.heading } : null;
  hold(w);
  w.held.linvel = { x: 0, y: 0, z: 0 }; w.held.angvel = { x: 0, y: 0, z: 0 };
  w.sim.vehicle.body.setTranslation({ x, y: 600, z }, true);
  w.spawning = true; w.startedAt = performance.now();
  w.recorder.clear();
  w.rig.reset();
}
export function toggleWorldMap(w) { return w.maps?.toggle() ?? false; }
export function togglePerf(w) { w.perfBox.style.display = w.perfBox.style.display === 'none' ? 'block' : 'none'; }

// hide the real world's own overlays (another world)
export function hideRealWorld(w) { for (const id of ['map3Label', 'map3Loading', 'map3Attribution', 'map3Where', 'map3Perf', 'worldMini', 'worldFull']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } if (w) { w.shown = false; w.maps?.show(false); } }
export function showRealWorld(w) { for (const e of [w.label, w.attribution, w.whereBox]) if (e) e.style.display = ''; w.shown = true; w.maps?.show(true); }

// the car onto the nearest named road to a place (sim frame), facing along it
function onRoad(w, x, z) {
  const S = w.stream;
  let best = null;
  for (const e of S.tiles.values()) {
    const L = e.data?.lists.roads?.data;
    if (!L) continue;
    const T = S.manifest.grid.tileSize, [cx, cz] = [(e.i + 0.5) * T - S.origin[0], (e.j + 0.5) * T - S.origin[1]];
    // (the tile's road pieces: [ax, az, bx, bz, name, rank, segment]; a proper road, not an alley)
    for (let k = 0; k < L.length; k += 7) {
      if (L[k + 5] < 3) continue;
      const ax = L[k] + cx, az = L[k + 1] + cz, bx = L[k + 2] + cx, bz = L[k + 3] + cz, dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, x: px, z: pz, heading: Math.atan2(dx, dz) * 180 / Math.PI };
    }
  }
  return best;
}
// lay the car down on the ground at a place (sim frame); false if there's no ground there yet
function land(w, x, z, headingDeg) {
  const y = w.stream.groundBelow(x, z, 900, 1400);
  if (y === null) return false;
  release(w, false);
  w.sim.resetCar({ position: [x, y + (w.sim.vehicle.spec.spawnHeight ?? 0.6), z], headingDeg });
  w.rig.reset();
  return true;
}
// the car held still (a countdown) and let go
// (pinned: held until let go, whatever the streaming would do)
export function holdCar(w) { hold(w); w.held.linvel = { x: 0, y: 0, z: 0 }; w.held.angvel = { x: 0, y: 0, z: 0 }; w.pinned = true; }
export function releaseCar(w) { w.pinned = false; release(w, false); }
export function resetToRoad(w) {
  const p = w.sim.vehicle.body.translation(), r = onRoad(w, p.x, p.z);
  if (r) land(w, r.x, r.z, r.heading);
}

const compass = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

export function realWorldFrame(w, shared, seconds) {
  const S = w.stream, v = w.sim.vehicle, p = v.body.translation(), vel = v.body.linvel();
  const { shifted } = S.update([p.x, p.y, p.z], [vel.x, vel.y, vel.z], seconds);
  if (shifted) {
    // everything kept in the physics' frame moves with it
    w.fx.shift({ x: 0, y: 0, z: 0, w: 1 }, shifted);
    w.recorder.clear();
    w.camera.position.x += shifted[0]; w.camera.position.z += shifted[2];
  }
  const speed = Math.hypot(vel.x, vel.z);
  let waiting = false;
  if (w.spawning) {
    waiting = true;
    // on the nearest road to the spawn, once its ground is in
    if (S.readyAround(p.x, p.z, 60)) {
      const r = w.landAt ? (() => { const [lx, lz] = S.toSim(w.landAt.wx, w.landAt.wz); return { x: lx, z: lz, heading: w.landAt.heading }; })() : onRoad(w, p.x, p.z);
      if (r && land(w, r.x, r.z, r.heading)) { w.spawning = false; w.landAt = null; waiting = false; S.stats.lastDrivable = performance.now() - w.startedAt; S.stats.firstDrivable ??= S.stats.lastDrivable; }
    }
  } else if (!S.readyAround(p.x, p.z, 20 + speed * 0.5)) waiting = true;
  // (held where it is while the world catches up; carrying on as it was once it has)
  if (waiting && !w.spawning) hold(w); else if (!waiting && !w.spawning && !w.pinned) release(w);
  // a short note when the world's waiting
  w.loading.style.display = waiting ? 'block' : 'none';
  if (waiting) { const st = S.status; w.loading.innerHTML = `${w.spawning ? 'Loading the world' : 'Loading area'}…<br><small style="opacity:.7">${st.tiles} tiles · ${st.loading} coming · ${st.building} building</small>`; }
  // the label: which world, which tile, the elevation data there; where you are; the maps
  const where = S.where(p.x, p.z), q = v.body.rotation(), heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180 / Math.PI, bearing = ((180 - heading) % 360 + 360) % 360;
  w.where = where;
  w.maps?.update(where.latLon[0], where.latLon[1], bearing, speed);
  if ((w.labelTimer = (w.labelTimer ?? 0) - seconds) <= 0) {
    w.labelTimer = 0.25;
    const dem = where.dem, [wx, wz] = S.toWorld(p.x, p.z), at = placeOf(w, wx, wz);
    w.label.textContent = `Map v3 | tile ${where.tile[0]}/${where.tile[1]} | DEM: ${dem ? `${dem.name}${dem.resolution ? ` ${dem.resolution} m` : ''}` : '…'}`;
    w.whereBox.innerHTML = `<div style="font-weight:700;font-size:17px">${where.road ?? '&nbsp;'}</div><div>${[at.area, at.city].filter(Boolean).join(' · ')}</div><div style="font:600 12px 'JetBrains Mono',monospace;opacity:.9">${compass(bearing)} ${String(Math.round(bearing)).padStart(3, '0')}°</div>`;
  }
  // the performance overlay (F3): the last frame's draw calls, every pass of it (the effects draw
  // after the scene), counted here and started again
  const info = shared.renderer?.info;
  if (info) { info.autoReset = false; w.perf.calls = info.render.calls; w.perf.triangles = info.render.triangles; info.reset(); }
  const ms = seconds * 1000, now = performance.now();
  w.perf.frameMs += (ms - w.perf.frameMs) * 0.05;
  if (ms > w.perf.worstMs || now - w.perf.worstAt > 2000) { w.perf.worstMs = ms; w.perf.worstAt = now; }
  if (w.perfBox.style.display !== 'none' && (w.perfTimer = (w.perfTimer ?? 0) - seconds) <= 0) {
    w.perfTimer = 0.5;
    const T = w.perf.targets ?? {}, st = S.status, mem = (performance as any).memory?.usedJSHeapSize;
    const row = (name, value, target, unit, fmt = v => v.toFixed(0)) => `<div><span style="color:${value == null || target == null ? '#ccc' : value <= target ? '#7ee08a' : '#ff8a7a'}">●</span> ${name.padEnd(17)} ${value == null ? '—' : fmt(value)}${unit}${target != null ? ` <span style="opacity:.6">/ ${target}${unit}</span>` : ''}</div>`;
    w.perfBox.innerHTML = '<b>World performance</b> <span style="opacity:.6">(F3)</span>'
      + row('time to drivable', S.stats.firstDrivable, T.timeToDrivableMs, ' ms') + (S.stats.lastDrivable !== S.stats.firstDrivable ? row(' after travel', S.stats.lastDrivable, T.timeToDrivableMs, ' ms') : '')
      + row('tile load', st.tileMs, T.tileLoadMs, ' ms') + row('frame', w.perf.frameMs, T.frameMs, ' ms', v => v.toFixed(1)) + row(' worst (2 s)', w.perf.worstMs, null, ' ms', v => v.toFixed(1))
      + row('draw calls', w.perf.calls ?? null, T.drawCalls, '') + row('triangles', w.perf.triangles != null ? w.perf.triangles / 1000 : null, null, 'k')
      + row('JS memory', mem != null ? mem / 1e6 : null, T.memoryMB, ' MB') + row('GPU objects', info ? info.memory.geometries + info.memory.textures : null, null, '')
      + `<div style="opacity:.75">tiles ${st.tiles} in · ${st.loading} coming · ${st.physics} solid · ${st.colliders} colliders<br>${st.fetched} downloaded (${(st.bytes / 1e6).toFixed(1)} MB) · ${st.cached} from the cache${st.errors ? ` · ${st.errors} failed` : ''}</div>`;
  }
  return { hold: !!w.maps?.open, waiting, where };
}
