import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORD_SET } from "./fixtures.ts";
import { wordToHex } from "./hex.ts";
import { MAX_ROWS, Round } from "./round.ts";

/** A round whose answer is BYTE (42 59 54 45). */
function newRound(): Round {
  return new Round("BYTE", WORD_SET);
}

/** Submits a word's hex and skips the answer try, leaving the round ready for the next row. */
function guessAndSkip(round: Round, word: string): void {
  assert.equal(round.submitGuess(wordToHex(word)).ok, true);
  round.skipAnswer();
}

describe("Round", () => {
  it("rejects an answer that isn't in the word list", () => {
    assert.throws(() => new Round("ZZZZ", WORD_SET));
  });

  it("scores a guess, then waits for the answer try", () => {
    const round = newRound();
    const outcome = round.submitGuess(wordToHex("TEAM"));
    assert.ok(outcome.ok);
    assert.equal(outcome.row.word, "TEAM");
    assert.equal(outcome.row.marks.length, 8);
    assert.equal(round.phase, "answer");
  });

  it("rejects an invalid guess without using a row", () => {
    const round = newRound();
    assert.deepEqual(round.submitGuess("5A5A5A5A"), { ok: false, error: "notWord" });
    assert.equal(round.rows.length, 0);
    assert.equal(round.phase, "guess");
  });

  it("solves on a correct answer", () => {
    const round = newRound();
    round.submitGuess(wordToHex("TEAM"));
    assert.deepEqual(round.submitAnswer(" byte "), { ok: true, correct: true });
    assert.equal(round.phase, "solved");
    assert.deepEqual(round.result(), {
      solved: true,
      answer: "BYTE",
      rowsUsed: 1,
      answerTries: 1,
      hintsUsed: false,
    });
  });

  it("goes back to guessing after a wrong answer", () => {
    const round = newRound();
    round.submitGuess(wordToHex("TEAM"));
    assert.deepEqual(round.submitAnswer("TEAM"), { ok: true, correct: false });
    assert.equal(round.phase, "guess");
  });

  it("rejects a malformed or unlisted answer without using the try", () => {
    const round = newRound();
    round.submitGuess(wordToHex("TEAM"));
    assert.deepEqual(round.submitAnswer("BYTES"), { ok: false, error: "format" });
    assert.deepEqual(round.submitAnswer("ZZZZ"), { ok: false, error: "notWord" });
    assert.equal(round.phase, "answer");
    assert.deepEqual(round.submitAnswer("BYTE"), { ok: true, correct: true });
    assert.equal(round.result().answerTries, 1);
  });

  it("allows only one answer try per row", () => {
    const round = newRound();
    round.submitGuess(wordToHex("TEAM"));
    round.submitAnswer("TEAM");
    assert.throws(() => round.submitAnswer("BYTE"), /phase "guess"/);
  });

  it("does not accept a guess while waiting for the answer try", () => {
    const round = newRound();
    round.submitGuess(wordToHex("TEAM"));
    assert.throws(() => round.submitGuess(wordToHex("BAKE")), /phase "answer"/);
  });

  describe("forced final answer", () => {
    function roundAtFinal(): Round {
      const round = newRound();
      for (const word of ["TEAM", "BAKE", "BUSY", "LIME", "QUIZ"]) {
        guessAndSkip(round, word);
      }
      round.submitGuess(wordToHex("ZONE"));
      return round;
    }

    it("locks the grid after 6 rows", () => {
      const round = roundAtFinal();
      assert.equal(round.rows.length, MAX_ROWS);
      assert.equal(round.phase, "final");
      assert.throws(() => round.submitGuess(wordToHex("BYTE")), /phase "final"/);
    });

    it("can't be skipped", () => {
      assert.throws(() => roundAtFinal().skipAnswer(), /phase "final"/);
    });

    it("solves when correct", () => {
      const round = roundAtFinal();
      round.submitAnswer("BYTE");
      assert.equal(round.result().solved, true);
      assert.equal(round.result().rowsUsed, 6);
    });

    it("fails when wrong", () => {
      const round = roundAtFinal();
      assert.deepEqual(round.submitAnswer("TEAM"), { ok: true, correct: false });
      assert.equal(round.phase, "failed");
      assert.deepEqual(round.result(), {
        solved: false,
        answer: "BYTE",
        rowsUsed: 6,
        answerTries: 1,
        hintsUsed: false,
      });
    });
  });

  describe("hints", () => {
    it("can't be read until enabled", () => {
      assert.throws(() => newRound().hintLetters(), /not enabled/);
    });

    it("shows a letter once both digits of its byte are in the right spot", () => {
      const round = newRound();
      round.enableHints();
      assert.deepEqual(round.hintLetters(), [null, null, null, null]);
      // BAKE = 42 41 4B 45: bytes 1 and 4 match BYTE exactly.
      guessAndSkip(round, "BAKE");
      assert.deepEqual(round.hintLetters(), ["B", null, null, "E"]);
    });

    it("combines digits found in different rows", () => {
      const round = newRound();
      round.enableHints();
      // BYTE's 2nd byte is 59. BUSY (55) finds the 5; LIME (49) finds the 9.
      guessAndSkip(round, "BUSY");
      assert.equal(round.hintLetters()[1], null);
      guessAndSkip(round, "LIME");
      assert.equal(round.hintLetters()[1], "Y");
    });

    it("records hints as used in the result", () => {
      const round = newRound();
      round.enableHints();
      round.submitGuess(wordToHex("TEAM"));
      round.submitAnswer("BYTE");
      assert.equal(round.result().hintsUsed, true);
    });

    it("can't be enabled after the round ends", () => {
      const round = newRound();
      round.submitGuess(wordToHex("TEAM"));
      round.submitAnswer("BYTE");
      assert.throws(() => round.enableHints(), /over/);
    });
  });

  it("has no result until the round is over", () => {
    assert.throws(() => newRound().result(), /not over/);
  });
});
