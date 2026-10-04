// A route's start grid and its start and finish lines, pure: up to 8 (or however many) slots behind the
// start line, two side by side where the road is wide enough, staggered, facing along the road; each slot
// can be nudged (along and across); and the plain-English problems with where the grid is.
//
//   placeGrid(line, { count, loop, nodes, startS, adjust }) → { startS, finishS, columns, rows, slots, problems }
//   gateAt(line, s, { width, loop }) → a line across the road at s: { x, z, h, heading, x1, z1, x2, z2, width }

import { at, radiusAt } from './geometry.js';

export const GRID = { count: 8, max: 16, column: 3.2, row: 8, stagger: 4, front: 6, car: 1.9 };

export function headingOf(dx, dz) { return Math.atan2(dx, dz) * 180 / Math.PI; }

export function gateAt(line, s, { width = null, loop = false, margin = 2 } = {}) {
  const p = at(line, s, loop), w = width ?? p.w + 2 * margin;
  // (across: the way along turned a quarter left, z being south)
  const lx = p.dz, lz = -p.dx;
  return { s: p.s, x: p.x, z: p.z, h: p.h, dx: p.dx, dz: p.dz, heading: headingOf(p.dx, p.dz), width: w, x1: p.x + lx * w / 2, z1: p.z + lz * w / 2, x2: p.x - lx * w / 2, z2: p.z - lz * w / 2 };
}

// where on the road a point a distance d to the left of s is
export function offsetAt(line, s, d, loop = false) {
  const p = at(line, s, loop);
  return { x: p.x + p.dz * d, z: p.z - p.dx * d, h: p.h, heading: headingOf(p.dx, p.dz), w: p.w, s: p.s };
}

export function placeGrid(line, { count = GRID.count, loop = false, nodes = [], startS = null, finishS = null, adjust = {} } = {}) {
  const problems = [], L = line.length ? line.at(-1).s : 0;
  count = Math.max(1, Math.min(GRID.max, Math.round(count)));
  if (L < 2) return { startS: 0, finishS: 0, columns: 1, rows: 0, slots: [], problems };
  // side by side if the road's wide enough all along where the grid goes (its narrowest)
  const span = n => GRID.front + Math.ceil(count / n) * GRID.row + (n > 1 ? GRID.stagger : 0);
  const narrowest = (s0, s1) => { let w = Infinity; for (let s = Math.max(0, s0); s <= s1; s += 4) w = Math.min(w, at(line, s, loop).w); return w; };
  let columns = 2;
  const S2 = startS ?? Math.min(L * 0.5, span(2) + 2);
  if (narrowest(S2 - span(2), S2) < 2 * GRID.column) columns = 1;
  const rows = Math.ceil(count / columns), length = span(columns);
  // the start line: as near the route's start as the grid allows (on a loop, the start and finish line)
  const start = startS ?? (loop ? length + 2 : Math.min(length + 2, L * 0.5));
  const finish = loop ? start : (finishS ?? Math.max(start + 1, L - 15));
  const w = narrowest(start - length, start);
  const slots = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns), col = i % columns, a = adjust?.[i] ?? adjust?.[String(i)] ?? {};
    const s = start - GRID.front - row * GRID.row - (col ? GRID.stagger : 0) + (a.s ?? 0);
    const d = (columns > 1 ? (col ? -1 : 1) * GRID.column / 2 : 0) + (a.d ?? 0);
    const o = offsetAt(line, s, d, loop);
    slots.push({ i, s: loop ? ((s % L) + L) % L : s, d, x: o.x, z: o.z, h: o.h, heading: o.heading, roadWidth: o.w });
    if ((!loop && s < 0) || Math.abs(d) + GRID.car / 2 > o.w / 2 + 0.3) problems.push({ level: 'error', field: `grid.${i}`, message: `Grid slot ${i + 1} is off the road.` });
  }
  // the slope, junctions and corners where the grid is
  const back = start - length;
  const grade = Math.abs(at(line, start, loop).h - at(line, back, loop).h) / Math.max(1, length);
  if (grade > 0.06) problems.push({ level: 'warning', field: 'grid', message: `The start grid is on a steep slope (${Math.round(grade * 100)}%): cars may roll before the start. Move the start to flatter road.` });
  const junction = nodes.find(n => n.degree >= 3 && n.s >= back - 4 && n.s <= start + 4);
  if (junction) problems.push({ level: 'warning', field: 'grid', message: 'The start grid is across a junction: cars may start in the side road. Move the start along.' });
  if (columns === 1 && count > 1) problems.push({ level: 'warning', field: 'grid', message: `The road is too narrow for side-by-side slots (${w.toFixed(1)} m): the ${count} cars start in single file.` });
  let tight = Infinity;
  for (let s = Math.max(0, back); s <= start; s += 4) tight = Math.min(tight, radiusAt(line, s, 12, loop));
  if (tight < 40) problems.push({ level: 'warning', field: 'grid', message: `The start grid is on a tight corner (${Math.round(tight)} m radius): start on a straight.` });
  if (!loop && finish - start < 100) problems.push({ level: 'error', field: 'grid', message: 'The finish is too close to the start: lengthen the route.' });
  return { startS: start, finishS: finish, columns, rows, length, slots, problems };
}
