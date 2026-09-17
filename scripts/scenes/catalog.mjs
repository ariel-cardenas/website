/** All primary scenes are editable vector contours. PNGs are QA references. */
export const scenarios = {
  sunny: { title: "Sunny alpine mountain", converted: true },
  rainy: { title: "Rainy alpine mountain", converted: true },
  snowy: { title: "Snowy alpine mountain", converted: true },
};
export const sourceDirectory = "assets/weather/reference";
export const minimumSimilarity = .985;
export const minimumRegionSimilarity = .97;
export const maximumRgbError = 2.2;
