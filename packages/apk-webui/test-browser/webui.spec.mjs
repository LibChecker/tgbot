import { expect, test } from "@playwright/test";

import { createSmokeApk } from "./fixtures.mjs";

const validApk = {
  name: "smoke.apk",
  mimeType: "application/vnd.android.package-archive",
  buffer: createSmokeApk(),
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("renders the first screen without starting analysis", async ({ page }) => {
  await expect(page.locator("#analyze-form")).toBeVisible();
  await expect(page.locator("#analyze-button")).toBeDisabled();
  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("#result-view")).toBeHidden();
});

test("history accordion hides inert content after collapsing and restores it", async ({ page }) => {
  const toggle = page.locator("#history-toggle-button");
  const content = page.locator("#history-content");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(content).toHaveAttribute("aria-hidden", "true");
  await expect(content).toHaveAttribute("inert", "");
  await expect(content).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(content).not.toHaveAttribute("aria-hidden");
  await expect(content).not.toHaveAttribute("inert");
  await expect(content).toBeVisible();
});

test("runs damaged input through the analyzer Worker and reports the failure", async ({ page }) => {
  const workerStarted = page.waitForEvent("worker");
  await page.locator("#file-input").setInputFiles({
    name: "damaged.apk",
    mimeType: "application/vnd.android.package-archive",
    buffer: Buffer.from("not an apk"),
  });
  await page.locator("#analyze-button").click();

  const worker = await workerStarted;
  expect(worker.url()).toContain("analyzer-worker");
  await expect(page.locator("#error-box")).toBeVisible();
  await expect(page.locator("#result-view")).toBeHidden();
});

test("analyzes a small APK, saves history, reopens the report, and compares it", async ({ page }) => {
  const workerStarted = page.waitForEvent("worker");
  await page.locator("#file-input").setInputFiles(validApk);
  await page.locator("#analyze-button").click();
  await workerStarted;

  await expect(page.locator("#result-view")).toBeVisible();
  await expect(page.locator("#report-hero")).toContainText("Smoke APK");
  await expect(page.locator("#tab-panel")).toContainText("com.example.smoke");

  const historyEntry = page.locator('[data-history-action="open"]').first();
  await expect(historyEntry).toContainText("Smoke APK");
  await historyEntry.click();
  await expect(page.locator("#result-view")).toBeVisible();
  await expect(page.locator("#tab-panel")).toContainText("com.example.smoke");

  await page.locator('[data-app-mode="compare"]').click();
  await expect(page.locator("#compare-view")).toBeVisible();
  const leftHistory = page.locator('[data-compare-history="left"]');
  const rightHistory = page.locator('[data-compare-history="right"]');
  const historyId = await leftHistory.locator("option").nth(1).getAttribute("value");
  expect(historyId).toBeTruthy();
  await leftHistory.selectOption(historyId);
  await rightHistory.selectOption(historyId);

  await expect(page.locator('[data-compare-slot-report="left"]')).toContainText("Smoke APK");
  await expect(page.locator('[data-compare-slot-report="right"]')).toContainText("Smoke APK");
  await expect(page.locator("#compare-result")).toContainText(/No differences|无差异/u);
});
