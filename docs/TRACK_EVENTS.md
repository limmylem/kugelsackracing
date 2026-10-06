# Gameplay on generated tracks (Phase 5 Step 3)

Generated tracks ([TRACKS.md](TRACKS.md)) are now raced as quests. A **track event** is a quest
([QUESTS.md](QUESTS.md)) with a `track` field in place of a route, so it runs through the same systems:

- the quest session, its timing, HUD and results;
- NPC racers;
- medals, rewards, tiers and anti-farming;
- PlayerService and recordings.

Driving up to a **race venue** in the real world opens a card that lists its events. Entering one fades to a
loading screen, makes the track and puts the car on the grid. Leaving puts the car back on the exact spot it
left in the real world.

## The pieces

| | |
|---|---|
| `content/quests.js` | the `venue` kind (marker "Race venue", `events: [quest ids]`); the new types `circuit_race`, `hot_lap`, `hillclimb`, `endurance` (and `drift`, which also runs on a track); `TRACK_KINDS`, `RIVAL_TYPES`; `trackLinkProblems` (publish checks); rewards by kind of track |
| `quest/types/` | `circuitRace.js`, `hotLap.js` (medals for the best lap or the total), `hillclimb.js`, `endurance.js` (the framework) |
| `track/events/model.js` | track names; the daily and weekly tracks from the date; quick and shared tracks; `eventsFor` (the events a non-official track gets, from `data/trackEvents.json`); `newTrackEvent`; `recordKey` |
| `track/events/hash.js` | `trackHash(data)` (the fingerprint of what was built), `packTrack` / `unpackTrack` (the baked track), `syncPlan`, `joinRace` (multiplayer prep) |
| `track/events/reference.js` | the AI reference laps: a headless lap at each skill level, kept by code |
| `track/events/prepare.js` | an event made ready to race: its course (with hash and reference times) and its rating |
| `track/events/records.js` | in the profile: records per code, generator version and class; leaderboards; farming per code; the quick races' hourly cap; recent tracks and favourites |
| `track/events/ghost.js` | the best lap's ghost from a recording (the Phase 4 format), and where the ghost is at any moment |
| `track/events/checks.js` | the publish checks: the track measured again, and the AI test race (did the AI finish, and where are the problem corners) |
| `play/trackTrip.js` | the trip from the real world to the track and back (pure, with adapters: the game's and the tests') |
| `play/trackUi.js` | the venue card, the track library (F4), the loading screen, and "Back to the real world" |
| `editor/trackEvent.js` | the editor's track-event designer and an event's track panel, plus the AI test race on a track |
| `data/trackEvents.json` | which tracks there are and what's raced on them (daily, weekly, quick, shared); library sizes; reference settings |
| `data/economy.json trackEvents` | rewards by kind of track, farming per track code, and the hourly cap |

## Race venues

- **Making one.** In the editor, use the venue tool (**6**) and click the map. A venue's panel lists its events;
  **Create a track event…** opens the designer:
  - pick a preset, a theme and a seed, then **🎲 Roll another seed** until the track is right;
  - **Preview** shows its map, length, corners and theme, and whether it passes its checks;
  - **Test drive** opens the game's Track world on its code;
  - name it, pick the event type, and **Create the event here**.

  This makes a draft quest with `track: { code, kind: 'official', name, layout, km, corners, theme, version }`
  and attaches it to the venue. Set its laps, rivals, start, collisions, entry and fee like any quest's.
- **The AI test race** (on the event's panel; normal or fast) works the same way as Phase 4's:
  - the rivals race the track in a physics world of its own;
  - then a solo lap at each skill level runs (two laps on a circuit: a standing one and a flying one);
  - the result is kept on the event as `track.check`: `trackOk` and `problems` (the layout and dressing
    measured again), `aiFinished`, `spots` (problem corners named by turn number), `aiTimes`, `hash` and `at`.
    The event's rating (its stars) is worked out from it.
- **Publishing.** An event can't be published until:
  - its track passes its checks;
  - the AI could finish it (every skill's reference lap, and at least half the race field);
  - the check is for the track as it is now (the same hash).

  Problem corners are warnings. Publish the events and the venue: players see published events on the
  venue's card.
- **In the game.** Driving up to a venue (or clicking it) shows its card:
  - its track's preview map, length, corners and theme;
  - each event's type, laps, rivals, start, stars, reward, entry fee, and the player's best and medal.

  Each event has **Race** and a **Race my best-lap ghost** option. Track events don't get markers of their own:
  the venue is their marker. Fast travel (the full map's finder) lists race venues, and a track event found
  there takes you to its venue.

## Entering and leaving

`play/trackTrip.js`, run by the game in `testtrack/test-scene.js`:

1. **The spot.** The world file, the car's position and its heading are kept.
2. **The fade.** The screen fades to the loading screen (`data/trackEvents.json loading.fadeSeconds`).
3. **The track.** It's made in a Web Worker, or loaded from this browser's cache. One generated track's world
   is kept at a time.
4. **The reference times.** They're read from their cache, or timed now, with progress shown. This happens once
   per track and car class.
5. **The event.** It's made ready (`track/events/prepare.js`): its course, its hash, its AI times and its rating.
6. **The race.** It starts on the grid. The start lights follow the countdown.
7. **Leaving.** "Back to the real world" is on the track, on the results screen and in the pause menu
   ("Quit and leave the track"). The real world comes back and the car is put down on the spot it left, facing
   the same way, standing still.

Damage isn't the trip's to carry. It belongs to the player's car (the session and PlayerService): what happened
on the track is on the car back in the real world, and the other way round. Loose and torn-off parts follow the
session's attach state too.

## Track events

| type | on | medals | rivals |
|---|---|---|---|
| `circuit_race` | a circuit | the place with rivals; alone, times from the reference laps | yes |
| `hot_lap` | a circuit | the best lap (`mode: 'best_lap'`, the default) or the total (`'total'`) | no (collisions off) |
| `hillclimb` | a point-to-point | the place with rivals, else times | optional |
| `endurance` | a circuit | as a circuit race | yes |
| `drift` | either | scores | no |

`endurance` is the framework only: laps split into `stints`, with each stint's time and best lap in the HUD and
in the result. Driver changes, fuel, tyres and pit stops are for later; the track already has its pit lane.

Every event sets these: laps (circuits), NPC count and skill range, car requirements (`entry`), the start
(standing or rolling), collisions (`full`, `reduced` or `off`), and optionally its own entry fee
(`params.entryFee`; blank uses the economy's).

## Kinds of track

- **official**: picked and named in the editor, at a venue. Its code never changes, and its hash is kept with
  the event when it's tested.
- **daily**: from the UTC date (`dailyTrack(date)`), so it's the same for every player.
  - The seed is `fnv32('salt:daily:YYYY-MM-DD')`, and the preset is picked from `data/trackEvents.json
    daily.presets` by the seed.
  - The generator version is pinned there, so a newer generator never changes a past day's track.
  - If a seed can't make a track, the next seed derived from it is used (`mix(seed, k)`).
- **weekly**: the same, by ISO week (`2026-W41`, Monday to Sunday, UTC), with bigger events.
- **quick**: a random track from a preset. It pays `economy.trackEvents.byKind.quick` (0.55) of an official
  track's, capped each hour.
- **shared**: a code a friend gave. It gets a quick race's events and pay, and the identical track and hash.

## The track library (F4)

The library has these tabs:

- Official (every published venue's events, grouped by track);
- Daily and Weekly (with their local leaderboards);
- Recent and Favourites;
- Quick race (a preset, then **Random track**);
- Friend's code.

Each track shows:

- its preview map;
- its length, corners, theme and layout;
- its difficulty (stars from its events' ratings, or `quest/difficulty.js` on its line before it's rated);
- the player's best time and best lap for their car's class, and their medals;
- its code, which can be selected and copied.

From a track you can favourite it (☆/★), **Play again** (the last event played), or race any of its events. The
"best-lap ghost" box is the same option as on the venue card.

## Reference times, medals and stars

`track/events/reference.js` runs `race/aiTest.js` solo-only (`race: false`, `soloLaps`):

- the reference car for the class (`race/setup.js`'s first rival) drives a lap at each skill level in
  `data/npc.json skill.levels`;
- on a circuit it drives two laps: a standing one and a flying one;
- the times are kept by `code|class|ref<cacheVersion>` (IndexedDB in the browser, memory in the tests);
- bump `data/trackEvents.json reference.cacheVersion` when the AI or the physics changes.

`quest/rules.js medalTargets` reads a track's `course.aiTimes[class]`:

- gold is the high skill's time, silver the medium's, bronze the low's;
- a standing-start race is the standing lap plus (laps − 1) flying laps;
- a rolling start is laps × flying;
- a hot lap's best lap is one flying lap.

A track event's rating (stars and km) comes from `content/rating.js` with these medals: Phase 4 Step 5's
difficulty rules on the track's line, its rivals, and how tight its gold is.

In a 4.3 km circuit's test, the reference laps took 19 s in Node (six laps, about 800 s simulated) and gave the
same times to the tenth when run again.

## Records, ghosts and leaderboards

**Phase 6 Step 1: these are the server's** (docs/SERVER.md, `play/trackServer.js`).
- **The day's and the week's tracks** are worked out there (the same search, in a worker, kept for
  everyone). Their events carry the hash of the track as the server built it.
- **Every finished run** on a generated track is handed in and checked again by `quest/validate.js`
  against the course the server built.
- **Records** (per code, generator version and class) and **leaderboards** (one place a player, best
  first, for official, daily and weekly events) come from the server.
- **Race replays** are kept there: your newest 50 and your records'. The library's "My replays" lists
  them, and a leaderboard links a record's replay.

The profile's own copies below are still kept, for the ghosts and for a page without a server.

All of these are in the profile (`track/events/records.js`; `data/schemas/profile.schema.json`):

- **Records** (`trackRecords`) are kept per track code, generator version and car class (`code|vN|class`):
  - the best time (a hot lap's is its best lap), the best lap and best score;
  - their splits and laps, and the best run's recording.

  The recording goes in the recording store and PlayerService keeps it while the profile points at it.
- **The ghost** is made on request. When "best-lap ghost" is ticked, the record's recording for the player's
  class is cut down to its best lap (`lapGhost`: a recording of its own in the same format). A see-through copy
  of the car then drives it from each lap's start (from the start on a point-to-point).
- **Leaderboards** (`trackBoards[eventId]`) exist for official, daily and weekly events: the best 10 runs on this
  device, each a Phase 4 result (`quest/result.js`) with its `rank`.
- **Recent** (12) and **favourites** (50) are for the library. The sizes are set in `data/trackEvents.json library`.

## Rewards

A track event's reward is a quest's, from `content/quests.js rewardsOf`:

- its type (`economy.quests.byType`);
- its km of driving (lap × laps);
- its stars, the lowest class it lets in, and its rivals and their skill;
- multiplied by `economy.trackEvents.byKind` for its kind of track: official 1, daily 1.1, weekly 1.2,
  quick 0.55, shared 0.55.

Medals and places pay their shares as for any quest (`data/quests.json rewards` and `race`). Two rules are new:

- **Farming is by track code.** Every event on a track counts toward the cut: more than `freeRuns` finishes
  within `windowHours` pays `decay^(runs over)` (`economy.trackEvents.farming`).
- **Quick races (and shared codes) are capped each hour.** In any rolling hour they pay at most
  `hourlyCap.goldRuns` (3) × the event's full reward, in money and in xp. A run over the cap shows a line saying
  so on its results.

## The economy simulation

The economy simulation (`tools/economy/sim.mjs`, `npm run economy-sim`) has track events in its pool:

- 40 tracks from `simulation.pool.tracks`, by kind, each with one or two events;
- their own random numbers, so the world's quests and series are what they would be without them;
- the bot pays farming by code and the hourly cap, and a quick race is a fresh event each time;
- a track event takes `timing.trackSeconds` (25 s) longer: entering and leaving.

After adding them, every target was re-checked:

| target | result |
|---|---|
| first upgrade | 0 min |
| second car | 2.7 h |
| repairs | mean 9–17% (worst 95% of a typical race reward) |
| skilled vs average | 1.20× |
| stuck | never |
| quest pay | every type × tier within 0.6–1.6× of its tier's median |
| level | 10 after 8 h |

Two balance changes came out of it:

- the track types' `byType` (circuit race 1, hot lap 0.9, hillclimb 0.9, endurance 0.95);
- checkpoint runs from 1.1 to 1.25: they were the weakest type before (0.75× their tier's median), and with
  track events in the pool they fell under 0.6×.

## Multiplayer prep

- **Every track has a hash.** `trackHash(data)` is the fingerprint of what was built: code, version, build,
  layout and dressing hashes, the centreline (mm), the road and kerb meshes and the barriers (cm), the
  colliders, the grid and the checkpoints. It's about 20 ms to work out.
- **Before a race** every player's hash is compared with the host's (`syncPlan`). A player whose hash differs
  (another build, or a floating-point difference on their machine) downloads the host's baked track:
  - `packTrack` is JSON with the typed arrays as base64 (about 5 MB for a 4 km circuit);
  - `unpackTrack` checks the hash before using it;
  - `joinRace` is one player's side of all this.
- **Results carry the hash** (`result.track: { code, kind, hash, version }`). `quest/validate.js` rejects a
  result whose hash isn't the event's (or the course's), so a mismatched result pays nothing and is logged
  as invalid.

## Tests

- **`npm run test:unit`** (`tests/unit/trackEvents.test.mjs`) covers:
  - daily and weekly keys and tracks;
  - a shared code's hash, the baked track, and the download on a mismatch;
  - events as quests: publish checks, rewards by kind, medals from the reference laps;
  - a result paid, with its record, leaderboard, farming by code, the quick cap and favourites;
  - a mismatched hash paying nothing;
  - the best lap's ghost;
  - the trip's order of steps, and its way back when a track can't be made.
- **`npm run test:track-events`** (`tests/track-events.ts`, with the physics, the game's quest controller, NPCs
  and PlayerService) covers:
  - every event type on 20 random tracks (every preset), solo and with 3 NPCs: circuit race and endurance
    (2 laps; endurance in 2 stints), hillclimb, and hot lap and drift solo. Each must finish, validate, be paid
    and carry its track's hash;
  - 100 trips from a real-world sim to three different tracks (one kept at a time) and back: back on the very
    spot, damage carried both ways, and memory not growing;
  - the same date giving the same track all day and all week, and 120 days and 52 weeks giving that many
    different tracks;
  - shared codes: the same hash made here, by a friend, and sent baked;
  - reference times timed twice, and the medal targets checked against the rules;
  - the economy simulation with track events: every target.
