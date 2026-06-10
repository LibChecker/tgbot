# LibChecker APK Bot and Web UI

This repository contains two deployable parts:

| Part | Path | Platform | Purpose |
| --- | --- | --- | --- |
| tgbot | `src/bot/` | Cloudflare Workers | Telegram bot, APK link preview, upload page, report rendering, webhook/admin APIs. |
| Web UI | `pages-apk-webui/` | Cloudflare Pages | Standalone browser APK analyzer powered by the same parser and LibChecker rules. |
| Shared analyzer | `src/shared/` | Worker and Pages | APK parser, signature parser, SDK marker runtime, and generated local bundles. |

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
npx wrangler secret put BOT_TOKEN
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAPH_ACCESS_TOKEN
```

`TELEGRAM_WEBHOOK_SECRET` and `TELEGRAPH_ACCESS_TOKEN` are optional, but recommended for production.

Deploy the Worker and register the Telegram webhook:

```bash
npm run deploy:setup
```

The public Worker URL is configured in `wrangler.toml` through `PUBLIC_WEBHOOK_URL`.

## Web UI Deployment

Build and deploy the Pages app:

```bash
npm run pages:build
npm run pages:deploy
```

## Scripts

| Command | Area | Description |
| --- | --- | --- |
| `npm run dev` | tgbot | Start the Worker locally. |
| `npm run deploy` | tgbot | Deploy the Worker. |
| `npm run deploy:setup` | tgbot | Deploy, set webhook, and sync bot commands. |
| `npm run webhook:info` | tgbot | Show Telegram webhook status. |
| `npm run webhook:set` | tgbot | Register the Telegram webhook. |
| `npm run webhook:delete` | tgbot | Delete the Telegram webhook. |
| `npm run commands:set` | tgbot | Sync Telegram bot commands. |
| `npm run generated:generate` | shared | Generate ignored runtime bundles under `src/shared/generated/`. |
| `npm run generated:refresh` | shared | Regenerate all ignored runtime bundles, including LibChecker rules and icons. |
| `npm run i18n:generate` | shared | Generate runtime i18n catalogs from `locales/*.json`. |
| `npm run i18n:check` | shared | Validate locale catalogs and any existing generated i18n catalog. |
| `npm run rules:update` | shared | Refresh generated LibChecker rules. |
| `npm run pages:dev` | Web UI | Run the Pages app locally. |
| `npm run pages:build` | Web UI | Build the Pages app. |
| `npm run pages:deploy` | Web UI | Deploy the Pages app. |
| `npm run check` | shared | Validate Worker, scripts, generated files, and Web UI. |

The repository root is the npm workspace root. The root `pages:*` scripts delegate to the `@tgbot/apk-webui` workspace so existing commands keep working while Web UI-only dependencies stay scoped to the Web UI package.

## Localization

User-facing copy lives in `locales/*.json`. These files are the translation source of truth for both the Telegram bot and the Web UI.

- `locales/en.json` is the default runtime catalog.
- `locales/zh-Hans.json` is the Simplified Chinese catalog.
- `crowdin.yml` maps Crowdin translations to `locales/%locale%.json`.
- Runtime modules import ignored files under `src/shared/generated/`; do not edit generated files by hand.

When contributing through GitHub PRs or Crowdin, edit or add locale JSON files only. Keep the same key tree as `locales/en.json`, and keep placeholders such as `{count}` or `{appName}` unchanged.

After changing translations, run:

```bash
npm run i18n:generate
npm run check
```

`src/shared/generated/` is ignored by git. The dev, build, deploy, and check scripts generate the runtime bundles before they are needed.

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

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `BOT_TOKEN`
- `ADMIN_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAPH_ACCESS_TOKEN`

Optional repository variable:

- `WORKER_URL`

## Project Layout

```text
src/
  bot/               tgbot Worker source
    index.js         Worker entry, Telegram webhook, admin API
    apk-url-preview.js APK link preview parser
    report-viewer.js Worker-hosted report pages
    upload-view.js   Worker-hosted upload page
    observability.js Logs and Analytics Engine events
  shared/            Shared APK analyzer source
    apk.js           APK, manifest, resources, and icon parser
    apk-signatures.js APK signing block, X.509, and digest parser
    i18n.js          Shared localization runtime
    sdk-markers.js   LibChecker SDK marker annotator
    generated/       Ignored generated i18n, LibChecker rule, and icon bundles
locales/             Translation JSON catalogs
pages-apk-webui/     Web UI Pages app workspace package
scripts/             Shared maintenance and webhook scripts
wrangler.toml        Worker deployment config
```
