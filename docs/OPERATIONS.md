# Running the game (Phase 6 Step 5)

How to see what the game is doing, how you're told when something goes wrong, and the switches for handling it
without a deploy: features off, maintenance, "please refresh". Also how deploys stay safe and how to roll one
back. Recovering from a lost database, server or host: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

**Online (Phase 7 Step 5):** production only, one server in Sydney ([DEPLOYMENT.md](DEPLOYMENT.md)). Everything here
runs locally and is tested; [Online](#online) lists what's set up outside the game.

## The dashboard

The admin page's **Monitoring** tab (`GET /api/v1/admin/monitoring`). It refreshes every 30 seconds.

| What | Where it comes from |
|---|---|
| Players now, today, new today | Accounts seen in the last 5 minutes (this server); sessions used in 24 hours; accounts made in 24 hours |
| Requests, server errors, rate limited (last 5 minutes) | Every API request counted (`server/src/ops/metrics.ts`, in memory, 6 hours) |
| Answer times | Half under, 95% under; per kind of request too, slowest first (last hour) |
| The database | A `select 1`'s time; the connection pool: open, waiting |
| The verification queue | Results and tracks waiting for the track worker, the oldest's wait; results in the last hour and how many were refused |
| Economy activity | Money made and spent today; made in the last hour against a normal hour this week. Money by source and day, and the richest players, are on **Economy dashboard**. |
| Waiting for an admin | Open reports, abuse flags, support messages |
| Alerts | Firing and fixed, with how often |

**Charts:** requests, players, the 95% answer time and server errors, a minute at a time for 2 hours.

**Several servers:** each counts its own requests. The tab shows the one that answered, while the database
numbers are everyone's. An external monitor can read every server's numbers from `GET /api/v1/metrics`
(Prometheus text, with `Authorization: Bearer $METRICS_TOKEN`; off without the token). Grafana Cloud's free
plan can scrape it.

## Alerts

`server/src/ops/alerts.ts`, checked every minute on each server. Sent to `ALERT_EMAIL` (from
`noreply@ognistrada.com`, through Resend), and to a phone through `ALERT_WEBHOOK_URL` if it's set (the deploy doesn't
set it yet: [Online](#online)).

**Sending:**
- once when a problem starts;
- again every hour while it lasts;
- once when it's fixed ("Fixed: …").

**The phone:** the simplest is [ntfy](https://ntfy.sh), which is free.
1. Install its app.
2. Subscribe to a long random topic name.
3. Set `ALERT_WEBHOOK_URL=https://ntfy.sh/<that topic>`.

Any webhook that takes plain text works.

| Alert | Fires when (thresholds in `server/config/<env>.json` `alerts`) |
|---|---|
| `errors` | Over 5% of requests failed with a server error in 5 minutes (at least 20 requests) |
| `slow` | The 95th-percentile answer took over 1.5 s in 5 minutes (at least 20 requests) |
| `database` | The database doesn't answer, takes over 1 s for `select 1`, or more than 5 requests are queueing for a connection |
| `queue` | More than 20 results or tracks waiting, or one waiting over 2 minutes |
| `money` | Over 5,000,000 made in an hour (rewards, grants, starting money), or 5× a normal hour this week |
| `realtime` | (Phase 7 Step 5) The real-time server hasn't reported for 90 s (it sends its numbers every 5 s). Races, lobbies and free roam are probably down: `docker compose ps` and `docker compose logs rt` on the server. `GET /api/v1/status` says the same (`"rt": "up"`, `"down"`, or `"unknown"` just after the API starts). |

**What can't be seen from inside:**

| Alert | Covered by |
|---|---|
| **Site down** | UptimeRobot: the game's address, `/api/v1/status` (`"api":"up"` and `"rt":"up"`) and `https://rt.ognistrada.com/health` (`"ok":true`) ([Online](#online)) |
| **The nightly backup missed** | Healthchecks.io ([DEPLOYMENT.md](DEPLOYMENT.md#monitoring-and-alerts)) |
| **Spending over budget** | Each provider's own billing alerts ([COSTS.md](COSTS.md)) |

Errors with their stack traces also go to Sentry, which emails new kinds of error.

`server/test/ops.test.ts` checks:
- each alert fires on its condition;
- it goes by email and webhook;
- it isn't repeated within the hour;
- it's repeated after an hour;
- "Fixed" is sent.

## The status page

**`/site/status.html`** on the game's own address, so it loads when the server is down and says so.
- It asks `GET /api/v1/status` every 30 seconds: the server, the database, maintenance and its message, and features switched off.
- It shows "Everything is working", "Up, with some features off", "Down for maintenance", "Having problems" or "The game's server isn't answering".
- **UptimeRobot's own public status page** is the one that still works if Cloudflare is down too. `status.ognistrada.com` isn't set up (it could point at either, later).

## Switches (no deploy needed)

The admin page's **Launch** tab (`PUT /api/v1/admin/settings/:key`):
- each change needs a reason and goes in the audit log;
- it applies on every server within a few seconds (`server/src/ops/settings.ts`).

| Switch | What it does |
|---|---|
| **Features** | Switch one off when it's broken: signing up, guests, the shop, quests, track results, replays, world editing, reports, support. Its requests answer `503 FEATURE_OFF` with your message; the rest of the game carries on, and the status page lists it. |
| **Gradual rollout** | A feature on for a **share** of players (0–100%). Each account always lands on the same side (a hash of its id and the feature). |
| **Maintenance** | Everyone but editors and admins gets `503 MAINTENANCE` with your message and "back at". Who you are and the status still answer, so the game shows the message as a banner and the status page says so. |
| **The oldest game the server takes** | The game sends its API version (`x-kr-client`; `CLIENT_PROTOCOL` in `packages/shared` and `account/api.js`, which a test keeps equal). An older one gets `426 CLIENT_TOO_OLD`, and the game shows "The game has been updated" with a **Refresh** button. Raise `CLIENT_PROTOCOL` with any API change an old game can't follow. Tools that don't send a version are let through. |
| **Closed beta** | Sign-ups need an invite code ([LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md)) |

## Safe deploys

A deploy (`deploy.yml`; [DEPLOYMENT.md](DEPLOYMENT.md#deploying)) goes:
1. CI must pass on the commit, and its image is built;
2. production, after your approval (the `production` environment's required reviewer) — there's no staging;
3. on the server, `docker compose up -d` with the new image: the API stops cleanly (SIGTERM: it finishes its
   requests) and the new one starts in seconds; the real-time server drains first (no new joins, races under way
   finish, up to `RT_DRAIN_SEC`, 600 s);
4. the deploy waits until both answer healthy at the new commit, publishes the game, then runs the checks.

With one server there's a gap of a few seconds for the API at each deploy (the game retries): deploy when few are
playing.

**Database migrations that don't break the running version:**
- The new server migrates when it starts, while the old one is still serving.
- So every migration only **adds**:
  - tables;
  - columns that are nullable or have a default;
  - indexes, with `IF NOT EXISTS`, so a retried deploy is harmless.
- `server/test/migrations.test.ts` fails on a drop, a rename, a type change, a new `NOT NULL` without a default, or a delete, from migration 0010 on.
- **Removing something takes two releases:**
  1. stop using it and deploy;
  2. after that's settled, drop it in a migration listed in the test's `ALLOWED_DESTRUCTIVE` with its reason.

**Gradual rollouts:**
- With one server there are no canary deploys, so new behaviour goes out behind a feature switch.
- Deploy it with the switch at 10%, watch Monitoring, then raise it.

## Rolling back

| What | How |
|---|---|
| Everything, kept in step | **Actions → rollback → Run workflow** (`rollback.yml`): the commit to go back to (`/opt/ognistrada/deployed.log` on the server lists the deploys). It still needs your approval. |
| The game alone | Cloudflare → Workers & Pages → `ognistrada` → Deployments → **Rollback** |
| A feature alone | Switch it off on the Launch tab (seconds) |

- **A rollback never undoes migrations.** The older server runs on the newer schema, which is why they only add.
- **The rollback drill** (`node server/tools/rollback-test.ts`, report in `reports/rollback-test.md`; run in CI):
  1. a broken release, with an additive migration and a bug failing every garage request, deployed to a production-like database;
  2. the server-errors alert fires on its first check;
  3. the previous version is started again on the newer schema;
  4. it serves every request and takes a purchase, the books balance, and the alert clears.

## Online

What's set up outside the game ([DEPLOYMENT.md](DEPLOYMENT.md#monitoring-and-alerts); the owner's accounts:
[GO_LIVE.md](GO_LIVE.md) step 10). **Ask before anything that costs money.**

1. **Alerts:** `ALERT_EMAIL` (a GitHub secret, put in the server's settings by each deploy). `ALERT_WEBHOOK_URL` (a
   phone, through an ntfy topic) isn't passed by the deploy yet: add it to `server/scripts/deploy-server.sh` if wanted.
2. **UptimeRobot** (free), alerting the owner's email:
   - `https://ognistrada.com/` (up);
   - `https://api.ognistrada.com/api/v1/status`, keyword `"api":"up"`;
   - the same address again, keyword `"rt":"up"` (the API hears from the real-time server);
   - `https://rt.ognistrada.com/health`, keyword `"ok":true`.
3. **Sentry** (free): `SENTRY_DSN` (secret: the API and the real-time server) and `SENTRY_CLIENT_DSN` (variable: the
   game). Spike protection on.
4. **Healthchecks.io** (free): one check, a ping a day, its URL in the secret `HEALTHCHECKS_BACKUP_URL`.
5. **Budgets:** OVHcloud and PlanetScale bill a fixed monthly amount; Cloudflare → Billing → Notifications, a
   usage alert at $1 (everything we use is free); GitHub Actions spending limit $0 ([COSTS.md](COSTS.md)).
6. **`METRICS_TOKEN`** only if an external dashboard should read `/api/v1/metrics` (not set).
7. **Turnstile** keys are set (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`); Cloudflare's WAF rules ([ABUSE.md](ABUSE.md)).
8. **The server itself:** Docker restarts a stopped container; the OS installs security updates and reboots itself at
   about 04:00 Adelaide time when one needs it. Logs: `docker compose logs --tail 100 api rt` on the server (kept up to
   30 MB a container).
