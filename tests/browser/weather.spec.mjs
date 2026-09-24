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
  await page.evaluate(async () => {
    for (const assets of Object.values(window.MOUNTAIN_WEATHER_SCENES)) await window.MountainSceneCache.get(assets.horizontal);
  });
  await expect.poll(() => page.evaluate(() => window.__testWeatherDeadline)).toBeTruthy();
  const deadline = await page.evaluate(() => window.__testWeatherDeadline);
  await page.clock.pauseAt(new Date(deadline - 1));
  await expect(page.locator(".experience")).toHaveAttribute("data-weather", "sunny");
  await page.clock.runFor(1);
  await expect(page.locator(".experience")).not.toHaveAttribute("data-weather", "sunny");
  await expect(page.locator(".scene-layer.is-visible")).toHaveClass(/is-rasterized/);
});

test("all scenarios reuse vector surfaces and textures during hover and crossfades", async ({ page }) => {
  await page.addInitScript(() => {
    const NativePath2D = window.Path2D;
    window.__testPathCount = 0;
    window.Path2D = class extends NativePath2D {
      constructor(...args) { super(...args); window.__testPathCount++; }
    };
  });
  const bitmapRequests = [];
  page.on("request", request => { if (/\.png(?:\?|$)/.test(request.url())) bitmapRequests.push(request.url()); });
  await page.goto("/?weather=sunny");
  await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-renderer", "vector");
  const cached = await page.evaluate(async () => {
    for (const assets of Object.values(window.MOUNTAIN_WEATHER_SCENES)) {
      await window.MountainSceneCache.get(assets.horizontal);
      await mountainRenderer?.preload(assets.horizontal);
    }
    const source = window.MOUNTAIN_WEATHER_SCENES.sunny.horizontal;
    const sameSurface = await window.MountainSceneCache.get(source) === await window.MountainSceneCache.get(source);
    return { sameSurface, paths: window.__testPathCount, gpu: Boolean(mountainRenderer?.ready), textures: mountainRenderer?.textureCache.size };
  });
  expect(cached.sameSurface).toBe(true);
  if (cached.gpu) expect(cached.textures).toBe(3);
  for (const weather of ["rainy", "snowy", "sunny"]) {
    await page.evaluate(name => changeWeather(name), weather);
    await expect(page.locator(".experience")).toHaveAttribute("data-weather", weather);
    await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-renderer", "vector");
    if (cached.gpu) await expect.poll(() => page.evaluate(() => mountainRenderer.nextTexture === null && mountainRenderer.currentSource === weatherAsset(currentWeather))).toBe(true);
  }
  // Cancel a transition before it completes, including returning to its source.
  await page.evaluate(async () => { await changeWeather("rainy"); await changeWeather("sunny"); });
  if (cached.gpu) await expect.poll(() => page.evaluate(() => mountainRenderer.nextTexture === null && mountainRenderer.currentSource === weatherAsset("sunny"))).toBe(true);
  await page.mouse.move(760, 560);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__testPathCount)).toBe(cached.paths);
  expect(bitmapRequests).toEqual([]);
});

test("desktop/mobile breakpoint swaps keep the correct composition and open panel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto("/?weather=sunny");
  await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-renderer", "vector");
  await page.locator('[data-panel="refuge"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-source", "assets/weather/sunny-vertical.svg");
  await expect(page.locator("#mountain-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mountain-panel")).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 810 });
  await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-source", "assets/weather/sunny-horizontal.svg");
  if (await page.evaluate(() => Boolean(mountainRenderer?.ready))) {
    await expect(page.locator(".experience")).toHaveClass(/has-webgl/);
    expect(await page.evaluate(() => mountainRenderer.currentSource)).toBe("assets/weather/sunny-horizontal.svg");
  }
});

test("the WebGL scene is oriented like the canvas one it replaces", async ({ page, context }, testInfo) => {
  const viewport = { width: 1440, height: 810 };
  await page.setViewportSize(viewport);
  // No reduced motion here: the WebGL layer only replaces the picture when
  // animation is allowed, so the canvas rendering comes from a second page.
  await page.goto("/?weather=sunny");
  await page.waitForFunction(() => Boolean(mountainRenderer?.ready), null, { timeout: 20_000 }).catch(() => {});
  test.skip(!(await page.evaluate(() => Boolean(mountainRenderer?.ready))), "no WebGL in this browser");
  await expect(page.locator(".experience")).toHaveClass(/has-webgl/);
  const gpu = await page.screenshot({ path: testInfo.outputPath("webgl.png") });

  const canvasPage = await context.newPage();
  await canvasPage.setViewportSize(viewport);
  await canvasPage.emulateMedia({ reducedMotion: "reduce" });
  await canvasPage.goto("/?weather=sunny");
  await expect(canvasPage.locator(".scene-layer.is-visible")).toHaveClass(/is-rasterized/);
  await expect(canvasPage.locator(".experience")).not.toHaveClass(/has-webgl/);
  const canvas = await canvasPage.screenshot({ path: testInfo.outputPath("canvas.png") });

  const metrics = comparePixels(
    await sharp(canvas).removeAlpha().raw().toBuffer(),
    await sharp(gpu).removeAlpha().raw().toBuffer(),
    viewport.width,
    viewport.height,
  );
  console.log(`webgl vs canvas similarity: ${metrics.ssim.toFixed(6)}`);
  expect(metrics.ssim).toBeGreaterThanOrEqual(.95);
  await canvasPage.close();
});

test("losing WebGL retains the cached code-rendered scene", async ({ page }) => {
  await page.goto("/?weather=sunny");
  await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-renderer", "vector");
  const lost = await page.evaluate(() => {
    const extension = mountainRenderer?.gl?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  if (lost) await expect(page.locator(".experience")).not.toHaveClass(/has-webgl/);
  await expect(page.locator(".scene-layer.is-visible .scene-raster")).toBeVisible();
  await page.locator('[data-panel="base"]').click();
  await expect(page.locator("#mountain-panel")).toBeVisible();
});

test("a real touch-device context uses code rendering without requiring WebGL", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto("/?weather=snowy");
  await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-source", "assets/weather/snowy-vertical.svg");
  await expect(page.locator(".scene-layer.is-visible")).toHaveAttribute("data-scene-renderer", "vector");
  await expect(page.locator(".experience")).not.toHaveClass(/has-webgl/);
  await page.locator('[data-panel="shop"]').tap();
  await expect(page.locator("#mountain-panel")).toBeVisible();
  await context.close();
});
