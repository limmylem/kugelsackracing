# The game's sound (Phase 8 Step 1)

Engines, tyres, the road, crashes, damage, the echoes of where you are and the other cars, all made by the game as
it plays: one sound system for your car, the NPC racers and other players, reacting to the physics' revs, load and
slip, and to the parts fitted. Every sound is ours: made by our own tools from settings (`npm run sounds`,
`tools/content/sound.mjs`) or by the game's own code as it plays. No recordings and no sound library were used, so
nothing was bought and nothing needs licensing.

## How it fits together

```
the page (each frame)                                   the audio thread (AudioWorklet, audio/worklet.js)
  physics snapshot ─► audio/game.js ─┬─► your car ───────► 'kr-engine' + 'kr-chassis' (audio/dsp.js) ─┐
  network states ──► audio/voices.js ┴─► other cars ─────► 'kr-car' (both in one node, mixed down) ───┤
  Map v3, Rapier rays ─► audio/environment.js (echo, area, ambience)                                   │
                                                                                                      ▼
  groups: engine · tyres · impacts · environment · others · ui · music  (settings' sliders; data/audio.json trims)
        └─► echoes (tunnel, street: convolution; a slap between walls) ─► compressor ─► limiter ('kr-limiter') ─► out
```

- **One AudioContext** (`audio/system.js`), started by the first key press, click or tap (browsers allow sound only
  after one). Seven groups, each with its slider in Settings → Sound, and a quality setting (high / low). A
  compressor, then a look-ahead limiter (`audio/dsp.js` Limiter: 3 ms ahead, ceiling −1 dBFS): nothing past the
  ceiling, ever, however many crashes at once.
- **The voices run on the audio thread** (AudioWorklet), so a long frame, a tile loading or the garbage collector
  never stutters the sound. The page only sends each voice its state (revs, throttle, load, gear, slip …). Every
  level and filter glides sample by sample: no zipper noise, no clicks.
- **The sound files** are made once by `npm run sounds` (WAV, the masters, in `assets/sounds/`) and compressed as
  Opus for players (56 kbit/s, `tools/content/opus.mjs`, `assets/sounds/manifest.json`): 245 files, 4.1 MB of Opus
  against 25 MB of WAV. A browser fetches and decodes (in the background) only the engines and sounds of the cars and
  parts in use; when the last car using one goes, it's let go. A browser that can't decode Opus gets the WAV.

## Engines

Each engine has a sound config (`data/sounds/engines/*.json`: i4, i4_turbo, flat4, v6, v8, v8_tt, rs17) and its
files. The voice (`audio/dsp.js` EngineVoice) takes the revs, throttle, load (the torque model's: positive on
power, negative on the overrun), gear, clutch, boost and the limiter, and plays:

- **The engine itself, two ways.** *Granular* (the default): a recorded-style sweep from idle to past the redline,
  on load and off, cut into one-engine-cycle grains; each cycle plays the grain nearest the revs now, crossfaded.
  *Layers*: steady loops at five rpm points, on and off load, crossfaded by the revs (equal power) and pitched a
  little. Compared on the same engines, granular was steadier — level jitter 0.0383 against 0.0388, level wobble
  0.0241 against 0.0268, brightness wobble 0.0450 against 0.0507 — and plays each rpm's own cycle instead of a
  pitched neighbour, so it's the default; layers are used on low quality (cheaper, smaller) and can be heard side by
  side on the test page.
- **Gear changes** cut the sound at once and bring it back darker; the gear going in clunks. **The rev limiter**
  bounces at its rate (a stage-2 ECU's faster). **Idle** wobbles (a cross-plane V8 lopes). **Starting**: the starter
  turns it, it catches and flares; **stopping** runs it down with a shudder; a **stall** (revs falling away) stops it,
  and it starts again by itself when the physics' revs come back.
- **Damage**: a damaged engine misfires (dropped firings, a pop now and then).

## Parts change the sound

A part's `sound` block (`data/parts/**`, schema `partSound`) changes the car's sound; `garage/carSound.js` merges them
into `spec.audio` (levels and tones multiply, rasp and pops add as shares, the rest the last part's):

| Part kind | What changes |
|---|---|
| Exhausts (cat-backs, headers) | Level, tone (brighter or deeper), rasp, pops and crackles on lift-off |
| Intakes | The induction roar under throttle |
| ECU maps | Pops on the overrun, the limiter's bounce rate |
| Turbos | The spool whistle (rising with boost), the blow-off valve or a wastegate's flutter when the throttle shuts |
| Superchargers | The rotors' whine (roots/twin-screw or centrifugal) |
| Gearboxes | Straight-cut gears' whine |
| Engine swaps | The other engine's whole sound config |

**In the garage**, the dyno's runs have a listen button: each run plays back as a sweep through that build's sound,
so before and after can be heard one after the other. Every part with a `sound` block is tested to change the sound
the way it says (`tests/unit/audio.test.mjs`).

## Tyres, the road and the car

- **Tyres** (`audio/mix.js` tyreSound, from each wheel's combined slip — 1 is the grip limit): nothing well inside it,
  a scrub nearing it, a squeal past it (higher pitched the harder), a skid when sliding. The squeal tells you how near
  the limit you are.
- **The road**, by surface under each wheel: asphalt's roar, concrete brighter with its joints, cobbles' rumble,
  gravel's crunch, grass, dirt, sand, and a hiss when wet; kerbs rumble at their stripes' rate; bumps thump through
  the suspension; wind rises with speed; brakes squeal now and then on low-speed stops; the handbrake ratchets.
- **Crashes** (`audio/crash.js`, `data/sounds/crash.json`): a tap, crunch or crash by how hard (the damage model's
  class), for what was hit — a car, a rail, concrete, a building, a tree, a tyre wall — with a low thump under a big
  one; glass, lights, parts tearing off and clattering down the road; scraping along walls (metal or concrete);
  loose parts rattling; a hanging bumper flapping, faster the faster you go.
- **Damage while driving** (`data/sounds/mechanical.json`): a boost leak's hiss, steam from the engine bay, a soft
  tyre flapping each turn, a damaged gearbox grinding gears in, a damaged diff whining, a holed exhaust's rattly
  blat. Each is only connected while it's heard.

## Where you are

- **Echoes** (`audio/environment.js`): rays from the camera (up and all round, against the world's fixed colliders)
  tell a tunnel, under a bridge, a street between buildings, or open country; the echo follows (a long dense one in a
  tunnel, a shorter one with early reflections in a street, a slap between close walls timed by how far apart they
  are, nothing in the open). An echo not in use is disconnected and costs nothing.
- **The area** (Map v3's tiles: buildings, trees, water): city, forest or coast ambience, and a crowd at tracks
  (cheering overtakes and crashes).
- **Other cars**: placed left to right, quieter with distance, muffled by the air far off, muffled more behind a
  building (a ray between you), and pitched by Doppler (coming at you higher, going away lower).

## The cameras

Outside, mostly the exhaust and the engine; on the bonnet more intake; in the cockpit the exhaust muffled, more
intake, gearbox and the cabin's boom, the outside world muffled; a convertible with its roof open in between
(`data/audio.json` views). Changing camera glides over a quarter of a second.

## Other cars: NPCs and other players

The same voices as yours (`audio/voices.js`), fed by the NPC's physics or by the network's car state (revs,
throttle, gear and wheel slip). The nearest **6** have everything (engine, tyres, road), heard from outside and mixed
in one worklet node; the next **12** within 600 m have one engine loop pitched by their revs (very cheap); the rest
none. A car changing between them crossfades (0.3 s); what's no longer heard is let go once it has faded. On low
quality the nearest 3 are full.

## Settings, the overlay and the test page

- **Settings → Sound**: master and each group (engine, tyres, impacts, environment, others, UI, music), and quality.
  Low quality: layers instead of granular, no echoes, no occlusion rays, 3 full voices. **M** mutes.
- **Shift+M** shows the audio overlay: the audio thread's share of real time against its budget, the page's time per
  frame, voices, what's loaded, the limiter's work, the echo and area, the engine and tyres.
- **The audio test page**, `dev/audio.html` (locally `npm start`, then `/dev/audio.html`): a virtual dyno — any car
  and parts, the revs, load, gear, clutch and boost by hand or swept, start, stop, lift-off, the limiter — each layer
  alone or muted, granular against layers, A/B builds, the cameras, the tyres on each surface, the echoes, crashes,
  with graphs of revs, load, boost and slip and the sound's spectrum.

## Budgets and what was measured

`data/audio.json` `budget`: the audio thread may use **15%** of one core on a desktop; on a low-end device (taken as
**4×** slower) at low quality, **60%**. The page's own time on sound: under 0.6 ms a frame.

| Test | Result |
|---|---|
| An 8-car race with crashes in Chromium, the whole graph, once warmed up (`npm run test:audio-browser`) | high 12.6% · low 8.7% (34.9% on a 4× slower device) |
| The same, its first 8 s (the audio thread's code still being compiled) | high 18.5% · low 11.8% |
| The voices' code alone, Node (`npm run test:audio`) | high 7.4% · low 17.9% on a 4× slower device; per voice: engine 0.70%, another car's engine 0.42%, tyres and road with everything on 0.74% |
| Clipping: the race with a pile-up of crashes | out never past −1.00 dBFS (the mix reached +9.3 dBFS; the limiter took up to 10.3 dB off) |
| 100 races in a row | nothing left playing, no nodes or worklet voices left, the worklet's sample bank empty, the heap +0.2 MB |
| Clicks | none on crossfades, grains, gear changes, the limiter, lift-off, start and stop (`tests/unit/audio.test.mjs`); none as another car changes detail (in Chromium) |
| Opus | each of the 245 files matches its WAV in Chromium: the same length, the engines' loops and sweeps not shifted by more than a sample, loops joining smoothly |

(Measured on a 2.8 GHz cloud CPU, October 2026.)

## Tests

- `tests/unit/audio.test.mjs` — the engine, parts, tyres, surfaces, cameras, Doppler, voices, echoes, limiter, clicks.
- `tests/unit/sound.test.mjs` — the sound configs and files, the turbo, crash sounds.
- `tests/audio.mjs` (`npm run test:audio`, in the fast checks) — CPU, clipping, memory over 100 races.
- `tools/audio-browser.mjs` (`npm run test:audio-browser`, in the slow tests) — the race through the real graph in
  Chromium, every Opus against its WAV, another car's voice changing detail, the test page.
- `tests/check-data.mjs` — every sound file there, the sweeps covering every engine's revs, the Opus up to date.

## Making and changing sounds

- `npm run sounds` makes every engine's files from its config's `synth` settings, the crash sounds, and the Opus
  (needs ffmpeg with libopus). `--only v8` for one. A config without `synth` (real recordings) is left alone.
- Tuning without code: `data/audio.json` (group trims, compressor, limiter, voices, budgets, cameras, distance,
  Doppler, occlusion, echoes, tyre slip thresholds, surfaces), each engine's config (`mix`, `granular`, `limiter`,
  `idle`, `start`, `exhaust`, `pops`), and the parts' `sound` blocks.

## If we record our own sounds

Real recordings can replace the made ones file for file: a config without `synth` keeps its files. What would be
needed, for each of the 7 engine sounds (an engine of that kind: i4, turbo i4, flat-4, V6, V8, twin-turbo V8, and a
high-revving race engine):

- **A slow sweep** from idle to the redline on load (full throttle on a chassis dyno, about 20–30 s) and the same
  back down off load (throttle shut), with the revs logged alongside (OBD or an ignition pickup) so each engine cycle
  can be marked. For layers instead: steady 4–5 s holds at five rpm points, on and off load.
- **Microphones**: at the exhaust (about 1 m behind, off to one side), in the engine bay (intake), and in the cabin.
- **One-offs**: starter and catch, switching off, gear changes, the rev limiter, pops on the overrun, and where the
  car has them, a blow-off valve or wastegate flutter, supercharger whine, straight-cut gear whine.
- **Tyres and road** (a skid pad or closed road): squeal, scrub and skid on asphalt; rolling on asphalt, concrete,
  cobbles, gravel, dirt, grass and wet road; kerbs.
- **Impacts** (scrap panels and objects, not cars crashing): metal on metal, a guard rail, concrete, wood, a tyre
  wall; glass breaking; parts falling; metal and concrete scraping.
- **Ambience**: a city street, a coast, a forest; a crowd (people recorded need to agree to it).
- **Gear**: a field recorder at 24-bit/96 kHz or 32-bit float, wind protection, and permission from the car's owner,
  the dyno and the location. The recordings must be ours: never from other games or videos.

Licensed engine-sound libraries exist too; none has been bought. Ask the owner before buying one.

## Not done yet

- **Music**: the group and its slider are there; there's no music yet.
- **Safari** may not decode Opus everywhere; it then gets the WAV files (bigger downloads, the same sound).
- The low-end figure is the desktop's measured time × 4, not a measurement on a slow device.
