/** Update layout anchors on existing editable contours. Never retrace edits. */
import { readFile, writeFile } from "node:fs/promises";
import { layouts, hotspotStyles } from "./scenes/layouts.mjs";
import { scenarios, sourceDirectory } from "./scenes/catalog.mjs";
import { compileScene } from "./scenes/compile.mjs";
import { gzipSync } from "node:zlib";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(scenarios).filter(name => scenarios[name].converted);
if (names.some(name => !scenarios[name]?.converted)) throw new Error("A requested scene has not been converted yet");
for (const name of names) {
  for (const orientation of ["horizontal", "vertical"]) {
    const target = new URL(`assets/weather/${name}-${orientation}.svg`, root);
    let svg = await readFile(target, "utf8");
    svg = svg.replace(/<g id="layer-([^"\s]+)"[^>]+>/g, (tag, region) => {
      if (region === "terrain") return tag;
      const values = Object.fromEntries([...tag.matchAll(/data-origin-([^=]+)="([^"]+)"/g)].map(m => [m[1], Number(m[2])]));
      const layout = layouts[name][orientation];
      const point = layout.landmarks[region];
      if (!point) throw new Error(`Unrecognized region: ${region}`);
      const x = values.left + (point.x - values["anchor-x"]) * layout.width / 100;
      const y = values.top + (point.y - values["anchor-y"]) * layout.height / 100;
      return tag.replace(/transform="[^"]+"/, `transform="translate(${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100})"`);
    });
    await writeFile(target, svg);
    await writeFile(new URL(`assets/weather/${name}-${orientation}.scene.json.gz`, root), gzipSync(JSON.stringify(compileScene(svg)), { level: 9 }));
    // The preview only has to survive a blurred backdrop and the moment before
    // the vector surface is ready, so quality 90 keeps it visually equal to the
    // PNG reference at roughly a quarter of the lossless download.
    await sharp(Buffer.from(svg)).webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(new URL(`assets/weather/${name}-${orientation}.webp`, root).pathname);
    console.log(`Updated ${name}/${orientation}`);
  }
}
await writeFile(new URL("css/scene-hotspots.css", root), hotspotStyles());
const registry = Object.fromEntries(Object.entries(scenarios).map(([name, scene]) => [name, {
  ...Object.fromEntries(["horizontal", "vertical"].map(orientation => [orientation, `${scene.converted ? "assets/weather" : sourceDirectory}/${name}-${orientation}.${scene.converted ? "svg" : "png"}`])),
  preview: Object.fromEntries(["horizontal", "vertical"].map(orientation => [orientation, `${scene.converted ? "assets/weather" : sourceDirectory}/${name}-${orientation}.${scene.converted ? "webp" : "png"}`])),
}]));
await writeFile(new URL("js/weather-scenes.js", root), `/** Generated registry. Geometry lives in assets/weather/*.svg. */\nwindow.MOUNTAIN_WEATHER_SCENES = Object.freeze(${JSON.stringify(registry, null, 2)});\n`);
