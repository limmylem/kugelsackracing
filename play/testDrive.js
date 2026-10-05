// A route driven for real (Phase 4 Step 2: the editor's test drive): the car on grid slot 1, a countdown,
// then the route's tracker (route/tracker.js) on — checkpoints in order, laps, the finish, "Return to
// route" and the reset to the last checkpoint (the damage kept, as Phase 3's resets keep it), the wrong
// way — with the route dressed on the road (play/routeDressing.js), a HUD, and the line driven recorded
// with its speed. Nothing here earns or spends anything; the session's trial keeps nothing of the car.
//
//   const R = createRouteRun({ THREE, w, rw, compiled, course, laps, resetCar, onEnd })
//     w: the game's Map v3 world; rw: map/render/game (travelTo, holdCar, releaseCar)
//   R.frame(seconds)   each frame, after the physics     R.end()   stop now (F2)     R.state
//   R.resetNow()   the player's reset (R): back to the last checkpoint passed, as the corridor's reset
//   R.autoInput()  with autopilot: true (the browser tests), the input that drives it round
//   onEnd(result: { finished, time, lapTimes, splits, resets, line: [{ x, z, v }], encoded })

import { createTracker } from '../route/tracker.js';
import { createAutopilot } from '../route/autopilot.js';
import { createRouteDressing } from './routeDressing.js';
import { encodeLine } from '../route/geometry.js';

const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const CSS = `#routeHud{position:fixed;top:78px;left:50%;transform:translateX(-50%);z-index:40;pointer-events:none;font:600 15px Barlow,system-ui,sans-serif;color:#fff;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.6)}
#routeHud .t{font:700 34px "JetBrains Mono",monospace}#routeHud .row{opacity:.9}
#routeHud .big{position:fixed;top:38%;left:50%;transform:translate(-50%,-50%);font:800 44px Barlow,system-ui,sans-serif;letter-spacing:.04em;white-space:nowrap}
#routeHud .big.warn{color:#ffbd4a}#routeHud .big.bad{color:#ff5a4a}#routeHud .big.go{color:#7ee08a}
#routeHud .card{position:fixed;top:30%;left:50%;transform:translateX(-50%);background:rgba(14,18,26,.9);border-radius:12px;padding:14px 22px;font-size:15px}`;

export function createRouteRun({ THREE, w, rw, compiled: c, course = {}, laps = 1, resetCar, onEnd, autopilot = false }) {
  if (!document.getElementById('routeHudCss')) { const st = document.createElement('style'); st.id = 'routeHudCss'; st.textContent = CSS; document.head.appendChild(st); }
  const hud = document.createElement('div'); hud.id = 'routeHud'; document.body.appendChild(hud);
  const S = w.stream, slot = c.grid.slots[0];
  const tracker = createTracker({ line: c.line, loop: c.loop, startS: c.grid.startS, finishS: c.grid.finishS, checkpoints: c.checkpoints, laps: c.loop ? laps : 1, corridor: { margin: course.corridor?.margin ?? 8 } });
  const dressing = createRouteDressing({ THREE, parent: S.world, compiled: c, guides: course.guides });
  const samples = [];
  let lastSim = null;
  let phase = 'placing', count = 3, message = null, messageFor = 0, resets = 0, sampleT = 0, endedAt = null, done = false, result = null, sinceGo = 0;
  rw.travelTo(w, { xz: [slot.x, slot.z], heading: slot.heading });
  const pilot = autopilot ? createAutopilot(c.line, { loop: c.loop }) : null;
  const backTo = (point, why) => { resets++; resetCar(point); rw.travelTo(w, { xz: [point.x, point.z], heading: point.heading }); tracker.resetTo(point); say(why, 'warn', 2); };
  const say = (text, cls = '', secs = 2) => { message = { text, cls }; messageFor = secs; };

  function draw() {
    const T = tracker.state, total = tracker.required.length;
    const lap = c.loop && laps > 1 ? `<div class="row">Lap ${Math.min(T.lap + 1, laps)} / ${laps}</div>` : '';
    hud.innerHTML = `<div class="t">${fmt(T.time)}</div><div class="row">${total ? `Checkpoint ${Math.min(T.next, total)} / ${total}` : ''}${T.extension ? ` · +${T.extension}s` : ''}</div>${lap}
      ${phase === 'countdown' ? `<div class="big ${count > 0 ? '' : 'go'}">${count > 0 ? Math.ceil(count) : 'GO'}</div>` : ''}
      ${phase === 'placing' ? '<div class="big">Getting to the start…</div>' : ''}
      ${T.wrongWay ? '<div class="big bad">WRONG WAY</div>' : T.offRoute ? `<div class="big warn">Return to route ${Math.max(0, 5 - T.offFor).toFixed(0)}</div>` : message ? `<div class="big ${message.cls}">${message.text}</div>` : ''}
      ${phase === 'finished' ? `<div class="card"><b>${result.finished ? `Finished: ${fmt(result.time)}` : 'Ended'}</b>${result.lapTimes.length > 1 ? `<br>Laps: ${result.lapTimes.map(fmt).join(' · ')}` : ''}${resets ? `<br>${resets} reset${resets > 1 ? 's' : ''}` : ''}<br><span style="opacity:.7">F2: back to the editor</span></div>` : ''}`;
  }

  function finish(finished) {
    if (phase === 'finished') return;
    phase = 'finished'; endedAt = performance.now();
    const T = tracker.state;
    result = { finished, time: Math.round(T.time * 100) / 100, lapTimes: T.lapTimes.slice(), splits: T.splits.slice(), resets, line: samples.slice(), bonus: T.bonus.length };
    result.encoded = samples.length > 1 ? encodeLine(samples.map(p => { const [lat, lon] = S.projection.toLatLon(p.x, p.z); return { lat, lon, h: p.v, w: 0 }; })) : null;
    draw();
  }
  function end() {
    if (done) return;
    done = true;
    if (phase !== 'finished') finish(false);
    hud.remove(); dressing.dispose();
    onEnd?.(result);
  }

  return {
    // (count: seconds to GO in the countdown; sinceGo: since it — a dressed track's start lights follow them)
    get state() { return { phase, ...tracker.state, resets, dressing: dressing.stats, count, sinceGo }; },
    tracker, dressing, end,
    get auto() { return !!pilot && phase === 'driving'; },
    resetNow() { if (phase === 'driving' && !w.spawning) backTo(tracker.resetPoint(), 'Back to the last checkpoint'); },
    autoInput() {
      // (its time: the simulation's, as the tracker's)
      const now = w.sim.time ?? 0, dt = lastSim == null ? 0 : Math.max(0, now - lastSim); lastSim = now;
      const b = w.sim.vehicle.body, p = b.translation(), q = b.rotation(), v = b.linvel(), [x, z] = S.toWorld(p.x, p.z);
      const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), m = Math.hypot(fx, fz) || 1;
      const cmd = pilot.drive({ x, z, fx: fx / m, fz: fz / m, speed: (v.x * fx + v.z * fz) / m, dt });
      return { throttle: cmd.throttle, brake: cmd.brake, steer: cmd.steer, handbrake: false, device: 'wheel' };
    },
    frame(seconds) {
      if (done) return;
      const b = w.sim.vehicle.body, p = b.translation(), [x, z] = S.toWorld(p.x, p.z), v = b.linvel();
      dressing.update(x, z);
      if (phase === 'placing') { if (!w.spawning) { rw.holdCar(w); tracker.begin(x, z); phase = 'countdown'; count = 3; } draw(); return; }
      if (phase === 'countdown') { count -= seconds; if (count <= 0) { rw.releaseCar(w); tracker.start(); phase = 'driving'; sinceGo = 0; say('GO', 'go', 0.8); } draw(); return; }
      sinceGo += seconds;
      if (phase === 'finished') { draw(); if (performance.now() - endedAt > 4000 && result.finished) end(); return; }
      if (w.spawning) { draw(); return; }               // (being put back on the road)
      for (const e of tracker.update(seconds, { x, z, vx: v.x, vz: v.z })) {
        if (e.type === 'checkpoint') say(e.bonus ? `Bonus${e.extension ? ` +${e.extension}s` : ''}` : `${e.number} / ${e.of}  ${fmt(e.time)}`, 'go', 1.4);
        else if (e.type === 'missed') say(e.message, 'bad', 3);
        else if (e.type === 'lap') say(`Lap ${e.lap} · ${fmt(e.lapTime)}`, 'go', 2);
        else if (e.type === 'reset') backTo(e.point, 'Back to the last checkpoint');
        else if (e.type === 'finish') finish(true);
      }
      sampleT += seconds;
      if (sampleT >= 0.1) { sampleT = 0; samples.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, v: Math.round(Math.hypot(v.x, v.z) * 10) / 10 }); }
      messageFor -= seconds; if (messageFor <= 0) message = null;
      draw();
    },
  };
}
