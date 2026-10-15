import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SESSION_STATE_VERSION, Session, isDraft, restoreSession } from "../../src/game/session.ts";
import { wordToHex } from "../../src/game/hex.ts";
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

    it("rejects digits while a word attempt is due", () => {
      const session = sessionAt(1);
      assert.equal(session.round?.phase, "answer");
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
      assert.equal(session.round?.phase, "answer");
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
      for (const phase of ["answer", "final", "solved", "failed"] as const) {
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
 * then a second row guessed and waiting for its answer try.
 */
function sessionAt(n: number): Session {
  const session = new Session(WORDS, () => 0);
  for (let i = 0; i < n; i++) {
    session.newRound();
  }
  const round = session.round;
  assert.ok(round);
  // The answer is WORDS[0], because random() is always 0.
  const other = WORDS[1];
  assert.ok(other);
  round.submitGuess(wordToHex(other));
  assert.deepEqual(round.submitAnswer(other), { ok: true, correct: false });
  round.submitGuess(wordToHex(other));
  return session;
}

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

  it("saves in format version 3", () => {
    assert.equal(SESSION_STATE_VERSION, 3);
    assert.equal(sessionAt(1).toState()?.version, 3);
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

  it("round-trips a row that is waiting for its word attempt, with no draft", () => {
    const restored = Session.fromState(stored(sessionAt(1)), WORDS);
    assert.equal(restored?.round?.phase, "answer");
    assert.equal(restored?.draft, "");
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
    assert.equal(restored.round?.phase, "answer");
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
      ["a draft while a word attempt is due", () => ({ ...valid(), draft: "42" })],
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

  describe("starts fresh, without throwing, for state from before the no-skip rule", () => {
    // Version 1 saved an answerTries count with each round.
    const other = WORDS[1];
    assert.ok(other);
    const cases: readonly (readonly [string, () => unknown])[] = [
      ["version-1 state", () => withRound({ ...stored(sessionAt(5)), version: 1 }, { answerTries: 1 })],
      [
        "version-1 state with a skipped try",
        () => withRound({ ...stored(sessionAt(5)), version: 1 }, { answers: [null], answerTries: 0 }),
      ],
      ["a null answer try", () => withRound(stored(sessionAt(5)), { answers: [null] })],
      ["a version-2 round carrying answerTries", () => withRound(stored(sessionAt(5)), { answerTries: 1 })],
      // sessionAt's round has 2 rows, so a valid answers list has 1 or 2 entries.
      ["answers 2 shorter than the rows", () => withRound(stored(sessionAt(5)), { answers: [] })],
      ["answers longer than the rows", () => withRound(stored(sessionAt(5)), { answers: [other, other, other] })],
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
