// Checks media/styles.css against the tested palette and the accessibility
// and CSP rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MAX_ROWS } from "../../src/game/round.ts";
import { DECODE_PANEL, FINAL_PANEL } from "../../src/ui/game.ts";
import { LIGHT_BODY_CLASSES, THEME_ATTRIBUTE, THEME_ICON } from "../../src/theme.ts";
import { DARK_PALETTE, LIGHT_PALETTE, isLargeText } from "../../src/ui/palette.ts";
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

  it("strikes through tried words", () => {
    assert.match(block(".tried-word"), /text-decoration: line-through;/);
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
    const gap = /(?:^|[\s;])gap: ([^;]+);/;
    assert.equal(columns.exec(block(".hint-strip"))?.[1], columns.exec(block(".grid-row"))?.[1]);
    assert.ok(gap.exec(block(".grid-row"))?.[1], "a gap between byte pairs");
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
    const between = px(block(".grid-row"), "gap");
    const within = px(block(".pair"), "gap");
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
});

/** The declarations of the rule whose selector list is `selectors`, whitespace aside. */
function ruleFor(selectors: string): string {
  const wanted = selectors.replace(/\s+/g, " ").trim();
  for (const [, selector, body] of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector?.replace(/\s+/g, " ").trim() === wanted) {
      return body ?? "";
    }
  }
  return "";
}

/**
 * A `px` value from a declaration such as `gap: 12px;`, or from one that names
 * a custom property declared in :root as a `px` value, such as
 * `gap: var(--ox-row-gap);`. NaN otherwise.
 */
function px(body: string, property: string): number {
  const value = new RegExp(`(?:^|[\\s;])${property}: ([^;]+);`).exec(body)?.[1]?.trim() ?? "";
  const custom = /^var\((--ox-[a-z-]+)\)$/.exec(value)?.[1];
  if (custom) {
    return px(root, custom);
  }
  return Number(/^([\d.]+)px$/.exec(value)?.[1]);
}

describe("media/styles.css panel fit (#33)", () => {
  const tileMin = 18 * 1.4 + 2 * 2;
  const pairGap = px(block(".pair"), "gap");
  const pairMin = 2 * tileMin + pairGap;
  const rowGap = px(block(".grid-row"), "gap");
  const gridGap = px(block(".grid"), "gap");
  const gameGap = px(ruleFor(".game, .how-to-play"), "gap");
  const aroundGrid = px(root, "--ox-around-grid");
  const messageMargin = Number(/margin: (-\d+)px 0;/.exec(block(".message"))?.[1]);
  /** The game's parts that take height mid-game and at the final answer, as `buildScreen` appends them. */
  const IN_FLOW = ["header", "statusBar", "grid", "legend", "decode", "message", "keypad"];
  /** The game's other parts, which `--ox-around-grid` leaves out (see the test that checks why). */
  const NOT_IN_FLOW = ["hintStrip", "result", "resultNote", "announcement"];

  /** A grid row's widest allowed width, as the `.grid-row, .hint-strip` rule works it out. */
  function rowMaxWidth(panelHeight: number, hintRoom: number): number {
    const byHeight = ((panelHeight - aroundGrid - hintRoom - 5 * gridGap) / 6) * 8 + 4 * pairGap + 3 * rowGap;
    return Math.max(4 * pairMin + 3 * rowGap, byHeight);
  }

  /** A tile's size in a panel: the row takes the game's width, up to its maximum, and never less than its columns' minimum. */
  function tileSize(panelWidth: number, panelHeight: number, hintRoom = 0): number {
    const game = Math.min(panelWidth - 2 * px(block("body"), "padding"), px(block("#app"), "max-width"));
    const row = Math.max(Math.min(game, rowMaxWidth(panelHeight, hintRoom)), 4 * pairMin + 3 * rowGap);
    return (row - 4 * pairGap - 3 * rowGap) / 8;
  }

  /** The game screen's height with that tile size: the grid plus everything around it. */
  function screenHeight(tile: number, hintRoom = 0): number {
    return aroundGrid + hintRoom + 6 * tile + 5 * gridGap;
  }

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
    assert.match(root, /--ox-pair-min: calc\(2 \* var\(--ox-tile-min\) \+ var\(--ox-pair-gap\)\);/);
    // At about 230px the rows overflow, as they did, rather than shrink the tiles.
    assert.equal(tileSize(230, 850).toFixed(1), "29.2");
    assert.equal(tileSize(230, 400).toFixed(1), "29.2");
  });

  it("keeps the hint strip in the grid's columns, with the same width limits", () => {
    assert.equal(/grid-template-columns: ([^;]+);/.exec(block(".hint-strip"))?.[1], "repeat(4, minmax(var(--ox-pair-min), 1fr))");
    const shared = ruleFor(".grid-row, .hint-strip");
    assert.match(shared, /width: 100%;/);
    assert.match(shared, /margin-inline: auto;/);
  });

  it("ends the decode box's placeholder in an ellipsis when it doesn't fit, at the final answer too", () => {
    // One rule for both placeholders: "Type the English word" and "Decode the bytes above".
    assert.match(block(".decode-input"), /text-overflow: ellipsis;/);
    const placeholder = block(".decode-input::placeholder");
    assert.match(placeholder, /text-overflow: ellipsis;/);
    assert.match(placeholder, /overflow: hidden;/);
    assert.match(placeholder, /white-space: nowrap;/);
    assert.equal(block(".decode-final .decode-input::placeholder"), "", "the final card doesn't override it");
  });

  /** The `@container (width < Npx)` rules: their width, selector and declarations. */
  const containerRules = [...rules.matchAll(/@container \(width < (\d+)px\) \{\s*([^{}]+?)\s*\{([^{}]*)\}\s*\}/g)].map(
    ([, width, selector, body]) => ({ width: Number(width), selector, body: body?.trim() }),
  );
  /** The decode row's width a placeholder needs: its text, the box's padding and border, the gap and the button. */
  function rowNeeded(text: number, button: number): number {
    const box = 2 * Number(/padding: 0 (\d+)px;/.exec(block(".decode-input"))?.[1]) + 2 * Number(/border: (\d+)px solid/.exec(block(".decode-input"))?.[1]);
    return text + box + px(block(".decode-row"), "gap") + button;
  }

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

  it("shows a placeholder that fits in full: the box takes the row's free width, and nothing else cuts it", () => {
    assert.match(block(".decode-input"), /flex: 1;/);
    assert.doesNotMatch(block(".decode-input"), /(?:^|[\s;])(max-)?width:/);
    assert.doesNotMatch(block(".decode-input::placeholder"), /width|max-|content:/);
  });

  it("keeps the 400px panel's tiles, gaps and keys as they were", () => {
    assert.deepEqual([rowGap, pairGap, gridGap, px(block(".keypad"), "gap")], [12, 3, 6, 6]);
    // 41px tiles at 400px wide, as before, from 850px tall up.
    assert.equal(tileSize(400, 850), 41);
    assert.equal(tileSize(400, 1200), 41);
    // The widest tiles, in the 400px-wide game of a wider panel, stay 44px when there's room.
    assert.equal(tileSize(437, 960), 44);
  });

  it("adds up the height outside the grid from the stylesheet's own sizes", () => {
    const touch = px(root, "--ox-touch");
    const decode = 2 * 2 + 2 * px(block(".decode"), "padding") + 14 * 1.4 + 2 * px(block(".decode"), "gap") + touch + 12 * 1.4;
    const message = 14 * 1.4 + 2 * messageMargin;
    const keypad = 5 * touch + 4 * px(block(".keypad"), "gap");
    const legend = 12 * 1.4;
    // Body padding, header, status line, legend, decode panel, message, keypad, and the gaps between them and the grid.
    const parts = 2 * px(block("body"), "padding") + touch + touch + legend + decode + message + keypad + (IN_FLOW.length - 1) * gameGap;
    assert.ok(aroundGrid >= parts && aroundGrid - parts < 1, `--ox-around-grid is ${aroundGrid}px for ${parts}px`);
  });

  it("measures `--ox-around-grid` from the game's in-flow parts: a new one forces a re-measure", () => {
    const script = readFileSync(new URL("../../media/main.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const appended = /const game = element\("div", "game"\);\s*game\.append\(([^)]*)\);/.exec(script)?.[1]?.split(",").map((name) => name.trim());
    // In the game's order: the in-flow parts mid-game and at the final answer, and the rest.
    assert.deepEqual(appended, ["header", "statusBar", "grid", "hintStrip", "legend", "decode", "result", "resultNote", "message", "announcement", "keypad"]);
    assert.deepEqual(appended?.filter((name) => !NOT_IN_FLOW.includes(name)), IN_FLOW);
    // Why the others take no height while the keypad shows: the hint strip has its own room,
    // the result card and its note are hidden until the keypad is, and the announcement is screen-reader only.
    assert.match(script, /ui\.hintStrip\.hidden = !view\.hints\.on/);
    assert.match(script, /result\.hidden = true;/);
    assert.match(script, /resultNote\.hidden = true;/);
    assert.match(script, /ui\.keypad\.hidden = result !== null;/);
    assert.match(script, /const announcement = element\("p", "sr-only"\);/);
    assert.match(block(".sr-only"), /position: absolute;/);
    // The comment by `--ox-around-grid` names every part it adds up, and the gaps between them.
    const comment = /\/\*((?:(?!\*\/)[\s\S])*)\*\/\s*--ox-around-grid:/.exec(css)?.[1]?.replace(/\s*\*\s*/g, " ") ?? "";
    for (const part of ["header", "status line", "legend", "decode panel", "message line", "keypad"]) {
      assert.match(comment, new RegExp(part), part);
    }
    assert.match(comment, new RegExp(`the ${IN_FLOW.length - 1} gaps of ${gameGap}px`));
  });

  it("fits the whole game in a panel about 400 × 850: grid, legend, decode panel and the full keypad", () => {
    for (const [width, height] of [[400, 850], [437, 850], [400, 900], [437, 960]] as const) {
      const used = screenHeight(tileSize(width, height));
      assert.ok(used <= height, `${width} × ${height}: ${used}px`);
    }
  });

  it("limits tile size by the panel's height as well as its width, in a wider panel too", () => {
    const shared = ruleFor(".grid-row, .hint-strip");
    assert.match(
      shared,
      /max-width: max\(\s*4 \* var\(--ox-pair-min\) \+ 3 \* var\(--ox-row-gap\),\s*\(100vh - var\(--ox-around-grid\) - var\(--ox-hint-room\) - 5 \* var\(--ox-grid-gap\)\) \/ 6 \* 8 \+ 4 \* var\(--ox-pair-gap\) \+ 3 \* var\(--ox-row-gap\)\s*\);/,
    );
    assert.ok(tileSize(437, 850) < 44, "shorter than 960px: smaller tiles");
    assert.ok(screenHeight(tileSize(437, 850)) <= 850);
  });

  it("makes room for the hint strip while it shows: its 28px cell and a 12px gap", () => {
    assert.match(root, /--ox-hint-room: 0px;/);
    const room = px(ruleFor(".game:has(> .hint-strip:not([hidden]))"), "--ox-hint-room");
    assert.equal(room, px(block(".hint-cell"), "min-height") + gameGap);
    assert.ok(screenHeight(tileSize(400, 850, room), room) <= 850);
  });

  it("keeps the grid at 6 rows", () => {
    assert.equal(MAX_ROWS, 6);
    assert.match(ruleFor(".grid-row, .hint-strip"), /- 5 \* var\(--ox-grid-gap\)\) \/ 6 \*/);
  });

  it("takes the space from the message line's empty margins, without it overlapping the decode panel or keypad", () => {
    assert.ok(messageMargin < 0 && -messageMargin < gameGap, `${messageMargin}px inside a ${gameGap}px gap`);
    // One line is still kept, so a message showing up doesn't move the keypad.
    assert.match(block(".message"), /min-height: 1\.4em;/);
  });

  it("sets again every size VS Code's default webview styles change: body padding and margin, font and line height", () => {
    const body = block("body");
    for (const declaration of [/margin: 0;/, /padding: 12px;/, /font-family: var\(--ox-sans\);/, /font-size: 14px;/, /font-weight: 400;/, /line-height: 1\.4;/]) {
      assert.match(body, declaration);
    }
    // Nothing is sized from the root font size, which the stylesheet doesn't set.
    assert.doesNotMatch(rules, /\d(rem|vw)\b/);
  });

  it("keeps keys at least 44px tall", () => {
    assert.match(block(".key"), /min-height: var\(--ox-touch\);/);
    assert.equal(px(root, "--ox-touch"), 44);
  });

  it("lets a panel too short for the game scroll: nothing is fixed to the panel's height or clipped", () => {
    assert.equal(block("html"), "", "no rule for <html>");
    for (const selector of ["body", "#app", ".game, .how-to-play", ".grid", ".grid-row", ".grid-row, .hint-strip", ".keypad"]) {
      const body = ruleFor(selector);
      assert.notEqual(body, "", selector);
      assert.doesNotMatch(body, /(?:^|[\s;])(height|max-height):|overflow|position: fixed/, selector);
    }
    // The height limit has a floor, so tiles keep their minimum and the page scrolls.
    assert.equal(tileSize(400, 500).toFixed(1), "29.2");
    assert.ok(screenHeight(tileSize(400, 500)) > 500);
  });
});
