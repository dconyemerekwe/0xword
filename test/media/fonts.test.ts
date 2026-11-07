// Checks the bundled fonts in media/fonts/: what's there, where it came from,
// how media/styles.css loads it, and that it ships in the .vsix.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { matchesGlob } from "node:path/posix";
import { describe, it } from "node:test";
import { MEDIA_FOLDER, STYLE_PATH, buildCsp, buildHtml, createNonce } from "../../src/webview/html.ts";

const root = new URL("../../", import.meta.url);
const FONT_FOLDER = `${MEDIA_FOLDER}/fonts`;
const fonts = new URL(`${FONT_FOLDER}/`, root);
const styleUrl = new URL(STYLE_PATH.join("/"), root);

const css = readFileSync(styleUrl, "utf8");
/** The stylesheet without comments. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
const faces = [...rules.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
/** Everything but the @font-face rules. */
const outsideFaces = rules.replace(/@font-face\s*\{[^}]*\}/g, "");
const rootBlock = /:root\s*\{([^}]*)\}/.exec(rules)?.[1] ?? "";

/** The two bundled families, each with its font file, licence and the project named in that licence. */
const FAMILIES = [
  {
    family: "DM Sans",
    stack: "--ox-sans",
    generic: "sans-serif",
    font: "DMSans-Variable.ttf",
    licence: "DMSans-OFL.txt",
    project: "The DM Sans Project Authors",
  },
  {
    family: "JetBrains Mono",
    stack: "--ox-mono",
    generic: "monospace",
    font: "JetBrainsMono-Variable.ttf",
    licence: "JetBrainsMono-OFL.txt",
    project: "The JetBrains Mono Project Authors",
  },
] as const;

const FONT_FILES = FAMILIES.flatMap(({ font, licence }) => [font, licence]);

/** `font-family: "DM Sans"` → `DM Sans`. */
function faceFamily(face: string): string | undefined {
  return /font-family:\s*"([^"]+)";/.exec(face)?.[1];
}

/** The @font-face rule for `family`. */
function faceFor(family: string): string {
  return faces.find((face) => faceFamily(face) === family) ?? "";
}

/** A face's `font-weight: 100 1000` range. */
function weightRange(face: string): readonly [number, number] {
  const [, low, high] = /font-weight:\s*(\d+)\s+(\d+);/.exec(face) ?? [];
  return [Number(low), Number(high)];
}

/** The families in a custom property's font stack, quotes removed. */
function stackOf(property: string): string[] {
  const value = new RegExp(`${property}:\\s*([^;]+);`).exec(rootBlock)?.[1] ?? "";
  return value.split(",").map((family) => family.trim().replace(/^"|"$/g, ""));
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(outsideFaces)?.[1] ?? "";
}

/** SHA-256 of a file in media/fonts/, as lowercase hex. */
function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(new URL(file, fonts))).digest("hex");
}

interface ReadmeRow {
  readonly file: string;
  readonly sourceUrl: string;
  readonly commit: string;
  readonly checksum: string;
}

/** The README table's rows: `| file | source file | URL | commit | SHA-256 |`. */
const readmeRows: ReadmeRow[] = [
  ...readFileSync(new URL("README.md", fonts), "utf8").matchAll(
    /^\| `([^`]+)` \| `[^`]+` \| (\S+) \| `([^`]+)` \| `([^`]+)` \|$/gm,
  ),
].map(([, file = "", sourceUrl = "", commit = "", checksum = ""]) => ({ file, sourceUrl, commit, checksum }));

describe("media/fonts/ contents", () => {
  it("holds exactly the two upright variable fonts, their two OFL licences and the README", () => {
    assert.deepEqual(readdirSync(fonts).sort(), [...FONT_FILES, "README.md"].sort());
  });

  it("bundles no italic files, as the panel uses no italics", () => {
    assert.ok(readdirSync(fonts).every((file) => !/italic/i.test(file)));
    assert.doesNotMatch(rules, /italic|oblique/i);
  });

  for (const { family, font, licence, project } of FAMILIES) {
    it(`ships ${family} as a TrueType font file that names its family`, () => {
      const bytes = readFileSync(new URL(font, fonts));
      assert.deepEqual([...bytes.subarray(0, 4)], [0, 1, 0, 0], "TrueType signature");
      // The name table stores the family name in UTF-16 big-endian.
      assert.ok(bytes.includes(Buffer.from(family, "utf16le").swap16()), `names ${family}`);
    });

    it(`ships ${family}'s SIL Open Font License 1.1 next to it`, () => {
      const text = readFileSync(new URL(licence, fonts), "utf8");
      assert.match(text, /SIL Open Font License, Version 1\.1/);
      assert.ok(text.includes(project), project);
    });
  }
});

describe("media/fonts/README.md", () => {
  it("has one row per font and licence file, and none for a file that isn't there", () => {
    assert.deepEqual(readmeRows.map(({ file }) => file).sort(), [...FONT_FILES].sort());
  });

  it("records a source URL in Google Fonts' google/fonts repository, pinned to the recorded commit", () => {
    for (const { file, sourceUrl, commit } of readmeRows) {
      assert.match(commit, /^[0-9a-f]{40}$/, file);
      const prefix = `https://github.com/google/fonts/blob/${commit}/ofl/`;
      assert.ok(sourceUrl.startsWith(prefix), `${file}: ${sourceUrl}`);
      assert.match(sourceUrl.slice(prefix.length), /^(dmsans|jetbrainsmono)\//, file);
    }
  });

  it("takes every file from the same commit", () => {
    assert.equal(new Set(readmeRows.map(({ commit }) => commit)).size, 1);
  });

  it("records each file's SHA-256, and every file matches it", () => {
    for (const { file, checksum } of readmeRows) {
      assert.match(checksum, /^[0-9a-f]{64}$/, file);
      assert.equal(sha256(file), checksum, file);
    }
  });

  it("would catch a file that doesn't match its checksum", () => {
    const [first, second] = readmeRows;
    assert.ok(first && second);
    assert.notEqual(sha256(first.file), second.checksum);
  });
});

describe("media/styles.css @font-face", () => {
  it("declares exactly one face per bundled family", () => {
    assert.deepEqual(faces.map(faceFamily).sort(), FAMILIES.map(({ family }) => family).sort());
  });

  for (const { family, font } of FAMILIES) {
    it(`loads ${family} by a relative URL that points to its file in media/fonts/`, () => {
      const urls = [...faceFor(family).matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1] ?? "");
      assert.deepEqual(urls, [`fonts/${font}`]);
      for (const url of urls) {
        assert.doesNotMatch(url, /^[a-z][a-z0-9+.-]*:|^\/|\.\./i, url);
        const resolved = new URL(url, styleUrl);
        assert.ok(resolved.href.startsWith(fonts.href), resolved.href);
        assert.ok(existsSync(resolved), resolved.href);
      }
    });
  }

  it("loads nothing from outside: no remote, data: or local() sources", () => {
    assert.doesNotMatch(rules, /https?:|\/\/|data:|local\(/i);
  });

  it("covers DM Sans weight 1000, which the title's WORD uses", () => {
    assert.match(block(".title-word"), /font-family: var\(--ox-sans\);[\s\S]*font-weight: 1000;/);
    const [low, high] = weightRange(faceFor("DM Sans"));
    assert.ok(low <= 400 && high >= 1000, `${low} to ${high}`);
  });

  it("covers every weight the stylesheet uses with each family", () => {
    const sans = weightRange(faceFor("DM Sans"));
    const mono = weightRange(faceFor("JetBrains Mono"));
    for (const [, selector, body = ""] of outsideFaces.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const weight = /font-weight: (\d+);/.exec(body)?.[1];
      if (weight === undefined) continue;
      const [low, high] = body.includes("var(--ox-mono)") ? mono : sans;
      assert.ok(Number(weight) >= low && Number(weight) <= high, `${selector?.trim()}: ${weight}`);
    }
  });
});

describe("media/styles.css font families", () => {
  it("sets the interface in DM Sans", () => {
    assert.equal(stackOf("--ox-sans")[0], "DM Sans");
    assert.match(block("body"), /font-family: var\(--ox-sans\);/);
  });

  it("sets hex tiles, the keypad, the title's 0x and the cheatsheet hex in JetBrains Mono", () => {
    assert.equal(stackOf("--ox-mono")[0], "JetBrains Mono");
    for (const selector of [".tile", ".key", ".title-hex", ".cheat-hex"]) {
      assert.match(block(selector), /font-family: var\(--ox-mono\);/, selector);
    }
  });

  for (const { family, stack, generic } of FAMILIES) {
    it(`follows ${family} with fallback fonts, ending in the generic ${generic}`, () => {
      const families = stackOf(stack);
      assert.ok(families.length >= 3, families.join(", "));
      assert.equal(families.at(-1), generic);
    });
  }

  it("names the bundled families only through those stacks, so every element keeps its fallbacks", () => {
    for (const [, value = ""] of outsideFaces.matchAll(/font-family:\s*([^;]+);/g)) {
      assert.match(value, /^var\(--ox-(sans|mono)\)$/, value);
    }
    for (const [, value = ""] of outsideFaces.matchAll(/(?:^|[\s;{])font:\s*([^;]+);/g)) {
      assert.match(value, /^(inherit|var\(--ox-label-font\))$/, value);
    }
    assert.match(rootBlock, /--ox-label-font:[^;]*var\(--ox-sans\);/);
  });

  it("shows text in the fallback fonts straight away, rather than hiding it while a font loads", () => {
    for (const face of faces) {
      assert.match(face, /font-display: swap;/);
    }
  });
});

describe("the CSP for the bundled fonts", () => {
  const CSP_SOURCE = "https://*.vscode-cdn.net";

  it("allows fonts only from the webview's own source", () => {
    const directives = buildCsp(CSP_SOURCE, "abc").split("; ");
    assert.deepEqual(
      directives.filter((directive) => directive.startsWith("font-src")),
      [`font-src ${CSP_SOURCE}`],
    );
    assert.ok(directives.includes("default-src 'none'"));
  });

  it("puts that font-src in the webview's HTML, with no other origin", () => {
    const html = buildHtml({
      cspSource: CSP_SOURCE,
      nonce: createNonce(),
      scriptUri: `${CSP_SOURCE}/media/dist/main.js`,
      styleUri: `${CSP_SOURCE}/media/styles.css`,
      theme: "system",
    });
    const csp = /content="([^"]*)"/.exec(html)?.[1] ?? "";
    assert.match(csp, new RegExp(`(^|; )font-src ${CSP_SOURCE.replace(/[.*]/g, "\\$&")}(;|$)`));
    assert.doesNotMatch(csp.replaceAll(CSP_SOURCE, ""), /https?:|data:|\*/);
  });
});

describe(".vscodeignore and the bundled fonts", () => {
  const ignored = readFileSync(new URL(".vscodeignore", root), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  it("doesn't exclude any font or licence file, so they ship in the .vsix", () => {
    for (const file of FONT_FILES) {
      // A pattern without a slash may match at any depth, so try the file name too.
      for (const path of [`${FONT_FOLDER}/${file}`, file]) {
        for (const pattern of ignored) {
          assert.ok(!matchesGlob(path, pattern), `${pattern} excludes ${path}`);
        }
      }
    }
  });

  it("would catch a pattern that excludes them", () => {
    for (const pattern of ["media/**", "media/fonts/**", "**/*.ttf", "*.txt"]) {
      assert.ok(
        FONT_FILES.some((file) => matchesGlob(`${FONT_FOLDER}/${file}`, pattern) || matchesGlob(file, pattern)),
        pattern,
      );
    }
  });
});
