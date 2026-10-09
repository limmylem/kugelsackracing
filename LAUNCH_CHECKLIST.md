# Launch checklist

What has to be true before the closed beta, and before opening to everyone. Built in Phase 6 Step 5.
- **[x]** done and tested on this computer.
- **[ ]** not done yet: most need the hosting being set up now (friends testing, Phase 7 Step 5: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/GO_LIVE.md](docs/GO_LIVE.md)), money, or a decision from the owner.

Work down it in order.

## 1. Decisions only the owner can make (blocking)

- [ ] **Players' minimum age.**
  - The owner's view: "they can be any age". The game still asks for a birth date and refuses under-13s, until a lawyer agrees.
  - Under 13 brings COPPA (US) and parental consent (GDPR article 8: 13–16 depending on the EU country; the UK's Children's Code).
  - Changing it is one setting (`minAge`), but needs the legal review first. See [docs/PRIVACY_DATA.md](docs/PRIVACY_DATA.md), open questions.
- [ ] **The privacy policy and terms** (`account/privacy.html`, `account/terms.html`) reviewed by a lawyer, for the EU, UK, US and Australia. They are drafts, marked as drafts. Before that review, fill in:
  - [ ] the operator's legal name and contact address;
  - [ ] the governing law;
  - [ ] the data transfers (the server and database are in Sydney now; Resend in Tokyo, Sentry in the US);
  - [ ] the breach process.
- [ ] **Self-hosting Google Fonts and the jsDelivr libraries**, or listing them in the privacy policy. Players' browsers send their IP address to both ([docs/PRIVACY_DATA.md](docs/PRIVACY_DATA.md)).
- [ ] **The car models' origin and licences** confirmed. The credits page lists them as the project's own; check before launch.
- [x] **The hosting chosen and bought by the owner** (2026-10-08): an OVHcloud VPS-1 and PlanetScale Postgres PS-5, both in Sydney, about US$10.50–11.50 a month in all ([docs/COSTS.md](docs/COSTS.md)). GO_LIVE.md Parts 0–5 done.

## 2. Security ([docs/SECURITY.md](docs/SECURITY.md))

- [x] Every endpoint reviewed against the OWASP Top 10. Every endpoint that takes an id checks the player owns it.
- [x] Editors and admins need two-factor sign-in (an authenticator app), every 12 hours.
- [x] The client can't choose its own IP address. Session tokens never reach page scripts. `delete-user` is closed.
- [x] Content security policy without `'unsafe-inline'` scripts; security headers.
- [x] Secret scan of the files and the whole git history (none found); it runs in CI.
- [x] Dependency scan in CI (`security.yml`: high or critical fails).
- [ ] **Open, accepted:**
  - L3: sign-up says when an email already has an account;
  - L4: moderate advisories in development tools only.
- [x] Secrets made for production and kept in a password manager (`BETTER_AUTH_SECRET`, `BACKUP_PASSPHRASE`, `EDGE_SECRET`; GO_LIVE.md Part 0), and set in GitHub's secrets only (Part 5). `METRICS_TOKEN` isn't needed yet.

## 3. Abuse ([docs/ABUSE.md](docs/ABUSE.md))

- [x] Bot check (Cloudflare Turnstile) on sign-up, guests and sign-in. It's required in production, so it refuses rather than letting bots through.
- [x] **Turnstile keys made and set** (`TURNSTILE_SITE_KEY` a variable, `TURNSTILE_SECRET_KEY` a secret). Free.
- [x] Multi-account detection (the IP address plus a random device id): it flags for an admin, never bans by itself.
- [x] Rate limits reviewed: per address and per account, and enough for 500 players.
- [ ] Cloudflare's WAF rate rules and Bot Fight Mode switched on (ABUSE.md lists the rules). Free.
- [x] Player reports, with an admin queue. Offensive and reserved names are refused.

## 4. Privacy ([docs/PRIVACY_DATA.md](docs/PRIVACY_DATA.md))

- [x] Data inventory: everything stored, why, and for how long.
- [x] Cookie audit: only the sign-in and security cookies, which are essential, so no consent banner (test: `privacy.test.ts`).
- [x] Retention jobs run daily: guests 30 days, signals 90, support a year, the audit log 2 years.
- [x] A copy of my data and account deletion cover every table.
- [x] Credits and licences page (`/account/credits.html`). CI checks it's up to date.

## 5. Monitoring ([docs/OPERATIONS.md](docs/OPERATIONS.md))

- [x] Admin dashboard (Monitoring tab), and `/api/v1/metrics` for an outside dashboard.
- [x] Alerts: errors, slow answers, the database, the verification queue, the economy's money. Email and phone, tested.
- [x] `ALERT_EMAIL` set (a GitHub secret; each deploy puts it on the server). Alerts include the real-time server going quiet.
- [ ] `ALERT_WEBHOOK_URL` (a phone, through an ntfy topic): optional, not passed by the deploy yet.
- [x] Public status page (`/site/status.html`).
- [ ] UptimeRobot's four monitors (the game; `/api/v1/status` with `"api":"up"` and with `"rt":"up"`; `rt.ognistrada.com/health` with `"ok":true`), Sentry's DSNs and Healthchecks.io for the backup (GO_LIVE.md step 10; [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#monitoring-and-alerts)). Free.

## 6. Reliability ([docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md))

- [x] Nightly encrypted backups, each one restored to check it, kept 35 days in the private R2 bucket `ognistrada-backups`.
- [x] Disaster recovery drill passes. The database is lost and restored, every row and balance checks, and players and the admin sign in again (`npm run drill:dr -w @kr/server`, in CI).
- [ ] **Point-in-time recovery:** included with PlanetScale; check its window on PS-5 in the dashboard ([docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md)).
- [ ] The restore drill run once online (Actions → backup with *drill*), then every 3 months.
- [x] Safe deploys: CI, then production with the owner's approval (there's no staging). Migrations only add (a test checks it). The real-time server finishes its races before it stops for a deploy.
- [x] One-click rollback, with the rollback drill passing (`npm run drill:rollback -w @kr/server`, in CI).
- [x] Feature switches with gradual rollout, maintenance mode, and "please refresh" for old versions of the game.

## 7. Performance and costs ([reports/load-test.md](reports/load-test.md), [docs/COSTS.md](docs/COSTS.md))

- [x] 500 players at once, through the whole game: every step's p95 under 210 ms, no errors, books balanced.
- [x] When the database's connections run out, requests get `503 BUSY` (try again) instead of failing.
- [x] Cost per 1,000 players estimated: about $15–20 a month.
- [ ] Budget alerts set on every paid service (COSTS.md lists them).
- [ ] The load test run online: the `loadtest` workflow (20 online bots, free roam and races).

## 8. Support

- [x] "Contact support" on the account page, and an in-game Feedback button. Both send the game's version and the device.
- [x] Admin: support and feedback queue, answered by email; search any player; a player's full history.

## 9. The closed beta

- [x] Closed beta on: sign-up needs an invite code (production starts with it on).
- [x] Invite codes made, revoked and tracked (who used which) on the admin page's Launch tab.
- [ ] Real email (Resend, the `infra` workflow's email step) set up, so invites and verification emails arrive.
- [ ] Deployed to production: `infra`, the R2 key, `server-setup`, the first deploy (GO_LIVE.md steps 6–8), then **check** passing.
- [ ] The owner signed up with `ADMIN_EMAIL`, two-factor sign-in on (GO_LIVE.md step 9).
- [ ] The two-network check: two players on different networks (home Wi-Fi and a phone hotspot) sign up with invite codes, get the verification emails, meet in free roam and race each other.
- [ ] First invite codes made and sent.

## 10. Tests (every phase)

- [x] `npm run test:server`: the server, including the security, abuse, privacy and operations tests.
- [x] `npm test`, `npm run test:unit`, `npm run test:all` and every phase's suites. Three fail exactly as they did before Step 5: quest stress timings, one economy balance target and the known NPC stuck spots ([docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)).
- [x] Browser tests: accounts, economy, shop, deploy layout, and the launch screens (`npm run test:browser:launch -w @kr/server`).
- [x] DR drill, rollback drill, load test report.

## Opening to everyone (after the beta)

- [ ] Everything in section 1 decided.
- [ ] Closed beta switched off (Launch tab).
- [ ] HSTS and DMARC tightened ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), "Once everything works").
- [ ] A bigger server, or a second one, if the beta's Monitoring numbers say so (COSTS.md; ask first).
