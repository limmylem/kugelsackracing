// What's wrong with a route, in plain English (the editor lists these; a quest can't be published with a
// route that has errors). Pure: works on a compiled route (route/model.js).
//
//   validateRoute(compiled) → [{ level: 'error' | 'warning', field, message }]
//   checkRoadData(N, roadData) → { changed, versionChanged, missing: [{ key, name }], altered: [{ key, name, was, now }] }

import { isCovered, mergeCuts } from './checkpoints.js';

export const LIMITS = { minLength: 500, maxLength: 80000, gateGap: 25, needCheckpoints: 2000 };

const km = m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

// the roads a route was made on, against the map now: gone (an error: the route can't be driven as made)
// or changed shape (a warning: check it)
export function checkRoadData(N, roadData) {
  const out = { changed: false, versionChanged: false, missing: [], altered: [] };
  if (!roadData) return out;
  out.versionChanged = !!(roadData.version && N.version && roadData.version !== N.version);
  for (const sg of roadData.segments ?? []) {
    const now = N.byKey.get(sg.key);
    if (!now) out.missing.push({ key: sg.key, name: sg.name ?? null });
    else if (sg.length != null && Math.abs(now.length - sg.length) > Math.max(2, sg.length * 0.02)) out.altered.push({ key: sg.key, name: now.name ?? sg.name ?? null, was: sg.length, now: Math.round(now.length * 10) / 10 });
  }
  out.changed = out.missing.length > 0 || out.altered.length > 0;
  return out;
}

export function validateRoute(c) {
  const P = [...(c.built?.problems ?? [])];
  const add = (level, field, message) => P.push({ level, field, message });
  const L = c.length ?? 0;
  if (c.built?.line?.length) {
    if (L < LIMITS.minLength) add('error', 'waypoints', `Route is under 500 m (it's ${km(L)}): spread the waypoints out.`);
    if (L > LIMITS.maxLength) add('warning', 'waypoints', `Route is very long (${km(L)}): over ${km(LIMITS.maxLength)} is a long drive for one quest.`);
    for (const i of c.built.uturns ?? []) add('warning', `waypoints.${i}`, `The route turns back on itself at waypoint ${i + 1} (a U-turn).`);
    if (c.loop) {
      const a = c.built.line[0], b = c.built.line.at(-1);
      if (Math.hypot(a.x - b.x, a.z - b.z) > 2) add('error', 'kind', "The loop doesn't close: its end isn't back at its start.");
    }
  }
  // the road data it was made on
  const R = c.roadCheck;
  if (R?.missing.length) add('error', 'roadData', `Route uses a road that no longer exists in OSM data (${[...new Set(R.missing.map(m => m.name ?? 'an unnamed road'))].slice(0, 3).join(', ')}): redraw that part.`);
  if (R?.altered.length) add('warning', 'roadData', `${R.altered.length === 1 ? 'A road' : `${R.altered.length} roads`} on this route changed in the OSM data since it was made (${[...new Set(R.altered.map(m => m.name ?? 'unnamed'))].slice(0, 3).join(', ')}): check the route, then mark it reviewed.`);
  // the grid
  for (const p of c.grid?.problems ?? []) P.push(p);
  // the checkpoints
  const cps = c.checkpoints ?? [];
  cps.forEach((cp, i) => {
    if (!c.loop && (cp.s <= c.grid.startS || cp.s >= c.grid.finishS)) add('error', `checkpoints.${i}`, `Checkpoint ${i + 1} is ${cp.s <= c.grid.startS ? 'before the start' : 'after the finish'}.`);
    if (cp.width != null && cp.width < (c.gates?.[i]?.roadWidth ?? 0)) add('warning', `checkpoints.${i}`, `Checkpoint ${i + 1} is narrower than the road: cars can go round it.`);
    const nx = cps[i + 1];
    if (nx && Math.abs(nx.s - cp.s) < LIMITS.gateGap) add('warning', `checkpoints.${i + 1}`, `Checkpoints ${i + 1} and ${i + 2} are only ${Math.round(Math.abs(nx.s - cp.s))} m apart.`);
  });
  for (const lost of c.lostCheckpoints ?? []) add('warning', 'checkpoints', `A checkpoint was dropped: the route no longer passes ${lost.name ?? 'where it was'}.`);
  if (L > LIMITS.needCheckpoints && !cps.some(cp => cp.required !== false)) add('warning', 'checkpoints', `A ${km(L)} route with no checkpoints: add some (or let the editor place them).`);
  // the shortcuts
  for (const cut of mergeCuts((c.allShortcuts ?? c.shortcuts ?? []).filter(cut => !isCovered(cut, cps, L, c.loop)), L, c.loop)) {
    const where = `between ${km(cut.a)} and ${km(cut.b)}`;
    if (cut.kind === 'crossing') add('error', 'checkpoints', `Route crosses itself without a checkpoint between the crossings: add one ${where}.`);
    else if (cut.kind === 'road') add('warning', 'checkpoints', `Possible shortcut${cut.via ? ` via ${cut.via}` : ' by another road'} skips ${km(cut.saving)} with no checkpoint to stop it: add one ${where}.`);
    else add('warning', 'checkpoints', `The route passes within ${cut.gap} m of itself: a shortcut of ${km(cut.saving)} with no checkpoint to stop it: add one ${where}.`);
  }
  return P;
}
