# Launch: the last tests, launch day and the first week (Phase 8 Step 4)

How the game goes from the friends' closed beta to open to everyone, and what to watch once it is. It leans on what's
already built: the deploy with approval and one-click rollback ([OPERATIONS.md](OPERATIONS.md)), the alerts and the
Monitoring tab, maintenance mode and the status page, the admin's Live tab for news and notices
([LIVE_UPDATES.md](LIVE_UPDATES.md)) and its Statistics tab ([ANALYTICS.md](ANALYTICS.md)). The checklist to tick is
[LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md).

**Opening to everyone is the owner's decision**, made when the checklist's "Opening to everyone" section is done —
the legal review above all. Nothing here costs money; a bigger server would, and is asked about first
([COSTS.md](COSTS.md)).

## 1. The last tests (before opening)

Each has a command or workflow; all run in CI, the slow ones beside each deploy.

| What | How | Passing means |
|---|---|---|
| Every suite | `npm run test:all`, `npm run test:server`, `npm run test:unit` | As in LAUNCH_CHECKLIST.md section 10 (the known failures listed there, no new ones) |
| Every browser | `browsers.yml` (Linux: Chromium, Chrome, Edge, Firefox, WebKit; macOS: Safari's WebKit, Chromium) | The game runs and drives in each; an old browser is told what to use |
| The new player's first minutes | `node tools/first-launch-browser.mjs` (the game's first launch in a browser) and `npm run test:browser:launch -w @kr/server` (the launch screens) | The warning, the starter car, the tutorial, settings, accessibility and the news panel work in a real browser |
| Load | the `loadtest` workflow, run once online (20 bots, free roam and races) and `npm run load-test:full -w @kr/server` locally (500 players) | Every step under its limit, no errors |
| Security | `security.yml` (dependencies, secrets, the history) and the OWASP review ([SECURITY.md](SECURITY.md)) | No high or critical findings; the accepted ones still accepted |
| Disaster recovery | Actions → backup with *drill*, online ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)) | The backup restores; every row and sign-in checks |
| Rollback | `npm run drill:rollback -w @kr/server` (in CI) and one real rollback rehearsed online in a quiet hour | The previous release back in under 5 minutes |
| The two-network check | Two players on different networks (home Wi-Fi and a phone hotspot) | Sign up with invites, get the emails, meet in free roam, race |
| Accessibility by hand | ACCESSIBILITY.md "Checking it" | Keyboard only, a screen reader, 200% text, each colour mode, reduced motion |

**The beta's own evidence**: before opening, a week of the friends' beta with the Statistics tab on (those who
agreed): where new players stop, the tutorial's and first steps' completion, crash and error rates by version, frame
rates by device. Fix what it shows first.

## 2. Launch day

**The day before**
- Deploy the launch build in the morning, not the evening, and only if CI is green. Check it online
  (`tools/check-deploy.mjs`, the live-look workflow) and play it for 15 minutes.
- Write the launch news item and the patch notes on the Live tab as drafts.
- Confirm the alerts still reach the owner's email (`ALERT_EMAIL`; the Monitoring tab lists the last ones sent).
- Back up by hand (Actions → backup) and note the release to roll back to.

**Opening**
1. Admin → Launch: switch the closed beta off (sign-up without an invite). Publish the launch news item.
2. Post the links (the landing page `/about/`, the press kit `/press/`) where the owner has chosen.
3. Watch for the first two hours: the Monitoring tab (errors, slow answers, the database, the real-time server),
   the support queue, the status page.

**If something breaks**
- **Errors climbing or the game unplayable after the deploy**: roll back (OPERATIONS.md "Rolling back"), post an
  outage notice on the Live tab, fix, deploy again.
- **Too many players for the server** (slow answers, `503 BUSY`, the real-time server's tick over budget): turn on
  the closed beta again to stop new sign-ups, post a notice; ask the owner about a bigger server with its monthly
  cost (COSTS.md) before buying anything.
- **Abuse** (spam sign-ups, cheating): Turnstile and the rate limits are on; the Reports & flags tab; turn the closed
  beta back on if it's a flood.
- **Email not arriving**: Resend's dashboard; the verification queue alert.

## 3. The first week

| Day | Look at | Do |
|---|---|---|
| Every day | Monitoring (errors, p95, the database, alerts), support and feedback, reports and flags | Answer support within a day; act on reports |
| Every day | Statistics: crash and error rates by version | A crash rate over 2% of sessions on a version is a fix today |
| Day 2 | Statistics: where new players stop, the tutorial's steps, first steps done or skipped | The biggest drop-off is the first fix |
| Day 3 | Frame rates by device and browser | A tier or browser under its target (PERFORMANCE.md) gets its preset lowered |
| Day 3 | Quests' finish rates | Too hard, too long or broken quests fixed or hidden |
| Day 4 | The economy dashboard | Money in and out as the targets say (ECONOMY_SERVER.md); nothing farmed |
| Day 5 | Coming back (day 1 and 7) | Compare with the beta's |
| Day 7 | Costs (Cloudflare, PlanetScale, OVHcloud, Resend) | Within COSTS.md's budget; if not, tell the owner before it grows |
| Day 7 | A patch with the week's fixes | Patch notes on the Live tab with the deploy's commit as its version |

**Keep the first week calm**: small, tested fixes; deploys in the morning; no big new features; one patch at the end
of the week rather than many small ones, unless something is broken.

## 4. After the first week

- Move the rest of the hard-coded English into `locales/` (the i18n check's ratchet) before any new language.
- Decide on the open questions in LAUNCH_CHECKLIST.md with the lawyer's answers.
- Plan the next region and the next features from what the Statistics and support say.
