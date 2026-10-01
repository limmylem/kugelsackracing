// Cameras for the test worlds, all set up from the car spec's `camera` section (editable live in the
// tuning panel):
//  - chase: behind the car with a little lag (it trails the car's heading and drifts back as the car
//    accelerates, closer as it brakes, out as it corners), sways a little with the body's roll and
//    pitch, and its field of view widens with speed
//  - bonnet: on the bonnet, fixed to the body
//  - cockpit: at the driver's head, looking out through the windscreen with the steering wheel in view;
//    the head leans with the g-forces and glances into turns
//  - side, high: views for watching the suspension and the car's line
// Road bumps, kerbs and very high speed add a subtle shake, and a crash a short hard one (shake(amount)).
// A loose bonnet flown up (snapshot.bonnetUp) blocks the bonnet camera's view as it does the driver's.
// Everything eases by time constants, so it behaves the same at any frame rate.

import * as THREE from 'three';

export const CAMERAS = ['chase', 'bonnet', 'cockpit', 'side', 'high'];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (dt, tau) => tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = Math.PI / 180;
// smooth, repeatable wobble (-1..1) at about f Hz
const wobble = (t, f, phase) => 0.6 * Math.sin(2 * Math.PI * f * t + phase) + 0.4 * Math.sin(2 * Math.PI * f * 1.731 * t + phase * 2.3 + 1.1);

export function createCameraRig() {
  const s = {
    mode: null, time: 0, yaw: 0, offset: new THREE.Vector3(), anchorY: 0, acc: new THREE.Vector3(), lastVel: null,
    roll: 0, pitch: 0, bumps: 0, head: new THREE.Vector3(), glance: 0, crash: 0,
  };
  const v3 = () => new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const tmp = { fwd: v3(), left: v3(), up: v3(), want: v3(), look: v3() };

  return {
    get mode() { return s.mode; },
    // jump straight to the car next time (a different car, or it was put somewhere else)
    reset() { s.mode = null; s.crash = 0; },
    // a crash: a jolt of amount 0..1 (a hard hit: 1), dying away in about a third of a second
    shake(amount) { s.crash = Math.min(1, Math.max(s.crash, amount)); },
    // camera: the THREE camera; car: the drawn car (a THREE object at the physics car's pose);
    // snap: the latest physics snapshot; C: spec.camera
    update(camera, car, snap, dt, mode, C) {
      const snapTo = mode !== s.mode;
      s.mode = mode;
      s.time += dt;
      const pos = car.position, quat = car.quaternion;
      const fwd = tmp.fwd.set(0, 0, 1).applyQuaternion(quat), left = tmp.left.set(1, 0, 0).applyQuaternion(quat), up = tmp.up.set(0, 1, 0).applyQuaternion(quat);
      const speed = Math.hypot(snap.velocity[0], snap.velocity[2]), kmh = speed * 3.6;

      // measured acceleration (world, smoothed) → g in the car's frame
      const vel = new THREE.Vector3(...snap.velocity);
      if (s.lastVel && dt > 0 && !snapTo) s.acc.lerp(vel.clone().sub(s.lastVel).divideScalar(dt), ease(dt, 0.25));
      else s.acc.set(0, 0, 0);
      s.lastVel = vel;
      const gLong = s.acc.dot(fwd) / 9.81, gLat = s.acc.dot(left) / 9.81;

      // body roll / pitch against the car's own heading (smoothed a touch)
      const roll = Math.asin(clamp(left.y, -1, 1)), pitch = Math.asin(clamp(-fwd.y, -1, 1));
      s.roll += (roll - s.roll) * ease(dt, 0.12);
      s.pitch += (pitch - s.pitch) * ease(dt, 0.12);

      // shake: suspension moving fast (bumps), wheels on kerbs, very high speed
      const Sh = C.shake;
      const hits = snap.wheels.reduce((a, w) => a + Math.max(0, Math.abs(w.compressionSpeed || 0) - 0.3), 0);
      s.bumps = Math.max(s.bumps * Math.exp(-dt / 0.3), Math.min(1, hits / 1.5));
      const kerb = snap.wheels.some(w => w.grounded && w.surface === 'kerb') ? smoothstep(2, 20, speed) : 0;
      const fast = smoothstep(Sh.shakeFrom, Sh.shakeFrom + 90, kmh);
      const t = s.time, ab = s.bumps * Sh.bumps, ak = kerb * Sh.kerbs, as = fast * Sh.speed;
      s.crash *= Math.exp(-dt / 0.12);
      const ac = s.crash ** 1.5;
      const shakeUp = 0.035 * ab * wobble(t, 7, 0.3) + 0.012 * ak * wobble(t, 22, 1.7) + 0.008 * as * wobble(t, 11, 2.9) + 0.12 * ac * wobble(t, 17, 0.8);
      const shakeSide = 0.02 * ab * wobble(t, 5, 4.1) + 0.006 * ak * wobble(t, 19, 0.6) + 0.006 * as * wobble(t, 9, 5.3) + 0.1 * ac * wobble(t, 13, 2.4);
      const shakeRoll = (0.5 * ab * wobble(t, 6, 2.2) + 0.25 * ak * wobble(t, 21, 3.3) + 0.15 * as * wobble(t, 12, 0.9) + 3 * ac * wobble(t, 15, 1.9)) * DEG;

      camera.up.set(0, 1, 0);
      let fov = C.chase.fov, near = 0.1;
      if (mode === 'chase') {
        const Ch = C.chase, carYaw = Math.atan2(fwd.x, fwd.z);
        if (snapTo) { s.yaw = carYaw; s.anchorY = pos.y; }
        s.yaw += wrap(carYaw - s.yaw) * ease(dt, Ch.headingLag);
        s.anchorY += (pos.y - s.anchorY) * ease(dt, 0.1);
        const ahead = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)), side = new THREE.Vector3(ahead.z, 0, -ahead.x);
        // where it wants to sit: behind and above, pushed back by acceleration and out by cornering
        const lag = new THREE.Vector3(s.acc.x, 0, s.acc.z).multiplyScalar(Ch.accelLag / 9.81);
        if (lag.length() > 1.5) lag.setLength(1.5);
        const want = tmp.want.copy(ahead).multiplyScalar(-Ch.distance).add(new THREE.Vector3(0, Ch.height, 0)).sub(lag);
        if (snapTo) s.offset.copy(want); else s.offset.lerp(want, ease(dt, Ch.positionLag));
        camera.position.set(pos.x, s.anchorY, pos.z).add(s.offset);
        camera.position.addScaledVector(side, shakeSide).y += shakeUp;
        // look just ahead of the car, nodding with its pitch; the horizon leans with its roll
        const look = tmp.look.set(pos.x, s.anchorY + Ch.lookHeight, pos.z).addScaledVector(ahead, Ch.lookAhead);
        look.y -= Math.tan(s.pitch * Ch.sway) * Ch.distance;
        camera.lookAt(look);
        camera.rotateZ(-s.roll * Ch.sway + shakeRoll);
        fov = Ch.fov + Ch.fovAtSpeed * Math.pow(clamp(kmh / Ch.fovSpeed, 0, 1), 1.5);
      } else if (mode === 'bonnet' || mode === 'cockpit') {
        const B = mode === 'bonnet' ? C.bonnet : C.cockpit, inside = mode === 'cockpit';
        // head: leans against the g-forces (out of the turn, back when accelerating), and glances into turns
        const headWant = inside ? new THREE.Vector3(clamp(-gLat, -1.2, 1.2) * B.headSway, 0, clamp(-gLong, -1.2, 1.2) * B.headSway * 0.7) : new THREE.Vector3();
        s.head.lerp(headWant, ease(dt, 0.15));
        s.glance += ((inside ? clamp((snap.yawRate || 0) * B.glance, -0.3, 0.3) : 0) - s.glance) * ease(dt, 0.3);
        const eye = new THREE.Vector3(...B.position).add(s.head).add(new THREE.Vector3(shakeSide * 0.5, shakeUp * 0.6, 0));
        // (a loose bonnet up against the windscreen: the bonnet camera is behind it too, and sees it)
        if (!inside && snap.bonnetUp > 0) eye.lerp(new THREE.Vector3(...C.cockpit.position), Math.min(1, snap.bonnetUp));
        camera.position.copy(eye.applyQuaternion(quat).add(pos));
        // face the car's +z (a camera looks down its own -z), then pitch down, glance, shake
        camera.quaternion.copy(quat).multiply(q.setFromEuler(e.set(0, Math.PI + s.glance, 0, 'YXZ'))).multiply(q.setFromEuler(e.set(-B.pitch * DEG, 0, shakeRoll * 0.6)));
        fov = B.fov + (C.chase.fovAtSpeed * 0.4) * Math.pow(clamp(kmh / C.chase.fovSpeed, 0, 1), 1.5);
        near = 0.03;
      } else {
        // side / high: follow the car on the flat
        const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), l2 = new THREE.Vector3(flat.z, 0, -flat.x);
        const want = mode === 'side' ? l2.clone().multiplyScalar(7).add(new THREE.Vector3(0, 1.2, 0)) : flat.clone().multiplyScalar(-18).add(new THREE.Vector3(0, 12, 0));
        if (snapTo) s.offset.copy(want); else s.offset.lerp(want, ease(dt, 0.2));
        camera.position.copy(pos).add(s.offset);
        camera.lookAt(pos.x, pos.y + 0.8, pos.z);
        fov = 60;
      }
      if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== near) { camera.fov = fov; camera.near = near; camera.updateProjectionMatrix(); }
    },
  };
}
