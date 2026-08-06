import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
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
    fs: {
      // apps/desktop is the Vite project root, but HelpPage.tsx imports
      // docs/user-guide.md (repo root) via a `?raw` import — allow the dev
      // server to read across that workspace-root boundary.
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
}));
