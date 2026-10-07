# Multiplayer: the networking foundation (Phase 7 Step 1)

Players drive in the same world and see each other's cars. This step covers the network model, the real-time
server, the protocol, time sync, showing other cars, connections and the debug tools. It doesn't cover races
between players or collisions between their cars (other cars are drawn kinematically: they don't push yours yet).

Everything here runs on this computer only (deployment is paused, [DEPLOYMENT.md](DEPLOYMENT.md)). It has been
tested on simulated bad networks from the start, never only on localhost.

## The network model

**Each player's own game simulates their car.** It sends the car's state to the server, the server relays it to
the players near it, and their games draw it.

| | Client-authoritative (this) | Server-authoritative (the alternative) |
|---|---|---|
| Your own car | Responds at once, at any ping | Either input delay, or prediction and rollback of the whole car physics |
| Server cost | Relaying and checking: a 256-player process ticks in a few ms | Running every car's physics (Rapier) for every room |
| Determinism needed | Only for checking results afterwards (already built: [DETERMINISM.md](DETERMINISM.md)) | Bit-identical physics across browsers and the server, every frame |
| Cheating | A modified client can send states its car didn't really reach (see the checks below) | Much harder |

Driving feel decides it. A racing game with a 150 ms ping can't put that ping between the player's input and
their car, and rolling back a full vehicle simulation (tyres, suspension, damage) costs too much on the server
and in browsers. The cost is trust, so the server checks what it can live and the result is checked properly
afterwards:

### Live checks and after-race checks

**Live** (`server/src/rt/checks.ts`, every state as it arrives). These are cheap and catch the obvious:
- the message rate (at most 70 a second);
- finite numbers, inside the world (500 km);
- stamps not too far in the future (150 ms) or the past (2.5 s);
- speed below 110 m/s;
- not further than its speed allows since the last state (6 m slack), unless it's a reset (at most one every
  1.5 s);
- out-of-order or stale states are dropped without a strike (normal on a lossy link).

Every other dropped state is a strike. 30 strikes in 10 s and the player is removed (`KICKED`). A dropped state
reaches nobody, so an impossible car never appears in anyone else's game.

**After the race** (Phase 6 Step 3): a result is accepted only by replaying it. The run's recorded inputs are
driven again headlessly with the same physics, car and track, and must arrive at the same place at the same time
([DETERMINISM.md](DETERMINISM.md)). This is what keeps leaderboards and rewards honest. A client that sends
impossible states over the network can't win by it, because the replay decides, not the live states.

The live checks can't catch a car driven slightly better than its physics allow (a few percent more grip). The
replay catches that for results. For live play it only affects what others see, and Step 3 (collisions between
players) will need to reconsider it.

## The server

**Colyseus 0.18** (`@colyseus/core`, `ws-transport`, `redis-presence`, `redis-driver`), not a custom
uWebSockets.js server. Colyseus provides:
- rooms with join/leave and reconnection (`allowReconnection`);
- authentication before join (`onAuth`);
- matchmaking across processes through Redis;
- binary messages (`onMessageBytes`, `sendBytes`), so the protocol is our own and not tied to its state sync;
- a transport layer that can be swapped.

A custom server would mean writing all of that ourselves. Its speed isn't needed: a 256-player process ticks in
2.4 ms at the 95th percentile (below). Colyseus's own schema state sync isn't used for car states. It doesn't
quantise the way we need and its deltas assume a reliable stream. Our codec does both.

**Transport.** WebSockets now. Everything above the transport is written for either a reliable stream or
unreliable datagrams:
- the client (`net/client.js`) sends full states instead of deltas when the transport is unreliable
  (`fullStates`);
- events that must arrive are separate and reliable;
- the server's per-client simulator has a datagram mode, and all the bad-network tests run in both modes.

Switching to WebTransport later means a transport in `net/transport.js` and the server's equivalent. Colyseus
has a WebTransport transport in development. Datagrams roughly halve how far behind other cars are shown on a
lossy network (below).

**Files:**
- `server/src/rt/room.ts`: the test room (`test`, named `<room>@<world>`);
- `server.ts`: starting a process;
- `main.ts`: the command and several processes;
- `tickets.ts`, `checks.ts`, `interest.ts`;
- `bridge.ts`: the API telling the real-time server about bans.

**Joining:**
1. The game asks the API for a join ticket (`POST /api/v1/rt/ticket`, signed in or as a guest).
2. The ticket is signed with `RT_SECRET`, which the API and the real-time server share. It's good for 60 s and
   for one use only (its id is kept in Redis).
3. It carries the player's id, name, whether they're a guest, and the protocol version.
4. The room's `onAuth` checks, in order:
   - the protocol version;
   - the ticket (signature, expiry, not used before);
   - the ban list in Redis;
   - whether guests are allowed (`rt.allowGuests`);
   - whether the room and the server have room (`rt.maxPlayers` across processes, from Redis).
5. Joining from a second tab or device takes over: the first connection is closed with `ELSEWHERE`.

**Bans:**
- When an admin suspends or bans an account (`server/src/routes/admin.ts`), the API writes it to Redis
  (`rt:banned:<id>`) and publishes it.
- Every room kicks that player at once, and later joins are refused (`BANNED`). Unbanning removes it.

**Several processes:** `npm run rt -w @kr/server -- --processes 3` starts three processes on consecutive ports.
- Redis presence and the Redis driver share rooms between them.
- A player can be sent to any process. Matchmaking finds the room wherever it is (`publicAddress`).
- Each process publishes its rooms' load to Redis every 5 s, which is what the "server full" check reads.

## Messages

Binary, defined once in `net/` and shared by the game, the bots and the server:
- `protocol.js`: the version and message types, the close codes and their messages;
- `codec.js`: the encoding.

**Versioned.** `PROTOCOL` (now 1) is checked in two places:
- in the join ticket and options, before join: a mismatch is refused with code 4010, "The game has been updated:
  refresh the page to play online";
- in the hello message.

Any change to the encoding bumps it.

**Quantised:**

| Field | Encoding |
|---|---|
| Position | int32 millimetres per axis (±2,147 km) |
| Rotation | Smallest-three quaternion: 2 bits for the largest component, 15 bits per other component |
| Velocity | int16, 1 cm/s |
| Angular velocity | int16, 1 mrad/s |
| Steering, throttle, brake, wheel slip | 8 bits each |
| Gear, RPM | 1 byte; 16 bits at 1 rpm |
| Wheel spin | Per wheel, int16 |
| Lights and flags | 1 byte: brake, head, reverse, handbrake, stalled, away |

A full state is 63 bytes. Each state has a mask byte, so only the groups that changed since the last
acknowledged keyframe are sent. A parked car's state is 9 bytes. A full keyframe goes every second.

**Deltas only on a reliable transport.** A lost delta over datagrams would leave the receiver with a stale
rotation, so in datagram mode states are always full.

**Events** that must arrive go reliably:
- a crash (its dents, glass and parts, in Phase 4's compact form);
- a part coming off;
- a reset or a repair;
- light changes;
- the horn.

Their payloads are a small tagged binary encoding (`encodeValue`) that refuses `__proto__` and limits sizes.

**One coordinate system for everyone.** Each game keeps a floating origin (whole map tiles) to keep numbers
small. On the wire, positions are in the region's map frame: the simulation position plus that whole-tile
origin (`net/frame.js`). Two players with different origins agree on where a car is, and each converts to its
own frame when drawing. Millimetres in int32 cover the largest region with room to spare.

## Time sync

`net/clock.js`:
1. The client pings once a second.
2. The server answers with its time and tick.
3. Of the last 48 samples, the quarter with the shortest round trips is kept, and the median of their offsets is
   taken. Slow samples are where the error is.
4. The estimate is slewed at most 1 ms per ping, so time never jumps.
5. Before the first ping is answered, the welcome message's server time gives a first guess. It isn't counted
   as a sample: its trip time is unknown.

Every message from the server carries the server's time and tick. Every state a client sends is stamped with
the server time its physics state is for (not when it was sent). Measured accuracy: 0.7–2.0 ms against the
server's real clock, at the target bad network (target ≤ 5 ms).

## Sending your car

`net/client.js` (the game's side: `play/multiplayer.js`):
- 30 states a second (`NET.sendHz`, configurable). The detailed groups (wheels, engine) go every 2nd state.
- Paced per frame, so states keep their timing at any frame rate.
- Stamped with a smoothed clock, so the stamps advance evenly.
- Damage, parts, resets, repairs and lights go as reliable events.

## Showing other cars

`net/remote.js`, one per other car.

**Snapshot interpolation with an adaptive buffer.** Each car is shown a little in the past, between two states
that have arrived. The delay is:

```
clamp(p95 of arrival lag + half a send interval,  p50 + minBuffer 60 ms,  p50 + maxBuffer 1000 ms)
```

It's measured continuously. It follows the network's spread, not its worst moment.

- Shown time doesn't jump to a new delay. It runs at 90–110% of real time, changing by at most 0.5% a frame,
  until it's there. It resets only if it's more than 2 s off.
- Positions are Hermite curves using each state's velocity, with tangents limited by the chord, so a slow or
  sparse stream doesn't overshoot.
- Rotation is slerped.

**Late states.** The car is predicted ahead from its last state's velocity and turn, for up to 500 ms, then eased
to a stop. If its observed speed has been well below its reported speed (sliding into something), the prediction
uses the observed speed.

**No snapping.** When a real state arrives after a prediction, the car is blended from where it was shown to
where it should be (projective velocity blending). The blend time grows with the error: from 200 ms up to
1500 ms (`T = max(200, 300·√d + 15·dv, 2000·turn)`). A car is first drawn once it has two states. A reset or
teleport is flagged, so it moves at once instead of gliding across the map.

**Matching the car.** `testtrack/test-scene.js` (`mpAdapter`) draws each other player's car from its look (its
own model, parts and paint):
- **Wheels** turn at the sent wheel spin, steer with its steering, and sit on the suspension.
- **Lights:** brake, reverse and headlights from the flags.
- **Sound:** its engine at its RPM and throttle, and its tyres squealing at its slip (`remoteCarSound` in
  `testtrack/audio.js`). Both are positioned and quieter with distance.
- **Damage:** dents rebuilt from its crash events (the same deterministic rebuild as the garage), with glass and
  parts hanging or gone.

A player who joins later gets everyone's look and damage so far. Name labels float above the cars.

**Kinematic for now.** Other cars are drawn, not simulated. Collisions between players are Step 3.

## Interest management

`server/src/rt/interest.ts` is a spatial grid of 250 m cells. Each player gets the cars around them at a rate set
by distance:

| Distance | Rate |
|---|---|
| Up to 250 m | Every tick (30 Hz) |
| Up to 700 m | Every 3rd tick |
| Up to 1500 m | Every 10th tick |
| Beyond 1500 m | Not sent: listed in the roster only |

Far cars are shown with a longer buffer, which the adaptive delay handles on its own.

## Connections

**Reconnecting:**
- A dropped connection reconnects by itself (the SDK's reconnection, retried for up to `NET.reconnectSec`, 20 s).
- While it's away, its car stays where it was for everyone else, marked "away" (a light flag), and is predicted
  to a stop.
- When it's back, it carries on in the same room with the same id. Its events and look are kept.
- If it doesn't come back in time, it leaves.

**Dead connections** are removed: no message for `NET.idleSec` (15 s) and the server closes it (`IDLE`).

**Clear messages** (`net/protocol.js` `MESSAGES`, shown on the game's screen):

| Code | When | The player sees |
|---|---|---|
| 4010 `VERSION` | Protocol mismatch | The game has been updated: refresh the page to play online. |
| 4011 `BANNED` | Banned or suspended | This account is suspended or banned. |
| 4012 `FULL` | Room or server full | The server is full right now. Try again in a minute. |
| 4013 `TICKET` | Bad, expired or reused ticket | Couldn't sign you in to the game server. Sign in again, then retry. |
| 4014 `KICKED` | Removed (checks, an admin) | You were removed from the session. |
| 4015 `ELSEWHERE` | Joined from another tab or device | You joined from another tab or device, so this one was disconnected. |
| 4016 `IDLE` | Nothing heard for 15 s | Lost the connection to the game server. |
| 4017 `CLOSED` | The room or server closed | The game server is restarting. Reconnecting… |
| 4018 `GUESTS` | Guests not allowed | Make a full account to join this room (your progress comes with you). |

## Debug tools

**In the game** (any world or track, with `?mp`):
- `?mp` joins the free-roam room for this world; `?mp=<name>` joins a room of that name.
- `?netsim=150,30,0.05` adds 150 ms latency, ±30 ms jitter and 5% loss on this side. Add `,datagram` to drop
  unreliable messages instead of delaying them like TCP.
- `?servernetsim=…` does the same on the server's side, for this player (development and test only:
  `rt.netsim`).
- `?netdebug` shows the network overlay from the start; **F8** toggles it. It shows:
  - ping and jitter;
  - loss;
  - kB/s up and down;
  - the buffer;
  - for each car: how far behind it's shown, its corrections (now and at worst) and how long it's been predicted;
  - the simulator's settings, when on.

**The network simulator** (`net/netsim.js`) is the same code on both sides. It has a seeded random number
generator and an injectable clock, so the offline tests are repeatable.
- "Stream" mode behaves like TCP: a lost packet waits for a retransmission, and everything behind it waits too.
- "Datagram" mode drops unreliable messages.

**Headless bots** (`server/tools/rt-bots.ts`) are real clients (the same `net/client.js`) driving scripted
routes, including a real 5.3 km loop on the Milton Keynes roads:

```sh
node server/tools/rt-bots.ts --n 8 --seconds 60 [--route mk] [--netsim 150,30,0.05] [--server-netsim 150,30,0.05] [--endpoint http://localhost:2567]
```

`npm run rt -w @kr/server` starts the real-time server (`--processes N` for several).

## Targets and results

The targets are in `net/settings.js` (`NET.targets`). Results from `node --expose-gc server/tools/rt-test.ts`
are written to `reports/multiplayer-test.md` (not committed, like the other reports). From the runs on this computer:

| Target | Limit | Measured |
|---|---|---|
| Upload per player | < 10 KB/s | 1.2–2.1 KB/s |
| Download, 8 cars nearby | < 20 KB/s | 9.8–10.5 KB/s |
| Download, 30 cars nearby | < 48 KB/s | 28–34 KB/s (less a car than with 8: distant cars are sent less often) |
| Smooth at 150 ms, ±30 ms jitter, 5% loss | 0 snaps | 0 snaps in about 132,000 car-frames each over WebSockets and over datagrams (8 bots on the real route); worst frame-to-frame jump 6.3 cm |
| Much worse (400 ms, ±120 ms, 20% loss) | Graceful: still connected, every car shown and moving, < 5% of frames corrected | 1.3–3.8% of frames corrected |
| Time sync | ≤ 5 ms | 0.7–2.0 ms at the target bad network |
| Server tick | p95 ≤ 4 ms | 2.2–2.4 ms with 8 rooms × 32 players (256) in one process |
| Players per process | 256 | 256 |
| Reconnecting | Same car and damage, no memory growth | 100 of 100 back as the same car with its damage, the slowest in 0.5 s; heap 231.3 → 231.5 MB |

**A snap** is a drawn frame where a car moves more than 10 cm (or 10% of its movement that frame) beyond where
its own motion would have taken it, or turns more than 1.5° beyond it (`net/measure.js`). It's measured on what
was drawn, frame by frame, at 60 fps.

**The trade-off.** At the target bad network over WebSockets, other cars are shown about 750 ms in the past. A
lost packet stalls the TCP stream behind it, and the buffer has to cover that. Over datagrams it's about 380 ms. The
buffer above the usual delay measured in the full test: 349 ms over WebSockets, 62 ms over datagrams.
This is fine for free roam. For close racing (Step 3) it's the main reason to move to WebTransport datagrams. A
player's own car is never delayed.

## The tests

| Test | What it covers |
|---|---|
| `tests/unit/net.test.mjs` | The codec (round trips, quantisation limits, deltas, version), the world frame, the clock, interpolation, the simulator. Offline smoothness at target, in both modes, over several seeds. |
| `server/test/rt.test.ts` (needs Redis) | Join tickets (forged, expired, reused); version mismatch, banned and guest joins refused with their codes; a ban kicking a player in the room; the live checks; the interest grid; join and leave; reconnect. |
| `server/tools/rt-test.ts` (needs Redis) | Writes `reports/multiplayer-test.md`. Covers: <ul><li>8 bots on a real route;</li><li>the bad-network test (stream, datagram, and worse than target);</li><li>time sync accuracy;</li><li>bandwidth with 8 and 30 cars;</li><li>several processes;</li><li>8 rooms × 32 players' tick time;</li><li>reconnect ×100 (no lost state, heap not growing).</li></ul> |
| `server/tools/mp-browser.ts` (needs Redis, Chromium) | The success check. Two real browsers, signed in, in the same room. Each sees the other's car: <ul><li>moving smoothly;</li><li>wheels turning;</li><li>brake lights;</li><li>engine and tyre sound;</li><li>dents after a knock.</li></ul> A dropped connection comes back by itself. Then all of it again at the target bad network. |

The two-networks check (two players on different real networks, such as home Wi-Fi and a phone hotspot) needs
the game online. It's in [DEPLOYMENT.md](DEPLOYMENT.md) "To do when we deploy".

## Running it on this computer

```sh
redis-server                                  # or: docker compose up redis
npm run rt -w @kr/server                      # the real-time server on :2567
npm start -w @kr/server                       # the API and the game on :8787 (RT_URL=ws://localhost:2567)
# open http://localhost:8787/?mp in two browsers (or a normal and a private window)
```

With Docker Compose, `docker compose up --build` starts all of it, Redis and the real-time server included.

**Settings:**
- The API: `RT_URL`, `RT_SECRET` (in development made from `BETTER_AUTH_SECRET`), `REDIS_URL`.
- The real-time server: `RT_PORT`, `RT_HOST`, `RT_PUBLIC_ADDRESS`, `REDIS_URL`, `RT_SECRET`.
- `server/config/<env>.json` `rt`: `allowGuests`, `maxPlayers`, `netsim`.
