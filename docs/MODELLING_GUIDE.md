# Modelling guide

How to make car and part models that go straight into the game. The rules below are the ones
`npm run check-models` checks, and `npm run import` checks, fixes and imports by. Its tables come from
`data/content/model-rules.json`: change the rules there, then run `npm run guide`.

## The short version

1. Model at real size in **metres**, **+Y up**, the car's **front towards +Z** and its **left towards +X**.
2. Put the **origin where the part attaches** (the tables below say where for each type).
3. Name materials **`paint`** (body colour), **`car_atlas`** (the palette texture), **`glass`**,
   **`light_…`**, or a **finish** (`chrome`, `carbon`, `raw_metal`…). Nothing else.
4. Keep under the **triangle budget**, flat-shaded, with normals. Only meshes: no cameras, lights or
   animations.
5. Export **glTF Binary (.glb)** named **`<type>_<name>.glb`** (e.g. `spoiler_ducktail.glb`,
   `rim_5spoke.glb`, `car_roadster.glb`), drop it in **`incoming/`** and run **`npm run import`**.

The import checks it, fixes what it can, checks it again, and if it passes writes the model, an icon and
a starting part file with the price and stats marked **to do**. The shop lists the part as "coming soon"
until you fill those in and delete its `todo` line.

## Axes, units and scale

| | Game (glTF) | Blender |
|---|---|---|
| Up | +Y | +Z (the exporter's **+Y Up** option turns it) |
| The car's front | +Z | −Y (the car faces you in Front view, numpad 1) |
| The car's left | +X | +X |
| Units | metres | Scene › Units: Metric, Unit Scale 1.0 |

Apply every transform before exporting (Blender: select all, **Ctrl+A › All Transforms**): the checker
measures what's in the file. A model 100× too big was almost always made in centimetres; the checker
says so, and `npm run fix-model -- file.glb --scale 0.01` fixes it.

## Origins: where a part attaches

A part's origin is its **socket**: the game puts the origin exactly on the car's socket and hangs the
part from there. So the origin goes where the part meets the car, not in the middle of the scene. The
checker tells you which way the model is off ("its bottom is 0.95 m above the origin…"), and
`npm run fix-model -- file.glb --place-origin` (or `npm run import -- --place-origin`) moves it for you
using the rules below.

In Blender: select the vertex or edge at the attach point, **Shift+S › Cursor to Selected**, **Object ›
Set Origin › Origin to 3D Cursor**, then move the object to 0, 0, 0 and apply its location.

## Parts

- **One model per part**, meshes only. Several meshes are fine (they're merged where they can be).
- **Wheels are rims only**: the game makes each tyre to fit its rim, from the tyre part's size. The rim
  turns about X (the axle), its outer face towards +X. It's the left-hand wheel: the game turns the
  right-hand wheel sockets round so one model fits all four.
- **Left and right parts** (doors, fenders, skirts, mirrors) are separate models, each where it sits on
  its own side.
- **Variants** (a rim in chrome, black, 17"…) don't need models of their own: a variant table
  (`data/variants/<part>.json`) makes them from one model with `npm run generate-variants`.
- **Closed meshes** (no holes): the importer estimates the mass from the volume (× a density for each
  type); with holes it can only guess from the size.

## Materials and textures

- **`paint`**: every surface in the car's body colour. It follows the player's paint and finish. Make it
  a plain material (no texture).
- **`car_atlas`**: everything else in colour: a small palette texture (a grid of flat colours). UV each
  face onto its colour: a whole face on one texel. The importer can split surfaces textured in the paint
  colour into `paint` for you: `npm run import -- --paint "#6d9a91"`.
- **`glass`**, **`light_head`**, **`light_tail`** (and other `light_…`): the car's own glass and lamps.
- **Finish materials** (`chrome`, `carbon`, `raw_metal`, `rubber`, `matte_black`…): surfaces that are
  always that finish (data/finishes.json has the list).
- Textures at most 1024×1024, sides a power of two (the importer shrinks bigger ones). PNG or JPEG.

## Cars

A car is modelled whole, each part's mesh under an **empty named for its socket** (`socket_bonnet`,
`socket_wheel_FL`…), placed where that part attaches. `npm run import` of `car_<id>.glb` copies it to
`data/cars/<id>/`, starts a `car.json` from the starter car's if there isn't one (its to-dos marked),
and splits it into the body and a model per stock part (`npm run build:car`).

- The **wheel sockets** (`socket_wheel_FL`, `_FR`, `_RL`, `_RR`) are the wheel centres at ride height:
  a wheel's radius above the ground, so the car stands on its stock tyres. The **right-hand ones are
  turned 180° round Y** so their +X points out of the car, like the left ones.
- **Left and right sockets mirror each other**: the same y and z, x the other way.
- Socket names are **exact** (case matters): the checker spots near misses (`socket_whel_FL`,
  `Socket_Mirror_Right`) and says what they should be.
- The body's painted surfaces use `paint`; it must be there.
- **Made in Claude Design**: [car_prompts.md](car_prompts.md) has a ready prompt for each car (`npm run car-prompts`
  writes it from the cars' data: every socket, part and size exact). A wheel there is its rim and, round it, a tyre in
  the `rubber` material (cut off by the split; the game draws its own tyres); a part may be a group of meshes, and
  several meshes straight under one socket are gathered into one part.

## Generated parts

Mechanical parts aren't modelled by hand: `npm run generate-parts` builds them in code from settings
(`tools/generators/<category>.js`, on the shared helpers in `tools/generators/lib/`) and imports each one
through the same pipeline as a modelled part, so every one passes these rules. Change a part by changing
its generator's settings and running it again — never the `.glb`. A part file says it's generated in its
`madeBy` (the generator, the design and the settings it was made with).

- **The same rules**: real size in metres, +Y up, front +Z, origins at the attach point, the materials
  below, under the triangle budget, closed meshes (the mass of a new part comes from its volume and
  materials), flat-shaded low-poly with slight bevels.
- **Generators' own materials**: `rim_finish` (a rim's face: it takes the rim's finish), `caliper`,
  `seat_fabric` and `light_aux` (a lamp's lens: it glows the light's colour) — each part's colour is in
  its generator's settings. These, `titanium`, `rubber` and `glass` keep their own look whatever finish
  the part is given.
- **Made to fit each car**: parts that must fit a car's shape are measured from its model
  (`tools/generators/lib/car.js`: the cabin's floor, roof, pillars and door openings; the strut towers; the
  bumper's bottom outline; the roof; the sills) — a roll cage, a strut brace, underglow, a front lip, the
  Ridgeback's bull bar and snorkel. A part for every car keeps a version per car in its `byCar`.
- **Brake kits** are drawn at every wheel (`look.drawAt: "wheels"`): on the hub, steering but not
  turning, made to fit inside the rim.
- **Wings** have their element as a node of its own, `wing_element`, turning about its middle: the game
  tips it to the wing's angle setting.
- **Shape settings**: a family's models are made by these generators from its settings and its shape (`formulas.json`
  `families.<kind>.shapeSettings`: a wheel's spoke style, dish and lip, a wing's profile and end plates, an exhaust's tip
  shape and cut…; `npm run content -- shapes <kind>`). Each one's default is the look the kind always had. Where a shape
  is better modelled than made in code, a generator mixes in a **kit piece** (below).
- **Not generated**: anything that has to follow a car's curves — bumpers, bonnets, fenders, widebody
  flares, hardtops, engine covers, side skirts. Those are modelled (`docs/models_todo.md` lists them). Vents, scoops and
  dive planes on an aero kit's bumper corners come in as kit pieces.

## Kit pieces

A kit piece is a small model a generator mixes into a family's models: a wing's **end plate**, a wheel's **centre**, an
**exhaust tip**, a piece on each front **corner of an aero kit's bumper**. Each kind of family has its attach points
(the *Kit pieces* table below, from `model-rules.json` kits); a piece is one model for one attach point.

- **Name it** `kit_<kind>_<attach>_<name>.glb` (`kit_spoiler_endplate_fin.glb`, `kit_wheels_centre_spinner.glb`). In
  the Blender add-on, pick **Kit piece: …** as what it is: its checks, Place at origin and Export use the attach point's
  rules and name the file for you.
- **Model it at the reference size** in the table, real size in metres, +Y up, the car's front +Z: the generator scales
  it to where it goes (an end plate with the wing's chord; an exhaust tip with the pipe's radius and the tip's length) —
  so model it once, at that size, and it fits every wing or pipe.
- **Its origin is the attach point**, as the table says: an end plate's inner face at x 0 with the wing element's middle
  at y 0, z 0; a wheel centre's back on the hub's face; an exhaust tip's front where it meets the pipe, pointing back
  (−z); a bumper corner piece's inner face against the bumper's side. **Model the left-hand one** (+x out): the generator
  mirrors it for the right.
- **Materials**: `paint`, a finish (`carbon`, `chrome`, `raw_metal`, `matte_black`…) or `rim_finish` (a wheel's face:
  it takes the wheel's finish). **No `car_atlas` and no textures**: it's mixed into a model made in code, which has
  neither. Closed meshes, flat-shaded, low-poly, under the attach point's triangle budget (it adds to the part's).
- **Import it** like any model: put it in `incoming/` and `npm run import`. It's checked (size, origin, budget,
  materials), fixed and put in `assets/kits/<kind>/<attach>_<name>.glb`; from then on it's a choice for that kind's kit
  shape setting (`centrePiece`, `platePiece`, `tipPiece`, `bumperPiece`) in the family builder's Shape step. Every model
  made with it goes through the same checks as the rest (`npm run test:shapes` tries each piece on every car).
- `npm run sample-models -- --kits` writes the four starter pieces, to try it all with.

## The Blender add-on

`npm run blender-addon` makes `tools/blender/dist/ognistrada_tools.zip`; in Blender, **Edit › Preferences › Add-ons ›
Install from Disk**, pick it and tick **Ognistrada tools**. Its panel is in the 3D View's sidebar (**N**) ›
**Ognistrada**: **Set up the scene** (metres), what the model is (a part type, a car, or a **Kit piece: …** — see Kit
pieces) and its name, **Add socket** (an empty named exactly
as the game wants, at the 3D cursor — for a car), **Place at origin** (the attach point to 0, 0, 0, by the type's
rule), **Check** (these rules, in plain words with how to fix each) and **Export for the game** (checks, then writes
`<type>_<name>.glb` with the right settings into the folder chosen — the game's `incoming/`). See
[CONTENT_PIPELINE.md](CONTENT_PIPELINE.md).

## Levels of detail, textures, crashes

- **Levels of detail**: the importer makes a model's LOD1 (for far away) with meshoptimizer. To make your own, add a
  copy named `<object>__lod1` with fewer triangles: it's checked against its budget (the model's budget × the share in
  the rules: "LOD1 has 3× too many triangles…").
- **Textures** of 512 px or more are compressed to KTX2 by the importer: keep them as PNG or JPEG in Blender.
- **Parts that come off in a crash** (panels, bumpers, spoilers…) get collision hulls and their mounts from the model:
  keep them closed and without stray faces far from the part.

## Tools

| Command | What it does |
|---|---|
| `npm run check-models` | Checks every model the game uses (or `-- path` for files or a folder): a PASS / WARN / FAIL report per file with how to fix each problem. Exits 1 on a failure. |
| `npm run fix-model -- x.glb` | The auto-fixer on its own: removes cameras, lights, animations and unused data (never empty socket nodes), merges duplicates, adds missing normals, shrinks big textures, compresses the geometry (meshopt). Options: `--scale`, `--place-origin`, `--paint "#hex"`, `--material "Material.001=paint"`. |
| `npm run import` | Everything in `incoming/`: check, fix, check again, then model, icon and part file (or a car). Asks in the terminal when a file name doesn't say what it is. |
| `npm run generate-variants` | Parts from variant tables (`data/variants/*.json`): stable ids like `rim_5spoke_17_chrome`; variants dropped from a table are retired, never deleted. |
| `npm run icons` | Draws every part's icon: from its model (a variant in its own finish), or simple artwork for its slot in its tier's colour for parts with no model. `-- --missing` for new parts only. |
| `npm run balance-report` | Every part's price, mass and stat changes on the starter car, value for money, and anything off its tier's rules (`data/content/tiers.json`: price bands, gains to each slot's key stat, dearer parts doing more), with the fully upgraded car's class, in `reports/balance.csv`. |
| `npm run playtest` | A whole upgrade journey played through the player service, with the rating and the Step 6 results after every change (`reports/playtest.csv`). In the game: the garage's settings › Playtest, and `dev/playtest.html` to read the log. |
| `npm run guide` | Rewrites this guide's tables and `docs/part_prompt_templates.md` from `data/content/model-rules.json`. |
| `npm run sample-models` | Writes sample models to `incoming/` to try it all with (`-- --broken` adds models with mistakes, `-- --kits` the starter kit pieces). |
| `npm run generate-parts` | Makes the mechanical parts' models in code (`tools/generators/<category>.js`: rims, brakes, engine, aero, interior, bay, exhaust, lights, offroad) and imports them like a modelled part: checked, icon, part file. `-- rims brakes` for some generators, `--only id,id`, `--check` to build and check without importing. Draws `docs/generated_parts.png` (every generated part) and `docs/generated_fit.png` (every car with a set fitted through the garage). |
| Part preview | `http://localhost:7690/dev/parts.html`: every part alone or on a car, its variants, sockets, wireframe, bounds, triangle counts, paint and finish tests, and a fit check (does it cut into the body or other parts?). |

## The rules

<!-- rules:start (written by npm run guide from data/content/model-rules.json: edit that file, not these tables) -->

### Part types

Name the file `<type>_<name>.glb` (or with one of the other names). Sizes are metres: wide = across the car (x), tall = up (y), long = front to back (z).

| Type | File names | Goes in | Wide | Tall | Long | Origin | Triangles |
|---|---|---|---|---|---|---|---|
| Spoiler or wing | `spoiler_…` `wing_…` `ducktail_…` | aero / spoiler | 0.8–1.9 | 0.03–0.6 | 0.05–0.7 | the middle of the boot lid where it bolts on, at the bottom of its feet | 2,000 |
| Wheel (rim only) | `rim_…` `wheel_…` | wheels / wheels | 0.1–0.35 | 0.35–0.55 | 0.35–0.55 | the wheel's centre on its axle; the outer face towards +x | 3,000 |
| Bonnet | `bonnet_…` `hood_…` | body / bonnet | 1–1.9 | 0.01–0.3 | 0.6–1.8 | the middle of its back edge (the hinge line), level with its top surface | 1,500 |
| Cowl bonnet | `cowl_bonnet_…` `bonnet_cowl_…` | body / bonnet | 1–1.9 | 0.01–0.6 | 0.6–1.8 | the middle of its back edge (the hinge line), level with the panel's top there (the cowl rises above it) | 1,500 |
| Boot lid | `boot_…` `trunk_…` `bootlid_…` | body / boot | 1–1.9 | 0.01–0.5 | 0.2–1.3 | the middle of its front edge (the hinge line), level with its top surface | 1,500 |
| Front bumper | `bumper_front_…` `front_bumper_…` | body / bumper_front | 1.3–2.1 | 0.08–0.7 | 0.08–0.7 | the middle of where it meets the body | 1,500 |
| Rear bumper | `bumper_rear_…` `rear_bumper_…` | body / bumper_rear | 1.3–2.1 | 0.08–0.7 | 0.08–0.7 | the middle of where it meets the body | 1,500 |
| Left door | `door_left_…` `left_door_…` | body / door_left | 0.02–0.3 | 0.3–1.1 | 0.6–1.7 | its front edge (the hinge line), halfway up | 1,500 |
| Right door | `door_right_…` `right_door_…` | body / door_right | 0.02–0.3 | 0.3–1.1 | 0.6–1.7 | its front edge (the hinge line), halfway up | 1,500 |
| Left front wing (fender) | `fender_left_…` `left_fender_…` | body / fender_left | 0.02–0.35 | 0.15–0.9 | 0.5–1.6 | its inner edge where it bolts to the body, at the top | 1,500 |
| Right front wing (fender) | `fender_right_…` `right_fender_…` | body / fender_right | 0.02–0.35 | 0.15–0.9 | 0.5–1.6 | its inner edge where it bolts to the body, at the top | 1,500 |
| Left side skirt | `skirt_left_…` `left_skirt_…` | body / skirt_left | 0.005–0.25 | 0.02–0.35 | 0.9–2.6 | its middle | 1,000 |
| Right side skirt | `skirt_right_…` `right_skirt_…` | body / skirt_right | 0.005–0.25 | 0.02–0.35 | 0.9–2.6 | its middle | 1,000 |
| Left mirror | `mirror_left_…` `left_mirror_…` | body / mirror_left | 0.06–0.4 | 0.04–0.3 | 0.02–0.3 | where its arm meets the door (its innermost point) | 800 |
| Right mirror | `mirror_right_…` `right_mirror_…` | body / mirror_right | 0.06–0.4 | 0.04–0.3 | 0.02–0.3 | where its arm meets the door (its innermost point) | 800 |
| Seat | `seat_…` | interior / seat | 0.35–0.75 | 0.5–1.3 | 0.4–1.1 | the middle of its base, on the floor | 2,500 |
| Steering wheel | `steering_wheel_…` `steering_…` | interior / steering_wheel | 0.25–0.45 | 0.25–0.45 | 0.01–0.25 | its hub, on the steering column (the wheel faces +z towards the driver) | 2,000 |
| Engine | `engine_…` | engine / engine | 0.3–1.1 | 0.25–1 | 0.3–1.2 | the middle of its base, on the engine mounts | 6,000 |
| Intake (air box, filter) | `intake_…` `airbox_…` `air_filter_…` | intake / intake | 0.05–0.7 | 0.05–0.5 | 0.05–0.8 | where it joins the engine | 1,500 |
| Turbo | `turbo_…` `turbocharger_…` | turbo / turbo | 0.1–0.6 | 0.1–0.5 | 0.1–0.6 | where it bolts to the exhaust manifold | 2,500 |
| Intercooler | `intercooler_…` | intercooler / intercooler | 0.3–1 | 0.1–0.5 | 0.03–0.3 | its middle | 1,500 |
| Exhaust (tip) | `exhaust_…` `exhaust_tip_…` | exhaust / exhaust | 0.03–0.4 | 0.03–0.3 | 0.05–1.6 | the front of the tip, where it meets the pipe (the tip points back, towards −z) | 1,200 |
| Engine cover | `engine_cover_…` `enginecover_…` | body / engine_cover | 1–1.9 | 0.01–0.5 | 0.2–1.3 | the middle of its front edge (the hinge line), level with its top surface | 1,500 |
| Roof (soft top, hardtop) | `roof_…` `soft_top_…` `hardtop_…` | body / roof | 0.9–1.9 | 0.05–1 | 0.4–1.8 | the middle of the roof, level with its top | 1,500 |
| Brake kit (disc and caliper) | `brakes_…` `brake_kit_…` | brakes / brakes | 0.02–0.2 | 0.2–0.48 | 0.2–0.48 | the wheel hub's centre (the disc's centre on the axle), the outer face towards +x: drawn at every wheel | 1,500 |
| Supercharger | `supercharger_…` `blower_…` | turbo / supercharger | 0.15–0.7 | 0.1–0.5 | 0.15–0.75 | where it bolts to the engine | 2,500 |
| Radiator | `radiator_…` | engine / radiator | 0.3–0.95 | 0.15–0.65 | 0.03–0.25 | its middle | 1,200 |
| Strut brace | `strut_brace_…` | suspension / strut_brace | 0.6–1.6 | 0.02–0.25 | 0.03–0.3 | the middle of the bar, on the line between the strut tops | 800 |
| Roll cage or hoop | `roll_cage_…` `cage_…` `roll_hoop_…` | interior / roll_cage | 0.8–1.85 | 0.4–1.6 | 0.05–2.6 | the middle of the cabin above the seats (socket_cage): the cage goes where the cabin has room for it, front to back | 4,000 |
| Harness | `harness_…` | interior / harness | 0.2–0.6 | 0.3–1 | 0.02–1 | the middle of the seat back, where the straps cross | 800 |
| Gauge pod | `gauges_…` `gauge_pod_…` | interior / gauges | 0.04–0.45 | 0.04–0.4 | 0.03–0.25 | where the pod sits on the dash or pillar | 1,000 |
| Gear lever | `shifter_…` `gear_lever_…` | drivetrain / shifter | 0.03–0.25 | 0.1–0.45 | 0.03–0.25 | the middle of its base, on the tunnel | 600 |
| Fog lights (a pair) | `fog_lights_…` `fog_…` | cosmetic / fog_lights | 0.3–1.9 | 0.04–0.3 | 0.02–0.3 | the middle between the two lamps (socket_fog_lights): they stand on the front bumper's face, in front of the socket | 1,000 |
| Underglow strips | `underglow_…` | cosmetic / underglow | 0.8–2.1 | 0.004–0.08 | 1.8–5 | the middle of the floor | 600 |
| Front lip or splitter | `front_lip_…` `lip_…` `splitter_…` | aero / front_lip | 1–2.2 | 0.01–0.25 | 0.05–0.6 | the middle of its front edge, under the bumper (socket_front_lip) | 1,200 |
| Canards (dive planes) | `canards_…` `dive_planes_…` | aero / canards | 1–2.2 | 0.02–0.35 | 0.05–0.5 | the middle between the bumper corners (socket_canards) | 800 |
| Mud flaps | `mud_flaps_…` `mudflaps_…` | body / mud_flaps | 1–2.2 | 0.15–0.55 | 0.005–3.6 | between the flaps, at the height of their tops (socket_mud_flaps): they hang behind the wheels | 600 |
| Aero kit | `aero_kit_…` | aero / aero_kit | 1.4–2.3 | 0.05–0.7 | 2.5–5.2 | the middle of the car at floor level (socket_aero_kit) | 3,000 |
| Bull bar | `bull_bar_…` `nudge_bar_…` | body / bull_bar | 1.2–2.2 | 0.3–1.1 | 0.05–0.55 | the middle of the bar where it bolts to the chassis (socket_bull_bar) | 2,500 |
| Winch | `winch_…` | body / winch | 0.25–0.75 | 0.1–0.4 | 0.1–0.45 | its mounting plate (socket_winch) | 1,500 |
| Snorkel | `snorkel_…` | body / snorkel | 0.05–0.35 | 0.5–1.6 | 0.05–0.6 | where it goes into the wing (socket_snorkel): it runs up the outside of it | 800 |
| Roof rack | `roof_rack_…` | body / roof_rack | 0.8–1.7 | 0.05–0.35 | 0.8–2.4 | the middle of the rack, its feet on the roof (socket_roof_rack) | 2,500 |
| Light bar | `light_bar_…` | body / light_bar | 0.3–1.6 | 0.04–0.25 | 0.03–0.3 | the middle of the bar, on its brackets | 1,000 |
| Rally light pod | `rally_lights_…` `light_pod_…` | body / rally_lights | 0.4–1.5 | 0.08–0.4 | 0.05–0.35 | the middle of the pod where it straps on (socket_rally_lights) | 1,500 |
| Skid plates | `skid_plates_…` `skid_plate_…` | body / skid_plates | 0.5–1.7 | 0.003–0.25 | 0.5–3.2 | the middle of the plates, under the car (socket_skid_plates) | 800 |
| Rock sliders | `rock_sliders_…` | body / rock_sliders | 1.3–2.3 | 0.03–0.3 | 1.4–3.3 | the middle between the two sills (socket_rock_sliders): they hang under the sills | 1,500 |
| Lift kit | `lift_kit_…` | suspension / lift_kit | 1–2.1 | 0.1–0.8 | 1.8–3.8 | the middle of the car between the axles (socket_lift_kit) | 2,000 |

The origin may be 3 cm off (engine: 6 cm). Over the triangle budget is a warning; over twice it, a failure.

### Kit pieces

Name the file `kit_<kind>_<attach>_<name>.glb` (e.g. `kit_spoiler_endplate_fin.glb`): a piece a family's model generator mixes in (see Kit pieces above). Model it at the sizes shown, with its origin where it says; the generator scales it as shown. Materials: `paint`, a finish or the generators' own (`rim_finish`…): no `car_atlas`, no textures.

| Kind | Attach point | File name | Wide | Tall | Long | Origin | Scaled by | Triangles |
|---|---|---|---|---|---|---|---|---|
| spoiler | Wing end plate | `kit_spoiler_endplate_…` | 0.003–0.05 | 0.05–0.4 | 0.1–0.6 | the end of the wing's element: the plate's inner face at x 0 (it stands out to +x), the element's middle — half its thickness up, half its chord along — at y 0, z 0; modelled for a 0.3 m chord, the left-hand one (the game mirrors it for the right) | y: chord (0.3 m), z: chord (0.3 m) | 300 |
| wheels | Wheel centre piece | `kit_wheels_centre_…` | 0.004–0.06 | 0.03–0.14 | 0.03–0.14 | the hub's front face: its back at x 0, centred on the axle (it stands out to +x, the wheel's outer face) | — | 400 |
| exhaust | Exhaust tip | `kit_exhaust_tip_…` | 0.04–0.14 | 0.04–0.14 | 0.06–0.32 | the front of the tip, where it meets the pipe, centred on it (it points back, to −z); modelled for a 45 mm radius and 180 mm long | x: radius (0.045 m), y: radius (0.045 m), z: length (0.18 m) | 300 |
| body_kit | Bumper corner piece (a vent, a scoop, dive planes) | `kit_body_kit_bumper_…` | 0.005–0.12 | 0.02–0.25 | 0.03–0.4 | the front bumper's left-hand corner, 10 cm above its bottom edge, 2 cm back from its front: its inner face at x 0 (it stands out to +x); the game mirrors it for the right-hand corner | — | 400 |

### Cars

| | |
|---|---|
| File name | `car_<id>.glb` (the whole car, each part's mesh under its socket node) |
| Size | 3–5.6 m long, 1.4–2.2 m wide, 1–2.1 m tall |
| Wheelbase / track | 2–3.4 m / 1.1–1.9 m |
| Wheel sockets | at each wheel's centre, 0.24–0.42 m up (the stock wheel's radius, give or take 1.5 cm) |
| Left / right sockets | mirror each other to 1 cm |
| Triangles | 150,000 for the whole car |
| Paint | the body's painted surfaces use the material `paint` |
| Must have | `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR` |
| Should have | `socket_bonnet`, `socket_boot`, `socket_bumper_front`, `socket_bumper_rear`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_engine`, `socket_intake`, `socket_turbo`, `socket_exhaust_tip`, `socket_spoiler` |

### Materials and textures

Material names: `paint`, `car_atlas`, `glass`, `rim_finish`, `caliper`, `seat_fabric`, `light_*`, or a finish: `gloss`, `matte`, `metallic`, `pearl`, `carbon`, `chrome`, `matte_black`, `gloss_black`, `raw_metal`, `rubber`, `titanium`, `polished`, `painted`. Textures at most 1024×1024, sides a power of two.

<!-- rules:end -->

## Before you export: a checklist

- [ ] Real size in metres, transforms applied (scale 1)
- [ ] +Y up, front +Z, left +X
- [ ] Origin at the attach point
- [ ] Materials named `paint` / `car_atlas` / `glass` / `light_…` / a finish
- [ ] Under the triangle budget, normals on, UVs on anything textured
- [ ] No cameras, lights, animations or armatures
- [ ] File named `<type>_<name>.glb`
