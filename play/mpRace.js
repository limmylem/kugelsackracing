// A multiplayer race as the game plays it (Phase 7 Step 2; docs/MULTIPLAYER.md "Race flow"): the race room says what's
// raced (mp/client.js 'load'); this takes the player there (a real-world route in its region, or a generated track —
// built here and checked by its hash), lays out the route, and holds the car near the start while the others load.
// When the grid is announced the car goes onto its slot, held; the lights go out at the server's goAt (the clocks are
// synced: Step 1) and the car is let go on that very physics step. The run is timed by the game's own QuestSession on
// the server's clock — the same gates, laps, resets (Phase 4's corridor rules) and sub-tick timing as a quest — and
// handed in when it's over, to be checked (Phase 6 Step 3). The others' cars are drawn as in free roam (play/
// multiplayer.js), on the race room's connection. Players watching — spectators, or anyone finished or out — follow any
// car: behind it, in it, or from TV cameras beside the route. Nothing of the page in here: the game hands in `game`.
//
//   const R = createMpRace({ S (mp/client.js), game, cfg (data/multiplayer.json), quests (data/quests.json), autopilot })
//     game: {
//       goTo(venue, course, { onProgress }) → { course, hash, w }   the world loaded (the route's region, or the track
//                                      built), the course laid out in it (route/model.js viewCourse), the track's hash
//       adapters() → play/questController.js adapters (place, hold, release, resetTo, carState, ready, onStep, frame)
//       dressing(course) → { update(x, z), dispose() }    the route's line, gates and arches
//       drawCars(net, { label }) → play/multiplayer.js's (joinMultiplayer on the race's connection)
//       localState() → this car's state for the others (play/multiplayer.js localState)
//       simTime() → the physics' time (s)      car() → { carId, instanceId, className, topSpeed, … } (a run's car)
//       carNow() → { x, z, heading, kmh, forward, gear }     hideCar(on) (out of sight and held: watching)
//       focus([x, y, z] | null) (the world's ground streamed round there)     toSim / toWorld([x, y, z]) (frames)
//       say(text, kind)                a message on screen     realTime(on) (racing: the physics catches up each frame)
//       carView(handle) → { pos: [x, y, z], quat: [x, y, z, w] } in the scene's frame, or null
//       tvCameras() → a generated track's TV cameras (track/cameras.js) in the world frame, or null
//       (car-to-car contact, Phase 7 Step 3 — mp/contactClient.js; docs/CONTACT.md:)
//       sim() → the physics (physics/sim.js)     carPhysics() → { box (the body collider), mass }
//       carPose() → { position (the physics' frame), headingDeg }: where the car is (the run's record starts there)
//       contactHit(impact, { scale }) → your car's damage from an agreed hit (the game's crash path, and on to the others)
//       contactEffect({ point, strength, kind, local }) → sparks and a knock where cars touched (point: [x, z], physics' frame)
//       setOpacity(id | 'me', a) → a car drawn see-through (a ghost: 0..1)
//     }
//   R.frame(dt)  every frame, after the physics     R.camera(camera, dt) → whether it placed the camera (watching)
//   R.state: 'idle' | 'loading' | 'loaded' | 'grid' | 'racing' | 'finished' | 'out'    R.progress (loading's step)
//   R.watching → { id, name, mode } | null       R.watch(on)  R.nextCar(±1)  R.nextCamera()   R.cars() (the ones to watch)
//   R.drawn → the others' cars as drawn (play/multiplayer.js: .car(id) → { pose, handle })
//   R.clock() → s since the lights went out      R.lights() → { red, green } (track/lights.js)    R.lap → { lap, laps }
//   R.auto / R.autoInput(dt) (the browser tests' autopilot, once it's GO: ?mp&mpauto)   R.resetNow()   R.dispose()
//   R.contact → this race's contact client (mp/contactClient.js: its debug, the overlay's)   R.scrape() → your car
//   rubbing on another ({ amount, speed, material, point, normal } — the game adds it to its own scrapes) or null

import { createQuestSession } from '../quest/session.js';
import { createRecorder } from '../quest/recording.js';
import { buildResult } from '../quest/result.js';
import { createAutopilot } from '../route/autopilot.js';
import { at } from '../route/geometry.js';
import { raceQuest } from '../mp/quest.js';
import { startLights } from '../track/lights.js';
import { zoom } from '../track/cameras.js';
import { createContactClient } from '../mp/contactClient.js';
import { createRunRecorder } from '../mp/runRecord.js';
import { createContactOverlay } from '../mp/contactOverlay.js';
import { openContactReplay } from '../mp/contactReplay.js';

export const CAMERAS = ['chase', 'in-car', 'tv'];
const CAMERA_NAMES = { chase: 'Chase', 'in-car': 'In car', tv: 'TV' };
export const cameraName = m => CAMERA_NAMES[m] ?? m;

// TV cameras beside a real-world route: every so often along it, off to one side and up (alternating sides, the
// outside of the bend where there is one), each covering its stretch of the route — in the course's (world) frame
export function routeCameras(course, { every = 170, out = 9, up = 7 } = {}) {
  const L = course.length, cams = [];
  for (let s = every / 2, k = 0; s < L; s += every, k++) {
    const p = at(course.line, s, course.loop), q = at(course.line, Math.min(L, s + 30), course.loop);
    const turn = Math.sign(p.dx * q.dz - p.dz * q.dx) || (k % 2 ? 1 : -1);          // (+: the road bends left)
    const side = -turn, half = (p.w ?? 10) / 2 + out;                                 // (the outside of the bend)
    cams.push({ s, x: p.x + p.dz * side * half, y: (p.h ?? 0) + up, z: p.z - p.dx * side * half });
  }
  return cams;
}

export function createMpRace({ S, game, cfg, quests, autopilot = false }) {
  let run = null;            // the race being raced or watched here
  let watching = null;       // { id, mode, tv }
  const offs = [];
  const me = () => S.me;
  const goAt = () => S.goAt;
  const say = (text, kind = 'info') => game.say?.(text, kind);

  offs.push(S.on('load', m => { void load(m); }));
  offs.push(S.on('lobby', m => {
    // (back in the lobby — a rematch voted for, or a new race being set up): this race over here
    if (m.phase === 'lobby' && run) end();
  }));
  offs.push(S.on('event', m => {
    const e = m.e;
    if (!run || e.pid !== S.myUid) return;
    if (e.type === 'jumpstart') say(`Jump start: +${e.penaltySec} s`, 'bad');
    if (e.type === 'spectate') { say(e.why, 'warn'); run.state = 'out'; watch(true); }
    if (e.type === 'dnf') { run.state = 'out'; say(e.why === 'time' ? 'Out of time: did not finish' : 'Out of the race', 'bad'); }
  }));
  offs.push(S.on('results', () => { if (run && (run.state === 'grid' || run.state === 'racing')) { run.state = 'out'; } }));
  offs.push(S.on('left', () => end()));
  // (car-to-car contact: the agreed results, refusals, who's a ghost — the contact client's)
  for (const k of ['contact', 'contact-rejected', 'ghosts']) offs.push(S.on(k, m => run?.C?.message(m)));
  // (the contact replay asked for: both players' views of it, side by side)
  offs.push(S.on('contact-replay', m => { if (!m.contact) { say(m.why ?? 'That contact isn\'t kept any more', 'warn'); return; } replayView?.close(); replayView = openContactReplay(m.contact, { names: Object.fromEntries((S.lobby?.players ?? []).map(p => [p.uid, p.name])), boxes: Object.fromEntries((S.lobby?.players ?? []).filter(p => p.car?.box).map(p => [p.uid, p.car.box])), onClose: () => { replayView = null; } }); }));
  // F10 the contact overlay, Shift+F10 the last contact replayed (docs/CONTACT.md "Debug tools")
  let replayView = null;
  const keys = e => {
    if (e.code !== 'F10' || !run?.C) return;
    e.preventDefault();
    if (e.shiftKey) { const cid = run.overlay?.lastCid() ?? [...run.C.debug.agreed].reverse().find(a => a.cid)?.cid; if (cid) S.send({ t: 'contact-replay', cid }); else say('No contact yet to replay', 'info'); return; }
    run.overlay ??= createContactOverlay({ C: run.C, names: uid => S.lobby?.players.find(p => p.uid === uid)?.name ?? null, mode: () => S.lobby?.settings?.collisions ?? '', me: () => S.myUid });
    run.overlay.toggle();
  };
  if (typeof addEventListener === 'function') { addEventListener('keydown', keys); offs.push(() => removeEventListener('keydown', keys)); }

  // ---------- loading: to the venue, the car near the start ----------
  async function load(m) {
    end();
    const r = run = { raceId: m.raceId, venue: m.venue, laps: m.laps, state: 'loading', progress: 'Loading…', course: null, hash: null, Q: null, A: null, dressing: null, M: null, rec: null, released: false, handed: false, offset: null, detach: null, slot: null, pilot: null, tv: null };
    try {
      const got = await game.goTo(m.venue, m.course, { onProgress: t => { r.progress = t; } });
      if (run !== r) return;
      r.course = got.course; r.hash = got.hash ?? null;
      r.quest = raceQuest({ raceId: m.raceId, venue: m.venue.venue, laps: m.laps, loop: r.course.loop, trackHash: r.hash });
      r.A = game.adapters();
      r.dressing = game.dressing(r.course);
      r.M = await game.drawCars(S.race.net, { label: o => labelOf(o) });
      r.tv = game.tvCameras?.() ?? routeCameras(r.course);
      // (near the start while the others load — the back of the grid — so the ground there is in)
      const back = r.course.grid.slots.at(-1);
      r.A.place(back); r.A.hold();
      r.progress = 'Putting the car on the grid…';
      for (let i = 0; i < 600 && run === r && !r.A.ready(); i++) await new Promise(res => setTimeout(res, 100));
      if (run !== r) return;
      r.state = 'loaded';
      S.send({ t: 'loaded', hash: r.hash });
      if (me()?.role === 'spectator') watch(true);
    } catch (e) {
      if (run !== r) return;
      r.state = 'idle'; r.error = e?.message ?? String(e);
      say(`Couldn't load the race: ${r.error}`, 'bad');
    }
  }
  // the name over a car: its place in the race
  function labelOf(o) {
    const st = S.standings?.list?.find(x => x.pid === o.uid);
    return st ? `${st.place}. ${o.name ?? st.name}` : o.name ?? null;
  }

  // ---------- the grid: the car on its slot, the run's session ready for the lights ----------
  function toGrid(r) {
    const p = me();
    if (!p || p.role !== 'racer' || p.slot == null || !r.course) return;
    const slot = r.course.grid.slots[p.slot] ?? r.course.grid.slots.at(-1);
    r.slot = p.slot;
    watching = null; game.hideCar(false); game.focus?.(null);
    r.A.place(slot); r.A.hold();
    const car = game.car();
    r.Q = createQuestSession({ quest: r.quest, course: r.course, config: quests, car, startMode: 'standing', externalGo: true, slot: p.slot });
    r.Q.begin({ intro: false });
    r.Q.drain();
    r.rec = createRecorder({ hz: quests.recording?.hz ?? 20 });
    r.offset = (S.race?.net.stampAt() ?? 0) / 1000 - game.simTime();
    r.pilot = autopilot ? createAutopilot(r.course.line, { loop: r.course.loop }) : null;
    contactOn(r);
    r.detach = r.A.onStep((t, dt) => step(r, t, dt));
    game.realTime?.(true);
    r.state = 'grid';
  }
  // every physics step: on the server's clock (the step's moment), the lights, the run's timing
  function step(r, simT, dt) {
    if (run !== r || !r.Q || r.offset == null) return;
    const t = simT + r.offset, go = goAt();
    if (go != null) r.Q.setGo(go / 1000);
    if (!r.released && go != null && t * 1000 >= go) {
      r.released = true; r.A.release({ speed: 0 }); r.state = 'racing';
      // (the run's record from here: the car put exactly where it stands — the verifier starts it the same way)
      if (r.recorder) r.recorder.start({ pose: game.carPose(), t0: Math.round(t * 1000), carId: game.car()?.carId ?? null, origin: game.toWorld([0, 0, 0]) });
    }
    const st = r.Q.state.state;
    if ((st === 'countdown' || st === 'racing') && r.A.ready()) {
      const c = r.A.carState();
      r.Q.tick({ t, dt, ...c });
      if (r.released) r.rec.sample(t - go / 1000, c);
    }
    for (const e of r.Q.drain()) {
      if (e.type === 'reset') { r.A.resetTo(e.point); r.Q.noteReset(e.point); r.M?.reset(); say('Back to the last checkpoint', 'warn'); }
      if (e.type === 'missed') say(e.message, 'bad');
    }
    if (!r.handed && r.Q.outcome && (r.Q.state.state === 'finished' || r.Q.state.state === 'results' || r.Q.state.state === 'failed')) handIn(r);
  }
  // the run, handed in to be checked: the server's results wait for it
  function handIn(r) {
    r.handed = true;
    const o = r.Q.outcome;
    if (o.status !== 'finished') { r.state = 'out'; return; }
    const result = buildResult({ quest: r.quest, course: r.course, outcome: o, car: game.car() });
    S.sendRun(result, r.rec.finish({ questId: r.quest.id, routeVersion: r.course.version ?? null }), r.recorder?.on ? r.recorder.stop() : null);
    r.result = result; r.state = 'finished';
  }

  // ---------- watching: any car, from behind, inside or the TV cameras ----------
  function cars() {
    const net = S.race?.net;
    if (!net) return [];
    const st = S.standings?.list ?? [];
    return [...net.players.values()].filter(p => p.id !== net.id && p.base).map(p => ({ id: p.id, uid: p.uid, name: p.name, place: st.find(x => x.pid === p.uid)?.place ?? 99, status: st.find(x => x.pid === p.uid)?.status ?? null }))
      .filter(c => c.status !== 'dnf').sort((a, b) => a.place - b.place);
  }
  function watch(on) {
    if (!on) { watching = null; game.hideCar(false); game.focus?.(null); return; }
    const list = cars();
    watching = { id: watching?.id ?? list[0]?.id ?? null, mode: watching?.mode ?? 'chase', tv: null };
    // (racing no more, or never: your own car out of the way of the view)
    if (!run || run.state === 'loaded' || run.state === 'out' || me()?.role === 'spectator') game.hideCar(true);
  }
  function nextCar(d = 1) {
    if (!watching) return;
    const list = cars();
    if (!list.length) return;
    const i = list.findIndex(c => c.id === watching.id);
    watching.id = list[((i < 0 ? 0 : i + d) % list.length + list.length) % list.length].id;
    watching.tv = null;
  }
  function nextCamera() { if (watching) { watching.mode = CAMERAS[(CAMERAS.indexOf(watching.mode) + 1) % CAMERAS.length]; watching.tv = null; } }
  // (the camera, if watching: true when it placed it)
  function camera(cam, dt) {
    if (!watching || !run?.M) return false;
    if (watching.id == null || !cars().some(c => c.id === watching.id)) { const l = cars(); watching.id = l[0]?.id ?? null; }
    const c = watching.id != null ? run.M.car(watching.id) : null, v = c?.handle ? game.carView(c.handle) : null;
    if (!v) return false;
    const [x, y, z] = v.pos, [qx, qy, qz, qw] = v.quat;
    game.focus?.(v.pos);                 // (the world's ground streamed round the car being watched)
    const fx = 2 * (qx * qz + qw * qy), fz = 1 - 2 * (qx * qx + qy * qy), n = Math.hypot(fx, fz) || 1, f = [fx / n, fz / n];
    let p, look, fov = 60;
    if (watching.mode === 'chase') { p = [x - f[0] * 7, y + 2.6, z - f[1] * 7]; look = [x + f[0] * 4, y + 1, z + f[1] * 4]; }
    else if (watching.mode === 'in-car') {
      // (the driver's seat: a little left of the middle, at head height — and looking down the road)
      const lx = f[1], lz = -f[0];
      p = [x + lx * 0.35 - f[0] * 0.1, y + 1.1, z + lz * 0.35 - f[1] * 0.1]; look = [x + f[0] * 30, y + 0.9, z + f[1] * 30]; fov = 72;
    } else {
      // (the TV camera covering where the car is: the nearest beside the route, kept while it still sees the car well)
      const world = game.toWorld([x, y, z]);
      const d = k => Math.hypot(k.x - world[0], k.z - world[2]);
      if (!watching.tv || d(watching.tv) > 150) watching.tv = run.tv?.reduce((b, k) => !b || d(k) < d(b) ? k : b, null) ?? null;
      if (!watching.tv) { p = [x - f[0] * 7, y + 2.6, z - f[1] * 7]; look = [x, y + 1, z]; }
      else { p = game.toSim([watching.tv.x, watching.tv.y, watching.tv.z]); look = [x, y + 0.8, z]; fov = zoom(d(watching.tv)); }
    }
    // (eased a little: no jolt as the car bumps; cut at once on a camera change)
    const k = watching.at && watching.mode !== 'tv' ? 1 - Math.exp(-dt * 12) : 1;
    watching.at = watching.at && k < 1 ? watching.at.map((a, i) => a + (p[i] - a) * k) : p;
    cam.position.set(...watching.at); cam.up.set(0, 1, 0); cam.lookAt(look[0], look[1], look[2]);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    return true;
  }

  // ---------- car-to-car contact (Phase 7 Step 3; docs/CONTACT.md) ----------
  // the other racers as the contact needs them: their net ids, body boxes and masses (the server's word on the car)
  function othersOf() {
    const out = new Map(), net = S.race?.net;
    if (!net) return out;
    for (const p of S.lobby?.players ?? []) {
      if (p.uid === S.myUid || p.npc || p.role !== 'racer') continue;
      const np = [...net.players.values()].find(x => x.uid === p.uid);
      const mine = game.carPhysics();
      if (np) out.set(p.uid, { id: np.id, box: p.car?.box ?? mine.box, mass: p.car?.mass ?? mine.mass, name: p.name });
    }
    return out;
  }
  function contactOn(r) {
    const sim = game.sim?.();
    if (!sim || r.C) return;
    r.recorder = createRunRecorder({ sim, toWorld: game.toWorld, clock: simT => (simT + (r.offset ?? 0)) * 1000 });
    r.C = createContactClient({ sim, net: S.race.net, send: m => S.send(m), cfg: cfg.contact, myUid: S.myUid, mine: () => game.carPhysics(), others: othersOf,
      roomAt: simT => (simT + (r.offset ?? 0)) * 1000, mode: () => S.lobby?.settings?.collisions ?? 'ghost', recorder: r.recorder, toSim: game.toSim, toWorld: game.toWorld,
      onImpact: (impact, { scale }) => game.contactHit?.(impact, { scale }), onEffect: e => game.contactEffect?.(e) });
  }

  function end() {
    const r = run;
    run = null; watching = null;
    if (!r) return;
    r.C?.dispose(); if (r.recorder?.on) r.recorder.stop(); r.overlay?.dispose(); replayView?.close();
    game.setOpacity?.('me', 1);
    r.detach?.(); r.dressing?.dispose(); r.A?.dispose(); void r.M?.leave();
    game.hideCar(false); game.focus?.(null); game.realTime?.(false);
  }

  const api = {
    get state() { return run?.state ?? 'idle'; },
    get run() { return run; },
    get progress() { return run?.progress ?? ''; },
    get watching() { if (!watching) return null; const c = cars().find(x => x.id === watching.id); return { id: watching.id, name: c?.name ?? null, place: c?.place ?? null, mode: watching.mode }; },
    get racing() { return !!run && (run.state === 'grid' || run.state === 'racing'); },
    get lap() { const H = run?.Q?.hud?.(); return H ? { lap: H.lap, laps: H.laps } : null; },
    get drawn() { return run?.M ?? null; },          // (the others' cars as drawn: play/multiplayer.js's — .car(id))
    get contact() { return run?.C ?? null; },
    scrape() { return run?.C?.scrape() ?? null; },
    watch, nextCar, nextCamera, camera, cars,
    clock() { const g = goAt(), now = S.race?.net.roomNow(); return g != null && now != null ? (now - g) / 1000 : null; },
    // the lights: five red coming on through the last lightsSec, all out at GO (track/lights.js), on the server's clock
    lights() {
      const g = goAt(), now = S.race?.net.roomNow(), L = cfg.race.lightsSec;
      if (g == null || now == null || !['countdown', 'racing'].includes(S.phase)) return { red: 0, green: false };
      const left = (g - now) / 1000;
      return left > 0 ? (left > L ? { red: 0, green: false, waiting: true } : startLights({ phase: 'countdown', left, total: L })) : startLights({ phase: 'go', since: -left });
    },
    frame(dt) {
      const r = run;
      if (!r) return;
      r.A?.frame?.();
      if (r.course && r.dressing) { const c = game.carNow(); r.dressing.update?.(c.x, c.z); }
      if (r.state === 'loaded' && ['countdown', 'racing'].includes(S.phase) && me()?.role === 'racer' && me()?.slot != null) toGrid(r);
      // (the step's moment on the server's clock — as this car's states are stamped for it: the physics' time plus where
      // that clock stands now. The run and the server's view of the same car then agree to the millisecond)
      if (r.Q && S.race?.net) r.offset = S.race.net.stampAt() / 1000 - game.simTime();
      // your car to the others: once it's on its slot, while racing (not in the lobby, not while watching)
      const sending = r.state === 'grid' || r.state === 'racing' || r.state === 'finished';
      r.M?.frame(dt, () => sending ? game.localState() : null);
      // the contact: who's near (drawn nearer the present), the proxies; ghosts drawn see-through — yours too
      if (r.C) {
        r.C.frame(dt);
        for (const [uid, o] of othersOf()) game.setOpacity?.(o.id, r.C.opacity(uid));
        game.setOpacity?.('me', r.C.opacity(S.myUid));
        if (r.overlay?.shown && (r.overlayAt = (r.overlayAt ?? 0) - dt) <= 0) { r.overlayAt = 0.2; r.overlay.update(); }
      }
    },
    get auto() { return !!run?.pilot && run.released && (run.state === 'racing' || run.state === 'finished'); },
    autoInput(dt) {
      const c = game.carNow();
      const cmd = run.pilot.drive({ x: c.x, z: c.z, fx: Math.sin(c.heading * Math.PI / 180), fz: Math.cos(c.heading * Math.PI / 180), speed: c.forward, dt });
      return { throttle: cmd.throttle, brake: cmd.brake, steer: cmd.steer, handbrake: false, device: 'wheel' };
    },
    // R (back on the road): the quest's own reset — the last checkpoint, by the tracker
    resetNow() {
      const r = run, Q = r?.Q;
      if (!Q || Q.state.state !== 'racing' || !r.A.ready()) return false;
      const point = Q.tracker.resetPoint();
      r.A.resetTo(point); Q.noteReset(point); r.M?.reset();
      return true;
    },
    end,
    dispose() { end(); for (const f of offs) f(); },
  };
  return api;
}
