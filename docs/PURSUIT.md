# Police pursuits

Quests where the police are after you: get away, or get somewhere with them behind you. Solo (`pursuit`) and,
for a party, co-op (`pursuit_coop`). They're built on the systems the game already has: a pursuit is a quest
(its card, fee, results, medals and pay), its police are real cars in the same physics as yours, and co-op runs
through the party and the race server.

## How a pursuit plays

1. **The intro.** The police car is parked by the road, a few metres behind you. It pulls out with its lights
   and siren; the camera swings round to your car (your real car, with its parts and its damage) as it pulls
   away; then it settles into the chase camera and **GO** — the car is yours, already moving, the police
   about 45 m behind. Space skips it: you're put where it would have left you, at speed, and it's GO at once.
2. **The chase.** The heat (1–5, on the HUD) rises while they can see you: with time, with every hit on a
   police car, and while you're going over 140 km/h. More heat brings more police cars, better cars, and
   more tactics (below).
3. **Losing them.** When no police car has seen you for 1.5 s, the cooldown starts and the search area (an
   orange circle round where you were last seen) shows on the minimap. Get out of it before the time runs
   out and you've escaped. If they see you again, the cooldown starts over. If the time runs out with you
   still inside, they've closed in and the chase is on again (a mission can say you got away instead).
4. **Busted.** Below 12 km/h with a police car on you (in sight and within 14 m, or touching) for 3.5 s — the
   BUSTED bar fills; it drains when you get going — or your car disabled by damage. A bust (or a quit, or a
   wreck) costs the bust fine, taken by the server.
5. **Done.** An escape mission is over when you escape. A destination mission is over when you reach the
   drop (the route's finish), with or without losing them first (the mission says).

The score (the medals are scores) counts every second they're after you × the heat level, an escape × the
level, the drop, and every police car you put out of action. The server checks it can't be more than that.

## What the police do

Each police car (a *unit*) is a car from the parts system, built for your car's rating × the heat level's
(`data/pursuit.json` levels: about 0.92 at heat 1 to 1.14 at heat 5), in the police livery with a light bar.
It drives with the same physics and takes the same damage as any car. Its only "rubber band" is a small
change (at most ±6 %) to the speed it aims for, by how far behind it is.

| Mode | What it's doing |
|---|---|
| patrol | nothing known yet |
| alerted | driving by road to where you were reported (a unit that can see you radios it in) |
| pursue | on you, in sight: off the road and straight at you when the way is clear, cutting corners |
| intercept | (heat 2+) to a point ahead of you by another road |
| ram | (heat 2+) close behind: through you |
| pit | (heat 3+) lined up on a rear corner at speed, then turning in |
| box | (heat 3+) you slow, three units in sight: ahead, left and right of you, slowing down |
| block | a roadblock's car, parked across a junction ahead (heat 4+) until you're close |
| search | the cooldown: driving to places in the search area |
| leave | you got away: they drive off and go |

Roadblocks (heat 4+): two cars across the road at the next junction 220–420 m ahead. Spike strips (heat 5):
across the road 120–220 m ahead; a tyre that runs over one is punctured (with full damage on). New units
come in on a road 160–320 m behind you, out of your sight where they can. Units that are hopelessly stuck, or
far away and unseen, are taken away and replaced.

**Sight** is a ray from a unit's eye (1.3 m up) to yours, blocked only by the ground and buildings — not
fences, barriers or trees, which they see over or past. Each pair is looked at every 0.2 s (in range: 220 m).

**Driving.** On the roads a unit follows a path on the road network (obeying one-way streets), replanned
about once a second, setting off along the road it faces. Near you with a clear way (nothing solid at bumper
height) it leaves the road. Three feeler rays ahead steer it round anything solid the road data runs through
(construction fences), and a stuck unit backs off and tries again.

## The debug overlay

**F4** during a pursuit (or `?pursuitDebug` in the address) shows: the heat, its level and the phase; the
cooldown's time left, the search area's radius and how far you are from its centre; the bust meter; every
unit's mode, how it's driving (road, direct, backing off, parked), whether it can see you, its distance, its
speed and the speed it wants, and its condition. In the world: each unit's sight line to you (green: sees you,
red: blocked, grey: out of range), where it's aiming (yellow), its path on the roads, the search area (orange
ring) and spike strips (white posts).

## Making one (the editor)

A quest of type **Police pursuit** on a route: the route's start is where it starts (the cinematic plays from
there), its finish is the drop. Its settings (all optional but the route):

| Setting | |
|---|---|
| Objective | escape, or destination (the route's finish) |
| Starting heat / Most heat | 1–5 |
| Police cars at once / in all | caps on the heat's numbers |
| Roadblocks / Spike strips | allowed or not |
| Cooldown ends inside the search area | reacquire (default) or escape |
| Lose them before the drop | a destination mission: the drop counts only once they've lost you |
| Time limit | optional |
| Bust fine | money; blank: the entry fee (at least $150) |
| Gold score | the medals' scores (silver and bronze: data/quests.json medals.score) |
| (params.intro: false) | no intro cinematic: a rolling start |

All the police tuning is in `data/pursuit.json` (heat rates, the five levels, sight, spawning, driving, busts,
the cooldown, roadblocks, spikes, co-op targeting); the score, the drop's radius and the fine in
`data/quests.json` `pursuit` (the server checks results by them); the rewards' weight in `data/economy.json`
`quests.byType`. The intro's shots are data: `data/cinematics.json` (below).

## The intro cinematic

`data/cinematics.json`: each cinematic's length; the player's throttle over time (the AI drives your car along
the route); when the police pull out, how far beside the road they're parked, the gap at the start and at the
handover; where everyone is put if it's skipped; and its shots. A shot is a stretch of time, an easing, a
subject (whose car the camera moves with: `player`, `police`, `player:N` in co-op), control points
`[right, up, forward]` from that car (a smooth Catmull-Rom curve through them), where it looks, and its field
of view from–to. A point can be `"chase"`: the game's own chase camera at that moment — the last shot ends on
it, so the handover has no cut.

At GO nothing about the car changes: it was driving in the same physics all along (its speed, wheel spin, revs,
gear and clutch simply carry on); the AI's input is eased into yours over half a second, and input counts only
from GO. Skipped, the car is put down moving (wheels turning at road speed, the gear for that speed: the
physics' own `reset` with a speed).

## Co-op (a party)

A **Co-op pursuit** quest is for a party (up to 4). The party's leader opens its card and presses Start: the hub
makes a race room of the `pursuit` kind for the quest and takes everyone in the party there (they load the route,
as for a race). The countdown is the race room's, on the server's clock.

**The missions:**

| Mission | How it goes |
|---|---|
| Convoy | get away together (or all to the drop). It fails only when every one of you is busted at once. |
| Getaway | one of you (the leader, to start with) carries the goods, and the police go for the carrier first. Busted, the carrier drops the goods where they were; anyone free who drives within 6 m picks them up. Done when the goods reach the drop (or, with no drop, when you've escaped with them). |
| Split up | each of you has your own drop (the quest's drops, in party order); the police split their units between you. Done when everyone still free is at their drop. |

A busted player **respawns** after the mission's delay (on a road a few hundred metres off, as far from the police
as there is) or **spectates** the others, as the mission says. The heat is shared. Each police car chooses whom to
chase by a score: who's nearest, who it can see, who's most damaged, who's carrying the goods, less the share of
units already on that player (so they spread out), plus a little for the one it's already after
(`data/pursuit.json` targeting; a mission can set its own weights — split-up spreads them harder).

**Rewards** are paid by the API only, after its own check: each player their share of the quest's reward for the
medal their score earns — shared (everyone the whole) or split (by each one's part of the chase), as the quest says.
The score is held to what the run's length and heat could have made, and a run is paid once (the ledger's key).
Co-op pursuits have no entry fee and no bust fine.

**Who decides what — and why.** The race server runs the pursuit (`server/src/rt/pursuit.ts`): the director (heat,
sight, the units' orders, busts, the escape) and the mission (`pursuit/coop.js`), from the players' cars as the
room relays them and from what their games report. It decides the end and asks the API to pay. But the server has
no world — no roads, buildings or ground to drive a car on — and the police must drive with the same physics and
take the same damage as the players. So one player's game, the **host** (the leader; if they leave, the next player
in the room, who takes the police over where they were), drives the police cars in its own physics, as the room
orders, and sends their states back; the room sends them to everyone as cars (as it does its NPCs), so every game
draws them, light bars and sirens included. Each game says which police cars can see its own car (its own rays
against its own ground and buildings). The host only drives: it can't make anyone busted, change the heat or pay
anyone, and the room ignores police states that move impossibly fast.

**The intro (co-op).** It plays during the countdown, from 6 s before GO to GO on the server's clock, so it's the same
moment in every game: each player's own car driven by its game's AI along its lane from its grid slot, the camera
going round the police car, then each teammate's car, then yours, settling on your chase camera; the host's police
car pulls out behind; at GO every car is handed over at once, moving. Space cuts the camera to yours (the AI
still drives to GO, so the party stays in step).

The room's messages are listed at the top of `server/src/rt/pursuit.ts`. Its test: `node server/tools/pursuit-test.ts`
(the API, the race server and a party of bots, with a stand-in for the host's game; needs `TEST_DATABASE_URL`).

## How to test it

**Solo.** Make a route in the editor (a few hundred metres of city or more), then a quest of type *Police pursuit*
on it (objective *escape*, starting heat 1, most heat 3), and publish both. Drive to its start and press Start on its
card. Watch the intro (or press Space), then:
- *Escape:* get out of the police car's sight (round a corner, behind buildings); the cooldown and the orange
  search circle on the minimap appear; drive out of the circle before the time runs out → *Escaped*, paid.
- *Busted:* stop with the police car on you; the BUSTED bar fills in 3.5 s → *Busted*, the fine taken.
- *Heat:* starting heat 4–5 shows more units, intercepts, rams, PITs, box-ins, a roadblock and spike strips.
- **F4** shows the debug overlay (also `?pursuitDebug` in the address).

**Co-op.** Two players (two windows: `?mp&player=A` and `?mp&player=B` in development): A makes a party (F7 →
Party), B joins; publish a *Co-op pursuit* quest; A drives to it and presses Start on its card. Both are taken into
its room; the intro plays in both through the countdown; at GO both drive. A's game drives the police; B sees them.

**Automated:** `node --test tests/unit/pursuit.test.mjs` (the director, police aiming, the session, the server's check,
the fine, the cinematic maths, co-op missions); `node server/tools/pursuit-test.ts` (a party of bots through the API
and the race server: chased, lost, escaped, paid once; the host leaving); `node server/tools/pursuit-browser.ts
--local-libs` (two game windows: the party, the synced intro, the host's police, both sides' views, the end). The
server tools need `TEST_DATABASE_URL` (PostgreSQL with PostGIS).

## Files

| File | |
|---|---|
| `pursuit/director.js` | the director, pure: heat, sight, cooldown, escape, busts, units' modes and targets, spawn/roadblock/spike requests |
| `pursuit/police.js` | a unit's driver: modes → the car's input (paths, direct, PIT, box, follow, feelers, backing off) |
| `pursuit/paths.js` | road paths and places along the road (route/network.js) |
| `pursuit/coop.js` | the co-op mission, pure: convoy, getaway, split up; respawns; reward shares |
| `server/src/rt/pursuit.ts` | the co-op room: the director and mission run on the server; the host's police relayed; the end, paid by the API |
| `server/src/mp/service.ts` | `pursuitMission` (the quest and its route for a room), `recordPursuit` (checked and paid, once) |
| `play/mpRace.js`, `play/pursuitHud.js` | co-op in each game: the room's word to the session, respawns, the host's hand-over, the intro, the panel |
| `quest/types/pursuit.js`, `pursuitCoop.js` | the quest types: when it's over, the score, the HUD panel |
| `play/pursuitPlay.js` | the police in the world: cars, damage, sight rays, spikes, roadblocks, light bars, sirens, debug overlay |
| `play/cinematic.js` | the intro's camera (pure) |
| `audio/siren.js` | the siren (Web Audio: Doppler, distance, panning) |
| `data/pursuit.json`, `data/cinematics.json` | tuning and shots |
| `tests/unit/pursuit.test.mjs` | the tests |
