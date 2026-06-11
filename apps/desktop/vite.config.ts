import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const creatorMode = process.env.VITE_CREATOR_MODE === "1";

// `VITE_CREATOR_MODE` is statically replaced at build time so Rollup can
// tree-shake the creator module out of end-user bundles. To build a creator
// binary:  VITE_CREATOR_MODE=1 npm run dev  (with the creator-mode Cargo feature).
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  define: {
    // Static replacement ensures dead-branch elimination: `import.meta.env.VITE_CREATOR_MODE`
    // evaluates to `"1"` in creator builds and `""` in end-user builds.
    "import.meta.env.VITE_CREATOR_MODE": JSON.stringify(creatorMode ? "1" : ""),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
