/** Rasterizes a compiled scene off the main thread.
 * The page stays responsive while ~180k contours are filled, and only the
 * finished ImageBitmap is transferred back.
 */
"use strict";

async function loadInstructions(source) {
  const response = await fetch(source.replace(/\.svg$/, ".scene.json.gz"));
  if (!response.ok || !response.body) throw new Error(`Vector scene unavailable: ${source}`);
  const scene = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
  if (scene.version !== 1 || !scene.layers?.length) throw new Error("Unsupported scene instructions");
  return scene;
}

function drawVector(scene) {
  const canvas = new OffscreenCanvas(scene.width, scene.height);
  // willReadFrequently keeps the raster on the CPU: intricate multi-contour
  // fills are far cheaper there than through GPU tessellation.
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("2D vector surface unavailable");
  for (const layer of scene.layers) {
    context.save();
    context.setTransform(1, 0, 0, 1, layer.x, layer.y);
    if (layer.clip) context.clip(new Path2D(layer.clip));
    for (const [fill, contours] of layer.paths) {
      context.fillStyle = fill;
      context.fill(new Path2D(contours));
    }
    context.restore();
  }
  return canvas.transferToImageBitmap();
}

async function drawPreview(source) {
  const response = await fetch(source.replace(/\.svg$/, ".webp"));
  if (!response.ok) throw new Error(`Scene unavailable: ${source}`);
  return createImageBitmap(await response.blob());
}

self.addEventListener("message", async (event) => {
  const { id, source } = event.data;
  try {
    let bitmap;
    let renderer = "vector";
    try {
      bitmap = drawVector(await loadInstructions(source));
    } catch (error) {
      renderer = "preview";
      bitmap = await drawPreview(source);
    }
    self.postMessage({ id, bitmap, renderer }, [bitmap]);
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
});
