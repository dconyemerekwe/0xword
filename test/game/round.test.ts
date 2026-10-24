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

/** Six different listed words that aren't BYTE, one per row: rows can't repeat in a round. */
const SIX = ["TEAM", "BAKE", "BUSY", "LIME", "QUIZ", "ZONE"] as const;

/** Scores the first `n` of SIX as rows: none is fully right. */
function guessRows(round: Round, n: number): void {
  for (const word of SIX.slice(0, n)) {
    guess(round, word);
  }
}

/** A round with all six rows scored and none fully right: the decode step after row 6. */
function roundAfterSixRows(): Round {
  const round = newRound();
  guessRows(round, MAX_ROWS);
  return round;
}

/** A round whose row `row` (from 1) is BYTE, fully right, after `row - 1` rows that aren't. */
function roundSolvedAt(row: number): Round {
  const round = newRound();
  guessRows(round, row - 1);
  guess(round, "BYTE");
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

  it("has no result until the round is over", () => {
    assert.throws(() => newRound().result(), /not over/);
    assert.throws(() => roundSolvedAt(1).result(), /not over/);
  });

  describe("before the decode step", () => {
    it("can't decode from the very start of the round", () => {
      const round = newRound();
      assert.equal(round.canDecode, false);
      assert.throws(() => round.submitAnswer("BYTE"), /phase "guess"/);
      assert.equal(round.attempt, null);
    });

    it("can't decode after rows 1 to 5 that aren't fully right, and keeps waiting for hex rows", () => {
      const round = newRound();
      for (const [i, word] of SIX.slice(0, MAX_ROWS - 1).entries()) {
        guess(round, word);
        assert.equal(round.rows.length, i + 1);
        assert.equal(round.phase, "guess", `after row ${i + 1}`);
        assert.equal(round.canDecode, false, `after row ${i + 1}`);
        assert.throws(() => round.submitAnswer("BYTE"), /phase "guess"/, `after row ${i + 1}`);
      }
      assert.equal(round.attempt, null);
      assert.equal(round.hexSolved, false);
    });

    it("has no way to skip: there is nothing to skip", () => {
      assert.equal("skipAnswer" in newRound(), false);
    });
  });

  describe("unlocking the decode step", () => {
    for (const row of [1, 3, 6]) {
      it(`unlocks on a fully right row at row ${row}, locking the hex`, () => {
        const round = roundSolvedAt(row);
        assert.equal(round.phase, "decode");
        assert.equal(round.canDecode, true);
        assert.equal(round.hexSolved, true);
        assert.equal(round.rows.length, row);
        assert.equal(round.isOver, false, "a fully right row alone doesn't win");
        assert.throws(() => round.submitGuess(wordToHex("BAKE")), /phase "decode"/);
      });
    }

    it("unlocks on a fully right row at every row from 1 to 6", () => {
      for (let row = 1; row <= MAX_ROWS; row++) {
        assert.equal(roundSolvedAt(row).phase, "decode", `row ${row}`);
      }
    });

    it("unlocks after row 6 without a fully right row, locking the hex", () => {
      const round = roundAfterSixRows();
      assert.equal(round.rows.length, MAX_ROWS);
      assert.equal(round.phase, "decode");
      assert.equal(round.canDecode, true);
      assert.equal(round.hexSolved, false);
      assert.throws(() => round.submitGuess(wordToHex("BYTE")), /phase "decode"/);
    });

    it("doesn't unlock on a row that is nearly right", () => {
      // BITE = 42 49 54 45: 7 of 8 tiles in the right spot.
      const round = newRound();
      guess(round, "BITE");
      assert.equal(round.phase, "guess");
      assert.equal(round.hexSolved, false);
    });
  });

  describe("one try at the decode step", () => {
    it("solves on the right word after a solved grid, in any letter case", () => {
      for (const input of ["BYTE", "byte", " Byte "]) {
        const round = roundSolvedAt(2);
        assert.deepEqual(round.submitAnswer(input), { ok: true, correct: true }, input);
        assert.equal(round.phase, "solved");
        assert.equal(round.attempt, "BYTE");
        assert.deepEqual(round.result(), { solved: true, answer: "BYTE", rowsUsed: 2, answerTries: 1, hintsUsed: 0 });
      }
    });

    it("solves on the right word after row 6 without a solved grid", () => {
      const round = roundAfterSixRows();
      assert.deepEqual(round.submitAnswer("BYTE"), { ok: true, correct: true });
      assert.deepEqual(round.result(), { solved: true, answer: "BYTE", rowsUsed: 6, answerTries: 1, hintsUsed: 0 });
    });

    it("fails on a wrong listed word even with the grid solved, with rows left", () => {
      const round = roundSolvedAt(3);
      assert.deepEqual(round.submitAnswer("BITE"), { ok: true, correct: false });
      assert.equal(round.phase, "failed");
      assert.equal(round.attempt, "BITE");
      assert.deepEqual(round.result(), { solved: false, answer: "BYTE", rowsUsed: 3, answerTries: 1, hintsUsed: 0 });
    });

    it("fails on a wrong listed word after row 6", () => {
      const round = roundAfterSixRows();
      assert.deepEqual(round.submitAnswer("data"), { ok: true, correct: false });
      assert.deepEqual(round.result(), { solved: false, answer: "BYTE", rowsUsed: 6, answerTries: 1, hintsUsed: 0 });
    });

    it("takes a word already guessed as a hex row as the try: rows and words are apart", () => {
      const round = roundAfterSixRows();
      assert.deepEqual(round.submitAnswer("TEAM"), { ok: true, correct: false });
    });

    it("ends the round with exactly one counted try: no word can be tried after it", () => {
      for (const word of ["BYTE", "CODE"]) {
        const round = roundSolvedAt(1);
        round.submitAnswer(word);
        assert.equal(round.isOver, true);
        assert.equal(round.canDecode, false);
        assert.throws(() => round.submitAnswer("BYTE"), /phase "(solved|failed)"/);
        assert.throws(() => round.submitGuess(wordToHex("BAKE")), /phase "(solved|failed)"/);
        assert.equal(round.result().answerTries, 1);
      }
    });
  });

  describe("rejected words at the decode step", () => {
    const rejected: readonly (readonly [string, string, string])[] = [
      ["empty", "", "format"],
      ["too short", "BYT", "format"],
      ["too long", "BYTES", "format"],
      ["not letters", "B4TE", "format"],
      ["not listed", "ZZZZ", "notWord"],
      ["not listed, lowercase", "qxzj", "notWord"],
    ];
    for (const [name, input, error] of rejected) {
      it(`rejects a ${name} word without using the try, and stays at the decode step`, () => {
        const round = roundSolvedAt(2);
        const before = round.toState();
        assert.deepEqual(round.submitAnswer(input), { ok: false, error });
        assert.deepEqual(round.toState(), before);
        assert.equal(round.phase, "decode");
        assert.equal(round.attempt, null);
      });
    }

    it("still takes the one try after any number of rejected words, the same one twice included", () => {
      const round = roundAfterSixRows();
      for (const input of ["ZZZZ", "ZZZZ", "B4TE", "", "BYTES"]) {
        assert.equal(round.submitAnswer(input).ok, false, input);
      }
      assert.deepEqual(round.submitAnswer("BYTE"), { ok: true, correct: true });
    });

    it("has no repeat rejection for words: the only counted word ends the round (#34's word rule is gone)", () => {
      const round = roundSolvedAt(1);
      assert.equal(round.answerError("BYTE"), null);
      round.submitAnswer("CODE");
      assert.equal(round.answerError("CODE"), null, "doesn't check the phase, and there is no repeat");
    });
  });

  describe("hex row checks (#34)", () => {
    it("rejects a hex row already scored, in either case, without using a row", () => {
      const round = newRound();
      guess(round, "TEAM");
      const before = round.toState();
      for (const input of [wordToHex("TEAM"), wordToHex("TEAM").toLowerCase()]) {
        assert.deepEqual(round.submitGuess(input), { ok: false, error: "repeat" }, input);
      }
      assert.deepEqual(round.toState(), before);
      assert.equal(round.rows.length, 1);
    });

    it("runs the invalid-guess checks before the repeat check", () => {
      const round = newRound();
      guess(round, "TEAM");
      const hex = wordToHex("TEAM");
      assert.deepEqual(round.submitGuess(hex.slice(0, -1)), { ok: false, error: "length" });
      assert.deepEqual(round.submitGuess(`${hex.slice(0, -1)}G`), { ok: false, error: "notHex" });
      assert.equal(round.rows.length, 1);
    });

    it("says why a row or word would be rejected, without changing anything", () => {
      const round = newRound();
      guess(round, "TEAM");
      const before = round.toState();
      assert.equal(round.rowError(wordToHex("TEAM")), "repeat");
      assert.equal(round.rowError(""), "length");
      assert.equal(round.rowError("7B7B7B7B"), "notLetter");
      assert.equal(round.rowError(wordToHex("ZZZZ")), "notWord");
      assert.equal(round.rowError(wordToHex("BEAT")), null);
      assert.equal(round.answerError(""), "format");
      assert.equal(round.answerError("ZZZZ"), "notWord");
      assert.equal(round.answerError(" beat "), null);
      assert.deepEqual(round.toState(), before);
    });

    it("checks rows without checking the phase, at the decode step too", () => {
      const round = roundAfterSixRows();
      assert.equal(round.rowError(wordToHex("BAKE")), "repeat");
      assert.equal(round.rowError(wordToHex("BYTE")), null);
    });
  });

  describe("every reachable sequence ends in solved or failed", () => {
    // For each way to reach the decode step (a fully right row at rows 1 to 6,
    // or row 6 without one), Hints on or off before each row (2^rows ways),
    // any rejected words, then a right or wrong word: 2 × (2 + 4 + … + 64 + 64) rounds.
    it("ends every one of 380 rounds with one try, as the word says, and at most one hint per row", () => {
      let rounds = 0;
      const endings: readonly (readonly [rows: number, solvedGrid: boolean])[] = [
        ...[1, 2, 3, 4, 5, 6].map((rows) => [rows, true] as const),
        [MAX_ROWS, false],
      ];
      for (const [rows, solvedGrid] of endings) {
        for (let hinted = 0; hinted < 2 ** rows; hinted++) {
          for (const right of [false, true]) {
            const round = newRound();
            const words = [...SIX.slice(0, rows - 1), solvedGrid ? "BYTE" : (SIX[rows - 1] ?? "")];
            let hints = 0;
            for (const [i, word] of words.entries()) {
              assert.equal(round.phase, "guess");
              if (hinted & (1 << i)) {
                round.enableHints();
                hints++;
              }
              guess(round, word);
            }
            assert.equal(round.phase, "decode");
            assert.equal(round.hintsLocked, true);
            assert.equal(round.submitAnswer("QXZJ").ok, false);
            round.submitAnswer(right ? "BYTE" : "DATA");
            assert.equal(round.phase, right ? "solved" : "failed");
            const result = round.result();
            assert.equal(result.rowsUsed, rows);
            assert.equal(result.answerTries, 1);
            assert.equal(result.hintsUsed, hints);
            assert.ok(result.hintsUsed <= result.rowsUsed);
            rounds++;
          }
        }
      }
      assert.equal(rounds, 380);
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

    it("starts off, with no hints counted", () => {
      const round = newRound();
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 0);
      assert.equal(round.hintsLocked, false);
    });

    it("turns on and counts one hint, then off again keeping it counted", () => {
      const round = newRound();
      round.enableHints();
      assert.equal(round.hintsShown, true);
      assert.equal(round.hintsUsed, 1);
      round.disableHints();
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 1);
      assert.throws(() => round.hintLetters(), /not enabled/);
    });

    it("turning off before ever turning on counts no hint", () => {
      const round = newRound();
      round.disableHints();
      assert.equal(round.hintsUsed, 0);
    });

    it("toggles any number of times before the decode step, with no limit", () => {
      const round = newRound();
      guessRows(round, MAX_ROWS - 1);
      for (let i = 0; i < 100; i++) {
        round.enableHints();
        round.disableHints();
      }
      assert.equal(round.hintsUsed, 1);
      assert.equal(round.phase, "guess");
    });

    it("saves the count, the toggle and whether the current row is counted, and nothing else about hints", () => {
      const round = newRound();
      round.enableHints();
      const state = round.toState();
      assert.deepEqual(
        Object.keys(state).filter((key) => /hint/i.test(key)),
        ["hintsUsed", "hintsShown", "rowHinted"],
      );
    });
  });

  describe("Hints locks with the hex", () => {
    const decodeSteps: readonly (readonly [string, () => Round])[] = [
      ["a solved grid at row 1", () => roundSolvedAt(1)],
      ["a solved grid at row 4", () => roundSolvedAt(4)],
      ["a solved grid at row 6", () => roundSolvedAt(6)],
      ["row 6 without a solved grid", () => roundAfterSixRows()],
    ];
    for (const [name, reach] of decodeSteps) {
      it(`locks after ${name}: off, unreadable, and can't be turned on or off again`, () => {
        const round = reach();
        assert.equal(round.hintsLocked, true);
        assert.equal(round.hintsShown, false);
        assert.throws(() => round.hintLetters(), /not enabled/);
        assert.throws(() => round.enableHints(), /locked/);
        assert.throws(() => round.disableHints(), /locked/);
      });
    }

    it("switches Hints off when the row that locks the hex is scored with Hints on, keeping that row's hint", () => {
      const round = newRound();
      guess(round, "BAKE");
      round.enableHints();
      guess(round, "BYTE");
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsLocked, true);
      assert.equal(round.hintsUsed, 1);
      assert.equal(round.toState().rowHinted, false);
    });

    it("stays locked once the round is over, and through rejected words", () => {
      const round = roundSolvedAt(2);
      round.submitAnswer("QXZJ");
      assert.throws(() => round.enableHints(), /locked/);
      round.submitAnswer("BYTE");
      assert.equal(round.hintsLocked, true);
      assert.throws(() => round.enableHints(), /locked/);
    });

    it("isn't locked by a rejected row, even a fully right one typed again", () => {
      const round = newRound();
      guess(round, "TEAM");
      assert.equal(round.submitGuess("5A5A5A5A").ok, false);
      assert.equal(round.hintsLocked, false);
    });
  });

  describe("hint count (#38, #46)", () => {
    it("turns Hints off when a row is scored with Hints on, keeping the count", () => {
      const round = newRound();
      round.enableHints();
      guess(round, "TEAM");
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 1);
      assert.equal(round.toState().rowHinted, false);
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

    it("counts one hint for a row however often Hints is turned on and off before it's scored", () => {
      const round = newRound();
      round.enableHints();
      round.disableHints();
      round.enableHints();
      round.enableHints();
      round.disableHints();
      guess(round, "TEAM");
      assert.equal(round.hintsUsed, 1);
    });

    it("counts again for the next row, once Hints is pressed again", () => {
      const round = newRound();
      round.enableHints();
      guess(round, "TEAM");
      guess(round, "BAKE");
      assert.equal(round.hintsUsed, 1);
      round.enableHints();
      assert.equal(round.hintsUsed, 2);
    });

    it("counts one hint per row with Hints on, and nothing after the last row: MAX_HINTS is MAX_ROWS", () => {
      const round = newRound();
      for (const word of SIX) {
        round.enableHints();
        guess(round, word);
      }
      assert.equal(round.hintsUsed, MAX_ROWS);
      assert.throws(() => round.enableHints(), /locked/);
      round.submitAnswer("CODE");
      assert.equal(round.result().hintsUsed, MAX_HINTS);
      assert.equal(MAX_HINTS, MAX_ROWS);
    });

    it("counts at most rowsUsed hints when the grid is solved early", () => {
      for (let rows = 1; rows <= MAX_ROWS; rows++) {
        const round = newRound();
        for (const word of [...SIX.slice(0, rows - 1), "BYTE"]) {
          round.enableHints();
          guess(round, word);
        }
        round.submitAnswer("BYTE");
        assert.equal(round.result().hintsUsed, rows, `solved at row ${rows}`);
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
      round.enableHints();
      check();
      guess(round, "BYTE");
      check();
      round.submitAnswer("QXZJ");
      check();
      round.submitAnswer("BYTE");
      check();
      assert.equal(last, 2);
    });
  });
});

/** Plays a BYTE round to each phase; the name says where it stops. */
const PHASES: readonly (readonly [string, () => Round])[] = [
  ["guess, before the first row", () => newRound()],
  [
    "guess, two rows",
    () => {
      const round = newRound();
      guessRows(round, 2);
      return round;
    },
  ],
  ["decode, after a solved grid at row 1", () => roundSolvedAt(1)],
  ["decode, after a solved grid at row 4", () => roundSolvedAt(4)],
  ["decode, after row 6 without a solved grid", () => roundAfterSixRows()],
  ["decode, after a solved grid at row 6", () => roundSolvedAt(6)],
  [
    "solved, after a solved grid",
    () => {
      const round = roundSolvedAt(2);
      round.submitAnswer("BYTE");
      return round;
    },
  ],
  [
    "failed, a wrong word after a solved grid",
    () => {
      const round = roundSolvedAt(3);
      round.submitAnswer("BITE");
      return round;
    },
  ],
  [
    "solved, after row 6",
    () => {
      const round = roundAfterSixRows();
      round.submitAnswer("byte");
      return round;
    },
  ],
  [
    "failed, after row 6",
    () => {
      const round = roundAfterSixRows();
      round.submitAnswer("CODE");
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
    "decode, Hints on for the solving row, then locked",
    () => {
      const round = newRound();
      guess(round, "TEAM");
      round.enableHints();
      guess(round, "BYTE");
      return round;
    },
  ],
  [
    "failed, Hints for every row (MAX_HINTS)",
    () => {
      const round = newRound();
      for (const word of SIX) {
        round.enableHints();
        guess(round, word);
      }
      round.submitAnswer("CODE");
      return round;
    },
  ],
];

/** Plays the round of the PHASES entry named `name`. */
function play(name: string): Round {
  const reach = PHASES.find(([phase]) => phase === name)?.[1];
  assert.ok(reach, name);
  return reach();
}

/** Saved state as it comes back from storage: plain JSON data. */
function stored(round: Round): Record<string, unknown> {
  return JSON.parse(JSON.stringify(round.toState())) as Record<string, unknown>;
}

/** Saved state of the round with two rows (TEAM, BAKE) in progress, with one change. */
function tampered(change: (state: Record<string, unknown>) => void): Record<string, unknown> {
  const state = stored(play("guess, two rows"));
  change(state);
  return state;
}

/** Saved state of the PHASES entry named `name`, with one change. */
function tamperedPhase(name: string, change: (state: Record<string, unknown>) => void): Record<string, unknown> {
  const state = stored(play(name));
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
    for (const [name, reach] of PHASES) {
      it(`keeps everything in phase ${name}`, () => {
        const round = reach();
        const restored = Round.fromState(stored(round), WORD_SET);
        assert.ok(restored);
        assert.deepEqual(restored.toState(), round.toState());
        assert.equal(restored.phase, round.phase);
        assert.equal(restored.hintsUsed, round.hintsUsed);
        assert.equal(restored.hintsShown, round.hintsShown);
        assert.equal(restored.hintsLocked, round.hintsLocked);
        assert.equal(restored.hexSolved, round.hexSolved);
        assert.equal(restored.canDecode, round.canDecode);
      });
    }

    it("saves the answer, every row, the one attempt and the phase, and nothing else", () => {
      const state = play("failed, a wrong word after a solved grid").toState();
      assert.equal(state.answer, "BYTE");
      assert.deepEqual(
        state.rows.map((row) => row.word),
        ["TEAM", "BAKE", "BYTE"],
      );
      assert.equal(state.attempt, "BITE");
      assert.equal(state.phase, "failed");
      assert.deepEqual(Object.keys(state).sort(), [
        "answer",
        "attempt",
        "hintsShown",
        "hintsUsed",
        "phase",
        "rowHinted",
        "rows",
      ]);
    });

    it("records the decode step, and with it the Hints lock, as the phase", () => {
      for (const name of ["decode, after a solved grid at row 1", "decode, after row 6 without a solved grid"]) {
        const state = play(name).toState();
        assert.equal(state.phase, "decode", name);
        assert.equal(state.attempt, null, name);
        assert.equal(state.hintsShown, false, name);
        assert.equal(state.rowHinted, false, name);
      }
    });

    it("restores the decode step after a solved grid, which still takes the one try", () => {
      const restored = Round.fromState(stored(play("decode, after a solved grid at row 4")), WORD_SET);
      assert.ok(restored);
      assert.equal(restored.hintsLocked, true);
      assert.throws(() => restored.enableHints(), /locked/);
      assert.equal(restored.submitAnswer("ZZZZ").ok, false);
      assert.deepEqual(restored.submitAnswer("CODE"), { ok: true, correct: false });
      assert.deepEqual(restored.result(), { solved: false, answer: "BYTE", rowsUsed: 4, answerTries: 1, hintsUsed: 0 });
    });

    it("restores a round between rows that still takes hex rows, and no word", () => {
      const restored = Round.fromState(stored(play("guess, two rows")), WORD_SET);
      assert.ok(restored);
      assert.throws(() => restored.submitAnswer("BYTE"), /phase "guess"/);
      guess(restored, "BYTE");
      assert.equal(restored.phase, "decode");
    });

    it("restores Hints on with its row counted: toggling again doesn't count, and the next scored row turns it off", () => {
      const restored = Round.fromState(stored(play("guess, Hints on now, after a row scored with Hints on (2 hints)")), WORD_SET);
      assert.ok(restored);
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
      const restored = Round.fromState(stored(play("guess, Hints turned on and off again for the row being typed")), WORD_SET);
      assert.ok(restored);
      assert.equal(restored.hintsUsed, 1);
      restored.enableHints();
      assert.equal(restored.hintsUsed, 1);
    });

    it("restores a finished round with the most hints, MAX_HINTS", () => {
      const restored = Round.fromState(stored(play("failed, Hints for every row (MAX_HINTS)")), WORD_SET);
      assert.equal(restored?.result().hintsUsed, MAX_HINTS);
    });

    it("gives a copy that later play doesn't change", () => {
      const round = roundSolvedAt(1);
      const state = round.toState();
      round.submitAnswer("BYTE");
      assert.equal(state.phase, "decode");
      assert.equal(state.attempt, null);
    });
  });

  describe("rejects corrupt or tampered state", () => {
    const invalid: readonly (readonly [string, () => unknown])[] = [
      ["null", () => null],
      ["undefined", () => undefined],
      ["a string", () => "BYTE"],
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
      ["a row word that doesn't match its hex", () => tampered((s) => (firstRow(s).word = "CODE"))],
      ["a lowercase row hex", () => tampered((s) => (firstRow(s).hex = "5445414d"))],
      ["a row hex that isn't a word", () => tampered((s) => (firstRow(s).hex = "5A5A5A5A"))],
      ["a row with an extra key", () => tampered((s) => (firstRow(s).extra = 1))],
      ["rows that aren't an array", () => tampered((s) => (s.rows = { ...rowsOf(s) }))],
      ["more than MAX_ROWS rows", () => tampered((s) => (s.rows = Array(MAX_ROWS + 1).fill(firstRow(s))))],
      ["a repeated row", () => tampered((s) => (s.rows = [firstRow(s), firstRow(s)]))],
      // Phases
      ["the removed final phase (version 8)", () => tamperedPhase("decode, after row 6 without a solved grid", (s) => (s.phase = "final"))],
      ["the removed answer phase (version 5)", () => tampered((s) => (s.phase = "answer"))],
      ["an unknown phase", () => tampered((s) => (s.phase = "won"))],
      ["the decode step with rows left and no solved grid", () => tampered((s) => (s.phase = "decode"))],
      ["waiting for a row after a solved grid", () => tamperedPhase("decode, after a solved grid at row 1", (s) => (s.phase = "guess"))],
      ["waiting for a row after row 6", () => tamperedPhase("decode, after row 6 without a solved grid", (s) => (s.phase = "guess"))],
      ["a row after a solved grid", () => tamperedPhase("decode, after a solved grid at row 1", (s) => rowsOf(s).push(firstRow(tampered(() => {}))))],
      ["solved without an attempt", () => tamperedPhase("decode, after a solved grid at row 1", (s) => (s.phase = "solved"))],
      ["failed without an attempt", () => tamperedPhase("decode, after row 6 without a solved grid", (s) => (s.phase = "failed"))],
      // The one attempt
      ["an attempt before the decode step", () => tampered((s) => (s.attempt = "BYTE"))],
      ["an attempt with the round still at the decode step", () => tamperedPhase("decode, after a solved grid at row 1", (s) => (s.attempt = "CODE"))],
      ["a wrong attempt in a solved round", () => tamperedPhase("solved, after a solved grid", (s) => (s.attempt = "CODE"))],
      ["the right attempt in a failed round", () => tamperedPhase("failed, after row 6", (s) => (s.attempt = "BYTE"))],
      ["a lowercase attempt", () => tamperedPhase("failed, after row 6", (s) => (s.attempt = "code"))],
      ["an attempt that isn't listed", () => tamperedPhase("failed, after row 6", (s) => (s.attempt = "ZZZZ"))],
      ["an attempt that isn't a string", () => tamperedPhase("failed, after row 6", (s) => (s.attempt = 1))],
      ["the version-8 answers list", () => tamperedPhase("failed, after row 6", (s) => (s.answers = ["CODE"]))],
      [
        "the version-8 answers list in place of the attempt",
        () =>
          tamperedPhase("failed, after row 6", (s) => {
            delete s.attempt;
            s.answers = ["CODE"];
          }),
      ],
      ["an answerTries field", () => tamperedPhase("failed, after row 6", (s) => (s.answerTries = 1))],
      // Hints
      ["hintsUsed as a string", () => tampered((s) => (s.hintsUsed = "0"))],
      ["hintsUsed as false (the version-7 flag)", () => tampered((s) => (s.hintsUsed = false))],
      ["hintsUsed: -1", () => tampered((s) => (s.hintsUsed = -1))],
      ["hintsUsed: 0.5", () => tampered((s) => (s.hintsUsed = 0.5))],
      ["hintsUsed: NaN", () => tampered((s) => (s.hintsUsed = Number.NaN))],
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
        "more than MAX_HINTS hints in a full round (version 8 allowed MAX_ROWS + 1)",
        () => tamperedPhase("failed, Hints for every row (MAX_HINTS)", (s) => (s.hintsUsed = MAX_HINTS + 1)),
      ],
      ["the current row counted with no hints counted", () => tampered((s) => (s.rowHinted = true))],
      [
        "Hints on at the decode step",
        () =>
          tamperedPhase("decode, after a solved grid at row 1", (s) => {
            s.hintsUsed = 1;
            s.hintsShown = true;
            s.rowHinted = true;
          }),
      ],
      [
        "a hint counted after the last row, at the decode step",
        () =>
          tamperedPhase("decode, after row 6 without a solved grid", (s) => {
            s.hintsUsed = 1;
            s.rowHinted = true;
          }),
      ],
      [
        "a hint counted after the last row of a finished round",
        () =>
          tamperedPhase("solved, after a solved grid", (s) => {
            s.hintsUsed = 1;
            s.rowHinted = true;
          }),
      ],
      ["hintsShown as a string", () => tampered((s) => (s.hintsShown = "false"))],
      [
        "hints shown but the current row not counted",
        () =>
          tampered((s) => {
            s.hintsUsed = 1;
            s.hintsShown = true;
          }),
      ],
      ["rowHinted as 0", () => tampered((s) => (s.rowHinted = 0))],
      ["a hintsLocked field (the lock is the phase)", () => tamperedPhase("decode, after a solved grid at row 1", (s) => (s.hintsLocked = true))],
    ];
    for (const [name, make] of invalid) {
      it(`returns null for ${name}, without throwing`, () => {
        assert.equal(Round.fromState(make(), WORD_SET), null);
      });
    }
  });

  describe("accepts every hint count a real round could have saved", () => {
    // Two rows: up to 2 counted rows, plus the current row if `rowHinted`.
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

    it("restores every hint count from 0 to rowsUsed at the decode step and once the round is over", () => {
      for (const name of ["decode, after a solved grid at row 4", "failed, a wrong word after a solved grid", "solved, after row 6"]) {
        const rows = rowsOf(stored(play(name))).length;
        for (let hintsUsed = 0; hintsUsed <= rows; hintsUsed++) {
          const state = tamperedPhase(name, (s) => (s.hintsUsed = hintsUsed));
          assert.ok(Round.fromState(state, WORD_SET), `${name}: ${hintsUsed}`);
        }
      }
    });
  });
});
