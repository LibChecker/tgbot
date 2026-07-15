import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createSmokeApk } from "./fixtures.mjs";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const smokeApk = {
  name: "accessibility-smoke.apk",
  mimeType: "application/vnd.android.package-archive",
  buffer: createSmokeApk(),
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("first screen has no automatically detectable WCAG A or AA violations", async ({ page }, testInfo) => {
  await expect(page.locator("#analyze-form")).toBeVisible();
  await expectNoWcagViolations(page, testInfo);
});

test("analyzed report has no automatically detectable WCAG A or AA violations", async ({ page }, testInfo) => {
  await analyzeSmokeApk(page);
  await expectNoWcagViolations(page, testInfo, "#result-view");
});

test("ELF detail dialog has no automatically detectable WCAG A or AA violations", async ({ page }, testInfo) => {
  await analyzeSmokeApk(page);
  await page.locator('[data-tab="native"]').click();
  await page.locator("[data-elf-details]").first().click();
  await expect(page.locator("#elf-detail-dialog")).toBeVisible();
  await expect(page.locator("#elf-detail-body")).toHaveAttribute("aria-busy", "false");
  await expectNoWcagViolations(page, testInfo, "#elf-detail-dialog");
});

test("populated compare view has no automatically detectable WCAG A or AA violations", async ({ page }, testInfo) => {
  await analyzeSmokeApk(page);
  await page.locator('[data-app-mode="compare"]').click();
  await expect(page.locator("#compare-view")).toBeVisible();

  const leftHistory = page.locator('[data-compare-history="left"]');
  const rightHistory = page.locator('[data-compare-history="right"]');
  const historyId = await leftHistory.locator("option").nth(1).getAttribute("value");
  expect(historyId).toBeTruthy();
  await leftHistory.selectOption(historyId);
  await rightHistory.selectOption(historyId);
  await expect(page.locator("#compare-result")).toContainText(/No differences|无差异/u);

  await expectNoWcagViolations(page, testInfo, "#compare-view");
});

async function analyzeSmokeApk(page) {
  const workerStarted = page.waitForEvent("worker");
  await page.locator("#file-input").setInputFiles(smokeApk);
  await page.locator("#analyze-button").click();
  await workerStarted;
  await expect(page.locator("#result-view")).toBeVisible();
  await expect(page.locator("#report-hero")).toContainText("Smoke APK");
}

async function expectNoWcagViolations(page, testInfo, selector = "") {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (selector) {
    builder = builder.include(selector);
  }

  const results = await builder.analyze();
  if (results.violations.length > 0) {
    await testInfo.attach("axe-results", {
      body: Buffer.from(JSON.stringify(results, null, 2)),
      contentType: "application/json",
    });
  }
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
}

function formatViolations(violations) {
  return violations
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
    .join("\n");
}
