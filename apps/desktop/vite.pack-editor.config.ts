import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { packEditorSavePlugin } from "./pack-editor/save-plugin";

// apps/desktop — lets the editor import ../src and ../scripts under root=pack-editor.
const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "pack-editor",
  plugins: [react(), packEditorSavePlugin()],
  server: {
    port: 1430,
    strictPort: true,
    fs: { allow: [appRoot] },
  },
});
