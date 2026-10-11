# Performance and graphics settings (Phase 8 Step 2)

The game should run smoothly from an older laptop or a Chromebook to a gaming PC, with clear graphics settings, and it
mustn't quietly get slower. This page says how it's measured, what each tier of computer should reach, what the
graphics settings do, what was changed and what each change bought, and how the checks keep it so.

**Driving is the same on every setting.** The physics runs at 120 steps a second with the same tyre model on every
preset; nothing in the graphics settings reaches it. `tools/physics-presets.mjs` proves it: the Phase 1 physics tests
(0–100, the quarter mile, braking, the skidpad, the slalom) run in the game at low, medium, high and ultra, and again
after switching presets back and forth while driving, give the same results and the same telemetry, bit for bit.

## Device tiers and what they should reach

`data/performance.json` `tiers` — each tier's preset, its targets (at that preset) and its memory budgets:

| Tier | Example hardware | Preset | Average fps | Worst 1% fps | Stutters (frames over 2× the target) | Main thread a frame | Drivable after opening | Memory budgets (textures / meshes / audio / heap) |
|---|---|---|---|---|---|---|---|---|
| Low | Older laptops and Chromebooks with integrated graphics: Intel UHD 620 / Iris Plus, AMD Vega 6, Intel N100 / Celeron N5100 | low | 30 | 20 | ≤ 1% | ≤ 22 ms | ≤ 25 s | 256 / 256 / 32 / 700 MB |
| Medium | A typical laptop: Iris Xe (11th–13th gen), Radeon 680M, Apple M1/M2 | medium | 60 | 40 | ≤ 0.5% | ≤ 11 ms | ≤ 15 s | 512 / 512 / 64 / 1000 MB |
| High | A gaming PC: GeForce RTX 3060 / Radeon RX 6600 or better | high | 60+ | 50 | ≤ 0.3% | ≤ 9 ms | ≤ 10 s | 1024 / 768 / 96 / 1500 MB |

"Drivable" is on a normal home connection (25 Mbit/s, 40 ms: `data/performance.json` `network`), the first visit.

## How it's measured

- **The frame profiler** (`perf/profiler.js`) times every frame and, inside it, each stage of the game's work one
  after another: input, streaming (the map), physics, AI (the NPC drivers, inside the physics' steps), network,
  audio, effects, render (submitting the picture) and the game's own (HUD, cameras, everything else). What isn't any
  stage's — the browser, garbage collection, waiting for the graphics card — is the frame's `other`. It keeps the
  average, the worst 1% of frames, draw calls and triangles (every pass: the shadows' too), the heap, and the garbage
  made a second.
- **Stutters**: a frame longer than twice the target (`stutterFactor`) is a stutter, logged with its cause — `shader
  compile` (new shader programs appeared in it, and which), `garbage collection` (the heap shrank across it), the stage
  that took the most, or `browser` (the game's own stages took less than half of it: the browser, the GPU, another tab).
- **Shift+P** in the game: the performance overlay (`perf/overlay.js`) — the last few seconds' frame times as a graph
  against the target, where the time goes, draw calls, the resolution and frame rate cap now, memory, and the last
  stutters with their causes.
- **The benchmark scenes** (`perf/bench.js`, run by `tools/bench.mjs`), each opened in a browser, set up, run and
  measured; written to `reports/performance/<label>.json`:

  | Scene | What |
  |---|---|
  | `track_race` | A dressed generated track (the busiest theme), an 8-car race: you on the autopilot and seven NPCs |
  | `night_rain` | The same track at night in the rain: floodlights, rain, a wet road; four cars |
  | `city` | Downtown San Francisco (Map v3: Market Street), an 8-car race through its streets |
  | `roam` | Free roam with 30 players at The Embarcadero: you and 29 others (the game's own network code, `server/tools/roam-host.ts` — the API and real-time server run in the test) driving the streets round you |
  | `pileup` | A 10-car pile-up: nine AI cars at 60 km/h into each other in front of you — crashes, dents, sparks, smoke |

  ```
  node tools/bench.mjs [--scenes …] [--seconds 30] [--tier medium | --preset high] [--swiftshader] [--size 640x360]
                       [--network] [--alloc] [--cpu] [--baseline file] [--label name]
  ```
  `--alloc` lists where the garbage is made (Chrome's sampling heap profiler), `--cpu` where the main thread's time
  goes (its sampling profiler) and the garbage collector's share of it — that's how the changes below were found. The
  `roam` scene needs PostgreSQL (`TEST_DATABASE_URL`).

- **Garbage** (the short-lived objects the collector clears up), counted by Chrome's sampling heap profiler over the
  run, the objects already collected included. Each allocation is put down to what drives it: the simulation's steps
  and the replay's recording go with simulated time, the rest of the frame with frames drawn, and the rest (the sound's
  messages, the network, timers) with real time. Put back together at 60 frames and one simulated second a second, as
  on a computer that keeps up, that's the **garbage MB/s** in the report. (Drawn in software, a few frames a second
  with the simulation behind real time, the raw rate would be meaningless. The in-game overlay's figure, the heap's
  growth between frames, misses what's collected within a frame. It's only a rough guide.)

- **No graphics card here, or in CI.** This machine and GitHub's free runners draw in software (SwiftShader), a frame a
  second or so: frame rates there say nothing about players' computers. What does compare is the CPU's side (each
  stage), draw calls, triangles, memory, garbage, shader compiles and loading. Real frame rates come from the game's
  own benchmark on real computers: **Settings → Graphics → "Test this computer and pick for me"**, and Shift+P while
  playing. (The owner chose this, 2026-10-11: no paid GPU machine for CI.)

## The graphics settings

Settings (O) → **Graphics** (`testtrack/settings.js`; `perf/quality.js`; `data/performance.json` `quality`). Every
setting changes while playing — no restart (`tools/browsers.mjs` switches presets and a custom set mid-drive and checks
the game keeps drawing without an error).

| Setting | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Render distance | 700 m | 1,000 m | 1,400 m | 2,000 m |
| Shadows | off | 1024 | 2048 | 4096 |
| Reflections (paint, chrome) | off | sky | sky | live (the surroundings) |
| Effects (particles, sparks, smoke) | low | medium | high | high |
| Anti-aliasing | off | FXAA | MSAA 4× | MSAA 4× |
| Bloom / motion blur | — | — | bloom | bloom, motion blur |
| Car detail (drawn whole within) | 60 m | 150 m | 300 m | 600 m |
| Detailed cars (at most) | 4 | 6 | 8 | 12 |
| Damage deformation detail | low | medium | high | high |
| Scenery and trees | 35% | 65% | 100% | 100% |
| Spectators | low | medium | high | high |
| Full engine sounds | 3 | 6 | 6 | 8 |
| Resolution (of the screen's pixels, up to) | 80% (1×) | 100% (1.5×) | 100% (2×) | 100% (2×) |
| Dynamic resolution (down to) | on (50%) | on (60%) | on (70%) | off |
| Frame rate cap | 30 | 60 | 60 | none (the screen's) |

Changing any of them makes the preset **Custom**. What they do:

- **Render distance**: how far the real world's tiles load (never less than the physics needs — what the car drives on
  is the same on every setting) and how far each tile's detail reaches (terrain, roads, buildings, trees, railings);
  on tracks, how near trees are drawn in full.
- **Shadows**: the sun's shadow map size, or none. **Every car's shadow is one draw** — its one-piece copy (below) —
  not one for each of its 30-odd parts.
- **Reflections**: what reflective paint and chrome reflect: nothing, the sky, or the surroundings (a small cube map
  round your car, one face drawn every other frame).
- **Effects**: `data/effects.json` quality — how many particles, how long they last, soft edges, spark lights.
- **Anti-aliasing, bloom, motion blur**: the finishing passes (`perf/graphics.js`, three.js's EffectComposer: MSAA 4×
  on the picture's render target, or FXAA on the finished picture; bloom round bright lights; motion blur streaking the
  edges of the picture with speed). With none of them on, the scene goes straight to the screen, and the passes' code
  isn't even loaded.
- **Car detail and detailed cars**: other cars further than the car detail's distance, or beyond the nearest few, are
  drawn as **one piece** — every mesh of the car merged into one, its materials' colours as the vertices' (made once a
  car, a few milliseconds' worth a frame; made again when its parts or paint change) — one draw instead of thirty.
- **Damage detail**: how finely a crash dents the body (the dentable copy's longest edge: 7 / 10 / 14 cm) and the share
  of the denting's time a frame.
- **Scenery and spectators**: the share of trees, rocks and the like drawn (the same ones always — the instances are
  shuffled once, so drawing the first part of them thins them evenly), and the grandstands' crowd.
- **Full engine sounds**: how many other cars are heard in full (the rest with the simple sound).
- **Dynamic resolution**: when frames run long (the last half second averaging over 1.15× the target), the render scale
  drops 10%; after three steady seconds it rises 5% (not straight back to a scale that just failed). Never below the
  minimum.
- **Frame rate cap**: 30, 60, 120 or none; the frames in between the screen's are skipped (keeping the rhythm: 60 on a
  144 Hz screen is 60).
- **Power saver**: on battery (where the browser can tell) or always — at most 30 fps, the resolution at most 75%.

**The first launch** (`perf/autodetect.js`): once the car's on the ground, a few seconds at high, then medium, then
low (as fast as the screen goes, at full resolution); the first whose frames keep to their frame rate (the 90th
percentile within 1.15× of it) is kept and saved — ultra where high runs well under even a fast screen's frame time.
Software graphics (no graphics card at all) are low at once. A note says which was picked; it can be changed, or the
test run again, from the settings. (Not under automation: the tests say which preset they want, `?graphics=low`.)

## What was changed, and what each change bought

Measured on this machine (4 cores, 2.8 GHz, software rendering at 640×360), `before-step2.json` (the game as it was,
with the measuring added: `tests/perf/before-step2.json`) against the same scenes after, at the high preset — the
closest to how the game was set before. The software renderer makes the frame time itself meaningless; see the CPU's
stages, draw calls, triangles, memory and garbage.

(The full table is in [the report](#the-report) below.)

| Change | Where | What it bought (measured) |
|---|---|---|
| **One draw for a car's shadow** — each car's one-piece copy casts its shadow, its parts none | `garage/visual.js` setDetail, `testtrack/test-scene.js` carDetailFrame | Shadow draws in the 8-car race 188 → 17 (−91%), downtown 126 → 23 (−82%) |
| **Far cars in one piece** (car detail, detailed cars) | same | The 10-car pile-up 414 → about 230 picture draws; triangles 642k → 185k |
| **The spark lights never hidden** — hiding one changed the scene's light count, and every material was compiled again at the first sparks | `effects/threeRenderer.js` | No more shader-compile stutter at the first crash |
| **Shaders compiled before they're needed**: the world's when it's entered, other players' and NPCs' cars while they're still hidden, the one-piece cars and broken glass and lamps ahead of time | `testtrack/test-scene.js` warmShaders, precompile | Shader-compile stutters in the benchmarks (see the report) |
| **The crash replay's recording recycled** — 30 frames a second of every car's state, each kept 6 s: long enough to outlive the quick collections | `physics/replay.js` | Nothing measurable in the garbage made (the physics' own small vectors are about 80% of it, and stay); what it saves is old objects for the full collections, too few in a benchmark run to count |
| **Other players' network delays sorted without garbage** (a reused array sorted numerically, the same figures) | `net/remote.js` | Free roam with 29 others: the garbage outside the frame 8.0 → 3.4 MB/s (−58%); in all 83 → 78 MB/s |
| **One-piece copies made into typed arrays, and not again for every dent** (the first version made 90% of the pile-up's garbage) | `garage/visual.js` | — (found by `--alloc` before it shipped) |
| **Car models kept for the next race** (least recently used let go past an eighth of the meshes' budget) | `garage/visual.js` ModelCache | A race against the same cars again loads them at once |
| **The map round a quest fetched while its card is open** | `map/render/worker.ts` prefetch | Fast travel or driving there reads this computer's cache, no download |

## Rendering

- **WebGPU or WebGL 2.** `tools/renderer-bench.mjs` (`dev/renderer-bench.html`) draws the same scene with three.js
  r160's WebGPURenderer and its WebGLRenderer. The CPU's time to submit a frame (Chromium; software Vulkan and GL here):

  | Meshes | WebGL 2 | WebGPU | WebGL 2, instanced | WebGPU, instanced |
  |---|---|---|---|---|
  | 300 | 1.0 ms | 5.3 ms | 0.4 ms | 0.9 ms |
  | 1,000 | 2.7 ms | 14.6 ms | 0.5 ms | 0.9 ms |
  | 3,000 | 6.1 ms | 29.0 ms | 0.5 ms | 0.9 ms |

  WebGPU through this three.js is two to five times slower on the CPU, and the game's own shaders (the map's colours,
  cracked glass, the wet road, the particles) are GLSL that its WebGPU renderer can't run without rewriting. So the game
  uses **WebGL 2 everywhere** — there's no browser where WebGPU would be faster for it today. (To look at again with a
  newer three.js: the same tool.) The table also shows why instancing matters: 1,000 meshes 2.7 → 0.5 ms.
- **Fewer draw calls.** Everything repeated is instanced (trees, rocks, barriers, posts, the crowd, route arrows); each
  map tile is already a handful of merged meshes, one per material (`map/bake`); cars are one draw far away and one draw
  as a shadow (above).
- **Culling.** three.js leaves out what's outside the camera's view; each map tile hides its buildings, roads, trees and
  railings beyond their distances (scaled by the render distance). Hiding what large buildings block (occlusion
  culling) isn't done: it would need the GPU's occlusion queries a frame late (popping) or a CPU visibility pass costing
  more than the few draws it would save in the city — the tiles' distance detail already keeps the city at about 250
  draws.
- **Levels of detail**: terrain (three levels by distance), buildings, roads, trees and railings by distance (scaled by
  the render distance), cars (whole or one piece), scenery's share and the crowd per preset.
- **Compressed textures (KTX2/Basis): not used, deliberately.** Measured: every car and part model together carries
  58 KB of textures (one small palette each); the rest of the textures (3–15 MB in a scene) are drawn on canvases at
  start (windows, fences, street names). KTX2 would save a few MB of GPU memory against budgets of 256 MB and more, and
  nothing at all in download, for a transcoder and its WebAssembly. Worth it when photographic textures arrive.
- **Shaders compiled during loading** (above), so the first crash, the first broken window, the first car of a new
  model and the first far car in one piece don't stutter.
- **Garbage**: the crash replay recycles its frames; the one-piece copies are made into arrays made once; other
  players' network delays are sorted without making any. What's left is mostly the physics' own small vectors (the
  vehicle model, the drivers: about 80% of it in a race) — left alone, the physics stays exactly as it is. Its cost,
  measured (`--cpu`, `--gc`): the collector takes about 1–2% of the main thread; its quick collections pause it 2–5 ms
  at most here, its full ones (one every second or two in a race) 4–11 ms, once 36 ms — drawn in software, the
  collector's helper threads compete with the renderer for the CPU, so a player's computer does better.

## The CPU and threads

- **Main thread budget** per tier (`mainThreadMs`: 22 / 11 / 9 ms a frame) — the game's own work, every stage but the
  browser's. `tools/bench.mjs` prints it against the budget for each scene.
- **Off the main thread already**: the map's tiles (fetched, cached in IndexedDB, decoded, the terrain cut and its
  normals worked out) in two Web Workers, handed back without copying; all the sound's processing on the audio thread
  (AudioWorklet: engines, tyres, the limiter); the minimap's tiles in MapLibre's workers.
- **On the main thread, on purpose**: the physics (Rapier) and the NPC drivers, which run inside each physics step.
  Moving them to a worker would put a frame of delay between your input and the car, and between the physics and what's
  drawn; the replays, the multiplayer's state and the determinism tests all read the simulation step by step. Its cost:
  **8 cars with collisions, 4.8–5.6 ms of physics per 60th of a second** on this machine (the pile-up and the races),
  within the 6 ms budget (`data/tracks.json` physicsMs8Cars).
- **SharedArrayBuffer: not used.** It would need the pages served cross-origin isolated (COOP/COEP headers), which the
  bot check on the account pages (Cloudflare Turnstile's iframe) doesn't work with, and every font, library and map tile
  would need its own cross-origin headers. Nothing would gain from it: the workers' data is transferred without copying
  already, and the audio thread is sent 4 small messages a second.

## Memory

- **Budgets per tier** (above), checked every 5 seconds (`perf/memory.js`): what the graphics card holds (geometries,
  textures — every one counted once), the decoded sound, the heap. Over one, what can be let go is, least recently used
  first: car models no car uses now (kept up to an eighth of the meshes' budget), the car model files kept for the next
  race. The map's tiles come and go by distance; the sound's files by use (counted references).
- **The long play test** (`tools/memory-soak.mjs`, 2 hours by default): the game itself, round and round — a downtown
  race and driving on (free roam), a race on a generated track, the garage, the test centre's pile-up and repairs —
  sampled every half minute. It passes when, from the end of the first round (everything loaded once) to the end of the
  last, the heap, geometries, textures, shaders, page elements and sound nodes haven't grown beyond a small allowance.

## Loading

- **Time to drivable** targets per tier (above). `tools/bench.mjs --network` measures it over a normal home connection.
- **What players download**: the site (`tools/build-site.mjs`) leaves out the editor, the admin page, the development
  and test pages and the benchmarks' scenes (`perf/bench.js`); the finishing passes (bloom, FXAA) load only when one
  is turned on; the first launch's benchmark only on the first launch.
- **Preloading**: while a quest's card is open, the map round its start is fetched into the cache; the world's shaders
  compile as it's entered; other cars' while they're still hidden.

## Stutters, and the background

- The causes are logged (above); the ones found and fixed: shader compiles at the first sparks (the lights' count) and
  for new cars and broken glass (compiled ahead), and garbage from the one-piece copies (made into arrays made once)
  and other players' network delays (sorted without any).
- **In the background** (another tab, minimised): the browser stops drawing (no frames), the sound is suspended, and
  the multiplayer connection stays (a worker's heartbeat keeps it alive and shows your car as paused to the others).

## Browsers

`tools/browsers.mjs` (the `browsers` workflow: Chrome, Edge, Chromium, Firefox, WebKit on Linux; WebKit — Safari's
engine — and Chromium on macOS) records what each supports (`perf/features.js`), drives the game on low and high,
switches settings while driving, and checks a browser missing something is told what to use.

| | Needed | Chrome / Edge | Firefox | Safari |
|---|---|---|---|---|
| WebGL 2 | yes | yes | yes | 15+ |
| JavaScript modules, import maps | yes | yes | 108+ | 16.4+ |
| Module workers | yes | yes | 114+ | 15+ |
| WebAssembly (the physics), IndexedDB, DecompressionStream (the map's tiles) | yes | yes | 113+ | 16.4+ |
| AudioWorklet | no — the engines' simpler sound without it | yes | yes | yes |
| KHR_parallel_shader_compile | no — shaders compile one after another | yes | yes | no |
| Battery status | no — power saver "on battery" can't tell | yes | no | no |
| performance.memory | no — no heap figure in the overlay | yes | no | no |
| WebGPU | no — not used (above) | yes | partly | 26+ |

(Filled in from the `browsers` workflow's report: `reports/browsers/*.json` in its artifacts.)

**Too old a browser** (index.html, before anything loads): missing any needed feature, the page says what's missing
and to use an up-to-date Chrome, Edge or Firefox, or Safari 16.4 or newer — or, missing only WebGL 2, to turn hardware
acceleration on or update the graphics driver.

## Checks that keep it so

| Check | When | What |
|---|---|---|
| `perf` workflow | Every change to the game on `main` | The five scenes against `tests/perf/ci-baseline.json`: a figure worse beyond `data/performance.json` `ci` warns (draw calls, triangles and sizes +10%; times +25%) or fails (+25% / +60%). Never holds up a deploy. |
| `browsers` workflow | Changes to the game's page and start-up | Above |
| `tools/physics-presets.mjs` | By hand (and before a release) | The physics tests identical on every preset, and after switching while driving |
| `soak` workflow (`tools/memory-soak.mjs`) | Sundays, and by hand: 2 hours | Memory flat |
| `tests/unit/quality.test.mjs` | Every commit (the unit tests) | Presets and custom, the frame rate cap, dynamic resolution |

## The report

`tests/perf/before-step2.json` (the game before this step, with only the measuring added) against
`tests/perf/after-step2-high.json` (after, at the high preset — the closest to how the game was set before; high adds
bloom). `node tools/perf-report.mjs <before> <after>` makes the table.

How to read it, with no graphics card: the **frame time** here is the software renderer's — meaningless for players
(and high's new bloom and MSAA passes cost the software renderer far more than a GPU). The **physics, AI and game
stages a frame** grow with it (a slow frame catches up several physics steps): compare **physics per 60th of a second**
instead, which is the same before and after (the physics wasn't touched). The draw calls, triangles, memory, garbage
and its stutters are what changed.

#### Before Step 2 → after, at the high preset (software rendering, 640×360; this machine)

| | track_race | night_rain | city | roam | pileup |
|---|---|---|---|---|---|
| draw calls (picture + shadows) | 264 → 105 (-60%) | 236 → 104 (-56%) | 327 → 239 (-27%) | 272 → 190 (-30%) | 478 → 401 (-16%) |
| …of them for the shadows | 188 → 14 (-93%) | 161 → 13 (-92%) | 126 → 19 (-85%) | 54 → 15 (-72%) | 64 → 3 (-95%) |
| triangles (k) | 786 → 788 | 773 → 773 | 647 → 659 | 300 → 300 | 642 → 454 (-29%) |
| physics ms a frame | 21.50 → 23.20 (+8%) | 13.29 → 13.32 | 23.00 → 30.37 (+32%) | 5.02 → 4.03 (-20%) | 18.17 → 17.84 |
| AI ms | 6.32 → 7.06 (+12%) | 4.23 → 3.89 (-8%) | 5.77 → 7.90 (+37%) | 0.27 → 0.24 (-13%) | 0.69 → 0.77 (+12%) |
| game ms | 3.81 → 4.09 (+7%) | 3.14 → 3.80 (+21%) | 3.25 → 5.10 (+57%) | 2.79 → 3.55 (+28%) | 5.84 → 7.04 (+21%) |
| render (CPU) ms | 5.55 → 5.44 | 4.11 → 5.84 (+42%) | 7.89 → 8.44 (+7%) | 10.12 → 8.45 (-16%) | 8.94 → 7.60 (-15%) |
| streaming ms | 0.18 → 0.20 (+11%) | 0.21 → 0.20 | 1.77 → 2.53 (+43%) | 2.25 → 1.64 (-27%) | 0.00 → 0.00 |
| network ms | 0.01 → 0.00 (-100%) | 0.00 → 0.00 | 0.00 → 0.00 (-33%) | 2.65 → 2.41 (-9%) | 0.00 → 0.00 (-11%) |
| audio (main thread) ms | 1.09 → 0.86 (-21%) | 0.91 → 0.78 (-14%) | 1.16 → 1.08 (-6%) | 2.12 → 2.17 | 0.77 → 1.21 (+56%) |
| effects ms | 0.04 → 0.09 (+122%) | 0.03 → 0.11 (+255%) | 0.10 → 0.23 (+123%) | 0.05 → 0.05 | 0.47 → 0.53 (+13%) |
| physics per 60th of a second, ms | 5.18 → 5.11 | 3.38 → 3.57 (+6%) | 5.56 → 5.68 | 0.82 → 0.60 (-27%) | 4.81 → 5.03 (+5%) |
| heap MB | 129 → 123 (-5%) | 120 → 113 (-6%) | 300 → 303 | 238 → 248 (+5%) | 179 → 190 (+6%) |
| meshes MB | 17 → 19 (+15%) | 16 → 18 (+7%) | 89 → 91 | 89 → 93 (+5%) | 30 → 34 (+13%) |
| textures MB | 15 → 15 | 15 → 15 | 12 → 12 | 8 → 8 | 3 → 3 |
| garbage, MB/s at 60 fps (Chrome's count; ± about 30% from run to run) | 141 → 154 | 138 → 91 (-34%) | 152–174 → 154–227 (3 runs) | 83 → 78 (-6%) | 155 → 159 |
| …of it the physics and the drivers, MB a simulated second | 112 → 123 | 67 → 69 | 106 → 113 | 10 → 10 | 75 → 76 |
| …the rest of the frame, KB a frame | 488 → 532 | 1209 → 384 (-68%) | 789–964 → 843–1941 (3 runs) | 1110 → 1090 | 1352 → 1391 |
| …outside the frame (the network, timers), MB/s | 0.1 → 0.0 | 0.0 → 0.0 | 0.1 → 0.1 | 8.0 → 3.4 (-58%) | 1.2 → 1.5 |
| shader-compile stutters | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| audio thread | 7.1% → 7.9% (+11%) | 5.1% → 5.1% | 5.9% → 6.7% (+13%) | 4.0% → 9.5% (+140%) | 5.1% → 9.5% (+85%) |
| frame (software rendering) ms | 875 → 893 | 862 → 897 | 932 → 1273 (+36%) | 588 → 596 | 1184 → 1073 (-9%) |
| drivable in s | 4.6 → 4.2 (-8%) | 4.5 → 4.8 (+8%) | 9.8 → 10.1 | 9.9 → 11.5 (+16%) | 5.2 → 6.4 (+23%) |

- **Draw calls** fell by 16–60%, almost all of it the **shadows** (−72 to −95%): every car's shadow is one draw.
- **Garbage** (counted again, by Chrome: the page's own figure missed most of it): about the same before and after
  in most scenes — it's mostly the physics' own (untouched) — except the night race, a third less (1.2 → 0.4 MB a
  frame), and free roam's network, less than half (above). Medium and low make less again (the night race 74 / 69
  MB/s, the pile-up 103 / 93). Downtown's varies most from run to run (843–1,941 KB a frame at high in three runs;
  nothing in its allocation profile is the graphics').
- **The pile-up's triangles** fell 29% (far cars in one piece); its picture draws barely, because at high all ten
  cars are near enough (300 m) and few enough (8) to be drawn whole — at medium and low (150 / 60 m, 6 / 4 cars) they
  fall further (below).
- **Memory**: the meshes a few MB more (the one-piece copies: about a megabyte a car).
- **Loading**: a fraction of a second more before driving in some scenes — the world's shaders compiled as it's entered
  (without the browser's parallel compiling, as here, that waits) — paid once, instead of stutters later.
