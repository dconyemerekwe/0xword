// Checks media/styles.css against the tested palette and the accessibility
// and CSP rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DECODE_PANEL, FINAL_PANEL } from "../../src/ui/game.ts";
import { LIGHT_BODY_CLASSES, THEME_ATTRIBUTE, THEME_ICON } from "../../src/theme.ts";
import {
  DARK_PALETTE,
  DIMMED_KEY_PAIRS,
  LARGE_TEXT_PAIRS,
  LIGHT_PALETTE,
  TEXT_PAIRS,
  contrastRatio,
  isLargeText,
  type PaletteToken,
} from "../../src/ui/palette.ts";
import { STYLE_PATH } from "../../src/webview/html.ts";

const css = readFileSync(new URL(`../../${STYLE_PATH.join("/")}`, import.meta.url), "utf8");
/** The stylesheet without comments. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
const root = /:root\s*\{([^}]*)\}/.exec(rules)?.[1] ?? "";
/** The light palette's rule: its selector list and its declarations. */
const lightRule = /(?<=\})\s*([^{}]*\[data-ox-theme="light"\])\s*\{([^}]*)\}/.exec(rules);
const lightSelectors = lightRule?.[1]?.split(",").map((selector) => selector.trim()) ?? [];
const light = lightRule?.[2] ?? "";
/** Everything but the two palette rules. */
const outsidePalettes = rules.replace(lightRule?.[0] ?? "", "").replace(/:root\s*\{[^}]*\}/, "");

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

  it("declares every light palette token in the light rule, with the tested value", () => {
    assert.ok(lightRule, "a light palette rule");
    for (const [token, value] of Object.entries(LIGHT_PALETTE)) {
      const declared = new RegExp(`${property(token)}:\\s*(#[0-9A-Fa-f]{6});`).exec(light)?.[1];
      assert.equal(declared?.toUpperCase(), value.toUpperCase(), token);
    }
  });

  it("declares no colour token that the palette doesn't have", () => {
    const known = Object.keys(DARK_PALETTE).map(property);
    for (const block of [root, light]) {
      const declared = [...block.matchAll(/(--ox-[a-z-]+):\s*#/g)].map((match) => match[1]);
      assert.deepEqual(declared.filter((name) => !known.includes(name ?? "")), []);
    }
  });

  it("uses colours only through those properties: no literal colours outside the two palette rules", () => {
    assert.doesNotMatch(outsidePalettes, /#[0-9A-Fa-f]{3,8}\b/);
    assert.doesNotMatch(outsidePalettes, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    // Named colours, in any property that takes a colour.
    for (const [, name, value] of outsidePalettes.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
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
    const uses = [...outsidePalettes.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(^|[\s;])color: var\(--ox-right\);/.test(body ?? ""))
      .map(([, selector]) => selector?.trim());
    assert.deepEqual(uses, [".title-hex"]);
  });

  it("makes right keys blue and absent keys darker and struck through", () => {
    assert.match(block(".key-right"), /background: var\(--ox-right\);/);
    assert.match(block(".key-absent"), /background: var\(--ox-key-absent\);/);
    assert.match(block(".key-absent"), /text-decoration: line-through;/);
  });

  it("has no Tried list styles: one try per round (#46)", () => {
    assert.doesNotMatch(css, /\.tried/);
  });
});

describe("media/styles.css light and dark themes", () => {
  it("puts the dark palette in :root: the default, for vscode-dark and vscode-high-contrast", () => {
    assert.match(root, /--ox-background: #14161B;/);
    // No other rule picks a palette from VS Code's dark classes.
    assert.doesNotMatch(rules, /vscode-dark|vscode-high-contrast(?!-light)/);
  });

  it("switches to the light palette for VS Code's light themes unless dark is forced, or whenever light is forced", () => {
    const expected = [
      ...LIGHT_BODY_CLASSES.map((name) => `body.${name}:not([${THEME_ATTRIBUTE}="dark"])`),
      `body[${THEME_ATTRIBUTE}="light"]`,
    ];
    assert.deepEqual(lightSelectors, expected);
  });

  it("decides the palette nowhere else", () => {
    const mentions = [...rules.matchAll(/vscode-light|vscode-high-contrast-light|data-ox-theme/g)].length;
    assert.equal(mentions, lightSelectors.join(",").match(/vscode-light|vscode-high-contrast-light|data-ox-theme/g)?.length);
  });

  it("puts the light palette on <body>, after :root, so it overrides the dark one", () => {
    assert.ok(lightSelectors.every((selector) => selector.startsWith("body")));
    assert.ok(rules.indexOf(lightRule?.[0] ?? "") > rules.indexOf(":root"));
  });

  it("shows the theme button's sun on the dark palette and its moon on the light one", () => {
    const shown = (block: string, icon: string): string | undefined =>
      new RegExp(`--ox-${icon}-display: (\\w+);`).exec(block)?.[1];
    for (const [palette, block] of [["dark", root], ["light", light]] as const) {
      const icon = THEME_ICON[palette];
      const other = icon === "sun" ? "moon" : "sun";
      assert.equal(shown(block, icon), "block", `${palette}: ${icon}`);
      assert.equal(shown(block, other), "none", `${palette}: ${other}`);
    }
    assert.match(block(".theme-sun"), /display: var\(--ox-sun-display\);/);
    assert.match(block(".theme-moon"), /display: var\(--ox-moon-display\);/);
  });

  it("puts the `?` and theme buttons side by side on the right of the header", () => {
    assert.match(block(".header"), /justify-content: space-between;/);
    assert.match(block(".header-buttons"), /display: flex;/);
  });

  it("outlines empty tiles and cheatsheet cards with their own tokens, as the light theme draws them differently", () => {
    assert.match(block(".tile"), /border: 2px solid var\(--ox-empty-border\);/);
    assert.match(block(".cheat-card"), /border: 1px solid var\(--ox-card-border\);/);
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

  it('draws "Last try" and error messages in the orange text colour: `wrong` itself in the dark theme', () => {
    assert.match(block(".decode-badge"), /color: var\(--ox-wrong-text\);/);
    assert.match(block(".message-error"), /color: var\(--ox-wrong-text\);/);
    assert.equal(DARK_PALETTE.wrongText, DARK_PALETTE.wrong);
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

describe("media/styles.css pages L1 to L3: the decode lock (#46)", () => {
  it("draws the locked Hints button dimmed, from `disabled`, with no pressed highlight", () => {
    const locked = block(".hints-button:disabled");
    assert.match(locked, /border-color: var\(--ox-hints-locked-border\);/);
    assert.match(locked, /color: var\(--ox-hints-locked-text\);/);
    assert.match(locked, /cursor: default;/);
  });

  it("draws the locked `?` greyed out in the locked Hints text colour, from `disabled`, at the same size (#53)", () => {
    const locked = block(".icon-button:disabled");
    assert.match(locked, /color: var\(--ox-hints-locked-text\);/);
    assert.match(locked, /cursor: default;/);
    // Only the colour and cursor change: no size, layout, opacity or icon change.
    assert.deepEqual(
      [...locked.matchAll(/([a-z-]+):/g)].map((match) => match[1]),
      ["color", "cursor"],
    );
  });

  it("stacks the lock over the panel's body in one grid cell, so the panel keeps its size and place", () => {
    assert.match(block(".decode"), /display: grid;/);
    assert.match(block(".decode-body"), /grid-area: 1 \/ 1;/);
    assert.match(block(".decode-lock"), /grid-area: 1 \/ 1;/);
    assert.match(block(".decode-lock"), /align-items: center;/);
    assert.match(block(".decode-lock"), /justify-content: center;/);
  });

  it("keeps the decode row's padding and border, so the #33 placeholder widths still hold", () => {
    assert.match(block(".decode"), /padding: 12px;/);
    assert.match(block(".decode"), /border: 2px solid var\(--ox-panel\);/);
    assert.match(block(".decode-body"), /gap: 8px;/);
  });

  it("fades the locked panel's body to the 10% measured from lock-1.jpg", () => {
    assert.match(block(".decode-locked .decode-body"), /opacity: 0\.1;/);
  });

  it("draws the lock badge round, with a thin outline, and the lock in the title's colour", () => {
    const badge = block(".lock-badge");
    assert.match(badge, /border: 1px solid var\(--ox-lock-badge-border\);/);
    assert.match(badge, /border-radius: 50%;/);
    assert.match(badge, /background: var\(--ox-lock-badge\);/);
    assert.match(badge, /color: var\(--ox-text\);/);
    assert.match(block(".lock-badge-icon"), /stroke: currentColor;/);
  });

  it("draws the title bold in the text colour and the message lighter", () => {
    assert.match(block(".lock-title"), /color: var\(--ox-text\);/);
    assert.match(block(".lock-title"), /font-weight: 700;/);
    assert.match(block(".lock-message"), /color: var\(--ox-lock-message\);/);
  });

  it("adds no transition or animation for the unlock: the page 3 card is the highlight", () => {
    for (const selector of [".decode", ".decode-body", ".decode-lock", ".decode-locked .decode-body"]) {
      assert.doesNotMatch(block(selector), /transition|animation/, selector);
    }
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

  it("draws the outcome message muted and smaller than the heading", () => {
    assert.match(block(".result-outcome"), /color: var\(--ox-muted\);/);
    const outcome = Number(/font-size: ([\d.]+)px;/.exec(block(".result-outcome"))?.[1]);
    const heading = Number(/font-size: ([\d.]+)px;/.exec(block(".result-heading"))?.[1]);
    assert.ok(outcome < heading, `${outcome}px under a ${heading}px heading`);
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

describe("media/styles.css page 5: How to play", () => {
  it("uses the page 5 colours from docs/design/README.md", () => {
    assert.equal(DARK_PALETTE.icon, "#CCCFD8");
    assert.equal(DARK_PALETTE.cheatHex, "#7EA8FF");
    assert.equal(DARK_PALETTE.panel, "#1D2027");
    assert.equal(DARK_PALETTE.chipOnAbsent, "#C9CFD8");
  });

  it("draws `?` and the back arrow as icons in the icon colour, with 44px targets", () => {
    const button = block(".icon-button");
    assert.match(button, /color: var\(--ox-icon\);/);
    assert.match(button, /min-width: var\(--ox-touch\);/);
    assert.match(button, /min-height: var\(--ox-touch\);/);
    assert.match(block(".icon"), /stroke: currentColor;/);
  });

  it("puts `?` on the right of the header", () => {
    assert.match(block(".header"), /justify-content: space-between;/);
  });

  it("draws RULES and ASCII CHEATSHEET in muted capitals", () => {
    assert.match(block(".section-heading"), /color: var\(--ox-muted\);/);
    assert.match(block(".section-heading"), /text-transform: uppercase;/);
  });

  it('sets the rules in the same type as "Decode the word": one shared font property', () => {
    const font = /(?:^|;)\s*font: (var\(--ox-label-font\));/;
    assert.equal(font.exec(block(".decode-label"))?.[1], "var(--ox-label-font)");
    assert.equal(font.exec(block(".rules"))?.[1], "var(--ox-label-font)");
    // Family, size, weight and line spacing all come from the shared value.
    assert.match(root, /--ox-label-font: 700 14px\/1\.4 var\(--ox-sans\);/);
    for (const selector of [".decode-label", ".rules"]) {
      assert.doesNotMatch(block(selector), /font-(family|size|weight)|line-height/, selector);
    }
  });

  it("centres each chip's word with equal padding on every side, level with the text around it", () => {
    const chip = block(".chip");
    assert.match(chip, /display: inline-flex;/);
    assert.match(chip, /align-items: center;/);
    assert.match(chip, /justify-content: center;/);
    assert.match(chip, /line-height: 1;/);
    assert.match(chip, /vertical-align: baseline;/);
    // One padding value: the same above, below and at the sides.
    assert.match(chip, /padding: \d+px;/);
  });

  it("keeps the chips within the rules' line height, so they don't spread the lines", () => {
    const padding = Number(/padding: (\d+)px;/.exec(block(".chip"))?.[1]);
    const [, size, lineHeight] = /--ox-label-font: \d+ (\d+)px\/([\d.]+)/.exec(root) ?? [];
    const chipHeight = Number(size) + 2 * padding;
    const lineBox = Number(size) * Number(lineHeight);
    assert.ok(chipHeight <= lineBox + 1, `a ${chipHeight}px chip on a ${lineBox}px line`);
  });

  it("draws rule 3's chips in the tile colours", () => {
    assert.match(block(".chip-right"), /background: var\(--ox-right\);\s*color: var\(--ox-on-right\);/);
    assert.match(block(".chip-wrong"), /background: var\(--ox-wrong\);\s*color: var\(--ox-on-wrong\);/);
    assert.match(block(".chip-absent"), /background: var\(--ox-absent\);\s*color: var\(--ox-chip-on-absent\);/);
  });

  it("draws the cheatsheet as 5 columns of panel-coloured cards, the letter bold and the hex in blue monospace", () => {
    assert.match(block(".cheatsheet"), /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
    assert.match(block(".cheat-card"), /background: var\(--ox-panel\);/);
    assert.match(block(".cheat-letter"), /color: var\(--ox-text\);/);
    assert.match(block(".cheat-letter"), /font-weight: 700;/);
    assert.match(block(".cheat-hex"), /color: var\(--ox-cheat-hex\);/);
    assert.match(block(".cheat-hex"), /font-family: var\(--ox-mono\);/);
  });

  it("draws 4_ and 5_ in the cards' blue monospace", () => {
    assert.match(block(".code"), /color: var\(--ox-cheat-hex\);/);
    assert.match(block(".code"), /font-family: var\(--ox-mono\);/);
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

  it("loads nothing but the bundled fonts: no @import, and url() only inside @font-face", () => {
    assert.doesNotMatch(rules, /@import/i);
    // test/media/fonts.test.ts checks that those URLs are relative and point into media/fonts/.
    assert.doesNotMatch(rules.replace(/@font-face\s*\{[^}]*\}/g, ""), /url\(/i);
  });

  it("sets again every size VS Code's default webview styles change: body padding and margin, font and line height", () => {
    const body = block("body");
    for (const declaration of [/margin: 0;/, /padding: 12px;/, /font-family: var\(--ox-sans\);/, /font-size: 14px;/, /font-weight: 400;/, /line-height: 1\.4;/]) {
      assert.match(body, declaration);
    }
    // Nothing is sized from the root font size, which the stylesheet doesn't set.
    assert.doesNotMatch(rules, /\d(rem|vw)\b/);
  });
});

/** A `px` value from a declaration such as `gap: 8px;`, or NaN. */
function px(body: string, property: string): number {
  return Number(new RegExp(`(?:^|[\\s;])${property}: ([\\d.]+)px;`).exec(body)?.[1]);
}

describe("media/styles.css grid tiles and keypad keep their shape (#33)", () => {
  /** The game column in a 400px panel: the panel less the body's padding on each side. */
  const column400 = 400 - 2 * px(block("body"), "padding");
  const rowGap = px(block(".grid-row"), "gap");
  const pairGap = px(block(".pair"), "gap");
  const keyGap = px(block(".keypad"), "gap");

  it("sizes every row's columns the same way, whatever its tiles hold, so empty tiles match scored ones", () => {
    assert.match(block(".grid-row"), /grid-template-columns: repeat\(4, minmax\(var\(--ox-pair-min\), 1fr\)\);/);
    // Two equal columns per pair, not sized from the digit: an empty tile is as wide as a filled one.
    assert.match(block(".pair"), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    // Square: the height follows the width for every tile.
    assert.match(block(".tile"), /aspect-ratio: 1;/);
  });

  it("changes only colours between tile states: empty, typed, right, wrong, absent and the dimmed locked tiles", () => {
    assert.equal(block(".tile-empty"), "", "no rule of its own for empty tiles");
    for (const selector of [".tile-typed", ".tile-right", ".tile-wrong", ".tile-absent", ".grid-locked .tile-right", ".grid-locked .tile-wrong"]) {
      const body = block(selector);
      assert.notEqual(body, "", selector);
      const properties = [...body.matchAll(/([a-z-]+):/g)].map((match) => match[1] ?? "");
      assert.deepEqual(properties.filter((name) => !["border-color", "background", "color"].includes(name)), [], selector);
    }
  });

  it("never shrinks a tile below a scored tile's content: one 18px digit line and its 2px border on each side", () => {
    assert.equal(px(block(".tile"), "font-size"), 18);
    assert.match(block("body"), /line-height: 1\.4;/);
    assert.match(block(".tile"), /border: 2px solid/);
    assert.match(root, /--ox-tile-min: calc\(18px \* 1\.4 \+ 2 \* 2px\);/);
    assert.match(root, new RegExp(`--ox-pair-min: calc\\(2 \\* var\\(--ox-tile-min\\) \\+ ${pairGap}px\\);`));
    // The hint strip's cells keep the same minimum, so they stay under their byte pairs.
    assert.match(block(".hint-strip"), /grid-template-columns: repeat\(4, minmax\(var\(--ox-pair-min\), 1fr\)\);/);
  });

  it("keeps every key at its 400px size, shrinking only to fit the column a scrollbar narrows: no fr, percentage or viewport widths", () => {
    // Exactly this range and nothing else: 89.5px at most, 87px at least.
    const columns = "minmax(var(--ox-key-min-width), var(--ox-key-width))";
    assert.match(block(".keypad"), /grid-template-columns: repeat\(4, minmax\(var\(--ox-key-min-width\), var\(--ox-key-width\)\)\);/);
    assert.equal(px(root, "--ox-key-width"), (column400 - 3 * keyGap) / 4);
    // VS Code's 10px scrollbar takes the 400px panel's column from 376px to 366px.
    assert.equal(px(root, "--ox-key-min-width"), (column400 - 10 - 3 * keyGap) / 4);
    assert.match(block(".key-wide"), /grid-column: span 2;/);
    for (const selector of [".keypad", ".key", ".key-wide"]) {
      const body = block(selector).replace(columns, "");
      assert.doesNotMatch(body, /\dfr\b|%|\dv[wh]\b|minmax|(?:^|[\s;])(max-)?width:/, selector);
    }
    // Still at least 44px tall.
    assert.match(block(".key"), /min-height: var\(--ox-touch\);/);
  });

  it("centres the keypad in a wider panel and lets it overflow to the right in a narrower one, never squashed", () => {
    // Auto margins centre it, and drop to 0 when it doesn't fit, so it starts at
    // the left and the panel scrolls sideways; centring with `align-self` or
    // `justify-content` would push its left side out of reach instead.
    assert.match(block(".keypad"), /margin-inline: auto;/);
    const game = /(?:^|\})\s*\.game,\s*\.how-to-play\s*\{([^}]*)\}/.exec(rules)?.[1];
    assert.ok(game, "the .game rule");
    for (const [name, body] of [[".keypad", block(".keypad")], [".key", block(".key")], [".game", game], ["#app", block("#app")], ["body", block("body")]]) {
      assert.doesNotMatch(body ?? "", /overflow|align-self|justify-(content|self): center/, name);
    }
  });

  it("keeps the 400px panel's sizes: 41px tiles and the keys' 1fr width there", () => {
    assert.deepEqual([rowGap, pairGap, keyGap], [12, 3, 6]);
    assert.equal((column400 - 3 * rowGap - 4 * pairGap) / 8, 41);
    // The grid's narrowest width fits the 400px column, so the tile minimum doesn't change 41px tiles.
    const pairMin = 2 * 29.2 + pairGap;
    assert.ok(4 * pairMin + 3 * rowGap <= column400, `${4 * pairMin + 3 * rowGap}px in ${column400}px`);
    assert.equal(px(root, "--ox-key-width"), 89.5);
    assert.equal(px(root, "--ox-key-min-width"), 87);
  });
});

describe("media/styles.css decode box placeholder (#33)", () => {
  /** The `@container (width < Npx)` rules: their width, selector and declarations. */
  const containerRules = [...rules.matchAll(/@container \(width < (\d+)px\) \{\s*([^{}]+?)\s*\{([^{}]*)\}\s*\}/g)].map(
    ([, width, selector, body]) => ({ width: Number(width), selector, body: body?.trim() }),
  );

  /** The decode row's width a placeholder needs: its text, the box's padding and border, the gap and the button. */
  function rowNeeded(text: number, button: number): number {
    const input = block(".decode-input");
    const box = 2 * Number(/padding: 0 (\d+)px;/.exec(input)?.[1]) + 2 * Number(/border: (\d+)px solid/.exec(input)?.[1]);
    return text + box + px(block(".decode-row"), "gap") + button;
  }

  it("ends the decode box's placeholder in an ellipsis when it doesn't fit, at the final answer too", () => {
    // One rule for both placeholders: "Type the English word" and "Decode the bytes above".
    assert.match(block(".decode-input"), /text-overflow: ellipsis;/);
    const placeholder = block(".decode-input::placeholder");
    assert.match(placeholder, /text-overflow: ellipsis;/);
    assert.match(placeholder, /overflow: hidden;/);
    assert.match(placeholder, /white-space: nowrap;/);
    assert.equal(block(".decode-final .decode-input::placeholder"), "", "the final card doesn't override it");
  });

  it("shows a placeholder that fits in full: the box takes the row's free width, and nothing else cuts it", () => {
    assert.match(block(".decode-input"), /flex: 1;/);
    assert.doesNotMatch(block(".decode-input"), /(?:^|[\s;])(max-)?width:/);
    assert.doesNotMatch(block(".decode-input::placeholder"), /width|max-|content:/);
  });

  it("makes the decode row a size container, so a rule can tell when the placeholder fits", () => {
    assert.match(block(".decode-row"), /container-type: inline-size;/);
  });

  it("hides a focused placeholder, where Chromium shows no ellipsis, only in a row too narrow for it: both placeholders", () => {
    // Widths measured in Chromium with the bundled DM Sans at 14px, by text:
    // each placeholder, and the bold button beside it. Rewording any of them
    // fails here until the cut-offs are measured again.
    const MEASURED: Readonly<Record<string, number>> = {
      "Type the English word": 142,
      "Decode": 85,
      "Decode the bytes above": 158.9,
      "Submit": 81.3,
    };
    const measured = (text: string): number => {
      const width = MEASURED[text];
      assert.ok(width !== undefined, `"${text}" has no measured width: re-measure the placeholder cut-off`);
      return width;
    };
    const typeTheWord = rowNeeded(measured(DECODE_PANEL.placeholder), measured(DECODE_PANEL.button));
    const decodeTheBytes = rowNeeded(measured(FINAL_PANEL.placeholder), measured(FINAL_PANEL.button));
    assert.deepEqual(containerRules, [
      { width: Math.ceil(typeTheWord), selector: ".decode-input:focus::placeholder", body: "color: transparent;" },
      { width: Math.ceil(decodeTheBytes), selector: ".decode-final .decode-input:focus::placeholder", body: "color: transparent;" },
    ]);
  });

  it("keeps a focused placeholder visible where it fits: in a 400px panel's decode row", () => {
    // The row at 400px: the body's padding, then the decode panel's padding and border.
    const row = 400 - 2 * px(block("body"), "padding") - 2 * px(block(".decode"), "padding") - 2 * 2;
    for (const { width } of containerRules) {
      assert.ok(width <= row, `hidden below ${width}px, the row is ${row}px`);
    }
  });

  it("never hides an unfocused placeholder: it ends in an ellipsis instead", () => {
    for (const [, selector, body] of rules.matchAll(/([^{}]*::placeholder)\s*\{([^{}]*)\}/g)) {
      if (!selector?.includes(":focus")) {
        assert.doesNotMatch(body ?? "", /transparent/, selector);
      }
    }
  });
});

describe("media/styles.css reduced motion (#63)", () => {
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{\s*([^{}]*)\{([^{}]*)\}\s*\}/.exec(rules);
  /** VS Code's Reduce Motion setting's rule (#74): its selector list and declarations. */
  const vscodeReduced = /(?:^|\})\s*([^{}@]*body\.vscode-reduce-motion[^{}]*)\{([^{}]*)\}/.exec(rules);
  /** Everything but the two reduced-motion rules. */
  const outsideReduced = rules
    .replace(reduced?.[0] ?? "", "")
    .replace(vscodeReduced ? `${vscodeReduced[1]}{${vscodeReduced[2]}}` : "", "");
  const resets = ["transition: none !important;", "animation: none !important;", "scroll-behavior: auto !important;"];

  it("turns off every transition, animation and smooth scroll under reduced motion, on every element and pseudo-element", () => {
    assert.ok(reduced, "the reduced-motion rule");
    const selectors = reduced[1]?.split(",").map((selector) => selector.trim());
    assert.deepEqual(selectors, ["*", "*::before", "*::after"]);
    for (const declaration of resets) {
      assert.ok(reduced[2]?.includes(declaration), declaration);
    }
  });

  it("turns off every transition and animation when VS Code marks the body `vscode-reduce-motion` (#74)", () => {
    // VS Code adds this body class when `workbench.reduceMotion` is "on" (or "auto"
    // with the OS setting), even when the OS's prefers-reduced-motion is off.
    assert.ok(vscodeReduced, "a rule for body.vscode-reduce-motion");
    const selectors = vscodeReduced[1]?.split(",").map((selector) => selector.trim());
    assert.deepEqual(selectors, [
      "body.vscode-reduce-motion",
      "body.vscode-reduce-motion *",
      "body.vscode-reduce-motion *::before",
      "body.vscode-reduce-motion *::after",
    ]);
    for (const declaration of resets) {
      assert.ok(vscodeReduced[2]?.includes(declaration), declaration);
    }
  });

  it("has just these two reduced-motion rules, with the same reset, and nothing else forces a value", () => {
    assert.equal(rules.match(/prefers-reduced-motion/g)?.length, 1, "one media query");
    assert.equal(rules.match(/\{[^{}]*\}/g)?.filter((rule) => rule.includes("!important")).length, 3, "the two resets and [hidden]");
    const declarations = (body: string | undefined): string[] =>
      (body ?? "").split(";").map((part) => part.trim()).filter(Boolean).sort();
    assert.deepEqual(declarations(vscodeReduced?.[2]), declarations(reduced?.[2]));
    assert.doesNotMatch(outsideReduced.replace(/\[hidden\]\s*\{[^}]*\}/, ""), /!important|vscode-reduce-motion/);
  });

  it("moves nothing the reduced-motion rule doesn't turn off: only transitions, animations and scrolling", () => {
    // Every motion property elsewhere is one the rule resets with a shorthand
    // or `scroll-behavior`. Motion through anything else would need a new reset.
    const motion = [...outsideReduced.matchAll(/(?:^|[\s;{])((?:transition|animation|scroll-behavior|offset-path|view-transition-name)[a-z-]*):/g)].map(
      (match) => match[1] ?? "",
    );
    for (const name of motion) {
      assert.match(name, /^(transition|animation|scroll-behavior)(-[a-z-]+)?$/, name);
    }
    assert.doesNotMatch(outsideReduced, /@view-transition/);
  });

  it("has the tile colour change as its only transition, so the reset is all it needs", () => {
    const transitions = [...outsideReduced.matchAll(/(?:^|[\s;])(transition[a-z-]*|animation[a-z-]*): ([^;]+);/g)].map((match) => `${match[1]}: ${match[2]}`);
    assert.deepEqual(transitions, ["transition: background-color 150ms ease-out"]);
    assert.doesNotMatch(outsideReduced, /@keyframes/);
  });
});

/**
 * A simple selector's specificity as [ids, classes, types]: enough for
 * compound selectors of types, classes, attributes and pseudo-classes.
 */
function specificity(selector: string): readonly [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes = selector.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+/g)?.length ?? 0;
  const types = selector.match(/(?:^|[\s>+~])[a-z][\w-]*/g)?.length ?? 0;
  return [ids, classes, types];
}

/** Whether specificity `a` beats `b`. */
function outranks(a: readonly number[], b: readonly number[]): boolean {
  for (const [index, value] of a.entries()) {
    const other = b[index] ?? 0;
    if (value !== other) {
      return value > other;
    }
  }
  return false;
}

describe("media/styles.css the focus ring (#63)", () => {
  /** The rules that set `outline`: their selectors and declarations. */
  const outlineRules = [...rules.matchAll(/([^{}]+)\{([^{}]*\boutline[^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: selector?.split(",").map((part) => part.trim()) ?? [],
    body: body ?? "",
  }));
  const ring = outlineRules[0];

  it("draws one 2px ring in the accent colour, 2px outside every focused control, and no rule removes or changes it", () => {
    assert.equal(outlineRules.length, 1, "only the ring rule sets outline");
    assert.deepEqual(ring?.selectors, [":focus-visible", ".decode-input:focus-visible"]);
    assert.match(ring?.body ?? "", /outline: 2px solid var\(--ox-accent\);/);
    assert.match(ring?.body ?? "", /outline-offset: 2px;/);
    assert.doesNotMatch(rules, /outline-(style|width|color)|outline: (none|0)/);
  });

  it("gives the decode box the ring by specificity too, in case VS Code's default `input:focus` ring is ever unlayered", () => {
    // VS Code's default webview styles, before this stylesheet, include
    // `a:focus, input:focus, select:focus, textarea:focus { outline: 1px solid -webkit-focus-ring-color; outline-offset: -1px; }`.
    // Current VS Code puts them in `@layer vscode-default`, so this unlayered
    // stylesheet wins whatever the specificity; the extra selector only
    // matters in a build without that layer.
    const vscodeDefault = specificity("input:focus");
    assert.deepEqual(vscodeDefault, [0, 1, 1]);
    assert.ok(!outranks(specificity(":focus-visible"), vscodeDefault), "the plain ring alone would lose to it");
    assert.ok(outranks(specificity(".decode-input:focus-visible"), vscodeDefault));
  });

  it("is visible in both palettes, so in both high-contrast themes: at least 3:1 against every surface around a control", () => {
    // High-contrast dark shows the dark palette and high-contrast light the light one.
    assert.ok(LIGHT_BODY_CLASSES.includes("vscode-high-contrast-light"));
    assert.ok(!(LIGHT_BODY_CLASSES as readonly string[]).includes("vscode-high-contrast"));
    // The ring sits outside the control, so it is seen against what is around it:
    // the page (header buttons, Hints, keys, DEL, ENTER), the decode panel
    // (the box and Decode), the final card (the box and Submit) or the result card (New round).
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE]) {
      for (const surface of ["background", "panel", "finalCard"] as const) {
        const ratio = contrastRatio(palette.accent, palette[surface]);
        assert.ok(ratio >= 3, `${palette.accent} on ${surface} ${palette[surface]}: ${ratio.toFixed(2)}:1`);
      }
    }
  });
});

describe("media/styles.css a focused key's ring in a 400px panel (#63)", () => {
  const ringWidth = px(block(":focus-visible,\n.decode-input:focus-visible"), "outline-offset") + 2;
  const padding = px(block("body"), "padding");
  const keyGap = px(block(".keypad"), "gap");

  it("fits the keypad in the 400px panel's column, with or without the scrollbar, so no key reaches the edge", () => {
    const column = 400 - 2 * padding;
    assert.equal(4 * px(root, "--ox-key-width") + 3 * keyGap, column);
    // VS Code's 10px scrollbar narrows the column, and the keys shrink to fit it.
    assert.equal(4 * px(root, "--ox-key-min-width") + 3 * keyGap, column - 10);
  });

  it("draws the ring within the body's padding at the panel's edges and within the gap between keys", () => {
    assert.equal(ringWidth, 4);
    assert.ok(ringWidth <= padding, `a ${ringWidth}px ring in ${padding}px of padding`);
    assert.ok(ringWidth < keyGap, `a ${ringWidth}px ring in a ${keyGap}px gap`);
  });

  it("lets nothing clip a ring: no overflow, clipping or paint containment but the screen-reader text and the placeholder", () => {
    const clipping = [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(?:^|[\s;])(overflow[a-z-]*|clip-path|clip|contain):/.test(body ?? ""))
      .map(([, selector]) => selector?.trim());
    assert.deepEqual(clipping, [".sr-only", ".decode-input::placeholder"]);
  });
});

describe("media/styles.css every text and background pair it draws is contrast-checked (#64)", () => {
  /**
   * Every rule that draws text or an icon, with the colour it's drawn in and
   * the fill it sits on (its own, or the one behind it): the audit for #64.
   * Each rule names at least one of the two tokens itself.
   */
  const DRAWN: readonly (readonly [selector: string, text: PaletteToken, background: PaletteToken])[] = [
    ["body", "text", "background"],
    [".icon-button", "icon", "background"],
    [".icon-button:disabled", "hintsLockedText", "background"],
    [".title-hex", "right", "background"],
    [".status", "muted", "background"],
    [".hints-button", "hintsText", "background"],
    ['.hints-button[aria-pressed="true"]', "hintsOnText", "hintsOn"],
    [".hints-button:disabled", "hintsLockedText", "background"],
    [".tile", "text", "background"],
    [".tile-right", "onRight", "right"],
    [".tile-wrong", "onWrong", "wrong"],
    [".tile-absent", "onAbsent", "absent"],
    [".grid-locked .tile-right", "onRight", "lockedRight"],
    [".grid-locked .tile-wrong", "onWrong", "lockedWrong"],
    [".hint-cell", "text", "background"],
    [".hint-unknown", "stripUnknown", "background"],
    [".legend", "muted", "background"],
    [".lock-badge", "text", "lockBadge"],
    [".lock-title", "text", "panel"],
    [".lock-message", "lockMessage", "panel"],
    [".decode", "text", "panel"],
    [".decode-badge", "wrongText", "finalCard"],
    [".decode-input", "text", "panel"],
    [".decode-input::placeholder", "muted", "panel"],
    [".decode-input:disabled", "muted", "panel"],
    [".decode-button", "onRight", "right"],
    [".decode-button:disabled", "muted", "keyAbsent"],
    [".decode-foot", "muted", "panel"],
    [".decode-final", "text", "finalCard"],
    // The box's typed text and its placeholder, on the page colour in the card.
    [".decode-final .decode-input", "text", "background"],
    [".decode-final .decode-input", "muted", "background"],
    [".decode-final .decode-button", "onWrong", "wrong"],
    [".decode-final .decode-foot", "finalNote", "finalCard"],
    [".result", "text", "panel"],
    [".result-outcome", "muted", "panel"],
    [".result-heading", "text", "panel"],
    [".result-line", "muted", "panel"],
    [".result-byte", "text", "byteTile"],
    [".result-hex", "byteHex", "byteTile"],
    [".result-arrow", "muted", "byteTile"],
    [".result-letter", "text", "byteTile"],
    [".result-button", "onRight", "right"],
    [".result-note", "muted", "background"],
    [".how-to-play-heading", "text", "background"],
    [".section-heading", "muted", "background"],
    [".rules", "text", "background"],
    [".chip-right", "onRight", "right"],
    [".chip-wrong", "onWrong", "wrong"],
    [".chip-absent", "chipOnAbsent", "absent"],
    [".cheatsheet-line", "text", "background"],
    [".code", "cheatHex", "background"],
    [".cheat-card", "text", "panel"],
    [".cheat-letter", "text", "panel"],
    [".cheat-hex", "cheatHex", "panel"],
    [".message", "text", "background"],
    [".message-error", "wrongText", "background"],
    [".key", "text", "key"],
    [".key-right", "onRight", "right"],
    [".key-wrong", "onWrong", "wrong"],
    [".key-absent", "muted", "keyAbsent"],
    [".key:disabled:not(.key-right, .key-wrong, .key-absent)", "muted", "key"],
    [".keypad-locked .key:disabled", "lockedKeyText", "lockedKey"],
    [".keypad-locked .key-right:disabled", "lockedKeyText", "lockedKeyRight"],
    [".keypad-locked .key-wrong:disabled", "onWrong", "lockedWrong"],
    [".keypad-locked .key-absent:disabled", "lockedKeyText", "keyAbsent"],
  ];
  const checked = [...TEXT_PAIRS, ...DIMMED_KEY_PAIRS, ...LARGE_TEXT_PAIRS].map(([text, background]) => `${text}/${background}`);

  for (const [selector, text, background] of DRAWN) {
    it(`checks ${selector}: ${text} on ${background}`, () => {
      const body = block(selector);
      assert.ok(
        body.includes(`var(${property(text)})`) || body.includes(`var(${property(background)})`),
        `${selector} names neither colour: ${body}`,
      );
      assert.ok(checked.includes(`${text}/${background}`), `${text}/${background} isn't in TEXT_PAIRS`);
    });
  }

  it("draws text and icons only in colours the audit lists", () => {
    const listed = new Set(DRAWN.map(([, text]) => property(text)));
    const used = [...outsidePalettes.matchAll(/(?:^|[\s;{])(?:color|stroke): var\((--ox-[a-z-]+)\)/g)].map((match) => match[1]);
    assert.ok(used.length > 0);
    for (const colour of used) {
      assert.ok(colour && listed.has(colour), `${colour} is drawn as text but not audited`);
    }
  });

  it("checks no pair the stylesheet doesn't draw", () => {
    const drawn = new Set(DRAWN.map(([, text, background]) => `${text}/${background}`));
    assert.deepEqual(
      checked.filter((pair) => !drawn.has(pair)),
      [],
    );
  });
});

describe("media/styles.css colour is never the only cue (#64)", () => {
  it("strikes through not-in-word keys, and keeps them struck through when the hex locks", () => {
    assert.match(block(".key-absent"), /text-decoration: line-through;/);
    assert.doesNotMatch(block(".keypad-locked .key-absent:disabled"), /text-decoration/);
  });

  it("dashes the disabled decode box's outline", () => {
    assert.match(block(".decode-input:disabled"), /border-style: dashed;/);
  });

  it("draws the lock icons in their text's colour, so they show wherever that text does", () => {
    for (const selector of [".status-icon", ".hints-icon", ".lock-badge-icon"]) {
      assert.match(block(selector), /stroke: currentColor;/, selector);
    }
  });
});
