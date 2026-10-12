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

## Where things are

| | |
|---|---|
| `data/content/model-rules.json` | What a model must be: sizes, origins, budgets, LODs, KTX2, collision, dents, crash templates |
| `data/content/formulas.json` | Families' stats formulas and allowed ranges, finishes, engines, the economy rules |
| `data/content/tiers.json`, `balance.json` | Price and performance bands per tier; class limits |
| `data/content/standards.json`, `templates/` | The shared standards, and the car body templates |
| `data/content/check-rules.json`, `checks.json` | The automatic checks' rules and results |
| `data/families/`, `data/engines/` | Families and engines (what the build makes parts from) |
| `tools/content/`, `tools/blender/` | The pipeline's code, and the Blender add-on |
| `server/src/content/`, `admin/content.js` | The content manager (the admin page's Content tab) |

## When something's wrong

- **Import says a model still has problems**: read its *How to fix* lines. The original stays in `incoming/` until
  it passes.
- **`verify` fails in the pre-commit hook**: run `npm run content -- check` (and `npm run content -- build` if it
  says a part is out of date with its definition), then commit `data/content/checks.json` with your change.
- **Publishing is refused**: the reason is shown. Usually it's a failing check (open the part to see which), or a
  draft that would let a car past its class limit.
- **A part goes through a car**: the fit check names the car and what it goes through. Make the model fit, or
  leave that car out (`conflicts: ["car:<id>"]` with a note), if no player has it fitted there yet.
