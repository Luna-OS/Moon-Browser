import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

// Moon Browser ESLint configuration.
//
// Two rules here are not style preferences, they enforce a security
// boundary: the browser UI and the internal pages never talk to the network
// themselves (everything goes through the main process), and never inject
// raw HTML — page titles, addresses and history entries come from the web
// and must stay escaped.
const rendererBoundaries = {
  name: "moon/renderer-boundaries",
  files: ["src/renderer/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-globals": [
      "error",
      {
        name: "fetch",
        message:
          "The browser UI makes no network requests of its own. Ask the main process via IPC.",
      },
      {
        name: "XMLHttpRequest",
        message:
          "The browser UI makes no network requests of its own. Ask the main process via IPC.",
      },
      { name: "WebSocket", message: "The browser UI opens no network connections of its own." },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message:
          "dangerouslySetInnerHTML is not allowed. Titles and addresses from the web must stay escaped.",
      },
    ],
  },
};

export default tseslint.config(
  { ignores: ["out", "release", "dist", "node_modules", "coverage"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    extends: [jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Tabs are clickable elements with the ARIA tab role and full keyboard
      // support; the pointer handlers are an addition, not the only way in.
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-autofocus": "off",
    },
  },
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // Entry points only render; they have nothing to export.
    files: ["src/renderer/*/main.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  rendererBoundaries,
  {
    files: ["*.config.{js,ts}", "scripts/**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettierConfig,
);
