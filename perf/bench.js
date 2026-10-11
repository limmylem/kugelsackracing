// The benchmark scenes (Phase 8 Step 2; docs/PERFORMANCE.md), set up in the game's own page (dev/world.html) and
// measured with the frame profiler (perf/profiler.js). tools/bench.mjs opens each scene's world in a browser, calls
// setup() and then measure(); the same can be done by hand from the console:
//   (await import('/perf/bench.js')).setup('track_race'); … (await import('/perf/bench.js')).measure(30)
//
// The scenes (data/performance.json benchmarks — which world each opens):
//   track_race   a dressed generated track, an 8-car race: you (the quest autopilot) and seven NPC racers
//   night_rain   the same track at night in the rain (floodlights, rain, wet road), you and three NPCs
//   pileup       ten cars driving into each other (you watching, nine AI cars at 60 km/h): crashes, dents, sparks
//   city         the real world downtown (Map v3: San Francisco's Market Street), an 8-car race: you (the autopilot) and seven
//                NPC racers on its streets (a grid has eight places)
//   roam         free roam with 30 players: you and 29 others driving round you (tools/bench.mjs runs the server
//                and the other players: mp/roamBot.js)
//
//   await setup(name, opts) → { ok, error?, note }     await measure(seconds) → the profiler's stats plus memory,
//   the renderer's resources, the audio thread's share; and while measuring the player's car keeps driving

const W = () => globalThis.testWorld;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 120000, every = 250) => { const t0 = performance.now(); for (;;) { const v = await fn(); if (v) return v; if (performance.now() - t0 > ms) return null; await sleep(every); } };

// a track event's race, started as the game starts one (track-perf-browser.mjs's way): npc NPCs, conditions
async function trackRace({ npc = 7, laps = 3, conditions = null } = {}) {
  const w = W().active, D = w.trackData;
  if (!D) return { ok: false, error: 'not on a track' };
  const { newTrackEvent, trackInfo } = await import('../track/events/model.js'), { readyEvent } = await import('../track/events/prepare.js');
  const qcfg = await (await fetch('data/quests.json')).json();
  const ev = newTrackEvent({ id: `bench_${npc}`, track: { code: D.code, kind: 'quick', name: 'benchmark', info: trackInfo(D) }, type: 'circuit_race', params: { laps }, npc: { count: npc, skill: [0.5, 0.8], drivers: 'random' } });
  if (conditions) ev.conditions = { ...ev.conditions, ...conditions };
  const { event, course } = readyEvent(ev, D, null, { config: qcfg });
  w.questGame.trackCourse = () => course;
  await W().shared.session.player.addXp(1e6);           // (every tier open: a fresh profile's level 1)
  const r = await w.quests.start(event);
  if (r?.ok === false) return { ok: false, error: r.error };
  const racing = await until(() => W().active.quests.state === 'racing', 120000);
  return racing ? { ok: true, note: `${npc + 1}-car race${conditions ? `, ${conditions.timeOfDay} ${conditions.weather}` : ''}` } : { ok: false, error: `the race didn't start (${W().active.quests.state})` };
}

// a sprint through downtown San Francisco (Market Street: the map tests' own city route), made and published as the
// editor would, then raced: you on the autopilot and the NPCs (a grid has eight places: seven NPCs at most)
async function cityRace({ npc = 7 } = {}) {
  const w = W().active;
  if (!w.stream || !w.questGame?.network) return { ok: false, error: 'not in the real world' };
  const N = await w.questGame.network();
  const { newRoute, saveCourse } = await import('../route/model.js'), { newItem } = await import('../content/quests.js'), { worldContent } = await import('../content/client.js');
  const C = await worldContent(), WP = [[37.7936, -122.3955], [37.7880, -122.4075], [37.7765, -122.4170]];
  const saved = saveCourse(N, { ...newRoute(N.region, 'p2p'), waypoints: WP.map(([lat, lon]) => ({ lat, lon })) });
  if (!saved?.course) return { ok: false, error: 'the route could not be made' };
  const start = { lat: WP[0][0], lon: WP[0][1], alt: 0, heading: 0 };
  const { author: _a, id: _i, ...route } = newItem('route', { location: saved.location ?? start, region: N.region });
  Object.assign(route, { name: 'Benchmark: Market Street', course: saved.course });
  const rr = await C.service.create(route); if (!rr.ok) return { ok: false, error: `route: ${rr.error}` };
  const rp = await C.service.publish(rr.item.id); if (!rp.ok) return { ok: false, error: `route: ${rp.error} ${JSON.stringify(rp.problems ?? '')}` };
  const { author: _b, id: _j, ...q0 } = newItem('quest', { location: rp.item.location, type: 'sprint' });
  Object.assign(q0, { name: 'Benchmark: downtown sprint', route: rp.item.id, npc: { count: npc, skill: [0.5, 0.8], drivers: 'random' } });
  const rq = await C.service.create(q0); if (!rq.ok) return { ok: false, error: `quest: ${rq.error}` };
  const pq = await C.service.publish(rq.item.id); if (!pq.ok) return { ok: false, error: `quest: ${pq.error} ${JSON.stringify(pq.problems ?? '')}` };
  await W().shared.session.player.addXp(1e6);
  const r = await w.quests.start(pq.item);
  if (r?.ok === false) return { ok: false, error: r.error };
  const racing = await until(() => W().active.quests.state === 'racing', 180000);
  return racing ? { ok: true, note: `${npc + 1}-car race downtown` } : { ok: false, error: `the race didn't start (${W().active.quests.state})` };
}

// free roam: you among the other players (tools/bench.mjs runs the server and puts them on the roads round you) — once
// this window has them all (their cars drawn where they're near enough)
async function roam({ players = 30 } = {}) {
  const ok = await until(() => { const M = globalThis.__krMp; return M?.status === 'online' && M.others().length >= players - 1; }, 120000, 500);
  const o = globalThis.__krMp?.others() ?? [];
  if (!ok) return { ok: false, error: `${o.length + 1} of ${players} players here (${globalThis.__krMp?.status ?? 'not online'})` };
  await until(() => globalThis.__krMp.others().filter(x => x.drawn).length >= Math.min(players - 1, 12), 60000, 500);
  const n = globalThis.__krMp.others(), drawn = n.filter(x => x.drawn).length;
  return { ok: true, note: `free roam, ${n.length + 1} players (${drawn} others' cars drawn, the nearest ${Math.round(n[0]?.distM ?? 0)} m away)` };
}

const SCENES = {
  roam,
  city: () => cityRace({ npc: 7 }),
  track_race: () => trackRace({ npc: 7 }),
  night_rain: () => trackRace({ npc: 3, conditions: { timeOfDay: 'night', weather: 'rain' } }),
  async pileup() {
    const g = globalThis.garage;
    if (!g?.pileup) return { ok: false, error: 'no pile-up command here' };
    // (a chase camera on the middle of it: the player's car stands 45 m back, the nine drive in from a ring round it)
    const note = await g.pileup(9, 60);
    return { ok: true, note };
  },
};

export async function setup(name, opts = {}) {
  if (!W()?.active) return { ok: false, error: 'no world yet' };
  const f = SCENES[name];
  if (!f) return { ok: false, error: `no scene ${name}` };
  try { return await f(opts); } catch (e) { return { ok: false, error: String(e?.stack ?? e) }; }
}

// what the graphics card holds (estimated: every geometry's buffers and every texture's pixels, as drawn now)
function gpuMemory(scene, renderer) {
  const geos = new Set(), texs = new Set();
  scene.traverse(o => {
    if (o.geometry) geos.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) for (const v of Object.values(m)) if (v?.isTexture) texs.add(v);
  });
  let geoBytes = 0, texBytes = 0;
  for (const g of geos) { for (const a of Object.values(g.attributes ?? {})) geoBytes += a.array?.byteLength ?? 0; geoBytes += g.index?.array?.byteLength ?? 0; }
  for (const t of texs) { const im = t.image; const w = im?.width ?? 0, h = im?.height ?? 0; texBytes += w * h * 4 * (t.generateMipmaps !== false ? 4 / 3 : 1); }
  return { geometries: geos.size, textures: texs.size, meshMB: geoBytes / 1048576, textureMB: texBytes / 1048576, programs: renderer.info.programs?.length ?? null };
}

// where the draw calls come from: one frame's every draw (the renderer's own, caught as it's made), counted by what
// it draws (the nearest named group above it, under the scene's top level, and the mesh's own name) and by pass — the
// shadows' (the sun's shadow map) or the picture's
export async function drawBreakdown(top = 16) {
  const S = W().shared, R = S.renderer, w = W().active, orig = R.renderBufferDirect, out = new Map();
  const labelOf = o => {
    let outer = null, inner = o.name || null;
    for (let p = o.parent; p && p !== w.scene; p = p.parent) if (p.name) { outer = p.name; if (!inner) inner = p.name; }
    const sub = (inner || o.material?.name || (o.isInstancedMesh ? 'instanced' : o.type)).replace(/[\d_.:-]+$/, '');
    return outer && outer !== sub ? `${outer} › ${sub}` : sub;
  };
  let frames = 0;
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const k = labelOf(object), e = out.get(k) ?? { calls: 0, shadow: 0, triangles: 0 };
    if (scene) e.calls++; else e.shadow++;
    const n = object.isInstancedMesh ? object.count : 1, c = group ? group.count : geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
    e.triangles += c / 3 * n;
    out.set(k, e);
    return orig.apply(this, arguments);
  };
  // (a few whole frames: counted from one frame's end to another's, then per frame)
  const P = S.prof, end = P.frameEnd;
  let counting = false;
  await new Promise(resolve => { P.frameEnd = function () { end.call(this); if (!counting) { counting = true; out.clear(); return; } if (++frames >= 3) { P.frameEnd = end; R.renderBufferDirect = orig; resolve(); } }; });
  const per = v => Math.round(v / frames);
  const list = [...out.entries()].sort((a, b) => (b[1].calls + b[1].shadow) - (a[1].calls + a[1].shadow));
  const total = list.reduce((a, [, v]) => ({ calls: a.calls + v.calls / frames, shadow: a.shadow + v.shadow / frames }), { calls: 0, shadow: 0 });
  return { total: { calls: Math.round(total.calls), shadow: Math.round(total.shadow) }, by: Object.fromEntries(list.slice(0, top).map(([k, v]) => [k, { calls: per(v.calls), shadow: per(v.shadow), triangles: per(v.triangles) }])) };
}

export async function measure(seconds = 30) {
  const S = W().shared, P = S.prof, sim0 = W().active.sim.time, t0 = performance.now();
  P.reset();
  await sleep(seconds * 1000);
  const st = P.stats(), w = W().active;
  let audio = null;
  try { const { audioSystem } = await import('../audio/system.js'); const A = audioSystem(); if (A) { const a = A.stats(); audio = { share: a.cpu.audio, voices: a.voices, worklet: a.worklet }; } } catch { /* no sound */ }
  return {
    ...st, stutterList: P.stutters.slice(-10),
    memory: { heapMB: st?.heapMB ?? null, ...gpuMemory(w.scene, S.renderer) },
    draws: await drawBreakdown(),
    audio,
    cars: 1 + (w.sim.cars?.length ?? 0) + (S.mp?.others?.().length ?? 0),
    ...(S.mp && { online: (({ ping, upKBs, downKBs, zones }) => ({ ping, upKBs, downKBs, zones }))(S.mp.net?.stats ?? {}), drawnOthers: S.mp.others().filter(x => x.drawn).length }),
    // (the physics by simulated time, not by frame: a slow frame catches up several steps — what a step costs, and
    // a 60th of a second's worth of steps)
    // (how long it ran, in real time and the simulation's: the garbage worked out from them — tools/bench.mjs)
    wallSeconds: (performance.now() - t0) / 1000, simSeconds: w.sim.time - sim0,
    physicsStep: { stepMs: w.sim.perf.stepMs, perCarMs: w.sim.perf.perCarMs, cars: w.sim.perf.cars, per60thMs: w.sim.perf.stepMs * (S.settings.stepHz ?? 120) / 60 },
    viewport: [innerWidth, innerHeight, devicePixelRatio, S.renderer.getPixelRatio()],
  };
}
