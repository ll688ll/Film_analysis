/**
 * Colormap look-up tables for dose map visualization.
 * Each LUT is a Uint8Array of 256 * 4 (RGBA) values.
 */

export type ColormapName = "jet" | "viridis" | "hot";

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

const lutCache = new Map<ColormapName, Uint8Array>();

export function getColormapLUT(name: ColormapName): Uint8Array {
  let lut = lutCache.get(name);
  if (lut) return lut;

  switch (name) {
    case "jet":
      lut = buildLUT(JET_STOPS);
      break;
    case "hot":
      lut = buildLUT(HOT_STOPS);
      break;
    case "viridis":
      lut = buildLUT(VIRIDIS_STOPS);
      break;
  }
  lutCache.set(name, lut);
  return lut;
}

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
