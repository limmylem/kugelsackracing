# Routes: drawing, checkpoints and test drives

Phase 4 Step 2. A route is the line a quest is driven along, on the region's real roads, with its start
grid, checkpoints and finish. The editor draws and checks it; the game dresses it on the road and drives
it. It's world content like the rest (kind `route`, see [WORLD_CONTENT.md](WORLD_CONTENT.md)): saved as
a draft as you work, published with the quests that use it.

## Drawing one (the route tool, 4)

- **Start**: press **4** and click the map (or the 3D world) where it starts. Each click after that adds
  a waypoint at the end.
- **The route follows the real roads**: the shortest way on the region's road graph (OpenStreetMap's
  drivable roads) between waypoints, one-way streets the right way.
  - A waypoint goes on the nearest road. On a dual carriageway, or where two roads run side by side, it
    takes whichever makes the route sensible: no U-turn to reach it, no dead-end alley.
- **On the map**, with the route selected:
  - **drag a waypoint**: the route follows as it moves (the grid and checkpoints are worked out when you
    let go);
  - **drag the dot halfway along a leg**: a new waypoint there;
  - **right-click a waypoint**, or select it and press **Delete**: it's gone;
  - **L, then click a road**: that road is driven from end to end (a locked waypoint, gold ring). The
    route goes the way the road allows.
- **Road options** (the panel): one-way streets backwards, motorways, unpaved roads, tunnels, off-road
  legs. Ferries never. Off-road: a waypoint marked off-road is reached in a straight line, and only if
  the route allows it.
- **Point to point or loop.** A loop closes back to its start (and must: an open one is an error). Laps
  are the quest's setting.
- **Undo** (Ctrl+Z) takes back every change: waypoints, options, checkpoints, the grid.

## What's worked out (route/)

| Module | What |
| --- | --- |
| `route/network.js` | the region's road graph ready for routing: A* between places on roads, which road a click means, the options |
| `route/build.js` | waypoints → the route: each leg routed (remembered, so an edit re-routes only what changed), the centreline every 4 m, lightly smoothed, with the road's width; the OSM road segments used; U-turns |
| `route/stats.js` | length, turns, the sharpest corner, climb and descent, steepest grade, road names, and an estimated time for the starter car (corner speeds from grip, braking and accelerating between them) |
| `route/grid.js` | the start grid: up to 8 slots (or 1–16), two abreast where the road's wide enough, staggered, behind the start line, facing along the road; the finish line |
| `route/checkpoints.js` | checkpoints every so many metres (500 by default), and shortcut detection |
| `route/tracker.js` | following a car round it: checkpoints in order, laps, finish, the corridor, the wrong way |
| `route/validate.js` | the plain-English problems, and noticing the road data changed |
| `route/model.js` | the stored route and what's compiled from it; saving; loading the line without the graph |
| `route/autopilot.js` | a simple driver that can drive a route (the tests use it) |

### Start grid

- Placed automatically at the route's start, the slots fitted to the road's width.
- Each slot can be nudged on the map. *Put slots back* resets them. The start line can be moved along
  (*Start line*, m along the route).
- Warnings:
  - a steep slope (over 6%);
  - across a junction;
  - a road too narrow for side-by-side slots;
  - a tight corner.
- A slot off the road is an error.
- The finish: a gate across the road near the end (point to point), or the start line again (a loop).

### Checkpoints and shortcuts

- **Placed automatically**: one every *spacing* metres (the panel), and one inside every shortcut that
  nothing else cuts off.
- **Shortcuts** the editor looks for:
  - **another road** joining two parts of the route: from every junction the route passes, the shortest
    way over roads it doesn't use, either way down them, up to 1.5 km. It counts when it saves at least
    150 m;
  - **the route passing close to itself** (across a verge, a car park): parts a road's width or so
    apart, but far apart along the route;
  - **the route crossing itself**.
- A shortcut is **stopped** when a required checkpoint lies inside the stretch it skips. On the map,
  unstopped ones are red dashes and stopped ones grey.
- **Editing by hand**: drag a checkpoint along the route, right-click it to delete it, or set it in the
  panel:
  - required or bonus;
  - time added when it's passed;
  - its width (empty: the road's width and a margin).

  Any of these makes the checkpoints hand-placed: they're kept by where they are through later edits
  (one the route no longer passes is dropped, with a warning). *Place them again* goes back to automatic.

### Corridor, resets, wrong way (the tracker)

- **The corridor** is the road's width plus a margin (8 m, per route).
- Out of it for a second: **"Return to route"**, with a countdown.
- Out of it for 5 seconds: **reset** to the last checkpoint or reset point driven past (reset points
  every 250 m, as well as the checkpoints). The damage stays, as Phase 3's resets keep it: what came
  loose goes back on by the session's rules.
- **R** during a route resets there too.
- **Checkpoints count in order** and only when driven through.
  - Reaching a later one (by a shortcut) says "Missed checkpoint N: go back through it".
  - There's no finish until it's done.
  - A bonus checkpoint can be missed.
- **Wrong way**: going against the route faster than 4 m/s for 1.5 seconds.
- Where a route runs along the same road twice (out and back), the tracker keeps to the pass the car is
  going the way of.

### Dressing (play/routeDressing.js)

Optional per route (the panel):
- racing-line arrows on the road;
- warning signs before the tight corners;
- checkpoint gates;
- the start and finish arch.

The route's **roads** are closed (the default) or open: traffic comes in Step 4. Everything is built in
512 m pieces, made as the car comes within 900 m and thrown away past 1300 m. The shapes and materials are
shared, so nothing grows however long the route.

## Test drive (from the editor)

- **▶ Test drive** (or **T**) with a route selected: the editor steps aside and the car's on grid slot 1.
  There's a countdown, then the checkpoints, timing and corridor are live, and a HUD shows the time,
  checkpoint and lap.
- **The car**: your car as it is, or any car in the dealership, stock (the panel). Either way it's a
  trial: nothing is earned or spent, and no damage or wear is kept.
- **F2 ends it** (or the finish, a moment after) and you're back in the editor exactly where you were,
  same view, same camera.
- **The line you drove** is drawn on the map, coloured by speed (blue slow → red fast).
  *Use … as the reference time* stores the time, and the line, with the route (undoable).

## Saved data (in the route item's `course`)

| Field | What |
| --- | --- |
| `kind` | `p2p` or `loop` |
| `region` | the baked region it's on |
| `waypoints` | `[{ lat, lon, lock?: { key, dir, name }, offRoad? }]` |
| `options` | the road options |
| `path` | the baked centreline: lat/lon (1e-6°), height (cm) and road width (dm), delta-coded like Google's polyline. The game drives this without the road graph |
| `length`, `stats` | the numbers above |
| `roadData` | `{ region, version, osmDate, segments: [{ key, length, name }] }`: the OSM road segments used (key: `way:fromNode:toNode`, OpenStreetMap's own ids) |
| `review` | set when the roads changed: `{ needed, missing, altered, segments }` |
| `grid` | `{ count, startS, adjust, at, finish }` |
| `checkpointMode`, `spacing`, `checkpoints` | `[{ id, s, lat, lon, width, required, timeExtension, auto }]` |
| `guides`, `roads`, `corridor` | the dressing, closed or open roads, the off-route margin |
| `referenceTime`, `referenceLine` | from a test drive |
| `problems` | the checks when it was saved, so they're known without the road graph |

- **When the road data changes** (a new bake of the region), the editor checks the route's segments
  against today's graph as it opens it.
  - Gone or changed shape: it's marked *needs review* and the roads are shown orange.
  - A road gone is an error (`Route uses a road that no longer exists in OSM data (…)`), so its quests
    can't be published.
  - Saving it again (any edit, or *Re-route on today's roads*) routes it on the new roads.
- **Quests link to routes by id.** One route can serve several quests. The quest's checks include the
  route's:
  - laps need a loop;
  - a delivery needs a point-to-point route;
  - the route mustn't have errors;
  - the quest should start near the route's start.

  Publishing a quest publishes its route with it.

## Validation (examples)

Errors stop publishing; warnings don't.

- `Route is under 500 m (it's 320 m): spread the waypoints out.`
- `Route crosses itself without a checkpoint between the crossings: add one between 1.2 km and 1.8 km.`
- `Possible shortcut via Cut Lane skips 1.6 km with no checkpoint to stop it: add one between …` (warning)
- `Grid slot 7 is off the road.`
- `The start grid is on a steep slope (10%): …` · `The start grid is across a junction: …` (warnings)
- `Route uses a road that no longer exists in OSM data (East Road): redraw that part.`
- `The route turns back on itself at waypoint 3 (a U-turn).` (warning)
- `The loop doesn't close: its end isn't back at its start.`
- `3 laps need a loop route: "Harbour run" is point to point.` (on the quest)

## Real roads (the regions)

Besides San Francisco, five small regions are baked from Overture (OpenStreetMap's roads) and Copernicus
GLO-30 elevation (`data/map/regions/*.json`, `node map/bake/bake.ts --region <id>`), one per test:

| Region | Country | What it tests |
| --- | --- | --- |
| `monaco` | Monaco | city streets, a 30% descent, the Portier tunnel complex and bridges (the test route stops short of the Fairmont hairpin: a 150° turn into a 5 m one-way that the autopilot can't take yet — a driver can, at walking pace) |
| `tokyo` | Japan | Shibuya's narrow, steep streets |
| `stelvio` | Italy | a mountain pass's hairpins |
| `munich` | Germany | a motorway (A9) and its overpasses |
| `mk` | United Kingdom | a loop through Milton Keynes' roundabouts and dual carriageways |

Driving these found bake bugs that every region had, San Francisco included. All are fixed in the bake
(`map/bake/roads.ts`, `terrain.ts`, `tiles.ts`, `details.ts`):
- the same road baked twice (one copy with its layer, one without): two decks one over the other;
- a junction on a bridge stamped into the ground beneath it;
- roads side by side (a slip road, a bridge's end beside the road it comes down to) at different
  heights where their surfaces overlap: a kerb;
- two junctions a few metres apart at very different heights: no road is now steeper than 35%;
- bridges eased only between their own ends, passing just over a road beneath. They're now raised to
  clear it, and their profiles smoothed;
- building colliders solid down to a road passing through them, and building corners standing on a
  drawn road;
- bridge parapets running across a road that merges, and mapped fences drawn across streets;
- trees on the drawn road.

## Tests

- **`npm run test:unit`**, `tests/unit/route.test.mjs`, on a small made-up road map whose answers are
  known and on San Francisco:
  - routing (one-way streets, road options, locked roads, off-road legs, loops);
  - the save / load round trip;
  - the road data changing (a road gone, a road reshaped);
  - checkpoints passed in order (a skipped one is missed: no finish);
  - laps;
  - the corridor ("Return to route", then the reset to the last checkpoint) and the wrong way;
  - shortcut detection (another road, close to itself, crossing itself);
  - validation messages, the grid, the numbers;
  - routes as content (shape, the quest link, published together, flagged when the roads change).
- **`npm run test:routes`** (`tests/map/routes.test.ts`): a route in each of the six regions, routed from
  a few clicks, then driven in the physics on the baked world's own colliders by the autopilot, from grid
  slot 1 to the finish. Every checkpoint in order, no resets, never off the route, never the wrong way.
- **`npm run perf:route`** (`tests/route-perf.mjs`): a 60 km tour of San Francisco.
  - Worked out in full in about 1 s.
  - A dragged waypoint re-routed in under 0.1 s a step (only its legs).
  - The tracker at about 10 µs a frame along all of it.
  - The dressing driven past three times with at most 15 of its 53 pieces made at once, and no memory
    growth.
