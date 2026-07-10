# WebUI polish and performance design

Date: 2026-07-10

## Context

The LibChecker WebUI already has a recognizable visual language built around
light and dark themes, compact pill controls, a dotted canvas background, and
capability-gated glass effects. Recent work refined report sharing, report
badges, and touch behavior for segmented controls. This iteration should
continue that direction instead of replacing the visual system or application
architecture.

The current production build also exposes a concrete shipping risk. The CSS
gzip budget is exceeded at the 16 KiB boundary, while first-screen JavaScript
is 35.1 KiB against a 40 KiB budget. The stylesheet is large and the main
controller still owns optional visual behavior, so visual polish and runtime
work need to reduce cost rather than add another layer of effects.

## Goals

- Refine the upload, link analysis, history, report, and share-modal surfaces
  without changing their information architecture.
- Preserve the current brand, themes, dotted background, pointer lighting,
  and glass character on devices that can render them comfortably.
- Bring CSS gzip below budget with at least 0.5 KiB of headroom.
- Avoid increasing first-screen JavaScript and target less than 35 KiB gzip.
- Reduce work performed by decorative effects when the page is hidden,
  off-screen, power-constrained, or configured to reduce motion.
- Remove unused or superseded WebUI code only when references, tests, and
  rendered behavior provide evidence that removal is safe.

## Non-goals

- Migrating away from vanilla ESM, Vite, HTML, and CSS.
- Redesigning the analysis flow or report information architecture.
- Changing shared report contracts, history storage formats, analyzer output,
  Worker routes, or generated LibChecker bundles.
- Adding a new UI, animation, or styling dependency.
- Disabling the established text-selection policy for application and report
  data.

## Design direction

This is a balanced, incremental refinement. The interface keeps its current
cool neutral palette, purple-blue accent, rounded geometry, and restrained
technical character. Polish comes from clearer hierarchy, fewer nested
outlines, consistent spacing, and intentional states rather than additional
decoration.

### Top bar and global controls

- Keep the existing mode and theme segmented controls.
- Normalize the heights, inner insets, borders, and pressed states of segmented
  controls, language selection, and icon buttons.
- Remove redundant highlight and shadow layers where they do not communicate a
  separate elevation level.
- Preserve the mobile split between primary mode controls and footer-level
  secondary settings.

### Analysis panel

- Keep file selection as the primary action and URL analysis as a secondary
  path.
- Clarify the hierarchy between prompt, supported file types, current file
  state, URL status, explanatory text, and the primary action.
- Reduce nested card borders and align the primary button optically with the
  file-selection surface.
- Preserve all file-picker compatibility behavior and input validation.

### History

- Make the empty history presentation compact enough to keep the first screen
  focused on analysis.
- Keep collapse, list/grid selection, reopening, and clear behavior unchanged.
- Align heading, explanatory text, view selection, and destructive action into
  a stable hierarchy across desktop and mobile.

### Reports

- Normalize report hero, tabs, metric cards, data groups, and empty/error states
  around a smaller set of radii, spacing values, and surface treatments.
- Keep report values selectable through the existing `app-data-text` policy;
  static UI text remains non-selectable.
- Preserve horizontally scrollable report tabs and touch-drag behavior.
- Retain the current share flow while making its visual states consistent with
  the rest of the report surface.

### Motion and responsive behavior

- Use short interaction transitions, generally 160-240 ms, for hover, press,
  focus, and state changes.
- Gate hover-only treatment behind `(hover: hover) and (pointer: fine)`.
- Keep touch targets large enough for mobile use and avoid layout-affecting
  animation properties.
- Prefer static treatment when reduced motion, low-power capability, page
  visibility, or viewport visibility indicates that continuous animation is
  inappropriate.

## Performance architecture

Core analysis controls, localization, and state restoration remain in the
first-screen path. Decorative behavior and report-only behavior should not
delay those controls.

### CSS

- Consolidate repeated card, border, button, and segmented-control declarations
  into the smallest existing set of reusable rules and variables.
- Remove overridden declarations and selectors that have no source or runtime
  consumer.
- Keep feature-specific styles with their existing lazy features. Report-only
  styles may move behind an existing report module boundary when that reduces
  first-screen CSS without causing a flash of unstyled content.
- Do not raise the CSS budget to make the build pass.

### JavaScript

- Isolate optional dotted-canvas and pointer-lighting orchestration from core
  application startup when doing so reduces the initial bundle.
- Start optional effects after the meaningful first screen is available and
  only when capability checks permit them.
- Suspend continuous drawing while the document is hidden or the relevant
  canvas is not visible, and resume without changing application state.
- Coalesce resize work and retain an explicit device-pixel-ratio cap.
- Remove constants, functions, and branches only after confirming that no
  HTML, JavaScript template, dynamic import, or test references them.

### Failure behavior

Optional visual modules fail closed to a static background. Their failure must
not block file selection, URL analysis, report loading, history, localization,
or theme selection. Existing user-facing analysis errors and runtime
diagnostics remain available.

## Data and module boundaries

- Local files continue through the browser analyzer worker.
- URL analysis continues through the existing `/url-report` boundary.
- History continues through the current history module and storage schema.
- Report models, rendering, sharing, and comparison continue through their
  existing modules and contracts.
- This work may deepen existing WebUI module boundaries but must not move
  browser-only behavior into shared analyzer code.

## Validation

The rendered flow under test is: the app loads, the first meaningful screen
renders, primary controls respond, and a report surface can be opened and
navigated without runtime errors.

Required checks:

1. Run `npm run pages:check`.
2. Run `npm run pages:build`.
3. Run `npm run perf:check` and inspect every budget row.
4. Validate the preview preflight with
   `npm run deploy:preflight -- --target=preview` before committing
   implementation work.
5. Use the Codex Browser against the exact Vite local URL for desktop and a
   mobile viewport.
6. Check page identity, meaningful DOM content, framework overlays, console
   warnings/errors, screenshots, and at least one state-changing interaction.
7. Exercise mode, theme, language, URL-input enablement, history view, report
   tabs, and report sharing where test data is available.
8. Check mobile wrapping, horizontal scrolling, touch targets, clipping, and
   fixed top-bar behavior.

## Acceptance criteria

- The visual language remains recognizably the current LibChecker WebUI.
- Upload, URL analysis, history, report, compare, and share behavior remain
  functionally unchanged.
- CSS gzip is no more than 15.5 KiB against the 16 KiB budget.
- First-screen JavaScript gzip does not regress and is targeted below 35 KiB.
- First-screen request count remains within the existing budget.
- Decorative animation performs no continuous work while suspended by page or
  viewport visibility and uses static fallback when capability checks fail.
- Desktop and mobile Browser validation show no relevant console error,
  clipping, overlap, or inaccessible primary control.
- All WebUI checks, performance budgets, and preview preflight pass.

## Risks and mitigations

- **CSS consolidation changes specificity.** Keep edits in small groups and
  reload both first-screen and report states after each group.
- **Lazy styles cause an unstyled report frame.** Load styles through the same
  boundary as report rendering and verify direct report entry as well as local
  analysis entry.
- **Animation suspension fails to resume.** Test visibility and viewport state
  transitions independently from analysis state.
- **Dead-code cleanup removes dynamic behavior.** Search HTML attributes,
  template strings, dynamic imports, and tests before deletion; retain code
  when evidence is ambiguous.
- **A rounded budget result hides a threshold failure.** Trust the budget
  script's status and preserve measurable headroom instead of aiming at the
  exact limit.

## Implementation sequence

1. Establish selector, bundle, and rendered-state baselines.
2. Consolidate visual tokens and shared control/surface rules.
3. Refine the analysis and history surfaces.
4. Refine shared report and modal surfaces.
5. Isolate and suspend optional visual effects.
6. Remove proven dead CSS and JavaScript.
7. Run static checks, builds, budgets, desktop/mobile Browser QA, and preview
   preflight.
