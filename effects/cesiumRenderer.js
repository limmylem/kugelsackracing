// Draws the effects (effects/director.js) in the real world, with CesiumJS (index.html).
//
//  - Particles: billboards sized in metres, a pool for each style (smoke and dust a soft puff, sparks a
//    streak turned along their motion, flames, glittering glass, chips), only the live ones shown.
//  - Lit like the test worlds (lighting.js lightFromSun) from Cesium's sun at the scene's time: each
//    particle's colour is shaded on the CPU (smoke darker at night, sparks and flames brighter), and puffs
//    fade out where they meet the ground (the height of the ground under where each was made) — so they
//    don't end in a hard line on the road.
//  - Marks (skid marks, drips): one primitive of coloured quads, rebuilt when marks change (at most every
//    `rebuild` seconds) and now and then as they fade.
//  - No spark lights here (Cesium has no cheap point lights).
//
// The effects work in the physics' local frame (realworld/physicsCar.js: x east, y up, z south, its origin
// following the car); frame() gives that frame (physics/geo.js LocalFrame) to place them on the globe.

import { STYLES } from './particles.js';
import { lightFromSun } from './lighting.js';

const SPARK = STYLES.indexOf('spark'), FLAME = STYLES.indexOf('flame'), PUFF = STYLES.indexOf('puff');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// (a small image for each style, white: tinted by each particle's colour)
function styleImage(style) {
  const size = 64, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), m = size / 2;
  if (style === 'puff' || style === 'flame') {
    const grad = g.createRadialGradient(m, m, 0, m, m, m);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(style === 'puff' ? 0.45 : 0.25, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
  } else if (style === 'spark') {
    const grad = g.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.35, 'rgba(255,255,255,1)'); grad.addColorStop(0.65, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
  } else if (style === 'shard') {
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(m, 4); g.lineTo(size - 4, m); g.lineTo(m, size - 4); g.lineTo(4, m); g.closePath(); g.fill();
  } else { g.fillStyle = '#fff'; g.fillRect(8, 14, size - 16, size - 28); }
  return c.toDataURL();
}

// time(): the scene's time (a JulianDate: the viewer's clock), for where the sun is
export function createCesiumEffects(C, director, { scene, frame, time = () => C.JulianDate.now(), rebuild = 0.4 }) {
  const P = director.particles;
  const pools = STYLES.map(style => ({ style, image: styleImage(style), list: [], shown: 0, collection: scene.primitives.add(new C.BillboardCollection({ scene, blendOption: C.BlendOption.TRANSLUCENT })) }));
  const pos = new C.Cartesian3(), axis = new C.Cartesian3(), colour = new C.Color(), stats = { drawn: 0, marks: 0, uploadMs: 0, rebuilds: 0 };
  let light = lightFromSun([0.4, 0.8, 0.3]), lightTimer = 0;

  // the sun where the car is, now (Cesium's clock): toward it in the local frame
  function sunLight(F) {
    const t = time();
    const icrf = C.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(t, new C.Cartesian3());
    const m = C.Transforms.computeIcrfToFixedMatrix(t) ?? C.Transforms.computeTemeToPseudoFixedMatrix(t);
    const sun = C.Matrix3.multiplyByVector(m, icrf, new C.Cartesian3()), toSun = C.Cartesian3.normalize(C.Cartesian3.subtract(sun, new C.Cartesian3(...F.origin), new C.Cartesian3()), new C.Cartesian3());
    const d = F.vectorToLocal([toSun.x, toSun.y, toSun.z]);
    return lightFromSun(d);
  }

  // marks: one primitive, rebuilt when they've changed
  let marks = null, since = 0, faded = 0, version = -1;
  function buildMarks(F) {
    const M = director.marks, instances = [];
    for (let i = 0; i < M.count; i++) {
      const s = M.strength(i), a = Math.max(M.alpha[i * 2], M.alpha[i * 2 + 1]) * s;
      if (a < 0.01) continue;
      const corners = [0, 1, 2, 3].map(c => F.fromLocal([M.pos[i * 12 + c * 3], M.pos[i * 12 + c * 3 + 1], M.pos[i * 12 + c * 3 + 2]]));
      const positions = new Float64Array([...corners[0], ...corners[1], ...corners[2], ...corners[0], ...corners[2], ...corners[3]]);
      const geometry = new C.Geometry({ attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }) }, primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromVertices(positions) });
      const shade = Math.min(1, light.key.intensity * 0.45 + light.ambient.intensity * 0.6);
      instances.push(new C.GeometryInstance({ geometry, attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(new C.Color(M.colour[i * 3] * shade, M.colour[i * 3 + 1] * shade, M.colour[i * 3 + 2] * shade, a)) } }));
    }
    if (marks) scene.primitives.remove(marks);
    marks = instances.length ? scene.primitives.add(new C.Primitive({ geometryInstances: instances, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: false, allowPicking: false })) : null;
    stats.marks = instances.length; stats.rebuilds++;
  }

  function update(dt) {
    const t0 = performance.now(), F = frame();
    if (!F) return;
    if ((lightTimer -= dt) <= 0) { lightTimer = 1; try { light = sunLight(F); } catch { /* the sun's data not there yet: keep the last */ } }
    const night = light.night, key = light.key, amb = light.ambient;
    const glowK = 1 + night * director.cfg.night.glow;
    for (const pool of pools) pool.n = 0;
    for (let k = 0; k < P.count; k++) {
      const i = P.list[k], st = P.style[i], pool = pools[st];
      let b = pool.list[pool.n];
      if (!b) { b = pool.collection.add({ image: pool.image, sizeInMeters: true, show: false }); pool.list.push(b); }
      pool.n++;
      const p = F.fromLocal([P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]]);
      pos.x = p[0]; pos.y = p[1]; pos.z = p[2];
      b.position = pos;
      let r = P.colour[i * 3], g = P.colour[i * 3 + 1], bl = P.colour[i * 3 + 2], a = P.alpha[i];
      const size = P.size[i];
      if (st === SPARK || st === FLAME) {
        const k2 = director.particles.effects[P.effect[i]].glow * glowK;
        r = Math.min(1, r * k2); g = Math.min(1, g * k2); bl = Math.min(1, bl * k2);
      } else {
        const lit = amb.intensity * 0.6 + key.intensity * 0.45;
        r *= amb.sky[0] * 0.6 + key.colour[0] * lit; g *= amb.sky[1] * 0.6 + key.colour[1] * lit; bl *= amb.sky[2] * 0.6 + key.colour[2] * lit;
      }
      if (st === PUFF) a *= clamp((P.pos[i * 3 + 1] - P.floor[i]) / Math.max(0.05, size * 0.6), 0, 1);     // (fading where it meets the ground)
      colour.red = clamp(r, 0, 1); colour.green = clamp(g, 0, 1); colour.blue = clamp(bl, 0, 1); colour.alpha = clamp(a, 0, 1);
      b.color = colour;
      if (st === SPARK) {
        const v = F.vectorFromLocal([P.vel[i * 3], P.vel[i * 3 + 1], P.vel[i * 3 + 2]]), sp = Math.hypot(...v) || 1;
        axis.x = v[0] / sp; axis.y = v[1] / sp; axis.z = v[2] / sp;
        b.alignedAxis = axis;
        b.width = size * 2; b.height = size * 2 + sp * 0.09;
      } else { b.width = b.height = size * 2; b.rotation = P.seed[i] * 6.2832; }
      if (!b.show) b.show = true;
    }
    for (const pool of pools) { for (let k = pool.n; k < pool.shown; k++) pool.list[k].show = false; pool.shown = pool.n; }
    stats.drawn = P.count;
    // marks: new ones (or a shift of the frame) soon, the fading now and then
    since += dt; faded += dt;
    const M = director.marks, changed = M.changed.size > 0 || M.version !== version;
    if ((changed && since >= rebuild) || faded > 5) { M.takeChanges(); version = M.version; since = 0; faded = 0; buildMarks(F); }
    stats.uploadMs += ((performance.now() - t0) - stats.uploadMs) * 0.1;
  }

  function dispose() {
    for (const pool of pools) scene.primitives.remove(pool.collection);
    if (marks) scene.primitives.remove(marks);
  }
  return { update, dispose, stats, get light() { return light; } };
}
