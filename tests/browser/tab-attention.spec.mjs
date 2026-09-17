import { test, expect } from "@playwright/test";
import sharp from "sharp";

test("link-preview metadata uses the sunny PNG without running JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/?weather=rainy");
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(image).toMatch(/\/sunny-horizontal\.png$/);
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", image);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  const response = await page.request.get(new URL(image, page.url()).href);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toBe("image/png");
  const metadata = await sharp(await response.body()).metadata();
  expect(metadata.width).toBe(1672);
  expect(metadata.height).toBe(941);
  await context.close();
});

async function openPage(page, reducedMotion = "no-preference") {
  await page.emulateMedia({ reducedMotion });
  // These tests isolate tab lifecycle from expensive scenery preparation.
  await page.route("**/assets/weather/*.scene.json.gz", route => route.abort());
  await page.clock.install();
  await page.goto("/?weather=sunny");
  await page.clock.pauseAt(await page.evaluate(() => new Date().toISOString()));
}

// Headless pages do not expose a real browser tab bar. Exercise the native
// visibilitychange handler with controlled visibility and the browser clock.
async function setHidden(page, hidden) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("favicon waits 10 hidden seconds, blinks, and restores on return", async ({ page }) => {
  await openPage(page);
  const icon = page.locator('link[rel="icon"]');
  await page.clock.runFor(20_000);
  await expect(icon).toHaveAttribute("href", "assets/favicon.svg");
  await expect(page).toHaveTitle("Ariel Cárdenas");
  await setHidden(page, true);
  await page.clock.runFor(9_999);
  await expect(icon).toHaveAttribute("href", "assets/favicon.svg");
  await expect(page).toHaveTitle("Ariel Cárdenas");
  await page.clock.runFor(1);
  await expect(icon).toHaveAttribute("href", /\/assets\/favicon-emoji\.svg$/);
  await expect(page).toHaveTitle("Hey, I miss u");
  const emoji = await page.request.get(await icon.getAttribute("href"));
  expect(emoji.ok()).toBe(true);
  expect(await emoji.text()).toContain("😢</text>");
  await page.clock.runFor(499);
  await expect(icon).toHaveAttribute("href", /\/assets\/favicon-emoji\.svg$/);
  await expect(page).toHaveTitle("Hey, I miss u");
  await page.clock.runFor(1);
  await expect(icon).toHaveAttribute("href", /\/assets\/favicon-blank\.svg$/);
  await expect(page).toHaveTitle("Hey, I miss u");
  const blank = await page.request.get(await icon.getAttribute("href"));
  expect(blank.ok()).toBe(true);
  const blankPixels = await sharp(await blank.body()).ensureAlpha().raw().toBuffer();
  expect(blankPixels.every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
  await page.clock.runFor(500);
  await expect(icon).toHaveAttribute("href", /\/assets\/favicon-emoji\.svg$/);
  await expect(page).toHaveTitle("Hey, I miss u");
  await setHidden(page, false);
  await expect(icon).toHaveAttribute("href", "assets/favicon.svg");
  await expect(page).toHaveTitle("Ariel Cárdenas");
  await page.clock.runFor(20_000);
  await expect(icon).toHaveAttribute("href", "assets/favicon.svg");
  await expect(page).toHaveTitle("Ariel Cárdenas");
});

test("returning early cancels attention and a new absence gets a fresh delay", async ({ page }) => {
  await openPage(page);
  const icon = page.locator('link[rel="icon"]');
  await setHidden(page, true);
  await page.clock.runFor(5000);
  await setHidden(page, false);
  await page.clock.runFor(10_000);
  await expect(icon).toHaveAttribute("href", "assets/favicon.svg");
  await expect(page).toHaveTitle("Ariel Cárdenas");
  await setHidden(page, true);
  await page.clock.runFor(9_999);
  await expect(icon).toHaveAttribute("href", "assets/favicon.svg");
  await page.clock.runFor(1);
  await expect(icon).toHaveAttribute("href", /\/assets\/favicon-emoji\.svg$/);
});

test("reduced motion highlights the favicon without blinking", async ({ page }) => {
  await openPage(page, "reduce");
  const icon = page.locator('link[rel="icon"]');
  await setHidden(page, true);
  await page.clock.runFor(10_000);
  await expect(icon).toHaveAttribute("href", /\/assets\/favicon-emoji\.svg$/);
  await expect(page).toHaveTitle("Hey, I miss u");
  await page.clock.runFor(5000);
  await expect(icon).toHaveAttribute("href", /\/assets\/favicon-emoji\.svg$/);
  await expect(page).toHaveTitle("Hey, I miss u");
  await setHidden(page, false);
  await expect(icon).toHaveAttribute("href", "assets/favicon.svg");
  await expect(page).toHaveTitle("Ariel Cárdenas");
});
