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

describe("media/styles.css page 3: the hex locked and the final answer", () => {
  it("uses the page 3 colours from docs/design/README.md", () => {
    assert.equal(DARK_PALETTE.finalCard, "#241B12");
    assert.equal(DARK_PALETTE.lockedKey, "#1B1E24");
    assert.equal(DARK_PALETTE.lockedKeyRight, "#1E3660");
    assert.equal(DARK_PALETTE.lockedRight, "#2754A8");
    assert.equal(DARK_PALETTE.lockedWrong, "#AE783F");
  });

  it("draws the final-answer card with an orange border on its own background", () => {
    assert.match(block(".decode-final"), /border-color: var\(--ox-wrong\);/);
    assert.match(block(".decode-final"), /background: var\(--ox-final-card\);/);
  });

  it('draws "Last try" in orange', () => {
    assert.match(block(".decode-badge"), /color: var\(--ox-wrong\);/);
  });

  it("makes Submit orange with dark text", () => {
    assert.match(block(".decode-final .decode-button"), /background: var\(--ox-wrong\);[\s\S]*color: var\(--ox-on-wrong\);/);
  });

  it("dims locked keys, keeping right and wrong keys coloured", () => {
    assert.match(block(".keypad-locked .key:disabled"), /background: var\(--ox-locked-key\);/);
    assert.match(block(".keypad-locked .key-right:disabled"), /background: var\(--ox-locked-key-right\);/);
    assert.match(block(".keypad-locked .key-wrong:disabled"), /background: var\(--ox-locked-wrong\);/);
  });

  it("puts the locked-key rules after the general disabled-key rule, so they win", () => {
    assert.ok(rules.indexOf(".keypad-locked .key:disabled") > rules.indexOf(".key:disabled:not("));
  });

  it("keeps locked absent keys struck through", () => {
    assert.doesNotMatch(block(".keypad-locked .key-absent:disabled"), /text-decoration/);
    assert.match(block(".key-absent"), /text-decoration: line-through;/);
  });

  it("dims the right and wrong tiles while the hex is locked", () => {
    assert.match(block(".grid-locked .tile-right"), /background: var\(--ox-locked-right\);/);
    assert.match(block(".grid-locked .tile-wrong"), /background: var\(--ox-locked-wrong\);/);
  });

  it("draws the lock icon in the status line's own colour", () => {
    assert.match(block(".status-icon"), /stroke: currentColor;/);
  });
});

describe("media/styles.css page 2: the Hints button and strip", () => {
  it("uses the page 2 colours from docs/design/README.md", () => {
    assert.equal(DARK_PALETTE.hintsBorder, "#3C3F48");
    assert.equal(DARK_PALETTE.hintsText, "#CCCFD8");
    assert.equal(DARK_PALETTE.hintsOn, "#1E2A45");
    assert.equal(DARK_PALETTE.hintsOnText, "#7EA8FF");
  });

  it("draws Hints off outlined on the page background", () => {
    const off = block(".hints-button");
    assert.match(off, /border: 1px solid var\(--ox-hints-border\);/);
    assert.match(off, /background: var\(--ox-background\);/);
    assert.match(off, /color: var\(--ox-hints-text\);/);
  });

  it("draws Hints on with a blue border and a tinted fill, from aria-pressed", () => {
    const on = block('.hints-button[aria-pressed="true"]');
    assert.match(on, /border-color: var\(--ox-right\);/);
    assert.match(on, /background: var\(--ox-hints-on\);/);
    assert.match(on, /color: var\(--ox-hints-on-text\);/);
  });

  it("draws the light bulb in the button's own colour", () => {
    assert.match(block(".hints-icon"), /stroke: currentColor;/);
  });

  it("puts Hints on the right of the status line", () => {
    assert.match(block(".status-bar"), /justify-content: space-between;/);
  });

  it("draws one dashed cell per byte, in the same columns as the byte pairs", () => {
    const columns = /grid-template-columns: ([^;]+);/;
    const gap = /gap: (\d+px);/;
    assert.equal(columns.exec(block(".hint-strip"))?.[1], columns.exec(block(".grid-row"))?.[1]);
    assert.equal(gap.exec(block(".hint-strip"))?.[1], gap.exec(block(".grid-row"))?.[1]);
    assert.match(block(".hint-cell"), /border: 1px dashed var\(--ox-strip-border\);/);
  });

  it("draws known letters in the text colour and ? muted", () => {
    assert.match(block(".hint-cell"), /color: var\(--ox-text\);/);
    assert.match(block(".hint-unknown"), /color: var\(--ox-strip-unknown\);/);
  });
});

describe("media/styles.css page 4: the result card, in the dark palette", () => {
  it("takes the byte tiles' colours from existing dark tokens, adding no new colours", () => {
    assert.equal(DARK_PALETTE.byteTile, DARK_PALETTE.hintsOn);
    assert.equal(DARK_PALETTE.byteHex, DARK_PALETTE.hintsOnText);
  });

  it("draws the card with a blue outline on the panel colour", () => {
    assert.match(block(".result"), /border: 2px solid var\(--ox-right\);/);
    assert.match(block(".result"), /background: var\(--ox-panel\);/);
  });

  it("draws the heading as large text and the result line muted", () => {
    const size = Number(/font-size: ([\d.]+)px;/.exec(block(".result-heading"))?.[1]);
    assert.ok(size >= 24, `${size}px`);
    assert.match(block(".result-heading"), /color: var\(--ox-text\);/);
    assert.match(block(".result-line"), /color: var\(--ox-muted\);/);
  });

  it("keeps the byte tiles inside the card: the columns and tiles may shrink below their content", () => {
    // With plain `1fr` a column can't be narrower than its tile's content,
    // so in a narrow panel the 4th tile spilled past the card's border.
    assert.match(block(".result-bytes"), /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    assert.match(block(".result-byte"), /min-width: 0;/);
  });

  it("wraps the byte tiles to 2 × 2 in a very narrow panel, keeping 4 in a row at about 400px", () => {
    const narrow = /@media \(max-width: (\d+)px\) \{\s*\.result-bytes \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*\}\s*\}/.exec(rules);
    assert.ok(narrow, "a max-width media query with 2 columns");
    const breakpoint = Number(narrow[1]);
    // Four tiles of about 28px plus 3 gaps of 8px, inside the body's and the card's padding and border.
    const needed = 4 * 28 + 3 * 8 + 2 * 12 + 2 * 16 + 2 * 2;
    assert.ok(breakpoint >= needed && breakpoint < 400, `${breakpoint}px, needs at least ${needed}px`);
  });

  it("draws four byte tiles in a row, with the hex in blue and the letter in the text colour", () => {
    assert.match(block(".result-byte"), /background: var\(--ox-byte-tile\);/);
    assert.match(block(".result-hex"), /color: var\(--ox-byte-hex\);/);
    assert.match(block(".result-hex"), /font-family: var\(--ox-mono\);/);
    assert.match(block(".result-letter"), /color: var\(--ox-text\);/);
  });

  it("makes New round blue with white text, and the note under the card muted", () => {
    assert.match(block(".result-button"), /background: var\(--ox-right\);[\s\S]*color: var\(--ox-on-right\);/);
    assert.match(block(".result-note"), /color: var\(--ox-muted\);/);
  });
});

describe("media/styles.css layout and accessibility", () => {
  it("makes keys, the Decode button, the decode box, Hints and New round at least 44px tall", () => {
    assert.match(root, /--ox-touch:\s*44px;/);
    for (const selector of [".key", ".decode-button", ".decode-input", ".hints-button", ".result-button"]) {
      assert.match(block(selector), /min-height: var\(--ox-touch\);/, selector);
    }
  });

  it("makes keypad keys and Hints at least 44px wide too", () => {
    assert.match(block(".key"), /min-width: var\(--ox-touch\);/);
    assert.match(block(".hints-button"), /min-width: var\(--ox-touch\);/);
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
