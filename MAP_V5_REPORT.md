# Map v5 report: Adelaide

Map v4 made Adelaide's roads accurate, watertight and drivable. Map v5 makes the city **recognisable**: someone who
knows it should know where they are from what's around them, with no HUD or map.

Map v5 keeps Map v4's road surface model, bake, elevation pipeline, tile grid, collision rules, streaming and
lighting, and builds on them:

- footpaths, kerbs and verges;
- buildings that look like their type;
- chains drawn as parody brands;
- street furniture, railways and markings;
- landmarks, sports grounds and place signs;
- vegetation by species;
- a region style pack for what the data doesn't say.

Map v4 is still there behind `?map=v4` (off by default); Map v3 behind `?map=v3`.

- How it works: [MAP_README.md](MAP_README.md#map-v5).
- What was wrong with Map v4, measured before anything changed: [MAP_V5_DIAGNOSIS.md](MAP_V5_DIAGNOSIS.md).
- Every size and threshold: `data/map/v5.json` (over `data/map/v4.json`) and `data/map/styles/australia.json`.
- The tests: `tests/map/v5.test.ts` (`npm run test:map5`), and Map v4's on the same bake
  (`npm run test:map4 -- --dir assets/map/adelaide/v5`).

In the game, the label at the bottom left reads
`Map v5 | tile x/y | DEM: GA LiDAR 5 m | roads: roads-5.0 | style: Australia` (the DEM where the car is: Copernicus
GLO-30 30 m in the hills).

## Map v4's faults: before and after

Map v4's numbers are Step 0's ([MAP_V5_DIAGNOSIS.md](MAP_V5_DIAGNOSIS.md)), measured on the whole region or on 72
central tiles where it says so. Map v5's are from the **whole region's bake**: its tests, and for the elevation and
grades the same measures run on both bakes.

| | Fault | Map v4 | Map v5 |
|---|---|---|---|
| 1a | Road heights against the 5 m LiDAR (every road point on pure LiDAR) | median +0.98 m, 95th percentile 3.48 m (1.05M points) | median 0.00 m, 95th percentile 0.43 m (1.27M points) |
| 1a | Main roads on LiDAR: road − LiDAR, median / 95th percentile | South Road +0.73 / 2.2 m, Anzac Highway +1.33 / 2.4, Unley Road +1.76 / 3.2, Glen Osmond Road +1.88 / 7.8 | South Road 0.00 / 2.7 m, Anzac Highway 0.00 / 0.15, Unley Road −0.01 / 0.12, Glen Osmond Road +0.01 / 0.26 |
| 1a | The South Eastern Freeway's steepest grade (the real road: about 6%) | 35.8% over 20 m and over 100 m | 13.6% over 20 m, 9.8% over 100 m |
| 1c | A road's edge | an open 8 cm step for a wheel to catch, everywhere | closed by a kerb and a footpath or verge: 8,918 km of kerb |
| 1d | Road bridge decks (segments of 10 m or more) steeper than 8% / 15% | 111 / 37 of 461; steepest 50.6% | 7 / 1 of 461; steepest 17.0% (Barcoo Road) |
| 1d | Bridges over roads | 42 of 311 decks below the road under them, 132 more clearing it by less than 4.5 m | 35 of 1,544 deck-edge pieces over a road under 4.5 m (2.3%), the lowest 3.89 m; 3 decks short of their clearance |
| 1e | The Heysen Tunnels | a trench cut into the hill, no walls or ceiling, the hill's top 50 m up | tubes with walls, ceilings, portals and wall lamps, the hill intact over them; both bores driven through at 6.3–6.7% |
| 1f | Road read as grass (central tiles) | 35% of sampled road points on a non-road raster cell | none: the surface is the triangle's own |
| 1g | Signs in the road | 696 of 1,507 street name signs (46%) on the road surface (central tiles) | 0 of 821,321 signs, signals, lamps, furniture and trees on a lane |
| 1h | Floating car parks and paths | 6,018 car-park triangles more than 1.5 m over the ground (central tiles), solid | 131 of 6.86M triangles more than 0.6 m over the ground, the highest 1.21 m |
| 1i | Street lights | pools of light 8 m across, the nearest six lamps real lights at 160 reaching 32 m | pools 15 m across, the nearest six at 320 reaching 40 m |
| 1j | Roundabout islands | grass, no kerb | 5,523 raised islands, 317 of them roundabout gardens with plants and a tree; Britannia Roundabout's two islands are gardens |

The freeway's grade is still steeper than the real road's in places. That's the hills' 30 m elevation and the
interchanges' junction surfaces ([Known gaps](#known-gaps)).

## Before and after

Map v5 at each of Step 0's places and Map v4 bugs, shot the same way as Step 0: street level on the left, from above
on the right, at 13:00. Map v4 is the first picture of each pair, Map v5 the second (`docs/map-v5/step0/`,
`docs/map-v5/after/`; `tools/map-shots.mjs --map v5`).

### Main shopping street: Rundle Street, East End

![Main shopping street: Rundle Street, East End: Map v4](docs/map-v5/step0/shopping-rundle-st.jpg)

![Main shopping street: Rundle Street, East End: Map v5](docs/map-v5/after/shopping-rundle-st.jpg)

### Suburban street: Alfred Street, Parkside

![Suburban street: Alfred Street, Parkside: Map v4](docs/map-v5/step0/suburb-parkside.jpg)

![Suburban street: Alfred Street, Parkside: Map v5](docs/map-v5/after/suburb-parkside.jpg)

### Motorway interchange: South Road Superway / Port Wakefield Road

![Motorway interchange: South Road Superway / Port Wakefield Road: Map v4](docs/map-v5/step0/interchange-superway.jpg)

![Motorway interchange: South Road Superway / Port Wakefield Road: Map v5](docs/map-v5/after/interchange-superway.jpg)

### Petrol station: OTR, King William Road / Greenhill Road, Unley

![Petrol station: OTR, King William Road / Greenhill Road, Unley: Map v4](docs/map-v5/step0/petrol-otr-unley.jpg)

![Petrol station: OTR, King William Road / Greenhill Road, Unley: Map v5](docs/map-v5/after/petrol-otr-unley.jpg)

### Fast-food drive-thru: West Terrace, Adelaide

![Fast-food drive-thru: West Terrace, Adelaide: Map v4](docs/map-v5/step0/drivethru-west-tce.jpg)

![Fast-food drive-thru: West Terrace, Adelaide: Map v5](docs/map-v5/after/drivethru-west-tce.jpg)

### Shopping centre car park: Burnside Village

![Shopping centre car park: Burnside Village: Map v4](docs/map-v5/step0/carpark-burnside-village.jpg)

![Shopping centre car park: Burnside Village: Map v5](docs/map-v5/after/carpark-burnside-village.jpg)

### School: Adelaide High School, West Terrace

![School: Adelaide High School, West Terrace: Map v4](docs/map-v5/step0/school-adelaide-high.jpg)

![School: Adelaide High School, West Terrace: Map v5](docs/map-v5/after/school-adelaide-high.jpg)

### Park: Rymill Park, East Terrace

![Park: Rymill Park, East Terrace: Map v4](docs/map-v5/step0/park-rymill.jpg)

![Park: Rymill Park, East Terrace: Map v5](docs/map-v5/after/park-rymill.jpg)

### Train station: Adelaide Railway Station, North Terrace

![Train station: Adelaide Railway Station, North Terrace: Map v4](docs/map-v5/step0/station-adelaide.jpg)

![Train station: Adelaide Railway Station, North Terrace: Map v5](docs/map-v5/after/station-adelaide.jpg)

### Landmark: Adelaide Oval

![Landmark: Adelaide Oval: Map v4](docs/map-v5/step0/landmark-adelaide-oval.jpg)

![Landmark: Adelaide Oval: Map v5](docs/map-v5/after/landmark-adelaide-oval.jpg)

### South Eastern Freeway (M1) above Glen Osmond

![South Eastern Freeway (M1) above Glen Osmond: Map v4](docs/map-v5/step0/bug-sef-m1.jpg)

![South Eastern Freeway (M1) above Glen Osmond: Map v5](docs/map-v5/after/bug-sef-m1.jpg)

### Heysen Tunnels, South Eastern Freeway

![Heysen Tunnels, South Eastern Freeway: Map v4](docs/map-v5/step0/bug-heysen-tunnels.jpg)

![Heysen Tunnels, South Eastern Freeway: Map v5](docs/map-v5/after/bug-heysen-tunnels.jpg)

### The windy route's start: Belair Road / Springbank Road (the owner's screenshot)

![The windy route's start: Belair Road / Springbank Road (the owner's screenshot): Map v4](docs/map-v5/step0/bug-windy-run-start.jpg)

![The windy route's start: Belair Road / Springbank Road (the owner's screenshot): Map v5](docs/map-v5/after/bug-windy-run-start.jpg)

### The windy route's hairpins, Belair Road, Clapham

![The windy route's hairpins, Belair Road, Clapham: Map v4](docs/map-v5/step0/bug-windy-run-hairpins.jpg)

![The windy route's hairpins, Belair Road, Clapham: Map v5](docs/map-v5/after/bug-windy-run-hairpins.jpg)

### Waverley Ridge Road over the South Eastern Freeway, Crafers (the owner's screenshot)

![Waverley Ridge Road over the South Eastern Freeway, Crafers (the owner's screenshot): Map v4](docs/map-v5/step0/bug-overpass-waverley.jpg)

![Waverley Ridge Road over the South Eastern Freeway, Crafers (the owner's screenshot): Map v5](docs/map-v5/after/bug-overpass-waverley.jpg)

### Steepest bridge: North South Motorway deck, Wingfield

![Steepest bridge: North South Motorway deck, Wingfield: Map v4](docs/map-v5/step0/bug-steep-bridge-nsm.jpg)

![Steepest bridge: North South Motorway deck, Wingfield: Map v5](docs/map-v5/after/bug-steep-bridge-nsm.jpg)

(Map v5's street-level picture is from the nearest road: the spot is just past the region's northern edge, and
the car can't stand there exactly.)

### Roundabout: Britannia Roundabout, Kent Town / Norwood

![Roundabout: Britannia Roundabout, Kent Town / Norwood: Map v4](docs/map-v5/step0/bug-roundabout-britannia.jpg)

![Roundabout: Britannia Roundabout, Kent Town / Norwood: Map v5](docs/map-v5/after/bug-roundabout-britannia.jpg)

### Road reading as grass: Port Road / Hindmarsh

![Road reading as grass: Port Road / Hindmarsh: Map v4](docs/map-v5/step0/bug-grass-on-road.jpg)

![Road reading as grass: Port Road / Hindmarsh: Map v5](docs/map-v5/after/bug-grass-on-road.jpg)

### Street sign standing in the road, Hindmarsh

![Street sign standing in the road, Hindmarsh: Map v4](docs/map-v5/step0/bug-sign-in-road.jpg)

![Street sign standing in the road, Hindmarsh: Map v5](docs/map-v5/after/bug-sign-in-road.jpg)

### Floating street-side parking slabs, Bowden

![Floating street-side parking slabs, Bowden: Map v4](docs/map-v5/step0/bug-floating-paths.jpg)

![Floating street-side parking slabs, Bowden: Map v5](docs/map-v5/after/bug-floating-paths.jpg)

## How each was fixed

Each fault's cause, measured before anything changed, is in [MAP_V5_DIAGNOSIS.md](MAP_V5_DIAGNOSIS.md#the-step-1-bugs-root-causes).

- **1a, elevation.** The ground now comes from GA's 5 m LiDAR wherever it is valid (the plains), blended over
  `blendBand` m into Copernicus with its tree canopy capped by DEM-S (the hills). On LiDAR the road's ground is
  sampled along the road only, with no opening or 2D blur, so a hillside no longer bleeds into the road. Each road
  class has its own steepest grade (`heights.maxGradeByClass`: a motorway 7.5%, a residential street 26%). Each
  motorway, trunk and primary carriageway is one profile end to end through its junctions (`heights.corridor`),
  held to its grade. Junction clusters wider than `quadraticAbove` m get a gently curved surface, not one plane.
- **1b, bends and merges.** A way's end tangent is carried into the way that continues it, so a split in OSM is no
  longer a kink. Cross-sections are turned on the road's chord either side (`graph.normalSmooth`). Hairpins are
  curved, not cornered.
- **1c, wheels at joins.** Every road edge is closed by the cross-section: a kerb and a footpath or verge, at the
  road's height or a kerb's, meeting the ground at its outer edge. There's no open 8 cm step for a wheel to catch.
  The car-park slabs (1h) are gone from beside the road.
- **1d, bridges.** A deck's clearance over what it crosses is a constraint spread back along its approaches (within
  `approachGrade`) and through junctions, so embankments form. Decks never take their height from the ground under
  them. A deck beside a road on the ground where it rises away is narrowed so neither overhangs the other
  (`widths.acrossLevels`).
- **1e, tunnels.** Where a tunnel road runs under more than `terrain.tunnelCover` m of ground (the Heysen Tunnels), a
  tube is built from the road surface: walls, a ceiling, portals with headwalls and wings, and lamps on the walls,
  all solid. The hill over it is left intact. The road inside is on the freeway's own profile.
- **1f, surfaces.** A wheel takes the surface of the very triangle its ray hit (road, kerb, footpath, verge, car
  park, deck), not the 2D raster under it. The raster is only for the terrain.
- **1g, signs.** Every sign, signal and post is placed from the cross-section: past the kerb on the footpath or
  verge, on the side its traffic keeps to, facing it, outside every lane and the exclusion mask.
- **1h, floating paths.** Street-side parking is part of the road's cross-section, at the road's height. Car parks lie
  on the ground as the roads shaped it.
- **1i, lights.** Each lamp's pool of light on the road and footpath is nearly twice as wide (15 m, was 8) and
  brighter, and its glow larger. The nearest six lamps are real lights at twice the intensity (320, was 160) and
  reach 40 m (was 32). The draw calls are the same.
- **1j, roundabouts.** A ring of one-way roads that circulates is a roundabout. Its island is raised behind a kerb,
  with bark mulch, low plants and a tree (the style pack's garden, estimated).

## What makes it recognisable

From the whole region's bake (each count from its log; what's estimated is flagged in the tiles):

- **Footpaths, kerbs and verges** (Step 2): 10.5 km² of footpath, 18.2 km² of verge and 8,918 km of kerb on 149,044
  road sides. 32,235 are OSM's own mapped footpaths, snapped to the road's edge; 61,954 are the style pack's
  (estimated). 9,369 sides are paved to the shops, and 36,404 kerbs are lowered at crossings and driveways.
- **Buildings by type** (Step 3): 263,735 buildings. 78,675 are typed from their tags, 4,193 from a place inside them
  and 182,387 estimated from land use, size and height. Houses 227,516, apartments 8,020, shops 4,951, offices 1,824,
  schools 1,151, churches 331, towers 59, malls 31 and more, each with its type's facade, roof and palette. 3,918 have
  their businesses' names on sign bands. 104,232 houses have a front fence, wall or hedge (estimated).
- **Chains as parodies** (Step 4): 467 chain outlets found, 328 of them on their buildings, under 21 parody brands. For
  example Long Roll 51, Northbound 41, Cove Fuel 41, Bright Fuel 40, Hills Pantry 37 and Patty Wagon 27. Their sites
  have 208 pylon signs, 121 petrol canopies (45 of them mapped) with 404 pumps, 42 drive-thru menu boards and 64
  trolley bays. The closest any parody name comes to a real one is 0.67 (the limit is 0.72).
- **Street furniture** (Step 5): 2,386 traffic lights, 393 stop and 1,543 give way signs, 218 speed signs, 1,011
  roundabout entry signs, 678 ONE WAY and 657 NO ENTRY signs, 16,531 street name signs, 3,425 bus stops (1,038 with
  shelters), 1,277 power poles with 659 spans of wire, and 5,397 benches, bins and the like. A further 3,868 pieces
  would have stood in a lane and were left out.
- **Railways** (Step 5): 248.9 km of track with ballast, sleepers and rails, 117 rail bridges, 83 level crossings with
  booms, 194 platforms and 734 overhead wire masts.
- **Markings** (Step 5): 1,703 turn arrows at traffic lights and 53 bicycle lane sides.
- **Landmarks and grounds** (Step 6): the 80 most prominent buildings are drawn from anywhere, among them Adelaide
  Health & Medical Sciences, Festival Tower, The Adelaidean and the Riverbank Stand. The grounds include 134 ovals
  (99 with cricket pitches), 164 fields, 2,058 courts and 1,520 pools. There are 629 suburb signs and 128 park signs.
- **Vegetation** (Step 7): 423,040 trees by kind. 198,253 are street trees in the verges and 93,009 are garden trees
  behind houses (estimated).
- **Teleport spots** (Step 10): 69 in the full map (Tab). They include each parody chain at its most confident
  outlet, the ten most prominent named landmarks, Step 0's ten places and bug spots, and the known bad spots.

## Recognisability

`tools/map-recognise.mjs` shoots 18 places a local would know (`data/map/v5/recognise.json`) from the car's chase
camera, at 13:00, in Map v5 and in Map v4. Nothing on screen names the place: no HUD, no map, no debug label, no
names painted on the road. The places include:

- King William Street at Victoria Square, Rundle Street, Hindley Street, Gouger Street;
- Montefiore Road, Britannia Roundabout, O'Connell Street, The Parade, Unley Road;
- a street of houses in Parkside;
- Jetty Road at Glenelg, Henley Square, Port Adelaide;
- the Superway, the Heysen Tunnels, Anzac Highway.

The quiz page (`docs/map-v5/recognise/index.html`) shows each place's Map v5 picture, asks "where is this?", keeps the
answer back until asked, and puts Map v4's picture beside it. It's for trying on someone who knows Adelaide. The
answers are in `answers.json` beside it. In Map v5 the places carry what the brief asked for: Rundle Street's shops
with their names on the sign bands, Victoria Square's tram lines, Jetty Road's tram and its stop, the Heysen
Tunnels' portals. Map v4 has bare kerbless roads and plain buildings at the same places.

## What the whole-region bake found

Each slice passed all its tests. The first whole-region bake found these, all fixed and in this bake:

- **The bake stopped, twice.** Clipper2-js (1.2.4, the latest) is a port of C#, where a point is a value; in
  JavaScript points are shared objects, and its sweep can leave a ring of edges all at one height that closes on
  itself. `ClipperBase.getCurrYMaximaVertex` then walks round it for good. It happened on a verge at -34.8616,
  138.6228 and on a footpath at -34.9332, 138.5388, found with the bake paused in the debugger.
  `map/model/clipperGuard.ts` replaces that walk with one that throws when it comes back to where it began, which
  Clipper's own `execute()` catches; the loop is counted, and the cross-section's operations are run again on their
  input snapped to 4 mm, then 16 mm. In the whole region: 4 loops, all 4 pieces made again snapped, none left out.
- **Roads still being built.** The North-South Motorway's River Torrens to Darlington tunnels under South Road
  (21 km of them, years from opening) were in the map as drivable motorway. Cars drove into the buildings over them,
  and the ground cut down along them left car parks in the air. Overture flags them `is_under_construction`; those
  roads and railways (and abandoned ones) are left out now.
- **A viaduct that came down between its crossings.** The Superway was 1.8 m over Grand Junction Road. A deck over a
  big junction wasn't lifted to clear it (the junction's own roads weren't counted as what it crosses), and between
  its crossings the deck came back down to the ground's height at the junctions on it where its ramps join. Now:
  - a junction's own roads count, on its surface;
  - a road running along under a deck counts, away from where the deck comes down;
  - between two of its needs a deck stays at the lower of them;
  - a viaduct (decks joined off the ground, with their ramps) is at least its lowest need, less the approach grade
    from the ground it's anchored to.

  On the Superway's slice, deck edges under 4.5 m over a road went from 27% to 0.2%.
- **A car park 7 m up a pit.** A verge corner with no road edge near enough to take its height from was given 0 m,
  and the ground under it was shaped down to it (Burnside, off Greenhill Road). Those stray triangles are left out:
  641 in the whole region.
- **Plants in the road.** A roundabout's or a turning circle's planting was set on rings of the island's mean
  radius, which on an island that isn't round runs off its edge onto the ring road. Each plant is inside the island
  now, at least `islands.plantInset` m in from its kerb.
- **A tunnel under a building.** The tunnel test asked for a tube under Sir Richard Williams Avenue, which runs under
  the airport's forecourt. The bake builds tubes under hills; under a building the building's own collider is the
  roof, from the road's clearance up, and the test checks the headroom instead.

## The bake

| | Map v4 | Map v5 |
|---|---|---|
| Whole region | 21 min (1,267 s), 9.3 GB | 72 min (4,317 s), 9.6 GB |
| Tiles | 366 MB (1,596 tiles) | 545 MB (1,596 tiles) |
| Road surface | 17.7M triangles, 103,068 roads | 18.0M triangles, 102,964 roads, plus 22.6M of kerbs, verges, footpaths and islands |
| Lamps / trees / railings | 76,313 / 431,358 / 167,358 | 76,073 / 423,040 / 145,989 |

The bake is deterministic: the same area baked twice gives byte-identical tiles, road graph and road model (only the
manifest's note of the bake's time and memory differs). Unlike Map v4's, Map v5's tiles do depend on the size of the
bake's blocks ([Known gaps](#known-gaps)).

The bake takes about 3.4 times as long as Map v4's. Half of it is the cross-section bands: 2,237 s for 70,181 cells,
each a few of Clipper's unions and differences. Joining each clip set first to avoid Clipper's stalls added 13% to
that step. The rest is Map v4's own steps.

In the game, a tile is about 1.5 times Map v4's. The extra is the bands' triangles, the furniture lists and the
buildings' facades. It streams the same way.

## The tests

### Map v5's own (`npm run test:map5`), on the whole region: 17 of 19 pass

- ✅ **side**: signs and lights on the left of the traffic they face, for every kind:
  - traffic lights 2,376 of 2,386;
  - give way 1,533 of 1,543;
  - stop 389 of 393;
  - speed 216 of 218;
  - roundabout 1,009 of 1,011;
  - ONE WAY;
  - NO ENTRY 647 of 657.
- ✅ **lanes**: 0 of 821,321 pieces (furniture, signs, lamps, trees, place and street name signs) stand on a lane.
- ❌ **floating**: 131 of 6,861,377 car-park and path triangles stand more than 0.6 m over the ground with nothing under
  them; the test allows 68 (0.001%). The highest is 1.21 m.
- ❌ **clearance**: 35 of 1,544 deck-edge pieces over a road are under 4.5 m (2.3%); the test allows 2%. The lowest is
  3.89 m.
- ✅ **roundabouts**: Britannia Roundabout's two islands are gardens (32 of 32 points each), and North Terrace / King
  William Street, a crossing of divided roads, isn't one.
- ✅ **buildings**: all 263,735 have a type (69% estimated, marked so).
- ✅ **tunnels** (6 of 6), each bore driven through end to end and solid all round:
  - the Heysen Tunnels' bores, at 6.7% and −6.3% inside, the body within 0.15 m of the road;
  - Sir Richard Williams Avenue under the airport's forecourt, with headroom under the building.

The CBD, Heysen and Superway slices pass all their tests.

### Map v4's on the Map v5 bake (`npm run test:map4 -- --dir assets/map/adelaide/v5`): 21 of 27 pass

- ✅ widths: every class at least its model width (95% of 400 cross-sections at 100.5% or more).
- ✅ overlapping road surfaces: 0.58% (limit 0.60%).
- ✅ the drawn ground never through the road at near detail; the collision surface within 0.3 cm of the drawn road.
- ✅ no building, railing or trunk over a lane, and 0 trunks on a road.
- ✅ junction joins: 0.037% with no road, 0.23% with a step over 2 cm.
- ✅ crossings at 30–150 km/h within 10.1 m/s².
- ✅ lamps: 0 on a lane; 98.49% of lit road points with a lamp within 30 m.
- ✅ 9 of the 10 known bad spots.
- ❌ **cracks**: 12 T-junction cracks inside the road on 25 tiles (4.78 per 100k triangles; the limit is 2), each under
  3 mm.
- ❌ **edges**: 0.064% of 2.6M points 0.15 m inside a road's edge have no drawn road (the limit is 0.050%). They're
  service lanes, drawn a little narrower than the model's edge.
- ❌ **colliders**: of 87,554 audited, 75 road collision triangles lie more than 2 cm off the drawn road. They are kerb
  and verge triangles at a block's edge, a few cm (at most 9 cm) off the neighbouring tile's drawn kerb or verge.
  Something is drawn under each one; the bake's own audit, against the road model, passes.
- ❌ **trees**: 78 of 687,722 tree crowns reach through a bridge deck.
- ❌ **bad spots**: King William Street has 6 holes in 601 road points.
- ❌ **seams**: 48 of 353,884 road vertices on the 2,982 shared tile edges are without their neighbour's within 1 cm.
  These are the same block-edge kerbs and verges.

The colliders and seams failures come from the block-edge difference in [Known gaps](#known-gaps). The cracks, the
edge points, the crowns and King William Street's holes were found on the CBD slice too, and they're as small there.

### Map v3's determinism test on it (`npm run test:map -- --region adelaide --map v5 --only determinism`)

❌ It fails: 18 of 22 files differ when the second bake is a block per tile. The same blocks twice give identical
files.

### Map v4's tests, made V5-aware

Map v4's tests (`tests/map/v4.test.ts`) run on the V5 bake too (`--dir assets/map/adelaide/v5`). Four of their
measures assumed things that V5 changes on purpose, so on a V5 bake they read V5's way:

- **A lane is the road's own surface.** V5's road mesh also holds kerbs, verges, footpaths, islands and gardens. Map
  v4's tests counted anything in the road mesh as road, so a tree in a verge would have been "a tree on the road".
  On V5 a lane is a road triangle whose surface isn't one of the bands beside it (kerb, verge, footpath, dirt or a
  concrete strip).
- **Cracks are counted in the road's own triangles.** The T-junction crack count leaves out the kerb's and
  footpath's steps, which are meant to be there.
- **Tight bends are left out of the edge-hole test.** V5 turns each cross-section on the road's chord
  `graph.normalSmooth` m either side, so through a tight bend its edge isn't square to one piece of the centre line,
  where Map v4's test looks for it. Bends turning more than `tests.bendTurn` (30°) within twice that distance are
  skipped.
- **Low plants aren't trunks.** V5's garden plants and roundabout shrubs have no collider by design (a car drives
  through a bush), so the "every tree solid" test leaves them out.

No Map v4 test was removed or loosened for Map v4's own bake: it still runs as before on `assets/map/adelaide/v4`.

## Known gaps

What Map v5 doesn't do yet, or does only partly, and why:

- **The hills' elevation is still 30 m data.** GA's 5 m LiDAR doesn't cover the Adelaide Hills. The SA
  Government's 1 m LiDAR does, but it's ordered through ELVIS, which this bake environment can't reach, and the
  order needs an email address. Until the owner orders it ([MAP_V5_DIAGNOSIS.md](MAP_V5_DIAGNOSIS.md#what-only-the-owner-can-do)),
  the hills use Copernicus capped by DEM-S, and the freeway's grade comes from its class's limit rather than the
  real cuttings and embankments.
- **Direction signs.** Only 7 are tagged in the data the bake can reach, so the big green signs over and beside the
  freeways and main roads aren't there. Inventing them would break the brief's rule.
- **Pedestrian refuges, keep-clear areas and painted medians.** Overture's copy of OSM has none of them here.
- **Estimated driveways.** Kerbs are lowered at the driveways OSM maps; a driveway OSM doesn't map isn't guessed.
- **Building parts.** 254 buildings have `building:part` shapes (a tower on a podium, say). Map v5 draws the outline
  at the building's height; the parts aren't used yet.
- **Overhead wires on street tram lines.** The tram's overhead wiring is drawn where the line has its own track;
  along King William Street and the Glenelg line's street section, where the tram runs in the road, it isn't.
- **The South Eastern Freeway's grade** is still steeper than the real road in places: 13.6% over 20 m and 9.8% over
  100 m, where the real freeway is about 6%. Its profile is held to the motorway limit (7.5%), but the junction
  surfaces at the Mount Osmond and Devils Elbow interchanges sit off it by up to 1.5 m, and the road between them takes
  the difference. Changing the motorway limit or the junctions' weight didn't fix it. The real fix is the hills' 1 m
  LiDAR.
- **Bridges a little low.** 35 deck-edge pieces (2.3% of those over a road; the test allows 2%) are under 4.5 m. The
  worst is Torrens Road over Devonport Terrace at 3.89 m; others are Anzac Highway over South Road at 4.16 m, Mount
  Osmond Road over the freeway at 4.33 m and Hart Street over Wirra Drive at 4.17 m. They're short decks, held down by
  their approaches.
- **A few raised paving pieces.** 131 car-park and path triangles (of 6.86M) stand 0.6–1.21 m over the ground beside
  a road or a service bridge in 19 places (the test allows 68).
- **Kerbs and verges at a bake block's edge.** Map v4's tiles were the same whatever the size of the bake's blocks. Map
  v5's kerbs, verges, furniture, wires, trees and lamps near a block's edge come out a little different depending on
  which block builds them. Each block works from what's within its own reach, so near its edge the road edges,
  buildings and furniture it sees aren't quite its neighbour's. At a tile edge between two blocks a kerb or verge can
  step by a few cm (at most 9 cm). That's the 48 seam vertices and 75 collision triangles above. It's deterministic
  (the same blocks always give the same tiles); making every Map v5 step independent of the blocks is the fix.
- **The bake's length**: 72 minutes for the whole region (Map v4's 21).
