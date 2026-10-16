// In-engine cinematics (docs/PURSUIT.md; data/cinematics.json), pure: where the camera is at a moment of one — its
// shots, each a smooth curve (Catmull-Rom) through control points placed round a car as it moves (its right, up and
// forward, so the camera travels with it), eased, looking at a point by a car, its field of view eased between two; a
// shot's point may be "chase", the game's own chase camera then, so the last shot ends on it and hands over without a
// cut. And the player's car's throttle while the AI drives it. Nothing of the page: play/questUi.js runs it, the
// tests check it.
//
//   cinematicCamera(def, t, { subjects: { player: pose, police: pose, 'player:1': pose, … }, chase: { p, look, fov } })
//     → { p: [x, y, z], look: [x, y, z], fov, shot }     pose: { p: [x, y, z], f: forward (unit), l: left (unit) }
//   throttleAt(def.player.throttle, t) → 0–1          EASE.inOut(u) …          catmullRom(points, u) → [x, y, z]

const clamp01 = u => Math.max(0, Math.min(1, u));
export const EASE = {
  linear: u => u,
  in: u => u * u * u,
  out: u => 1 - (1 - u) ** 3,
  inOut: u => u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2,
};

// a smooth curve through the points (its ends: the first and last), at u from 0 to 1 — even shares between them
export function catmullRom(pts, u) {
  if (pts.length === 1) return pts[0].slice();
  const n = pts.length - 1, x = clamp01(u) * n, i = Math.min(n - 1, Math.floor(x)), t = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

// [s, value] pairs, smoothly between (held at the ends)
export function throttleAt(pairs, t) {
  if (!pairs?.length) return 1;
  if (t <= pairs[0][0]) return pairs[0][1];
  for (let i = 1; i < pairs.length; i++) if (t <= pairs[i][0]) { const [a, va] = pairs[i - 1], [b, vb] = pairs[i]; return va + (vb - va) * EASE.inOut((t - a) / (b - a || 1)); }
  return pairs.at(-1)[1];
}

export const shotAt = (def, t) => def.shots.find(s => t >= s.from && t < s.to) ?? def.shots.at(-1);

// a point given as [right, up, forward] from a car (its pose), or "chase" — the game's camera's (look: its look)
function place(pt, pose, chase, which = 'p') {
  if (pt === 'chase') return chase[which].slice();
  const [r, u, f] = pt;
  return [pose.p[0] - pose.l[0] * r + pose.f[0] * f, pose.p[1] + u + pose.f[1] * f, pose.p[2] - pose.l[2] * r + pose.f[2] * f];
}

export function cinematicCamera(def, t, { subjects, chase }) {
  const s = shotAt(def, t), pose = subjects[s.subject] ?? subjects.player;
  const u = (EASE[s.ease] ?? EASE.inOut)(clamp01((t - s.from) / (s.to - s.from || 1)));
  const p = catmullRom(s.path.map(pt => place(pt, pose, chase, 'p')), u);
  const look = place(s.look, pose, chase, 'look');
  const fa = s.fov?.[0] === 'chase' ? chase.fov : s.fov?.[0] ?? chase.fov, fb = s.fov?.[1] === 'chase' ? chase.fov : s.fov?.[1] ?? fa;
  // (a shot ending on the chase camera: its look turns to the chase's by the end too)
  const lk = s.look !== 'chase' && s.path.at(-1) === 'chase' ? look.map((v, k) => v + (chase.look[k] - v) * u) : look;
  return { p, look: lk, fov: fa + (fb - fa) * u, shot: s };
}
