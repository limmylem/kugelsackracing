// The turns along a route, for directions (play/turnHud.js: "Turn left onto King William Street in 200 m"), pure.
//
//   routeTurns(line, { nodes, segments, loop }) → [{ s, angle, way: 'left' | 'right', kind, junction, name }]
//     line: the route's centreline [{ x, z, s }] (route/build.js); nodes: the junctions it passes [{ s, degree }] and
//     segments: its roads in order [{ sStart, name }] (both from buildRoute; a race's course has neither: its bends only)
//   kind: 'slight' | 'turn' | 'sharp' | 'uturn' at a junction, 'bend' | 'sharpBend' | 'hairpin' on the road itself,
//     'arrive' at the end (not for a loop)
//   nextTurn(turns, s, { length, loop }) → { turn, dist, then } the next one past s, how far, and the one right after
//     it if that's close (THEN m)
//
// At a junction (three roads or more) a change of heading of TURN.junction degrees or more is a turn; on the road,
// a bend counts from TURN.bend degrees (route/stats.js corners) — a gentle curve the road takes anyway isn't one.

import { at } from './geometry.js';
import { corners } from './stats.js';

export const TURN = { junction: 25, bend: 60, before: [25, 5], after: [5, 25], merge: 35, then: 150 };
const heading = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const wrap = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// how much the route turns at s: the heading TURN.before m before it against TURN.after m after it (+ left, degrees)
export function turnAngle(line, s, loop = false) {
  const hb = heading(at(line, s - TURN.before[0], loop), at(line, s - TURN.before[1], loop));
  const ha = heading(at(line, s + TURN.after[0], loop), at(line, s + TURN.after[1], loop));
  return wrap(ha - hb) * 180 / Math.PI;
}
export function kindOf(angle, junction) {
  const a = Math.abs(angle);
  if (junction) return a >= 165 ? 'uturn' : a >= 130 ? 'sharp' : a >= 50 ? 'turn' : 'slight';
  return a >= 140 ? 'hairpin' : a >= 100 ? 'sharpBend' : 'bend';
}

export function routeTurns(line, { nodes = null, segments = null, loop = false } = {}) {
  if (!line || line.length < 3) return [];
  const L = line.at(-1).s, out = [];
  const named = (segments ?? []).filter(g => Number.isFinite(g.sStart)).sort((a, b) => a.sStart - b.sStart);
  const roadAt = s => { let n = null; for (const g of named) { if (g.sStart <= s) n = g.name ?? null; else break; } return n; };
  for (const nd of nodes ?? []) {
    if (!(nd.degree >= 3) || !Number.isFinite(nd.s) || nd.s < 8 || nd.s > L - 8) continue;
    const angle = turnAngle(line, nd.s, loop);
    if (Math.abs(angle) < TURN.junction) continue;
    const onto = roadAt(nd.s + 10), from = roadAt(nd.s - 10);
    out.push({ s: nd.s, angle, way: angle > 0 ? 'left' : 'right', kind: kindOf(angle, true), junction: true, name: onto && onto !== from ? onto : null });
  }
  for (const c of corners(line, loop)) {
    if (Math.abs(c.angle) < TURN.bend || out.some(t => t.junction && Math.abs(t.s - c.s) < TURN.merge)) continue;
    out.push({ s: c.s, angle: c.angle, way: c.way, kind: kindOf(c.angle, false), junction: false, name: null });
  }
  out.sort((a, b) => a.s - b.s);
  // (two close together the same way: one)
  const merged = [];
  for (const t of out) { const p = merged.at(-1); if (p && t.s - p.s < TURN.merge && p.way === t.way) { if (Math.abs(t.angle) > Math.abs(p.angle)) merged[merged.length - 1] = { ...t, name: t.name ?? p.name }; } else merged.push(t); }
  if (!loop) merged.push({ s: L, angle: 0, way: null, kind: 'arrive', junction: false, name: null });
  return merged;
}

export function nextTurn(turns, s, { length = Infinity, loop = false } = {}) {
  if (!turns?.length) return null;
  let i = turns.findIndex(t => t.s > s + 2);
  let dist;
  if (i < 0) { if (!loop) return null; i = 0; dist = turns[0].s + length - s; } else dist = turns[i].s - s;
  const n = turns[i + 1] ?? (loop ? turns[0] : null), gap = n ? (n.s > turns[i].s ? n.s - turns[i].s : n.s + length - turns[i].s) : Infinity;
  return { turn: turns[i], dist, then: n && n !== turns[i] && gap <= TURN.then ? n : null };
}
