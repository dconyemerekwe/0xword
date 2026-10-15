import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Session } from "../../src/game/session.ts";
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
});
