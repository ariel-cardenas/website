# Ariel's interactive mountain

A single-screen, framework-free portfolio. The mountain is the interface: eight landmarks open soft content panels. Weather is selected before first paint, avoids repeating the previous session value on reload, and crossfades to a different random state every five minutes.

## Files

```text
website/
├── index.html       # Scene, hotspots, panel templates, and Ariel's content
├── styles.css       # Full-screen composition, landmark positions, and motion
├── main.js          # Automatic weather, dialogs, hotspots, audio wiring, and parallax
├── weather-music.js # Shared-clock Web Audio chiptune arrangements
├── mountain-renderer.js # Dependency-free WebGL liquid-hover renderer
├── favicon.svg
├── Sunny H.png      # Desktop scenes
├── Rainy H.png
├── Snowy H.png
├── Sunny V.png      # Mobile scenes
├── Rainy V.png
└── Snowy V.png
```

## Run locally

Open `index.html` directly or serve the folder with any static web server:

```sh
python3 -m http.server 8000
```

## Extend it

- Edit content in the six `<template>` elements at the bottom of `index.html`.
- Desktop and mobile hotspot coordinates are grouped and commented in `styles.css`.
- Weather image paths and the five-minute interval are collected at the top of `main.js`.
- To add a landmark, create a hotspot with `data-panel="name"`, add `<template id="panel-name">`, and define its `--x` / `--y` position.

The `#world` element can later become a PixiJS or Three.js mount point. Its hotspots should remain in the same transformed container or be projected from the renderer so they continue to track the artwork.

On fine-pointer desktop devices, `mountain-renderer.js` progressively replaces the image layer with a WebGL canvas. It applies a localized, time-varying displacement inside the hovered landmark's exact responsive bounds. The invisible zones cover the combined base camp, sun/night star, trail map, training area, summit, Shangri-La refuge, gear shop, and news mailbox. The mailbox contains vlogs and blog entries; the trail map contains routes and objectives. Touch devices, reduced-motion users, unsupported GPUs, and lost WebGL contexts continue using the original image layers.

Base Camp, Northstar, Shangri-La Refuge, Trail Map, Gear Shop, and News Mailbox
use a focused-view transition. The complete `.world` layer scales around the
live responsive hotspot, then reverses when the panel closes. Base Camp and
Northstar open from the right; Refuge, Trail Map, Gear Shop, and News Mailbox
open from the left. Since both the WebGL canvas and fallback pictures live
inside that layer, the camera move works in every rendering mode.
