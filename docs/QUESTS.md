# Quests at run time: finding, racing, results

> **Phase 5 Step 3:** quests also run on generated tracks. Track events (circuit race, hot lap, hillclimb or
> sprint, endurance, drift) are listed at race venues, in the daily and weekly tracks, quick races and shared
> codes, and come with records per track code, ghosts and leaderboards. See [TRACK_EVENTS.md](TRACK_EVENTS.md).

(What quests pay, difficulty, levels and tiers, the finder and fast travel, the sounds, camera, hints and
accessibility options, and the balance and scale tests: [PROGRESSION.md](PROGRESSION.md).)

Phase 4 Step 3. A published quest (Step 1, [WORLD_CONTENT.md](WORLD_CONTENT.md)) on a route (Step 2,
[ROUTES.md](ROUTES.md)) can be found in the world, entered, raced and finished. The money and progress go
through PlayerService, and the rules are in `data/quests.json`.

## Finding and starting one

- **The quest card.** Drive up to a quest's marker, or click it in the world or on the map. The card shows:
  - its name and type;
  - the route: its length, laps, checkpoints and start, and the route itself drawn on the minimap;
  - the medal times (or scores);
  - whether you can enter. If not, it says why in plain words, for example `Needs a car under 201 hp
    (yours has 295 hp)`, `Car too damaged: repair first (The front-left wheel is off.)`,
    `Needs level 3 (you're level 1)` or `Entry fee $500: you have $100`;
  - when your car is the problem, which of your other cars would qualify;
  - the entry fee and the most it pays;
  - your best time or score, your medal and how many tries you've had.
- **Start.** The entry fee is taken by PlayerService (`startQuest`) only when the quest actually starts.
  If the game then can't start it, the fee is refunded (`refundQuest`).
- **Set route.** Shows a dashed guide line on the minimap and the full map from the car to the quest's
  start, along the region's road graph.

## The run (one QuestSession for every type)

`quest/session.js` takes every quest type through the same states:

`intro → countdown → racing → finished | failed → results`

- **Intro.** The camera flies along the route (config `intro`). Space or Enter skips it. Then the car is
  put on its grid slot.
- **Start.**
  - **Standing start:** the car is held until GO, and the clock starts at GO. Throttle over
    `jumpThrottle` in the last `jumpWindow` seconds before GO is a jump start, which adds `jumpPenalty`
    seconds to the time.
  - **Rolling start** (`params.start: 'rolling'`): the car is let go `rollingDistance` m before the start
    line at `rollingKmh`. The clock starts as it crosses the line.
- **Racing.** The Step 2 tracker handles the corridor ("Return to route", then a reset to the last
  checkpoint), the wrong way, and resets (R).
- **Damage** follows the Phase 3 rules. If the car can't be driven for `wreck.seconds`, the quest ends as
  **Wrecked**, and the results offer a tow to the garage.
- **Pause menu (Esc):**
  - Resume.
  - Restart: the fee is charged again, unless `restart.free` is set.
  - Quit: counts as did not finish (DNF).
  - Settings: the HUD's size, showing or hiding it, and the full settings.

The type modules (`quest/types/`) sit on top of the session. Each can have `init`, `tick`, `checkpoint`,
`finishLine`, `timeUp`, `finish` and `hud`. Adding a new type means a module there, its entry in
`content/quests.js` `TYPES`, and the list in `quest/types/index.js`.

| Type | Module | Rules |
| --- | --- | --- |
| Sprint | `sprint.js` | point to point (or laps on a loop); fastest time |
| Time trial | `timeTrial.js` | medal times from the route's reference time × `medals.time`. With checkpoint time extensions (or `timeLimitSeconds`) it's a countdown, starting at the bronze time minus the extensions to earn; at zero it's out of time |
| Checkpoint run | `checkpoint.js` | every checkpoint in order before `timeLimitSeconds` (plus the extensions) runs out |
| Drift | `drift.js` + `quest/drift.js` | the score from drift angle, speed and time, with a combo multiplier. A wall hit or a spin loses the combo. Medals by score; an optional time limit ends the run (scored, not failed) |
| Delivery | `delivery.js` | the cargo takes the car's damage (twice over if fragile). The payout loses `damagePenalty` × the share lost. At 0% the cargo is destroyed and the delivery fails. The cargo is shown in the HUD |
| Pink slip | `pinkSlip.js` | framework only. Disabled until rival drivers arrive (Step 4). It has the confirmation screens (the last one asks you to type the car's name) and the transfer through PlayerService (`forfeitCar` / `awardCar`, only allowed during a pink-slip run) |

## Timing

- **Gates on physics ticks.** Every checkpoint and the start and finish lines are gates across the road
  (`route/grid.js` `gateAt`). Each physics tick, the car's move since the last tick is tested against
  them. The crossing time comes from where along that move it crossed (`quest/timing.js`), so times
  don't depend on the frame rate.
- **Only the right pass counts.** A gate counts only when crossed forwards, and only near where the tracker
  has the car along the route.
- **Checkpoints in order.** Passing a later checkpoint, or driving past the next one outside its gate,
  says "Missed checkpoint N: go back through it". The HUD arrow then points back to it, and there's no
  finish until it's done.
- **Splits.** Each checkpoint's time is compared with your best run's: green if faster, red if slower.
- **Laps** on loop routes, with the best lap marked.

## The race HUD (play/questUi.js)

- Timer (or the time left), checkpoint count, lap count, the last split and its delta.
- Speed and gear.
- An arrow to the next checkpoint, and the route line on the minimap.
- Position (`1st / 1`): a placeholder ready for Step 4's rivals.
- Type panels: drift score and combo, the delivery's cargo condition, the next medal target and the time
  trial's countdown.
- Its size and whether it's shown are set in the pause menu. They're kept in this browser.

## Results and rewards

- **The results screen** shows:
  - the time or score, the medal, and whether it's a personal best (and what it was);
  - the splits and laps;
  - the damage taken and the estimated repair cost;
  - what was paid, line by line.
- **Buttons:** Retry (the fee again), Free roam, and Garage (or Tow to the garage when wrecked).
- **Rewards** go through PlayerService (`finishQuest`), from the economy's reward for the quest
  (`data/economy.json` `quests`) × `rewards` in `data/quests.json`:
  - each medal tier pays its share the first time it's reached;
  - a better medal later pays the difference;
  - finishing without a medal pays `finish` once;
  - a run that reaches nothing new pays `repeat`;
  - xp works the same way.

  These are placeholder values: balancing is Step 5.

## Progress and recordings

- **Per quest, in the save** (`profile.quests[id]`, `garage/player/quests.js`): attempts, finishes, DNFs,
  completed, medal, best time and score, best splits and laps, the share paid so far, and the best run's
  recording id. `profile.xp` holds the xp. `profile.questLog` keeps the last 50 runs handed in, with what
  each paid and why an invalid one paid nothing.
- **On the map,** each quest's marker shows **new** (bright), **attempted** (•) or **completed** (✓, in its
  medal's colour).
- **Recordings** (`quest/recording.js`): your best run is recorded for ghost replays later.
  - The car's state is sampled every 1/20 s of simulated time.
  - Values are quantised: position in cm, rotation as four int16s, velocity in cm/s.
  - Each channel is delta-coded, zigzag varint, then base64, which is about 10 kB a minute.
  - The same run always gives the same string.
  - Recordings are kept in their own store (`quest/recordStore.js`: IndexedDB, `drive-world-ghosts`), so
    the save stays small. A new best replaces the old recording.

## Result validation (ready for a server)

Every finished run produces a result object (`quest/result.js`):
- the quest's id and version, the route's id and version (`routeVersionOf`: a hash of its line,
  checkpoints and grid);
- the car's setup (class, kW, kg, top speed);
- the start (mode, jump);
- each checkpoint's time and lap, the laps, the raw and total time, and the penalties;
- the score, the damage taken and each damage event, and the recording reference.

`quest/validate.js` checks it, and PlayerService runs the checks before paying anything. An invalid
result pays nothing and is logged. The checks:
- it's the same quest and quest version;
- the route version matches;
- the run was started and not already handed in;
- every required checkpoint was passed, in order, on every lap;
- the times only go up, and the laps add up;
- no stretch is faster than the route allows: each stretch takes at least its length ÷ (the car's top
  speed, at least `minTopSpeedKmh`, × `topSpeedSlack`);
- a drift score is possible.

The medal is worked out again from the result's own numbers, not taken from the game. All of it lives in
PlayerService, so a server can take the checks over later.

## Config (`data/quests.json`)

| Key | What |
| --- | --- |
| `start` | the countdown, jump-start throttle, window and penalty, rolling speed and distance |
| `intro` | the fly-along's length, height and how far behind |
| `restart.free` | whether a restart is free |
| `wreck.seconds` | how long undrivable before the quest ends as Wrecked |
| `medals` | time and score multipliers for gold, silver and bronze |
| `rewards` | each tier's share, finish, repeat |
| `drift` | the drift scoring rules |
| `delivery.fragileFactor` | how much more a fragile cargo feels the damage |
| `validation` | top-speed slack, the lowest top speed assumed |
| `recording.hz` | the recording's rate |
| `levels` | xp for each level: base, growth and the highest level (PROGRESSION.md) |
| `camera` | the camera's glides between free roam, the intro, the race and the results (seconds), and the results' orbit |
| `finding` | the nearby notice and "Recommended for you" (PROGRESSION.md) |
| `hud` | the HUD's default size and visibility |

## Tests

- **`npm run test:unit`** (`tests/unit/quest.test.mjs`):
  - the session's states;
  - sub-tick timing (the same time at 30, 60, 120 and 144 Hz ticks);
  - checkpoints in order (missed, the arrow back, no finish until it's passed);
  - jump starts and rolling starts;
  - laps and splits against your best;
  - time limits and extensions;
  - wrecked;
  - drift scoring (combo, wall, spin);
  - the delivery's cargo and payout;
  - medals and rewards (once per tier, then the repeat);
  - entry reasons and qualifying cars;
  - result validation (impossible times, out of order, wrong route version, changed quest);
  - recordings;
  - the pink-slip framework;
  - PlayerService: fees charged and refunded, restarts, rewards and progress, PB recordings replaced,
    invalid results paying nothing, a result handed in twice paying once, DNFs, pink-slip transfers.
- **`npm run test:quests`** (`tests/map/quests.test.ts`), on Monaco's real roads in the physics:
  - every type (sprint, time trial, checkpoint run, drift, delivery, and a rolling start) driven to the
    finish by the test driver, through the game's quest controller and PlayerService, each with a valid
    result;
  - the same scripted run at 30, 60 and 144 fps, which gives the same time (within 1 ms; in fact
    identical);
  - 50 restarts and quits: the fee charged for every start, the attempts and DNFs counted, and no memory
    growth.
