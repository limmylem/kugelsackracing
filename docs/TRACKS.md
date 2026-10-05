# Generated tracks (Phase 5 Step 1: the track generator core)

Race tracks made from a seed, in a scene of their own: not part of the real world's streaming (no
tiles load), with the same car, physics, damage and HUD. A track is its **seed + parameters +
generator version**: the same three always make the identical track, on any machine, in any browser.
Its world (road, ground, surfaces) and its course in the Phase 4 route format come from that, so
checkpoints, the corridor, resets, timing, the racing line and NPC racers work on it unchanged.

## Using it

- **The track generator page** — `dev/tracks.html`: pick a preset or set the parameters, type a seed
  (any text or a whole number), **Generate**. You get a top-down map (coloured by how tight the road is,
  the start ▲ and checkpoints ●), the elevation profile (and banking), and the stats: length, corners,
  tightest corner, longest straight, elevation change, climb, steepest gradient, most banking,
  checkpoints, estimated lap, attempts, generator version and hash. **Random seed**, **Copy track code**,
  **Fly camera** (along the road), **Test drive** (the track in the game, with Phase 4's route test
  drive: countdown, checkpoints, splits, laps, resets — F2 ends it). Paste a code into the code box and
  press Enter to open that track; `dev/tracks.html?code=<code>` opens one directly.
- **In the game** — the **🏎️ Track** world button opens the last track made or opened on the generator
  page (or `index.html?track=<code>`; otherwise a fast flowing circuit). Leaving it (another world
  button, or T) goes back to the real world exactly where you left it: the real world waits, paused,
  while you're on a track. `dev/world.html?world=track&code=<code>&drive=1` drops straight into a test
  drive.

## Track codes

26 characters in groups of five, e.g. `04028-CG81C-D1K00-00R00-0001H-C`
(`track/code.js`): Crockford base 32 of 16 bytes — the generator version, every parameter (type,
style, crests, length range, corner range, width, elevation, climb, banking) and the seed, with a check
byte so a typo is caught rather than making a different track. The parameters are stored in full, not as
a preset's name, so a code means the same track however the presets change. Parameters are rounded to
what a code can hold (`normalise`) before the generator sees them: a track from the page's form and one
from its code are the same track.

## Parameters and presets (`data/tracks.json`)

| | |
| --- | --- |
| type | `circuit` (closed loop) or `p2p` (sprint or hillclimb) |
| lengthKm | [min, max] |
| corners | [min, max] corner groups (a chicane or a set of esses counts as one) |
| style | `flowing`, `technical`, `fast` or `mixed` — which corners, their radii, the straights between |
| width | m |
| elevation | m from the lowest point to the highest (the waves; less if the gradient limits need it) |
| climb | point to point: m from start to finish (negative: downhill) |
| banking | the most banking in fast corners, degrees (0: none) |
| crests | sharper rises and dips allowed |

Presets: Short technical circuit, Fast flowing circuit, High-speed circuit, Grand prix circuit, Club
circuit, Mountain hillclimb, Coastal sprint. Add one by adding an entry: it's just parameters.

## How a track is made (`track/gen/v1.js`)

1. **Elements**, chosen by the seed and the style: the main straight first (the start and finish), then
   corner groups — single corners (35–120°), fast sweepers, hairpins (150–180°), chicanes, esses —
   with straights between. A circuit's corners mostly go its own way round (a few against); a sprint's
   go either way, its hairpins switching back. The straights are stretched or shrunk towards the length
   wanted.
2. **Clothoids**: every corner is a clothoid in (the curvature growing steadily from nothing), an arc,
   and a clothoid out — steering winds on and off as on a real track, never in a jump. Each clothoid is
   long enough to keep the curvature's rate of change under the limit; a small-angle kink gets a bigger
   radius so its clothoids fit.
3. **Closing a circuit**: its corners that go its own way round are scaled so it turns exactly once;
   then, since where it ends depends on its straights' lengths in a straight line (their headings are
   fixed), the straights' lengths are solved — the least change, weighted by their lengths, none under
   its minimum (the main straight keeps the start straight's length) — so the end meets the start: same
   place, same heading, curvature zero both sides. No kink. Whatever the integration leaves (under 5 cm)
   is spread along the lap.
4. **The path**: the curvature integrated (half-metre steps), resampled every ~2 m, centred on the origin.
5. **Elevation**: seeded waves along the track (a circuit's periodic, so it ends at the height it
   started), the start straight left level (the grid and the line), a hillclimb's climb added (steady,
   eased in and out), then scaled down until no gradient is over the limit (10%) and no change in
   gradient is over its limit (sharper with crests).
6. **Banking**: in fast corners (radius 45 m and up) up to the parameter's degrees, more the tighter the
   corner, eased in and out over 40 m; the inside of the corner lower. It never twists the road faster
   than a real one's: the edge rises or falls against the middle by at most 1% — so it builds up over a
   long corner, and in quick esses and chicanes (where it would have to flip from one way to the other
   in a few metres, a jolt at speed) there's little of it.
7. **Checks** — any failing: another attempt, from a seed derived from this one (still deterministic):
   - the track never comes within its width + 2 × 14 m of run-off of itself (a hairpin's own legs may,
     by 0.55 × the distance along the track between them); no bridges yet
   - no corner under 14 m radius; the curvature never changing faster than the limit
   - length within the range
   - gradients, gradient changes, banking and how fast the banking twists the road within limits
   - a start straight of at least 180 m

   Every attempt is logged with why it failed (the generator page lists them).

Its styles and limits live in `track/gen/v1.js`, not the config: they're part of what version 1 *is*.

## Determinism and versions

- **One random number generator**: xoshiro128** seeded through splitmix32 (`track/det.js`), integers
  only. `Math.random` is never used.
- **Only exact arithmetic**: JavaScript's + − × ÷, `Math.sqrt`, `Math.round` and the integer operations
  give the same bits everywhere (IEEE 754); `Math.sin`, `cos`, `atan2`, `pow`, `exp` and `hypot` don't
  (each engine has its own). The generator uses its own sine and cosine (fdlibm's kernels) and nothing
  else; its output is rounded to fixed precision (millimetres, hundredths of a degree).
- **Versions**: `track/generate.js` registers every generator version. A version never changes once
  released; a better generator is a new file (`track/gen/v2.js`) and `LATEST` moves to it, and codes
  made with version 1 still make version 1's tracks. `tests/fixtures/tracks-v1.json` pins 21 of them
  (three a preset) by hash: if one stops matching, version 1 was changed — put it back.
- The world built from a track (`track/build.js`: meshes, ground) isn't part of its identity and uses
  ordinary maths; it has its own `BUILD_VERSION`, which empties the cache when it changes.

## The world (`track/build.js`, `track/scene.js`)

- **Road**: a cross-section every centreline point — verge, edge, middle, edge, verge. The road surface
  is tilted by its banking; the verges (5 m, flat at the edge's height, reaching down onto the ground) are
  the space Step 2's kerbs and barriers will use. Paint (`track/render.js`): white edge lines, chequered
  start and finish lines, the grid's boxes.
- **Collision is the drawing**: the road's positions and indices are one trimesh shape, the ground's
  heights one heightfield (`physics/terrain.js`'s layout), handed to both the simulation and the
  renderer through `physics/track.js` `trackShapes` — the very same arrays. The road's collider has its
  triangles' internal edges smoothed over (Rapier's `FIX_INTERNAL_EDGES`): a car whose floor touches the
  road (bottomed out braking hard at 170 km/h) slides instead of catching on an edge between triangles.
- **Ground**: a height grid round the track (the margin 260 m; cells of 4 m or more, at most 420 across):
  land that follows the track's own heights, under the road and verges a little below them, beyond them
  meeting the road's edge and blending into the land over 55 m or more — a cutting where the track runs
  lower, an embankment where it's higher.
- **Surfaces** (Map v3's): tarmac on the road, a verge surface beside it, grass beyond
  (`physics/track.js` `surfaceMap`, painted along the centreline).
- **Course**: the Phase 4 route format (`route/model.js`): the encoded centreline with heights and
  widths (a generated track sits at 0°, 0° in a transverse Mercator frame — `trackProjection`), the
  grid placed on the main straight's level start (eight slots), checkpoints made automatically, the
  stats, the racing line baked, a corridor margin. `viewCourse` reads it as it reads any route.
- **In the game**: `track/scene.js` answers what the game asks of the real world — `travelTo`,
  `holdCar`, `releaseCar`, `resetToRoad`, the frame hook, a small `w.stream` (projection, frame, world
  group) — so the Phase 4 route test drive, quests and NPC races run on it unchanged. The track is a few
  km across and centred on the origin, so Map v3's floating origin isn't needed (the frame never moves);
  its whole ground is there from the start, so nothing waits to load. One generated track's world is
  kept at a time.

## Speed (`track/worker.js`, `track/client.js`)

Tracks are made in a Web Worker (progress as it goes: layout, ground, road, course, racing line) and kept
in this browser's IndexedDB by code (the latest 30): a track made before loads in tens of milliseconds.
Measured: the layout 7 ms on average (99% within 43 ms over 10,000 tracks); the whole world 0.3–0.8 s in
the browser; from the cache about 40 ms.

## Tests

- `npm run test:unit` (`tests/unit/tracks.test.mjs`): the deterministic sine and random numbers pinned;
  codes round-trip, typos caught; the same track every time and version 1's pinned tracks unchanged; 210
  tracks over every preset passing every check measured again from the output (`track/validate.js` —
  itself shown to catch a kink, a gap, a crossing, a too-tight jog, too steep, banking where none was
  asked for, banking flipping too suddenly); the built world (course read back as a route, the collider the drawn mesh, every road
  triangle facing up, the ground under the road, surfaces).
- `npm run test:tracks` (`tests/tracks.mjs`): 1,000 seeds made twice and again from their codes, compared
  by hash; 10,000 seeds over every preset, every one passing every check, with the attempts each took and
  why attempts failed; every version's pinned tracks.
- `npm run test:track-drive` (`tests/track-drive.ts`): Phase 1 Step 6's tests on a generated circuit
  (0–100, quarter mile, 100–0 and the 30/60/144 fps check down its main straight, a robot's flying lap,
  ten cars' physics cost) against the car's own targets; 100 random tracks over every preset driven by
  the route test driver (through the Phase 4 tracker) and by the Phase 4 AI — finished, never out of the
  corridor, never stuck; 8-car NPC races on 10 of them.
- Across browsers: `dev/tracks.html?determinism=30` hashes 30 seeds of every preset in the browser
  (`window.__trackHashes`); compared with Node's, all 210 identical in Chromium. (Firefox and Safari
  weren't available to run here; the generator's arithmetic is exact by the standard, so they should
  match — worth a check by hand: open that page and compare the list.)
