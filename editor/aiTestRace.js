// The editor's AI test race (race/aiTest.js): the quest's rivals race its route in a physics world of its
// own — the route's baked tiles loaded along it (as the tests do) — watched on the map, the cars as dots
// in their drivers' colours, at normal speed or as fast as it goes. Then a solo lap at each skill level
// sets the route's AI reference times (course.aiTimes, by the quest's class: the medal targets use them).
// Spots where the AIs crash, leave the route or get stuck are marked on the map and listed.
//
//   const T = await startAiTestRace({ map, quest, route, manifest, base, fast, onUpdate, onDone })   T.stop()

import RAPIER from '@dimforge/rapier3d-compat';
import { createAiTest } from '../race/aiTest.js';
import { viewCourse } from '../route/model.js';
import { transverseMercator } from '../map/build/format/projection.js';
import { decodeTile } from '../map/build/format/tileFormat.js';
import { terrainMeshes } from '../map/build/format/terrainMesh.js';
import { tileColliders } from '../map/build/render/physics.js';
import { MeshoptDecoder } from '../map/build/vendor/meshopt_decoder.module.js';
import { createSimulation } from '../physics/sim.js';
import { socketsFromGlb } from '../physics/sockets.js';
import { garageSession } from '../garage/session.js';

const json = async u => (await fetch(u, { cache: 'no-cache' })).json();
const glbs = new Map();

export async function startAiTestRace({ map, quest, route, manifest, base, fast = false, onUpdate = () => {}, onDone = () => {} }) {
  await RAPIER.init();
  const session = await garageSession(), db = session.db;
  const [settings, cfg, qcfg] = await Promise.all([json('physics/settings.json'), json('data/npc.json'), json('data/quests.json')]);
  const P = transverseMercator(manifest.projection.lat0, manifest.projection.lon0), T = manifest.grid.tileSize;
  const course = viewCourse(route.course, P);
  if (!course) throw new Error('the route has no line yet');
  // the tiles the route passes over (and 150 m either side), decoded once
  const want = new Set();
  for (const p of course.line) for (let dx = -150; dx <= 150; dx += 150) for (let dz = -150; dz <= 150; dz += 150) want.add(`${Math.floor((p.x + dx) / T)}_${Math.floor((p.z + dz) / T)}`);
  const have = new Set(manifest.tiles.map(t => `${t.i}_${t.j}`)), tiles = [];
  await MeshoptDecoder.ready;
  for (const key of want) {
    if (!have.has(key)) continue;
    const [i, j] = key.split('_').map(Number), bytes = new Uint8Array(await (await fetch(new URL(`tiles/${key}.m3t`, base))).arrayBuffer());
    const d = await decodeTile(bytes, MeshoptDecoder);
    Object.assign(d.meshes, terrainMeshes(d));
    tiles.push({ i, j, d });
  }
  const xs = course.line.map(p => p.x), zs = course.line.map(p => p.z), origin = [Math.floor(((Math.min(...xs) + Math.max(...xs)) / 2) / T) * T, Math.floor(((Math.min(...zs) + Math.max(...zs)) / 2) / T) * T];
  const surfaces = Object.entries(manifest.surfaces).map(([name, s]) => ({ name, ...s }));
  const socketsOf = async spec => { if (!glbs.has(spec.model.file)) glbs.set(spec.model.file, fetch(spec.model.file).then(r => r.arrayBuffer())); return socketsFromGlb(await glbs.get(spec.model.file), spec.model); };
  // a physics world with the route's ground (each car's own spec for the player's slot: the first rival's)
  async function makeSim(spec) {
    const track = { surfaces: manifest.surfaces, offRoad: 'grass', spawn: { position: [course.line[0].x - origin[0], course.line[0].h + 2, course.line[0].z - origin[1]], headingDeg: 0 }, roads: [] };
    const sim = createSimulation(RAPIER, { settings, spec, sockets: await socketsOf(spec), track });
    sim.vehicle.body.enableCcd(true);
    const byKey = new Map(tiles.map(t => [`${t.i}_${t.j}`, t.d]));
    sim.vehicle.surfaceAt = (sx, sz) => {
      const wx = sx + origin[0], wz = sz + origin[1], d = byKey.get(`${Math.floor(wx / T)}_${Math.floor(wz / T)}`), Gs = d?.grids.surface;
      if (!Gs) return surfaces[0];
      const c = Math.min(Gs.n - 1, Math.max(0, Math.floor((wx - Math.floor(wx / T) * T) / Gs.cell))), r = Math.min(Gs.n - 1, Math.max(0, Math.floor((wz - Math.floor(wz / T) * T) / Gs.cell)));
      return surfaces.find(s => s.name === Gs.names[Gs.data[r * Gs.n + c]]) ?? surfaces[0];
    };
    for (const t of tiles) sim.addStatic({ position: [(t.i + 0.5) * T - origin[0], 0, (t.j + 0.5) * T - origin[1]] }, tileColliders(t.d, RAPIER, manifest.barriers).pieces);
    sim.step({ device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false });
    return { sim, frame: { toWorld: (x, z) => [x + origin[0], z + origin[1]], toSim: (x, z) => [x - origin[0], z - origin[1]] }, free: () => sim.vehicle.world.free() };
  }
  const playerRating = session.stats?.totals?.rating?.index ?? null;
  const test = createAiTest({ makeSim, socketsOf, course, quest, db, cfg, qcfg, sessionRules: db.sessions, seed: Date.now() % 100000, playerRating });
  await test.start();

  // on the map: the cars, and the problem spots
  const ll = (x, z) => { const [lat, lon] = P.toLatLon(x, z); return [lon, lat]; };
  if (!map.getSource('ai-cars')) {
    map.addSource('ai-cars', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('ai-spots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'ai-spots', type: 'circle', source: 'ai-spots', paint: { 'circle-radius': 14, 'circle-color': '#ff2d2d', 'circle-opacity': 0.35, 'circle-stroke-color': '#ff2d2d', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'ai-cars', type: 'circle', source: 'ai-cars', paint: { 'circle-radius': 6, 'circle-color': ['get', 'colour'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'ai-names', type: 'symbol', source: 'ai-cars', layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
  }
  let stopped = false, last = performance.now();
  const draw = () => {
    map.getSource('ai-cars')?.setData({ type: 'FeatureCollection', features: test.cars().map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: ll(c.x, c.z) }, properties: { colour: c.colour ?? '#e33', label: `${c.place}. ${c.name}` } })) });
    const rep = test.report();
    map.getSource('ai-spots')?.setData({ type: 'FeatureCollection', features: rep.spots.map(s => ({ type: 'Feature', geometry: { type: 'Point', coordinates: ll(s.x, s.z) }, properties: { count: s.count } })) });
    return rep;
  };
  const loop = async () => {
    if (stopped) return;
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    await test.step(dt, { fast });
    const rep = draw();
    onUpdate({ phase: test.phase, report: rep, cars: test.cars() });
    if (test.done) { onDone({ ...rep, spots: rep.spots.map(s => ({ ...s, lat: ll(s.x, s.z)[1], lon: ll(s.x, s.z)[0] })) }); return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    stop() { stopped = true; test.dispose(); for (const id of ['ai-names', 'ai-cars', 'ai-spots']) if (map.getLayer(id)) map.removeLayer(id); for (const id of ['ai-cars', 'ai-spots']) if (map.getSource(id)) map.removeSource(id); },
    clearCars() { map.getSource('ai-cars')?.setData({ type: 'FeatureCollection', features: [] }); },
  };
}
