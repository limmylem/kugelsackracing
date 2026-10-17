// The gauge pods fitted in a car (interior parts, slot "gauges": data/parts/interior/gauge_pod*.json, readout_*) reading
// what they're for while it's driven: each gauge's face gets a dial drawn on it — its name, its scale, a needle at the
// engine's own numbers — over the model's still needle (hidden).
//
//   gaugeKinds(part, n) → the n things its gauges read ("Gauge pod (boost, oil, water)" says; a readout of n: the
//     usual n), each 'boost' | 'oilPressure' | 'water' | 'oilTemp' | 'volts'
//   createGaugeModel(spec) → G; G.update(b, dt) → { boost, oilPressure, water, oilTemp, volts } (bar, bar, °C, °C, V)
//     from the car's snapshot b (physics/vehicle.js): the turbo's boost curve (spec.turbo) with its spool lag, or the
//     manifold's vacuum with none; oil pressure with the revs (none with the engine stopped or blown); the coolant's
//     temperature (physics/mechanical.js); the oil's, slower, with the load
//   findGaugeFaces(object, root) → [{ centre, normal, up, radius }] in root's frame, from the model itself (its round
//     faces and bezels, and its needles: the generator's pods — tools/generators/interior.js gaugePod)
//   createLiveGauges({ THREE, vis, socket, part, spec }) → L; L.update(b, dt) each frame; L.dispose()
// Pure but for the last (tests/unit/liveGauges.test.mjs).

import { t } from '../ui/i18n.js';
import { playerUnits } from '../ui/units.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
function curveAt(curve, x) {
  if (!curve?.length) return 0;
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (x <= curve[i][0]) { const [x0, y0] = curve[i - 1], [x1, y1] = curve[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return curve.at(-1)[1];
}

// ---------- what each gauge reads ----------
export const GAUGE_KINDS = ['boost', 'oilPressure', 'water', 'oilTemp', 'volts'];
const WORDS = [[/oil\s*temp/i, 'oilTemp'], [/oil(\s*press)?/i, 'oilPressure'], [/water|coolant/i, 'water'], [/boost|vac/i, 'boost'], [/volt|batt/i, 'volts']];
export function gaugeKinds(part, n) {
  const out = [], list = /\(([^)]*)\)/.exec(part?.name ?? '')?.[1];
  for (const w of list ? list.split(/,|\band\b/) : []) { const k = WORDS.find(([re]) => re.test(w))?.[1]; if (k && !out.includes(k)) out.push(k); }
  for (const k of ['boost', 'water', 'oilPressure', 'oilTemp', 'volts']) if (out.length < n && !out.includes(k)) out.push(k);
  return out.slice(0, n);
}

// ---------- the numbers ----------
export function createGaugeModel(spec) {
  const E = spec.engine, redline = E.redlineRpm ?? 7000, turbo = spec.turbo?.boost?.length ? spec.turbo : null;
  const lag = turbo ? (spec.turbo.lag ?? (E.induction === 'supercharged' ? 0.05 : 0.45)) : 0.08;
  const S = { boost: 0, oilPressure: 0, water: null, oilTemp: null, volts: 12.4 };
  const follow = (v, to, tau, dt) => v + (to - v) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
  return {
    state: S,
    peakBoost: turbo ? Math.max(...turbo.boost.map(p => p[1])) : 0,
    update(b, dt) {
      const e = b?.engine ?? {}, m = b?.mechanical ?? {}, rpm = e.rpm ?? 0, thr = clamp(e.throttle ?? 0, 0, 1);
      const running = rpm > 300 && !e.health?.blown, condition = e.health?.condition ?? 100;
      // boost (bar over the air outside): the manifold's vacuum with the throttle shut; with a turbo, its curve at
      // these revs as the throttle opens — rising with the spool's lag, falling at once (the blow-off valve); a leak
      // (mechanical damage) loses its share
      const vacuum = running ? -0.68 * (1 - thr) * smooth(300, 700, rpm) : 0;
      const built = turbo && running ? curveAt(turbo.boost, rpm) * smooth(0.2, 0.85, thr) * (1 - (m.boost ?? 0)) : 0;
      const target = Math.max(vacuum, built > 0.02 ? built : vacuum);
      S.boost = follow(S.boost, target, target > S.boost && turbo ? lag : 0.1, dt);
      // the coolant: the cooling model's (physics/mechanical.js), or a warm engine's with none
      const water = Number.isFinite(m.temp) ? m.temp : 88;
      S.water = S.water == null ? water : follow(S.water, water, 0.6, dt);
      // the oil: after the coolant, slowly, hotter with the work the engine does
      const load = thr * clamp(rpm / redline, 0, 1);
      S.oilTemp = S.oilTemp == null ? water + 4 : follow(S.oilTemp, running ? water + 6 + 22 * load : water, 30, dt);
      // its pressure: with the revs, a little less hot or worn; none stopped
      const press = running ? (1.3 + 4.2 * clamp(rpm / (0.55 * redline), 0, 1)) * (1 - 0.25 * smooth(105, 135, S.oilTemp)) * (0.55 + 0.45 * condition / 100) : 0;
      S.oilPressure = follow(S.oilPressure, press, 0.15, dt);
      // the battery: charging while it runs
      S.volts = follow(S.volts, running ? 14.1 - 0.25 * smooth(0, 0.9, thr) : 12.4, 0.4, dt);
      return S;
    },
  };
}

// ---------- each kind's dial ----------
// (scales in bar and °C, or psi and °F for imperial units; warn: where the red starts — from that end)
export function dialOf(kind, { imperial = false, peakBoost = 0 } = {}) {
  const psi = v => v * 14.5038, F = c => c * 9 / 5 + 32;
  const label = t(`gauge.${kind}`);
  if (kind === 'boost') {
    const top = Math.max(1, Math.min(3, Math.ceil(peakBoost * 2) / 2));
    return imperial ? { label, unit: 'psi', min: -15, max: Math.ceil(psi(top) / 5) * 5, step: 5, of: psi, warn: null } : { label, unit: 'bar', min: -1, max: top, step: top > 1.5 ? 0.5 : 0.5, of: v => v, warn: null };
  }
  if (kind === 'oilPressure') return imperial ? { label, unit: 'psi', min: 0, max: 100, step: 20, of: psi, low: 15 } : { label, unit: 'bar', min: 0, max: 7, step: 1, of: v => v, low: 1 };
  if (kind === 'water') return imperial ? { label, unit: '°F', min: 100, max: 260, step: 40, of: F, warn: 230 } : { label, unit: '°C', min: 40, max: 130, step: 20, of: c => c, warn: 110 };
  if (kind === 'oilTemp') return imperial ? { label, unit: '°F', min: 120, max: 300, step: 40, of: F, warn: 266 } : { label, unit: '°C', min: 50, max: 150, step: 25, of: c => c, warn: 130 };
  return { label, unit: 'V', min: 8, max: 16, step: 2, of: v => v, low: 11.5 };
}
export const NEEDLE_SWEEP = 270;           // degrees, from bottom left round to bottom right
export const needleAngle = (dial, v) => (-135 + NEEDLE_SWEEP * clamp((dial.of(v) - dial.min) / (dial.max - dial.min), 0, 1)) * Math.PI / 180;

// ---------- the faces, from the model ----------
// Its pods are rows of round gauges: discs (the faces and bezels: 168 points each in the generator's models) and
// needles (36 each). The discs' spread finds the row: the thinnest way through them is the way they face (the
// needles are on the front), the longest the row's; each gauge's centre is along it, evenly.
function eigen3(A) {
  // (Jacobi rotations: a 3×3 symmetric matrix's eigenvalues and vectors)
  const a = A.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-14) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  return [0, 1, 2].map(i => ({ value: a[i][i], vector: [V[0][i], V[1][i], V[2][i]] })).sort((x, y) => x.value - y.value);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = a => { const l = Math.hypot(...a) || 1; return scale(a, 1 / l); };
// pieces: [{ points: [[x, y, z]…] (root frame), count (its vertices) }]; up: the root's up ([0, 1, 0])
export function facesFrom(pieces, up = [0, 1, 0]) {
  const discs = pieces.filter(p => p.count >= 168 && p.count % 168 === 0), needles = pieces.find(p => p.count % 36 === 0 && p.count % 168 !== 0 && p.count <= 36 * 6);
  if (!discs.length || !needles) return [];
  const n = needles.count / 36, pts = discs.flatMap(p => p.points);
  const C = scale(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = sub(p, C); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j] / pts.length; }
  const [thin, mid, long] = eigen3(cov);
  const nc = scale(needles.points.reduce(add, [0, 0, 0]), 1 / needles.points.length);
  const normal = norm(scale(thin.vector, Math.sign(dot(sub(nc, C), thin.vector)) || 1));
  const span = v => { let lo = Infinity, hi = -Infinity; for (const p of pts) { const s = dot(sub(p, C), v); lo = Math.min(lo, s); hi = Math.max(hi, s); } return [lo, hi]; };
  const [ml, mh] = span(mid.vector), [ll, lh] = span(long.vector), [, front] = span(normal);
  const R = n > 1 ? (mh - ml) / 2 : Math.min(mh - ml, lh - ll) / 2, gap = n > 1 ? (lh - ll - 2 * R) / (n - 1) : 0;
  const row = norm(long.vector), lift = sub(up, scale(normal, dot(up, normal)));
  const dialUp = Math.hypot(...lift) > 0.2 ? norm(lift) : norm(row);
  const across = norm(mid.vector), middle = add(C, add(scale(across, (ml + mh) / 2), scale(normal, front + 0.0012)));
  return Array.from({ length: n }, (_, i) => ({ centre: add(middle, scale(row, (i - (n - 1) / 2) * gap + (ll + lh) / 2)), normal, up: dialUp, radius: Math.max(0.008, R - 0.0045) }));
}
export function findGaugeFaces(object, root) {
  object.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert(), pieces = [];
  object.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const P = o.geometry.attributes.position, m = inv.clone().multiply(o.matrixWorld), e = m.elements, points = [];
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); points.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]); }
    pieces.push({ mesh: o, points, count: P.count });
  });
  const faces = facesFrom(pieces);
  return { faces, needles: faces.length ? pieces.filter(p => p.count % 36 === 0 && p.count % 168 !== 0 && p.count <= 216).map(p => p.mesh) : [] };
}

// ---------- on the car ----------
export function createLiveGauges({ THREE, vis, socket, part, spec }) {
  const att = vis.attached?.get(socket), object = att?.object;
  if (!object) return null;
  const root = vis.group ?? vis.root;
  root.updateWorldMatrix(true, true);
  const { faces, needles } = findGaugeFaces(object, root);
  if (!faces.length) return null;
  for (const m of needles) m.visible = false;
  const model = createGaugeModel(spec), kinds = gaugeKinds(part, faces.length);
  const imperial = playerUnits().system?.other === 'imperial';
  const dials = faces.map((f, i) => {
    const kind = kinds[i], dial = dialOf(kind, { imperial, peakBoost: model.peakBoost });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(f.radius, 40), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.name = `live-gauge-${kind}`;
    // (facing the driver, the dial's top up)
    const z = new THREE.Vector3(...f.normal), y = new THREE.Vector3(...f.up), x = new THREE.Vector3().crossVectors(y, z).normalize();
    y.crossVectors(z, x);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    mesh.position.set(...f.centre);
    root.add(mesh);
    return { kind, dial, canvas, tex, mesh, ctx: canvas.getContext('2d'), shown: null, shownValue: null };
  });
  let since = 1;
  function draw(d, v) {
    const g = d.ctx, D = d.dial, c = 128, a = needleAngle(D, v), val = D.of(v);
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#0d0f12'; g.beginPath(); g.arc(c, c, 127, 0, Math.PI * 2); g.fill();
    const toA = x => (-135 + NEEDLE_SWEEP * (x - D.min) / (D.max - D.min) - 90) * Math.PI / 180;
    // (the red: from warn up, or under low)
    g.lineWidth = 12; g.strokeStyle = '#d8342c';
    if (D.warn != null) { g.beginPath(); g.arc(c, c, 104, toA(D.warn), toA(D.max)); g.stroke(); }
    if (D.low != null) { g.beginPath(); g.arc(c, c, 104, toA(D.min), toA(D.low)); g.stroke(); }
    g.strokeStyle = '#f2f2f2'; g.fillStyle = '#f2f2f2'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 25px Barlow, system-ui, sans-serif';
    for (let k = D.min; k <= D.max + 1e-6; k += D.step) {
      const q = toA(k), major = true;
      g.lineWidth = major ? 5 : 2; g.beginPath(); g.moveTo(c + Math.cos(q) * 96, c + Math.sin(q) * 96); g.lineTo(c + Math.cos(q) * 116, c + Math.sin(q) * 116); g.stroke();
      g.fillText(Number.isInteger(k) ? String(k) : k.toFixed(1), c + Math.cos(q) * 74, c + Math.sin(q) * 74);
      const half = k + D.step / 2;
      if (half < D.max) { const h = toA(half); g.lineWidth = 2; g.beginPath(); g.moveTo(c + Math.cos(h) * 104, c + Math.sin(h) * 104); g.lineTo(c + Math.cos(h) * 116, c + Math.sin(h) * 116); g.stroke(); }
    }
    g.fillStyle = '#ffb347'; g.font = '700 24px Barlow, system-ui, sans-serif'; g.fillText(D.label, c, c + 44);
    g.fillStyle = '#c9ced6'; g.font = '600 20px "JetBrains Mono", monospace';
    g.fillText(`${Math.abs(val) < 10 && D.unit !== '°C' && D.unit !== '°F' ? val.toFixed(1) : Math.round(val)} ${D.unit}`, c, c + 72);
    // the needle
    const na = a - Math.PI / 2;
    g.strokeStyle = '#ff6a1f'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(c - Math.cos(na) * 18, c - Math.sin(na) * 18); g.lineTo(c + Math.cos(na) * 108, c + Math.sin(na) * 108); g.stroke();
    g.fillStyle = '#20242a'; g.beginPath(); g.arc(c, c, 13, 0, Math.PI * 2); g.fill();
    d.tex.needsUpdate = true;
  }
  return {
    object, dials,
    update(b, dt) {
      const S = model.update(b, dt);
      // (drawn again 20 times a second at most, and only when the needle has moved)
      if ((since += dt) < 0.05) return;
      since = 0;
      const visible = object.visible !== false && !!object.parent;
      for (const d of dials) {
        d.mesh.visible = visible;
        const v = S[d.kind], a = needleAngle(d.dial, v);
        if (d.shown != null && Math.abs(a - d.shown) < 0.004 && Math.abs(v - d.shownValue) < 0.05 * d.dial.step) continue;
        d.shown = a; d.shownValue = v; draw(d, v);
      }
    },
    dispose() {
      for (const m of needles) m.visible = true;
      for (const d of dials) { d.mesh.parent?.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); d.tex.dispose(); }
    },
  };
}
