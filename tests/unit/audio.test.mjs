// The game's sound (Phase 8 Step 1; docs/AUDIO.md): the engine reacting at once to the throttle, revs and gears; the
// gear change's cut and clunk, the limiter's bounce, idle's wobble, starting and stalling; every part with sound
// settings changing the sound as it says (exhaust, intake, turbo, blow-off, supercharger, straight-cut gears, ECU);
// the tyres telling how near the grip limit they are; each surface its own; the cameras; Doppler; other cars' voices
// (the nearest six in full); the echo's surroundings; the limiter never past its ceiling; and no clicks — crossfading
// the loops, cutting the grains, changing gear, on the limiter, starting, stopping. All on the very code the
// AudioWorklet runs (audio/dsp.js), rendered here from the sound files. npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { soundHarness, render, rms, peak, spectrum, centroid, band, toneAt, clicks, tonalBank, Bank, ChassisVoice, Limiter, SR } from '../audioHarness.mjs';
import { root } from '../harness.mjs';
import { SURFACES } from '../../audio/dsp.js';
import { tyreSound, surfaceMix, viewMix, doppler, rankVoices, surroundings, engineInput, remoteEngineInput, BrakeSqueal, Bumps } from '../../audio/mix.js';
import { mergeSound } from '../../garage/carSound.js';
import { areaTheme } from '../../audio/environment.js';

const S = await soundHarness(), A = JSON.parse(fs.readFileSync(path.join(root, 'data/audio.json'), 'utf8'));
const stock = S.spec('starter_car'), E = stock.engine;
const CLICK = 0.005;      // (a step of a tenth of a percent of full scale, or a 10% jump in level: tests/audioHarness.mjs clicks)
const at = (x, t0, t1) => rms(x, Math.round(t0 * SR), Math.round(t1 * SR));
const steady = (rpm, o = {}) => () => ({ rpm, throttle: 0.6, pedal: 0.6, load: 0.6, gear: 3, ...o });

// ---------- the engine ----------

test('louder and brighter with the revs and the load; on load brighter than off; granular and layers alike', () => {
  for (const mode of ['granular', 'layers']) {
    const lvl = rpm => { const v = S.engine(stock, { mode, mute: { intake: false } }); return at(render(v, 1.2, steady(rpm, { throttle: 1, pedal: 1, load: 1 }), { channels: [0] }), 0.6, 1.2); };
    const low = lvl(1500), mid = lvl(3500), high = lvl(6000);
    assert.ok(mid > low * 1.25 && high > mid * 1.25 && high > low * 1.8, `${mode}: ${low.toFixed(4)} → ${mid.toFixed(4)} → ${high.toFixed(4)}`);
    const tone = load => { const v = S.engine(stock, { mode, mute: { intake: false } }); return centroid(spectrum(render(v, 1.2, steady(4000, { load, throttle: Math.max(0, load), pedal: Math.max(0, load) }), { channels: [0] }), Math.round(0.6 * SR), 16384)); };
    assert.ok(tone(1) > tone(-0.8) * 1.15, `${mode}: on load ${tone(1).toFixed(0)} Hz, off ${tone(-0.8).toFixed(0)} Hz`);
  }
});

test('reacts at once: a stab of throttle is heard within 60 ms, a lift within 60 ms', () => {
  const v = S.engine(stock), x = render(v, 2, t => t < 1 ? steady(3000, { throttle: 0.05, pedal: 0.05, load: -0.6 })() : steady(3000, { throttle: 1, pedal: 1, load: 1 })(), { channels: [0, 1] });
  const before = at(x, 0.8, 1), after = at(x, 1.5, 2), w = 0.01;
  let t50 = null;
  for (let t = 1; t < 1.5; t += w) if (at(x, t, t + w) - before > (after - before) * 0.5) { t50 = t - 1; break; }
  assert.ok(after > before * 1.5 && t50 != null && t50 <= 0.06, `on throttle: ${before.toFixed(4)} → ${after.toFixed(4)}, half way in ${(t50 * 1000).toFixed(0)} ms`);
  const y = render(S.engine(stock), 2, t => t < 1 ? steady(4000, { throttle: 1, pedal: 1, load: 1 })() : steady(4000, { throttle: 0, pedal: 0, load: -0.9 })(), { channels: [0, 1] });
  const on = at(y, 0.8, 1), off = at(y, 1.5, 2);
  let d50 = null;
  for (let t = 1; t < 1.5; t += w) if (on - at(y, t, t + w) > (on - off) * 0.5) { d50 = t - 1; break; }
  assert.ok(off < on * 0.7 && d50 != null && d50 <= 0.06, `lifting: ${on.toFixed(4)} → ${off.toFixed(4)}, half way in ${(d50 * 1000).toFixed(0)} ms`);
});

test('a gear change: the sound cut at once and back after, darker while cut; the gear going in clunks', () => {
  const v = S.engine(stock, { mute: { intake: false } }), x = render(v, 2, t => steady(5000, { throttle: 1, pedal: 1, load: 1, gear: t < 1.1 ? 2 : 3, shifting: t >= 1 && t < 1.1 })(), { channels: [0] });
  const before = at(x, 0.8, 0.98), during = at(x, 1.03, 1.09), after = at(x, 1.4, 1.6);
  assert.ok(during < before * 0.3, `cut: ${before.toFixed(4)} → ${during.toFixed(4)}`);
  assert.ok(after > before * 0.7, `back: ${after.toFixed(4)}`);
  // the clunk: on the gearbox's output as the gear goes in
  const g = render(S.engine(stock), 1.5, t => steady(4000, { gear: t < 0.6 ? 2 : 3, shifting: t >= 0.5 && t < 0.6 })(), { channels: [2] });
  assert.ok(at(g, 0.6, 0.75) > 10 * at(g, 0.2, 0.45), `clunk ${at(g, 0.6, 0.75).toFixed(4)} against ${at(g, 0.2, 0.45).toFixed(5)}`);
});

test('the rev limiter bounces: the sound cut and back at its rate (the engine\'s; a stage-2 ECU\'s faster)', () => {
  const bounce = spec => {
    const v = S.engine(spec, { mute: { intake: false, pops: false } }), x = render(v, 2.5, steady(spec.engine.redlineRpm, { throttle: 1, pedal: 1, load: 1, fuelCut: true }), { channels: [0] });
    // its level, each 5 ms, and the rate it moves at (the envelope's spectrum's peak between 5 and 40 Hz)
    const env = [];
    for (let t = 0.5; t < 2.5; t += 0.005) env.push(at(x, t, t + 0.005));
    const m = env.reduce((a, b) => a + b, 0) / env.length;
    let best = 0, hz = 0;
    for (let f = 5; f <= 40; f += 0.25) { let re = 0, im = 0; env.forEach((e, i) => { re += (e - m) * Math.cos(2 * Math.PI * f * i * 0.005); im += (e - m) * Math.sin(2 * Math.PI * f * i * 0.005); }); const p = re * re + im * im; if (p > best) { best = p; hz = f; } }
    return { hz, depth: (Math.max(...env) - Math.min(...env)) / Math.max(...env) };
  };
  const plain = bounce(stock), ecu = bounce(S.spec('starter_car', ['ecu_stage1']));
  assert.ok(Math.abs(plain.hz - 14) <= 1.5 && plain.depth > 0.5, JSON.stringify(plain));
  assert.ok(Math.abs(ecu.hz - 16) <= 1.5 && ecu.depth > 0.5, JSON.stringify(ecu));
});

test('idle wobbles; a cross-plane V8 lopes', () => {
  const wob = spec => { const v = S.engine(spec), rpms = []; render(v, 3, () => ({ rpm: spec.engine.idleRpm, throttle: 0.05, pedal: 0, load: 0.02, gear: 0 })); for (let i = 0; i < 400; i++) { render(v, 0.005, null); rpms.push(v.rpm); } const m = rpms.reduce((a, b) => a + b, 0) / rpms.length; return Math.sqrt(rpms.reduce((a, r) => a + (r - m) ** 2, 0) / rpms.length) / m; };
  const four = wob(stock), v8 = wob(S.spec('brute_500'));
  assert.ok(four > 0.002 && four < 0.05, `the four's wobble ${(four * 100).toFixed(2)}%`);
  assert.ok(v8 > four, `the V8's ${(v8 * 100).toFixed(2)}% against ${(four * 100).toFixed(2)}%`);
  // and never past its revs off idle
  const v = S.engine(stock);
  render(v, 2, () => ({ rpm: 4000, throttle: 0.5, pedal: 0.5, load: 0.5 }));
  assert.ok(Math.abs(v.rpm - 4000) < 20, `at 4000: ${v.rpm.toFixed(0)}`);
});

test('starting: the starter turns it, it catches and flares; stopping runs it down; a stall, and back by itself', () => {
  const v = S.engine(stock, { startOff: true }), states = [];
  const x = render(v, 4, t => { states.push(v.mode); return { rpm: E.idleRpm, throttle: 0.05, pedal: 0, load: 0.02, gear: 0 }; }, { channels: [0, 1], events: [[0.5, 'start']] });
  assert.ok(at(x, 0, 0.45) < 1e-4, 'off: silent');
  assert.ok(states.includes('crank') && states.includes('catch') && v.mode === 'run', [...new Set(states)].join(' → '));
  assert.ok(at(x, 0.6, 1.3) > 0.003, `the starter cranking ${at(x, 0.6, 1.3).toFixed(4)}`);
  // stopping: runs down to silence
  const y = render(v, 3, () => ({ rpm: E.idleRpm, throttle: 0.05, pedal: 0, load: 0 }), { channels: [0, 1], events: [[0.2, 'stop']] });
  assert.equal(v.mode, 'off');
  assert.ok(at(y, 2.5, 3) < 1e-4 && at(y, 0, 0.2) > 0.002, 'it ran down and stopped');
  // a stall: the physics' revs falling away (a blown engine), then the engine back at idle (repaired): it starts itself
  const w = S.engine(stock), modes = [];
  const z = render(w, 6, t => { if (modes.at(-1)?.[1] !== w.mode) modes.push([t, w.mode]); return { rpm: t < 1 ? E.idleRpm : t < 3 ? Math.max(0, E.idleRpm * (1 - (t - 1) * 2)) : E.idleRpm, throttle: 0.05, pedal: 0, load: 0 }; }, { channels: [0, 1] });
  const order = modes.map(m => m[1]).join(' → ');
  assert.ok(/run → stop → off → crank → catch/.test(order) && w.mode !== 'off', order);
  assert.ok(at(z, 2.2, 2.9) < 1e-4, 'stalled: silent until it starts again');
});

test('misfires: a damaged engine drops firings, a healthy one doesn\'t', () => {
  // (the level over each firing's time: how many are well below the usual — dropped)
  const weak = misfire => { const v = S.engine(stock, { mute: { intake: false, pops: false } }), x = render(v, 3, steady(2000, { misfire }), { channels: [0] }); const w = 120 / 2000 / 2, e = []; for (let t = 0.5; t + w < 3; t += w) e.push(at(x, t, t + w)); const med = [...e].sort((a, b) => a - b)[e.length >> 1]; return e.filter(x2 => x2 < med * 0.6).length / e.length; };
  const healthy = weak(0), sick = weak(0.3);
  assert.ok(healthy < 0.05 && sick > healthy + 0.1, `firings well down: healthy ${(healthy * 100).toFixed(0)}%, misfiring ${(sick * 100).toFixed(0)}%`);
});

// ---------- parts ----------

// lift off from high revs, a few times: how many pops
const pops = spec => { const v = S.engine(spec), red = spec.engine.redlineRpm; render(v, 6, t => { const on = t % 1.5 < 0.7; return { rpm: red * (on ? 0.85 : 0.75), throttle: on ? 1 : 0, pedal: on ? 1 : 0, load: on ? 1 : -0.9, gear: 3 }; }); return v.popCount; };

test('every part with sound settings changes the sound as it says', () => {
  const withSound = Object.values(S.db.parts).filter(p => p.sound && Object.keys(p.sound).some(k => !k.startsWith('_')));
  assert.ok(withSound.length >= 25, `${withSound.length} parts with sound settings`);
  const checked = [];
  for (const part of withSound) {
    // a car it fits (its own, or the first that takes it), stock, then with it
    const car = Object.keys(S.db.cars).find(c => { try { S.spec(c, [part.id]); return true; } catch { return false; } });
    assert.ok(car, `${part.id} fits some car`);
    const before = S.spec(car), after = S.spec(car, [part.id]), Sd = part.sound, B = before.audio, Af = after.audio;
    assert.ok(Af.from.some(x => x.part === part.id), `${part.id}: in spec.audio.from`);
    const red = after.engine.redlineRpm, r = 0.75 * red;
    const render1 = (spec, o, st, ch = [0], secs = 1.5) => render(S.engine(spec, o), secs, st, { channels: ch });
    if (Sd.exhaust?.level) {
      const a = at(render1(before, { mute: { intake: false, pops: false } }, steady(r, { throttle: 1, pedal: 1, load: 1 })), 0.5, 1.5), b = at(render1(after, { mute: { intake: false, pops: false } }, steady(r, { throttle: 1, pedal: 1, load: 1 })), 0.5, 1.5);
      const want = Af.exhaust.level / B.exhaust.level;
      if (Math.abs(want - 1) > 0.04) assert.ok(Math.abs(b / a / want - 1) < 0.3 || (want > 1) === (b > a), `${part.id}: ${want.toFixed(2)}× louder asked, ${(b / a).toFixed(2)}× heard`);
    }
    if (Sd.exhaust?.tone && Math.abs(Sd.exhaust.tone - 1) > 0.02) {
      // (its tone alone: the rasp it may bring brightens too, and is checked by itself below)
      const c = spec => centroid(spectrum(render1(spec, { mute: { intake: false, pops: false } }, steady(r, { throttle: 1, pedal: 1, load: 1 })), Math.round(0.5 * SR), 32768));
      const ca = c(before), cb = c({ ...after, audio: { ...Af, exhaust: { ...Af.exhaust, rasp: B.exhaust.rasp } } });
      assert.ok((Af.exhaust.tone > B.exhaust.tone) === (cb > ca), `${part.id}: tone ×${(Af.exhaust.tone / B.exhaust.tone).toFixed(2)}, centre ${ca.toFixed(0)} → ${cb.toFixed(0)} Hz`);
    }
    if (Sd.exhaust?.rasp) {
      const h = spec => band(spectrum(render1(spec, { mute: { intake: false, pops: false } }, steady(r, { throttle: 1, pedal: 1, load: 1 })), Math.round(0.5 * SR), 32768), 1800, 6000);
      assert.ok(h(after) > h(before), `${part.id}: rasp — the 1.8–6 kHz share ${h(before).toFixed(3)} → ${h(after).toFixed(3)}`);
    }
    if (Sd.exhaust?.pops) assert.ok(pops(after) > pops(before), `${part.id}: pops ${pops(before)} → ${pops(after)}`);
    if (Sd.intake?.roar) {
      const ro = spec => at(render1(spec, null, steady(r, { throttle: 1, pedal: 1, load: 1 }), [1]), 0.5, 1.5);
      assert.ok((Sd.intake.roar > 1) === (ro(after) > ro(before)), `${part.id}: roar ×${Sd.intake.roar}: ${ro(before).toFixed(4)} → ${ro(after).toFixed(4)}`);
    }
    if (Sd.whistle) {
      const W = Af.whistle, hz = W.toHz * 0.9 + W.fromHz * 0.1;
      const x = render1(after, { mute: { exhaust: false, intake: false } }, steady(r, { throttle: 1, pedal: 1, load: 1, spool: 1, whistle: { hz, gain: W.gain, noise: W.noise, q: W.q } }), [1]);
      assert.ok(toneAt(spectrum(x, Math.round(0.5 * SR), 32768), hz, 30) > 20, `${part.id}: its whistle at ${hz.toFixed(0)} Hz`);
    }
    if (Sd.blowoff) {
      const x = render1(after, { mute: { exhaust: false, intake: false } }, t => t < 1 ? steady(r, { throttle: 1, pedal: 1, load: 1, spool: 0.9 })() : steady(r * 0.8, { throttle: 0, pedal: 0, load: -0.8, spool: 0.6 })(), [1], 2);
      assert.ok(at(x, 1.02, 1.25) > 4 * Math.max(1e-5, at(x, 0.6, 0.95)), `${part.id}: its ${Sd.blowoff.kind} when the throttle shut: ${at(x, 1.02, 1.25).toFixed(4)} against ${at(x, 0.6, 0.95).toFixed(5)}`);
    }
    if (Sd.supercharger) {
      const C = Sd.supercharger, hz = r / 60 * C.ratio * (C.kind === 'centrifugal' ? 1 : C.lobes ?? 4);
      const x = render1(after, { mute: { exhaust: false, intake: false } }, steady(r, { throttle: 1, pedal: 1, load: 1 }), [1]);
      assert.ok(toneAt(spectrum(x, Math.round(0.5 * SR), 32768), hz, 15) > 20, `${part.id}: its whine at ${hz.toFixed(0)} Hz`);
    }
    if (Sd.gears?.whine >= 0.03) {
      const hz = 3000 / 60 * Sd.gears.teeth;
      const x = render1(after, null, steady(3000, { throttle: 1, pedal: 1, load: 1, gear: 2 }), [2]);
      assert.ok(toneAt(spectrum(x, Math.round(0.5 * SR), 32768), hz, 15) > 10, `${part.id}: its gears' whine at ${hz.toFixed(0)} Hz`);
      assert.ok(at(x, 0.5, 1.5) > 5 * at(render1(before, null, steady(3000, { throttle: 1, pedal: 1, load: 1, gear: 2 }), [2]), 0.5, 1.5), `${part.id}: louder than the helical box`);
    }
    if (Sd.limiter) assert.ok(Af.limiter.hz === Sd.limiter.hz, `${part.id}: its limiter`);
    checked.push(part.id);
  }
  assert.equal(checked.length, withSound.length);
});

test('engine swaps change the engine\'s sound completely: its own sound config', () => {
  const kaze = S.spec('kaze_gt'), g = S.H.garage(null, 'kaze_gt');
  for (const p of ['clutch_race', 'gearbox_uprated', 'radiator_aluminium', 'kaze_gt_swap_brute_v8']) assert.ok(g.install(p, { auto: true }).ok, p);
  assert.ok(g.remove('socket_engine', { auto: true }).ok && g.install('brute_500_engine', { socket: 'socket_engine' }).ok, 'the V8 in');
  const swapped = g.stats().spec;
  assert.notEqual(kaze.engine.sound, swapped.engine.sound);
  assert.equal(swapped.engine.sound, 'data/sounds/engines/v8.json');
  // the swapped Kaze sounds like the Brute 500 (the V8's own car), not like a Kaze: its spectrum in third-octave bands
  const bands = spec => { const sp = spectrum(render(S.engine(spec, { mute: { intake: false, pops: false } }), 1.5, steady(2500), { channels: [0] }), Math.round(0.5 * SR), 32768), out = []; for (let f = 50; f < 5000; f *= 2 ** (1 / 3)) out.push(Math.log10(band(sp, f, f * 2 ** (1 / 3)) + 1e-9)); return out; };
  const dist = (a, b) => Math.sqrt(a.reduce((s2, x, i) => s2 + (x - b[i]) ** 2, 0) / a.length);
  const v8 = bands(S.spec('brute_500')), k = bands(kaze), sw = bands(swapped);
  assert.ok(dist(sw, v8) < 0.5 * dist(sw, k), `the swapped car against the V8's ${dist(sw, v8).toFixed(2)}, against the Kaze's own ${dist(sw, k).toFixed(2)}`);
});

test('the parts\' sound blocks merge: levels and tones multiply, rasp and pops add as shares, the rest the last part\'s', () => {
  const m = mergeSound([{ id: 'a', sound: { exhaust: { level: 1.2, rasp: 0.5, pops: 0.5 } } }, { id: 'b', sound: { exhaust: { level: 1.5, tone: 0.9, rasp: 0.5 }, intake: { roar: 2 } } }, { id: 'c', sound: { gears: { whine: 0.1, teeth: 20 } } }, { id: 'd', sound: { gears: { whine: 0.2, teeth: 30, _note: 'x' } } }]);
  assert.ok(Math.abs(m.exhaust.level - 1.8) < 1e-9 && m.exhaust.tone === 0.9 && Math.abs(m.exhaust.rasp - 0.75) < 1e-9 && m.exhaust.pops === 0.5 && m.intake.roar === 2);
  assert.deepEqual(m.gears, { whine: 0.2, teeth: 30 });
  assert.deepEqual(m.from.map(x => x.part), ['a', 'b', 'c', 'd']);
  // torn off: its sound gone with it (the stats leave it out)
  const g = S.H.garage(null, 'starter_car'); assert.ok(g.install('catback_race', { auto: true }).ok);
  assert.ok(g.stats().spec.audio.exhaust.level > 1.3);
  const socket = Object.entries(g.build.sockets).find(([, id]) => g.state.parts[id]?.partId === 'catback_race')?.[0];
  assert.ok(socket);
  assert.equal(g.stats({ ...g.build, attach: { ...(g.build.attach ?? {}), [socket]: 'detached' } }).spec.audio.exhaust.level, 1, 'torn off: the stock level');
});

// ---------- tyres, road and car ----------

test('the tyres tell how near the grip limit they are: nothing well inside, a scrub nearing it, a squeal past it, a skid sliding', () => {
  const wheels = (s, slide = 0) => [0, 1, 2, 3].map(() => ({ grounded: true, combinedSlip: s, slipSpeed: slide, load: 3500, surface: 'tarmac' }));
  const surf = { tarmac: { sound: 'tarmac' }, gravel: { sound: 'gravel' } };
  const at2 = (s, slide) => tyreSound(wheels(s, slide), 25, surf, A.tyres);
  const inside = at2(0.4, 0.2), near = at2(0.9, 0.6), limit = at2(1.05, 1.5), past = at2(1.4, 4), slide = at2(2.6, 12);
  assert.deepEqual([inside.scrub, inside.squeal, inside.skid], [0, 0, 0]);
  assert.ok(near.scrub > 0.3 && near.squeal === 0, JSON.stringify(near));
  assert.ok(limit.squeal > 0 && past.squeal > limit.squeal && slide.squeal >= past.squeal, `${limit.squeal.toFixed(2)} → ${past.squeal.toFixed(2)} → ${slide.squeal.toFixed(2)}`);
  assert.ok(slide.skid > 0.5 && past.skid < slide.skid && slide.pitch > past.pitch);
  // on gravel no squeal; in the air nothing
  assert.equal(tyreSound(wheels(1.5, 5).map(w => ({ ...w, surface: 'gravel' })), 25, surf, A.tyres).squeal, 0);
  assert.equal(tyreSound(wheels(1.5, 5).map(w => ({ ...w, grounded: false })), 25, surf, A.tyres).squeal, 0);
  // and heard so: the squeal's band louder the further past
  const lvl = st => { const v = new ChassisVoice(SR, 3); return at(render(v, 1, () => ({ speed: 25, ...st }), { channels: [0] }), 0.4, 1); };
  assert.ok(lvl(near) > lvl(inside) && lvl(past) > lvl(near) * 2 && lvl(slide) > lvl(past), [inside, near, past, slide].map(lvl).map(x => x.toFixed(4)).join(' → '));
});

test('each surface sounds its own: asphalt\'s roar, concrete brighter with its joints, cobbles\' rumble, gravel\'s crunch, grass, dirt, sand, wet', () => {
  const sound = (name, extra = {}) => { const surf = new Float32Array(SURFACES.length); surf[SURFACES.indexOf(name)] = 1; const v = new ChassisVoice(SR, 5), x = render(v, 2, () => ({ speed: 22, surf, ...extra }), { channels: [1] }); const sp = spectrum(x, Math.round(0.5 * SR), 65536); return { rms: at(x, 0.5, 2), c: centroid(sp), hi: band(sp, 1000, 6000) }; };
  const S2 = Object.fromEntries(SURFACES.map(n => [n, sound(n)]));
  for (const n of SURFACES) assert.ok(S2[n].rms > 0.002, `${n}: ${S2[n].rms.toFixed(4)}`);
  assert.ok(S2.concrete.c > S2.tarmac.c, `concrete brighter: ${S2.tarmac.c.toFixed(0)} → ${S2.concrete.c.toFixed(0)} Hz`);
  assert.ok(S2.gravel.hi > S2.tarmac.hi * 2, `gravel's crunch: ${S2.tarmac.hi.toFixed(3)} → ${S2.gravel.hi.toFixed(3)}`);
  assert.ok(S2.dirt.c < S2.gravel.c && S2.grass.c < S2.gravel.c, 'dirt and grass softer than gravel');
  const wet = sound('tarmac', { wet: 1 });
  assert.ok(wet.hi > S2.tarmac.hi * 2, `wet: the spray's hiss ${S2.tarmac.hi.toFixed(3)} → ${wet.hi.toFixed(3)}`);
  // kerbs rumble at the rate their stripes pass; the road's roar rises with speed; the wind with its square
  const kerb = new ChassisVoice(SR, 6), k = render(kerb, 1.5, () => ({ speed: 20, kerb: 1, kerbHz: 20 }), { channels: [1] });
  assert.ok(toneAt(spectrum(k, Math.round(0.3 * SR), 65536), 20, 3) > 5, 'the kerb at 20 Hz');
  const road = sp => { const surf = new Float32Array(SURFACES.length); surf[0] = 1; return at(render(new ChassisVoice(SR, 7), 1.5, () => ({ speed: sp, surf }), { channels: [1] }), 0.5, 1.5); };
  assert.ok(road(30) > road(15) * 1.5 && road(15) > road(5));
  const wind = sp => at(render(new ChassisVoice(SR, 8), 2, () => ({ speed: sp, wind: Math.min(1, (sp / 45) ** 2) }), { channels: [2] }), 1, 2);
  assert.ok(wind(40) > wind(20) * 2.5 && wind(5) < wind(20));
  // the surfaces under the wheels, by the world's names
  const mix = surfaceMix([{ grounded: true, surface: 'cobbles' }, { grounded: true, surface: 'cobbles' }, { grounded: true, surface: 'kerb' }, { grounded: false, surface: 'grass' }], { cobbles: { sound: 'tarmac' }, kerb: { sound: 'tarmac', rumble: 1 } }, A.surfaces, 20);
  assert.ok(Math.abs(mix.surf[SURFACES.indexOf('cobbles')] - 2 / 3) < 1e-6 && mix.kerb > 0.9 && mix.kerbHz === 20, JSON.stringify(mix));
});

test('bumps thump through the suspension; brakes squeal on some stops; the handbrake ratchets', () => {
  const B = new Bumps(A.bumps);
  assert.equal(B.update([{ grounded: true, compressionSpeed: 0.4 }], 0.016), 0);
  assert.ok(B.update([{ grounded: true, compressionSpeed: 2.5 }], 0.016) > 0.5);
  assert.equal(B.update([{ grounded: true, compressionSpeed: 2.5 }], 0.016), 0, 'not again at once');
  const v = new ChassisVoice(SR, 9), x = render(v, 1, () => ({ speed: 10 }), { channels: [1], events: [[0.5, 'thump', 1]] });
  assert.ok(at(x, 0.5, 0.6) > 20 * Math.max(1e-6, at(x, 0.2, 0.45)), 'a thump');
  const h = render(new ChassisVoice(SR, 10), 1, () => ({ speed: 0 }), { channels: [1], events: [[0.3, 'handbrake']] });
  assert.ok(at(h, 0.3, 0.55) > 1e-3 && at(h, 0.7, 1) < 1e-5, 'the ratchet, then quiet');
  // brakes: some stops squeal, the same ones each time
  const stops = seed => { const b = new BrakeSqueal(A.brakes, seed), out = []; for (let s = 0; s < 40; s++) { let max = 0; for (let v = 20; v > 0; v -= 0.5) max = Math.max(max, b.update(v, 0.3, 0.02)); for (let v = 0; v < 15; v += 1) b.update(v, 0, 0.02); out.push(max > 0.2); } return out; };
  const a = stops(1), c = stops(1), share = a.filter(Boolean).length / a.length;
  assert.deepEqual(a, c);
  assert.ok(share > 0.15 && share < 0.6, `${(share * 100).toFixed(0)}% of stops squeal`);
});

// ---------- where you listen; other cars ----------

test('the cameras: in the cockpit the exhaust muffled, more intake and gearbox, the outside world muffled, the cabin booming; outside mostly the exhaust', () => {
  const chase = viewMix(A, 'chase'), cockpit = viewMix(A, 'cockpit'), open = viewMix(A, 'cockpit', true);
  assert.ok(chase.exhaust > chase.intake && chase.muffle >= 20000 && chase.outside >= 20000);
  assert.ok(cockpit.muffle < 3000 && cockpit.outside < 4000 && cockpit.intake > chase.intake && cockpit.gearbox > chase.gearbox && cockpit.boom > 0 && cockpit.inside);
  assert.ok(open.muffle > cockpit.muffle && open.wind > cockpit.wind, 'the roof down: less muffled, more wind');
});

test('Doppler: a car coming at you higher, going away lower, a passing car\'s pitch falls; nothing when it\'s still', () => {
  const D = A.doppler;
  assert.ok(doppler([0, 0, -50], [0, 0, 30], [0, 0, 0], D) > 1.08, 'coming');
  assert.ok(doppler([0, 0, -50], [0, 0, -30], [0, 0, 0], D) < 0.93, 'going');
  assert.equal(doppler([0, 0, -50], [0, 0, 0], [0, 0, 0], D), 1);
  const pass = [-100, -20, 20, 100].map(x => doppler([x, 0, -5], [40, 0, 0], [0, 0, 0], D));
  for (let i = 1; i < pass.length; i++) assert.ok(pass[i] < pass[i - 1], pass.map(p => p.toFixed(3)).join(' → '));
  assert.ok(doppler([0, 0, -10], [0, 0, 300], [0, 0, 0], D) <= 1 + D.max + 1e-9, 'never past its most');
});

test('other cars\' voices: the nearest six full, the next simple within reach, none further; no flapping between two at the same distance', () => {
  const was = new Map(), cars = Array.from({ length: 30 }, (_, i) => ({ id: i, d: 10 + i * 30 }));
  let v = rankVoices(cars, A.voices, was, 0);
  for (let t = 0.1; t <= 2; t += 0.1) v = rankVoices(cars, A.voices, was, t);
  const of = id => v.get(id);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(of), Array(6).fill('full'));
  assert.equal(of(6), 'simple');
  assert.equal(cars.filter(c => of(c.id) === 'full').length, 6);
  assert.ok(cars.filter(c => of(c.id) === 'simple').every(c => c.d <= A.voices.simpleM));
  assert.equal(of(29), 'off');
  // two cars swapping places back and forth: it doesn't change every frame
  const w2 = new Map(), pair = t => [{ id: 'a', d: 50 + Math.sin(t * 30) }, { id: 'b', d: 50 - Math.sin(t * 30) }, ...[1, 2, 3, 4, 5].map(i => ({ id: `n${i}`, d: i }))];
  let changes = 0, last = null;
  for (let t = 0; t < 5; t += 1 / 60) { const r = rankVoices(pair(t), A.voices, w2, t); const k = `${r.get('a')}${r.get('b')}`; if (last && k !== last) changes++; last = k; }
  assert.ok(changes <= 5 / A.voices.hold + 1, `${changes} changes in 5 s`);
  assert.equal(rankVoices(cars, A.voices, new Map(), 0, 'low').size, 30);
  let low = rankVoices(cars, A.voices, new Map(), 0, 'low'); const wl = new Map(); for (let t = 0; t < 2; t += 0.1) low = rankVoices(cars, A.voices, wl, t, 'low');
  assert.equal([...low.values()].filter(x => x === 'full').length, A.voices.lowFull);
});

test('another player\'s car: on the throttle on load, off it on the overrun; an NPC\'s from its physics like yours', () => {
  assert.ok(remoteEngineInput({ rpm: 5000, throttle: 1, gear: 3 }, 900).load > 0.9);
  assert.ok(remoteEngineInput({ rpm: 5000, throttle: 0, gear: 3 }, 900).load < -0.5);
  assert.ok(Math.abs(remoteEngineInput({ rpm: 900, throttle: 0, gear: 0 }, 900).load) < 0.1);
  // the physics' engine: load from its torque — flat out near 1, shut on the overrun −1
  const flat = engineInput({ rpm: 4000, torque: 150, throttle: 1, gear: '3' }, E), shut = engineInput({ rpm: 4000, torque: -40, throttle: 0, gear: 'R' }, E);
  assert.ok(flat.load > 0.8 && flat.gear === 3, JSON.stringify(flat));
  assert.ok(shut.load < -0.5 && shut.gear === -1, JSON.stringify(shut));
});

test('the echo: a tunnel, under a bridge, a street of buildings, open country — from the rays round the listener', () => {
  const ring = (d, n = 12) => Array.from({ length: n }, () => d);
  const tunnel = surroundings({ up: 5, sides: ring(5), hits: { ground: 12 } }, A);
  const under = surroundings({ up: 9, sides: ring(null), hits: {} }, A);
  const street = surroundings({ up: null, sides: Array.from({ length: 12 }, (_, i) => i % 6 === 0 ? null : i % 6 === 3 ? null : 9), hits: { building: 8 } }, A);
  const open = surroundings({ up: null, sides: ring(null), hits: {} }, A);
  assert.ok(tunnel.tunnel > 0.8, JSON.stringify(tunnel));
  assert.ok(under.under > 0.8 && under.tunnel < 0.2, JSON.stringify(under));
  assert.ok(street.street > 0.5 && street.width < 25 && street.area.city > 0.5, JSON.stringify(street));
  assert.ok(open.open > 0.95, JSON.stringify(open));
  // the area's ambience: a city's traffic, a forest's birds, the coast's sea
  const amb = JSON.parse(fs.readFileSync(path.join(root, 'data/sounds/ambient.json'), 'utf8'));
  assert.ok(areaTheme(amb, { city: 1, forest: 0, coast: 0 }).city > 0.8 && areaTheme(amb, { city: 0, forest: 1, coast: 0 }).birds > 0.8 && areaTheme(amb, { city: 0, forest: 0, coast: 1 }).sea > 0.8);
});

// ---------- the limiter, and no clicks ----------

test('the limiter: nothing past its ceiling whatever comes in, quiet things untouched, and its gain glides', () => {
  const L = new Limiter(SR, { ceiling: 0.89 }), n = 128, l = new Float32Array(n), r = new Float32Array(n), ol = new Float32Array(n), or = new Float32Array(n);
  let maxOut = 0, maxStep = 0, prevG = 1, quietDiff = 0;
  for (let b = 0; b < 2000; b++) {
    for (let i = 0; i < n; i++) { const t = (b * n + i) / SR; const loud = b > 500 && b < 1500, burst = b % 97 === 0 ? 6 : 0; l[i] = (loud ? 3 : 0.2) * Math.sin(2 * Math.PI * 220 * t) + (i === 5 ? burst : 0); r[i] = l[i] * 0.8; }
    L.process([l, r], [ol, or], n);
    for (let i = 0; i < n; i++) maxOut = Math.max(maxOut, Math.abs(ol[i]), Math.abs(or[i]));
    maxStep = Math.max(maxStep, Math.abs(L.g - prevG)); prevG = L.g;
    if (b > 100 && b < 190) for (let i = 0; i < n; i++) quietDiff = Math.max(quietDiff, Math.abs(ol[i]) - 0.2);
  }
  assert.ok(maxOut <= 0.89 + 1e-6, `the loudest out ${maxOut}`);
  assert.ok(quietDiff <= 1e-6, 'a quiet signal through as it was');
  const report = L.take();
  assert.ok(report.peakIn > 3 && report.minGain < 0.3 && report.peakOut <= 0.89 + 1e-6);
});

test('no clicks: crossfading the loops and cutting the grains up and down the revs, changing gear, on the limiter, lifting off, starting and stopping', () => {
  // (the engine's layers and sweep made of tones: anything broadband left is a click — tests/audioHarness.mjs)
  for (const carId of ['starter_car', 'brute_500']) {
    const spec = S.spec(carId), cfg = S.config(spec.engine.sound), Eg = spec.engine, tb = new Bank();
    tb.add(spec.engine.sound, tonalBank(cfg));
    const plain = { ...spec, audio: { ...spec.audio, exhaust: { level: 1, tone: 1, rasp: 0, pops: 0 } } };
    for (const mode of ['layers', 'granular']) {
      // (no rasp: its soft clip makes harmonics of its own, a different thing from a click)
      const v = () => { const x = S.engine(plain, { mode, mute: { intake: false, pops: false }, bank: tb }); x.cfg.exhaust.rasp = 0; return x; };
      const sweep = render(v(), 9, t => ({ rpm: Eg.idleRpm + (Eg.redlineRpm - Eg.idleRpm) * (t < 4 ? t / 4 : t < 5 ? 1 : Math.max(0, 1 - (t - 5) / 3)), throttle: t < 4.5 ? 1 : 0, pedal: t < 4.5 ? 1 : 0, load: t < 4.5 ? 0.9 : -0.8, gear: 3 }), { channels: [0] });
      const gears = render(v(), 6, t => ({ rpm: 3000 + 1500 * Math.sin(t), throttle: 1, pedal: 1, load: 0.8, gear: t < 2 ? 2 : t < 4 ? 3 : 4, shifting: (t > 1.85 && t < 2) || (t > 3.85 && t < 4) }), { channels: [0] });
      const limiter = render(v(), 3, t => ({ rpm: Eg.redlineRpm, throttle: t % 0.1 < 0.05 ? 0 : 1, pedal: 1, load: 0.9, gear: 3, fuelCut: t % 0.1 < 0.05 }), { channels: [0] });
      for (const [name, x] of Object.entries({ sweep, gears, limiter })) { const c = clicks(x); assert.ok(c.ratio < CLICK, `${carId} ${mode} ${name}: ${c.ratio.toFixed(4)} at ${c.at.toFixed(3)} s`); }
    }
  }
  // starting and stopping (the starter's own buzz is tonal: its run in and out, and the engine fading in and out)
  const spec = S.spec('starter_car'), tb = new Bank(); tb.add(spec.engine.sound, tonalBank(S.config(spec.engine.sound)));
  const v = S.engine({ ...spec, audio: { ...spec.audio, exhaust: { level: 1, tone: 1, rasp: 0, pops: 0 } } }, { startOff: true, mute: { intake: false, pops: false }, bank: tb });
  v.cfg.exhaust.rasp = 0;
  const x = render(v, 5, () => ({ rpm: spec.engine.idleRpm, throttle: 0.05, pedal: 0, load: 0.02, gear: 0 }), { channels: [0], events: [[0.3, 'start'], [3.5, 'stop']] });
  const c = clicks(x, 6000, 0.25 * SR);
  assert.ok(c.ratio < CLICK * 3, `starting and stopping: ${c.ratio.toFixed(4)} at ${c.at.toFixed(3)} s`);
});
