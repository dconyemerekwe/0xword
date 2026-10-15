import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORD_SET } from "./fixtures.ts";
import { wordToHex } from "../../src/game/hex.ts";
import { MAX_ROWS, Round } from "../../src/game/round.ts";

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

  it("doesn't count a skipped try as an answer try", () => {
    const round = newRound();
    guessAndSkip(round, "TEAM");
    round.submitGuess(wordToHex("BAKE"));
    round.submitAnswer("BYTE");
    assert.deepEqual(round.result(), {
      solved: true,
      answer: "BYTE",
      rowsUsed: 2,
      answerTries: 1,
      hintsUsed: false,
    });
  });

  it("doesn't win on an all-right hex row alone", () => {
    const round = newRound();
    const outcome = round.submitGuess(wordToHex("BYTE"));
    assert.ok(outcome.ok);
    assert.ok(outcome.row.marks.every((mark) => mark === "right"));
    assert.equal(round.phase, "answer");
    assert.equal(round.isOver, false);
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

/** Plays a BYTE round to each phase; the name says where it stops. */
const PHASES: readonly (readonly [string, () => Round])[] = [
  ["guess, before the first row", () => newRound()],
  [
    "guess, after a skip and a wrong answer",
    () => {
      const round = newRound();
      guessAndSkip(round, "TEAM");
      round.submitGuess(wordToHex("CODE"));
      round.submitAnswer("data");
      return round;
    },
  ],
  [
    "answer",
    () => {
      const round = newRound();
      guessAndSkip(round, "TEAM");
      round.submitGuess(wordToHex("CODE"));
      return round;
    },
  ],
  [
    "final",
    () => {
      const round = newRound();
      for (let row = 1; row < MAX_ROWS; row++) {
        guessAndSkip(round, "TEAM");
      }
      round.submitGuess(wordToHex("BITE"));
      return round;
    },
  ],
  [
    "solved",
    () => {
      const round = newRound();
      round.submitGuess(wordToHex("TEAM"));
      round.submitAnswer("BYTE");
      return round;
    },
  ],
  [
    "failed",
    () => {
      const round = newRound();
      for (let row = 1; row <= MAX_ROWS; row++) {
        round.submitGuess(wordToHex("TEAM"));
        round.submitAnswer("CODE");
      }
      return round;
    },
  ],
  [
    "answer, with hints on",
    () => {
      const round = newRound();
      round.enableHints();
      round.submitGuess(wordToHex("BITE"));
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

/** The answer-phase round's saved state (rows TEAM, CODE) with one change. */
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
      });
    }

    it("saves the answer, every row, each answer try and the phase", () => {
      const state = playTo(1).toState();
      assert.equal(state.answer, "BYTE");
      assert.deepEqual(
        state.rows.map((row) => row.word),
        ["TEAM", "CODE"],
      );
      assert.deepEqual(state.answers, [null, "DATA"]);
      assert.equal(state.phase, "guess");
      assert.equal(state.answerTries, 1);
      assert.equal(state.hintsUsed, false);
    });

    it("restores a round that plays on like the original", () => {
      const restored = Round.fromState(stored(playTo(3)), WORD_SET);
      assert.ok(restored);
      assert.deepEqual(restored.submitAnswer("BYTE"), { ok: true, correct: true });
      assert.deepEqual(restored.result(), {
        solved: true,
        answer: "BYTE",
        rowsUsed: MAX_ROWS,
        answerTries: 1,
        hintsUsed: false,
      });
    });

    it("gives a copy that later play doesn't change", () => {
      const round = playTo(2);
      const state = round.toState();
      round.submitAnswer("BYTE");
      assert.equal(state.phase, "answer");
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
      ["a missing key", () => tampered((s) => delete s.answerTries)],
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
      ["an impossible phase", () => tampered((s) => (s.phase = "solved"))],
      ["an unknown phase", () => tampered((s) => (s.phase = "won"))],
      ["wrong answer tries", () => tampered((s) => (s.answerTries = 1))],
      ["answer tries as a string", () => tampered((s) => (s.answerTries = "0"))],
      ["hintsUsed as a string", () => tampered((s) => (s.hintsUsed = "false"))],
      ["more answer tries than rows", () => tampered((s) => (s.answers = [null, null, null]))],
      ["a row before the last without its answer try", () => tampered((s) => (s.answers = []))],
      ["a lowercase saved answer try", () => tampered((s) => (s.answers = ["data"]))],
      ["a saved answer try that isn't a word", () => tampered((s) => (s.answers = ["ZZZZ"]))],
      ["a saved answer try that isn't a string", () => tampered((s) => (s.answers = [1]))],
      [
        "a skipped forced final answer",
        () => {
          const state = stored(playTo(3));
          state.answers = Array(MAX_ROWS).fill(null);
          state.phase = "guess";
          return state;
        },
      ],
      [
        "a row after the round was solved",
        () => {
          const state = stored(playTo(4));
          state.rows = [firstRow(state), firstRow(state)];
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
});
