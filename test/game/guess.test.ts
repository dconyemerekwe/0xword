import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkGuess } from "../../src/game/guess.ts";

const words: ReadonlySet<string> = new Set(["BYTE", "TEAM"]);

describe("checkGuess", () => {
  it("accepts a valid guess and returns the uppercased hex and word", () => {
    assert.deepEqual(checkGuess("5445414d", words), { ok: true, hex: "5445414D", word: "TEAM" });
  });

  it("rejects the wrong length", () => {
    assert.deepEqual(checkGuess("425954", words), { ok: false, error: "length" });
    assert.deepEqual(checkGuess("", words), { ok: false, error: "length" });
  });

  it("rejects non-hex characters", () => {
    assert.deepEqual(checkGuess("4259544G", words), { ok: false, error: "notHex" });
  });

  it("rejects bytes that aren't capital letters", () => {
    assert.deepEqual(checkGuess("42595430", words), { ok: false, error: "notLetter" }); // 30 is "0"
  });

  it("rejects letters that don't form a listed word", () => {
    assert.deepEqual(checkGuess("5A5A5A5A", words), { ok: false, error: "notWord" }); // ZZZZ
  });
});
