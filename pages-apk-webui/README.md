# APK WebUI

This directory contains the standalone Cloudflare Pages app for local APK analysis in the browser. It shares the APK analyzer and LibChecker rule bundles from the repository-level `src/shared/` module, but it does not depend on the Telegram bot runtime.

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
    build.mjs           Pages build script
  dist/                 Generated build output
```

The build script copies shared analyzer files into `dist/modules/`:

- `src/shared/apk.js`
- `src/shared/apk-signatures.js`
- `src/shared/i18n.js`
- `src/shared/sdk-markers.js`
- `src/shared/generated/i18n-catalogs.js`
- `src/shared/generated/libchecker-rules.js`
- `src/shared/generated/libchecker-sdk-icons.js`

UI translations are sourced from the repository-level `locales/*.json` files. The Pages build runs `scripts/generate_i18n_catalogs.mjs` before copying modules, so Crowdin or GitHub PR translation updates only need to touch the locale JSON files.

## Local Development

Install dependencies from the repository root first:

```bash
npm install
```

Run the Pages app locally:

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
