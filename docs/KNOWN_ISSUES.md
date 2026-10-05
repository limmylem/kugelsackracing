# Known issues, and what to revisit before Phase 6

As of the end of Phase 4 (Step 5). Each with what was seen and where; the tests named reproduce them.
How quests, rewards and progression work: [PROGRESSION.md](PROGRESSION.md).

## Known issues

### The baked world: spots where cars stop dead

AI drivers (the NPCs, and the test driver) stop at the same metre every time, are reset, and stop again:

| Where | What's there |
| --- | --- |
| San Francisco, 2nd Street under I-80 (37.78376, −122.39447) | the I-80 viaduct overhead has a piece tagged *ground* (layer 0) at 17.9 m |
| San Francisco, 4th Street under the I-80 ramps (37.78034, −122.39894) | motorway bridges overhead at 9–11 m |
| San Francisco, Stockton Tunnel (37.79257, −122.40761) | a piece of the tunnel road is tagged *ground*, not *tunnel* |
| Monaco, 450–470 m along the routes test's sprint | a ramp beside a level road; the level road's surface overlaps the ramp (docs/NPC_RACERS.md) |
| Stelvio | drops with no barrier: a car pushed wide goes over (docs/NPC_RACERS.md) |

The first three look like the same cause: OSM pieces of elevated or underground roads that aren't tagged
bridge or tunnel get baked as surface at their own height, which walls off the street underneath. The fix
belongs in the Map v3 bake (treat a *ground* piece of a way that's otherwise bridge/tunnel, or one far
above the terrain, as the structure it is). Until then, authors find these with the editor's AI test race
(problem spots on the map), and `tests/map/newplayer.test.ts` keeps its routes away from them. A route
check could also warn about a route passing under a *ground* road well above it.

### Rookie quests are scarce outside San Francisco and Munich

A quest's tier is `floor((stars + its class's tier) / 2)`, and city and mountain roads rate high. From 40
random 1–4 km routes in each region (solo time trial / 2-rival sprint): San Francisco about half 2★
(Rookie), Munich nearly all Rookie, Milton Keynes mostly 3★ (Club); **Monaco, Tokyo and Stelvio almost
none** (3–5★: Club and Pro). A new player who fast-travels there finds next to nothing to enter. Either
start players in San Francisco or Munich (as now) and place Rookie quests deliberately, or revisit how
stars map to tiers before content goes in at scale.

### Club tier takes about 15 first-time Rookie golds

A 2–3 km 2★ Rookie quest pays 50–65 xp for its first gold, a repeat 16–22 xp (less again with
anti-farming); level 3 is 900 xp. `npm run test:newplayer`: 15 Rookie quests golded, a series bonus and
some repeats to reach it. The economy simulation agrees (its pool assumes ~50 Rookie quests within reach).
A starting area needs at least 15–20 Rookie quests, or the level curve's early steps should come down.

### Some steep routes rate easier than they drive

Routes with 20–28% grades in San Francisco rate 2★ (the steepest grade is one feature among many: full
at 30%, weight 0.5), yet those are where the AI and new players struggle. Worth a heavier weight for very steep
grades — then rerun `npm run economy-sim`, as rewards follow the stars.

### At 50,000 quests

`npm run stress:quests` puts 50,000 quests, each with its own route, into the six baked regions — so they
pack far tighter than real content would (Stelvio: 6,000 quests within 1 km). Measured (4-core container,
Node 22):

| | measured | target |
| --- | --- | --- |
| 100,000 items imported | 89 s | 120 s |
| everything loaded at once (a player who's been everywhere) | 1.06 GB heap | — |
| nearby query (3 km, nearest 2,000), densest place / anywhere | p95 10 / 13 ms | **8 ms** |
| the maps' 2,000 markers handed over | median 7.7 ms | 8 ms |
| the finder: every quest listed / a filter changed | 50,000 of 50,000 / 52 ms | all / 100 ms |
| the finder: opening the full map (first time; kept 20 s) | 589 ms | **400 ms** |
| the nearby notice | p99 0.46 ms | 1 ms |
| the editor's area query / *Check everything* (100,000) | p95 14 ms / 86 s | 15 ms / 120 s |
| free roam at 200 km/h through the densest area | p95 0.44 ms a frame, worst 31 ms | 2 / **12 ms** |
| arriving there (that area's content loaded) | 0.76 s | behind the loading screen |
| memory over 20 km of free roam | +9 MB | 50 MB |

What's over, and why: the content cells are 5 km across, so a packed region is one or two cells holding
thousands of quests *and their routes*; a nearby query looks at all of them, and loading one is a large
read. Route courses are now kept as text in memory until read (`content/service.js`), which halved memory
(2.1 → 1.06 GB) and the collector's pauses — the rest is the work itself, on the main thread. The worst
free-roam frame is the re-query every 250 m plus the maps' update in the densest spot.

The lasting fixes, before content goes in at this density: run the content service in a **Web Worker**
(queries and cell loads off the main thread — the API is already async), and keep **routes apart from the
quests' cells** (a server's routes table in Phase 6, or a body store locally), so a nearby query only ever
reads light markers. `stress:quests` is reported in CI but not blocking until then.

Also:
- **Exporting everything** to one file stops past a browser's longest string (tens of thousands of
  routes): the editor says so and asks for an area at a time. *Check everything* doesn't need an export.
- **The finder** works on every quest in every region on the main thread; a server should answer its
  filters and "Recommended" (Phase 6).

### Generated tracks (Phase 5 Step 1, docs/TRACKS.md)

- **Phase 1's lap robot weaves on high-speed generated circuits**: its steering was tuned on the test
  centre's circuit and oscillates in 130–150 km/h sweepers until it spins (with or without banking). The
  route test driver and the Phase 4 AI drive those tracks cleanly, so `npm run test:track-drive` runs the
  Phase 1 tests on a grand prix circuit; the robot's controller needs a look before it laps fast tracks.
- **Cross-browser determinism was checked in Chromium only** (210 of 210 hashes identical to Node's).
  Firefox and Safari weren't available here: open `dev/tracks.html?determinism=30` in each and compare.
- **One generated track's world is kept at a time**: opening another frees the last (its build stays in
  the cache, so going back takes tens of milliseconds plus the colliders).
- **No bridges or crossings**: a track never comes near itself (figure-of-eight layouts are rejected).
- **No world edge**: the ground stops 260 m beyond the track and there's no wall at its edge yet; a
  car driven that far falls off (a reset, R, puts it back on the road). Step 2's barriers will keep cars in.
- **8-car NPC races on generated tracks**: in `npm run test:track-drive`'s ten races every car finishes,
  but one NPC (in one race, on a fast flowing circuit) is stuck-and-reset after contact in the pack — the
  Phase 4 AI's racing in traffic (docs/NPC_RACERS.md's known limits), where the test wants none.
- **Cars have no bump stops** (Phase 1's suspension stops at its travel and pushes no harder): braking
  hard from 170 km/h or more, with the aero load on top, the front bottoms out and the floor touches the
  road. On a generated track the road's collider has its internal edges smoothed, so it scrapes and
  slides; on the baked real-world roads a floor can still catch on a triangle edge (one cause of NPCs
  spinning at speed). A progressive bump stop in the car model is the lasting fix.
- **Hillclimbs' land can be steep** beside the road where the road cuts across a slope: the ground blends
  to the road's height over 55 m, which on a big climb makes banks steeper than real land.

### Smaller things

- **A forced finish in a test** (`session.finish` outside a physics tick) needs the controller to drain
  its events (`controller.skipIntro()` does) — the game never does this; only scripts that cheat do.
- **The browser smoke test** of the polish (sounds, camera, hints, accessibility) ran headless with
  three.js and Rapier from `node_modules` (the CDN isn't reachable there) and without maplibre; it isn't
  part of CI. The polish's logic is unit-tested (`tests/unit/polish.test.mjs`).
- **The densest city tile's 8-car race** is within the frame budget on average (about 5 ms of 8), but its
  worst single physics step was about 43 ms (`npm run test:npc -- --only dense`).
- **NPC tests** still have the known failures in docs/NPC_RACERS.md (skill spread; stuck-and-reset at
  the spots above), reported in CI but not blocking.

## To revisit before Phase 6 (accounts, a server-owned economy)

- **Money, progress and inventory are in the browser** (`LocalPlayerService`). Every request already
  goes through PlayerService's methods and answers `{ ok, error, updatedState }`
  (`garage/player/service.js` METHODS); a server answering the same requests replaces it
  (`garage/player/remote.js` is the client side). The server must own: the balance, fees and rewards,
  repairs, purchases, xp and levels, series bonuses, pink-slip car transfers.
- **Results are checked in the browser** (`quest/validate.js`: times against the route, the car's
  limits, the recording). The same checks must run on the server, with the recording sent, before
  anything is paid.
- **Anti-farming uses the browser's clock** (`quests.farming.windowHours`): the server's clock instead.
- **Rewards are worked out from the quest's stored rating** and the economy config. The server needs the
  same code and config version; a change to the rules makes stored ratings out of date (*Check
  everything* lists them) — rerate on the server when the rules change.
- **World content is per browser** (IndexedDB). The PostGIS design is in WORLD_CONTENT.md; add a routes
  table apart from quests, the finder's filters and "Recommended" as queries, and *Check everything* as
  a server job.
- **Saves**: the profile (version 4), recordings (version 2) and content (version 3) migrate on load in
  the browser; the server should migrate on read too, with the same fixtures (`tests/fixtures/saves/`).
- **Hints seen, settings**: hints are in the profile already (moves with it); the accessibility and
  input settings are per browser (localStorage) — decide whether they follow the account.
- **Fast travel regions** come from `data/map/baked.json`; with a server, the regions a player can reach
  (and their quests) should come from it.
