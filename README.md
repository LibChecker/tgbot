# LibChecker APK Bot and Web UI

This repository contains two deployable parts:

| Part | Path | Platform | Purpose |
| --- | --- | --- | --- |
| tgbot | `src/` | Cloudflare Workers | Telegram bot, APK link preview, upload page, report rendering, webhook/admin APIs. |
| Web UI | `pages-apk-webui/` | Cloudflare Pages | Standalone browser APK analyzer powered by the same parser and LibChecker rules. |

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
- Shared parser and generated LibChecker rule bundles.
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

Install root dependencies:

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
| `npm run rules:update` | shared | Refresh generated LibChecker rules. |
| `npm run pages:dev` | Web UI | Run the Pages app locally. |
| `npm run pages:build` | Web UI | Build the Pages app. |
| `npm run pages:deploy` | Web UI | Deploy the Pages app. |
| `npm run check` | shared | Validate Worker, scripts, generated files, and Web UI. |

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
src/                 tgbot Worker source
  index.js           Worker entry, Telegram webhook, admin API
  apk.js             APK, manifest, and resources parser
  apk-url-preview.js APK link preview parser
  report-viewer.js   Worker-hosted report pages
  upload-view.js     Worker-hosted upload page
  observability.js   Logs and Analytics Engine events
  generated/         LibChecker rule and icon bundles
pages-apk-webui/     Web UI Pages app
scripts/             Shared maintenance and webhook scripts
wrangler.toml        Worker deployment config
```
