// A car's shared standards (Phase 8 Step 3; data/content/standards.json; docs/CONTENT_PIPELINE.md) as the tags parts'
// fits, requires and conflicts use (garage/validate.js) — so a part made to a standard fits every car built to it,
// worked out from the car's standards instead of listed part by part.
//
//   standards (car.json): { type, engineMount, bay, boltPattern, rims: [min, max], seatMount, steeringColumn,
//     bumperMount, spoilerMount (one or a list), exhaustRoute }
//   standardTags(standards, S) → ['body:coupe', 'mount:long', 'bay:compact', 'bay:medium', 'bolt_pattern:5x114.3',
//     'rim_fits:16', …]   (a bay takes an engine its size or smaller: every size up to its own)
//   standardProblems(standards, S) → ['bay "huge" isn't a standard (compact, medium, large, xl)', …]
//
// No browser or Node APIs.

const listOf = v => v == null ? [] : Array.isArray(v) ? v : [v];
const named = (o = {}) => Object.keys(o).filter(k => !k.startsWith('_'));

export function standardTags(st, S) {
  if (!st) return [];
  const out = [];
  if (st.type) out.push(`body:${st.type}`);
  if (st.engineMount) out.push(`mount:${st.engineMount}`);
  if (st.bay) { const order = S.bays.order, i = order.indexOf(st.bay); for (const b of order.slice(0, i + 1)) out.push(`bay:${b}`); }
  if (st.boltPattern) out.push(`bolt_pattern:${st.boltPattern}`);
  if (st.rims) for (let d = st.rims[0]; d <= st.rims[1]; d++) out.push(`rim_fits:${d}`);
  for (const [key, tag] of [['seatMount', 'seat_mount'], ['steeringColumn', 'steering_column'], ['bumperMount', 'bumper_mount'], ['spoilerMount', 'spoiler_mount'], ['exhaustRoute', 'exhaust_route']])
    for (const v of listOf(st[key])) out.push(`${tag}:${v}`);
  return out;
}

export function standardProblems(st, S) {
  if (!st) return [];
  const out = [], one = (key, v, set) => { if (v != null && !named(set).includes(v)) out.push(`${key} "${v}" isn't a standard (${named(set).join(', ')})`); };
  one('type', st.type, S.types);
  one('engineMount', st.engineMount, S.engineMounts);
  if (st.bay != null && !S.bays.order.includes(st.bay)) out.push(`bay "${st.bay}" isn't a standard (${S.bays.order.join(', ')})`);
  one('boltPattern', st.boltPattern, S.boltPatterns);
  if (st.rims) {
    const [a, b] = st.rims, { min, max } = S.rimSizes;
    if (!(Number.isInteger(a) && Number.isInteger(b) && a <= b && a >= min && b <= max)) out.push(`rims [${st.rims}] should be two whole inch sizes, smallest first, within ${min}–${max}`);
  }
  one('seatMount', st.seatMount, S.seatMounts);
  one('steeringColumn', st.steeringColumn, S.steeringColumns);
  one('bumperMount', st.bumperMount, S.bumperMounts);
  for (const v of listOf(st.spoilerMount)) one('spoilerMount', v, S.spoilerMounts);
  one('exhaustRoute', st.exhaustRoute, S.exhaustRoutes);
  return out;
}
