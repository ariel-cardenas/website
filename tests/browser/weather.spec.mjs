import { test, expect } from "@playwright/test";
import { scenarios } from "../../scripts/scenes/catalog.mjs";
import { sourceDirectory } from "../../scripts/scenes/catalog.mjs";
import { comparePixels } from "../../scripts/compare-scene.mjs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const weatherNames = Object.keys(scenarios).filter(name => scenarios[name].converted);
const panels = ["northstar", "base", "gym", "shop", "refuge", "trailmap", "news", "summit"];

// Keep visual/click tests on their selected scenario. The dedicated clock test
// below exercises the unchanged real 30-second interval separately.
test.beforeEach(async ({ context }, testInfo) => {
  if (testInfo.title.includes("30-second")) return;
  await context.addInitScript(() => {
    const interval = window.setInterval;
    window.setInterval = (callback, delay, ...args) => interval(callback, delay === 30000 ? 3600000 : delay, ...args);
  });
});

for (const weather of weatherNames) {
  for (const orientation of ["horizontal", "vertical"]) {
    test(`${weather} ${orientation}: vector loads and every landmark opens`, async ({ page }, testInfo) => {
      await page.setViewportSize(orientation === "vertical" ? { width: 390, height: 844 } : { width: 1440, height: 810 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.goto(`/?weather=${weather}`);
      await expect(page.locator(".experience")).toHaveAttribute("data-weather", weather);
      await expect(page.locator(".scene-layer.is-visible")).toHaveClass(/is-rasterized/);
      await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-source", `assets/weather/${weather}-${orientation}.svg`);
      await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-renderer", "vector");
      await page.screenshot({ path: testInfo.outputPath(`${weather}-${orientation}.png`) });
      for (const panel of panels) {
        await page.locator(`[data-panel="${panel}"]`).click();
        await expect(page.locator("#mountain-panel")).toBeVisible();
        await expect(page.locator("#panel-title")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("#mountain-panel")).not.toBeVisible();
      }
      expect(errors).toEqual([]);
    });

    test(`${weather} ${orientation}: browser render matches the PNG reference`, async ({ page, context }, testInfo) => {
      const viewport = orientation === "vertical" ? { width: 390, height: 844 } : { width: 1440, height: 810 };
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/?weather=${weather}`);
      await expect(page.locator(".scene-layer.is-visible")).toHaveClass(/is-rasterized/);
      const actual = await page.screenshot({ path: testInfo.outputPath("vector.png") });
      const referencePage = await context.newPage();
      await referencePage.setViewportSize(viewport);
      await referencePage.emulateMedia({ reducedMotion: "reduce" });
      await referencePage.route("**/assets/weather/*.scene.json.gz", route => route.abort());
      await referencePage.route("**/assets/weather/*.webp", route => {
        const filename = new URL(route.request().url()).pathname.split("/").pop().replace(/\.webp$/, ".png");
        return route.fulfill({ path: fileURLToPath(new URL(`../../${sourceDirectory}/${filename}`, import.meta.url)), contentType: "image/png" });
      });
      await referencePage.goto(`/?weather=${weather}`);
      await expect(referencePage.locator(".scene-layer.is-visible")).toHaveClass(/is-rasterized/);
      const reference = await referencePage.screenshot({ path: testInfo.outputPath("original-png.png") });
      const a = await sharp(reference).removeAlpha().raw().toBuffer();
      const b = await sharp(actual).removeAlpha().raw().toBuffer();
      const metrics = comparePixels(a, b, viewport.width, viewport.height);
      console.log(`${weather}/${orientation} actual browser similarity: ${metrics.ssim.toFixed(6)}`);
      expect(metrics.ssim).toBeGreaterThanOrEqual(.975);
      expect(metrics.rmse).toBeLessThan(3);
      await referencePage.close();
    });
  }
}

test("no JavaScript still renders the faithful code-generated preview", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 810 } });
  const page = await context.newPage();
  await page.goto("/");
  const image = page.locator(".scene-layer.is-visible img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", "assets/weather/sunny-horizontal.webp");
  await context.close();
});

test("a real 30-second tick changes weather without blanking the scene", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const interval = window.setInterval;
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 30000) window.__testWeatherDeadline = Date.now() + delay;
      return interval(callback, delay, ...args);
    };
  });
  await page.goto("/?weather=sunny");
  await expect(page.locator(".scene-layer.is-visible img")).toHaveJSProperty("complete", true);
  await expect(page.locator(".scene-layer.is-visible")).toHaveClass(/is-rasterized/);
  await expect.poll(() => page.evaluate(() => window.__testWeatherDeadline)).toBeTruthy();
  const deadline = await page.evaluate(() => window.__testWeatherDeadline);
  await page.clock.pauseAt(new Date(deadline - 1));
  await expect(page.locator(".experience")).toHaveAttribute("data-weather", "sunny");
  await page.clock.runFor(1);
  await expect(page.locator(".experience")).not.toHaveAttribute("data-weather", "sunny");
  await expect(page.locator(".scene-layer.is-visible")).toHaveClass(/is-rasterized/);
});
