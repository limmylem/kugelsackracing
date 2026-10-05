# NPC racers

Phase 4 Step 4. Rivals race the player on the same physics: their cars are built from the parts system
and driven through the same controls. Each rival is a named driver with its own skill and character.
Placeholder values throughout: balancing is Step 5. The rules are in `data/npc.json` and
`data/quests.json` (`race`).

## The pieces

| Module | What |
| --- | --- |
| `route/racingLine.js` | the racing line, worked out when the route is saved and per car at the start (see below) |
| `ai/driver.js` | the AI driver: separate from the car, it gives a car its inputs each physics step |
| `ai/skill.js` | a driver's numbers from its skill and personality |
| `ai/rng.js` | seeded randomness: every random thing an NPC does comes from the race's seed |
| `ai/npcCars.js` | NPC cars built from the parts system, aimed at a performance target |
| `race/setup.js` | who races: the quest's rival settings → drivers, skills, cars |
| `race/race.js` | the race (positions, gaps, NPC damage and retirements, resets, rubber-banding, level of detail) |
| `race/aiTest.js`, `editor/aiTestRace.js` | the editor's AI test race, problem spots, AI reference times |

## Racing lines (baked per route)

The racing line is worked out when a route is saved (route/model.js `bakeRacing`) and stored with it
(`course.racing`: offsets across the road, decimetres, delta-coded). If the route has changed since, it
is made again.

**How it's made:**
- **A reference line first.** The centreline is smoothed and resampled every 2 m. A map's sharp vertex,
  such as a hairpin drawn as two straight lines meeting, becomes a bend. Each point notes how far it is
  from the real centreline, so the limits stay the real road's edges.
- **Minimum curvature.** Each point moves across the road until the line's fourth difference is zero:
  the least bending, not the shortest way. The work goes coarse to fine, so a long bend is straightened
  as a whole.
- **Its limits.** The line stays inside 80% of the mapped width less 1.1 m. Kerbs, gutters, parked cars
  and a step to the road beside it all make a real road narrower than its mapped width. Narrow streets
  keep nearer the middle, and the narrowest point within 8 m counts, because where a road narrows there
  is a corner. The first and last 30 m of a point-to-point route stay central (the grid, the finish
  line).

**Fitted to the world** (`race/fit.js`, at the start of a race or AI test, once the world's colliders are
loaded). The map's width is only what the map says: a kerb, a wall or a bank inside it, or a baked
terrain ledge, isn't in it. Every 2 m two rays each way across the road (at 0.35 m and 0.9 m over the
road, against the fixed world only, never a car) measure the real gap, and the line keeps 1.15 m (half a
car) from what they hit. Where the gap is narrower than a car's comfort, the line goes through its middle,
and the speed plan slows: walking pace through a gap of about a car's width, picking up as it opens to
3.4 m.

**The speed plan** is worked out per car at the start of a race, from its garage numbers (its real
parts): its grip, its braking (from its 100–0 distance), its power at the wheels, its drag and downforce,
and its top speed.
- **Corners:** v² = μg/κ, with downforce.
- **Tight turns:** a bend about as tight as the car can turn at all is walking pace.
- **Crests and dips:** a crest is taken as a hop (the ground falling away at up to 0.9 g); a dip keeps
  the squash to 0.8 g.
- **Accelerating out:** forwards from each point, with traction, power, drag, rolling resistance and the
  hill.
- **Braking zones:** backwards from each corner, with the grip left over from cornering.

The driver's margins scale it.

**In the editor**, the route tool draws the racing line coloured by the speed the starter car can carry
(medium skill), blue slow to red fast.

## The AI driver

**Same physics, no cheats.** An NPC's car is a car in the same simulation as the player's, with the same
tyre model and drivetrain. Its driver gives it the same inputs a player gives (steering through the
wheel, throttle, brake, the automatic gearbox, the handbrake) and the car's own driver aids. There is no
extra grip, power or force. Any car can be driven by the player or by an AI.

**Steering** is pure pursuit on a point of the racing line ahead:
- the look-ahead grows with speed (7–32 m), measured along the line;
- damped against yaw, countersteering if the rear steps out;
- never more lock than the front tyres can use.

**Speed:**
- **The target** is the slowest point within braking distance, braked for from where the car is.
- **Braking** is a feed-forward from the deceleration that point needs, plus feedback.
- **Throttle** is smooth, rate-limited by the driver's reaction time.
- **Grip** left over from cornering is shared between throttle and brake, with less throttle once the
  car slides.

**Skill** (0–1, each setting can also be set on its own):

| Setting | Effect |
| --- | --- |
| line accuracy | how far it wanders off the line (1.4 m → 0.15 m) |
| braking point | the share of its braking it plans with (0.62 → 0.93) |
| cornering margin | the share of its grip it corners at (0.70 → 0.97) |
| reaction time | 0.45 → 0.15 s |
| consistency | its pace varies 5% → 0.8% lap to lap |
| mistake rate | 1.2 → 0.12 a minute |
| throttle commitment | the most throttle it uses once on the move (55% → 100%, all of it from a skill of 0.9) |

**Mistakes:**
- **running wide:** cornering on more grip than it has;
- **braking late:** fading to nothing at the corner itself, and milder into a slow bend;
- **a small lock-up:** ABS off for a moment;
- **a rare spin:** traction control off, too much throttle out of a bend.

**Personality:**
- **Aggression:** how often it goes for a gap, and how often it defends.
- **Caution:** its following gap in traffic (0.35–0.9 s).
- **A hit from another car:** *calm* carries on, *angry* gets more aggressive for 20 s, *rattled* gets more
  careful and a little slower.

**The drivers** are in `data/npc.json`. Ten of them, each with a name, a home, skill, aggression,
caution, a favourite car, a colour and a line about them.

### Around other cars

The race gives each driver the cars near it along the route: how far ahead or behind, how far across,
and how fast. This is a list, not raycasts.
- **Following:** it never runs into the back of the car ahead. Its gap is its caution × its speed, plus
  5 m.
- **Overtaking:** it goes for a gap on the inside of the next bend, or the outside if that's where the
  room is (a car's width and a metre to spare beyond the car it passes). Not while crawling up a steep
  climb, unless the car ahead is stopped. More aggressive drivers try more often. It holds the move
  until it's past, or gives up after 8 s.
- **Defending:** one move, to the inside of the next bend. Never with a car alongside, and at most one
  move in 10 s.
- **A car alongside:** it leaves the room, never steering into it.

**Walls the map doesn't know about** (a parked car, a barrier inside the mapped width) are found with
three short rays ahead, 20 times a second. They push the driver away from the side that's closer.

### Recovery

- **Stuck** (hardly moving for 2.5 s when it should be going): it backs out for 1.8 s. The automatic
  gearbox goes into reverse when the brake is held at a stop, as the player's does. It steers to
  straighten up. Stalled on a climb steeper than 12%, it backs straight down it instead (15 m, at most
  5 s) for a run-up. It never backs up faster than 3 m/s.
- **Turned round** (spun): it straightens up the same way.
- **Still stuck after 3 tries**, on its roof, or more than 25 m off the route: the route's reset. It is
  put back at its last reset point (or further back), never within 7 m of another car, and faded out
  and in.
- **Put back at the same place a fourth time:** it can't get past there, and retires (DNF, stuck)
  rather than going round in circles.

## NPC cars

`ai/npcCars.js` builds each NPC car from a model the quest lets in, then fits parts that fit it, a few
tried at a time, keeping the one that brings it nearest the target. The target is:
- the rating the quest's (or the rival settings') class allows × `cars.target` (0.94);
- or, for a quest open to any car, the player's own car's rating.

The car never goes past the quest's limits (class, power, weight, power to weight), and it must still
be drivable. Where some can, only models that turn tighter than the route's tightest bend (its racing
line's, with 3% to spare) are used: a car that needs a three-point turn at a hairpin holds the whole field
up there. A driver gets its favourite car if the quest lets it in and it can get near the target;
otherwise a model that can. The build is seeded, so the same race gives the same car.

**Damage** follows the player's rules (garage/carDamage.js, with the session's collision mode):
- what a hit does to its parts goes into its physics (the garage's stats for the damaged build);
- under 75% condition it slows in step with the damage;
- undrivable, or under 25%, it retires (DNF).

## The race

`race/race.js`, each physics tick:
- **The NPCs' sessions** are QuestSessions, with the same gates, checkpoints, laps and sub-tick timing as
  the player's. They count down with the player's and go on the same tick.
- **Positions** come from progress along the route (laps and distance); the finished are ranked by
  time, and DNFs come last.
- **Gaps** to the car ahead and behind come from when each car passed where the other is now (noted
  every 10 m).
- **Collision modes** (Phase 3) are respected: full, reduced, or ghosting.

**Rubber-banding** (subtle; `rubberBand` in data/npc.json):
- Ahead of the player by more than 1.5 s, an NPC is a little more careful; behind, a little bolder.
- Its cornering margin and braking change by at most 3.5%, never past the most skilled driver's.
- It never touches the car or the physics.
- It is off for pink slips, and when the player turns it off (pause menu → Settings).

**Level of detail:**
- NPCs within 220 m of the player, or in view within 650 m, drive in the full physics.
- Further away and out of view for 2 s, an NPC leaves the physics. It runs along its racing line on
  its speed plan and still counts for checkpoints and the finish.
- It comes back to full physics at the same place and speed, with the same damage, before it can be
  seen.

**The player's finish:** NPCs still racing get the time they'd have finished in (their speed plan from
where they are, at their pace), marked as estimated (*).

**Not in a worker (yet).** The AI drivers and their cars run in the same physics step as the player's
car, on the main thread, like the rest of the game's physics today: the game has no physics worker to
move them into. What keeps 7 NPCs in budget is the level of detail, the AI's rays against the fixed world
by Rapier's own filter (no JS callback per collider), and skipping Rapier's per-step sweep of every body
and collider for soft bodies (physics/sim.js: there are none). On a whole route's world (28,000
colliders) that sweep was 5 ms a step on its own; an 8-car race is now 1.2–3.1 ms a step.

## In the game

- **The HUD:**
  - your place (1st / 8) and the gaps ahead and behind;
  - the standings (names; ✓ finished, DNF);
  - the drivers' names over their cars, which can be turned off in the pause menu's settings.
- **The results** show full standings with each car, time and DNF reason, plus your place.
- **Rewards by place** go through PlayerService (data/quests.json `race`):
  - 1st, 2nd and 3rd are gold, silver and bronze, each tier paid once;
  - lower places pay the finish share, then the repeat, each × the place's share;
  - a DNF pays nothing.
- **The result carries everyone's times**, and validation checks the place against them.
- **Pink slips** are head to head with one rival in the car at stake:
  - three warning screens, the last asking you to type your car's name;
  - the winner takes the loser's car through PlayerService. Win, and the rival's car is yours with its
    upgrades fitted; lose, and yours is gone with everything on it;
  - no rubber-banding, and the starter car can't be staked.

## In the editor

**Rival settings** (a sprint's or a pink slip's *Rivals* section):
- how many (0–7, at most the route's grid slots less one);
- the skill range;
- the drivers (ticked, or none ticked for random);
- the cars' class;
- aggression (empty: each driver's own);
- rubber-banding on or off.

**AI test race:**
- The quest's rivals race the route in a physics world of its own: the route's baked tiles, loaded
  along it.
- It is watched on the map, the cars as dots in their drivers' colours with their places, at normal
  speed or fast.
- Then a solo lap at low, medium and high skill sets the route's AI reference times, by the quest's
  class (`course.aiTimes`). The medal times use them: gold the high-skill AI's time, silver the
  medium's, bronze the low's.
- **Problem spots** are where AIs crashed out, left the route or got stuck: more than one incident
  within 40 m, or anyone stuck. They are marked on the map and listed (click: go there).

## Tests

- **`npm run test:unit`**, `tests/unit/npc.test.mjs`:
  - the racing line (it straightens a bend inside the road; a narrow street stays central; the offsets
    survive saving);
  - the speed plan (braking zones, grip, the racing line quicker, a faster car quicker);
  - seeded randomness;
  - skills;
  - NPC cars within a quest's limits;
  - who races (by the seed, the skill range, picked drivers, pink slips);
  - rewards and validation by place;
  - pink slips (never the starter car);
  - AI reference times as medal targets.
- **`npm run test:npc`**, `tests/map/npc.test.ts`, on the six real routes in the physics:
  - an AI at each skill level finishes cleanly;
  - the skill spread matches the config;
  - fairness (top speed, cornering and braking within the car's physics);
  - 8-car races (no one stuck or through walls; the finishing order changes with the seed);
  - the same seed gives the same race;
  - an 8-car race within the frame budget, and the detail switches out of sight with no jumps;
  - 100 races without memory growth.

## Known limits (where the tests still fail)

`npm run test:npc` on the six sample routes:
- **Passing:** every route at low, medium and high skill finishes cleanly; fairness (speed, cornering,
  braking within the car's physics); the skill spread (low about 8% slower than high over the routes,
  medium about 2.5%: on the config's targets, though on Monaco and Tokyo the levels are close); 8-car
  races on Tokyo, Munich, San Francisco and Milton Keynes with no one stuck or off the road; the finishing order
  changes with the seed; the same seed gives the same race; an 8-car race within the frame budget with
  the detail switches unseen; 100 races without memory growth.
- **8-car races on Monaco and Stelvio:** every car finishes, but with stuck-and-reset incidents (3 and
  10 in the test's race), where the test wants none, and some moments off the road. (Milton Keynes now
  passes: an NPC coming back from the cheap run is put down at its ride height, not dropped from 35 cm —
  a drop at speed bottomed its suspension and the floor caught the road.)
  Most are at spots where the baked world is not what the road is, or where it has no barrier:
  - **Monaco 450–470 m:** the route goes down a ramp beside a road that stays level; the bake leaves the
    level road's surface up to 1.3 m above the ramp inside the ramp's mapped width, so the drivable
    trench is 2–3.5 m wide. Solo, the AI threads it (its line fitted to the world, see above); in traffic,
    a car pushed over hits the ledge. Monaco's hairpin exit (about 890 m) is also a steep climb taken at
    walking pace.
  - **Stelvio:** the outside of the mountain road falls away with no barrier; a car pushed wide in the
    pack goes over the edge and is reset.
  - **Tokyo 170–180 m** (passing now): a 26–36% climb. NPCs no longer pass side by side while crawling
    up it, and back down for a run-up if they stall.
  Results at these spots are sensitive: small changes to the driving move which car meets them. The
  lasting fix for the first two belongs in the world bake (the ramp's surface; barriers at drops).
- **The player's bot wins most test races** (it starts on pole, and passing is hard on these roads).
