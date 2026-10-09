# What the game costs to run (Phase 6 Step 5)

What it costs now, an estimate per 1,000 players worked from what the load test measured (`npm run load-test:full -w
@kr/server`, [reports/load-test.md](../reports/load-test.md)), and the budget alerts to set. Every paid step needs the
owner's OK first, with a monthly estimate.

> **Check each pricing page before paying**, because they change. Anything marked *check* is a figure I couldn't confirm.

## Now: friends testing (Phase 7 Step 5)

Approved by the owner on 2026-10-08: production only, the owner and up to ~5 friends at once, all in Australia
([DEPLOYMENT.md](DEPLOYMENT.md), [GO_LIVE.md](GO_LIVE.md)).

| What | Plan | A month |
|---|---|---|
| The server (the API, the real-time server, the tunnel) | OVHcloud VPS-1, Sydney: 2 vCores, 4 GB, 40 GB | A$6.29 + GST ≈ US$4.60 |
| The database | PlanetScale Postgres PS-5, AWS Sydney | ≈ US$5 (*check* the first invoice) |
| The domain | `ognistrada.com` at Namecheap, its yearly renewal | ≈ US$1 |
| Cloudflare (DNS, Pages, R2, Turnstile, the tunnel), Resend, UptimeRobot, Sentry, Healthchecks.io, GitHub | Free plans | $0 |
| **Total** | | **≈ US$10.50–11.50** |

No Redis (one real-time process keeps everything in memory) and no staging. R2 is free to 10 GB stored; we use about
0.3 GB of files plus 35 nightly backups. OVHcloud's VPS traffic is unmetered (*check* the order page), so free roam's
bandwidth costs nothing extra on this server.

## What one player uses (measured)

The load test's player runs the whole flow once:
- sign in;
- the world;
- the garage;
- the shop (buy, fit, remove, sell);
- a drive with a crash and a repair;
- the daily event, checked and paid;
- the leaderboard.

| Per session of the test | Measured |
|---|---|
| Requests to the API | 24 |
| Sent from the API to the player | 250 KB (uncompressed JSON) |
| Database growth | 50 KB, of which 32 KB is idempotency keys, deleted after 24 hours. **About 16 KB stays**: driving sessions 3.9, item history 2.7, ledger 2.6, results 1.8, quest progress 1.3, sign-in signals 0.8 (deleted after 90 days). |
| Server CPU | About 0.3 s, which also includes the test's own requests, so it overstates |
| 500 players at once, on 4 cores | Every step's p95 at most 210 ms, no errors, about 80 requests a second |

A real evening's play is longer than the test's one pass. **I assume 3 passes per session and 15 sessions a month
per active player.** For 1,000 monthly active players that's 45,000 passes a month.

| Per 1,000 monthly active players | Estimate |
|---|---|
| API requests | About 1.1 million a month (0.4 a second on average; evenings 5–10× that) |
| API traffic | About 11 GB a month out of the server. The server doesn't compress; Cloudflare compresses on the way to players. OVHcloud's VPS traffic is unmetered (*check*). |
| Database growth | About 0.7 GB a month (16 KB × 45,000), kept, because the ledger and history are kept |
| Server CPU | About 4 CPU-hours a month. Sign-in is the expensive part: a password check takes about 100 ms of CPU, by design. |
| Players at once (evening peak, about 10%) | About 100 |
| Emails (verification, resets, support replies) | About 1.5 per new player, and a few per 100 active players |
| Map files and models (R2 through Cloudflare) | A few hundred requests per session, mostly from Cloudflare's cache. Egress is free on R2. |

## Monthly cost

| Service | Closed beta (500 players) | Per 1,000 active players | 5,000 active players |
|---|---|---|---|
| **The server** (OVHcloud VPS, Sydney: the API and the real-time server) | VPS-1, ≈ US$4.60: 2 vCores shared by the API and the real-time server; the load test's 500 at once took 4 cores, so a couple of hundred (*check* with the `loadtest` workflow) | VPS-1 to about 1,000; then a bigger VPS (VPS-2 or VPS-3, about US$8–15, *check*) | A second server, or a bigger one, about US$30 (*check*) |
| **Database** (PlanetScale Postgres) | PS-5, ≈ US$5 | PS-5, then a bigger size as storage grows (about 0.7 GB a month per 1,000 players; *check* PS-5's storage) | A larger size, about US$20–40 (*check*) |
| **Point-in-time recovery** | Included with PlanetScale ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)); *check* the window on each size | | |
| Cloudflare: DNS, Pages, R2, Turnstile, WAF rules | $0. R2's free tier is 10 GB of storage and 10 million reads a month; the world's files are a few GB. | $0 | $0, until R2 passes its free reads (*check*) |
| Email (Resend) | $0 (3,000 a month free) | $0, near the limit in a month of many sign-ups | About $20 (Pro) |
| Errors (Sentry) | $0 (free plan) | $0 | $0 or about $26 (*check*) |
| Alerts (ntfy), uptime monitor and status page (UptimeRobot or Better Stack) | $0 | $0 | $0 |
| Backups (GitHub Actions, kept in R2) | $0 (free minutes; R2's free storage) | $0 | $0 |
| Domain | About $1 a month (yearly) | | |
| **Total** | **About US$11 a month** | **About US$11–20 a month per 1,000** | **About US$60–90 a month** |

**Where the money goes first:**
- **Players at once.** The load test's 500 at once took 4 cores; the 2-vCore VPS holds fewer (*check* with the `loadtest` workflow).
  - Past that, answers slow down.
  - When the database's connections run out, requests get `503 BUSY` with "try again in 2 s" rather than failing. The game retries.
  - A 2,000-player run on this computer showed both: password checks queued, and the database pool ran out.
  - Raise the instance size or count when the Monitoring tab's p95 or "waiting for a connection" climbs ([OPERATIONS.md](OPERATIONS.md)).
- **Database storage.** The ledger, item history and results are kept for good. About 0.7 GB a month per 1,000 players.
  - Before it matters, older driving sessions and results could be summarised or archived.
  - That's a decision about what we keep ([PRIVACY_DATA.md](PRIVACY_DATA.md)), so ask first.

**Multiplayer (Phase 7 Steps 1–4).** Online it runs on the same VPS as the API (Phase 7 Step 5), at no extra cost.
- **The real-time server:** one process handled 256 players at a 2.4 ms tick on this computer. A second process or
  server, or a region elsewhere, is a cost to estimate and ask about first ([DEPLOYMENT.md](DEPLOYMENT.md#scaling-later)).
- **Redis:** not used with one process. With several: a container on the same server (free), or a managed one reached
  by several servers (Upstash charges per request; others about US$10 a month, *check*).
- **Traffic:**
  - each player sends about 2 KB/s and receives about 10 KB/s with 8 cars around, 31–34 KB/s with 30;
  - an hour with 8 cars around is about 40 MB out of the server per player;
  - 100 players at once for 3 hours every evening is about 360 GB a month;
  - OVHcloud's VPS traffic is unmetered (*check*); a host that charges per GB changes this most.

**Multiplayer free roam (Phase 7 Step 4; [FREE_ROAM.md](FREE_ROAM.md)), per 1,000 players.** Mostly bandwidth, and it
depends on how crowded the world is (a player's download grows with the cars within 1.5 km). Measured with the bot swarm
(`node server/tools/roam-test.ts --swarm 150`): in a very dense crowd (~85 cars in view each, at half a game's send rate)
each player receives about 35 kB/s on average (74 at the 95th percentile) and the zone servers use about 3.5 ms of CPU a
second per connection (a player holds 1–4 connections, ~1.7 on average with 2 km zones). Priced (before Phase 7 Step 5)
at a managed host's rates — about $25 a month a core, $10 for Redis and $0.15 a GB past the included bandwidth (*check*);
on OVHcloud's unmetered VPS the bandwidth part, most of it, falls away:

| | Download a player | 1,000 monthly active players (20 h a month each, 10% on at once in the evening) | 1,000 on at once, all month (the worst case) |
|---|---|---|---|
| Very dense crowd — measured | 35 kB/s | **about $390 a month** | **about $13,300 a month** |
| Spread-out world (~10 cars in view) — estimated from ~0.4 kB/s a car in view, doubled for a game's full send rate | ~8 kB/s | **about $100 a month** | **about $3,100 a month** |

The admin page's **Free roam** tab shows the estimate from the live numbers. Bandwidth is the thing to watch: sending each
car once instead of through every zone two players share (FREE_ROAM.md, KNOWN_ISSUES.md) cuts it, and a host with cheap
or included egress (or Cloudflare in front of the WebSockets) changes the last column most. (An earlier version of this
section said 6 kB/s and about $45 / $950: that swarm had lost half its connections without noticing — see
KNOWN_ISSUES.md.) Nothing here has been bought.

## Budget alerts to set

| Where | Set |
|---|---|
| OVHcloud | A fixed monthly price; check the first invoices match (A$6.29 + GST). No usage charges on the VPS. |
| PlanetScale | A fixed size (PS-5); check the first invoice, and its usage page for storage nearing the plan's limit. |
| Cloudflare (Billing → Notifications) | A usage-based billing alert at **$1**. Everything we use is free, so any charge means something's wrong (R2 past 10 GB). |
| Resend | None needed on the free plan (it stops at 3,000 a month, 100 a day). |
| Sentry | Spike protection on, with a monthly error quota |
| GitHub | Actions spending limit **$0** (the repository is public: its minutes are free) |
| Namecheap | Auto-renew on for `ognistrada.com`, the card up to date |

The game itself also warns about what it can see:
- the `slow`, `database` and `errors` alerts mean it's outgrowing its plan;
- the `money` alert is about the game's economy, not real money.

## Re-measuring

```sh
TEST_DATABASE_URL=postgres://… npm run load-test:full -w @kr/server -- --players 500
```

- The report's "one player's session" lines give the per-player figures above.
- Re-measure after a big feature (Phase 7's real-time racing will change the picture).
- Re-measure online with the `loadtest` workflow (20 online bots by default, up to 200): free roam and races on the
  real servers.
