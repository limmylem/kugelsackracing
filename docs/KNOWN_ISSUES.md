# Known issues, and what to revisit

As of Phase 8 Step 4 (final polish and launch, first), Step 3 (the content pipeline), Step 2 (performance and graphics settings), Step 1 (the game's sound), Phase 7 Step 5 (online for friends testing), Step 4 (free roam), Step 3 (car-to-car contact), Step 2 (multiplayer races), Step 1 (multiplayer's networking), then Phase 6's deployment step (going online, then Step 2's server-owned economy, then Step 1's server and
accounts, below first); Phase 5's and Phase 4's entries as they were at their ends. Each with what was seen and where; the tests named reproduce them.
How quests, rewards and progression work: [PROGRESSION.md](PROGRESSION.md).

## Fixed on 2026-10-14 (a pass through this list)

- **Cars have bump stops** (physics/vehicle.js `BUMP_STOP`): past a spring's travel a progressive, damped rubber stop
  (up to 6 cm) pushes back instead of the body coming down onto the road. Dropped a metre onto the test centre's
  straight, no car's floor touches the road (the Apex V8's did from half a metre); a kerb strike counts what the stop
  takes. tests/unit/bumpstops.test.mjs. The rally stage: the Strada Evo still fastest; the Apex V8 (14 cm of travel) is
  now about 13 s slower there than before, its stops working over the stage's bumps.
- **Rain changes grip** (`conditions.applyGrip` on): every car in a rain event, the player's and the NPCs', has 0.82 of
  its grip on every surface (physics/sim.js `setGrip`); the NPCs plan their speeds on it (route/racingLine.js
  `wetCaps`), and a rain event's medal times allow 4% more (data/quests.json `medals.weather`: the AI is 0.3–5% slower
  in the wet). Multiplayer lobbies' weather is still only a setting shown in the lobby (drawn and driven dry).
- **The six draft parts pass their checks:** the kevlar Shellback seats are priced in the tier whose band holds their
  price for what they do (seats have a sport tier now; tools/content/families.mjs prefers it), and the Groundline kits
  are made without dive planes (sold as their own part): a 60 km/h crash costs less than two race wins to fix.
- **Tyre walls and glancing hits** — measured, not a problem: over 256 glancing hits along the tyre walls of three fast
  circuits, a car slides along a tyre wall as far as along the same wall built of concrete (median 44 m both). The one
  case seen before was the wall's curve further on, not its material. `npm run test:dress-drive` checks it now.
- **`?player=` development players come back where they left** (`GET /roam/me?player=A`, development only).
- **Ramming evidence expires** after 30 days unless an open report points at it (retention `evidenceDays`;
  PRIVACY_DATA.md).
- **The lobby's host picks any published route from a list** (the official ones first, then every published route in
  a region the game has: `GET /mp/routes`).
- **Reporting a player** (the lobby, free roam's Nearby, the leaderboards) uses the game's own dialog, not the
  browser's prompt box.
- **Steep routes rate harder:** a grade past 15% scores again (full at 30%: `difficulty.points.steep`), so 20–28% hills
  aren't 2★ any more. Stored ratings change when a quest is saved again or checked in bulk.
- **Club tier opens at level 2** (about 7 first-time Rookie golds, not 15). On the server online the economy settings
  are the database's: the owner sets Club to 2 on the admin page (Economy settings → "Quest tiers: the level each opens at" → Save tier levels) — new keys
  like the steep rule arrive by themselves, changed values don't.
- **The tier-3 time trial's pay** is within 0.6–1.6× of its tier's median again (all 17 type × tier rows, in
  `npm run test:track-events -- --only economy` and `npm run economy-sim`).
- **Race replays' wheels turn and steer**, worked out from each car's recorded motion (the distance rolled; the yaw
  rate, a bicycle model). The cars still carry the damage they have now.
- **Fitting parts under load:** the game's data with the published content is made once per settings and catalogue
  version (not for every request), and a build's stats are kept once worked out (garage/stats.js): with 500 players
  fitting at the same moment, p95 13.1 → 10.0 s (fitting) and 17.1 → 9.0 s (taking off).
- **Other players' damaged engines misfire**, from the crashes their cars send (the engine's condition lost), as an
  NPC's does; a leaking radiator steams and a loose panel flaps too (audio/remoteDamage.js), as yours do.

## Phase 8 Step 4: final polish and launch (LAUNCH_CHECKLIST.md, docs/RELEASE.md)

### Fixed on the way (2026-10-16)

- **The dock and the News button showed message names online** ("dock.tow", "dock.chat", "news.button": the owner's
  screenshot). index.html drew them before the game's words had loaded. Now the language loads first, and both redraw
  whenever it loads or changes. `tools/first-launch-browser.mjs` fails on any message name in either (it reproduced
  the bug on the old code), and `tools/live-look.mjs` checks the live site for it.
- **The Stelvio Pass never let you drive.** The car is put down by a ray cast from 900 m, and the pass's road is at
  2,760 m, so a player who went there saw "Loading the world" for good. The ray now starts above the ground's own height
  there (map/render/game.ts `land`). Found filming the trailer; `live-look` drives it online (drivable in 12 s at 2,759 m).
  Only Stelvio is that high; the old v2 world (`?map=v2`, San Francisco only) still starts at 900 m.
- **Two players joining free roam at the same moment could end up in different instances**, each alone. A new
  instance's group was a random name, so two players placed before either's room existed each got their own. Now it's
  the first free name (g1, g2, …), the same for both (mp/roam.js `placeInstance`; tests/unit/roam.test.mjs). This is
  what failed the two-windows browser test (`server/tools/mp-two-windows.ts`: both "online #1", in different rooms,
  seeing nobody) and, earlier, its F9 check. Deployed 2026-10-16 (run 360), and the two-windows test passes
  again (slow-tail run 3, all its checks). It's in `slow-tail` now (Actions → slow-tail → Run workflow), as an earlier
  step's flake (below) can stop the full run's slow tests before it.
- **The trailer's multiplayer shot was filmed with one car.** After most of an hour of filming, the browser drew a
  frame every few seconds and lost its connection to the game server. The filming (devlog/capture/capture.mjs) now
  opens fresh browsers for each run, and leaves out a multiplayer shot whose camera car isn't online rather than
  filming it alone.

### Things to know

- **The two-browsers multiplayer test now and then sees one snap on a clean network** (`server/tools/mp-browser.ts`:
  one jump of 15.5 cm in about 1,500 frames watched at 60 fps; runs 345 and 359 on 2026-10-16, while the same run's
  150 ms / 5% loss check passed). It isn't every run, and it isn't from Step 4's changes. A failure there stops the
  slow tests after it, so the two-windows test and the rest don't run: `slow-tail` runs them on their own.
- **737 strings of hard-coded English are left** outside `locales/` (data/i18n-baseline.json; the check lets the number
  only go down). English is the only launch language, so players don't see this; a translation would miss them.
- **The trailer was filmed without a graphics card** (software rendering, as in CI): flat light, no shadows on the
  cars. On a computer with one, `cd devlog && node trailer/make.mjs` films it again in about an hour (RELEASE.md
  "Trailer").
- **The two-windows test doesn't load the world in this development container** (`look` never sees a car; the page's
  renderer isn't made), though it does in CI. Run it in CI or `slow-tail`.
- **Legal texts are drafts**: the privacy policy and terms wait for a lawyer, and whether a free web game needs a formal
  rating in Australia is an open question (LAUNCH_CHECKLIST.md section 1).

## The seven cars rebuilt from the starter coupe's model (2026-10-15; tools/content/coupeCar.mjs)

The Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo and Apex V8 are now the starter coupe's model
reshaped to each one's proportions, in place of the box placeholders. Their cabins, engine bays and wheel wells are the
coupe's, smaller and more detailed than the boxes' were: the add-on parts made by code were made again for them, and
most fit as before, but a few published ones meet the new cabins or bonnets. They're waived (`data/content/check-rules.json`
fit.known: each with where, how many places and how to fix it) so a player who has one fitted keeps a drivable car:

- **Roll cages** (bolt-in and welded) in the Brute 500, Hana Roadster and Ridgeback 4x4: the cage finder finds no clear
  plane behind the seats, so the cage meets the side trim. The Hana Roadster's **roll hoop** too.
- **The race harness** in the Apex V8, Ridgeback 4x4, Strada Evo and Vortex R: its belts meet the seat back or the shelf.
- **The strut braces** under the Ridgeback 4x4's bonnet, and **the Brute 500's V8**
  swapped into the Kaze GT and the Ridgeback 4x4 (taller than their bonnets).
- Small touches, a few places each: **the 19" rims** on the Kaze GT and Vortex R (their barrels meet the rear bulkhead,
  which runs up to the tyre as on the starter coupe, whose own 17" rims meet it the same way), **the cat-back exhausts**
  on the Vortex R and Brute 500 (the rear underfloor), **the bucket seats** (the cabin floor), and a few more in
  fit.known.
- Some draft family parts (the Shellback seats, the Gripline steering wheels, the Readout gauge pods, a few crate
  engines and intakes) now leave out cars they don't fit (their `conflicts` say which); no player has them yet.
- The bigger cars' bodies are over the dent budget's 150,000 triangles for their first dent (the Ridgeback 4x4's about
  220,000 for the whole car): a short stutter the first time one is dented, spread over frames.

## Phase 8 Step 3: the content pipeline (docs/CONTENT_PIPELINE.md)

- **The four part combinations that went through the car are fixed** (`data/content/check-rules.json` fit.known is
  empty again): the ducktail has its own version for the Ridgeback 4x4 and the Vortex R, raised on two feet to sit on
  their boot lids; the Kaze GT's engine swaps need its new cowl bonnet (bought with them; a car that already had a swap
  is given one free, its old bonnet put in the inventory), and the V8 sits 4 cm higher in it. The twin-screw
  supercharger sits in the V8's valley, through the engine's own box (fitcheck.js THROUGH), as a real one does.
- **Collision hulls are the built-in splitter's** here (CoACD isn't installed in CI or on this machine): a little
  rounder than CoACD's. Installing CoACD (`pip install coacd`) and running `npm run content -- finish` again doesn't
  change hulls already made; delete a part's `collision` to have it made again.
- **A part still hanging off the car is a box to the physics** (as before); its collision hulls are used once it's torn
  off and lies in the road: a hanging bumper's real, curved shape snagged the road at 190 km/h (tests/unit/detach.test.mjs).
- **The Blender add-on's test runs only where Blender is** (BLENDER_PYTHON or BLENDER; not in CI): the add-on's rules
  copy is checked everywhere.
- **Thumbnails are drawn without a browser** (the icons' software renderer): flat-shaded like the game, no shadows on
  the car itself, tyres as plain rings.
- **The class limits are found by search** (the most powerful build of each car with every part, drafts too): a combination
  the search doesn't try could, in principle, be stronger; the search tries every part's best settings.

## Phase 8 Step 2: performance and graphics settings (docs/PERFORMANCE.md)

- **Frame rates on real graphics cards aren't measured here:** this machine and CI draw in software (no GPU — the
  owner's choice of free CI). The tiers' targets are checked on real computers with the game's own test (Settings →
  Graphics → "Test this computer"; Shift+P), and CI compares the CPU's side, draw calls, memory and garbage instead.
- **The first launch's test takes a few seconds** at each preset from high down (up to about 12 s on a slow computer),
  the picture changing as it goes; it happens once (and again only when asked).
- **WebGL 2, not WebGPU:** three.js r160's WebGPU renderer was 2–5× slower on the CPU and can't run the game's own
  shaders; to look at again with a newer three.js (`tools/renderer-bench.mjs`).
- **Compressed textures (KTX2) only for big ones:** the game's own models have almost none to compress (58 KB in all the
  car models); since Step 3 the import makes any texture of 512 px or more KTX2 (docs/CONTENT_PIPELINE.md).
- **No occlusion culling:** what large buildings hide is still drawn when it's within its detail distance (the city's
  tiles keep that to about 250 draws).
- **The physics and the NPC drivers run on the main thread** (on purpose: no frame of input delay; 8 cars with
  collisions take about 5 ms per 60th of a second here, within the 6 ms budget).
- **The physics makes a lot of short-lived garbage** (its small vectors: about 130 MB per simulated second in an 8-car
  race). Left as it is: the collector takes about 1–2% of the main thread for it, in pauses of about a millisecond
  (`tools/bench.mjs --cpu`), and rewriting the vehicle model's arithmetic isn't worth any risk to the physics.
- **Safari is tested as WebKit** (Playwright's build of Safari's engine, on macOS in CI), not Safari itself.
- **Firefox isn't driven in CI:** on GitHub's Linux machines it has no WebGL at all (no graphics card, no software
  fallback even forced on); what it supports and the old-browser message are checked. Firefox is to be tried on a real
  computer.
- **Live reflections (ultra) draw the scene again** a face every other frame: a high-end setting.
- **A far car in one piece shows no new dents** until it's near again (dents too small to see at that distance), and
  its wheels don't turn; its shadow is its one piece's too, so a shadow doesn't show a door hanging open.
- **Old track detail settings are forgotten:** the graphics settings replace "effects quality" and "track detail"
  (the first launch's test picks a preset for everyone once).

## Adelaide, a new region (2026-10-11; MAP_README.md, "The Adelaide bake")

- **Elevation from a 30 m surface model** (Copernicus GLO-30): South Australia's 1 m LiDAR (ELVIS) couldn't be
  downloaded on the bake machine. Hills, the coast and the plains are right; in the CBD a junction's height can
  carry the model's noise. Southbound on King William Road into North Terrace the road crests at +7.5 % then
  +17 % over 4 m: above about 100 km/h a car bottoms out there and stops (the route test's autopilot did, at
  116 km/h, so its Adelaide route ends before it). Overall Adelaide has the fewest sharp grade changes of any region
  (more than 10 % within 4 m: 2.6 per 10 km of road, San Francisco 9.4, Tokyo 22, Monaco 64). The fix: the LiDAR
  as the region's first elevation source, then a bake.
- **`npm run test:map -- --region adelaide`: three checks fail** (four until the physics test's road below was fixed), all bake behaviour, not
  Adelaide's data:
  - one dead end of 14,154 lies on another road without joining it: Middleton Drive, which OpenStreetMap (via
    Overture) ends 10.8 m short of McMurray Avenue's straight 176 m piece — beyond the join's 6 m — while the curve
    the bake fits through McMurray's nodes brings the road under its end. The two meet within 4 cm: no step.
  - the road-surface check's 5 % sample finds one OSM node 1.4 m from the drawn surface: Brooks Lane, a 7.6 m
    piece between two junctions, where the two junction fans leave a gap and the ground shows 7 cm below.
  - the railings test's parapet is at the end of the Montefiore Road bridge (by Morphett Street), where its deck
    is 1 m above a road beside it: hit from that road at 15°, the car slips under the deck's end (2 of 16 hits).
    The bake keeps the ground clear under a bridge's ends and nothing closes their sides, in every region; from
    the deck the parapet holds at 50–300 km/h.
  - (fixed) the Phase 1 physics test ran on the coast spot's road, whose longest straight is 653 m (it wants 900); it
    now takes the longest straight main road when that's too short: Grange Road's 1,480 m, where all four pass
    (2026-10-14: 0–100 in 9.25 s, 100–0 in 41.3 m).
- **NPC racers** (`npm run test:npc -- --regions adelaide`, not blocking in CI): Adelaide's route at low, medium
  and high skill finishes cleanly, and (2026-10-14) its 8-car race too. Monaco, Stelvio, Tokyo and Milton Keynes still
  have a stuck car or more (docs/NPC_RACERS.md, "Known limits").
- **Its road graph is the biggest** (89,000 segments): about 0.4 GB in memory in each of the API and the
  real-time server once someone drives there (docs/DEPLOYMENT.md), and about 0.2 GB of a browser's memory once Set
  route or a quest there loads it (San Francisco's: about half).

## Phase 8 Step 1: vehicle and world sound (docs/AUDIO.md)

- **No music yet:** the music group and its slider are there, with nothing in it.
- **Every sound is made by our own tools** (no recordings, no library bought): engines are convincing but not a
  particular real car's; recordings can replace them file for file (docs/AUDIO.md lists what would be needed).
- **The low-end budget is estimated,** not measured on a slow device: the desktop's time × 4 (data/audio.json
  `budget.lowEndFactor`). On low quality the 8-car race used 8.7% of a 2.8 GHz cloud core (34.9% at × 4; budget 60%).
- **The first seconds cost more:** the audio thread's code is compiled as it runs — the race's first 8 s took 18.5%
  of real time against 12.6% after (budget 15%). Once per game, as the sound starts.
- **Safari may not decode Opus;** it then fetches the WAV files instead (about 6× bigger, the same sound).
- **Other players' cars** are heard from their network state (revs, throttle, gear, wheel slip) and the crashes they
  send: a damaged engine misfires, a leaking radiator steams, a hanging bumper flaps. The steam's end is worked out
  from the leak they sent (the coolant they had, less the leak a second since), not sent.
- **Echoes** come from rays against the world's fixed colliders every 0.2 s; a gap in the colliders (a bridge without
  a deck collider, say) sounds like open country.

## Phase 7 Step 5: online for friends testing (docs/GO_LIVE.md, docs/DEPLOYMENT.md)

- **A race running when the real-time server crashes is called off**, not resumed: its racers are told ("Nothing was
  lost"), nothing is paid, and they queue again. Free roam players are put back by themselves. (Live crash test,
  2026-10-10: back in 2–4 s.)
- **A player whose race server is gone for good waits about 60 s** (the connection's 30 retries) before "race called
  off" shows; when it's back sooner they're told within seconds.
- **Deploys are one at a time:** a deploy still waiting for approval holds up the newer ones until it's approved or
  cancelled; each includes everything before it, so approving only the newest is enough.
- **The slow tests run beside a deploy, not before it** (the owner's choice): a failure there is fixed, or rolled back,
  after. Three of them are timing-sensitive on GitHub's shared runners (the clock sync, car contact, the browser race
  test); each failure so far was fixed at its cause.
- **Starts are a little slower since the clutch fix** (0–100 km/h 9.22 → 9.35 s); the Strada Evo now only just beats
  the Apex V8 on the rally stage (it won before because the Apex burnt out its clutch).
- **The editor's world map** (OpenFreeMap's style) shows blank stand-ins for a few icons its sprite hasn't got, and no US
  road shields.
- **Ping from GitHub's US runners is about 200 ms**: the load tests' targets allow for it; from Australia it's 20–30 ms.

## Phase 7 Step 4: free roam (docs/FREE_ROAM.md)

### Fixed on the way (found by the free roam tests)

- **Handing a car over between zones made it jump.** Each zone server sends its states with its own delay and clock,
  so switching which zone a car was drawn from moved it by up to a few metres. The game now lines the zones' clocks up
  by the physics tick both stamp, keeps a car on the zone that's sending fresh states, and blends any small leftover
  over at least `blendMs` (longer the bigger it is), drawing the car's real velocity meanwhile. A car that really
  leaves fades out instead of vanishing.
- **A lost zone connection stayed lost.** If a zone closed a player's connection (or a join failed, or never answered),
  the game kept the dead connection and never joined that zone again: every car in it was invisible until the player
  drove out and back in. The 500-bot swarm found it — half its zone connections were gone by the end (the test's own
  bots had sat idle while the others joined, and the zones rightly closed them after `NET.idleSec`). The game now joins
  a lost zone again (1 s, doubling to 30 s), the swarm drives each bot from the moment it's in, and two checks guard
  it: section A closes a connection from the server and expects it back with the car seen again; the swarm expects
  98% of all zone connections online at the end.
- **A kink at a handoff.** When a car's source zone changed, its position was eased but its velocity changed in one
  frame: a few centimetres' kink, seen as a snap in 38 of 1,484 switches in one run. The velocity is handed over too
  now (over 150–500 ms).
- **Far cars counted as frozen.** A car beyond 700 m is sent a few times a second, so it's predicted between states
  most of the time; "fresh" and "frozen" now allow for how far apart its states come.
- **The swarm's frame-cost check measured nothing** after the other sections had run (their loop was stopped but not
  forgotten, so the swarm's watchers were never stepped): it passed with 0 cars drawn.
- **An idle database connection closed by the server ended the process** (node-postgres's pool error, unhandled):
  seen when the test dropped its database; a database restart would have done the same to the API. Logged now.
- **The first roster had no names or privacy.** It was built before the zone had the player's free-roam record; a
  `joining` hook fills the record first.
- **Two invites from one flash near a border.** Every zone the car was in saw the flashing; only the home zone looks
  now, and an answer goes back to the zone the invite came from.
- **A challenge lost its zone.** The cars drove out of the zone that ran it before the finish; the game keeps that zone
  open (pinned) until the results.
- **A rolling start could wait forever** for a car that never got rolling: it's called off after `maxHoldSec` (30 s).
- **Flashing was looked for sideways** (the car's forward axis was wrong in the detector).
- **Leaving lost the car and its damage.** The last save ran after the player had been removed from the zone.
- **Inspect showed the wrong car**: the one on the player's ticket, not the one they were driving.
- **The hub's notices crashed on one process** (`toUser(...).catch` with the local presence), and a block or a new
  friendship told only one of the two players.

### Things to know

- **A handoff still snaps now and then under load.** In the last 1,000-handoff run (25 drivers on 4 busy cores), 24 of
  1,476 times a watching game's view of a car moved zone it snapped within half a second: 11–16 cm off where the car
  moves ~90 cm a frame, and once 4.2 m. With 10 drivers (400 handoffs) it was 1 in 598, worst 27 cm. What's left comes
  with late states (the new zone's view correcting a prediction just after the switch), not with the switch itself; the
  4.2 m one wasn't seen again. `ROAM_DEBUG=1 node server/tools/roam-test.ts --only F` prints each snap near a switch
  with what the views were doing.
- **500 bots can't send at a game's rate on this computer.** In the 500-bot swarm the bots' cars reached the zones at 2.8
  states a second (a game sends 30): 500 games' worth of sending needs more cores than are left beside the zone servers.
  The swarm's server numbers are for that lighter load, and its new check says so (it fails). With 150 bots (15.3 a
  second) the zone servers used 3.53 ms of CPU a second per connection — Step 1's budget is 3.91, so at a game's full
  rate a zone process may carry fewer than 256 connections (not measured). Re-run with the bots on other computers
  (DEPLOYMENT.md item 12; that costs money: ask first).
- **Download in a dense crowd is over Step 1's target.** With 150 bots each seeing ~85 cars within 1.5 km, at half a
  game's rate: 35 kB/s a player on average, 74 at the 95th percentile (Step 1's target: 48 with 30 cars nearby). Two
  reasons: every car within 1.5 km is sent, however many; and a car near a border arrives once through each zone the two
  players share (~1.8 times on average with 1 km zones). Done (2026-10-14): in a crowd only the nearest 24 cars come at
  the full rate (net/settings.js interest.fullCap; the rest at the next ring's), and a zone that starts sending a car
  again after a gap is drawn afresh, not glided across the gap (net/remote.js). Built but **off**
  (data/roam.json zones.oneSender): each car sent to each player by one zone they share, the zone that stops sending for
  shareSec more and telling the game so it switches first. In the 200-handoff test it made 34 of 55 snaps come at a
  switch (up to 59 cm; none with it off), because a zone was sometimes told to stop before the one taking over had the
  car — the game would need to confirm what it receives. Not needed for friends testing (a few players); the crowd's
  numbers haven't been measured again (the 150-bot swarm needs Redis and more cores).
- **Frozen views at a handoff on this computer:** the 200-handoff test puts a car right from a zone whose view had
  frozen 57–95 times (79 on the code from before these changes too); FREE_ROAM.md's run had none. Timing on a busy
  4-core container; the snap check itself passes.
- **Contact across a zone border is agreed one-sidedly.** Two players near a border can have different home zones;
  each reports to its own, which checks it against its own view of both cars (as Step 3 does when one report is
  missing). Both games still get one agreed result each, but the two zones don't compare notes.
- **Voice chat in lobbies and races** (2026-10-14): everyone in a lobby and its race hears everyone in it, at full
  volume (mp/voice.js 'room'; the lobby's corner: the microphone and who's talking); free roam's voice waits meanwhile
  and joins again after. Not yet in the menus. Tested through the stand-in for Cloudflare's SFU
  (server/tools/voice-browser.ts); the real one is checked online once its two secrets are added (GO_LIVE.md "Voice chat").
- **Voice chat across several real-time processes:** each player's entry is in presence (Redis with several processes),
  so it works there — but tested in one process only.
- **The browser test needs `--local-libs` here**: the page loads three.js, Rapier and MapLibre from jsDelivr, which this
  computer can't reach; the option serves them from node_modules (14 of 14 then).
- **Not checked on two networks yet.** Everything ran on this computer (Phase 7 Step 1's deferred check, now with free
  roam: two players on different networks in the same zone and instance).

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
- **Ramming evidence is kept in full** (both cars' last `replaySec`, a few tens of kB gzipped) for 30 days, or while
  an open report points at it.

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
- **The lobby offers the official routes** (`data/multiplayer.json` venues.routes, one a baked region) first, then
  every published route (`GET /mp/routes`), random, the official tracks or a track code.
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

Done in Phase 7 Step 5: the server is an OVHcloud VPS (always on — nothing sleeps) and the database PlanetScale
Postgres PS-5 (its own backups, besides the nightly encrypted one). Still on a free plan: **email** (Resend: at most
100 a day — plenty for friends testing; docs/COSTS.md).

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
- **Fitting a part or taking it off** waits up to about 10 s (p95, measured again 2026-10-14: fitting 13.1 → 10.0 s,
  taking off 17.1 → 9.0 s, the whole rush 61 → 53 s, once the game's data with the published content is made once
  per settings and catalogue version, and a build's stats once for each build: garage/stats.js).
- **Everything else** waits about 1–6 s.
- **Why:** each fit or removal runs the game's own build checks: the car's stats several times, about
  20 ms of CPU. About 165 requests a second fit through one process.

At a person's pace (the default: arriving over 20 s, 5–20 s between actions) every action's p95 is under
about 100 ms. The game shows each change at once, so only the confirmation waits.

The server online (an OVHcloud VPS-1: 2 vCores, shared by the API and the real-time server) holds fewer. Before there are that many
players:
- a paid instance with more cores;
- faster build checks still: the cache of a build's stats (2026-10-14) helps within a player's actions; each fit
  still works out the new build once (about 3 ms) and checks it.

### One server process: changes from another device reach the others through it

Another tab's or device's changes come through the server's events (`GET /player/events`), which are
sent by the process that made the change. With more than one server process, they'd need passing between
them (PostgreSQL's `LISTEN`/`NOTIFY`). Online the API is one process (the VPS), so this doesn't happen yet.
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
- **The server online (2 vCores):** about half as fast, so a burst like this would take about half a minute.

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
- **`npm run test:track-events`:** "every quest type pays 0.6–1.6× the median". The tier-3 time trial paid 0.55×, the same number before Step 5 (within range again by 2026-10-14: all 17 rows).
- **`npm run test:npc`:** the known stuck-and-reset races in Monaco and Stelvio (above: reported in CI, not blocking).

### Nearby content: a 10 km circle in the densest city is over 5 ms through the API

`npm run stress:content -w @kr/server` (50,000 markers):
- **Within the Phase 4 limits (p95 5 ms, worst 25 ms):** every nearby, cell and tile query in the
  database, and every query the game makes (3 km, whole items).
- **Over:** a 10 km circle in the busiest cities through the API, at a p95 of about 13–16 ms. It returns
  about 320 items (167 KB), and the time is in building and sending that much, not in the search. The
  database's own time for it is within the limit.

The game never asks for that much at once. The editor's map asks by tiles, which are cached and small.

### Free hosting sleeps (no longer)

Since Phase 7 Step 5 nothing sleeps (an always-on VPS, a PlanetScale database). The game's chip still says "Waking the
server…" and keeps retrying when the API doesn't answer — now only during an update or a restart.

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

The lasting fixes, done (2026-10-14): in a browser the in-browser content service now runs in a **Web Worker**
(content/worker.js; `npm run test:content-worker`: 10 queries over 3,000 places nearby took 176 ms with the page's worst
frame 27 ms), so its queries and cell loads are off the main thread — the timings above are the worker's now, not the
game's frames. And **routes are apart from the quests** where players get their content: the game's server keeps every
item in its own row (PostGIS, indexed by place), and the game's nearby queries ask for marker kinds only (quests, venues,
garages…), so they never read a route's course; a route is fetched by its id when a quest is entered.
The in-browser service (the editor and the game without a server) still keeps routes in the quests' cells.
`stress:quests` measures that service as before, and stays reported in CI, not blocking.

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
- **Run-off isn't enough everywhere**: straight on at the racing line's speed (a quick race car's) a car
  stops or hits slowly at 92% of corners in `npm run test:dress-drive`; the rest are mostly street
  circuits (walls close on purpose) and corners where another part of the track leaves no room.
- **A tyre wall's softness is in the damage, not the physics**: it doesn't bounce and its hits reach the
  damage model at 55% (physics/settings.json impacts.materials), but the car still stops as fast as at a
  concrete wall — Rapier has no per-collider compliance.
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
- **Replays record the cars' bodies only**: the recording is the Phase 4 ghost format (position, rotation,
  velocity at 20 Hz); the wheels' turning and steering are worked out from that as it plays (since 2026-10-14), and
  the cars carry the damage they have now. A replay is kept until the next run (not saved, not shareable).
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
