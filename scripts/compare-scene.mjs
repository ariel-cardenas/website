/** Compare native-size RGB and local luminance structure, not just file size. */
import sharp from "sharp";
import { readFile } from "node:fs/promises";

export function comparePixels(reference, rendered, width, height, region = {}) {
  const left = Math.max(0, Math.floor(region.x || 0));
  const top = Math.max(0, Math.floor(region.y || 0));
  const right = Math.min(width, Math.ceil(left + (region.width || width)));
  const bottom = Math.min(height, Math.ceil(top + (region.height || height)));
  let error = 0, samples = 0, similarity = 0, windows = 0;
  const luminance = (data, index) => .2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2];
  for (let wy = top; wy < bottom; wy += 8) {
    for (let wx = left; wx < right; wx += 8) {
      let a = 0, b = 0, aa = 0, bb = 0, ab = 0, count = 0;
      for (let y = wy; y < Math.min(wy + 8, bottom); y++) {
        for (let x = wx; x < Math.min(wx + 8, right); x++) {
          const index = (y * width + x) * 3;
          const p = luminance(reference, index), q = luminance(rendered, index);
          a += p; b += q; aa += p * p; bb += q * q; ab += p * q; count++;
          for (let channel = 0; channel < 3; channel++) {
            const delta = reference[index + channel] - rendered[index + channel];
            error += delta * delta; samples++;
          }
        }
      }
      a /= count; b /= count;
      const va = Math.max(0, aa / count - a * a), vb = Math.max(0, bb / count - b * b);
      const covariance = ab / count - a * b;
      similarity += ((2 * a * b + 6.5025) * (2 * covariance + 58.5225)) / ((a * a + b * b + 6.5025) * (va + vb + 58.5225));
      windows++;
    }
  }
  const mse = error / samples;
  return { ssim: similarity / windows, rmse: Math.sqrt(mse), psnr: mse === 0 ? Infinity : 10 * Math.log10(255 ** 2 / mse) };
}

export async function compareScene(referencePath, svg) {
  const reference = await sharp(await readFile(referencePath)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rendered = await sharp(Buffer.from(svg)).resize(reference.info.width, reference.info.height).removeAlpha().raw().toBuffer();
  return comparePixels(reference.data, rendered, reference.info.width, reference.info.height);
}
