# The server-owned economy (Phase 6 Step 2)

With a server and someone signed in, the server is the only copy of a player's money, cars, parts, builds,
damage, XP, level, quest progress and medals. The game asks it to do things; the server decides, using the
game's own rules and prices from its own settings, and answers with the player's new state. Nothing the
browser sends can say what something costs, what a player owns or how much they earn.

The shop, the dealership, selling, refunds, kits, sales, level locks, the used car lot and garage space (Phase 6
Step 4) are in [SHOP.md](SHOP.md).

Without a server (the old `npm start`), the game works as it always did: `LocalPlayerService`, kept in the
browser. Signed out on a page with a server, it's the starter car and nothing is kept.

- **Code:** `server/src/economy` (`service.ts` the actions and sessions, `store.ts` the tables, `config.ts`
  the settings), `server/src/routes/player.ts` and `adminEconomy.ts`; the client is
  `garage/player/remote.js`, chosen in `garage/session.js`.
- **The rules are the game's:** each action runs `LocalPlayerService` (`garage/player/service.js`) on the
  server, on the player's profile read from the tables, and what it would have saved is written back.
  The local game and the server can't disagree about a price, a fit or a reward, and
  `server/test/economy-flow.test.ts` checks a full garage session step by step against the local one.

## The tables

| Table | What |
|---|---|
| `player_economy` | One row a player: balance, XP, level, the current car, `rev` (moves on with every change), the rest of the profile (setups, hints, favourites…) in `state`. |
| `ledger` | Every money change: amount, balance after, kind (`start`, `purchase`, `sale`, `repair`, `entry_fee`, `refund`, `reward`, `grant`, `removal`, `reversal`, `adjustment`, `other`), reason in words, what it was about (`ref`: parts, car, quest), the session, the request's Idempotency-Key, the admin who did it, and what it reverses. |
| `owned_cars`, `owned_parts` | Each car and part a player owns, by its own instance id (unique across every player): price paid, condition, damage (the compact events format), tuning, paint; `extra`: when it was bought and whether it's been fitted (refunds), a car's body price, a used car's listing and history. |
| `car_build_slots` | Which part is in which socket of which car. |
| `item_history` | Each car's and part's story: bought, fitted, taken off, damaged, repaired, sold, given, taken away (with the ledger row, if money moved). |
| `quest_progress` | Medals, best runs and attempts, per quest. |
| `economy_sessions` | Quest runs, track events and drives: their car, fee, state, how they ended, their damage reports, whether they've been paid. |
| `economy_config` | Every version of the economy's settings, who made it, why, and which is active. |
| `player_recordings` | The best runs' recordings (gzipped), as the local game keeps them apart from the save. |

### What the database itself refuses

Migration `0006_economy_rules.sql` (and `0007`, `0008`) makes these rules the database's, so not even a bug
in the server can break them:
- **The ledger is append-only.** Rows can't be changed or deleted. The only exceptions are deleting an
  account (its rows go with it) and a guest making an account (the rows move to the new account, unchanged).
- **The balance is the ledger's.** Each row's `balance_after` must be the previous one plus its amount, and
  inserting the row sets the balance. Nothing else can change the balance.
- **Never below zero.** Neither the balance nor any row's `balance_after`.
- **Once only:** one reward a session, one entry fee a session, one reversal a transaction.
- **A part in one place:** a part instance in at most one socket of one car, and only on a car its owner
  owns. Instance ids are unique across every player.

`economy.ledgerCheck()` compares every balance with its ledger's sum; the admin dashboard shows the result.

## An action

`POST /api/v1/player/actions/:action` with `{ args }`:
- **The actions** are the game's own: buy, sell (one or several), refund, a kit, sell a car, a used car, garage
  space (SHOP.md), fit, take off, buy and fit, a whole build, tuning, paint,
  setups, select a car, buy a car; repairs (a part, several, the body, the car — quick or full, every
  problem or chosen ones), the free basic repair, a spare fitted in place of a broken part; quests (start,
  refund, finish, fail), pink slips (win a car, lose one); damage and wear while driving; hints and
  favourites. The development commands (add money, give parts, unlimited money, import a save, reset)
  aren't actions at all.
- **Arguments** are checked by a strict schema per action (`PLAYER_ACTION_ARGS` in `packages/shared`): an
  extra field (a price, a cost, an amount) is refused before anything runs.
- **One transaction each**, holding the player's lock (`pg_advisory_xact_lock`), so a player's actions
  happen one at a time however many arrive at once. Everything the action reads besides the player's own
  rows (the settings, a quest, a course) is read before the transaction opens.
- **Checked by the game's rules:** owned, fits, affordable, priced from the active settings.
- **The answer:** `{ ok, updatedState, rev, ... }` as the local service's (the bought ids, the fee, the
  reward). A refusal is `409 REFUSED` with the reason in words and `details.updatedState`, so the game can
  put back what it showed.
- **Each write needs an Idempotency-Key** (as every write on the server): sent again, it's done once and
  the same answer comes back.

Reads: `GET /player` (the profile and `rev`), `GET /player/config` (the active settings, read-only, with
an ETag), `GET /player/ledger`, `GET /player/recordings/:id`, and `GET /player/events` (server-sent events:
a change from another tab or device).

### Speed

Each action brings the player's save in with the game's rules (migrating it, checking every car's build
and stats), which is most of its work. The server keeps the last save it checked for each player and uses
it again while the save hasn't changed: the same `rev` and the same settings version, and only after its
transaction committed. The tests run with `KR_VERIFY_ECONOMY_CACHE=1`, which checks every use against
bringing the save in afresh.

## Sessions: quests, track events and drives

- **A quest or track event starts a session** (`startQuest`): the server finds the quest itself (published
  content, or today's track event), checks the player may enter (level, the car's class and power from its
  build, worked out on the server), charges the fee and gives back a session id.
- **How it ends** is recorded: finished, quit, wrecked (`failQuest` with its status), refunded, or expired.
  - **A refund** only within 2 minutes of the start and with no damage reported: the game couldn't start it.
  - **Expired:** a run with no word from the game (no heartbeat, report or result) for 10 minutes. The
    server checks every minute; it ends as a disconnect, the fee spent and nothing paid.
- **Finishing** hands in the result with its checkpoints, laps and recording. The server checks it with the
  game's own rules (`quest/validate.js`) against the course it builds itself, and pays what the rules give.
  A session pays once, however many times its result arrives.
- **Pink slips:** the prize is the quest's rival car, stock, and only for a finished run the server
  believes with first place, once.
- **Drives** (free roam and test drives, `POST /player/drives`) are sessions too, so crash damage always
  belongs to one. A heartbeat (`POST /player/sessions/:id/heartbeat`) every minute keeps a session open.

## Damage

The game reports damage during a session (`damageCar`, `wearPart`). The server keeps it per part, in the
compact events format, and:
- takes it only for an active session of this player, and only for parts on that session's car;
- **never mends anything:** a part's condition only goes down, mechanical damage keeps the worse of what it
  had and what's reported, and a report can add dents but never replace them;
- refuses a report with more than 64 parts or 32 hits a part, and a session with more than 20,000 reports;
- chooses itself what a session's reset puts back (a race's or a test's reset, by the session's kind).

Repairs are priced on the server from the damage it keeps (`repairCost`, the settings' repair rules).

## The economy's settings

The settings are `data/economy.json` and `data/quests.json` as one versioned document on the server
(`economy_config`). The first version is the repository's files. The server charges and pays by the active
version, and the game gets a read-only copy (`GET /player/config`) for showing prices.

On the admin page, **Economy settings**:
- shows the active version as JSON;
- saves a change as a new version, with who made it and why. It's checked against the economy's schema
  first, and refused if someone else changed the settings since you loaded them;
- lists every version, and rolls back to any of them (a new version with that one's values).

No value was changed in Step 2: the active settings are the repository's files. Settings the game gains later (Step 4's
`shop`, `sell.repairShare`) are added to the active version when the server starts, as a new version that changes
nothing already there. The shop's own changes are made on the admin page's Shop view (SHOP.md).

## The game (the client)

`RemotePlayerService` (`garage/player/remote.js`) answers the same requests as the local service, so the
garage, the shop and the quests didn't change:
- **As fast as before:** each action is first worked out locally with the same rules, on the last profile
  the server sent, and shown at once, marked pending ("saving…" by the account chip).
- **The server's answer counts:** the change is confirmed, or put back with the server's reason in plain
  words ("Not enough money: … (Put back as it was.)").
- **Offline:** changes wait, with "changes paused (offline)" and a message, and go when the connection is
  back, with the same Idempotency-Key, so a change sent twice is done once. Started offline, the game shows
  the last garage the server sent and waits.
- **Two tabs or devices** stay in step through the server's events; when both change something, the server
  settles it (each action against what it has).

### Existing saves

As decided in Step 1: a fresh start. A signed-in player's economy begins on the server with the starting
car and money (a `start` row in the ledger). A save kept in the browser before Phase 6 isn't read or
imported. Every item the server holds is checked by the game's rules whenever it's loaded or changed.

## Admin tools

On the admin page (`/admin/`, admins only; every write is in the admin log with who, whom and why):
- **A player's economy:** money and XP, their cars with each build, their spare parts, an item's history,
  and the ledger (newest first).
- **Putting things right**, always with a written reason:
  - give or take money (never below zero);
  - give a part or a car, or take one away;
  - reverse a transaction (a new ledger row; the old one stays).
- **Economy dashboard:**
  - money earned and spent each day, by source;
  - all the money in the game, the average balance, and the average balance by level;
  - the ledger check;
  - alerts: a player earning far more than others in a day (over five times the 95th percentile, and at
    least 50,000), and recent admin grants.

## Tests

| Command | What |
|---|---|
| `npm run test:server` | Includes the economy: `economy.test.ts`, `sessions.test.ts`, `economy-flow.test.ts`. |
| `npm run test:browser:economy -w @kr/server` | The client and the admin page in Chromium. |
| `npm run load-test:economy -w @kr/server` | 500 players in the garage and on the road. |

What they cover:
- **Double spend:** 50 purchases at once with money for one; exactly one goes through.
- **A part in one place:** fitted to two cars at once, or sold ten times at once; it happens once.
- **Tampering:** a price, a quantity, someone else's part, a part that doesn't fit, made-up ids, the
  development commands, a replayed request.
- **The ledger** can't be edited, and the balance only moves through it.
- **Random actions:** about 2,400 by six players at once. Every balance equals its ledger, none is below
  zero, and every part is in one place.
- **Sessions:** the fee charged once, refunds only for a run that never got going, a finish paid once over
  10 at once, the timeout, pink slips, damage sanity, repairs priced by the server.
- **The full garage flow** step by step against the local service, refusals included.
- **Guest to account** (the economy moves) and account deletion.
- **Admin tools,** settings changes and rollback, the dashboard.
- **In the browser:**
  - shown at once and confirmed;
  - a refusal put back with its message;
  - offline: paused, then sent once;
  - two tabs in step;
  - the game's own garage on the server;
  - the admin page: a player's books, a grant, a reversal, the settings, the dashboard.

### Load (this computer: 4 cores, PostgreSQL on the same machine)

500 signed-in players arrive over 20 s. Each then:
- looks at their garage and the settings;
- buys a part, fits it, takes it off and sells it;
- drives with three crash reports, a heartbeat and the end;
- repairs the car;
- starts and finishes today's daily event.

Each player waits 5–20 s before each action. That's 7,500 requests, with no errors:

| | p50 | p95 | worst |
|---|---|---|---|
| Fit a part / take it off | 40 ms | 101 ms | 139 ms |
| Buy, sell | 16–17 ms | 66–71 ms | 148 ms |
| Their garage | 12 ms | 18 ms | 52 ms |
| Crash report, repair, start an event, finish it | 15–19 ms | 24–30 ms | 70 ms |
| Start a drive, heartbeat, end it, the settings | 2–10 ms | 5–32 ms | 98 ms |

The limits are a p50 under 150 ms and a p95 under 1 s; the game shows each change at once anyway. After
the run, every balance equals its ledger, with one start row and one reward a player.

`--burst` sends every step from all 500 at the same moment, as a stress figure. Everything still goes
through correctly, about 165 requests a second, but fits wait up to about 9 s (docs/KNOWN_ISSUES.md).
