# What the game costs to run (Phase 6 Step 5)

An estimate per 1,000 players, worked from what the load test measured (`npm run load-test:full -w @kr/server`,
[reports/load-test.md](../reports/load-test.md)), and the budget alerts to set. **Nothing here has been bought.**
Deployment is paused ([DEPLOYMENT.md](DEPLOYMENT.md)), and every paid step needs the owner's OK first.

> Prices are the ones in [DEPLOYMENT.md](DEPLOYMENT.md) when it was written. **Check each pricing page before
> paying**, because they change. Anything marked *check* is a figure I couldn't confirm.

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
| API traffic | About 11 GB a month out of Render. The server doesn't compress; Cloudflare compresses on the way to players. Render's plans include some outbound bandwidth (*check*), well above this. |
| Database growth | About 0.7 GB a month (16 KB × 45,000), kept, because the ledger and history are kept |
| Server CPU | About 4 CPU-hours a month. Sign-in is the expensive part: a password check takes about 100 ms of CPU, by design. |
| Players at once (evening peak, about 10%) | About 100 |
| Emails (verification, resets, support replies) | About 1.5 per new player, and a few per 100 active players |
| Map files and models (R2 through Cloudflare) | A few hundred requests per session, mostly from Cloudflare's cache. Egress is free on R2. |

## Monthly cost

| Service | Closed beta (500 players) | Per 1,000 active players | 5,000 active players |
|---|---|---|---|
| **API server** (Render) | Starter, $7. 0.5 CPU, about 60 players at once by the load test's numbers. | Starter at about 1,000; above that Standard, about $25 (*check*), 1 CPU | Standard, or 2 Starters, about $25 |
| **Database** | Render Postgres Basic-256mb, $6, or Neon's paid plan | The same plan. Storage grows about 0.7 GB a month, so a few dollars more per GB once past the plan's included storage (*check*). | A larger plan, about $20 (*check*) |
| **Point-in-time recovery** | Included with the paid database plans ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)); the window depends on the plan (*check*) | | |
| Cloudflare: DNS, Pages, R2, Turnstile, WAF rules | $0. R2's free tier is 10 GB of storage and 10 million reads a month; the world's files are a few GB. | $0 | $0, until R2 passes its free reads (*check*) |
| Email (Resend) | $0 (3,000 a month free) | $0, near the limit in a month of many sign-ups | About $20 (Pro) |
| Errors (Sentry) | $0 (free plan) | $0 | $0 or about $26 (*check*) |
| Alerts (ntfy), uptime monitor and status page (UptimeRobot or Better Stack) | $0 | $0 | $0 |
| Backups (GitHub Actions artifacts) | $0 (free minutes) | $0 | $0 |
| Domain | About $1 a month (yearly) | | |
| **Total** | **About $14 a month** | **About $15–20 a month per 1,000** | **About $70–90 a month** |

**Where the money goes first:**
- **Players at once.** One Starter instance holds about 60 at once.
  - Past that, answers slow down.
  - When the database's connections run out, requests get `503 BUSY` with "try again in 2 s" rather than failing. The game retries.
  - A 2,000-player run on this computer showed both: password checks queued, and the database pool ran out.
  - Raise the instance size or count when the Monitoring tab's p95 or "waiting for a connection" climbs ([OPERATIONS.md](OPERATIONS.md)).
- **Database storage.** The ledger, item history and results are kept for good. About 0.7 GB a month per 1,000 players.
  - Before it matters, older driving sessions and results could be summarised or archived.
  - That's a decision about what we keep ([PRIVACY_DATA.md](PRIVACY_DATA.md)), so ask first.

**Multiplayer (Phase 7 Step 1), not in the table above yet.** The region and services are the owner's decision:
ask first ([DEPLOYMENT.md](DEPLOYMENT.md) "To do when we deploy" 9).
- **The real-time server:**
  - a second Render Starter, $7 a month, or a small Fly.io machine in Sydney, a few dollars a month (*check*);
  - one process handled 256 players at a 2.4 ms tick on this computer.
- **Redis:**
  - Render Key Value Starter, about $10 a month (*check*), or Upstash, which charges per request;
  - its use is small: rooms, one-use ticket ids and bans.
- **Traffic:**
  - each player sends about 2 KB/s and receives about 10 KB/s with 8 cars around, 31–34 KB/s with 30;
  - an hour with 8 cars around is about 40 MB out of the server per player;
  - 100 players at once for 3 hours every evening is about 360 GB a month;
  - check the host's included bandwidth before choosing (*check*).

## Budget alerts to set (when we deploy)

None of these exist yet, because there are no accounts ([DEPLOYMENT.md](DEPLOYMENT.md), "To do when we deploy").

| Where | Set |
|---|---|
| Render (Billing) | A spend limit, or a notification, at **$20 a month** for the beta. Free services can't be charged. |
| Neon (if used) | Usage alerts on compute hours and storage, at the paid plan's included amounts |
| Cloudflare (Billing → Notifications) | A usage-based billing alert at **$1**. Everything we use is free, so any charge means something's wrong. |
| Resend | None needed on the free plan (it stops at 3,000). On Pro, an alert at 80%. |
| Sentry | Spike protection on, with a monthly error quota |
| GitHub | Actions spending limit **$0** |

The game itself also warns about what it can see:
- the `slow`, `database` and `errors` alerts mean it's outgrowing its plan;
- the `money` alert is about the game's economy, not real money.

## Re-measuring

```sh
TEST_DATABASE_URL=postgres://… npm run load-test:full -w @kr/server -- --players 500
```

- The report's "one player's session" lines give the per-player figures above.
- Re-measure after a big feature (Phase 7's real-time racing will change the picture).
- Re-measure on the real server once deployed: staging, on the Starter plan, with `--players 60`.
