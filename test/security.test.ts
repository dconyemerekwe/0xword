// Audit tests for the webview's security rules (CLAUDE.md rules 2, 5 and 6):
// the policy, the extension-side wiring, and what media/ holds.
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
];

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

  it("sets default-src 'none' and exactly the four directives it needs", () => {
    assert.deepEqual(directives.get("default-src"), ["'none'"]);
    assert.deepEqual([...directives.keys()].sort(), ["default-src", "font-src", "img-src", "script-src", "style-src"]);
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
  for (const file of ["media/main.ts", "src/webview/html.ts", "src/extension.ts"]) {
    it(`${file} has no innerHTML, insertAdjacentHTML, inline handler or style attribute set as text`, () => {
      for (const pattern of FORBIDDEN) {
        assert.doesNotMatch(code(file), pattern, file);
      }
    });
  }

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
    for (const [, font] of read(STYLE_PATH.join("/")).matchAll(/url\("([^"]+)"\)/g)) {
      assert.ok(existsSync(new URL(`media/${font}`, root)), `${font}`);
    }
  });

  it("has a stylesheet that loads nothing from outside: no http(s), @import or data: URLs", () => {
    assert.doesNotMatch(read(STYLE_PATH.join("/")), /https?:|@import|data:/i);
  });
});
