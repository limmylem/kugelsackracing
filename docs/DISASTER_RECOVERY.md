# Disaster recovery (Phase 6 Step 5; online since Phase 7 Step 5)

What to do if the database, the server or a hosting provider fails. How much can be lost, how long it takes, and the
drills that prove the plan works. The setup it restores: [DEPLOYMENT.md](DEPLOYMENT.md) — one VPS in Sydney
(OVHcloud), PlanetScale Postgres in Sydney, Cloudflare in front.

| | Target | How |
|---|---|---|
| **Data lost at most (RPO)** | Minutes with PlanetScale's point-in-time restore (*check* its window on PS-5); a day with the nightly backup alone | PlanetScale's own backups, and our nightly encrypted dump kept in R2, checked by restoring each one |
| **Back up within (RTO)** | 1 hour for a lost server or database; a day for a whole provider gone | The steps below. The drill restores in about a second on a small database; a real one takes minutes. |

## What's backed up, and where

| What | Backup | Kept |
|---|---|---|
| The database (accounts, the economy, results, world content: everything the server keeps) | **Nightly**, 16:17 UTC (`backup.yml`): `pg_dump`, encrypted with AES-256 (`BACKUP_PASSPHRASE`), restored straight away into a scratch PostgreSQL with PostGIS to prove it's good, then put in the private R2 bucket `ognistrada-backups` as `daily/<date>.dump.gpg`. Healthchecks.io emails if a night is missed. | 35 days (R2 deletes older ones) |
| The database, continuously | **PlanetScale's backups and point-in-time restore** (*check* the schedule and how far back in its dashboard: Backups) | PlanetScale's window |
| The server | Nothing to back up: it holds no data. Everything on it comes from the repository (`deploy/`), the image (`ghcr.io`) and GitHub's secrets, except `rt.secret`, which is made afresh. | — |
| The code, the game, the workflows | Git (GitHub); every deploy can be rebuilt from its commit, and the newest 20 commits' images are kept | Forever |
| Map files, cars, sounds (`assets/`) | Git and the bake (`npm run map:bake`). R2 `ognistrada-tiles` holds the deployed copy; any deploy uploads it again. | Git |
| Secrets | **Not in any backup.** In GitHub's secrets (which can't be read back out) and the owner's password manager. | The password manager |

**Secrets to keep safe** (in the password manager — GitHub's copies can be replaced but never read):
- `BACKUP_PASSPHRASE`: without it **no backup can be read at all**.
- `BETTER_AUTH_SECRET`: it signs sessions and encrypts the two-factor secrets; restoring with a different one signs
  everyone out, and editors and admins must set up two-factor sign-in again.
- `EDGE_SECRET`, the deploy SSH key (`~/.ssh/ognistrada_deploy`), `DATABASE_URL` (or PlanetScale's login to make a
  new password), the Turnstile and Resend keys, and the logins to OVHcloud, PlanetScale, Cloudflare, Resend, GitHub
  and Namecheap (each with two-factor sign-in).
- Not needed: `RT_SECRET` (the server makes a new one), the tunnel's token (read from Cloudflare at each deploy).

## If the database fails or its data is damaged

1. **Stop writes.** Admin page → Launch → Maintenance, with a message. If the admin page doesn't work, stop the
   server's containers: `ssh ubuntu@<SERVER_HOST> 'cd /opt/ognistrada && docker compose stop api rt'`.
2. **Decide what to restore to:**
   - **Bad data** (a bug or a mistake wrote it): PlanetScale's **point-in-time restore** to just before it (the
     database → Backups → restore to a time; *check* the exact menu). It restores into a new branch or database:
     check it there first, then point the server at it (step 3).
   - **The database gone, or PlanetScale unavailable:** the newest nightly backup from R2.
     1. Download it: Cloudflare → R2 → `ognistrada-backups` → `daily/` → the newest file, or
        `rclone copyto r2:ognistrada-backups/daily/<date>.dump.gpg .` with the R2 keys.
     2. A new empty PostgreSQL (17 or newer) with PostGIS: a new PlanetScale database (GO_LIVE.md Part 3), or Neon in
        Sydney as the fallback.
     3. With PostgreSQL tools at least as new as it:
        `TARGET_URL='postgresql://…' BACKUP_PASSPHRASE='…' server/scripts/restore.sh <date>.dump.gpg`
        (`--clean` to overwrite a database that isn't empty). It decrypts, restores, and prints what it found.
3. **Point the server at it:** set the GitHub secret `DATABASE_URL` to the restored database (the direct connection,
   port 5432), then **Actions → rollback** with the commit production runs now (a redeploy writes the new settings).
   The server migrates on start (nothing to do).
4. **Check:** Actions → check; the admin page (Monitoring: the database line, the economy); sign in as yourself
   (password and authenticator).
5. **Open again:** maintenance off. Watch Monitoring for an hour.
6. **Afterwards:** write down what was lost (between the restore point and the failure). If players' data was exposed
   or lost: [PRIVACY_DATA.md](PRIVACY_DATA.md)'s open question 8 on breach notification (the EU and UK deadline is 72
   hours; Australia's notifiable data breaches scheme).

## If the server fails

Docker restarts a crashed container by itself, and the server comes back by itself after a reboot.

| What happens | What to do |
|---|---|
| **It keeps crashing after a deploy** | Roll back ([DEPLOYMENT.md](DEPLOYMENT.md#rolling-back)): Actions → rollback → the commit before. The database needs nothing: migrations only add. |
| **Up but broken in one feature** | Switch that feature off (Launch tab) and fix it calmly. |
| **Overloaded** | Monitoring shows the slow requests; `docker stats` on the server shows memory and CPU. A bigger VPS is a resize in OVHcloud (ask first: money), or switch the heaviest feature off. |
| **Unreachable** (UptimeRobot says all three addresses are down) | OVHcloud's control panel: the VPS's state, its console, **Reboot**. Then Actions → check. |
| **Lost, or not to be trusted any more** (broken into) | Rebuild it from scratch (below). Replace every secret it held if it may have been read. |

### Rebuilding the server from scratch

About an hour, most of it waiting. Nothing on the old server is needed.
1. **A new VPS:** OVHcloud → VPS-1, Sydney, Ubuntu 24.04, with the deploy key `ognistrada_deploy.pub`
   ([GO_LIVE.md](GO_LIVE.md) Part 2). Or reinstall the same one (the VPS → **Reinstall**, with the SSH key).
2. **Its address:** if it changed, the repository variable `SERVER_HOST`; and the variable `SERVER_SSH_HOST_KEY`, if
   it's set, removed or replaced (the new server has a new host key).
3. **Actions → server-setup**, a dry run, then for real (approve both): Docker, updates, the firewall, a new
   `rt.secret`.
4. **The first deploy:** Actions → rollback with the commit production should run (or push to `main`), approve it. The
   tunnel's token comes from Cloudflare; the tunnel and its addresses don't change, so DNS needs nothing.
5. **Check:** Actions → check; UptimeRobot turns green.
6. Delete the old VPS in OVHcloud once the new one works (it's billed until then).

## If a hosting provider fails or is lost

Everything is code (`deploy/`, the workflows, `tools/`), so it can be rebuilt elsewhere.

| Provider | Holds | If it's gone |
|---|---|---|
| **OVHcloud** | The server | Any Ubuntu 24.04 VPS in or near Sydney (Vultr, DigitalOcean, AWS Lightsail…): [Rebuilding the server](#rebuilding-the-server-from-scratch). The tunnel means no DNS change. |
| **PlanetScale** | The database | Restore the newest backup into any PostgreSQL 17+ with PostGIS (Neon in Sydney is the fallback), set `DATABASE_URL`, redeploy (above). |
| **Cloudflare** (DNS, Pages, R2, the tunnel, Turnstile) | The game, its files, the way in | Move the domain's DNS to another provider (at Namecheap). Serve the game (`node tools/build-site.mjs`) and `assets/` from any static host with CORS (`TILES_URL`); open ports 80/443 on the server with a reverse proxy and certificates (Caddy) in place of the tunnel; another bot check or none. A day's work. The backups in R2 would be gone too: keep a downloaded one. |
| **GitHub** (code, workflows, images, secrets) | Everything's source | A clone of the repository is a full copy: keep one. Build the image with the `Dockerfile` and run `deploy-server.sh` by hand with the secrets from the password manager. |
| **Resend** | Email | Any SMTP service: the `SMTP_URL` in `deploy-server.sh` and its DNS records. |

## The drill

`TEST_DATABASE_URL=… node server/tools/dr-test.ts` (run in CI; report in `reports/dr-test.md`):

1. a production-like database: 30 players with passwords, garages, purchases and support messages, an admin with two-factor sign-in, settings and grants;
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

**Online** (there's no staging), once at the start and then every 3 months: Actions → backup → Run workflow with
*drill* ticked. The night's backup is made, restored into a fresh PostgreSQL with PostGIS on GitHub's runner, and the
image production runs is started on the restored copy and must answer healthy with its database (the run's summary
says so). Note the time it took here.
