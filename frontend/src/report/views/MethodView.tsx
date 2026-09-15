import { fmt } from "../../analysis/format";
import { MM_PER_INCH } from "../../analysis/roiGeometry";
import { quantStep } from "../doseGrid";
import type { ReportPayload } from "../reportTypes";
import { Section } from "../ui";

/** How the numbers were produced, in enough detail to repeat them. */
export default function MethodView({ payload }: { payload: ReportPayload }) {
  const { film, calibration, roi, doseGrid } = payload;
  const fullScale = film.bitDepth === 16 ? 65535 : film.bitDepth === 8 ? 255 : null;
  const pixelMm = film.dpi > 0 ? MM_PER_INCH / film.dpi : null;

  const roiOptions: string[] = [];
  if (roi) {
    roiOptions.push(
      `${roi.roiType} of ${fmt(roi.stats.width_mm, 2)} × ${fmt(roi.stats.height_mm, 2)} mm centred at (${fmt(roi.stats.center_x_mm, 2)}, ${fmt(roi.stats.center_y_mm, 2)}) mm` +
        (roi.geometry.rotation ? `, rotated ${roi.geometry.rotation}°` : "")
    );
    if (roi.roiType === "Ring") roiOptions.push(`inner radius ${roi.holeRatio} % of the outer`);
    if (roi.threshold > 0) roiOptions.push(`pixels at or below ${roi.threshold} Gy excluded`);
    if (roi.cornerCutEnabled && roi.cornerCutMm > 0) roiOptions.push(`${roi.cornerCutMm} mm chamfered off each corner`);
    roiOptions.push(
      roi.trimEnabled && roi.trimPercent > 0
        ? `${roi.trimPercent} % of pixels trimmed from each tail before the statistics`
        : "no trimming"
    );
  }

  return (
    <Section id="method" title="Method">
      <div className="text-sm text-slate-800 space-y-2 leading-relaxed">
        <p>
          <span className="font-medium">Dose calculation.</span> Each pixel's{" "}
          {calibration.channel.toLowerCase()} value was converted to a colour fraction
          {fullScale ? ` (pixel / ${fullScale} for ${film.bitDepth}-bit data)` : ""} and to dose with
          the rational function{" "}
          <code className="font-mono bg-slate-100 px-1 rounded">Dose = b / (Color − a) + c</code>{" "}
          using a = {calibration.a.toFixed(5)}, b = {calibration.b.toFixed(5)}, c ={" "}
          {calibration.c.toFixed(5)}.
          {pixelMm ? ` At ${film.dpi} dpi one pixel is ${pixelMm.toFixed(4)} mm.` : ""}
        </p>
        {roi && (
          <p>
            <span className="font-medium">Region of interest.</span> {roiOptions.join("; ")}. Statistics
            (mean, standard deviation, CV, percentiles, dose uniformity ratio DUR = max / min, flatness
            = (max − min) / (max + min), homogeneity index HI = (P98 − P2) / median) were computed by
            the server on the full-resolution dose map at export time. Isodose contours use marching
            squares on the ROI block-averaged to at most 160 blocks a side; profiles are sampled every
            image pixel along the ROI axes and their FWHM and 80–20 % penumbra are read from a 5-sample
            moving average.
          </p>
        )}
        <p>
          <span className="font-medium">Data in this file.</span> The dose map is stored averaged over{" "}
          {doseGrid.step} × {doseGrid.step} px blocks ({doseGrid.cols} × {doseGrid.rows}) and quantised
          to 16 bits over {fmt(doseGrid.lo, 3)}–{fmt(doseGrid.hi, 3)} Gy (steps of{" "}
          {(quantStep(doseGrid.lo, doseGrid.hi) * 1000).toFixed(2)} mGy)
          {doseGrid.clamped ? "; values outside that range are clamped" : ""}. Cursor readouts on the
          map come from this grid; every statistic comes from the full-resolution map.
        </p>
        <p className="text-slate-500">
          Exported {new Date(payload.generatedAt).toLocaleString()} by {payload.meta.author || "an unnamed user"}
          {payload.app.version ? ` with Film Analysis v${payload.app.version}` : ""}.
        </p>
      </div>
    </Section>
  );
}
