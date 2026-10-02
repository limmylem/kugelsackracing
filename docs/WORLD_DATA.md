# The world's map data

The real world is built from open map data turned into the game's own vector tiles **offline**, once
per region, and kept in one [PMTiles](https://github.com/protomaps/PMTiles) file per region. The game
reads that file a piece at a time with HTTP range requests, so it can sit on any static host or CDN.
Nothing asks a map server while you drive. The drawing and the collision both read the same tiles, so
what you see and what the car drives on always line up.

```
Overture Maps (S3, GeoParquet) ─┐
OpenStreetMap extract (.osm.pbf)┼─▶ tools/world/build.mjs ─▶ assets/world/<region>.pmtiles ─▶ game (realworld/mapTiles.js)
data/world/overrides/<region>   ┘        (world/schema.js layers, world/tiles.js zooms)        data/world/regions.json
```

## Building a region

```sh
npm run world:build -- --region sf            # data/world/regions/sf.json → assets/world/sf.pmtiles
npm run world:build -- --region sf --osm california-latest.osm.pbf   # roads etc. from an OSM extract
npm run world:build -- --region sf --release latest                  # the newest Overture release
npm run world:build -- --region sf --bbox -122.42,37.77,-122.40,37.79  # a quick look at part of it
```

The build needs Node 20 or newer and internet access to `overturemaps-us-west-2.s3.amazonaws.com`
(no account). Downloads are only the parts of Overture's files that cover the region (a few hundred MB
for a city; each file's index is cached in `.cache/world/`, so rebuilding the same release is quick).
The San Francisco test region takes under a minute and comes to about 10 MB.

The build also writes `data/world/regions.json`, the list the game uses to find the right file for
where the car is.

## Adding a region

1. Copy `data/world/regions/sf.json` to `data/world/regions/<id>.json` and set its `id`, `name`,
   `bbox` (`[west, south, east, north]` in degrees), `spawn` and `output`. Aim for a city with some
   country round it: about 15 × 15 km is 80 tiles and about 10 MB. Bigger regions work, but split very
   large areas into several regions so each file stays a sensible size.
2. Optional, for more detail: download an OpenStreetMap extract that covers the box (e.g. from
   [Geofabrik](https://download.geofabrik.de/) or [BBBike](https://extract.bbbike.org/), or cut one with
   `osmium extract -b w,s,e,n planet.osm.pbf -o region.osm.pbf`) and set `"osm": { "pbf": "path" }`, or
   pass `--osm`. Roads, land use, water and details then come straight from OSM with every tag (lanes,
   sidewalks, individual trees, street lamps). Without one, they come from Overture's copies of the same
   OSM data. Those copies drop some tags (lane counts, for one) but are otherwise the same.
3. `npm run world:build -- --region <id>`, then commit the `.pmtiles` file and `regions.json`, or
   upload the file to your host or CDN and point the region's `url` in `regions.json` at it.

Elevation (Stage B) will be added to the same build: Copernicus GLO-30 everywhere, plus a region's own
LiDAR DEM where there is one.

## What the tiles hold

Zoom 14 tiles (about 1.9 km across at San Francisco's latitude, 8192 units across: a quarter of a metre
a unit) have everything. Zoom 12 and 10 hold a simpler world for the distance. The full field list is
at the top of `world/schema.js`.

| layer | what | main fields |
|---|---|---|
| `roads` | every road and path, cut where its properties change | `k` kind, `s` sub-kind (link, driveway, parking_aisle…), `w` width, `ln` lanes, `ow` one way, `br`/`tn`/`ly` bridge, tunnel, layer, `sf` surface, `sp` speed limit, `n` name |
| `rail` | railways, trams, subways | `k`, `br`, `tn`, `ly` |
| `buildings` | footprints and building parts | `h` height, `mh` base, `fl` floors, `b` kind, `rs`/`rh`/`rd` roof shape, height, direction, `fc`/`rc` facade/roof colour, `fm`/`rm` materials, `pt` part, `hp` has parts |
| `landuse` | parks, forest, farmland, residential, industrial, sand, rock… | `k` |
| `cover` | land cover from satellite imagery (where nothing's mapped) | `k` |
| `water` | sea, lakes, rivers (areas), streams and canals (lines) | `k`, `w` |
| `paved` | car parks, parking bays, fuel stations, service areas, plazas, driveways | `k`, `pk` parking type |
| `details` | trees, street lamps, signals, crossings, bollards, gates; fences, walls, hedges, guard rails, kerbs | `k`, `h` |

Lines and areas are cut exactly at tile edges, so a road crossing an edge ends at the same point on both
sides and the game joins it back up. Buildings are never cut: each goes whole into the tile its middle
is in. Every feature has a stable id (a hash of its OSM or Overture id), so a building can be pointed at.

### Hand-made changes

`data/world/overrides/<region>.json` changes buildings by id when the region is built: set any field
(`"h": 48, "fc": "#c8b89a"`) or remove a building (`"remove": true`). The world editor (Phase 4) will
write this file.

## Licences and attribution

The map is © OpenStreetMap contributors (ODbL 1.0) and © Overture Maps Foundation (ODbL 1.0 and CDLA
Permissive 2.0, depending on the theme). The game shows this in the corner of the real world
(`world/attribution.js`), and every map file carries it in its metadata. Keep both if you host the
files elsewhere. No imagery or data from Google's photorealistic tiles goes into the map.
