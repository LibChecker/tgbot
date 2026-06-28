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
- Web UI build script: `packages/apk-webui/scripts/build.mjs`
- Web UI package check script: `packages/apk-webui/scripts/check.mjs`
- Web UI element collection/view helpers: `packages/apk-webui/src/app/view.js`
- Web UI runtime i18n/non-translatable constants: `packages/apk-webui/src/app/i18n.js`
- Web UI persisted history: `packages/apk-webui/src/app/history.js`
- Web UI compare mode: `packages/apk-webui/src/app/compare-controller.js`
- Web UI report rendering: `packages/apk-webui/src/app/report-renderer.js`
- Web UI optional effects gates: `packages/apk-webui/src/app/liquid-glass-support.js`, `packages/apk-webui/src/app/file-picker-support.js`
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
- Cloudflare Pages deploys must run from `packages/apk-webui/` with its relative `dist` so `functions/` are discovered. If production `/url-report` returns `405`, suspect Pages Functions were not deployed and verify the deploy cwd before changing route logic.
- Do not deploy or change Cloudflare/Telegram webhook state unless the user explicitly asks.
- In this sandbox, `git add` and `git commit` may need escalation because writing `.git/index.lock` is blocked. Confirm staged diff boundaries before escalating.
- Preflight success requires every check table row, especially `npm run perf:check` size budgets, to be `OK`. Treat any `FAIL` budget row as a real preflight failure even if later logs include Wrangler dry-run output.
- Wrangler can emit non-fatal `EPERM` log-write warnings under sandboxed macOS paths. Treat these as noise only when command exit status is 0, the preflight reports passed, and all budget/check rows are `OK`.
- Windows Node deploy scripts must spawn command shims explicitly, such as `npm.cmd` and `node_modules/.bin/wrangler.cmd`; plain `spawn("npm")` or extensionless `.bin/wrangler` can fail before preflight starts.

## Generated Files And Localization

- Edit `locales/en.json` and `locales/zh-Hans.json` for user-facing copy. Keep key trees and placeholders aligned.
- The runtime fallback locale is English. `zh-Hans` is the Simplified Chinese locale id; keep `zh-CN` only as a compatibility input that normalizes to `zh-Hans`.
- Keep static HTML fallback text in English because the Web UI applies runtime i18n after load. Chinese copy belongs in `locales/zh-Hans.json`.
- Keep Chinese Simplified strings concise and do not add Chinese sentence-ending `。` unless the existing UI context explicitly needs one.
- Runtime generated files live under `packages/shared/src/generated/` and are ignored by git. Do not hand-edit them.
- Scripts usually run `generated:generate` before checks/builds. If locale or generated-source behavior changes, run `npm run i18n:check` or `npm run check`.
- LibChecker rules/icons are large generated assets. Use `npm run generated:refresh` or `npm run rules:update` only when intentionally refreshing those bundles.
- Do not add custom metadata fields to Crowdin JSON locale files; the generator expects string trees. For brand names, file extensions, protocol names, JSON field names, SDK/ABI/signing terms, and other non-translatable Web UI constants, use runtime constants such as `NON_TRANSLATABLE_MESSAGES` in `packages/apk-webui/src/app/i18n.js`.
- If using the Crowdin Translator MCP, it is configured as a remote MCP with `CROWDIN_API_TOKEN`; running Codex sessions may need a restart before a newly added MCP appears.

## Web UI Notes

- The UI is vanilla ESM, Vite, HTML, and CSS; there is no React framework.
- `app.js` owns most page state and event wiring. `app/state.js` defines initial state factories and shared constants.
- `app/view.js` centralizes DOM element lookup. Add new persistent DOM controls there before wiring them in `app.js`.
- Keep Web UI styles in `packages/apk-webui/src/app.css`; keep feature-specific lazy styles in their existing CSS files when already split.
- History, compare mode, report rendering, SDK icons, and LCAPPS flows have dedicated modules. Prefer extending those modules over adding more unrelated logic to `app.js`.
- Browser APK analysis should stay local to the Web UI worker. Server-side URL analysis belongs to the Worker/Pages Function boundary.
- Web UI Telegram/social preview metadata lives in `packages/apk-webui/src/index.html`; keep the stable preview image source at `packages/apk-webui/src/assets/social-preview.png` and copy it through `packages/apk-webui/scripts/build.mjs`.
- When adding a new Web UI `src/app/*.js` module, make sure the build path copies or bundles it into `dist`. A past refactor passed syntax checks but served a 404 module until `scripts/build.mjs` was updated.
- The Web UI check script auto-scans Web UI `src/` and `scripts/`. Keep it as the single package-level entrypoint instead of lengthening `package.json` with per-file `node --check` lists.
- Segmented controls should share the established title-bar pill geometry: real capsule ends (`border-radius: 999px` and `corner-shape: round` where used), inset-shadow borders instead of layout-affecting borders, consistent inner inset, and draggable thumb support when the paired control supports it. Keep click and drag paths separate so click transitions can animate and drag can follow the pointer.
- For touch UI, do not rely on mobile Safari clearing `:hover`. Gate hover-only highlights behind `(hover: hover) and (pointer: fine)`, and clear touch active classes on `pointerup`, `pointercancel`, and blur.
- For touch/mobile topbar stability, keep the fixed header path free of expensive compositor triggers such as `contain: paint`, forced transforms, `will-change`, and backdrop blur; iOS Safari can hide or jitter fixed headers during address-bar scroll when those are stacked together.
- iOS/iPadOS file pickers can gray out `.apk/.apks/.apkm/.xapk` when `accept` is set. Use the existing `file-picker-support.js` path to relax picker filtering on Apple mobile WebKit while preserving in-app file validation.
- Liquid/glass-like effects must be capability- and power-mode gated, not OS-name gated. `CSS.supports()` can be a false positive for SVG-backed backdrop filters on Android/iOS browser shells; keep explicit fallback reasons in `liquid-glass-support.js` and prefer old stable backgrounds when rendering is suspect.
- WebUI CSS gzip budget is intentionally tight. Before raising the budget, prefer lazy CSS for non-first-screen UI (`runtime-log.css`, `lcapps-bubble.css`), removing duplicated control rules, or consolidating existing tokens. A modest budget raise is acceptable only when the transferred gzip size and first-screen impact are understood.
- Runtime log UI is page-session frontend diagnostics only: live while the page is open, capped, not Cloudflare logs, and not persisted across refresh. Keep runtime log event names/fields in English; localize only visible labels.
- Keep runtime log export/share/download code lazy-loaded; it is not first-screen behavior and can tip the tight initial JS gzip budget.
- For slow Web UI link analysis, inspect runtime log split timings (`client_duration_ms`, `server_duration_ms`, `fetch_headers_ms`, `response_text_ms`, `json_parse_ms`, `render_ms`) before blaming rendering, history writes, or remote parsing. Large reports can justify moving noncritical work off the visible-result path, but they are not evidence of multi-second stalls by themselves.
- Static Web UI text should stay non-selectable for drag/long-press copy. Only application/report data values should opt into selection, using the existing `app-data-text` whitelist class or an equivalent narrowly scoped report-data selector.

## Worker Notes

- `packages/bot-worker/src/index.js` is intentionally broad: webhook routing, Telegram response flow, admin routes, uploads, and report redirects.
- Worker HTTP routing is Hono-based. Keep route declarations near the top of `index.js`, use `context.env` and `context.executionCtx`, and leave heavy business logic in existing handler modules/functions.
- Keep remote APK URL/range preview logic in `apk-url-preview.js`.
- Remote URL preview is not the same as full local package analysis. APKS/APKM/XAPK containers may need inner APK extraction; range parsing works best for direct APKs or stored inner APK entries. For deflated inner APKs, return a clear unsupported/limited diagnostic rather than a misleading "missing AndroidManifest.xml" report.
- Keep Worker HTML page rendering in `upload-view.js` and `report-viewer.js`.
- Use `observability.js` helpers for structured logs and Analytics Engine fields; keep event field names within the allowed sets.
- Keep logs and troubleshooting diagnostics in English. User-facing errors should be localized through error codes/messages; analytics fields should stay low-sensitive and whitelist-shaped.
- Admin endpoints require `ADMIN_TOKEN`; do not weaken auth behavior.

## Shared Analyzer Notes

- Shared modules must stay runtime-compatible with both Cloudflare Workers and browser workers.
- Avoid Node-only APIs in `packages/shared/src/` unless guarded and already established.
- Parser contract changes should be reflected in `packages/shared/src/contracts.js` and both Worker/Web UI consumers.
- Add focused tests under `packages/shared/test/` when changing parser behavior or shared algorithms.
- APKS/APKM/XAPK are ZIP containers. Local analysis should pick `base.apk` or the best main APK candidate; do not pretend split manifests/resources are fully merged unless that is actually implemented.
- Adaptive icon rendering must handle bitmap/vector/color plus shape drawables, including `solid` and `gradient` backgrounds. White foreground-only icons often mean the adaptive background layer was skipped.
- Vector drawables with stroke-only paths must not silently default missing `fillColor` to black. Preserve `fill="none"` for pure stroked paths and add parser tests for icon regressions.
- Vector drawable paths with `fillType="evenOdd"` must preserve SVG `fill-rule="evenodd"`/`clip-rule="evenodd"` or hollow rings can render as solid fills.

## Validation Guidance

- For narrow Web UI UI-only changes: run `npm run pages:check`; prefer `npm run pages:build` when HTML/CSS/assets or bundle behavior changes.
- For Web UI visual or bundle-size work, also run `npm run perf:check` when CSS/JS size, lazy CSS, first-screen assets, or animated effects changed.
- When reading `npm run perf:check` or deploy preflight output, scan the full performance budget table and verify all rows are `OK`; do not rely only on the final Worker dry-run or upload-size lines.
- For rendered Web UI validation, start or inspect `npm run pages:dev` and use the exact Vite `Local:` URL. Do not assume port `5173`; first confirm the chosen URL returns `200 OK` with `curl -I`.
- If a long-lived dev server appears stale, restart it or use a cache-busting URL/new port before drawing conclusions. Vite/HMR and browser caches have previously served old `app.js`/`app.css`.
- Use the Codex Browser plugin first for local Web UI checks. If it reports `ERR_BLOCKED_BY_CLIENT`, `Browser Use URL policy`, a crashed tab, or repeated localhost navigation timeouts, record that blocker and ask the user before falling back to ordinary Playwright or another browser surface. Do not keep retrying blocked localhost URLs in a loop.
- The Codex Browser runtime often supports `load`/`domcontentloaded`, but not always `networkidle`; prefer the supported states. Screenshots can time out even when DOM/CSS checks work.
- When Browser cannot render the local app, still run code-level validation (`npm run pages:check`, `npm run pages:build`, and targeted CSSOM/DOM checks when possible) and clearly state what was not visually verified.
- For shared parser, i18n, contract, or cross-package changes: run `npm run check`.
- For Worker-only syntax/routing changes: run `npm run check --workspace @tgbot/bot-worker`, then broaden to `npm run check` if shared behavior or deploy behavior is touched.
- For deployment script, wrangler config, size-budget, or production/preview behavior changes: run the relevant deploy preflight command before committing.

## Conventions

- Keep code ESM and plain JavaScript.
- Prefer existing helper modules and local patterns over new dependencies.
- Avoid editing generated bundles, build output, or Cloudflare state unintentionally.
- Keep user-visible copy localized through `locales/*.json`.
- Keep CSS responsive and check narrow viewport behavior for Web UI layout changes.
