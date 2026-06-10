# APK WebUI

This directory contains the standalone Cloudflare Pages app for local APK analysis in the browser. It shares the APK analyzer and LibChecker rule bundles from the repository-level `src/shared/` module, but it does not depend on the Telegram bot runtime.

It is registered as the npm workspace package `@tgbot/apk-webui`. Run commands from the repository root through the root `pages:*` scripts, or target this workspace directly with `npm run <script> --workspace @tgbot/apk-webui`.

## Project Structure

```text
pages-apk-webui/
  src/
    app/                UI helper modules for rendering, history, i18n, and effects
    assets/             Static visual assets
    analyzer-worker.js  Browser worker that runs APK analysis
    app.css             Page styles
    app.js              Main UI controller
    index.html          Static entry HTML
  scripts/
    build.mjs           Vite Pages build wrapper
    benchmark.mjs       Local Chrome/CDP performance benchmark
  vite.config.mjs       Vite build config and shared-module aliases
  dist/                 Generated build output
```

The build script generates ignored shared runtime bundles, then Vite bundles the WebUI, worker, and shared analyzer files into hashed `dist/assets/` files:

- `src/shared/apk.js`
- `src/shared/apk-signatures.js`
- `src/shared/i18n.js`
- `src/shared/sdk-markers.js`
- `src/shared/generated/i18n-catalogs.js`
- `src/shared/generated/libchecker-rules.js`
- `src/shared/generated/libchecker-sdk-icons.js`

UI translations are sourced from the repository-level `locales/*.json` files. LibChecker rules and icons are generated from the upstream bundle script. These generated files live under `src/shared/generated/` locally and are not tracked by git.

## Local Development

Install dependencies from the repository root first:

```bash
npm install
```

Run the Vite dev server locally:

```bash
npm run pages:dev
```

Build the static Pages output:

```bash
npm run pages:build
```

Run WebUI syntax checks:

```bash
npm run pages:check
```

Run a local Chrome/CDP performance benchmark against the built `dist/` output:

```bash
node pages-apk-webui/scripts/benchmark.mjs --label vite --sample /path/to/app.apk
```

## Deployment

Deploy the Pages app:

```bash
npm run pages:deploy
```

When using Cloudflare Pages Git integration, configure:

- Build command: `npm run build`
- Build output directory: `dist`

## Analyzer Runtime

APK files are parsed locally in a browser Web Worker. The worker receives a `File`, reads it as an `ArrayBuffer`, then uses the shared analyzer modules copied into `dist/modules/`.

The browser-side analyzer currently supports manifest parsing, resources, application icons, native libraries, permissions, components, signatures, metadata, and LibChecker SDK rule annotations.
