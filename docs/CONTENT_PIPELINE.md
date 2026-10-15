# The content pipeline

How cars, engines and parts get into the game (Phase 8 Step 3). Adding content is made of commands and buttons,
and each step is checked automatically, so you don't have to remember the steps. Where a step needs a decision
(a price, publishing), the tools tell you what to do next.

Everything here is fictional: the makers (Kugel Motorworks…), part names (Streetline, Mesh10…) and designs.
**Don't add a real make, model, logo or part brand**, or anything modelled on a real product, without asking the
owner first.

---

## The everyday jobs

### 1. A new part from a model (Blender)

1. **Install the Blender add-on** once: `npm run blender-addon` makes `tools/blender/dist/ognistrada_tools.zip`.
   In Blender: *Edit › Preferences › Add-ons › Install from Disk*, pick the zip, tick **Ognistrada tools**. Its
   panel is in the 3D View's sidebar (press **N**) › **Ognistrada**.
2. In the panel: **Set up the scene** (metres, unit scale 1.0). Choose **What it is** (spoiler, rim, bonnet…) and
   give it a **Name** (small letters, digits and `_`).
3. Model it at its real size, the car's front towards **−Y** in Blender, its left towards **+X**. **Place at
   origin** moves it so the point it attaches by is at 0, 0, 0 (each type's rule is in
   [MODELLING_GUIDE.md](MODELLING_GUIDE.md)).
4. **Check**: the same rules as the game's importer, in plain words with how to fix each one, for example:
   - *It's 120 m wide… Everything is 100× too big, so it was probably made in centimetres.*
   - *LOD1 has 3× too many triangles: 2,028, where its budget is 700 (35% of 2,000).*
   - *Material "Material.001" isn't a name the game knows…*
5. **Export for the game**: set **Export to** to the game's `incoming/` folder. It checks again and refuses a
   model that fails. Otherwise it writes `<type>_<name>.glb` with the game's export settings.
6. In the game's folder: **`npm run import`**. The importer checks the model, fixes what it safely can (removes
   cameras and lights, adds normals, compresses the mesh), checks it again, then makes:
   - the model in `assets/parts/…`, with a **level of detail** for far away (made by meshoptimizer; or yours,
     if you named objects `<name>__lod1`);
   - big textures (512 px or more) **compressed to KTX2**, so they take less memory on the graphics card;
   - for a part that can come off in a crash: **collision hulls** (the shape it has lying in the road) and **how it
     hangs** when it comes loose (its mounts, worked out from the model);
   - an icon, and a starting part file in `data/parts/…` with its **price and stats marked "to do"**. The shop
     doesn't sell it until those are filled in.
7. Fill in its price and stats. `data/content/tiers.json` has each tier's price and performance bands. Or make it
   part of a family (below) and they're worked out for you.
8. **`npm run content -- check`** (see *The automatic checks*), then **publish** it in the admin page's Content tab.

### 2. A family of parts (dozens of variants at once)

A family is one small file, `data/families/<name>.json`. It lists the settings (diameters, materials, sizes…) and
the finishes, and the build makes a part for **every combination**. For example, `streetline.json` (exhausts:
5 diameters × 2 materials × 3 finishes = 30 parts):

```json
{ "id": "streetline", "kind": "exhaust", "name": "Streetline",
  "settings": { "diameter": [57, 63, 70, 76, 89], "material": ["stainless", "titanium"], "tips": "dual" },
  "finishes": ["polished", "matte", "carbon"], "status": "draft" }
```

- **`npm run content -- build`** makes the models (fitted to each car where the kind needs it), icons and part
  files. Each part's **stats come from formulas** in `data/content/formulas.json` (`families.<kind>`), and stats
  stay inside the **allowed ranges** set there. Its **tier, price and unlock level** come from what it measurably
  does, using the economy rules (`formulas.json` economy, `tiers.json`), priced between the hand-made parts of the
  slot. A finish changes the look and multiplies the price.
- A part the family stops making is **retired**: it's no longer sold, but players who own one keep it.
- Change the family file, never the parts it makes. Ids don't change, so players' parts stay theirs.
- Its **shape** (how its models look: see *Shape settings and kits*), its cars left off (`leaveOff`: car → why) and,
  written by the builder when a change needs them, `idKeys` / `idOmit` (so a setting that starts or stops varying
  doesn't change the ids of the parts it still makes) are in the file too. The family builder makes and changes these
  files for you (*A family from the admin page*).
- Then **`npm run content -- check`** and publish (all the family at once: `npm run content -- status streetline
  --to published`, or in the Content tab).

### 3. An engine (and engine swaps)

One file in `data/engines/<id>.json`: its maker, layout (inline, V, flat, rotary), cylinders, displacement,
aspiration, idle and redline, character, **mount** (`long`, `trans`, `mid`) and its sound. The build works out
its torque curve (you can override points), mass, size (its **bay class**) and price, and makes a **crate engine**
part. It goes in **every car with the same mount and a big enough bay**, needs a clutch, gearbox and cooling
strong enough for it, and changes the car's weight and balance. Cars it physically won't fit under (through the
bonnet) are left out automatically, with the reason written in the part.

### 4. A new car

**`npm run content -- new-car <id> --type <hatchback|saloon|coupe|estate|suv|pickup|sports> [--name "…"]`**

- It starts from the **body template** for that type (`data/content/templates/`): its proportions, its standard
  sockets and **standards** (engine mount, bay size, bolt pattern, rim sizes, seat/steering/bumper/spoiler/exhaust
  mounts). Parts made to those standards fit it straight away.
- Without a model, it makes a **placeholder** in the type's proportions, so you can drive it at once. With
  `--model file.glb` (or later `npm run import -- incoming/car_<id>.glb`), it uses the real one. A new car's model
  must have **every socket** of the car it starts from, for example *Front bumper missing socket
  "socket_bumper_front"*. The add-on's **Add socket** makes them with the right names.
- It's a **draft**, given its class by how it rates. Drive it, fill in its to-dos (price, physics), check, publish.

### 5. Changing what's live (the admin page › Content)

The **Content** tab on the admin page (admins only) lists every part and car with its status and checks.
- **Search and filter** by slot, family, tier, status and problems.
- **Open one**: its checks, its stats with their allowed ranges, its history, and a **3D preview on any car it
  fits**, plus its studio thumbnail.
- **Edit** price, unlock level, tier, name or (for a family's part) its stats, **one or many at once** (pick
  several, "Price ×"). An edit is a **new draft version**. Players keep the published version until you publish
  the new one. Each edit is checked straight away: a price outside its tier's band, or a stat outside its range,
  is refused with the reason. **Live checks** (tier bands, class limits) run on it too.
- **Status**: draft → review → published. **Only published parts reach players** (the shop, the used lot, other
  drivers' cars). Publishing needs passing checks, and a part that fails stays as it was, with the reason.
- **CSV out and in**: export, change prices in a spreadsheet, import (try it first as a dry run).
- Every change is in the history and the admins' log, with who made it and why.
- **Players keep what was published.** Publishing keeps a copy of what players get (price, tier, unlock level, name,
  stats). If the part's files change later — its family changed and rebuilt, then deployed — players keep that copy, and
  the part shows as a new draft version ("changed in the files since it was published") until you publish it again. A
  changed model is the exception: models aren't kept per version, so a new shape shows once it's deployed.

### 6. A family from the admin page

The family builder: the admin page's **Builder** tab (admins only): New family, New engine, New car, Presets & variations, Jobs, and the families to change. It writes the same family file you'd write by hand
(`data/families/<id>.json`, in the same layout) and runs the same build and checks as `npm run content`, so a family made
there can be changed by hand or from the command line, and the other way round. It works in two places:
- **On the live admin page** (ognistrada.com): everything is worked out and previewed there; **Make** sends it to
  GitHub's `content-builder` workflow, which makes it (`npm run content -- run-job`: the same checks again), runs
  everything the pre-commit hook runs, commits it to `main` and starts the deploy — approve that on GitHub and its parts
  arrive in the Content tab as drafts to publish. About 15–20 minutes before the deploy; the Jobs list shows how it's
  going. (docs/DEPLOYMENT.md "The live Builder": its token.)
- **On your computer** (`npm run server:dev`): the jobs run there and write your copy's files; **commit them** (the
  pre-commit hook and CI check them as they check anything made with `npm run content`) and deploy.

1. **What it is**: pick the kind (exhaust, wheel, wing…: the kinds in `formulas.json`), or **start from** a family or a
   preset to copy its settings.
2. **Name**: type one, or **Suggest names** for invented ones in the style of the others. A name like a real make,
   model or part brand is refused, with the reason (`data/content/real-names.json`, fuzzily: Br3mbo and Rekaro too). The
   id comes from the name.
3. **Settings**: each with its allowed range shown; numbers as values or **from, to, step**; lists as ticks. A value
   outside the range can't be picked (nor saved through the API).
4. **Shape**: the kind's shape settings (see *Shape settings and kits*) with a **live 3D model** of a part as you change
   them, its triangles against the budget. Each one **fixed** for the family or **varied** (a part for each value).
5. **Finishes**, 6. **Aim** (the tiers, price range or unlock levels you want: optional), 7. **Fits** (the cars its
   parts go on, with a count; leave a car out with a reason — the family file's `leaveOff`).

As you go, the right-hand side shows **every part it would make** — settings × shapes × finishes — with its stats,
tier, price and unlock level, worked out by the build's own code before anything is made, and what to look at: parts
that can't be made (a stat out of its range, too little or too much for any tier: **Skip** them in one go), parts the
economy check would fail, parts that do the same as another family's, a shape all but the same as another family's, a
crowded tier, the aim it misses (and which settings to change to hit it), and over `families.maxVariants` parts.

- **Preview** makes a few parts' models (the smallest, the largest, one in the middle and one of each shape; or pick
  them) as the build makes them — fitted to the cars — with their icons and studio thumbnails, and shows each on a car
  in 3D. Nothing is saved as a part.
- **Make the family** writes the file as a **draft** and builds and checks it as a **job**: its progress and log (the
  command line's words) show as it goes, and you can cancel it. A job that fails or is cancelled **puts everything back**
  as it was and says why. When it's done, the Content tab shows the new parts with their checks: fix any that fail, send
  them to review, publish as usual. Nothing is published by the builder.
- **Change a family**: pick it on the Builder tab (or in the Content tab's Family filter › **Change … in the builder**). The same form, filled
  in from its file; before saving it lists the parts that will be **added**, those whose stats, price or model
  **change**, and those **retired** (with how many players own each: they keep them). Parts it still makes keep their
  ids, even when a setting starts or stops varying (the builder adds `idKeys` and `idOmit` to the file for that).
- **Save as preset**: the setup (kind, settings, shape, finishes, aim) under a name, in `data/content/presets/`. **Presets &
  variations**: from a preset or a family, several new families at once, varying the settings and shape settings you
  pick (new materials, a budget, middle and top build, new designs), each with an invented name and its summary;
  preview any, then make the ones you tick.
- **New engine**: every field of `data/engines/<id>.json` (the maker from the made-up makers in
  `data/content/builder.json`), with its torque curve, power, mass, bay class and price as you change them, and the cars
  it'll go in — and why not the others. **New car**: `new-car` as a form (a model is optional), then the placeholder in 3D.
- **Jobs**: everything running or done since the server started, with its log. At most `jobs.maxRunning` at once
  (`data/content/builder.json`); one per family; a job that writes files has them to itself while it runs.
- Every action is in the history and the admins' log, with who and why.

### 7. Shape settings and kits

A family's **shape** (`shape` in its file) is how its models look, beyond the settings that make them: a wheel's spoke
style, dish and lip; a wing's uprights, profile and end plates; an exhaust's tip shape and cut; a seat's bolsters and
head wings… Each kind's shape settings and what each may be are in `formulas.json` (`families.<kind>.shapeSettings`):
a range, a list of values, a table, or a **kit piece**. `npm run content -- shapes <kind>` lists them.

```json
"shape": { "spoke": "split", "dish": 0.03, "cap": ["flat", "dome"], "centrePiece": "spinner" }
```

- A value fixes it for the family; a list makes a part for each (in their ids, like a varied setting). Left out: its
  default — the look the kind had before shape settings, so every family made before keeps its exact models.
- **Shape settings that change what a part does** are marked `stats: true` and used by the kind's formulas (a wing's
  profile, end plates, set angle and gurney change its downforce and drag); their stats are kept in their allowed ranges
  like any other. The rest only change the look.
- The models are made in code from these settings, the same every time (the same family file, the same bytes), at the
  right size and origin for the kind, fitted to each car where the kind needs it, and through the same checks as an
  imported model (model rules, levels of detail, compressed textures, collision hulls for what comes off, thumbnails,
  the fit check). A model that fails isn't made, and the build says why. `npm run test:shapes` makes every kind at the
  ends of every shape setting's range and some random mixes, and checks each.
- **Kit pieces**: where a shape is better modelled than made in code, model a few pieces in Blender and the generator
  mixes them in: a wing's end plates, a wheel's centre, exhaust tips, a piece on each front corner of an aero kit. In
  the Blender add-on pick **Kit piece: …** as what it is (its own checks and attach point), export
  `kit_<kind>_<attach>_<name>.glb` to `incoming/` and `npm run import`: it's checked and put in
  `assets/kits/<kind>/<attach>_<name>.glb`, and from then on it's a choice for that kind's kit shape setting. How to
  model one: [MODELLING_GUIDE.md](MODELLING_GUIDE.md) › Kit pieces. `npm run sample-models -- --kits` writes the four
  starter pieces.

---

## The automatic checks

**`npm run content -- check`** checks every new or changed part on **every car it fits** (unchanged parts keep
their results). The results go in `data/content/checks.json` and show in the Content tab:

| Check | What passes |
|---|---|
| **fit** | Fitted as the shop fits it (with what it needs), it goes through the body or other parts no more than the car's own stock part there does; what bolts onto the engine may touch it where it mounts |
| **drive** | 0–100 km/h and 100–0 at the test centre: finished, everything real numbers, the car upright |
| **crash** | Into the wall at 60 km/h: damage and repair as real numbers, the repair no more than 2 race wins |
| **sound** | It sounds, isn't silent or clipping, and changes as its settings say (an engine: its cylinders and revs) |
| **budget** | Its models against the model rules (triangles, levels of detail, textures, file size) |
| **economy** | Its price in its tier's band, what it does in its tier's band, and not far better value than the slot's hand-made parts |
| **ranges** | A family's stats at the top and bottom of their allowed ranges still drive |
| **classes** | Every car's most powerful build (drafts included) at most `maxClassJump` classes above stock. A draft that would break it is blamed and held back |

The rules are in `data/content/check-rules.json`. **A part that fails can't be published.** It also makes the
thumbnails of what changed.

**Known problems** (`check-rules.json` fit.known): four combinations that players already had before the checks
existed go through the body today, for example the V8 swap in the Kaze GT through its bonnet. They're kept, with
their limits and reasons (shown in the Content tab and in [KNOWN_ISSUES.md](KNOWN_ISSUES.md)), until they're
fixed. Leaving them off now would make those players' cars undrivable. Nothing new can be added to that list.

**`npm run content -- verify`** checks, without running anything, that every part is up to date with its definition
and its checks are current and passing for everything players have. **The pre-commit hook and CI run it**, so
content can't go out unchecked.

---

## Models in the game

- **Levels of detail**: a far car is drawn in one piece from each model's LOD1 (35% of the triangles here).
  `data/content/model-rules.json` lods sets the share and which models get one (600+ triangles).
- **Compressed textures (KTX2)**: big textures stay compressed on the graphics card. The game fetches the decoder
  only for a model that has one.
- **Collision**: a part lying in the road collides as its convex hulls, not a box. With CoACD installed (`pip install
  coacd`), hulls are CoACD's; without it, the built-in splitter's.
- **Dents**: the model check says if denting a part would need too fine a copy (a stutter on the first crash).
- **Studio thumbnails** (`assets/thumbs/`, `npm run content -- thumbnails`): body parts, wheels, aero and exhausts
  are shown fitted to a car; other parts are shown on their own. Each one is made again only when something it
  shows changes.
- **Content bundles** (built with the site, `tools/content/bundle.mjs`): the game reads all its car and part data from
  **one file named by its content** (cached for good, a new name when anything changes) instead of ~700 files.
  Every model is fetched **at an address with its version** only when it's drawn, and kept in the browser's cache,
  so a returning player downloads only what changed. Old versions are dropped from the cache.

---

## Targets

`data/content/targets.json`: a **50+ variant family made and checked in under an hour**, and a **new car playable
from its template** (the pipeline's part in minutes; with the modelling, under a day).
**`npm run content -- targets`** measures both and records the result in the file.

---

## Commands

| Command | What it does |
|---|---|
| `npm run blender-addon` | The Blender add-on as a zip to install |
| `npm run import [-- files…]` | Models in `incoming/` checked, fixed, finished and put in the game |
| `npm run check-models` | Every model in the game against the model rules |
| `npm run content -- build [ids…]` | Every family's and engine's parts made (or just these) |
| `npm run content -- check [ids…]` | The automatic checks on what's new or changed (`--all`: everything) and its thumbnails |
| `npm run content -- verify` | Everything made and checked? (the pre-commit hook and CI) |
| `npm run content -- new-car <id> --type <type>` | A new car from a body template |
| `npm run content -- status <ids, a family or engine…> --to <draft\|review\|published>` | Status in the files |
| `npm run content -- report` | Every family and engine: parts, tiers, prices, statuses, what's failing; the cars' classes |
| `npm run content -- targets [family]` | Measure the targets |
| `npm run content -- thumbnails [ids…] [--all]` | Studio thumbnails |
| `npm run content -- finish [ids…]` | What the importer does, done to models already in the game (LODs, KTX2, hulls) |
| `npm run guide` | The modelling guide's tables and the add-on's rules, from `model-rules.json` |
| `npm run content -- new-family --kind <kind> --name "…" [--set key=a,b] [--set key=from..to/step] [--shape key=v] [--finishes a,b] [--aim-tiers sport] [--dry-run]` | The family builder from the command line: every part it'd make, then the family made as a draft (a job: put back if it fails). `--from <family>` / `--from-preset <name>` to start from one; `--suggest-names` |
| `npm run content -- preview <family> [part ids…] [--out dir]` | A few parts' models, icons and thumbnails, as the build makes them (nothing saved as a part) |
| `npm run content -- variations <preset or family> --vary <setting,…> [--count n] [--seed n] [--make]` | New families from one, varying those settings: what each would make; `--make` makes them |
| `npm run content -- presets [--save <name> --from <family>]` | The builder's presets (`data/content/presets/`) |
| `npm run content -- shapes <kind>` | A kind's shape settings, what each may be, and its kit pieces |
| `npm run content -- run-job <request.json> [--message file]` | A request from the live admin page's Builder, made here (what the `content-builder` workflow runs): checked again with the same code, then made as jobs |
| `npm run test:shapes [kinds…]` | Every kind's generator at the ends of every shape setting's range (and random mixes): model rules, budget, fit on every car, drive and crash for those that change stats |
| `npm run test:content-builder` | The family builder end to end: a family made as a job, its file and parts as the builder said, verify and the pre-commit hook; then changed (ids kept, retired as said); everything put back |

## Where things are

| | |
|---|---|
| `data/content/model-rules.json` | What a model must be: sizes, origins, budgets, LODs, KTX2, collision, dents, crash templates |
| `data/content/formulas.json` | Families' stats formulas and allowed ranges, finishes, engines, the economy rules |
| `data/content/tiers.json`, `balance.json` | Price and performance bands per tier; class limits |
| `data/content/standards.json`, `templates/` | The shared standards, and the car body templates |
| `data/content/check-rules.json`, `checks.json` | The automatic checks' rules and results |
| `data/families/`, `data/engines/` | Families and engines (what the build makes parts from) |
| `data/content/builder.json` | The family builder's limits: parts per family, jobs, names, previews, warnings, variations, engine makers |
| `data/content/real-names.json` | Real makes, models and part brands no name may be like |
| `data/content/presets/` | The builder's presets |
| `assets/kits/<kind>/` | Kit pieces the model generators mix in (`model-rules.json` kits: their attach points) |
| `tools/content/builder.mjs`, `jobs.mjs`, `preview.mjs`, `names.mjs` | The family builder (the admin page and the command line), its jobs, previews and names |
| `tools/content/`, `tools/blender/` | The pipeline's code, and the Blender add-on |
| `server/src/content/`, `admin/content.js`, `admin/builder.js` | The content manager and the family builder (the admin page's Content tab) |

## When something's wrong

- **A builder job failed**: its log (the Builder tab › Jobs) says why, in the command line's words; nothing it did is
  kept. Change the family and make it again.
- **Import says a model still has problems**: read its *How to fix* lines. The original stays in `incoming/` until
  it passes.
- **`verify` fails in the pre-commit hook**: run `npm run content -- check` (and `npm run content -- build` if it
  says a part is out of date with its definition), then commit `data/content/checks.json` with your change.
- **Publishing is refused**: the reason is shown. Usually it's a failing check (open the part to see which), or a
  draft that would let a car past its class limit.
- **A part goes through a car**: the fit check names the car and what it goes through. Make the model fit, or
  leave that car out (`conflicts: ["car:<id>"]` with a note), if no player has it fitted there yet.
