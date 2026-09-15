/**
 * The one Plotly build the app ships.
 *
 * `react-plotly.js` imports the full `plotly.js/dist/plotly` (4.8 MB) by
 * default. Every chart in the app is a bar, scatter or heatmap, all of which
 * the cartesian build (1.4 MB) covers, and the standalone report viewer
 * bundles this same component so a report file stays small.
 */

import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js/dist/plotly-cartesian";

const Plot = createPlotlyComponent(Plotly);

export default Plot;
