import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORDS } from "./fixtures.ts";
import { hexToWord, wordToHex } from "../../src/game/hex.ts";
import { WORD_LIST_SIZE, parseWordList, pickAnswer } from "../../src/game/words.ts";

describe("bundled word list", () => {
  it("parses, and every word survives a hex round trip", () => {
    assert.ok(WORDS.length > 1000);
    for (const word of WORDS) {
      assert.equal(hexToWord(wordToHex(word)), word);
    }
  });

  it("holds exactly WORD_LIST_SIZE words, the count the host checks answer tries against", () => {
    assert.equal(WORDS.length, WORD_LIST_SIZE);
  });

  it("is sorted, so diffs stay readable", () => {
    assert.deepEqual(WORDS, [...WORDS].sort());
  });
});

describe("parseWordList", () => {
  it("ignores blank lines and CRLF endings", () => {
    assert.deepEqual(parseWordList("BYTE\r\n\r\nTEAM\n"), ["BYTE", "TEAM"]);
  });

  it("rejects bad words, duplicates and an empty list", () => {
    assert.throws(() => parseWordList("BYTE\nbyte\n"), /Invalid word/);
    assert.throws(() => parseWordList("BYTES\n"), /Invalid word/);
    assert.throws(() => parseWordList("BYTE\nBYTE\n"), /Duplicate word/);
    assert.throws(() => parseWordList("\n\n"), /empty/);
  });
});

describe("pickAnswer", () => {
  const words = ["BYTE", "TEAM", "QUIZ"];

  it("uses the random function to choose", () => {
    assert.equal(pickAnswer(words, () => 0), "BYTE");
    assert.equal(pickAnswer(words, () => 0.5), "TEAM");
    assert.equal(pickAnswer(words, () => 0.999999), "QUIZ");
  });

  it("stays in range even if random returns 1", () => {
    assert.equal(pickAnswer(words, () => 1), "QUIZ");
  });

  it("returns a listed word with the default Math.random", () => {
    assert.ok(words.includes(pickAnswer(words)));
  });

  it("rejects an empty list", () => {
    assert.throws(() => pickAnswer([]));
  });
});
