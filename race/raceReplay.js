// The race replay (Phase 5 Step 4): every car of a race recorded as the ghosts are (quest/recording.js,
// the Phase 4 format: 20 samples a second, a few kB a car a minute), and played back after it — from the
// track's TV cameras (track/cameras.js: cutting from one to the next as the car it follows goes round, the
// lens zoomed to keep it framed), behind a car, or from inside it; played, paused, faster or slower,
// skipped back and on. Pure (no drawing): the game puts each car where pose() says and the view where
// camera() says.
//
//   const R = createRaceRecording({ hz })
//     R.sample(t, cars)   each physics step: cars [{ id, name, colour, player, x, y, z, q: [x, y, z, w], vx, vy, vz }]
//     R.note(t, type, info)   a moment worth skipping to (an overtake, a crash)
//     R.finish() → { hz, duration, cars: [{ id, name, colour, player, offset, rec }], events }
//   const P = createRacePlayer(recording, { cameras, data })   (cameras/data: a generated track's, for the TV view)
//     P.step(dt)  P.play() P.pause() P.toggle()  P.setSpeed(x)  P.skip(seconds)  P.nextEvent()
//     P.mode ('tv' | 'chase' | 'incar')  P.setMode(m)  P.cycleMode()  P.focus (car id)  P.nextCar(±1)
//     P.pose(id) → { position: [x, y, z], rotation: { x, y, z, w } } or null   P.camera() → { position, target, fov, name }

import { createRecorder, decodeRecording } from '../quest/recording.js';
import { cameraFor, zoom } from '../track/cameras.js';

export const SPEEDS = [0.25, 0.5, 1, 2, 4];
export const MODES = ['tv', 'chase', 'incar'];

export function createRaceRecording({ hz = 20 } = {}) {
  const cars = new Map(), events = [];
  let t0 = null, last = 0;
  return {
    sample(t, list) {
      t0 ??= t;
      const rel = t - t0;
      last = Math.max(last, rel);
      for (const c of list) {
        let e = cars.get(c.id);
        if (!e) cars.set(c.id, e = { id: c.id, name: c.name ?? null, colour: c.colour ?? null, player: !!c.player, offset: Math.round(rel * 1000) / 1000, recorder: createRecorder({ hz }) });
        e.recorder.sample(rel - e.offset, c);
      }
    },
    note(t, type, info = {}) { if (t0 != null) events.push({ t: Math.round((t - t0) * 100) / 100, type, ...info }); },
    get duration() { return last; },
    finish() {
      return { hz, duration: Math.round(last * 1000) / 1000, events: events.slice(), cars: [...cars.values()].map(e => ({ id: e.id, name: e.name, colour: e.colour, player: e.player, offset: e.offset, rec: e.recorder.finish({ car: e.name }) })) };
    },
  };
}

const lerp = (a, b, k) => a + (b - a) * k;
function slerpish(a, b, k) {
  // (nlerp, the shorter way round: close enough between samples a twentieth of a second apart)
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = d < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map(j => lerp(a[j], b[j] * s, k)), m = Math.hypot(...q) || 1;
  return { x: q[0] / m, y: q[1] / m, z: q[2] / m, w: q[3] / m };
}
const rotate = (q, v) => {
  const { x, y, z, w } = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};

export function createRacePlayer(recording, { cameras = null, data = null } = {}) {
  const cars = recording.cars.map(c => ({ ...c, samples: decodeRecording(c.rec) }));
  const end = Math.max(0, ...cars.map(c => c.offset + (c.samples.at(-1)?.t ?? 0)));
  const events = (recording.events ?? []).slice().sort((a, b) => a.t - b.t);
  let t = 0, speed = 1, paused = false, mode = cameras?.length ? 'tv' : 'chase';
  let focus = (cars.find(c => c.player) ?? cars[0])?.id ?? 0, tvCam = null, nearI = null;
  const byId = id => cars.find(c => c.id === id);
  function sampleAt(c, time) {
    const S = c.samples, local = time - c.offset;
    if (!S.length || local < 0) return null;
    const f = Math.min(S.length - 1, Math.max(0, local * recording.hz)), i = Math.min(S.length - 2, Math.floor(f)), k = S.length > 1 ? Math.min(1, f - i) : 0;
    const a = S[Math.max(0, i)], b = S[Math.min(S.length - 1, i + 1)];
    return { position: [lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k)], rotation: slerpish(a.q, b.q, k), speed: Math.hypot(lerp(a.vx, b.vx, k), lerp(a.vz, b.vz, k)) };
  }
  // the track point nearest the car (searched near the last one; all of it at first or after a jump)
  function trackIndex(p) {
    const X = data.centre.x, Z = data.centre.z, n = X.length;
    const span = nearI == null ? n : 60;
    let best = nearI ?? 0, bd = Infinity;
    for (let s = -span; s <= span; s++) {
      const i = nearI == null ? s + span : ((nearI + s) % n + n) % n;
      if (i < 0 || i >= n) continue;
      const d = (X[i] - p[0]) ** 2 + (Z[i] - p[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    nearI = bd > 900 && nearI != null ? null : best;
    return best;
  }
  const P = {
    cars, events,
    get t() { return t; }, get end() { return end; }, get speed() { return speed; }, get paused() { return paused; }, get mode() { return mode; }, get focus() { return focus; },
    get done() { return t >= end; },
    step(dt) { if (!paused) t = Math.min(end, t + dt * speed); if (t >= end) paused = true; return t; },
    play() { if (t >= end) t = 0; paused = false; }, pause() { paused = true; }, toggle() { paused ? P.play() : P.pause(); },
    setSpeed(x) { speed = SPEEDS.includes(x) ? x : 1; },
    faster(d = 1) { speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + d))] ?? 1; },
    skip(seconds) { t = Math.max(0, Math.min(end, t + seconds)); nearI = null; tvCam = null; },
    seek(time) { t = Math.max(0, Math.min(end, time)); nearI = null; tvCam = null; },
    // on to the next moment worth seeing (an overtake, a crash), from a couple of seconds before it
    nextEvent() { const e = events.find(x => x.t - 2 > t + 0.5); if (e) { P.seek(e.t - 2); if (e.id != null && byId(e.id)) focus = e.id; } return e ?? null; },
    setMode(m) { if (MODES.includes(m) && (m !== 'tv' || cameras?.length)) mode = m; },
    cycleMode() { const list = MODES.filter(m => m !== 'tv' || cameras?.length); mode = list[(list.indexOf(mode) + 1) % list.length]; },
    nextCar(d = 1) { const k = cars.findIndex(c => c.id === focus); focus = cars[((k + d) % cars.length + cars.length) % cars.length].id; nearI = null; tvCam = null; },
    pose(id) { const c = byId(id); return c ? sampleAt(c, t) : null; },
    camera() {
      const p = P.pose(focus) ?? P.pose(cars[0]?.id);
      if (!p) return null;
      const target = [p.position[0], p.position[1] + 0.7, p.position[2]];
      if (mode === 'tv' && cameras?.length && data) {
        tvCam = cameraFor(cameras, data, trackIndex(p.position), tvCam);
        const pos = [tvCam.x, tvCam.y, tvCam.z];
        return { position: pos, target, fov: zoom(Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2])), name: tvCam.name, kind: 'tv' };
      }
      if (mode === 'incar') {
        const eye = rotate(p.rotation, [0.32, 1.12, -0.15]), ahead = rotate(p.rotation, [0.32, 1.0, 20]);
        return { position: [p.position[0] + eye[0], p.position[1] + eye[1], p.position[2] + eye[2]], target: [p.position[0] + ahead[0], p.position[1] + ahead[1], p.position[2] + ahead[2]], fov: 70, name: 'in-car', kind: 'incar' };
      }
      const back = rotate(p.rotation, [0, 0, 1]), m = Math.hypot(back[0], back[2]) || 1;
      return { position: [p.position[0] - back[0] / m * 7.5, p.position[1] + 2.6, p.position[2] - back[2] / m * 7.5], target: [p.position[0] + back[0] / m * 4, p.position[1] + 1, p.position[2] + back[2] / m * 4], fov: 58, name: 'chase', kind: 'chase' };
    },
  };
  return P;
}
