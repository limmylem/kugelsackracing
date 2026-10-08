# Deterministic physics (Phase 6 Step 3, the first part)

The server checks the best results by driving them again: the run's recorded inputs, replayed headlessly
with the same physics, car, track and other cars, must arrive at the same place at the same time. That only
works if the same inputs give the same result, bit for bit, in every browser and on the server. This is the
test of that, and what it found.

## The test

`tests/determinism/run.ts` (and `.github/workflows/determinism.yml`, on every change to the simulation):
- **100 recorded runs** on generated tracks, one from every preset in turn, 30 s each, driven by the test
  driver with a little weaving so each run is different. 20 of them have three more cars on the grid, each
  replaying its own recorded inputs (cars touching, slipstream).
- **Each physics step's input is recorded as it's applied**, quantized to 3 bytes (steering, throttle,
  brake), so the recording is exactly what the car got.
- **Replayed from the inputs alone** in Node (the server) and in each browser
  (`tests/determinism/page.html`). The state of every car — position, rotation, velocities, every wheel's
  spin — is hashed bit for bit after every simulated second.
- **Compared:** a run matches only if every second's hash is identical.

```sh
node tests/determinism/run.ts record --out .cache/determinism/r100
node tests/determinism/run.ts replay --in .cache/determinism/r100
node tests/determinism/run.ts browsers --in .cache/determinism/r100 --browsers chromium
node tests/determinism/run.ts compare --in .cache/determinism/r100
```

`DET_MATH=all` runs it with the deterministic maths below (`node tests/determinism/detmath.mjs` builds it);
`--rapier deterministic` with Rapier's deterministic build.

## What it found

### The platform's maths isn't the same everywhere

With the game as it is, **0 of 100 runs** replayed in Chromium 141 match Node 22 (the server). Both are
V8, but different versions: `Math.cos` gives a different last bit for some angles. The first difference
is in building the track — one scenery collider's rotation — and the runs part within the first second.

JavaScript doesn't promise that `Math.sin`, `cos`, `exp`, `pow`, `atan2` and the rest give the same bits
on every engine, or even every version of one. The simulation uses them about 300 times (the tyres, the
engine, the aerodynamics, the AI, the track builder; `Math.hypot` is one of them).

### With deterministic maths, they match

The same 100 runs with every one of those functions replaced by stdlib's ports of FreeBSD's maths library
(`@stdlib/math-base-special-*`: built only from `+ − × ÷` and `sqrt`, which IEEE 754 makes exact
everywhere):

| | Rapier as now (`rapier3d-compat`) | Rapier's deterministic build |
|---|---|---|
| Node 22, Linux x64 (here) | 100 of 100 (the reference) | 100 of 100 |
| Chromium 141, Linux x64 (here) | 100 of 100 | 100 of 100 |

(CI: Firefox, WebKit on Linux, WebKit 26 and Node on macOS arm64 — to be filled in.)

- **No cost in speed:** 100 runs took 124 s with the deterministic maths, 132 s without.
- **Rapier itself** was already deterministic across these (it's WebAssembly, whose arithmetic is exact);
  its deterministic build agrees with the usual one bit for bit here.

### In the game now (Phase 7 Step 3)

The deterministic maths is the game's own: `physics/detmath.js` installs it on `Math` before anything is built or
simulated (`physics/detmath-install.js`, the game's first import), and the server's replay worker
(`server/src/mp/replayWorker.ts`), the multiplayer bots and the contact tests install the same. The bundle is
`physics/vendor/detmath.js` (`node tools/build-detmath.mjs` rebuilds it from the `@stdlib` packages: `Math.log` is
stdlib's `ln` — its `log` takes a base); `Math.hypot` folds stdlib's two-argument one over however many it's given.
`tests/unit/detmath.test.mjs` checks each against the platform's own (the same function, to the last bit or two). The two `**` with a fraction now use `Math.pow`. A
multiplayer run on a generated track is driven again on the server from its inputs and contact pushes and must land
exactly where it says (docs/CONTACT.md "Verification"; `server/tools/mp-contact-test.ts`).

### Not yet covered
- **Real-world routes:** the map's collision streams in round the car on a per-frame time budget and as
  downloads finish, so which colliders exist at each step depends on the machine. A replay there needs
  the route's corridor of collision loaded before the start, in a fixed order.
- **NPCs with their own driver:** the test's other cars replay recorded inputs. The real NPC driver
  (`ai/driver.js`) is seeded and uses the same maths, so it should follow, but it isn't in the test yet.
