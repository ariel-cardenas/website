/** Compile editable SVG contours to draw instructions, not pixel/color arrays. */
import { createHash } from "node:crypto";

export function compileScene(svg) {
  const root = svg.match(/<svg\b[^>]+>/)?.[0];
  if (!root) throw new Error("Missing SVG root");
  const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
  const scene = { version: 1, width: Number(attribute(root, "width")), height: Number(attribute(root, "height")), sourceSha256: createHash("sha256").update(svg).digest("hex"), layers: [] };
  let layer;
  const clips = new Map([...svg.matchAll(/<clipPath\b([^>]+)><path\b([^>]+)\/><\/clipPath>/g)].map(match => [attribute(match[1], "id"), attribute(match[2], "d")]));
  const artwork = svg.replace(/<defs>[\s\S]*?<\/defs>/g, "");
  for (const match of artwork.matchAll(/<\/?g\b[^>]*>|<path\b[^>]*\/>/g)) {
    const tag = match[0];
    if (tag.startsWith("</g")) { layer = undefined; continue; }
    if (tag.startsWith("<g")) {
      if (layer) throw new Error("Nested SVG groups need explicit compiler support");
      const transform = attribute(tag, "transform")?.match(/^translate\(([-\d.]+)\s+([-\d.]+)\)$/);
      if (!transform) throw new Error("Editing regions must use a translate(x y) transform");
      layer = { name: attribute(tag, "id"), x: Number(transform[1]), y: Number(transform[2]), paths: [] };
      const clip = attribute(tag, "clip-path")?.match(/^url\(#([^\)]+)\)$/)?.[1];
      if (clip && !clips.has(clip)) throw new Error(`Missing editing-region clip: ${clip}`);
      if (clip) layer.clip = clips.get(clip);
      scene.layers.push(layer);
    } else {
      if (!layer || /\btransform=/.test(tag)) throw new Error("Transformed or ungrouped path needs explicit compiler support");
      const fill = attribute(tag, "fill"), d = attribute(tag, "d");
      if (!/^#[0-9a-f]{6}$/i.test(fill || "") || !d) throw new Error("Paths require solid RGB fill and SVG contour data");
      layer.paths.push([fill, d]);
    }
  }
  if (!scene.layers.length || !scene.width || !scene.height) throw new Error("Incomplete vector scene");
  return scene;
}
