# Map v4: the real world

The game's real-world maps are simple low-poly copies of real regions: **Adelaide** (the city, the coast, the
Adelaide Hills), **San Francisco** (the hills, the Pacific coast, the Bay, the Golden Gate Bridge, the freeways) and
a few smaller ones. Each is **baked offline** into static files. The browser never asks Overpass for anything,
never builds terrain and never extrudes buildings. It loads tiles and draws them.

**Map v4** (Adelaide) rebuilds everything about the roads from **one road surface model** (`map/model/`). The model
is made at bake time and is the only description of a road. These all come from it, and nothing else works roads
out again:

- the drawn road and its markings;
- the ground shaped under it;
- the road colliders;
- the exclusion mask that keeps trees and props off roads;
- the railings and the street lamps;
- the navigation graph.

Map v4 keeps Map v3's pipeline where it worked: the OSM extract, the vector map, the elevation and datums, the
buildings, the tile format and the streamer. Why it changed is in [MAP_V4_DIAGNOSIS.md](MAP_V4_DIAGNOSIS.md). What it
fixed, with numbers and before/after pictures, is in [MAP_V4_REPORT.md](MAP_V4_REPORT.md).

Everything you see, everything the car collides with, and the road graph used for navigation come from the same
baked data:

- The drawn terrain is cut from the physics heightfield.
- The road collider is the drawn road surface.
- Every other collider has something drawn where it is, and the bake checks that for every tile.

So they always line up.

- **In the game:** **Real world** (the game opens on it). The label at the bottom left reads
  `Map v4 | tile x/y | DEM: <source> <resolution> | roads: <model version>` in a Map v4 region, and
  `Map v3 | tile x/y | DEM: …` in the others.
- **The old maps** are behind debug flags, all off by default:
  - `?map=v3` loads Adelaide's Map v3 bake, for comparing. `localStorage` `map.version` = `v3` does the same.
  - `?map=v2` runs the low-poly map before that.
  - `?photoreal=1` runs the Cesium one.
- **Keys:**
  - **Tab**: the full map, with quick travel to the test spots (number keys, or click).
  - **F3**: the performance overlay.
  - **R**: back onto the nearest road.
  - **Shift+F3, Shift+F6, Shift+F4, Shift+F2**: the debug views, time of day and bad spots ([Debug views and bad spots](#debug-views-and-bad-spots)).

## Map v3's Step 0: what was there before (Map v2), and why it changed

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
  format/     the data format, shared by the bake and the game: projection.ts (transverse Mercator), grid.ts (tile
              grid, height grid), tileFormat.ts (the .m3t tile), terrainMesh.ts (RTIN + skirts; v4: cut under roads
              from lowered heights), barriers.ts (railing colliders), graph.ts (road graph), pmtiles.ts
  model/      Map v4's road surface model (built at bake time, the one description of every road):
              index.ts (buildRoadModel), graph.ts (OSM ways → planar graph), widths.ts, topology.ts (joints,
              junctions, trims, clusters, patch outlines), heights.ts (profiles, junction planes, chains, bridges),
              surface.ts (the mesh), geom.ts (cross-sections), mask.ts (exclusion mask, road-surface index),
              props.ts (trees, railings), lamps.ts (street lamps), checks.ts (cracks, overlaps, folds)
  collision/  Map v4's colliders against what's drawn: buildings.ts (building hulls cut off roads), audit.ts
              (every collider has something drawn there)
  bake/       the offline pipeline (Node):
              bake.ts (Map v3's command), sources.ts (OSM extract, Osmium), osmBridge.ts (OSM from Overture when
              Geofabrik is unreachable), planetiler.yml (the vector map), osmData.ts, elevation.ts (GDAL), roads.ts,
              terrain.ts, buildingMerge.ts, extrude.ts, details.ts (railings, trees, names), tiles.ts
              bakeV4.ts (Map v4's command), terrainV4.ts (the ground under and round the roads), tilesV4.ts (v4
              tiles), clip.ts (the surface cut at tile borders), encodePool.ts + encodeWorker.ts (tiles encoded on
              every core)
  render/     the game side (browser): streamer.ts, worker.ts, objects.ts (three.js), physics.ts (Rapier),
              lamps.ts (street lamps, the nearest few as real lights), maps.ts (MapLibre), game.ts (HUD, label,
              travel, overlay), debug.ts (debug views, bad spots)
  debug/      tools for looking: diagnoseV3.ts (Map v4 Step 0's measurements), modelSlice.ts (the model for a small
              area, top down, to a PNG, without a bake), tileHeights.ts (a baked road surface coloured by height),
              plot.ts
  build/      format + render compiled for the browser (npm run map:build)
```

## The pipeline (Map v3's, kept by Map v4)

Map v4 keeps this pipeline for the OSM extract, the vector map, the elevation, the buildings and the tiles. Everything about roads in steps 4, 5, 7 and 8 is replaced by the road surface model ([below](#the-road-surface-model-map-v4)). Map v3's bakes (San Francisco and the other regions, and Adelaide's v3 bake for `?map=v3`) are still made this way.

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
   - **Width for the game.** Every road is drawn wider than its real width (`roads.widthScale`, 1.4×,
     at least `roads.minWidth`, 5 m), so it's easier to stay on. The centre line stays exactly
     OpenStreetMap's; the graph's `width` is the drawn width.
   - **Roads that meet.** Overture's copy of OSM loses some junction nodes, so roads that meet didn't
     always join.
     - Nodes within 0.5 m of each other become one. This covers a road's end and its continuation,
       including onto a bridge, and an end on another road's shape point at the same layer.
     - A loose end lying on another road (within `roads.joinOnto`, 1 m, of its edge), or stopping short
       of it and pointing at it (within `roads.joinPointing`, 6 m), is joined to it. A node is put into
       the other road there.
     - Only the same layer and structure are joined this way, so a road under a viaduct stays under it.
       A road running alongside another is left alone. The bake log counts each kind of join.
   - **One copy of each road.** Overture can carry an OSM way twice (one copy with its level, one
     without), which baked as two decks one over the other. The same geometry, and two segments between
     the same junctions of the same length, are kept once (the copy that knows its layer).
   - **Height profiles.** The elevation sampled along each way, spikes removed, then smoothed (still
     following real hills). Every junction has one height that all its roads meet, and no road between
     two junctions is steeper than `roads.maxGrade` (35%; junctions a few metres apart on roads at
     different levels are drawn together). Bridge and tunnel decks run smoothly between the ground
     heights at their ends, and are smoothed along their whole length.
   - **Roads side by side** whose drawn surfaces overlap (a slip road running in, a bridge's end beside
     the road it comes down to) get the greater road's height there, eased over 30 m: no kerb between
     them. Not a tunnel under a road, and not one road crossing over another.
   - **Bridges over roads** are raised to clear what's under them (`roads.overpassClearance`, 5.2 m),
     eased to their own ends, no steeper than 15%.
   - **Surface.** A ribbon per segment (crown, camber, edges skirted under the ground), cut back at
     junctions. Each junction, roundabout entry or fork is one fan of triangles joining the cut ends,
     each road's crown included. One joined surface: no overlaps, gaps or steps. Line markings run along
     the ribbons.
5. **Terrain** (`map/bake/terrain.ts`). This is one height grid for the whole region:
   - Water is flat at its level, with the ground kept below it.
   - Car parks and fuel stations are flattened to their best-fitting plane.
   - The ground under each road's corridor sits just below the road surface, then slopes back to the
     natural ground (cuttings and embankments). Junctions get the same treatment under their fan.
   - Under bridges the ground is not flattened; it's only kept clear of the deck — by up to 5 m away from
     its ends, as a surface model (Copernicus) often has the deck as ground. A junction on a bridge
     shapes nothing on the ground.
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
     `data/map/bake.json`. None stands on a road's drawn surface: a fence mapped across a street, a
     parapet where another road merges, a wall the wider drawn road now covers.
   - **Trees.** Mapped trees and tree rows, and woods and parks filled in, placed deterministically from
     feature ids. None within a drawn road's width and a metre.
   - **Buildings and roads.** A building a road runs through (a passage, a covered street) is solid only
     from the road's clearance up; a footprint's corner standing on a drawn road is moved back to its
     edge.
   - **Street names** along roads, and signs at junctions.
8. **Tiles.** 512 m squares, each with a 257 × 257 heightfield (centimetres), terrain colours, tyre
   surfaces, the elevation source of each point, road/junction/car-park/water/building meshes, railing
   pieces, trees, labels, and road references for the HUD. Positions sit on one fixed 1 cm grid, so a
   point two tiles share is the same point in both. There's also a far layer (4 km chunks) for the
   horizon, with landmarks in full detail.

## The road surface model (Map v4)

`map/model/`, with every width, spacing, threshold and tolerance in `data/map/v4.json` (its `_note`s say what each
one does). The steps run in order, and each uses only what the steps before it made:

1. **The graph** (`graph.ts`).
   - OSM's drivable ways become a planar graph. There's a node at every intersection, every end, every change of
     layer or structure, and every crossing of a tile border.
   - Each segment keeps OSM's own point sequence: every OSM node stays exactly where OSM has it.
   - Curve points are added where a way bends, set by how far it turns (at most `maxTurnPerPoint` degrees between
     two points), so a tight bend gets more points and never folds.
   - Kept from Map v3: the joining of roads Overture's copy of OSM left unjoined, and one copy of a road given
     twice. A loose end now joins onto the other road's real drawn width.
   - **Never invented or simplified:** no road is added, and no OSM node is moved or dropped.
2. **Widths** (`widths.ts`).
   - Each road's **drivable** width is the OSM `width` tag when there is one. Otherwise it's the `lanes` tag × the lane
     width plus both shoulders. Otherwise it's the class's lanes from the table, counted **per direction** on a
     one-way carriageway (Map v3 gave each carriageway of a divided road one lane).
   - The **visual** width is the drivable width plus a kerb band each side.
   - Lanes and widths OSM doesn't give are marked **estimated** in the data.
   - Two roads side by side that don't meet there (the carriageways of a divided road, a service road beside a
     street) are narrowed on the sides facing each other, so the real median stays. It's never filled in. The
     narrowing eases along the road and is marked **adjusted**.
3. **Junctions** (`topology.ts`).
   - A node where two roads meet end to end, nearly straight and nearly the same width, is a **joint**: one
     cross-section shared by both. Every tile-border node is one too.
   - Anything else with more than one road is a **junction**. Each road there (an arm) is trimmed back to where its
     edges meet its neighbours', plus the kerb's corner round. One rule covers T-, Y-, acute, 5-way and fork
     junctions.
   - Junctions whose trims would leave less than `minRibbon` m of road between them become one **cluster** with one
     **patch**: the two carriageways of a divided road crossing another, a slip road's fork, a roundabout's entries.
   - A patch's outline is the union of its arms' ends and its core (Clipper2). Sliver holes are filled; islands and
     medians are kept. It is cut into triangles with libtess.
4. **Heights** (`heights.ts`), solved on the graph from the elevation, after it's been **opened** over `demOpen` m and
   blurred over `demBlur` m. The opening cuts off what's left of buildings and trees in a surface model.
   - Each way's elevation profile has its spikes taken out, then is smoothed. It still follows the real hills.
   - Bridge and tunnel nodes take their heights from the ground nodes the structure is anchored to.
   - Each cluster gets a **plane**: a least-squares fit through where its roads reach it, no steeper than
     `junctionMaxSlope`.
   - Neighbouring planes are relaxed towards each other (their heights, not their tilt):
     - **A short road between two planes** (shorter than two eases) must rise as the planes' own slopes along it do,
       to within what a curve bending no faster than `maxGradeChange` can make up over its length. So the two planes
       meet in one smooth curve, with no hump. Without this, the 10 m of Flinders Street between two big patches had
       to climb 0.5 m between two nearly level planes: 41 m/s² at 150 km/h, now 18.
     - **A longer road** may be no steeper than `planeGrade`.
     - Each round moves the planes by half what's missing, so where two roads between the same junctions ask for
       different things, the planes settle between them.
   - Each chain of road between junctions or ends is bent to meet the planes at its two ends, then held to
     `maxGrade` and to `maxGradeChange` (no crest that throws a car).
   - Bridges ease straight between their ends and are lifted `overpassClearance` over what they cross. Tunnels are
     lowered the same way.
   - A road eases from its own profile and camber onto a junction's plane over `armEase` m, so its trimmed end lies
     exactly on the plane, flat across.
   - **Vertical curves.** What's drawn is each chain's solved profile averaged over `drawnSmooth` m either side and
     sampled every `drawnStep` m. A profile is straight between its points, which can be 12 m apart on a straight
     road, so every change of grade at a point is a kink. Averaged, each change becomes a curve 12 m long, as roads
     are built. The averaging stops short of each trim, so a junction's plane is met exactly. The surface gets extra
     rows only where the grade changes (`curveRows`). Where Adelaide Bridge meets the ground: 14 m/s² at 150 km/h
     before, 7 after.
5. **The surface** (`surface.ts`).
   - Every road is a ribbon of 5-point cross-sections: visual edge, drivable edge (the kerb band between them),
     crown, and the same on the other side. The camber is `camber` (`camberOneWay` on a one-way carriageway).
   - Rows sit closer together near a trim (`easeRows`), so the ease onto the plane is smooth.
   - Each patch shares its ribbons' end vertices exactly, so there are no overlaps, gaps or steps.
   - Skirts (drawn, not solid) hang under the edges. Bridges get deck sides, and dead ends get a short cap.
   - Markings: centre, lane and edge lines by class in the region's style (Australian here), plus zebra crossings
     and stop lines where OSM maps them. They're one vertex-coloured mesh just over the surface.
   - Every vertex is put on the tiles' 1 cm grid **before** T-junctions are closed (where a vertex lies on another
     triangle's edge, that edge is split). Closed cracks stay closed in the tiles.
   - The drawn heights are written back into the graph, so navigation, lamps and tests use the heights you drive on.
6. **The ground** (`map/bake/terrainV4.ts`), in the region's one height grid, so the drawn terrain and the physics'
   heightfield still match.
   - Every grid point under a road triangle is set `sink` m under the road surface there.
   - Every point within `margin` m of a road (at least a grid cell's diagonal) is set `sink` m under the **lowest**
     road surface within that margin. So no terrain triangle touching a road can rise into it.
   - "The road surface" here counts the road's own vertices as well as the grid points under it. On a steep crossfall
     the kerb's edge can be lower than any grid point under the road, and the ground there stood a few centimetres
     over it.
   - Beyond that, the ground slopes back to the natural ground: cuttings and embankments.
   - Under bridges the ground is kept `bridgeClearance` under the deck (more away from its ends). Over tunnels, the
     natural ground stays as a roof.
   - The terrain's simplified (far) meshes are cut from heights lowered under and beside roads by their own error
     plus `lodRoadDrop`, so the ground can't come up through a road at any distance. Tile-border points are never
     lowered, so seams still match. The physics keeps the grid as it is.
7. **Collision** (`map/bake/tilesV4.ts`, `map/collision/`):
   - **Roads:** each tile's solid road triangles plus `apron` m of its neighbours' are welded into one trimesh with
     Rapier's internal-edge fix, so there's no edge at a border for a wheel to catch on. The collider *is* the drawn
     surface.
   - **Buildings:** a building's collider reaching over a road surface at the road's height is cut back off it
     (`roadClearance`), or dropped if too little is left. Car parks are cut off roads the same way.
   - **The audit** (`audit.ts`): every collider in every tile must have something drawn where it is. That's the
     heightfield, the road surface within 2 cm, a roof, a railing the tile draws, or a trunk at a tree it draws. The
     bake fails if any doesn't.
8. **What stands beside the road** (`mask.ts`, `props.ts`, `lamps.ts`):
   - **The exclusion mask** is a 1 m raster, baked into each tile so it can be looked at. It marks every road
     surface on every layer plus a buffer, the ground under every bridge deck, railways and tunnel portals.
   - **Trees** are placed only where nothing masked lies under their **crown** (Map v3 checked only the trunk
     against the centre line).
   - **Railings:** each OSM barrier piece is tested along its whole length and its collider's thickness. Estimated
     railings (flagged) go along both sides of bridge decks, motorway edges and steep drops, chained with no gaps.
   - **Street lamps** — OSM's mapped lamps first, then estimated ones (flagged) on lit roads:
     - Lit roads are `lit=yes`, the `alwaysLitClasses` everywhere, and other urban classes in built-up areas;
       never `lit=no`.
     - Spacing is by kind: `spacing.urban`, `motorway`, `tunnel`. They stand at the kerb, staggered on both sides of
       wide roads.
     - There's one at a corner of every lit junction and two at each mapped crossing.
     - A lamp is never in a lane, on a road surface or under a deck.
9. **Tiles** (`map/bake/clip.ts`, `tilesV4.ts`): the surface is cut exactly at each tile's border.
   - A point where an edge crosses the border is worked out from the edge's ends in one fixed order, then put on the
     1 cm grid, so both tiles get the same vertices along it.
   - The rest of the tile is Map v3's: heightfield, terrain colours, tyre surfaces, buildings, water, car parks,
     names, signs, and the HUD's road list.
   - New lists: `lamps`, `roadEdges` and `roadBorder` (for the debug views), and the `exclusion` grid.

**In the game** (`map/render/`):

- The road surface is drawn as baked, with tyre surfaces per triangle.
- **Lamps** are instanced (poles, arms, heads), with glow sprites and soft pools of light on the road under each head
  after dark: a few draw calls a tile, whatever the count.
- The nearest `realLights` lamps are real spot lights, fading in and out over `fadeDistance` m so none pops.
- The real lights are made once and kept; three.js compiles its shaders for a fixed count of lights.

### The block bake

- The graph, widths, junctions and heights are solved for the **whole region at once**. Heights need the whole
  network: a chain of roads can run across many tiles.
- The surface, the ground under it, the mask, trees, railings, lamps and tiles are then made **a block of
  `bake.blockTiles` × `bake.blockTiles` tiles at a time**, with `bake.blockPad` m round it.
  - Every road and junction touching the padded block is built. Each comes out identical whichever block builds it,
    because it depends only on its own inputs.
  - The ground is shaped from the unshaped heights in a window reaching past the block, and only the block's own
    cells are kept.
  - So blocks agree exactly where they meet, and memory stays bounded.
- Tiles are encoded and gzipped on every core but one (`encodePool.ts`).
- What made it fast:
  - The pad round each block is only as wide as anything in it looks for a road (100 m), not 400 m.
  - The T-junction repair, the tile clipping and the surface check weld vertices in typed arrays rather than Maps
    of strings or large numbers.
  - Trees are placed only from the woods and parks that reach the block.
  - Bridge lifts are spread along a deck in one pass, not n³.
  - The bake runs with a larger young-generation heap (`--max-semi-space-size=64`).
  - A 3 km slice of central Adelaide went from 129 s to 54 s.
- `--block-tiles` and `--block-pad` bake with other blocks. The tiles, graph and model come out byte-identical
  (tested on the slice: 6 × 6 tiles with a 100 m pad against 3 × 3 tiles with a 400 m pad).
- The vector map and the elevation are reused from Map v3's bake when their inputs haven't changed.
- Output goes beside the region's Map v3 bake, in `assets/map/<region>/v4/`: `manifest.json`, `graph.json.gz`,
  `roadmodel.json.gz` (the model's roads and junctions), `tiles/` and `far/`. The vector map is v3's
  (`../map.pmtiles`).

## Baking a region

Requirements: Node 22+, Java 21+, GDAL 3.x with its Python scripts, Osmium, and PROJ's geoid grids for
the region's datums. On Ubuntu:

```sh
sudo apt-get install gdal-bin python3-gdal osmium-tool proj-bin proj-data
# geoid grids (the bake runs PROJ offline): put us_nga_egm08_25.tif and the region's local geoid
# (e.g. us_noaa_g2018u0.tif for NAVD88) into .cache/map/proj/ — from cdn.proj.org, or the same files in
# github.com/OSGeo/PROJ-data (raw.githubusercontent.com/OSGeo/PROJ-data/master/us_nga/us_nga_egm08_25.tif)
# Every region needs us_nga_egm08_25.tif, Copernicus-only ones too: without it GDAL warps every source to
# nodata, and the bake stops ("no elevation anywhere") rather than baking the region flat.
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
4. **Map v4** (Adelaide so far):
   ```sh
   npm run map:bake4 -- --region <id> --area <lat>,<lon>,3   # a 3 km slice (about 2 minutes)
   npm run map:bake4 -- --region <id>                        # the whole region
   ```
   - It reuses the region's Map v3 vector map and cached elevation when their inputs haven't changed.
   - It writes `assets/map/<id>/v4/`.
   - It fails if any tile has a collider with nothing drawn there.
   - To switch the game to it, point the region's `manifest` in `data/map/baked.json` at
     `assets/map/<id>/v4/manifest.json`. `?map=v3` still loads the Map v3 bake beside it.

Tuning:

- **Map v3:** `data/map/bake.json` (road shape, terrain slopes, colours, railings, trees, building heights).
- **Map v4:** `data/map/v4.json`, for everything about roads and what's made from them: widths, junctions, heights,
  surface, terrain under roads, collision, exclusion mask, lamps, railings, the block bake (`bake`) and the tests'
  limits (`tests`). Bump its `version` after changing anything; the game's tile cache then drops the old tiles.
  Map v4 still reads `bake.json` for terrain colours, surfaces, tree density and buildings.
- **Performance targets:** `data/map/performance.json`, shown by the F3 overlay.

## Debug views and bad spots

`map/render/debug.ts`, on the streamed world:

- **Shift+F3** cycles the debug views:
  - **colliders**: every physics collider near the car as a wireframe, drawn from the very pieces the physics holds.
    Terrain is green, road white, buildings orange, railings red, trees brown, anything else magenta.
  - **roads**: the road model's edges coloured by class, junction patches cyan, bridges yellow, tunnels purple.
  - **mask**: the exclusion mask. Road is red, under a deck yellow, railway blue.
  - **lamps**: mapped (OSM) lamps white, estimated orange, the real lights ringed.
  - **seams**: tile borders, and any height or road-edge mismatch where two loaded tiles meet (red).
- **Shift+F6** steps the time of day: day, dusk, night (for the lamps). It's saved like the settings' time of day.
- **Shift+F4** logs a **bad spot**: position, heading, tile and a note. With the dev server running, it's written
  into `data/map/known-bad-spots.json`; otherwise it's kept in the browser, and Shift+F4 twice quickly saves the file.
  **Shift+F2** takes the car to the next bad spot. The tests check every one (`badspots`).

Tools that need no browser:

- `node map/debug/modelSlice.ts --region adelaide --at <lat>,<lon> --size 160`: the model for a small area, top down
  to a PNG, without a bake.
- `node map/debug/tileHeights.ts --region adelaide --at <x>,<z> --size 40`: a baked road surface coloured by
  height, with its triangles' edges.
- `node tools/map-shots.mjs --spots <file> [--map v3]`: screenshots in the game at a list of spots.

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

### Map v3's tests

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

### Map v4's tests

```sh
npm run test:map4 -- --region adelaide                  # the six problems, on assets/map/adelaide/v4/
npm run test:map4 -- --only junctions,bumps --verbose   # some: widths surface edges colliders trees junctions bumps lamps badspots seams
npm run test:map -- --region adelaide --map v4          # Map v3's tests, on the v4 bake
```

Each test decodes the tiles and collides with them as the game does (`tests/map/harness.ts`). Every limit is in
`data/map/v4.json` (`tests`, and `collision.maxBumpAccel`).

- **widths** (problem 1): the drawn road's width across, every few metres along every road in a sample of tiles,
  against the model's width for its class. Also reports the median drawn width by class.
- **surface** (2, 5):
  - The tiles' road meshes, joined back together: T-junction cracks inside the road (where light would show through)
    per 100,000 triangles.
  - The share of the road where two solid surfaces of the same level overlap.
- **edges** (2): points just inside every road edge, checking three things:
  - there's drawn road there (no holes);
  - the collision surface is within `maxPhysicsGap` of it;
  - the drawn ground, at near and middle detail, never comes through it.
- **colliders** (3):
  - The bake's audit, re-run: every collider has something drawn there.
  - No building, railing or trunk collider over a lane.
  - After a drive that loads and unloads tiles, no collider is left behind.
- **trees** (4): no trunk on any road surface, and no crown through a bridge deck.
- **junctions** (5): across every join between a junction patch and its roads, there's drawn road on both sides, and
  no step beyond the road's own grade.
- **bumps** (5): a car driven straight across junctions, bridge ends and tile borders at 30, 80 and 150 km/h, with the
  physics. The body's vertical acceleration is measured, and Map v3's bake is driven the same way for comparison.
- **lamps** (6):
  - Lamps along lit-class roads: the share of points within `lampReach` m of one.
  - None on a road surface.
  - The nearest few as real lights.
- **badspots**: every spot in `data/map/known-bad-spots.json` checked again on the v4 bake. That's the owner's
  screenshots and Step 0's worst places.
- **seams**: every road-surface vertex on a shared tile edge has its match in the neighbour.

`--map v4` runs Map v3's tests (road positions against OSM, heights, terrain seams, railings at 50–300 km/h,
streaming, memory, determinism, Phase 1 physics) on the v4 bake. For determinism, it bakes a 1.2 km area twice with
`bakeV4.ts`, the second time with a block for every tile and a 400 m pad, and every file must be byte-identical. So a
block's edge can't show.

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
- **Tests (`npm run test:map`): 19 of 19 pass.**
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

## The Adelaide bake (results)

The whole city, baked like San Francisco (`data/map/regions/adelaide.json`, 2026-10-11): from Henley Beach and
Glenelg on the coast to Mount Lofty and Crafers in the Adelaide Hills, from Port Adelaide and the Superway in the
north to Somerton Park and Mitcham in the south, with the CBD, North Adelaide and the parklands in the middle. In the game: the full map (Tab) → **Regions** → Adelaide → **Travel**.

- **Size:** 1,596 tiles of 512 m (21.5 × 19.5 km), 172 MB of tiles plus a 13 MB road graph, a 12 MB vector map
  and a 36-chunk far layer: 198 MB in all, static files.
- **Sources:** OpenStreetMap rebuilt from Overture (release 2026-09-23.1; Geofabrik couldn't be reached from the
  bake machine) and Copernicus GLO-30 elevation. South Australia's 1 m LiDAR (ELVIS: GDA2020 / MGA zone 54 with
  AHD heights, `EPSG:7854+5711`) would be better still, but ELVIS couldn't be reached either: add it to
  `dem.sources` ahead of GLO-30 when it can be downloaded.
- **Bake time:** about 6 minutes on 4 cores once the sources are downloaded (about 2 more the first time), at
  about 7 GB of memory at most.
- **Contents:** 89,356 road segments (49,360 junctions), 265,274 buildings (121,038 OSM footprints, 144,236 from
  Overture only; 63,433 with estimated heights), 146,065 railing pieces, 456,489 trees and 9,864 car parks.
- **Quick travel:** King William Street, The Parade (Norwood), Greenhill Road up into the hills, the Esplanade
  (Glenelg South), the South Road Superway, Adelaide Bridge over the Torrens, the Heysen Tunnels on the South
  Eastern Freeway, Adelaide Airport (the big car park) and the Britannia Roundabout.
- **Tests (`npm run test:map -- --region adelaide`):**
  - The baked centre lines are within 0.7 cm of OpenStreetMap (306,878 nodes).
  - The drawn road is within 0.4 cm of the elevation profile, and physics within 0.4 cm (junctions 12 cm).
  - All 3,112 tile edges are identical in physics.
  - One vertical datum (EGM2008); no LiDAR, so no blend to check.
  - The guard rail on Greenhill Road and the wall on King William Street hold at 50–300 km/h.
  - Streaming: 20 km at 200 km/h with the ground always ready. Over 284 tiles the heap grows by 3 MB.
  - Two bakes come out byte-identical.
  - The Phase 1 physics tests pass on Anzac Highway's 1,320 m straight (the test looks on the coast spot's road,
    and the Esplanade's longest straight is 653 m: it reports that as a failure).
  - Three more fail, all bake behaviour every region has (docs/KNOWN_ISSUES.md, "Adelaide"): one dead end of
    14,154 (Middleton Drive) lies on a road it isn't joined to; the 5 % sample of the drawn road's surface finds
    one node 1.4 m from it (Brooks Lane, a 7.6 m piece between two junctions); and the railings test's parapet,
    at the end of the Montefiore Road bridge, is hit from the road beside it, 1 m below the deck, and the car
    slips under the deck's end (from the deck, it holds at 50–300 km/h).
  - `npm run test:routes -- --only adelaide`: from North Adelaide down O'Connell Street and King William Road
    over Adelaide Bridge (1.67 km), driven to the finish by the autopilot. `npm run test:npc -- --regions
    adelaide`: NPCs at low, medium and high skill finish it cleanly.
- **In the browser:** from San Francisco, the full map's **Travel** to Adelaide is drivable at Victoria Square in
  12 s, and every quick-travel spot in 10–23 s, with software rendering on the build machine.
- **Baking it found two bake bugs**, fixed for every region's next bake:
  - with PROJ's EGM2008 geoid grid missing, GDAL warped the elevation to nothing and the region baked flat at 0 m
    without a word: the bake now stops ([Baking a region](#baking-a-region));
  - the loose-end join looked for the road an end lies on only near the middle of each piece of road, so a long
    straight piece (200 m between nodes, common in Adelaide's suburbs) was never found and the T-junction stayed
    unjoined; and an end a metre or two past a junction it already had was "joined" back onto it, folding back on
    itself (47 such in Adelaide). Now every piece is found along its whole length, and those ends are left as
    they are.

### Map v4 (2026-10-13)

Adelaide is the first region on Map v4; the game loads `assets/map/adelaide/v4/`. The full report, with before and
after pictures of the ten most complex junctions, three bridges and the known bad spots, is
[MAP_V4_REPORT.md](MAP_V4_REPORT.md).

- **Bake:** `npm run map:bake4 -- --region adelaide`: 22 minutes on 4 cores, 9 GB at most, in 49 blocks of 6 × 6 tiles.
- **Size:** 1,596 tiles, 366 MB (Map v3's: 172 MB), plus the road graph and the road model file. 400 MB in all.
- **Contents:**
  - 103,068 roads and 32,600 junction patches, 17.7M road-surface triangles;
  - 76,313 street lamps: 7,567 mapped in OSM, 68,746 estimated;
  - 431,358 trees;
  - 167,358 railing pieces: 100,642 mapped, 66,716 estimated;
  - 265,255 buildings.
- **Tests:** `npm run test:map4`: 27 of 27 pass on the whole region, among them:
  - the narrowest drawn road at its full model width;
  - 0.013% of 2.7M edge points with no road;
  - the ground never through the road at near detail;
  - every collider audited, and none over a lane;
  - no tree on a road or through a deck;
  - junction steps over 2 cm at 0.22% of joins;
  - 150 km/h across junctions at 17.8 m/s² (Map v3: 21.1);
  - 98.5% of lit roads with a lamp within 30 m;
  - all 10 known bad spots pass;
  - every tile border matched.

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
