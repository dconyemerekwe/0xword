// The esbuild options for the extension host (dist/) and the webview script
// (media/dist/). scripts/build.ts runs them; test/package.test.ts builds with
// them too, so the package it checks matches what `npm run build` makes.
import type { BuildOptions } from "esbuild";

export const BUILDS: readonly BuildOptions[] = [
  {
    // Extension host: Node, CommonJS, `vscode` provided at runtime.
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.cjs",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["vscode"],
    loader: { ".txt": "text" },
    sourcemap: true,
  },
  {
    // Webview: browser script loaded by the panel. Must stay inside media/,
    // the webview's only local resource root.
    entryPoints: ["media/main.ts"],
    outfile: "media/dist/main.js",
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "iife",
    // Inlines the word list, so the webview never fetches it.
    loader: { ".txt": "text" },
  },
];
