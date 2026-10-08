# Car-to-car contact between players (Phase 7 Step 3)

How players' cars touch, bump and crash into each other fairly with network lag. The rule above all the others:
**fair and stable beats realistic**. A contact that feels a little soft is fine; a car launched by lag is not.

## The problem

Each player simulates only their own car (Step 1). Every other car arrives as states stamped on the race's clock and
is drawn about 100–200 ms in the past (the interpolation buffer). A state is a round trip old when it arrives (the
other player to the server, the server to you) plus a tick or two: at 250 ms ping, about 350 ms. At 30 m/s that is
10 m behind where the car really is. If contact used those positions, a car alongside you would be hit where it no
longer is, and the two players would disagree about the hit.

## The model

```
 my physics world                          the race server                     the other player's world
 ─────────────────                         ───────────────                     ────────────────────────
 my car (simulated)                                                            their car (simulated)
 their car = a PROXY at the                                                    my car = a PROXY at the
   predicted present ──contact──► local, capped push on MY car only           predicted present
                       report ─────────►  pairs both reports  ◄───────── report
                                          agreed impulse + damage + blame
                       ◄──────────────── one agreed result ─────────────────►
 my car: the agreed hit in place of my own, the difference blended in over 0.2 s
```

1. **Proxies.** Every other car is a proxy in my physics world: a kinematic body the size of its body box, moved
   each step to where that car is predicted to be now. It is in a collision group of its own that touches nothing:
   Rapier never lets a proxy push my car (or debris). Car-to-car contact is ours, not the solver's.
2. **Closer to the present when close.** Each remote car has a nearness: 0 beyond `farGapM`, 1 within `nearGapM`
   (the gap between the two cars' boxes), changing at most `rampPerSec`. The proxy is the car's newest state
   extrapolated to the present (Step 1's prediction: velocity, a fading acceleration, the spin), for at most
   `maxPredictMs` — 400 ms, enough for a state a 300 ms round trip old. The drawn car blends from its usual
   interpolated pose to the proxy's pose as the nearness rises. So when two cars are close, each player draws the
   other where it can be hit.
   - **The race's clock, every frame.** The physics' time is turned into the race's clock with the clock this car's
     states are stamped with, read again each frame. That clock settles in the seconds after joining; a contact timed
     on an offset taken once, at the grid, was reported ~140 ms early at 250 ms ping and refused (found by the tests).
   - **A knock is shown before its states arrive.** Right after a hit, this game predicts the other car's reaction to
     its own push (equal and opposite, by its mass) and draws it moved by that — and treats it so for the contact —
     until the other car's own states show the knock, handed over smoothly over `reactSec`. The extrapolation treats
     a change faster than any car makes by itself (over 4 g) as a knock: the new speed carries on, it isn't taken as
     an acceleration that keeps going.
3. **Contact is in the ground plane.** Two oriented boxes (the cars' footprints), overlapping only if their heights
   overlap too. The test gives the overlap's depth, a horizontal normal and the contact point. The same pure
   functions (`mp/contact.js`) run on the client, on the server (its own view of the cars) and in the verifier.
4. **Local response on my car only, capped.** It applies as an impulse at the centre of mass's height: no roll or
   pitch torque, nothing vertical.
   - **A hit** (closing faster than `rubBelow`): the two-body impulse J = (1 + e)·m_red·v_closing (m_red from both
     masses, e the restitution), spread over `impactSpreadSec`; and while the other car still closes hard (its
     reaction not yet in its states), an inelastic push from the same budget.
   - **Rubbing** (side by side, closing slowly): a soft spring and a damper (both ways, so they settle) on the
     overlap, with a little sliding friction. One contact for as long as it lasts: cars that part for a moment and
     lean in again within `forgetSec` carry on the same one (one report, one set of sparks), so it feels like light,
     steady contact, not repeated bouncing. Rubbing that turns into a real knock becomes a hit of its own.
   - **Caps on every contact:** the change in speed (`maxDeltaV`); the yaw spin (`maxSpin`), both per contact and as
     a ceiling — a contact never spins a car already turning past `maxSpin`; the rubbing force (`maxRubG`).
5. **Reports.** When a contact begins, each player's game reports it after `reportAfterMs`: the room time, both cars'
   positions and velocities as it saw them (in the world's frame), the normal, the point, the closing speed (the
   highest in the last `closingLookSec`: whichever game notices second may already see the reaction), the push it
   applied, how far it predicted, and its view of the last 1.5 s (for the replay).
6. **One agreed result.** The server pairs the two reports of a contact (the same pair, within `pairWindowMs`
   widened by the two players' lag), waiting at most `waitMs` plus their pings for the second one.
   - **The closing speed:** both reports' mean when they agree (within `closingTol`); **the gentler one** when they
     don't (high lag, packet loss). A one-sided report is checked against the server's own view of the two cars at
     that moment: too far apart (`serverCheckM`) and it is refused; otherwise the gentler of the two is used.
   - **The impulse:** for a hit, J by the Phase 3 rules (relative speed, direction, both masses), capped the same
     way. For rubbing, none: each game's own light push stands, checked step by step by the verifier.
   - **The damage:** each car's impact strength, scaled by the collision mode, at the contact point in that car's own
     frame as it was then (so it doesn't matter when the result arrives).
   - **The blame** (below).

   Everyone in the race gets the same `contact` message.
7. **Corrections.** Each player's game replaces its own hit with the agreed one: agreed − its own hit pushes so far,
   spread over `blendSec`. From then on that contact's hit is settled (only the light rubbing push, if they stay
   touching). A refused contact is undone the same way, and nothing more is pushed for it. Small differences are
   never a jump: the other player sees your car move smoothly, through its interpolation, to the agreed outcome.

Damage between players is the agreed one. Each car's owner works it out from the agreed impact (Phase 3's
`crashOutcome`) and sends it on as Step 1's damage events — dents, glass and lights, parts loose or off — so both
players draw the same damage on both cars. Sparks and the knock's sound: the two players involved play their own at
once, everyone else plays the agreed one at its point; rubbing makes the game's own scrape (the sound and the sparks
of the physics' scrapes) for as long as it lasts.

## Collision modes and automatic ghosting

The lobby sets **full**, **reduced** (quick races' default: the damage between players × `damage.reduced`) or
**ghost**. Even in full, the server ghosts a car (it touches nobody) while:
- its ping (the round trip) or jitter is above `maxPingMs` / `maxJitterMs` (300 / 70 ms), or its states come more
  than `maxStateGapMs` apart (a game drawing a few frames a second: its car can't be placed well enough to touch);
- it has just reset or rejoined (`resetSec`, `rejoinSec`);
- it is going the wrong way (`wrongWaySec` of it, until `rightWaySec` back the right way);
- it is in the pit lane;
- optionally: the first corner of lap 1, and cars being lapped;
- it has caused `repeatIncidents` careless contacts this race.

A ghosted car is drawn see-through (`opacity`), yours too. It fades back to solid only when the server lifts the
ghost **and** no car overlaps it.

## Fair play

- **Blame**, for every agreed contact, from the server's own log of both cars: which car's front hit which part of
  the other, who closed in faster, braking much harder than needed (the hardest quarter second in the last
  `lookSec`: a brake test), a swerve off the line towards the other, and who was ahead. A brake test or a swerve
  moves a share of the fault onto that car. The result is a share of fault for each car, and whether it was careless.
- **Safety rating** (0–100, shown as a letter and number in the lobby): careless contacts cost incident points by
  how hard they were times the fault share; a clean race with contact on earns some back. Matchmaking keeps safety
  ratings close, with its own window and weight, as it does skill.
- **Penalties in the race:** a clear cause of a crash (`crashShare`, `crashStrength`) adds `seconds` to that
  driver's time; `repeatIncidents` careless contacts in one race ghost the driver for the rest of it.
- **Ramming:** `hits` at-fault hits on the same car within `withinSec` are flagged. The victim gets a one-tap report,
  with the server's record of both cars (the last `replaySec`) attached; the admins watch it from the report.

## Verification

Each finisher's run carries its record (`mp/runRecord.js`): the car put exactly where it stood at the lights (so the
replay starts the same way), then every physics step's input (5 bytes), every push on the car — the game's own
(`L`: a hit's marked `h`, the rest rubbing; with the proxy's pose it was against) and the agreed corrections (`F`) —
which contact each was tied to (`M`), and every change to the car between steps (damage, driving aids, a part off,
a reset), and where the car was every second. The API checks it against the race server's log (`mp/verify.js`):
1. Each agreed contact's hit pushes and its correction add up to the impulse the server agreed for this car.
2. Each rubbing push is within the rubbing cap for the car's mass, and away from the other car.
3. Every proxy pose pushed against is where the server had that car (its states round the contact, its trail after).
4. A refused contact is undone; there are no pushes the server never heard of.
5. The run's car was where the server saw it (except across a reset).
6. On a generated track, the run is driven again from its inputs and pushes (in a worker, with the same
   deterministic maths as the game — docs/DETERMINISM.md) and must arrive exactly where it says, every second.

A client that claims it was pushed forward fails: the server never agreed that contact (or refused it), the other car
wasn't there, and a push it hid from the record makes the replay miss. Real-world routes aren't replayed yet (their
collision streams in); checks 1–5 still run there.

## Debug tools

- **The contact overlay (F10 in a race):** a map of the cars round yours as the contact sees them — each proxy's box
  (solid or a ghost), how far ahead it's predicted, a knock's predicted push, where contacts began — then each car's
  nearness and ghosting (and why), and the latest contacts: what your game pushed against what was agreed, the
  kind, closing speed, whether the gentler report was used, and who was blamed. What the contact costs a step and a
  frame.
- **The contact replay (Shift+F10, the last contact; the admin page's Contacts tab, any contact of a race; a ramming
  report's evidence):** both players' views side by side — each game's own car and its proxy of the other over the
  second and a half before it reported, the race server's record of both under it — with the contact point, each
  report's prediction and push, the agreed impulses and the blame (`mp/contactReplay.js`).

## Settings

`data/multiplayer.json` `contact`: nearness and prediction, response, limits, agreement, damage, ghosting, blame,
safety rating, matchmaking, penalties, ramming and verification. Each section has a `_note` saying what its numbers
mean.

## Tests

`server/tools/mp-contact-test.ts` (the API and real-time server in one process; physics bots — each a real simulated
car with the game's contact client, through a simulated network): `reports/mp-contact.md` has the latest numbers.
See docs/MULTIPLAYER.md "Step 3".
