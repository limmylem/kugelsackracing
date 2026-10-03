# The real world (low-poly v2)

The game's real-world map is a low-poly copy of a real region, **baked offline** into small static
tiles. The browser downloads tiles and draws them. It doesn't ask Overpass for data, build terrain or
extrude buildings while you drive. Each tile file holds both what's drawn and what's collided with, and
both come from the same arrays: the terrain mesh is cut from the physics heightfield, and the road mesh
*is* the road collider. Visuals and physics can't drift apart.

The test region is **San Francisco**: the city, Twin Peaks and the hills, the Pacific coast, the Bay
and the Golden Gate Bridge.

- In the game: pick **Real world** (the game opens on it). A small label at the bottom left reads
  `World: low-poly v2 (tile x/y) · DEM …`, so you can always confirm which world is running.
- The old photorealistic Cesium map is still there behind a debug flag (off by default): open the game
  with `?photoreal=1`.

## Controls in the real world

| Key | |
|---|---|
| **Tab** | Full map, with quick travel to the test spots (click one or press 1–8; Shift-click the map to go anywhere) |
| **F3** | Performance overlay: time to drivable, tile load time, frame time, draw calls and memory, each against its target |
| **R** | Back onto the nearest named road |

The HUD under the minimap shows the road you're on, the neighbourhood and city, and your compass heading.

---

## How it fits together

```
 Overture Maps (S3 GeoParquet: buildings + OSM-derived roads,       ┐
   land use, water, barriers, places)                               │
 or an OpenStreetMap extract (.osm.pbf, e.g. Geofabrik)             ├─▶ tools/world/features.mjs ─┬─▶ tools/world/build.mjs ─▶ assets/world/<region>.pmtiles
 data/world/overrides/<region> (hand fixes)                         ┘    (one feature list,       │      (the vector map: minimap, full map)
                                                                          world/schema.js fields)  │
 Elevation: local LiDAR DEMs (USGS 3DEP 1 m here) + Copernicus GLO-30 ─────────────────────────────┴─▶ tools/world/bake.mjs ─▶ assets/world/<region>/
                                                                                                         (tiles/<i>_<j>.dwt, far_<a>_<b>.dwt, manifest.json)

 game: world/streamer.js ── Web Workers (world/tileWorker.js: fetch / IndexedDB, decode, cut terrain)
          ├─ world/tileObjects.js   what's drawn (three.js)
          ├─ world/tilePhysics.js   what's collided with (Rapier): heightfield, trimeshes, hulls, boxes
          └─ testtrack/realWorld.js the game side: spawn, "Loading area" hold, HUD, maps (world/worldMap.js)
```

### The tiles

The region is cut into a fixed grid of **512 m tiles** in a flat frame centred on the region
(`world/projection.js`: x east, z south, y up, metres). Each tile is one `.dwt` file
(`world/tileFormat.js`: a JSON header plus meshoptimizer-compressed buffers, gzipped), holding:

| | Drawn as | Collided as |
|---|---|---|
| Terrain: heights every 2 m, to the centimetre, plus a colour per point (land use, rock, beach, under water) | RTIN (Martini) meshes at 3 levels of detail, cut in the worker from the same heights | Rapier **heightfield** |
| Roads (width from lanes/type, camber, kerbs, skirts), car parks, footpaths, tunnel roofs | meshes with line markings and bay lines | **trimeshes** (the same arrays) |
| Buildings (Overture height/floors/roof/colours + OSM tags) | walls by window style, roofs (flat, gabled, hipped, pyramidal, skillion, dome) | **convex hulls** of the footprint |
| Railings, walls, fences, hedges (OSM + auto on bridges, motorways, drops) | instanced rails and posts | chained **boxes**: ≥0.35 m thick, taller than drawn, overlapping at joints |
| Trees, street-name labels, junction signs | instances, painted labels, sign posts | tree trunks as cylinders |
| Tyre surface every 2 m (tarmac, concrete, cobbles, gravel, grass, sand…) | | the tyres' grip |

**Far layer:** 4 km chunks of the whole region (16 m terrain, tall buildings as blocks, landmarks
in full), drawn to the horizon wherever detailed tiles haven't loaded yet.

**Landmarks** (≥70 m tall, or churches, stadiums, towers and similar over 400 m²) are kept in full
detail at every distance, so you can steer by them.

### Terrain accuracy

- Heights come straight from the elevation data. The baker uses a region's own LiDAR first (here
  USGS 3DEP 1 m), then Copernicus GLO-30 (30 m) everywhere else. The debug label shows which DEM and
  resolution the current tile used.
- Under roads, the ground follows the road's own smoothed profile, sitting 7 cm below the road surface,
  then blends back to the natural ground as cuttings and embankments. Car parks, fuel stations and
  driveways are flattened to a fitted plane.
- Under bridges the ground stays natural (kept clear below the deck). Tunnels run through the hill, which
  keeps its surface as the tunnel roof. Layered roads and interchanges stay separate.
- Water is flat: the sea at sea level, lakes at their shore level.

### Streaming

- Tiles load nearest first, plus a look-ahead along the car's velocity (4 s ahead). Physics for a tile
  is added a few milliseconds per frame, before the car can reach it (750 m, plus 2 m per m/s of speed).
- The spawn tile and its neighbours come first. The car is held until the ground under it is solid, then
  put down on the nearest named road. If loading ever falls behind the car, the world pauses with a short
  **"Loading area"** note instead of dropping the car.
- Decoding happens in Web Workers. Tiles are cached in IndexedDB under the bake's version, so a new bake
  replaces old copies.
- Floating origin (Phase 1 Step 7): the physics origin jumps a whole tile at a time to stay near the car.
- Levels of detail: terrain level 0 within 650 m, then 1 and 2, then the far layer. Roads and paths are
  drawn within 1.4 km, buildings within 3 km, trees within 700 m, rails within 900 m, labels within 360 m.
- Performance targets live in `data/world/performance.json`, and the F3 overlay checks against them.

---

## Baking a new region

You need Node 20+ and internet access to `overturemaps-us-west-2.s3.amazonaws.com` (map data) and the
elevation hosts (`copernicus-dem-30m.s3.amazonaws.com`, plus your LiDAR source). No accounts are needed.

1. **Describe the region.** Copy `data/world/regions/sf.json` to `data/world/regions/<id>.json` and set:
   - `id`, `name`, `bbox` (`[west, south, east, north]`, degrees), `spawn` (`lat`, `lon`, `bearing`, a road name)
   - `sources.overture.release` (an Overture release, or `"latest"`)
   - `sources.osm` (optional): an `.osm.pbf` extract for the region, e.g. from
     [Geofabrik](https://download.geofabrik.de/) or cut with `osmium extract -b w,s,e,n`. With it, roads,
     land use, water and details come straight from OSM with all their tags. Without it, they come from
     Overture's OSM-derived data, which keeps the OSM tags the game uses.
   - `dem.local`: high-resolution elevation files that cover the region, best first. Each entry has a name,
     resolution, attribution and files (URLs or local paths to GeoTIFFs in UTM or geographic coordinates).
     For example: **USGS 3DEP** 1 m (US), the **Environment Agency** 1 m LiDAR (England), **LINZ** 1 m
     (New Zealand), **ELVIS** 1 m / 5 m (Australia). `dem.base: "glo30"` fills everything else from
     Copernicus GLO-30.
   - `spots`: the quick-travel places (one each: dense city, suburb, mountain road with rails, coast,
     highway interchange, bridge, tunnel, big car park). The tests use them.
2. **Build the vector map** (minimap, full map and the baker's features):
   ```sh
   npm run world:build -- --region <id>
   ```
3. **Bake the tiles:**
   ```sh
   npm run world:bake -- --region <id>                         # everything (resumable: finished tiles are kept)
   npm run world:bake -- --region <id> --area lat,lon,2        # just 2 km round a place (a first slice)
   npm run world:bake -- --region <id> --force                 # bake every tile again
   npm run world:bake -- --region <id> --no-far                # skip the far layer
   ```
   Downloads (Overture parts, DEM files) are cached in `.cache/world/`. San Francisco (817 tiles, about
   15 × 15 km) takes about half an hour on 4 cores.
4. **Point the game at it:** add a scene like `scenes/real_world.json` with
   `"streamed": { "manifest": "assets/world/<id>/manifest.json" }` and list it in `scenes/worlds.json`.
5. **Run the tests** (below) and commit the output folder. `assets/world/<id>/` is plain static files
   that any CDN or static host can serve. Tile URLs are relative to the manifest.

Tuning lives in `data/world/bake.json`: tile size, terrain detail, colours, road and kerb dimensions,
railing types and the thresholds for auto railings (bridges, motorways, drops), tree density, building
heights, palettes and landmarks. Bump its `version` after changing it, so the next bake redoes every
tile and the game's cache drops the old ones.

## Data sources and attribution

| Data | Source | Licence |
|---|---|---|
| Roads, land use, water, barriers, trees, places | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (directly, or via Overture) | ODbL |
| Buildings, neighbourhoods | © [Overture Maps Foundation](https://overturemaps.org) | ODbL / CDLA Permissive 2.0 |
| Elevation (San Francisco) | USGS 3D Elevation Program, 1 m LiDAR (CA_SanFrancisco_B23) | public domain |
| Elevation (everywhere) | Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA | Copernicus licence |
| Map rendering | [MapLibre GL JS](https://maplibre.org) (BSD-3), loaded from jsDelivr | |
| Mesh tools | meshoptimizer (MIT), @mapbox/martini (ISC; vendored in `world/vendor/`) | |

The game shows this attribution at the bottom right of the real world and on the full map. The manifest
carries the full list.

## Tests

```sh
npm run test:world                         # all of the world's tests (a few minutes)
npm run test:world -- --only rails,height  # some: height, rails, streaming (+ memory), physics
npm run test:world -- --verbose            # every measurement
node --test tests/unit/worldTiles.test.mjs # the tile format, terrain cutting, railing colliders
```

They run headless on the baked tiles, which are decoded and collided with exactly as the game does it:

- **height**: at every test spot, 20 random points on the roads. The physics surface must match the drawn
  road within 0.1 m, the drawn ground must sit just under the road (never through it, never far below), and
  a car put down there must settle on four tyres, each on the drawn surface. Each point's difference from
  the raw elevation data is reported.
- **rails**: a guard rail, a bridge parapet, a wall, a retaining wall and a fence, each hit from the road
  side at 50, 100, 200 and 300 km/h, at 15° and 60°. No car may end up through one, and every hit must
  reach the Phase 3 damage model.
- **streaming**: a 20 km route through the region at 200 km/h, using the game's own streamer, with tiles
  arriving as slowly as `data/world/performance.json`'s network allows. The ground under the car must
  always be ready.
- **memory**: the same drive, past 100+ tiles loaded and dropped. The heap and collider count must stay level.
- **physics**: the Phase 1 test suite's straight-line tests (0–100, quarter mile, 100–0, the same at any
  frame rate), run on the Great Highway against the car's targets.

## Notes

- **Why no Planetiler/Geofabrik in the default pipeline:** this environment can't reach Geofabrik,
  GitHub releases or the OSM mirrors. The map therefore comes from Overture Maps, whose transportation
  and base themes are OpenStreetMap data carrying the OSM tags the game uses, merged with Overture
  buildings. The pipeline also reads an `.osm.pbf` extract directly when you give it one
  (`sources.osm`). Its output is the same PMTiles file Planetiler would produce for this schema, so you
  can swap Planetiler in for `tools/world/build.mjs` if you prefer.
- Earlier map pipeline details (schema, overrides, the PMTiles file): `docs/WORLD_DATA.md`.
