import vtracer from "@visioncortex/vtracer";

/** Cutout regions never overlap, so equal-color contours can share one path.
 * This retains every contour while substantially reducing SVG element count.
 */
export function coalesceCutout(svg) {
  const colors = new Map();
  const stack = [];
  for (const match of svg.matchAll(/<\/?g\b[^>]*>|<path\b[^>]*\/>/g)) {
    const tag = match[0];
    if (tag.startsWith("</g")) { stack.pop(); continue; }
    if (tag.startsWith("<g")) {
      if (/transform=/.test(tag)) throw new Error("Unexpected transformed trace group");
      stack.push(tag.match(/\bfill="([^"]+)"/)?.[1] || stack.at(-1));
      continue;
    }
    if (/transform=/.test(tag)) throw new Error("Unexpected transformed trace path");
    const fill = tag.match(/\bfill="([^"]+)"/)?.[1] || stack.at(-1);
    const d = tag.match(/\bd="([^"]+)"/)?.[1];
    if (!fill || !d) throw new Error(`Unsupported trace path: ${tag.slice(0, 200)}`);
    if (!colors.has(fill)) colors.set(fill, []);
    colors.get(fill).push(d);
  }
  if (!colors.size) throw new Error("Empty trace");
  return [...colors].map(([fill, paths], index) => `<path id="color-${index}" fill="${fill}" d="${paths.join("")}"/>`).join("\n");
}

export function quantize(rgba, step = 4) {
  for (let i = 0; i < rgba.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) rgba[i + channel] = Math.min(255, Math.round(rgba[i + channel] / step) * step);
  }
  return rgba;
}

export const traceOptions = Object.freeze({
  mode: "pixel", hierarchical: "cutout", filterSpeckle: 0,
  colorPrecision: 8, layerDifference: 4, pathPrecision: 2, optimize: 2,
});

export function vectorizePixels(rgba, width, height) {
  return coalesceCutout(vtracer.convertPixels(rgba, width, height, traceOptions));
}
