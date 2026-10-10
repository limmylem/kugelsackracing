// The engine and turbo sounds' files and mixes: the engine's sound config (data/sounds/engines) has loops from idle to
// the redline, on and off load, crossfaded by the revs and throttle and pitched only a little; louder and harsher up
// high, deeper and smoother down low; the loops are seamless (and their Opus too: the manifest's pad round each);
// the intake heard at high throttle; the turbo whistle only with a turbo fitted, rising with the spool under
// throttle and fading off it, each turbo part sounding its own. The crash sounds (audio/crash.js) on a stand-in for
// Web Audio (tests/fakeAudio.mjs). The engine itself, played: tests/unit/audio.test.mjs.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, load, root } from '../harness.mjs';
import { TurboSpool, engineLevels, intakeMix, layerMix, loadOf } from '../../testtrack/soundMix.js';
import { turboInput } from '../../audio/mix.js';
import { readWav } from '../../tools/content/sound.mjs';
import { assignDeep } from '../../garage/session.js';

const H = await harness(), stock = H.garage().stats().spec, E = stock.engine;
const cfg = load(E.sound);
const turboSpec = (id, ecu) => { const g = H.garage(); for (const p of ['front_mount_intercooler', 'pistons_forged', 'clutch_sport', id, ...(ecu ? [ecu] : [])]) assert.ok(g.install(p).ok, p); return g.stats().spec; };
const wavOf = f => readWav(fs.readFileSync(path.join(root, f)));

// Brightness of a whole loop: its spectrum's centre (Hz), and the share of it above 1.5 kHz (FFT)
function brightness({ samples: x, sr }) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) [re[i], re[j]] = [re[j], re[i]]; }
  for (let len = 2; len <= n; len <<= 1) for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
    const a = -2 * Math.PI * k / len, wr = Math.cos(a), wi = Math.sin(a), p = i + k, q = p + len / 2;
    const vr = re[q] * wr - im[q] * wi, vi = re[q] * wi + im[q] * wr;
    re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi;
  }
  let total = 0, centre = 0, high = 0;
  for (let k = 1; k < n / 2; k++) { const f = k * sr / n, p = re[k] ** 2 + im[k] ** 2; total += p; centre += f * p; if (f > 1500) high += p; }
  return { centre: centre / total, high: high / total };
}

test('the engine\'s sound config: loops from idle to the redline (idle, low, mid, high, redline), each on and off load, every file there', () => {
  assert.equal(E.sound, 'data/sounds/engines/rs17.json');
  assert.deepEqual([...new Set(cfg.layers.map(L => L.band))], ['idle', 'low', 'mid', 'high', 'redline']);
  assert.ok(cfg.layers[0].rpm <= E.idleRpm && cfg.layers.at(-1).rpm >= E.redlineRpm);
  for (const L of cfg.layers) for (const f of [L.on, L.off]) assert.ok(fs.existsSync(path.join(root, f)), f);
  for (const f of [cfg.intake.file, cfg.shift.file, cfg.limiter.file, cfg.damage.bang, cfg.damage.bent]) assert.ok(fs.existsSync(path.join(root, f)), f);
});

test('crossfaded by the revs and the throttle, each loop pitched only a little (the loudest never more than 15% off, idle to redline)', () => {
  let loudest = 0, heard = 0;
  for (let rpm = E.idleRpm; rpm <= E.redlineRpm; rpm += 5) for (const load of [0, 0.4, 1]) {
    const m = layerMix(cfg, rpm, load), power = m.map(x => x.on ** 2 + x.off ** 2), total = power.reduce((a, p) => a + p, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `equal power at ${rpm} rpm`);
    assert.ok(m.filter(x => x.on + x.off > 1e-9).length <= 2, 'the two nearest rpm points');
    m.forEach((x, i) => { if (power[i] >= 0.5) loudest = Math.max(loudest, Math.abs(x.rate - 1)); if (power[i] >= 0.1) heard = Math.max(heard, Math.abs(x.rate - 1)); });
  }
  assert.ok(loudest <= 0.15, `the loudest loop at most ${(loudest * 100).toFixed(1)}% off`);
  assert.ok(heard <= 0.2, `any loop with a tenth of the sound at most ${(heard * 100).toFixed(1)}% off`);
  // at a layer's own rpm: that loop alone, at its own pitch; the throttle moves it from off to on load
  const at = cfg.layers[4], i = 4;
  const off = layerMix(cfg, at.rpm, loadOf(cfg, 0, false)), on = layerMix(cfg, at.rpm, loadOf(cfg, 1, false)), half = layerMix(cfg, at.rpm, 0.5);
  assert.deepEqual([off[i].on, off[i].off, off[i].rate], [0, 1, 1]);
  assert.ok(on[i].on > 0.999 && on[i].off < 1e-9);
  assert.ok(half[i].on > 0.6 && half[i].off > 0.6);
  assert.equal(loadOf(cfg, 1, true), 0, 'the rev limiter cutting the fuel: off load');
});

test('louder and harsher up high, deeper and smoother down low', () => {
  // the level and tone: up with the revs and the load
  let prev = null;
  for (let rpm = E.idleRpm; rpm <= E.redlineRpm; rpm += 200) {
    const l = engineLevels(cfg, E, rpm, 1);
    if (prev) assert.ok(l.level > prev.level && l.tone > prev.tone, `${rpm} rpm`);
    prev = l;
  }
  const idle = engineLevels(cfg, E, E.idleRpm, 0), red = engineLevels(cfg, E, E.redlineRpm, 1);
  assert.ok(red.level > 3 * idle.level, `${idle.level.toFixed(3)} → ${red.level.toFixed(3)}`);
  assert.ok(engineLevels(cfg, E, 4000, 1).level > engineLevels(cfg, E, 4000, 0).level);
  // the loops themselves: brighter and rougher the higher they are, on load brighter than off
  const b = cfg.layers.map(L => ({ rpm: L.rpm, on: brightness(wavOf(L.on)), off: brightness(wavOf(L.off)) }));
  for (let i = 1; i < b.length; i++) assert.ok(b[i].on.centre > b[i - 1].on.centre, `on load, ${b[i - 1].rpm} → ${b[i].rpm}: ${b[i - 1].on.centre.toFixed(0)} → ${b[i].on.centre.toFixed(0)} Hz`);
  for (const x of b) assert.ok(x.on.centre > x.off.centre, `${x.rpm}: on ${x.on.centre.toFixed(0)} Hz, off ${x.off.centre.toFixed(0)} Hz`);
  assert.ok(b[0].on.centre < 300 && b.at(-1).on.centre > 900, `centre ${b[0].on.centre.toFixed(0)} → ${b.at(-1).on.centre.toFixed(0)} Hz`);
  assert.ok(b[0].on.high < 0.02 && b.at(-1).on.high > 0.15, `above 1.5 kHz: ${(b[0].on.high * 100).toFixed(1)}% → ${(b.at(-1).on.high * 100).toFixed(1)}%`);
});

test('every loop is whole engine cycles and joins up without a click', () => {
  for (const L of cfg.layers) for (const f of [L.on, L.off]) {
    const { samples: x, sr } = wavOf(f), cycles = x.length / sr * L.rpm / 120;
    assert.ok(Math.abs(cycles - Math.round(cycles)) * (120 / L.rpm) * sr < 1.5, `${f}: ${cycles.toFixed(3)} cycles`);
    let biggest = 0;
    for (let i = 1; i < x.length; i++) biggest = Math.max(biggest, Math.abs(x[i] - x[i - 1]));
    assert.ok(Math.abs(x[0] - x.at(-1)) <= biggest, `${f}: the join is no bigger a step than any in the loop`);
  }
  const { samples: intake } = wavOf(cfg.intake.file);
  assert.ok(Math.abs(intake[0] - intake.at(-1)) < 0.2);
});

// ---------- the audio code, on a stand-in for Web Audio ----------

const { installFakeAudio } = await import('../fakeAudio.mjs');
const F = installFakeAudio();
const { createAudioSystem } = await import('../../audio/system.js');
const { createCrashSounds } = await import('../../audio/crash.js');
const Asys = await createAudioSystem({ context: new F.classes.AudioContext() });

test('the intake\'s air: only at high throttle, louder and higher with the revs', () => {
  assert.equal(intakeMix(cfg, E, 5000, 0.3).gain, 0);
  const low = intakeMix(cfg, E, 2500, 1), high = intakeMix(cfg, E, 6500, 1);
  assert.ok(low.gain > 0 && high.gain > low.gain && high.hz > low.hz);
  assert.ok(high.gain <= cfg.intake.gain, 'subtle: never above its own level');
});

test('the turbo whistle: silent without a turbo; with one it rises with the spool under throttle and fades off it', () => {
  // (no turbo fitted: nothing, whatever the engine does)
  const none = new TurboSpool();
  for (let i = 0; i < 120; i++) assert.equal(none.update(1 / 60, stock.turbo, 5000, 1).gain, 0);
  const small = turboSpec('turbo_kit').turbo, medium = turboSpec('turbo_medium').turbo;
  assert.ok(small.sound.whistle && medium.sound.whistle && small.boost.length);
  const run = (turbo, steps) => { const s = new TurboSpool(), out = []; for (const [seconds, rpm, throttle] of steps) for (let i = 0; i < seconds * 60; i++) out.push(s.update(1 / 60, turbo, rpm, throttle)); return out; };
  // full throttle at 5000 rpm for 2 s, then off it for a second
  const r = run(small, [[2, 5000, 1], [1, 5000, 0]]), top = r[119], after = r.at(-1);
  for (let i = 1; i < 120; i++) assert.ok(r[i].hz >= r[i - 1].hz && r[i].gain >= r[i - 1].gain, 'rising under throttle');
  assert.ok(top.spool > 0.95 && Math.abs(top.hz - small.sound.whistle.toHz) < 300, `spool ${top.spool.toFixed(2)} at ${top.hz.toFixed(0)} Hz`);
  assert.ok(after.gain < 0.1 * top.gain && after.hz < top.hz, 'faded off the throttle');
  // with the boost: little at 2000 rpm, where the turbo hardly boosts
  assert.ok(run(small, [[2, 2000, 1]]).at(-1).gain < 0.2 * top.gain);
  // each turbo its own: the small one higher and quicker, the medium one deeper, slower to spool, louder
  const m = run(medium, [[2, 5500, 1]]), sEarly = run(small, [[0.4, 5000, 1]]).at(-1), mEarly = run(medium, [[0.4, 5500, 1]]).at(-1);
  assert.ok(m.at(-1).hz < top.hz - 1000, `${m.at(-1).hz.toFixed(0)} Hz against ${top.hz.toFixed(0)} Hz`);
  assert.ok(mEarly.spool < sEarly.spool, 'the medium turbo spools slower');
  assert.ok(m.at(-1).gain > top.gain, 'and is louder');
  // the game's turbo input (audio/mix.js turboInput): none without a turbo; the part's whistle with one
  const noTurbo = new TurboSpool(), boosted = new TurboSpool(), sp = turboSpec('turbo_kit');
  for (let i = 0; i < 120; i++) { assert.equal(turboInput(noTurbo, stock, 1 / 60, 5000, 1).whistle, null); turboInput(boosted, sp, 1 / 60, 5000, 1); }
  const w = turboInput(boosted, sp, 1 / 60, 5000, 1);
  assert.ok(w.spool > 0.9 && w.whistle.gain > 0 && w.whistle.hz > sp.audio.whistle.fromHz);
});

test('taking the turbo off silences its whistle: the live spec (rebuilt in place) no longer has one', () => {
  const g = H.garage();
  for (const p of ['front_mount_intercooler', 'turbo_kit']) assert.ok(g.install(p).ok);
  const live = JSON.parse(JSON.stringify(g.stats().spec)), engine = live.engine;
  assert.ok(live.turbo);
  assert.ok(g.remove('turbo_kit').ok);
  assignDeep(live, g.stats().spec);
  assert.equal('turbo' in live, false);
  assert.equal(live.engine, engine, 'the same objects, changed in place');
  assert.deepEqual(live, g.stats().spec);
  const s = new TurboSpool();
  assert.equal(s.update(1 / 60, live.turbo, 5000, 1).gain, 0);
});

test('crash sounds: a take of the right strength for what was hit — a car, a rail, concrete, a building, a tree, a tyre wall — a little different each time; a big one\'s body thump; the scrape loop follows the scrape', async () => {
  const crashCfg = load('data/sounds/crash.json');
  const crash = createCrashSounds(Asys);
  await crash.ready;
  assert.ok(crash.config, 'the crash sounds loaded');
  for (const [cls, material, family] of [['tap', 'concrete', 'concrete'], ['crunch', 'metal', 'metal'], ['crash', 'car', 'car'], ['crash', 'wood', 'tree'], ['crunch', 'tyres', 'tyrewall'], ['crash', 'building', 'building'], ['tap', 'plastic', 'car']]) {
    const src = crash.impact(cls, material, 0.5);
    assert.equal(src.family, family, `${cls} into ${material}`);
  }
  // louder the harder: a crash louder than a crunch louder than a tap; within a class, harder louder
  const gainOf = src => [...src.outs][0].gain.value, avg = (cls, within) => Array.from({ length: 30 }, () => gainOf(crash.impact(cls, 'concrete', within))).reduce((a, g) => a + g, 0) / 30;
  assert.ok(avg('tap', 0.5) < avg('crunch', 0.5) && avg('crunch', 0.5) < avg('crash', 0.5));
  assert.ok(avg('crash', 0) < avg('crash', 1));
  assert.ok(avg('tap', 1) <= crashCfg.gain.tap[1] * 1.1, 'a tap stays quiet');
  const rates = Array.from({ length: 12 }, () => crash.impact('tap', 'metal', 0.5).playbackRate.value);
  assert.ok(new Set(rates.map(r => r.toFixed(3))).size > 3 && rates.every(r => Math.abs(r - 1) <= crashCfg.pitch + 1e-9), 'a little higher or lower each time');
  // (a big one: a low body thump under it — an oscillator of its own; a tap none)
  const made0 = F.made; crash.impact('tap', 'metal', 1); const tapMade = F.made - made0, made1 = F.made; crash.impact('crash', 'metal', 1);
  assert.ok(F.made - made1 >= tapMade + 2, `a crash makes its thump too (${F.made - made1} nodes against a tap's ${tapMade})`);
  const takes = new Set(Array.from({ length: 20 }, () => crash.impact('crash', 'metal', 1).buffer));
  assert.ok(takes.size > 1, 'not always the same take');
  // the scrape: silent until sliding along something, then the loop for what it is, louder with the scrape
  const L = crash.loops, lv = f => L[f].gain.gain.value;
  crash.update({ scrape: null }, 0.016, {});
  assert.deepEqual([lv('metal'), lv('concrete')], [0, 0]);
  crash.update({ scrape: { amount: 0.8, speed: 15, material: 'metal' } }, 0.016, {});
  assert.ok(Math.abs(lv('metal') - 0.8 * crashCfg.scrape.gain) < 1e-9 && lv('concrete') === 0, 'along the guardrail: the metal scrape');
  crash.update({ scrape: { amount: 0.3, speed: 8, material: 'building' } }, 0.016, {});
  assert.ok(Math.abs(lv('concrete') - 0.3 * crashCfg.scrape.gain) < 1e-9 && lv('metal') === 0, 'a building\'s wall: the grinding one');
  // a hanging panel flaps in the wind, faster the faster the car
  crash.update({ speed: 30 }, 0.016, {}, { flap: 1, speed: 30 });
  const fast = L.flap.src.playbackRate.value, loud = L.flap.gain.gain.value;
  crash.update({ speed: 15 }, 0.016, {}, { flap: 1, speed: 15 });
  assert.ok(loud > 0 && L.flap.src.playbackRate.value < fast);
  crash.update({ speed: 30 }, 0.016, {}, { flap: 0, speed: 30 });
  assert.equal(L.flap.gain.gain.value, 0);
  crash.dispose();
});
