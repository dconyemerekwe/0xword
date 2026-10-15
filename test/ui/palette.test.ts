import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DARK_PALETTE,
  MIN_TEXT_CONTRAST,
  LARGE_TEXT_PAIRS,
  MIN_LARGE_TEXT_CONTRAST,
  TEXT_PAIRS,
  isLargeText,
  contrastRatio,
  relativeLuminance,
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

  for (const [text, background] of TEXT_PAIRS) {
    it(`${text} on ${background} has a contrast of at least ${MIN_TEXT_CONTRAST}:1`, () => {
      const ratio = contrastRatio(DARK_PALETTE[text], DARK_PALETTE[background]);
      assert.ok(ratio >= MIN_TEXT_CONTRAST, `${ratio.toFixed(2)}:1`);
    });
  }

  it("checks the mark colours' text pairs", () => {
    const pairs = TEXT_PAIRS.map(([text, background]) => `${text}/${background}`);
    for (const pair of ["onRight/right", "onWrong/wrong", "onAbsent/absent", "text/background", "text/panel"]) {
      assert.ok(pairs.includes(pair), pair);
    }
  });

  it("needs at least WCAG AA for normal text", () => {
    assert.equal(MIN_TEXT_CONTRAST, 4.5);
  });

  for (const [text, background] of LARGE_TEXT_PAIRS) {
    it(`${text} on ${background}, as large text only, has a contrast of at least ${MIN_LARGE_TEXT_CONTRAST}:1`, () => {
      const ratio = contrastRatio(DARK_PALETTE[text], DARK_PALETTE[background]);
      assert.ok(ratio >= MIN_LARGE_TEXT_CONTRAST, `${ratio.toFixed(2)}:1`);
    });
  }

  it("needs at least WCAG AA for large text, and only puts the design's blue title there", () => {
    assert.equal(MIN_LARGE_TEXT_CONTRAST, 3);
    assert.deepEqual(LARGE_TEXT_PAIRS, [["right", "background"]]);
    // About 3.9:1: fine for large text, too low for normal text.
    const ratio = contrastRatio(DARK_PALETTE.right, DARK_PALETTE.background);
    assert.ok(ratio >= 3 && ratio < 4.5, ratio.toFixed(2));
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
