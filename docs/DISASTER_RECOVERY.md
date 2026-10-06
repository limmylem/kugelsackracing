# Disaster recovery (Phase 6 Step 5)

What to do if the database, the server or a hosting provider fails. How much can be lost, how long it takes,
and the drill that proves the plan works.

| | Target | How |
|---|---|---|
| **Data lost at most (RPO)** | 24 hours now (the daily backup). Minutes with point-in-time recovery, once the database is on a paid plan. | Daily encrypted backups, checked by restoring each one ([SERVER.md](SERVER.md#backups)), and the provider's point-in-time recovery |
| **Back up within (RTO)** | 1 hour for a lost server or database; 4 hours for a whole provider gone | The steps below. The drill restores in about 1 s on a small database; a real one takes minutes. |

## What's backed up, and where

| What | Backup | Kept |
|---|---|---|
| The database (accounts, the economy, results, world content, everything on the server) | **Daily**, 03:17 UTC (`backup.yml`): `pg_dump`, encrypted with AES-256 (`BACKUP_PASSPHRASE`), and restored straight away into a scratch database to prove it's good | 30 days, as GitHub Actions artifacts |
| The database, continuously | **Point-in-time recovery**, by the provider. Needs a paid plan: Render Postgres's paid plans and Neon's paid plans include it, with a restore window of days. **Check the current window on each pricing page.** Neon's free plan keeps only a short history. | The provider's window |
| The code, the game, the workflows | Git (GitHub), and every deploy can be rebuilt from its commit | Forever |
| Map files, cars, sounds (`assets/`) | Rebuilt from git and the bake (`npm run map:bake`). R2 holds the deployed copy. | Git |
| Secrets | **Not in any backup.** Keep these in your password manager: `BETTER_AUTH_SECRET`, `BACKUP_PASSPHRASE`, `EDGE_SECRET`, the OAuth, Resend, Sentry and Turnstile keys. | Your password manager |

**`BETTER_AUTH_SECRET` matters for recovery:**
- it encrypts the two-factor secrets, and it signs sessions;
- restoring with a different one signs everyone out, and editors and admins must turn two-factor sign-in on again.

**`BACKUP_PASSPHRASE`:** without it, the backups can't be read at all.

## If the database fails or its data is damaged

1. **Stop writes.**
   - Turn maintenance on (admin page → Launch → Maintenance, with a message).
   - If the admin page doesn't work: Render → the service → **Suspend**.
2. **Decide what to restore to:**
   - **Bad data** (a bug or a mistake wrote it): point-in-time recovery to just before it, from the provider's dashboard.
     - Neon: Branches → Restore.
     - Render Postgres: Recovery → Point-in-time.
     - Restore into a new database, check it, then switch.
   - **The database gone:** the latest daily backup.
     - Actions → backup → the newest run → the artifact.
     - `TARGET_URL=<a new empty database> BACKUP_PASSPHRASE=… server/scripts/restore.sh kugelsack-YYYY-MM-DD.dump.gpg`
3. **Point the server at it:** set `DATABASE_URL` on Render to the restored database. The server migrates on start (nothing to do).
4. **Check:**
   - `/api/v1/health` (its `dbId` shows which database);
   - the admin page (Monitoring: the database line, the economy);
   - sign in as yourself (password and authenticator).
5. **Open again:** maintenance off (or resume the service). Watch Monitoring for an hour.
6. **Afterwards:**
   - Write down what was lost (the time between the restore point and the failure).
   - If players' data was exposed or lost: [PRIVACY_DATA.md](PRIVACY_DATA.md)'s open question 8 on breach notification. The EU and UK deadline is 72 hours.

## If the server fails

Render restarts a crashed server by itself, and the health check keeps traffic off a server that isn't ready.

| What happens | What to do |
|---|---|
| **It keeps crashing after a deploy** | Roll back ([OPERATIONS.md](OPERATIONS.md#rolling-back)): Render → Events → the previous deploy → Rollback. The database needs nothing, because migrations only add. |
| **It's up but broken in one feature** | Switch that feature off (Launch tab) and fix it calmly. |
| **It's overloaded** | Monitoring shows the slow requests. Raise the plan or the instance count (ask first: money), or switch off the heaviest feature. |

## If a hosting provider fails or is lost

The whole setup is code (`render.yaml`, the workflows, `tools/build-site.mjs`), so it can be rebuilt elsewhere.

| Provider | Holds | If it's gone |
|---|---|---|
| **Render** | The API | Any host that runs a Docker image: the repository's `Dockerfile`, the same environment variables. Point `api.` at it in Cloudflare. The `docker-compose.yml` here runs the whole game on any server. |
| **Neon / Render Postgres** | The database | Restore the latest backup into any PostgreSQL 16 with PostGIS, set `DATABASE_URL` (above). |
| **Cloudflare** (DNS, the game's pages, R2) | The game and its files | Move the domain's DNS to another provider. Serve the game (`node tools/build-site.mjs`) and `assets/` from any static host with CORS, and set `TILES_URL`. The API keeps working meanwhile, under Render's own address. |
| **GitHub** (code, workflows, backups) | Everything's source | A clone of the repository on your computer is a full copy. Keep one. Backups older than the last download are lost, so also download the newest backup now and then. |
| **Resend** | Email | Any SMTP service: set `SMTP_URL`. |

## The drill

`TEST_DATABASE_URL=… node server/tools/dr-test.ts` (run in CI; report in `reports/dr-test.md`):

1. a staging-like database: 30 players with passwords, garages, purchases and support messages, an admin with two-factor sign-in, settings and grants;
2. backed up with `server/scripts/backup.sh` (the file checked to be unreadable without the passphrase);
3. **the disaster:** the server stopped and the database dropped;
4. a new empty database, with a wrong passphrase refused, then `server/scripts/restore.sh`;
5. the server started on it;
6. **checked:**
   - every table's rows the same;
   - every balance the same, and equal to its ledger;
   - all the money the same;
   - players signing in with their passwords and buying a part;
   - the admin signing in with their authenticator code and using the admin tools.

**Latest result:** passed. From the database lost to the game serving again took **1.3 s** on this computer.

**On real staging** (when we deploy), once, and then every 3 months:
- Actions → backup → Run workflow with "Also restore this backup into the staging database";
- then sign in to staging as a player and as an admin;
- note the time it took here.
