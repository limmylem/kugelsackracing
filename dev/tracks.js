// The track generator's test page (Phase 5 Step 1; dev/tracks.html). Tracks are made in a Web Worker and
// kept in this browser by code (track/client.js); the map, the profile and the stats are drawn from what
// comes back. Test drive opens the track in the game (dev/world.html?world=track&code=…&drive=1): the
// Phase 4 route test drive on it — countdown, checkpoints, timing, resets.

import { loadTrack, codeOf } from '../track/client.js';
import { decode, generateTrack, LATEST } from '../track/generate.js';
import { viewCourse } from '../route/model.js';
import { trackProjection } from '../track/build.js';

const $ = id => document.getElementById(id);
const cfg = await (await fetch('data/tracks.json', { cache: 'no-cache' })).json();
const FIELDS = ['type', 'style', 'l0', 'l1', 'c0', 'c1', 'width', 'elevation', 'climb', 'banking', 'crests'];
let data = null, flying = null, busy = false;

for (const p of cfg.presets) $('preset').add(new Option(p.name, p.id));
$('preset').add(new Option('Custom', 'custom'));
function setParams(p) {
  $('type').value = p.type; $('style').value = p.style; $('l0').value = p.lengthKm[0]; $('l1').value = p.lengthKm[1]; $('c0').value = p.corners[0]; $('c1').value = p.corners[1];
  $('width').value = p.width; $('elevation').value = p.elevation; $('climb').value = p.climb ?? 0; $('banking').value = p.banking ?? 0; $('crests').checked = !!p.crests;
}
const params = () => ({ type: $('type').value, style: $('style').value, lengthKm: [+$('l0').value, +$('l1').value], corners: [+$('c0').value, +$('c1').value], width: +$('width').value, elevation: +$('elevation').value, climb: +$('climb').value, banking: +$('banking').value, crests: $('crests').checked });
$('preset').onchange = () => { const p = cfg.presets.find(x => x.id === $('preset').value); if (p) setParams(p.params); };
for (const f of FIELDS) $(f).addEventListener('change', () => { $('preset').value = 'custom'; });
setParams(cfg.presets[1].params); $('preset').value = cfg.presets[1].id;

async function generate(spec) {
  if (busy) return;
  busy = true; stopFly();
  $('go').disabled = true; $('progress').firstElementChild.style.width = '0%';
  $('status').textContent = 'Making the track…';
  try {
    data = await loadTrack(spec, { onProgress: (step, share) => { $('progress').firstElementChild.style.width = `${Math.round(share * 100)}%`; $('status').textContent = `${step}…`; } });
    $('progress').firstElementChild.style.width = '100%';
    $('code').value = data.code;
    try { localStorage.setItem('driveWorld.track.code', data.code); } catch { /* not kept */ }     // (the game's Track world opens it)
    history.replaceState(null, '', `dev/tracks.html?code=${data.code}`);
    $('status').textContent = data.fromCache ? `From this browser's cache: ${Math.round(data.loadMs)} ms` : `Made in ${(data.loadMs / 1000).toFixed(2)} s (layout ${Math.round(data.ms)} ms, ${data.attempts.length} attempt${data.attempts.length > 1 ? 's' : ''})`;
    for (const b of ['copy', 'flyBtn', 'drive']) $(b).disabled = false;
    draw();
  } catch (e) {
    $('status').textContent = `No track: ${e.message}`;
    data = null;
    showAttempts(e.attempts ?? []);
  } finally { busy = false; $('go').disabled = false; }
}
$('go').onclick = () => generate({ seed: $('seed').value, params: params() });
$('random').onclick = () => { $('seed').value = String(Math.floor(Math.random() * 4294967296)); generate({ seed: $('seed').value, params: params() }); };
$('code').onkeydown = e => { if (e.key === 'Enter') openCode($('code').value); };
function openCode(code) {
  try { const d = decode(code); setParams(d.params); $('seed').value = String(d.seed); $('preset').value = cfg.presets.find(p => codeOf({ seed: d.seed, params: p.params, version: d.version }) === codeOf({ code }))?.id ?? 'custom'; generate({ code }); }
  catch (e) { $('status').textContent = e.message; }
}
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(data.code); $('status').textContent = `Copied ${data.code}`; } catch { $('code').select(); document.execCommand('copy'); } };
$('drive').onclick = () => { location.href = `dev/world.html?world=track&code=${encodeURIComponent(data.code)}&drive=1`; };
$('flyBtn').onclick = () => flying ? stopFly() : fly();
addEventListener('resize', () => data && draw());

function showAttempts(list) {
  $('attempts').innerHTML = list.map(a => `<div>${a.attempt + 1}. ${a.reason ? a.reason.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '<b style="color:#3ccf7a">✓ passed every check</b>'}</div>`).join('');
}

// ---------- the map, the profile, the stats ----------
function draw() {
  const D = data, C = D.centre, n = C.x.length;
  showAttempts(D.attempts);
  // the map: the road at its width, coloured by how tight it is there
  const cv = $('map'), r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const g = cv.getContext('2d'), [x0, z0, x1, z1] = D.bounds, pad = 40;
  const sc = Math.min((r.width - 2 * pad) / (x1 - x0), (r.height - 2 * pad) / (z1 - z0));
  const X = x => (pad + (x - x0) * sc + ((r.width - 2 * pad) - (x1 - x0) * sc) / 2) * dpr, Z = z => (pad + (z - z0) * sc + ((r.height - 2 * pad) - (z1 - z0) * sc) / 2) * dpr;
  g.fillStyle = '#0f1418'; g.fillRect(0, 0, cv.width, cv.height);
  const curv = i => { const a = (i - 2 + n) % n, b = (i + 2) % n, ax = C.x[i] - C.x[a], az = C.z[i] - C.z[a], bx = C.x[b] - C.x[i], bz = C.z[b] - C.z[i]; const t1 = Math.atan2(az, ax), t2 = Math.atan2(bz, bx); let d = t2 - t1; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) / (Math.hypot(ax, az) + Math.hypot(bx, bz)) * 2; };
  g.lineCap = 'round'; g.lineWidth = Math.max(2, D.width * sc * dpr);
  for (let i = 0; i < (D.closed ? n : n - 1); i++) {
    const j = (i + 1) % n, k = Math.min(1, curv(i) * 30);
    g.strokeStyle = `hsl(${210 - 210 * k}, 75%, ${55 - 10 * k}%)`;
    g.beginPath(); g.moveTo(X(C.x[i]), Z(C.z[i])); g.lineTo(X(C.x[j]), Z(C.z[j])); g.stroke();
  }
  const course = viewCourse(D.course, trackProjection);
  g.fillStyle = '#fff';
  for (const gt of course.gates) { g.beginPath(); g.arc(X(gt.x), Z(gt.z), 4 * dpr, 0, 2 * Math.PI); g.fill(); }
  const st = course.start, h = st.heading * Math.PI / 180;
  g.fillStyle = '#3ccf7a'; g.beginPath(); g.moveTo(X(st.x + Math.sin(h) * 18), Z(st.z + Math.cos(h) * 18)); g.lineTo(X(st.x + Math.cos(h) * 9), Z(st.z - Math.sin(h) * 9)); g.lineTo(X(st.x - Math.cos(h) * 9), Z(st.z + Math.sin(h) * 9)); g.fill();
  if (!D.closed) { const f = course.finish; g.fillStyle = '#ff6b6b'; g.fillRect(X(f.x) - 5 * dpr, Z(f.z) - 5 * dpr, 10 * dpr, 10 * dpr); }
  // a scale bar
  const bar = 500 * sc * dpr; g.fillStyle = '#a3abb5'; g.fillRect(cv.width - bar - 20 * dpr, cv.height - 22 * dpr, bar, 3 * dpr); g.font = `${11 * dpr}px Barlow`; g.fillText('500 m', cv.width - bar - 20 * dpr, cv.height - 28 * dpr);
  // the elevation profile (and banking)
  const pv = $('profile'), pr = pv.getBoundingClientRect();
  pv.width = pr.width * dpr; pv.height = pr.height * dpr;
  const p = pv.getContext('2d');
  p.fillStyle = '#0f1418'; p.fillRect(0, 0, pv.width, pv.height);
  let lo = Infinity, hi = -Infinity; for (const v of C.h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < 10) { const m = (hi + lo) / 2; lo = m - 5; hi = m + 5; }
  const PX = i => (40 + i / (n - 1) * (pr.width - 60)) * dpr, PY = v => (pr.height - 18 - (v - lo) / (hi - lo) * (pr.height - 36)) * dpr;
  p.fillStyle = 'rgba(54,179,245,.18)'; p.beginPath(); p.moveTo(PX(0), PY(lo)); for (let i = 0; i < n; i++) p.lineTo(PX(i), PY(C.h[i])); p.lineTo(PX(n - 1), PY(lo)); p.fill();
  p.strokeStyle = '#36b3f5'; p.lineWidth = 2 * dpr; p.beginPath(); for (let i = 0; i < n; i++) i ? p.lineTo(PX(i), PY(C.h[i])) : p.moveTo(PX(i), PY(C.h[i])); p.stroke();
  p.strokeStyle = 'rgba(255,190,80,.8)'; p.lineWidth = 1 * dpr; p.beginPath(); const bm = Math.max(1, ...C.bank.map(Math.abs)); for (let i = 0; i < n; i++) { const y = (pr.height / 2 - C.bank[i] / bm * (pr.height / 2 - 12)) * dpr; i ? p.lineTo(PX(i), y) : p.moveTo(PX(i), y); } p.stroke();
  p.fillStyle = '#a3abb5'; p.font = `${11 * dpr}px Barlow`;
  p.fillText(`${Math.round(hi)} m`, 4 * dpr, PY(hi) + 4 * dpr); p.fillText(`${Math.round(lo)} m`, 4 * dpr, PY(lo)); p.fillText('elevation (blue) · banking (amber)', 44 * dpr, 14 * dpr);
  // the stats
  const S = D.stats, cs = D.course.stats;
  const rows = [['Length', `${(D.length / 1000).toFixed(2)} km`], ['Type', D.closed ? 'circuit' : 'point to point'], ['Corners', `${S.corners} (${S.groups} groups${S.hairpins ? `, ${S.hairpins} hairpin${S.hairpins > 1 ? 's' : ''}` : ''})`], ['Tightest corner', `${S.tightest} m radius`],
    ['Longest straight', `${S.longestStraight} m`], ['Elevation change', `${S.elevationRange} m`], ['Climb (total)', `${S.climb} m`], ['Steepest', `${S.maxGrade}%`], ['Most banking', `${S.maxBanking}°`],
    ['Checkpoints', D.course.checkpoints.length], ['Estimated lap', cs?.estimatedTime ? `${cs.estimatedTime.toFixed(1)} s` : '—'], ['Attempts', S.attempts], ['Generator', `v${D.version} · hash ${D.hash}`], ['Code', D.code]];
  $('stats').innerHTML = rows.map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join('');
}

// ---------- the fly-through ----------
async function fly() {
  const THREE = await import('three'), { trackMeshes } = await import('../track/render.js');
  const cv = $('fly'); cv.hidden = false; $('map').hidden = true; $('flyBtn').textContent = 'Stop flying';
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true }), r = cv.getBoundingClientRect();
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(r.width, r.height, false);
  const scene = new THREE.Scene(), sky = new THREE.Color('#9cc9f0');
  scene.background = sky; scene.fog = new THREE.Fog(sky, 500, 2600);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.1)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(300, 800, 200); scene.add(sun);
  scene.add(trackMeshes(THREE, data));
  const cam = new THREE.PerspectiveCamera(60, r.width / r.height, 0.5, 6000);
  const C = data.centre, n = C.x.length;
  let s = 0, last = performance.now();
  const at = f => { const i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f); return new THREE.Vector3(C.x[i] + (C.x[j] - C.x[i]) * t, C.h[i] + (C.h[j] - C.h[i]) * t, C.z[i] + (C.z[j] - C.z[i]) * t); };
  const loop = now => {
    if (!flying) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    s = (s + dt * 45 / (data.length / n)) % (data.closed ? n : n - 12);
    const p = at(s), ahead = at((s + 12) % n);
    cam.position.set(p.x, p.y + 3.2, p.z); cam.lookAt(ahead.x, ahead.y + 1.5, ahead.z);
    renderer.render(scene, cam);
    flying.raf = requestAnimationFrame(loop);
  };
  flying = { renderer, raf: requestAnimationFrame(loop) };
}
function stopFly() {
  if (!flying) return;
  cancelAnimationFrame(flying.raf); flying.renderer.dispose(); flying = null;
  $('fly').hidden = true; $('map').hidden = false; $('flyBtn').textContent = 'Fly camera';
  if (data) draw();
}

// ---------- ?determinism=N: every preset's first N seeds, hashed (the cross-browser check) ----------
const q = new URLSearchParams(location.search);
if (q.has('determinism')) {
  const N = +q.get('determinism') || 100, lines = [];
  for (const p of cfg.presets) for (let seed = 0; seed < N; seed++) { const g = generateTrack({ seed, params: p.params, version: LATEST }); lines.push(`${p.id} ${seed} ${g.code} ${g.hash}`); }
  window.__trackHashes = lines;
  $('status').textContent = `Determinism: ${lines.length} tracks hashed (window.__trackHashes)`;
} else if (q.get('code')) openCode(q.get('code'));
else generate({ seed: $('seed').value, params: params() });
