# tgbot Agent Guide

Root instructions for coding agents in this repository. Keep this file
operational: durable project decisions, validation commands, module boundaries,
and recurring pitfalls only.

## First Read

- This is a private npm workspace for a Cloudflare Telegram APK bot and a
  separate Cloudflare Pages APK Web UI.
- Read this file first, then use `README.md` for human-facing product and deploy
  overview.
- Run commands from the repository root unless a package-specific command is
  clearly needed.
- Be careful in dirty worktrees. Never revert unrelated user changes.

## Project Map

| Area | Path | Runtime | What it owns |
| --- | --- | --- | --- |
| Telegram bot / Worker | `packages/bot-worker/` | Cloudflare Workers + Hono | Telegram webhook, APK URL preview, WebUI upload guidance, report data, admin APIs, observability. |
| Browser Web UI | `packages/apk-webui/` | Cloudflare Pages + Vite | Browser-first APK analyzer UI, local Web Worker analysis, history, compare, report rendering, Pages Functions. |
| Shared analyzer | `packages/shared/` | Worker + browser | APK parsing, signatures, SDK marker matching, shared contracts, i18n runtime, generated rule/icon/catalog bundles. |
| Translations | `locales/` | Shared | Source-of-truth locale JSON for both bot and Web UI. |
| Deploy orchestration | `scripts/` | Node | Root Cloudflare preflight/deploy and size budget checks. |

## High-Value Entry Points

- Worker entry and Telegram flow: `packages/bot-worker/src/index.js`
- APK link preview/range parsing: `packages/bot-worker/src/apk-url-preview.js`
- Worker R2 report storage: `packages/bot-worker/src/report-store.js`
- Web UI shell: `packages/apk-webui/src/index.html`
- Web UI controller: `packages/apk-webui/src/app.js`
- Web UI view helpers: `packages/apk-webui/src/app/view.js`
- Web UI report rendering: `packages/apk-webui/src/app/report-renderer.js`
- Web UI history: `packages/apk-webui/src/app/history.js`
- Web UI compare mode: `packages/apk-webui/src/app/compare-controller.js`
- Web UI analyzer worker: `packages/apk-webui/src/analyzer-worker.js`
- Web UI build/check scripts: `packages/apk-webui/scripts/build.mjs`,
  `packages/apk-webui/scripts/check.mjs`
- Shared APK parser: `packages/shared/src/apk.js`
- Shared signing parser: `packages/shared/src/apk-signatures.js`
- Shared SDK markers: `packages/shared/src/sdk-markers.js`
- Shared report model: `packages/shared/src/report-model.js`
- Shared i18n runtime: `packages/shared/src/i18n.js`

## Common Commands

| Task | Command |
| --- | --- |
| Install deps | `npm install` |
| Full repo check | `npm run check` |
| Worker dev server | `npm run dev` |
| Web UI dev server | `npm run pages:dev` |
| Web UI check | `npm run pages:check` |
| Web UI build | `npm run pages:build` |
| Performance budgets | `npm run perf:check` |
| JavaScript type checks | `npm run typecheck` |
| Web UI Chromium smoke tests | `npm run test:browser --workspace @tgbot/apk-webui` |
| Web UI WebKit smoke tests | `npm run test:browser:webkit --workspace @tgbot/apk-webui` |
| Generate ignored shared bundles | `npm run generated:generate` |
| Refresh LibChecker bundles | `npm run generated:refresh` |
| Check translations | `npm run i18n:check` |
| Preview deploy preflight | `npm run deploy:preflight -- --target=preview` |
| Production deploy preflight | `npm run deploy:preflight -- --target=production` |

## Core Product Decisions

- Browser file analysis runs locally in the Web UI worker.
- Server-side URL analysis belongs at the Worker/Pages Function boundary.
- Bot report buttons should open the Web UI. The Worker exposes report payloads
  through `/report-data` only.
- Bot report links use the short Web UI query parameter `r` for the opaque
  R2 report ref. The Web UI resolves it through the build-time
  `BOT_REPORT_DATA_ORIGIN`; do not reintroduce nested report-data URLs in query
  params.
- Remote APK URL preview is not a full local package analysis. APKS/APKM/XAPK
  containers may need inner APK extraction; for deflated inner APKs, return a
  clear unsupported/limited diagnostic instead of a misleading missing-manifest
  report.
- APKS/APKM/XAPK are ZIP containers. Local analysis should pick `base.apk` or
  the best main APK candidate; do not claim split manifests/resources are fully
  merged unless that is implemented.

## Web UI Rules

- The UI is vanilla ESM, Vite, HTML, and CSS; there is no React framework.
- `app.js` owns most page state and event wiring. Extract only when it removes
  real complexity or protects first-screen bundle size.
- Keep persistent DOM lookups in `packages/apk-webui/src/app/view.js`.
- Keep styles in `packages/apk-webui/src/app.css`; keep feature-specific lazy
  styles in their existing CSS files.
- Report rendering, history, compare mode, SDK icons, runtime logs, and LCAPPS
  flows have dedicated modules. Prefer extending those over adding unrelated
  code to `app.js`.
- Keep shared report view-model code lazy-loaded through `report-renderer.js`.
  Do not re-export it from first-screen `app/report-model.js`, or entry JS can
  fail perf budgets.
- New `src/app/*.js` modules must be copied or bundled into `dist`; rely on the
  package check script, which scans Web UI `src/` and `scripts/`.
- Static Web UI text should stay non-selectable. Only report/data values should
  opt into selection through `app-data-text` or an equivalent narrow selector.
- Runtime log UI is page-session frontend diagnostics only: live, capped, not
  Cloudflare logs, and not persisted across refresh. Keep export/share/download
  lazy-loaded.
- Playwright browser smoke tests build and serve `dist`, while `perf:check`
  remains browserless. Keep Chromium on the PR path and WebKit as a separate
  opt-in or scheduled check.
- Browser smoke tests include automated axe WCAG A/AA checks for the first
  screen, analyzed report, and populated compare view; keep semantic keyboard
  checks because automated accessibility scans are not exhaustive.
- `scripts/benchmark.mjs` uses Playwright with an installed system Chrome while
  preserving its CLI and JSON result contract. Compare runner changes on the
  same machine and sample before accepting performance drift.
- `site-config.mjs` reads public Web UI origins from environment variables. Do
  not hard-code private preview or production hostnames.

## Web UI Interaction Rules

- Segmented controls use the established title-bar pill geometry: real capsule
  ends, inset-shadow borders, stable inner inset, and separate click/drag paths.
- Gate hover-only highlights behind `(hover: hover) and (pointer: fine)`.
  Clear touch active classes on `pointerup`, `pointercancel`, and blur.
- Keep fixed mobile topbar paths free of expensive compositor triggers such as
  `contain: paint`, forced transforms, `will-change`, and backdrop blur.
- iOS/iPadOS file pickers can gray out `.apk/.apks/.apkm/.xapk` when `accept`
  is set. Use `file-picker-support.js` to relax picker filtering on Apple
  mobile WebKit while keeping in-app validation.
- Liquid/glass effects must be capability- and power-mode gated, not OS-name
  gated. Keep fallback reasons in `liquid-glass-support.js`.
- Web UI CSS/JS budgets are intentionally tight. Before raising a budget, prefer
  lazy loading, deleting duplicate rules, or consolidating existing tokens.

## Worker Rules

- Worker HTTP routing is Hono-based. Keep route declarations near the top of
  `packages/bot-worker/src/index.js`, use `context.env` and
  `context.executionCtx`, and leave heavy logic in existing modules/functions.
- Keep remote APK URL/range preview logic in `apk-url-preview.js`.
- Bot-side APK file uploads should guide users to the Web UI; local file
  analysis belongs in the browser worker.
- Store bot report data through `report-store.js`; keep the Web UI-facing data
  shape validated with shared contracts.
- Use `observability.js` helpers for structured logs and Analytics Engine
  fields. Event field names stay English, low-sensitive, and whitelist-shaped.
- Cloudflare Analytics Engine exposes only `blob1`-`blob20` and
  `double1`-`double20`. Keep blob/double key arrays at 20 entries or fewer and
  let checks catch overflow.
- Admin endpoints require `ADMIN_TOKEN`; do not weaken auth behavior.
- Keep fast pure tests on `node:test`. Use the Cloudflare Vitest Workers pool
  only for runtime-sensitive Worker and Pages Function behavior such as R2,
  bindings, CORS, and request limits.

## Shared Analyzer Rules

- Shared modules must stay compatible with both Cloudflare Workers and browser
  workers.
- Avoid Node-only APIs in `packages/shared/src/` unless guarded and already
  established.
- Parser contract changes should update `packages/shared/src/contracts.js` and
  both Worker/Web UI consumers.
- Add focused tests under `packages/shared/test/` for parser behavior or shared
  algorithms.
- Adaptive icon rendering must handle bitmap, vector, color, and shape
  drawables, including `solid` and `gradient` backgrounds.
- Vector drawables with stroke-only paths must preserve `fill="none"` instead
  of defaulting missing `fillColor` to black.
- Vector drawables with `fillType="evenOdd"` must preserve SVG
  `fill-rule="evenodd"` and `clip-rule="evenodd"`.

## Localization And Generated Files

- Edit the matching `locales/*.json` catalog for user-facing copy. Keep every
  translated catalog's key tree and placeholders aligned with `locales/en.json`.
- Runtime fallback uses the default `locales/en.json` catalog. Every
  `locales/*.json` file becomes a supported locale; keep region or legacy tags
  only as compatibility aliases that normalize to a canonical catalog filename.
- Telegram command registration accepts only two-letter language codes; derive
  and deduplicate them from catalog locale tags instead of passing full tags.
- Static HTML fallback text matches the default catalog because Web UI runtime
  i18n applies after load.
- Keep translated strings concise and follow the punctuation style already
  established by the surrounding catalog.
- `packages/shared/src/generated/` is ignored generated output. Do not hand-edit
  it.
- Wrangler `.wrangler/types/worker-configuration.d.ts` files are ignored
  generated output. Package `typecheck` scripts regenerate them from the
  current Wrangler config before running `tsc`; do not commit or hand-edit them.
- Scripts usually run `generated:generate` before checks/builds.
- Keep LibChecker rules/icon generation archive-based, not one
  raw.githubusercontent.com request per file; GitHub Actions can hit HTTP 429.
- Keep `generate_libchecker_bundle.py` compatible with current upstream
  `IconResMap.kt` formats and fail fast on suspiciously low icon counts.
- Do not add custom metadata fields to Crowdin JSON locale files.

## Deploy Rules

- Root deploy commands are preferred because they run checks, Web UI build,
  performance budgets, and Worker dry-run size budgets.
- Cloudflare Pages deploys must run from `packages/apk-webui/` with relative
  `dist`, or `functions/` may not deploy. If production `/url-report` returns
  `405`, verify deploy cwd first.
- Do not deploy or change Cloudflare/Telegram webhook state unless explicitly
  asked.
- Preview bot deployments use `TEST_BOT_TOKEN` for `tgbot-preview`; never point
  production `BOT_TOKEN` webhook at preview.
- Worker custom domains come from `PREVIEW_WORKER_URL` and `WORKER_URL`.
- Web UI origins come from `PREVIEW_WEBUI_SITE_URL` or `WEBUI_SITE_URL`.
- Web UI bot report data origins are injected from `PREVIEW_WORKER_URL` or
  `WORKER_URL` at build time.
- Report sharing depends on the Worker `REPORT_DATA_BUCKET` R2 binding. Keep
  preview and production report buckets separate.
- Root deploy registers configured Web UI custom domains through the
  Cloudflare Pages Domains API. For preview custom domains, keep DNS proxied and
  pointed at the Pages branch alias.
- Preview bot report links must use `PREVIEW_WEBUI_SITE_URL` or the Pages
  branch preview alias; do not fall back to the production Web UI origin.
- Do not hard-code private preview or production hostnames in repo config,
  workflows, bot links, or `site-config.mjs`.
- Windows Node deploy scripts must spawn command shims explicitly, such as
  `npm.cmd` and `node_modules/.bin/wrangler.cmd`.

## Validation Guidance

- Web UI UI-only changes: run `npm run pages:check`; prefer
  `npm run pages:build` when HTML/CSS/assets or bundle behavior changes.
- Web UI bundle-size or first-screen changes: also run `npm run perf:check`.
- Worker-only routing/syntax changes: run
  `npm run check --workspace @tgbot/bot-worker`.
- Shared parser/i18n/contract/cross-package changes: run `npm run check`.
- Runtime-sensitive Worker or Pages Function changes: run each package's
  `npm run test:runtime` in addition to its fast `node:test` suite.
- Browser interaction changes: run the Chromium smoke suite. Run the separate
  WebKit suite when the change affects WebKit-specific behavior.
- Deployment script, Wrangler config, size-budget, or production/preview
  behavior changes: run the relevant deploy preflight command.
- Before trusting `npm run perf:check` or preflight output, scan the full budget
  table and verify every row is `OK`.
- Wrangler may emit non-fatal `EPERM` log-write warnings under sandboxed macOS
  paths. Treat them as noise only when exit status is 0, preflight reports
  passed, and all budget/check rows are `OK`.
- For rendered Web UI validation, use the exact Vite `Local:` URL and confirm it
  returns `200 OK` before browser checks. Restart stale Vite servers or use a new
  port before drawing conclusions.
- Use the Codex Browser plugin first for local Web UI checks. If it is blocked
  or crashes, record that blocker and use code-level validation.

## Commit Rules

- Before committing, run `npm run deploy:preflight -- --target=preview`.
- If the change affects production deploy behavior or production-only config,
  also run `npm run deploy:preflight -- --target=production`.
- Inspect `git diff --cached --stat` before committing.
- Consider whether this file needs durable updates, but avoid one-off notes.
- Do not commit generated bundles, build output, caches, `.DS_Store`, or local
  temporary files.
- In this sandbox, `git add` and `git commit` may need escalation because
  writing `.git/index.lock` can be blocked.

## Agent Workflow

1. Start with `git status --short`.
2. Inspect the smallest relevant area with `rg` or `rg --files`.
3. Read existing local patterns before editing.
4. Keep edits focused and avoid unrelated refactors or generated-output churn.
5. Run the narrowest relevant validation command, then report exactly what
   passed, failed, or was skipped.

## Compact Instructions

If context is compacted, preserve these facts:

- Current user request and exact screenshots, paths, URLs, issue links, or
  commits.
- Files read and files changed.
- Commands run and pass/fail/blocker results.
- Current dev server URL and whether it may be stale.
- Current git status and whether changes are user-owned or agent-owned.
- Any Cloudflare, Telegram webhook, or deployment state that must not be guessed.
