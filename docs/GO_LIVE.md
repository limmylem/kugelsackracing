# Going live for friends testing: your setup, step by step (Phase 7 Step 5)

The game online at `ognistrada.com` for you and up to ~5 friends at once, all in Australia. You make the accounts and
pay; everything after that is done by GitHub Actions workflows that Claude prepares and runs, with your approval.
**Nothing here has been done yet.** Work through Parts 0–5 in order (an hour or two, mostly waiting for emails and
DNS), then tell Claude "Parts 0–5 done" — or stop at any step that looks different from what's written here and ask.

**Never paste a secret (a password, key or token) into a chat.** Every secret goes straight into GitHub's secret
settings (Part 5). The repository is public: secrets there are hidden, even from the workflow logs.

## What it costs

| What | Plan | A month |
|---|---|---|
| Game server | OVHcloud VPS-1, Sydney (2 vCores, 4 GB, 40 GB) | A$6.29 + GST ≈ US$4.60 |
| Database | PlanetScale Postgres PS-5, AWS Sydney | ≈ US$5 (check at checkout) |
| The domain | `ognistrada.com` at Namecheap: its yearly renewal | ≈ US$1 |
| Cloudflare, Resend, UptimeRobot, Sentry, Healthchecks.io, GitHub | Free plans | $0 |
| **Total** | | **≈ US$10.50–11.50** |

If anything at a checkout costs noticeably more than this, stop and tell Claude before paying.

## How it fits together

```
players ──► Cloudflare (HTTPS, protection) ──┬─► ognistrada.com ........ the game (Cloudflare Pages)
                                             ├─► tiles.ognistrada.com .. map files (Cloudflare R2)
                                             └─► api. / rt.ognistrada.com ── Cloudflare Tunnel ──► the server (OVH Sydney)
                                                                                                    ├─ the API
                                                                                                    └─ real-time multiplayer
the server ──► the database (PlanetScale Sydney) · email (Resend)
```

The server opens no web ports: it connects out to Cloudflare through a **Cloudflare Tunnel**, so there are no
certificates to renew on it and only SSH (with your key) can reach it from the internet.

---

## Part 0 — Before you start (10 minutes)

1. **A password manager** (or one safe, private note) to keep the secrets below. You'll need some of them again if
   the server is ever rebuilt.
2. **An authenticator app on your phone** (Google Authenticator, Microsoft Authenticator, 1Password…). The admin
   page online needs two-factor sign-in.
3. **Make the deploy key** (lets GitHub log in to the server). In a terminal (Mac/Linux Terminal, or Windows
   PowerShell):

   ```sh
   ssh-keygen -t ed25519 -C "ognistrada-deploy" -f ~/.ssh/ognistrada_deploy -N ""
   ```

   That makes two files in your `.ssh` folder: `ognistrada_deploy` (**private** — goes into GitHub only) and
   `ognistrada_deploy.pub` (public — goes on the server).
4. **Make three random secrets** and save each in the password manager under the name shown:

   ```sh
   openssl rand -base64 32    # → BETTER_AUTH_SECRET (signs players' sessions)
   openssl rand -hex 24       # → EDGE_SECRET (proves a request came through Cloudflare)
   openssl rand -base64 32    # → BACKUP_PASSPHRASE (encrypts the backups — NEVER lose this one)
   ```

   On Windows without `openssl`, use your password manager's generator: 44 random letters and digits for each.

## Part 1 — Cloudflare (free; a card on file for R2)

1. Sign up at **cloudflare.com** → **Add a domain** → `ognistrada.com` → **Free** plan.
2. It shows the DNS records it found at Namecheap. **Delete any parking records** (an `A` record for
   `ognistrada.com`, or `www` pointing at `parkingpage.namecheap.com`): the setup workflow makes the real ones.
   Keep any `MX` records if you use email at this domain. Continue; it shows **two nameservers**.
3. **At Namecheap:** Domain List → `ognistrada.com` → **Manage**.
   - If **Advanced DNS → DNSSEC** is on, turn it off first.
   - **Nameservers** → **Custom DNS** → enter Cloudflare's two nameservers → the green tick.
   - (Namecheap's own email forwarding and redirects for this domain stop working after this.)
   - Cloudflare emails you when the domain is **Active** (minutes, sometimes up to a day). You can carry on meanwhile.
4. **R2:** left menu **R2 Object Storage** → enable it on the free plan and add a card. Nothing is charged within the
   free amounts (10 GB; we use about 0.3 GB).
5. **Account ID:** on the account's home page (or the domain's overview, right-hand column) → copy the **Account ID**.
   It isn't secret: it goes into GitHub as a variable (Part 5).
6. **Turnstile** (the "are you human" check on sign-up): left menu **Turnstile** → **Add widget** → name `ognistrada`,
   hostnames `ognistrada.com` and `api.ognistrada.com`, mode **Managed** → create → copy the **Site Key** and the
   **Secret Key**.
7. **Two API tokens:** top right → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**.
   - **`ognistrada setup`** (used only by the setup workflow):
     - Account → **Cloudflare Pages** → Edit; Account → **Workers R2 Storage** → Edit;
       Account → **Cloudflare Tunnel** → Edit
     - Zone → **Zone** → Read; Zone → **DNS** → Edit; Zone → **Zone Settings** → Edit;
       Zone → **Transform Rules** → Edit; Zone → **Single Redirect** → Edit; Zone → **Cache Rules** → Edit
     - Zone Resources: Include → Specific zone → `ognistrada.com`
     - TTL: a year from today → Continue → Create → **copy the token** (it's shown once).
   - **`ognistrada deploy`** (used by every deploy):
     - Account → **Cloudflare Pages** → Edit; Account → **Cloudflare Tunnel** → Read
     - TTL: a year → create → copy.

   If a permission name isn't in the list exactly as written, pick the nearest and tell Claude which.

## Part 2 — OVHcloud: the server (A$6.29 a month + GST)

1. At **ovhcloud.com/en-au** → **VPS** → **VPS-1** (2 vCores, 4 GB RAM, 40 GB).
   - Location: **Sydney**. Image: **Ubuntu 24.04**. Billing: monthly.
   - If the order lets you add an **SSH key**, paste the whole contents of `ognistrada_deploy.pub`.
   - Skip the paid extras.
2. When the "your VPS is ready" email arrives, note its **IPv4 address** (four numbers like `51.161.12.34`).
3. If you couldn't add the SSH key while ordering, add it now with the password from that email:

   ```sh
   ssh-copy-id -i ~/.ssh/ognistrada_deploy.pub ubuntu@YOUR-IP
   ```

   (Or in OVH's control panel: the VPS → **Reinstall** → Ubuntu 24.04 with your SSH key.)
4. Check it works: `ssh -i ~/.ssh/ognistrada_deploy ubuntu@YOUR-IP` should log you in without a password. Type
   `exit`. That's all you do on the server: the setup workflow does the rest.

## Part 3 — PlanetScale: the database (about US$5 a month)

1. Sign up at **planetscale.com** → **New database** → **Postgres**.
   - Name `ognistrada`, region **AWS ap-southeast-2 (Sydney)**, cluster size **PS-5**.
   - **If PS-5 isn't offered in Sydney, or the price is much over US$5, stop and tell Claude** (the fallback is
     Neon in Sydney).
2. Turn on the **PostGIS** extension (the database's settings → **Extensions** → `postgis` → enable / apply).
3. **Connect** → create a password for the default (admin) role → copy the connection string for a **direct**
   connection (port **5432**, not the pooler's 6432). It looks like
   `postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=verify-full`. That's the secret `DATABASE_URL`.

## Part 4 — Resend: email (free)

1. Sign up at **resend.com** (you don't need to add the domain: the setup workflow does it).
2. **API Keys** → **Create API Key**:
   - `ognistrada setup`, permission **Full access** → that's `RESEND_API_KEY`.
   - `ognistrada production`, permission **Sending access** → that's `RESEND_SMTP_KEY`.

## Part 5 — GitHub: approvals, settings and secrets (free)

In the repository `limmylem/kugelsackracing` → **Settings**:

1. **Environments** → **New environment** → `production` → **Required reviewers**: tick and add yourself (don't tick
   "Prevent self-review") → **Save protection rules**. Every deploy to the live game then waits for your click.
2. **Environments** → **New environment** → `infra` → the same required reviewer → save.
3. **Secrets and variables** → **Actions**:

   **Variables** tab → **New repository variable** for each:

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_ACCOUNT_ID` | From Part 1, step 5 |
   | `SERVER_HOST` | The server's IPv4 address (Part 2) |
   | `TURNSTILE_SITE_KEY` | Turnstile's Site Key (Part 1, step 6) |

   **Secrets** tab → **New repository secret** for each:

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | The `ognistrada deploy` token |
   | `DEPLOY_SSH_KEY` | The whole contents of the private key file `ognistrada_deploy` (from `-----BEGIN` to `END…-----`) |
   | `DATABASE_URL` | PlanetScale's direct connection string |
   | `BETTER_AUTH_SECRET` | From Part 0 |
   | `EDGE_SECRET` | From Part 0 |
   | `BACKUP_PASSPHRASE` | From Part 0 |
   | `TURNSTILE_SECRET_KEY` | Turnstile's Secret Key |
   | `RESEND_SMTP_KEY` | Resend's sending key |
   | `ADMIN_EMAIL` | Your email: the account that becomes the owner (admin) online |
   | `ALERT_EMAIL` | Where alerts go (can be the same email) |

   **Environments** → `infra` → **Add environment secret** for each:

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_SETUP_TOKEN` | The `ognistrada setup` token |
   | `RESEND_API_KEY` | Resend's full-access key |

4. Tell Claude **"Parts 0–5 done"**.

---

## What happens next (Claude runs it; you approve)

6. **The setup workflow, dry run first** (`infra`): Claude runs it and shows you everything it *would* do — the
   site's HTTPS settings, the game's Pages project, the R2 buckets for map files and backups, the tunnel and its
   addresses, the email domain's records. You approve the run in GitHub (Actions → the run → **Review
   deployments**), check the list, then it runs for real.
7. **One more R2 key** (2 minutes, you): R2 → **Manage R2 API tokens** → **Create** → **Object Read & Write** on the
   buckets `ognistrada-tiles` and `ognistrada-backups` → add the two values as secrets `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY`.
8. **The server's setup** (`server-setup`, dry run first): Docker, automatic security updates, the firewall, the
   tunnel. Then **the first deploy** — you approve it.
9. **You sign up** at `ognistrada.com` with the `ADMIN_EMAIL` address, confirm the email, set up two-factor sign-in
   with your authenticator app. You're the owner: the admin page's **Launch** tab makes invite codes for your
   friends.
10. **Monitoring** (free accounts, 15 minutes): UptimeRobot (emails you if the site or server goes down), Sentry
    (emails you when errors spike), Healthchecks.io (emails you if the nightly backup stops). Claude gives you the
    exact monitors to add.
11. **The tests with a friend:** you on home Wi-Fi and a friend on a phone hotspot sign up with invite codes, get the
    verification emails, meet in free roam and race each other.

## Things to know

- **Approvals:** every deploy and every setup run waits in GitHub until you click **Approve** (you get an email).
- **Costs to watch:** OVH and PlanetScale bill monthly; Cloudflare R2 only past 10 GB (we use about 0.3 GB).
- **Renewals:** the domain at Namecheap (keep auto-renew on); the two Cloudflare tokens after a year (Claude will
  remind you; DEPLOYMENT.md "What expires").
- **If something breaks:** you'll get an email; the server restarts itself; any deploy can be rolled back in one
  step (Actions → **rollback**).
