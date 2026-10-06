# Notes for Claude

## Git workflow

- When a request is complete, commit the work and push it to `main` (in addition to any session branch):
  `git push origin HEAD:main`. Fast-forward only — fetch `main` first, and if it has moved on, merge it
  in before pushing; never force-push `main`.
- The pre-commit hook (`.githooks/pre-commit`) runs the data checks, model checks, physics tests and crash
  suite; let it run.

## Reminders for the user (raise them at the right time)

- **Deployment is paused**: the game runs on localhost only (Docker Compose) until multiplayer fully works. Don't
  run the `infra` workflow, deploy, or create accounts. Keep docs/DEPLOYMENT.md current, and put anything that needs
  real hosting (CDN, DNS, status page, hosting costs, real email) under its "To do when we deploy".

- **Hosting is on free plans** (docs/DEPLOYMENT.md). Remind the user to upgrade to at least the ~$13/month plan
  (Render Starter for the API; Render Postgres or Neon's paid plan) **before Phase 7 multiplayer testing or before
  inviting beta testers**, whichever comes first.
- **Phase 7 Step 1's tests** must include the deferred deployment check: two players on different networks (e.g. home
  Wi-Fi and a phone hotspot) sign in, join the same room and see each other. `rt.ognistrada.com` is only a ping/pong
  stand-in (server/src/rt/health.ts) until then.
- Stop and ask before anything that costs money, with a monthly cost estimate.
