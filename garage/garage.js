// The garage: the 3D workshop (garageScene.js), its screen (garageUi.js) and the garage's logic
// (workshop.js), put together for the game. The page calls enter() / exit(); the garage calls back
// through `actions` to leave (back to where the player was) or test drive (the car as it is, in the
// test centre, with a way back to the garage). Every change is made and saved by the player service
// as it happens (garage/player), so there's nothing to save or lose on the way out.
//
//   import * as garage from './garage/garage.js';
//   await garage.enter({ leave: () => …, testDrive: () => … })

import * as THREE from 'three';
import { ModelCache } from './visual.js';
import { modelRig } from '../physics/sockets.js';
import { garageSession } from './session.js';
import { Workshop } from './workshop.js';
import { GarageScene } from './garageScene.js';
import { GarageScreen } from './garageUi.js';
import { createSounds } from './sounds.js';

let g = null;          // everything made once: renderer, scene, screen
let workshop = null;   // the garage's logic on the player's profile (its undo history lasts the visit to the page)
let active = false, testing = false, noticesShown = false, hooks = {};
const MODE_KEY = 'driveWorld.garage.mode';

async function create() {
  const session = await garageSession();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.id = 'garage-canvas';
  renderer.domElement.style.display = 'none';
  document.body.appendChild(renderer.domElement);
  const root = document.createElement('div');
  root.id = 'garage-root';
  root.style.display = 'none';
  document.body.appendChild(root);

  const sounds = createSounds(), models = new ModelCache();
  const scene = new GarageScene({ renderer, models, sounds });
  scene.attachInput(renderer.domElement);
  // each car's body model: how its wheels hang (for the lift), fetched once a car
  const rigs = new Map();
  scene.rigFor = car => { if (!rigs.has(car.id)) rigs.set(car.id, fetch(car.model.file).then(r => r.arrayBuffer()).then(glb => modelRig(glb, car.model))); return rigs.get(car.id); };
  const rig = await scene.rigFor(session.garage.car);
  scene.rig = rig;
  const screen = new GarageScreen({ root, scene, sounds, actions: { leave: () => leave(), testDrive: () => testDrive(), testDriveCar: id => testDriveCar(id), testDriveWith: (state, name) => testDriveWith(state, name), modeChanged: mode => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* not kept */ } } } });
  screen.playtest = session.playtest;
  screen.dev = session.dev;
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    scene.resize(innerWidth, innerHeight);
    if (active) screen.render();
  });
  return { session, renderer, root, scene, screen, sounds, models, rig, last: 0 };
}

// Into the garage with the player's current car (hooks: { leave(), testDrive() } — how the page switches;
// tab: a tab to open on, e.g. 'damage' when the car's been towed in)
export async function enter(h = {}) {
  hooks = h;
  if (!g) g = await create();
  const { session, renderer, root, scene, screen } = g;
  // (back from a test drive of a dealer's car: the player's own car again)
  if (session.testDriving) session.endTestDrive();
  // (parts shaken loose with visual-only damage: back on; with full damage they stay loose or off, as the
  // save has them, for the damage report — a repair puts them back)
  session.attach.dropTransient('garage');
  session.attach.sync();
  if (!workshop) {
    let mode = 'quick';
    try { mode = localStorage.getItem(MODE_KEY) || 'quick'; } catch { /* default */ }
    workshop = new Workshop({ db: session.db, service: session.player, mode });
  }
  // (back from a test drive: the screen as it was; otherwise a fresh visit)
  if (!testing) screen.reset();
  testing = false;
  renderer.domElement.style.display = 'block';
  root.style.display = 'block';
  screen.visible = true;
  screen.loading = true;
  screen.workshop = workshop;
  active = true;
  g.last = performance.now();
  requestAnimationFrame(loop);
  await screen.showCar();
  screen.loading = false;
  scene.focus(screen.ui.view);
  // (towed in: open on the damage report)
  if (h.tab) screen.setTab(h.tab);
  screen.render();
  // the first time the car comes in damaged: what the damage report is for (and, short of money, the
  // free repair) — once ever (garage/hints.js)
  if (workshop.problems().problems.length) screen.hint('damageTab');
  if (workshop.safetyNet.offered) screen.hint('safetyNet');
  // what loading the save changed (a part that's gone from the game, refunded; an old save brought up to date)
  if (!noticesShown && session.notices.length) { noticesShown = true; screen.notice('Your save was brought up to date', session.notices); }
}

export function exit() {
  if (!g) return;
  active = false;
  g.screen.visible = false;
  g.renderer.domElement.style.display = 'none';
  g.root.style.display = 'none';
  g.sounds.lift(false); g.sounds.dyno(null);
  g.scene.clearGhost();
}

export const isActive = () => active;
// (for the console and tests)
export const debug = { get workshop() { return workshop; }, get scene() { return g?.scene; }, get screen() { return g?.screen; } };

function loop(now) {
  if (!active) return;
  const dt = Math.min(0.05, (now - g.last) / 1000);
  g.last = now;
  g.screen.pollGamepad(dt);
  g.scene.update(dt);
  g.scene.render();
  g.screen.updateMarkers();
  requestAnimationFrame(loop);
}

// Back to where the player came from (everything's already saved)
function leave() {
  hooks.leave?.();
}

// The car as it is in the test centre; the garage keeps its screen for when the player's back
function testDrive() {
  if (!workshop.drivable.ok) return;
  testing = true;
  hooks.testDrive?.();
}
// A dealer's car, stock, in the test centre (the session's test drive: nothing on it changes or is
// kept); back in the garage, the player's own car again and the dealership as it was
function testDriveCar(carId) {
  const r = g.session.testDrive(carId);
  if (!r.ok) return r;
  testing = true;
  hooks.testDrive?.();
  return r;
}
// A build that isn't the player's own (a shop part on their car, a used car from the lot), the same way
function testDriveWith(state, name) {
  const r = g.session.testDriveWith(state, name);
  if (!r.ok) return r;
  testing = true;
  hooks.testDrive?.();
  return r;
}
