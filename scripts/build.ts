// Bundles the extension host (dist/) and the webview script (media/dist/).
// Usage: node scripts/build.ts [--watch]
import * as esbuild from "esbuild";
import { BUILDS } from "./builds.ts";

const watch = process.argv.includes("--watch");

if (watch) {
  for (const options of BUILDS) {
    const context = await esbuild.context(options);
    await context.watch();
  }
  console.log("Watching for changes...");
} else {
  await Promise.all(BUILDS.map((options) => esbuild.build(options)));
}
