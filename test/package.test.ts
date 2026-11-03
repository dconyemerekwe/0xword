// Checks what the .vsix ships (#86): exactly the allowlisted files, under a
// size limit, with README links that point at the repo.
//
// The test packages a clean copy of the repo with vsce itself, so it checks
// what `npm run package` really ships, not a guess at .vscodeignore's rules:
// every file git tracks is copied to a temporary folder (as a fresh checkout,
// like CI's, would have it), the extension and webview are built into it with
// the same esbuild options as `npm run build`, then vsce lists and packs it.
// This doesn't depend on whether `npm run build` has run (`npm test` runs
// before it in CI), and takes about a second.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PackageManager, listFiles } from "@vscode/vsce";
import * as esbuild from "esbuild";
import { BUILDS } from "../scripts/builds.ts";
import { imageLinks } from "./markdown.ts";
import { ALLOWED_MEDIA } from "./media/allowedFiles.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Every file the .vsix may ship, by its path in the repo. vsce renames a few
 * inside the package (README.md to readme.md, LICENSE to LICENSE.txt). A file
 * missing from the package, or one not on this list, fails the test.
 */
const PACKAGED_FILES = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "dist/extension.cjs", // the built extension host (package.json "main")
  "media/dist/main.js", // the built webview script
  "media/fonts/DMSans-OFL.txt",
  "media/fonts/DMSans-Variable.ttf",
  "media/fonts/JetBrainsMono-OFL.txt",
  "media/fonts/JetBrainsMono-Variable.ttf",
  "media/icon.png", // the Marketplace icon
  "media/icon.svg", // the activity-bar icon
  "media/styles.css",
  "package.json",
];

/**
 * The largest the .vsix may be, in bytes. It was 245.52 KB on 2026-11-03
 * (#86), mostly the two fonts (417 KB before compression). 400 KB leaves
 * room for the game to grow, but catches a stray image, a second font or an
 * unminified dependency, any of which would add 100 KB or more.
 */
const MAX_VSIX_BYTES = 400 * 1024;

/** The `npm run package` script; the options passed to vsce below mirror it. */
const PACKAGE_SCRIPT = "vsce package --no-dependencies --githubBranch main";

/** Where the Marketplace README's links must point: the repo, on `main`. */
const REPO_URL = "https://github.com/dconyemerekwe/0xword";

interface PackedFile {
  readonly path: string;
  readonly contents?: Buffer | string;
}

/**
 * vsce's internal `pack`: `vsce package` without the prepublish build (the
 * test builds itself). Not in vsce's public API, which only offers
 * `createVSIX`, and that runs `npm run vscode:prepublish` in the folder. It's
 * the function `vsce package` calls (node_modules/@vscode/vsce/out/package.js),
 * and vsce is pinned to an exact version, so an upgrade that changes it fails
 * here rather than quietly.
 */
const { pack } = createRequire(import.meta.url)("@vscode/vsce/out/package.js") as {
  pack(options: {
    cwd: string;
    packagePath: string;
    dependencies: boolean;
    githubBranch: string;
  }): Promise<{ packagePath: string; files: PackedFile[] }>;
};

/** Every file git tracks, as `a/b.c` paths. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((path) => path !== "");
}

let work = "";
/** Paths in the repo that vsce would package. */
let listed: string[] = [];
let vsixBytes = 0;
let packed: PackedFile[] = [];

before(async () => {
  work = mkdtempSync(join(tmpdir(), "0xword-package-"));
  const checkout = join(work, "checkout");
  for (const path of trackedFiles()) {
    const from = join(root, path);
    // A tracked file deleted in the working tree isn't in a fresh checkout of the change.
    if (existsSync(from)) {
      mkdirSync(dirname(join(checkout, path)), { recursive: true });
      copyFileSync(from, join(checkout, path));
    }
  }
  await Promise.all(
    BUILDS.map((options) =>
      // From the copy, so the bundles are built from the checked-out files only.
      esbuild.build({ ...options, absWorkingDir: checkout, logLevel: "silent" }),
    ),
  );

  listed = (await listFiles({ cwd: checkout, packageManager: PackageManager.None })).sort();

  // pack prints the file tree; keep the test output to the test results.
  const log = console.log;
  console.log = () => {};
  try {
    const result = await pack({
      cwd: checkout,
      packagePath: join(work, "0xword.vsix"),
      dependencies: false,
      githubBranch: "main",
    });
    packed = result.files;
    vsixBytes = statSync(result.packagePath).size;
  } finally {
    console.log = log;
  }
});

after(() => {
  if (work !== "") {
    rmSync(work, { recursive: true, force: true });
  }
});

describe("the .vsix contents", () => {
  it("are exactly the allowlisted files, as vsce lists them for a fresh checkout and build", () => {
    assert.deepEqual(listed, [...PACKAGED_FILES].sort());
  });

  it("are the files vsce packs, plus only its own manifest files", () => {
    const own = ["[Content_Types].xml", "extension.vsixmanifest"];
    const renamed = new Map([
      ["extension/LICENSE.txt", "LICENSE"],
      ["extension/readme.md", "README.md"],
      ["extension/changelog.md", "CHANGELOG.md"],
    ]);
    const paths = packed
      .map((file) => file.path)
      .filter((path) => !own.includes(path))
      .map((path) => renamed.get(path) ?? path.replace(/^extension\//, ""))
      .sort();
    assert.deepEqual(paths, [...PACKAGED_FILES].sort());
  });

  it("leave out src/, tests, scripts/, docs/, source maps, TypeScript and dotfiles", () => {
    for (const path of listed) {
      assert.doesNotMatch(path, /^(src|test|scripts|docs|\.github|\.claude|\.vscode)\//, path);
      assert.doesNotMatch(path, /\.(map|ts)$|(^|\/)tsconfig\.json$/, path);
      assert.doesNotMatch(path, /(^|\/)\./, path);
    }
  });

  it("leave out the webview's TypeScript source and config, which sit in media/", () => {
    for (const path of ["media/main.ts", "media/text.d.ts", "media/tsconfig.json"]) {
      assert.ok(existsSync(join(root, path)), `${path} is in the repo`);
      assert.ok(!listed.includes(path), `${path} ships`);
    }
  });

  it("leave out the extension's source map, which the build writes beside it", () => {
    assert.ok(BUILDS.some((options) => options.outfile === "dist/extension.cjs" && options.sourcemap === true));
    assert.ok(!listed.includes("dist/extension.cjs.map"));
  });

  it("include both fonts, each with its OFL licence", () => {
    for (const font of ["DMSans", "JetBrainsMono"]) {
      assert.ok(listed.includes(`media/fonts/${font}-Variable.ttf`), font);
      assert.ok(listed.includes(`media/fonts/${font}-OFL.txt`), `${font} licence`);
    }
  });

  it("ship from media/ only files media/ is allowed to hold", () => {
    for (const path of listed.filter((path) => path.startsWith("media/"))) {
      assert.ok(ALLOWED_MEDIA.includes(path), path);
    }
  });

  it("are listed with the same options as the package script", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    assert.equal(manifest.scripts?.package, PACKAGE_SCRIPT);
  });

  it("has no \"vsce\" options in package.json, which the packing here wouldn't apply", () => {
    // `vsce package` reads a "vsce" block (patchOptionsWithManifest in
    // node_modules/@vscode/vsce/out/util.js); the `pack` call above skips that step.
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
    assert.ok(!("vsce" in manifest));
  });
});

describe("the .vsix size", () => {
  it(`stays under ${MAX_VSIX_BYTES / 1024} KB`, () => {
    assert.ok(vsixBytes > 0);
    assert.ok(vsixBytes <= MAX_VSIX_BYTES, `the .vsix is ${(vsixBytes / 1024).toFixed(2)} KB`);
  });
});

/** Every link target in Markdown or HTML: images, `[text](target)` and `href`. */
function linkTargets(markdown: string): string[] {
  return [
    ...imageLinks(markdown),
    ...[...markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? ""),
    ...[...markdown.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1] ?? ""),
  ];
}

describe("the packaged README", () => {
  const readme = (): string => {
    const file = packed.find((candidate) => candidate.path === "extension/readme.md");
    assert.ok(file?.contents !== undefined, "the .vsix has a rewritten readme.md");
    return file.contents.toString();
  };

  it("points every image at the repo's main branch, since docs/ isn't packaged", () => {
    const images = imageLinks(readme());
    const tracked = trackedFiles();
    assert.ok(images.length > 0);
    for (const link of images) {
      assert.ok(link.startsWith(`${REPO_URL}/raw/main/`), link);
      const path = decodeURIComponent(link.slice(`${REPO_URL}/raw/main/`.length));
      assert.ok(tracked.includes(path), `${path} isn't in the repo`);
    }
  });

  it("includes the screenshots in docs/, which don't ship themselves", () => {
    const images = imageLinks(readme());
    assert.ok(images.some((link) => link.includes("/raw/main/docs/")));
    assert.ok(!listed.some((path) => path.startsWith("docs/")));
  });

  it("has no relative link left, so links to files that don't ship still work", () => {
    for (const link of linkTargets(readme())) {
      assert.match(link, /^(https:\/\/|#|mailto:)/, link);
    }
  });

  it("the link check catches a relative link", () => {
    assert.deepEqual(linkTargets('[a](SECURITY.md) ![b](docs/x.png) <img src="y.png"> <a href="z.md">'), [
      "docs/x.png",
      "y.png",
      "SECURITY.md",
      "z.md",
    ]);
  });
});
