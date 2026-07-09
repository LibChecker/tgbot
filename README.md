# LibChecker APK Bot and Web UI

This repository contains two deployable parts:

| Part | Path | Platform | Purpose |
| --- | --- | --- | --- |
| tgbot | `packages/bot-worker/` | Cloudflare Workers | Telegram bot, APK link preview, upload page, report rendering, webhook/admin APIs. |
| Web UI | `packages/apk-webui/` | Cloudflare Pages | Standalone browser APK analyzer powered by the same parser and LibChecker rules. |
| Shared analyzer | `packages/shared/` | Worker and Pages | APK parser, signature parser, SDK marker runtime, and generated local bundles. |

## tgbot

The Worker bot accepts APK files, APK links, and direct uploads. It returns a short Telegram summary and a full LibChecker-style report page.

Key capabilities:

- Telegram webhook handling for private chats, groups, and channels.
- JavaScript APK parsing for manifest, resources, permissions, components, and native libraries.
- LibChecker-Rules-Bundle matching for SDK names, icons, and component markers.
- `/upload` for APKs that are too large for Telegram Bot API downloads.
- Protected admin APIs for webhook and command-menu management.
- Structured Worker logs and Analytics Engine events.

## Web UI

The Pages app is a separate browser-first APK analyzer. It runs the analysis locally in the browser through a Web Worker, so APK files do not need to be sent to the Telegram bot flow.

Key capabilities:

- Local APK analysis in the browser.
- Shared parser and generated local LibChecker rule bundles.
- Static Cloudflare Pages deployment.
- Independent development and deployment commands.

## Usage

- Send or forward an `.apk` file to the Telegram bot.
- Reply to an APK with `/apkinfo`.
- Send an APK download link for range-based preview parsing.
- Use `/upload` for larger files.
- Open the Web UI when you want browser-only local analysis.

Group behavior depends on Telegram Privacy Mode. For the most reliable group flow, use `/apkinfo@your_bot_name` or disable Privacy Mode in BotFather.

## Quick Start

Install workspace dependencies from the repository root:

```bash
npm install
```

Run the Worker bot locally:

```bash
npm run dev
```

Run the Web UI locally:

```bash
npm run pages:dev
```

## Worker Deployment

Configure Worker secrets:

```bash
npx wrangler secret put BOT_TOKEN --config packages/bot-worker/wrangler.toml --env production
npx wrangler secret put BOT_TOKEN --config packages/bot-worker/wrangler.toml --env preview
npx wrangler secret put ADMIN_TOKEN --config packages/bot-worker/wrangler.toml --env production
npx wrangler secret put ADMIN_TOKEN --config packages/bot-worker/wrangler.toml --env preview
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config packages/bot-worker/wrangler.toml --env production
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config packages/bot-worker/wrangler.toml --env preview
```

Use a dedicated test bot token for the preview environment. In GitHub Actions,
set `TEST_BOT_TOKEN`; the workflow syncs it into the preview Worker as
`BOT_TOKEN` so production `BOT_TOKEN` stays isolated.

`TELEGRAM_WEBHOOK_SECRET` is optional, but recommended for production.

Report sharing uses the `REPORT_DATA_BUCKET` R2 binding declared in
`packages/bot-worker/wrangler.toml`. Deploys use separate preview and
production buckets, and the deploy script creates the target bucket when it is
missing during a real deploy. The deploy `CLOUDFLARE_API_TOKEN` must include
R2 Admin Read & Write permission for bucket creation.

SDK custom emoji ids are runtime data. The sync and deploy scripts resolve a
Workers KV namespace named `tgbot-sdk-emojis`; real sync/deploy runs create it
automatically when it does not exist. Set `TELEGRAM_SDK_EMOJI_KV_NAMESPACE_NAME`
only if you want a different namespace name. When the KV binding or key is
absent, the Worker still lists SDK markers but omits custom emoji icons.

Run the deploy preflight locally before shipping:

```bash
npm run deploy:preflight -- --target=preview
npm run deploy:preflight -- --target=production
```

Deploy preview or production:

```bash
npm run deploy:preview
npm run deploy:production
```

Deploy production and register the Telegram webhook:

```bash
npm run deploy:setup
```

The Worker has explicit Wrangler environments in `packages/bot-worker/wrangler.toml`:

- `preview`: deploys `tgbot-preview` on `workers.dev`, binds the custom domain from repository variable `PREVIEW_WORKER_URL`, uses `Libchecker_TG_Bot_Preview`, uses `TEST_BOT_TOKEN` for preview bot testing, points report buttons at `PREVIEW_WEBUI_SITE_URL` or the Cloudflare Pages branch preview alias, registers the preview Web UI Pages custom domain when configured, and injects the preview Worker origin so Web UI report links can resolve `?r=...`.
- `production`: deploys `tgbot`, binds the custom domain from repository variable `WORKER_URL`, uses `Libchecker_TG_Bot`, injects that URL as `PUBLIC_WEBHOOK_URL`, points report buttons at `WEBUI_SITE_URL`, registers the production Web UI Pages custom domain when configured, and injects the production Worker origin so Web UI report links can resolve `?r=...`.

## Web UI Deployment

Build and deploy the Pages app directly:

```bash
npm run pages:build
npm run pages:deploy:preview
npm run pages:deploy:production
```

The root Cloudflare deploy commands are preferred because they always run `check`, WebUI build, WebUI performance budgets, and Worker dry-run size budgets before deployment. Pages preview deploys use the current branch name, while production deploys use the `main` branch.

The CI performance budget is intentionally lightweight and does not need a browser. It checks the built WebUI `dist/` output for:

- initial JS gzip size
- first-screen unique request count
- analyzer worker entry size and gzip size
- LibChecker rules/icons staying lazy-loaded from the first screen
- LibChecker rules-core, rules-detail, and SDK icons having exactly one materialized large chunk each

## Scripts

| Command | Area | Description |
| --- | --- | --- |
| `npm run dev` | tgbot | Start the Worker locally. |
| `npm run deploy` | Cloudflare | Alias for production deploy. |
| `npm run deploy:preflight` | Cloudflare | Run checks, WebUI build, WebUI performance budgets, and Worker dry-run budget. |
| `npm run deploy:preview` | Cloudflare | Deploy preview Worker and Pages. |
| `npm run deploy:production` | Cloudflare | Deploy production Worker and Pages. |
| `npm run deploy:setup` | Cloudflare | Deploy production, set webhook, and sync bot commands. |
| `npm run webhook:info` | tgbot | Show Telegram webhook status. |
| `npm run webhook:set` | tgbot | Register the Telegram webhook. |
| `npm run webhook:delete` | tgbot | Delete the Telegram webhook. |
| `npm run commands:set` | tgbot | Sync Telegram bot commands. |
| `npm run generated:generate` | shared | Generate ignored runtime bundles under `packages/shared/src/generated/`. |
| `npm run generated:refresh` | shared | Regenerate all ignored runtime bundles, including LibChecker rules and icons. |
| `npm run i18n:generate` | shared | Generate runtime i18n catalogs from `locales/*.json`. |
| `npm run i18n:check` | shared | Validate locale catalogs and any existing generated i18n catalog. |
| `npm run rules:update` | shared | Refresh generated LibChecker rules. |
| `npm run pages:dev` | Web UI | Run the Pages app locally. |
| `npm run pages:build` | Web UI | Build the Pages app. |
| `npm run pages:deploy` | Web UI | Alias for production Pages deploy. |
| `npm run pages:deploy:preview` | Web UI | Deploy a Pages preview branch. |
| `npm run pages:deploy:production` | Web UI | Deploy the production Pages branch. |
| `npm run perf:check` | Web UI | Validate WebUI dist performance budgets for CI. |
| `npm run size:check` | Web UI | Alias for `perf:check`. |
| `npm run check:workflows` | CI | Validate repository workflow guardrails. |
| `npm run check` | all | Validate shared modules, Worker, scripts, generated files, and Web UI. |

The repository root is the npm workspace root. Root scripts are compatibility shims that delegate to `@tgbot/bot-worker`, `@tgbot/apk-webui`, and `@tgbot/shared`.

## Localization

User-facing copy lives in `locales/*.json`. These files are the translation source of truth for both the Telegram bot and the Web UI.

- `locales/en.json` is the default runtime catalog.
- `locales/zh-Hans.json` is the Simplified Chinese catalog.
- `crowdin.yml` maps Crowdin translations to `locales/%locale%.json`.
- Runtime modules import ignored files under `packages/shared/src/generated/`; do not edit generated files by hand.

When contributing through GitHub PRs or Crowdin, edit or add locale JSON files only. Keep the same key tree as `locales/en.json`, and keep placeholders such as `{count}` or `{appName}` unchanged.

After changing translations, run:

```bash
npm run i18n:generate
npm run check
```

`packages/shared/src/generated/` is ignored by git. The dev, build, deploy, and check scripts generate the runtime bundles before they are needed.

## Admin API

All admin endpoints require either `Authorization: Bearer <ADMIN_TOKEN>` or `X-Admin-Token: <ADMIN_TOKEN>`.

```text
GET  /admin/webhook
POST /admin/webhook/set
POST /admin/webhook/delete
GET  /admin/commands
POST /admin/commands/set
POST /admin/commands/delete
```

## GitHub Actions

`.github/workflows/deploy.yml` checks both parts with `npm run check`, then deploys the Worker on pushes to `main` or `master`.

`.github/workflows/desktop-nightly.yml` packages the Web UI URL from `packages/apk-webui/site-config.mjs` with Pake into Windows x64 and macOS arm64 desktop installers. It runs nightly, can be triggered manually with a custom URL or `pake-cli` version, supports a `WEBUI_SITE_URL` repository variable override, and replaces assets on the reusable `nightly` prerelease.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`, including R2 Admin Read & Write for report bucket creation
- `CLOUDFLARE_ACCOUNT_ID`
- `BOT_TOKEN` for production
- `TEST_BOT_TOKEN` for preview bot testing
- `ADMIN_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_STICKER_OWNER_ID` for the SDK custom emoji sync workflow

Optional repository secret:

- `TEST_TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_SDK_EMOJI_KV_NAMESPACE_ID`, advanced override for an existing production KV namespace id.
- `PREVIEW_TELEGRAM_SDK_EMOJI_KV_NAMESPACE_ID`, advanced override for an existing preview KV namespace id.

Optional repository variable:

- `PREVIEW_WORKER_URL`, the full preview Worker URL used for the preview custom domain, test bot webhook, and Web UI report-data origin.
- `WORKER_URL`, the full production Worker URL used for the production custom domain, bot webhook, and Web UI report-data origin.
- `PREVIEW_WEBUI_SITE_URL`, the optional full preview Web UI URL used by preview bot report buttons and preview metadata. When omitted, preview deploys use the Pages branch preview alias. For a custom preview domain, keep the DNS CNAME proxied and pointed at the Pages branch alias, for example `<branch-alias>.tgbot-apk-webui.pages.dev`.
- `WEBUI_SITE_URL`, the full production Web UI URL used by production bot report buttons and Web UI metadata.
- `TELEGRAM_SDK_EMOJI_KV_NAMESPACE_NAME`, optional namespace name override for SDK custom emoji ids. Defaults to `tgbot-sdk-emojis`.
- `PREVIEW_TELEGRAM_SDK_EMOJI_KV_NAMESPACE_NAME`, optional preview namespace name override.

## Project Layout

```text
packages/
  bot-worker/        Cloudflare Worker workspace package
    src/
      index.js       Worker entry, Telegram webhook, admin API
      apk-url-preview.js APK link preview parser
      report-store.js R2 report data storage
      upload-view.js Worker-hosted upload page
      observability.js Logs and Analytics Engine events
    scripts/         Worker admin and webhook helpers
    wrangler.toml    Worker deployment config
  apk-webui/         Web UI Pages workspace package
    src/             Browser UI and analyzer worker
    functions/       Pages Functions endpoints
    scripts/         Web UI build, check, and benchmark helpers
    wrangler.jsonc   Pages deployment config
  shared/            Shared analyzer workspace package
    src/
      apk.js         APK, manifest, resources, and icon parser
      apk-signatures.js APK signing block, X.509, and digest parser
      i18n.js        Shared localization runtime
      sdk-markers.js LibChecker SDK marker annotator
      generated/     Ignored generated i18n, LibChecker rule, and icon bundles
    scripts/         Shared asset generation helpers
locales/             Translation JSON catalogs
```
