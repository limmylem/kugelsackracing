// Parts coming loose and off in a crash: which, when, and what shape they are for the physics
// (physics/looseParts.js). Pure, so the page, tests and later a server agree.
//
// Each detachable part (its detach block: data/schemas/part.schema.json) is attached, loose or
// detached. A crash's stress on it (garage/damage.js: condition points by its toughness, whatever the
// damage setting) adds up; past looseThreshold it comes loose — or, with looseType none (mirrors,
// wings), comes straight off — and one hit past detachThreshold tears it off (half that, once it's
// loose). A loose part also tears off when the physics says it pulled on its fixings too hard. Off:
// nothing comes loose.

const DEG = Math.PI / 180;
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };

// A part's shape (its bounds, or its base part's) for the physics: { mass, half, centre (part frame),
// origin (its socket, car frame), type, axis, limits (rad), mount, open, pop, strength, plateNormal,
// plateArea, edge, looseDrag }; rng picks a hanging part's mount
export function bodyDef(part, socket, parts, rng = Math.random) {
  let bounds = null;
  for (let p = part, i = 0; p && i < 8 && !bounds; p = p.variantOf ? parts[p.variantOf] : null, i++) bounds = p.bounds;
  bounds ??= { min: [-0.15, -0.15, -0.15], max: [0.15, 0.15, 0.15] };
  const D = part.detach ?? {}, half = [0, 1, 2].map(k => (bounds.max[k] - bounds.min[k]) / 2), centre = [0, 1, 2].map(k => (bounds.max[k] + bounds.min[k]) / 2);
  const thin = [0, 1, 2].reduce((a, k) => half[k] < half[a] ? k : a, 0), plateNormal = [0, 0, 0];
  plateNormal[thin] = 1;
  const axis = D.hinge ? norm(D.hinge.axis) : [1, 0, 0], a = axis.findIndex(x => Math.abs(x) > 0.5);
  // (the edge across from the hinge: where the air gets under a bonnet)
  const edge = centre.map((c, k) => k === a ? c : c * 2);
  return {
    mass: part.mass, half, centre, origin: [...socket.position], type: D.looseType ?? 'none', axis,
    limits: D.hinge ? D.hinge.limits.map(x => x * DEG) : [0, 0],
    mount: D.mounts?.length ? D.mounts[Math.floor(rng() * D.mounts.length) % D.mounts.length] : [0, 0, 0],
    open: D.open ?? 0, pop: D.pop ?? 0, strength: D.attachStrength ?? 1000, looseDrag: D.looseDrag ?? 0,
    plateNormal, plateArea: 4 * [0, 1, 2].filter(k => k !== thin).reduce((x, k) => x * half[k], 1), edge,
  };
}

// What a crash does to the parts' attachment: states { socket: { state, stress } } (as they are; not
// changed), stress: the damage result's, bySocket: socket → part definition. Returns the changes:
// [{ socket, from, to, stress, reason }], and the states with them
export function attachAfterImpact(states, stress, bySocket, { mode = 'full' } = {}) {
  const next = { ...states }, changes = [];
  if (mode === 'off') return { states: next, changes };
  for (const s of stress) {
    const part = bySocket[s.target], D = part?.detach;
    if (!D?.detachable) continue;
    const was = next[s.target] ?? { state: 'attached', stress: 0 };
    if (was.state === 'detached') continue;
    const now = { ...was, stress: +(was.stress + s.points).toFixed(2) };
    let to = was.state, reason = null;
    if (s.points >= D.detachThreshold * (was.state === 'loose' ? 0.5 : 1)) { to = 'detached'; reason = `a ${s.points.toFixed(0)}-point hit (tears off at ${D.detachThreshold})`; }
    else if (was.state === 'attached' && now.stress >= D.looseThreshold) { to = D.looseType === 'none' ? 'detached' : 'loose'; reason = `${now.stress.toFixed(0)} points of hits (loose at ${D.looseThreshold})`; }
    now.state = to;
    next[s.target] = now;
    if (to !== was.state) changes.push({ socket: s.target, from: was.state, to, stress: now.stress, reason });
  }
  return { states: next, changes };
}

// A wheel torn off (garage/mechanical.js), as the physics' debris: its rim, tyre and spacer as one
// rolling cylinder where the wheel is now. parts: the rim, tyre and spacer definitions fitted there;
// centre: the wheel's centre (car frame); radius, spin (rad/s): as the physics has them
export function wheelDef(parts, { centre, radius, spin = 0 }) {
  const tyre = parts.find(p => p?.tyreSize), mass = parts.reduce((a, p) => a + (p?.mass ?? 0), 0);
  return { shape: 'wheel', mass, radius, halfWidth: (tyre?.tyreSize.width ?? 190) / 2000, centre: [0, 0, 0], half: [0.1, radius, radius], origin: [...centre], spin };
}
