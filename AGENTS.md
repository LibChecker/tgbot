# Agent Instructions

- Before creating any git commit, run `npm run deploy:preflight -- --target=preview` from the repository root and make sure it passes.
- If the commit changes production deploy behavior or production-only configuration, also run `npm run deploy:preflight -- --target=production` before committing.
