# Multiplayer

**Step 4, free roam in the real world** (zones and instances, handoffs, privacy, challenges, meets, chat, persistence) has
its own page: [FREE_ROAM.md](FREE_ROAM.md).

Step 1 (below, first): the networking foundation. Players drive in the same world and see each other's cars: the
network model, the real-time server, the protocol, time sync, showing other cars, connections and the debug tools.
Step 2 ([Lobbies, matchmaking and races](#phase-7-step-2-lobbies-matchmaking-and-races), after it): races between
players, from a quick race or a lobby to verified results. Collisions between players' cars are off in both (ghost
mode: other cars don't push yours); car contact comes in Step 3.

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

**Closing or reloading the page** leaves the room at once (`pagehide`), so the car doesn't linger for 20 s as
"reconnecting…".

**A window in the background** (minimised, another tab, covered by another window) draws no frames, and the game
sends from its frame loop. A timer in a small worker (not slowed down like the page's own timers) keeps the
connection alive. While the page is hidden it sends the car as it stands, marked paused (`LIGHT.AWAY`); everyone
else sees it there with "paused (window in the background)". A page that's visible but drawing slower than one frame
a second only keeps its connection.

**Paused games:** the server accepts the same physics step again (a paused car still says where it is); only an
older step is out of order. Before this, a game with its settings open vanished for everyone else after 3 s.

**Joining on top of another car:** every new car arrives where the world puts it, so two players joining together
were drawn inside each other. The later one (the higher id) moves 3.5 m beside the other once it has landed.

**One account, two windows:** joining again replaces the first connection (`ELSEWHERE`). The replaced window says
so in a banner that stays until it's dealt with (not a few seconds' notice), and in development it says how to play
two windows (below).

**Clear messages** (`net/protocol.js` `MESSAGES`, shown on the game's screen):

| Code | When | The player sees |
|---|---|---|
| 4010 `VERSION` | Protocol mismatch | The game has been updated: refresh the page to play online. |
| 4011 `BANNED` | Banned or suspended | This account is suspended or banned. |
| 4012 `FULL` | Room or server full | The server is full right now. Try again in a minute. |
| 4013 `TICKET` | Bad, expired or reused ticket | Couldn't sign you in to the game server. Sign in again, then retry. |
| 4014 `KICKED` | Removed (checks, an admin) | You were removed from the session. |
| 4015 `ELSEWHERE` | Joined from another tab or device (into a room of the same sort: free roam, or a race — a race's lobby doesn't close your free roam) | You joined from another tab or device, so this one was disconnected. |
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
- `?player=A` (development only, `rt.devPlayers`): this window plays as a guest of its own, "Player A",
  whatever the browser is signed in as. Two windows of one browser share its sign-in, so without it the second
  window replaces the first. Refused in staging and production (the server won't start with it on).
- `?netdebug` shows the network overlay from the start; **F8** toggles it. It shows:
  - who you are (your id and player) and the room;
  - **every other player:** how far from you, whether its car is drawn here (and if not, why: no state yet,
    loading its model, nothing heard for 3 s, reconnecting), whether it's on screen, and how long ago its last
    state arrived;
  - ping and jitter;
  - loss;
  - kB/s up and down;
  - the buffer;
  - for each car: how far behind it's shown, its corrections (now and at worst) and how long it's been predicted;
  - the simulator's settings, when on.
- **F9** (development only) puts your car beside the nearest other player, facing the way it faces.

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
| `server/test/rt.test.ts` (needs Redis) | Join tickets (forged, expired, reused); development `?player=` tickets (and refused where switched off, and in production); version mismatch, banned and guest joins refused with their codes; a ban kicking a player in the room; the live checks (a paused game's states accepted); the interest grid; join and leave; reconnect. |
| `server/tools/rt-test.ts` (needs Redis) | Writes `reports/multiplayer-test.md`. Covers: <ul><li>8 bots on a real route;</li><li>the bad-network test (stream, datagram, and worse than target);</li><li>time sync accuracy;</li><li>bandwidth with 8 and 30 cars;</li><li>several processes;</li><li>8 rooms × 32 players' tick time;</li><li>reconnect ×100 (no lost state, heap not growing).</li></ul> |
| `server/tools/mp-two-windows.ts` (needs Redis, Chromium) | Two windows of **one** browser, sharing its sign-in, in the world `/?mp` opens, as a person tries it on their own computer. What's checked is what each window really draws, read from its 3D scene and its rendered pixels: <ul><li>plain `?mp` in both: the replaced window says so on screen;</li><li>`?player=A` / `?player=B`: both in the room, not on top of each other, each window drawing the other's car on screen;</li><li>A drives by key presses: B draws it moving as far as A went;</li><li>A's window in the background for 20 s: A stays, B shows it paused, then moving again;</li><li>F8 lists the other player; F9 goes beside it.</li></ul> On the code before this fix it fails 10 of 11 checks. |
| `server/tools/mp-browser.ts` (needs Redis, Chromium) | The success check. Two real browsers, signed in, in the same room. Each sees the other's car: <ul><li>moving smoothly;</li><li>wheels turning;</li><li>brake lights;</li><li>engine and tyre sound;</li><li>dents after a knock.</li></ul> A dropped connection comes back by itself. Then all of it again at the target bad network. |

The two-networks check (two players on different real networks, such as home Wi-Fi and a phone hotspot) needs
the game online. It's in [DEPLOYMENT.md](DEPLOYMENT.md) "To do when we deploy".

## Running it on this computer

```sh
docker compose up --build                     # everything: the game and API, Redis, the real-time server
```

or by hand:

```sh
npm run rt -w @kr/server                      # the real-time server on :2567 (one process; no Redis needed)
npm start -w @kr/server                       # the API and the game on :8787 (RT_URL=ws://localhost:2567)
```

Redis is optional: without `REDIS_URL` the real-time server is one process, keeping its presence (who's where,
invite codes, parties, kicks) in memory. With it (`REDIS_URL=redis://localhost:6379`), several processes share
them (`--processes 4`).

**Two windows on one computer:**
1. Open `http://localhost:8787/?mp&player=A` in one window and `http://localhost:8787/?mp&player=B` in a second
   window (not a second tab: a tab in the background stops drawing). Put them side by side.
2. Wait for both to finish loading the world (the HOLD sign goes away) and for "Online … you are Player A/B".
   The second to arrive is moved beside the first, so each window shows the other car next to its own.
3. Press **F8** in either window: under PLAYERS, the other player should read "drawn" with an update a few
   hundred ms old. If it says "NOT drawn", the reason is next to it.
4. Click into one window and drive (arrow keys or WASD). The other window shows that car moving, a moment behind.
5. Lost each other? **F9** puts your car beside the nearest player.

Plain `?mp` in two windows of one browser is one account twice: the second window replaces the first, and the
first says so at the top of the screen. Two different browsers (or a normal and a private window), each signed in
as a different player, work with plain `?mp`.

**Settings:**
- The API: `RT_URL`, `RT_SECRET` (in development made from `BETTER_AUTH_SECRET`), `REDIS_URL`.
- The real-time server: `RT_PORT`, `RT_HOST`, `RT_PUBLIC_ADDRESS`, `REDIS_URL`, `RT_SECRET`.
- `server/config/<env>.json` `rt`: `allowGuests`, `maxPlayers`, `netsim`, `devPlayers` (development and test only).

---

# Phase 7 Step 2: lobbies, matchmaking and races

Players race each other: a quick race found by matchmaking, or a lobby of their own (private, with an invite code,
or custom and listed). Everyone loads the same route or track, sees the same countdown on the server's clock, races
with live positions worked out by the server, and gets results that are checked before they count — then pay and
rank changes. Players who drop can come back; spectators can watch any race. It reuses Step 1's networking, rooms,
time sync and bots; Phase 4's QuestSession, timing and reset rules; Phase 5's generated tracks and their hashes; and
Phase 6's accounts, rewards, run verification and reports.

Everything works on **one real-time process with no Redis** (`npm run rt`); Redis only lets several processes share
the work. The rules and numbers are in `data/multiplayer.json` (and the pay in `data/economy.json` `multiplayer`).

**Not in this step:** collisions between players (ghost mode only: the lobby's collision setting has just that one
choice); pink-slip races between players (nothing a player owns can be lost to another); input-replay verification
of real-world route runs (a run on a route is checked on its gates, times and the race server's own timing; generated
tracks' runs are replayed as in Phase 6).

## Lobbies

| Kind | How you get in | Who sets it up |
|---|---|---|
| Quick race | **Quick race** in the menu: matchmaking puts you in one | The queue: the venue for the region, one lap, ranked |
| Private lobby | Its **invite code** (6 letters), or a friend's invite, or joining a friend | Its host |
| Custom lobby | The **lobby browser** (when its host lists it), an invite, a code-less join from a friend | Its host |

The host chooses the venue (a real-world route, today's or this week's official track, a track code, or random),
laps, the car classes allowed, NPCs in the empty places, time of day, weather and the grid order (by rating, random,
or the last race reversed). Collision mode is ghost only. Players pick which of their cars to race (among those
allowed). Chat goes through the name/profanity filter (`server/src/names.ts` `cleanChat`); a player can mute (this
game only), block (kept by the API: chat, invites and the queue keep you apart) or report (Phase 6 Step 5's reports)
anyone in the lobby. The host can kick (they can't come back for `lobby.kickBanSec`); when the host leaves, the
longest-standing player is the host.

## Matchmaking

`mp/match.js` (pure) runs every `queue.cycleMs` over everyone waiting in a region's queue room
(`server/src/rt/queue.ts`). A race is built round the longest-waiting player:
1. **region and ping** first: the region's ping limit widens with the wait (`pingLimitsMs`, a step every
   `pingStepSec`);
2. then **skill** (the OpenSkill ordinal, within a window that widens with the wait: `skill`);
3. then **car class** (strictly: `classStrict`) and **performance rating** (within `performance`, widening too).

Parties are matched as one (all their members together). A race goes at once when its grid is full; otherwise once
its longest-waiting party has waited `npcFillSec` (15 s), with whoever fits then and NPCs in the empty places — nobody
is asked, and nobody waits longer (Phase 7 Step 5). The queue screen says so, with a **Race now** button (go at once,
NPCs in the empty places).

**Targets** (`queue.targets`): queue time p50 ≤ 10 s and p95 ≤ 20 s; a race's skill spread p95 ≤ 12 ordinal points
and performance spread p95 ≤ 120; one class in 95% of races (a small queue at the fill races together, whatever the cars). The queue reports its numbers to the API every 5 s; the admin
page's **Multiplayer** dashboard (`GET /api/v1/admin/mp/dashboard`) shows them against the targets.

On this computer (4 cores, 16 GB), 2,000 bots queuing at once against one process with no Redis
(`mp-load-test.ts --bots 2000 --workers 4`): all matched and seated; queue time p50 5.0 s, p95 31.2 s, longest
49.4 s; skill spread p95 9.1, performance spread p95 77, one class in every race; 264 races, 7.6 players a race
(242 full grids); the matchmaker's cycle p95 28 ms, at worst 52 ms, against its 500 ms interval.

## Skill rating

OpenSkill (Plackett–Luce), updated once a ranked race (a quick race) is confirmed. Players see a **tier**, never the
number: Bronze, Silver, Gold, Platinum, Diamond, Champion (three divisions each), from the ordinal mu − 3σ
(`mp/rank.js`). A player is Unranked until `rank.placementRaces` races. Leaving a ranked race early counts as last.

## Race flow

`mp/race.js` (pure: the tests drive it directly) is the race; the race room (`server/src/rt/race.ts`) feeds it.

1. **Loading.** Everyone loads the venue: a real-world route in its region (the route's course comes with the
   `load` message, laid out in that region's map frame — the frame the server tracks cars in), or a generated track
   built by the game, whose **hash** must match the server's (Phase 5): a player whose track differs watches instead.
   The race starts when everyone has loaded, or after `race.loadTimeoutSec`; anyone still loading starts from the
   back of the grid when they're in (`lateJoin: 'back'`) or watches.
2. **Grid**: by rating, random, or the last race reversed.
3. **Countdown**: the lights go out at `goAt`, a moment on the server's clock sent ahead (`race.countdownSec`), and
   every game's clock is synced to it (Step 1): five red lights over the last `race.lightsSec`, then out. The game
   releases its car on the physics step at `goAt`. A car more than `jumpStart.toleranceM` off its slot before then
   gets `jumpStart.penaltySec` (judged once it's been on its slot, or `settleSec` after the grid: the game needs a
   moment to put it there).
4. **Racing**: the server follows every car's progress with the route's own tracker (checkpoints in order, laps),
   times each line crossing between the two states either side of it, and sends **live positions** 4 times a second
   (finished by time, then by distance, then the out). Its live checks flag progress no car could make, or a
   checkpoint passed out of order, for the results' check. Each game times its own run with the same QuestSession as
   a quest (Phase 4: gates, laps, sub-tick timing, the reset and corridor rules: R puts you back at the last
   checkpoint) — on the server's clock.
5. **Finish**: once the winner finishes, the others have `race.finishWindowSec`; anyone still racing then is DNF.

## Disconnects

- A **short drop** reconnects by itself (Step 1); the car waits, marked as reconnecting.
- A **long drop**: after `race.dnfGraceSec` the player is out (DNF) and their car is taken off everyone's screen.
- **Leaving** a ranked race early counts as last place; more than `leaving.freeLeaves` in `leaving.windowHours` and
  the queue makes you wait (`leaving.cooldownMinutes`, longer each time).
- The **host** leaving passes the lobby on; **everyone but one** leaving: the last one finishes alone.

## Results

1. **Provisional** standings as soon as the race ends (the server's own times).
2. Each finisher's game hands in its run through the race room; the API checks it (Phase 6 Step 3: `quest/validate.js`
   on the race's quest — gates, laps, times — plus the run's time against the race server's, within 300 ms, and the
   server's live flags). A run that fails, or no run at all, is **disqualified**, and the standings close up.
3. **Confirmed**: pay by place (`data/economy.json` `multiplayer`, in the economy simulation too), xp, and — for a
   ranked race — rating and tier changes. Paid once, through the ledger (Phase 6).
4. The **podium**, then a **rematch** vote (more than half: back to the lobby together) or back to the menu.

## Spectating

Anyone can watch: a lobby you're in (**Watch instead**), a friend's race (**Watch** in the friends list), a listed
lobby (**Watch** in the browser), or by joining with a code once it's under way. Finished and DNF players can watch
too (**W**). While watching: **← →** another car, **C** the camera — chase, in the car, or **TV** cameras beside the
route (a generated track's own TV cameras, Phase 5).

## Friends, invites and parties

The hub room (`server/src/rt/hub.ts`) is where a player is while they're on the multiplayer screens: their friends
with online status and what they're doing (in a lobby, racing, watching, free roam), friend requests (add by name),
invites to a lobby, joining a friend, and **parties** (up to `queue.maxPartySize`): the leader's Quick race queues
everyone. Friends, blocks and reports are kept by the API; the hub passes them on (`POST /internal/mp/act`), so the
development players (`?player=A`) can use them too.

## Venues

`data/multiplayer.json` `venues.routes`: one official real-world route a baked region, published as world content by
`server/tools/seed-mp-routes.ts` (ids `route_mp<region>`; run it once on a database:
`DATABASE_URL=… node server/tools/seed-mp-routes.ts`). A quick race's venue per region is the real-time server's
`quickVenue` setting; "random" picks among the published routes and the official tracks.

## The game's side

- `mp/client.js` — the session: the hub, the queue, the lobby and race (the same for the screens and the bots).
- `play/mpScreens.js` — the screens: menu (**F7** or the **Multiplayer** button at the top), lobby, loading, lights,
  race HUD, results with podium and rematch, the watching bar. Each has an id (`#mpMenu`, `#mpLobby`, `#mpLoading`,
  `#mpLights`, `#mpHud`, `#mpResults`, `#mpWatch`).
- `play/mpRace.js` — the race as the game plays it: to the venue, the car on its slot, released at `goAt`, the run
  timed on the server's clock and handed in, the others' cars drawn (Step 1), and the spectator's cameras.

## The tests (Step 2)

| Test | What it covers |
|---|---|
| `tests/unit/mp.test.mjs` | The rules, pure: settings, ratings and tiers, matchmaking, the race (jump starts and the settling time, the finish window, DNFs, leaving, hashes, late loaders, impossible progress), results and pay, NPC drivers, a route's version not depending on key order. |
| `server/test/mp.test.ts` (Postgres) | The API: friends and blocks, ticket claims and development players, the internal key, a ranked race confirmed (a failed run moving the standings, pay and ratings), leaving cooldowns, the dashboard. |
| `server/tools/mp-race-test.ts` (Postgres; one real-time process, no Redis) | Bot races end to end (`reports/mp-races.md`): A — 8 bots matched onto a real-world route, ranked; the countdown within a few ms in every bot through a 60 ± 10 ms network; a drop on the final lap; a run that fails the check (disqualified, pay and ratings follow); rematch. B — 8 bots on today's generated track; one built it differently and watches. C — a party queues together; a lone player races NPCs after the fill (`npcFillSec`), nothing to accept. D — disconnects in the lobby, at the countdown, mid-race for good; the host leaving; everyone but one leaving. E — chat filter, block, mute, kick (and can't come back), report. F — a spectator. |
| `server/tools/rt-crash-test.ts` (Postgres; the real-time server a process of its own, no Redis) | The real-time server killed (SIGKILL) and started again (Phase 7 Step 5): A — mid-race: the players told, their hubs back by themselves, nothing of the race in the API (no pay, no cooldown, no money moved — a race has no entry fee), they queue and race again and are paid once. B — mid-free-roam: each zone joined again by itself (a fresh ticket, backing off), the two in the same instance again, their saved places as they were. |
| `server/tools/mp-load-test.ts` (Postgres) | 2,000 bots queue at once, in worker processes, against one real-time process with no Redis: all matched and seated, queue times and match quality within the targets, the matchmaker's cycle well inside its interval (`reports/mp-matchmaking-load.md`). |
| `server/tools/mp-browser-race.ts` (Postgres, Chromium) | The game in the browser, as people play it: two windows as Player A and B (`?mp&player=A`, `?mp&player=B`, driven by the autopilot once it's GO: `&mpauto`), bots filling the grid; one real-time process, no Redis. Every check is on what's **drawn**: each screen visible, in the window, not covered (the element at its middle is itself), its text against the server's own state, its pixels in a screenshot — and for what lasts a moment, the frames each window painted (Chrome's screencast for the lights; the text in each painted frame for the results' title). <ul><li>The lobby: private, joined by its code typed in; players with car and class, ready, rank, as the server has them; chat filter and mute; free roam still on under it.</li><li>Loading.</li><li>The lights: red painted in both windows, then out within a few ms of the server's `goAt` (aimed by the clock, put out within a frame of it), the green painted.</li><li>The race HUD: each window's own place and the standings in the server's order; the other cars in each window's 3D view, and in the picture.</li><li>The results: provisional (the race server's confirmation held back, as if the checks were slow, until both windows have painted it), then confirmed in the server's order with pay and rank; both runs pass the check; the podium.</li><li>A rematch, B watching it (Watch instead): the bar names the car the chase camera is on; switching car; the in-car and TV cameras.</li><li>A quick race matched from two clicks, to its lights (`--quick`: the setup and this part only).</li></ul> |

Last runs on this computer: the bot races 29 of 29, the browser races 29 of 29, the load test 5 of 5.

## Trying it on this computer

1. Start everything (`docker compose up --build`, or `npm run rt -w @kr/server` and `npm start -w @kr/server`), and
   publish the official routes once: `DATABASE_URL=… node server/tools/seed-mp-routes.ts`.
2. Open `http://localhost:8787/?mp&player=A` and `http://localhost:8787/?mp&player=B` in two windows side by side.
   On the welcome, pick **Just drive** (or sign in).
3. In A, open the menu (**F7**, or the **Multiplayer** button at the top) and click **Private lobby**. Its invite
   code is at the top right of the lobby.
4. In B, open the menu, type the code under Race and click **Join**. Both lobbies list both players.
5. As the host, A picks the venue (Real-world route → Market Street Sprint, say) and laps. Both click **Ready**; A
   clicks **Start the race**.
6. Both windows load the route, then show the lights. Drive off when they go out. Your place and the standings are
   top right. **R** puts you back at the last checkpoint.
7. After the finish: the results, provisional, then confirmed with your pay and rank. **Rematch** or **Back to the
   menu**.
8. **Quick race** in both windows (from the menu) matches A and B into one race by themselves. Waiting alone, you're
   offered NPCs after 40 s.


## Step 3: car-to-car contact

Players' cars touch, bump, lean on each other and crash, fairly with lag: how it works is in
[CONTACT.md](CONTACT.md). In short — each player simulates only their own car; the others are proxies in their
physics, predicted to the present when close; a contact pushes only your own car (capped: no launches, no wild
spins); both games report it; the race server agrees one result (the impulse each car gets, the damage, who caused
it) and both games blend to it. Lag, resets, the wrong way and the pit lane ghost a car automatically. Blame feeds a
safety rating (shown in the lobby, used by matchmaking), penalties and ramming reports. Each run's record carries its
pushes, checked against the race server's log and, on a generated track, driven again exactly.

The game's side: `play/mpRace.js` (the contact client and the run's record in a race; ghosts drawn see-through;
sparks, knocks, scrapes and damage), `play/mpScreens.js` (collisions in the lobby's settings — full, reduced, ghost;
each player's safety rating; the ramming report), `mp/contactOverlay.js` (F10) and `mp/contactReplay.js`
(Shift+F10; the admin page's Contacts tab).

### The tests (Step 3)

| Test | What it covers |
|---|---|
| `tests/unit/contact.test.mjs` | The rules, pure: boxes and contact points, a rear-end, 150 ms of lag, the caps, rubbing that settles, agreeing two reports (and the gentler, and a one-sided one checked against the server), blame (rear-end, brake test, swerve), ghosting, a race's incidents (penalty, repeat offender, ramming), the safety rating. |
| `tests/unit/runRecord.test.mjs` | A run's record on a generated track — inputs, a contact's pushes, a reset — driven again exactly (bit for bit); the record edited every way a cheat might (a push nobody agreed, a bigger one, against a car that wasn't there, a correction for nothing, a refused contact kept, pushes hidden), each caught. |
| `tests/unit/mp.test.mjs` | Matchmaking keeps safety ratings close. |
| `server/tools/mp-contact-test.ts` (Postgres; one real-time process, no Redis; physics bots) | `reports/mp-contact.md`. 1 — seven scenarios at 0, 80, 150 and 250 ms ping: a rear-end, a side-swipe, rubbing through a corner, door to door at speed, a T-bone, a spin into another car, a squeeze against the pit wall; each an agreed contact; both games drawing each car where it came to rest (within 0.5 m) and never far off through the knock; the same damage on both screens (the same events, the same dents and parts); sparks and sounds on both; nothing launched, spun wildly or through a wall; rubbing one steady contact. 2 — ghosting: 400 ms ping, a reset, the wrong way, the pit lane (each on and off at the right times; nobody touching the ghost). 3 — blame on scripted contacts with a known cause (rear-end, brake test, swerve), a time penalty, a repeat offender ghosted, ramming flagged with its replay and the one-tap report. 4 — honest runs pass; edited records fail; a contact claimed that never was is refused and the run fails; an unrecorded push fails the replay; a race to the finish with the API's verdicts (the honest one driven again in the API's worker) and safety ratings moving. 5 — 8 cars weaving into each other for 25 s at 80 ms: the frame and bandwidth targets. |

Last runs on this computer: the contact tests 248 of 249. The 8 cars made 69 agreed contacts in 25 s (29 hits,
40 rubbing); each game's physics took 1.3–1.4 ms a frame (95th percentile 2.1–2.3 ms, the target 4), uploads
1.3–1.6 kB/s and downloads 9.4 kB/s (targets 10 and 20). The honest 3-minute race was driven again in 10.9 s. The one
miss: the spin at 250 ms ping, drawn 5.2 m off for a moment just after the hit (the limit 3.0 m). It wasn't seen again
in 15 more runs of it (worst 2.1 m): [KNOWN_ISSUES.md](KNOWN_ISSUES.md). The Step 2 bot races, with quick races now
on reduced contact, 28 of 29 (the countdown's spread 8.7 ms against 8; that race twice more, 11 of 11 each, spreads
3.6 and 4.2 ms: the clock sync is unchanged by this step). Step 1's real-time test 13 of 13.

### Trying contact on this computer

As "Trying it on this computer" above, then in the lobby (as host) set **Collisions** to **Full contact** (quick
races are **Reduced** by default; **Ghost** is no contact). In the race, drive into each other. **F10** shows the
contact overlay (both windows: what each game predicts and pushes, the agreed result and the blame); **Shift+F10**
replays the last contact from both players' views. `?mp&player=A&netsim=75` (each window: 75 ms each way) tries it at
150 ms ping. The admin page's **Contacts** tab shows any race's contacts (its id is in the results) and replays them.
