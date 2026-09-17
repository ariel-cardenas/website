/** Named editing regions in percentages of the original artwork.
 * Regions include nearby scenery; these are not isolated/rigged 3D objects.
 * Partitioning retains all pixels. Actual contours are editable SVG paths.
 */
export const layerSizes = {
  horizontal: {
    news: [6, 15], trailmap: [7, 17], gym: [23, 31], shop: [31, 45],
    refuge: [25, 28], summit: [17, 25], northstar: [25, 34], base: [43, 30],
  },
  vertical: {
    news: [10, 11], trailmap: [16, 12], gym: [32, 22], shop: [51, 29],
    refuge: [45, 20], summit: [22, 24], northstar: [37, 28], base: [54, 32],
  },
};
export function editingRegions(layout, orientation) {
  return Object.entries(layerSizes[orientation]).map(([name, [width, height]]) => {
    const point = layout.landmarks[name];
    const left = Math.max(0, Math.round((point.x - width / 2) * layout.width / 100));
    const top = Math.max(0, Math.round((point.y - height / 2) * layout.height / 100));
    const right = Math.min(layout.width, Math.round((point.x + width / 2) * layout.width / 100));
    const bottom = Math.min(layout.height, Math.round((point.y + height / 2) * layout.height / 100));
    return { name, left, top, right, bottom, anchorX: point.x, anchorY: point.y };
  });
}
