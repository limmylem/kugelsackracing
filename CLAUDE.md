# Notes for Claude

## Git workflow

- When a request is complete, commit the work and push it to `main` (in addition to any session branch):
  `git push origin HEAD:main`. Fast-forward only — fetch `main` first, and if it has moved on, merge it
  in before pushing; never force-push `main`.
- The pre-commit hook (`.githooks/pre-commit`) runs the data checks, model checks, physics tests and crash
  suite; let it run.

## Deploys (the owner's choices, 2026-10-10)

- The quickest way every time: a deploy waits only for the fast checks and the image (server.yml); the slow tests run
  beside it, and a failure there is fixed (or rolled back) after.
- Every time a deploy is waiting for approval, give the owner the direct link to its run
  (https://github.com/limmylem/kugelsackracing/actions/runs/<id>) with "Review deployments → production → Approve and
  deploy". Cancel older deploys still waiting, so only the newest needs approving (each includes everything before it).

## Reminders for the user (raise them at the right time)

- **Going live for friends testing (Phase 7 Step 5, owner-approved 2026-10-08):** production only, no staging. One
  OVHcloud VPS-1 in Sydney (API + real-time server + Cloudflare Tunnel in Docker), PlanetScale Postgres PS-5 in Sydney,
  Cloudflare (DNS, Pages, R2, Turnstile, Tunnel), Resend; about US$10.50–11.50 a month in all (docs/DEPLOYMENT.md,
  docs/COSTS.md). The owner's step-by-step is docs/GO_LIVE.md: the owner makes every account and pays; setup and deploy
  workflows run only with the owner's approval, dry runs first. The owner and friends are in Australia (up to ~5
  playing at once); the domain is at Namecheap.
- **The repo is public:** never commit emails, tokens or secrets; they live in GitHub's secret settings only, and
  nobody should paste them into a chat.
- **The two-network check** (deferred since Phase 7 Step 1) is part of Step 5's tests: two players on different
  networks (home Wi-Fi and a phone hotspot) sign up with invite codes, get the verification emails, meet in free roam
  and race each other.
- Stop and ask before anything that costs money (a bigger server, a second server or region, Redis, paid plans of the
  free services, voice chat), with a monthly cost estimate.
