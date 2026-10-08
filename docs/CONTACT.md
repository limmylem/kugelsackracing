# Car-to-car contact between players (Phase 7 Step 3)

How players' cars touch, bump and crash into each other fairly with network lag. The rule above all the others:
**fair and stable beats realistic**. A contact that feels a little soft is fine; a car launched by lag is not.

## The problem

Each player simulates only their own car (Step 1). Every other car arrives as states stamped on the server's clock
and is drawn about 100–200 ms in the past (the interpolation buffer). At 30 m/s that is 3–6 m behind where the car
really is. If contact used those positions, a car alongside you would be hit where it no longer is, and the two
players would disagree about the hit.

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
 my car: the difference between the agreed push and what I applied, blended in over ~0.2 s
```

1. **Proxies.** Every other car is a proxy in my physics world: a kinematic body the size of its body box, moved
   each step to where that car is predicted to be now. Rapier never lets a proxy push my car: car-to-car
   contact is ours, not the solver's. Proxies still knock debris and props about.
2. **Closer to the present when close.** Each remote car has a nearness: 0 beyond `farGapM`, 1 within `nearGapM`
   (the gap between the two cars' boxes), changing at most `rampPerSec`. The proxy is always the car's newest state
   extrapolated to the present (Step 1's prediction: velocity, a fading acceleration, the spin), for at most
   `maxPredictMs`. The drawn car blends from its usual interpolated pose to the proxy's pose as the nearness rises.
   So when two cars are close, each player draws the other where it hits.
3. **Contact is in the ground plane.** Two oriented boxes (the cars' footprints), overlapping only if their heights
   overlap too. The test gives the overlap's depth, a horizontal normal and the contact point. The same pure
   function (`mp/contact.js`) runs on the client, on the server (its own view of the cars) and in the verifier.
4. **Local response on my car only, capped.** It applies as an impulse at the centre of mass's height: no roll or
   pitch torque, nothing vertical.
   - **A hit** (closing faster than `rubBelow`): the two-body impulse J = (1 + e)·m_red·v_closing (m_red from both
     masses, e the restitution), spread over `impactSpreadSec`.
   - **Rubbing** (side by side, closing slowly): a soft spring and damper on the overlap with a little sliding
     friction. Light, steady contact, not repeated bouncing.
   - **Caps on every contact:** the change in speed (`maxDeltaV`), the yaw spin (`maxSpin`), the rubbing force
     (`maxRubG`). A contact's total push never exceeds them, however long it lasts or however far the boxes overlap.
5. **Reports.** When a contact begins, each player's game reports it after `reportAfterMs`: the room time, both cars'
   positions and velocities as it saw them, the normal, the point, the closing speed, the push it applied, and how
   far it predicted. These go over the reliable channel.
6. **One agreed result.** The server pairs the two reports of a contact (same pair, within `pairWindowMs`), waiting
   at most `waitMs` plus the players' pings for the second one.
   - **The closing speed:** both reports' mean when they agree (within `closingTol`); **the gentler one** when they
     don't (high lag, packet loss). A one-sided report is checked against the server's own view of the two cars at
     that moment. Too far apart, and it is rejected; otherwise the gentler of the two is used.
   - **The impulse:** J by the Phase 3 rules (`physics/carCollisions.js`: relative speed, direction, both masses),
     capped the same way.
   - **The damage:** each car's `impactStrength`, scaled by the collision mode.
   - **The blame** (below).

   Both players (and anyone near) get the same `contact` message.
7. **Corrections.** Each player's game applies agreed − already applied to its own car, spread over `blendSec`. A
   rejected contact is undone the same way. Small differences are never a jump: the other player sees your car move
   smoothly, through its interpolation, to the agreed outcome.

Damage between players is the agreed one. Each car's owner works it out from the agreed impact (Phase 3's
`crashOutcome`), and the result reaches everyone else through Step 1's damage events. Both players therefore draw
the same dents and lost parts. Sparks, scrapes and impact sounds come from the agreed message at its time and point,
so every client plays the same thing. The two players involved play their own straight away and skip the agreed
copy of that contact.

## Collision modes and automatic ghosting

The lobby sets **full**, **reduced** (quick races' default: the damage between players × `reducedDamage`) or
**ghost**. Even in full, the server ghosts a car (it touches nobody) while:
- its ping or jitter is above `maxPingMs` / `maxJitterMs`;
- it has just reset or rejoined (`resetSec`, `rejoinSec`);
- it is going the wrong way;
- it is in the pit lane;
- optionally: the first corner of lap 1, and cars being lapped.

A ghosted car is drawn see-through. It fades back to solid only when the server lifts the ghost **and** no car
overlaps it.

## Fair play

- **Blame**, for every agreed contact, from the server's own log of both cars: which car's front hit which part of
  the other, who closed in faster, braking much harder than the road needed, a swerve off the line towards the
  other, and who was ahead. The result is a share of fault for each car, and whether it was careless.
- **Safety rating** (0–100, shown as a letter and number in the lobby): careless contacts cost incident points by
  how hard they were times the fault share; a clean race earns some back. Matchmaking keeps safety ratings close,
  with its own window and weight, as it does skill.
- **Penalties in the race:** a clear cause of a crash adds `penaltySec` to that driver's time; `repeatIncidents`
  careless contacts in one race ghost the driver for the rest of it.
- **Ramming:** repeated at-fault hits on the same car within `rammingWithinSec` are flagged. The victim gets a
  one-tap report, with the server's replay of both cars attached.

## Verification

Each finisher's run carries every physics step's input (Phase 6 Step 3's 3 bytes a step) and every contact push
applied to the car. Each push is either:
- **local:** the proxy's recorded pose, from which the push is recomputed; or
- **a correction:** the push as applied.

The verifier drives the run again from its inputs, recomputing each local push from the recorded proxy pose with the
same contact function, and applying each correction. For each contact it then checks three things:
1. The pushes add up to the server's agreed impulse.
2. Every proxy pose recorded is close to where the server had that car.
3. The replayed run arrives where and when the result says.

A client that claims it was pushed forward fails all three: the server never agreed that contact, the other car
was not there, and the replay doesn't arrive in time. Generated tracks are replayed in full. Real-world routes are
not yet deterministic (their collision streams in), so there only checks 1 and 2 run.

## Debug tools

- **The contact overlay (F10):**
  - each proxy's box and how far ahead it is predicted;
  - the contact points;
  - the push applied against the agreed one;
  - the blame.
- **The contact replay:** any contact from both players' perspectives side by side, from the tracks each report
  carries (their own car and the proxy around the moment).

## Settings

`data/multiplayer.json` `contact`: nearness and prediction, response, limits, agreement, ghosting, blame, safety
rating, penalties and ramming. Each section has a `_note` saying what its numbers mean.
