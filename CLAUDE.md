# Notes for Claude

## Git workflow

- When a request is complete, commit the work and push it to `main` (in addition to any session branch):
  `git push origin HEAD:main`. Fast-forward only — fetch `main` first, and if it has moved on, merge it
  in before pushing; never force-push `main`.
- The pre-commit hook (`.githooks/pre-commit`) runs the data checks, model checks, physics tests and crash
  suite; let it run.
