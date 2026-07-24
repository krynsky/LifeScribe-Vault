import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Separate config for the pack-editor directory, which the main
// eslint.config.js deliberately ignores (see its top-level `ignores`).
// Kept as its own file — rather than an override in eslint.config.js — so
// `npm run lint` and `npm run lint:pack-editor` stay independent, mirroring
// how typecheck and typecheck:pack-editor are two separate tsc runs.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Underscore-prefixed destructured bindings are a deliberate
      // "strip this key" convention (see OverlayDesign.tsx's stripViewKeys).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // save-plugin.mjs / .test.mjs are plain Node scripts (the Vite dev-server
    // plugin backing the editor + its tests), not browser/React code.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        URL: "readonly",
        Buffer: "readonly",
        queueMicrotask: "readonly",
        setTimeout: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
);
