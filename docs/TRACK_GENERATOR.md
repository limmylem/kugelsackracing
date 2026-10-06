# The track generator: variety, quality and polish (Phase 5 Step 4)

How generated tracks are made good, varied and memorable, and what's around them on the day: the quality
score and its gates, generator version 3 and its signature features, the variety and problem-seed reports,
names, conditions, TV cameras and replays, sound, detail levels and performance. The layout generator and
the dressing are in [TRACKS.md](TRACKS.md); racing on the tracks (venues, the daily and weekly tracks,
records) in [TRACK_EVENTS.md](TRACK_EVENTS.md).

## How the generator works, in one page

A track is **seed + parameters + generator version** (`track/generate.js`), written as a 26-character
code (`track/code.js`). Every version is its own frozen file in `track/gen/` — v1 the layout
(`v1.js`), v2 the same layout plus the dressing's rules (`v2.js` + `track/dress.js`), v3 a better layout
(`v3.js`) — and a code always makes its version's track. Making one:

1. **Layout** (`track/gen/v3.js`): a main straight, then corner groups chosen by the style's mix of
   **speed classes** — slow (16–36 m radius), medium (38–95 m), fast (100–230 m) — hairpins, chicanes and
   esses, and the **signature feature** (below); straights between them, sized by **flow rules** (after a
   slow corner a straight long enough to accelerate on; slow to slow a longer one; into a slow corner a
   braking zone; a circuit's back straight into a slow corner), all scaled for short tracks.
2. **Clothoids and closing**: each corner a clothoid in, an arc, a clothoid out; a circuit's corners scaled
   to turn exactly once (a figure of eight: each lobe ±(180° + its crossing angle)), its straights solved
   so the end meets the start with no kink. A layout whose closing would stretch a straight far past the
   length wanted is turned down before it's drawn out (the same reason, the same attempts).
3. **Elevation**: seeded hills and hollows, a crest or a bridge where the feature asks, within gradient and
   gradient-change limits (sharper over a crest).
4. **Checks**, any failing → another attempt from a derived seed (still deterministic; 200 at most, the
   signature dropped after 100): never near itself (except a crossover's one crossing, ≥ 45°, on a bridge
   with 7.2 m clearance), the minimum radius and curvature rate, length, gradients, **room for run-off**
   outside every fast corner for its speed (`track/gen/space.js`), room for a pit lane.
5. **Dressing** (`track/dress.js`, `track/build2.js`): kerbs, run-off by corner speed, barriers, the start,
   pits, signs, grandstands, scenery by **theme** — and, on a crossover, the bridge.
6. **Built** (`track/build2.js`): the road, ground, colliders and course (the Phase 4 route format), its
   **names** and **TV cameras**; drawn by `track/renderDress.js` at the player's **detail level**.

## Presets and themes

**Presets** (`data/tracks.json` presets) are just parameters: type (circuit / sprint), length and corner
ranges, style (technical, flowing, fast, mixed — which corner classes, straights and signatures), width,
elevation, climb, banking, theme, pit lane, sausage kerbs, and (v3) `bridges` (a crossover allowed:
mixed_gp and fast_flowing) and `signatures` (on unless turned off). Add one by adding an entry.

**Themes** (`data/tracks.json` themes): countryside, forest, desert, coastal, mountain, street. Each has
`dress` (what goes where: run-off scale and surfaces by corner speed, barrier type, grandstands, marshals,
light towers, boards, footbridges, buildings, trees, rocks — part of the track's identity) and `look`
(ground, grass, gravel and road colours, trees, sky, horizon, fog, sun, the default time of day and
weather, the backdrop — free to change). Its name list (`track/names.js` PLACE and NOUN) and its sounds
(`data/sounds/ambient.json`) go with it.

### Adding a theme

1. `data/tracks.json` themes: a new entry with `name`, `dress` and `look` (copy the nearest one). `dress`
   changes what's placed — a theme added is new, so no existing code changes; never edit an existing
   theme's `dress` (it would change released tracks: `npm run test:dress` pins them), only its `look`.
2. `track/code.js` THEMES (the theme's number in the code: add it at the end — never reorder the list).
3. `track/names.js`: its PLACE names and NOUNs (and a suffix list if it isn't a loop or sprint kind).
4. `data/sounds/ambient.json` themes: its birds / wind / sea / city levels.
5. If it needs a new backdrop or tree kind: `track/renderDress.js` (the backdrop's shapes, `full` / `far`
   trees).
6. `npm run check`, `npm run test:dress` (every theme dressed and checked), and look at it in the game at
   every time of day and weather: `dev/world.html?world=track&code=…`, then in the console
   `(await import('/testtrack/test-scene.js')).trackConditions({ time: 'night' })` (dawn, morning,
   midday, afternoon, evening, dusk, night; `weather`: clear, hazy, overcast, rain, fog).

### Adding a track element (a kind of thing beside the track)

1. **Where** — `track/dress.js`: add objects `{ k: 'mything', i, x, z, … }` in the dressing step that fits
   (from the plan's corners, straights, run-off), using the dressing's own random numbers. If it's for new
   tracks only, put it behind the dressing version (`DRESS_VERSION` / the generator version) so released
   tracks don't change; `npm run test:dress` fails if a pinned track's dressing changed.
2. **Solid?** — `track/build2.js`: its colliders (boxes or capsules) in the `objects` loop.
3. **Drawn** — `track/renderDress.js` dressMeshes: merge its parts into one mesh (`merge`) or instance it
   (`addInstanced`) into a layer; give it `shadow: true` if it should cast one (the low detail level turns
   them off).
4. **Checked** — `track/validateDress.js` if it has rules (clear of the road and run-off).
5. **Seen** — the map on `dev/tracks.html` (`dev/tracks.js` drawDress), and its counts in the stats.

## Quality score (`track/quality.js`)

Every track gets a score from 0 to 100, from its measured features; weights and thresholds in
`data/tracks.json` quality:

| part | measured | weight |
| --- | --- | --- |
| variety | the mix of slow / medium / fast corners (entropy), the style's classes present, the same corner not repeated | 1.2 |
| flow | braking zones; **stop-start** sections (a heavy stop with under 120 m before the next) | 1 |
| overtaking | straights of ≥ 220 m reaching ≥ 170 km/h into a braking zone of ≥ 70 km/h (want 2; 1 on short tracks and sprints) | 1.1 |
| elevation | crests and dips, corners on a slope, the height range | 0.6 |
| safety | run-off outside each corner against what its speed needs; no fast stretch passing close to another part of the track | 1 |
| ai | how close a headless AI race was: finishers bunched, places changing (`aiCloseness`) | 0.8 |

`qualityOf(gen, plan, cfg, { ai })` gives `{ score, gate, parts, measures, notes }`. **`gate`** is the
deterministic parts only (no physics: the same on every machine); **`score`** adds the AI race when one
was run. The notes say what pulled it down ("2 stop-start sections", "no real overtaking chance").

**The gates** (`quality.min`: daily 60, weekly 65, quick 55): the day's, the week's and quick races'
tracks take the first derived seed whose gate reaches the minimum (`track/events/model.js`); a lower one
is skipped and logged (`skipped`), so everyone still gets the same track. The day's and the week's must
also differ from the last 7 days' / 4 weeks' (layout similarity, below). These rules apply from the dates
in `data/trackEvents.json` daily/weekly `rules` (2026-10-01, week of 2026-09-28): the days before keep
their version-2 tracks.

**Seen on the test page** (`dev/tracks.html`): the score, each part's bar and the notes; **Race AI** runs
the headless AI race and adds its closeness.

**Tuning**: change the weights and thresholds in `data/tracks.json` quality and run `npm run
track-variety` — it reports the score's spread and each part's median per preset, and how many tracks pass
each gate. Raising a gate's minimum changes which seed the days from its rule's date get: add a new rule
with a later `from` date rather than editing the current one.

## Similarity (`layoutSignature`, `similarity`)

A layout's signature is its curvature in 64 bins along its length; two tracks' similarity (0–1) is the best
correlation of their bins over every start point, both directions and mirror images, times their length
ratio. A circuit run backwards or started elsewhere is the same circuit (1.0); different seeds of one
preset average ~0.4; 0.92 is a near-duplicate (`variety.similarity.duplicate`).

## Signature features (`track/gen/v3.js` SIGNATURES)

Chosen once per seed by the style's weights (`STYLES[...].signatures`): **long hairpin** (a 170–180°
hairpin at the end of a long straight), **fast esses** (3–4 quick alternating sweepers), **banked corner**
(a long banked bowl), **big crest** (a long straight over a blind crest), **crossover** (a figure of eight:
one crossing on a bridge; mixed_gp and fast_flowing, `bridges`). None for some tracks (`none`'s weight).
The feature's corner gets a name of its own ("Mill Hairpin", "The Bowl", "Flyover").

## Variety report (`npm run track-variety`)

`tools/track-variety.mjs`: 10,000 tracks per preset (worker threads; about 45 minutes on 3 cores), each
measured — length, corners by class, hairpins, elevation, crests, theme, signature, crossings, the quality
gate and its parts — and their spread reported against `data/tracks.json` variety.targets (all presets,
and each preset's own): no seed without a track, the gate's p10 and median, the share passing the quick
gate, all three corner classes, signature features, the length range covered, every theme used, near
duplicates among a 400-track sample, elevation. Writes `reports/track-variety.txt` and `.json`; exits 1
if a target isn't met. `--per 500` for a quick look, `--only mixed_gp`, `--threads 4`, `--no-fail`.

Last full run (generator v3): every target met in every preset; quality medians 79–91, p10 69–85; daily gate
passed by 98–100%; no near duplicates.

## Problem seeds (`tests/fixtures/problem-seeds.json`)

Seeds whose version-2 tracks were bad, with what was wrong (`wrong`): stop-start sections, no overtaking
chance, a missing corner class, a dangerous spot. `tools/problem-seeds.mjs` finds them (the worst of 300
seeds a preset by the gate) and writes the fixture; add one by hand with `source: "noted"`.
`tests/unit/problemSeeds.test.mjs` keeps them as permanent tests: version 2 still makes each exactly as it
was (its code, its hash), and version 3 from the same seed and parameters passes the daily gate, scores
10+ better, and has none of what was wrong. (The seeds noted by hand during Step 1 weren't recorded where
this step could find them: add them to the fixture with `source: "noted"` and they're tested the same way.)

## Names (`track/names.js`)

`trackName(seed, { theme, layout })` → a fictional name matching the theme ("Bracken Speedway", "Harbour
City Grand Prix", "Eagle Pass Hillclimb"); `cornerNames(gen, plan)` → up to 6 notable corners named — the
signature feature, the bridge, the crest, the first corner, hairpins, the fastest, the longest, the slowest.
All from the seed. Shown on the generator page's map, the venue card, the track library (Notable: …), the
track's label in the game, and the TV cameras' names.

## Conditions (`track/renderDress.js` themeEnvironment, `track/weather.js`)

Each event can set a time of day (dawn, day, dusk, night) and weather (clear, cloudy, rain, fog); "any"
takes the theme's own (`eventConditions`). `data/tracks.json` conditions: the hour each time is in the
game's day (`effects/lighting.js`), its warmth, and each weather's sun, greyness, fog and rain. Rain falls
round the camera (streaks), the road goes dark and shiny. **Grip**: the weather's `grip` (rain 0.82) is
applied to every surface only when `conditions.applyGrip` is true — false for now (visual only), the hook
ready. **Floodlights**: circuits at dusk and night light up — lamps on the light towers, or masts at the
marshal posts — with pools of light following the camera and the scene lit cool from above.

## TV cameras and replays (`track/cameras.js`, `race/raceReplay.js`)

`tvCameras(data)`: from the code — outside every corner (back from its run-off, 6–11 m up (over the advertising boards)), on every
grandstand, and beside the straights every ~260 m where nothing else covers them. Each covers a stretch of
the track; `cameraFor` cuts to the camera whose stretch the car entered last (the next corner's as it
comes), and `zoom` keeps the car about the same size in frame.

Every race is recorded (`createRaceRecording`: each car in the Phase 4 ghost format, 20 samples a second —
about 10 kB a car a minute) with its overtakes and crashes noted. **Watch replay** on the results screen
plays it: TV cameras, chase or in-car (C), play / pause (Space), slower / faster (− / +: ×0.25 to ×4), back
and on 10 s (← / →), the next overtake or crash (N), another car (Tab), close (Esc). A crash replay on a
generated track films from its nearest TV camera.

## Sound (`testtrack/trackAudio.js`, `testtrack/soundMix.js`)

Made as it plays (Web Audio, no files): each theme's ambience (`data/sounds/ambient.json`: birds, wind,
the sea, the city), quieter at speed and inside; the crowd's murmur near the grandstands, cheering at
overtakes and crashes; tyres by surface (`tyreMix`): squeal on tarmac, a rumble across kerbs at the rate
the stripes pass, a swish on grass, a crunch on gravel and sand.

## Detail levels and performance

The **track detail** setting (Settings → Effects): low, medium, high (`data/tracks.json`
performance.detail.levels — the share of trees and rocks, how near trees are drawn in full, the
grandstands' crowd, shadows and their map size, the screen's sharpness), with targets per level.

- `npm run test:track-perf` (`tests/track-perf.ts`): 50 different tracks loaded in a row (made, built,
  dressed, a physics world) — each within 3 s (slowest 1.5 s measured), memory not growing (−6 MB from the
  10th to the 50th); at each level on the busiest theme (forest), the dressing's draw calls (30 / 33 / 33)
  and triangles (246k / 290k / 344k), and the CPU's share of a frame in an 8-car race (physics 2.5 ms + the
  dressing's updates 0.5–1.2 ms + the recording): 3.0 / 3.3 / 3.7 ms against budgets of 8 / 9 / 10 ms.
- `node tools/track-perf-browser.mjs` (needs playwright-core and a Chromium with a GPU): the whole frame
  in an 8-car race at each level in a browser, against `frameMs`, checking the level really applied. Run
  here only with software rendering (no GPU): 8 cars at every level, whole-frame draw calls 108 at low (no
  shadow pass) and about 430 at medium and high (the shadow pass draws the cars again), but 0.6–0.9 s a
  frame — the CPU drawing every pixel, not a measurement of the game. It needs running on real hardware.

## Tests and reports

| | |
| --- | --- |
| `npm run test:unit` | trackQuality (score, weights, similarity, the gates, deterministic skips, names, conditions), problemSeeds, raceReplay (cameras, recording, playback), trackAudio (tyre and ambience mixes) |
| `npm run test:tracks` | every version's pinned tracks (v3: `tests/fixtures/tracks-v3.json`), 10,000 seeds valid |
| `npm run test:dress` | dressing determinism and checks; v2 and v3 pinned dressings |
| `npm run test:track-events` | events on tracks; `--only close`: AI races on the day's, the week's and quick tracks — everyone finishes, the full score (AI included) through each gate, the field together |
| `npm run test:track-perf` | loads, memory, detail levels |
| `npm run track-variety` | the variety report |
| `node tools/problem-seeds.mjs` | find problem seeds for the fixture |
| `node tools/player-test-browser.mjs` | the scripted player test in a browser (needs playwright-core): fast travel to a venue, its official race, the replay, back to the real world, the daily track, its code shared, a repair and a part bought — no page errors |
| `node tools/track-perf-browser.mjs` | frame times of an 8-car race at each detail level, in a browser |

## Appendix: the last full variety report

`npm run track-variety` (10,000 tracks a preset, generator v3), as it printed:

```
Generated tracks' variety: 10000 tracks a preset, generator v3

short_technical (10000 tracks)
  length 2.1–2.6 km (median 2.4) · corners 9–13 · elevation 2.3–10.6 m · crests/dips 0 (median)
  corners: 100% have slow, 100% medium, 42% fast, 42% all three · hairpins in 31%
  themes: desert 16% · countryside 17% · coastal 17% · mountain 17% · street 17% · forest 16%
  signatures: none 52% · long hairpin 28% · big crest 14% · fast esses 6%
  quality: p10 69 · median 78.9 · p90 86.6 · passing the gates: daily 98%, weekly 96%, quick 99% · parts (median): variety 74 flow 69 overtaking 100 elevation 6 safety 100
  layouts: mean similarity 0.42, near-duplicates 0.00% of 402 tracks' pairs
  ok   every seed a track: 0 seeds with no track (at most 0)
  ok   quality (p10): p10 69 (at least 50)
  ok   quality (median): median 78.9 (at least 70)
  ok   pass the quick races' gate: 99% (at least 85%)
  ok   slow, medium and fast corners: 42% of tracks have all three (at least 30%)
  ok   signature features: 48% of tracks (at least 45%)
  ok   length spread: p10–p90 covers 58% of the preset's range (at least 55%)
  ok   every theme: 6 themes, the rarest 16% (at least 12%)
  ok   no near-duplicates: 0.00% of pairs alike (at most 0.50%)

fast_flowing (10000 tracks)
  length 3.7–4.6 km (median 4.1) · corners 9–14 · elevation 3.7–14.4 m · crests/dips 1 (median)
  corners: 100% have slow, 100% medium, 87% fast, 86% all three · hairpins in 24%
  themes: desert 16% · countryside 17% · coastal 17% · mountain 17% · street 17% · forest 16%
  signatures: fast esses 27% · none 18% · banked corner 18% · crossover 14% · big crest 14% · long hairpin 10%
  quality: p10 81.4 · median 87.4 · p90 91.2 · passing the gates: daily 100%, weekly 100%, quick 100% · parts (median): variety 92 flow 100 overtaking 100 elevation 19 safety 100
  layouts: mean similarity 0.38, near-duplicates 0.00% of 402 tracks' pairs
  ok   every seed a track: 0 seeds with no track (at most 0)
  ok   quality (p10): p10 81.4 (at least 50)
  ok   quality (median): median 87.4 (at least 70)
  ok   pass the quick races' gate: 100% (at least 85%)
  ok   slow, medium and fast corners: 86% of tracks have all three (at least 50%)
  ok   signature features: 82% of tracks (at least 45%)
  ok   length spread: p10–p90 covers 65% of the preset's range (at least 55%)
  ok   every theme: 6 themes, the rarest 16% (at least 12%)
  ok   no near-duplicates: 0.00% of pairs alike (at most 0.50%)

high_speed (10000 tracks)
  length 4.1–5.1 km (median 4.5) · corners 6–11 · elevation 3.8–14.6 m · crests/dips 1 (median)
  corners: 100% have slow, 97% medium, 90% fast, 87% all three · hairpins in 32%
  themes: desert 16% · countryside 17% · coastal 17% · mountain 17% · street 17% · forest 16%
  signatures: banked corner 29% · none 24% · big crest 19% · fast esses 19% · long hairpin 10%
  quality: p10 82.1 · median 87.9 · p90 91.6 · passing the gates: daily 100%, weekly 100%, quick 100% · parts (median): variety 94 flow 100 overtaking 100 elevation 18 safety 100
  layouts: mean similarity 0.44, near-duplicates 0.00% of 402 tracks' pairs
  ok   every seed a track: 0 seeds with no track (at most 0)
  ok   quality (p10): p10 82.1 (at least 50)
  ok   quality (median): median 87.9 (at least 70)
  ok   pass the quick races' gate: 100% (at least 85%)
  ok   slow, medium and fast corners: 87% of tracks have all three (at least 40%)
  ok   signature features: 76% of tracks (at least 45%)
  ok   length spread: p10–p90 covers 64% of the preset's range (at least 55%)
  ok   every theme: 6 themes, the rarest 16% (at least 12%)
  ok   no near-duplicates: 0.00% of pairs alike (at most 0.50%)

mixed_gp (10000 tracks)
  length 4–5 km (median 4.5) · corners 12–18 · elevation 4–14.8 m · crests/dips 1 (median)
  corners: 100% have slow, 100% medium, 91% fast, 91% all three · hairpins in 26%
  themes: desert 16% · countryside 17% · coastal 17% · mountain 17% · street 17% · forest 16%
  signatures: none 22% · big crest 18% · long hairpin 18% · fast esses 18% · crossover 14% · banked corner 9%
  quality: p10 81.3 · median 87 · p90 91.4 · passing the gates: daily 100%, weekly 100%, quick 100% · parts (median): variety 92 flow 100 overtaking 100 elevation 21 safety 100
  layouts: mean similarity 0.35, near-duplicates 0.00% of 402 tracks' pairs
  ok   every seed a track: 0 seeds with no track (at most 0)
  ok   quality (p10): p10 81.3 (at least 50)
  ok   quality (median): median 87 (at least 70)
  ok   pass the quick races' gate: 100% (at least 85%)
  ok   slow, medium and fast corners: 91% of tracks have all three (at least 60%)
  ok   signature features: 78% of tracks (at least 45%)
  ok   length spread: p10–p90 covers 71% of the preset's range (at least 55%)
  ok   every theme: 6 themes, the rarest 16% (at least 12%)
  ok   no near-duplicates: 0.00% of pairs alike (at most 0.50%)

club_circuit (10000 tracks)
  length 1.7–2.2 km (median 2) · corners 6–10 · elevation 2.1–10.4 m · crests/dips 0 (median)
  corners: 100% have slow, 98% medium, 42% fast, 42% all three · hairpins in 30%
  themes: desert 16% · countryside 17% · coastal 17% · mountain 17% · street 17% · forest 16%
  signatures: none 28% · big crest 22% · fast esses 20% · long hairpin 20% · banked corner 11%
  quality: p10 70 · median 81.2 · p90 87.8 · passing the gates: daily 98%, weekly 95%, quick 99% · parts (median): variety 74 flow 100 overtaking 100 elevation 6 safety 100
  layouts: mean similarity 0.47, near-duplicates 0.00% of 402 tracks' pairs
  ok   every seed a track: 0 seeds with no track (at most 0)
  ok   quality (p10): p10 70 (at least 50)
  ok   quality (median): median 81.2 (at least 70)
  ok   pass the quick races' gate: 99% (at least 85%)
  ok   slow, medium and fast corners: 42% of tracks have all three (at least 30%)
  ok   signature features: 72% of tracks (at least 45%)
  ok   length spread: p10–p90 covers 59% of the preset's range (at least 55%)
  ok   every theme: 6 themes, the rarest 16% (at least 12%)
  ok   no near-duplicates: 0.00% of pairs alike (at most 0.50%)

mountain_hillclimb (10000 tracks)
  length 3.3–4.1 km (median 3.8) · corners 14–21 · elevation 155.7–165.7 m · crests/dips 1 (median)
  corners: 100% have slow, 100% medium, 37% fast, 37% all three · hairpins in 54%
  themes: mountain 100%
  signatures: none 42% · long hairpin 41% · big crest 9% · fast esses 7%
  quality: p10 85 · median 89.1 · p90 92.9 · passing the gates: daily 100%, weekly 100%, quick 100% · parts (median): variety 74 flow 100 overtaking 100 elevation 70 safety 100
  layouts: mean similarity 0.15, near-duplicates 0.00% of 402 tracks' pairs
  ok   every seed a track: 0 seeds with no track (at most 0)
  ok   quality (p10): p10 85 (at least 50)
  ok   quality (median): median 89.1 (at least 70)
  ok   pass the quick races' gate: 100% (at least 85%)
  ok   slow, medium and fast corners: 37% of tracks have all three (at least 30%)
  ok   signature features: 58% of tracks (at least 45%)
  ok   length spread: p10–p90 covers 61% of the preset's range (at least 55%)
  ok   no near-duplicates: 0.00% of pairs alike (at most 0.50%)
  ok   elevation: median 160.6 m (at least 40 m)

coastal_sprint (10000 tracks)
  length 3.3–4.8 km (median 4.1) · corners 10–16 · elevation 18.9–34 m · crests/dips 2 (median)
  corners: 100% have slow, 100% medium, 88% fast, 88% all three · hairpins in 18%
  themes: coastal 100%
  signatures: fast esses 40% · none 27% · big crest 20% · long hairpin 14%
  quality: p10 84.9 · median 91 · p90 95.9 · passing the gates: daily 100%, weekly 100%, quick 100% · parts (median): variety 91 flow 100 overtaking 100 elevation 57 safety 100
  layouts: mean similarity 0.14, near-duplicates 0.00% of 402 tracks' pairs
  ok   every seed a track: 0 seeds with no track (at most 0)
  ok   quality (p10): p10 84.9 (at least 50)
  ok   quality (median): median 91 (at least 70)
  ok   pass the quick races' gate: 100% (at least 85%)
  ok   slow, medium and fast corners: 88% of tracks have all three (at least 50%)
  ok   signature features: 73% of tracks (at least 45%)
  ok   length spread: p10–p90 covers 75% of the preset's range (at least 55%)
  ok   no near-duplicates: 0.00% of pairs alike (at most 0.50%)

street_circuit (10000 tracks)
  length 2.8–3.5 km (median 3.2) · corners 11–16 · elevation 2.9–12 m · crests/dips 0 (median)
  corners: 100% have slow, 100% medium, 57% fast, 57% all three · hairpins in 41%
  themes: street 100%
  signatures: none 41% · long hairpin 37% · big crest 14% · fast esses 7%
  quality: p10 75.2 · median 82.6 · p90 88.2 · passing the gates: daily 100%, weekly 99%, quick 100% · parts (median): variety 83 flow 100 overtaking 100 elevation 10 safety 100
  layouts: mean similarity 0.38, near-duplicates 0.00% of 402 tracks' pairs
  ok   every seed a track: 0 seeds with no track (at most 0)
  ok   quality (p10): p10 75.2 (at least 50)
  ok   quality (median): median 82.6 (at least 70)
  ok   pass the quick races' gate: 100% (at least 85%)
  ok   slow, medium and fast corners: 57% of tracks have all three (at least 30%)
  ok   signature features: 59% of tracks (at least 45%)
  ok   length spread: p10–p90 covers 60% of the preset's range (at least 55%)
  ok   no near-duplicates: 0.00% of pairs alike (at most 0.50%)

Every variety target met.
(42.8 min, 3 threads)
```
