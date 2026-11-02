import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("MCP guide exposes current-origin config and restores keyboard focus", async ({ page }) => {
  await page.goto("/");
  const opener = page.locator("#mcp-guide-open");
  const dialog = page.locator("#mcp-guide");
  await opener.click();
  await expect(dialog).toBeVisible();
  await expect(page.locator("#mcp-guide-url")).toHaveText(new URL("/mcp", page.url()).href);
  await expect(page.locator("#mcp-guide-remote-config")).toContainText('[mcp_servers.apk_remote]');
  const close = dialog.locator(".mcp-guide-close");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator("a")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect((await new AxeBuilder({ page }).include("#mcp-guide").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await close.click();
  await expect(dialog).not.toBeVisible();
});

test("MCP remains in the mobile topbar and the guide fits the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const opener = page.locator(".topbar #mcp-guide-open");
  await expect(opener).toBeVisible();
  await opener.click();
  const dialog = page.locator("#mcp-guide");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("MCP waits for initialization before accepting clicks", async ({ page }) => {
  let releaseLocale;
  const localeReady = new Promise((resolve) => { releaseLocale = resolve; });
  await page.route(/\/assets\/(en|zh-Hans)-[^/]+\.js$/, async (route) => {
    await localeReady;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  try {
    await expect(page.locator("#mcp-guide-open")).toBeDisabled();
  } finally {
    releaseLocale();
  }
  await page.locator("#mcp-guide-open").click();
  await expect(page.locator("#mcp-guide")).toBeVisible();
});

test("MCP switches modes by keyboard and copies the exact configuration", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value) => { window.__mcpCopied = value; },
    } });
  });
  await page.goto("/");
  await page.locator("#mcp-guide-open").click();
  await page.locator('[data-mcp-copy="mcp-guide-remote-config"]').click();
  expect(await page.evaluate(() => window.__mcpCopied)).toBe(`[mcp_servers.apk_remote]\nurl = "${new URL("/mcp", page.url()).href}"`);
  await expect(page.locator('#mcp-guide [role="status"]')).not.toBeEmpty();
  await page.locator("#mcp-tab-remote").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#mcp-tab-local")).toBeFocused();
  await expect(page.locator("#mcp-panel-remote")).toBeHidden();
  await expect(page.locator("#mcp-panel-local")).toBeVisible();
  await expect(page.locator("#mcp-guide-local-config")).toContainText("/absolute/path/to/tgbot/packages/apk-mcp/src/server.mjs");
  expect((await new AxeBuilder({ page }).include("#mcp-guide").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Denied"); }; });
  await page.locator('[data-mcp-copy="mcp-guide-local-config"]').click();
  await expect(page.locator('#mcp-guide [role="status"]')).not.toBeEmpty();
  expect(await page.locator('#mcp-guide [role="status"]').textContent()).not.toMatch(/Copied to clipboard|已复制到剪贴板/);
});

test("MCP setup prompt copies the current endpoint and supports three-tab navigation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value) => { window.__mcpCopied = value; },
    } });
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await page.locator("#mcp-guide-open").click();
  await page.locator("#mcp-tab-remote").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#mcp-tab-prompt")).toBeFocused();
  await expect(page.locator("#mcp-panel-prompt")).toBeVisible();
  const prompt = page.locator("#mcp-guide-prompt");
  await expect(prompt).toContainText(new URL("/mcp", page.url()).href);
  await expect(prompt).toContainText("analyze_apk_url");
  await expect(prompt).toContainText("https://github.com/LibChecker/tgbot#mcp-clients");
  await page.locator('[data-mcp-copy="mcp-guide-prompt"]').click();
  expect(await page.evaluate(() => window.__mcpCopied)).toBe(await prompt.textContent());
  expect(await page.locator("#mcp-guide").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include("#mcp-guide").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.locator("#mcp-tab-prompt").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#mcp-tab-remote")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator("#mcp-tab-prompt")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("#mcp-tab-remote")).toBeFocused();
});
