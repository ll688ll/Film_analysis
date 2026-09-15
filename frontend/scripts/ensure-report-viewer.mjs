/**
 * Runs before `npm run dev`: build the report viewer once if it is missing,
 * so Export Report works on a fresh checkout. After editing `src/report/`,
 * rebuild it by hand with `npm run build:report`.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const viewer = fileURLToPath(new URL("../public/report/report.js", import.meta.url));

if (!existsSync(viewer)) {
  console.log("[report] viewer not built yet; running `vite build -c vite.report.config.ts`");
  const result = spawnSync("npx", ["vite", "build", "-c", "vite.report.config.ts"], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(result.status ?? 1);
}
