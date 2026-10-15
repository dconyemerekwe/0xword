// Checks media/styles.css against the tested palette and the accessibility
// and CSP rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DARK_PALETTE, isLargeText } from "../../src/ui/palette.ts";
import { STYLE_PATH } from "../../src/webview/html.ts";

const css = readFileSync(new URL(`../../${STYLE_PATH.join("/")}`, import.meta.url), "utf8");
/** The stylesheet without comments. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
const root = /:root\s*\{([^}]*)\}/.exec(rules)?.[1] ?? "";
const outsideRoot = rules.replace(/:root\s*\{[^}]*\}/, "");

/** `onRight` → `--ox-on-right`. */
function property(token: string): string {
  return `--ox-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(rules)?.[1] ?? "";
}

describe("media/styles.css colours", () => {
  it("declares every dark palette token in :root, with the tested value", () => {
    for (const [token, value] of Object.entries(DARK_PALETTE)) {
      const declared = new RegExp(`${property(token)}:\\s*(#[0-9A-Fa-f]{6});`).exec(root)?.[1];
      assert.equal(declared?.toUpperCase(), value.toUpperCase(), token);
    }
  });

  it("declares no colour token that the palette doesn't have", () => {
    const declared = [...root.matchAll(/(--ox-[a-z-]+):\s*#/g)].map((match) => match[1]);
    const known = Object.keys(DARK_PALETTE).map(property);
    assert.deepEqual(declared.filter((name) => !known.includes(name ?? "")), []);
  });

  it("uses colours only through those properties: no literal colours outside :root", () => {
    assert.doesNotMatch(outsideRoot, /#[0-9A-Fa-f]{3,8}\b/);
    assert.doesNotMatch(outsideRoot, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    // Named colours, in any property that takes a colour.
    for (const [, name, value] of outsideRoot.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
      if (/color|background|border|outline|fill|stroke|shadow|decoration/.test(name ?? "")) {
        const words =
          (value ?? "")
            .replace(/var\(--ox-[a-z-]+\)/g, "")
            .replace(/\d+(\.\d+)?(px|em|rem|%)?/g, "")
            .match(/[a-z-]+/gi) ?? [];
        const allowed = ["solid", "dashed", "none", "inherit", "line-through", "transparent", "currentColor"];
        assert.deepEqual(words.filter((word) => !allowed.includes(word)), [], `${name}: ${value}`);
      }
    }
  });

  it("only refers to custom properties it declares", () => {
    const declared = new Set([...root.matchAll(/(--ox-[a-z-]+):/g)].map((match) => match[1]));
    for (const [, name] of rules.matchAll(/var\((--[a-z-]+)\)/g)) {
      assert.ok(declared.has(name), name);
    }
  });

  it("colours right, wrong and absent tiles with the mark colours and their text colours", () => {
    assert.match(block(".tile-right"), /background: var\(--ox-right\);[\s\S]*color: var\(--ox-on-right\);/);
    assert.match(block(".tile-wrong"), /background: var\(--ox-wrong\);[\s\S]*color: var\(--ox-on-wrong\);/);
    assert.match(block(".tile-absent"), /background: var\(--ox-absent\);[\s\S]*color: var\(--ox-on-absent\);/);
  });

  it("draws the `0x` title in the design's blue, as WCAG large text", () => {
    assert.match(block(".title-hex"), /color: var\(--ox-right\);/);
    const size = Number(/font-size: ([\d.]+)px;/.exec(block(".title"))?.[1]);
    const weight = Number(/font-weight: (\d+);/.exec(block(".title-hex"))?.[1]);
    assert.ok(isLargeText(size, weight), `${size}px at weight ${weight}`);
  });

  it("uses the large-text-only blue for text nowhere but the title", () => {
    const uses = [...outsideRoot.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(^|[\s;])color: var\(--ox-right\);/.test(body ?? ""))
      .map(([, selector]) => selector?.trim());
    assert.deepEqual(uses, [".title-hex"]);
  });

  it("makes right keys blue and absent keys darker and struck through", () => {
    assert.match(block(".key-right"), /background: var\(--ox-right\);/);
    assert.match(block(".key-absent"), /background: var\(--ox-key-absent\);/);
    assert.match(block(".key-absent"), /text-decoration: line-through;/);
  });

  it("strikes through tried words", () => {
    assert.match(block(".tried-word"), /text-decoration: line-through;/);
  });
});

describe("media/styles.css layout and accessibility", () => {
  it("makes keys, the Decode button and the decode box at least 44px tall", () => {
    assert.match(root, /--ox-touch:\s*44px;/);
    for (const selector of [".key", ".decode-button", ".decode-input"]) {
      assert.match(block(selector), /min-height: var\(--ox-touch\);/, selector);
    }
  });

  it("makes keypad keys at least 44px wide too", () => {
    assert.match(block(".key"), /min-width: var\(--ox-touch\);/);
  });

  it("puts a wider gap between byte pairs than within a pair", () => {
    const between = Number(/gap: (\d+)px;/.exec(block(".grid-row"))?.[1]);
    const within = Number(/gap: (\d+)px;/.exec(block(".pair"))?.[1]);
    assert.ok(between > within, `${between}px between, ${within}px within`);
  });

  it("respects reduced motion", () => {
    assert.match(rules, /@media \(prefers-reduced-motion: reduce\)/);
  });

  it("loads nothing: no @import and no url()", () => {
    assert.doesNotMatch(rules, /@import|url\(/i);
  });
});
