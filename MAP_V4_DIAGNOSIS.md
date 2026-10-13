# Map v4, Step 0: what's wrong with Map v3's roads, and why

Measured on the baked Adelaide region (v3, 2026-10-11) before anything changed:

- **The numbers** come from `node map/debug/diagnoseV3.ts --region adelaide --around -34.9275,138.6,2.5 --around -34.9905,138.6104,0.6`. It covers 112 tiles of central Adelaide plus Clapham, 9,088 road segments and 1,257,400 sample points. Every segment is sampled every 2 m, at five points across its width. The results are in `output/diagnosis/v3-adelaide.json`, which is gitignored.
- **The pictures** come from `node tools/map-shots.mjs --spots output/diagnosis/v3-spots.json`, top-down or from the chase camera, some with the new collider view on. They're in `output/diagnosis/v3/`.
- **The owner's screenshots** (2026-10-13) show four of the places: Belair Road / Springbank Road and Belair Road / Alton Avenue in Clapham (Adelaide), and Portola Drive / Clipper Street and Broadway / Pierce Street (San Francisco).

Every location below is in `data/map/known-bad-spots.json`, so the regression test drives through each one.

| # | Problem | How often (sample area) | Main cause |
|---|---|---|---|
| 1 | Roads too narrow | primary 5.9 m, secondary 5.5 m, trunk 7.1 m drawn (residential 8.4 m) | one-way carriageways get 1 lane |
| 2 | Gaps, holes, missing chunks along edges | holes 0.43% (+0.74% at junctions); ground through the road 1.44% near, **23%** at mid distance | junction fans cut corners; ground flattened too narrowly; terrain mesh error |
| 3 | Invisible objects | 685 railing and 1,302 building collider points over lanes; every undrawn tree solid | colliders that don't match what's drawn |
| 4 | Trees on roads and bridges | 5 crowns through decks and 9 trunks in lanes in the sample area | tree exclusion only knows ground roads, by centre distance |
| 5 | Junctions cut each other off, holes, bumps | two surfaces over one spot 6.5%; steps over 2 cm 1.4% | ribbons overlap beyond the cut, fans per node, no clusters |
| 6 | Not enough street lighting | there is none | no lamp system; 10,191 mapped OSM lamps unused |

## 1. Roads are too narrow

- **Where it comes from:** `map/bake/roads.ts` `sizeOf` (line 88). Without a `lanes` tag, a one-way way gets `max(1, ceil(class lanes / 2))` lanes. For primary, secondary and trunk roads that's **1 lane**. A carriageway is then 1 × 3.4 + 2 × 0.4 = 4.2 m, × 1.4 (`roads.widthScale`) = **5.88 m**.
- **Why it hits Adelaide so hard:** its arterial roads are mapped as two one-way ways (89% of primary, 92% of trunk and 69% of secondary segments are one-way). OSM rebuilt from Overture carries **no `lanes` tags at all** (0 of 2,620 primary segments) and only 209 `width` tags. So every arterial carriageway is drawn one narrow lane wide: narrower than a residential street (2 lanes × 3.0 m × 1.4 = 8.4 m).
- **Drawn widths (median):**

  | Class | Width |
  |---|---|
  | motorway | 14.3 m |
  | residential | 8.4 m |
  | tertiary | 9.5 m |
  | trunk | 7.1 m |
  | primary | 5.9 m |
  | secondary | 5.5 m |
  | service | 5.0 m |

- **Seen at:** Belair Road (`v3-01-belair-springbank-top.png`: two carriageways about 6 m each) and King William Street (`v3-10-king-william-night.png`: the city's main boulevard as one narrow ribbon).

## 2. Gaps, holes and missing chunks along road edges

Three causes:

1. **Junction fans cut corners** (`roads.ts` `buildSurface`, lines 592–627). Each junction is one fan from the node to the cut ends of its roads. Between two roads, its edge is a straight chord. At acute angles, forks and Y-junctions the chord runs inside where the roads really are, so a wedge of ground shows between them.
   - Dual carriageways make it worse. A junction of two of them is four nodes within 20 m, each with its own fan, and the ground between the fans shows through (`v3-01`, and the owner's screenshots of Belair Road and Broadway / Pierce Street).
   - Measured: **9,364** samples (0.74%) inside a road's own width near a junction have no road surface over them.
2. **Folds and gaps on curves and ends.** Away from junctions, **5,421** samples (0.43%) have no road over them (Muller Street, Sheldon Street, Alexandra Avenue in Norwood; `v3-03-muller-st-hole-top.png`).
   - The ribbon's sideways direction comes from its neighbouring points, with no limit for the curve's radius, so tight bends fold their inner edge.
   - Dead ends and short pieces between close nodes leave slivers.
3. **The ground comes up through the road** (`map/bake/terrain.ts` lines 112–135 and 146–149):
   - Only grid points within the road's half width + 0.5 m (`core`) are flattened, to 6 cm under the road (`sink`).
   - The next grid point, 2 m further out, is blended back to natural ground over as little as 1.5 m (`blendW` minimum). It can be close to a metre higher, so the 2 m terrain triangles that cross the road's edge rise above it.
   - The terrain mesh is also simplified (RTIN: 0.04 m error near, **0.5 m** at 650–1,700 m, `objects.ts` `setDetail`). Its error is larger than the 6 cm sink.
   - Measured: the near terrain mesh is above the road surface at **1.44%** of samples (up to 18 cm, Kenilworth Road, `v3-04`). The mid-distance one is above it at **23%**. That's why distant roads are broken up by green (`v3-05-magill-rd-chase.png`, and the owner's hill screenshots).

## 3. Invisible objects on roads

The new collider view (Shift+F3, `map/render/debug.ts`) draws every collider the physics holds. Comparing it with what's drawn found three kinds of collider with nothing visible there:

1. **Tree trunks that aren't drawn.** The graphics settings' scenery slider draws only a share of the trees (`objects.ts` `setScenery`). The physics makes a trunk for every tree (`map/render/physics.ts`). On low or medium scenery most trunks are invisible but solid. The trunk collider is also 0.25 m round against a drawn 0.16 m.
2. **Railings, fences and hedges reaching into lanes:** **685** points where a railing collider stands on a road surface (`v3-08-fence-collider-on-road.png`, Hindmarsh).
   - `map/bake/details.ts` (line 55) tests only the middle of each 4 m piece, and only against the centre line ± half width + 0.3 m. The collider box is at least 0.35 m thick and 1.2 m taller than the rail (`barriers.minThickness`, `extraHeight`), so the ends of pieces near a road reach into it.
   - Estimated railings are skipped only within 25 m of 3-way junctions, not where a road merges at a fork.
3. **Building colliders over lanes:** **1,302** points where a building's convex collider is over a road surface at the road's height (`v3-07-building-collider-on-road.png`, Hindmarsh).
   - `map/bake/tiles.ts` moves a footprint's corners off the drawn road, but not its edges. Its passage check looks only for centre-line points inside the footprint, so a road widened past a building's edge runs into its collider.

The road's own trimesh is also built without Rapier's internal-edge fix. That doesn't add objects, but the car's body can catch on triangle edges where the surface creases (problem 5).

## 4. Trees on roads, and on bridges where they come up from underneath

- **Where it comes from:** `details.ts` `trees` (line 104). The road exclusion is built from `g.structure === 'ground'` segments only, and the terrain's road cells (`hardRoad`) come only from ground roads (`terrain.ts` line 121 skips bridges).
- A tree in a park under a bridge is placed as if the bridge weren't there, and its crown (up to 8 m) comes up through the deck. There are **5** in the sample area, all at the Hackney Road bridge over the Torrens (`v3-09-tree-through-deck.png`). Across the region there are many more.
- The test is the tree's centre against the centre line ± half width + 1 m, not its crown's footprint. **9** trunks still stand in lanes where a mapped tree is closer than that to a road whose drawn width was later widened.

## 5. Junctions cut each other off, with holes and bumps

- **Two road surfaces over one spot**, within 0.5 m of each other: **81,972** samples (6.5%). Of those, **17,383** (1.4%) step by more than 2 cm (up to 34 cm: Greenhill Road, `v3-06-greenhill-step-top.png`).
- **Ribbons overlap past the cut.** Each road is cut back from a junction only by the widest road's half width × 1.15 + 1 m (`roads.ts` `cutAt`, line 513). At acute angles the ribbons still overlap each other beyond the cut. Each has its own height profile and camber, so they z-fight and step.
- **One fan per node, no clusters.** Dual carriageways, slip roads and roundabout entries put several junction nodes within a few metres of each other. Each gets its own fan, and the fans overlap (Belair Road / Springbank Road: four fans).
- **Fans have no single surface.** Each fan goes from the node's height to the arms' cut sections, with their camber. A car crosses a crease at every arm.
- **Merges and height matching leave steps:** nodes merged within 0.5 m, and roads side by side matched in height over 30 m (`matchSideBySide`), leave steps where ribbons meet.
- **Roundabouts:** Overture's copy of OSM has no `junction=roundabout` tag, so roundabouts are only found by shape (for quick travel). They're built as plain fans.

## 6. Not enough street lighting for night driving

- **There is no street lighting at all.** Map v3 has no lamp system. At night the only lights are the car's own two headlights (`test-scene.js` `addHeadlights`) under a dark sky.
- The Adelaide extract has **10,191** mapped street lamps (`highway=street_lamp`, kept by the OSM reader and never used). Only 235 roads carry `lit=yes` and 36 `lit=no`.

## What v4 changes, in short

- **One road surface model** at bake time (`map/model/`), with real junction patches:
  - arms trimmed exactly to where their edges meet;
  - near junctions merged into one cluster;
  - each patch on one plane, sharing its boundary vertices with the trimmed arms.
- **Edges that can't fold**, built from the whole model and cut exactly at tile borders.
- **Wider roads:** lanes × 3.5 m + shoulders + kerbs, with one-way arterials given their real lanes, and a visual and a drivable width.
- **Heights solved on the graph first:** junctions, then segments, slope and slope change limited.
- **Ground flattened under the whole surface** plus a margin of at least one grid cell, deeper than the terrain mesh's error.
- **Collision from the same model:** road trimeshes with Rapier's internal-edge fix and a collision apron over tile borders. Every collider is checked against something drawn when baking. Trunks only for the trees drawn.
- **An exclusion mask from the model:** every layer, decks and their footprint below, buffers. Trees and props are tested by their crowns.
- **Street lamps:** OSM's, then estimated ones from the model, drawn cheaply, with the nearest few as real lights.
- **Debug views and tools:** colliders, road model, mask, lamps, seams; the bad-spot logger and replay; the top-down shot tool.
