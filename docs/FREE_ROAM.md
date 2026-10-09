# Multiplayer free roam (Phase 7 Step 4)

Players drive the baked real-world regions together: they see each other on the roads and the maps, join their friends
wherever they are, challenge someone nearby to a race to a real destination, race quests as a party, and meet up at real
car parks to show off their cars. It builds on Step 1 (the networking, interest management, bots), Step 2 (the hub,
parties, lobbies and race flow), Step 3 (car-to-car contact, the referee, safety ratings), Phase 4 (the road graph,
quests, the world editor) and Phase 6 (accounts, the economy, verification).

Everything runs on this computer (deployment is paused: [DEPLOYMENT.md](DEPLOYMENT.md)). The settings are in
`data/roam.json`.

**Griefing protection is part of it:** free roam is ghost between players by default, so nobody can be rammed by a
stranger; contact is opt-in on both sides; passive mode takes you out of everything; a player who keeps hitting others
is ghosted for everyone automatically; blocked players never meet.

## Trying it on this computer

1. Start everything: `docker compose up --build` (or `npm run rt -w @kr/server` and `npm start -w @kr/server`).
2. Open `http://localhost:8787/?mp&player=A` and `http://localhost:8787/?mp&player=B` in two windows side by side.
   Drive into a real-world region (Milton Keynes, San Francisco, …: the regions menu, or the full map).
3. Each window shows "Free roam" and the zone it's in, and draws the other car with its name over it. **F9** (development)
   puts your car beside the other.
4. **F6** opens the free-roam screen: *Nearby* (inspect a car, challenge, add friend, mute, block, report), *Friends*
   (join a friend, the party, challenge the party, race a quest together), *Meets*, *Chat* and *Settings*.
5. Hold **,** to flash your headlights: twice at the car just ahead challenges it to a sprint. **'** is the horn, **`**
   the quick chat wheel, **Enter** chat. **Tab** the full map (other players as dots: friends green, the party violet,
   everyone else blue).
6. Signed in (not `?player=`), leave and come back: you're put back where you were, in the same car with its damage.

## World instances

**Zones.** A region's map frame is cut into square zones of `zones.zoneTiles` × `zones.zoneTiles` Map v3 tiles (4 × 4 tiles
of 512 m: 2,048 m). Each zone is served by *instances*: rooms of the real-time server (`roam`, filtered by region, zone and
instance group) holding at most `zones.capacity` players (50), and `zones.friendSlots` (8) more for friends and parties
joining theirs. A zone's instances can be in any real-time process; Redis presence lists them all.

**Which instance** (`mp/roam.js` `placeInstance`, run by the hub when a player enters a zone), in order:
1. one with a member of their party (and the most of them);
2. one with a friend (the most friends);
3. the same instance group they were in, in the zone they came from (a handoff);
4. the one with the most players within `nearRadiusM` (1.5 km) of them, then the lowest ping (and, all else equal, the
   fuller: instances fill up rather than spread);
5. none with room: a new instance (the group they came with, if it isn't there yet).

Never one with someone they've blocked, or who has blocked them. A full instance is skipped, except by friends and
the party, who use the friend slots. A party leader's whole party lands together: placement puts each member in the
instance holding the others.

**Server regions.** `regions.list` names where zone servers run (on this computer: one, `local`). A player connects to
the region with the lowest measured ping, unless the region of their friends or party is within `preferWithinMs` of it
(`mp/roam.js` `pickRegion`). Online, one region a continent (docs/DEPLOYMENT.md "To do when we deploy").

## Driving from one zone to the next (the handoff)

The point: no loading screen, no hitch, no jump, nothing lost — at any speed.

- **Overlapping borders.** A car within `overlapM` (300 m) of a neighbouring zone is in that zone's instance too (the same
  group where it can be): the game sends its car to both and receives the cars of both (`mp/roamClient.js`). Near a corner
  that's up to four zones.
- **The home zone** moves only once the car is `handoffM` (25 m) past the border (hysteresis: driving along the line doesn't
  flap). The new home is told; it's the one that saves where the player is and what their friends see. The old zone is
  left once the car is more than `overlapM + leaveSlackM` (360 m) from it.
- **Each other car is drawn once**, from one zone at a time (its *source*), kept as long as that zone's view of it is fresh.
  When the source changes (the car left that zone, or that zone's view of it stalled), the new zone's drawing is **lined up
  in time** with the old one: the two zones' clocks differ, but the car's own physics step number is the same in both, so
  the moment last drawn is found in the new zone's clock (`clockOffset`) and its interpolation carries on from there
  (`net/remote.js` `align`). The few centimetres left are eased away over at least 350 ms (longer for a bigger offset),
  and the old drawing's velocity is handed over to the new one's over 150–500 ms rather than in one frame (the two views'
  speeds differ slightly, more if the old one was predicting: a change of speed in one frame is a kink the eye catches).
  Measured: the offset at a switch is 2 cm at the median, under 10 cm at worst, at 200 km/h. "Fresh" and "stalled" allow
  for how often the car is sent: a car beyond 700 m comes a few times a second (Step 1's interest rings).
- **A lost zone connection is joined again.** If a zone closes the connection (a network drop it can't come back from, a
  server restart, nothing heard for `NET.idleSec`) or a join fails or doesn't answer in 20 s, the game joins that zone
  again while the car is in it: after 1 s, doubling to 30 s, with a fresh join ticket each time. While the real-time
  server is restarting (an update, a crash: CLOSED, Colyseus's 4001) the game says so ("The game server is restarting.
  Reconnecting…") until it's back (Phase 7 Step 5; `server/tools/rt-crash-test.ts`). A ban, the same account joining
  elsewhere, an old game version, or the API refusing the ticket (signed out, the terms) stays offline.
- **Nothing lost**: the car's look and damage are sent to each zone it joins; its settings, party and auto-ghost go with
  it; a challenge stays in the zone it started in until it's over (the game keeps that zone joined, wherever it drives).
- **Fading at the edge.** A car that comes into view from a zone this player isn't in fades in over half a second, and
  one that leaves fades out — at the distances involved (300 m and more) that's never a car next to you.

## Seeing other players

- **Interest management**: Step 1's rings (`NET.interest`): full rate within 250 m, every 3rd tick to 700 m, every 10th
  to 1.5 km.
- **Level of detail** (`seeing`): the car's own model with turning wheels, damage and engine sound within `fullM` (250 m);
  the model without sound to `simpleM` (700 m); beyond, a dot on the maps only.
- **Names over cars** fade from `nameFullM` (60 m) to `nameHideM` (300 m); *Names over cars* in Settings turns them off.
- **The maps**: the minimap and the full map show every player in the region you may see (their privacy setting, blocks),
  sent every `mapEverySec` (2 s) by your home zone from Redis presence (`rt:roam:map:<region>`), placed to `mapPrecisionM`
  (10 m) — not their exact position. Click a friend on the full map to join them.
- **Inspect** a car within `inspectM` (40 m): its model, class and performance rating, mass, parts, safety rating, how many
  crashes it's had.

## Privacy and presence

Settings (free-roam screen → Settings; kept by the API, `PUT /api/v1/roam/settings`, and carried in every join ticket):

| Setting | What it does |
|---|---|
| Who sees where you are: everyone / friends only / nobody | The maps (minimap and full map), the friends list's "where", and Join friend. On the road, your car is always seen by those near you (it's on the road) — but to a stranger you're a "Driver", not your name, when you share with nobody. |
| Appear offline | Offline in friends' lists, not on their maps, and they can't join you |
| Names over cars / Nearby chat | What you see and hear |
| Contact / Contact with my party / Passive mode | Collisions (below) |

**Blocked players** (either way) never appear in your instance (placement keeps you apart), and if you block someone who's
there, each disappears from the other's world at once: no car, no roster entry, no name, no chat, no challenges, not on
the map, no Join friend.

**Join friend**: a friend who shares where they are (with friends or everyone) and isn't appearing offline — you're put
beside them (in their region, switching to it if it's another), and placement puts you in their instance.

## Collisions and griefing

- **Ghost by default.** Two cars touch only when both players have **Contact** on, or they're in the same party with
  **Contact with my party** on (both). Contact is Step 3's ([CONTACT.md](CONTACT.md)): each game reports what it saw, the
  zone's referee agrees one result (in reduced mode), and the push and damage follow.
- **Passive mode**: a ghost to everyone, can't challenge or be challenged. Switching it waits `passiveCooldownSec` (a
  minute) since the last switch; contact `toggleCooldownSec` (5 s).
- **Automatic protection**: a player at fault (`faultShare`, at least `minStrength`) in `autoGhost.hits` contacts within
  `windowSec` is ghosted for everyone for `ghostSec` (5 minutes; twice as long each time), in every zone and process
  (Redis), and their safety rating drops `safetyPerHit` for each of those hits (the API). They're told why.
- **Report a player** from Nearby: the zone keeps every car's last `TRAIL_SEC` seconds, and the last `reports.replaySec`
  (15 s) of both cars go with the report (the admin page's Contacts tab replays them). `reports.perHour` at most.
- Near a zone border, two players can have different home zones; each reports a contact to its own home zone, which
  agrees it one-sidedly (checked against its own view of both cars, as Step 3 does when one report is missing).

## Challenges

- **Asking**: *Challenge* in Nearby (sprint somewhere, race to the nearest quest marker, follow the leader), or **flash
  your headlights** twice within 1.5 s at a car within 25° of straight ahead and 120 m: a sprint. The challenged player
  gets a prompt with the route on their map (its length, the roads, where it ends) and 15 s to answer.
- **No spam**: declined or unanswered, that pair waits `pairCooldownSec` (30 s), twice as long each time up to 10 minutes;
  at most `perMinute` (3) challenges sent a minute; a blocked player's challenges are declined without a word (they're
  told it was sent).
- **Routes** (`mp/challenge.js` `sprintRoute`): built on the region's road graph exactly as an editor's route is
  (`route/build.js`), to a destination `routeM.min`–`max` (1.2–4 km) away by road, or to the quest marker; checkpoints
  every 400 m, the last the finish.
- **Rolling start**: side by side at 15–60 km/h for 5 s, then GO; a car more than 25 m ahead of the rearmost at GO gets
  +3 s. A rolling start that never comes together in 30 s is called off.
- **Ghosted to everyone else** (and traffic) for the challenge; contact between the racers as their settings say.
- **A server session**: the zone server runs it on the cars' accepted states (gates, the finish, timing between states),
  then hands its record to the API, which checks it (`verifyChallenge`: every checkpoint in order and where the car's trail
  was, no impossible speed or jump, times consistent with the finish and the route's length) before paying (the economy's
  ledger, once).
- **Pay** (`challenges.pay`): base + per km by place; **caps** against farming: the same pair (or group) is paid at most
  `pairPerDay` (3) challenges a day, a player at most `dailyPaid` (15). Past a cap the result still counts, nothing's paid,
  and the player's told why.
- **Groups**: a party leader challenges the whole party (up to 8): it goes ahead with everyone who accepts.

## Co-op quests

A party races a quest together: *Race the nearest quest together* (Friends → Party) makes a private lobby on the quest's
route (with or without NPCs) and invites the party — then it's Step 2's race flow: the lobby, the grid and countdown, the
race, results checked and paid per player by the quest's rules.

## Car meets

- **Meet spots** are world content (kind `meet`, the editor's *Meet spot* tool, key 7): a marker at a car park or a scenic
  place, its parking laid out from it (`spots` in rows of `perRow`, facing its heading; alternate rows nose to nose).
- **At a meet** (within 120 m): *Park* puts you in the nearest free spot; *Photo mode* hides the screens (Esc brings them
  back); inspect anyone's car; horn, headlights; emotes (wave, thumbs up, clap, rev, photo) seen by those at the meet.
- **Scheduled meets** are made on the admin page (*Free roam* tab): a published meet spot, a title, a start and how long.
  They're listed in the free-roam screen and on the HUD with a countdown from two days before, and their spot is on the
  map.

## Communication

- **The quick chat wheel** (`, or the Chat tab): eight preset messages to those near.
- **Nearby text chat** (within `chat.nearbyM`, 300 m, to those who have it on) and **party chat** (wherever they are).
- Every message through the name and profanity filter (`cleanChat`); rate limited (a burst of 4, then 1 a second); **mute**
  (this game only), **block** (kept by the API) and **report** (with the replay) from Nearby.
- **Voice chat: a design note only** (nothing built, nothing bought). It would need a media server (an SFU such as LiveKit
  or a hosted one like Agora): proximity voice per zone instance (players within ~100 m in one room, volume by distance),
  party voice as a separate room, push-to-talk by default, voice off for guests and under-18 accounts, mute and block
  honoured by the SFU's permissions, no recording. Every option costs money (a hosted SFU charges per participant-minute;
  a self-hosted one needs its own servers and bandwidth): to be priced and decided with the owner first.

## Coming back where you left (persistence)

Your home zone saves where you are (region, position, heading, car, its damage) every `saveEverySec` (30 s) and when you
leave. Next time (`GET /api/v1/roam/me`) you're put back there — unless the region isn't baked any more, the spot is more
than `maxOffRoadM` (30 m) from a road, or it's older than `keepDays` (90): then the garage (the region's spawn), and the
game says why. The car's damage is the economy's (Phase 6: the car's own state), and the look that was saved with it.

## The server side

| Part | Where |
|---|---|
| Zone instances (`roam` rooms) | `server/src/rt/roam.ts` — Step 1's room with the free-roam layer: per-viewer hiding and names, the map, contact and auto-ghost, challenges, chat, meets, reports, saving |
| Placement, join friend | `server/src/rt/hub.ts` (`roam-place`, `roam-join`) |
| Presence (Redis, or memory with one process) | `rt:roam:map:<region>` every player's map place (written by their home zone); `rt:status` (free roam, the zone and instance, hidden or not); `rt:roam:ghost:<uid>` and the `rt:roam:ghost` channel (an auto-ghost everywhere); the rooms' listing (Colyseus) with each instance's players and their rough places |
| The rules | `mp/roam.js` (zones, placement, privacy, contact, auto-ghost, meets, coming back), `mp/challenge.js` |
| The game's zones and handoffs | `mp/roamClient.js`; the game: `play/roam.js`; headless: `mp/roamBot.js` |
| The API | `server/src/roam/service.ts`, `server/src/routes/roam.ts`; tables `roam_players`, `roam_challenges`, `roam_challenge_players`, `meet_events` (migration 0014) |
| The live dashboard | the admin page's **Free roam** tab (`GET /api/v1/admin/roam/dashboard`): players and connections per zone and instance, handoffs a minute, bandwidth, CPU and memory per process, tick times, and the hosting cost at the live numbers. Each zone process reports every 5 s; one silent for 20 s is left out of the totals and listed as silent. |

## Hosting cost per 1,000 free roam players

Mostly bandwidth, and that depends on how crowded the world is: a player's download grows with the cars within 1.5 km.
At `data/roam.json` `costs` (a managed host's rates: about $25 a month a core, a managed Redis about $10, bandwidth past the
included amount about $0.15 a GB — *check* each before paying; online it all runs on the one OVHcloud VPS, traffic
unmetered and no Redis — docs/COSTS.md):

| | download a player | 1,000 monthly active (20 h a month each, 10% on at once) | 1,000 on at once, all month |
|---|---|---|---|
| A very dense crowd (the 150-bot swarm: ~85 cars in view each, at half a game's send rate) — measured | 35 kB/s | **about $390 a month** | **about $13,300 a month** |
| A spread-out world (~10 cars in view each) — an estimate from the swarm's ~0.4 kB/s a car in view, doubled for the full send rate | ~8 kB/s | **about $100 a month** | **about $3,100 a month** |

Nearly all of the second column is bandwidth (8 kB/s is ~20 GB a player a month). What would change it most: sending
each car once rather than through every zone the two players share (KNOWN_ISSUES.md), and a host with cheap or
included egress. Also in [COSTS.md](COSTS.md); the live figure is on the admin dashboard. Nothing has been bought.

## The tests

| Test | What it covers |
|---|---|
| `tests/unit/roam.test.mjs` | The rules, pure: zones and the zones a car is in (the handoff's hysteresis, corners, a teleport); placement (party, friends, players near, ping; blocked; the cap and the friend slots; a handoff's group); seeing (blocks, location, appear offline, join friend, names); contact (both on, the party, passive, auto-ghost, challenges); the auto-ghost (repeats, light or blameless hits); challenges (asking, declining and its doubling cooldown, no answer, spam, blocked players, groups); flashing headlights; a sprint route on the real Milton Keynes road graph, the rolling start, a jump start, results, the check (edited records caught), the pay and its caps; follow-the-leader; meets, the map, coming back, regions. |
| `server/test/roam.test.ts` (Postgres) | The API: settings (kept, validated, in the ticket with friends); coming back (the spot, the car, its damage; the garage when the region's gone or the spot's off road); challenges checked then paid by place, an edited record paying nothing, paid once, the pair's and the player's daily caps; auto-ghost dropping the safety rating; scheduled meets (admins only); the dashboard and the cost; the internal key. |
| `server/tools/roam-test.ts` (Postgres; Redis for G) | End to end with bots made of the game's own client code (`reports/roam-test.md`): **A** friends and parties always in one instance (a full one too, after driving into the next zone), blocked players never; **B** privacy and blocks on the map, in the world, names, join friend, the friends list; **C** challenges — the route, decline and cooldown, passive, a blocked player declined silently, flashing headlights, the rolling start, results checked and paid, the second paid less, a party's group challenge; **D** a bot ramming others auto-ghosted, its safety rating down; **E** leaving and coming back to the same spot, car and damage; chat, the wheel, emotes, inspect, meets, a report with its replay; **F** `--handoffs 1000` at 200 km/h; **G** `--swarm 500` (see below). Also: a zone connection the server closes is joined again. |
| `server/tools/roam-browser.ts` (Postgres, Chromium) | Two game windows (Player A and B) in Milton Keynes: the same zone and instance, each drawing the other's car with its name, the minimap following B's privacy setting, a "Driver" when B shares with nobody, the free-roam screen, inspect, a challenge from the screen answered from the prompt, nearby chat, contact and passive mode in the HUD. |

**How the swarm (G) runs on one computer.** 500 bots — the game's own client code — in 4 processes, 4 zone server
processes sharing Redis, the API, and three "watcher" games parked in the middle (the game's frame cost is timed there).
All on 4 cores, so: the zones are 1 km (`--swarm-zone-tiles 2`: 15–16 zones, ~2.6 connections a bot; still finer than
the game's 2 km); the bots run at the lowest priority and the watchers' process at a raised one (the bots stand in for
other players' computers); and 1 bot in 25 reads the other cars as a game does — the rest receive them (the zone servers
send every bot the same) without reading them, which 500 games' worth of would need far more cores than this computer
has. The report says how fast the bots' cars actually reached the zones (states a second a connection; a game sends 30).
The thread CPU clock here counts in 4 ms steps, so the tick's own CPU time is reported as a mean, not per tick.

### Results (this computer: 4 cores)

The last full run (`--handoffs 1000 --swarm 500`, A–G): 55 of 56 checks passed; the one missed is the handoff snaps.

- **A–E**: all passed — friends, parties and a full instance's friend slots; blocked players placed apart; two friends
  handed over together; a zone connection closed by the server joined again; privacy on the map, in the world and in
  names; join friend; blocks both ways at once; challenges (route shown first, decline and cooldown, passive, blocked,
  flashing headlights, the rolling start, checked and paid, the second paid less, a party's group challenge); the
  rammer auto-ghosted everywhere with its safety rating down; coming back to the same spot, car and damage; chat, the
  wheel, emotes, inspect, meets, a report with its replay.
- **F, 1,000 handoffs at 200 km/h** (25 drivers in 3 processes, 393 s): nothing lost (look, damage, settings — 4,412
  zone answers), no car drawn from a frozen view, 1,476 times a watching game's view of a car moved zone. Every frame of
  every car within 700 m: 46 snaps in 1.75 million car-frames (2.6 per 100,000); **24 of them within half a second of a
  switch** (1.6% of switches: 11–16 cm off where the car moves ~90 cm a frame; once 4.2 m). With 10 drivers (400
  handoffs) it was 1 in 598 switches, worst 27 cm: the misses come with the load (late states under 4 busy cores), not
  with the switch itself. The game's cost of merging and sampling the zones: p50 0.27 ms, p95 0.61 ms a frame.
- **G, 500 bots** (1 km zones): 15 zones, 35 instances, 4 processes; 1,302 connections for 503 players; 1,299 of 1,315
  zone connections online at the end (16 joining); 272 handoffs. Zone tick p50 at worst 2.89 ms (p95 10.4 ms; mean CPU
  2.55 ms); zone servers 2.07 ms of CPU a second per connection (Step 1's budget: 3.91); the watching game's frame p95
  2.17 ms drawing ~127 cars; download 14.6 kB/s a bot on average (p95 29.8), upload p95 0.95. **But the bots' cars
  reached the zones at only 2.8 states a second (a game sends 30)**: 500 games' worth of sending needs more cores than
  this computer has beside the servers, so the load above is lighter than 500 real players'. Not verified here.
- **G, 150 bots** (same zones, to get nearer a game's rate): 15.3 states a second; 414 connections; 3.53 ms of CPU a
  second per connection (budget 3.91); tick p50 at worst 3.40 ms; frame p95 2.14 ms drawing ~86 cars; **download 35 kB/s
  a bot on average, 74 at p95** — every bot sees ~85 others within 1.5 km (a very dense crowd), and a car near a border
  arrives once through each zone the two players share. Over Step 1's 48 kB/s (a target for 30 cars nearby).
- **The browser test** (`server/tools/roam-browser.ts --local-libs`): 14 of 14.
