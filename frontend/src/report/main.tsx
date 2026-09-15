/**
 * Entry point of the standalone report viewer. Built by
 * `vite.report.config.ts` into one script and one stylesheet that the app
 * inlines, together with the payload, into each exported HTML file.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import "./report.css";
import ReportApp from "./ReportApp";
import { REPORT_DATA_ID, REPORT_ROOT_ID, type ReportPayload } from "./reportTypes";

function readPayload(): ReportPayload {
  const el = document.getElementById(REPORT_DATA_ID);
  if (!el || !el.textContent) throw new Error("the report data block is missing");
  return JSON.parse(el.textContent) as ReportPayload;
}

const root = document.getElementById(REPORT_ROOT_ID);
if (root) {
  try {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ReportApp payload={readPayload()} />
      </React.StrictMode>
    );
  } catch (err) {
    root.textContent = `This report could not be opened: ${(err as Error).message}.`;
  }
}
