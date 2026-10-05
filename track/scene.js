// The Track scene in the game (Phase 5 Step 1): a generated track (track/build.js) as a world of its own —
// not part of the real world's streaming, no tiles loaded, the same car, physics, damage and HUD. It
// answers what the game asks of the real world (map/render/game.ts) — travelTo, holdCar, releaseCar,
// resetToRoad, the frame hook — so the Phase 4 route test drive, quests and NPC races run on it
// unchanged; w.stream is the small part of the real world's stream they use (its projection, its frame,
// where its world group is). Its whole ground is there from the start: nothing waits to load. The
// track is a few km across, centred on the origin, so the physics' frame never needs to move.
//
//   attachTrackWorld(w, data) → w.stream          trackFrame(w, shared, seconds) → { waiting: false }
//   travelTo(w, { xz, heading } | { s })  holdCar(w)  releaseCar(w)  resetToRoad(w)
//   showRealWorld(w) / hideRealWorld(w)  (its label)   toggleWorldMap / togglePerf (nothing yet)

import { trackProjection } from './build.js';

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

// the nearest centreline point to (x, z): its index, distance, and the way along there (h: the height
// it's at, if known — where a crossover's bridge passes over the road below, which pass it's on)
export function nearestOnTrack(data, x, z, h = null) {
  const C = data.centre, n = C.x.length;
  let best = 0, bd = Infinity;
  for (let i = 0; i < n; i++) { const d = (C.x[i] - x) ** 2 + (C.z[i] - z) ** 2 + (h != null && data.crossing ? 9 * (C.h[i] - h) ** 2 : 0); if (d < bd) { bd = d; best = i; } }
  if (h != null && data.crossing) bd = (C.x[best] - x) ** 2 + (C.z[best] - z) ** 2;
  const a = data.closed ? (best - 1 + n) % n : Math.max(0, best - 1), b = data.closed ? (best + 1) % n : Math.min(n - 1, best + 1);
  const dx = C.x[b] - C.x[a], dz = C.z[b] - C.z[a];
  return { i: best, d: Math.sqrt(bd), x: C.x[best], z: C.z[best], h: C.h[best], heading: Math.atan2(dx, dz) * 180 / Math.PI };
}

export function attachTrackWorld(w, data, { THREE, RAPIER }) {
  w.RAPIER = RAPIER;
  w.trackData = data;
  const group = new THREE.Group(); group.name = 'track-world';
  w.scene.add(group);
  w.stream = {
    projection: trackProjection, world: group, origin: [0, 0],
    toWorld: (x, z) => [x, z], toSim: (x, z) => [x, z], probeAbove: data.crossing ? 4 : null,
    surfaceAt: w.sim.vehicle.surfaceAt,
    // (the ground: the road's surface or the land's, whichever's under a point — out to a dressed track's barriers)
    groundBelow: (x, z, h = null) => { const t = nearestOnTrack(data, x, z, h), reach = data.dress ? Math.max(data.dress.runoff.L[t.i], data.dress.runoff.R[t.i]) : data.width / 2 + data.verge; return t.d < reach ? t.h : null; },
  };
  w.spawning = false;
  w.sim.vehicle.body.enableCcd(true);
  w.label = document.getElementById('trackLabel') ?? Object.assign(document.body.appendChild(document.createElement('div')), { id: 'trackLabel' });
  w.label.style.cssText = 'position:fixed;left:8px;bottom:6px;z-index:40;font:600 11px/1.4 "JetBrains Mono",monospace;color:#fff;background:rgba(10,14,20,.62);padding:2px 9px;border-radius:9px;pointer-events:none';
  w.label.textContent = `${data.names?.track ? `${data.names.track} · ` : ""}Track ${data.code} · ${(data.length / 1000).toFixed(2)} km · ${data.closed ? "circuit" : "point to point"}${data.theme ? ` · ${data.theme}` : ""} · generator v${data.version}`;
  return w.stream;
}

// the car put down at a place on the track (a grid slot, a checkpoint, the nearest road), facing the way given
export function travelTo(w, place) {
  const D = w.trackData;
  let x, z, heading;
  if (place.xz) [x, z] = place.xz; else { const i = Math.max(0, Math.min(D.centre.x.length - 1, Math.round((place.s ?? 0) / (D.length / D.centre.x.length)))); x = D.centre.x[i]; z = D.centre.z[i]; }
  const t = nearestOnTrack(D, x, z, place.h ?? null);
  heading = place.heading ?? t.heading;
  release(w, false);
  w.sim.resetCar({ position: [x, t.h + (w.sim.vehicle.spec.spawnHeight ?? 0.6), z], headingDeg: heading });
  w.spawning = false;
  w.recorder?.clear();
  w.rig?.reset();
}
export function holdCar(w) { hold(w); w.held.linvel = { x: 0, y: 0, z: 0 }; w.held.angvel = { x: 0, y: 0, z: 0 }; w.pinned = true; }
export function releaseCar(w) { w.pinned = false; release(w, false); }
export function resetToRoad(w) {
  const p = w.sim.vehicle.body.translation(), t = nearestOnTrack(w.trackData, p.x, p.z, p.y);
  travelTo(w, { xz: [t.x, t.z], heading: t.heading, h: t.h });
}
// each frame, before the physics: nothing to load — the track's all there; a dressed track's levels of
// detail and its start lights (w.lightsNow: what the countdown says they show)
export function realWorldFrame(w) {
  if (w?.trackDress) { w.trackDress.update(w.camera); if (w.lightsNow) w.trackDress.setLights(w.lightsNow()); }
  return { waiting: false, hold: false };
}
export const trackFrame = realWorldFrame;
export function hideRealWorld(w) { const e = document.getElementById('trackLabel'); if (e) e.style.display = 'none'; if (w) w.shown = false; }
export function showRealWorld(w) { if (w.label) w.label.style.display = ''; w.shown = true; }
export function toggleWorldMap() { return false; }
export function togglePerf() {}
