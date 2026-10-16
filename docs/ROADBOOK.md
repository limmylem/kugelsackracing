# The ROADBOOK, Expeditions and Season Tokens

Three systems, one job each:

- **ROADBOOK**: the player's seasonal journey (chapters, challenges, progress) and their permanent Personal History.
- **Expeditions**: multi-stage adventures in the open world: drive to real places on the map.
- **Season Tokens**: a seasonal currency earned by playing and spent in that season's shop.

Rewards are cosmetic only. Nothing in the ROADBOOK or the shop makes a car faster.

## How it fits together

```
game systems on the server ──events──▶ ROADBOOK service ──▶ roadbook_progress, token_ledger, player_items, player_history
  (economy: quest checked, car bought,    (server/src/roadbook/service.ts,
   part fitted; multiplayer result;        rules: roadbook/engine.js + expedition.js + geo.js)
   photo saved)                                     ▲
the game ──pings (positions, twice a second)────────┘     GET /roadbook ──▶ the journal (ui/roadbook.js), the HUD (play/roadbook.js)
```

- **The server decides everything.** Points, tokens, Expedition progress, purchases and rewards change only on the
  server. The game shows them, and sends where the car has been. It never says what it did: races, purchases and part
  fits are heard from the server's own economy (`economy.events`, after the action has been checked), multiplayer
  results from the race server's confirmed results, photos when the server saves one.
- **Positions** (`roadbook/geo.js`): the game sends the positions since its last ping, twice a second (at most 40). The
  server works out distance, places reached and Expedition stages from them itself. A step faster than 110 m/s is a
  jump (a teleport, fast travel or a made-up position). It counts for nothing, and nothing is believed until 200 m
  have been driven since. A ping sent twice counts once, by its samples' times.
- **Tokens are a ledger** (`token_ledger`): every row is a change with its reason, and a key that can be used once a
  season. An award, a purchase or the season's end can't happen twice, however often it's asked for. Every write
  also carries an Idempotency-Key, so the same request sent twice gets the first answer.
- **Everything is tagged with its season id**, so a season can be archived later.

## The season's clock

| Status | Who sees it | How it moves on |
|---|---|---|
| `testing` | admins and editors only | It starts when sign-ups open to everyone (the admin page's **Launch** tab: "Open sign-ups to everyone"), or an admin presses **Start the season now** on the **ROADBOOK** tab. A season whose `start` is a date starts on that date. |
| `live` | everyone | It ends `lengthDays` after it started. From `warningDays` before the end, the journal warns that leftover tokens become cash, and shows the rate. |
| `ended` | everyone (nothing more is earned; the shop is closed) | Each player's leftover tokens become cash at `conversion.cashPerToken` (a ledger row in the economy, `season-end:<season>`), once. Tokens never carry over. |

When a season starts, what admins and editors did while testing it (its progress, tokens and purchases) is cleared,
so they start with everyone else.

## Adding things (data files; the admin page's ROADBOOK tab edits the same things live)

Everything is data: a new season only needs new files. The files are where the server starts. After that, the live
copy is the admin page's **ROADBOOK** tab, which keeps versions with who changed what and why, and can roll back.
A deploy's new files (a new season, a new place) are added to the live copy, and nothing already there changes.
`npm run check` checks every file (`bundleProblems` in `roadbook/engine.js`), and so does the admin page before a
change goes live.

- **A challenge**: add it to `challenges` in `data/seasons/<season>/season.json`:
  ```json
  { "id": "ah_win_5_drift", "chapter": "the_underground", "style": "racing", "name": "Sideways", "description": "Win 5 drift events.",
    "goal": { "event": "race_finished", "where": { "win": true, "questType": "drift" }, "count": 5 }, "points": 60, "tokens": 40 }
  ```
  - **Events:**
    - `race_finished` { questType, medal, place, win, mp }
    - `part_installed` { partId }
    - `car_purchased` { carId, used }
    - `car_sold` { carId }
    - `photo_saved`
    - `distance_driven` { metres, carId }
    - `place_discovered` { place, hidden }
    - `expedition_stage` { expedition, stage }
    - `expedition_completed` { expedition }
  - **Goals:**
    - `count`: that many events
    - `sum` + `target`: a field added up, e.g. `"sum": "metres", "target": 500000`
    - `unique` + `count`: that many different values of a field
    - `streak`: that many in a row. An event that doesn't match starts it again; one with no value for a `where` key, such as a time trial with nobody to beat, neither counts nor breaks it.
- **A chapter**: add it to `chapters` with `unlockAt` (season points) and `milestoneTokens` (paid once all its
  challenges are done). Players never need every challenge to open the next chapter.
- **An Expedition**: add a file `data/seasons/<season>/expeditions/<id>.json` (copy `midnight_run.json`) and its id to
  the season's `expeditions`.
  - **Stage types:**
    - `reach`: get to a place; its marker is shown
    - `clue`: get to a place from a clue; no marker until within `revealWithin` m, with a hint after `hintAfterMin`
    - `collect`: drive through every item, in any order
    - `checkpoints`: a timed run, in order, `timeLimitSec` from the first checkpoint; late, and it starts again
  - **Places** are latitude/longitude, and must be on roads in the map. Check them in the editor's map, or with the
    Adelaide road graph in `assets/map/adelaide/v4/graph.json.gz`.
  - **Co-op:** `party` is `{ min: 1, max: 1 }` (solo) for now. Co-op Expeditions would add a party to the progress
    rows; the data already says how many may drive one.
- **A shop item**: add it to `items` in `data/seasons/<season>/shop.json`:
  - `price` in tokens
  - `grants` for what it unlocks:
    - `finishes`: a finish in `data/finishes.json` with `"locked": true`. Only owners can paint or refinish with it; the server refuses anyone else.
    - `photoFilters`: photo mode's filters
    - `badges`: shown on the profile card
- **A place to discover**: add it to `data/places.json`. `hidden: true` places aren't listed until found, and pay the
  season's `discoveries.hiddenTokens` once a season.
- **A new season**: a folder `data/seasons/<id>/` with `season.json`, `shop.json` and `expeditions/`, its id in
  `data/seasons/index.json` `seasons`, and `current` set to it when it should take over. The admin page's **Add a new
  season** does the same on the live copy.

## The admin page's ROADBOOK tab

The admin page's **ROADBOOK** tab (`admin/roadbook.js`) edits everything above without touching a file. It has:

- **The season's clock:** status, dates, days left, players, tokens earned and spent, items sold.
  - **Start the season now** shows while testing.
  - **End the season now** shows while live. Its confirm shows the conversion rate, and it can't be undone.
- **Plain forms for:**
  - **Season:** name, tagline, colour, start, length, warning, conversion rate.
  - **Chapters.**
  - **Challenges:** the goal's event, the kind of goal, and the conditions as rows.
  - **Expeditions and their stages:** a latitude box takes a pasted "lat, lon" or a Google Maps link.
  - **Shop items and their grants.**
  - **Places.**
  - **Raw JSON** for anything else.
  - **Add a new season**, and which season is current.
- **Checks as you edit:** the same ones as the server. The save bar lists what changed, needs a reason, and saves a new version, live at once.
- **Versions:** who, why and when; view any one; roll back to it.
- **Season Tokens:** give or take a player's tokens, with a reason.

## The balancing numbers

All in the data:
- **Challenges:** points and tokens, in `season.json`.
- **Chapters:** unlock points and milestone tokens, in `season.json`.
- **Season settings:** length, warning, conversion rate and hidden-place tokens, in `season.json`.
- **Expedition stages:** points and tokens, and time limits, in the Expedition files.
- **Shop prices:** in `shop.json`.

The After Hours season as shipped:

| | Points | Tokens |
|---|---|---|
| 13 challenges | 950 | 555 |
| Chapter milestones (3) | – | 600 |
| The Midnight Run (5 stages) | 250 | 1,000 |
| Hidden places (5 × 100) | – | 500 |
| **All of it** | **1,200** | **2,655** |
| The shop (6 items) | | 3,750 |

Chapters open at 0, 120 and 320 points. The end-of-season rate is 1 token = $2 (a race win pays about $1,500).

## Testing it without playing it

**Console commands** (in the game, `kr.roadbook`):
- `.fire('race_finished', { win: true, medal: 'gold', questType: 'sprint' })`: a fake event
- `.tokens(500)`: give tokens
- `.nextStage()`: start the Expedition if needed, teleport to the next stage and count arriving there. A teleport alone never counts, so this also tells the server it was driven.
- `.endSeason()`: end the season early, which turns tokens into cash
- `.show()`: open the journal

The commands use `/api/v1/roadbook/dev/*`. Anyone signed in can use them on a development server, but only admins can
on the live one. The admin page's ROADBOOK tab can also start or end the season and give a player tokens. Every admin
action is in the admins' log with its reason.

**Tests:**
- `tests/unit/roadbook.test.mjs`: the rules. `npm run test:unit`
- `server/test/roadbook.test.ts`: the server end to end. `npm run test:server`

## Not built yet

- A premium ROADBOOK, premium credits and real-money purchases.
- A scrap currency, community events and player-made challenges.
- Co-op Expeditions, season retrospectives and daily login rewards.
- A "repair a stranded vehicle" stage: damage and repair exist, but there's no way to place a broken-down car in the
  world for a player to find and fix.
