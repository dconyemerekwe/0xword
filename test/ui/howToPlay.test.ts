import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wordToHex } from "../../src/game/hex.ts";
import { Mark } from "../../src/game/score.ts";
import {
  BACK_TO_GAME,
  CHEATSHEET_HEADING,
  CHEATSHEET_LINE,
  HOW_TO_PLAY,
  RULES,
  RULES_HEADING,
  cheatsheet,
  plainText,
} from "../../src/ui/howToPlay.ts";

describe("How to play: names and headings", () => {
  it('names the `?` button and the heading "How to play", and the back arrow "Back to game"', () => {
    assert.equal(HOW_TO_PLAY, "How to play");
    assert.equal(BACK_TO_GAME, "Back to game");
  });

  it("has the RULES and ASCII CHEATSHEET sections (drawn in capitals by the stylesheet)", () => {
    assert.equal(RULES_HEADING.toUpperCase(), "RULES");
    assert.equal(CHEATSHEET_HEADING.toUpperCase(), "ASCII CHEATSHEET");
  });
});

describe("How to play: RULES", () => {
  it("shows the six numbered rules exactly as on page 5", () => {
    assert.deepEqual(RULES.map(plainText), [
      "The hidden word has 4 letters, written as ASCII hex: 2 digits per letter.",
      "Guess 8 hex digits that spell a real 4-letter word.",
      "Each digit turns blue right spot, orange wrong spot, or grey not in the word.",
      "After each row you get one try to type the English word. Fewer rows is a better score.",
      "After 6 rows the hex locks and you get one final answer.",
      "Stuck? Turn on Hints to see the letters you have fully decoded so far.",
    ]);
  });

  it('shows "blue", "orange" and "grey" in rule 3 as chips in the right, wrong and absent colours', () => {
    const chips = (RULES[2] ?? []).filter((part) => part.style !== "plain");
    assert.deepEqual(chips, [
      { text: "blue", style: Mark.Right },
      { text: "orange", style: Mark.Wrong },
      { text: "grey", style: Mark.Absent },
    ]);
  });

  it('shows "Hints" in rule 6 in bold, and every other rule as plain text', () => {
    assert.deepEqual(
      (RULES[5] ?? []).filter((part) => part.style !== "plain"),
      [{ text: "Hints", style: "strong" }],
    );
    for (const i of [0, 1, 3, 4]) {
      assert.ok(RULES[i]?.every((part) => part.style === "plain"), `rule ${i + 1}`);
    }
  });
});

describe("How to play: ASCII CHEATSHEET", () => {
  it("shows the line about 4_ and 5_, with both in the hex style", () => {
    assert.equal(plainText(CHEATSHEET_LINE), "4_ is A–O, 5_ is P–Z. The second digit counts up from there.");
    assert.deepEqual(
      CHEATSHEET_LINE.filter((part) => part.style === "code").map((part) => part.text),
      ["4_", "5_"],
    );
  });

  it("has 26 cards from A 41 to Z 5A, each with the hex wordToHex gives its letter", () => {
    const cards = cheatsheet();
    assert.equal(cards.length, 26);
    assert.deepEqual(cards[0], { letter: "A", hex: "41", label: "A is 41" });
    assert.deepEqual(cards.at(-1), { letter: "Z", hex: "5A", label: "Z is 5A" });
    assert.equal(cards.map((card) => card.letter).join(""), "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    for (const card of cards) {
      assert.equal(card.hex, wordToHex(card.letter.repeat(4)).slice(0, 2), card.letter);
      assert.equal(card.label, `${card.letter} is ${card.hex}`);
    }
  });

  it("matches every card on page 5", () => {
    const expected =
      "A41 B42 C43 D44 E45 F46 G47 H48 I49 J4A K4B L4C M4D N4E O4F P50 Q51 R52 S53 T54 U55 V56 W57 X58 Y59 Z5A";
    assert.equal(cheatsheet().map((card) => card.letter + card.hex).join(" "), expected);
  });

  it("agrees with the line: 4_ is A–O and 5_ is P–Z", () => {
    const starting = (digit: string): string =>
      cheatsheet()
        .filter((card) => card.hex.startsWith(digit))
        .map((card) => card.letter)
        .join("");
    assert.equal(starting("4"), "ABCDEFGHIJKLMNO");
    assert.equal(starting("5"), "PQRSTUVWXYZ");
  });
});
