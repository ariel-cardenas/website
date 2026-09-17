# Personal Website

A single-screen, framework-free portfolio. The mountain is the interface: eight landmarks open soft content panels. Weather is selected before first paint, avoids repeating the previous session value on reload, and crossfades to a different random state every 30 seconds.

## Files

```text
website/
├── assets/
│   ├── favicon.svg
│   ├── social/                  # Social media icons
│   └── weather/                 # Editable SVGs, compiled contours, lossless previews
│       └── reference/           # Untouched original PNGs, used only for QA/retracing
├── css/
│   ├── styles.css               # Composition and motion
│   └── scene-hotspots.css       # Generated from shared landmark layouts
├── js/
│   ├── main.js                  # Weather, dialogs, hotspots, audio, and parallax
│   ├── weather-scenes.js        # Initial-paint and runtime scene registry
│   ├── scene-cache.js           # Draw compiled vector contours once, cache surfaces
│   ├── mountain-renderer.js     # WebGL liquid-hover renderer
│   └── weather-music.js         # Web Audio chiptune arrangements
├── index.html                   # Scene, panel templates, and content
├── scripts/scenes/              # Layouts, editing regions, and trace settings
├── scripts/build-scenes.mjs     # Compile contours, previews, and hotspot CSS
├── scripts/trace-scenes.mjs     # Explicit high-fidelity PNG-to-vector conversion
├── docs/fidelity/               # Native-size whole-scene and landmark comparisons
├── tests/                       # Scene integrity and real-browser interaction tests
├── package.json
├── package-lock.json
└── README.md
```

## Run locally

Use a static HTTP server for vector rendering. Opening `index.html` directly uses the generated preview fallback. With Node installed:

```sh
npm run dev
```

## Extend it

- Edit content in the eight `<template>` elements at the bottom of `index.html`.
- Desktop and mobile drawing anchors and hotspot sizes share `scripts/scenes/layouts.mjs`. Rebuilding writes `css/scene-hotspots.css`.
- Weather image paths are in `js/weather-scenes.js`; the 30-second interval is at the top of `js/main.js`.
- To add a landmark, create a hotspot with `data-panel="name"`, add `<template id="panel-name">`, and define its `--x` / `--y` position.

The `#world` element can later become a PixiJS or Three.js mount point. Its hotspots should remain in the same transformed container or be projected from the renderer so they continue to track the artwork.

## Editable background artwork

All three backgrounds (sunny, rainy, snowy) are high-fidelity contour traces of their original PNGs, preserving composition, lighting, lettering, and fine texture rather than replacing them with simplified shapes. Each has separate desktop and mobile vectors. Their SVGs contain genuine editable paths, no `<image>` elements or encoded bitmap data. Whole-scene and regional native-size comparisons are recorded in `docs/fidelity/`.

Matching this illustration's detail requires large vector files. They are not a download-size optimization. The normal runtime downloads compressed `.scene.json.gz` drawing instructions, builds `Path2D` contours, and renders them once at the original resolution in small batches. No large SVG document is mounted or rendered by the browser. Camera movement, crossfades, and WebGL reuse cached surfaces/textures without rebuilding geometry. Lossless WebP previews generated from the same SVG source provide immediate first paint, no-JavaScript support, and graceful fallbacks. Source vectors do not invent detail beyond the original PNG resolution.

- Edit geometry and `fill` colors directly in `assets/weather/*.svg`, using code or an SVG editor. Named groups such as `layer-refuge`, `layer-shop`, and `layer-base` divide the artwork into editing regions. Each region includes surrounding scenery; it is not a separately rigged object, and moving it may require filling the exposed background.
- Edit landmark positions in `scripts/scenes/layouts.mjs`.
- Run `npm run build:scenes` after any artwork or layout edits. It updates SVG region offsets and hotspot CSS, compiles contours to compressed drawing instructions, and rebuilds lossless previews without retracing or overwriting path geometry. The compiler supports translated editing groups with solid-color SVG paths and rejects unsupported transforms. Committed runtime artifacts require no deployment build step.
- `npm run trace:scenes -- sunny` explicitly regenerates both sunny SVGs from their original PNGs, overwriting manual vector edits. The originals are retained for this purpose and for fidelity tests.
- Preview a specific starting scene with `/?weather=sunny`, `/?weather=rainy`, or `/?weather=snowy`. Automatic rotation still continues every 30 seconds.

`npm test` checks verified vector hashes, SVG references, editing regions, and generated hit regions. `npm run test:fidelity` independently re-renders the SVGs against the original PNGs (global SSIM ≥ 0.985, each landmark region ≥ 0.97). Intentional artwork edits will change these reference checks and should be reviewed explicitly. `npm run test:browser` checks real desktop/mobile clicks, browser-rendered PNG comparisons, touch input, resizing, cache reuse, WebGL loss, no-JavaScript fallback, and weather timing. Tests use local Brave when available; otherwise install Chromium with `npx playwright install chromium` (or set `CHROMIUM_EXECUTABLE`). Run `npm install` first for development tools; the deployed site has no runtime dependencies.

On fine-pointer desktop devices, `js/mountain-renderer.js` progressively replaces the scene layer with a WebGL canvas. It applies a localized, time-varying displacement inside the hovered landmark's exact responsive bounds. The invisible zones cover the combined base camp, sun/night star, trail map, training area, summit, Shangri-La refuge, gear shop, and news mailbox. The mailbox contains vlogs and blog entries; the trail map contains routes and objectives. Touch devices, reduced-motion users, unsupported GPUs, and lost WebGL contexts continue using the cached code-rendered canvas, or its generated preview if vector rendering is unavailable.

Base Camp, Northstar, Shangri-La Refuge, Trail Map, Gear Shop, and News Mailbox
use a focused-view transition. The complete `.world` layer scales around the
live responsive hotspot, then reverses when the panel closes. Base Camp and
Northstar open from the right; Refuge, Trail Map, Gear Shop, and News Mailbox
open from the left. Since both the WebGL canvas and fallback pictures live
inside that layer, the camera move works in every rendering mode.
