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

test("opens ELF details on demand and degrades safely for history reports", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const workerStarted = page.waitForEvent("worker");
  await page.locator("#file-input").setInputFiles(validApk);
  await page.locator("#analyze-button").click();
  await workerStarted;
  await expect(page.locator("#result-view")).toBeVisible();

  await page.locator('[data-tab="native"]').click();
  const detailButton = page.locator("[data-elf-details]").first();
  const alignmentLabel = page.locator(".native-library-meta .compare-diff-status", { hasText: "16 KB" });
  await expect(alignmentLabel).toBeVisible();
  await expect(alignmentLabel).toHaveCSS("border-top-style", "solid");
  await expect(alignmentLabel).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(detailButton).toHaveAttribute("aria-label", /libsmoke\.so/u);
  await detailButton.click();

  const dialog = page.locator("#elf-detail-dialog");
  const body = page.locator("#elf-detail-body");
  await expect(dialog).toBeVisible();
  await expect(body).toHaveAttribute("aria-busy", "false");
  await expect(body).toContainText("ELF64");
  await expect(body).toContainText("PT_LOAD");

  const spinnerShape = await body.evaluate((element) => {
    const spinner = document.createElement("span");
    spinner.className = "elf-detail-spinner";
    element.append(spinner);
    const style = getComputedStyle(spinner);
    const result = { cornerShape: style.cornerShape, width: spinner.offsetWidth, height: spinner.offsetHeight };
    spinner.remove();
    return result;
  });
  expect(spinnerShape).toEqual({ cornerShape: "round", width: 22, height: 22 });
  await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await body.evaluate((element) => {
    element.scrollTop = 120;
  });
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(detailButton).toBeFocused();

  const historyEntry = page.locator('[data-history-action="open"]').first();
  await expect(historyEntry).toContainText("Smoke APK");
  await historyEntry.click();
  await page.locator('[data-tab="native"]').click();
  await page.locator("[data-elf-details]").first().click();

  await expect(dialog).toBeVisible();
  await expect(page.locator(".elf-detail-status.is-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
