# Agent Instructions

## First Read

- This is a private npm workspace for a Cloudflare Telegram APK bot plus a separate Cloudflare Pages APK Web UI.
- Read this file first, then use `README.md` for the human-facing product/deploy overview.
- The repository root is the npm workspace root. Run commands from the root unless a package-specific command is clearly needed.
- Be careful in dirty worktrees. Do not revert unrelated user changes.

## Project Map

| Area | Path | Runtime | What it owns |
| --- | --- | --- | --- |
| Telegram bot / Worker | `packages/bot-worker/` | Cloudflare Workers | Telegram webhook, APK URL preview, upload page, report pages, admin APIs, observability. |
| Browser Web UI | `packages/apk-webui/` | Cloudflare Pages + Vite | Browser-first APK analyzer UI, local Web Worker analysis, history/compare/report rendering, Pages Functions. |
| Shared analyzer | `packages/shared/` | Worker + browser | APK parsing, signatures, SDK marker matching, shared contracts, i18n runtime, generated rule/icon/catalog bundles. |
| Translations | `locales/` | Shared | Source-of-truth locale JSON for both bot and Web UI. |
| Deploy orchestration | `scripts/` | Node | Root Cloudflare preflight/deploy and size budget checks. |

## High-Value Entry Points

- Worker entry and Telegram flow: `packages/bot-worker/src/index.js`
- APK link preview/range parsing: `packages/bot-worker/src/apk-url-preview.js`
- Worker-hosted upload page: `packages/bot-worker/src/upload-view.js`
- Worker-hosted report page: `packages/bot-worker/src/report-viewer.js`
- Web UI shell: `packages/apk-webui/src/index.html`
- Web UI main controller: `packages/apk-webui/src/app.js`
- Web UI element collection/view helpers: `packages/apk-webui/src/app/view.js`
- Web UI persisted history: `packages/apk-webui/src/app/history.js`
- Web UI compare mode: `packages/apk-webui/src/app/compare-controller.js`
- Web UI report rendering: `packages/apk-webui/src/app/report-renderer.js`
- Web UI analyzer worker: `packages/apk-webui/src/analyzer-worker.js`
- Shared APK parser: `packages/shared/src/apk.js`
- Shared signing parser: `packages/shared/src/apk-signatures.js`
- Shared SDK markers: `packages/shared/src/sdk-markers.js`
- Shared i18n runtime: `packages/shared/src/i18n.js`

## Common Commands

| Task | Command |
| --- | --- |
| Install deps | `npm install` |
| Full repo check | `npm run check` |
| Worker dev server | `npm run dev` |
| Web UI dev server | `npm run pages:dev` |
| Web UI check only | `npm run pages:check` |
| Web UI build | `npm run pages:build` |
| Generate ignored shared bundles | `npm run generated:generate` |
| Refresh LibChecker generated bundles | `npm run generated:refresh` |
| Check translations | `npm run i18n:check` |
| Generate translation catalogs | `npm run i18n:generate` |
| Deploy preflight, preview | `npm run deploy:preflight -- --target=preview` |
| Deploy preflight, production | `npm run deploy:preflight -- --target=production` |

## Commit And Deploy Rules

- Before creating any code commit, check whether `AGENTS.md` can be improved with reusable project knowledge, workflow constraints, or newly discovered pitfalls from the work. Update it when the added guidance would help future sessions; avoid churn for one-off details.
- Before creating any git commit, run `npm run deploy:preflight -- --target=preview` from the repository root and make sure it passes.
- If the commit changes production deploy behavior or production-only configuration, also run `npm run deploy:preflight -- --target=production` before committing.
- Root deploy commands are preferred over package deploy commands because they run checks, Web UI build, performance budgets, and Worker dry-run size budgets.
- Do not deploy or change Cloudflare/Telegram webhook state unless the user explicitly asks.

## Generated Files And Localization

- Edit `locales/en.json` and `locales/zh-Hans.json` for user-facing copy. Keep key trees and placeholders aligned.
- Runtime generated files live under `packages/shared/src/generated/` and are ignored by git. Do not hand-edit them.
- Scripts usually run `generated:generate` before checks/builds. If locale or generated-source behavior changes, run `npm run i18n:check` or `npm run check`.
- LibChecker rules/icons are large generated assets. Use `npm run generated:refresh` or `npm run rules:update` only when intentionally refreshing those bundles.

## Web UI Notes

- The UI is vanilla ESM, Vite, HTML, and CSS; there is no React framework.
- `app.js` owns most page state and event wiring. `app/state.js` defines initial state factories and shared constants.
- `app/view.js` centralizes DOM element lookup. Add new persistent DOM controls there before wiring them in `app.js`.
- Keep Web UI styles in `packages/apk-webui/src/app.css`; keep feature-specific lazy styles in their existing CSS files when already split.
- History, compare mode, report rendering, SDK icons, and LCAPPS flows have dedicated modules. Prefer extending those modules over adding more unrelated logic to `app.js`.
- Browser APK analysis should stay local to the Web UI worker. Server-side URL analysis belongs to the Worker/Pages Function boundary.

## Worker Notes

- `packages/bot-worker/src/index.js` is intentionally broad: webhook routing, Telegram response flow, admin routes, uploads, and report redirects.
- Keep remote APK URL/range preview logic in `apk-url-preview.js`.
- Keep Worker HTML page rendering in `upload-view.js` and `report-viewer.js`.
- Use `observability.js` helpers for structured logs and Analytics Engine fields; keep event field names within the allowed sets.
- Admin endpoints require `ADMIN_TOKEN`; do not weaken auth behavior.

## Shared Analyzer Notes

- Shared modules must stay runtime-compatible with both Cloudflare Workers and browser workers.
- Avoid Node-only APIs in `packages/shared/src/` unless guarded and already established.
- Parser contract changes should be reflected in `packages/shared/src/contracts.js` and both Worker/Web UI consumers.
- Add focused tests under `packages/shared/test/` when changing parser behavior or shared algorithms.

## Validation Guidance

- For narrow Web UI UI-only changes: run `npm run pages:check`; prefer `npm run pages:build` when HTML/CSS/assets or bundle behavior changes.
- For shared parser, i18n, contract, or cross-package changes: run `npm run check`.
- For Worker-only syntax/routing changes: run `npm run check --workspace @tgbot/bot-worker`, then broaden to `npm run check` if shared behavior or deploy behavior is touched.
- For deployment script, wrangler config, size-budget, or production/preview behavior changes: run the relevant deploy preflight command before committing.

## Conventions

- Keep code ESM and plain JavaScript.
- Prefer existing helper modules and local patterns over new dependencies.
- Avoid editing generated bundles, build output, or Cloudflare state unintentionally.
- Keep user-visible copy localized through `locales/*.json`.
- Keep CSS responsive and check narrow viewport behavior for Web UI layout changes.
