# Running the game (Phase 6 Step 5)

How to see what the game is doing, how you're told when something goes wrong, and the switches for handling it
without a deploy: features off, maintenance, "please refresh". Also how deploys stay safe and how to roll one
back. Recovering from a lost database, server or host: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

**Online parts are paused** like the rest of the hosting ([DEPLOYMENT.md](DEPLOYMENT.md)). Everything here
runs locally and is tested; [When we deploy](#when-we-deploy) lists what to set up.

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

`server/src/ops/alerts.ts`, checked every minute on each server. Sent to `ALERT_EMAIL`, and to a phone through
`ALERT_WEBHOOK_URL`.

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

**What can't be seen from inside:**

| Alert | Covered by |
|---|---|
| **Site down** | An outside uptime monitor checking `https://api.ognistrada.com/api/v1/status` and the game's address every minute |
| **Spending over budget** | Each provider's own billing alerts |

Both are in [When we deploy](#when-we-deploy). Errors with their stack traces also go to Sentry, which emails new kinds of error.

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
- **`status.ognistrada.com`**: point it at the page, or at the uptime monitor's own status page (most have a free public one that's independent of our hosting). Either is fine; the monitor's is the one that still works if Cloudflare Pages is down too.

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

A deploy (`deploy.yml`) goes:
1. CI must pass on the commit;
2. staging, by itself, then checked;
3. production, after your approval (the `production` environment's required reviewers);
4. Render starts the new server, waits for `/api/v1/health` to answer, then moves traffic over. The old one finishes its requests (a clean stop on SIGTERM).

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
- Render has no canary deploys on these plans, so new behaviour goes out behind a feature switch.
- Deploy it with the switch at 10%, watch Monitoring, then raise it.

## Rolling back

| What | How |
|---|---|
| Everything, kept in step | **Actions → rollback → Run workflow** (`rollback.yml`): the environment and the commit to go back to. Production still needs your approval. |
| The API alone | Render → the service → Events → the previous deploy → **Rollback** (one click) |
| The game alone | Cloudflare → Pages → Deployments → **Rollback** |
| A feature alone | Switch it off on the Launch tab (seconds) |

- **A rollback never undoes migrations.** The older server runs on the newer schema, which is why they only add.
- **The rollback drill** (`node server/tools/rollback-test.ts`, report in `reports/rollback-test.md`; run in CI):
  1. a broken release, with an additive migration and a bug failing every garage request, deployed to a staging-like database;
  2. the server-errors alert fires on its first check;
  3. the previous version is started again on the newer schema;
  4. it serves every request and takes a purchase, the books balance, and the alert clears.

## When we deploy

Add to [DEPLOYMENT.md](DEPLOYMENT.md)'s list. **Ask before anything that costs money.**

1. **Alerts:** set `ALERT_EMAIL` (your email) and `ALERT_WEBHOOK_URL` (an ntfy topic) on Render for production and staging. Free.
2. **Uptime monitor and status page:** UptimeRobot or Better Stack (both have free plans).
   - Monitor `https://api.ognistrada.com/api/v1/status` (keyword `"api":"up"`) and `https://ognistrada.com/`, every minute (5 on UptimeRobot's free plan).
   - Alert your email and phone.
   - Make its public status page, and point `status.ognistrada.com` at it.
3. **Budgets:** a spending limit or alert on every paid service:
   - **Render:** Billing → spend limit; its free plans can't be charged.
   - **Neon:** Billing → usage alerts; the paid plan's compute hours.
   - **Cloudflare:** Billing → notifications. R2 and Pages are free here; Workers paid only if turned on.
   - **Resend:** the free plan caps itself at 3,000 emails a month.
   - **Sentry:** the free plan; set a spike-protection quota.
   - **GitHub Actions:** the free minutes; a spending limit of $0.
4. **`METRICS_TOKEN`** if an external dashboard should read `/api/v1/metrics`.
5. **Turnstile keys and Cloudflare's rules** ([ABUSE.md](ABUSE.md)).
6. **Point-in-time recovery** ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)): it comes with the paid database plan.
