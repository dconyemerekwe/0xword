import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Mark, score } from "../../src/game/score.ts";

const R = Mark.Right;
const W = Mark.Wrong;
const A = Mark.Absent;

describe("score", () => {
  it("marks every digit right for an exact match", () => {
    assert.deepEqual(score("42595445", "42595445"), [R, R, R, R, R, R, R, R]);
  });

  it("handles repeated digits: answer BYTE, guess TEAM", () => {
    // Answer 42595445 has three 4s and three 5s. The right-spot 4 (position 7)
    // is claimed first, so only two 4s are left for wrong-spot marks.
    assert.deepEqual(score("5445414D", "42595445"), [W, W, W, W, A, A, R, A]);
  });

  it("stops marking wrong-spot once the answer's copies run out", () => {
    // Answer has six 4s and two 5s; the guess has four 5s.
    assert.deepEqual(score("54545454", "44454544"), [W, R, W, W, A, W, A, R]);
  });

  it("claims right-spot matches before wrong-spot ones", () => {
    // The answer's only 9 is at position 4, where the guess also has a 9. The
    // guess's earlier 9 (position 2) must be absent, not take it as wrong-spot.
    assert.deepEqual(score("49594549", "42595445"), [R, A, R, R, W, W, R, A]);
  });

  it("marks digits not in the answer absent", () => {
    assert.deepEqual(score("ABCDEF01", "42595445"), [A, A, A, A, A, A, A, A]);
  });

  it("ignores case", () => {
    assert.deepEqual(score("4259544a", "4259544A"), [R, R, R, R, R, R, R, R]);
  });

  it("rejects values that aren't 8 digits", () => {
    assert.throws(() => score("4259", "42595445"), RangeError);
  });
});
