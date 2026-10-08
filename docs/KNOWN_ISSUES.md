# Known issues, and what to revisit

As of Phase 7 Step 3 (car-to-car contact, first), Step 2 (multiplayer races), Step 1 (multiplayer's networking), then Phase 6's deployment step (going online, then Step 2's server-owned economy, then Step 1's server and
accounts, below first); Phase 5's and Phase 4's entries as they were at their ends. Each with what was seen and where; the tests named reproduce them.
How quests, rewards and progression work: [PROGRESSION.md](PROGRESSION.md).

## Phase 7 Step 3: car-to-car contact (docs/CONTACT.md)

### Fixed on the way (found by the contact tests)

- **A contact timed on a stale clock.** The physics' time was turned into the race's clock with an offset taken once,
  on the grid — while the stamp clock was still settling after joining. At 250 ms ping the game reported contacts
  ~140 ms early, where the race server's record didn't have the cars touching, and refused them. The offset is
  read afresh every frame now (the game's race did; the test bots didn't).
- **Prediction capped below the states' age.** A remote car's newest state is a round trip and a tick or two old
  (~350 ms at 250 ms ping); prediction stopped at 250 ms, so the other car was hit ~2.5 m from where it was.
  `maxPredictMs` is 400 now, and the server's pairing window widens by the two players' lag.
- **A knock taken as acceleration.** The remote car's prediction carried on the jump in speed of a hit as if the
  car kept accelerating (capped at 15 m/s²): drawn 2–3 m off for a moment after every hit at high ping. A change over
  4 g is a knock now, not an acceleration.
- **A long rub fought by its own correction.** The agreed result for rubbing was the push each game had applied by
  its report; the rub carried on, and the "correction" pushed the car back into the other. Rubbing is now one
  contact for as long as it lasts, the agreed result for it carries no impulse, and the verifier checks each rubbing
  push against the cap instead.
- **The bots reversed on the grid.** The brake held at a standstill engages reverse with the automatic box; the test
  bots held the brake through the countdown and backed 50 m, going the wrong way (ghosted). Held by the handbrake.
- **`Math.log` was NaN with the deterministic maths.** stdlib's `log` is a logarithm to a base, `log(x, b)`; the
  natural log is its `ln`. Installed as `Math.log`, every log was NaN — nothing in the physics uses it, but the engine
  sound does, and the game's frame stopped on the error (found by the browser race test: the lights and the race HUD
  never drawn). Mapped to `ln` now; `tests/unit/detmath.test.mjs` checks every function against the platform's.
- **The run's trail on a slow computer, and on a real-world route.** It assumed each physics step was 1/120 s of the
  race's clock (a game whose physics falls behind real time isn't) and was kept in the physics' floating-origin frame
  (the race server's record is in the world's). Each point is stamped on the race's clock and kept in the world's
  frame now; and a rubbing push's direction is checked against the race server's record of both cars, not the push's
  point (found by the browser race test).
- **A game at a few frames a second was touchable.** It sends its car once a frame — every 2.5 s at 0.4 fps — so the
  others' proxies of it were seconds stale, and its own physics, catching up a second a frame, fell behind the race's
  clock. Such a car is ghosted now (`maxStateGapMs`), and the run's trail is checked for where the car was rather than
  exactly when (found by the browser race test, whose software-drawn windows ran at 0.4 fps in this container).
- **Race damage didn't reach the others.** A crash into a wall in a race (not free roam) wasn't sent to the other
  players, nor were parts torn off. Both go on the race's connection now.

### Things to know

- **Through the knock itself, each game is blind to the other's reaction for a round trip.** It predicts it (the
  push it gave, by the other car's mass) and hands over to the real states smoothly; the tests allow 1.5 m plus 6 mm
  per ms of ping between where each game draws the other car and where it was, through a hard hit (worst seen: 1.7 m
  at 250 ms; a car braking hard into a hairpin is drawn up to ~1.1 m wide at any ping). Once it's over, both games
  agree: the cars at rest within 0.3 m in every scenario at every ping (the check: 0.5 m).
- **Seen once: a spinning car drawn 5.2 m off for a moment.** In one full run of the contact tests, the spin into
  another car at 250 ms ping had the spinner drawn 5.2 m from where it was, 0.16 s after the hit (the check allows
  3.0 m). It wasn't seen again in 15 more runs of that scenario, alone and after the others (worst 2.1 m, at about
  0.35 s, as usual). It is only what was drawn: the agreed contact, the damage and where both cars came to rest
  matched in that run too. The test now says when the car's own frames were far apart at the worst moment (a pause
  in the test's one process, which runs both games, the race server and the network), so the next one shows whether
  it was that.
- **Real-world routes aren't replayed** (their collision streams in, so they aren't deterministic yet): a run there
  is checked on its pushes against the race server's log and on where the server saw the car (checks 1–5 in
  CONTACT.md "Verification"), not driven again.
- **A run's damage, aids and parts are the client's word**, recorded as they changed (the replay applies them at the
  same step). The server checks the impulses that caused contact damage, not the damage model's output.
- **The replay takes about 1/16 of the race's length** (a 3-minute run in ~11 s), in a worker thread beside the API,
  one run at a time. A busy server would want more workers.
- **NPCs in a race are ghosts** to players (they're driven by the server; contact with them isn't modelled).
- **Ramming evidence is kept in full** (both cars' last `replaySec`, a few tens of kB gzipped) with no expiry yet.

## Phase 7 Step 2: lobbies, matchmaking and races (docs/MULTIPLAYER.md)

### Fixed on the way: a route read back from the database could look changed

A route's version (`route/model.js routeVersionOf`) hashed its stored path as JSON, and Postgres's `jsonb` hands an
object's keys back in its own order — so the same route, read back, could have another version, and every run on
it failed its check ("The route has changed since the run started"). Found by the bot races (a party's race,
disqualified at random). The path's keys are now put in a fixed order before hashing (`canonPath`). This also fixed
a latent Phase 6 bug: runs on generated tracks checked after an API restart.

### Fixed on the way: concurrent queries on one transaction

`server/src/economy/store.ts loadProfile` sent four queries at once on a transaction's single connection. pg queued
them, so it worked, but pg 9 will refuse it (the deprecation warning in the bot races). They're one after another now.

### Not in this step

- **Collisions between players**: ghost mode only (Step 3 — done: docs/CONTACT.md).
- **Pink slips between players**: none (nothing a player owns can be lost to another player).
- **Real-world route runs aren't replayed input by input.** A multiplayer run on a route is checked on its gates,
  laps and times (Phase 6 Step 3's checks on the race's quest), against the race server's own timing of the same
  run (within 300 ms), and the server's live flags; a generated track's run is replayed as in Phase 6.
- **Regions**: one ("local") until the game is online; the queue's ping is the round trip to this computer's
  real-time server.

### Things to know

- **A computer that draws slowly** keeps real time in a race: the physics catches up each frame (up to a second of
  it, instead of the usual 8 steps), because a race is timed on the server's clock. Only a computer whose physics
  itself can't keep up would race slower. With no graphics card (software drawing, as in the browser tests and CI),
  the city draws at 2–4 frames a second at the race venues downtown; the tests load less of it (`?view=600`: the
  world 600 m round the car instead of 1.4 km). A player can use `?view=` too.
- **Found by the browser test:** the lobby's connection was closed as idle after 15 s (nothing was sent while no cars
  were drawn); the start lights showed outside the countdown (CSS overrode their `hidden`); other players' cars each
  carried two real headlight lights (a race's worth of cars made every pixel slower: now one shared pair follows the
  nearest car with its lights on); leaving free roam could wait for ever on a room already gone; and the test's own
  "is it drawn" check had trusted the `hidden` attribute instead of what the browser computed. Then, with the race
  driven to the end in both windows:
  - joining a race's lobby closed your own free-roam connection as if it were another tab ("You joined from another
    tab or device"), and free roam coming back after a race could close the race's connection the same way. One
    connection per account now holds among rooms of one sort (free roam; races), not across them;
  - a rematch's cars were refused by the live checks ("moved too far": the jump back to the grid, measured against
    the last race's states); each race's grid now starts the checks afresh;
  - at about one frame a second a run could be timed half a second off the server's own timing of it, and
    disqualified: the game now times the run on the same clock its states are stamped with, and that clock is steered
    towards the server's by the time passed rather than by the frame;
  - **a quick race never started from the game**: matched, the game took its reserved seat with no address for the
    real-time server (a reserved seat takes no ticket, and the browser has the address from its tickets), failed at
    once, and the empty race closed. The bots had been given the address, so their races worked. The queue's address
    now goes with the seat, and the bot races find the server from their tickets as the game does;
  - leaving a lobby kept its state, so the next quick race looked matched at once;
  - the account chip covered the results' Rematch button.
- **TV cameras on real-world routes** are simple: beside the route every 170 m, up 7 m, on the outside of the bend.
  A building can come between one and the car. Generated tracks use their own placed TV cameras (Phase 5).
- **The lobby offers the official routes** (`data/multiplayer.json` venues.routes, one a baked region) and random,
  the official tracks or a track code. Other published routes can be set through the lobby's settings message, not
  picked from a list yet.
- **Reporting from the lobby** asks for the reason in the browser's own prompt box.
- **The 2,000-bot load test is the matchmaker's**: 2,000 players queue at once, are matched and take their seats
  (262 race rooms), then leave. It doesn't race 2,000 players at once: the bot races cover races (8 at a time) and
  Step 1's tests cover a room's ticks (256 players).
- **Bots in the tests are kinematic** (`mp/npc.js`: a speed plan along the racing line), timed by the same
  QuestSession as a person's run. The NPCs that fill a lobby are the same, driven by the server.

## Phase 7 Step 1: multiplayer networking (docs/MULTIPLAYER.md)

### Fixed: two windows on one computer didn't see each other

Reported after Step 1: `docker compose up`, `/?mp` in two windows side by side; the banner said 2 players, but
neither window showed the other car. Found with `server/tools/mp-two-windows.ts`, which reproduces it (and fails 10
of 11 checks on the code before the fix):
- **The same account twice.** Two windows of one browser share its sign-in, so the second window replaced the
  first (`ELSEWHERE`). The first went offline with a five-second notice, so its car was never sent. The "2
  players" was the second window's join banner, from the moment before the first was replaced. Now the replaced
  window keeps a banner saying why, and in development `?mp&player=A` / `?mp&player=B` give each window a guest of
  its own.
- **On top of each other.** Every new car arrives at the same place, so with two different players each car was
  drawn inside the other. Now the later one moves beside the first.
- **Background windows dropped.** A window that isn't drawing sent nothing, and the server removed it after 15 s.
  Its states were also refused, because the physics step hadn't moved on, which also hid any player with the
  settings open. Now a worker keeps it connected and its car shows as paused; the same step again is accepted.
- **A closed or reloaded window** left its car behind as "reconnecting…" for 20 s. It now leaves at once.
- **Slow machines** caught up with a car's delay at a rate set per frame, so at a few frames a second other cars
  trailed for many seconds. It's now per second.

Why the earlier tests missed it: `mp-browser.ts` used two separate browsers with two accounts, in the proving
ground. It checked where the network code said the other car should be, not what was drawn.



Two real browsers on this computer see each other smoothly in the same room, on a clean network and at 150 ms,
30 ms jitter and 5% loss (`server/tools/mp-browser.ts`). The check with two players on different real networks
(home Wi-Fi and a phone hotspot) needs the real-time server online. It's in docs/DEPLOYMENT.md "To do when we
deploy" 9, together with choosing where it runs and a Redis (both cost money: ask first).

### Other cars are shown 0.4–0.75 s in the past on a bad network

At 150 ms, 30 ms jitter and 5% loss over WebSockets, a lost packet holds up everything behind it (TCP), so the
buffer grows to about 750 ms to stay smooth. Over datagrams it's about 380 ms (`rt-test.ts` measures both). On a
good network it's about 100 ms. This is fine for free roam. For close racing (Step 3), move to WebTransport
datagrams; everything above the transport already handles them. Your own car is never delayed.

### Other cars don't collide with yours yet

They're drawn kinematically: they pass through your car. Collisions between players are Step 3.

### A modified client could drive slightly better than its car allows, live

The live checks (docs/MULTIPLAYER.md "Live checks and after-race checks") catch impossible states: too fast,
teleporting, too many messages. They can't catch a car with a few percent more grip. Results are still decided by
the replay (Phase 6 Step 3), so this affects only what other players see live.

### The browser test draws at a few frames a second here

This computer's Chromium renders in software (SwiftShader), so each test page draws the world at 2–4 fps. The
pages check what they can at that rate: the other car seen and moving, wheels, brake lights, sound, dents and
reconnecting. Smoothness is measured by a third, headless player watching both cars at a steady 60 fps through
the same network code. The pages check it themselves only when they reach 20 fps, which a machine with a GPU will.

At 2 fps (this computer on a slow day), `mp-browser.ts` can fail one check, "Ben sees Ana's car, drawn and moving"
at the target bad network: Ana drives only a few metres in that phase. It fails the same way on the code before
the two-window fix, and passes at 3 fps or more.

### Fixed on the way: the test track's road (since Phase 5 Step 4)

`testtrack/test-scene.js` had a local variable `roadMesh` that hid the function of the same name, so building the
proving ground's road threw "roadMesh is not a function". It has been renamed (`trackRoad`). Found by the
two-browser test, the first to open the proving ground in a browser since then.

## Phase 6: going online (docs/DEPLOYMENT.md)

### On free plans: sleeping servers, short database history

Everything runs on free plans while it's one person testing (docs/DEPLOYMENT.md "Free plans: what to watch").
- **The API sleeps** after 15 minutes without a visit and takes about a minute to wake.
- **Database history:** Neon keeps 6 hours of it to restore from. The daily backup covers the rest, so at worst a
  day's progress is lost.
- **Email:** at most 100 a day.

**Upgrade before Phase 7's multiplayer testing or before inviting beta testers.**

### Not yet checked online: the inbox test and the ping from Australia

Everything is tested locally in one browser, each part on an address of its own (`server/tools/deploy-browser.ts`),
and online by `tools/check-deploy.mjs` after each deploy. Two things need you, once the accounts exist:
- a sign-up from a phone on mobile data, its email landing in a Gmail and an Outlook inbox;
- the real-time round trip from Australia (`ognistrada.com/site/ping.html`).

### Two players in the same room: built in Phase 7 Step 1, not online yet

The real-time server is built (docs/MULTIPLAYER.md). Online, `rt.ognistrada.com` still only answers a ping with a
pong until it's deployed; the two-networks check is waiting for that (above).

### The development pages on staging can't open the editor

The editor's code is served only to editor accounts, from the API's address. The development pages (`dev/`, staging
only) import parts of it directly, and those imports don't carry the session, so their AI test-race button fails
there. In the game, the editor opens normally for editors.

## Phase 6 Step 2: the server-owned economy

### Everyone at the same moment: fitting parts queues

`npm run load-test:economy -w @kr/server -- --burst` has all 500 players send every step at the same moment.
Everything goes through correctly, and the books balance afterwards. But the slowest actions wait:
- **Fitting a part or taking it off** waits up to about 9 s (p95 about 9.4 s).
- **Everything else** waits about 1–6 s.
- **Why:** each fit or removal runs the game's own build checks: the car's stats several times, about
  20 ms of CPU. About 165 requests a second fit through one process.

At a person's pace (the default: arriving over 20 s, 5–20 s between actions) every action's p95 is under
about 100 ms. The game shows each change at once, so only the confirmation waits.

Render's free plan has a fraction of one CPU, so its limits are much lower. Before there are that many
players:
- a paid instance with more cores;
- faster build checks: a cache of the car's stats for a build already worked out
  (`garage/stats.js`, shared with the game and its physics tests, so it wasn't changed here).

### One server process: changes from another device reach the others through it

Another tab's or device's changes come through the server's events (`GET /player/events`), which are
sent by the process that made the change. With more than one server process, they'd need passing between
them (PostgreSQL's `LISTEN`/`NOTIFY`). Render's free plan runs one process, so this doesn't happen yet.
Nothing goes wrong without it: each action is checked against the database, and the game catches up on
its next action or reload.

### Settings changes reach every server within 5 seconds

The server checks the active settings version every 5 s. For up to 5 s after an admin's change, a price
can still be the old one. Each ledger row from an action records the version that priced it (`ref.configVersion`).

### Not checked in a browser here: the whole game page

`npm run test:browser:economy -w @kr/server` drives the game's own player service and garage
(`garage/session.js`), the account chip and the admin page in Chromium. It doesn't play the full 3D game
page through a quest. The game's quest controller now hands the pink slip's result to the server
(`play/questController.js`); that path is covered by the server tests, not in a browser.

## Phase 6 Step 1: the server

### Signing in at once: password checks are deliberately slow

`npm run load-test -w @kr/server` has 500 players sign in at the same moment, then load the content near
them. Nothing fails, and the content comes back at a p95 of about 180 ms. But signing in waits:
- **This computer (4 cores):** a p95 of about 15 s. Each password check is scrypt (32 MB, about 100 ms of
  CPU), so about 35 a second fit, and the burst queues behind them.
- **Afterwards:** requests that land just as all those sign-ins finish wait too (`/me` at a p95 of about
  8 s).
- **Render's free plan:** it has a fraction of one CPU, so a burst like this would take minutes.

Players stay signed in for 30 days, so it's only a burst of fresh sign-ins that queues. Before there are
that many players:
- a paid instance with several cores;
- the session cookie cache (it trades instant sign-out-everywhere and bans for fewer database reads);
- a queue that says "busy, retrying".

The load test reports sign-in as "over (known)", not failed.

**Phase 6 Step 5's full-game load test** (`npm run load-test:full -w @kr/server`, [reports/load-test.md](../reports/load-test.md)):
- **500 players at once (the beta's size), arriving over a minute:** passes. Every step's p95 is under 210 ms, including sign-in, with no errors and the books balanced.
- **2,000 at once (this computer, 4 cores):** fails.
  - Sign-in queues behind the password checks.
  - The database's 10 connections run out. Those requests used to answer 500. They now answer `503 BUSY` with "try again in 2 s", and the game retries.
  - Online, more players at once means a bigger plan ([COSTS.md](COSTS.md)).

### Launch readiness (Phase 6 Step 5): what's left

[LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md) has every item. The ones that aren't code:
- **The minimum age stays 13** until a lawyer agrees otherwise. The owner would allow any age, but under-13s bring COPPA, GDPR article 8 and the UK Children's Code ([PRIVACY_DATA.md](PRIVACY_DATA.md)).
- **The privacy policy and terms** are drafts for the EU, UK, US and Australia, and need a legal review.
- **Point-in-time recovery, Turnstile, alerts, the uptime monitor and budget alerts** wait for the deployment.
- **Two security findings stay open (accepted):**
  - sign-up says when an email already has an account (L3);
  - moderate advisories in development tools only (L4).
  - Details in [SECURITY.md](SECURITY.md).
- **Browser tests and the CDN:** the game's page needs `--local-libs` in the shop browser test where jsDelivr can't be reached. Its `pbf` and `@mapbox/vector-tile` must be the CDN's versions (4 and 2): set `CDN_LIBS` to a folder with them installed if the repository's own are newer.

### Every phase's tests at the end of Phase 6 Step 5

Run on this computer. Everything passes except three suites that fail **the same way on the code from before Step 5** (commit
`92589b2`, checked side by side). They aren't caused by Step 5, and they stay as they were:
- **`npm run stress:quests`:** 5 of its 13 timing limits are over (nearby queries p95 about 10–13 ms against 8; the full map opening in 663 ms against 400). They are timings on 50,000 quests, and vary with the machine: the older code missed 6 here.
- **`npm run test:track-events`:** "every quest type pays 0.6–1.6× the median". The tier-3 time trial pays 0.55×, the same number before Step 5. It's a balance target for the owner to tune ([PROGRESSION.md](PROGRESSION.md)); nothing in Step 5 changed the economy's rules.
- **`npm run test:npc`:** the known stuck-and-reset races in Monaco and Stelvio (above: reported in CI, not blocking).

### Nearby content: a 10 km circle in the densest city is over 5 ms through the API

`npm run stress:content -w @kr/server` (50,000 markers):
- **Within the Phase 4 limits (p95 5 ms, worst 25 ms):** every nearby, cell and tile query in the
  database, and every query the game makes (3 km, whole items).
- **Over:** a 10 km circle in the busiest cities through the API, at a p95 of about 13–16 ms. It returns
  about 320 items (167 KB), and the time is in building and sending that much, not in the search. The
  database's own time for it is within the limit.

The game never asks for that much at once. The editor's map asks by tiles, which are cached and small.

### Free hosting sleeps

Render's free web services sleep after 15 minutes without a visit. The first request after that waits
about a minute, and the game's chip says "Waking the server…" and keeps retrying. Neon's free databases
also pause when idle, and wake in a second or so.

### Not verified here: the Docker image and the browser's Sentry

- **The Docker image:** Docker Hub refused this session's pulls (429), so the image wasn't built here. CI
  builds it on every push. The same layout was checked on this machine instead: a copy without what
  `.dockerignore` leaves out, with only the production dependencies. That copy migrated a new database,
  served the game, the pages and today's tracks, and refused the server's source, the tests and `.env`.
- **The browser's Sentry:** it loads from jsDelivr, which this session couldn't reach. It only loads when
  `SENTRY_CLIENT_DSN` is set, and the game carries on if it can't.

### The terms of service and privacy policy are drafts

`account/terms.html` and `account/privacy.html` were written with the game as a starting point. Have them
reviewed before the game is opened to the public.

### The shop (Phase 6 Step 4, docs/SHOP.md)

- **Selling changed, and needs the owner's OK.** The old condition curve let a player profit by repairing a part
  just to sell it (the exploit check found $1,806 on a wrecked engine). A sale is now worth less a share of its
  repair bill (`sell.repairShare` 0.5, `floor` 0.1). A new part still sells for 60% of what was paid. Worn and
  damaged parts sell for more than before: a part at 0% sold for 6% of its price, and now sells for about 40%. The
  old rule comes back by removing `repairShare` from the settings, and with it the exploit.
- **Makers are made up.** Parts had no makers, so `shop.makers` gives one per category ("Airwerk" intakes,
  "Gripmax" tyres…), "Sackworks Racing" for race parts and "Factory" for stock and car-specific parts. Admins can
  change any part's maker.
- **A used car's history is generated**, from its mileage and the day's seed: services, accidents and parts
  fitted. It's flavour, consistent with the car's condition, not a record of anything that happened.
- **The used lot isn't a shared stock.** Everyone sees the same cars all day, and each player can buy each car
  once. One player buying a car doesn't take it off anyone else's lot.
- **New parts and cars come from their data files.** The admin catalogue prices, hides, locks and times what's
  there. Making a new part (its stats and model) is still the data files' and the editor's job.
- **The sim's bots sell a car roughly.** With the garage full they sell the weakest for 60% of what they paid for
  it and its parts, close to the game's value for a car in good condition. They value a used car by its listed
  rating.
- **Refund and confirmation timing.** "Click again to confirm" lasts 3.5 s. Under software rendering (the tests'
  Chromium) two clicks can be further apart than that, so the browser test clicks twice at once.

## Known issues (Phase 5 and before)

### The baked world: spots where cars stop dead

AI drivers (the NPCs, and the test driver) stop at the same metre every time, are reset, and stop again:

| Where | What's there |
| --- | --- |
| San Francisco, 2nd Street under I-80 (37.78376, −122.39447) | the I-80 viaduct overhead has a piece tagged *ground* (layer 0) at 17.9 m |
| San Francisco, 4th Street under the I-80 ramps (37.78034, −122.39894) | motorway bridges overhead at 9–11 m |
| San Francisco, Stockton Tunnel (37.79257, −122.40761) | a piece of the tunnel road is tagged *ground*, not *tunnel* |
| Monaco, 450–470 m along the routes test's sprint | a ramp beside a level road; the level road's surface overlaps the ramp (docs/NPC_RACERS.md) |
| Stelvio | drops with no barrier: a car pushed wide goes over (docs/NPC_RACERS.md) |

The first three look like the same cause: OSM pieces of elevated or underground roads that aren't tagged
bridge or tunnel get baked as surface at their own height, which walls off the street underneath. The fix
belongs in the Map v3 bake (treat a *ground* piece of a way that's otherwise bridge/tunnel, or one far
above the terrain, as the structure it is). Until then, authors find these with the editor's AI test race
(problem spots on the map), and `tests/map/newplayer.test.ts` keeps its routes away from them. A route
check could also warn about a route passing under a *ground* road well above it.

### Rookie quests are scarce outside San Francisco and Munich

A quest's tier is `floor((stars + its class's tier) / 2)`, and city and mountain roads rate high. From 40
random 1–4 km routes in each region (solo time trial / 2-rival sprint): San Francisco about half 2★
(Rookie), Munich nearly all Rookie, Milton Keynes mostly 3★ (Club); **Monaco, Tokyo and Stelvio almost
none** (3–5★: Club and Pro). A new player who fast-travels there finds next to nothing to enter. Either
start players in San Francisco or Munich (as now) and place Rookie quests deliberately, or revisit how
stars map to tiers before content goes in at scale.

### Club tier takes about 15 first-time Rookie golds

A 2–3 km 2★ Rookie quest pays 50–65 xp for its first gold, a repeat 16–22 xp (less again with
anti-farming); level 3 is 900 xp. `npm run test:newplayer`: 15 Rookie quests golded, a series bonus and
some repeats to reach it. The economy simulation agrees (its pool assumes ~50 Rookie quests within reach).
A starting area needs at least 15–20 Rookie quests, or the level curve's early steps should come down.

### Some steep routes rate easier than they drive

Routes with 20–28% grades in San Francisco rate 2★ (the steepest grade is one feature among many: full
at 30%, weight 0.5), yet those are where the AI and new players struggle. Worth a heavier weight for very steep
grades — then rerun `npm run economy-sim`, as rewards follow the stars.

### At 50,000 quests

`npm run stress:quests` puts 50,000 quests, each with its own route, into the six baked regions — so they
pack far tighter than real content would (Stelvio: 6,000 quests within 1 km). Measured (4-core container,
Node 22):

| | measured | target |
| --- | --- | --- |
| 100,000 items imported | 89 s | 120 s |
| everything loaded at once (a player who's been everywhere) | 1.06 GB heap | — |
| nearby query (3 km, nearest 2,000), densest place / anywhere | p95 10 / 13 ms | **8 ms** |
| the maps' 2,000 markers handed over | median 7.7 ms | 8 ms |
| the finder: every quest listed / a filter changed | 50,000 of 50,000 / 52 ms | all / 100 ms |
| the finder: opening the full map (first time; kept 20 s) | 589 ms | **400 ms** |
| the nearby notice | p99 0.46 ms | 1 ms |
| the editor's area query / *Check everything* (100,000) | p95 14 ms / 86 s | 15 ms / 120 s |
| free roam at 200 km/h through the densest area | p95 0.44 ms a frame, worst 31 ms | 2 / **12 ms** |
| arriving there (that area's content loaded) | 0.76 s | behind the loading screen |
| memory over 20 km of free roam | +9 MB | 50 MB |

What's over, and why: the content cells are 5 km across, so a packed region is one or two cells holding
thousands of quests *and their routes*; a nearby query looks at all of them, and loading one is a large
read. Route courses are now kept as text in memory until read (`content/service.js`), which halved memory
(2.1 → 1.06 GB) and the collector's pauses — the rest is the work itself, on the main thread. The worst
free-roam frame is the re-query every 250 m plus the maps' update in the densest spot.

The lasting fixes, before content goes in at this density: run the content service in a **Web Worker**
(queries and cell loads off the main thread — the API is already async), and keep **routes apart from the
quests' cells** (a server's routes table in Phase 6, or a body store locally), so a nearby query only ever
reads light markers. `stress:quests` is reported in CI but not blocking until then.

Also:
- **Exporting everything** to one file stops past a browser's longest string (tens of thousands of
  routes): the editor says so and asks for an area at a time. *Check everything* doesn't need an export.
- **The finder** works on every quest in every region on the main thread; a server should answer its
  filters and "Recommended" (Phase 6).

### Generated tracks (Phase 5 Steps 1 and 2, docs/TRACKS.md)

- **Phase 1's lap robot weaves on high-speed generated circuits**: its steering was tuned on the test
  centre's circuit and oscillates in 130–150 km/h sweepers until it spins (with or without banking). The
  route test driver and the Phase 4 AI drive those tracks cleanly, so `npm run test:track-drive` runs the
  Phase 1 tests on a grand prix circuit; the robot's controller needs a look before it laps fast tracks.
- **Cross-browser determinism was checked in Chromium only** (210 of 210 layouts, and 240 of 240
  dressings, identical to Node's). Firefox and Safari weren't available here: open
  `dev/tracks.html?determinism=30&dress` in each and compare.
- **One generated track's world is kept at a time**: opening another frees the last (its build stays in
  the cache, so going back takes tens of milliseconds plus the colliders).
- **Crossovers only in version 3, and only on two presets**: a figure of eight with one bridge (Step 4)
  is a signature feature of the mixed_gp and fast_flowing presets (`bridges`); versions 1 and 2 never cross.
- **Version-1 tracks are undressed** (as they were made): no barriers, so a car can still drive off the
  ground's edge 260 m out. Version-2 tracks are closed in by their barriers.
- **8-car NPC races on generated tracks**: in `npm run test:track-drive`'s ten races every car finishes,
  but one NPC (in one race, on a fast flowing circuit) is stuck-and-reset after contact in the pack — the
  Phase 4 AI's racing in traffic (docs/NPC_RACERS.md's known limits), where the test wants none.
- **Cars have no bump stops** (Phase 1's suspension stops at its travel and pushes no harder): braking
  hard from 170 km/h or more, with the aero load on top, the front bottoms out and the floor touches the
  road. On a generated track the road's collider has its internal edges smoothed, so it scrapes and
  slides; on the baked real-world roads a floor can still catch on a triangle edge (one cause of NPCs
  spinning at speed). A progressive bump stop in the car model is the lasting fix.
- **Run-off isn't enough everywhere**: straight on at the racing line's speed (a quick race car's) a car
  stops or hits slowly at 92% of corners in `npm run test:dress-drive`; the rest are mostly street
  circuits (walls close on purpose) and corners where another part of the track leaves no room.
- **A tyre wall's softness is in the damage, not the physics**: it doesn't bounce and its hits reach the
  damage model at 55% (physics/settings.json impacts.materials), but the car still stops as fast as at a
  concrete wall — Rapier has no per-collider compliance.
- **A glancing hit on a tyre wall carries the car along it**: with no bounce (restitution 0) a car that
  glances a tyre wall at speed stays against it and slides on; where the wall curves on round a fast
  corner's run-off it meets more of it further along (seen at 150 km/h, 15°, on a version-3 track:
  2.3 m/s at the glance, a 26 m/s hit 100 m on). `npm run test:dress-drive` compares tyre walls and
  concrete on the hit itself (within 15 m of where it was aimed). A little restitution, or less friction
  along a tyre wall, would let it shed the car as concrete does.
- **A car stopped in a gravel trap is beached**: it can't drive out (by design); the AI's and the
  tracker's resets (5 s off the route, or stuck) put it back — there are no marshals or recovery vehicles.
- **The AI's racing line stays off the kerbs**: Phase 4's line keeps a margin from the road's edge (built
  for real roads); `npm run test:dress-drive` shows the AI can use the kerbs on a wider line, but NPCs
  don't by default.
- **A dressed track's time of day and weather are the event's or the theme's** (Step 4); the player's
  time-of-day setting doesn't apply there.
- **The garages are solid boxes** behind their fronts (no pit stops yet: the pit lane is drivable, the
  boxes aren't).
- **Hillclimbs' land can be steep** beside the road where the road cuts across a slope: the ground blends
  to the road's height over 55 m, which on a big climb makes banks steeper than real land.

### Generated tracks: variety, quality and polish (Phase 5 Step 4, docs/TRACK_GENERATOR.md)

- **AI-only races rarely see a pass**: in `npm run test:track-events -- --only close` (six NPCs of similar
  skill on the day's, the week's and quick tracks) there are 0–2 passes a race on most tracks; the cars
  mostly finish in grid order, a few seconds apart. The Phase 4 AI's passing (`ai/driver.js` tactics)
  starts a move but rarely completes one between cars of similar pace — it never out-brakes. So the
  quality score's AI part mostly measures how bunched the field stays. The tracks' overtaking chances are
  scored from their layout (long straights into heavy braking: every v3 preset's median is full marks);
  better AI racecraft (late braking, a switchback) is the fix.
- **Two Phase 4 race bugs found and fixed here**: a finished NPC was seen by the others as stopped on the
  finish line (its progress stops there) — they queued behind it, and on a sprint never finished; and in
  the editor's AI test race the world's own idle car sat on the pole slot, unseen by the NPCs, which piled
  into it at the start. AI test results and closeness scores from before this step were pessimistic.
- **Rain is visual only**: rain, a dark wet road, greyer light; the grip hook (`conditions.applyGrip`, rain
  0.82) is off. Turned on, the AI's speed plans don't yet know the grip is lower.
- **Replays show the cars' bodies only**: the recording is the Phase 4 ghost format (position, rotation,
  velocity at 20 Hz), so in a replay the wheels don't turn or steer and the cars carry the damage they
  have now. A replay is kept until the next run (not saved, not shareable).
- **Frame times weren't measured on a GPU**: this container renders in software, so the browser's frame
  times (`tools/track-perf-browser.mjs`) mean nothing here. The CPU's share of a frame (3.0–3.7 ms at the
  three levels, `npm run test:track-perf`) and the draw calls (30–33) are well inside budget; run the
  browser tool on real hardware before relying on the frameMs targets (here, with software rendering,
  every frame took 0.6–0.9 s). The track detail setting applies to the next track loaded. With 8 cars
  the shadow pass is most of the draw calls (about 430 a frame at medium and high, 108 at low with no
  shadows): fewer shadow casters (the cars' small parts) would be the first saving.
- **The ambience is synthesised** (no recorded sounds): birds, wind, sea and city from noise and
  oscillators, the crowd from filtered noise, not placed in 3D (the nearest grandstand sets its level).
- **The problem seeds are the scan's**: the seeds noted by hand during Step 1 weren't recorded where this
  step could find them; `tests/fixtures/problem-seeds.json` has 16 from `tools/problem-seeds.mjs` (the
  worst version-2 seeds of each preset). Add the noted ones with `source: "noted"`.
- **The day's tracks changed from 2026-10-01** (version 3 with the quality gate, by the rule in
  `data/trackEvents.json`): released before anyone played them, but from now on a change to the gate or
  the generator for the day's tracks must be a new rule with a later date.
- **Flat circuits score lower on elevation** (the part's median 6–21% on circuits): fine for the gates
  (weight 0.6), but a hillier circuit preset would lift it.
- **A sprint's standing start can leave an NPC stuck on a steep grid** (one reset seen in the close-race
  test on a hillclimb).

### Smaller things

- **A forced finish in a test** (`session.finish` outside a physics tick) needs the controller to drain
  its events (`controller.skipIntro()` does) — the game never does this; only scripts that cheat do.
- **The browser smoke test** of the polish (sounds, camera, hints, accessibility) ran headless with
  three.js and Rapier from `node_modules` (the CDN isn't reachable there) and without maplibre; it isn't
  part of CI. The polish's logic is unit-tested (`tests/unit/polish.test.mjs`).
- **The densest city tile's 8-car race** is within the frame budget on average (about 5 ms of 8), but its
  worst single physics step was about 43 ms (`npm run test:npc -- --only dense`).
- **NPC tests** still have the known failures in docs/NPC_RACERS.md (skill spread; stuck-and-reset at
  the spots above), reported in CI but not blocking.

## To revisit before Phase 6 (accounts, a server-owned economy)

(Kept as written at the end of Phase 5. Phase 6 has since done the economy, results, anti-farming, the day's
tracks, records and saves on the server: SERVER.md and ECONOMY_SERVER.md.)

- **Money, progress and inventory are in the browser** (`LocalPlayerService`). Every request already
  goes through PlayerService's methods and answers `{ ok, error, updatedState }`
  (`garage/player/service.js` METHODS); a server answering the same requests replaces it
  (`garage/player/remote.js` is the client side). The server must own: the balance, fees and rewards,
  repairs, purchases, xp and levels, series bonuses, pink-slip car transfers.
- **Results are checked in the browser** (`quest/validate.js`: times against the route, the car's
  limits, the recording). The same checks must run on the server, with the recording sent, before
  anything is paid.
- **Anti-farming uses the browser's clock** (`quests.farming.windowHours`): the server's clock instead.
- **Rewards are worked out from the quest's stored rating** and the economy config. The server needs the
  same code and config version; a change to the rules makes stored ratings out of date (*Check
  everything* lists them) — rerate on the server when the rules change.
- **World content is per browser** (IndexedDB). The PostGIS design is in WORLD_CONTENT.md; add a routes
  table apart from quests, the finder's filters and "Recommended" as queries, and *Check everything* as
  a server job.
- **Saves**: the profile (version 4), recordings (version 2) and content (version 3) migrate on load in
  the browser; the server should migrate on read too, with the same fixtures (`tests/fixtures/saves/`).
- **Hints seen, settings**: hints are in the profile already (moves with it); the accessibility and
  input settings are per browser (localStorage) — decide whether they follow the account.
- **The day's and the week's tracks are worked out in the browser** from the date (`track/events/model.js`:
  the rules, the quality gate, the skipped seeds, the similarity to recent days). The server should work
  them out once (the same code and config version) and publish them; the track records and event
  leaderboards (`track/events/records.js`, per code / version / class) must be the server's, with the
  run's recording checked against the track's hash before a record counts.
- **Race replays are in memory only**: with accounts, a run's recording (already sent for checking) could
  be kept for the replay and for others to watch; the other cars' recordings would need storing too.
- **Fast travel regions** come from `data/map/baked.json`; with a server, the regions a player can reach
  (and their quests) should come from it.
