import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_STATE_VERSION,
  Session,
  isDraft,
  isReported,
  readRejection,
  restoreSession,
  stillApplies,
  type Rejection,
} from "../../src/game/session.ts";
import { wordToHex } from "../../src/game/hex.ts";
import { MAX_ROWS, type AnswerError, type RowError } from "../../src/game/round.ts";
import { GameController } from "../../src/ui/game.ts";
import { WORDS } from "./fixtures.ts";

/** A random source that returns these values in turn. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("Session", () => {
  it("has no round before the first newRound", () => {
    const session = new Session(WORDS);
    assert.equal(session.round, null);
    assert.equal(session.roundNumber, 0);
  });

  it("starts round 1, ready for its first hex row", () => {
    const session = new Session(WORDS);
    const round = session.newRound();
    assert.equal(session.round, round);
    assert.equal(session.roundNumber, 1);
    assert.equal(round.phase, "guess");
    assert.deepEqual(round.rows, []);
  });

  it("starts exactly one fresh round per call", () => {
    const session = new Session(WORDS);
    const first = session.newRound();
    const second = session.newRound();
    assert.notEqual(second, first);
    assert.equal(session.round, second);
    assert.equal(session.roundNumber, 2);
  });

  it("replaces a round in progress with an untouched one", () => {
    const [answer, other] = WORDS;
    assert.ok(answer && other);
    const session = new Session(WORDS, () => 0);
    session.newRound().submitGuess(wordToHex(other));
    const fresh = session.newRound();
    assert.equal(fresh.phase, "guess");
    assert.deepEqual(fresh.rows, []);
  });

  it("picks each answer at random from the word list", () => {
    const first = WORDS[0];
    const last = WORDS.at(-1);
    assert.ok(first && last);
    const session = new Session(WORDS, sequence(0, 0.999999));
    for (const expected of [first, last]) {
      const round = session.newRound();
      round.submitGuess(wordToHex(expected));
      assert.deepEqual(round.submitAnswer(expected), { ok: true, correct: true });
    }
  });

  it("works with a one-word list", () => {
    const session = new Session(["BYTE"]);
    session.newRound().submitGuess(wordToHex("BYTE"));
    assert.deepEqual(session.round?.submitAnswer("BYTE"), { ok: true, correct: true });
  });

  it("rejects an empty word list", () => {
    assert.throws(() => new Session([]), /without words/);
  });

  describe("the half-typed hex row (draft)", () => {
    /** A fresh session whose answer is WORDS[0], waiting for its first row. */
    function guessing(): Session {
      const session = new Session(WORDS, () => 0);
      session.newRound();
      return session;
    }

    it("starts empty", () => {
      assert.equal(guessing().draft, "");
    });

    it("takes up to 8 uppercase hex digits", () => {
      const session = guessing();
      session.setDraft("0123ABCF");
      assert.equal(session.draft, "0123ABCF");
    });

    it("rejects a draft that isn't up to 8 uppercase hex digits, keeping the old one", () => {
      const session = guessing();
      session.setDraft("42");
      for (const bad of ["4a", "425954451", "4G", " "]) {
        assert.throws(() => session.setDraft(bad), RangeError, bad);
      }
      assert.equal(session.draft, "42");
    });

    it("rejects a draft before the first round", () => {
      assert.throws(() => new Session(WORDS).setDraft(""), RangeError);
    });

    it("takes digits straight after a row is scored, with no word tried", () => {
      const session = sessionAt(1);
      assert.equal(session.round?.phase, "guess");
      session.setDraft("4");
      assert.equal(session.draft, "4");
    });

    it("rejects digits once the hex is locked", () => {
      const session = atFinal();
      assert.throws(() => session.setDraft("4"), RangeError);
      session.setDraft("");
      assert.equal(session.draft, "");
    });

    it("clears the draft once the row is scored", () => {
      const session = guessing();
      const other = WORDS[1];
      assert.ok(other);
      session.setDraft(wordToHex(other));
      const outcome = session.submitDraft();
      assert.equal(outcome.ok, true);
      assert.equal(session.draft, "");
      assert.equal(session.round?.phase, "guess");
    });

    it("keeps the digits of a repeated row, which isn't scored again", () => {
      const session = sessionAt(1);
      const row = session.round?.rows[0]?.hex ?? "";
      session.setDraft(row);
      assert.deepEqual(session.submitDraft(), { ok: false, error: "repeat" });
      assert.equal(session.draft, row);
      assert.equal(session.round?.rows.length, 2);
    });

    it("keeps the digits of a rejected row, without using a row", () => {
      const session = guessing();
      session.setDraft("7B");
      assert.deepEqual(session.submitDraft(), { ok: false, error: "length" });
      session.setDraft("7B595445");
      assert.deepEqual(session.submitDraft(), { ok: false, error: "notLetter" });
      assert.equal(session.draft, "7B595445");
      assert.deepEqual(session.round?.rows, []);
    });

    it("can't submit before the first round", () => {
      assert.throws(() => new Session(WORDS).submitDraft(), /No round/);
    });

    it("is cleared by a new round", () => {
      const session = guessing();
      session.setDraft("4259");
      session.newRound();
      assert.equal(session.draft, "");
    });
  });

  describe("isDraft", () => {
    it("accepts 0 to 8 uppercase hex digits while waiting for a hex row", () => {
      for (const draft of ["", "0", "9AF", "42595445"]) {
        assert.equal(isDraft(draft, "guess"), true, draft);
      }
    });

    it("accepts only an empty draft in every other phase", () => {
      for (const phase of ["final", "solved", "failed"] as const) {
        assert.equal(isDraft("", phase), true, phase);
        assert.equal(isDraft("4", phase), false, phase);
      }
    });

    it("rejects lowercase, other characters, 9 digits and non-strings", () => {
      for (const draft of ["4a", "4G", "-1", "425954451", null, undefined, 42, ["4"]]) {
        assert.equal(isDraft(draft, "guess"), false, String(draft));
      }
    });
  });

  describe("ensureRound (on init)", () => {
    it("starts round 1 in a fresh session", () => {
      const session = new Session(WORDS);
      assert.equal(session.ensureRound(), true);
      assert.equal(session.roundNumber, 1);
      assert.ok(session.round);
    });

    it("leaves a round already there alone", () => {
      const session = new Session(WORDS);
      const round = session.newRound();
      assert.equal(session.ensureRound(), false);
      assert.equal(session.round, round);
      assert.equal(session.roundNumber, 1);
    });
  });
});

/**
 * A session at round `n`, its round with one row guessed and answered wrongly,
 * then a second row guessed with no word tried after it.
 */
function sessionAt(n: number): Session {
  const session = new Session(WORDS, () => 0);
  for (let i = 0; i < n; i++) {
    session.newRound();
  }
  const round = session.round;
  assert.ok(round);
  // The answer is WORDS[0], because random() is always 0.
  const [first, second] = WRONG;
  assert.ok(first && second);
  round.submitGuess(wordToHex(first));
  assert.deepEqual(round.submitAnswer(first), { ok: true, correct: false });
  round.submitGuess(wordToHex(second));
  return session;
}

/** Six different wrong words: rows and words can't repeat within a round. WORDS[0] is the answer. */
const WRONG = WORDS.slice(1, 1 + MAX_ROWS);

/** A session whose first round has all six rows scored and no word tried: the hex is locked. */
function atFinal(): Session {
  const session = new Session(WORDS, () => 0);
  const round = session.newRound();
  for (const word of WRONG) {
    round.submitGuess(wordToHex(word));
  }
  assert.equal(round.phase, "final");
  return session;
}

/** A session whose first round was solved on row 1 (the answer is WORDS[0]), not yet reported. */
function solved(): Session {
  const session = new Session(WORDS, () => 0);
  const answer = WORDS[0];
  assert.ok(answer);
  session.newRound().submitGuess(wordToHex(answer));
  session.round?.submitAnswer(answer);
  return session;
}

/** A session whose first round failed: six wrong rows and a wrong final answer. */
function failed(): Session {
  const session = new Session(WORDS, () => 0);
  const round = session.newRound();
  for (const word of WRONG) {
    round.submitGuess(wordToHex(word));
    round.submitAnswer(word);
  }
  assert.equal(round.phase, "failed");
  return session;
}

describe("Session.takeResult (roundFinished, once)", () => {
  it("gives nothing before the first round", () => {
    assert.equal(new Session(WORDS).takeResult(), null);
  });

  it("gives nothing while the round is in progress, on every phase", () => {
    const session = new Session(WORDS, () => 0);
    session.newRound();
    assert.equal(session.takeResult(), null, "guess");
    assert.equal(sessionAt(1).takeResult(), null, "guess, after rows and a wrong word");
    assert.equal(session.reported, false);
  });

  it("gives nothing at the final answer, before it's given", () => {
    assert.equal(atFinal().takeResult(), null);
  });

  it("gives a solved round's result once, without the answer", () => {
    const session = solved();
    assert.deepEqual(session.takeResult(), { solved: true, rowsUsed: 1, answerTries: 1, hintsUsed: 0 });
    assert.equal(session.reported, true);
    assert.equal(session.takeResult(), null);
  });

  it("gives a failed round's result once, with all 6 rows and every answer try", () => {
    const session = failed();
    assert.deepEqual(session.takeResult(), { solved: false, rowsUsed: MAX_ROWS, answerTries: MAX_ROWS, hintsUsed: 0 });
    assert.equal(session.takeResult(), null);
  });

  it("gives a failed round's result with one answer try when only the final answer was tried", () => {
    const session = atFinal();
    session.round?.submitAnswer(WORDS[1] ?? "");
    assert.deepEqual(session.takeResult(), { solved: false, rowsUsed: MAX_ROWS, answerTries: 1, hintsUsed: 0 });
  });

  it("records the hint count", () => {
    const session = new Session(WORDS, () => 0);
    const answer = WORDS[0];
    assert.ok(answer);
    const round = session.newRound();
    round.enableHints();
    round.submitGuess(wordToHex(answer));
    round.submitAnswer(answer);
    assert.deepEqual(session.takeResult(), { solved: true, rowsUsed: 1, answerTries: 1, hintsUsed: 1 });
  });

  it("is reset by a new round, which then reports only once it's over", () => {
    const session = solved();
    session.takeResult();
    session.newRound();
    assert.equal(session.reported, false);
    assert.equal(session.takeResult(), null);
  });

  it("drops an unfinished round replaced by a new round, with no result", () => {
    const session = sessionAt(1);
    session.newRound();
    assert.equal(session.takeResult(), null);
  });
});

describe("isReported", () => {
  it("accepts false for any round, and true only for a finished one", () => {
    const unfinished = sessionAt(1).round;
    const finished = solved().round;
    assert.ok(unfinished && finished);
    assert.equal(isReported(false, unfinished), true);
    assert.equal(isReported(false, finished), true);
    assert.equal(isReported(true, finished), true);
    assert.equal(isReported(true, unfinished), false);
  });

  it("rejects anything that isn't a boolean", () => {
    const finished = solved().round;
    assert.ok(finished);
    for (const value of [null, undefined, 0, 1, "true", "false", [], {}]) {
      assert.equal(isReported(value, finished), false, String(value));
    }
  });
});

/** `state` with its round's fields changed. */
function withRound(state: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  return { ...state, round: { ...(state.round as object), ...changes } };
}

/** Saved state as it comes back from storage: plain JSON data. */
function stored(session: Session): Record<string, unknown> {
  return JSON.parse(JSON.stringify(session.toState())) as Record<string, unknown>;
}

describe("Session state", () => {
  it("has nothing to save before the first round", () => {
    assert.equal(new Session(WORDS).toState(), null);
  });

  it("saves the version, the round number and the round", () => {
    const session = sessionAt(3);
    const state = session.toState();
    assert.ok(state);
    assert.equal(state.version, SESSION_STATE_VERSION);
    assert.equal(state.roundNumber, 3);
    assert.deepEqual(state.round, session.round?.toState());
  });

  it("saves in format version 8", () => {
    assert.equal(SESSION_STATE_VERSION, 8);
    assert.equal(sessionAt(1).toState()?.version, 8);
  });

  describe("the hint count and Hints on/off (version 8, #38)", () => {
    /** A session at round 1 (2 rows) with Hints turned on, and then off again if `off`. */
    function withHints(off: boolean): Session {
      const session = sessionAt(1);
      session.round?.enableHints();
      if (off) {
        session.round?.disableHints();
      }
      return session;
    }

    it("saves a new round with Hints off and no hints counted", () => {
      const state = sessionAt(1).toState();
      assert.equal(state?.round.hintsShown, false);
      assert.equal(state?.round.hintsUsed, 0);
      assert.equal(state?.round.rowHinted, false);
    });

    it("round-trips Hints on, with the count", () => {
      const restored = Session.fromState(stored(withHints(false)), WORDS);
      assert.equal(restored?.round?.hintsShown, true);
      assert.equal(restored?.round?.hintsUsed, 1);
      assert.equal(restored?.round?.toState().rowHinted, true);
    });

    it("round-trips Hints turned on and off again as off, with the row still counted", () => {
      const restored = Session.fromState(stored(withHints(true)), WORDS);
      assert.equal(restored?.round?.hintsShown, false);
      assert.equal(restored?.round?.hintsUsed, 1);
      restored?.round?.enableHints();
      assert.equal(restored?.round?.hintsUsed, 1);
    });

    it("starts a new round with Hints off and no hints counted, after a round with hints", () => {
      const session = withHints(false);
      const round = session.newRound();
      assert.equal(round.hintsShown, false);
      assert.equal(round.hintsUsed, 0);
    });

    it("reports the count in the result", () => {
      const session = new Session(WORDS, () => 0);
      const [answer] = WORDS;
      const [first, second] = WRONG;
      assert.ok(answer && first && second);
      const round = session.newRound();
      round.enableHints();
      round.submitGuess(wordToHex(first));
      round.submitGuess(wordToHex(second));
      round.enableHints();
      session.submitAnswer(answer);
      assert.deepEqual(session.takeResult(), { solved: true, rowsUsed: 2, answerTries: 1, hintsUsed: 2 });
    });

    const tampered: readonly (readonly [string, Record<string, unknown>])[] = [
      ["a hint count as a string", { hintsUsed: "1", rowHinted: true }],
      ["a negative hint count", { hintsUsed: -1 }],
      ["a fractional hint count", { hintsUsed: 0.5 }],
      ["more hints than its 2 rows + 1", { hintsUsed: 4, rowHinted: true }],
      ["Hints on with the current row not counted", { hintsUsed: 1, hintsShown: true }],
      ["the current row counted with no hints counted", { rowHinted: true }],
      ["the one-way flag of version 7", { hintsUsed: true }],
    ];
    for (const [name, changes] of tampered) {
      it(`drops the state, without throwing, for ${name}`, () => {
        const state = withRound(stored(sessionAt(1)), changes);
        assert.equal(Session.fromState(state, WORDS), null);
        assert.equal(restoreSession(state, WORDS).round, null);
      });
    }

    it("drops version-4 state, which had no hints on/off flag", () => {
      const state = stored(sessionAt(1));
      const { hintsShown: _hintsShown, ...round } = state.round as Record<string, unknown>;
      assert.equal(Session.fromState({ ...state, version: 4, round }, WORDS), null);
      assert.equal(Session.fromState({ ...state, version: 4 }, WORDS), null);
    });
  });

  it("saves the already-reported flag", () => {
    const session = solved();
    assert.equal(session.toState()?.reported, false);
    session.takeResult();
    assert.equal(session.toState()?.reported, true);
  });

  it("round-trips a reported finished round, which then reports nothing", () => {
    const session = solved();
    session.takeResult();
    const restored = Session.fromState(stored(session), WORDS);
    assert.equal(restored?.reported, true);
    assert.equal(restored?.takeResult(), null);
  });

  it("round-trips a finished round not yet reported, which then reports once", () => {
    const restored = Session.fromState(stored(solved()), WORDS);
    assert.equal(restored?.reported, false);
    assert.ok(restored?.takeResult());
    assert.equal(restored?.takeResult(), null);
  });

  it("round-trips an unfinished round as not reported", () => {
    assert.equal(Session.fromState(stored(sessionAt(2)), WORDS)?.reported, false);
  });

  describe("rejects an invalid already-reported flag", () => {
    const cases: readonly (readonly [string, () => unknown])[] = [
      ["a missing flag (version-3 state)", () => {
        const { reported: _reported, ...rest } = stored(solved());
        return { ...rest, version: 3 };
      }],
      ["a missing flag", () => {
        const { reported: _reported, ...rest } = stored(solved());
        return rest;
      }],
      ["version-3 state with the flag", () => ({ ...stored(solved()), version: 3 })],
      ["null", () => ({ ...stored(solved()), reported: null })],
      ['the string "true"', () => ({ ...stored(solved()), reported: "true" })],
      ["1", () => ({ ...stored(solved()), reported: 1 })],
      ["0", () => ({ ...stored(solved()), reported: 0 })],
      ["true for a round still in progress", () => ({ ...stored(sessionAt(2)), reported: true })],
    ];
    for (const [name, make] of cases) {
      it(`returns null for ${name}`, () => {
        assert.equal(Session.fromState(make(), WORDS), null);
      });
    }
  });

  it("saves the half-typed hex row", () => {
    const session = new Session(WORDS, () => 0);
    session.newRound();
    assert.equal(session.toState()?.draft, "");
    session.setDraft("4259");
    assert.equal(session.toState()?.draft, "4259");
  });

  it("round-trips a half-typed hex row, from empty to all 8 digits", () => {
    for (const draft of ["", "4", "4259", "42595445"]) {
      const session = new Session(WORDS, () => 0);
      session.newRound();
      session.setDraft(draft);
      const restored = Session.fromState(stored(session), WORDS);
      assert.equal(restored?.draft, draft);
      assert.equal(restored?.round?.phase, "guess");
    }
  });

  it("round-trips a half-typed row after scored rows, with no word tried since", () => {
    const session = sessionAt(1);
    session.setDraft("4259");
    const restored = Session.fromState(stored(session), WORDS);
    assert.equal(restored?.round?.phase, "guess");
    assert.equal(restored?.draft, "4259");
  });

  it("round-trips hex rows and word attempts independently: more tries than rows, or none", () => {
    const [other, third, fourth] = WRONG;
    assert.ok(other && third && fourth);
    const many = new Session(WORDS, () => 0);
    const round = many.newRound();
    round.submitGuess(wordToHex(other));
    for (const word of [other, third, fourth]) {
      round.submitAnswer(word);
    }
    const none = atFinal();
    for (const session of [many, none]) {
      const restored = Session.fromState(stored(session), WORDS);
      assert.ok(restored);
      assert.deepEqual(restored.toState(), session.toState());
    }
    assert.deepEqual(many.toState()?.round.answers, [other, third, fourth]);
    assert.deepEqual(none.toState()?.round.answers, []);
  });

  it("round-trips the locked hex, still waiting for the final answer", () => {
    const restored = Session.fromState(stored(atFinal()), WORDS);
    assert.equal(restored?.round?.phase, "final");
    assert.equal(restored?.round?.canDecode, true);
  });

  it("saves the round's answer tries as words, with no skipped (null) entries", () => {
    const state = sessionAt(1).toState();
    assert.ok(state);
    assert.equal(state.round.rows.length, 2);
    assert.deepEqual(state.round.answers, [WORDS[1]]);
    assert.equal("answerTries" in state.round, false);
  });

  it("round-trips the round number and the round in progress", () => {
    const session = sessionAt(4);
    const restored = Session.fromState(stored(session), WORDS);
    assert.ok(restored);
    assert.equal(restored.roundNumber, 4);
    assert.deepEqual(restored.toState(), session.toState());
    assert.equal(restored.round?.phase, "guess");
  });

  it("round-trips a finished round", () => {
    const session = new Session(WORDS, () => 0);
    const round = session.newRound();
    const answer = WORDS[0];
    assert.ok(answer);
    round.submitGuess(wordToHex(answer));
    round.submitAnswer(answer);
    assert.equal(Session.fromState(stored(session), WORDS)?.round?.phase, "solved");
  });

  describe("rejects corrupt or tampered state", () => {
    const valid = (): Record<string, unknown> => stored(sessionAt(2));
    const invalid: readonly (readonly [string, () => unknown])[] = [
      ["undefined, as in a panel never opened", () => undefined],
      ["null", () => null],
      ["a string", () => "state"],
      ["an array", () => [valid()]],
      ["a newer version", () => ({ ...valid(), version: SESSION_STATE_VERSION + 1 })],
      ["a version as a string", () => ({ ...valid(), version: String(SESSION_STATE_VERSION) })],
      ["no version", () => ({ roundNumber: 2, round: valid().round })],
      ["an extra key", () => ({ ...valid(), extra: true })],
      ["no round", () => ({ version: SESSION_STATE_VERSION, roundNumber: 2 })],
      ["round number 0", () => ({ ...valid(), roundNumber: 0 })],
      ["a negative round number", () => ({ ...valid(), roundNumber: -1 })],
      ["a fractional round number", () => ({ ...valid(), roundNumber: 1.5 })],
      ["a round number as a string", () => ({ ...valid(), roundNumber: "2" })],
      ["an infinite round number", () => ({ ...valid(), roundNumber: Number.POSITIVE_INFINITY })],
      ["a tampered round", () => ({ ...valid(), round: { ...(valid().round as object), answer: "ZZZZ" } })],
      ["a null round", () => ({ ...valid(), round: null })],
      ["version-2 state, which had no draft", () => ({ version: 2, roundNumber: 2, round: valid().round })],
      ["version 2 with a draft", () => ({ ...valid(), version: 2 })],
      ["a missing draft", () => ({ version: SESSION_STATE_VERSION, roundNumber: 2, round: valid().round })],
      ["a null draft", () => ({ ...valid(), draft: null })],
      ["a draft as a number", () => ({ ...valid(), draft: 42 })],
      ["a draft once the hex is locked", () => ({ ...stored(atFinal()), draft: "42" })],
      [
        "a JSON-parsed __proto__ key",
        () => JSON.parse(`{${JSON.stringify(valid()).slice(1, -1)},"__proto__":{"roundNumber":9}}`),
      ],
    ];
    for (const [name, make] of invalid) {
      it(`returns null for ${name}, without throwing`, () => {
        assert.equal(Session.fromState(make(), WORDS), null);
      });
    }

    describe("an invalid draft in a round waiting for a hex row", () => {
      const guessing = (): Record<string, unknown> => {
        const session = new Session(WORDS, () => 0);
        session.newRound();
        return stored(session);
      };
      for (const draft of ["4a", "425954451", "4G", " 42", "42 ", "４２"]) {
        it(`returns null for ${JSON.stringify(draft)}`, () => {
          assert.equal(Session.fromState({ ...guessing(), draft }, WORDS), null);
        });
      }
    });

    it("returns null for a draft in a finished round", () => {
      const session = new Session(WORDS, () => 0);
      const answer = WORDS[0];
      assert.ok(answer);
      session.newRound().submitGuess(wordToHex(answer));
      session.round?.submitAnswer(answer);
      assert.equal(Session.fromState({ ...stored(session), draft: "4" }, WORDS), null);
    });

    it("returns null for an empty word list, without throwing", () => {
      assert.equal(Session.fromState(stored(sessionAt(1)), []), null);
    });
  });
});

describe("restoreSession (webview start-up)", () => {
  it("starts fresh with no round when nothing was saved, so init starts round 1", () => {
    const session = restoreSession(undefined, WORDS);
    assert.equal(session.round, null);
    assert.equal(session.ensureRound(), true);
    assert.equal(session.roundNumber, 1);
  });

  it("restores a valid saved session, so init keeps its round", () => {
    const saved = sessionAt(5);
    const session = restoreSession(stored(saved), WORDS);
    assert.equal(session.roundNumber, 5);
    assert.equal(session.ensureRound(), false);
    assert.deepEqual(session.toState(), saved.toState());
  });

  it("starts fresh when the saved state is invalid", () => {
    const session = restoreSession({ ...stored(sessionAt(5)), version: 0 }, WORDS);
    assert.equal(session.round, null);
    assert.equal(session.roundNumber, 0);
  });

  describe("starts fresh, without throwing, for state from an older format", () => {
    // Version 1 saved an answerTries count with each round.
    const cases: readonly (readonly [string, () => unknown])[] = [
      ["version-1 state", () => withRound({ ...stored(sessionAt(5)), version: 1 }, { answerTries: 1 })],
      [
        "version-1 state with a skipped try",
        () => withRound({ ...stored(sessionAt(5)), version: 1 }, { answers: [null], answerTries: 0 }),
      ],
      ["a null answer try", () => withRound(stored(sessionAt(5)), { answers: [null] })],
      ["a version-2 round carrying answerTries", () => withRound(stored(sessionAt(5)), { answerTries: 1 })],
      // Version 5 had one compulsory word attempt per row, and an "answer" phase.
      ["version-5 state", () => ({ ...stored(sessionAt(5)), version: 5 })],
      [
        "version-5 state waiting for a word attempt",
        () => withRound({ ...stored(sessionAt(5)), version: 5 }, { phase: "answer" }),
      ],
      ["an answer phase in version-6 state", () => withRound(asVersion6(stored(sessionAt(5))), { phase: "answer" })],
      ["an answer phase in version-8 state", () => withRound(stored(sessionAt(5)), { phase: "answer" })],
      // Version 5 allowed a repeated row: dropped by its version alone.
      [
        "version-5 state with a repeated row",
        () => {
          const state: Record<string, unknown> = { ...asVersion6(stored(sessionAt(5))), version: 5 };
          const round = state["round"] as { rows: unknown[] };
          return withRound(state, { rows: [round.rows[0], round.rows[0]] });
        },
      ],
    ];
    for (const [name, make] of cases) {
      it(`for ${name}`, () => {
        // Throwing here would fail the test.
        const session = restoreSession(make(), WORDS);
        assert.equal(session.round, null);
        assert.equal(session.roundNumber, 0);
        assert.equal(session.ensureRound(), true);
        assert.equal(session.roundNumber, 1);
      });
    }
  });

  it("gives round N+1 for a queued newRound after init on a restored round N", () => {
    const session = restoreSession(stored(sessionAt(5)), WORDS);
    session.ensureRound();
    const fresh = session.newRound();
    assert.equal(session.roundNumber, 6);
    assert.equal(fresh.phase, "guess");
    assert.deepEqual(fresh.rows, []);
  });

  it("gives one new round per queued newRound on top of the restored number", () => {
    const session = restoreSession(stored(sessionAt(5)), WORDS);
    session.ensureRound();
    session.newRound();
    session.newRound();
    assert.equal(session.roundNumber, 7);
  });
});

// Regression tests for #43: a round could end on a decode while the next hex
// row was half typed, and was saved with that draft, which restore rejects.
describe("solving with a half-typed hex row", () => {
  /** A controller over a fresh session (answer WORDS[0]) with row 1 scored and `42` typed for row 2. */
  function halfTyped(): { session: Session; controller: GameController } {
    const other = WORDS[1];
    assert.ok(other);
    const session = new Session(WORDS, () => 0);
    const controller = new GameController(session, () => {});
    controller.dispatch({ type: "init" });
    for (const digit of wordToHex(other)) {
      controller.dispatch({ type: "digit", digit });
    }
    controller.dispatch({ type: "enter" });
    // The player starts typing row 2, then decodes the right word instead.
    controller.dispatch({ type: "digit", digit: "4" });
    controller.dispatch({ type: "digit", digit: "2" });
    assert.equal(session.draft, "42");
    return { session, controller };
  }

  it("restores the solved round after the panel is hidden and shown", () => {
    const answer = WORDS[0];
    assert.ok(answer);
    const { session, controller } = halfTyped();
    controller.dispatch({ type: "decode", word: answer });
    assert.equal(session.round?.phase, "solved");

    const saved = controller.savedState();
    const restored = Session.fromState(JSON.parse(JSON.stringify(saved)), WORDS);
    assert.notEqual(
      restored,
      null,
      `saved state rejected: ${JSON.stringify({ phase: saved?.round.phase, draft: saved?.draft })}`,
    );
    assert.equal(restored?.round?.phase, "solved");
  });

  it("clears the draft when a decode solves the round, and keeps it for a wrong or rejected word", () => {
    const answer = WORDS[0];
    const wrong = WORDS[2];
    assert.ok(answer && wrong);
    const { session } = halfTyped();
    assert.deepEqual(session.submitAnswer("ZZZZ"), { ok: false, error: "notWord" });
    assert.equal(session.draft, "42", "a rejected word leaves the half row");
    assert.deepEqual(session.submitAnswer(wrong), { ok: true, correct: false });
    assert.equal(session.draft, "42", "a wrong word leaves the half row: the player carries on typing");
    assert.deepEqual(session.submitAnswer(answer), { ok: true, correct: true });
    assert.equal(session.draft, "");
    assert.equal(session.toState()?.draft, "");
  });

  it("has no draft to lose when a wrong final answer fails the round: the locked keypad takes none", () => {
    const session = atFinal();
    assert.throws(() => session.setDraft("4"), RangeError);
    assert.deepEqual(session.submitAnswer(WORDS[MAX_ROWS + 1] ?? ""), { ok: true, correct: false });
    assert.equal(session.round?.phase, "failed");
    assert.equal(session.draft, "");
    assert.equal(Session.fromState(stored(session), WORDS)?.round?.phase, "failed");
  });

  it("keeps a finished round free of a draft whatever comes after: digits, DEL, ENTER, Hints, init", () => {
    const answer = WORDS[0];
    assert.ok(answer);
    const { session, controller } = halfTyped();
    controller.dispatch({ type: "decode", word: answer });
    for (const action of [
      { type: "digit", digit: "4" },
      { type: "delete" },
      { type: "enter" },
      { type: "toggleHints" },
      { type: "init" },
      { type: "decode", word: answer },
    ] as const) {
      controller.dispatch(action);
      assert.equal(session.draft, "", action.type);
    }
    assert.ok(Session.fromState(stored(session), WORDS));
  });

  it("throws, like Round.submitAnswer, with no round to answer in", () => {
    assert.throws(() => new Session(WORDS).submitAnswer("BYTE"), /No round/);
  });
});

describe("Session: a new round starts with nothing tried (#34)", () => {
  it("accepts the earlier round's hex rows and words again", () => {
    // random() is always 0, so both rounds have the same answer, WORDS[0].
    const session = sessionAt(1);
    const [first, second] = WRONG;
    assert.ok(first && second);
    const round = session.newRound();
    assert.equal(session.roundNumber, 2);
    assert.deepEqual(round.rows, []);
    assert.deepEqual(round.answers, []);
    assert.equal(round.submitGuess(wordToHex(first)).ok, true, "round 1's first row");
    assert.equal(round.submitGuess(wordToHex(second)).ok, true, "round 1's second row");
    assert.deepEqual(round.submitAnswer(first), { ok: true, correct: false }, "round 1's tried word");
  });

  it("clears the last rejection", () => {
    const session = withRejectedRow();
    session.newRound();
    assert.equal(session.rejection, null);
    assert.equal(session.toState()?.rejection, null);
  });
});

/** Types `hex` as the draft, rejects it with ENTER (expecting `error`) and records the rejection. */
function rejectRow(session: Session, hex: string, error: RowError): Session {
  session.setDraft(hex);
  assert.deepEqual(session.submitDraft(), { ok: false, error });
  session.setRejection({ kind: "row", error, hex });
  return session;
}

/** Tries `word`, expecting `error`, and records the rejection, with `saved` as the word it names. */
function rejectWord(session: Session, word: string, error: AnswerError, saved = word): Session {
  assert.deepEqual(session.submitAnswer(word), { ok: false, error });
  session.setRejection({ kind: "word", error, word: saved });
  return session;
}

/** `sessionAt(1)` with its first row typed again and rejected by ENTER as a repeat. */
function withRejectedRow(): Session {
  const session = sessionAt(1);
  return rejectRow(session, session.round?.rows[0]?.hex ?? "", "repeat");
}

/** `sessionAt(1)` with its tried word typed again, in lowercase, and rejected as a repeat. */
function withRejectedWord(): Session {
  const word = WRONG[0] ?? "";
  return rejectWord(sessionAt(1), ` ${word.toLowerCase()} `, "repeat", word);
}

/** A session at the final answer, with `WRONG[0]` tried after row 1. */
function atFinalWithTriedWord(): Session {
  const session = new Session(WORDS, () => 0);
  const round = session.newRound();
  for (const [i, word] of WRONG.entries()) {
    assert.equal(round.submitGuess(wordToHex(word)).ok, true);
    if (i === 0) {
      assert.deepEqual(round.submitAnswer(word), { ok: true, correct: false });
    }
  }
  assert.equal(round.phase, "final");
  return session;
}

/** A session whose round was solved on its first row. */
function solvedSession(): Session {
  const session = new Session(WORDS, () => 0);
  const answer = WORDS[0] ?? "";
  session.newRound().submitGuess(wordToHex(answer));
  session.submitAnswer(answer);
  return session;
}

/**
 * Version-7 state: today's state with the round's hints as version 7 saved
 * them, a one-way `hintsUsed` flag and no `rowHinted`.
 */
function asVersion7(state: Record<string, unknown>): Record<string, unknown> {
  const { rowHinted: _rowHinted, hintsUsed, ...round } = state.round as Record<string, unknown>;
  return { ...state, version: 7, round: { ...round, hintsUsed: typeof hintsUsed === "number" && hintsUsed > 0 } };
}

/** Version-6 state: version-7 state without the rejection. */
function asVersion6(state: Record<string, unknown>): Record<string, unknown> {
  const { rejection: _rejection, ...rest } = asVersion7(state);
  return { ...rest, version: 6 };
}

describe("Session: the last rejected move, saved for its message (#34)", () => {
  it("has none at first, and saves null", () => {
    const session = sessionAt(1);
    assert.equal(session.rejection, null);
    assert.equal(session.toState()?.rejection, null);
  });

  it("saves a repeated row with its error and digits, and restores it with the digits still typed", () => {
    const session = withRejectedRow();
    const hex = session.draft;
    assert.deepEqual(session.toState()?.rejection, { kind: "row", error: "repeat", hex });
    const restored = Session.fromState(stored(session), WORDS);
    assert.deepEqual(restored?.rejection, { kind: "row", error: "repeat", hex });
    assert.equal(restored?.draft, hex);
    assert.deepEqual(restored?.toState(), session.toState());
  });

  it("saves a repeated word, trimmed and uppercased, and restores it", () => {
    const restored = Session.fromState(stored(withRejectedWord()), WORDS);
    assert.deepEqual(restored?.rejection, { kind: "word", error: "repeat", word: WRONG[0] });
  });

  describe("restores every kind of rejection the screen can show", () => {
    const cases: readonly (readonly [string, () => Session])[] = [
      ["an empty row", () => rejectRow(sessionAt(1), "", "length")],
      ["a short row", () => rejectRow(sessionAt(1), "4A", "length")],
      ["a byte that isn't a letter", () => rejectRow(sessionAt(1), "7B7B7B7B", "notLetter")],
      ["an unlisted word in hex", () => rejectRow(sessionAt(1), wordToHex("ZZZZ"), "notWord")],
      ['a malformed word, saved as ""', () => rejectWord(sessionAt(1), "B4TE", "format", "")],
      ["an unlisted word", () => rejectWord(sessionAt(1), "zzzz", "notWord", "ZZZZ")],
      ["a repeated word as the final answer", () => rejectWord(atFinalWithTriedWord(), WRONG[0] ?? "", "repeat")],
    ];
    for (const [name, make] of cases) {
      it(name, () => {
        const session = make();
        assert.notEqual(session.rejection, null);
        const restored = Session.fromState(stored(session), WORDS);
        assert.ok(restored, "restored");
        assert.deepEqual(restored.rejection, session.rejection);
      });
    }
  });

  it("is cleared by every other change to the session: typing, ENTER, a word, a new round", () => {
    const changes: readonly (readonly [string, (session: Session) => void])[] = [
      ["setDraft", (session) => session.setDraft("4")],
      ["submitDraft", (session) => session.submitDraft()],
      ["submitAnswer", (session) => session.submitAnswer("ZZZZ")],
      ["newRound", (session) => session.newRound()],
    ];
    for (const [name, change] of changes) {
      const session = withRejectedRow();
      change(session);
      assert.equal(session.rejection, null, name);
    }
  });

  it("can be cleared with null", () => {
    const session = withRejectedRow();
    session.setRejection(null);
    assert.equal(session.toState()?.rejection, null);
  });

  describe("setRejection throws for one the round doesn't reject now", () => {
    const hexOf = (word: string | undefined): string => wordToHex(word ?? "");
    const cases: readonly (readonly [string, () => Session, Rejection])[] = [
      ["an empty row with the wrong error", () => sessionAt(1), { kind: "row", error: "repeat", hex: "" }],
      ["a repeat that isn't the typed row", () => sessionAt(1), { kind: "row", error: "repeat", hex: hexOf(WRONG[0]) }],
      ["the wrong error for the typed row", () => withRejectedRow(), { kind: "row", error: "notWord", hex: hexOf(WRONG[0]) }],
      ["a row once the hex is locked", () => atFinal(), { kind: "row", error: "length", hex: "" }],
      ["a word that would be counted", () => sessionAt(1), { kind: "word", error: "repeat", word: WORDS[MAX_ROWS + 1] ?? "" }],
      ["the answer, which would solve the round", () => sessionAt(1), { kind: "word", error: "notWord", word: WORDS[0] ?? "" }],
      ["a word in lowercase", () => sessionAt(1), { kind: "word", error: "repeat", word: (WRONG[0] ?? "").toLowerCase() }],
      ["a format error that names text", () => sessionAt(1), { kind: "word", error: "format", word: "B4TE" }],
      [
        "a word before any row is scored",
        () => {
          const session = new Session(WORDS, () => 0);
          session.newRound();
          return session;
        },
        { kind: "word", error: "format", word: "" },
      ],
    ];
    for (const [name, make, rejection] of cases) {
      it(name, () => {
        const session = make();
        const before = session.rejection;
        assert.throws(() => session.setRejection(rejection), RangeError);
        assert.equal(session.rejection, before, "unchanged");
      });
    }

    it("with no round", () => {
      assert.throws(() => new Session(WORDS).setRejection({ kind: "word", error: "format", word: "" }), RangeError);
    });
  });

  it("readRejection returns a fresh copy, not the object it was given", () => {
    const session = withRejectedRow();
    const saved = { kind: "row", error: "repeat", hex: session.draft };
    const round = session.round;
    assert.ok(round);
    const read = readRejection(saved, round, session.draft);
    assert.deepEqual(read, saved);
    assert.notEqual(read, saved);
  });

  describe("drops tampered state with a rejection, without throwing", () => {
    const row = (): Record<string, unknown> => stored(withRejectedRow());
    const word = (): Record<string, unknown> => stored(withRejectedWord());
    const field = (state: Record<string, unknown>, key: string): string =>
      String((state["rejection"] as Record<string, unknown>)[key]);
    const changed = (state: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> => ({
      ...state,
      rejection: { ...(state["rejection"] as object), ...changes },
    });
    const without = (state: Record<string, unknown>, key: string): Record<string, unknown> => {
      const rejection = { ...(state["rejection"] as Record<string, unknown>) };
      delete rejection[key];
      return { ...state, rejection };
    };
    const cases: readonly (readonly [string, () => unknown])[] = [
      [
        "no rejection key",
        () => {
          const { rejection: _rejection, ...rest } = row();
          return rest;
        },
      ],
      ["a rejection as text", () => ({ ...row(), rejection: "You've already tried 41 42 4C 45" })],
      ["a rejection as an array", () => ({ ...row(), rejection: ["row", "repeat"] })],
      ["an unknown kind", () => changed(row(), { kind: "hint" })],
      ["a free-text field", () => changed(row(), { text: "<b>hi</b>" })],
      ["a missing error", () => without(row(), "error")],
      ["a missing hex", () => without(row(), "hex")],
      ["an unknown error", () => changed(row(), { error: "tooLong" })],
      ["a word error on a row", () => changed(row(), { error: "format" })],
      ["a row error on a word", () => changed(word(), { error: "notLetter" })],
      ["an error as a number", () => changed(row(), { error: 1 })],
      ["a row rejection once the hex is locked", () => ({ ...stored(atFinal()), rejection: { kind: "row", error: "length", hex: "" } })],
      ["a hex that isn't the typed row", () => changed(row(), { hex: wordToHex(WRONG[1] ?? "") })],
      ["a hex in lowercase", () => changed(row(), { hex: field(row(), "hex").toLowerCase() })],
      ["a row rejection with a word key", () => changed(row(), { word: WRONG[0] })],
      ["a word rejection with a hex key", () => changed(word(), { hex: "" })],
      ["a word in lowercase", () => changed(word(), { word: field(word(), "word").toLowerCase() })],
      ["a word as a number", () => changed(word(), { word: 42 })],
      ["a format error naming text", () => changed(word(), { error: "format", word: "<img>" })],
      ["a long format error", () => changed(word(), { error: "format", word: "A".repeat(10_000) })],
      ["a word rejection in a finished round", () => ({ ...stored(solvedSession()), rejection: { kind: "word", error: "format", word: "" } })],
    ];
    for (const [name, make] of cases) {
      it(`for ${name}`, () => {
        assert.equal(Session.fromState(make(), WORDS), null);
        assert.equal(restoreSession(make(), WORDS).round, null, "starts fresh");
      });
    }
  });

  describe("keeps the round, with no rejection, when a well-formed one no longer applies", () => {
    /** A newer word list that also holds ZZZZ, as a later release might. */
    const withZzzz = [...WORDS, "ZZZZ"];

    it("an unlisted word the word list now holds", () => {
      const session = rejectWord(sessionAt(1), "ZZZZ", "notWord");
      const restored = Session.fromState(stored(session), withZzzz);
      assert.ok(restored, "the round in progress isn't lost");
      assert.equal(restored.rejection, null);
      assert.deepEqual(restored.toState(), { ...session.toState(), rejection: null });
      const view = new GameController(restored, () => {}).view();
      assert.equal(view.message, "");
      assert.equal(view.messageIsError, false);
    });

    it("an unlisted hex row the word list now holds, keeping its typed digits", () => {
      const session = rejectRow(sessionAt(1), wordToHex("ZZZZ"), "notWord");
      const restored = Session.fromState(stored(session), withZzzz);
      assert.ok(restored);
      assert.equal(restored.rejection, null);
      assert.equal(restored.draft, wordToHex("ZZZZ"));
    });

    const cases: readonly (readonly [string, () => Record<string, unknown>])[] = [
      ["a known error the row doesn't have", () => {
        const state = stored(withRejectedRow());
        return { ...state, rejection: { ...(state["rejection"] as object), error: "notWord" } };
      }],
      ["a repeat of a word not tried yet", () => {
        const state = stored(withRejectedWord());
        return { ...state, rejection: { kind: "word", error: "repeat", word: WORDS[MAX_ROWS + 1] } };
      }],
    ];
    for (const [name, make] of cases) {
      it(name, () => {
        const restored = Session.fromState(make(), WORDS);
        assert.ok(restored);
        assert.equal(restored.rejection, null);
        assert.equal(restored.roundNumber, 1);
      });
    }

    it("stillApplies says whether the round still rejects it", () => {
      const session = withRejectedWord();
      const { round, rejection } = session;
      assert.ok(round && rejection);
      assert.equal(stillApplies(rejection, round), true);
      assert.equal(stillApplies({ kind: "word", error: "notWord", word: rejection.kind === "word" ? rejection.word : "" }, round), false);
    });
  });

  describe("version-6 and version-7 state, saved before hints were counted (#38)", () => {
    // A one-way flag can't say how many hints were used, so older state starts fresh.
    const cases: readonly (readonly [string, () => Record<string, unknown>])[] = [
      ["version-7 state", () => asVersion7(stored(sessionAt(3)))],
      ["version-7 state with hints used", () => asVersion7(stored(withHintsOn()))],
      ["version-7 state with a rejection", () => asVersion7(stored(withRejectedRow()))],
      ["version-7 state in today's round format", () => ({ ...stored(sessionAt(3)), version: 7 })],
      ["version-6 state", () => asVersion6(stored(sessionAt(3)))],
      ["version-6 state with hints used", () => asVersion6(stored(withHintsOn()))],
      [
        "version-6 state in today's format but without the rejection",
        () => {
          const { rejection: _rejection, ...rest } = stored(sessionAt(3));
          return { ...rest, version: 6 };
        },
      ],
    ];
    for (const [name, make] of cases) {
      it(`starts fresh, without throwing, for ${name}`, () => {
        const state = make();
        assert.equal(Session.fromState(state, WORDS), null);
        const session = restoreSession(state, WORDS);
        assert.equal(session.round, null);
        assert.equal(session.ensureRound(), true);
        assert.equal(session.roundNumber, 1);
      });
    }

    /** A session at round 1 with Hints on. */
    function withHintsOn(): Session {
      const session = sessionAt(1);
      session.round?.enableHints();
      return session;
    }
  });
});
