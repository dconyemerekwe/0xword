// Draws the Marketplace icon, media/icon.png, from its SVG source with a
// locally installed Chromium browser (Edge or Chrome), so no image library
// is needed. Run it by hand after changing the SVG; CI never runs it.
// Usage: node scripts/render-icon.ts [path to msedge.exe or chrome]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE = fileURLToPath(new URL("../docs/design/icons/marketplace-icon.svg", import.meta.url));
const OUTPUT = fileURLToPath(new URL("../media/icon.png", import.meta.url));
const SIZE = 128;

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
];

const browser = process.argv[2] ?? BROWSERS.find((path) => existsSync(path));
if (!browser) {
  throw new Error("No Edge or Chrome found: pass the browser's path as the first argument.");
}

// A page that shows only the SVG, at 1:1, on a transparent background.
const svg = readFileSync(SOURCE).toString("base64");
const work = mkdtempSync(join(tmpdir(), "0xword-icon-"));
try {
  const page = join(work, "icon.html");
  writeFileSync(
    page,
    `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style>` +
      `<img width="${SIZE}" height="${SIZE}" src="data:image/svg+xml;base64,${svg}">`,
  );
  // Remove the old PNG first, so a browser that writes nothing fails below.
  rmSync(OUTPUT, { force: true });
  execFileSync(browser, [
    "--headless=new",
    "--no-first-run",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${SIZE},${SIZE}`,
    "--default-background-color=00000000",
    `--user-data-dir=${join(work, "profile")}`,
    `--screenshot=${OUTPUT}`,
    pathToFileURL(page).href,
  ]);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (!existsSync(OUTPUT)) {
  throw new Error(`The browser exited without writing ${OUTPUT}.`);
}

// The PNG's IHDR chunk starts at byte 8; its width and height follow the type.
const png = readFileSync(OUTPUT);
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== SIZE || height !== SIZE) {
  throw new Error(`Expected ${SIZE}x${SIZE}, got ${width}x${height}.`);
}
console.log(`Wrote ${OUTPUT} (${width}x${height}).`);
