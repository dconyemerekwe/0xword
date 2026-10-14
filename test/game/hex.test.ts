import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hexToWord, wordToHex } from "../../src/game/hex.ts";

describe("wordToHex", () => {
  it("converts each letter to two uppercase hex digits", () => {
    assert.equal(wordToHex("BYTE"), "42595445");
    assert.equal(wordToHex("AZAZ"), "415A415A");
  });

  it("rejects anything that isn't four uppercase letters", () => {
    for (const bad of ["byte", "BYT", "BYTES", "BY E", "B1TE", ""]) {
      assert.throws(() => wordToHex(bad), RangeError, bad);
    }
  });
});

describe("hexToWord", () => {
  it("converts back, in either case", () => {
    assert.equal(hexToWord("42595445"), "BYTE");
    assert.equal(hexToWord("5a5a5a5a"), "ZZZZ");
  });

  it("round-trips with wordToHex", () => {
    assert.equal(hexToWord(wordToHex("QUIZ")), "QUIZ");
  });

  it("returns null for bytes outside 41–5A", () => {
    assert.equal(hexToWord("40595445"), null); // 40 is "@"
    assert.equal(hexToWord("425B5445"), null); // 5B is "["
    assert.equal(hexToWord("42796445"), null); // 79 is lowercase "y"
  });

  it("returns null for the wrong length or non-hex characters", () => {
    assert.equal(hexToWord("425954"), null);
    assert.equal(hexToWord("4259544500"), null);
    assert.equal(hexToWord("4259544G"), null);
  });
});
