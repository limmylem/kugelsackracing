# Personal data: what the game keeps, why, where, who sees it, how long (Phase 6 Step 5)

The list behind the privacy policy (`account/privacy.html`) and the terms (`account/terms.html`). Both are
**drafts for legal review**: see [Open questions for the reviewer](#open-questions-for-the-reviewer). Keep
this file current: the release checklist ([SECURITY.md](SECURITY.md)) asks for any new personal data to be
added here before it ships.

**Where things are:**
- **The database:** PostgreSQL on Neon, AWS Asia Pacific (Singapore). Encrypted at rest by Neon. Backups are encrypted with AES-256 and kept 30 days ([SERVER.md](SERVER.md#backups)).
- **The server:** Render, Singapore.
- **The edge:** Cloudflare, worldwide.
- **Email:** Resend, Tokyo.
- **Errors:** Sentry, US.

All of these are paused until we deploy ([DEPLOYMENT.md](DEPLOYMENT.md)).

**Who can see it:**
- **The player:** their own data, all of it through "Download my data" (`GET /api/v1/me/export`).
- **Admins:** what's listed. Every view of a player's account or history is itself logged.
- **Editors:** only world content.
- **Other players:** only display names, results on leaderboards, and replays shared from them.
- **Nobody:** passwords (hashed), session tokens and two-factor secrets (encrypted).

## On the server

| Data | What exactly | Why (legal basis, GDPR/UK) | Where | Who can see it | Kept |
|---|---|---|---|---|---|
| Account | Email, display name, role, when made, email verified, terms version accepted and when, last name change, ban or suspension and its reason | Running the account (contract) | `users` | The player, admins | Until the account is deleted |
| Password | A scrypt hash (never the password) | Signing in (contract) | `accounts` | Nobody (never shown or exported) | Until deleted |
| Social sign-in | The Google or Discord account id, and the tokens they give (Better Auth keeps them; the game doesn't use them) | Signing in (contract) | `accounts` | Nobody; the provider id is in the export | Until deleted, or that sign-in removed |
| Date of birth | **Not kept.** Checked against the minimum age at sign-up, then dropped | Age rule (legal obligation) | — | — | — |
| Two-factor sign-in | Whether it's on; the authenticator's secret and backup codes (encrypted with the server's secret) | Protecting accounts, required for editors and admins (legitimate interest; contract) | `users`, `two_factors` | Nobody (the on/off is in the export) | Until turned off or the account deleted |
| Sessions | Each sign-in: its internet address, browser (user agent), when made and last used, expiry, and when it passed two-factor | Staying signed in, "sign out everywhere", spotting a stolen account (contract; legitimate interest) | `sessions` | The player (export), admins (count, last seen) | 30 days from last use, then 7 days after expiry |
| Email links | Verification (1 day), password reset (1 hour), two-factor sign-in steps | Account security | `verifications` | Nobody | Until used or expired, then deleted daily |
| Game progress | The save: money, XP, level, cars, parts, builds, setups, damage, quest progress, hints seen, the money ledger, each item's history, runs and drives | Playing the game (contract) | `player_economy`, `ledger`, `owned_*`, `quest_progress`, `item_history`, `economy_sessions`, `player_recordings` | The player, admins | Until the account is deleted (guests: see below) |
| Results and records | Each run handed in, with its recording as evidence (positions over time), records, race replays the player keeps | Leaderboards, checking results are real (contract; legitimate interest in fair play) | `track_results`, `track_records`, `replays` | The player; display name and time on leaderboards to everyone; replays to anyone with the link | Until deleted (replays: the newest 50 and each record's) |
| World content | What editors made (quests, routes), with the author's id | Running the world (contract with editors) | `content_items`, `content_history` | Everyone (published), editors (drafts) | While the game runs. On deletion it stays, no longer linked to them. |
| Account links (abuse review) | The addresses each account played from, and a scrambled (HMAC) form of the game's random browser id, with first and last seen | Stopping multi-account farming and fraud (legitimate interest) | `account_signals` | Admins (addresses shown partly, the browser id never) | **90 days** from last seen |
| Abuse flags | The scan's flags: which accounts, why, admin review notes | Fraud prevention (legitimate interest) | `abuse_flags` | Admins | Reviewed ones 1 year after review; their id removed on account deletion |
| Reports | Reports a player makes (who, about whom, what they wrote, a race reference) and how admins resolved them | Moderation (legitimate interest) | `reports` | Admins. The reported player sees the reason and outcome in their export, never who reported them. | 1 year after resolved; the reporter's id removed if they delete their account |
| Support and feedback | The message, a category, a contact email (guests only, if given), and the game's version and device: browser, operating system, screen size, graphics card, memory, language, frame rate | Answering the player (contract; legitimate interest) | `support_tickets` | Admins | **1 year** |
| Invite codes | Which code an account used, and a scrambled form of the email that used it | Running the closed beta | `invite_uses` | Admins (the name, never the email) | 1 year |
| Admin log | Every admin action: who, whom, why, what changed | Accountability (legitimate interest; legal obligation) | `audit_log` | Admins; the player sees actions on their account in the export | **2 years** |
| Idempotency keys | The last day's write requests and their answers | Applying each action once | `idempotency_keys` | Nobody | 24 hours |
| Alerts | What went wrong on the server (no personal data) | Running the service | `alerts` | Admins | 90 days after clearing |

**Guest accounts** (playing without signing up) hold the same kinds of data. A guest nobody has played for
**30 days** is deleted with everything it had. Making a full account moves the guest's progress across.

## Outside the database

| Data | What | Where | Kept |
|---|---|---|---|
| Server logs | Each request: method, address with tokens and secret values removed, the player's internet address, status, time. Never passwords, cookies or tokens (`server/src/app.ts`). | Render's logs | Render's retention: 7 days on the starter plan |
| Error reports | Errors from the server and the game, with nothing personal: no name, email, address, cookies or typed text (`sendDefaultPii: false`, scrubbed in `beforeSend`) | Sentry (US) | Sentry's retention: 30 days on the free plan |
| Email | The email address, and the email itself (verification, password reset, support answers) | Resend (Tokyo); Mailpit on this computer | Resend's logs: 30 days |
| Bot check | Cloudflare Turnstile sees the browser's address and signals about the browser while checking it isn't a bot, under Cloudflare's privacy policy | Cloudflare | Cloudflare's policy |
| Edge | Cloudflare sees every request (DDoS protection, caching) | Cloudflare | Cloudflare's policy |
| Libraries and fonts | The game's pages load three.js, Rapier and MapLibre from jsDelivr, and its fonts from Google Fonts. Each sees the browser's address when it's fetched. | jsDelivr, Google | Their policies (see the open questions) |

## In the player's browser

No advertising or tracking cookies, and no analytics. `server/test/privacy.test.ts` fails if the server ever
sets a cookie that isn't one of these:

| Cookie | Why | Lasts |
|---|---|---|
| `kr.session_token` (`__Secure-` in production) | Keeps you signed in. httpOnly. | 30 days |
| `kr.session_data` | A short cached copy of the session, so each request needn't ask the database | Minutes |
| `kr.dont_remember` | "Don't remember me" | The browser session |
| `kr.two_factor` | Between your password and your authenticator code | 10 minutes |
| `kr_csrf` | Protects your requests from other sites. httpOnly, SameSite=Strict. | The browser session |

All of them are strictly necessary, so no consent banner is needed (ePrivacy Directive art. 5(3); UK PECR
reg. 6). If anything non-essential is ever added (analytics, say), it must ask first, and this table and the
test must change with it.

**Local storage and IndexedDB** (not sent anywhere, except the browser id):
- the game's settings (`driveWorld.settings.v1`, `driveWorld.questHud`, `driveWorld.questFilters`, the editor's bookmarks);
- the welcome screen seen (`kr.welcomed`);
- the random browser id (`kr.device`, sent as `x-kr-device` and kept only scrambled);
- downloaded map files;
- ghost recordings;
- the offline garage of the local-only game (`drive-world`).

## Rights, and how they're met

| Right | How |
|---|---|
| Access, portability (GDPR art. 15, 20; UK; CCPA "know"; APP 12) | "Download my data" on the account page: everything above that's theirs, as JSON |
| Correction (art. 16; CCPA; APP 13) | Display name on the account page. Anything else: Contact support. |
| Deletion (art. 17; CCPA "delete") | "Delete my account" on the account page, at once (`server/test/privacy.test.ts` checks every table). Backups roll off within 30 days. |
| Objection and restriction (art. 18, 21) | Contact support. An admin can suspend processing by suspending the account. |
| Complaint | To the EU data protection authority where they live, the UK's ICO, Australia's OAIC, or the US state attorney general |
| Not selling or sharing data (CCPA/CPRA) | Nothing is sold or shared for advertising. Nothing to opt out of. |

## The minimum age

- **The setting:** `minAge` in `server/config/*.json`, currently **13**.
  - Sign-up asks for a date of birth, checks it, and drops it.
  - Guests and social sign-ups confirm their age in the same way before they play.
- **The owner's view (2026-10-07): "any age".**
  - **Not applied, because it needs a legal decision.** Collecting an email or an IP address from children under 13 in the US needs verifiable parental consent (COPPA).
  - In the EU and UK, a child under 13 to 16 (by country) needs a parent's consent for the game to rely on consent at all. The UK Children's Code also applies to any game children are likely to play.
  - Allowing younger players needs parental consent flows and child-friendly defaults: names hidden on leaderboards, no free-text reports or support from children.
  - It's a one-line change in the config once that's decided.

## Open questions for the reviewer

1. **The minimum age**, above.
2. **The owner's legal identity** in the policy: the name and address of the controller, and the contact email.
   - GDPR art. 27: an EU representative may be needed if the game targets EU players. UK: a UK representative.
3. **Transfers out of the EU and UK** to Singapore (Render, Neon), the US (Sentry) and Japan (Resend):
   - which transfer mechanism each provider offers (SCCs, the UK IDTA addendum, the EU–Japan adequacy decision);
   - whether to pick EU regions instead (Neon and Render both have Frankfurt).
4. **Google Fonts and jsDelivr** see players' IP addresses. A German court (LG München, 2022) found that unlawful without consent.
   - Recommendation: serve the fonts and libraries from the game's own address (no cost, a small change).
   - Until then, a consent question may be needed for EU players.
5. **Abuse flags in the export:** they're left out (fraud prevention) and listed in the policy as kept. Is that the right reading of art. 15 and 23?
6. **Legitimate interests assessments** for account links (90 days), reports and the admin log (2 years): are the retention periods right?
7. **The terms:**
   - the governing law and courts;
   - the consumer-law wording for each country (the EU's unfair terms rules, the Australian Consumer Law's guarantees);
   - whether "no real-world value" for in-game money is enough if paid items are ever added.
8. **Breach notification:** 72 hours to the authority (GDPR art. 33). Australia's notifiable data breaches scheme. The US states' laws.
   - [OPERATIONS.md](OPERATIONS.md)'s incident steps include a notification step: who decides?
