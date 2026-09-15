import CurveChart from "../../wizard/CurveChart";
import type { ReportCalibration } from "../reportTypes";
import { Caption, Section } from "../ui";

const CHANNEL_KEYS = ["Red", "Green", "Blue"] as const;

/** The calibration behind the dose map: coefficients per channel and, when known, the fitted curve with its points. */
export default function CalibrationView({ calibration }: { calibration: ReportCalibration }) {
  const { profileName, profileNote, source, channel, channels, points } = calibration;

  const fitted: Partial<Record<(typeof CHANNEL_KEYS)[number], { a: number; b: number; c: number }>> = {};
  for (const key of CHANNEL_KEYS) {
    const cp = channels.find((c) => c.channel.toLowerCase() === key.toLowerCase());
    if (cp) fitted[key] = { a: cp.a, b: cp.b, c: cp.c };
  }
  const maxDose = points.length ? Math.max(...points.map((p) => p.dose)) : 10;

  const sourceText =
    source === "snapshot"
      ? "Taken from the immutable snapshot saved with this analysis, so it is the calibration that produced this dose map even if the profile has since changed."
      : source === "profile"
        ? "Taken from the calibration profile as it was when the report was exported."
        : "The dose map was computed from hand-entered coefficients rather than a saved profile.";

  return (
    <Section id="calibration" title="Calibration" pageBreak>
      <p className="text-sm text-slate-800 mb-3">
        <span className="font-medium">{profileName ?? "Manual coefficients"}</span>
        {profileNote ? <span className="text-slate-500"> · {profileNote}</span> : null}
      </p>

      {channels.length > 0 ? (
        <table className="w-full max-w-xl text-sm mb-3">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <th className="px-3 py-1.5 font-medium">Channel</th>
              <th className="px-3 py-1.5 font-medium text-right">a</th>
              <th className="px-3 py-1.5 font-medium text-right">b</th>
              <th className="px-3 py-1.5 font-medium text-right">c</th>
              <th className="px-3 py-1.5 font-medium text-right">R²</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((cp) => {
              const applied = cp.channel.toLowerCase() === channel.toLowerCase();
              return (
                <tr key={cp.channel} className={applied ? "bg-sky-50 font-medium" : ""}>
                  <td className="px-3 py-1.5 text-slate-800">
                    {cp.channel}
                    {applied && <span className="ml-2 text-[10px] uppercase tracking-wider text-sky-700">applied</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{cp.a.toFixed(5)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{cp.b.toFixed(5)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{cp.c.toFixed(5)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{cp.r_squared != null ? cp.r_squared.toFixed(4) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-sm font-mono text-slate-800 mb-3">
          {channel}: a = {calibration.a.toFixed(5)}, b = {calibration.b.toFixed(5)}, c = {calibration.c.toFixed(5)}
        </p>
      )}

      {points.length > 0 && (
        <div className="h-72">
          <CurveChart points={points} fittedCurves={fitted} maxDose={maxDose} />
        </div>
      )}

      <Caption>
        {sourceText}
        {points.length > 0
          ? ` The curve was fitted to ${points.length} measured point${points.length === 1 ? "" : "s"}; markers are the measured colour fractions, lines the fitted rational functions.`
          : " No measured points are stored for this profile (imported from the desktop application)."}
      </Caption>
    </Section>
  );
}
