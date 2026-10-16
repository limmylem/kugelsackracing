# Map v5 Step 0: diagnosis (Adelaide)

Map v4 gave Adelaide accurate, watertight, drivable roads. Map v5's job is to make the world **recognisable**: someone
who knows a place should know where they are from the street alone. Before building anything, Step 0 measured:

- what the data gives us;
- how wrong the terrain is;
- what each well-known place is missing;
- the cause of every known Map v4 bug.

Everything here was measured on the live Map v4 bake (`assets/map/adelaide/v4/`, roads `roads-4.2`) and on the bake's
own inputs (`.cache/map/adelaide/`).

The tools:

- `map/debug/coverageV5.ts` (data coverage and the per-spot inventory);
- `tools/map-shots.mjs` (the pictures);
- one-off scripts for the terrain and bug numbers, whose method is described with each number.

## The short version

- **Terrain is the biggest problem, and it is a data problem first.**
  - Map v4 used one source, Copernicus GLO-30: a 30 m *surface* model, with the trees and roofs in it.
  - On the plains, Map v4's roads sit a median **0.97 m above** the 5 m LiDAR ground (95th percentile 4.0 m).
  - On the South Eastern Freeway, Map v4 climbs to the Heysen Tunnels at **27.5% over 20 m**. The real freeway is
    graded at about 6–7%.
  - Better data is reachable for the plains: Geoscience Australia's **5 m LiDAR DEM**, through AWS's public terrain
    tiles. It is **not** reachable for the hills. There, the best free sources are 30 m: Copernicus, and GA's
    vegetation-removed DEM-S. SA's 1 m hills LiDAR is behind the ELVIS ordering system, which this bake environment
    can't reach (see [What only the owner can do](#what-only-the-owner-can-do)).
- **Every Step 1 bug has a single, measured cause.** Each is listed below with its evidence.
- **The data is good for footpaths, crossings, lamps, signals, trees and furniture.** It is poor for road-side tags,
  shops and brands:
  - The OSM data comes from **Overture's copy** of OSM (Geofabrik, Overpass and the OSM API are all blocked from the
    bake environment).
  - That copy drops `sidewalk=*`, `junction=roundabout`, `railway=level_crossing`, `service=drive-through` and most
    shop and amenity POIs.
  - **Overture Places** has the shops and brands instead: 40,716 places, 3,516 with a brand. The
    **name-suggestion-index** recognises 2,429 of them as chain outlets.

## The teleport spots

`data/map/v5/spots.json`. Each spot has a street-level shot (the chase camera, looking along `bearing`) and a top-down
shot 140 m across. All shots are at noon.

| Spot | What it is | Bug |
|---|---|---|
| `shopping-rundle-st` | Main shopping street: Rundle Street, East End | |
| `suburb-parkside` | Suburban street: Alfred Street, Parkside | |
| `interchange-superway` | Motorway interchange: South Road Superway / Port Wakefield Road | |
| `petrol-otr-unley` | Petrol station: OTR, King William Road / Greenhill Road, Unley | |
| `drivethru-west-tce` | Fast-food restaurant with a drive-thru: West Terrace | |
| `carpark-burnside-village` | Shopping centre car park: Burnside Village | |
| `school-adelaide-high` | School: Adelaide High School | |
| `park-rymill` | Park: Rymill Park (from East Terrace) | |
| `station-adelaide` | Train station: Adelaide Railway Station, North Terrace | |
| `landmark-adelaide-oval` | Landmark: Adelaide Oval (from War Memorial Drive) | |
| `bug-sef-m1` | South Eastern Freeway (M1) above Glen Osmond | 1a |
| `bug-heysen-tunnels` | The Heysen Tunnels | 1e |
| `bug-windy-run-start` | The windy route's start: Belair Road / Springbank Road (the owner's screenshot) | 1a, 1b, 1c |
| `bug-windy-run-hairpins` | The windy route's hairpins on Belair Road, Clapham | 1a, 1b |
| `bug-overpass-waverley` | Waverley Ridge Road over the South Eastern Freeway, Crafers (the owner's screenshot) | 1d |
| `bug-steep-bridge-nsm` | The steepest deck: North South Motorway, Wingfield (74%) | 1d |
| `bug-roundabout-britannia` | Britannia Roundabout, Kent Town | 1j |
| `bug-grass-on-road` | A road read as grass: Barton Terrace West | 1f |
| `bug-sign-in-road` | A street sign standing in the road: Barton Terrace West | 1g |
| `bug-floating-paths` | Floating street-side parking slabs: Hill Street, Bowden | 1h |

**The windy run** is the live game's published "Windy route" (`route_mv5tzos995747cf9`, 2.3 km). It was found
through the public API: `tools/live-look.mjs` now prints the published routes, and with the workflow's `route` input,
a route's course. Its course is saved in `data/map/v5/windy-route.json`. It starts at the Belair Road / Springbank
Road junction (the owner's first screenshot, and Map v4's bad spot 1) and climbs Belair Road's hairpins at Clapham.

### Map v4 at each spot (street level | from above)

**Main shopping street: Rundle Street, East End**: Grass to the shopfronts, no footpaths; every building the same window grid; the street sign on the grass; 22 branded places and 6 signals unused.

![Main shopping street: Rundle Street, East End](docs/map-v5/step0/shopping-rundle-st.jpg)

**Suburban street: Alfred Street, Parkside**: Single-storey villas drawn as two- to three-storey flat-roofed blocks; no footpaths, verges, fences or driveways; a sign on the road's edge.

![Suburban street: Alfred Street, Parkside](docs/map-v5/step0/suburb-parkside.jpg)

**Motorway interchange: South Road Superway / Port Wakefield Road**: The roads are right; nothing tells you where you are: no direction signs or route shields (none tagged), no structure detail.

![Motorway interchange: South Road Superway / Port Wakefield Road](docs/map-v5/step0/interchange-superway.jpg)

**Petrol station: OTR, King William Road / Greenhill Road, Unley**: A box on grey paving: no canopy, pumps or sign; OTR (in Overture) unused.

![Petrol station: OTR, King William Road / Greenhill Road, Unley](docs/map-v5/step0/petrol-otr-unley.jpg)

**Fast-food drive-thru: West Terrace, Adelaide**: McDonald's (Overture) shown as a plain box; no drive-thru lane, pylon or menu board.

![Fast-food drive-thru: West Terrace, Adelaide](docs/map-v5/step0/drivethru-west-tce.jpg)

**Shopping centre car park: Burnside Village**: The centre as beige boxes; 50 branded shops unused; the car park plain.

![Shopping centre car park: Burnside Village](docs/map-v5/step0/carpark-burnside-village.jpg)

**School: Adelaide High School, West Terrace**: A plain box; the school type and grounds unused.

![School: Adelaide High School, West Terrace](docs/map-v5/step0/school-adelaide-high.jpg)

**Park: Rymill Park, East Terrace**: Trees are right; benches, bins and paths aren't drawn.

![Park: Rymill Park, East Terrace](docs/map-v5/step0/park-rymill.jpg)

**Train station: Adelaide Railway Station, North Terrace**: A box; no platforms, canopies or tracks; unnamed in the data.

![Train station: Adelaide Railway Station, North Terrace](docs/map-v5/step0/station-adelaide.jpg)

**Landmark: Adelaide Oval**: The stands as boxes; the oval itself not drawn; not visible from far away.

![Landmark: Adelaide Oval](docs/map-v5/step0/landmark-adelaide-oval.jpg)

**South Eastern Freeway (M1) above Glen Osmond**: 1a: the freeway's profile follows a 30 m surface model; 27.5% near the tunnels.

![South Eastern Freeway (M1) above Glen Osmond](docs/map-v5/step0/bug-sef-m1.jpg)

**Heysen Tunnels, South Eastern Freeway**: 1e: no portal: the freeway runs into a canyon cut in the hill, roofed by the hill's top.

![Heysen Tunnels, South Eastern Freeway](docs/map-v5/step0/bug-heysen-tunnels.jpg)

**The windy route's start: Belair Road / Springbank Road (the owner's screenshot)**: 1a/1b/1c: the 176 m junction on one plane meeting steeper roads: the owner's tilted slab.

![The windy route's start: Belair Road / Springbank Road (the owner's screenshot)](docs/map-v5/step0/bug-windy-run-start.jpg)

**The windy route's hairpins, Belair Road, Clapham**: 1a/1b: kinks at the hairpin; heights fine here (Copernicus), but the 5 m tiles are 70 m low.

![The windy route's hairpins, Belair Road, Clapham](docs/map-v5/step0/bug-windy-run-hairpins.jpg)

**Waverley Ridge Road over the South Eastern Freeway, Crafers (the owner's screenshot)**: 1d: the deck drops from 565 m to the freeway's 557 m within about 22 m, through the freeway's clearance.

![Waverley Ridge Road over the South Eastern Freeway, Crafers (the owner's screenshot)](docs/map-v5/step0/bug-overpass-waverley.jpg)

**Steepest bridge: North South Motorway deck, Wingfield**: 1d: a 48 m deck at 74% (top view only: the chase camera found no ground on the deck).

![Steepest bridge: North South Motorway deck, Wingfield](docs/map-v5/step0/bug-steep-bridge-nsm.jpg)

**Roundabout: Britannia Roundabout, Kent Town / Norwood**: 1j: grass islands; no kerb, garden or tree.

![Roundabout: Britannia Roundabout, Kent Town / Norwood](docs/map-v5/step0/bug-roundabout-britannia.jpg)

**Road reading as grass: Port Road / Hindmarsh**: 1f: the road's edges read as grass to the tyres (the surface raster).

![Road reading as grass: Port Road / Hindmarsh](docs/map-v5/step0/bug-grass-on-road.jpg)

**Street sign standing in the road, Hindmarsh**: 1g: the junction sign stands on the road surface.

![Street sign standing in the road, Hindmarsh](docs/map-v5/step0/bug-sign-in-road.jpg)

**Floating street-side parking slabs, Bowden**: 1h: a street-side parking strip as a raised slab with concrete kerbs beside the road.

![Floating street-side parking slabs, Bowden](docs/map-v5/step0/bug-floating-paths.jpg)

## Data coverage (the whole region)

`node map/debug/coverageV5.ts --region adelaide`.

- **OSM source:** `overture` (release 2026-09-23.1).
- **Overture Places:** the same release.
- **The name-suggestion-index:** 8.0.20260918, from npm.

### Roads

| | |
|---|---|
| Drivable ways | 68,564 |
| …with a `sidewalk*` tag | 31 (0.0%) |
| …with `lanes` / `width` / `lit` | 0.3% / 0.3% / 0.2% |
| …with `surface` / `maxspeed` | 77.3% / 49.9% |
| …with `destination*` / `turn:lanes` / `incline` | 7 / 9 / 2 |
| …with `cutting` / `embankment` | 0 |
| …with `ref` | 120 |
| **Separately mapped sidewalks** (`footway=sidewalk`) | **15,558 ways, 2,258 km** |
| Crossing ways (`footway=crossing`) | 14,422 |
| All footways, paths and pedestrian ways | 41,183 |
| Driveways (`service=driveway`) / parking aisles / alleys | 7,873 / 3,978 / 466 |
| Drive-throughs (`service=drive-through`) | 0 (dropped by Overture) |

### Buildings

| | OSM (123k) |
|---|---|
| With a type (not just `building=yes`) | 66.5% |
| With a height | 59.7% |
| With levels | 15.2% |
| With a roof shape | 2.1% |
| With a colour | 0.4% |
| With a material | 0.2% |
| Building parts | 254 |

Overture's buildings add heights, floors, roof shapes and colours where it has them. It also adds 142k footprints OSM
lacks: Map v4 merges 265k buildings in all.

### Points, furniture and structures

| Feature | Count | Feature | Count |
|---|---|---|---|
| Traffic signals | 1,856 | Street lamps | 10,191 |
| Stop / give-way signs | 864 / 4,178 | Crossings (nodes and ways) | 32,985 |
| Kerb points | 5,310 | Bus stops / shelters | 3,666 / 1,199 |
| Power poles / towers / lines | 1,327 / 109 / 156 | Trees / tree rows | 37,810 / 837 |
| Barriers (fences, walls, hedges…) | 5,753 | Benches / bins / post boxes | 3,385 / 1,355 / 220 |
| Fire hydrants / bollards / bike racks | 392 / 351 / 1,047 | Traffic calming | 47 |
| Railway stations / level crossings | 52 / 0 | Sports pitches | 2,869 |
| Schools / places of worship (OSM) | 174 / 1 | Shops / fast food / fuel (OSM) | 16 / 0 / 11 |
| Bridges / tunnels (ways) | 1,917 / 154 | Roundabouts (`junction=roundabout`) | 0 |
| Railway lines / electrified | 780 / 26 | Car parks / parks | 10,293 / 975 |
| With `wikidata` / `wikipedia` | 87 | Tourism / historic | 644 |

### Brands

| | |
|---|---|
| OSM POIs with `brand` / `brand:wikidata` | 53 / 40 |
| Overture Places / confident (≥ 0.5) | 40,716 / 34,151 |
| …with a brand / a brand Wikidata id | 3,516 / 587 |
| …recognised by the name-suggestion-index (Wikidata id, or brand or name matched) | 2,429 |

Top brands by count:

- Australia Post 130
- TAB 105
- OTR 60
- Subway 46
- BP 55
- BWS 34
- Shell 30
- McDonald's 21 (+20 McCafé)
- Coles 21
- Hungry Jack's 20
- Domino's 18
- ALDI 18
- KFC 16
- IGA 14
- Bunnings 8
- Woolworths 10 (+12 mislabelled "Woolworths New Zealand")
- Ampol 10

Overture's brand field is sometimes wrong: "Ferrari of Alberta" at a West Terrace car dealer, "Woolworths New
Zealand". Matching must check the name-suggestion-index's location set, and gate on confidence.

What's lost in Overture's copy of OSM, and what replaces it:

- `junction=roundabout` → found by shape: a loop of one-way roads, short and round.
- `railway=level_crossing` → where a road crosses a railway at grade.
- `service=drive-through` → a service road wrapping a fast-food building.
- `sidewalk=*` → the separately mapped sidewalks; estimated by class where there are none.
- Shop, amenity and brand POIs, and station names → Overture Places.

## Terrain accuracy

**Map v4's source:** Copernicus GLO-30.

- 30 m, EGM2008.
- A digital *surface* model: it has the trees and roofs in it. Map v4 cut building footprints and road corridors out of
  it and refilled them from the ground round them.

**What's reachable from the bake environment:**

| Source | Resolution | Ground? | Coverage | Licence |
|---|---|---|---|---|
| Geoscience Australia, *DEM of Australia derived from LiDAR 5 m grid*, via AWS terrain tiles (`elevation-tiles-prod`, z14 GeoTIFF, EPSG:3857, AHD) | 5 m (3.9 m pixels) | bare earth | the Adelaide plains, part of the foothills | CC BY 4.0 |
| GA *SRTM-derived 1 Second DEM-S* (vegetation offsets removed, smoothed), via DEA's public bucket | 30 m | near bare earth (buildings still in) | everywhere | CC BY 4.0 |
| Copernicus GLO-30 | 30 m | surface model | everywhere | Copernicus DEM licence |
| SA Government 1 m LiDAR (ELVIS) | 1 m | bare earth | the plains and the hills | CC BY 4.0, ordered by email |

### Where the 5 m data is real

AWS's z14 tiles cover the whole region, but not all of it is 5 m data. A coarser source has been upsampled into the
hills.

- Upsampled data is straight between its posts: its second difference is zero inside each cell. In the tiles over the
  hills, more than half the pixels have a zero second difference. On the plains about 97% are non-zero.
- Where the LiDAR survey ends, there is a band about 200 m wide of blended data. It runs diagonally across the
  foothills, and there it is **up to 70 m too low**.
- At Belair Road's hairpins (-35.0006, 138.6071), the tiles say 157 m. Copernicus says 232 m, and DEM-S, an
  independent satellite model, says 224 m.

So the 5 m data can only be used where it has its own detail **and** agrees with both 30 m models at 30 m scale. That
rules out the band, and 0.9% of the land in all.

### Map v4's road heights against the 5 m LiDAR

Measured where it is valid: 1.1M road points, at every road point in the graph.

| | median | 95th percentile | max |
|---|---|---|---|
| Map v4 road − LiDAR | +0.97 m | 4.0 m | (the band) |
| Copernicus − LiDAR (under roads) | +0.96 m | 3.8 m | |
| DEM-S − LiDAR (under roads) | +3.84 m | 7.1 m | (buildings still in DEM-S) |

| Road | share on valid LiDAR | Map v4 − LiDAR: median / p95 / max |
|---|---|---|
| South Road | 100% | +0.69 / 2.2 / 6.6 m |
| North South Motorway | 100% | +0.67 / 2.3 / 6.7 m |
| Anzac Highway | 100% | +1.30 / 2.4 / 4.8 m |
| Port Road | 100% | +1.14 / 2.5 / 4.6 m |
| Portrush Road | 100% | +1.33 / 2.9 / 5.0 m |
| Unley Road | 100% | +1.74 / 3.2 / 5.0 m |
| Magill Road | 100% | +1.56 / 2.6 / 6.8 m |
| Glen Osmond Road | 100% | +1.88 / 7.8 / 10.2 m |
| Greenhill Road | 95% | +1.29 / 18.2 / 66.7 m (the band) |
| Belair Road | 68% | +1.81 / 53.1 / 71.9 m (the band) |
| South Eastern Freeway | 5% | +5.04 / 7.6 / 13.8 m (its bottom end only) |

The bias of about +1 m is Copernicus's: radar sees a little of what stands on the ground. The spread is its 30 m
resolution, and its trees in the River Torrens' linear park and its buildings in the city. The map of where
Copernicus is more than 5 m off the LiDAR is all trees and the CBD.

### The South Eastern Freeway

One carriageway, Glen Osmond to Crafers: 9.8 km, from 170 m to 513 m. The hills have no valid LiDAR, so the comparison
here is the road's own shape against what a freeway can be.

- Map v4's steepest grades:
  - 27.5% over 20 m and 14.0% over 100 m, at the Heysen Tunnels' western portal (-34.9724, 138.6764);
  - a change of grade of 39% within 20 m.
- The real freeway is graded at about 6–7%.
- The cause is the tunnel. Map v4 eases a tunnel straight between the heights where it leaves the ground. Those come
  from the DEM at the portal, which is the hillside above the cutting, about 50 m over the road at its highest. So the
  road climbs the hill to reach the portal.
- Copernicus and DEM-S along the freeway:
  - They agree with Map v4 to a few metres except over the tunnels (+40–50 m: the hill).
  - DEM-S is 5 m higher than Copernicus along the cuttings, which its smoothing fills.
  - Neither resolves the cuttings and embankments. Only LiDAR would.

## What each place is missing (Map v4, against its data)

Counts are what's mapped within 120 m of the spot (`coverageV5.ts --spots`). "Ignored" means Map v4 draws none of it.

- **Rundle Street (shopping):**
  - Ignored: 18 sidewalks, 29 crossings, 10 kerb points, 6 traffic signals, 21 benches, bins and bike racks, 11 trees,
    136 places (22 branded: Grill'd, Kathmandu, Macpac, Jetts…).
  - What's drawn: 55 buildings, all the same window grid on beige walls. Grass runs to the shopfronts, and a street
    sign stands on the grass.
  - It needs shopfronts with awnings and a sign band, footpaths, signals, and parody signage for the chains.
- **Alfred Street, Parkside (suburb):**
  - Ignored: 7 sidewalks, 16 crossings, 4 stop and give-way signs.
  - What's drawn: the street's single-storey villas, as two- and three-storey flat-roofed blocks with the same windows,
    on beige ground. No footpaths, verges, fences, front gardens or driveways.
  - It needs houses with hipped roofs (the region's default, estimated), verges with street trees, footpaths and front
    fences.
- **South Road Superway (interchange):**
  - Ignored: 11 lamps (estimated lamps are drawn), and no direction signs (no `destination` tags in the data).
  - It needs green guide signs where tagged (none here), route shields (`ref`), and the Superway's structure (Step 1d).
- **OTR, Unley (petrol):**
  - What's drawn: a plain box on grey paving. No canopy, pumps or price sign, and the OTR brand is unused (Overture has
    it).
  - It needs a petrol-station template: canopy, pumps, a pylon sign with a parody brand.
- **West Terrace (fast food):**
  - Ignored: McDonald's (Overture), 25 lamps, 12 sidewalks, 3 signals. The drive-thru lane isn't mapped as one (Overture
    dropped `service=drive-through`).
  - It needs the drive-thru template where a service road wraps the building, and a parody pylon.
- **Burnside Village (shopping centre):**
  - Ignored: 89 places (50 branded), 12 sidewalks, 26 trees.
  - What's drawn: the centre as one big beige box. The car park has no bay lines where none are mapped.
- **Adelaide High School:**
  - What's drawn: a plain box. The school's type is unused; it has no grounds or ovals.
- **Rymill Park:**
  - Ignored: 75 mapped trees are drawn, but 29 benches, bins and the playground aren't. The lake is drawn.
- **Adelaide Railway Station:**
  - Ignored: 10 railway features, 10 signals, 20 benches.
  - What's drawn: the station as a box, with no platforms, canopies or tracks drawn as railway. It is unnamed in the
    OSM data (Overture dropped its `name`).
- **Adelaide Oval:**
  - What's drawn: the stands as boxes. The oval isn't drawn as an oval: 2 pitches, ignored.
  - It is the region's most famous landmark and needs to be visible from far away.

## The Step 1 bugs: root causes

### 1a. Terrain and road elevation

1. **The source.**
   - Copernicus is a 30 m surface model: +0.97 m median over the real ground, more under trees and in the city.
   - The 5 m LiDAR plains data was never used.
2. **The smoothing goes across the road.** Map v4 opens the DEM (over `demOpen`, 12 m) and blurs it (over `demBlur`,
   10 m) in two dimensions. On a hillside that mixes in the ground above and below the road. That suits a surface
   model's noise, but not bare-earth LiDAR.
3. **One grade limit for every road.** The limit is `maxGrade` 30% (35% on the graph). A motorway can be as steep as
   a hill street, so a freeway climbs a hillside to a tunnel portal at 27.5%.
4. **Big junctions on one plane.**
   - Junctions closer than `minRibbon` chain into clusters up to 200 m across, each fitted with one plane.
   - At the windy route's start (Belair / Springbank Road, the owner's screenshot), cluster 32278 is 176 × 138 m on a
     5.9% plane.
   - The roads and small junctions round it, from Copernicus, climb at 12–14%. The LiDAR says 7–9%.
   - The fold where the plane meets them is the tilted slab in the screenshot.

### 1b. Road bends and merges

- `map/model/graph.ts densify()` curves each OSM **way** on its own, with Catmull–Rom tangents from each node's
  neighbours. At a way's first and last nodes there's no neighbour, so the tangent falls back to the straight line to
  the next node.
- Overture's copy of OSM splits roads into a separate way between every pair of junctions. So wherever two ways meet in
  a continuous curve, their end tangents disagree. That's a kink at every split, and the Hermite curves either side
  overshoot.
- On the windy route's first hairpin (-35.0001, 138.6113), segment 58036 turns 10° within 0.3 m (39°/m), next to a
  −2.1° turn: a zigzag. The segments either side turn 9–14° every 1–2 m.
- Second, a node turning more than `corner` degrees stays a sharp corner. A hairpin whose OSM nodes are a few metres
  apart turns that much at each node, so parts of real curves are drawn as corners.
- Merges are unions of overlapping ribbons, and nothing sets their taper length (measured in Step 11).

### 1c. Wheels flying off or cut off

These are four separate causes, all measured:

1. **Every road edge is an open step.**
   - The ground under and beside every road is set `terrain.sink` (8 cm) under it, so the road's collision trimesh
     ends in an open edge 8 cm over the ground.
   - A wheel coming back onto the road from the verge meets a sharp 8 cm step. The body can catch the edge, because
     Rapier's internal-edge fix covers internal edges, not a mesh's boundary.
   - Skirts hide this from view: they're drawn, not solid.
2. **Solid slabs beside the road (see 1h).** Street-side parking strips and car-park kerbs float up to 2 m over the
   ground along kerbs, and they're solid: a car at the road's edge hits them.
3. **Folds** where big junction planes meet steeper roads (1a.4), and decks up to 74% steep (1d). At speed these throw
   the car.
4. **Two road surfaces over one spot.** 0.45% of road triangles (Map v4's own test) have another surface within
   0.5 m over or under them. A wheel can meet the upper one's edge.

### 1d. Bridges and overpasses

- **How V4 solves a bridge.** It takes its height from where it meets the ground. The DEM there is the ground
  *beside* the road below, not an approach embankment, so on a short overpass both ends sit near the lower road's own
  level. Map v4 then lifts the deck by `overpassClearance` within the deck only, with its ends fixed, so the climb is
  squeezed into the deck.
- **Waverley Ridge Road over the freeway at Crafers** (the owner's screenshot):
  - Its two 47 m decks start at 557.0 m, the freeway's level, and reach 564.9 m within about 22 m: 69% at the
    steepest.
  - The west end sits about 12 m from the freeway's edge at the freeway's height. That's the deck coming down through
    the freeway's clearance.
- **Across the region:**
  - **117 of 352 decks are steeper than 8%, and 39 are steeper than 15%.** The worst is the North South Motorway at
    74%.
  - Of 311 bridge-over-road pairs, 42 have the deck *below* the road under it, and 132 more clear it by less than
    4.5 m. Examples: Mount Barker Road over the freeway (−1.0 m), North South Motorway over South Road (−0.5 m).
- **Chains end at junction clusters,** so a lift can't spread back along the approach roads or raise a ramp's junction.
- **Bridge decks don't sample the DEM** under them (they ease between their ends). The ends do.

### 1e. Tunnels

- Map v4 has no tunnel structure.
  - Where the ground over a tunnel is thicker than `tunnelCover` (5 m), the height grid is cut 1 m under the road, so
    the drawn terrain has a trench along the tunnel.
  - The natural ground is kept as a solid `cover` mesh over it.
- Inside, you drive in a trench whose sides are the hill's own terrain, rising to a roof that's the hill's top:
  50 m up in the Heysen Tunnels.
- There are no walls, ceiling or portals. The only lighting is estimated lamps at 24 m on the road's edge.
- The trench is cut into the drawn terrain, so the terrain over the tunnel is not intact.
- The road inside follows a straight line between the portal heights, which come from the hillside (1a.3).

### 1f. Roads read as grass

- The tyres' surface comes from `streamer.surfaceAt(x, z)`, which reads the tile's **2D surface raster**
  (`grids.surface`). It never looks at the collider the wheel actually hit.
- That raster comes from Map v3's tile builder and Map v3's narrower road widths. So Map v4's wider roads read as grass
  at their edges, and a bridge deck reads whatever lies under it.
- **In 72 central tiles, 35% of sampled road points (225,905 of 643,340) sit on a raster cell that isn't a road
  surface.** Physics, grip, tyre sounds and skid marks all follow it: hence grass skid marks on the road.
- Rapier 0.21 reports the triangle a ray hit (`featureId`), and Map v4's road meshes carry a surface per triangle. The
  information is there; it just isn't used.

### 1g. Signs in the road

- `map/bake/details.ts labels()` puts each junction's street-name sign at the node, plus 1.2 × (the widest half-width
  + 1.6 m), at 45° to the first named road.
- That direction comes from the segment's first two points even when the segment *ends* at the node. Nothing checks
  the spot against the road surface, the exclusion mask or the driving side.
- With Map v4's wider roads and big junction patches, **696 of 1,507 signs (46%) in the 72 central tiles stand on the
  road surface.**

### 1h. Floating pathways on buildings

- They're **`amenity=parking` + `parking=street_side`**: the on-street parking strips OSM maps along kerbs. Hill
  Street, Bowden, and Barton Terrace West are examples.
- Map v3's tile builder draws every car park on its own best-fitting plane, with 12 cm kerbs round it. That plane is
  fitted to the ground *before* Map v4 shapes the ground under the roads.
- The ground beside a road is then lowered under the road, so the strip, a metre or two wide and running along the
  kerb and the building fronts, is left floating.
- In the 72 central tiles, 6,018 triangles of the car-park mesh are more than 1.5 m over the ground with no road
  under them (up to 2 m), and 98 of the tunnel roof's. They are solid.

### 1i. Street lights too dim

- Map v4 draws lamps instanced with a glow, and a soft pool of light on the road under each one (`poolRadius` 8 m).
- Only the nearest 6 are real lights (`realLights`, intensity 160, range 32 m).
- Further than about 100 m away, a lamp lights nothing. The pools are faint, and narrower than a 4-lane road.

### 1j. Roundabout islands

- Overture's copy of OSM has no `junction=roundabout` at all, so Map v4 knows a roundabout only as a short loop of
  one-way roads (for the quick-travel spot).
- The island inside is whatever the ground's land use is (grass), with no kerb, no garden and no tree, and no data is
  used for it.
- Britannia Roundabout's island is grass, with lamps estimated round it.

## What only the owner can do

**The hills need LiDAR.**

- The SA Government's 1 m LiDAR covers the Adelaide Hills, including the whole South Eastern Freeway, the Heysen
  Tunnels and Belair Road.
- It is ordered through ELVIS (<https://elevation.fsdf.org.au>): pick an area, and a download link arrives by email.
  That host can't be reached from the bake environment, and the order needs an email address.
- To use it:
  1. Order the 1 m DEM tiles for the box -34.93 to -35.01 latitude, 138.60 to 138.72 longitude.
  2. Put the GeoTIFFs where the bake can fetch them, for example a release attachment on the repository. They are CC BY
     4.0, so they can be public.
  3. Map v5's elevation picks them up automatically as its best source (`data/map/regions/adelaide.json`
     `demV5.sources`, "ELVIS").
- Until then, Map v5 uses the best free data:
  - **the 5 m LiDAR on the plains**, where it is valid;
  - **Copernicus with its tree canopy capped by DEM-S** in the hills.
  - **Freeway-grade road profiles** keep the South Eastern Freeway's shape right even where the DEM is coarse.

## Map v5's plan, from this

1. **Elevation (1a):**
   - GA 5 m LiDAR where valid, blended into Copernicus capped by DEM-S.
   - Road profiles solved along the road only, with grade and vertical-curve limits by class.
   - Big junctions on a gently curved surface rather than one plane.
2. **Shape (1b):** tangents carried across a way's ends into the road that continues it; hairpins curved, not
   cornered; merge tapers measured.
3. **Joins (1c):**
   - Kerbs and footpaths close every road edge, at the road's own height or a kerb's.
   - The ground meets the cross-section's outer edge exactly.
   - No slab beside a road, and every join's vertices shared (as Map v4).
4. **Bridges (1d):** clearance as a constraint spread back along the approaches and through junctions within the
   approach grade, so embankments form. Decks never take a height from the ground under them.
5. **Tunnels (1e):** a tube (walls, ceiling, portals, lights, collision) with the hill left intact over it; the road
   inside on the freeway's grade.
6. **Surfaces (1f):** the surface of the triangle the wheel hit (road, footpath, car park, deck); the raster only for
   terrain.
7. **Signs (1g):** placed from the cross-section: on the footpath's outer edge or the verge, the driving side, facing
   the approach, outside every lane and the exclusion mask.
8. **Floating (1h):** street-side parking is part of the road's cross-section, at the road's height; car parks sit on
   the shaped ground; a check that nothing is over the ground without a structure under it.
9. **Lights (1i):** brighter, wider pools baked on the road and footpath per lamp, at the same draw-call cost.
10. **Roundabouts (1j):** the island from the ring's inner edge, with a raised kerb, bark mulch, low plants and a tree
    (the region style pack's design, estimated).
