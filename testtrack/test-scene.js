// Test worlds (proving ground, physics lab, test centre, …): draws a simulation from physics/sim.js
// with three.js. Physics runs at a fixed rate; this only reads its states, blends between the last two
// for smooth motion, and draws the world, the car, optional debug lines, the HUD (with tachometer) and
// the car's sounds. Each world is built the first time you visit it and kept, so switching back and
// forth is instant.
//
// Tools for tuning: the tuning panel (P: every value in the car spec, presets, the automated tests),
// telemetry graphs (L), cameras (C: chase, bonnet, cockpit, side, high). Automated tests run in the
// test centre: while one runs, its simulation is the one drawn.
//
// The engine's health: a downshift that over-revs it flashes a warning; bent valves and a blown engine
// (a bang, smoke from the engine bay, the car coasting) are written to the player's engine, which the
// garage repairs. B resets the car for development (every part back to 100%, dents out, on the road).
//
// Crashes (physics/impacts.js → garage/damage.js): each hit dents the car, costs its parts condition and
// breaks glass and lights (by the damage setting: full, visual only, off), with a crash sound by how hard
// and into what, a scrape sound while sliding along something, and a jolt of the camera. U shows the
// damage view (every part coloured by its condition, and where each hit landed); the crash test
// (tuning panel's tests, or garage.crash(60, 'wall')) drives the car into the test centre's wall,
// barrier or guardrail at a chosen speed.
//
// Mechanical damage (garage/mechanical.js, physics/mechanical.js): hits, kerb strikes and heavy landings
// bend the steering and suspension, rims, puncture tyres, hole the radiator and boost pipes, damage the
// gearbox, diff and exhaust, and a huge one tears a wheel off (it rolls away). The dashboard shows the
// engine's temperature, the check engine light and lamps for tyres, overheating, limp mode and damaged
// systems; I opens the damage report; garage.damage(…) sets any of it. What changes while driving (tyre
// pressures, coolant, clutch wear) is written back to the parts every few seconds.
//
// Effects (effects/, data/effects.json): sparks where metal scrapes something hard (a wall, the road
// under a bottomed-out car, a dragging loose part, a flat tyre's rim, a torn-off part sliding), tyre smoke
// and skid marks, dirt spray, dust and grass off loose ground (each surface's effects), steam from a
// leaking radiator or a hot engine (with its hiss), smoke from a damaged engine, a blown engine's burst
// and flash of flame, glass shards, debris chips and dust clouds in crashes, and drips from a leaking car
// — for every car, yours and the AI's. Lit by the time of day (settings: night has headlights, and
// sparks glow), at the quality in the settings (low / medium / high); . opens the effects panel (each
// effect on demand, and what they cost); garage.pileup(8, 60) throws AI cars into each other.
//
// Sessions (physics/race.js, data/sessions.json; the settings, O): a test drive or a race. Cars hit each
// other fully, for reduced damage, or not at all (ghosting); their hits damage both cars (an AI car keeps
// its own damage, garage/carDamage.js). R (back on the road) keeps the damage — in a race even a part
// torn off stays off (only a wheel goes back on, bent and flat); B (the development reset, everything
// repaired) only in a test drive; Backspace twice tows the car to the garage, ending the session, the
// garage open on the damage report. After a big crash a short slow-motion replay from a cinematic angle
// (any key skips it; on in the settings, never in a race), from the last seconds of every car's state
// (physics/replay.js). Denting the meshes is spread over frames (garage/dents.js DentBudget: at most
// settings.budget.dentsMs a frame). The first time something happens — the first damage, a part hanging
// off, a car that can't carry on — a short hint says what to do (garage/hints.js).

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSimulation } from '../physics/sim.js';
import { axisAngle, modelRig, nodeBoxes, quatMul, socketsFromGlb, wheelTransform } from '../physics/sockets.js';
import { roadCenterline, roadLine, terrainOf, trackShapes } from '../physics/track.js';
import { createAudio } from './audio.js';
import { createDyno, createTacho } from './gauges.js';
import { InputManager } from './input.js';
import { reverseLine, roadFollower, straightLine } from '../physics/ai.js';
import { createSettingsPanel, loadSettings, saveSettings } from './settings.js';
import { CAMERAS, createCameraRig } from './camera.js';
import { Telemetry } from '../physics/telemetry.js';
import { createTelemetryPanel } from './telemetryPanel.js';
import { createTuningPanel } from './tuning.js';
import { causeOf, engineFlash } from './engineNews.js';
import { bodyDef, wheelDef } from '../garage/detach.js';
import { CORNERS } from '../garage/mechanical.js';
import { testCar } from '../physics/testCars.js';
import { createDamageReport, createDash } from './dashboard.js';
import { placeForCrash } from '../physics/crashTest.js';
import { TESTS, createRun, evaluate } from '../physics/testSuite.js';
import { garageSession } from '../garage/session.js';
import { ModelCache, createCarVisual, setEnvironment, skyEnvironment } from '../garage/visual.js';
import { EffectsDirector } from '../effects/director.js';
import { carEffectsInfo } from '../effects/carInfo.js';
import { createThreeEffects } from '../effects/threeRenderer.js';
import { lightAt } from '../effects/lighting.js';
import { createEffectsPanel } from './effectsPanel.js';
import { createSession } from '../physics/race.js';
import { ReplayPlayer, ReplayRecorder } from '../physics/replay.js';
import { CarDamage } from '../garage/carDamage.js';
import { DentBudget } from '../garage/dents.js';
import { Hints, crashEvents as hintEvents } from '../garage/hints.js';
import { drivability, ownedBySocket } from '../garage/repair.js';
import { createHintCard } from './hintCard.js';
import * as RW2 from './realWorld.js';
import * as MapV3 from '../map/build/render/game.js';
// the real world: Map v3 (map/, MAP_README.md) — or v2's baked world (testtrack/realWorld.js), behind ?map=v2
const rwOf = w => (w?.track?.mapV3 ? MapV3 : RW2);
const hideRealWorlds = () => { RW2.hideRealWorld(); MapV3.hideRealWorld(); };

const TEST_CENTRE = 'scenes/test_centre.json', RESULTS = 'driveWorld.testResults.v1';

// Display / sound only (not physics):
const FORCE_LINE_M_PER_N = 1 / 4000;           // force arrows: metres of line per newton
const AERO_LINE_M_PER_N = 1 / 600;             // aero arrows (much smaller forces)
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SKID_FROM = 1.5, SKID_FULL = 7;          // tyre sliding speed (m/s) where the squeal starts and peaks
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let shared = null, active = null;
const worlds = new Map();
// Debug handle for the browser console: (await import('./testtrack/test-scene.js')).debug.active
// (debug.frame(ms) draws one frame by hand, e.g. in a background tab where the browser pauses animation)
export const debug = { get active() { return active; }, get shared() { return shared; }, frame: now => active && frame(active, now), runTests: (ids, o) => runTests(ids, o) };
// The page can let the tests switch worlds its own way (so its world buttons follow): switchTo(file)
// toGarage(): tow the car to the garage (the page goes there, open on the damage report)
export const hooks = { switchTo: null, toGarage: null };

export async function enter(file) {
  if (!shared) shared = await createShared();
  shared.hud.style.display = 'block';
  shared.audio?.mute(shared.muted);
  shared.input.enabled = true;
  if (!worlds.has(file)) {
    shared.info.textContent = 'Building world…';
    worlds.set(file, await buildWorld(file));
  }
  active = worlds.get(file);
  hideRealWorlds();
  if (active.stream) rwOf(active).showRealWorld(active);
  // record this world's car; the gearbox mode carries over between worlds
  shared.stopTelemetry?.();
  shared.stopTelemetry = shared.telemetry.attach(active.sim);
  shared.telemetry.label = active.name;
  active.sim.vehicle.drivetrain.mode = shared.gearMode;
  active.rig.reset();
  shared.renderer.domElement.style.display = 'block';
  shared.last = performance.now();
  if (!shared.looping) { shared.looping = true; requestAnimationFrame(loop); }
}

export function exit() {
  active = null;
  hideRealWorlds();
  if (!shared) return;
  shared.renderer.domElement.style.display = 'none';
  shared.hud.style.display = 'none';
  shared.dyno.hide();
  shared.panel.hide();
  shared.tuning.hide();
  shared.graphs.hide();
  if (shared.tests) finishTests();
  shared.audio?.mute(true);
  shared.input.enabled = false;
  shared.flash.hide();
}

// Things every world shares: the screen, HUD, controls, the car spec and model, the physics engine
async function createShared() {
  const hud = document.createElement('div'), info = document.createElement('div');
  hud.id = 'testHud';
  info.textContent = 'Loading physics…';
  hud.appendChild(info);
  document.body.appendChild(hud);
  const flash = engineFlash();
  document.body.appendChild(flash.el);
  const getJson = async url => (await fetch(url, { cache: 'no-cache' })).json();
  // the car: built from its parts by the garage (data/cars, data/parts); `spec` is the one live object
  // every car drives on, rebuilt in place when parts change (window.garage in the console)
  const [settings, session, effectsCfg] = await Promise.all([getJson('physics/settings.json'), garageSession(), getJson('data/effects.json')]);
  const spec = session.spec;
  const tacho = createTacho(spec.engine), dyno = createDyno(spec.engine), dash = createDash(), report = createDamageReport();
  hud.prepend(tacho.canvas);
  tacho.canvas.after(dash.el);
  document.body.appendChild(report.el);
  document.body.appendChild(dyno.el);
  // the car's body model: where its sockets are (the physics) and how its wheels turn (the drawing)
  const glb = await (await fetch(spec.model.file)).arrayBuffer();
  const sockets = socketsFromGlb(glb, spec.model), rig = modelRig(glb, spec.model);
  // (where the body shell, its glass and its lights are, for crash damage)
  const damageBoxes = nodeBoxes(glb, spec.model, [...(session.garage.car.model.breakables ?? []).map(b => b.node), 'body_shell']);
  await RAPIER.init();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // what chrome, metallic paint and the like reflect (only those finishes use it)
  setEnvironment(skyEnvironment(renderer));
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '1', display: 'none' });
  document.body.appendChild(renderer.domElement);

  // Player settings (aids, brake bias, input device and bindings), kept in this browser
  const prefs = loadSettings(spec), input = new InputManager(prefs);
  const panel = createSettingsPanel(prefs, spec, input, () => { if (shared) shared.play = sessionFrom(prefs, session.db); });
  document.body.appendChild(panel.el);
  // Telemetry: your driving, and the last automated test
  const telemetry = new Telemetry({ seconds: 600, stepHz: settings.stepHz }), testTelemetry = new Telemetry({ seconds: 300, stepHz: settings.stepHz });
  const graphs = createTelemetryPanel(() => [{ id: 'drive', name: 'your driving', telemetry }, ...(testTelemetry.count ? [{ id: 'test', name: `test: ${testTelemetry.label}`, telemetry: testTelemetry }] : [])]);
  document.body.appendChild(graphs.el);
  // Tuning panel: edits `spec` in place, which every world's cars drive on
  let results = {};
  try { results = JSON.parse(localStorage.getItem(RESULTS) || '{}'); } catch { /* none kept */ }
  const tuning = createTuningPanel({ spec, carId: session.garage.car.id, save: (edited, put) => session.saveEdits(edited, put), onChange: retuned, tests: { list: TESTS, run: (ids, o) => runTests(ids, o), stop: () => { if (shared.tests) shared.tests.queue.length = 0, shared.tests.stopped = true; }, crash: (kmh, target) => crashTest(kmh, target) } });
  document.body.appendChild(tuning.el);
  // (the car's test targets, and how hard the test robot drives it: tests/targets/<carId>.json)
  const targets = await getJson(`tests/targets/${session.garage.car.id}.json`).catch(() => ({}));
  tuning.setTests({ results, targets });
  // the session (a test drive or a race: the settings), the dent budget, the hints
  const hintCard = createHintCard();
  document.body.appendChild(hintCard.el);
  const hints = new Hints(session.db.hints, { seen: () => session.player.profile?.hints, mark: id => session.player.markHint(id) });
  const s = {
    hud, info, flash, tacho, dyno, dash, report, mechSave: 0, settings, spec, session, glb, sockets, rig, damageBoxes, renderer, prefs, input, panel, debug: false, camMode: 0, last: 0, hudTimer: 0, fps: 60, looping: false, effectsCfg,
    damageView: false, lastCrash: null,
    play: null, dents: new DentBudget(settings.budget?.dentsMs ?? 2), hints, hintCard, replay: null, replayDue: null, towArmed: 0,
    models: new ModelCache(), visuals: new Set(), copies: [],
    audio: null, muted: false, gearMode: spec.gearbox.mode, compact: false, telemetry, testTelemetry, graphs, tuning, targets, results, tests: null,
    carId: session.garage.car.id, switching: null,
  };
  s.play = sessionFrom(prefs, session.db);
  // parts fitted or taken off (garage console, K): every car re-derives, and that's the new saved setup
  session.onChange(() => {
    // (another car: picked in the garage, or a test drive — every world swaps to it)
    if (session.garage.car.id !== shared.carId) { switchCar(); return; }
    // (another engine — a swap — or its sound: the new one's sound)
    if (s.audio && s.audioSound !== spec.engine?.sound) restartAudio();
    for (const w of worlds.values()) w.sim.retune();
    tuning.rebase();
    // (a blown engine written back: the car can't be driven until it's repaired)
    const d = session.drivable;
    for (const w of worlds.values()) w.sim.vehicle.immobilized = d.ok ? null : d.reasons;
  });
  // parts fitted or taken off, the paint: every car drawn changes what's different (AI cars keep their paint)
  // normal play: the garage changes the car only while it's standing still (garage.debugMode(true): any time)
  session.addChangeGate(() => active && !shared.tests && Math.abs(active.sim.vehicle.forwardSpeed()) > 0.5 ? 'Stop the car first: parts, tuning and condition only change in the garage (standing still). garage.debugMode(true) lets them change while driving.' : null);
  session.onLook(() => {
    if (session.garage.car.id !== shared.carId) return;          // (another car: switchCar draws it)
    const d = session.drivable;
    for (const w of worlds.values()) w.sim.vehicle.immobilized = d.ok ? null : d.reasons;
    const paint = session.paint;
    for (const v of shared.visuals) {
      v.applyBuild(session.garage.build, session.garage.view);
      if (!v.fixedPaint) { v.setDamage(session.damage, session.db.damage); if (shared.damageView) v.showCondition(conditionsNow()); }
      if (!v.fixedPaint && (v.paint.colour !== paint.colour || v.paint.finish !== paint.finish)) v.setPaint(paint);
    }
  });
  // the effects' debug panel (.): each effect on demand, and what they cost
  s.fxPanel = createEffectsPanel(() => active, s);
  document.body.appendChild(s.fxPanel.el);
  // (parts, paint or tyre smoke changed: what the effects know about your car)
  const fxInfo = () => { for (const w of worlds.values()) w.fx.setCar(0, carEffectsInfo(session, s.damageBoxes)); };
  session.onLook(fxInfo); session.onChange(fxInfo);
  debugCommands(session);
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    for (const w of worlds.values()) { w.camera.aspect = innerWidth / innerHeight; w.camera.updateProjectionMatrix(); }
  });
  // sound may only start after a user gesture
  const startAudio = () => { if (!s.audio && !s.noAudio && active) try { s.audio = createAudio(spec); s.audioSound = spec.engine?.sound; s.audio.mute(s.muted); } catch { s.noAudio = true; } };
  addEventListener('keydown', e => {
    if (!active) return;
    if (s.replay) { e.preventDefault(); s.replay.player.skip(); return; }      // (any key skips a crash replay)
    startAudio();
    if (e.code === 'Enter') s.dyno.rerun();
    if (e.code === 'Escape' && panel.open) panel.hide();
    else if (e.code === 'Escape' && s.tests) { s.tests.queue.length = 0; s.tests.stopped = true; }
  });
  addEventListener('pointerdown', startAudio);
  return s;
}

// Another car (picked in the garage, or a test drive from the dealership): every world's car is swapped
// for it where it stands — its model's sockets and wheels, its collider, its drawing — and the dials,
// the sound and the tests' targets are the new car's
function switchCar() {
  const s = shared;
  return s.switching ??= (async () => {
    try {
      while (s.carId !== s.session.garage.car.id) {
        const spec = s.spec, car = s.session.garage.car;
        s.carId = car.id;
        if (s.tests) finishTests();
        const glb = await (await fetch(spec.model.file)).arrayBuffer();
        Object.assign(s, { glb, sockets: socketsFromGlb(glb, spec.model), rig: modelRig(glb, spec.model), damageBoxes: nodeBoxes(glb, spec.model, [...(car.model.breakables ?? []).map(b => b.node), 'body_shell']) });
        for (const w of worlds.values()) {
          w.sim.replaceCar(spec, s.sockets);
          for (const p of w.pieces?.values?.() ?? []) p.object?.removeFromParent();
          w.pieces?.clear?.();
          const old = w.carVis, vis = await carVisual();
          w.scene.add(vis.group);
          vis.group.add(w.comMarker);
          dropCar(old);
          Object.assign(w, { carVis: vis, car: vis.group, wheelVis: vis.wheelVis, details: vis.details });
          const d = s.session.drivable;
          w.sim.vehicle.immobilized = d.ok ? null : d.reasons;
          w.sim.vehicle.drivetrain.mode = s.gearMode = spec.gearbox.mode;
          w.rig.reset();
        }
        if (active) { s.stopTelemetry?.(); s.stopTelemetry = s.telemetry.attach(active.sim); }
        // the dials, the sound, the tests' targets
        const tacho = createTacho(spec.engine);
        s.tacho.canvas.replaceWith(tacho.canvas);
        s.tacho = tacho;
        const dyno = createDyno(spec.engine);
        s.dyno.el.replaceWith(dyno.el);
        s.dyno = dyno;
        if (s.audio) restartAudio();
        s.targets = await (await fetch(`tests/targets/${car.id}.json`, { cache: 'no-cache' })).json().catch(() => ({}));
        s.tuning.setTests({ results: s.results, targets: s.targets });
        s.tuning.rebase();
      }
    } catch (err) { console.error(`Couldn't switch to the ${s.session.garage.car.name}: ${err.message ?? err}`); }
    finally { s.switching = null; }
  })();
}
// The engine's sound again (another engine, or another car)
function restartAudio() {
  const s = shared;
  try { s.audio?.ctx.close(); } catch { /* gone */ }
  s.audio = null;
  try { s.audio = createAudio(s.spec); s.audioSound = s.spec.engine?.sound; s.audio.mute(s.muted || !active); } catch { s.noAudio = true; }
}

async function buildWorld(file) {
  const track = await (await fetch(file)).json();
  // (the real world: its ground streams in from the baked tiles — testtrack/realWorld.js)
  if (track.streamed) await RW2.prepareTrack(track);
  if (track.mapV3) await MapV3.prepareTrack(track);
  const { settings, spec, sockets, glb } = shared;
  const sim = createSimulation(RAPIER, { settings, spec, sockets, track });
  const terrain = terrainOf(track);

  const scene = new THREE.Scene();
  const sky = new THREE.Color(0x9cc9f0);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, terrain ? 250 : 150, terrain ? 900 : 450);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x556655, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 150 });
  scene.add(sun, sun.target);

  // Fixed shapes (same as the colliders)
  const trees = [];
  for (const s of trackShapes(track)) {
    if (s.tree) { trees.push(s.tree); continue; }
    if (s.kind === 'heightfield') { scene.add(terrainMesh(s.terrain, s.colour, track.terrain.rockColour)); continue; }
    let geo;
    if (s.kind === 'box') geo = new THREE.BoxGeometry(s.halfExtents[0] * 2, s.halfExtents[1] * 2, s.halfExtents[2] * 2);
    else geo = new THREE.CapsuleGeometry(s.radius, s.halfHeight * 2, 6, 16);
    const mat = s.ground ? groundMaterial(s, !terrain) : new THREE.MeshLambertMaterial({ color: s.colour });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...s.centre);
    mesh.quaternion.set(s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w);
    mesh.receiveShadow = true;
    mesh.castShadow = !s.ground;
    scene.add(mesh);
  }
  const heightAt = (x, z) => terrain ? terrain.heightAt(x, z) : 0;
  for (const road of track.roads || []) {
    scene.add(roadMesh(road, heightAt));
    if (road.startArch && road.startLine) scene.add(startArch(road, heightAt));
  }
  for (const p of track.pads || []) scene.add(padMesh(p, heightAt));
  for (const p of track.paint || []) if (p.type === 'skidpad') scene.add(skidpadMesh(p, heightAt));
  if (trees.length) scene.add(...treeMeshes(trees, track.trees));
  const cones = sim.propDefs.map(p => { const m = coneMesh(p); scene.add(m); return m; });

  // Car
  const carVis = await carVisual();
  scene.add(carVis.group);
  const { group: car, wheelVis, details } = carVis;
  // the centre of mass (with the debug lines, G): an orange ball on the car's axes
  const comMarker = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10), new THREE.MeshBasicMaterial({ color: '#ff9a1f', depthTest: false }));
  ball.renderOrder = 999;
  const comAxes = new THREE.AxesHelper(0.35);
  comAxes.material.depthTest = false; comAxes.renderOrder = 999;
  comMarker.add(ball, comAxes);
  comMarker.visible = false;
  car.add(comMarker);
  { const d = shared.session.drivable; sim.vehicle.immobilized = d.ok ? null : d.reasons; }

  // Debug lines: suspension rays, spring / grip / drive forces
  const MAX_LINES = 96;
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINES * 6), 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_LINES * 6), 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
  lines.renderOrder = 10;
  lines.frustumCulled = false;
  scene.add(lines);

  // The effects (effects/: sparks, smoke, steam, dust, debris, skid marks…): marks sit just above whatever
  // is drawn on the ground (roads are drawn a few cm above the terrain); every car's, yours is 0
  const surfaces = track.surfaces ?? {};
  const fx = new EffectsDirector(shared.effectsCfg, { level: shared.prefs.effects, surfaces, markLift: terrain ? 0.075 : 0.012 });
  const fxDraw = createThreeEffects(fx, { renderer: shared.renderer, scene });
  fx.setCar(0, carEffectsInfo(shared.session, shared.damageBoxes));

  const w = {
    file, name: track.name, track, sim, scene, camera, sun, hemi, car, carVis, wheelVis, details, comMarker, cones, lines, surfaces, fx, fxDraw, heightAt, others: new Map(),
    roadLines: (track.roads || []).map(roadLine), rig: createCameraRig(),
    aiDamage: new Map(),                 // AI car id → its own crash damage (garage/carDamage.js)
    recorder: new ReplayRecorder(shared.session.db.sessions.replay),
  };
  if (track.streamed) await RW2.attachRealWorld(w, shared, { RAPIER });
  if (track.mapV3) await MapV3.attachRealWorld(w, shared, { RAPIER });
  return w;
}

function loop(now) {
  if (!active) { shared.looping = false; return; }
  requestAnimationFrame(loop);
  frame(active, now);
}

function frame(w, now) {
  const seconds = Math.min(Math.max((now - shared.last) / 1000, 0), 0.25);
  shared.last = now;
  shared.fps += ((seconds > 0 ? 1 / seconds : 0) - shared.fps) * 0.05;

  // Input (keyboard / gamepad / wheel), and the game's own actions
  const inp = shared.input.poll(), P = shared.prefs, v = w.sim.vehicle;
  // a crash replay playing (or due): it's what's drawn, and the world waits
  if (shared.replay || (shared.replayDue && now >= shared.replayDue.at)) { if (replayFrame(w, now, seconds, inp)) return; }
  for (const act of inp.pressed) handleAction(w, act, inp);
  // the real world: its ground streamed round the car; it waits while the ground ahead is loading
  const rw = w.stream ? rwOf(w).realWorldFrame(w, shared, seconds) : null;
  if (w.stream) w.sim.vehicle.surfaceAt = w.stream.surfaceAt;
  const paused = shared.panel.open || !!rw?.hold;           // the settings panel pauses the car
  // player settings → the car
  Object.assign(v.aids, P.aids);
  v.mechanical.enabled = (P.damage ?? 'full') === 'full';        // (visual only, off: it drives as new)
  if (w.altitudeOffset !== P.altitude) { w.sim.setAltitudeOffset(P.altitude); w.altitudeOffset = P.altitude; }
  if (v.brakes.bias !== P.brakeBias) v.brakes.setBias(P.brakeBias);
  v.handbrakeClutch = P.handbrakeClutch;
  shared.lastInput = inp;
  // the session's collisions between cars (ghosting: none)
  if (w.sim.collisions !== shared.play.collisions) w.sim.setCollisions(shared.play.collisions);
  // An automated test running here is what's drawn (your car waits); otherwise your car drives, each
  // physics step with the input from its own moment
  const T = shared.tests?.world === w ? shared.tests : null;
  let view = T ? stepTests(T, seconds) : null;
  if (!view && shared.switching) view = w.sim.advance(0, { throttle: 0, brake: 0, steer: 0, handbrake: false, device: inp.device });   // (another car on its way: hold still)
  if (!view) {
    const input = paused ? { throttle: 0, brake: 0, steer: 0, handbrake: false, device: inp.device } : (start, end) => shared.input.stepInput(inp, now + start * 1000, now + end * 1000);
    view = w.sim.advance(paused ? 0 : seconds, input);
    shared.gearMode = v.drivetrain.mode;
    effectsCars(w, view.current, view.stepsThisFrame * w.sim.dt);     // (simulation time: the effects keep pace with the physics)
    if (view.stepsThisFrame) w.recorder.record(w.sim.time, view.current);
    engineEvents(w, v);
    crashEvents(w, v, now);
    partsEvents(w, v);
    mechanicalEvents(w, v, paused ? 0 : seconds);
  }
  const { previous: a, current: b, alpha, stepsThisFrame } = view, sim = T?.sim ?? w.sim;

  // Draw everything part-way between the last two physics states
  const place = (obj, pa, pb) => {
    obj.position.set(pa.position[0] + (pb.position[0] - pa.position[0]) * alpha, pa.position[1] + (pb.position[1] - pa.position[1]) * alpha, pa.position[2] + (pb.position[2] - pa.position[2]) * alpha);
    obj.quaternion.set(pa.rotation.x, pa.rotation.y, pa.rotation.z, pa.rotation.w)
      .slerp(new THREE.Quaternion(pb.rotation.x, pb.rotation.y, pb.rotation.z, pb.rotation.w), alpha);
  };
  placeCar(w.carVis, a, b, alpha);
  w.cones.forEach((m, i) => place(m, a.props[i], b.props[i]));

  updateCarDetails(w.carVis, a, b, alpha);
  if (!T) drawParts(w, b);
  syncParts(w.carVis, b);
  if (!T) updateOtherCars(w, a, b, alpha);
  if (!paused && !T) shared.input.feedback(b, seconds);

  b.bonnetUp = T ? 0 : bonnetUp(b);
  w.rig.update(w.camera, w.car, b, seconds, CAMERAS[shared.camMode], shared.spec.camera);
  const inside = CAMERAS[shared.camMode] === 'cockpit' || CAMERAS[shared.camMode] === 'bonnet', D = w.carVis.details;
  if (D.glass) D.glass.opacity = inside ? 0.1 : D.glass.userData.opacity ?? D.glassOpacity;
  const light = daylight(w, P.timeOfDay ?? 13);
  updateEffects(w, light, T ? 0 : stepsThisFrame * w.sim.dt);
  shared.flash.update(seconds);
  if (shared.audio) { shared.audio.update(b, seconds, { exhaust: exhaustOff(), inside: ['cockpit', 'bonnet'].includes(CAMERAS[shared.camMode]), steam: w.fx.cars.get(0)?.steam ?? 0 }); updateSqueal(b); }
  shared.tacho.draw(b.engine);
  updateDebug(w, b);
  w.sun.position.copy(w.car.position).addScaledVector(w.sunDir, 40); // shadows follow the car
  w.sun.target.position.copy(w.car.position);

  shared.hudTimer -= seconds;
  if (shared.hudTimer <= 0) { shared.hudTimer = 0.1; updateHud(w, b, stepsThisFrame, sim); updateDash(b); }
  shared.graphs.update(now);
  shared.dents.flush();                                     // (denting, at most its budget a frame)
  shared.hintCard.update(seconds);
  w.fxDraw.render(w.scene, w.camera);
  shared.fxPanel.update(w, seconds);
}

// ---------- Sessions (physics/race.js), the crash replay (physics/replay.js), hints (garage/hints.js) ----------

// The session the settings ask for: its kind, and the collisions and replay chosen (the kind's own if none)
function sessionFrom(prefs, db) {
  const kind = db.sessions.kinds[prefs.session] ? prefs.session : 'test';
  return createSession(db.sessions, kind, { ...(prefs.collisions && { collisions: prefs.collisions }), replay: db.sessions.kinds[kind].replay && prefs.crashReplay !== false });
}
// A hint for something that happened on the road (once ever: the save keeps it)
function hint(when) {
  const h = shared.hints.note(when, 'drive');
  if (h) shared.hintCard.show(h.title, h.text);
}
// One frame of the crash replay (or its start, once its wait is up): the cars and torn-off pieces where
// the recording has them, in slow motion, from the replay's camera; your car's dents as they were before
// the crash until it happens. Any key, or a button, skips it. Returns whether it drew the frame
function replayFrame(w, now, seconds, inp) {
  const s = shared, due = s.replayDue;
  if (!s.replay) {
    s.replayDue = null;
    const frames = w.recorder.window(due.time, s.session.db.sessions.replay.before, s.session.db.sessions.replay.after);
    if (frames.length < 4) return false;
    s.replay = { player: new ReplayPlayer(frames, { speed: s.session.db.sessions.replay.speed, at: due.time, focus: due.focus }), before: due.before, crashed: false, world: w };
    w.carVis.setDamage(due.before, s.session.db.damage);
    hint('replay');
  }
  const R = s.replay;
  if (R.world !== w || inp.pressed.length) R.player.skip();
  const { a, b, alpha, done } = R.player.step(seconds);
  if (!R.crashed && R.player.afterCrash) { R.crashed = true; w.carVis.setDamage(s.session.damage, s.session.db.damage); }
  if (done) {
    s.replay = null;
    w.carVis.setDamage(s.session.damage, s.session.db.damage);
    w.rig.reset();
    s.last = now;
    return false;
  }
  // the cars where the recording has them
  const byId = f => new Map(f.cars.map(c => [c.id, c]));
  const A = byId(a), B = byId(b);
  placeCar(w.carVis, A.get(0), B.get(0), alpha);
  updateCarDetails(w.carVis, A.get(0), B.get(0), alpha);
  for (const [id, vis] of w.others) { const ca = A.get(id), cb = B.get(id); if (ca && cb) placeCar(vis, ca, cb, alpha); }
  drawParts(w, { ...B.get(0), debris: b.debris });
  const cam = R.player.camera();
  w.camera.position.fromArray(cam.position);
  w.camera.lookAt(new THREE.Vector3(...cam.target));
  if (w.camera.fov !== 42) { w.camera.fov = 42; w.camera.updateProjectionMatrix(); }
  s.dents.flush();
  s.hintCard.update(seconds);
  s.info.innerHTML = `<div class="world">${w.name}</div><div class="test">REPLAY <b>×${s.session.db.sessions.replay.speed}</b> · any key skips</div>`;
  daylight(w, s.prefs.timeOfDay ?? 13);
  w.fxDraw.render(w.scene, w.camera);
  return true;
}
// Backspace twice: the car towed to the garage — the session over (a race back to a test drive), the
// garage open on the damage report
function tow(w) {
  const s = shared, ok = s.play.allows('tow');
  if (!ok.ok) { s.flash.show('No tow', 'warn', 1.5, ok.why); return; }
  if (performance.now() - s.towArmed > 2500) { s.towArmed = performance.now(); s.flash.show('Tow to the garage?', 'warn', 2.2, 'Backspace again: ends the session, the car to the garage for repairs'); return; }
  s.towArmed = 0;
  if (s.play.race) { s.prefs.session = 'test'; delete s.prefs.collisions; saveSettings(s.prefs); s.play = sessionFrom(s.prefs, s.session.db); }
  for (const c of [...w.sim.cars]) w.sim.removeCar(c.id);
  resetCar(w, true);
  w.rig.reset();
  s.flash.show('Towed to the garage', 'ok', 1.5, 'the damage report is open');
  if (hooks.toGarage) hooks.toGarage(); else s.flash.show('Towed', 'ok', 2, 'no garage on this page: the car is back at the start');
}

// ---------- Effects (effects/director.js, effects/threeRenderer.js) ----------

// Every car's state into the effects: yours (0) and the AI cars' — tyres, steam, smoke, drips, and the
// scrapes (sparks) worked out from each one's snapshot
function effectsCars(w, b, dt) {
  const fx = w.fx;
  if (fx.level !== shared.prefs.effects) fx.setQuality(shared.prefs.effects);
  fx.updateCar(0, b, dt);
  fx.sense(0, b);
  for (const o of b.others ?? []) {
    if (!fx.cars.has(o.id)) fx.setCar(o.id, carEffectsInfo(shared.session, shared.damageBoxes, { paint: AI_PAINT }));
    fx.updateCar(o.id, o, dt);
    fx.sense(o.id, o);
  }
  for (const id of fx.cars.keys()) if (id !== 0 && !b.others?.some(o => o.id === id)) fx.dropCar(id);
}
// The light at this time of day (effects/lighting.js): the sun (or the moon), the sky, the fog — set
// when the time changes; and your car's headlights at night
function daylight(w, hours) {
  if (w.hours !== hours) {
    w.hours = hours;
    const L = w.light = lightAt(hours);
    w.sunDir = new THREE.Vector3(...L.key.dir);
    const srgb = THREE.SRGBColorSpace;            // (lighting.js's colours are as they look on screen)
    w.sun.color.setRGB(...L.key.colour, srgb); w.sun.intensity = L.key.intensity;
    w.hemi.color.setRGB(...L.ambient.sky, srgb); w.hemi.groundColor.setRGB(...L.ambient.ground, srgb); w.hemi.intensity = L.ambient.intensity;
    w.scene.background.setRGB(...L.background, srgb); w.scene.fog.color.setRGB(...L.fog, srgb);
  }
  const lamps = w.carVis.headlights;
  if (lamps) for (const l of lamps) l.intensity = w.light.night * 60;
  return w.light;
}
// Move the effects on and get them ready to draw (seen from the camera, in the world's wind)
function updateEffects(w, light, dt) {
  w.fx.setViewer(w.camera.position.toArray());
  w.fx.setWind(w.track.wind ?? null);
  w.fx.update(dt);
  w.fxDraw.update(light, dt);
}
// The lit road ahead of your car at night: two headlights (lamps: the model's front lights, if it says
// where they are)
function addHeadlights(vis) {
  const boxes = shared.damageBoxes, front = Object.entries(boxes).filter(([n, b]) => /light|lamp/i.test(n) && !/tail|rear/i.test(n) && (b.min[2] + b.max[2]) > 0);
  const at = front.length ? front.map(([, b]) => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]]) : [[0.6, 0.65, 2], [-0.6, 0.65, 2]];
  vis.headlights = at.slice(0, 2).map(p => {
    const l = new THREE.SpotLight(0xfff2dc, 0, 60, 0.5, 0.45, 1.2);
    l.position.fromArray(p);
    l.target.position.set(p[0], p[1] - 1.2, p[2] + 12);
    vis.group.add(l, l.target);
    return l;
  });
}

// ---------- Automated tests (physics/testSuite.js) in the test centre ----------

// Run tests (ids) in the test centre, switching to it if need be. watch: in real time (× speed) so you
// can follow the car; otherwise as fast as the frame allows (still drawn, in fast-forward).
async function runTests(ids, { watch = false, speed = 1 } = {}) {
  if (shared.tests) return;
  if (active?.file !== TEST_CENTRE) {
    if (hooks.switchTo) await hooks.switchTo(TEST_CENTRE); else await enter(TEST_CENTRE);
  }
  const w = worlds.get(TEST_CENTRE);
  if (!w || active !== w) return;
  shared.tests = { world: w, queue: [...ids], watch, speed, run: null, sim: null, clock: 0, lastPanel: 0, ctx: { RAPIER, settings: shared.settings, spec: shared.spec, sockets: shared.sockets, track: w.track, pace: shared.targets?.pace } };
}

// One frame of the running test: take its physics steps, record its telemetry, and hand back the two
// states to draw (null once every test is done)
function stepTests(T, seconds) {
  const dt = 1 / shared.settings.stepHz;
  if (T.stopped && T.run) { T.run = null; T.detach?.(); T.sim = null; }
  if (!T.run) {
    const id = T.queue.shift();
    if (!id) { finishTests(); return null; }
    T.run = createRun(T.ctx, id);
    T.acc = 0;
    T.clock = 0;
    shared.testTelemetry.clear();
    shared.testTelemetry.label = TESTS.find(t => t.id === id).name;
    shared.graphs.select('test');
  }
  const run = T.run;
  // the test starts a new simulation for each run (the slalom makes several): follow it
  const follow = () => {
    if (run.sim === T.sim || !run.sim) return;
    T.detach?.();
    T.sim = run.sim;
    shared.testTelemetry.lastVel = null;
    T.detach = T.sim.onStep(s => { T.clock += s.dt; shared.testTelemetry.record(s.vehicle, T.clock, s.dt); });
    T.prev = T.cur = T.sim.snapshot();
    T.world.rig.reset();
  };
  let steps = Infinity, n = 0;
  const t0 = performance.now();
  if (T.watch) { T.acc += seconds * T.speed; steps = Math.min(Math.floor(T.acc / dt), 64); T.acc -= steps * dt; }
  while (n < steps && !run.done) {
    follow();
    if (T.watch && n === steps - 1 && T.sim) T.prev = T.sim.snapshot();
    run.next(1);
    n++;
    if (!T.watch && performance.now() - t0 > 14) break;      // flat out, but keep the page drawing
  }
  follow();
  if (T.sim && n) { T.cur = T.sim.snapshot(); if (!T.watch) T.prev = T.cur; }
  const test = TESTS.find(t => t.id === run.id);
  T.status = `${test.name}${run.status ? ' · ' + run.status : ''}`;
  if (run.done) {
    const r = evaluate([run.result], shared.targets)[0];
    shared.results[run.id] = { last: r, prev: shared.results[run.id]?.last ?? null };
    try { localStorage.setItem(RESULTS, JSON.stringify(shared.results)); } catch { /* not kept */ }
    T.detach?.();
    T.run = null;
    T.sim = null;
  }
  if (performance.now() - T.lastPanel > 200 || run.done) {
    T.lastPanel = performance.now();
    shared.tuning.setTests({ results: shared.results, running: { name: test.name, status: run.status, progress: run.progress } });
  }
  return T.cur ? { previous: T.prev, current: T.cur, alpha: T.watch ? T.acc / dt : 1, stepsThisFrame: n } : null;
}

function finishTests() {
  const T = shared.tests;
  shared.tests = null;
  T.detach?.();
  T.world.rig.reset();
  shared.tuning.setTests({ results: shared.results, running: null });
}

// The car spec was edited in the tuning panel (path: what changed, null: all of it)
function retuned(path) {
  const s = shared, P = s.prefs, spec = s.spec, all = path === null;
  for (const w of worlds.values()) w.sim.retune();
  // the settings that the player also has in the settings panel (O) follow the spec
  if (all || path === 'brakes.bias') P.brakeBias = spec.brakes.bias;
  if (all || path === 'brakes.handbrake.disengageClutch') P.handbrakeClutch = spec.brakes.handbrake.disengageClutch;
  for (const [k, id] of [['abs', 'abs'], ['tractionControl', 'tc'], ['stability', 'esc'], ['countersteer', 'countersteer'], ['steering', 'steering'], ['drift', 'drift'], ['revProtection', 'revProtection']])
    if ((all || path === `assists.${k}.enabled`) && spec.assists[k]) P.aids[id] = spec.assists[k].enabled;
  if (all || path === 'assists.tractionControl.strength') P.aids.tcStrength = spec.assists.tractionControl.strength;
  if (all || path === 'gearbox.mode') { s.gearMode = spec.gearbox.mode; for (const w of worlds.values()) w.sim.vehicle.drivetrain.mode = s.gearMode; }
  saveSettings(P);
}

function updateDebug(w, s) {
  w.lines.visible = shared.debug;
  w.comMarker.visible = shared.debug;
  if (!shared.debug) return;
  w.comMarker.position.fromArray(shared.spec.centreOfMass);
  const pos = w.lines.geometry.attributes.position.array, col = w.lines.geometry.attributes.color.array;
  let n = 0;
  const line = (p, q, rgb) => { pos.set(p, n * 6); pos.set(q, n * 6 + 3); col.set(rgb, n * 6); col.set(rgb, n * 6 + 3); n++; };
  const along = (p, dir, len) => [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len];
  const { restLength } = shared.spec.suspension, radius = shared.spec.wheels.radius, down = s.up.map(v => -v);
  const q = new THREE.Quaternion(s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w);
  for (const wh of s.wheels) {
    if (!wh.origin) continue;
    line(wh.origin, along(wh.origin, down, restLength + radius), wh.grounded ? [0.2, 1, 0.3] : [1, 0.25, 0.2]); // ray
    if (!wh.grounded) continue;
    line(wh.contact, along(wh.contact, s.up, wh.load * FORCE_LINE_M_PER_N), [1, 0.6, 0.1]);                  // spring + damper
    const heading = new THREE.Vector3(Math.sin(wh.steerAngle), 0, Math.cos(wh.steerAngle)).applyQuaternion(q);
    line(wh.contact, along(wh.contact, heading.toArray(), 0.7), [0.9, 0.9, 0.9]);                            // where the wheel points
    // Tyre force arrow, green → yellow → red as the tyre runs out of grip
    const len = Math.hypot(...wh.force) * FORCE_LINE_M_PER_N;
    if (len < 0.02) continue;
    const g = wh.gripUsed, rgb = g < 0.7 ? [0.3, 1, 0.4] : g < 1 ? [1, 1 - (g - 0.7) / 0.3 * 0.7, 0.2] : [1, 0.2, 0.2];
    const dir = wh.force.map(v => v / (len / FORCE_LINE_M_PER_N)), tip = along(wh.contact, dir, len);
    const side = new THREE.Vector3(...dir).cross(new THREE.Vector3(...s.up)).normalize().toArray(), head = Math.min(0.25, len * 0.35);
    line(wh.contact, tip, rgb);
    line(tip, along(along(tip, dir, -head), side, head * 0.5), rgb);
    line(tip, along(along(tip, dir, -head), side, -head * 0.5), rgb);
  }
  // aero: drag (orange) at the centre of mass, lift (red, up) / downforce (blue, down) at the front,
  // rear and any parts (purple)
  for (const ar of s.aero.arrows) {
    const len = Math.hypot(...ar.force) * AERO_LINE_M_PER_N;
    if (len < 0.03) continue;
    const dir = ar.force.map(v => v * AERO_LINE_M_PER_N / len), tip = along(ar.point, dir, len);
    const up = ar.kind !== 'drag' && dot3(ar.force, s.up) > 0;
    const rgb = ar.kind === 'drag' ? [1, 0.55, 0.1] : ar.kind === 'part' ? [0.75, 0.4, 1] : up ? [1, 0.3, 0.3] : [0.3, 0.6, 1];
    const side = new THREE.Vector3(...dir).cross(new THREE.Vector3(...(ar.kind === 'drag' ? s.up : [1, 0, 0]))).normalize().toArray(), head = Math.min(0.3, len * 0.3);
    line(ar.point, tip, rgb);
    line(tip, along(along(tip, dir, -head), side, head * 0.5), rgb);
    line(tip, along(along(tip, dir, -head), side, -head * 0.5), rgb);
  }
  w.lines.geometry.setDrawRange(0, n * 2);
  w.lines.geometry.attributes.position.needsUpdate = true;
  w.lines.geometry.attributes.color.needsUpdate = true;
}

// ---------- Crashes (physics/impacts.js, garage/damage.js) ----------

// What the cars hit this frame: your car's damage (session.crash writes it to the car, and the drawing
// follows through onLook), the sound, the camera's jolt, and a marker in the damage view; an AI car's
// its own (garage/carDamage.js) — a hit between two cars damages both, by the session's collisions — and
// a big one of yours is replayed. now: the frame's time (ms)
function crashEvents(w, v, now) {
  const s = shared, impacts = v.sensor.take(), mode = s.prefs.damage ?? 'full', rules = s.session.db.damage;
  // (the AI cars' own hits: their damage, their sparks, bits and dust — each car's drawing given its
  // dents once a frame, however many hits)
  const looks = new Set();
  for (const c of w.sim.cars) for (const impact of c.vehicle.sensor.take()) {
    const cd = w.aiDamage.get(c.id), scale = s.play.scale(impact), r = cd && mode !== 'off' && scale > 0 ? cd.hit(impact, { scale }).result : null;
    if (r && (r.dents.length || r.broken.length)) looks.add(c.id);
    w.fx.play(w.fx.impactEvent(c.id, impact, r, groundUnder(c.vehicle)));
  }
  for (const id of looks) w.others.get(id)?.setDamage(w.aiDamage.get(id).view3d, rules);
  if (!impacts.length) return;
  const C = rules.classes;
  for (const impact of impacts) {
    const brokenBefore = new Set(s.session.damage.shell?.broken ?? []), before = s.session.damage;
    const { result, saved } = s.session.crash(impact, { mode, boxes: s.damageBoxes, scale: s.play.scale(impact) });
    // a big crash: replayed (after a moment, to see what happened next) — from your car's place then
    const R = s.session.db.sessions.replay;
    if (s.play.replay && !s.tests && !s.replay && !s.replayDue && result.strength >= R.threshold && now - (s.lastReplay ?? -Infinity) > R.cooldown * 1000) {
      const p = v.body.translation();
      s.replayDue = { at: now + R.wait * 1000, time: w.sim.time, focus: [p.x, p.y, p.z], before };
      s.lastReplay = now;
    }
    // the first damage, a part hanging off, something bent: a hint, once ever
    for (const e of hintEvents(result, mode)) hint(e);
    saved.then(() => { if (!drivability(s.session.garage.car, ownedBySocket(s.session.db, s.session.player.profile, s.session.player.profile.currentCar), rules).ok) hint('undrivable'); });
    const [lo, hi] = result.class === 'tap' ? [C.tap, C.crunch] : result.class === 'crunch' ? [C.crunch, C.crash] : [C.crash, C.crash * 2.2];
    s.audio?.crash.impact(result.class, impact.material, (result.strength - lo) / (hi - lo));
    for (const b of result.broken) if (!brokenBefore.has(b)) { if (/glass/.test(b)) s.audio?.crash.glass(); else s.audio?.crash.light(); }
    // the effects: sparks off metal, bits of what was hit, dust on loose ground, glass shards
    w.fx.play(w.fx.impactEvent(0, impact, result, groundUnder(v)));
    for (const e of w.fx.breakEvents(0, result.broken, brokenBefore, s.damageBoxes)) w.fx.play(e);
    w.rig.shake(result.class === 'tap' ? 0.05 : Math.min(1, result.strength / 14));
    s.lastCrash = { ...result, at: performance.now() };
    impactMarker(w, result);
    saved.then(r => { if (r && !r.ok) console.warn(`The crash damage wasn't saved: ${r.error}`); });
  }
}
// (the surface under a car: its first wheel on the ground's)
function groundUnder(v) { return v.wheels.find(x => x.grounded && x.surface)?.surface?.name ?? null; }
// every fitted part's condition, and the body shell's (for the damage view)
function conditionsNow() {
  const sn = shared.session, parts = sn.garage.state.parts, sockets = {};
  for (const [socket, id] of Object.entries(sn.garage.build.sockets)) if (id) sockets[socket] = parts[id]?.condition ?? 100;
  return { shell: sn.damage.shell?.condition ?? 100, sockets };
}
// the damage view (U): parts coloured by condition, the hits marked
function setDamageView(on) {
  const s = shared;
  s.damageView = on;
  for (const v of s.visuals) if (!v.fixedPaint) v.showCondition(on ? conditionsNow() : null);
  for (const w of worlds.values()) for (const m of w.markers ?? []) m.visible = on;
}
// A marker where a hit landed (on the car, car frame): a ball coloured by how hard, and its strength;
// the last dozen, each for half a minute
function impactMarker(w, r) {
  const colour = { tap: '#5ec8ff', crunch: '#ffcc33', crash: '#ff4d3d' }[r.class], g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.04 + Math.min(0.1, r.strength / 150), 12, 8), new THREE.MeshBasicMaterial({ color: colour, depthTest: false })));
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  canvas.width = 512; canvas.height = 64;
  ctx.font = '600 30px system-ui, sans-serif';
  const text = `${r.strength.toFixed(1)} m/s ${r.class} · ${r.hit?.name ?? ''}`, width = Math.min(512, ctx.measureText(text).width + 20);
  ctx.fillStyle = 'rgba(12,16,22,0.8)'; ctx.fillRect(0, 10, width, 44); ctx.fillStyle = colour; ctx.fillText(text, 10, 43);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  label.center.set(0, 0.5); label.scale.set(0.8, 0.1, 1); label.position.set(0.08, 0.1, 0);
  g.add(label);
  g.traverse(o => { o.renderOrder = 999; });
  g.position.fromArray(r.point);
  g.visible = shared.damageView;
  w.carVis.group.add(g);
  (w.markers ??= []).push(g);
  const drop = m => { m.removeFromParent(); m.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); w.markers = w.markers.filter(x => x !== m); };
  while (w.markers.length > 12) drop(w.markers[0]);
  setTimeout(() => { if (w.markers.includes(g)) drop(g); }, 30000);
}
// The crash test: into the test centre's wall, metal barrier or along the guardrail at kmh (scenes/
// test_centre.json tests.crash; physics/crashTest.js): the car put down just short of it, going at that
// speed, coasting in — front first, reversing in (rear) or sliding in side-on (side), angleDeg off square
async function crashTest(kmh = 60, target = 'wall', side = 'front', angleDeg = 0) {
  if (shared.tests) return;
  if (active?.file !== TEST_CENTRE) { if (hooks.switchTo) await hooks.switchTo(TEST_CENTRE); else await enter(TEST_CENTRE); }
  const w = worlds.get(TEST_CENTRE);
  if (!w?.track.tests.crash?.[target]) { console.warn(`No crash test target "${target}": wall, barrier or guardrail.`); return; }
  shared.session.attach.reattachAll('crash test');
  placeForCrash(w.sim, kmh, target, { side, angleDeg });
  w.rig.reset();
  shared.flash.show(`Crash test: ${kmh} km/h`, 'warn', 1.2, target === 'guardrail' ? 'along the guardrail (steer right to keep it on)' : `${{ front: 'front first', rear: 'reversing', side: 'side-on' }[side] ?? side}${angleDeg ? ` at ${angleDeg}°` : ''} into the ${target === 'wall' ? 'concrete wall' : 'metal barrier'}`);
}

// ---------- Loose and torn-off parts (garage/detach.js, physics/looseParts.js) ----------

// The physics and the drawing follow the session's states (loose, torn off, back on); a part that pulls
// too hard on its fixings tears off; bits on the road clatter
function partsEvents(w, v) {
  const s = shared, mode = s.prefs.damage ?? 'full';
  for (const e of v.parts.take()) s.session.attach.set(e.socket, 'detached', { mode, reason: `pulled off (${Math.round(e.load)} N)` });
  syncLoose(w, v);
  for (const e of w.sim.debris.take()) s.audio?.crash.clatter(e.strength);
}
function syncLoose(w, v) {
  const s = shared, sn = s.session, states = sn.attach.states, car = sn.garage.car, pieces = (w.pieces ??= new Map());   // socket → { id, object }
  // (every part something has off the car: the session, the physics, the pieces, the drawing)
  const wheels = new Map(CORNERS.map(k => [car.model.sockets[k], k]));
  for (const socket of new Set([...Object.keys(states), ...v.parts.parts.keys(), ...pieces.keys(), ...w.carVis.offCar.keys()])) {
    if (wheels.has(socket)) continue;                          // (wheels: below)
    const want = states[socket]?.state ?? 'attached', have = pieces.has(socket) ? 'detached' : v.parts.has(socket) ? 'loose' : 'attached';
    if (want === 'attached') {
      if (have !== 'attached' || w.carVis.partState(socket) !== 'attached') { v.parts.reattach(socket); pieces.get(socket)?.object?.removeFromParent(); pieces.delete(socket); w.carVis.reattachPart(socket); }
      continue;
    }
    if (want === have) continue;
    const id = sn.garage.build.sockets[socket], part = id && sn.db.parts[sn.garage.state.parts[id]?.partId], sdef = car.sockets.find(x => x.name === socket);
    if (!part || !sdef) continue;
    const def = bodyDef(part, sdef, sn.db.parts, Math.random, car.id);
    if (want === 'loose') { if (v.parts.loosen(socket, def)) w.carVis.loosenPart(socket); continue; }
    const pieceId = v.parts.detach(socket, def, w.sim.time, socket), object = w.carVis.detachPart(socket);
    if (object) {
      // (where it was on the car, drawn, until the next snapshot has its body)
      object.matrixAutoUpdate = false; w.scene.add(object);
      w.carVis.group.updateMatrixWorld(true);
      w.carVis.pieceMatrix(socket, w.carVis.group.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(...sdef.position)), object.matrix);
    }
    pieces.set(socket, { id: pieceId, object });
    s.audio?.crash.tear();
    w.fx.play({ type: 'partOff', car: 0, socket, point: sdef.position });
  }
  // wheels torn off (garage/mechanical.js): the wheel's pivot off the car, a rolling cylinder in the world
  for (const [socket, k] of wheels) {
    const want = states[socket]?.state === 'detached', piece = pieces.get(socket);
    if (!want) {
      if (piece || w.carVis.wheelOff(k)) { v.parts.reattach(socket); piece?.object?.removeFromParent(); pieces.delete(socket); w.carVis.reattachWheel(k); }
      continue;
    }
    if (piece) continue;
    const wh = v.wheels.find(x => x.name === k), centre = [wh.socket[0], wh.socket[1] - wh.length, wh.socket[2]];
    const here = car.sockets.filter(x => (x.node ?? x.name) === socket).map(x => sn.db.parts[sn.garage.state.parts[sn.garage.build.sockets[x.name]]?.partId]).filter(Boolean);
    const id = v.parts.detach(socket, wheelDef(here, { centre, radius: wh.radius ?? s.spec.wheels.radius, spin: wh.omega }), w.sim.time, socket), off = w.carVis.detachWheel(k);
    if (off) { w.scene.add(off.object); off.object.matrix.copy(w.carVis.group.matrixWorld).multiply(off.inCar); }
    pieces.set(socket, { id, object: off?.object ?? null, offset: off ? new THREE.Matrix4().makeTranslation(-centre[0], -centre[1], -centre[2]).multiply(off.inCar) : null });
    s.audio?.crash.tear();
    w.fx.play({ type: 'partOff', car: 0, socket, point: centre });
    s.flash.news({ type: 'wheelOff', wheel: k });
  }
}
// where the loose parts hang and the torn-off pieces lie now
const poseMatrix = (p, q) => new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(q.x, q.y, q.z, q.w), new THREE.Vector3(1, 1, 1));
function drawParts(w, b) {
  if (b.looseParts?.length) {
    const inv = poseMatrix(b.position, b.rotation).invert();
    for (const p of b.looseParts) w.carVis.setPartPose(p.socket, inv.clone().multiply(poseMatrix(p.position, p.rotation)));
  }
  if (!w.pieces?.size) return;
  const byId = new Map((b.debris ?? []).map(d => [d.id, d])), alive = new Set(w.sim.debris.pieces.map(p => p.id));
  for (const [socket, piece] of w.pieces) {
    if (!alive.has(piece.id)) { piece.object?.removeFromParent(); continue; }     // (cleared away: too old, too far, too many)
    const d = byId.get(piece.id);
    if (!d) continue;                                                              // (torn off since this snapshot)
    if (piece.object && piece.offset) { piece.object.matrix.multiplyMatrices(poseMatrix(d.position, d.rotation), piece.offset); piece.object.matrixWorldNeedsUpdate = true; }   // (a wheel)
    else if (piece.object) { w.carVis.pieceMatrix(socket, poseMatrix(d.position, d.rotation), piece.object.matrix); piece.object.matrixWorldNeedsUpdate = true; }
  }
}
// how far up a loose bonnet is (0 shut … 1 up: it blocks the bonnet and cockpit cameras)
function bonnetUp(b) {
  const p = b.looseParts?.find(x => x.socket === 'socket_bonnet');
  if (!p) return 0;
  const q = new THREE.Quaternion(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w).invert().multiply(new THREE.Quaternion(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w));
  return Math.min(1, 2 * Math.acos(Math.min(1, Math.abs(q.w))) / 1.0);
}
// which sockets a debug command means: a socket (socket_bonnet or bonnet) or a part fitted (its id)
function socketsFor(which) {
  const sn = shared.session, names = sn.garage.car.sockets.map(s => s.name);
  if (names.includes(which)) return [which];
  if (names.includes(`socket_${which}`)) return [`socket_${which}`];
  return Object.entries(sn.garage.build.sockets).filter(([, id]) => id && sn.garage.state.parts[id]?.partId === which).map(([s]) => s);
}

// ---------- Mechanical damage (garage/mechanical.js, physics/mechanical.js) ----------

// What the physics said this frame (your car only): a kerb strike or heavy landing damages its corner;
// warnings (overheating, limp mode, a flat tyre…); and every saveEvery seconds what's changed while
// driving (tyre pressures, coolant, clutch wear) is written back to the parts
function mechanicalEvents(w, v, dt) {
  const s = shared, sn = s.session, mode = s.prefs.damage ?? 'full', M = v.mechanical;
  for (const c of w.sim.cars) c.vehicle.mechanical.take();        // (the AI cars': not yours)
  for (const e of M.take()) {
    if (e.type === 'strike') {
      const r = sn.mechanical.strike(e.wheel, e.strength, { mode, kind: e.kind });
      s.lastStrike = { ...e, effects: r.effects, at: performance.now() };
      s.input.pulse(Math.min(1, 0.3 + e.strength / 12), 0.2);
      if (e.strength > 2) { w.rig.shake(Math.min(0.5, e.strength / 25)); s.audio?.crash.impact(e.strength > 8 ? 'crunch' : 'tap', 'metal', Math.min(1, e.strength / 10)); }
      r.saved.then(x => { if (x && !x.ok) console.warn(`The ${e.kind} damage wasn't saved: ${x.error}`); });
      continue;
    }
    s.flash.news(e);
  }
  s.mechSave += dt;
  if (s.mechSave >= sn.db.damage.mechanical.saveEvery) {
    s.mechSave = 0;
    const live = M.changes();
    if (live) sn.mechanical.writeBack(live).then(x => { if (x && !x.ok) console.warn(`What's changed while driving wasn't saved: ${x.error}`); });
  }
}
// (the exhaust loose or torn off: it's all holes, for the sound)
function exhaustOff() { const st = shared.session.attach.stateOf('socket_exhaust'); return st === 'detached' ? 1 : st === 'loose' ? 0.5 : 0; }
// the dashboard's gauge and lamps, and the damage report when it's open
function updateDash(b) {
  const s = shared, rows = s.session.mechanical.report(b.mechanical);
  s.dash.update(b, rows, s.spec.damage?.rules.cooling, 0.1);
  s.report.update(rows, b, s.prefs.damage ?? 'full', s.spec.steering.ratio);
}

// ---------- The engine's health (physics/engineHealth.js) ----------

// What the drivetrain said this frame (your car only): warnings, the bang and smoke of a blown engine,
// and the damage written to the player's engine when an over-rev is over
function engineEvents(w, v) {
  const s = shared, events = v.drivetrain.events;
  if (!events.length) return;
  for (const e of events.splice(0)) {
    if (e.type === 'grind') { s.audio?.grind(e.strength); s.input.pulse(0.5 + 0.5 * e.strength, 0.3); continue; }
    s.flash.news(e);
    // (a money shift: its toll on the gearbox, with full damage)
    if (e.type === 'overRevShift') s.session.mechanical.gearboxWear(e.over * s.session.db.damage.mechanical.effects.gearbox.overRevShift, { mode: s.prefs.damage ?? 'full' });
    if (e.type === 'bent') s.audio?.clunk?.(1);
    if (e.type === 'blown') { s.audio?.bang?.(); w.fx.play({ type: 'engineBlow', car: 0 }); }
    if (e.type === 'incident') s.session.wearEngine(e.condition, causeOf(e)).then(r => { if (!r.ok) console.warn(`The engine damage wasn't saved: ${r.errors.join(' ')}`); });
  }
}
// (the HUD's line on it)
function healthText(h) {
  const c = Math.round(h.condition);
  if (h.blown) return 'engine <b class="off">BLOWN</b> (repair it in the garage)';
  return `engine condition <b class="${c < 70 ? 'off' : ''}">${c}%</b>${h.misfire > 0 ? ` · <b class="off">misfiring</b> (${Math.round(h.misfire * 100)}% of firings)` : ''}${h.floating ? ' · <b class="off">VALVE FLOAT</b>' : ''}`;
}

function updateHud(w, s, steps, sim) {
  const deg = r => r * 180 / Math.PI, signed = (x, d) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
  const rows = s.wheels.map(wh => {
    const pct = Math.round(wh.gripUsed * 100), sliding = wh.grounded && wh.combinedSlip > 1;
    const colour = wh.gripUsed < 0.7 ? '#4d6' : wh.gripUsed < 1 ? '#fc3' : '#f54';
    return `<tr><td>${wh.grounded ? '<span class="on">●</span>' : '<span class="off">○</span>'} ${wh.name}</td>` +
      `<td>${(wh.compression * 1000).toFixed(0)} mm</td><td>${(wh.load / 1000).toFixed(1)} kN</td>` +
      `<td>${signed(wh.slipRatio, 2)}</td><td>${signed(deg(wh.slipAngle), 1)}°</td>` +
      `<td><div class="bar"><div style="width:${pct}%;background:${colour}"></div></div></td>` +
      `<td>${sliding ? '<b class="off">slide</b>' : pct + '%'}</td>` +
      `<td>${wh.brake.pressureBar.toFixed(0)}</td><td style="color:${wh.brake.temp > 450 ? '#f54' : wh.brake.temp > 250 ? '#fc3' : 'inherit'}">${wh.brake.temp.toFixed(0)}°</td><td>${wh.brake.absActive ? '<b class="abs">ABS</b>' : ''}</td></tr>`;
  }).join('');
  const run = shared.tests?.world === w ? shared.tests : null;
  const testBanner = run ? `<div class="test">TEST <b>${run.status ?? ''}</b> ${run.watch ? `· watching at ${run.speed}×` : '· fast-forward'} · <kbd>Esc</kbd> stop</div>` : '';
  const parked = s.held && Math.abs(s.speed) < 0.5 ? ' <span class="hold">HOLD</span>' : '';
  // (the speedometer reads the wheels, at their actual size; a car missing a part it needs says why it won't go)
  const kmh = Math.round(Math.abs(s.speedometer ?? s.speed) * 3.6);
  const stuck = s.immobilized ? `<div class="test">CAN'T DRIVE · ${s.immobilized.join(' · ')}</div>` : '';
  const e = s.engine, T = s.timer, pct = x => Math.round(x * 100) + '%', radius = shared.spec.wheels.radius;
  const driven = s.wheels.filter(wh => wh.driven);
  shared.hud.classList.toggle('compact', shared.compact);
  if (shared.compact) {
    shared.info.innerHTML = `
      <div class="world">${w.name}</div>${testBanner}${stuck}
      <div class="big">${kmh} <small>km/h</small>${parked}</div>
      <div class="engine">gear <b>${e.gear}</b> · <b>${Math.round(e.rpm)}</b> rpm${e.fuelCut ? ' <b class="off">LIMITER</b>' : ''}${e.health.blown ? ' <b class="off">ENGINE BLOWN</b>' : e.health.floating ? ' <b class="off">VALVE FLOAT</b>' : ''} ·
        <span class="lamp${s.assists ? ' on' : ''}">AIDS ${s.assists ? 'ON' : 'OFF'}</span> <span class="lamp${s.absActive ? ' lit' : ''}">ABS</span> <span class="lamp${s.tcActive ? ' lit' : ''}">TC</span> <span class="lamp${s.escActive ? ' lit' : ''}" title="${s.escMode || ''}">ESC</span></div>
      ${s.lap ? `<div class="timer stage">${w.track.roads.find(r => r.startLine)?.style === 'gravel' ? 'Stage' : 'Lap'} <b>${s.lap.running ? clock(s.lap.t) : '–'}</b>${s.lap.running ? ` <span class="timing">${Math.round(s.lap.progress * 100)}%</span>` : ''} · best <b>${s.lap.best != null ? clock(s.lap.best) : '–'}</b></div>` : ''}
      ${s.aero.slipstream > 0.05 || s.aero.parts.length ? `<div class="engine">${s.aero.parts.length ? 'spoiler on · ' : ''}${s.aero.slipstream > 0.05 ? `<b>slipstream ${Math.round(s.aero.slipstream * 100)}%</b>` : ''}</div>` : ''}
      <div class="engine">${shared.play.name}${shared.play.collisions !== 'full' ? ` · cars: ${shared.play.collisions === 'off' ? 'ghosting' : 'reduced damage'}` : ''}</div>
      <div class="keys"><kbd>H</kbd> full HUD · <kbd>R</kbd> back on the road · <kbd>⌫</kbd><kbd>⌫</kbd> tow to the garage · <kbd>C</kbd> camera: ${CAMERAS[shared.camMode]} · <kbd>O</kbd> settings · <kbd>P</kbd> tuning · <kbd>L</kbd> telemetry · <kbd>T</kbd> next world</div>`;
    return;
  }
  const pf = sim.perf, B = pf.budget, perFrame = pf.stepMs * shared.settings.stepHz / 60, room = B ? Math.floor(B.frameMs / (shared.settings.stepHz / 60) / Math.max(pf.perCarMs, 1e-3)) : null;
  const over = B && (perFrame > B.frameMs || pf.perCarMs > B.carStepMs);
  shared.info.innerHTML = `
    <div class="world">${w.name}</div>${testBanner}${stuck}
    <div class="big">${kmh} <small>km/h</small>${parked}</div>
    <div class="engine">
      gear <b>${e.gear}</b> ${e.mode === 'auto' ? 'automatic' : 'sequential'}${e.shifting ? ' · shifting' : ''} · <b>${Math.round(e.rpm)}</b> rpm${e.fuelCut ? ' <b class="off">LIMITER</b>' : ''}<br>
      throttle ${pct(e.throttle)} · clutch ${pct(e.clutch)} ${e.gear === 'N' || e.clutch === 0 ? 'open' : e.clutchLocked ? 'locked' : `slipping ${Math.round(Math.abs(e.clutchSlipRpm))} rpm`} · ${layoutText(e)}<br>
      engine <b>${e.torque.toFixed(0)}</b> N·m · <b>${e.powerKw.toFixed(0)}</b> kW (${(e.powerKw * 1.341).toFixed(0)} hp) · driven wheels ${driven.map(wh => `${wh.name} ${(wh.omega * radius * 3.6).toFixed(0)}`).join(' / ')} km/h${Math.abs(s.steering.torqueSteer ?? 0) > 0.001 ? ` · torque steer <b>${(s.steering.torqueSteer * 180 / Math.PI).toFixed(1)}°</b>` : ''}<br>
      ${healthText(e.health)} · rev protection ${s.aids.revProtection ? 'on' : 'off'}
    </div>
    ${s.lap ? `<div class="timer stage">${w.track.roads.find(r => r.startLine)?.style === 'gravel' ? 'Stage' : 'Lap'} <b>${s.lap.running ? clock(s.lap.t) : '–'}</b>${s.lap.running ? ` <span class="timing">${Math.round(s.lap.progress * 100)}%</span>` : ' · cross the start line'} · last <b>${s.lap.last != null ? clock(s.lap.last) : '–'}</b> · best <b>${s.lap.best != null ? clock(s.lap.best) : '–'}</b></div>` : ''}
    <div class="timer">0–100 <b>${T.t100 ? T.t100.toFixed(2) + ' s' : '–'}</b> · ¼ mile <b>${T.quarter ? `${T.quarter.toFixed(2)} s @ ${(T.quarterSpeed * 3.6).toFixed(0)} km/h` : '–'}</b> · top <b>${(T.top * 3.6).toFixed(0)} km/h</b> · 100–0 <b>${T.stopping != null ? T.stopping.toFixed(1) + ' m…' : T.stopDistance != null ? T.stopDistance.toFixed(1) + ' m' : '–'}</b>${T.running ? ' <span class="timing">timing</span>' : ''}</div>
    <div class="sub"><span class="lamp${s.assists ? ' on' : ''}">AIDS ${s.assists ? 'ON' : 'OFF'}</span> <span class="lamp${s.absActive ? ' lit' : ''}">ABS</span> <span class="lamp${s.tcActive ? ' lit' : ''}">TC</span> <span class="lamp${s.escActive ? ' lit' : ''}" title="${s.escMode || ''}">ESC</span>
      throttle ${Math.round(s.throttle * 100)}% · brake ${Math.round(s.brake * 100)}% · bias ${Math.round(s.brakeBias * 100)}% front · input <b>${shared.lastInput?.device ?? 'keyboard'}</b></div>
    <div class="sub">steering wheel <b>${signed(deg(s.steering.wheelAngle), 0)}°</b> → front wheels ${signed(deg(s.steering.roadAngle), 1)}° · self-aligning <b>${s.steering.sat.toFixed(0)}</b> N·m <span class="ffb"><span style="left:${50 + 50 * Math.min(0, s.steering.ffb)}%;width:${50 * Math.abs(s.steering.ffb)}%"></span></span>
      · yaw <b>${signed(deg(s.yawRate), 0)}</b>°/s (expected ${signed(deg(s.yawExpected), 0)})</div>
    <div class="sub">aero: front <b>${liftText(s.aero.frontLift)}</b> · rear <b>${liftText(s.aero.rearLift)}</b> · drag <b>${s.aero.drag.toFixed(0)}</b> N · ${s.aero.mixed ? (s.aero.frontLift > 0 ? 'front lifts, rear pressed down' : 'front pressed down, rear lifts') : `balance ${Math.round(s.aero.balance * 100)}% front`}
      · air <b>${s.aero.density.toFixed(3)}</b> kg/m³ at ${Math.round(s.aero.altitude)} m · slipstream <b>${Math.round(s.aero.slipstream * 100)}%</b> · spoiler ${s.aero.parts.find(p => p.slot === 'spoiler') ? `on, ${s.aero.parts.find(p => p.slot === 'spoiler').angle}°` : 'off'}</div>
    <div class="sub">session <b>${shared.play.describe()}</b>${shared.play.replay ? ' · crash replays on' : ''}${shared.dents.pending ? ` · denting ${shared.dents.pending} mesh${shared.dents.pending > 1 ? 'es' : ''}` : ''}</div>
    ${crashLine()}
    ${garageLine()}
    <div class="sub">physics ${shared.settings.stepHz} Hz, ${steps} step${steps === 1 ? '' : 's'} this frame · ${Math.round(shared.fps)} fps ·
      <span class="${over ? 'off' : ''}">cost <b>${pf.stepMs.toFixed(3)}</b> ms a step (car ${pf.vehicleMs.toFixed(3)}, Rapier ${pf.worldMs.toFixed(3)}${pf.cars > 1 ? `, ${pf.cars - 1} other car${pf.cars > 2 ? 's' : ''} ${pf.carsMs.toFixed(3)}` : ''}, slowest ${pf.peakMs.toFixed(2)})
      = ${perFrame.toFixed(2)} ms a frame at 60 fps${B ? ` of a ${B.frameMs} ms budget · room for about ${room} cars` : ''}</span></div>
    <table><tr><th>wheel</th><th>susp</th><th>load</th><th>slip ratio</th><th>slip angle</th><th colspan="2">grip used</th><th>brake bar</th><th>disc</th><th></th></tr>${rows}</table>
    <div class="keys"><kbd>W</kbd><kbd>S</kbd> throttle / brake-reverse (hold <kbd>Shift</kbd> for half) · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> handbrake ·
    <kbd>Z</kbd> gearbox ${shared.gearMode === 'auto' ? 'auto' : 'manual'} · <kbd>V</kbd> 2H / 4H / 4L · <kbd>[</kbd><kbd>]</kbd><kbd>\\</kbd> diff locks · <kbd>;</kbd> roof · <kbd>Q</kbd><kbd>E</kbd> shift down / up · <kbd>F</kbd> clutch ·
    <kbd>R</kbd> back on the road (<kbd>Shift</kbd>: to the start) · ${shared.play.restore ? '<kbd>B</kbd> reset car (development: repaired) · ' : ''}<kbd>⌫</kbd><kbd>⌫</kbd> tow to the garage · <kbd>U</kbd> damage view ${shared.damageView ? 'on' : 'off'} · <kbd>I</kbd> damage report · <kbd>G</kbd> debug lines ${shared.debug ? 'on' : 'off'} · <kbd>C</kbd> camera: ${CAMERAS[shared.camMode]} · <kbd>P</kbd> tuning &amp; tests · <kbd>L</kbd> telemetry · <kbd>M</kbd> sound ${shared.muted ? 'off' : 'on'} · <kbd>X</kbd> all aids ${s.assists ? 'on' : 'off'} · <kbd>O</kbd> settings &amp; controls · <kbd>K</kbd> spoiler · <kbd>N</kbd> sockets · <kbd>J</kbd> AI car ahead · <kbd>Y</kbd> dyno · <kbd>H</kbd> small HUD · <kbd>T</kbd> next world · gamepads and wheels work too</div>
    ${shared.debug ? '<div class="legend"><span style="color:#f93">drag</span> <span style="color:#f55">lift</span> <span style="color:#59f">downforce</span> <span style="color:#b6f">spoiler</span> · <span style="color:#3f5">ray (grounded)</span> <span style="color:#f43">ray (in air)</span> <span style="color:#f91">spring</span> <span style="color:#ddd">wheel heading</span> tyre force: <span style="color:#4f6">grip</span> <span style="color:#fd3">near limit</span> <span style="color:#f44">sliding</span></div>' : ''}`;
}

// Skid marks: dark see-through strips laid behind sliding tyres. A fixed-size ring buffer, so the
// oldest marks are reused once it fills up.
// Tyres: a squeal on tarmac, louder the faster they slide (and the more weight is on them); on loose
// surfaces a gravel crunch that grows with speed and sliding instead
function updateSqueal(s) {
  const w = active;
  let squeal = 0, crunch = 0, fastest = 0;
  const speed = Math.abs(s.speed);
  for (const wh of s.wheels) {
    if (!wh.grounded) continue;
    const weight = Math.min(1, wh.load / 3000);
    if (w?.surfaces[wh.surface]?.sound === 'gravel') crunch = Math.max(crunch, Math.min(1, smoothstep(0.5, 25, speed) * 0.7 + smoothstep(1, 8, wh.slipSpeed) * 0.6) * weight);
    else { squeal = Math.max(squeal, smoothstep(SKID_FROM, SKID_FULL, wh.slipSpeed) * weight); fastest = Math.max(fastest, wh.slipSpeed); }
  }
  shared.audio.squeal.set(squeal, Math.min(1, fastest / 15));
  shared.audio.gravel.set(crunch, speed);
}

// ---------- World pieces ----------

// Ground slabs: a 1 m / 10 m grid in the flat lab (easy to read motion), plain grass round terrain
function groundMaterial(s, grid) {
  if (!grid) return new THREE.MeshLambertMaterial({ color: s.colour });
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = s.colour; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
  for (let i = 0; i <= 10; i++) { g.beginPath(); g.moveTo(i * 25.6, 0); g.lineTo(i * 25.6, 256); g.moveTo(0, i * 25.6); g.lineTo(256, i * 25.6); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(s.halfExtents[0] * 2 / 10, s.halfExtents[2] * 2 / 10);
  t.anisotropy = shared.renderer.capabilities.getMaxAnisotropy();
  return new THREE.MeshLambertMaterial({ map: t });
}

// Terrain: one vertex per grid point, split into triangles exactly like the physics heightfield
function terrainMesh(t, colour, rockColour) {
  const V = t.n + 1, pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3);
  const base = new THREE.Color(colour), high = new THREE.Color('#8fa866'), low = new THREE.Color('#5a7447'), c = new THREE.Color();
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let col_ = 0; col_ < V; col_++)
    for (let row = 0; row < V; row++) {
      const i = row * V + col_, h = t.at(col_, row);
      pos[i * 3] = -t.half + col_ * t.cell; pos[i * 3 + 1] = h; pos[i * 3 + 2] = -t.half + row * t.cell;
      c.copy(base).lerp(h > 0 ? high : low, Math.min(1, Math.abs(h) / 12)).multiplyScalar(0.94 + rnd() * 0.12);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
  const idx = [];
  for (let row = 0; row < t.n; row++)
    for (let c0 = 0; c0 < t.n; c0++) {
      const i00 = row * V + c0, i10 = i00 + 1, i01 = i00 + V, i11 = i01 + 1;
      idx.push(i00, i01, i10, i10, i01, i11); // diagonal from (-x,+z) to (+x,-z), facing up
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (rockColour) {   // steep banks and cuttings show bare rock / earth
    const rock = new THREE.Color(rockColour), n = geo.attributes.normal;
    for (let i = 0; i < V * V; i++) {
      const k = smoothstep(0.12, 0.3, 1 - n.getY(i));
      if (k > 0) { c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]).lerp(rock, k); col.set([c.r, c.g, c.b], i * 3); }
    }
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// Asphalt road following the terrain, with edge lines, centre dashes, corner kerbs and a start line
function roadMesh(road, heightAt) {
  const line = roadCenterline(road, 2), half = road.width / 2, m = line.length, gravel = road.style === 'gravel';
  const pos = [], col = [];
  const asphalt = new THREE.Color(gravel ? '#a08a67' : '#3c3e42'), white = new THREE.Color('#f2f2ee'), red = new THREE.Color('#c8302a');
  const rut = new THREE.Color('#86704f'), verge = new THREE.Color('#b3a07c');
  const at = (p, off, lift) => { const x = p.x - p.tz * off, z = p.z + p.tx * off; return [x, heightAt(x, z) + lift, z]; };
  const strip = (i, j, o1, o2, lift, c) => {
    const a = line[i], b = line[j], q = [at(a, o1, lift), at(a, o2, lift), at(b, o2, lift), at(b, o1, lift)];
    for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(...q[k]); col.push(c.r, c.g, c.b); }
  };
  const smooth = i => { let s = 0; for (let k = -3; k <= 3; k++) s += line[(i + k + m) % m].curvature; return s / 7; };
  const last = road.closed ? m : m - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % m;
    const shade = asphalt.clone().multiplyScalar(0.96 + ((i * 7919) % 10) / (gravel ? 60 : 125));
    strip(i, j, -half, half, 0.04, shade);                                   // surface
    if (gravel) {
      for (const s of [-1, 1]) {
        strip(i, j, s * 0.7, s * 1.5, 0.05, rut.clone().multiplyScalar(0.95 + ((i * 3571) % 7) / 60));   // wheel ruts
        strip(i, j, s * (half - 0.3), s * (half + 0.9), 0.045, verge);                                  // loose stones at the edges
      }
      continue;
    }
    for (const s of [-1, 1]) strip(i, j, s * (half - 0.45), s * (half - 0.25), 0.06, white); // edge lines
    if (Math.floor(i * 2 / 3) % 3 === 0) strip(i, j, -0.1, 0.1, 0.06, white); // centre dashes
    if (Math.abs(smooth(i)) > road.kerbCurvature) {                          // kerbs on the corners
      const c = Math.floor(i / 1) % 2 ? red : white;
      for (const s of [-1, 1]) strip(i, j, s * half, s * (half + 1.2), 0.07, c);
    }
  }
  if (road.startLine) {                                                       // chequered start line
    let best = 0, bd = Infinity;
    line.forEach((p, i) => { const d = Math.hypot(p.x - road.startLine[0], p.z - road.startLine[1]); if (d < bd) { bd = d; best = i; } });
    for (let r = 0; r < 2; r++)
      for (let c = -half; c < half; c += 1) strip((best + r) % m, (best + r + 1) % m, c, c + 1, 0.065, (Math.floor(c + half) + r) % 2 ? white : new THREE.Color('#1c1c1c'));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}

// A flat paved area (track.pads): a circle or a rectangle turned by headingDeg
function padMesh(p, heightAt) {
  const geo = p.radius ? new THREE.CircleGeometry(p.radius, 96) : new THREE.PlaneGeometry(p.halfExtents[0] * 2, p.halfExtents[1] * 2);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: p.colour || '#3c3e42' }));
  m.rotation.set(-Math.PI / 2, 0, (p.headingDeg || 0) * Math.PI / 180, 'YXZ');
  m.position.set(p.centre[0], heightAt(p.centre[0], p.centre[1]) + 0.02, p.centre[1]);
  m.receiveShadow = true;
  return m;
}

function skidpadMesh(p, heightAt) {
  const g = new THREE.Group(), y = heightAt(...p.centre) + 0.03;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(p.surfaceRadius, 96), new THREE.MeshLambertMaterial({ color: '#3c3e42' }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(p.ringRadius - 0.15, p.ringRadius + 0.15, 128), new THREE.MeshLambertMaterial({ color: '#f2f2ee' }));
  for (const m of [disc, ring]) { m.rotation.x = -Math.PI / 2; m.receiveShadow = true; g.add(m); }
  ring.position.y = 0.02;
  g.position.set(p.centre[0], y, p.centre[1]);
  return g;
}

// Low-poly trees; trunks match their solid colliders (radius/height × size)
function treeMeshes(trees, T) {
  const paint = (geo, hex) => {
    geo = geo.index ? geo.toNonIndexed() : geo;
    const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    geo.deleteAttribute('uv');
    return geo;
  };
  const merge = parts => {
    const pos = [], nrm = [], col = [];
    for (const g of parts) { pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); col.push(...g.attributes.color.array); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  };
  const r = T.trunkRadius, h = T.trunkHeight;
  const kinds = {
    broadleaf: merge([
      paint(new THREE.CylinderGeometry(r * 0.8, r, h, 6).translate(0, h / 2, 0), '#6b4a2f'),
      paint(new THREE.IcosahedronGeometry(2.4, 0).scale(1, 1.1, 1).translate(0, h + 1.4, 0), '#557f3c'),
      paint(new THREE.IcosahedronGeometry(1.6, 0).translate(1, h + 2.4, 0.4), '#5f8a44'),
    ]),
    conifer: merge([
      paint(new THREE.CylinderGeometry(r * 0.8, r, h, 6).translate(0, h / 2, 0), '#5e4128'),
      paint(new THREE.ConeGeometry(2.2, 4, 7).translate(0, h + 1.2, 0), '#2f5d3a'),
      paint(new THREE.ConeGeometry(1.6, 3.2, 7).translate(0, h + 3.2, 0), '#34663f'),
    ]),
  };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return Object.entries(kinds).map(([kind, geo]) => {
    const list = trees.filter(t => t.kind === kind), mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    list.forEach((t, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, t.y, t.z), q.setFromAxisAngle(up, t.turn), new THREE.Vector3(t.size, t.size, t.size))));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  });
}

// Traffic cone (orange with a white band, on a square base), centred like its physics body
function coneMesh(p) {
  const g = new THREE.Group(), hh = p.halfHeight;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(p.radius, hh * 2, 16), new THREE.MeshLambertMaterial({ color: '#f26a1b' }));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(p.radius * 0.5, p.radius * 0.62, hh * 0.3, 16), new THREE.MeshLambertMaterial({ color: '#f4f4f0' }));
  band.position.y = hh * 0.15;
  const base = new THREE.Mesh(new THREE.BoxGeometry(p.radius * 2.6, 0.04, p.radius * 2.6), new THREE.MeshLambertMaterial({ color: '#d85a15' }));
  base.position.y = -hh + 0.02;
  for (const m of [cone, band, base]) { m.castShadow = true; g.add(m); }
  return g;
}

const clock = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// R: put the car back on the nearest bit of road, facing the way it was going (worlds with roads);
// Shift+R (or no roads): everything back to the start. The damage stays: what comes back on is the
// session's rule (a test drive: every part that came loose or off, as it is; a race: only a wheel torn off)
function resetCar(w, toStart) {
  shared.session.attach.reattachAll('reset', { kind: shared.play.kind });
  w.sim.vehicle.parts.clear();                       // (what's still loose hangs again from where the car is now)
  if (w.stream) { rwOf(w).resetToRoad(w); return; }          // (the real world: onto the nearest road)
  if (toStart || !w.roadLines.length) { w.sim.reset(); return; }
  const p = w.sim.vehicle.body.translation(), q = w.sim.vehicle.body.rotation();
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  let best = null, bd = Infinity;
  for (const line of w.roadLines) for (const pt of line) { const d = (pt.x - p.x) ** 2 + (pt.z - p.z) ** 2; if (d < bd) { bd = d; best = pt; } }
  const flip = fwd.x * best.tx + fwd.z * best.tz < 0 ? 180 : 0;
  w.sim.resetCar({ position: [best.x, w.heightAt(best.x, best.z), best.z], headingDeg: Math.atan2(best.tx, best.tz) * 180 / Math.PI + flip });
}

// Start / finish arch over a road: two posts and a banner (scenery only)
function startArch(road, heightAt) {
  const line = roadLine(road);
  let p = line[0], bd = Infinity;
  for (const q of line) { const d = Math.hypot(q.x - road.startLine[0], q.z - road.startLine[1]); if (d < bd) { bd = d; p = q; } }
  const g = new THREE.Group(), span = road.width + 3, post = new THREE.MeshLambertMaterial({ color: '#d8d8d4' });
  for (const s of [-1, 1]) {
    const x = p.x - p.tz * s * span / 2, z = p.z + p.tx * s * span / 2, m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.2, 0.3), post);
    m.position.set(x, heightAt(x, z) + 2.6, z);
    m.castShadow = true;
    g.add(m);
  }
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const x2 = c.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { x2.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f0'; x2.fillRect(i * 32, j * 32, 32, 32); }
  x2.fillStyle = '#e8433a'; x2.fillRect(128, 6, 256, 52);
  x2.fillStyle = '#fff'; x2.font = '700 34px system-ui, sans-serif'; x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.fillText('START · FINISH', 256, 34);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(span, 1, 0.12), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
  const h = Math.max(heightAt(p.x - p.tz * span / 2, p.z + p.tx * span / 2), heightAt(p.x + p.tz * span / 2, p.z - p.tx * span / 2));
  banner.position.set(p.x, h + 4.8, p.z);
  banner.rotation.y = Math.atan2(p.tx, p.tz);   // its length runs across the road
  banner.castShadow = true;
  g.add(banner);
  return g;
}

// Dust: soft round puffs thrown up by tyres on loose ground; they drift, grow and fade (smoke too, with
// its own life, size, how fast it rises and grows)
// Game actions from any input device
function handleAction(w, act, inp) {
  const s = shared, v = w.sim.vehicle;
  if (act === 'settings') { s.panel.toggle(); return; }
  if (s.panel.open) return;
  if (act === 'tuning') s.tuning.toggle();
  if (act === 'telemetry') s.graphs.toggle();
  if (s.tests?.world === w) return;                   // a test is driving
  if (act === 'reset') {
    const toStart = !!(s.input.keys.ShiftLeft || s.input.keys.ShiftRight);
    resetCar(w, toStart);
    w.rig.reset();
    if (toStart) s.telemetry.clear();                  // a fresh run to record
  }
  // (gear shifts reach the car through the input's timeline, in the physics step they were pressed in)
  if (act === 'gearbox') s.gearMode = v.drivetrain.mode = s.gearMode === 'auto' ? 'sequential' : 'auto';
  // the drivetrain: a 4WD's transfer case, diff locks (what happens shows through the engine's news)
  const dt = v.drivetrain;
  if (act === 'transfer' && !dt.nextTransfer(v.forwardSpeed()) && !dt.spec.transferCase) s.flash.show('No transfer case', 'warn', 1.2, `${dt.layout}: only a 4WD has 2H / 4H / 4L`);
  for (const [a, which] of [['lockFront', 'front'], ['lockRear', 'rear'], ['lockCentre', 'centre']])
    if (act === a && !dt.setLock(which, !dt.locks[which])) s.flash.show(`No ${which} locker`, 'warn', 1.2, `the ${which} diff can't be locked from the seat (a selectable locker can)`);
  // a convertible's roof: the soft top up or down (a setting on the roof part: while stopped)
  if (act === 'roof') {
    const top = Object.values(s.session.garage.build.sockets).map(id => id && s.session.garage.state.parts[id]).find(p => p && s.session.db.parts[p.partId]?.roof?.kind === 'soft');
    if (!top) s.flash.show('No folding roof', 'warn', 1.2, s.spec.roof ? `the ${s.spec.roof.kind} roof stays put` : 'this car has a fixed roof');
    else s.session.tune(top.instanceId, 'open', s.spec.roof?.open ? 0 : 1, { quiet: true }).then(r => { if (r.ok) s.flash.show(s.spec.roof?.open ? 'Roof down' : 'Roof up', 'ok', 1.2); else s.flash.show('Roof', 'warn', 1.5, r.errors.join(' ')); });
  }
  if (act === 'aids') { const on = !Object.entries(s.prefs.aids).some(([k, x]) => k !== 'tcStrength' && k !== 'revProtection' && x); for (const k of ['abs', 'tc', 'esc', 'countersteer', 'steering', 'drift']) s.prefs.aids[k] = on; saveSettings(s.prefs); }
  if (act === 'camera') s.camMode = (s.camMode + 1) % CAMERAS.length;
  if (act === 'debug') s.debug = !s.debug;
  if (act === 'hud') s.compact = !s.compact;
  if (act === 'dyno') s.dyno.toggle();
  if (act === 'mute') { s.muted = !s.muted; s.audio?.mute(s.muted); }
  if (act === 'spoiler') {
    // the wing is a part: fitted and taken off through the garage, like any other
    (s.session.isFitted('basic_wing') ? s.session.remove('basic_wing', { quiet: true }) : s.session.install('basic_wing', { quiet: true }))
      .then(r => { if (!r.ok) console.warn(`Can't change the wing: ${r.errors.join(' ')}`); });
  }
  if (act === 'aiCar') toggleAiCar(w);
  if (act === 'damageView') setDamageView(!s.damageView);
  if (act === 'damageReport') { s.report.toggle(); updateDash(v.snapshot()); }
  if (act === 'tow') tow(w);
  if (act === 'worldMap' && w.stream) rwOf(w).toggleWorldMap(w);
  if (act === 'perfOverlay' && w.stream) rwOf(w).togglePerf(w);
  if (act === 'restore') {
    // development: every part back to 100% (a blown engine runs again), and back on the road — a test
    // drive's reset; a race keeps its damage (tow to the garage)
    const ok = s.play.allows('restore');
    if (!ok.ok) { s.flash.show('No free repairs', 'warn', 2, ok.why); return; }
    s.session.restoreCar().then(r => {
      if (!r.ok) { console.warn(`Couldn't restore the car: ${r.errors.join(' ')}`); return; }
      v.drivetrain.health.sync();
      v.mechanical.cool();
      resetCar(w, false);
      w.rig.reset();
      w.fx.resetCar(0);
      for (const m of [...(w.markers ?? [])]) { m.removeFromParent(); } w.markers = [];
      s.flash.show('Car reset', 'ok', 1.5, 'repaired (development)');
    });
  }
  if (act === 'sockets') window.garage.sockets();
  if (act === 'effects') s.fxPanel.toggle();
}

// Brake lights and the cockpit steering wheel
function updateCarDetails(vis, a, b, alpha) {
  const d = vis.details;
  if (d.taillamp) d.taillamp.emissiveIntensity = b.brakeLights ? d.lampOn : d.lampOff;
  // (about its own z axis, the steering column; sign: a left turn is anticlockwise to the driver)
  const sw = d.steeringWheel;
  if (sw) sw.node.quaternion.fromArray(sw.base).multiply(scratchQ.setFromAxisAngle(Z_AXIS, sw.sign * (a.steering.wheelAngle + (b.steering.wheelAngle - a.steering.wheelAngle) * alpha)));
}
const scratchQ = new THREE.Quaternion(), Z_AXIS = new THREE.Vector3(0, 0, 1);

// A car's look, from its parts (garage/visual.js): the body with every fitted part's model on its
// socket, in its own paint (yours, unless one is given: an AI car's). details: its brake lights, its
// glass (nearly clear from the driver's seat) and the cockpit steering wheel; wheelVis: the pivot each
// wheel's rim and tyre hang from, and how it turns (modelRig)
async function carVisual({ paint } = {}) {
  const s = shared, session = s.session;
  const vis = await createCarVisual({ car: session.garage.car, finishes: session.db.finishes, models: s.models, paint: paint ?? session.paint });
  await vis.applyBuild(session.garage.build, session.garage.view);
  vis.fixedPaint = !!paint;
  // (your car shows its crash damage; the finer meshes for dents are worked out in the background; the
  // denting waits its turn in the frame's budget)
  vis.dentBudget = s.dents;
  if (!paint) { vis.setDamage(session.damage, session.db.damage); vis.warmDents(); }
  vis.wheelVis = Object.fromEntries(Object.entries(s.rig.wheels).map(([k, r]) => [k, { pivot: vis.wheels[k], rig: r }]));
  let taillamp = null, glass = null;
  vis.root.traverse(o => { if (!o.isMesh) return; if (/tail/i.test(o.material.name)) taillamp ??= o.material; if (/glass/i.test(o.material.name)) glass ??= o.material; });
  const sw = s.rig.steeringWheel && vis.root.getObjectByName(s.rig.steeringWheel.node);
  vis.details = {
    // (the lamps: the model's own glow when off, bright when braking)
    taillamp, lampOff: taillamp?.emissiveIntensity ?? 1, lampOn: taillamp ? 3 / Math.max(0.05, ...taillamp.emissive.toArray()) : 1,
    glass, glassOpacity: glass?.opacity ?? 1,
    steeringWheel: sw ? { node: sw, base: sw.quaternion.toArray(), sign: s.rig.steeringWheel.sign } : null,
  };
  if (!paint) addHeadlights(vis);
  s.visuals.add(vis);
  return vis;
}
const dropCar = vis => { vis.dispose(); shared.visuals.delete(vis); };

const NO_TURN = [0, 0, 0, 1];
// Place a car's body and wheels part-way between two physics states
function placeCar(vis, a, b, alpha) {
  const lerp = (x, y) => x + (y - x) * alpha;
  vis.group.position.set(lerp(a.position[0], b.position[0]), lerp(a.position[1], b.position[1]), lerp(a.position[2], b.position[2]));
  vis.group.quaternion.set(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w).slerp(new THREE.Quaternion(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w), alpha);
  // each wheel rides the suspension (its centre is mountHeight − length from its socket), steers and
  // spins forwards about the car's axle (see modelRig)
  const W = shared.spec.wheels;
  // (a soft or flat tyre is drawn its full size, so the wheel goes up by what it's sagged: the car sits
  // lower on it; a bent rim wobbles as it turns; a wheel torn off is somewhere else)
  b.wheels.forEach((wb, i) => {
    const wa = a.wheels[i], v = vis.wheelVis[wb.name];
    if (!v?.pivot || wb.off) return;
    const drop = (W.mountHeight?.[W.front.includes(wb.name) ? 'front' : 'rear'] ?? 0) - lerp(wa.length, wb.length) + (W.radius - (wb.radius ?? W.radius)), spin = lerp(wa.spin, wb.spin);
    const t = wheelTransform(v.rig, NO_TURN, lerp(wa.steerAngle, wb.steerAngle), spin, drop, W.offsets?.[wb.name] ?? 0);
    let q = t.rotation;
    if (wb.bend) { const r = v.rig, f = [r.axle[1] * r.up[2] - r.axle[2] * r.up[1], r.axle[2] * r.up[0] - r.axle[0] * r.up[2], r.axle[0] * r.up[1] - r.axle[1] * r.up[0]]; q = quatMul(axisAngle(f, 1.5 * wb.bend / 1000 / (W.rimRadius ?? W.radius) * Math.sin(spin)), q); }
    v.pivot.quaternion.fromArray(q);
    v.pivot.position.fromArray(t.position);
    vis.setWheelSpin?.(wb.name, v.rig.axle, spin);           // (brake discs and calipers on the hub: they don't turn)
  });
}

// Aero parts fitted (a wing): its placeholder turned to the wing's angle
function syncParts(vis, s) {
  for (const p of s.aero.parts) {
    const socket = shared.spec.aeroParts?.find(a => a.part.slot === p.slot)?.socket;
    const wing = socket && vis.attached.get(socket)?.object?.userData.wing;
    if (wing) wing.rotation.x = (p.angle ?? 0) * Math.PI / 180;   // trailing edge up
  }
}

// The garage's debug console, for what's drawn (garage.help() lists everything)
function debugCommands(session) {
  const current = () => active ?? [...worlds.values()][0];
  session.debug('attached', () => { const w = current(); console.table(w.carVis.list()); console.log(`wheels: ${w.carVis.wheelRadius('FL')?.toFixed(4)} m tyre radius (the physics still rolls on ${shared.spec.wheels.radius} m until Step 4)`); },
    'garage.attached()               what\'s drawn on every socket (the part, its model, loaded / placeholder / made)');
  session.debug('pileup', (n = 8, kmh = 60) => pileup(current(), n, kmh), 'garage.pileup(8, 60)            8 AI cars driving into each other 45 m ahead at 60 km/h (J takes them away): the effects with many cars');
  session.debug('crash', (kmh = 60, target = 'wall', side = 'front', angleDeg = 0) => crashTest(kmh, target, side, angleDeg), 'garage.crash(60, "wall", "front", 0)   the crash test: into the wall or barrier (front, rear or side on, at an angle) or along the guardrail');
  const attachAs = state => which => {
    const sockets = socketsFor(which), mode = shared.prefs.damage === 'full' ? 'full' : 'visual';
    const done = sockets.filter(sk => session.attach.set(sk, state, { mode, reason: 'debug' }));
    console.log(done.length ? `${state}: ${done.join(', ')}` : `Nothing detachable called "${which}" (${state === 'loose' ? 'mirrors and wings go straight off' : 'a socket, e.g. bonnet, or a part id'})`);
    return done;
  };
  // mechanical damage straight: garage.damage("toe", 2, "FL"), garage.damage("puncture", 0.02, "RR"), garage.damage("radiator", 0.01)
  session.debug('damage', (kind, value, corner) => {
    if (!kind) { console.log(`garage.damage(kind, value, corner): ${session.mechanical.kinds.join(', ')}; value null puts it right. E.g. garage.damage("toe", 2, "FL") (degrees, + points left), garage.damage("puncture", 0.02, "RR") (share of the pressure a second), garage.damage("radiator", 0.01) (coolant a second), garage.damage("bend", 6, "FR") (mm), garage.damage("gearbox", 0.7), garage.damage("wheelOff", 1, "FL")`); return null; }
    if (kind === 'wheelOff') {
      const socket = session.garage.car.model.sockets[corner];
      const ok = !!socket && session.attach.set(socket, value === 0 || value === null ? 'attached' : 'detached', { mode: 'full', reason: 'debug' });
      console.log(ok ? `${corner} wheel ${value === 0 || value === null ? 'back on' : 'torn off'}` : 'garage.damage("wheelOff", 1, "FL"): a corner, FL FR RL RR');
      return ok;
    }
    return session.mechanical.set(kind, value ?? null, corner).then(r => { console.log(r.ok ? `${kind}${corner ? ` ${corner}` : ''} → ${value ?? 'fine'}` : `✘ ${r.errors.join(' ')}`); return r; });
  }, 'garage.damage("toe", 2, "FL")        mechanical damage: toe, camber, ride, damper, bend, puncture, pressure, brakeLine (a corner); radiator, coolant, boost, gearbox, differential, clutch, exhaust; wheelOff');
  session.debug('report', () => { const rows = session.mechanical.report(active?.sim.vehicle.mechanical.snapshot()); console.table(rows.map(r => ({ system: r.system, corner: r.corner ?? '', state: r.state, level: r.level }))); return rows; },
    'garage.report()                 every system\'s mechanical state (I shows it on screen)');
  // try a drive layout on the car you're driving (the live spec, like the tuning panel: the garage's next change puts it back)
  session.debug('drive', (layout = 'RWD') => {
    const id = { FWD: 'fwd', AWD: 'awdPower', '4WD': 'fourWd' }[layout], S = shared.spec;
    if (layout !== 'RWD' && !id) { console.log('garage.drive("RWD" | "FWD" | "AWD" | "4WD")'); return null; }
    const made = id ? testCar(S, id) : null;
    S.drivetrain.layout = layout;
    if (made) for (const k of ['differential', 'frontDifferential', 'centreDifferential', 'transferCase']) if (made[k]) S[k] = made[k];
    if (layout === 'FWD') S.drivetrain.torqueSteer = made.drivetrain.torqueSteer;
    for (const w of worlds.values()) w.sim.retune();
    console.log(`${layout} on the live spec (${layout === '4WD' ? 'V: 2H / 4H / 4L, [ ] lock the front / rear' : layout === 'AWD' ? 'a viscous centre diff, 40% to the front' : layout === 'FWD' ? 'an open front diff, with torque steer' : 'as the garage built it, until its next change'}) — the garage's next change puts the car back`);
    return layout;
  }, 'garage.drive("AWD")             try a drive layout on the car: RWD, FWD (open diff, torque steer), AWD (viscous centre), 4WD (2H / 4H / 4L, lockers)');
  session.debug('loose', attachAs('loose'), 'garage.loose("bonnet")         shake a part loose (a socket or part id; the damage setting says if it costs performance)');
  session.debug('detach', attachAs('detached'), 'garage.detach("mirror_left")   tear a part off');
  session.debug('attach', (which = 'all') => { if (which === 'all') { const n = session.attach.reattachAll('debug'); console.log(`${n} part${n === 1 ? '' : 's'} back on`); return n; } return attachAs('attached')(which); }, 'garage.attach("all")           put loose and torn-off parts back on'); 
  session.debug('sockets', on => { const shown = current().carVis.showSockets(on); for (const w of worlds.values()) if (w !== current()) w.carVis.showSockets(shown); console.log(`socket gizmos ${shown ? 'on' : 'off'} (N)`); return shown; },
    'garage.sockets()                every socket as a labelled axis gizmo (on / off; or N)');
  session.debug('models', () => { const rows = shared.models.stats(); console.table(rows); console.log(`${rows.length} models, loaded ${rows.reduce((a, r) => a + r.loaded, 0)} times, ${rows.reduce((a, r) => a + r.inUse, 0)} copies in use by ${shared.visuals.size} cars`); return rows; },
    'garage.models()                 every model file: how many times it was loaded, how many copies are in use');
  session.debug('copies', async (n = 10) => {
    // n parked copies of your car beside it (0: none), then what that loaded
    const w = current();
    for (const v of shared.copies.splice(0)) dropCar(v);
    const p = w.car.position, q = w.car.quaternion, side = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    for (let i = 0; i < n; i++) {
      const v = await carVisual();
      const at = p.clone().addScaledVector(side, 3.2 * (i + 1));
      v.group.position.set(at.x, w.heightAt(at.x, at.z), at.z);
      v.group.quaternion.copy(q);
      w.scene.add(v.group);
      shared.copies.push(v);
    }
    return window.garage.models();
  }, 'garage.copies(10)               park 10 copies of your car beside you (0: take them away) and show what that loaded');
}

const AI_PAINT = { colour: '#c8452f', finish: 'metallic' };
// A pile-up (garage.pileup(8, 60)): n AI cars on a ring 30 m round a point ahead of you, all driving into
// the middle at kmh — a big multi-car crash, to see the effects (and what they cost) with many cars at
// once. J takes them away
async function pileup(w, n = 8, kmh = 60) {
  const sim = w.sim, b = sim.vehicle.body, p = b.translation(), q = b.rotation();
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)), centre = [p.x + fwd.x * 45, p.z + fwd.z * 45];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, x = centre[0] + Math.sin(a) * 30, z = centre[1] + Math.cos(a) * 30;
    const id = sim.addCar({ position: [x, w.heightAt(x, z), z], headingDeg: (a * 180 / Math.PI + 180) % 360, speed: kmh / 3.6 }, straightLine({ speed: kmh / 3.6 }));
    await aiCarVisual(w, id);
  }
  return `${n} cars driving into each other at ${kmh} km/h, 45 m ahead`;
}

// AI car: J puts one on the road ahead of you (or straight ahead), going your speed, then racing
// along the road the way you're going (physics/ai.js); J again takes it away
async function toggleAiCar(w) {
  const sim = w.sim;
  if (sim.cars.length) { for (const c of [...sim.cars]) sim.removeCar(c.id); return; }
  const b = sim.vehicle.body, p = b.translation(), q = b.rotation(), v = b.linvel();
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  const speed = Math.max(0, v.x * fwd.x + v.z * fwd.z);
  let at, driver;
  if (w.roadLines.length) {
    // the road you're nearest, raced the way you're going along it
    let best = null;
    w.roadLines.forEach((line, r) => line.forEach((pt, i) => { const d = (pt.x - p.x) ** 2 + (pt.z - p.z) ** 2; if (!best || d < best.d) best = { d, r, i }; }));
    const road = w.track.roads[best.r], base = w.roadLines[best.r], forwards = fwd.x * base[best.i].tx + fwd.z * base[best.i].tz >= 0;
    const line = forwards ? base : reverseLine(base), m = line.length, i = forwards ? best.i : m - 1 - best.i;
    const ahead = line[road.closed ? (i + 8) % m : Math.min(m - 1, i + 8)];            // 16 m along the road
    at = { position: [ahead.x, w.heightAt(ahead.x, ahead.z), ahead.z], headingDeg: Math.atan2(ahead.tx, ahead.tz) * 180 / Math.PI, speed };
    driver = roadFollower(line, 2, { closed: !!road.closed });
  } else {
    at = { position: [p.x + fwd.x * 16, 0, p.z + fwd.z * 16], headingDeg: Math.atan2(fwd.x, fwd.z) * 180 / Math.PI, speed };
    driver = straightLine();
  }
  const id = sim.addCar(at, driver);
  await aiCarVisual(w, id);
}
// An AI car's look (a red one: its own paint) and its own crash damage — it drives on your car's spec,
// not its mechanical damage; a crash dents it as the same model as yours, by the same rules
async function aiCarVisual(w, id) {
  const sn = shared.session, c = w.sim.cars.find(x => x.id === id);
  c.vehicle.mechanical.enabled = false;
  const vis = await carVisual({ paint: AI_PAINT });
  w.scene.add(vis.group);
  w.others.set(id, vis);
  w.aiDamage.set(id, new CarDamage({ car: sn.garage.car, build: sn.garage.build, view: sn.garage.view, boxes: shared.damageBoxes, rules: sn.db.damage, mode: shared.prefs.damage === 'off' ? 'off' : 'visual' }));
}

function updateOtherCars(w, a, b, alpha) {
  const byId = new Map((a.others || []).map(o => [o.id, o]));
  for (const [id, vis] of w.others) {
    const ob = b.others?.find(o => o.id === id);
    if (!ob) { dropCar(vis); w.others.delete(id); w.aiDamage.delete(id); continue; }
    const oa = byId.get(id) || ob;
    placeCar(vis, oa, ob, alpha);
    updateCarDetails(vis, oa, ob, alpha);
  }
}

const liftText = F => F >= 0 ? `+${F.toFixed(0)} N lift` : `${(-F).toFixed(0)} N down`;
// (the drive layout, for the HUD: the diffs, the transfer case, what's locked)
function layoutText(e) {
  const L = e.locks ?? {}, lock = k => L[k] ? ' <b class="off">LOCKED</b>' : '';
  if (e.layout === 'AWD') return `AWD · centre ${e.centre.type} ${Math.round(e.centre.split * 100)}/${Math.round((1 - e.centre.split) * 100)}${lock('centre')} · front ${e.frontDiff.type}${lock('front')} · rear ${e.diffType}${lock('rear')}`;
  if (e.layout === '4WD') return `4WD <b>${e.transfer}</b> · front ${e.frontDiff.type}${lock('front')} · rear ${e.diffType}${lock('rear')}`;
  return `${e.layout ?? 'RWD'} · ${e.diffType} diff${lock(e.layout === 'FWD' ? 'front' : 'rear')}`;
}

// The car as the garage has it: its performance rating and class, mass, centre of mass (the marker
// with G) and the build's fingerprint
// (damage: the setting, the body and the last hit)
function crashLine() {
  const s = shared, d = s.session.damage, c = s.lastCrash, mode = { full: 'full', visual: 'visual only', off: 'off' }[s.prefs.damage ?? 'full'];
  const dents = (d.shell?.dents?.length ?? 0) + Object.values(d.parts).reduce((a, x) => a + x.length, 0), broken = d.shell?.broken?.length ?? 0;
  const last = c && performance.now() - c.at < 15000 ? ` · last hit <b>${c.strength.toFixed(1)}</b> m/s ${c.class} into ${c.material}: ${c.hit?.name ?? ''}${c.losses.length ? ` (${c.losses.map(l => `${l.target === 'engine' ? 'engine' : l.target === 'shell' ? 'body' : l.target.replace(/^socket_/, '')} −${Math.round(l.loss)}`).join(', ')})` : ''}${c.broken.length ? ` · broke ${c.broken.length}` : ''}` : '';
  const st = Object.entries(s.session.attach.states), short = k => k.replace(/^socket_/, '').replace(/_/g, ' ');
  const loose = st.filter(([, x]) => x.state === 'loose').map(([k]) => short(k)), off = st.filter(([, x]) => x.state === 'detached').map(([k]) => short(k));
  return `<div class="sub">damage <b>${mode}</b> · body ${Math.round(d.shell?.condition ?? 100)}% · ${dents} dent${dents === 1 ? '' : 's'}${broken ? ` · ${broken} window${broken > 1 ? 's' : ''} / lights broken` : ''}${loose.length ? ` · loose: <b class="off">${loose.join(', ')}</b>` : ''}${off.length ? ` · torn off: <b class="off">${off.join(', ')}</b>` : ''}${last}</div>`;
}
function garageLine() {
  const st = shared.session.stats, t = st.totals, S = shared.spec, c = S.centreOfMass;
  return `<div class="sub">garage: rating <b>${t?.rating ? `${t.rating.index} ${t.rating.class}` : '–'}</b> · <b>${Math.round(S.mass)}</b> kg · centre of mass ${c.map(x => (Math.abs(x) < 5e-4 ? 0 : x).toFixed(3)).join(', ')} (${t?.centreOfMassHeight != null ? `${(t.centreOfMassHeight * 1000).toFixed(0)} mm up` : ''}) · wheels ${t?.wheel?.label ?? ''} ${(S.wheels.radius * 1000).toFixed(0)} mm · build <b>${shared.session.fingerprint}</b>${shared.session.debugMode ? ' · <b class="off">DEBUG: garage changes while driving</b>' : ''}</div>`;
}
