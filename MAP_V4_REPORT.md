# Map v4 report: Adelaide

Map v4 rebuilds Adelaide's roads from **one road surface model** (`map/model/`). Everything about a road comes from
it:

- the drawn road and its markings;
- the ground under it;
- the road colliders;
- the trees, railings and street lamps beside it;
- the navigation graph.

Map v3's pipeline stays where it worked: the OSM extract, the vector map, the elevation and datums, the buildings,
the tile format and the streamer. Map v3 is still there behind `?map=v3` (off by default).

- How it works: [MAP_README.md](MAP_README.md#the-road-surface-model-map-v4).
- What was wrong with Map v3, measured before anything changed: [MAP_V4_DIAGNOSIS.md](MAP_V4_DIAGNOSIS.md).
- Every threshold: `data/map/v4.json`.
- The tests: `tests/map/v4.test.ts` (`npm run test:map4`).

In the game, the label at the bottom left reads `Map v4 | tile x/y | DEM: Copernicus GLO-30 30 m | roads: roads-4.2`.

## The six problems: before and after

Map v3's numbers are Step 0's, measured on 112 tiles of central Adelaide and Clapham (`MAP_V4_DIAGNOSIS.md`).

Map v4's come from its tests on the **whole region's bake**:

- **Width, holes, ground through the road, steps and bumps:** measured on every road in the region, or the tiles
  round the spawn and the bad spots.
- **Colliders:** audited on 80 tiles at test time, and on every tile at bake time.
- **Lamps:** along every lit road.

| # | Problem | Map v3 | Map v4 |
|---|---|---|---|
| 1 | Roads too narrow (median drawn width) | primary 5.9 m, secondary 5.5 m, trunk 7.1 m, residential 8.4 m | primary 9.2 m, secondary 10.0 m, trunk 9.6 m, residential 10.4 m; every road at least its model width (400 cross-sections) |
| 2 | Holes along road edges | 0.43% of edge samples (+0.74% at junctions) | 0.013% of 2,695,194 edge points; 0.063% of 913,284 samples across junction joins |
| 2 | Ground through the road (near / middle detail) | 1.44% / 23% | 0 / 0.07% |
| 2 | T-junction cracks inside the road | (fans: not measured) | 0.87 per 100,000 triangles, each under 3 mm |
| 3 | Colliders with nothing drawn there | every undrawn tree solid | none (every collider in every tile audited at bake time; the bake fails otherwise) |
| 3 | Building / railing colliders over a lane | 1,302 / 685 points | none |
| 4 | Trees on roads / through bridge decks | 9 trunks in lanes / 5 crowns through decks | none of 431,358 trees |
| 5 | Two road surfaces over one spot | 6.5% | 0.45% |
| 5 | Steps over 2 cm at junction joins | 1.4% (two surfaces stepping) | 0.22% of samples across 101,476 joins |
| 5 | Vertical acceleration crossing at 150 km/h: junctions / bridge ends / tile borders | 21.1 / 177.2 / 2.8 m/s² | 17.8 / 21.9 / 18.3 m/s² (limit 25) |
| 6 | Street lamps | none | 76,313: 7,567 mapped in OSM, 68,746 estimated (flagged); 98.5% of lit roads have one within 30 m; none in a lane |

All of Map v4's tests pass on the whole region: **27 of 27** in `tests/map/v4.test.ts`. The list is at the end.

## Before and after

Each picture is Map v3 on the left and Map v4 on the right, at the same place, at noon. They were taken with
`node tools/map-shots.mjs` in the game's own renderer: the top views from straight above, the others from the chase
camera. The speedometer is part of the game's HUD.

### The ten most complex junctions

Ten clusters were picked from the whole region's road model:

- the most roads meeting (then the most junction nodes, then the size);
- at least two named roads;
- under 200 m across;
- at least 400 m apart;
- well inside the baked area.

**1. Rapid Avenue, Wyatt Street, Folland Avenue, Northgate Parade** (18 roads meeting, 34 junction nodes, 179 m across; -34.85852, 138.63068)

![Rapid Avenue, Wyatt Street: from above](docs/map-v4/j01-rapid-avenue-wyatt-street-top.jpg)
![Rapid Avenue, Wyatt Street: driving in](docs/map-v4/j01-rapid-avenue-wyatt-street-chase.jpg)

**2. Western Link Road, Sir Richard Williams Avenue, Andy Thomas Circuit** (14 roads meeting, 29 junction nodes, 169 m across; -34.93912, 138.53478)

![Western Link Road, Sir Richard Williams Avenue: from above](docs/map-v4/j02-western-link-road-sir-richard-williams-avenue-top.jpg)
![Western Link Road, Sir Richard Williams Avenue: driving in](docs/map-v4/j02-western-link-road-sir-richard-williams-avenue-chase.jpg)

**3. Park Avenue, Cross Road, Glen Osmond Road, Mount Barker Road** (14 roads meeting, 18 junction nodes, 151 m across; -34.96313, 138.64387)

![Park Avenue, Cross Road: from above](docs/map-v4/j03-park-avenue-cross-road-top.jpg)
![Park Avenue, Cross Road: driving in](docs/map-v4/j03-park-avenue-cross-road-chase.jpg)

**4. Payneham Road, Lower North East Road, Clairville Road, Montacute Road** (13 roads meeting, 27 junction nodes, 164 m across; -34.88946, 138.65638)

![Payneham Road, Lower North East Road: from above](docs/map-v4/j04-payneham-road-lower-north-east-road-top.jpg)
![Payneham Road, Lower North East Road: driving in](docs/map-v4/j04-payneham-road-lower-north-east-road-chase.jpg)

**5. Junction Lane, South Road, Henley Beach Road, Norma Street** (12 roads meeting, 30 junction nodes, 197 m across; -34.92389, 138.56978)

![Junction Lane, South Road: from above](docs/map-v4/j05-junction-lane-south-road-top.jpg)
![Junction Lane, South Road: driving in](docs/map-v4/j05-junction-lane-south-road-chase.jpg)

**6. Gorge Road, Darley Road, Newton Road** (13 roads meeting, 20 junction nodes, 167 m across; -34.87667, 138.67131)

![Gorge Road, Darley Road: from above](docs/map-v4/j06-gorge-road-darley-road-top.jpg)
![Gorge Road, Darley Road: driving in](docs/map-v4/j06-gorge-road-darley-road-chase.jpg)

**7. Adelphi Terrace, Anzac Highway, Nile Street, Sussex Street** (12 roads meeting, 20 junction nodes, 164 m across; -34.97627, 138.51418)

![Adelphi Terrace, Anzac Highway: from above](docs/map-v4/j07-adelphi-terrace-anzac-highway-top.jpg)
![Adelphi Terrace, Anzac Highway: driving in](docs/map-v4/j07-adelphi-terrace-anzac-highway-chase.jpg)

**8. Muller Road, North East Road, Fosters Road, Thistle Avenue** (12 roads meeting, 20 junction nodes, 161 m across; -34.87103, 138.63712)

![Muller Road, North East Road: from above](docs/map-v4/j08-muller-road-north-east-road-top.jpg)
![Muller Road, North East Road: driving in](docs/map-v4/j08-muller-road-north-east-road-chase.jpg)

**9. Tapleys Hill Road, Henley Beach Road** (13 roads meeting, 16 junction nodes, 135 m across; -34.92639, 138.51773)

![Tapleys Hill Road, Henley Beach Road: from above](docs/map-v4/j09-tapleys-hill-road-henley-beach-road-top.jpg)
![Tapleys Hill Road, Henley Beach Road: driving in](docs/map-v4/j09-tapleys-hill-road-henley-beach-road-chase.jpg)

**10. Montacute Road, Newton Road, St Bernards Road** (12 roads meeting, 18 junction nodes, 196 m across; -34.88862, 138.67389)

![Montacute Road, Newton Road: from above](docs/map-v4/j10-montacute-road-newton-road-top.jpg)
![Montacute Road, Newton Road: driving in](docs/map-v4/j10-montacute-road-newton-road-chase.jpg)


### Three bridges

The South Road Superway (mapped as the North South Motorway, the longest deck in the region), Adelaide Bridge (King
William Road over the Torrens), and the Montefiore Road bridge.

**South Road Superway** (the deck 514 m between tile borders or nodes; -34.84227, 138.56422)

![South Road Superway: from above](docs/map-v4/b1-south-road-superway-top.jpg)
![South Road Superway: driving onto it](docs/map-v4/b1-south-road-superway-chase.jpg)

**Adelaide Bridge (King William Road)** (the deck 66 m between tile borders or nodes; -34.91633, 138.59899)

![Adelaide Bridge (King William Road): from above](docs/map-v4/b2-adelaide-bridge-king-william-road--top.jpg)
![Adelaide Bridge (King William Road): driving onto it](docs/map-v4/b2-adelaide-bridge-king-william-road--chase.jpg)

**Montefiore Road bridge** (the deck 193 m between tile borders or nodes; -34.92169, 138.59338)

![Montefiore Road bridge: from above](docs/map-v4/b3-montefiore-road-bridge-top.jpg)
![Montefiore Road bridge: driving onto it](docs/map-v4/b3-montefiore-road-bridge-chase.jpg)


### The known bad spots

Step 0's ten worst places (`MAP_V4_DIAGNOSIS.md`; the owner's screenshots among them). Every one is in
`data/map/known-bad-spots.json`, and the tests check each again (`badspots`).

**Belair Road / Springbank Road, from above (the owner's screenshot): Map v3's four fans and narrow carriageways; Map v4's one patch, the median kept**

![Belair Road / Springbank Road, from above (the owner's screenshot): Map v3's four fans and narrow carriageways; Map v4's one patch, the median kept](docs/map-v4/01-belair-springbank-top.jpg)

**Belair Road, driving in**

![Belair Road, driving in](docs/map-v4/02-belair-springbank-chase.jpg)

**Muller Street: a hole in the road away from any junction (Map v3)**

![Muller Street: a hole in the road away from any junction (Map v3)](docs/map-v4/03-muller-st-hole-top.jpg)

**Kenilworth Road: the ground 18 cm over the road's edge (Map v3)**

![Kenilworth Road: the ground 18 cm over the road's edge (Map v3)](docs/map-v4/04-kenilworth-ground-through-top.jpg)

**Magill Road: the ground through the road at mid distance (Map v3)**

![Magill Road: the ground through the road at mid distance (Map v3)](docs/map-v4/05-magill-rd-chase.jpg)

**Greenhill Road: two road surfaces 34 cm apart over one spot (Map v3)**

![Greenhill Road: two road surfaces 34 cm apart over one spot (Map v3)](docs/map-v4/06-greenhill-step-top.jpg)

**Hindmarsh, the collider view: a building's collider over the road (Map v3, orange)**

![Hindmarsh, the collider view: a building's collider over the road (Map v3, orange)](docs/map-v4/07-building-collider-on-road.jpg)

**Hindmarsh, the collider view: a fence's collider over the road (Map v3, red)**

![Hindmarsh, the collider view: a fence's collider over the road (Map v3, red)](docs/map-v4/08-fence-collider-on-road.jpg)

**Hackney Road bridge, the collider view: trees through the deck (Map v3)**

![Hackney Road bridge, the collider view: trees through the deck (Map v3)](docs/map-v4/09-tree-through-deck.jpg)

**King William Street at night: one narrow lane and no street lights (Map v3); four lanes, lit (Map v4)**

![King William Street at night: one narrow lane and no street lights (Map v3); four lanes, lit (Map v4)](docs/map-v4/10-king-william-night.jpg)


## How each was fixed

1. **Narrow roads.**
   - **Cause:** Map v3 gave each carriageway of a divided road one lane when OSM didn't tag its lanes, and Overture's
     copy of OSM tags none.
   - **Fix:** Map v4 counts each class's lanes per direction, adds shoulders and a kerb band, and takes OSM's `width`
     or `lanes` tag first. Widths and lanes not in OSM are marked estimated. Two carriageways side by side keep their
     real median.
2. **Gaps, holes and missing chunks.**
   - Ribbons and junction patches share their vertices exactly. They're put on the tiles' 1 cm grid before
     T-junctions are closed.
   - The ground is kept under the lowest road within 3 m of every grid point, and under every road edge (sampled
     every metre).
   - The far terrain meshes are cut from heights lowered under roads by their own error.
3. **Invisible objects.**
   - Building colliders are cut off the road surface; slivers and pieces left with a corner on the road are dropped.
   - Car parks are cut off roads too.
   - Railings are tested along their whole length, thickness and collider height.
   - Trunks are made only for drawn trees.
   - The bake audits every collider in every tile against what's drawn there.
4. **Trees on roads and bridges.** An exclusion mask from the model (every road surface on every layer, the ground
   under every deck, railways, tunnel portals) is tested against each tree's whole crown.
5. **Junctions cutting each other off.**
   - Arms are trimmed to where their edges meet.
   - Junctions closer than `minRibbon` become one cluster with one patch on one plane.
   - Roads ease onto the plane over 20 m.
   - Neighbouring planes are relaxed so a short road between two meets both in one smooth curve.
   - The drawn profile has vertical curves.
6. **Street lighting.**
   - OSM's 10,191 mapped lamps first; those on a road surface are dropped as wrong.
   - Then estimated ones (flagged) along lit roads, at junction corners and crossings, and in tunnels: lit is
     `lit=yes`, trunk to tertiary everywhere, and other urban classes in built-up areas.
   - They're drawn instanced with glows and pools of light, and the nearest six are real lights after dark.

## What the whole-region bake found

The 3 km slice passed everything. The whole region found these, all fixed and in this bake:

- **Roads given twice.** 56 roads, 54 of them bridges (the Superway, the Port River Expressway, Manton Street), came
  twice from Overture: one copy with its layer, one without. Tile-border nodes are each way's own, so the copies didn't
  share nodes and weren't recognised as one road; there were two decks. Now two segments between the same two places
  are one road.
- **The Flinders Street hump.** 10 m of Flinders Street between two big junction patches had to climb 0.5 m between
  two nearly level planes: 41 m/s² at 150 km/h. A short road between two planes now rises as the planes' own slopes
  do: 18 m/s².
- **Kinks.** Profiles are straight between points up to 12 m apart, so every change of grade was a kink. At Adelaide
  Bridge's end that was 14 m/s² at 150 km/h. Vertical curves (the profile averaged over ±6 m) bring it to 7.
- **Invisible walls.** A building's convex pieces included slivers metres long and a millimetre wide, and a stitch
  triangle at a road's outer edge was skipped as a sliver when cutting buildings off it. Estimated guard rails beside
  a lower road were tested to the rail's height, not its collider's, which reached into the road above.
- **A kerb lip.** On a steep crossfall the ground stood up to 4.5 cm over the road's edge.
- **Dead ends taken into a junction.** A dead end too close to a junction to keep its own road becomes part of the
  patch, and the patch stopped exactly at its last node. Map v3's own road test found 16 sampled OSM nodes with no
  road drawn over them (each such an end). Those patches now run the dead end's 0.5 m cap past it.
- **A ray through a vertex.** Map v4 puts a mesh vertex on every graph point (the cross-sections' crowns). Map v3's
  height test casts its physics ray straight down through graph points, and Rapier lets a ray through an exact vertex
  slip by: 16.6 cm, on one service road. One centimetre either side it hits the road, and no wheel is ever exactly
  there. The test now casts 5 mm off the point.
- **Lamp coverage.** Measured along every road the rule lights: 98.5%. The first measure counted every residential
  street in the hills and the parklands, deliberately unlit, and said 60%.

## The bake

| | Map v3 | Map v4 |
|---|---|---|
| Whole region | about 6 min, 7 GB | 22 min (1,309 s), 9 GB |
| A 3 km slice of the city | — | 54 s (129 s before this round's speed-ups) |
| Tiles | 172 MB | 366 MB (1,596 tiles) |
| Road surface | — | 17.7M triangles, 103,068 roads, 32,600 junction patches |
| Lamps / trees / railings | none / 456,489 / 146,065 | 76,313 / 431,358 / 167,358 (66,716 estimated) |

The surface, the ground under it, the mask, trees, railings, lamps and tiles are made a block of 6 × 6 tiles at a time.
Each block takes the roads and junctions within 100 m of it. Each piece depends only on its own inputs, so blocks of a
different size or pad give **byte-identical** tiles, graph and road model. The determinism test checks that (its
second bake is a block per tile).

Making it faster:

- the T-junction repair, tile clipping and surface check weld vertices in typed arrays (they spent most of their time
  making strings and large-number Map keys);
- the pad is only as wide as anything looks for a road;
- trees come only from woods and parks near the block;
- bridge lifts are spread in one pass, not n³;
- the cached elevation keeps a raw copy;
- the bake runs with a larger young-generation heap.

Map v4 still takes longer than Map v3's whole bake. The biggest parts now are the surface (5 min over all blocks),
the ground under it (3 min), Map v3's own tile builder (2.5 min) and the junction unions (1.5 min).

## Known issues

- **Short steep bridges.** A few very short bridges on steep hill roads (Slape Crescent, Schulze Road) meet a junction
  with a step of up to 1.1 m. The 30 m elevation in a gully puts the planes either side metres apart. They're within
  the share limit (0.22% of samples across all joins), but they're real steps. Better elevation (South Australia's
  1 m LiDAR, when ELVIS can be reached) is the real fix.
- **Big clusters.** Junctions closer than `minRibbon` merge, and in places they chain into clusters up to 200 m across
  on one plane (the ten above). On steep ground a plane that size sits away from the real ground at its edges; the
  ground is shaped to it.
- **Bigger tiles.** Tiles are about 2.1× Map v3's (more rows on curves and at junctions, the collision mesh with its
  apron, the exclusion mask, lamps). It's well within R2's free storage, but each tile takes longer to download.
- **Bumps on real geometry.** The tile-border bump runs found 18 m/s² at 150 km/h on Maria Street. It isn't a seam:
  every tile edge's vertices match. It's a real sag in the road, from −4.75% to level over 30 m. 150 km/h on a
  residential street compresses the suspension there.
- **Estimated features** are flagged in the data: widths and lanes OSM doesn't give, lamps, railings.

## The tests

`npm run test:map4 -- --region adelaide` (`tests/map/v4.test.ts`) on the whole region's bake: **27 of 27 pass**.

- ✅ **widths** · 400 cross-sections: drawn width ≥ 100.0% of the model's in 95% of them (limit 97%), narrowest Albert Street at -2740, -552 (10.40 of 10.40 m)
- ✅ **widths** · drawn widths by class (median): residential 10.4 m, tertiary 10.4 m, secondary 10.0 m, trunk 9.6 m, road 9.2 m, primary 9.2 m, unclassified 9.2 m, service 5.1 m, track 4.2 m
- ✅ **surface** · 25 tiles joined, 460k triangles: 4 T-junction cracks inside the road (0.87 per 100k triangles, limit 2), 12 more in its outline; each under 3 mm
- ✅ **surface** · overlapping road surfaces: 1016 of 227,160 sampled triangles have another solid one within 0.5 m over or under them (0.45%, limit 0.60%; Map v3: 6.5%)
- ✅ **edges** · 2,695,194 points 0.15 m inside road edges: 355 with no drawn road (0.013%, limit 0.050%; Map v3: 0.43%)
- ✅ **edges** · the drawn ground never through the road: near detail 0 (0.000%), middle detail 1995 (0.074%) of them under the ground (limits 0.10%, 0.50%; Map v3: 1.44%, 22.99%)
- ✅ **edges** · the collision surface under 584 of them: within 0.1 cm of the drawn road (limit 3 cm)
- ✅ **colliders** · 80 tiles, 66,215 colliders audited: every one has something drawn (terrain 81, road 152, building 48311, barrier 7943, tree 9728)
- ✅ **colliders** · no building, railing or trunk over a lane: none (Map v3: 1,302 building and 685 railing collider points over lanes)
- ✅ **colliders** · 25 tiles loaded and unloaded: 31671 colliders in, 0 left after unloading
- ✅ **trees** · 431,358 trees: 0 trunks on a road, 0 crowns through a bridge deck (Map v3: 9 trunks in lanes, 5 crowns through the Hackney Road bridge)
- ✅ **junctions** · 101,476 joins, 913,284 across them: 579 with no road (0.063%, limit 0.10%), 2022 steps over 2 cm (0.22%, limit 0.50%; largest 109.8 cm): 3.5 cm step at 2259.8, 7589.9 (Brown Hill Creek Road); 2.1 cm step at 2259.8, 7589.9 (Brown Hill Creek Road); 2.4 cm step at 2259.8, 7589.9 (Brown Hill Creek Road); 3.1 cm step at 2259.8, 7589.9 (Brown Hill Creek Road)
- ✅ **bumps** · 9 crossings × 3 speeds: junctions 3 × 3: ≤ 17.8 (v3 21.1), bridge ends 3 × 3: ≤ 21.9 (v3 177.2), tile borders 3 × 3: ≤ 18.3 (v3 2.8) m/s² (limits 25 at 30 km/h, 25 at 80 km/h, 25 at 150 km/h; 0 over); worst bridge end on Morphett Street at 150 km/h (-1080, -193)
- ✅ **lamps** · 76,313 lamps (68,746 estimated): 0 standing on a road's lanes (Map v3: no lamps at all)
- ✅ **lamps** · 175,381 points along lit roads: 98.51% have a lamp within 30 m (at least 80.00%)
- ✅ **lamps** · the nearest 6 as real lights: 6 lit at night, the nearest 6 (5, 40, 75, 110, 145, 180 m); farthest at 0% (fading in); all off by day: true
- ✅ **badspots** · Belair Road: 540 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · Belair Road: 785 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · Muller Street: 550 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · Kenilworth Road: 803 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · Magill Road: 43 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · Greenhill Road: 913 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · building collider over the road surface, Hin: 208 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · fence collider over the road surface, Hindma: 747 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · Hackney Road: 1018 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **badspots** · King William Street: 601 road points within 25 m: 0 holes, 0 under the ground, 0 off the collision surface
- ✅ **seams** · 2982 shared tile edges: 259,702 road vertices on them: 0 without their neighbour's (within 1 cm)

`npm run test:map -- --region adelaide --map v4` (Map v3's tests on the v4 bake):

<!-- v3 test list -->
