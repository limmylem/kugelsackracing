// The real world in the game (low-poly v2): a test world whose ground streams in from the baked tiles
// (world/streamer.js) instead of coming from a scene file. The car waits, held still, until the ground
// round where it's going to be is in the physics; if loading ever falls behind the car (it shouldn't:
// tiles ahead are loaded first, further ahead the faster it goes), the world pauses with a short
// "Loading area" note rather than letting the car fall through. R puts the car back on the nearest
// named road. The physics' origin follows the car (a whole tile at a time); the effects and the replay
// move with it. A small label says which world this is and which tile the car's in.
//
//   await prepareTrack(track) (the scene file's `streamed`: the manifest's surfaces, its spawn)
//   await attachRealWorld(w, shared, { RAPIER })  → w.stream
//   realWorldFrame(w, shared, seconds) → { waiting }  (each frame, before the physics)
//   resetToRoad(w)

import { createWorldStream } from '../world/streamer.js';

export async function prepareTrack(track) {
  const manifest = await (await fetch(track.streamed.manifest, { cache: 'no-cache' })).json();
  track.surfaces = manifest.surfaces;
  track.offRoad = 'grass';
  track.name = track.name ?? manifest.name;
  // the physics' origin starts at the spawn's tile (world/streamer.js)
  const T = manifest.tileSize, [sx, sz] = manifest.spawn.xz, ox = Math.floor(sx / T) * T, oz = Math.floor(sz / T) * T;
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
  const stream = await createWorldStream({ manifestUrl: w.track.streamed.manifest, scene: w.scene, sim: w.sim, RAPIER });
  w.stream = stream;
  w.RAPIER = RAPIER;
  w.spawning = true;
  hold(w);
  w.camera.far = 9000; w.camera.updateProjectionMatrix();
  w.scene.fog.near = 900; w.scene.fog.far = 5200;
  // every car keeps from tunnelling through anything at speed
  w.sim.vehicle.body.enableCcd(true);
  w.label = el('worldLabel', 'position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:40;font:600 11px/1.4 "JetBrains Mono",monospace;color:#fff;background:rgba(10,14,20,.62);padding:2px 9px;border-radius:9px;pointer-events:none;letter-spacing:.02em');
  w.loading = el('worldLoading', 'position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);z-index:41;font:600 15px/1.5 Barlow,system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.78);padding:10px 18px;border-radius:10px;pointer-events:none;display:none;text-align:center');
  w.attribution = el('worldAttribution', 'position:fixed;right:8px;bottom:4px;z-index:40;font:10px/1.3 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;opacity:.85;max-width:60vw;text-align:right');
  w.attribution.innerHTML = 'Map © <a style="color:inherit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · © <a style="color:inherit" href="https://overturemaps.org" target="_blank" rel="noopener">Overture Maps Foundation</a> · Elevation: ' + stream.manifest.dem.map(d => d.name).join(', ');
  w.attribution.title = stream.manifest.attribution.map(a => `${a.name}: ${a.licence}`).join('\n');
  w.startedAt = performance.now();
  return stream;
}

// hide the real world's own overlays (another world)
export function hideRealWorld() { for (const id of ['worldLabel', 'worldLoading', 'worldAttribution']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } }
export function showRealWorld(w) { for (const e of [w.label, w.attribution]) if (e) e.style.display = ''; }

// the car onto the nearest named road to a place (sim frame), facing along it
function onRoad(w, x, z) {
  const S = w.stream;
  let best = null;
  for (const e of S.tiles.values()) {
    const L = e.data?.lists.streets?.data;
    if (!L) continue;
    const [cx, cz] = [(e.i + 0.5) * S.manifest.tileSize - S.origin[0], (e.j + 0.5) * S.manifest.tileSize - S.origin[1]];
    for (let k = 0; k < L.length; k += 6) {
      if (L[k + 5] < 3) continue;          // (a proper road: not an alley)
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
      const r = onRoad(w, p.x, p.z);
      if (r && land(w, r.x, r.z, r.heading)) { w.spawning = false; waiting = false; S.stats.firstDrivable = performance.now() - w.startedAt; }
    }
  } else if (!S.readyAround(p.x, p.z, 20 + speed * 0.5)) waiting = true;
  // (held where it is while the world catches up; carrying on as it was once it has)
  if (waiting && !w.spawning) hold(w); else if (!waiting && !w.spawning) release(w);
  // a short note when the world's waiting
  w.loading.style.display = waiting ? 'block' : 'none';
  if (waiting) { const st = S.status; w.loading.innerHTML = `${w.spawning ? 'Loading the world' : 'Loading area'}…<br><small style="opacity:.7">${st.tiles} tiles · ${st.loading} coming · ${st.building} building</small>`; }
  // the label: which world, which tile
  const where = S.where(p.x, p.z);
  w.where = where;
  if ((w.labelTimer = (w.labelTimer ?? 0) - seconds) <= 0) {
    w.labelTimer = 0.25;
    const q = v.body.rotation(), heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180 / Math.PI, bearing = ((180 - heading) % 360 + 360) % 360;
    w.label.textContent = `World: low-poly v2 (tile ${where.tile[0]}/${where.tile[1]})${where.road ? ` · ${where.road}` : ''} · ${compass(bearing)} ${Math.round(bearing)}°`;
  }
  return { hold: false, waiting, where };
}
