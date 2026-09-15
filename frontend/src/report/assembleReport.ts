/**
 * Turn a payload into one self-contained HTML file: the viewer's stylesheet
 * and script inlined, the payload in a JSON block between them. The viewer
 * assets are built separately (`npm run build:report`) into `public/report/`,
 * so the app fetches them from its own origin at export time.
 */

import { baseName } from "../imaging/exporters";
import { REPORT_DATA_ID, REPORT_ROOT_ID, type ReportPayload } from "./reportTypes";

export interface ViewerAssets {
  js: string;
  css: string;
}

export const VIEWER_JS_URL = "/report/report.js";
export const VIEWER_CSS_URL = "/report/report.css";

const NOT_BUILT =
  "The report viewer is not built. Run `npm run build:report` in frontend/ (the production build does this itself).";

async function fetchAsset(url: string, expectType: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch {
    throw new Error(`Could not fetch ${url}.`);
  }
  // A dev server or nginx answers a missing file with the SPA's index.html.
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes(expectType)) throw new Error(NOT_BUILT);
  return res.text();
}

export async function fetchViewerAssets(): Promise<ViewerAssets> {
  const [js, css] = await Promise.all([
    fetchAsset(VIEWER_JS_URL, "javascript"),
    fetchAsset(VIEWER_CSS_URL, "css"),
  ]);
  return { js, css };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON that cannot end the script block it sits in, whatever the strings hold. */
function inlineJson(payload: ReportPayload): string {
  return JSON.stringify(payload)
    .split("<")
    .join("\\u003c")
    .split(" ")
    .join("\\u2028")
    .split(" ")
    .join("\\u2029");
}

/** Same for a script body: `</script` inside a string literal must not close the tag. */
function inlineScript(js: string): string {
  return js
    .replace(new RegExp("<\\/script", "gi"), "<\\/script")
    .split("<!--")
    .join("<\\!--");
}

export function assembleReportHtml(payload: ReportPayload, assets: ViewerAssets): string {
  const title = escapeHtml(payload.meta.title || payload.film.filename || "Film dose report");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title} · Film Analysis report</title>`,
    `<style>${assets.css}</style>`,
    "</head>",
    "<body>",
    `<div id="${REPORT_ROOT_ID}"></div>`,
    `<script id="${REPORT_DATA_ID}" type="application/json">${inlineJson(payload)}</script>`,
    `<script>${inlineScript(assets.js)}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

export function reportFileName(payload: ReportPayload): string {
  const stamp = payload.generatedAt.slice(0, 10).replace(/-/g, "");
  return `${baseName(payload.film.filename || "film")}_report_${stamp}.html`;
}
