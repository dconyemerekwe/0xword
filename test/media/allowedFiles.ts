// The files media/ may hold. test/security.test.ts checks media/ against it,
// and test/package.test.ts checks that every media/ file the .vsix ships is
// one of them.

/** What the panel uses, plus the sources and licences that sit beside it. */
export const ALLOWED_MEDIA: readonly string[] = [
  "media/dist/main.js", // the built webview script (SCRIPT_PATH); gitignored, so it's there after a build
  "media/fonts/DMSans-OFL.txt",
  "media/fonts/DMSans-Variable.ttf",
  "media/fonts/JetBrainsMono-OFL.txt",
  "media/fonts/JetBrainsMono-Variable.ttf",
  "media/fonts/README.md",
  "media/icon.png", // the Marketplace icon in package.json
  "media/icon.svg", // the activity-bar icon in package.json
  "media/main.ts", // source of the bundle
  "media/styles.css", // STYLE_PATH
  "media/text.d.ts",
  "media/tsconfig.json",
];
