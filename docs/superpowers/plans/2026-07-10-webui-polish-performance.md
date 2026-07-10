# WebUI Polish and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the LibChecker WebUI without changing its information architecture while restoring CSS budget headroom, reducing first-screen JavaScript, suspending decorative work when it is not useful, and deleting proven redundant code.

**Architecture:** Keep the vanilla ESM application and existing data flow. Move report and compare styles behind their already-lazy JavaScript module boundaries, move the fixed dotted-canvas renderer behind an idle dynamic import with a testable animation policy, then polish the remaining first-screen and report styles in small reviewable slices.

**Tech Stack:** Vanilla ESM, HTML, CSS, Vite 8, Cloudflare Pages, Node test runner, Codex Browser.

## Global Constraints

- Preserve the current brand, light/dark themes, dotted background, pointer lighting, and glass character on capable devices.
- Do not change shared report contracts, history storage formats, analyzer output, Worker routes, or generated LibChecker bundles.
- Do not add a UI, animation, or styling dependency.
- Static UI text remains non-selectable; application and report values continue to opt in through `app-data-text`.
- CSS gzip must be no more than 15.5 KiB against the 16 KiB budget.
- First-screen JavaScript gzip must not regress and is targeted below 35 KiB.
- First-screen request count must remain within the existing budget.
- Fixed mobile topbar paths must not use `contain: paint`, forced transforms, `will-change`, or backdrop blur.
- Hover-only highlights remain gated by `(hover: hover) and (pointer: fine)`.
- Run `npm run deploy:preflight -- --target=preview` before every implementation commit.
- The current design and plan documents remain uncommitted until Task 1 restores a passing preview preflight; include both documents in Task 1's verified commit.

---

## File Structure

- Create `packages/apk-webui/src/report.css`: styles used only after the report renderer or compare controller is loaded.
- Create `packages/apk-webui/src/compare.css`: compare-only layout and state styles loaded with `compare-controller.js`.
- Create `packages/apk-webui/src/app/background-effects.js`: dotted-canvas renderer and its animation eligibility policy.
- Create `packages/apk-webui/test/style-boundaries.test.mjs`: source-boundary checks for lazy CSS and static shell styling.
- Create `packages/apk-webui/test/background-effects.test.mjs`: pure animation-policy tests.
- Modify `packages/apk-webui/src/app.css`: retain shell, first-screen, history, modal host, and LCAPPS styles; consolidate controls and remove report/compare CSS.
- Modify `packages/apk-webui/src/app.js`: schedule the background renderer through a dynamic import and remove embedded dot-field code.
- Modify `packages/apk-webui/src/app/state.js`: retain the background module promise in runtime state.
- Modify `packages/apk-webui/src/app/report-renderer.js`: load report styles with the existing lazy report module.
- Modify `packages/apk-webui/src/app/compare-controller.js`: load report-shared and compare-only styles with the existing lazy compare module.
- Modify `packages/apk-webui/src/index.html`: remove static inline styles that duplicate stylesheet rules.
- Modify `packages/apk-webui/src/report-share-modal.css`: align share-modal spacing and surface treatment with the report view.

---

### Task 1: Put report and compare CSS behind existing lazy boundaries

**Files:**
- Create: `packages/apk-webui/src/report.css`
- Create: `packages/apk-webui/src/compare.css`
- Create: `packages/apk-webui/test/style-boundaries.test.mjs`
- Modify: `packages/apk-webui/src/app.css`
- Modify: `packages/apk-webui/src/app/report-renderer.js`
- Modify: `packages/apk-webui/src/app/compare-controller.js`
- Commit: `docs/superpowers/specs/2026-07-10-webui-polish-performance-design.md`
- Commit: `docs/superpowers/plans/2026-07-10-webui-polish-performance.md`

**Interfaces:**
- Consumes: the existing dynamic imports of `./app/report-renderer.js` and `./app/compare-controller.js` in `app.js`.
- Produces: `report.css` loaded before report module resolution and `compare.css` loaded before compare-controller resolution; no exported JavaScript API changes.

- [ ] **Step 1: Record the failing CSS baseline**

Run:

```bash
npm run pages:build
npm run perf:check
```

Expected: build passes; performance fails only at `WebUI CSS gzip`, with entry CSS around 16.0 KiB against the 16.0 KiB budget.

- [ ] **Step 2: Write the lazy-style boundary test**

Create `packages/apk-webui/test/style-boundaries.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("report and compare styles stay behind lazy module boundaries", async () => {
  const [appCss, reportCss, compareCss, reportRenderer, compareController] = await Promise.all([
    readSource("src/app.css"),
    readSource("src/report.css"),
    readSource("src/compare.css"),
    readSource("src/app/report-renderer.js"),
    readSource("src/app/compare-controller.js"),
  ]);

  assert.doesNotMatch(appCss, /^\.report-hero\s*\{/mu);
  assert.doesNotMatch(appCss, /^\.compare-slot\s*\{/mu);
  assert.match(reportCss, /^\.report-hero\s*\{/mu);
  assert.match(compareCss, /^\.compare-slot\s*\{/mu);
  assert.match(reportRenderer, /^import "\.\.\/report\.css";/mu);
  assert.match(compareController, /^import "\.\.\/report\.css";/mu);
  assert.match(compareController, /^import "\.\.\/compare\.css";/mu);
});
```

- [ ] **Step 3: Run the boundary test and confirm the red state**

Run:

```bash
node --test packages/apk-webui/test/style-boundaries.test.mjs
```

Expected: FAIL with `ENOENT` for `src/report.css` or `src/compare.css`.

- [ ] **Step 4: Add the lazy CSS imports**

Add these imports before the current JavaScript imports in `report-renderer.js`:

```js
import "../report.css";
```

Add these imports before the current JavaScript imports in `compare-controller.js`:

```js
import "../report.css";
import "../compare.css";
```

- [ ] **Step 5: Move report-only styles into `report.css`**

Move, without changing values, the complete rule blocks for these selector families from `app.css` to `report.css`:

```css
.result-view
.result-main
.report-hero
.report-share-button
.hero-copy
.hero-meta
.app-icon-frame
.app-icon
.app-icon-placeholder
.app-title-mask
.archive-distribution
.archive-chart
.chip
.feature-pill
.code-chip
.tabs
.tab
.tab-panel
.native-abi-tabs
.native-abi-tab
.native-library-list
.section-stack
.section-band
.summary-grid
.metric-card
.metric-label
.metric-value
.kv-table
.kv-row
.divider-kv-table
.list-stack
.list-row
.group-grid
.group-block
.component-group
.component-row
.permission-table
.sdk-row
.sdk-count
.sdk-rule-preview
.archive-chart-preview
.bar-track
.bar
.json-block
.raw-toolbar
.raw-export-button
.warning-note
```

Move the matching dark-theme, `@supports`, responsive, hover, power-mode, and reduced-motion rules with their base selectors. Keep `.history-row` and `.empty-list` base styles in `app.css`; when splitting the shared card group, leave this complete history declaration in `app.css`:

```css
.history-row {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card-bg);
  box-shadow: none;
}
```

- [ ] **Step 6: Move compare-only styles into `compare.css`**

Move every selector beginning with `.compare-` plus its responsive, hover, power-mode, and reduced-motion rules from `app.css` to `compare.css`. Retain only the hidden shell container's shared panel declaration in `app.css`:

```css
.tool-panel,
.history-panel,
.empty-state,
.result-view,
.compare-view {
  min-width: 0;
  border: 1px solid var(--panel-border);
  border-radius: var(--radius);
  background: var(--panel-bg);
  box-shadow: var(--shadow);
  -webkit-backdrop-filter: saturate(180%) blur(18px);
  backdrop-filter: saturate(180%) blur(18px);
}
```

- [ ] **Step 7: Run focused tests and production budgets**

Run:

```bash
node --test packages/apk-webui/test/style-boundaries.test.mjs
npm run pages:check
npm run pages:build
npm run perf:check
```

Expected: all tests pass; entry CSS gzip is at most 15.5 KiB; report and compare CSS appear as lazy chunks; first-screen request count remains within budget.

- [ ] **Step 8: Run preview preflight and commit the first verified slice**

Run:

```bash
npm run deploy:preflight -- --target=preview
git diff --check
git status --short
git add docs/superpowers/specs/2026-07-10-webui-polish-performance-design.md docs/superpowers/plans/2026-07-10-webui-polish-performance.md packages/apk-webui/src/app.css packages/apk-webui/src/report.css packages/apk-webui/src/compare.css packages/apk-webui/src/app/report-renderer.js packages/apk-webui/src/app/compare-controller.js packages/apk-webui/test/style-boundaries.test.mjs
git diff --cached --stat
git commit -m "Split WebUI feature styles from first screen"
```

Expected: preflight passes and the commit contains only the two approved documents plus the lazy-style boundary slice.

---

### Task 2: Lazy-load and suspend the dotted background renderer

**Files:**
- Create: `packages/apk-webui/src/app/background-effects.js`
- Create: `packages/apk-webui/test/background-effects.test.mjs`
- Modify: `packages/apk-webui/src/app.js`
- Modify: `packages/apk-webui/src/app/state.js`

**Interfaces:**
- Consumes: `{ canvas, fineHoverMedia, isPowerConstrained }` from `app.js`.
- Produces: `initColorOrbBackground(options): void` and `shouldAnimateDotField(state): boolean` from `background-effects.js`.

- [ ] **Step 1: Write the animation-policy test**

Create `packages/apk-webui/test/background-effects.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldAnimateDotField } from "../src/app/background-effects.js";

const eligible = {
  powerConstrained: false,
  visibilityState: "visible",
  fineHover: true,
  canvasVisible: true,
};

test("dot field animates only while visible on capable fine-pointer devices", () => {
  assert.equal(shouldAnimateDotField(eligible), true);
  assert.equal(shouldAnimateDotField({ ...eligible, powerConstrained: true }), false);
  assert.equal(shouldAnimateDotField({ ...eligible, visibilityState: "hidden" }), false);
  assert.equal(shouldAnimateDotField({ ...eligible, fineHover: false }), false);
  assert.equal(shouldAnimateDotField({ ...eligible, canvasVisible: false }), false);
});
```

- [ ] **Step 2: Run the policy test and confirm the red state**

Run:

```bash
node --test packages/apk-webui/test/background-effects.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `background-effects.js`.

- [ ] **Step 3: Create the background module and simplify fixed branches**

Start `background-effects.js` with the current dot constants, palettes, and `initColorOrbBackground` implementation moved from `app.js`. Import `clamp` locally and expose the pure policy:

```js
import { clamp } from "./math.js";

export function shouldAnimateDotField({
  powerConstrained,
  visibilityState,
  fineHover,
  canvasVisible = true,
}) {
  return !powerConstrained && visibilityState !== "hidden" && fineHover && canvasVisible;
}

export function initColorOrbBackground({ canvas, fineHoverMedia, isPowerConstrained }) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  canvas.dataset.renderer = "dot-field";
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    canvas.dataset.renderer = "dot-field-unavailable";
    return;
  }

  let canvasVisible = true;
  const canAnimate = () => shouldAnimateDotField({
    powerConstrained: isPowerConstrained(),
    visibilityState: document.visibilityState,
    fineHover: fineHoverMedia.matches,
    canvasVisible,
  });

  const visibilityObserver = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(([entry]) => {
      canvasVisible = entry?.isIntersecting !== false;
      refreshMotionMode();
    })
    : null;
  visibilityObserver?.observe(canvas);

  resizeNow();
  window.addEventListener("resize", scheduleResize, { passive: true });
  window.addEventListener("pointermove", updatePointer, { passive: true });
  window.addEventListener("blur", clearPointer);
  window.addEventListener("apk-theme-change", refreshPalette);
  window.addEventListener("apk-power-mode-change", refreshMotionMode);
  addMediaChangeListener(fineHoverMedia, refreshMotionMode);
  document.addEventListener("visibilitychange", refreshMotionMode);
  startAnimation();
}
```

Move these nested functions from the current `initColorOrbBackground` body
without changing their calculations: `resizeNow`, `scheduleResize`,
`buildDots`, `updatePointer`, `clearPointer`, `updatePointerSpeed`,
`drawPointerGlow`, `tick`, `stopAnimation`, and `refreshPalette`. Keep
`frameCount`, `resizeTimer`, `speedTimer`, `animationFrame`, `engagement`,
`glowOpacity`, and `palette` as closure state. Change `startAnimation` and
`refreshMotionMode` to call `canAnimate()`. Change `drawFrame` only as
described by the fixed-branch deletion below.

The existing configuration fixes `bulgeOnly: true`, `sparkle: false`, and `waveAmplitude: 0`. Delete the unreachable sparkle, wave, and non-bulge physics branches while preserving the current bulge calculation. Replace `shouldSparkleDot(...)` with the fixed radius and reduce `moveDotForPointer(...)` to:

```js
function moveDotForPointer(dot, cursorRadius, cursorRadiusSquared) {
  const dx = pointer.x - dot.ax;
  const dy = pointer.y - dot.ay;
  const distanceSquared = dx * dx + dy * dy;

  if (distanceSquared < cursorRadiusSquared && engagement > 0.01) {
    const distance = Math.sqrt(distanceSquared);
    const strength = 1 - distance / cursorRadius;
    const push = strength * strength * DOT_FIELD_CONFIG.bulgeStrength * engagement;
    const angle = Math.atan2(dy, dx);
    dot.sx += (dot.ax - Math.cos(angle) * push - dot.sx) * 0.15;
    dot.sy += (dot.ay - Math.sin(angle) * push - dot.sy) * 0.15;
    return;
  }

  dot.sx += (dot.ax - dot.sx) * 0.1;
  dot.sy += (dot.ay - dot.sy) * 0.1;
}
```

Add this compatibility helper inside the module:

```js
function addMediaChangeListener(mediaQuery, listener) {
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
  } else {
    mediaQuery.addListener(listener);
  }
}
```

- [ ] **Step 4: Add runtime state for the lazy module**

Add to `createRuntimeState()` in `state.js`:

```js
backgroundEffectsPromise: null,
```

- [ ] **Step 5: Replace the embedded renderer with an idle dynamic import**

Delete the dot-field constants, palettes, `initColorOrbBackground`, `shouldAnimateDotField`, `resolveDotFieldPalette`, and `formatDotFieldRgba` from `app.js`. Replace the startup call with `scheduleColorOrbBackground()` and add:

```js
function scheduleColorOrbBackground() {
  const canvas = elements.backgroundCanvas;
  if (!canvas) {
    return;
  }

  const load = () => {
    if (!runtime.backgroundEffectsPromise) {
      runtime.backgroundEffectsPromise = import("./app/background-effects.js");
    }
    void runtime.backgroundEffectsPromise
      .then(({ initColorOrbBackground }) => {
        if (canvas.isConnected) {
          initColorOrbBackground({ canvas, fineHoverMedia, isPowerConstrained: isAppPowerConstrained });
        }
      })
      .catch(() => {
        runtime.backgroundEffectsPromise = null;
        canvas.dataset.renderer = "dot-field-unavailable";
      });
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 1500 });
  } else {
    window.setTimeout(load, 0);
  }
}
```

- [ ] **Step 6: Verify policy, syntax, bundles, and rendered background**

Run:

```bash
node --test packages/apk-webui/test/background-effects.test.mjs
npm run pages:check
npm run pages:build
npm run perf:check
```

Expected: all pass; a separate background-effects chunk exists; first-screen JavaScript gzip is below its baseline and targeted below 35 KiB.

Use Codex Browser at the exact Vite `Local:` URL and verify:

```text
app loads -> dotted static background appears -> fine-pointer movement animates the field -> theme switch updates the palette -> no console warnings/errors
```

- [ ] **Step 7: Run preview preflight and commit**

Run:

```bash
npm run deploy:preflight -- --target=preview
git diff --check
git add packages/apk-webui/src/app.js packages/apk-webui/src/app/state.js packages/apk-webui/src/app/background-effects.js packages/apk-webui/test/background-effects.test.mjs
git diff --cached --stat
git commit -m "Lazy-load WebUI background effects"
```

---

### Task 3: Polish the first screen and remove static inline styling

**Files:**
- Modify: `packages/apk-webui/src/app.css`
- Modify: `packages/apk-webui/src/index.html`
- Modify: `packages/apk-webui/test/style-boundaries.test.mjs`

**Interfaces:**
- Consumes: existing HTML class names and CSS variables.
- Produces: the same DOM and interaction contracts with consistent control geometry and a compositor-safe mobile topbar.

- [ ] **Step 1: Add a failing static-shell style test**

Append to `style-boundaries.test.mjs`:

```js
test("static shell styling stays in stylesheets", async () => {
  const indexHtml = await readSource("src/index.html");
  assert.doesNotMatch(indexHtml, /\sstyle="/u);
});
```

- [ ] **Step 2: Run the test and confirm the red state**

Run:

```bash
node --test packages/apk-webui/test/style-boundaries.test.mjs
```

Expected: FAIL because `index.html` still has inline styles on the language icon, report shell, share button, footer, log link, and version.

- [ ] **Step 3: Move static inline declarations to stylesheets**

Remove every `style="..."` attribute from `index.html`. Keep data-driven inline custom properties in `report-renderer.js`; they represent chart geometry and bar width rather than static styling.

Add to `app.css`:

```css
.site-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin: clamp(18px, 3vw, 28px) 0 2px;
  padding: 0 8px;
  color: var(--muted);
  font-size: 0.78rem;
}

.footer-log-link {
  border: 0;
  background: none;
  color: inherit;
  padding: 0;
  font: inherit;
  cursor: pointer;
}

.footer-version {
  white-space: nowrap;
}
```

Add the report-shell and share-button declarations to `report.css`:

```css
.report-hero-shell {
  position: relative;
}

.report-share-button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
}

.report-share-button svg {
  grid-area: 1 / 1;
}

.report-share-button__spinner {
  width: 18px;
  height: 18px;
  color: var(--accent);
  fill: currentColor;
  transform-origin: center;
}
```

- [ ] **Step 4: Consolidate segmented-control rules**

Merge the duplicated mode/theme group, indicator, button, hover, focus, dragging, and active declarations using these shared selectors while retaining their different widths:

```css
.mode-chip-group,
.theme-chip-group {
  --segment-group-height: 32px;
  --segment-inner-height: 24px;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: var(--segment-group-height);
  padding: 0 var(--topbar-segment-inset);
  border: 0;
  border-radius: var(--topbar-segment-radius);
  corner-shape: round;
  background: var(--topbar-segment-bg);
  box-shadow: inset 0 0 0 1px var(--topbar-control-border);
  cursor: grab;
  isolation: isolate;
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
}

.mode-chip-group::before,
.theme-chip-group::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  z-index: 0;
  height: var(--segment-inner-height);
  border-radius: var(--topbar-segment-thumb-radius);
  corner-shape: round;
  background: var(--topbar-segment-selected-bg);
  box-shadow: var(--topbar-segment-shadow);
  will-change: transform, width;
  transition: transform 420ms var(--topbar-segment-spring), width 300ms var(--topbar-segment-settle);
}

.mode-chip,
.theme-chip {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--segment-inner-height);
  min-height: 0;
  border: 0;
  border-radius: var(--topbar-segment-thumb-radius);
  background: transparent;
  color: var(--topbar-muted);
  font-size: 12px;
  font-weight: 520;
  line-height: 1;
  cursor: inherit;
  transition: color 180ms ease, opacity 160ms ease;
}
```

Keep `.mode-chip-group::before` and `.theme-chip-group::before` separate only for their width and transform variables; keep `.mode-chip` and `.theme-chip` separate only for minimum width and horizontal padding.

- [ ] **Step 5: Refine first-screen hierarchy and empty states**

Adjust the existing rules to these values:

```css
.tool-panel {
  grid-template-columns: minmax(0, 1fr) minmax(184px, 216px);
  gap: 12px 18px;
}

.history-panel {
  gap: 12px;
}

.history-list > .empty-list {
  border: 0;
  background: transparent;
  padding: 6px 2px 2px;
}

.empty-state {
  min-height: 180px;
  padding: clamp(22px, 4vw, 36px);
}
```

Keep file selection primary, URL analysis secondary, and preserve all IDs, form submission, and validation behavior.

- [ ] **Step 6: Make mobile and constrained topbars compositor-safe**

Replace the coarse-pointer-only cleanup with a combined capability/mobile rule:

```css
@media (max-width: 700px), (hover: none), (pointer: coarse) {
  .color-orb-background {
    transform: none;
  }

  .topbar {
    contain: none;
    will-change: auto;
    transform: none;
  }

  .topbar::before {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    will-change: auto;
    transform: none;
  }
}

:root[data-power-mode="constrained"] :is(.tool-panel, .history-panel, .empty-state, .result-view, .compare-view) {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
```

Place hover color/lift rules inside the existing fine-pointer media query; retain `:focus-visible` and `:active` feedback outside it.

- [ ] **Step 7: Run checks and desktop/mobile Browser QA**

Run:

```bash
node --test packages/apk-webui/test/style-boundaries.test.mjs
npm run pages:check
npm run pages:build
npm run perf:check
```

Browser flow:

```text
app loads -> theme switches dark/light/system -> mode switches analyze/compare/analyze -> URL input enables submit -> clear returns to idle -> history list/grid controls retain state
```

Verify default desktop and `390x844` mobile viewports for clipping, wrapping, fixed topbar behavior, focus rings, console health, and screenshot evidence. Reset the temporary viewport after validation.

- [ ] **Step 8: Run preview preflight and commit**

Run:

```bash
npm run deploy:preflight -- --target=preview
git diff --check
git add packages/apk-webui/src/app.css packages/apk-webui/src/report.css packages/apk-webui/src/index.html packages/apk-webui/test/style-boundaries.test.mjs
git diff --cached --stat
git commit -m "Polish WebUI first screen details"
```

---

### Task 4: Polish report, compare, and share surfaces

**Files:**
- Modify: `packages/apk-webui/src/report.css`
- Modify: `packages/apk-webui/src/compare.css`
- Modify: `packages/apk-webui/src/report-share-modal.css`

**Interfaces:**
- Consumes: existing report renderer, compare controller, tab drag behavior, and share-modal markup.
- Produces: unchanged DOM/data behavior with normalized spacing, radii, surfaces, and states.

- [ ] **Step 1: Run focused behavior tests before visual edits**

Run:

```bash
node --test packages/apk-webui/test/report-renderer.test.mjs packages/apk-webui/test/report-share-modal.test.mjs packages/apk-webui/test/report-share.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Normalize report hierarchy**

Update report styles to use these relationships while preserving class names:

```css
.result-view {
  gap: clamp(18px, 2.6vw, 22px);
  padding: clamp(14px, 2.4vw, 20px);
}

.result-main {
  gap: clamp(14px, 2vw, 18px);
}

.report-hero-shell {
  padding: clamp(14px, 2.2vw, 18px);
}

.report-hero {
  gap: 14px;
  padding-right: 42px;
}

.summary-grid {
  gap: 10px;
}

.metric-card,
.kv-table,
.list-row,
.sdk-row,
.group-block,
.json-block {
  border-color: color-mix(in srgb, var(--line) 86%, transparent);
  background: color-mix(in srgb, var(--card-bg) 94%, transparent);
}
```

Use the existing outer report panel as the dominant elevation. Keep inner data cards flat (`box-shadow: none`) and use spacing/border contrast for hierarchy.

- [ ] **Step 3: Normalize tabs, rows, and compare surfaces**

Keep the established capsule geometry and touch drag behavior. Reduce inconsistent inner gaps and align report/compare rows:

```css
.tabs {
  min-height: 38px;
}

.tab,
.native-abi-tab {
  height: 30px;
  padding-inline: 13px;
}

.kv-row,
.list-row,
.sdk-row {
  padding: 12px 14px;
}

.compare-slot,
.compare-table,
.compare-app-card {
  border-color: color-mix(in srgb, var(--line) 86%, transparent);
  box-shadow: none;
}
```

Keep hover-only chart and row lifts inside fine-pointer media queries; retain keyboard focus treatment for archive segments and tabs.

- [ ] **Step 4: Align the report share modal**

In `report-share-modal.css`, keep the current interaction behavior and adjust only visual rhythm:

```css
.report-share-panel {
  gap: 16px;
  border-color: var(--line-strong);
}

.report-share-actions {
  gap: 8px;
}
```

Use existing surface, text, accent, and danger variables; do not introduce a separate modal palette.

- [ ] **Step 5: Re-run behavior tests and build checks**

Run:

```bash
node --test packages/apk-webui/test/report-renderer.test.mjs packages/apk-webui/test/report-share-modal.test.mjs packages/apk-webui/test/report-share.test.mjs
npm run pages:check
npm run pages:build
npm run perf:check
```

Expected: all pass; lazy report and compare CSS remain out of first-screen requests.

- [ ] **Step 6: Render a report in Browser without persisting test data**

Before seeding, save the current value of `localStorage["apk-webui-history"]`. Through the Browser tab's CDP capability, temporarily store one history entry with `compactVersion: 1` and this report payload, then reload:

```js
{
  id: "webui-polish-qa",
  key: "com.example.polish::42::polish.apk::4096",
  savedAt: "2026-07-10T00:00:00.000Z",
  compactVersion: 1,
  summary: {
    appName: "Polish QA",
    packageName: "com.example.polish",
    versionName: "1.4.2",
    versionCode: "42",
    targetSdk: "35",
    fileName: "polish.apk",
    fileSizeBytes: 4096,
    analyzedAt: "2026-07-10T00:00:00.000Z",
    iconDataUri: "",
    sdkCount: 0,
    stats: { nativeLibraries: 0, components: 1 },
  },
  report: {
    fileName: "polish.apk",
    fileSizeBytes: 4096,
    analyzedAt: "2026-07-10T00:00:00.000Z",
    durationMs: 18,
    apkInfo: {
      appName: "Polish QA",
      packageName: "com.example.polish",
      versionName: "1.4.2",
      versionCode: 42,
      targetSdk: 35,
      minSdk: 23,
      compileSdk: 35,
      buildFeatures: {},
      components: { activities: [{ name: "com.example.polish.MainActivity" }], services: [], receivers: [], providers: [] },
      metaData: { application: [] },
      nativeLibraries: [],
      permissions: ["android.permission.INTERNET"],
      sdkSummary: { native: [], components: [] },
      signatures: { schemes: [], certificates: [] },
    },
  },
}
```

Browser flow:

```text
reload -> open Polish QA history row -> report hero appears -> switch Summary/Components/Permissions/Raw tabs -> open and close share modal -> verify desktop and mobile screenshots -> verify console health
```

Restore the original history value and reload after QA.

- [ ] **Step 7: Run preview preflight and commit**

Run:

```bash
npm run deploy:preflight -- --target=preview
git diff --check
git add packages/apk-webui/src/report.css packages/apk-webui/src/compare.css packages/apk-webui/src/report-share-modal.css
git diff --cached --stat
git commit -m "Refine WebUI report surface hierarchy"
```

---

### Task 5: Prove cleanup and run the full release gate

**Files:**
- Modify only files with a proven unused declaration, selector, constant, or branch found by the checks below.

**Interfaces:**
- Consumes: all earlier task outputs.
- Produces: a clean worktree with passing full checks, budget evidence, and desktop/mobile rendered evidence.

- [ ] **Step 1: Scan for remnants that should no longer exist**

Run:

```bash
rg -n 'DOT_FIELD_|initColorOrbBackground|shouldSparkleDot|waveAmplitude|bulgeOnly|cursorForce' packages/apk-webui/src/app.js
rg -n '^\.report-hero\s*\{|^\.compare-slot\s*\{' packages/apk-webui/src/app.css
rg -n 'style="' packages/apk-webui/src/index.html
rg -n 'contain: paint|will-change: transform|backdrop-filter' packages/apk-webui/src/app.css
```

Expected: the first three commands return no matches. For the final command, every remaining match is outside the fixed mobile topbar path or is neutralized inside the combined mobile/coarse-pointer rule.

- [ ] **Step 2: Check changed symbols and selectors before deleting anything else**

For every deletion candidate, run both source and test searches:

```bash
rg -n 'candidateName|candidate-class' packages/apk-webui/src packages/apk-webui/test packages/apk-webui/scripts
```

Delete only candidates with no HTML attribute, JavaScript template, dynamic import, runtime query, CSS dependency, or test consumer. Leave ambiguous dynamic selectors intact.

- [ ] **Step 3: Run the complete validation stack**

Run:

```bash
git diff --check
npm run pages:check
npm run pages:build
npm run perf:check
npm run check
npm run deploy:preflight -- --target=preview
```

Expected: every command passes; every budget row is `OK`; entry CSS gzip is at most 15.5 KiB; first-screen JavaScript gzip does not regress and is targeted below 35 KiB.

- [ ] **Step 4: Run final Browser QA**

Use the exact Vite `Local:` URL and the Browser plugin. Validate default desktop and `390x844` mobile viewports:

```text
app loads -> first meaningful screen renders -> mode/theme/language/link/history controls respond -> seeded report opens -> report tabs and share modal respond -> no framework overlay -> no relevant console warning/error
```

Capture desktop first-screen, mobile first-screen, desktop report, and mobile report screenshots. Restore the original localStorage value, reset the viewport override, and close temporary QA tabs.

- [ ] **Step 5: Verify the implementation finishes cleanly**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: the worktree is clean and the latest commits are the focused lazy
styles, background effects, first-screen polish, and report-surface slices. If
Step 2 exposed an additional proven deletion, fold it into the owning earlier
task before that task's preflight and commit; do not create an unrelated final
cleanup commit.
