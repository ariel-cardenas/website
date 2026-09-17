/** Explicit retracing; normal builds never overwrite edited vector contours. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import { layouts } from "./scenes/layouts.mjs";
import { scenarios, sourceDirectory, minimumSimilarity, minimumRegionSimilarity, maximumRgbError } from "./scenes/catalog.mjs";
import { editingRegions } from "./scenes/regions.mjs";
import { quantize, vectorizePixels, traceOptions } from "./scenes/vectorize.mjs";
import { comparePixels } from "./compare-scene.mjs";

const names = process.argv.slice(2);
if (!names.length || names.some(name => !scenarios[name])) throw new Error("Specify valid weather names: sunny, rainy, snowy");
const root = new URL("../", import.meta.url);
await mkdir(new URL("docs/fidelity/", root), { recursive: true });
for (const name of names) {
  for (const orientation of ["horizontal", "vertical"]) {
    const started = performance.now();
    const layout = layouts[name][orientation];
    const source = await readFile(new URL(`${sourceDirectory}/${name}-${orientation}.png`, root));
    const reference = await sharp(source).removeAlpha().raw().toBuffer();
    const raw = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (raw.info.width !== layout.width || raw.info.height !== layout.height) throw new Error("Source/layout dimensions differ");
    quantize(raw.data, 4);
    const regions = editingRegions(layout, orientation);
    const owner = new Uint8Array(layout.width * layout.height).fill(regions.length);
    for (let index = regions.length - 1; index >= 0; index--) {
      const r = regions[index];
      for (let y = r.top; y < r.bottom; y++) owner.fill(index, y * layout.width + r.left, y * layout.width + r.right);
    }
    const allRegions = [...regions, { name: "terrain", left: 0, top: 0, right: layout.width, bottom: layout.height, anchorX: 0, anchorY: 0 }];
    const layers = [];
    for (let index = 0; index < allRegions.length; index++) {
      const region = allRegions[index];
      const width = region.right - region.left, height = region.bottom - region.top;
      const pixels = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sourceIndex = (region.top + y) * layout.width + region.left + x;
          if (owner[sourceIndex] !== index) continue;
          const p = sourceIndex * 4, target = (y * width + x) * 4;
          pixels[target] = raw.data[p]; pixels[target + 1] = raw.data[p + 1]; pixels[target + 2] = raw.data[p + 2]; pixels[target + 3] = 255;
        }
      }
      const paths = vectorizePixels(pixels, width, height).replace(/id="color-/g, `id="${region.name}-color-`);
      layers.push(`<g id="layer-${region.name}" data-landmark="${region.name}" data-origin-left="${region.left}" data-origin-top="${region.top}" data-origin-anchor-x="${region.anchorX}" data-origin-anchor-y="${region.anchorY}" transform="translate(${region.left} ${region.top})">\n${paths}\n</g>`);
      console.log(`${name}/${orientation}: traced ${region.name}`);
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- High-fidelity vector contours traced from the PNG. No embedded raster data. -->\n<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-labelledby="scene-title scene-description" data-weather="${name}" data-orientation="${orientation}">\n<title id="scene-title">${scenarios[name].title}</title>\n<desc id="scene-description">Detailed alpine artwork with Base Camp, Shangri-La, Trail Map, Gear Shop, News, a training zone, Northstar and the Mexican flag at the summit.</desc>\n${layers.join("\n")}\n</svg>\n`;
    const rendered = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
    const metrics = comparePixels(reference, rendered, layout.width, layout.height);
    const regionMetrics = Object.fromEntries(regions.map(r => [r.name, comparePixels(reference, rendered, layout.width, layout.height, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top })]));
    if (metrics.ssim < minimumSimilarity || metrics.rmse > maximumRgbError || Object.values(regionMetrics).some(m => m.ssim < minimumRegionSimilarity)) throw new Error(`Fidelity gate failed: ${JSON.stringify({ metrics, regionMetrics })}`);
    await writeFile(new URL(`assets/weather/${name}-${orientation}.svg`, root), svg);
    const report = {
      weather: name, orientation, width: layout.width, height: layout.height,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      svgSha256: createHash("sha256").update(svg).digest("hex"),
      quantizationStep: 4, traceOptions, bytes: Buffer.byteLength(svg), gzipBytes: gzipSync(svg).length,
      paths: (svg.match(/<path/g) || []).length, metrics, regionMetrics,
    };
    await writeFile(new URL(`docs/fidelity/${name}-${orientation}.json`, root), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ weather: name, orientation, seconds: (performance.now() - started) / 1000, ...metrics, paths: report.paths, bytes: report.bytes }));
  }
}
