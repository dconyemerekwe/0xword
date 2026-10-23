import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORD_SET } from "./fixtures.ts";
import { wordToHex } from "../../src/game/hex.ts";
import { MAX_HINTS, MAX_ROWS, Round } from "../../src/game/round.ts";

/** A round whose answer is BYTE (42 59 54 45). */
function newRound(): Round {
  return new Round("BYTE", WORD_SET);
}

/** Scores a word's hex as the next row. `word` must be listed. */
function guess(round: Round, word: string): void {
  assert.equal(round.submitGuess(wordToHex(word)).ok, true);
}

/**
 * Submits a word's hex, then tries that same (wrong) word. `word` must not
 * be BYTE. Before row 6 this leaves the round waiting for the next row.
 */
function guessAndMiss(round: Round, word: string): void {
  guess(round, word);
  assert.deepEqual(round.submitAnswer(word), { ok: true, correct: false });
}

/** Six different listed words that aren't BYTE, one per row: rows and words can't repeat in a round. */
const SIX = ["TEAM", "BAKE", "BUSY", "LIME", "QUIZ", "ZONE"] as const;

/** The first `n` of SIX, each guessed as a row and then tried as a wrong word. */
function missRows(round: Round, n: number): void {
  for (const word of SIX.slice(0, n)) {
    guessAndMiss(round, word);
  }
}

/** Scores the first `n` of SIX as rows, with no word tried. */
function guessRows(round: Round, n: number): void {
  for (const word of SIX.slice(0, n)) {
    guess(round, word);
  }
}

/** A round with all six rows scored and no word tried: the final answer is due. */
function roundAtFinal(): Round {
  const round = newRound();
  guessRows(round, MAX_ROWS);
  return round;
}

describe("Round", () => {
  it("rejects an answer that isn't in the word list", () => {
    assert.throws(() => new Round("ZZZZ", WORD_SET));
  });

  it("scores a guess and keeps waiting for hex rows", () => {
    const round = newRound();
    const outcome = round.submitGuess(wordToHex("TEAM"));
    assert.ok(outcome.ok);
    assert.equal(outcome.row.word, "TEAM");
    assert.equal(outcome.row.marks.length, 8);
    assert.equal(round.phase, "guess");
  });

  it("rejects an invalid guess without using a row", () => {
    const round = newRound();
    assert.deepEqual(round.submitGuess("5A5A5A5A"), { ok: false, error: "notWord" });
    assert.equal(round.rows.length, 0);
    assert.equal(round.phase, "guess");
  });

  describe("hex rows without word attempts", () => {
    it("scores rows 1 to 5 one after another, with no word attempt between them", () => {
      const round = newRound();
      for (const [i, word] of ["TEAM", "BAKE", "BUSY", "LIME", "QUIZ"].entries()) {
        guess(round, word);
        assert.equal(round.rows.length, i + 1);
        assert.equal(round.phase, "guess", `after row ${i + 1}`);
      }
      assert.deepEqual(round.answers, []);
    });

    it("locks the hex after row 6, the last row, even with no word tried", () => {
      const round = roundAtFinal();
      assert.equal(round.rows.length, MAX_ROWS);
      assert.equal(round.phase, "final");
      assert.throws(() => round.submitGuess(wordToHex("BYTE")), /phase "final"/);
    });

    it("doesn't win on an all-right hex row alone", () => {
      const round = newRound();
      const outcome = round.submitGuess(wordToHex("BYTE"));
      assert.ok(outcome.ok);
      assert.ok(outcome.row.marks.every((mark) => mark === "right"));
      assert.equal(round.phase, "guess");
      assert.equal(round.isOver, false);
    });

    it("has no way to skip: there is nothing to skip", () => {
      assert.equal("skipAnswer" in newRound(), false);
    });
  });

  describe("decoding the word", () => {
    it("can't decode before the first row is scored", () => {
      const round = newRound();
      assert.equal(round.canDecode, false);
      assert.throws(() => round.submitAnswer("BYTE"), /phase "guess" with 0 rows/);
      assert.deepEqual(round.answers, []);
    });

    it("can decode once a row is scored, until the round is over", () => {
      const round = newRound();
      guess(round, "TEAM");
      assert.equal(round.canDecode, true);
      round.submitAnswer("BYTE");
      assert.equal(round.canDecode, false);
      assert.throws(() => round.submitAnswer("BYTE"), /phase "solved"/);
    });

    it("solves on a correct answer after row 1, in any letter case", () => {
      const round = newRound();
      guess(round, "TEAM");
      assert.deepEqual(round.submitAnswer(" byte "), { ok: true, correct: true });
      assert.equal(round.phase, "solved");
      assert.deepEqual(round.result(), {
        solved: true,
        answer: "BYTE",
        rowsUsed: 1,
        answerTries: 1,
        hintsUsed: 0,
      });
    });

    for (let rows = 1; rows < MAX_ROWS; rows++) {
      it(`solves with rows left: after row ${rows}`, () => {
        const round = newRound();
        guessRows(round, rows);
        assert.deepEqual(round.submitAnswer("Byte"), { ok: true, correct: true });
        assert.equal(round.result().rowsUsed, rows);
        assert.equal(round.result().answerTries, 1);
      });
    }

    it("keeps guessing hex after a wrong listed word, with no row used", () => {
      const round = newRound();
      guess(round, "TEAM");
      assert.deepEqual(round.submitAnswer("TEAM"), { ok: true, correct: false });
      assert.equal(round.phase, "guess");
      assert.equal(round.rows.length, 1);
      guess(round, "BAKE");
      assert.equal(round.rows.length, 2);
    });

    it("takes any number of different wrong words between rows", () => {
      const round = newRound();
      guess(round, "TEAM");
      for (const word of ["TEAM", "CODE", "DATA", "BEAT"]) {
        assert.deepEqual(round.submitAnswer(word), { ok: true, correct: false });
      }
      assert.equal(round.phase, "guess");
      assert.deepEqual(round.answers, ["TEAM", "CODE", "DATA", "BEAT"]);
      round.submitAnswer("BYTE");
      assert.equal(round.result().answerTries, 5);
      assert.equal(round.result().rowsUsed, 1);
    });

    it("takes every wrong word in the list, then the answer: the most tries a round can have", () => {
      const round = newRound();
      guess(round, "TEAM");
      for (const word of WORD_SET) {
        if (word !== "BYTE") {
          assert.equal(round.submitAnswer(word).ok, true, word);
        }
      }
      round.submitAnswer("BYTE");
      assert.equal(round.result().answerTries, WORD_SET.size);
    });

    it("rejects a word already tried, in any letter case, without counting it or changing the phase", () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("BEAT");
      const before = round.toState();
      for (const input of ["BEAT", "beat", " Beat "]) {
        assert.deepEqual(round.submitAnswer(input), { ok: false, error: "repeat" }, input);
      }
      assert.deepEqual(round.toState(), before);
      assert.deepEqual(round.answers, ["BEAT"]);
    });

    it("rejects a hex row already scored, without using a row", () => {
      const round = newRound();
      guess(round, "TEAM");
      const before = round.toState();
      for (const input of [wordToHex("TEAM"), wordToHex("TEAM").toLowerCase()]) {
        assert.deepEqual(round.submitGuess(input), { ok: false, error: "repeat" }, input);
      }
      assert.deepEqual(round.toState(), before);
      assert.equal(round.rows.length, 1);
    });

    it("runs the invalid-guess checks before the repeat check, for rows and words (#34)", () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("BEAT");
      const hex = wordToHex("TEAM");
      // Each is the repeat with something wrong added, so the existing error wins.
      assert.deepEqual(round.submitGuess(hex.slice(0, -1)), { ok: false, error: "length" });
      assert.deepEqual(round.submitGuess(`${hex.slice(0, -1)}G`), { ok: false, error: "notHex" });
      assert.deepEqual(round.submitAnswer("BEATS"), { ok: false, error: "format" });
      assert.deepEqual(round.submitAnswer("BE4T"), { ok: false, error: "format" });
      assert.equal(round.rows.length, 1);
      assert.deepEqual(round.answers, ["BEAT"]);
    });

    it("says why a row or word would be rejected, without changing anything (#34)", () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("BEAT");
      const before = round.toState();
      assert.equal(round.rowError(wordToHex("TEAM")), "repeat");
      assert.equal(round.rowError(wordToHex("TEAM").toLowerCase()), "repeat");
      assert.equal(round.rowError(""), "length");
      assert.equal(round.rowError("7B7B7B7B"), "notLetter");
      assert.equal(round.rowError(wordToHex("ZZZZ")), "notWord");
      assert.equal(round.rowError(wordToHex("BEAT")), null, "a word tried may still be a row");
      assert.equal(round.answerError(" beat "), "repeat");
      assert.equal(round.answerError(""), "format");
      assert.equal(round.answerError("ZZZZ"), "notWord");
      assert.equal(round.answerError("TEAM"), null, "a row may still be tried as a word");
      assert.equal(round.answerError("BYTE"), null);
      assert.deepEqual(round.toState(), before);
    });

    it("agrees with submitGuess and submitAnswer at the final answer and once the round is over (#34)", () => {
      const round = newRound();
      missRows(round, 1);
      for (const word of SIX.slice(1)) {
        guess(round, word);
      }
      assert.equal(round.phase, "final");
      assert.equal(round.answerError("team"), "repeat");
      assert.deepEqual(round.submitAnswer("team"), { ok: false, error: "repeat" });
      assert.equal(round.rowError(wordToHex("BAKE")), "repeat", "doesn't check the phase");
      round.submitAnswer("BYTE");
      assert.equal(round.answerError("TEAM"), "repeat", "doesn't check the phase");
    });

    it("keeps hex rows and words apart: a word tried may still be guessed as a row, and back", () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("BEAT");
      guess(round, "BEAT");
      assert.deepEqual(round.submitAnswer("TEAM"), { ok: true, correct: false });
      assert.equal(round.rows.length, 2);
    });

    it("rejects a malformed or unlisted answer without counting it or changing the phase", () => {
      const round = newRound();
      guess(round, "TEAM");
      const before = round.toState();
      for (const input of ["", "BYT", "BYTES", "B4TE", "ZZZZ", "qxzj"]) {
        assert.equal(round.submitAnswer(input).ok, false, input);
      }
      assert.deepEqual(round.submitAnswer("BYTES"), { ok: false, error: "format" });
      assert.deepEqual(round.submitAnswer("ZZZZ"), { ok: false, error: "notWord" });
      assert.deepEqual(round.toState(), before);
      assert.deepEqual(round.submitAnswer("BYTE"), { ok: true, correct: true });
      // Only the accepted answer is recorded as a try.
      assert.deepEqual(round.answers, ["BYTE"]);
    });

    it("counts a wrong answer try as an answer try", () => {
      const round = newRound();
      guessAndMiss(round, "TEAM");
      guess(round, "BAKE");
      round.submitAnswer("BYTE");
      assert.deepEqual(round.result(), {
        solved: true,
        answer: "BYTE",
        rowsUsed: 2,
        answerTries: 2,
        hintsUsed: 0,
      });
      assert.deepEqual(round.toState().answers, ["TEAM", "BYTE"]);
    });

    it("lists the accepted answer tries, uppercased, without the rejected ones", () => {
      const round = newRound();
      assert.deepEqual(round.answers, []);
      guess(round, "TEAM");
      assert.deepEqual(round.submitAnswer("ZZZZ"), { ok: false, error: "notWord" });
      assert.deepEqual(round.answers, []);
      round.submitAnswer(" team ");
      assert.deepEqual(round.answers, ["TEAM"]);
    });
  });

  describe("forced final answer", () => {
    it("keeps waiting for the final answer after a rejected one", () => {
      const round = roundAtFinal();
      assert.deepEqual(round.submitAnswer("ZZZZ"), { ok: false, error: "notWord" });
      assert.deepEqual(round.submitAnswer("BYTES"), { ok: false, error: "format" });
      assert.equal(round.phase, "final");
      assert.equal(round.isOver, false);
      assert.deepEqual(round.answers, []);
    });

    it("solves when correct", () => {
      const round = roundAtFinal();
      round.submitAnswer("BYTE");
      assert.equal(round.result().solved, true);
      assert.equal(round.result().rowsUsed, MAX_ROWS);
      assert.equal(round.result().answerTries, 1);
    });

    it("fails when wrong, with one answer try if no word was tried before", () => {
      const round = roundAtFinal();
      assert.deepEqual(round.submitAnswer("TEAM"), { ok: true, correct: false });
      assert.equal(round.phase, "failed");
      assert.deepEqual(round.result(), {
        solved: false,
        answer: "BYTE",
        rowsUsed: MAX_ROWS,
        answerTries: 1,
        hintsUsed: 0,
      });
    });

    it("counts the earlier wrong words in a failed round's answer tries", () => {
      const round = newRound();
      missRows(round, MAX_ROWS);
      assert.equal(round.phase, "failed");
      assert.equal(round.result().answerTries, MAX_ROWS);
    });

    it("rejects an earlier wrong word as the final answer instead of failing the round", () => {
      const round = newRound();
      missRows(round, MAX_ROWS - 1);
      guess(round, SIX[5]);
      assert.equal(round.phase, "final");
      assert.deepEqual(round.submitAnswer("team"), { ok: false, error: "repeat" });
      assert.equal(round.phase, "final");
      assert.equal(round.answers.length, MAX_ROWS - 1);
      assert.deepEqual(round.submitAnswer("BYTE"), { ok: true, correct: true });
    });

    it("fails with every word but the answer tried: the most tries a failed round can have", () => {
      const round = newRound();
      const wrong = [...WORD_SET].filter((word) => word !== "BYTE");
      guess(round, SIX[0]);
      for (const word of wrong.slice(0, -1)) {
        assert.equal(round.submitAnswer(word).ok, true, word);
      }
      for (const word of SIX.slice(1)) {
        guess(round, word);
      }
      assert.equal(round.phase, "final", "nothing ended the round early");
      round.submitAnswer(wrong.at(-1) ?? "");
      assert.equal(round.phase, "failed");
      assert.equal(round.result().answerTries, WORD_SET.size - 1);
    });
  });

  describe("every sequence of rows and optional word attempts ends in solved or failed", () => {
    // Before each of rows 2 to 6 the player tries 0, 1 or 2 new wrong words
    // (3^5 = 243 ways), and repeats each one (rejected), then gives a right
    // or wrong final answer.
    const pool = [...WORD_SET].filter((word) => word !== "BYTE" && word !== "DATA");
    it("ends every one of 486 rounds, solved or failed as the final answer says", () => {
      let rounds = 0;
      for (let pattern = 0; pattern < 3 ** (MAX_ROWS - 1); pattern++) {
        for (const finalRight of [false, true]) {
          const round = newRound();
          let tries = 0;
          let rest = pattern;
          guess(round, SIX[0]);
          for (let row = 2; row <= MAX_ROWS; row++) {
            const wrong = rest % 3;
            rest = Math.floor(rest / 3);
            for (let i = 0; i < wrong; i++) {
              const word = pool[tries] ?? "";
              assert.deepEqual(round.submitAnswer(word), { ok: true, correct: false });
              assert.deepEqual(round.submitAnswer(word), { ok: false, error: "repeat" });
              tries++;
            }
            assert.equal(round.phase, "guess");
            guess(round, SIX[row - 1] ?? "");
          }
          assert.equal(round.phase, "final");
          round.submitAnswer(finalRight ? "BYTE" : "DATA");
          assert.equal(round.isOver, true);
          assert.equal(round.phase, finalRight ? "solved" : "failed");
          assert.equal(round.result().answerTries, tries + 1);
          assert.equal(round.result().rowsUsed, MAX_ROWS);
          rounds++;
        }
      }
      assert.equal(rounds, 486);
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
      guess(round, "BAKE");
      round.enableHints();
      assert.deepEqual(round.hintLetters(), ["B", null, null, "E"]);
    });

    it("combines digits found in different rows", () => {
      const round = newRound();
      // BYTE's 2nd byte is 59. BUSY (55) finds the 5; LIME (49) finds the 9.
      guess(round, "BUSY");
      round.enableHints();
      assert.equal(round.hintLetters()[1], null);
      guess(round, "LIME");
      round.enableHints();
      assert.equal(round.hintLetters()[1], "Y");
    });

    it("counts hints in the result", () => {
      const round = newRound();
      round.enableHints();
      guess(round, "TEAM");
      round.submitAnswer("BYTE");
      assert.equal(round.result().hintsUsed, 1);
    });

    it("can't be enabled after the round ends", () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("BYTE");
      assert.throws(() => round.enableHints(), /over/);
    });
  });

  describe("hints on and off", () => {
    it("starts off, with no hints counted", () => {
      const round = newRound();
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 0);
    });

    it("turns on, and counts one hint", () => {
      const round = newRound();
      round.enableHints();
      assert.equal(round.hintsShown, true);
      assert.equal(round.hintsUsed, 1);
    });

    it("turns off again, keeping the hint counted", () => {
      const round = newRound();
      round.enableHints();
      round.disableHints();
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 1);
    });

    it("can't be read once turned off again", () => {
      const round = newRound();
      round.enableHints();
      round.disableHints();
      assert.throws(() => round.hintLetters(), /not enabled/);
    });

    it("turning off before ever turning on counts no hint", () => {
      const round = newRound();
      round.disableHints();
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 0);
    });

    it("toggles any number of times, with no limit", () => {
      const round = newRound();
      for (let i = 0; i < 100; i++) {
        round.enableHints();
        assert.equal(round.hintsShown, true);
        round.disableHints();
        assert.equal(round.hintsShown, false);
      }
      round.enableHints();
      assert.deepEqual(round.hintLetters(), [null, null, null, null]);
    });

    it("toggles between rows, without changing the phase or the tries", () => {
      const round = newRound();
      guess(round, "BAKE");
      round.enableHints();
      assert.deepEqual(round.hintLetters(), ["B", null, null, "E"]);
      round.disableHints();
      assert.equal(round.phase, "guess");
      assert.deepEqual(round.answers, []);
    });

    it("toggles at the forced final answer", () => {
      const round = newRound();
      guessRows(round, MAX_ROWS - 1);
      guess(round, "BITE");
      assert.equal(round.phase, "final");
      round.enableHints();
      // BITE = 42 49 54 45: bytes 1, 3 and 4 match BYTE exactly (and BUSY
      // and LIME, among the earlier rows, find byte 2's 5 and 9).
      assert.deepEqual(round.hintLetters(), ["B", "Y", "T", "E"]);
      round.disableHints();
      round.enableHints();
      assert.equal(round.phase, "final");
    });

    it("can't be turned off after the round ends", () => {
      const round = newRound();
      round.enableHints();
      guess(round, "TEAM");
      round.submitAnswer("BYTE");
      assert.throws(() => round.disableHints(), /over/);
    });

    it("counts 0 hints in the result if never turned on", () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("BYTE");
      assert.equal(round.result().hintsUsed, 0);
    });

    it("saves the count, the toggle and whether the current row is counted, and nothing else about hints", () => {
      const round = newRound();
      round.enableHints();
      round.disableHints();
      round.enableHints();
      const state = round.toState();
      assert.equal(state.hintsUsed, 1);
      assert.equal(state.hintsShown, true);
      assert.equal(state.rowHinted, true);
      assert.deepEqual(
        Object.keys(state).filter((key) => /hint/i.test(key)),
        ["hintsUsed", "hintsShown", "rowHinted"],
      );
    });
  });

  describe("hint count (#38)", () => {
    it("starts each round with Hints off for the first row", () => {
      const round = newRound();
      assert.equal(round.hintsShown, false);
      guess(round, "TEAM");
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 0);
    });

    it("turns Hints off when a row is scored with Hints on, keeping the count", () => {
      const round = newRound();
      round.enableHints();
      guess(round, "TEAM");
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 1);
      assert.throws(() => round.hintLetters(), /not enabled/);
      assert.equal(round.toState().rowHinted, false);
    });

    it("turns Hints off after a scored row that is a real word but not the answer, and after an all-right row", () => {
      const round = newRound();
      round.enableHints();
      guess(round, "BAKE");
      assert.equal(round.hintsShown, false);
      round.enableHints();
      guess(round, "BYTE");
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 2);
    });

    const rejected: readonly (readonly [string, string])[] = [
      ["too short", "4259"],
      ["not hex", "4259544G"],
      ["not letters", "30313233"],
      ["not a listed word", "5A5A5A5A"],
    ];
    for (const [name, input] of rejected) {
      it(`keeps Hints on after a rejected row (${name}), and still counts one hint for the row`, () => {
        const round = newRound();
        round.enableHints();
        assert.equal(round.submitGuess(input).ok, false);
        assert.equal(round.hintsShown, true);
        assert.equal(round.hintsUsed, 1);
        guess(round, "TEAM");
        assert.equal(round.hintsUsed, 1);
      });
    }

    it("keeps Hints on after a repeated row, which doesn't end the row's stretch either", () => {
      const round = newRound();
      guess(round, "TEAM");
      round.enableHints();
      assert.deepEqual(round.submitGuess(wordToHex("TEAM")), { ok: false, error: "repeat" });
      assert.equal(round.hintsShown, true);
      round.disableHints();
      round.enableHints();
      assert.equal(round.hintsUsed, 1);
    });

    it("counts one hint for a row however often Hints is turned on and off before ENTER", () => {
      const round = newRound();
      round.enableHints();
      round.disableHints();
      round.enableHints();
      round.enableHints();
      round.disableHints();
      round.enableHints();
      assert.equal(round.hintsUsed, 1);
      guess(round, "TEAM");
      assert.equal(round.hintsUsed, 1);
    });

    it("counts a row whose Hints was turned on and off again before ENTER", () => {
      const round = newRound();
      round.enableHints();
      round.disableHints();
      guess(round, "TEAM");
      assert.equal(round.hintsUsed, 1);
      round.enableHints();
      assert.equal(round.hintsUsed, 2);
    });

    it("counts again for the next row, once Hints is pressed again", () => {
      const round = newRound();
      round.enableHints();
      guess(round, "TEAM");
      assert.equal(round.hintsUsed, 1);
      guess(round, "BAKE");
      assert.equal(round.hintsUsed, 1);
      round.enableHints();
      assert.equal(round.hintsUsed, 2);
    });

    it("counts a word attempt between rows as part of the row's stretch, not a new one", () => {
      const round = newRound();
      guess(round, "TEAM");
      round.enableHints();
      assert.deepEqual(round.submitAnswer("BEAT"), { ok: true, correct: false });
      assert.equal(round.hintsShown, true);
      round.disableHints();
      round.enableHints();
      assert.equal(round.hintsUsed, 1);
    });

    it("counts Hints at the forced final answer once, after one per row: 7 at most", () => {
      const round = newRound();
      for (const word of SIX) {
        round.enableHints();
        guess(round, word);
      }
      assert.equal(round.hintsUsed, MAX_ROWS);
      assert.equal(round.phase, "final");
      round.enableHints();
      round.disableHints();
      round.enableHints();
      assert.equal(round.hintsUsed, MAX_ROWS + 1);
      round.submitAnswer("CODE");
      assert.equal(round.phase, "failed");
      assert.equal(round.result().hintsUsed, MAX_HINTS);
      assert.equal(MAX_HINTS, 7);
    });

    it("counts Hints turned on after the last row and kept on to solve the round", () => {
      const round = newRound();
      guess(round, "BAKE");
      round.enableHints();
      round.submitAnswer("BYTE");
      assert.equal(round.result().hintsUsed, 1);
    });

    it("counts at most rowsUsed + 1 hints when the round is solved early", () => {
      for (let rows = 1; rows <= MAX_ROWS; rows++) {
        const round = newRound();
        for (const word of SIX.slice(0, rows)) {
          round.enableHints();
          guess(round, word);
        }
        round.enableHints();
        round.submitAnswer("BYTE");
        assert.equal(round.result().hintsUsed, rows + 1, `solved after row ${rows}`);
      }
    });

    it("only ever grows: no action lowers the count", () => {
      const round = newRound();
      let last = 0;
      const check = (): void => {
        assert.ok(round.hintsUsed >= last);
        last = round.hintsUsed;
      };
      round.enableHints();
      check();
      round.disableHints();
      check();
      round.submitGuess("5A5A5A5A");
      check();
      guess(round, "TEAM");
      check();
      round.submitAnswer("BEAT");
      check();
      round.enableHints();
      check();
      round.submitAnswer("BYTE");
      check();
      assert.equal(last, 2);
    });
  });

  it("has no result until the round is over", () => {
    assert.throws(() => newRound().result(), /not over/);
  });
});

/** Plays a BYTE round to each phase; the name says where it stops. */
const PHASES: readonly (readonly [string, () => Round])[] = [
  ["guess, before the first row", () => newRound()],
  [
    "guess, two rows and two wrong words",
    () => {
      const round = newRound();
      guessAndMiss(round, "TEAM");
      guess(round, "CODE");
      round.submitAnswer("data");
      return round;
    },
  ],
  [
    "guess, two rows and one wrong word between them",
    () => {
      const round = newRound();
      guessAndMiss(round, "TEAM");
      guess(round, "CODE");
      return round;
    },
  ],
  [
    "final, after wrong words",
    () => {
      const round = newRound();
      missRows(round, MAX_ROWS - 1);
      guess(round, "BITE");
      return round;
    },
  ],
  [
    "solved",
    () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("BYTE");
      return round;
    },
  ],
  [
    "failed, a wrong word after every row",
    () => {
      const round = newRound();
      missRows(round, MAX_ROWS);
      return round;
    },
  ],
  [
    "guess, one row and no word tried",
    () => {
      const round = newRound();
      guess(round, "TEAM");
      return round;
    },
  ],
  [
    "guess, three rows and no word tried",
    () => {
      const round = newRound();
      for (const word of ["TEAM", "CODE", "BAKE"]) {
        guess(round, word);
      }
      return round;
    },
  ],
  [
    "guess, many wrong words after one row, with rejected repeats",
    () => {
      const round = newRound();
      guess(round, "TEAM");
      for (const word of ["CODE", "CODE", "DATA", "TEAM", "BEAT", "BEST", "SAFE", "MILK", "data"]) {
        round.submitAnswer(word);
      }
      return round;
    },
  ],
  ["final, no word ever tried", () => roundAtFinal()],
  [
    "solved with rows left, after wrong words",
    () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("CODE");
      round.submitAnswer("DATA");
      guess(round, "BAKE");
      guess(round, "BUSY");
      round.submitAnswer("BYTE");
      return round;
    },
  ],
  [
    "solved at the final answer, no word tried before",
    () => {
      const round = roundAtFinal();
      round.submitAnswer("BYTE");
      return round;
    },
  ],
  [
    "failed, only the final answer tried",
    () => {
      const round = roundAtFinal();
      round.submitAnswer("TEAM");
      return round;
    },
  ],
  [
    "guess, Hints on for row 1, so turned off by it",
    () => {
      const round = newRound();
      round.enableHints();
      guess(round, "BITE");
      return round;
    },
  ],
  [
    "solved, Hints on for row 1",
    () => {
      const round = newRound();
      round.enableHints();
      guess(round, "BITE");
      round.submitAnswer("BYTE");
      return round;
    },
  ],
  [
    "failed, Hints on for row 1",
    () => {
      const round = newRound();
      round.enableHints();
      missRows(round, MAX_ROWS - 1);
      guess(round, "BITE");
      round.submitAnswer("CODE");
      return round;
    },
  ],
  [
    "guess, Hints on for row 1, then turned off again with no effect",
    () => {
      const round = newRound();
      round.enableHints();
      guessAndMiss(round, "BITE");
      round.disableHints();
      return round;
    },
  ],
  [
    "final, with hints on",
    () => {
      const round = newRound();
      missRows(round, MAX_ROWS - 1);
      guess(round, "BITE");
      round.enableHints();
      return round;
    },
  ],
  [
    "solved, Hints turned on and off again before row 1",
    () => {
      const round = newRound();
      round.enableHints();
      round.disableHints();
      guess(round, "BITE");
      round.submitAnswer("BYTE");
      return round;
    },
  ],
  [
    "guess, Hints on now, after a row scored with Hints on (2 hints)",
    () => {
      const round = newRound();
      round.enableHints();
      guess(round, "TEAM");
      round.enableHints();
      return round;
    },
  ],
  [
    "guess, Hints turned on and off again for the row being typed",
    () => {
      const round = newRound();
      guess(round, "TEAM");
      round.enableHints();
      round.disableHints();
      return round;
    },
  ],
  [
    "guess, Hints on before row 1, kept on by a rejected row",
    () => {
      const round = newRound();
      round.enableHints();
      assert.equal(round.submitGuess("5A5A5A5A").ok, false);
      return round;
    },
  ],
  [
    "guess, Hints for rows 2 and 4 only",
    () => {
      const round = newRound();
      guess(round, "TEAM");
      round.enableHints();
      guess(round, "BAKE");
      guess(round, "BUSY");
      round.enableHints();
      guess(round, "LIME");
      return round;
    },
  ],
  [
    "failed, Hints for every row and the final answer (MAX_HINTS)",
    () => {
      const round = newRound();
      for (const word of SIX) {
        round.enableHints();
        guess(round, word);
      }
      round.enableHints();
      round.submitAnswer("CODE");
      return round;
    },
  ],
  [
    "solved, Hints on at the decode that solved it",
    () => {
      const round = newRound();
      guess(round, "TEAM");
      round.submitAnswer("BEAT");
      round.enableHints();
      round.submitAnswer("BYTE");
      return round;
    },
  ],
  [
    "solved at the final answer, Hints turned on and off again after row 6",
    () => {
      const round = roundAtFinal();
      round.enableHints();
      round.disableHints();
      round.submitAnswer("BYTE");
      return round;
    },
  ],
];

/** Plays the round for the phase at `index` in PHASES. */
function playTo(index: number): Round {
  const play = PHASES[index]?.[1];
  assert.ok(play);
  return play();
}

/** Saved state as it comes back from storage: plain JSON data. */
function stored(round: Round): Record<string, unknown> {
  return JSON.parse(JSON.stringify(round.toState())) as Record<string, unknown>;
}

/** Saved state of the round in PHASES[2] (rows TEAM, CODE; Tried TEAM) with one change. */
function tampered(change: (state: Record<string, unknown>) => void): Record<string, unknown> {
  const state = stored(playTo(2));
  change(state);
  return state;
}

/** The saved rows, to tamper with. */
function rowsOf(state: Record<string, unknown>): Record<string, unknown>[] {
  return state.rows as Record<string, unknown>[];
}

function firstRow(state: Record<string, unknown>): Record<string, unknown> {
  const row = rowsOf(state)[0];
  assert.ok(row);
  return row;
}

describe("Round state", () => {
  describe("round-trips through toState and fromState", () => {
    for (const [name, play] of PHASES) {
      it(`keeps everything in phase ${name}`, () => {
        const round = play();
        const restored = Round.fromState(stored(round), WORD_SET);
        assert.ok(restored);
        assert.deepEqual(restored.toState(), round.toState());
        assert.equal(restored.phase, round.phase);
        assert.equal(restored.hintsUsed, round.hintsUsed);
        assert.equal(restored.hintsShown, round.hintsShown);
        assert.equal(restored.canDecode, round.canDecode);
      });
    }

    for (const [name, play] of PHASES) {
      it(`saves only accepted words, with no try count and no repeats, in phase ${name}`, () => {
        const state = play().toState();
        assert.ok(state.answers.every((tried) => typeof tried === "string"));
        assert.equal(new Set(state.answers).size, state.answers.length, "no repeated word");
        assert.equal(new Set(state.rows.map((row) => row.hex)).size, state.rows.length, "no repeated row");
        assert.equal("answerTries" in state, false);
      });
    }

    it("saves the answer, every row, each answer try and the phase", () => {
      const state = playTo(1).toState();
      assert.equal(state.answer, "BYTE");
      assert.deepEqual(
        state.rows.map((row) => row.word),
        ["TEAM", "CODE"],
      );
      assert.deepEqual(state.answers, ["TEAM", "DATA"]);
      assert.equal(state.phase, "guess");
      assert.equal(state.hintsUsed, 0);
      assert.equal(state.hintsShown, false);
      assert.equal(state.rowHinted, false);
      // No separate try count: it is the length of answers.
      assert.deepEqual(Object.keys(state).sort(), [
        "answer",
        "answers",
        "hintsShown",
        "hintsUsed",
        "phase",
        "rowHinted",
        "rows",
      ]);
    });

    it("saves rows and word attempts independently: more words than rows, or none", () => {
      const many = playTo(8).toState();
      assert.equal(many.rows.length, 1);
      assert.equal(many.answers.length, 7);
      const none = playTo(7).toState();
      assert.equal(none.rows.length, 3);
      assert.deepEqual(none.answers, []);
    });

    it("restores a round that plays on like the original", () => {
      const restored = Round.fromState(stored(playTo(3)), WORD_SET);
      assert.ok(restored);
      assert.deepEqual(restored.submitAnswer("BYTE"), { ok: true, correct: true });
      assert.deepEqual(restored.result(), {
        solved: true,
        answer: "BYTE",
        rowsUsed: MAX_ROWS,
        answerTries: MAX_ROWS,
        hintsUsed: 0,
      });
    });

    it("restores a round between rows that still takes hex rows and word attempts", () => {
      const restored = Round.fromState(stored(playTo(2)), WORD_SET);
      assert.ok(restored);
      guess(restored, "BAKE");
      assert.deepEqual(restored.submitAnswer("BEAT"), { ok: true, correct: false });
      assert.deepEqual(restored.answers, ["TEAM", "BEAT"]);
      assert.equal(restored.rows.length, 3);
    });

    /** Restores the round of the PHASES entry named `name`. */
    function restoredPhase(name: string): Round {
      const play = PHASES.find(([phase]) => phase === name)?.[1];
      assert.ok(play, name);
      const restored = Round.fromState(stored(play()), WORD_SET);
      assert.ok(restored);
      return restored;
    }

    it("restores Hints on with its row counted: toggling again doesn't count, and the next scored row turns it off", () => {
      const restored = restoredPhase("guess, Hints on now, after a row scored with Hints on (2 hints)");
      assert.equal(restored.hintsShown, true);
      assert.equal(restored.hintsUsed, 2);
      restored.disableHints();
      restored.enableHints();
      assert.equal(restored.hintsUsed, 2);
      guess(restored, "BAKE");
      assert.equal(restored.hintsShown, false);
      assert.equal(restored.hintsUsed, 2);
    });

    it("restores Hints turned off again in the current row as already counted for that row", () => {
      const restored = restoredPhase("guess, Hints turned on and off again for the row being typed");
      assert.equal(restored.hintsShown, false);
      assert.equal(restored.hintsUsed, 1);
      restored.enableHints();
      assert.equal(restored.hintsUsed, 1);
    });

    it("restores Hints off after a scored row as not yet counted for the next row", () => {
      const restored = restoredPhase("guess, Hints for rows 2 and 4 only");
      assert.equal(restored.hintsShown, false);
      assert.equal(restored.hintsUsed, 2);
      restored.enableHints();
      assert.equal(restored.hintsUsed, 3);
    });

    it("restores Hints kept on by a rejected row, still counted once", () => {
      const restored = restoredPhase("guess, Hints on before row 1, kept on by a rejected row");
      assert.equal(restored.hintsShown, true);
      assert.equal(restored.hintsUsed, 1);
      guess(restored, "TEAM");
      assert.equal(restored.hintsUsed, 1);
      assert.equal(restored.hintsShown, false);
    });

    it("restores a finished round with the most hints, MAX_HINTS", () => {
      const restored = restoredPhase("failed, Hints for every row and the final answer (MAX_HINTS)");
      assert.equal(restored.result().hintsUsed, MAX_HINTS);
    });

    it("gives a copy that later play doesn't change", () => {
      const round = playTo(2);
      const state = round.toState();
      round.submitAnswer("BYTE");
      assert.equal(state.phase, "guess");
      assert.equal(state.answers.length, 1);
    });
  });

  describe("rejects corrupt or tampered state", () => {
    const invalid: readonly (readonly [string, () => unknown])[] = [
      ["null", () => null],
      ["undefined", () => undefined],
      ["a string", () => "BYTE"],
      ["a number", () => 1],
      ["an array", () => [stored(newRound())]],
      ["an extra key", () => tampered((s) => (s.extra = 1))],
      ["a missing key", () => tampered((s) => delete s.phase)],
      [
        "a JSON-parsed __proto__ key",
        () => JSON.parse(`{${JSON.stringify(tampered(() => {})).slice(1, -1)},"__proto__":{"x":1}}`),
      ],
      ["inherited fields", () => Object.create(tampered(() => {}))],
      [
        "a getter",
        () =>
          Object.defineProperty(
            tampered((s) => delete s.answer),
            "answer",
            { enumerable: true, get: () => "BYTE" },
          ),
      ],
      ["an answer not in the list", () => tampered((s) => (s.answer = "ZZZZ"))],
      ["a lowercase answer", () => tampered((s) => (s.answer = "byte"))],
      ["a different answer, so the marks don't match", () => tampered((s) => (s.answer = "BITE"))],
      ["a tampered mark", () => tampered((s) => (firstRow(s).marks = Array(8).fill("right")))],
      ["a missing mark", () => tampered((s) => (firstRow(s).marks as unknown[]).pop())],
      ["an extra mark", () => tampered((s) => (firstRow(s).marks as unknown[]).push("right"))],
      ["a row word that doesn't match its hex", () => tampered((s) => (firstRow(s).word = "CODE"))],
      ["a lowercase row hex", () => tampered((s) => (firstRow(s).hex = "5445414d"))],
      ["a row hex that isn't a word", () => tampered((s) => (firstRow(s).hex = "5A5A5A5A"))],
      ["a row with an extra key", () => tampered((s) => (firstRow(s).extra = 1))],
      ["a row that isn't an object", () => tampered((s) => (s.rows = ["5445414D", "434F4445"]))],
      ["rows that aren't an array", () => tampered((s) => (s.rows = { ...rowsOf(s) }))],
      ["more than MAX_ROWS rows", () => tampered((s) => (s.rows = Array(MAX_ROWS + 1).fill(firstRow(s))))],
      ["answers that aren't an array", () => tampered((s) => (s.answers = { 0: "TEAM" }))],
      ["an impossible phase: solved by a wrong word", () => tampered((s) => (s.phase = "solved"))],
      ["an impossible phase: failed with rows left", () => tampered((s) => (s.phase = "failed"))],
      ["an impossible phase: final with rows left", () => tampered((s) => (s.phase = "final"))],
      ["the removed answer phase (version 5)", () => tampered((s) => (s.phase = "answer"))],
      ["an unknown phase", () => tampered((s) => (s.phase = "won"))],
      ["an answerTries field matching the answers", () => tampered((s) => (s.answerTries = 1))],
      ["an answerTries field that doesn't match", () => tampered((s) => (s.answerTries = 0))],
      ["an answerTries field as a string", () => tampered((s) => (s.answerTries = "1"))],
      ["hintsUsed as a string", () => tampered((s) => (s.hintsUsed = "0"))],
      ["hintsUsed as false (the version-7 flag)", () => tampered((s) => (s.hintsUsed = false))],
      [
        "hintsUsed as true (the version-7 flag)",
        () =>
          tampered((s) => {
            s.hintsUsed = true;
            s.rowHinted = true;
          }),
      ],
      ["hintsUsed as null", () => tampered((s) => (s.hintsUsed = null))],
      ["hintsUsed: -1", () => tampered((s) => (s.hintsUsed = -1))],
      ["hintsUsed: 0.5", () => tampered((s) => (s.hintsUsed = 0.5))],
      ["hintsUsed: NaN", () => tampered((s) => (s.hintsUsed = Number.NaN))],
      ["hintsUsed: Infinity", () => tampered((s) => (s.hintsUsed = Number.POSITIVE_INFINITY))],
      ["more hints than rows, with none for the current row", () => tampered((s) => (s.hintsUsed = 3))],
      [
        "more hints than rows + 1",
        () =>
          tampered((s) => {
            s.hintsUsed = 4;
            s.rowHinted = true;
          }),
      ],
      [
        "more than MAX_HINTS hints in a full round",
        () => {
          const state = stored(playTo(PHASES.findIndex(([name]) => name.includes("(MAX_HINTS)"))));
          state.hintsUsed = MAX_HINTS + 1;
          return state;
        },
      ],
      ["the current row counted with no hints counted", () => tampered((s) => (s.rowHinted = true))],
      ["no hintsShown (version-4 state)", () => tampered((s) => delete s.hintsShown)],
      ["hintsShown as a string", () => tampered((s) => (s.hintsShown = "false"))],
      ["hintsShown as 1", () => tampered((s) => (s.hintsShown = 1))],
      ["hintsShown as null", () => tampered((s) => (s.hintsShown = null))],
      [
        "hints shown but the current row not counted",
        () =>
          tampered((s) => {
            s.hintsUsed = 1;
            s.hintsShown = true;
          }),
      ],
      ["no rowHinted (version-7 state)", () => tampered((s) => delete s.rowHinted)],
      ["rowHinted as a string", () => tampered((s) => (s.rowHinted = "false"))],
      ["rowHinted as 0", () => tampered((s) => (s.rowHinted = 0))],
      ["rowHinted as null", () => tampered((s) => (s.rowHinted = null))],
      ["a hint counter", () => tampered((s) => (s.hintsLeft = 3))],
      [
        "a word attempt before any row",
        () =>
          tampered((s) => {
            s.rows = [];
            s.answers = ["TEAM"];
          }),
      ],
      ["the right word tried while the round is in progress", () => tampered((s) => (s.answers = ["BYTE"]))],
      ["the right word followed by more words", () => tampered((s) => (s.answers = ["BYTE", "TEAM"]))],
      [
        "a solved round whose right word isn't the last try",
        () =>
          tampered((s) => {
            s.answers = ["BYTE", "TEAM"];
            s.phase = "solved";
          }),
      ],
      [
        "a solved round with no answer tries",
        () =>
          tampered((s) => {
            s.answers = [];
            s.phase = "solved";
          }),
      ],
      ["a lowercase saved answer try", () => tampered((s) => (s.answers = ["data"]))],
      ["a saved answer try that isn't a word", () => tampered((s) => (s.answers = ["ZZZZ"]))],
      ["a saved answer try that isn't a string", () => tampered((s) => (s.answers = [1]))],
      ["a skipped (null) answer try", () => tampered((s) => (s.answers = [null]))],
      ["a hole in the answers", () => tampered((s) => (s.answers = ["TEAM", , "CODE"]))],
      [
        "a version-1 round: a skipped (null) try and an answerTries field",
        () =>
          tampered((s) => {
            s.answers = [null];
            s.answerTries = 0;
          }),
      ],
      [
        "a skipped forced final answer",
        () => {
          // Five real tries, so replay reaches row 6; only the last slot is null.
          const state = stored(playTo(3));
          state.answers = [...(state.answers as string[]), null];
          state.phase = "failed";
          return state;
        },
      ],
      ["a repeated row", () => tampered((s) => (s.rows = [firstRow(s), firstRow(s)]))],
      ["a repeated word", () => tampered((s) => (s.answers = ["TEAM", "TEAM"]))],
      ["a repeated word in another letter case", () => tampered((s) => (s.answers = ["TEAM", "team"]))],
      [
        "a failed round whose final answer repeats an earlier word",
        () => {
          const state = stored(playTo(5));
          const answers = state.answers as string[];
          state.answers = [...answers.slice(0, -1), answers[0]];
          return state;
        },
      ],
      ["more answer tries than listed words", () => tampered((s) => (s.answers = [...WORD_SET, "TEAM"]))],
      [
        "a failed round whose final answer is the right word",
        () => {
          const state = stored(playTo(5));
          state.answers = [...(state.answers as string[]).slice(0, -1), "BYTE"];
          return state;
        },
      ],
    ];
    for (const [name, make] of invalid) {
      it(`returns null for ${name}, without throwing`, () => {
        assert.equal(Round.fromState(make(), WORD_SET), null);
      });
    }
  });

  describe("accepts every hint count a real round could have saved", () => {
    // PHASES[2] has 2 rows: up to 2 counted rows, plus the current row if `rowHinted`.
    const valid: readonly (readonly [string, number, boolean, boolean])[] = [
      ["one hint per row, none for the current row", 2, false, false],
      ["one hint per row, and Hints on for the current row", 3, true, true],
      ["one hint per row, and Hints turned on and off for the current row", 3, false, true],
      ["one hint, for the current row only", 1, true, true],
    ];
    for (const [name, hintsUsed, hintsShown, rowHinted] of valid) {
      it(`restores ${name}`, () => {
        const state = tampered((s) => Object.assign(s, { hintsUsed, hintsShown, rowHinted }));
        const restored = Round.fromState(state, WORD_SET);
        assert.ok(restored);
        assert.deepEqual(restored.toState(), state);
      });
    }
  });
});
