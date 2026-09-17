/** Convert and commit one weather at a time. PNGs remain until converted. */
export const scenarios = {
  sunny: { title: "Sunny alpine mountain", converted: true },
  rainy: { title: "Rainy alpine mountain", converted: false },
  snowy: { title: "Snowy alpine mountain", converted: false },
};
export const sourceDirectory = "assets/weather";
export const minimumSimilarity = .985;
export const minimumRegionSimilarity = .97;
export const maximumRgbError = 2.2;
