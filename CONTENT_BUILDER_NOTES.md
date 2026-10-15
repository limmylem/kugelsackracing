# Content builder: findings before building it (Step 0)

What the family builder (the admin page's Content tab) has to fit into: how content edits are stored today, every
family kind and what its model generator takes, and the decisions made from it. The builder itself is described in
[docs/CONTENT_PIPELINE.md](docs/CONTENT_PIPELINE.md) ("A family from the admin page", "Shape settings and kits").

## 1. How content gets made and changed today

There are two places content lives, and they don't mix:

| | Where it's kept | How it gets to git, the hook and CI |
|---|---|---|
| **What a part is** (its family, settings, stats, model, price, tier) | **Files**: `data/families/<id>.json`, `data/engines/<id>.json` → `npm run content -- build` → `data/parts/<category>/<id>.json`, `assets/parts/…` models, `assets/icons/parts/…`; `npm run content -- check` → `data/content/checks.json`, `assets/thumbs/` | Committed like code. The pre-commit hook and CI (`checks.yml`, `server.yml`) run `npm run content -- verify`: every part made from its definition and checked. The server image is built from those files. |
| **What's been decided about it since** (draft → review → published, Content tab edits of price, tier, unlock level, name and stats) | **The database**: `catalogue_items` (each part's latest version, its status, the fields an edit set, what players have: `live`, `live_set`) and `catalogue_history` (every change, who and why). Every change also goes in `audit_log` (the admins' log). | Never in git. The game gets it as an overlay on the files (`garage/content.js` applyContent / withContent, `/player/config`). |

- `server/src/content/manager.ts` reads the game's files once (`gameData()`, cached for the process) plus
  `data/content/checks.json` and `thumbs.json` at start. Edits are new **versions** in the database, drafts until
  published; publishing needs passing checks (the files' checks, plus the live checks of an edited version, run in a
  worker).
- The server image (`Dockerfile`, `.dockerignore`) has **no `tools/`, no `.git`, no `tests/`** and no development
  dependencies (gltf-transform, sharp, meshoptimizer, three): the pipeline can't run in production or staging at all.
  `npm run content` only runs on a checkout.

**So the builder follows the files' path, not the database's.** It writes the same files a person does
(`data/families/<id>.json`, `data/engines/<id>.json`, presets) and runs the pipeline's own build and check modules on
them, on a checkout (the owner's computer: `npm run server:dev`). The owner commits the result; the hook and CI verify
it as they verify anything made with `npm run content`; a deploy takes it to the server, where the parts arrive as
drafts in the Content tab and are published there as now. On a server without the pipeline (the image) the builder
says so and only shows what it would make; it never writes there.

What the builder adds on top, in the database (so the Content tab's history and the admins' log have it, like other
Content tab edits): a `catalogue_history` row per family / engine / preset action (kind `family`, `engine`, `preset`,
`car`) and an `audit_log` row, each with who and why.

**Players keep the published version until it's published again.** A family edit changes its parts' files. Today a
changed file reaches players on the next deploy if the part is published. To keep the rule the Content tab already
has ("an edit is a new draft version; players keep the published one until it's published"), publishing now keeps
a copy of what was published (the fields the overlay carries: price, tier, unlock, name, mass, effects, sound, aero,
rim, toughness, its stats), and players get that copy until the part is published again. A part whose files changed
since it was published shows in the Content tab as a new draft version ("changed in the files since it was
published"). Models aren't versioned: a changed shape is seen as soon as it's deployed (noted in the docs).

## 2. Family kinds (formulas.json `families.<kind>`) and their settings now

Ten kinds. Every setting is a **range** (numbers, some whole), a **list of values**, a **table** (named entries whose
fields the formulas use), or **cars** (one of the game's cars). `shapeKeys` are the settings that change the model.

| Kind | Slot · priced by | Settings (allowed) | Model from (shape) |
|---|---|---|---|
| `wheels` (rim) | wheels · tier from construction, value by diameter | diameter 13–24 (whole), width 5–12 (default from diameter), offset 0–55 mm (35), spokes 3–20 (whole, 5), construction: cast / flow / forged | `rim()`: barrel, spokes, hub, cap |
| `exhaust` | exhaust · measured (power) | diameter 50–110 mm, tips: single / dual / quad (dual), material: steel / stainless / titanium | `exhaustTip()` |
| `spoiler` (wing) | spoiler · measured (grip) | span 0.9–1.7 m, chord 0.12–0.38 m, elements 1–2 (1), riser 0.04–0.4 m (0.18), mount: boot / deck / roof, style: wing / ducktail | `wing()` / `ducktail()`, **fitted to each car** |
| `intake` | intake · measured (power) | diameter 60–110 mm, style: cone / cold_air / stacks | `intake()`, fitted to each car |
| `turbo` | turbo · measured (power) | size 40–76 mm, ar 0.5–1.1 (from size) | `turbo()`, fitted to each car |
| `intercooler` | intercooler · tier by thickness | width 0.45–0.8 m (0.6), height 0.16–0.34 m (0.24), thickness 45–110 mm | `core()`, fitted to each car |
| `seat` | seat · measured (weight) | style: bucket / fixed, width 0.46–0.6 m (0.52), mount: std / wide, shell: steel / fibreglass / kevlar / carbon | `seat()`, fitted to each car |
| `steering_wheel` | steering_wheel · tier from grip | diameter 300–380 mm, dish 0–90 mm (30), spokes 3–4 (3), grip: leather / suede / carbon | `steeringWheel()`, fitted to each car |
| `gauges` | gauges · tier by count | count 1–4, size 52–60 mm (52), layout: pillar / dash | `gaugePod()`, fitted to each car |
| `body_kit` (aero kit) | aero_kit · measured (grip) | car (one per car), depth 0.02–0.1 m, diffuser 0–1 (0.5), canards 0–1 (0) | `aeroKit()`: **made from each car's model** (`perCar`) |

Finishes (`formulas.json finishes`): polished, painted, carbon, chrome, matte — each a variant, × its price (and its
mass for kinds where the finish is the material: spoilers, seats, aero kits).

## 3. How each kind's models are made today, and what shape settings need

All family models are **procedural**: `tools/shapes/index.js` turns a combination's settings into a call to a
generator in `tools/generators/` (low-poly shapes from `tools/generators/lib/geometry.js`). The family file's `shape`
object (used by mesh10, aerofoil, shellback) is passed straight through to the generator as its design, with no
check of names or values. The fitted kinds go through `fitBuild` (tools/generators/lib/fitcheck.js): bigger to
smaller, moved, until the model clears each car's body. No kind uses a base model that's scaled.

What each generator can already vary (its own settings, beyond the family settings) — these become the kinds' shape
settings, with the current defaults as the defaults so existing families make byte-identical models:

| Kind | Generator settings it already has | To add |
|---|---|---|
| wheels | spoke style (straight, paired, twisted, split, mesh, slot, holes), spoke width, taper, thickness, twist, concave, dish, lip, lip material, cap (flat, dome, none), cap material, nuts, beadlock, rivets, lean (mesh) | a centre piece from a kit |
| exhaust | tip shape (round, oval), cut (rolled, slash, straight), length | the slash's depth, the gap between tips, a tip from a kit |
| spoiler | uprights (straight, swan, struts, pedestal), end plates (up, down, long), gurney, thickness; second element | wing profile (thickness and camber), the end plates' shape (sweep), a set angle; profile, plates, angle and gurney **change downforce and drag** (formulas); end plates from a kit |
| intake | filter colour, reach, stack height | — |
| turbo | inlet (filter, pipe), manifold (cast, flange, equal), downpipe, hot side colour, filter colour | — |
| intercooler | tanks (side, top), tank size, fins (tube, bar), pipes, pipe and tank material | — |
| seat | height, depth, bolster, head wings, harness slots, fabric colour | — |
| steering_wheel | spoke (flat, slotted, drilled), quick release, flat bottom, rim thickness, marker colour | — |
| gauges | — (layout is a setting) | bezel, face and needle colours |
| body_kit | splitter reach (from depth), canards, diffuser length | strakes, side blades, splitter depth back, pieces from a kit (vents, canards) |

Bumpers, bonnets and side skirts aren't family kinds (they follow each car's curves and are modelled per car,
MODELLING_GUIDE.md). Their vents, splitters, lips and scoops come in through **kit pieces** (`assets/kits/<kind>/`):
small hand-made models with an attach point, mixed in by the aero kit's generator — the same mechanism the other
kinds use for end plates, centre caps and tips.

## 4. Decisions

- **One pipeline.** The builder's server code calls `tools/content/builder.mjs` (new), which uses `expandFamily`,
  `priceFamilyParts`, `buildContent`, `runChecks`, `verify`, `makeThumbnails` — the same modules `npm run content`
  calls. The CLI's new commands call the same `builder.mjs`.
- **Jobs** run in a worker thread (`tools/content/job.mjs`, imported, never a shell command). One job per family; at
  most `jobs.maxRunning` running (`data/content/builder.json`). A job that writes takes the pipeline's files for its
  whole run (shared files: `data/parts/index.json`, `checks.json`, `thumbs.json`), so two writers never interleave;
  previews write only to a temporary folder and run alongside. Before writing, a job copies everything it can touch;
  failed or cancelled, it puts it all back and removes what it added.
- **Every limit in config**: `data/content/builder.json` (variants per family, jobs, names, preview, warnings), the
  real-brand list in `data/content/real-names.json`, shape setting ranges in `formulas.json` (`shapeSettings`).
- **Shape settings in the family file** stay in its `shape` object (as now); a value can be a list (more parts, like
  a setting). Ids of existing parts don't change: a shape setting is in a part's id only when its family varies it.
- **Prediction = the build's own numbers**: the summary runs `expandFamily` and `priceFamilyParts` (what the build
  runs after making models) on the game's data; only a car that a fitted model can't be made to fit can differ (the
  build measures on the next car), and the summary says when that could happen.
