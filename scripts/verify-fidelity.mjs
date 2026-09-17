/** Re-render actual SVGs and independently check their original PNG references. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
import { scenarios, sourceDirectory, minimumSimilarity, minimumRegionSimilarity, maximumRgbError } from "./scenes/catalog.mjs";
import { layouts } from "./scenes/layouts.mjs";
import { editingRegions } from "./scenes/regions.mjs";
import { comparePixels } from "./compare-scene.mjs";

const root = new URL("../", import.meta.url);
for (const [weather, scenario] of Object.entries(scenarios)) {
  if (!scenario.converted) continue;
  for (const orientation of ["horizontal", "vertical"]) {
    const source = await readFile(new URL(`${sourceDirectory}/${weather}-${orientation}.png`, root));
    const svg = await readFile(new URL(`assets/weather/${weather}-${orientation}.svg`, root));
    const report = JSON.parse(await readFile(new URL(`docs/fidelity/${weather}-${orientation}.json`, root), "utf8"));
    assert.equal(createHash("sha256").update(source).digest("hex"), report.sourceSha256);
    assert.equal(createHash("sha256").update(svg).digest("hex"), report.svgSha256);
    const layout = layouts[weather][orientation];
    const reference = await sharp(source).removeAlpha().raw().toBuffer();
    const rendered = await sharp(svg).removeAlpha().raw().toBuffer();
    assert.equal(reference.length, rendered.length);
    const metrics = comparePixels(reference, rendered, layout.width, layout.height);
    assert.ok(metrics.ssim >= minimumSimilarity, `Scene similarity too low: ${weather}/${orientation}`);
    assert.ok(metrics.rmse <= maximumRgbError, `Color difference too large: ${weather}/${orientation}`);
    for (const r of editingRegions(layout, orientation)) {
      const local = comparePixels(reference, rendered, layout.width, layout.height, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
      assert.ok(local.ssim >= minimumRegionSimilarity, `Landmark similarity too low: ${weather}/${orientation}/${r.name}`);
    }
    console.log(`${weather}/${orientation}: SSIM ${metrics.ssim.toFixed(6)}, RGB RMSE ${metrics.rmse.toFixed(3)}`);
  }
}
