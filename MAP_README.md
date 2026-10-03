# Map v3: the real world

The game's real-world map is a simple low-poly copy of a real region (here **San Francisco**: the city,
its hills, the Pacific coast, the Bay, the Golden Gate Bridge, the freeways). It's **baked offline** into
static files. The browser never asks Overpass for anything, never builds terrain and never extrudes
buildings. It loads tiles and draws them.

Everything you see, everything the car collides with, and the road graph used for navigation comes from
the same baked data. The drawn terrain is cut from the physics heightfield. The drawn road surface is the
road collider. The road graph's centre lines are the lines the road surface was built along. So they
always line up.

- In the game: **Real world** (the game opens on it). The label at the bottom left reads
  `Map v3 | tile x/y | DEM: <source> <resolution>`.
- The old maps are behind debug flags (both off by default): `?map=v2` runs the previous low-poly map,
  and `?photoreal=1` runs the Cesium one.
- **Tab**: the full map, with quick travel to the test spots (number keys, or click). **F3**: the
  performance overlay. **R**: back onto the nearest road.

## Step 0: what was there before, and why it changed

The previous map (v2, `tools/world/`, `world/`) worked and loaded in about 5 s. Measured against this
brief, it had these problems:

- **Seams.** Each tile was shaped on its own, so neighbouring tiles disagreed along their shared edge:
  steps up to **1.97 m**, with 287 edge points off by more than 5 cm.
- **Mixed vertical datums.** USGS LiDAR (NAVD88) and Copernicus (EGM2008) were used as they came. That's
  about 0.37 m apart in San Francisco. There was no blend where one source met the other, and Copernicus,
  a surface model with buildings and trees in it, was used raw.
- **Road geometry.** Roads ran in straight lines between OSM nodes, with no curves. Junctions were
  overlapping ribbons (z-fighting). There was no road graph and nothing was marked as estimated.
- **Projection.** A local Mercator rather than a transverse Mercator.
- **No GDAL, Osmium or Planetiler.** Elevation was sampled on the fly in JavaScript, which made the bake
  slow (about 30 minutes).
- **Plain JavaScript**, with the pipeline, the data format and the rendering mixed together.

Kept from v2, in TypeScript now: the tile codec (meshoptimizer + gzip), RTIN terrain cut in a Web Worker,
the railing collider design, the streamer (workers, IndexedDB cache, look-ahead, "Loading area" hold,
floating origin), the Overture reader, the PBF reader, the HUD, the MapLibre maps and the test harness.

## Modules

```
map/
  format/   the data format, shared: projection.ts (transverse Mercator), grid.ts (tile grid, height grid),
            tileFormat.ts (the .m3t tile), terrainMesh.ts (RTIN + skirts), barriers.ts (railing
            colliders), graph.ts (road graph), pmtiles.ts
  bake/     the offline pipeline (Node): bake.ts (the command), sources.ts (OSM extract, Osmium),
            osmBridge.ts (OSM from Overture when Geofabrik is unreachable), planetiler.yml (the vector
            map), osmData.ts, elevation.ts (GDAL), roads.ts, terrain.ts, buildingMerge.ts, extrude.ts,
            details.ts (railings, trees, names), tiles.ts
  render/   the game side (browser): streamer.ts, worker.ts, objects.ts (three.js), physics.ts (Rapier),
            maps.ts (MapLibre), game.ts (HUD, label, travel, overlay)
  build/    format + render compiled for the browser (npm run map:build)
```

## The pipeline

```
Geofabrik .osm.pbf ──osmium extract──▶ <region>.osm.pbf ──Planetiler──▶ map.pmtiles (minimap, full map)
  (or OSM rebuilt from Overture)              │
                                              ├──▶ roads: graph, curves, profiles, joined surface ─┐
Overture buildings ──────────────────────────────▶ buildings (OSM footprint wins)                  │
USGS 3DEP LiDAR DTM ─┐                                                                              ├──▶ tiles/*.m3t, far/*.m3t,
Copernicus GLO-30 ───┴─ GDAL: warp to the grid, → EGM2008, blend, DSM fix ──▶ heights ─▶ terrain ───┘   graph.json.gz, manifest.json
```

1. **OpenStreetMap.** The region's Geofabrik extract (`osm.extract` in the region file) is downloaded
   and clipped to the region with `osmium extract`. If Geofabrik can't be reached, the OSM data is
   rebuilt from Overture Maps instead (`map/bake/osmBridge.ts`). Overture's transportation and base
   themes are OpenStreetMap data with OSM's own coordinates and tags, and the source OSM way is recorded
   on each road. That file is written as a normal `.osm.pbf`, so the rest of the pipeline is the same.
   The manifest records which source was used.
2. **The vector map.** Planetiler, with `map/bake/planetiler.yml`, turns the extract into one PMTiles
   file (`map.pmtiles`). The minimap and the full map read it through range requests.
3. **Elevation (GDAL).** Each source is warped with `gdalwarp` onto the region's height grid (a point
   every 2 m), in the region's transverse Mercator. Heights go into **EGM2008** on the way, using PROJ's
   geoid grids (USGS NAVD88 via GEOID18). The shift used is logged and kept in the manifest.
   - Copernicus is a surface model, so the cells under building footprints and road corridors are cut
     out and filled again from the ground around them (`gdal_rasterize`, `gdal_fillnodata`).
   - LiDAR blends into Copernicus over `blendBand` m (`gdal_proximity` gives the distance inside the
     LiDAR area, `gdal_calc` blends), so there's no step where they meet. It doesn't blend at the
     shoreline, where there's nothing to blend into.
   - Heights are stored to the centimetre.
4. **Roads** (`map/bake/roads.ts`):
   - **Geometry.** OSM's drivable ways keep every node exactly where it is. Where a way bends gently
     between nodes far apart, points are added on a cubic through those nodes. Sharp corners stay corners.
   - **The graph.** Nodes where ways meet or end, segments between them, with name, class, lanes, one
     way, speed limit, width, bridge, tunnel and layer. Lanes and width are marked estimated when OSM
     doesn't say.
   - **Height profiles.** The elevation sampled along each way, spikes removed, then smoothed (still
     following real hills). Every junction has one height that all its roads meet. Bridge and tunnel
     decks run smoothly between the ground heights at their ends.
   - **Surface.** A ribbon per segment (crown, camber, edges skirted under the ground), cut back at
     junctions. Each junction, roundabout entry or fork is one fan of triangles joining the cut ends,
     each road's crown included. One joined surface: no overlaps, gaps or steps. Line markings run along
     the ribbons.
5. **Terrain** (`map/bake/terrain.ts`). This is one height grid for the whole region:
   - Water is flat at its level, with the ground kept below it.
   - Car parks and fuel stations are flattened to their best-fitting plane.
   - The ground under each road's corridor sits just below the road surface, then slopes back to the
     natural ground (cuttings and embankments). Junctions get the same treatment under their fan.
   - Under bridges the ground is not flattened; it's only kept clear of the deck.
   - Along OSM walls and fences, no lip of ground. A LiDAR DTM often keeps part of a thin wall as a
     ridge, and the strip between two carriageways keeps the ground the roads were cut down through. Near
     a wall, the ground is cut down to each side's own level, so a retaining wall's real step stays
     (`terrain.wallReach`, 3 m). Where a road runs along the low side, the step (as sharp as the 2 m grid
     allows) is put just behind the wall, not in front of it as a ramp. This only ever lowers the ground,
     and never on a road.
   - Tunnels: the grid is lowered under the tunnel, and the natural ground above is kept as a solid roof
     mesh.

   Tiles are cut from this one grid, so neighbours share their edge points exactly.
6. **Buildings** (`map/bake/buildingMerge.ts`). OSM footprints merged with Overture; where both have a
   building, the OSM footprint wins and Overture fills in height, floors, roof and colours. Each building's
   height comes from the best thing known: OSM tag, then Overture, then floors × 3 m, then the median of
   nearby known heights, then a default by type. The last two are marked estimated.
7. **Details** (`map/bake/details.ts`):
   - **Railings.** From OSM barrier tags, plus estimated ones (flagged in the data) on both sides of
     bridges, along motorway edges and medians, and beside steep drops in the elevation. Thresholds are in
     `data/map/bake.json`.
   - **Trees.** Mapped trees and tree rows, and woods and parks filled in, placed deterministically from
     feature ids.
   - **Street names** along roads, and signs at junctions.
8. **Tiles.** 512 m squares, each with a 257 × 257 heightfield (centimetres), terrain colours, tyre
   surfaces, the elevation source of each point, road/junction/car-park/water/building meshes, railing
   pieces, trees, labels, and road references for the HUD. Positions sit on one fixed 1 cm grid, so a
   point two tiles share is the same point in both. There's also a far layer (4 km chunks) for the
   horizon, with landmarks in full detail.

## Baking a region

Requirements: Node 22+, Java 21+, GDAL 3.x with its Python scripts, Osmium, and PROJ's geoid grids for
the region's datums. On Ubuntu:

```sh
sudo apt-get install gdal-bin python3-gdal osmium-tool proj-bin proj-data
# geoid grids (if your PROJ doesn't fetch them from cdn.proj.org): put us_nga_egm08_25.tif and the
# region's local geoid (e.g. us_noaa_g2018u0.tif for NAVD88) into .cache/map/proj/
# Planetiler 0.8.4 is downloaded into .cache/map/tools/ on first use
```

1. Copy `data/map/regions/sf.json` to `data/map/regions/<id>.json` and set:
   - `bbox`, `spawn`, and `spots` (quick travel; `"auto": "roundabout"` finds one in the data: a way
     tagged `junction=roundabout`, or else the roundest short loop of one-way roads, marked estimated)
   - `osm.extract`: a Geofabrik `.osm.pbf` URL
   - `overture.release`
   - `dem.sources`, best first. Each needs a `crs` with its vertical datum and a `licence`. Use bare-earth
     **DTMs** only: ELVIS (Australia, e.g. `EPSG:28356+5711`), USGS 3DEP (`EPSG:269xx+5703`),
     Environment Agency LiDAR (`EPSG:27700+5701`), LINZ (`EPSG:2193+7839`). Add `{"glo30": true}` for
     Copernicus everywhere else. Don't use FABDEM (its licence is non-commercial).
2. Bake:
   ```sh
   npm run map:bake -- --region <id> --area <lat>,<lon>,2   # a 2 km slice first (about 30 s)
   npm run map:bake -- --region <id>                        # the whole region
   ```
   The output, `assets/map/<id>/` (`manifest.json`, `map.pmtiles`, `graph.json.gz`, `tiles/`, `far/`), is
   plain static files. Any CDN that serves HTTP range requests (Cloudflare R2, S3, GitHub Pages) can host
   it.
3. Point a scene at it, as `scenes/map_v3.json` does, and list it in `scenes/worlds.json`.

Tuning lives in `data/map/bake.json` (road shape, terrain slopes, colours, railings, trees, building
heights). Performance targets live in `data/map/performance.json` and are shown by the F3 overlay.

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Roads, land use, water, railings, trees, places | © OpenStreetMap contributors (Geofabrik extract, or via Overture Maps) | ODbL 1.0 |
| Buildings (heights, floors, roofs; footprints OSM lacks) | © Overture Maps Foundation | ODbL 1.0 / CDLA Permissive 2.0 |
| Elevation, San Francisco | USGS 3D Elevation Program, 1 m LiDAR DTM (CA_SanFrancisco_B23) | Public domain |
| Elevation, elsewhere | Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA | Copernicus DEM licence |
| Geoid grids | PROJ-data (NOAA GEOID18, NGA EGM2008) | Public domain / open |
| Tools | Planetiler (Apache 2.0), GDAL (MIT), Osmium (GPL-3, run as a tool), meshoptimizer (MIT), Martini (ISC), MapLibre GL JS (BSD-3) | |

The game shows OpenStreetMap, Overture and each elevation source at the bottom right and on the full
map. The manifest lists them all (`attribution`, `sources`).

## Tests

```sh
npm run test:map                                # everything (needs the full region baked)
npm run test:map -- --only roads,height,seams   # some: roads height seams datum rails streaming determinism physics
npm run test:map -- --verbose                   # every measurement
node --test tests/map/unit.test.ts              # the format modules (fast)
npm run map:typecheck                           # TypeScript
```

- **roads**: every OSM node of every baked road, the baked centre line against OpenStreetMap's own
  coordinates (re-read from the extract when it's there). Target: under 0.5 m.
- **height**: 200 random road points. The drawn road, the physics surface and the smoothed elevation
  profile agree within 0.1 m.
- **seams**: every pair of neighbouring tiles. Physics edges are identical; drawn edges meet within the
  terrain mesh's error and are skirted.
- **datum**: no step where LiDAR meets Copernicus. The change in slope across the boundary is compared
  with the ground round about; real cliffs kink too, so the test compares the whole spread, and a step
  would fatten its tail. Also, once both sources are in EGM2008, they agree on open ground: the peak of
  Copernicus − LiDAR sits at 0. Copernicus is a surface model, so its roofs and trees only ever add to
  the right of that peak.
- **rails**: a guard rail, a bridge parapet, a wall, a retaining wall and a fence, each hit at 50, 100,
  200 and 300 km/h at 15° and 60°, from a road beside it, with the car starting clear of anything else.
  Never through, and every hit reaches the damage model.
- **streaming**: 20 km at 200 km/h with the game's own streamer over a modest network. The ground is
  always ready.
- **memory**: the same drive, past 100 tiles. Memory stays level.
- **determinism**: a small area baked twice gives byte-identical tiles, far layer and graph. This needs
  the bake's inputs in `.cache/map`.
- **physics**: the Phase 1 straight-line tests (0–100, quarter mile, 100–0, the same at any frame rate)
  on the longest straight baked road.

## The San Francisco bake (results)

- **Size:** 900 tiles of 512 m (15.4 km square), 106 MB of tiles plus a 6.3 MB road graph, an 8.8 MB vector
  map and a 16-chunk far layer: 119 MB in all, static files.
- **Bake time:** about 4 minutes on 4 cores once the sources are downloaded, 2½ when the elevation is cached
  from an earlier bake. A 2 km slice takes about 30 s.
- **Contents:** 42,465 road segments (20,238 junctions), 171,540 buildings (170,058 OSM footprints, 1,482
  from Overture only; 8,485 with estimated heights), 123,955 railing pieces, 117,263 trees and 1,230 car
  parks.
- **Quick travel:** Financial District, Outer Sunset, Twin Peaks Boulevard, Great Highway, Central
  Freeway / US-101, Golden Gate Bridge, Broadway Tunnel, Stonestown Galleria (the big car park), and a
  roundabout in the Presidio (estimated).
- **Tests (`npm run test:map`): 18 of 18 pass.**
  - The baked centre lines are within 0.7 cm of OpenStreetMap.
  - The drawn road is within 1.1 cm of the elevation profile, and physics within 9.6 cm.
  - Tile seams are identical in physics.
  - At the LiDAR/Copernicus boundary the median change in slope is 5 cm, against 3 cm round about. The
    datum check peaks at 0.0 m.
  - The railings (guard rail, parapet, wall, retaining wall, fence) are never broken through at
    50–300 km/h.
  - Streaming: 20 km at 200 km/h with the ground always ready. Over 304 tiles the heap grows by 25 MB.
  - Two bakes come out byte-identical.
  - The Phase 1 physics tests pass on the Great Highway.
- **In the browser:** drivable about 5 s after the page opens, with software rendering on the build
  machine.

## Notes

- **Browser tile cache.** The game keeps tiles in IndexedDB under the manifest's `version`. That is the
  bake's inputs plus a hash of every tile it wrote, so any re-bake that changes a tile (new data, or new
  bake code with the same data) replaces the cached copies on the next visit.

- **Where the data came from in this bake.** Geofabrik, the OSM planet mirrors and Overpass couldn't be
  reached from the machine it was baked on, so the San Francisco bake's OSM data came from Overture's
  copy of OpenStreetMap (`sources.osm.source: "overture"` in the manifest). With network access to
  Geofabrik, the same command uses the real extract with no other changes.
- **Map label font.** MapLibre's label font comes from `demotiles.maplibre.org`. When that's
  unreachable, it draws the labels with a local font instead.
