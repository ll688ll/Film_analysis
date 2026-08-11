/**
 * Colormap look-up tables for dose map visualization.
 * Each LUT is a Uint8Array of 256 * 4 (RGBA) values.
 */

export type ColormapName = "jet" | "viridis" | "hot";

/**
 * Superset of {@link ColormapName} used by the image-analysis page.
 * `ColormapName` stays assignable to it, so existing call sites are unaffected.
 */
export type ContinuousColormapName =
  | ColormapName
  | "grayscale"
  | "inferno"
  | "turbo";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function buildLUT(stops: Array<[number, number, number, number]>): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  const n = stops.length - 1;

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // Find the two surrounding stops
    let lo = 0;
    for (let s = 0; s < n; s++) {
      if (t >= stops[s][0]) lo = s;
    }
    const hi = Math.min(lo + 1, n);
    const range = stops[hi][0] - stops[lo][0];
    const frac = range > 0 ? (t - stops[lo][0]) / range : 0;

    lut[i * 4 + 0] = Math.round(lerp(stops[lo][1], stops[hi][1], frac));
    lut[i * 4 + 1] = Math.round(lerp(stops[lo][2], stops[hi][2], frac));
    lut[i * 4 + 2] = Math.round(lerp(stops[lo][3], stops[hi][3], frac));
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

// [position, R, G, B]
const JET_STOPS: Array<[number, number, number, number]> = [
  [0.0, 0, 0, 128],
  [0.11, 0, 0, 255],
  [0.35, 0, 255, 255],
  [0.5, 0, 255, 0],    // deliberately shift green
  [0.65, 255, 255, 0],
  [0.89, 255, 0, 0],
  [1.0, 128, 0, 0],
];

const HOT_STOPS: Array<[number, number, number, number]> = [
  [0.0, 0, 0, 0],
  [0.33, 255, 0, 0],
  [0.67, 255, 255, 0],
  [1.0, 255, 255, 255],
];

const VIRIDIS_STOPS: Array<[number, number, number, number]> = [
  [0.0, 68, 1, 84],
  [0.13, 72, 36, 117],
  [0.25, 65, 68, 135],
  [0.38, 53, 95, 141],
  [0.5, 33, 145, 140],
  [0.63, 53, 183, 121],
  [0.75, 109, 205, 89],
  [0.88, 180, 222, 44],
  [1.0, 253, 231, 37],
];

const GRAYSCALE_STOPS: Array<[number, number, number, number]> = [
  [0.0, 0, 0, 0],
  [1.0, 255, 255, 255],
];

const INFERNO_STOPS: Array<[number, number, number, number]> = [
  [0.0, 0, 0, 4],
  [0.13, 31, 12, 72],
  [0.25, 85, 15, 109],
  [0.38, 136, 34, 106],
  [0.5, 186, 54, 85],
  [0.63, 227, 89, 51],
  [0.75, 249, 142, 9],
  [0.88, 249, 201, 50],
  [1.0, 252, 255, 164],
];

const TURBO_STOPS: Array<[number, number, number, number]> = [
  [0.0, 48, 18, 59],
  [0.125, 70, 107, 227],
  [0.25, 54, 175, 240],
  [0.375, 33, 225, 190],
  [0.5, 132, 247, 117],
  [0.625, 216, 229, 58],
  [0.75, 252, 163, 44],
  [0.875, 218, 80, 10],
  [1.0, 122, 4, 3],
];

const COLORMAP_STOPS: Record<
  ContinuousColormapName,
  Array<[number, number, number, number]>
> = {
  jet: JET_STOPS,
  hot: HOT_STOPS,
  viridis: VIRIDIS_STOPS,
  grayscale: GRAYSCALE_STOPS,
  inferno: INFERNO_STOPS,
  turbo: TURBO_STOPS,
};

/** All continuous colormaps, in the order they should be offered in a menu. */
export const CONTINUOUS_COLORMAPS: ContinuousColormapName[] = [
  "jet",
  "viridis",
  "inferno",
  "turbo",
  "hot",
  "grayscale",
];

const lutCache = new Map<ContinuousColormapName, Uint8Array>();

export function getColormapLUT(name: ContinuousColormapName): Uint8Array {
  let lut = lutCache.get(name);
  if (lut) return lut;

  lut = buildLUT(COLORMAP_STOPS[name] ?? JET_STOPS);
  lutCache.set(name, lut);
  return lut;
}

function toHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
  );
}

/**
 * Sample a continuous colormap at *n* points, as `#rrggbb` strings.
 *
 * "center" samples at (i + 0.5) / n, which keeps small n from being dominated
 * by the washed-out endpoints that (i / (n - 1)) produces.
 */
export function sampleColormap(
  name: ContinuousColormapName,
  n: number,
  mode: "center" | "edge" = "center"
): string[] {
  const lut = getColormapLUT(name);
  if (n <= 0) return [];
  if (n === 1) return [toHex(lut[128 * 4], lut[128 * 4 + 1], lut[128 * 4 + 2])];

  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = mode === "center" ? (i + 0.5) / n : i / (n - 1);
    const k = Math.round(t * 255) * 4;
    out.push(toHex(lut[k], lut[k + 1], lut[k + 2]));
  }
  return out;
}

/**
 * Categorical ramps that are not derived from a continuous colormap.
 * These read better than a sampled gradient when levels are few and the
 * point is to tell them apart rather than to imply an ordering.
 */
export const DISCRETE_PALETTES: Record<string, string[]> = {
  // ColorBrewer Set2 -- colourblind-safe
  Set2: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3"],
  Paired: [
    "#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99",
    "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a",
  ],
  Traffic: ["#16a34a", "#65a30d", "#ca8a04", "#ea580c", "#dc2626"],
  Thermal: ["#0b0f6b", "#2b4bbf", "#00a2b3", "#7fbf3f", "#f2c200", "#f27300", "#d92b04"],
  Grays: ["#111827", "#374151", "#4b5563", "#6b7280", "#9ca3af", "#d1d5db", "#e5e7eb", "#f9fafb"],
  Contour: ["#0ea5e9", "#f97316", "#22c55e", "#e11d48", "#a855f7", "#eab308", "#14b8a6", "#ec4899"],
};

/**
 * Apply a colormap LUT to a Float32Array of dose values.
 * Returns an ImageData-compatible Uint8ClampedArray (RGBA).
 */
export function applyColormap(
  doseData: Float32Array,
  width: number,
  height: number,
  cmapMin: number,
  cmapMax: number,
  colormapName: ColormapName = "jet"
): ImageData {
  const lut = getColormapLUT(colormapName);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const range = cmapMax - cmapMin;
  const invRange = range > 0 ? 1 / range : 0;

  for (let i = 0; i < doseData.length; i++) {
    const val = doseData[i];
    // Normalize to 0-255
    const t = Math.max(0, Math.min(1, (val - cmapMin) * invRange));
    const idx = Math.round(t * 255);
    const j = i * 4;
    const k = idx * 4;
    pixels[j] = lut[k];
    pixels[j + 1] = lut[k + 1];
    pixels[j + 2] = lut[k + 2];
    pixels[j + 3] = 255;
  }

  return new ImageData(pixels, width, height);
}
