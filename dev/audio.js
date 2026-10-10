// The audio test page (dev/audio.html; Phase 8 Step 1, docs/AUDIO.md): the game's own sound (audio/) driven by hand —
// a car and its parts (garage/data.js: the same stats as the game, spec.audio and all), the revs, throttle, load,
// gear, clutch and boost, the engine started and stopped, swept up the revs, the limiter held, lifted off; each layer
// heard alone or muted; granular and layers side by side; the cameras; the tyres on each surface; the echoes; the
// crashes. Graphs of what the sound is given (revs, load, boost, slip) and what comes out (its level, its spectrum).

import { Garage, loadGarageData } from '../garage/data.js';
import { startAudio } from '../audio/system.js';
import { createCarVoice } from '../audio/car.js';
import { createCrashSounds } from '../audio/crash.js';
import { createAudioOverlay } from '../audio/overlay.js';
import { viewMix, turboInput, tyreSound, TurboSpool } from '../audio/mix.js';
import { SURFACES } from '../audio/dsp.js';

const $ = id => document.getElementById(id);
const readJson = async f => (await fetch(f, { cache: 'no-cache' })).json();
const { db } = await loadGarageData(readJson);
const SLOTS = [['engine', 'Engine'], ['exhaust', 'Exhaust'], ['intake', 'Intake'], ['turbo', 'Turbo / blower'], ['ecu', 'ECU'], ['gearbox', 'Gearbox']];
const LAYERS = ['exhaust', 'intake', 'gearbox', 'turbo', 'supercharger', 'pops', 'tyres', 'road', 'brakes', 'wind'];

const ui = { car: Object.keys(db.cars).includes('starter_car') ? 'starter_car' : Object.keys(db.cars)[0], picks: {}, mode: 'granular', view: 'chase', echo: 'open', mutes: {}, ab: {} };
let A = null, voice = null, crash = null, spec = null, turbo = new TurboSpool(), overlay = null, analyser = null;
const st = { rpm: 900, target: 900, throttle: 0, pedal: 0, load: 0, gear: 3, shifting: false, shiftLeft: 0, clutch: 1, misfire: 0, spool: 0, fuelCut: false, sweeping: null, limiting: false };
const hist = [];

// ---------- the car and its parts ----------
function buildSpec(carId, picks) {
  const g = new Garage(db, null, carId);
  for (const id of Object.values(picks)) if (id) { const r = g.install(id, { auto: true }); if (!r.ok) console.warn(`${id}: ${r.errors?.join(' ')}`); }
  return g.stats().spec;
}
function fitting(carId, slot) {
  return Object.values(db.parts).filter(p => p.slot === slot || (slot === 'engine' && p.engine && p.slot === 'engine')).filter(p => { try { return new Garage(db, null, carId).install(p.id, { auto: true }).ok; } catch { return false; } }).sort((a, b) => a.name.localeCompare(b.name));
}
function renderParts() {
  const el = $('parts');
  el.innerHTML = `<div class="slot"><span>Car</span><select data-car>${Object.values(db.cars).map(c => `<option value="${c.id}" ${c.id === ui.car ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>`
    + SLOTS.map(([slot, name]) => `<div class="slot"><span>${name}</span><select data-slot="${slot}"><option value="">(its own)</option>${fitting(ui.car, slot).map(p => `<option value="${p.id}" ${ui.picks[slot] === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div>`).join('');
}
$('parts').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.car) { ui.car = t.value; ui.picks = {}; renderParts(); }
  else if (t.dataset.slot) ui.picks[t.dataset.slot] = t.value || null;
  applySpec();
});
function applySpec(s = null) {
  spec = s ?? buildSpec(ui.car, ui.picks);
  $('rpm').max = Math.round(spec.engine.redlineRpm * 1.05);
  if (voice) voice.setSpec(spec);
  info();
}

// ---------- the sound ----------
async function go() {
  A = await startAudio();
  if (!A) { $('go').textContent = 'The sound couldn\'t start (the console says why)'; return; }
  $('startCover').remove();
  analyser = new AnalyserNode(A.ctx, { fftSize: 4096, smoothingTimeConstant: 0.6 });
  A.master.connect(analyser);
  applySpec();
  voice = createCarVoice(A, { spec, role: 'player', startOff: true, mode: ui.mode });
  crash = createCrashSounds(A, { engineTap: voice.tap });
  overlay = createAudioOverlay(A, () => ({ voices: { counts: { full: 0, simple: 0, off: 0 } }, env: { surroundings: echoOf(ui.echo), area: null }, last: { engine: { rpm: st.rpm, load: st.load, gear: st.gear }, spool: st.spool, tyres: tyres() } }), { shown: true, parent: $('overlayHost') });
  setView(ui.view); setEcho(ui.echo); setMode(ui.mode);
  requestAnimationFrame(frame);
}
$('go').onclick = go;

const tyres = () => tyreSound([0, 1, 2, 3].map(() => ({ grounded: true, combinedSlip: +$('slip').value, slipSpeed: Math.max(0, +$('slip').value - 0.9) * 6, load: 3500, surface: $('surface').value })), +$('speed').value, { tarmac: { sound: 'tarmac' }, concrete: { sound: 'tarmac' }, cobbles: { sound: 'tarmac' } }, A.cfg.tyres);

let last = performance.now(), meterAt = 0, meters = null;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const E = spec.engine, idle = E.idleRpm, red = E.redlineRpm;
  // the revs: by hand, swept, or held on the limiter
  if (st.sweeping) {
    const S = st.sweeping; S.t += dt;
    if (S.phase === 'up') { st.pedal = 1; st.target = Math.min(red, st.target + (red - idle) / S.up * dt); if (st.target >= red) { S.phase = 'hold'; S.t = 0; } }
    else if (S.phase === 'hold') { st.pedal = 1; st.target = red; if (S.t > 0.6) { S.phase = 'down'; S.t = 0; } }
    else { st.pedal = 0; st.target = Math.max(idle, st.target - (red - idle) / 2.2 * dt); if (st.target <= idle) st.sweeping = null; }
    $('rpm').value = st.target; $('throttle').value = st.pedal;
  } else { st.target = +$('rpm').value; st.pedal = +$('throttle').value; }
  if (st.limiting) { st.target = red; st.pedal = 1; }
  st.rpm += (st.target - st.rpm) * Math.min(1, dt / 0.05);
  st.fuelCut = st.limiting || st.rpm >= red * 0.995 && st.pedal > 0.5;
  st.throttle = st.fuelCut ? 0 : st.pedal;
  if ($('autoLoad').checked) { st.load = st.pedal > 0.05 ? 0.2 + 0.8 * st.pedal : st.rpm > idle * 1.2 ? -0.85 : 0.05; $('load').value = st.load; } else st.load = +$('load').value;
  st.clutch = +$('clutch').value; st.misfire = +$('misfire').value;
  if (st.shiftLeft > 0) { st.shiftLeft -= dt; if (st.shiftLeft <= 0) { st.shifting = false; st.gear = st.nextGear; $('gear').value = st.gear; } }
  else st.gear = +$('gear').value;
  let whistle = null;
  if ($('autoBoost').checked) { const tu = turboInput(turbo, spec, dt, st.rpm, st.pedal); st.spool = tu.spool; whistle = tu.whistle; $('spool').value = st.spool; }
  else { st.spool = +$('spool').value; const W = spec.audio?.whistle; whistle = W && spec.turbo ? { hz: W.fromHz + (W.toHz - W.fromHz) * st.spool ** 0.8, gain: W.gain * st.spool ** 1.5, noise: W.noise, q: W.q } : null; }
  const surf = new Float32Array(SURFACES.length); surf[SURFACES.indexOf($('surface').value)] = 1;
  const speed = +$('speed').value;
  voice?.update({
    engine: { rpm: st.rpm, throttle: st.throttle, pedal: st.pedal, load: st.load, gear: st.gear, shifting: st.shifting, clutch: st.clutch, fuelCut: st.fuelCut, misfire: st.misfire, spool: st.spool, whistle },
    chassis: { speed, ...tyres(), surf, kerb: $('kerb').checked ? 1 : 0, kerbHz: speed, wet: $('wet').checked ? 1 : 0, brake: $('brake').checked && speed < 5 && speed > 0.3 ? 1 : 0, wind: Math.min(1, (speed / 45) ** 2) },
  }, dt);
  crash?.update({ speed, scrape: ui.scrape ? { amount: 0.8, speed: Math.max(5, speed), material: ui.scrape } : null }, dt, spec, { speed });
  overlay?.update(dt);
  for (const id of ['rpm', 'throttle', 'load', 'clutch', 'misfire', 'spool', 'speed', 'slip', 'width']) { const i = $(id), o = i.parentElement.querySelector('output'); if (o) o.textContent = (+i.value).toFixed(id === 'rpm' || id === 'width' ? 0 : 2); }
  // the graphs
  const lvl = level();
  hist.push({ rpm: st.rpm / (red * 1.05), load: st.load, spool: st.spool, slip: +$('slip').value / 3, out: lvl });
  if (hist.length > 600) hist.shift();
  draw(); spectrum();
  meterAt -= dt;
  if (meterAt <= 0 && voice) { meterAt = 0.25; voice.meter().then(m => { meters = m; info(); }); }
  requestAnimationFrame(frame);
}
const tbuf = new Float32Array(2048);
function level() { if (!analyser) return 0; analyser.getFloatTimeDomainData(tbuf); let s = 0; for (const x of tbuf) s += x * x; return Math.sqrt(s / tbuf.length); }
function draw() {
  const c = $('graph'), g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#ffffff14'; for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, y * H / 4); g.lineTo(W, y * H / 4); g.stroke(); }
  const line = (key, col, map) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); hist.forEach((h, i) => { const x = i / 600 * W, y = H - map(h[key]) * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
  line('rpm', '#36B3F5', v => v); line('load', '#E9ECEF', v => 0.5 + v / 2); line('spool', '#F5A623', v => v); line('slip', '#E5484D', v => v); line('out', '#7EE787', v => Math.min(1, v * 3));
  g.font = '12px JetBrains Mono'; [['revs', '#36B3F5'], ['load', '#E9ECEF'], ['boost', '#F5A623'], ['grip used', '#E5484D'], ['level out', '#7EE787']].forEach(([n, col], i) => { g.fillStyle = col; g.fillText(n, 10 + i * 110, 16); });
}
const fbuf = new Float32Array(2048);
function spectrum() {
  if (!analyser) return;
  const c = $('spectrum'), g = c.getContext('2d'), W = c.width, H = c.height, sr = A.ctx.sampleRate;
  analyser.getFloatFrequencyData(fbuf);
  g.clearRect(0, 0, W, H); g.fillStyle = '#36B3F5';
  for (let x = 0; x < W; x += 2) { const f = 30 * (16000 / 30) ** (x / W), k = Math.round(f / (sr / 2) * fbuf.length), v = (fbuf[k] + 110) / 90; g.fillRect(x, H - Math.max(0, v) * H, 2, Math.max(0, v) * H); }
  g.fillStyle = '#ffffff88'; g.font = '11px JetBrains Mono';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g.fillText(f >= 1000 ? `${f / 1000}k` : f, Math.log(f / 30) / Math.log(16000 / 30) * W, H - 4);
}
function info() {
  if (!spec) return;
  const S = spec.audio ?? {}, fmt = x => JSON.stringify(x);
  const m = meters?.engine, names = ['base', 'exhaust', 'intake', 'gearbox', 'pops', 'turbo', 'blowoff', 'supercharger', 'starter'];
  $('info').textContent = `${db.cars[ui.car].name} · ${spec.engine.sound?.split('/').pop()} · ${voice?.sound?.modes ? [...voice.sound.modes].join('+') : '…'} · engine ${m?.mode ?? '—'}
exhaust ${fmt(S.exhaust)}
intake  ${fmt(S.intake)}${S.whistle ? `\nturbo   ${fmt(S.whistle)}` : ''}${S.blowoff ? `\nblowoff ${fmt(S.blowoff)}` : ''}${S.supercharger ? `\nblower  ${fmt(S.supercharger)}` : ''}${S.gears ? `\ngears   ${fmt(S.gears)}` : ''}${S.limiter ? `\nlimiter ${fmt(S.limiter)}` : ''}
from    ${(S.from ?? []).map(x => `${x.name} (${x.keys.join(', ')})`).join('; ') || '—'}
${m ? `levels  ${names.map((n, i) => `${n} ${(m.meter[i] ?? 0).toFixed(3)}`).join(' · ')}\npops    ${m.pops}` : ''}`;
}

// ---------- the controls ----------
$('start').onclick = () => voice?.event('start');
$('stop').onclick = () => voice?.event('stop');
$('sweep').onclick = () => { st.sweeping = { phase: 'up', t: 0, up: 3.5 }; st.target = spec.engine.idleRpm; };
$('lift').onclick = () => { st.sweeping = null; $('throttle').value = 0; };
$('limit').onclick = e => { st.limiting = !st.limiting; e.target.classList.toggle('on', st.limiting); if (!st.limiting) $('rpm').value = spec.engine.redlineRpm * 0.8; };
const shift = d => {
  if (st.shifting) return;
  const ratios = spec.gearbox.ratios, g = +$('gear').value, to = Math.max(-1, Math.min(ratios.length, g + d));
  if (to === g) return;
  st.shifting = true; st.shiftLeft = spec.gearbox.shiftTime ?? 0.15; st.nextGear = to;
  if (g > 0 && to > 0) $('rpm').value = Math.max(spec.engine.idleRpm, +$('rpm').value * ratios[to - 1] / ratios[g - 1]);
};
$('up').onclick = () => shift(1); $('down').onclick = () => shift(-1);
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
function setMode(m) { ui.mode = m; voice?.setMode(m); document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); }
$('mutes').innerHTML = LAYERS.map(k => `<label><input type="checkbox" data-mute="${k}" checked> ${k} <a href="#" data-solo="${k}" style="color:var(--c-text-3);font-size:11px">only</a></label>`).join('');
const applyMutes = () => { const map = {}; document.querySelectorAll('[data-mute]').forEach(c => { if (!c.checked) map[c.dataset.mute] = false; }); voice?.mute(Object.keys(map).length ? map : null); };
$('mutes').addEventListener('change', applyMutes);
$('mutes').addEventListener('click', e => { const s = e.target.dataset?.solo; if (!s) return; e.preventDefault(); document.querySelectorAll('[data-mute]').forEach(c => { c.checked = c.dataset.mute === s; }); applyMutes(); });
$('soloNone').onclick = () => { document.querySelectorAll('[data-mute]').forEach(c => { c.checked = true; }); applyMutes(); };
$('views').innerHTML = ['chase', 'side', 'high', 'bonnet', 'cockpit', 'roofOpen'].map(v => `<button data-view="${v}">${v === 'roofOpen' ? 'cockpit, roof down' : v}</button>`).join('');
$('views').addEventListener('click', e => { const v = e.target.dataset?.view; if (v) setView(v); });
function setView(v) { ui.view = v; const m = v === 'roofOpen' ? viewMix(A.cfg, 'cockpit', true) : viewMix(A.cfg, v); voice?.setView(m); A?.setView(m); document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v)); }
const echoOf = e => ({ tunnel: e === 'tunnel' ? 1 : 0, under: e === 'under' ? 1 : 0, street: e === 'street' ? 1 : 0, open: e === 'open' ? 1 : 0, width: +$('width').value });
$('echoes').innerHTML = [['open', 'Open country'], ['street', 'City street'], ['under', 'Under a bridge'], ['tunnel', 'Tunnel']].map(([k, n]) => `<button data-echo="${k}">${n}</button>`).join('');
$('echoes').addEventListener('click', e => { const k = e.target.dataset?.echo; if (k) setEcho(k); });
$('width').addEventListener('input', () => setEcho(ui.echo));
function setEcho(k) { ui.echo = k; A?.setReverb(echoOf(k)); document.querySelectorAll('[data-echo]').forEach(b => b.classList.toggle('on', b.dataset.echo === k)); }
$('crashes').innerHTML = ['car', 'metal', 'concrete', 'building', 'tree', 'tyres'].map(m => ['tap', 'crunch', 'crash'].map(c => `<button data-crash="${c}:${m}">${m === 'metal' ? 'rail' : m === 'tyres' ? 'tyre wall' : m} ${c}</button>`).join('')).join('') + '<button data-x="glass">glass</button><button data-x="tear">part off</button><button data-x="scrape">scrape a rail</button><button data-x="wall">scrape a wall</button>';
$('crashes').addEventListener('click', e => {
  const t = e.target.dataset ?? {};
  if (t.crash) { const [c, m] = t.crash.split(':'); crash?.impact(c, m, 0.7); }
  if (t.x === 'glass') crash?.glass();
  if (t.x === 'tear') crash?.tear();
  if (t.x === 'scrape' || t.x === 'wall') { const m = t.x === 'scrape' ? 'metal' : 'concrete'; ui.scrape = ui.scrape === m ? null : m; e.target.classList.toggle('on', !!ui.scrape); }
});
$('thump').onclick = () => voice?.event('thump', 0.8);
$('handbrake').onclick = () => voice?.event('handbrake');
document.querySelectorAll('[data-ab]').forEach(b => b.onclick = () => { ui.ab[b.dataset.ab] = { car: ui.car, picks: { ...ui.picks } }; b.textContent = `${b.dataset.ab}: ${db.cars[ui.car].name}${Object.values(ui.picks).filter(Boolean).length ? ` + ${Object.values(ui.picks).filter(Boolean).length} parts` : ''}`; });
document.querySelectorAll('[data-sweepab]').forEach(b => b.onclick = () => {
  const x = ui.ab[b.dataset.sweepab]; if (!x) return;
  ui.car = x.car; ui.picks = { ...x.picks }; renderParts(); applySpec();
  st.sweeping = { phase: 'up', t: 0, up: 3.5 }; st.target = spec.engine.idleRpm;
});
renderParts();
applySpec();
// (the tests: the page's handles)
globalThis.__audioPage = { get A() { return A; }, get voice() { return voice; }, get crash() { return crash; }, st, ui, setMode, setView, setEcho, applySpec, go };
