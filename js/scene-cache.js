/** Draw complex SVG source once at its original resolution. Camera movement,
 * hover effects and crossfades then reuse a cached surface, not SVG DOM paths.
 * All six source SVGs remain independently editable; no bitmap is embedded.
 *
 * Rasterization runs in js/scene-worker.js wherever workers can own an
 * OffscreenCanvas, so filling ~180k contours never blocks interaction. Browsers
 * without that support keep the time-sliced main-thread path below.
 */
(function installSceneCache() {
  "use strict";
  const surfaces = new Map();
  const workerSupported = typeof Worker === "function"
    && typeof OffscreenCanvas === "function"
    && typeof DecompressionStream === "function";
  let worker = null;
  let workerBroken = !workerSupported;
  let pendingId = 0;
  const pending = new Map();

  function getWorker() {
    if (worker || workerBroken) return worker;
    try {
      worker = new Worker("js/scene-worker.js?v=1");
    } catch (_) {
      workerBroken = true;
      return null;
    }
    worker.addEventListener("message", (event) => {
      const { id, bitmap, renderer, error } = event.data;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve({ image: bitmap, width: bitmap.width, height: bitmap.height, renderer });
    });
    worker.addEventListener("error", () => {
      workerBroken = true;
      for (const request of pending.values()) request.reject(new Error("Scene worker unavailable"));
      pending.clear();
      worker?.terminate();
      worker = null;
    });
    return worker;
  }

  function rasterizeInWorker(source) {
    const instance = getWorker();
    if (!instance) return Promise.reject(new Error("Scene worker unavailable"));
    const id = ++pendingId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // The worker resolves relative paths against js/, not the document.
      instance.postMessage({ id, source: new URL(source, document.baseURI).href });
    });
  }

  async function preview(source) {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`Scene unavailable: ${source}`));
    });
    image.src = source.replace(/\.svg$/, ".webp");
    await loaded;
    if (image.decode) await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("2D scene surface unavailable");
    context.drawImage(image, 0, 0);
    return { image: canvas, width: canvas.width, height: canvas.height, renderer: "preview" };
  }

  async function drawVector(source) {
    const response = await fetch(source.replace(/\.svg$/, ".scene.json.gz"));
    if (!response.ok || !response.body) throw new Error(`Vector scene unavailable: ${source}`);
    const scene = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
    if (scene.version !== 1 || !scene.layers?.length) throw new Error("Unsupported scene instructions");
    const canvas = document.createElement("canvas");
    canvas.width = scene.width;
    canvas.height = scene.height;
    // Software rasterization avoids expensive GPU tessellation of intricate
    // multi-contour paths. The finished bitmap is composited/uploaded only once.
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("2D vector surface unavailable");
    let budgetStarted = performance.now();
    for (const layer of scene.layers) {
      context.save();
      context.setTransform(1, 0, 0, 1, layer.x, layer.y);
      if (layer.clip) context.clip(new Path2D(layer.clip));
      for (const [fill, contours] of layer.paths) {
        context.fillStyle = fill;
        context.fill(new Path2D(contours));
        if (performance.now() - budgetStarted > 8) {
          await new Promise(resolve => window.setTimeout(resolve, 0));
          budgetStarted = performance.now();
        }
      }
      context.restore();
    }
    return { image: canvas, width: canvas.width, height: canvas.height, renderer: "vector" };
  }

  async function rasterizeOnMainThread(source) {
    if (source.endsWith(".svg") && window.Path2D && window.DecompressionStream) {
      try { return await drawVector(source); } catch (error) {
        console.warn("Vector scene unavailable; using its generated preview.", error);
      }
    }
    return preview(source);
  }

  function get(source) {
    if (surfaces.has(source)) return surfaces.get(source);
    const promise = (async () => {
      if (!workerBroken && source.endsWith(".svg")) {
        try { return await rasterizeInWorker(source); } catch (error) {
          console.warn("Scene worker unavailable; rasterizing on the main thread.", error);
        }
      }
      return rasterizeOnMainThread(source);
    })().catch(error => {
      surfaces.delete(source);
      throw error;
    });
    surfaces.set(source, promise);
    return promise;
  }

  async function paint(layer, source, shouldCommit = () => true) {
    const surface = await get(source);
    if (!shouldCommit()) return false;
    let canvas = layer.querySelector(".scene-raster");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "scene-raster";
      canvas.setAttribute("aria-hidden", "true");
      layer.append(canvas);
    }
    canvas.width = surface.width;
    canvas.height = surface.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return false;
    context.drawImage(surface.image, 0, 0);
    layer.classList.add("is-rasterized");
    layer.dataset.sceneSource = source;
    layer.dataset.sceneRenderer = surface.renderer;
    return true;
  }
  window.MountainSceneCache = Object.freeze({ get, paint });
})();
