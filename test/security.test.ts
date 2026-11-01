// Audit tests for the webview's security rules (CLAUDE.md rules 2, 5 and 6):
// the policy, the extension-side wiring, and what media/ holds.
//
// The per-load nonce and refuse-a-foreign-nonce criteria of #58 are also
// covered by the createNonce and buildHtml tests in test/webview/html.test.ts;
// the draw-as-text criterion also by the last suite of test/media/main.test.ts.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MEDIA_FOLDER, SCRIPT_PATH, STYLE_PATH, buildCsp, buildHtml, createNonce } from "../src/webview/html.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
/** Source without comments, so a comment about `innerHTML` isn't a hit. */
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CSP_SOURCE = "https://*.vscode-cdn.net";

/** Patterns that build or run markup or code from text. */
const FORBIDDEN = [
  /innerHTML/,
  /outerHTML/,
  /insertAdjacentHTML/,
  /document\.write/,
  /\beval\s*\(/,
  /new Function\b/,
  /\.on[a-z]+\s*=[^=]/,
  /setAttribute\(\s*["'](style|on[a-z]+)["']/i,
  /\.style\b/,
  /cssText/,
  /srcdoc/i,
  /createContextualFragment/,
  /DOMParser/,
  /insertAdjacentElement/,
];

/** Every .ts file under src/, as `src/...` paths: media/main.ts bundles src/game and src/ui. */
function sourceFiles(): string[] {
  return readdirSync(fileURLToPath(new URL("src/", root)), { recursive: true, encoding: "utf8" })
    .map((path) => `src/${path.replaceAll("\\", "/")}`)
    .filter((path) => path.endsWith(".ts"))
    .sort();
}

/** Every file under media/, as `media/...` paths with forward slashes. */
function mediaFiles(): string[] {
  return readdirSync(fileURLToPath(new URL(`${MEDIA_FOLDER}/`, root)), { recursive: true, encoding: "utf8" })
    .map((path) => `${MEDIA_FOLDER}/${path.replaceAll("\\", "/")}`)
    .filter((path) => statSync(new URL(path, root)).isFile())
    .sort();
}

/** What the panel uses, plus the sources and licences that sit beside it. */
const ALLOWED_MEDIA = [
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

describe("security audit: the Content Security Policy", () => {
  const nonce = createNonce();
  const directives = new Map(
    buildCsp(CSP_SOURCE, nonce)
      .split("; ")
      .map((part) => {
        const [name = "", ...sources] = part.split(" ");
        return [name, sources] as const;
      }),
  );

  it("sets default-src 'none' and the script, style, font and img directives", () => {
    assert.deepEqual(directives.get("default-src"), ["'none'"]);
    for (const name of ["script-src", "style-src", "font-src", "img-src"]) {
      assert.ok(directives.has(name), name);
    }
  });

  it("lets no other directive allow more than 'none' or the extension's own source", () => {
    const required = ["default-src", "script-src", "style-src", "font-src", "img-src"];
    for (const [name, sources] of directives) {
      if (!required.includes(name)) {
        assert.ok(sources.every((source) => source === "'none'" || source === CSP_SOURCE), name);
      }
    }
  });

  it("allows scripts only with the per-load nonce", () => {
    assert.deepEqual(directives.get("script-src"), [`'nonce-${nonce}'`]);
  });

  it("allows styles, fonts and images only from the extension's own source", () => {
    for (const name of ["style-src", "font-src", "img-src"]) {
      assert.deepEqual(directives.get(name), [CSP_SOURCE], name);
    }
  });

  it("never allows unsafe-inline, unsafe-eval, data:, blob: or a bare wildcard", () => {
    assert.doesNotMatch(buildCsp(CSP_SOURCE, nonce), /unsafe-|data:|blob:|\s\*(\s|;|$)/);
  });

  it("is the policy in the HTML the host builds", () => {
    const html = buildHtml({ cspSource: CSP_SOURCE, nonce, scriptUri: "s", styleUri: "c", theme: "system" });
    assert.ok(html.includes(`content="${buildCsp(CSP_SOURCE, nonce)}"`));
  });
});

describe("security audit: no markup or code built from text", () => {
  // The built bundle is gitignored: scanned when a build has made it, skipped before.
  const bundle = existsSync(new URL("media/dist/main.js", root)) ? ["media/dist/main.js"] : [];
  for (const file of [...sourceFiles(), "media/main.ts", ...bundle]) {
    it(`${file} has no innerHTML, insertAdjacentHTML, inline handler, style or script injection`, () => {
      for (const pattern of FORBIDDEN) {
        assert.doesNotMatch(code(file), pattern, file);
      }
    });
  }

  it("scans the source files it should", () => {
    const files = sourceFiles();
    for (const file of ["src/extension.ts", "src/webview/html.ts", "src/game/round.ts", "src/ui/game.ts"]) {
      assert.ok(files.includes(file), file);
    }
  });

  it("gives setAttribute a string-literal name everywhere, bar the one in svgElement", () => {
    const source = code("media/main.ts");
    const calls = [...source.matchAll(/\.setAttribute\(\s*([^,)]*)/g)].map((match) => (match[1] ?? "").trim());
    assert.ok(calls.length > 10, "found the setAttribute calls");
    // The one named exception is `node.setAttribute(name, value)` inside svgElement, pinned below.
    assert.equal(calls.filter((arg) => arg === "name").length, 1);
    // The other named exception is the theme attribute, a constant in src/theme.ts.
    assert.equal(calls.filter((arg) => arg === "THEME_ATTRIBUTE").length, 1);
    assert.match(code("src/theme.ts"), /export const THEME_ATTRIBUTE = "data-ox-theme"/);
    for (const arg of calls.filter((arg) => arg !== "name" && arg !== "THEME_ATTRIBUTE")) {
      assert.match(arg, /^"[a-z-]+"$/, arg);
    }
    assert.match(
      source,
      /function svgElement[\s\S]*?for \(const \[name, value\] of Object\.entries\(attributes\)\) \{\s*node\.setAttribute\(name, value\);/,
    );
  });

  it("calls svgElement only with a literal object of known attribute names, never on*, style or href", () => {
    const known = new Set(["class", "viewBox", "stroke-linecap", "stroke-linejoin", "aria-hidden", "d", "x", "y", "width", "height", "rx", "cx", "cy", "r"]);
    const source = code("media/main.ts");
    const calls = [...source.matchAll(/svgElement\(\s*"[a-z]+",\s*(\{[^}]*\})/g)];
    assert.ok(calls.length > 10, "found the svgElement calls");
    // Every call matched the literal form: the definition is the only other `svgElement(`.
    assert.equal(source.match(/svgElement[<(]/g)?.length, calls.length + 1);
    for (const [, literal = ""] of calls) {
      assert.doesNotMatch(literal, /\.\.\.|\[|\$\{/, "no spread or computed names");
      const keys = [...literal.matchAll(/(?:^\{|,)\s*("[\w-]+"|\w+)\s*:/g)].map((match) => (match[1] ?? "").replaceAll('"', ""));
      assert.ok(keys.length > 0, literal);
      for (const key of keys) {
        assert.ok(known.has(key), key);
      }
    }
  });

  it("the HTML builder's output has no inline script, on* handler or style attribute", () => {
    const html = buildHtml({ cspSource: CSP_SOURCE, nonce: createNonce(), scriptUri: "s.js", styleUri: "c.css", theme: "dark" });
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/i);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(html, /\sstyle\s*=|<style\b/i);
  });

  it("the panel draws text only with textContent or text nodes: no innerText or outerText", () => {
    const source = code("media/main.ts");
    assert.doesNotMatch(source, /innerText|outerText/);
    assert.match(source, /\.textContent =/);
  });
});

describe("security audit: the webview options and each load", () => {
  // These two tests read src/extension.ts as text on purpose: it imports `vscode`,
  // which a plain node test can't load, so the exact wiring text is what can be pinned.
  const extension = code("src/extension.ts");

  it("limits localResourceRoots to the extension's media/ folder, and nothing else", () => {
    const roots = /localResourceRoots:\s*(\[[^\]]*\])/.exec(extension)?.[1];
    assert.equal(roots, "[vscode.Uri.joinPath(this.#extensionUri, MEDIA_FOLDER)]");
    assert.equal(MEDIA_FOLDER, "media");
  });

  it("makes a new nonce for every load, inline, not once up front", () => {
    assert.equal(extension.match(/createNonce\(\)/g)?.length, 1);
    assert.match(extension, /nonce:\s*createNonce\(\)/);
  });

  it("serves the script and stylesheet from inside media/", () => {
    assert.equal(SCRIPT_PATH[0], MEDIA_FOLDER);
    assert.equal(STYLE_PATH[0], MEDIA_FOLDER);
  });
});

describe("security audit: what media/ holds", () => {
  it("holds only the files the panel uses, their sources and licences", () => {
    // The built script is gitignored: before a build it may be missing, never extra.
    const found = mediaFiles();
    assert.deepEqual(
      found,
      ALLOWED_MEDIA.filter((path) => found.includes(path) || path !== "media/dist/main.js"),
    );
  });

  it("holds every file the page, the stylesheet and the manifest point at", () => {
    assert.ok(existsSync(new URL(STYLE_PATH.join("/"), root)));
    assert.ok(read("package.json").includes('"icon": "media/icon.svg"'));
    assert.ok(existsSync(new URL("media/icon.svg", root)));
    assert.ok(read("package.json").includes('"icon": "media/icon.png"'));
    assert.ok(existsSync(new URL("media/icon.png", root)));
    for (const [, font] of read(STYLE_PATH.join("/")).matchAll(/url\("([^"]+)"\)/g)) {
      assert.ok(existsSync(new URL(`media/${font}`, root)), `${font}`);
    }
  });

  it("has a stylesheet that loads nothing from outside: no http(s), @import or data: URLs", () => {
    assert.doesNotMatch(read(STYLE_PATH.join("/")), /https?:|@import|data:/i);
  });
});
