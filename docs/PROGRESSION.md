# Rewards, difficulty, progression and finding quests (Phase 4 Step 5)

How quests are made quickly, what they pay and why, how players move up through them, how they find them,
and how all of that is checked: the balance simulation, the stress tests and the new player's end-to-end
test. The run itself (the quest session, timing, the HUD, results, validation) is [QUESTS.md](QUESTS.md);
drawing routes is [ROUTES.md](ROUTES.md); the editor and the content service are
[WORLD_CONTENT.md](WORLD_CONTENT.md); generated race tracks are [TRACKS.md](TRACKS.md). What still needs work: [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Making quests, series and routes (the editor, F2)

### A route

Draw it with the route tool (4): click waypoints on the roads, then **Save**. See [ROUTES.md](ROUTES.md)
for the options, the grid, checkpoints, shortcuts and test drives. Two things to know:

- **Keep it on the baked map.** A region's road graph reaches past the edge of its baked tiles (whole OSM
  ways), but the ground doesn't. A route with any of its line past the region's bbox (its manifest's) gets
  an error — *"… m of this route is past the edge of the baked map …"* — and can't be published.
- **Test drive it, and run an AI test race** before publishing. Problem spots (where AIs got stuck or
  crashed out) show on the map; [KNOWN_ISSUES.md](KNOWN_ISSUES.md) lists the ones known in the baked world.

### Route suggestions

**Suggest routes** (the content tools) scans the region's road graph for good racing roads: it walks from
the curviest stretches along natural continuations, scores each walk (corners and their sharpness up;
junctions, sharp turns at junctions, motorways and steep grades down; 1.5–8 km, about 4 km best) and
lists the best twelve that don't overlap, each with why it scored as it did. Only roads on the baked map
are used. **Draft route** makes one a draft route; **Draft route + quest** also makes a draft quest on it
from the chosen template. Nothing is published: review, test drive, then publish.
(`route/suggest.js`, `SUGGEST_DEFAULTS` for the scoring.)

### A quest from a template

**Templates** (`data/content/quest-templates.json`) fill a new quest's type, rivals, entry and whatever its
type needs: *Mountain sprint, 3 NPCs, medium*; *Mountain sprint, 5 NPCs, hard*; *City sprint, 2 NPCs,
easy*; *Time trial, solo*; *Checkpoint run, 3 minutes*; *Drift, 5,000 points*; *Delivery, fragile
cargo*; *Class C race, 4 NPCs, medium*. The name can use
`{road}` (the route's first road) and `{region}`. A template never sets money: the reward comes from the
quest's rating (below). Add a template by adding an entry to the file; `tests/unit/contentTools.test.mjs`
checks every template makes a valid quest.

### A series

A series (content kind `series`) is 3–6 published quests in an area. Place one, pick its quests in the
side panel, publish. Finishing every quest in it pays a bonus once (`data/economy.json` `series`: half of
what its quests' gold medals pay, in money and xp). The quest card shows the series and how many are done.

### Checking everything

**Check everything** (or `npm run validate-content -- --file export.json`) checks every quest, route and
series again — after a map rebake or a rules change — and lists what needs a look, with reasons:
roads under a route changed or gone, a route past the edge of the baked map, a rating out of date, a
route changed since its quest was published, a quest's route or a series' quest missing or unpublished,
items saved by an older version. It works on the items directly (no export file), so it copes with any
amount of content: 100,000 items in about a minute (`npm run stress:quests`). Exporting *everything* to
one file has a limit (a browser's longest string): past it, the export says so and asks for an area at a
time.

## What a quest pays (`data/economy.json` `quests`, `content/quests.js` `rewardsOf`)

A quest never stores money. Its **rating** is stored with it whenever it's saved or published
(`content/rating.js`): its stars and km, worked out from its route. Everything it pays follows from that:

```
core  = (base + perKm × km, at most maxKm km) × byStars[stars] × byType[type] × byClass[lowest class it lets in]
        × (1 + rivals × npc.perRival × (npc.skillFloor + the rivals' mean skill))
fee   = core × its tier's feeShare            (none for Rookie; pink slips: no fee, the car is the stake)
money = core + fee × fee.back                 (a gold run's: the fee comes back)
xp    = (base.xp + perKm.xp × km) × byStars[stars] × the same rivals factor
```

Of that, each run pays (`data/quests.json` `rewards`): each medal tier pays up to its share **the first
time** it's reached (finish 30%, bronze 50%, silver 75%, gold 100%; a better medal later pays the
difference); a run that reaches nothing new pays the **repeat** share (10%). XP the same way (finish 40%,
… gold 100% the first time; repeats 35%).

**Anti-farming** (`quests.farming`): within a 2-hour window, the first 3 runs of a quest pay in full; each
one after that pays 0.6× the one before, down to 15%. **Tiers** (`quests.tiers`): a quest's tier is
`floor((stars + its class's tier) / 2)` — Rookie, Club, Pro, Expert, Legend — and sets its entry fee
share, the level it opens at, and a pink slip's highest stake class.

## Difficulty (`quest/difficulty.js`, `data/quests.json` `difficulty`)

1–5 stars from points: each feature of the route (`route/stats.js` `routeFeatures`) scores its value /
full (at most 1) × its weight — length, corners per km, their sharpness, hairpins, climbing per km, the
steepest grade, the share on narrow roads, junctions per km, drops without a rail — plus the rivals (how
many and how good) and how tight the gold time is. The stars are how many thresholds the total reaches,
plus one. Hover the stars on the quest card to see what scored.

**Medal targets** come from the route's reference time (an AI test race's, else its estimate for the
starter car): gold at ×1.0, silver ×1.12, bronze ×1.3 (scores: ×1, 0.7, 0.4). A quest can set its own
(`params.medalTimes`, `params.medalScores`).

**Recommended car**: the performance rating (`garage/rating.js`) each star count asks for, within the
quest's class. The card shows it, and warns when your car is under `warnBelow` of it.

## Progression (`quest/rules.js`, `garage/player/quests.js`)

- **Level** from xp: reaching level L takes `base × ((L−1) + growth × (L−1)(L−2)/2)` xp (400, 0.25):
  level 2 at 400, 3 at 900, 6 at 3,000, 10 at 7,200.
- **Tiers open by level**: Rookie at 1, Club at 3, Pro at 6, Expert at 10, Legend at 15. A locked quest's
  card says why (*"Club quests open at level 3 (you're level 1)"*).
- About **15 first-time Rookie golds** take a new player to level 3 (a 2–3 km Rookie quest pays 50–65 xp,
  a series bonus 80 or so). A starting area needs that much Rookie content — see
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Finding quests (`quest/finder.js`, `play/questFinder.js`)

- **The full map (Tab)** has a panel: **Recommended for you** (up to 8: tier open, a car of yours that
  suits it, stars about right for your level, not yet gold, nearer first), **filters** (type, difficulty,
  distance, done or not, medal, suits my car) over every quest in every baked region, and the **regions**
  (each with its quest count; Travel).
- **Fast travel**: *Go* on any quest in a baked region. The loading screen holds until its start area is
  in and its route loaded, then the car is on its grid and its card opens. *Travel* goes to a region.
- **Nearby notice** while free roaming: passing within 250 m of a quest you haven't played, a small notice
  — at most one every 45 s, each quest once a session, never during a quest. Off in the settings
  (Races: *Nearby quest notices*).

## Polish

- **Sounds** (`play/questSounds.js`, made with Web Audio — no files): countdown beeps and GO; a chime at
  each checkpoint, rising when ahead of your best split and falling when behind (so it's heard, not only
  seen); lap, best lap and bonus chimes; a buzz for a missed checkpoint, a jump start or a drift lost; the
  finish; on the results, the medal's fanfare (gold the longest), a personal best, the reward's coins and a
  level-up, one after another. M mutes them with the rest.
- **Camera** (`play/cameraBlend.js`): free roam → the intro's fly-along → the race → a slow orbit round
  the car on the results → free roam, each change a short eased glide (times in `data/quests.json`
  `camera.transitions`). A new view more than 400 m away (a restart from the finish, fast travel) is cut
  to rather than swooped to.
- **First-time hints** (`data/hints.json`, once each, kept in the save): a quest's card, the first medal,
  the first race against rivals, a pink slip's card, the finder on the full map (and the damage hints from
  Phase 3). Click one to dismiss it; one that comes while another shows waits its turn. Settings →
  Accessibility: switch hints off, or *Show the hints again*.
- **Accessibility** (Settings → Accessibility, `play/palette.js`):
  - *Colours*: Standard, or Colour-blind friendly (Okabe & Ito: blue for ahead, orange for behind, and
    checkpoint and bonus gates, the route and the guide line told apart by brightness as well as hue).
    `tests/unit/polish.test.mjs` simulates protanopia, deuteranopia and tritanopia and checks every pair
    stays apart (the standard red and green don't, for deuteranopia: that's why the option is there).
  - *Route guides*: Normal, or More visible — bigger, brighter arrows on the road, taller gates that glow
    at night, a thicker route line on the maps and a bigger checkpoint arrow. Changes apply at once,
    mid-race too.
  - *HUD size*: 60–160%, for the driving HUD and the race HUD (also in the pause menu).

## Save data and versions

The profile is version 4 (`garage/player/migrations.js`: every older version migrates as it loads), ghost
recordings version 2 (`quest/recording.js`), world content version 3 (`content/migrations.js`: older items
are brought up to date as their cells load). `tests/fixtures/saves/` holds frozen older saves that
`tests/unit/saves.test.mjs` loads. A quest edited after publishing keeps its best times only if its route
didn't change; otherwise they're shown marked *older version of this route* and the first run on the new
route becomes the record.

## Checking the balance and the scale

### The economy simulation (`npm run economy-sim`)

A bot player starts with the starter car and the starting money and, for 8 hours of play at three skill
levels, does quests from a pool like real content (`data/economy.json` `simulation.pool`), crashes at a
realistic rate (paying the crash test suite's real repair bills), repairs, and buys upgrades and cars.
It writes `reports/economy.txt` and `reports/economy.html` (charts: money over time, income an hour by quest type, the
spending split, the quests that pay too much or too little) and checks the targets in
`simulation.targets`: first meaningful upgrade within 30 minutes, second car within 1–4 hours, repairs at
most half a typical race reward on average (never more than one), a skilled player earning 1.1–1.8× an
average one, nobody stuck, every quest type paying within 0.6–1.6× its tier's median an hour, and level
6–12 after 8 hours. To retune: change `data/economy.json`, run it again, until every target passes.

### Stress tests

- `npm run stress:quests` — **50,000 published quests, each with its own route**, on real roads in all six
  baked regions (routes from each region's road graph; Monaco and Stelvio packed with thousands within
  3 km). Checks: importing them; nearby queries in the densest place; the maps' marker updates; the finder
  (every quest in every region, opening the full map, changing a filter); the nearby notice; the editor's
  area queries, *Check everything* over all 100,000 items and exporting everything; and free roam at
  200 km/h through the densest area with the game's own content layer (queries, markers, the maps, quest
  cards popping up and their routes loading) — no frame's content work over budget, no memory growth.
  `--quests N` for a quicker look. The measurements, and the two that are still over target at this
  density (the nearby query re-run in the most crowded places, opening the finder): KNOWN_ISSUES.md.
- `npm run stress:content` — 50,000 markers (Step 1): queries, flying and driving, memory.
- `npm run test:npc -- --only dense` — an 8-car NPC race through San Francisco's densest baked tile
  (the biggest: Nob Hill) within the physics frame budget.
- `npm run test:world` — 20 km at 200 km/h through the streamed world (Map v3), no hitches.

### The new player, end to end (`npm run test:newplayer`)

A fresh save in San Francisco, with quests made the way the editor makes them (templates on real roads near
the start, published through the content service): the finder recommends the Rookie quests and not the
locked one; the player races NPCs in the physics; crashes for real into the test centre's wall (the damage
saved as the game saves it) and repairs it; earns money from the rest of a series and gets its bonus;
buys a part and fits it (more power); plays on until the Club tier opens and races a Club quest; and the
save reloads exactly. Nothing may log an error or throw. `--content` only makes and lists the quests;
`--only "<quest name>"` plays just that one.
