import Plot from "react-plotly.js";

interface CurveChartProps {
  points: Array<{ dose: number; red_pct: number; green_pct: number; blue_pct: number }>;
  fittedCurves: {
    Red?: { a: number; b: number; c: number };
    Green?: { a: number; b: number; c: number };
    Blue?: { a: number; b: number; c: number };
  } | null;
  maxDose: number;
}

function generateCurvePoints(
  params: { a: number; b: number; c: number },
  maxDose: number
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  const end = maxDose * 1.1;
  const step = (end - 0.01) / 199;
  for (let i = 0; i < 200; i++) {
    const dose = 0.01 + i * step;
    const val = params.a + params.b / (dose - params.c);
    x.push(dose);
    y.push(val);
  }
  return { x, y };
}

export default function CurveChart({ points, fittedCurves, maxDose }: CurveChartProps) {
  const doses = points.map((p) => p.dose);
  const effectiveMax = maxDose > 0 ? maxDose : 10;

  const channelConfig: Array<{
    key: "Red" | "Green" | "Blue";
    color: string;
    field: "red_pct" | "green_pct" | "blue_pct";
  }> = [
    { key: "Red", color: "#ef4444", field: "red_pct" },
    { key: "Green", color: "#22c55e", field: "green_pct" },
    { key: "Blue", color: "#3b82f6", field: "blue_pct" },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const traces: any[] = [];

  for (const ch of channelConfig) {
    // Scatter points (multiply by 100 for display as %)
    traces.push({
      x: doses,
      y: points.map((p) => p[ch.field] * 100),
      mode: "markers",
      type: "scatter",
      name: `${ch.key} data`,
      marker: { color: ch.color, size: 8, symbol: "circle" },
    });

    // Fitted curve line (multiply by 100 for display as %)
    if (fittedCurves?.[ch.key]) {
      const curve = generateCurvePoints(fittedCurves[ch.key]!, effectiveMax);
      traces.push({
        x: curve.x,
        y: curve.y.map((v) => v * 100),
        mode: "lines",
        type: "scatter",
        name: `${ch.key} fit`,
        line: { color: ch.color, width: 2 },
      });
    }
  }

  return (
    <div className="w-full h-full">
      <Plot
        data={traces}
        layout={{
          title: { text: "Calibration Curves", font: { size: 14 } },
          xaxis: { title: { text: "Dose (Gy)" }, rangemode: "tozero" },
          yaxis: { title: { text: "Color %" }, rangemode: "tozero" },
          margin: { l: 50, r: 20, t: 40, b: 45 },
          legend: { x: 1, xanchor: "right", y: 1, bgcolor: "rgba(255,255,255,0.8)" },
          autosize: true,
          paper_bgcolor: "transparent",
          plot_bgcolor: "#f8fafc",
        }}
        config={{ responsive: true, displayModeBar: true, scrollZoom: true }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
