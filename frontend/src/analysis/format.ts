/** Number formatting shared by the ROI panel and its exports. */

export function fmt(v: number | undefined | null, decimals = 3): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

export function thousands(v: number | undefined | null): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US");
}
