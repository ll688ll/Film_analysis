import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Builds the standalone report viewer (`src/report/main.tsx`) as one script
 * and one stylesheet in `public/report/`. The app fetches both from its own
 * origin when exporting a report and inlines them, with the payload, into
 * the downloaded HTML file. `npm run build` runs this first (see `prebuild`).
 */
export default defineConfig({
  plugins: [react()],
  // The viewer has no static assets of its own, and its output lives inside
  // the app's public/ directory, which must not be copied into itself.
  publicDir: false,
  define: {
    // Library builds do not get Vite's usual replacement; React needs it.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "public/report",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: "src/report/main.tsx",
      name: "FilmReport",
      formats: ["iife"],
      fileName: () => "report.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "report.[ext]",
      },
    },
  },
});
