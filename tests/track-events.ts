// Gameplay on generated tracks, driven for real (Phase 5 Step 3; npm run test:track-events): in the physics,
// through the game's own quest controller, NPC racers and PlayerService (tests/trackHarness.ts):
//   - every event type finishes with a valid result on 20 random tracks, solo and against NPCs (a circuit
//     race, a hot lap, a hillclimb / sprint, an endurance race, a drift: the hot lap and the drift solo, as
//     the game runs them) — checked (quest/validate.js), paid, its track's hash on it
//   - a trip from the real world to a track and back, 100 times: the car back on the very spot, the damage
//     done on the track still on it (and the other way), and memory not growing
//   - the day's and the week's tracks: the same date the same track (and hash), other dates others
//   - a shared code: the identical track, hash for hash, made again and sent baked
//   - the AI reference times: the same run after run; the medal targets from them by the rules
//   - the economy simulation with track events in it: every target met (data/economy.json simulation.targets)
//
//   node --expose-gc tests/track-events.ts [--tracks 20] [--trips 100] [--only events,trips,dates,codes,reference,economy]

import fs from 'node:fs';
import { harness } from './harness.mjs';
import { makeTrack, simOn, trackReference, raceEvent, tracksCfg as TC, eventsCfg as E } from './trackHarness.ts';
import { playerService, qcfg } from './map/raceHarness.ts';
import { newTrackEvent, dailyTrack, weeklyTrack, sharedTrack, quickTrack, trackInfo, trackName } from '../track/events/model.js';
import { readyEvent, eventCourse } from '../track/events/prepare.js';
import { trackHash, packTrack, unpackTrack } from '../track/events/hash.js';
import { createMemoryRefCache } from '../track/events/reference.js';
import { createTrackTrip } from '../play/trackTrip.js';
import { buildTrack } from '../track/build.js';
import { generateTrack } from '../track/generate.js';
import { createSimulation } from '../physics/sim.js';
import { validateResult } from '../quest/validate.js';
import { medalTargets } from '../quest/rules.js';
import { makePool, simulate, crashCostTable } from '../tools/economy/sim.mjs';
import { evaluate } from '../tools/economy/report.mjs';

const args = process.argv.slice(2), opt = (n: string, d: any) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', null)?.split(','), want = (k: string) => !only || only.includes(k);
const H: any = await harness();
let failed = 0;
const report = (ok: boolean, name: string, detail: string) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(52)} ${detail}`); };
const P = TC.presets;

// ---------- every event type on random tracks, solo and with NPCs ----------
if (want('events')) {
  const N = +opt('--tracks', 20), fails: string[] = [], byType: any = {};
  const t0 = performance.now();
  for (let k = 0; k < N; k++) {
    const pr = P[k % P.length], T: any = makeTrack({ seed: 6007 * k + 17, params: pr.params }), info = trackInfo(T.gen);
    const track = { code: T.gen.code, kind: 'quick', name: trackName(T.gen.seed, { theme: info.theme, layout: info.layout }), info, version: T.gen.version };
    const runs = info.layout === 'loop'
      ? [['circuit_race', 0, { laps: 2 }], ['circuit_race', 3, { laps: 2 }], ['hot_lap', 0, { laps: 2 }], ['endurance', 0, { laps: 2, stints: 2 }], ['endurance', 3, { laps: 2, stints: 2 }], ['drift', 0, {}]]
      : [['hillclimb', 0, {}], ['hillclimb', 3, {}], ['drift', 0, {}]];
    const player = await playerService(H);
    await player.addXp(1e6);           // (every tier open: the tracks' events are of every difficulty)
    for (const [type, npcs, params] of runs as any[]) {
      const ev = newTrackEvent({ id: `trk_test_${k}_${type}_${npcs}`, track, type, params, npc: npcs ? { count: npcs, skill: [0.4, 0.8], drivers: 'random' } : {} });
      const { event } = readyEvent(ev, T.data, null, { config: qcfg });
      const label = `${type}${npcs ? ` +${npcs}` : ' solo'}`, row = byType[label] ??= { ok: 0, n: 0 };
      row.n++;
      try {
        const out: any = await raceEvent(H, T, event, { npcs, seed: k + 1, player });
        const res = out.res, o = res?.outcome, r = res?.result;
        const v = r ? validateResult(r, { quest: event, course: T.course, config: qcfg }) : { ok: false, problems: ['no result'] };
        const good = o?.status === 'finished' && v.ok && res.pay?.valid && r.track?.hash === T.course.trackHash && r.track.hash === event.track.hash && (!npcs || (r.place != null && r.field?.length === npcs + 1)) && (type !== 'endurance' || r.stints?.length === 2);
        if (good) row.ok++; else fails.push(`${label} on ${pr.id} ${T.gen.code}: ${o?.status ?? 'no outcome'}${o?.reason ? ` (${o.reason})` : ''}${v.ok ? '' : ` — ${v.problems.join('; ')}`}${res?.pay?.valid === false ? ` — not paid: ${res.pay.problems?.join('; ')}` : ''}`);
      } catch (e: any) { fails.push(`${label} on ${pr.id} ${T.gen.code}: threw ${e.message}`); }
    }
    console.log(`        ${k + 1} of ${N} tracks (${pr.id}, ${info.km} km) · ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  for (const f of fails.slice(0, 12)) console.log(`        ${f}`);
  for (const [label, r] of Object.entries(byType) as any) report(r.ok === r.n, `${label}: a valid result on every track`, `${r.ok} of ${r.n} finished, checked and paid, the track's hash on it`);
}

// ---------- the trip from the real world and back, 100 times ----------
if (want('trips')) {
  const trips = +opt('--trips', 100), spec = H.garage(null, 'starter_car').stats().spec;
  const player = await playerService(H), carId = player.profile.currentCar;
  // the real world: a world of its own (the test centre), the car driven somewhere on it
  const real = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
  for (let i = 0; i < 240; i++) real.step({ device: 'wheel', throttle: 0.6, brake: 0, steer: 0.15, handbrake: false });
  const codes = [quickTrack('club_circuit', 5, TC).code, quickTrack('short_technical', 9, TC).code, quickTrack('coastal_sprint', 3, TC).code];
  const cache = createMemoryRefCache();
  let world: any = null, inTrack = false, worst = 0, damageOk = 0, arrivedOk = 0;
  const pose = (sim: any) => { const b = sim.vehicle.body, p = b.translation(), q = b.rotation(); return { x: p.x, y: p.y, z: p.z, heading: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)) * 180 / Math.PI }; };
  const shellOf = () => player.profile.cars[carId].damage?.condition ?? 100;
  const trip = createTrackTrip({ config: qcfg, adapters: {
    spot: () => ({ file: 'real', ...pose(real) }),
    async load(code: string) {
      // (one track kept at a time: another's world freed)
      if (world?.code !== code) { world?.sim.vehicle.world.free(); const T = makeTrack({ code }); world = { code, T, data: T.data, sim: simOn(H, T, spec) }; }
      return world;
    },
    reference: (h: any, cls: string) => trackReference(H, h.T, cls, { cache }),
    async enter(h: any, prepared: any) {
      const s = prepared.course.grid.slots[0];
      h.sim.resetCar({ position: [s.x, 0, s.z], headingDeg: s.heading });
      inTrack = true;
    },
    async back(spot: any) { real.resetCar({ position: [spot.x, spot.y, spot.z], headingDeg: spot.heading }); inTrack = false; },
  } });
  const mem: number[] = [];
  for (let k = 0; k < trips; k++) {
    const code = codes[k % codes.length], track = sharedTrack(code);
    const ev = newTrackEvent({ id: `trk_trip_${k % 3}`, track: { code, kind: 'shared', name: track.name, info: track.info, version: track.version }, type: track.info.layout === 'loop' ? 'hot_lap' : 'hillclimb' });
    const before = shellOf(), spot = pose(real);
    const r = await trip.go(ev);
    if (!r.ok || !inTrack) { report(false, 'the trip there', r.error ?? 'not on the track'); break; }
    // on the track: the same car, the same damage (the session's); a knock there
    if (shellOf() === before) arrivedOk++;
    for (let i = 0; i < 60; i++) world.sim.step({ device: 'wheel', throttle: 1, brake: 0, steer: 0, handbrake: false });
    await player.damageCar(carId, { shell: { condition: Math.max(5, before - 0.4) } }, { cause: 'test' });
    const leftWith = shellOf();
    const l = await trip.leave();
    const at = pose(real), d = Math.hypot(at.x - spot.x, at.z - spot.z), dh = Math.abs(((at.heading - spot.heading + 540) % 360) - 180);
    worst = Math.max(worst, d + dh / 100);
    if (l.ok && shellOf() === leftWith && leftWith < before) damageOk++;
    // (back in the real world, it drives on from there)
    for (let i = 0; i < 30; i++) real.step({ device: 'wheel', throttle: 0.4, brake: 0, steer: (k % 2) ? 0.2 : -0.2, handbrake: false });
    if (k % 10 === 9) { (globalThis as any).gc?.(); const m = process.memoryUsage(); mem.push((m.heapUsed + m.arrayBuffers) / 1048576); }
  }
  world?.sim.vehicle.world.free(); real.vehicle.world.free();
  report(worst < 0.05, `${trips} trips: back on the very spot`, `the furthest from where it left: ${(worst * 100).toFixed(1)} cm (heading included)`);
  report(arrivedOk === trips && damageOk === trips, `${trips} trips: damage carried both ways`, `${arrivedOk} arrived with the real world's damage, ${damageOk} came back with the track's`);
  const grow = mem.at(-1)! - mem[1];
  report(grow < 25, `${trips} trips: memory not growing`, `${mem.map(m => m.toFixed(0)).join(' → ')} MB (heap + buffers every 10 trips; ${grow >= 0 ? '+' : ''}${grow.toFixed(1)} MB from trip 20)`);
}

// ---------- the day's and the week's tracks ----------
if (want('dates')) {
  const day = (d: number) => Date.UTC(2026, 9, 1) + d * 864e5;
  let same = 0, sameHash = 0;
  for (let d = 0; d < 6; d++) {
    const a = dailyTrack(day(d) + 3600e3, E, TC), b = dailyTrack(day(d) + 22 * 3600e3, E, TC);
    if (a.code === b.code) same++;
    if (trackHash(buildTrack(a.gen, TC)) === trackHash(buildTrack(generateTrack({ code: b.code }), TC))) sameHash++;
  }
  const days = new Set(Array.from({ length: 120 }, (_, d) => dailyTrack(day(d), E, TC).code));
  const weeks = new Set(Array.from({ length: 52 }, (_, w) => weeklyTrack(day(w * 7), E, TC).code));
  const inWeek = new Set(Array.from({ length: 7 }, (_, d) => weeklyTrack(Date.UTC(2026, 9, 5) + d * 864e5, E, TC).code));
  report(same === 6 && sameHash === 6 && inWeek.size === 1, 'daily / weekly: the same date, the same track', `${same} of 6 days the same code all day, ${sameHash} of 6 the same hash built twice; one track all of a week (${inWeek.size})`);
  report(days.size === 120 && weeks.size === 52, 'daily / weekly: other dates, other tracks', `${days.size} different tracks in 120 days, ${weeks.size} in 52 weeks`);
}

// ---------- a shared code ----------
if (want('codes')) {
  let ok = 0, n = 0;
  for (let k = 0; k < 8; k++) {
    const pr = P[(k * 3) % P.length], g = generateTrack({ seed: 991 * k + 5, params: pr.params });
    if (!g.ok) continue;
    n++;
    const mine = trackHash(buildTrack(g, TC)), friends = trackHash(buildTrack(generateTrack({ code: g.code }), TC)), sent = trackHash(unpackTrack(packTrack(buildTrack(generateTrack({ code: g.code }), TC))));
    if (mine === friends && friends === sent) ok++;
  }
  report(ok === n, 'a shared code: the identical track, hash for hash', `${ok} of ${n} codes: the same hash made here, by a friend from the code, and sent baked`);
}

// ---------- the AI reference times ----------
if (want('reference')) {
  const rows: string[] = [];
  let same = 0, rules = 0, n = 0;
  for (const [preset, seed] of [['club_circuit', 21], ['coastal_sprint', 8]] as any) {
    const t = quickTrack(preset, seed, TC), A: any = makeTrack({ code: t.code }), B: any = makeTrack({ code: t.code });
    const ra = await trackReference(H, A, 'open'), rb = await trackReference(H, B, 'open');
    n++;
    if (JSON.stringify([ra.standing, ra.flying]) === JSON.stringify([rb.standing, rb.flying]) && ra.finished) same++;
    // the medal targets: gold the high skill's, silver the medium's, bronze the low's — a race's from its
    // standing lap and flying ones, a hot lap's best lap a flying one
    const ev = newTrackEvent({ id: 'trk_ref', track: { code: t.code, kind: 'quick', name: t.name, info: t.info }, type: t.info.layout === 'loop' ? 'circuit_race' : 'hillclimb', params: t.info.layout === 'loop' ? { laps: 3 } : {} });
    const { event, course } = readyEvent(ev, A.data, ra, { config: qcfg }), M = medalTargets(event, course, qcfg);
    const L = t.info.layout === 'loop' ? 3 : 1, f = (k: string) => Math.round((ra.standing[k] + (L - 1) * ra.flying[k]) * 10) / 10;
    let good = M.from === 'ai' && M.gold === f('high') && M.silver === f('medium') && M.bronze === f('low') && M.gold < M.silver && M.silver < M.bronze;
    if (t.info.layout === 'loop') { const hot = medalTargets(readyEvent({ ...ev, type: 'hot_lap', params: { laps: 3, mode: 'best_lap' } }, A.data, ra, { config: qcfg }).event, course, qcfg); good &&= hot.gold === ra.flying.high && hot.bronze === ra.flying.low; }
    if (good) rules++;
    rows.push(`${preset} ${t.info.km} km: standing ${JSON.stringify(ra.standing)}, flying ${JSON.stringify(ra.flying)} · ${event.rating.stars}★ · ${(ra.ms / 1000).toFixed(1)} s`);
  }
  for (const r of rows) console.log(`        ${r}`);
  report(same === n, 'reference times: the same run after run', `${same} of ${n} tracks timed twice: the same to the tenth`);
  report(rules === n, 'medal targets: from the reference laps, by the rules', `${rules} of ${n}: gold the high skill's, silver the medium's, bronze the low's (a race: the standing lap + flying laps; a hot lap: a flying lap)`);
}

// ---------- the economy with track events ----------
if (want('economy')) {
  const db = H.db, S = db.economy.simulation;
  console.log('        measuring crash repairs (the crash suite, every car)…');
  const crashTable = await crashCostTable(), pool = makePool(db.economy, qcfg, S.seed), runs: any = {};
  for (const [name, skill] of Object.entries(S.skills)) runs[name] = simulate({ db, config: qcfg, pool, crashTable, skill, hours: S.hours, seed: S.seed });
  const checks = evaluate(runs, db.economy), tracks = Object.values(runs).flatMap((r: any) => r.runLog.filter((x: any) => x.track));
  for (const c of checks) report(c.pass, `economy: ${c.name}`.slice(0, 52), c.detail);
  report(tracks.length > 0, 'economy: track events played', `${tracks.length} track event runs (${[...new Set(tracks.map((x: any) => x.type))].join(', ')}) among ${Object.values(runs).reduce((a: number, r: any) => a + r.runs, 0)}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
