// Names for generated tracks (Phase 5 Step 4): the track's own, to match its theme (a forest's "Black Fir
// Ring", a city's "Harbour City Grand Prix", a mountain's "Eagle Pass Hillclimb"), and its notable corners'
// — the hairpins, the signature feature, the fastest corner, the first after the main straight, a run of
// esses. All from the seed (track/det.js: the same names on every machine), so everyone calls a track and
// its corners the same. Fictional, all of them.
//
//   trackName(seed, { theme, layout }) → 'Ashby Park'
//   cornerNames(gen, plan, { theme }) → [{ n (the corner's number, track/dress.js), apex (index), name, kind, x, z }]

import { rng, mix } from './det.js';

const PLACE = {
  countryside: ['Ashby', 'Brookfield', 'Hollins', 'Marley', 'Thornbury', 'Wexcombe', 'Ferris', 'Linden', 'Oakmere', 'Halden', 'Kestrel Down', 'Millbrook', 'Harrow Vale', 'Pennick'],
  forest: ['Pinewood', 'Black Fir', 'Elkhorn', 'Mossgrove', 'Ravenwood', 'Hemlock', 'Deepwold', 'Larchmont', 'Bracken', 'Owlsden', 'Timberline', 'Cedar Hollow', 'Greywood'],
  desert: ['Red Mesa', 'Sandvale', 'Dry Creek', 'Sunreach', 'Cactus Flat', 'Copperstone', 'Dune Point', 'Saltpan', 'Mirage', 'Dustbowl', 'Scorpion Gulch', 'Ochre Basin'],
  coastal: ['Saltmarsh', 'Gull Point', 'Bayview', 'Cliffhaven', 'Seacombe', 'Driftwood', 'Port Avel', 'Harbourside', 'Tidewater', 'Shellbay', 'Kittiwake', 'Lighthouse Head'],
  mountain: ['Highcrest', 'Eagle Pass', 'Stoneridge', 'Frostpeak', 'Granite', 'Col du Roc', 'Snowline', 'Alpenhorn', 'Summit', 'Windgap', 'Glacier Bend', 'Hornfels'],
  street: ['Downtown', 'Harbour City', 'Old Town', 'Midtown', 'Riverside', 'Union Square', 'Canal Street', 'Arsenal', 'Market', 'Neon Quarter', 'Docklands', 'Founders Row'],
};
const LOOP = ['Park', 'Ring', 'Circuit', 'Raceway', 'Motor Park', 'Speedway'], P2P = ['Hillclimb', 'Pass', 'Climb', 'Sprint', 'Road', 'Run'], STREET = ['Street Circuit', 'Grand Prix', 'Circuit', 'Street Race'];

export function trackName(seed, { theme = 'countryside', layout = 'loop' } = {}) {
  const A = PLACE[theme] ?? PLACE.countryside, B = layout === 'p2p' ? P2P : theme === 'street' ? STREET : LOOP;
  return `${A[mix(seed >>> 0, 0x4e41) % A.length]} ${B[mix(seed >>> 0, 0x4e42) % B.length]}`;
}

// ---------- corners ----------
const PEOPLE = ['Hendry', 'Okafor', 'Varga', 'Lindqvist', 'Moreau', 'Castell', 'Brandt', 'Ishikawa', 'Doyle', 'Marchetti', 'Novak', 'Quinn', 'Salas', 'Arden', 'Kowal', 'Ferreira'];
const NOUN = {
  countryside: ['Mill', 'Barn', 'Orchard', 'Spinney', 'Paddock', 'Copse', 'Haywain', 'Farmhouse', 'Church', 'Weir'],
  forest: ['Woodcutter', 'Clearing', 'Lodge', 'Ranger', 'Pines', 'Hollow', 'Stump', 'Fern', 'Sawmill', 'Owl'],
  desert: ['Mesa', 'Canyon', 'Oasis', 'Dune', 'Arroyo', 'Cactus', 'Butte', 'Vulture', 'Salt Flat', 'Mirage'],
  coastal: ['Lighthouse', 'Harbour', 'Pier', 'Cove', 'Gull', 'Breakwater', 'Lifeboat', 'Smugglers', 'Dunes', 'Ferry'],
  mountain: ['Glacier', 'Chapel', 'Gondola', 'Avalanche', 'Summit', 'Chalet', 'Ridge', 'Marmot', 'Ibex', 'Tunnel'],
  street: ['Station', 'Cathedral', 'Casino', 'Market', 'Bank', 'Museum', 'Fountain', 'Hotel', 'Tram', 'Opera'],
};
const pick = (r, list) => list[r.int(0, list.length - 1)];

// The notable corners: up to `most`, each named once, by what it is
export function cornerNames(gen, plan, { theme = plan?.theme ?? 'countryside', most = 6 } = {}) {
  const T = gen.track, C = plan?.corners ?? [], n = T.n, r = rng(mix(gen.seed ?? 0, 0x5c0e)), N = NOUN[theme] ?? NOUN.countryside;
  const out = [], used = new Set(), at = c => { const i = ((c.apex % n) + n) % n; return { x: T.x[i], z: T.z[i] }; };
  const name = (c, kind, text) => { if (!c || used.has(c.n) || out.length >= most) return; used.add(c.n); out.push({ n: c.n, apex: c.apex, kind, name: text, ...at(c) }); };
  if (!C.length) return out;
  // the signature feature's corner(s): named for what it is
  const S = T.signature, inSig = c => S?.from != null && c.apex >= S.from - 5 && c.apex <= S.to + 5;
  const sig = C.filter(inSig);
  if (S?.kind === 'long_hairpin' && sig.length) name(sig[0], 'signature', `${pick(r, N)} Hairpin`);
  if (S?.kind === 'banked_corner' && sig.length) name(sig[0], 'signature', pick(r, ['The Bowl', 'The Banking', `${pick(r, PEOPLE)} Banking`, 'The Wall of Speed']));
  if (S?.kind === 'fast_esses' && sig.length) { name(sig[0], 'signature', `${pick(r, N)} Esses`); for (const c of sig.slice(1)) used.add(c.n); }
  if (T.crossing) { const near = C.reduce((b, c) => { const d = Math.min(Math.abs(c.apex - T.crossing.j), n - Math.abs(c.apex - T.crossing.j)); return !b || d < b.d ? { c, d } : b; }, null); if (near) name(near.c, 'bridge', pick(r, ['Bridge Bend', 'Under the Bridge', 'Flyover', 'The Crossover'])); }
  if (S?.kind === 'big_crest' && S.at != null) { const c = C.find(c => c.apex > S.at); if (c) name(c, 'crest', pick(r, ['Over the Top', 'The Leap', `${pick(r, N)} Rise`, 'Blind Summit'])); }
  // the first corner after the main straight
  name(C[0], 'first', pick(r, [`${pick(r, PEOPLE)} Corner`, 'Turn One', `${pick(r, N)} Corner`, 'The First']));
  // the hairpins
  for (const c of C.filter(c => c.kind === 'hairpin')) name(c, 'hairpin', `${pick(r, N)} Hairpin`);
  // the fastest corner, the slowest, the longest
  const fast = C.reduce((b, c) => !b || c.vApex > b.vApex ? c : b, null), slow = C.reduce((b, c) => !b || c.vApex < b.vApex ? c : b, null), long = C.reduce((b, c) => !b || Math.abs(c.turn) > Math.abs(b.turn) ? c : b, null);
  name(fast, 'fastest', pick(r, [`${pick(r, PEOPLE)}'s`, `${pick(r, N)} Kink`, 'Flat Out', `${pick(r, N)} Sweep`]));
  name(long, 'longest', pick(r, [`${pick(r, N)} Curve`, 'The Carousel', `${pick(r, PEOPLE)} Loop`, 'The Long One']));
  name(slow, 'slowest', pick(r, [`${pick(r, N)} Bend`, 'The Elbow', `${pick(r, PEOPLE)} Turn`, 'The Hook']));
  return out.sort((a, b) => a.n - b.n);
}
