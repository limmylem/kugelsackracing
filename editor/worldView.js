// The editor's 3D view: a free-flying camera over the baked world (Map v3) the game drives in, the world
// streamed round the camera as it flies, world content drawn as the game draws it (editor/markers3d.js),
// and clicks turned into places: the road surface first (a road under the click within a metre of the
// nearest thing hit wins), then the ground, buildings and the rest — the exact latitude, longitude and
// height (the world's heights: metres above sea level, EGM2008).
//
// Controls: W A S D fly, Q / E down / up, right mouse drag (or the arrow keys) to look round, the wheel
// for speed, Shift to go faster.
//
//   const V = createWorldView({ THREE, world, canvas })   world: the game's Map v3 world (w.stream, w.scene)
//   V.frame(dt)   V.ray(clientX, clientY) → { lat, lon, alt, altFrom, normal } | null   V.pick(clientX, clientY) → id
//   V.lookAt(lat, lon, alt)   V.where() → { lat, lon, alt, heading }   V.covers(lat, lon)   V.setItems(items)   V.dispose()

import { createMarkers3d } from './markers3d.js';

const ROAD_MESHES = new Set(['roads', 'paved', 'markings']), GROUND_MESHES = /^terrain/;

export function createWorldView({ THREE, world: w, canvas }) {
  const S = w.stream, P = S.projection;
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 30000);
  // start where the game's camera was, a little higher
  camera.position.copy(w.camera.position).add(new THREE.Vector3(0, 25, 0));
  let yaw = Math.atan2(-(w.camera.getWorldDirection(new THREE.Vector3()).x), -(w.camera.getWorldDirection(new THREE.Vector3()).z)), pitch = -0.35, speed = 40;
  const keys = new Set(), raycaster = new THREE.Raycaster();
  const markers = createMarkers3d({ THREE, parent: S.world, place: it => { const [x, z] = P.toXZ(it.location.lat, it.location.lon); return [x, it.location.alt ?? 0, z]; } });

  const onKey = e => {
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.type === 'keydown') keys.add(e.code); else keys.delete(e.code);
  };
  let looking = null;
  const onDown = e => { if (e.button === 2) { looking = { x: e.clientX, y: e.clientY, yaw, pitch }; e.preventDefault(); } };
  const onMove = e => { if (!looking) return; yaw = looking.yaw - (e.clientX - looking.x) * 0.004; pitch = Math.max(-1.5, Math.min(1.2, looking.pitch - (e.clientY - looking.y) * 0.004)); };
  const onUp = e => { if (e.button === 2) looking = null; };
  const onWheel = e => { speed = Math.max(4, Math.min(1500, speed * (e.deltaY > 0 ? 0.85 : 1.18))); };
  const noMenu = e => e.preventDefault();
  addEventListener('keydown', onKey); addEventListener('keyup', onKey);
  canvas.addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove); addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: true }); canvas.addEventListener('contextmenu', noMenu);
  const onBlur = () => keys.clear();
  addEventListener('blur', onBlur);

  const toWorld = (x, z) => S.toWorld(x, z);
  const hitsUnder = (origin, dir, far = 20000) => {
    raycaster.set(origin, dir); raycaster.far = far; raycaster.camera = camera;      // (sprites — the labels — need it)
    const all = raycaster.intersectObject(S.world, true);
    return all.filter(h => { if (h.object.parent?.name === 'world-content' || h.object.isSprite) return false; for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; });
  };
  // a hit → a place: the road's surface if one's right there, else what was hit first
  function placeOf(hits) {
    if (!hits.length) return null;
    const first = hits[0], road = hits.find(h => ROAD_MESHES.has(h.object.name) && h.distance - first.distance < 1);
    const h = road ?? first, [wx, wz] = toWorld(h.point.x, h.point.z), [lat, lon] = P.toLatLon(wx, wz);
    const altFrom = road ? 'road' : GROUND_MESHES.test(h.object.name) ? 'ground' : 'ground';
    return { lat, lon, alt: Math.round(h.point.y * 100) / 100, altFrom, onRoad: !!road, what: h.object.name };
  }
  const ndc = (x, y) => new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);

  return {
    camera, markers,
    get speed() { return speed; },
    frame(dt) {
      // fly: along the view (level), sideways, up and down; faster the higher it is
      const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1, step = speed * fast * dt;
      if (keys.has('ArrowLeft')) yaw += 1.6 * dt; if (keys.has('ArrowRight')) yaw -= 1.6 * dt;
      if (keys.has('ArrowUp')) pitch = Math.min(1.2, pitch + 1.2 * dt); if (keys.has('ArrowDown')) pitch = Math.max(-1.5, pitch - 1.2 * dt);
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      let mx = 0, mz = 0, my = 0;
      if (keys.has('KeyW')) { mx += fx; mz += fz; } if (keys.has('KeyS')) { mx -= fx; mz -= fz; }
      if (keys.has('KeyD')) { mx += rx; mz += rz; } if (keys.has('KeyA')) { mx -= rx; mz -= rz; }
      if (keys.has('KeyE')) my += 1; if (keys.has('KeyQ')) my -= 1;
      camera.position.x += mx * step; camera.position.z += mz * step; camera.position.y += my * step;
      // (never below the ground: the tile's heightfield, no ray needed)
      const groundY = S.heightAt?.(camera.position.x, camera.position.z) ?? -Infinity;
      if (camera.position.y < groundY + 1.5) camera.position.y = groundY + 1.5;
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      // the world streamed round the camera (its origin may move: the camera moves with it)
      const vel = [mx * speed * fast, 0, mz * speed * fast];
      const { shifted } = S.update([camera.position.x, camera.position.y, camera.position.z], vel, dt);
      if (shifted) { camera.position.x += shifted[0]; camera.position.z += shifted[2]; }
      const [wx, wz] = toWorld(camera.position.x, camera.position.z);
      markers.update({ x: wx, y: camera.position.y, z: wz });
    },
    // what's under a point on the screen
    ray(clientX, clientY) {
      raycaster.setFromCamera(ndc(clientX, clientY), camera);
      return placeOf(hitsUnder(raycaster.ray.origin.clone(), raycaster.ray.direction.clone()));
    },
    pick(clientX, clientY) { raycaster.setFromCamera(ndc(clientX, clientY), camera); return markers.pick(raycaster); },
    // the ground (road first) straight under a place: its height
    groundAt(lat, lon) {
      const [wx, wz] = P.toXZ(lat, lon), [x, z] = S.toSim(wx, wz);
      return placeOf(hitsUnder(new THREE.Vector3(x, 3000, z), new THREE.Vector3(0, -1, 0), 6000));
    },
    // fly to look at a place (from 120 m back, 60 m up)
    lookAt(lat, lon, alt = null) {
      const [wx, wz] = P.toXZ(lat, lon), [x, z] = S.toSim(wx, wz), y = alt ?? camera.position.y;
      camera.position.set(x + Math.sin(yaw) * 120, y + 60, z + Math.cos(yaw) * 120);
      pitch = -0.45;
    },
    where() {
      const [wx, wz] = toWorld(camera.position.x, camera.position.z), [lat, lon] = P.toLatLon(wx, wz);
      return { lat, lon, alt: camera.position.y, heading: ((-yaw * 180 / Math.PI) % 360 + 360) % 360 };
    },
    covers(lat, lon) {
      const [x, z] = P.toXZ(lat, lon), T = S.manifest.grid.tileSize, i = Math.floor(x / T), j = Math.floor(z / T);
      return S.manifest.tiles.some(t => t.i === i && t.j === j);
    },
    setItems(items) { markers.setItems(items); },
    select(id) { markers.select(id); },
    dispose() {
      removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('contextmenu', noMenu);
      markers.dispose();
    },
  };
}
