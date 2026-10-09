// Multiplayer's settings and targets (Phase 7 Step 1; docs/MULTIPLAYER.md), shared by the game, the real-time
// server, the bots and the tests. The server's per-environment limits (guests, players a process, the network
// simulator) are in server/config/<env>.json "rt".

export const NET = {
  // ---- what a client sends ----
  sendHz: 30,                  // car states a second (configurable: the server tells each client on joining)
  detailEvery: 2,              // wheels and engine in every 2nd state (15 a second): the receiver interpolates them
  keyframeSec: 1,              // a full state (every field) at least this often, whatever changed
  pingSec: 1,                  // time sync: one ping a second, after a burst of 8 on joining
  // ---- the server ----
  tickHz: 30,                  // the room's tick: states gathered, checked, sent on to whoever's near
  // interest management (docs/MULTIPLAYER.md): who gets whose car, and how often, by distance (m). Beyond the last
  // ring: not sent at all. `every`: one tick in so many
  interest: { cell: 250, rings: [{ within: 250, every: 1 }, { within: 700, every: 3 }, { within: 1500, every: 10 }] },
  // ---- showing other cars ----
  interp: {
    // the buffer: how far behind the usual delay the cars are shown, so that 95% of states are in before they're needed
    minBufferMs: 60, maxBufferMs: 1000, startBufferMs: 100,
    maxExtrapolateMs: 500,       // predicting ahead when states are late, then the car eases to a stop
    blendMs: 200,                // a correction (a late state replacing a prediction) takes at least this long
    snapCm: 10,                  // a frame-to-frame jump beyond its motion bigger than this counts as a visible snap (tests)
  },
  // ---- the live checks on what a client sends (the race's result is checked afterwards by its replay) ----
  // (strikes in strikeWindowSec: the player flagged for the admins — Phase 7 Step 5: never removed)
  checks: { maxSpeed: 110, slackM: 6, maxRatePerSec: 70, futureMs: 150, pastMs: 2500, strikes: 30, strikeWindowSec: 10, resetEverySec: 1.5, worldLimitM: 500000 },
  // ---- reconnecting ----
  reconnectSec: 20,            // a dropped player's car waits this long for them (paused for everyone else)
  idleSec: 15,                 // nothing from a client for this long: the connection is dead, closed
  // (Phase 7 Step 5) the hub — friends, invites, parties — joined again by itself after the server restarted: the first
  // try after firstMs, then twice as long each time up to maxMs (mp/client.js)
  rejoin: { firstMs: 1000, maxMs: 30000 },
  // ---- targets (the tests measure against these; docs/MULTIPLAYER.md) ----
  targets: {
    upKBs: 10,                 // a player's upload, kB a second (WebSocket frames included)
    downPerCarKBs: 2.5,        // download per nearby car at the full rate
    downKBs: { 8: 20, 30: 48 },   // whole download with this many cars nearby (the far ones at their lower rates)
    smooth: { latencyMs: 150, jitterMs: 30, loss: 0.05 },      // remote cars smooth at these (no visible snap)
    timeSyncMs: 5,             // every client's server clock within this of the server's (on a steady link)
    tickMs: 4,                 // a room's tick, p95, with 32 players
    playersPerProcess: 256,    // players one room process carries within the tick target
  },
};
