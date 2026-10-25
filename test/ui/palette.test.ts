import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  BELOW_MIN_CONTRAST,
  DARK_PALETTE,
  DIMMED_KEY_PAIRS,
  LIGHT_PALETTE,
  MIN_TEXT_CONTRAST,
  LARGE_TEXT_PAIRS,
  MIN_LARGE_TEXT_CONTRAST,
  PALETTES,
  TEXT_PAIRS,
  isLargeText,
  contrastRatio,
  relativeLuminance,
  type PaletteToken,
} from "../../src/ui/palette.ts";

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
    assert.equal(contrastRatio("#2F6FE4", "#2F6FE4"), 1);
  });

  it("is the same either way round", () => {
    assert.equal(contrastRatio("#FFFFFF", "#2F6FE4"), contrastRatio("#2F6FE4", "#FFFFFF"));
  });

  it("matches known WCAG values", () => {
    // #767676 on white is the classic just-passing grey: 4.54:1.
    assert.equal(contrastRatio("#767676", "#FFFFFF").toFixed(2), "4.54");
    assert.equal(relativeLuminance("#808080").toFixed(4), "0.2159");
  });

  it("accepts either letter case", () => {
    assert.equal(contrastRatio("#2f6fe4", "#ffffff"), contrastRatio("#2F6FE4", "#FFFFFF"));
  });

  it("rejects anything but #RRGGBB", () => {
    for (const bad of ["#FFF", "FFFFFF", "#GGGGGG", "white", "#FFFFFF00", ""]) {
      assert.throws(() => relativeLuminance(bad), RangeError, bad);
    }
  });
});

describe("DARK_PALETTE", () => {
  it("uses the colours CLAUDE.md sets for the dark theme", () => {
    assert.equal(DARK_PALETTE.right, "#2F6FE4");
    assert.equal(DARK_PALETTE.onRight, "#FFFFFF");
    assert.equal(DARK_PALETTE.wrong, "#F0A04B");
    assert.equal(DARK_PALETTE.onWrong, "#1A1206");
    assert.equal(DARK_PALETTE.absent, "#343944");
    assert.equal(DARK_PALETTE.background, "#14161B");
    assert.equal(DARK_PALETTE.panel, "#1D2027");
    assert.equal(DARK_PALETTE.text, "#E8EAF0");
  });

  it("keeps the dark theme as built: the tokens added for the light theme repeat existing dark values", () => {
    assert.equal(DARK_PALETTE.wrongText, DARK_PALETTE.wrong);
    assert.equal(DARK_PALETTE.emptyBorder, DARK_PALETTE.absent);
    assert.equal(DARK_PALETTE.cardBorder, DARK_PALETTE.key);
  });

  it("uses the owner-approved decode lock colours, measured from the lock-*.jpg images and reusing values they match (#46)", () => {
    assert.equal(DARK_PALETTE.lockBadge, DARK_PALETTE.key);
    assert.equal(DARK_PALETTE.lockBadgeBorder, DARK_PALETTE.hintsBorder);
    assert.equal(DARK_PALETTE.lockMessage, DARK_PALETTE.hintsText);
    // The design table's absent-key text (owner's choice over the measured #8B919E).
    assert.equal(DARK_PALETTE.hintsLockedText, "#8A909C");
    assert.equal(DARK_PALETTE.hintsLockedBorder, "#303239");
  });

  it("needs at least WCAG AA for large text, and only puts the design's blue title there", () => {
    assert.equal(MIN_LARGE_TEXT_CONTRAST, 3);
    assert.deepEqual(LARGE_TEXT_PAIRS, [["right", "background"]]);
    // About 3.9:1: fine for large text, too low for normal text.
    const ratio = contrastRatio(DARK_PALETTE.right, DARK_PALETTE.background);
    assert.ok(ratio >= 3 && ratio < 4.5, ratio.toFixed(2));
  });
});

describe("LIGHT_PALETTE", () => {
  it("uses the page 4 colours from the light table in docs/design/README.md", () => {
    assert.equal(LIGHT_PALETTE.background, "#F6F6F9");
    assert.equal(LIGHT_PALETTE.text, "#15181B");
    assert.equal(LIGHT_PALETTE.muted, "#5D636C");
    assert.equal(LIGHT_PALETTE.right, "#2463EA");
    assert.equal(LIGHT_PALETTE.onRight, "#FFFFFF");
    assert.equal(LIGHT_PALETTE.wrong, "#F3A524");
    assert.equal(LIGHT_PALETTE.onWrong, "#1A1206");
    assert.equal(LIGHT_PALETTE.absent, "#6C7281");
    assert.equal(LIGHT_PALETTE.onAbsent, "#FFFFFF");
    assert.equal(LIGHT_PALETTE.emptyBorder, "#CFD2D8");
    assert.equal(LIGHT_PALETTE.panel, "#FFFFFF");
    assert.equal(LIGHT_PALETTE.byteTile, "#EDF3FC");
    assert.equal(LIGHT_PALETTE.byteHex, "#2463EA");
  });

  it("draws the `0x` title in CLAUDE.md's light blue", () => {
    assert.equal(LIGHT_PALETTE.right, "#2463EA");
  });

  /**
   * How each light value no page draws in light was derived: a page 4 value
   * (by its token, or the light outline `#CFD2D8`), or `share` of one over
   * another per sRGB channel. Recomputing them here proves none is a new hue.
   */
  const OUTLINE = "#CFD2D8";
  const light = (token: PaletteToken): string => LIGHT_PALETTE[token];
  const DERIVED: Readonly<Partial<Record<PaletteToken, string | readonly [top: string, base: string, share: number]>>> = {
    accent: light("right"),
    wrongText: [light("onWrong"), light("wrong"), 0.5],
    key: [OUTLINE, light("background"), 0.5],
    keyAbsent: light("background"),
    finalCard: [light("wrong"), light("panel"), 0.1],
    finalNote: light("muted"),
    lockedRight: [light("absent"), light("right"), 0.4],
    lockedWrong: [light("absent"), light("wrong"), 0.4],
    lockedKey: [OUTLINE, light("background"), 0.25],
    lockedKeyRight: [light("right"), light("background"), 0.15],
    lockedKeyText: light("muted"),
    hintsBorder: OUTLINE,
    hintsText: light("text"),
    hintsOn: light("byteTile"),
    hintsOnText: light("byteHex"),
    stripBorder: [light("muted"), OUTLINE, 0.5],
    stripUnknown: light("muted"),
    lockBadge: light("key"),
    lockBadgeBorder: OUTLINE,
    lockMessage: light("muted"),
    hintsLockedText: light("muted"),
    hintsLockedBorder: [OUTLINE, light("background"), 0.5],
    cardBorder: OUTLINE,
    icon: light("text"),
    cheatHex: light("byteHex"),
    chipOnAbsent: light("onAbsent"),
  };

  for (const [token, rule] of Object.entries(DERIVED)) {
    it(`derives ${token} from the page 4 colours, adding no new hue`, () => {
      const expected = typeof rule === "string" ? rule : mix(...rule);
      assert.equal(LIGHT_PALETTE[token as PaletteToken], expected);
    });
  }

  it("is its own palette: none of the well-known colours of the game it's inspired by", () => {
    // Its green, yellow and greys, in its light and dark modes.
    const borrowed = ["#6AAA64", "#C9B458", "#787C7E", "#538D4E", "#B59F3B", "#3A3A3C", "#D3D6DA", "#121213"];
    for (const palette of Object.values(PALETTES)) {
      for (const [token, value] of Object.entries(palette)) {
        assert.ok(!borrowed.includes(value.toUpperCase()), `${token}: ${value}`);
      }
    }
  });

  it("names nothing after that game, in either palette's code or the stylesheet", () => {
    for (const path of ["../../src/ui/palette.ts", "../../src/theme.ts", "../../media/styles.css"]) {
      const text = readFileSync(new URL(path, import.meta.url), "utf8");
      // The name, or a "-dle" name of our own ("handle" and "bundle" are fine).
      assert.doesNotMatch(text, /wordle|(hex|byte|word|0x)-?dle\b/i, path);
    }
  });
});

describe("both palettes", () => {
  it("define the same tokens", () => {
    assert.deepEqual(Object.keys(LIGHT_PALETTE).sort(), Object.keys(DARK_PALETTE).sort());
  });

  it("needs at least WCAG AA for normal text", () => {
    assert.equal(MIN_TEXT_CONTRAST, 4.5);
  });

  it("checks the three tile marks' text pairs, and the page's own text", () => {
    const pairs = TEXT_PAIRS.map(([text, background]) => `${text}/${background}`);
    for (const pair of ["onRight/right", "onWrong/wrong", "onAbsent/absent", "text/background", "text/panel"]) {
      assert.ok(pairs.includes(pair), pair);
    }
  });

  it("checks every dimmed key: unmarked, right, wrong and absent", () => {
    const backgrounds = DIMMED_KEY_PAIRS.map(([, background]) => background);
    assert.deepEqual(backgrounds, ["lockedKey", "lockedKeyRight", "lockedWrong", "keyAbsent"]);
  });

  for (const [name, palette] of Object.entries(PALETTES)) {
    for (const [text, background] of [...TEXT_PAIRS, ...DIMMED_KEY_PAIRS]) {
      const pair = `${name}:${text}/${background}`;
      const ratio = contrastRatio(palette[text], palette[background]);
      if (BELOW_MIN_CONTRAST.includes(pair)) {
        it(`${pair} is listed as under ${MIN_TEXT_CONTRAST}:1 for the owner (${ratio.toFixed(2)}:1)`, () => {
          assert.ok(ratio < MIN_TEXT_CONTRAST, `${ratio.toFixed(2)}:1 passes now: take it off BELOW_MIN_CONTRAST`);
        });
      } else {
        it(`${pair} has a contrast of at least ${MIN_TEXT_CONTRAST}:1`, () => {
          assert.ok(ratio >= MIN_TEXT_CONTRAST, `${ratio.toFixed(2)}:1`);
        });
      }
    }

    for (const [text, background] of LARGE_TEXT_PAIRS) {
      it(`${name}:${text}/${background}, as large text only, has a contrast of at least ${MIN_LARGE_TEXT_CONTRAST}:1`, () => {
        const ratio = contrastRatio(palette[text], palette[background]);
        assert.ok(ratio >= MIN_LARGE_TEXT_CONTRAST, `${ratio.toFixed(2)}:1`);
      });
    }
  }

  it("lists only real pairs as under the minimum, and only page 3's dimmed dark keys", () => {
    const pairs = Object.keys(PALETTES).flatMap((name) =>
      [...TEXT_PAIRS, ...DIMMED_KEY_PAIRS].map(([text, background]) => `${name}:${text}/${background}`),
    );
    for (const listed of BELOW_MIN_CONTRAST) {
      assert.ok(pairs.includes(listed), listed);
    }
    assert.deepEqual(BELOW_MIN_CONTRAST, [
      "dark:lockedKeyText/lockedKey",
      "dark:lockedKeyText/lockedKeyRight",
      "dark:lockedKeyText/keyAbsent",
    ]);
  });
});

describe("isLargeText", () => {
  it("is 24px and up at any weight", () => {
    assert.equal(isLargeText(24, 400), true);
    assert.equal(isLargeText(26, 400), true);
    assert.equal(isLargeText(23.9, 400), false);
  });

  it("is 18.66px and up when bold (700 or more)", () => {
    assert.equal(isLargeText(18.66, 700), true);
    assert.equal(isLargeText(20, 1000), true);
    assert.equal(isLargeText(18.6, 700), false);
    assert.equal(isLargeText(20, 600), false);
  });
});

/** `share` of `top` over `base`, per sRGB channel, rounded, as `#RRGGBB`. */
function mix(top: string, base: string, share: number): string {
  const channel = (colour: string, i: number): number => Number.parseInt(colour.slice(1 + 2 * i, 3 + 2 * i), 16);
  const channels = [0, 1, 2].map((i) => Math.round(channel(top, i) * share + channel(base, i) * (1 - share)));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
