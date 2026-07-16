import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createSmokeApk } from "./fixtures.mjs";

const DISMISS_STORAGE_KEY = "apk-webui-pwa-guide-dismissed-until";
const INSTALLED_STORAGE_KEY = "apk-webui-pwa-installed-until";
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const smokeApk = {
  name: "smoke.apk",
  mimeType: "application/vnd.android.package-archive",
  buffer: createSmokeApk(),
};
const smokeApkBase64 = smokeApk.buffer.toString("base64");

async function stubDesktopPwaApis(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: {
        brands: [],
        mobile: false,
        platform: "macOS",
        getHighEntropyValues: async () => ({
          platform: "macOS",
          platformVersion: "14.0.0",
        }),
      },
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: {
        setConsumer(consumer) {
          window.__pwaLaunchConsumer = consumer;
        },
      },
    });
  });
}

async function openPwaCapablePage(page) {
  await stubDesktopPwaApis(page);
  await page.goto("/");
  await expect(page.locator("#analyze-form")).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => typeof window.__pwaLaunchConsumer),
  ).toBe("function");
}

async function analyzeSmokeApk(page) {
  const workerStarted = page.waitForEvent("worker");
  await page.locator("#file-input").setInputFiles(smokeApk);
  await page.locator("#analyze-button").click();
  await workerStarted;
  await expect(page.locator("#result-view")).toBeVisible();
  await expect(page.locator("#report-hero")).toContainText("Smoke APK");
}

async function waitForGuideModule(page) {
  await expect.poll(() => page.evaluate(() => (
    performance.getEntriesByType("resource")
      .some(({ name }) => name.includes("pwa-install-guide"))
  ))).toBe(true);
}

test("opens a launchQueue APK in the analyzer automatically", async ({ page }) => {
  await openPwaCapablePage(page);

  const workerStarted = page.waitForEvent("worker");
  await page.evaluate(async ({ base64 }) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const file = new File([bytes], "smoke.apk", {
      type: "application/vnd.android.package-archive",
    });
    await window.__pwaLaunchConsumer({
      files: [{ getFile: async () => file }],
    });
  }, { base64: smokeApkBase64 });
  const worker = await workerStarted;

  expect(worker.url()).toContain("analyzer-worker");
  await expect(page.locator("#result-view")).toBeVisible();
  await expect(page.locator("#report-hero")).toContainText("Smoke APK");
  await expect(page.locator("#tab-panel")).toContainText("com.example.smoke");
});

test("dismisses the macOS install guide for 30 days across reloads", async ({ page }) => {
  await openPwaCapablePage(page);
  await analyzeSmokeApk(page);

  const guide = page.locator("#pwa-install-guide");
  await expect(guide).toBeVisible();
  await guide.locator("[data-pwa-guide-dismiss]").click();
  await expect(guide).toBeHidden();

  const remainingMs = await page.evaluate((key) => (
    Number(localStorage.getItem(key)) - Date.now()
  ), DISMISS_STORAGE_KEY);
  expect(remainingMs).toBeGreaterThan(DISMISS_DURATION_MS - 10_000);
  expect(remainingMs).toBeLessThanOrEqual(DISMISS_DURATION_MS);

  await page.reload();
  await expect.poll(
    () => page.evaluate(() => typeof window.__pwaLaunchConsumer),
  ).toBe("function");
  await analyzeSmokeApk(page);
  await waitForGuideModule(page);
  await expect(guide).toBeHidden();
});

test("shows the completed guide scene without playback for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openPwaCapablePage(page);
  await analyzeSmokeApk(page);

  const guide = page.locator("#pwa-install-guide");
  await expect(guide).toBeVisible();
  await expect(guide).toHaveClass(/\bis-complete\b/u);
  await expect(guide).not.toHaveClass(/\bis-playing\b/u);
  await expect(guide.locator(".pwa-guide-scene--report")).toHaveCSS("opacity", "1");
  await expect(guide.locator("[data-pwa-guide-replay]")).toHaveCount(0);
  await expect.poll(() => guide.evaluate((element) => (
    element.getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running").length
  ))).toBe(0);
});

test("holds the completed scene, then automatically replays without a manual control", async ({ page }) => {
  await openPwaCapablePage(page);
  await analyzeSmokeApk(page);

  const guide = page.locator("#pwa-install-guide");
  await expect(guide).toBeVisible();
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toHaveClass(/\bis-playing\b/u);
  await expect(guide.locator("[data-pwa-guide-replay]")).toHaveCount(0);

  await guide.locator(".pwa-guide-scene--report").dispatchEvent("animationend", {
    animationName: "pwa-guide-scene-report",
    bubbles: true,
  });
  await expect(guide).toHaveClass(/\bis-complete\b/u);
  await page.waitForTimeout(1200);
  await expect(guide).toHaveClass(/\bis-complete\b/u);
  await expect(guide).toHaveClass(/\bis-playing\b/u);
});

test("fully masks the report checkmark until its reveal phase", async ({ page }) => {
  await openPwaCapablePage(page);
  await analyzeSmokeApk(page);

  const guide = page.locator("#pwa-install-guide");
  await expect(guide).toBeVisible();
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toHaveClass(/\bis-playing\b/u);

  const checkmark = guide.locator(".pwa-guide-check-path");
  const mask = await checkmark.evaluate(async (element) => {
    const badge = element.closest(".pwa-guide-check");
    for (const animation of badge.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 6800;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      badgeOpacity: Number.parseFloat(getComputedStyle(badge).opacity),
      dasharray: Number.parseFloat(getComputedStyle(element).strokeDasharray),
      length: element.getTotalLength(),
      offset: Number.parseFloat(getComputedStyle(element).strokeDashoffset),
    };
  });

  expect(mask.badgeOpacity).toBe(0);
  expect(mask.dasharray).toBeCloseTo(mask.length, 3);
  expect(mask.offset).toBeGreaterThanOrEqual(mask.length);
});

test("shows the install guide only after the first successful analysis in a page session", async ({ page }) => {
  await openPwaCapablePage(page);
  await analyzeSmokeApk(page);

  const guide = page.locator("#pwa-install-guide");
  const analyzeButton = page.locator("#analyze-button");
  await expect(guide).toBeVisible();

  await page.evaluate(() => {
    const button = document.querySelector("#analyze-button");
    window.__pwaSecondAnalysisDone = new Promise((resolve) => {
      let sawBusy = false;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.oldValue === null) {
            sawBusy = true;
          } else if (sawBusy) {
            observer.disconnect();
            resolve();
            return;
          }
        }
      });
      observer.observe(button, {
        attributeFilter: ["disabled"],
        attributeOldValue: true,
      });
    });
  });
  await page.locator("#file-input").setInputFiles(smokeApk);
  await analyzeButton.click();
  await page.evaluate(() => window.__pwaSecondAnalysisDone);
  await expect(page.locator("#progress")).toHaveClass(/\bis-complete\b/u);
  await expect(guide).toBeHidden();
});

test("finishes active guide playback when reduced motion turns on", async ({ page }) => {
  await openPwaCapablePage(page);
  await analyzeSmokeApk(page);

  const guide = page.locator("#pwa-install-guide");
  await expect(guide).toBeVisible();
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toHaveClass(/\bis-playing\b/u);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(guide).toHaveClass(/\bis-complete\b/u);
  await expect(guide).not.toHaveClass(/\bis-playing\b/u);
  await expect(guide.locator(".pwa-install-guide__progress-item--one")).toHaveCSS("width", "6px");
  await expect(guide.locator(".pwa-install-guide__progress-item--three")).toHaveCSS("width", "18px");
  await expect(guide.locator("[data-pwa-guide-replay]")).toHaveCount(0);
  await page.waitForTimeout(2600);
  await expect(guide).toHaveClass(/\bis-complete\b/u);
  await expect(guide).not.toHaveClass(/\bis-playing\b/u);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(guide).toHaveClass(/\bis-complete\b/u);
  await expect(guide).toHaveClass(/\bis-playing\b/u);
});

test("uses corner brackets in the Simplified Chinese install guide", async ({ page }) => {
  await openPwaCapablePage(page);
  await page.locator("#language-select").selectOption("zh-Hans");
  await analyzeSmokeApk(page);

  const guide = page.locator("#pwa-install-guide");
  await expect(guide).toContainText("「安装 LibChecker WebUI」");
  await expect(guide).toContainText("在「打开方式」中选择 LibChecker WebUI");
  await expect(guide.locator("[data-pwa-guide-install]")).toHaveText("安装");
  await expect(guide).not.toContainText(/[“”]/u);

  const padding = await guide.evaluate((element) => {
    const background = element.querySelector(".pwa-guide-install-control .pwa-guide-accent-fill");
    const icon = element.querySelector(".pwa-guide-button-icon");
    const label = element.querySelector(".pwa-guide-button-label");
    const buttonX = Number(background.getAttribute("x"));
    const buttonWidth = Number(background.getAttribute("width"));
    const iconX = Number(icon.getAttribute("x"));
    const labelX = Number(label.getAttribute("x"));
    return {
      left: iconX - buttonX,
      right: buttonX + buttonWidth - labelX - label.getComputedTextLength(),
      width: buttonWidth,
    };
  });
  expect(padding.left).toBeCloseTo(padding.right, 0);
  expect(padding.width).toBeLessThan(80);
});

test("keeps the localized install pill compact without SVG text measurement", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(SVGTextContentElement.prototype, "getComputedTextLength", {
      configurable: true,
      value: () => 0,
    });
  });
  await openPwaCapablePage(page);
  await page.locator("#language-select").selectOption("zh-Hans");
  await analyzeSmokeApk(page);

  const guide = page.locator("#pwa-install-guide");
  await expect(guide.locator("[data-pwa-guide-install]")).toHaveText("安装");
  const width = await guide.locator(".pwa-guide-install-control .pwa-guide-accent-fill")
    .evaluate((element) => Number(element.getAttribute("width")));
  expect(width).toBeLessThan(80);
});

test("uses the captured beforeinstallprompt event from the install CTA", async ({ page }) => {
  await openPwaCapablePage(page);
  await page.evaluate(() => {
    window.__pwaInstallPromptCalls = 0;
    const installEvent = new Event("beforeinstallprompt", { cancelable: true });
    installEvent.prompt = async () => {
      window.__pwaInstallPromptCalls += 1;
    };
    installEvent.userChoice = Promise.resolve({
      outcome: "dismissed",
      platform: "web",
    });
    window.dispatchEvent(installEvent);
  });
  await analyzeSmokeApk(page);

  const installButton = page.locator("[data-pwa-guide-install]");
  await expect(installButton).toBeVisible();
  await installButton.click();
  await expect.poll(
    () => page.evaluate(() => window.__pwaInstallPromptCalls),
  ).toBe(1);
});

test("remembers an address-bar installation before the guide is created", async ({ page }) => {
  await openPwaCapablePage(page);
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect.poll(
    () => page.evaluate((key) => Number(localStorage.getItem(key)), INSTALLED_STORAGE_KEY),
  ).toBeGreaterThan(Date.now());

  await analyzeSmokeApk(page);
  await waitForGuideModule(page);
  await expect(page.locator("#pwa-install-guide")).toBeHidden();
});

test("visible install guide has no automatically detectable WCAG A or AA violations", async ({ page }) => {
  await openPwaCapablePage(page);
  await analyzeSmokeApk(page);
  await expect(page.locator("#pwa-install-guide")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("#pwa-install-guide")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
