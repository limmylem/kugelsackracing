// The weather on a generated track, drawn (Phase 5 Step 4): rain falling round the camera (streaks, as
// many a second as the conditions say: data/tracks.json conditions.weather), and a wet road — darker, with a
// sheen. Visual only: the grip is the physics' (applied only when conditions.applyGrip says so, by the game:
// testtrack/test-scene.js).
//
//   const R = createRain(THREE, scene, { rate })   R.update(camera, dt)   R.dispose()
//   wetRoad(material, wet)   the road's material darker and shinier (or as it was)

export function createRain(THREE, scene, { rate = 2400, box = 60, height = 30, speed = 22 } = {}) {
  const n = Math.max(200, Math.min(12000, Math.round(rate * height / speed))), pos = new Float32Array(n * 6), drift = new Float32Array(n);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < n; k++) { const x = (rnd() - 0.5) * box * 2, y = rnd() * height, z = (rnd() - 0.5) * box * 2; pos.set([x, y, z, x, y - 0.9, z], k * 6); drift[k] = 0.85 + rnd() * 0.3; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xbfd3e6, transparent: true, opacity: 0.45, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false; lines.name = 'rain';
  scene.add(lines);
  return {
    object: lines,
    // the drops falling, the box of them kept round the camera
    update(camera, dt) {
      const c = camera.position, P = geo.attributes.position.array;
      for (let k = 0; k < n; k++) {
        const o = k * 6;
        let y = P[o + 1] - speed * drift[k] * dt;
        let x = P[o], z = P[o + 2];
        if (y < c.y - height / 2) y += height;
        if (x - c.x > box) x -= 2 * box; else if (c.x - x > box) x += 2 * box;
        if (z - c.z > box) z -= 2 * box; else if (c.z - z > box) z += 2 * box;
        if (y > c.y + height / 2) y -= height;
        P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = x; P[o + 4] = y - 0.9; P[o + 5] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() { lines.removeFromParent(); geo.dispose(); mat.dispose(); },
  };
}

// a wet road: darker (the vertex colours scaled), its own sheen (an emissive cool tint) — or back
export function wetRoad(material, wet) {
  if (!material) return;
  material.userData.dry ??= { colour: material.color.getHex(), emissive: material.emissive?.getHex?.() ?? 0 };
  const D = material.userData.dry;
  if (wet) { material.color.setHex(D.colour).multiplyScalar(0.62); material.emissive?.setHex?.(0x0c1118); }
  else { material.color.setHex(D.colour); material.emissive?.setHex?.(D.emissive); }
  material.needsUpdate = true;
}
