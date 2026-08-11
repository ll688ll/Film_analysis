/**
 * Colour tables for the level map.
 *
 * The transported plane holds *bin codes*, so painting is a pure table lookup
 * indexed by bin. That makes it structurally impossible for the rendered image
 * to disagree with the statistics table -- both are driven by the same bin
 * boundaries, with no arithmetic in between.
 */

import {
  CONTINUOUS_COLORMAPS,
  DISCRETE_PALETTES,
  sampleColormap,
  type ContinuousColormapName,
} from "../analysis/colormaps";
import type { Level } from "./types";

export interface PresetGroup {
  label: string;
  options: string[];
}

export const COLOR_PRESETS: PresetGroup[] = [
  { label: "Sampled from colormap", options: CONTINUOUS_COLORMAPS },
  { label: "Discrete", options: Object.keys(DISCRETE_PALETTES) },
];

const CONTINUOUS = new Set<string>(CONTINUOUS_COLORMAPS);

/** N colours for a preset, whether it is a gradient or a categorical ramp. */
export function presetColors(preset: string, n: number, reverse = false): string[] {
  let colors: string[];

  if (CONTINUOUS.has(preset)) {
    colors = sampleColormap(preset as ContinuousColormapName, n);
  } else {
    const palette = DISCRETE_PALETTES[preset] ?? DISCRETE_PALETTES.Set2;
    if (n <= palette.length) {
      // Spread across the palette rather than always taking the first n,
      // so a 3-level map still uses visually distant colours.
      colors = Array.from(
        { length: n },
        (_, i) => palette[Math.round((i * (palette.length - 1)) / Math.max(1, n - 1))]
      );
    } else {
      colors = Array.from({ length: n }, (_, i) => palette[i % palette.length]);
    }
  }

  return reverse ? [...colors].reverse() : colors;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h.padEnd(6, "0").slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

export interface LevelLUTOptions {
  /** Dim every level except this one. */
  isolate?: number | null;
  /** Alpha applied to hidden levels (0 = fully transparent). */
  hiddenAlpha?: number;
  /** Alpha applied to non-isolated levels. */
  dimAlpha?: number;
}

/**
 * Build a `(bins + 1) x 4` RGBA table indexed by bin code.
 * Entry `bins` is the no-data code and is always fully transparent.
 */
export function buildLevelLUT(
  levels: Level[],
  bins: number,
  opts: LevelLUTOptions = {}
): Uint8Array {
  const { isolate = null, hiddenAlpha = 0, dimAlpha = 40 } = opts;
  const lut = new Uint8Array((bins + 1) * 4);

  for (const level of levels) {
    const [r, g, b] = parseHex(level.color);
    let alpha = 255;
    if (!level.visible) alpha = hiddenAlpha;
    else if (isolate !== null && level.index !== isolate) alpha = dimAlpha;

    const lo = Math.max(0, level.loBin);
    const hi = Math.min(bins - 1, level.hiBin);
    for (let i = lo; i <= hi; i++) {
      const k = i * 4;
      lut[k] = r;
      lut[k + 1] = g;
      lut[k + 2] = b;
      lut[k + 3] = alpha;
    }
  }

  // No-data (non-finite, transparent, or outside the value window).
  const nodata = bins * 4;
  lut[nodata] = 0;
  lut[nodata + 1] = 0;
  lut[nodata + 2] = 0;
  lut[nodata + 3] = 0;

  return lut;
}

/** Paint bin codes through the level LUT. */
export function applyLevelLUT(
  codes: Uint16Array,
  width: number,
  height: number,
  lut: Uint8Array
): ImageData {
  const n = width * height;
  const pixels = new Uint8ClampedArray(n * 4);
  const maxCode = lut.length / 4 - 1;

  for (let i = 0; i < n; i++) {
    const code = codes[i] <= maxCode ? codes[i] : maxCode;
    const k = code * 4;
    const j = i * 4;
    pixels[j] = lut[k];
    pixels[j + 1] = lut[k + 1];
    pixels[j + 2] = lut[k + 2];
    pixels[j + 3] = lut[k + 3];
  }

  return new ImageData(pixels, width, height);
}

/**
 * Composite the level map over a base image at the given opacity.
 *
 * `putImageData` ignores `globalAlpha` and all composite operations, so the
 * level map has to go onto a scratch canvas first and be drawn from there.
 */
export function compositeLevelMap(
  out: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  levelData: ImageData,
  base: CanvasImageSource | null,
  opacity: number
): void {
  const { width, height } = levelData;
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }
  if (out.width !== width || out.height !== height) {
    out.width = width;
    out.height = height;
  }

  scratch.getContext("2d")!.putImageData(levelData, 0, 0);

  const ctx = out.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  if (base) {
    ctx.drawImage(base, 0, 0, width, height);
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  } else {
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(scratch, 0, 0);
  ctx.globalAlpha = 1;
}
