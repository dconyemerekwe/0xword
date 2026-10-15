// Bundles the extension host (dist/) and the webview script (media/dist/).
// Usage: node scripts/build.ts [--watch]
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const builds: esbuild.BuildOptions[] = [
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

if (watch) {
  for (const options of builds) {
    const context = await esbuild.context(options);
    await context.watch();
  }
  console.log("Watching for changes...");
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
