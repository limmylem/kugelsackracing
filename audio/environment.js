// Where you're listening (Phase 8 Step 1; docs/AUDIO.md): the echo of what's round you and the sounds of the area.
//
//   the echo — rays cast from the listener through the physics' world (every world: Map v3's buildings, tunnel roofs
//     and bridge decks, a generated track's walls, the test worlds'): up to a roof, and level all round to the walls.
//     audio/mix.js surroundings() says what that is — a tunnel (a roof, walls close both sides: the long echo), under
//     a bridge (a roof, open sides: a short one and a slap), a street of buildings (walls both sides, open above:
//     reflections, the slap's delay from how far apart they are) or open country (almost none) — and audio/system.js's
//     reverbs follow it, gliding.
//   the area — Map v3's tiles round you (mapArea): how built up (its buildings), how wooded (its trees), how near the
//     water (its water) → the ambience (testtrack/trackAudio.js: birds, wind, the sea, a city's traffic), quieter the
//     faster you go and in the car. A generated track's own theme and its grandstands' crowd, as before.
//   another car behind a building or a hill: occluded(…) (one ray from the listener to it).
//
//   probe(world, RAPIER, pos, cfg) → { up, sides, hits }       (the rays; audio/mix.js surroundings reads it)
//   mapArea(stream, pos) → { city, forest, coast }              (0..1 each)
//   occluded(world, RAPIER, from, to) → bool
//   const E = createEnvironment(A, { ambientCfg })              E.update({ world, RAPIER, pos, listener, speed, inside, stream, theme, stands }, dt)
//   E.cheer(kind, strength) · E.surroundings · E.area · E.dispose()

import { surroundings } from './mix.js';
import { createTrackAmbience } from '../testtrack/trackAudio.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// (only what doesn't move: the world, not cars, cones or parts)
const fixedOnly = c => { const b = c.parent?.(); return !b || (b.isFixed ? b.isFixed() : !b.isDynamic?.()); };
const kindOf = c => { const u = c.userData ?? {}; return u.sound === 'building' ? 'building' : u.sound === 'tree' || u.material === 'wood' ? 'tree' : u.material === 'ground' ? 'ground' : 'other'; };

const RING = 12;
const DIRS = Array.from({ length: RING }, (_, i) => [Math.cos(i / RING * Math.PI * 2), 0, Math.sin(i / RING * Math.PI * 2)]);
export function probe(world, RAPIER, pos, cfg) {
  const R = cfg.reverb.probe, cast = (dir, reach, from = pos) => {
    const hit = world.castRay(new RAPIER.Ray({ x: from[0], y: from[1], z: from[2] }, { x: dir[0], y: dir[1], z: dir[2] }), reach, true, undefined, undefined, undefined, undefined, fixedOnly);
    return hit ? { d: hit.timeOfImpact ?? hit.toi, kind: kindOf(hit.collider) } : null;
  };
  const up = cast([0, 1, 0], R.up), hits = { building: 0, tree: 0, ground: 0, other: 0 }, sides = [];
  const from = [pos[0], pos[1] + 1.5, pos[2]];
  for (const d of DIRS) { const h = cast(d, R.side, from); sides.push(h ? h.d : null); if (h) hits[h.kind]++; }
  return { up: up ? up.d : null, upKind: up?.kind ?? null, sides, hits };
}
export function occluded(world, RAPIER, from, to) {
  const d = [to[0] - from[0], to[1] + 1 - from[1], to[2] - from[2]], L = Math.hypot(...d);
  if (!(L > 3)) return false;
  const hit = world.castRay(new RAPIER.Ray({ x: from[0], y: from[1], z: from[2] }, { x: d[0] / L, y: d[1] / L, z: d[2] / L }), L - 2, true, undefined, undefined, undefined, undefined, fixedOnly);
  return !!hit;
}

// Map v3: how built up, wooded and near the water it is round a place (sim frame), from the tiles loaded (each tile
// summed up once: its buildings and trees, a sample of its water's points)
const tileSummary = new WeakMap();
function summary(entry, T) {
  let s = tileSummary.get(entry.data);
  if (s) return s;
  const d = entry.data, cx = (entry.i + 0.5) * T, cz = (entry.j + 0.5) * T;
  const hulls = d.lists?.hulls, trees = d.lists?.trees, water = d.meshes?.water?.positions;
  const pts = [];
  if (water) for (let i = 0; i < water.length; i += 3 * 37) pts.push(water[i] + cx, water[i + 2] + cz);
  // (buildings: how many convex pieces — n, foot, eaves, n corners each; a building is a few)
  let pieces = 0;
  if (hulls) for (let k = 0, H = hulls.data; k < H.length; k += 3 + H[k] * 2) pieces++;
  s = { buildings: pieces, trees: trees ? trees.data.length / 5 : 0, water: Float32Array.from(pts), cx, cz };
  tileSummary.set(entry.data, s);
  return s;
}
export function mapArea(stream, pos) {
  const T = stream.manifest?.grid?.tileSize ?? 512, [wx, wz] = stream.toWorld(pos[0], pos[2]);
  let buildings = 0, trees = 0, area = 0, water = Infinity;
  for (const e of stream.tiles.values()) {
    if (e.state !== 'ready' || !e.data) continue;
    const s = summary(e, T), d = Math.hypot(s.cx - wx, s.cz - wz);
    if (d < T * 1.2) { const w = 1 - d / (T * 1.2); buildings += s.buildings * w; trees += s.trees * w; area += w; }
    if (d < T * 1.5) for (let i = 0; i < s.water.length; i += 2) water = Math.min(water, Math.hypot(s.water[i] - wx, s.water[i + 1] - wz));
  }
  const per = area || 1;
  return { city: smooth(40, 400, buildings / per), forest: smooth(60, 900, trees / per), coast: 1 - smooth(80, 450, water) };
}
// the ambience's layers for an area (data/sounds/ambient.json themes, mixed by how much it's each)
export function areaTheme(cfg, area) {
  const T = cfg.themes, w = { street: area.city, forest: area.forest * (1 - area.city), coastal: area.coast };
  const sum = w.street + w.forest + w.coastal, rest = Math.max(0, 1 - sum), out = { birds: 0, wind: 0, sea: 0, city: 0 };
  const add = (name, k) => { for (const key of Object.keys(out)) out[key] += (T[name]?.[key] ?? 0) * k; };
  for (const [name, k] of Object.entries(w)) add(name, sum > 1 ? k / sum : k);
  add('countryside', rest);
  for (const k of Object.keys(out)) out[k] = Math.min(1, out[k]);
  return out;
}

export function createEnvironment(A, { ambientCfg = null } = {}) {
  const cfg = A.cfg, R = cfg.reverb.probe;
  let ambCfg = ambientCfg, amb = null, since = 1e9, sur = { tunnel: 0, under: 0, street: 0, open: 1, width: null, area: { city: 0, forest: 0 } }, area = { city: 0, forest: 0, coast: 0 }, alive = true, ambKey = null;
  if (!ambCfg) fetch('data/sounds/ambient.json', { cache: 'no-cache' }).then(r => r.json()).then(c => { ambCfg = c; }).catch(() => {});
  return {
    get surroundings() { return sur; },
    get area() { return area; },
    // world, RAPIER: the physics' (the rays); pos: the listener (sim frame); stream: Map v3's (the area); theme: a
    // generated track's (and its stands: grandstands); speed m/s; inside: a cockpit or bonnet camera
    update({ world = null, RAPIER = null, pos = null, stream = null, theme = null, stands = [], speed = 0, inside = false }, dt) {
      if (!alive) return;
      since += dt;
      if (world && RAPIER && pos && since >= R.every) {
        since = 0;
        try {
          sur = surroundings(probe(world, RAPIER, pos, cfg), cfg);
          if (stream?.tiles) area = mapArea(stream, pos);
          A.setReverb(sur);
        } catch (e) { /* (the world changing under us: next time) */ }
      }
      // the ambience: a track's theme, or the area's
      if (!ambCfg || !pos) return;
      const key = theme ? `track:${theme}:${stands.length}` : stream ? 'area' : null;
      if (key !== ambKey) { amb?.dispose(); amb = key ? createTrackAmbience(A.ctx, A.bus.environment, { cfg: ambCfg, theme: theme ?? 'countryside', grandstands: stands }) : null; ambKey = key; }
      if (!amb) return;
      if (!theme) amb.setTheme(areaTheme(ambCfg, area));
      amb.update({ listener: pos, speed, inside }, dt);
    },
    cheer(kind, strength) { amb?.cheer(kind, strength); },
    get ambience() { return amb; },
    dispose() { alive = false; amb?.dispose(); amb = null; A.setReverb({ tunnel: 0, under: 0, street: 0, open: 1 }); },
  };
}
