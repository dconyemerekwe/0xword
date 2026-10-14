import { HEX_LENGTH } from "./hex.ts";

/** How one hex digit of a guess compares with the answer. */
export const Mark = {
  Right: "right",
  Wrong: "wrong",
  Absent: "absent",
} as const;
export type Mark = (typeof Mark)[keyof typeof Mark];

/**
 * Scores each of the 8 digits of a guess against the answer, handling repeated
 * digits: right-spot matches are claimed first, then a digit is marked wrong-spot
 * only while unmatched copies of it are left in the answer.
 */
export function score(guessHex: string, answerHex: string): Mark[] {
  if (guessHex.length !== HEX_LENGTH || answerHex.length !== HEX_LENGTH) {
    throw new RangeError(`Both values must be ${HEX_LENGTH} hex digits`);
  }
  const guess = guessHex.toUpperCase();
  const answer = answerHex.toUpperCase();
  const result: Mark[] = new Array<Mark>(HEX_LENGTH).fill(Mark.Absent);
  const unmatched = new Map<string, number>();

  for (let i = 0; i < HEX_LENGTH; i++) {
    if (guess[i] === answer[i]) {
      result[i] = Mark.Right;
    } else {
      const digit = answer[i]!;
      unmatched.set(digit, (unmatched.get(digit) ?? 0) + 1);
    }
  }
  for (let i = 0; i < HEX_LENGTH; i++) {
    if (result[i] === Mark.Right) {
      continue;
    }
    const digit = guess[i]!;
    const left = unmatched.get(digit) ?? 0;
    if (left > 0) {
      result[i] = Mark.Wrong;
      unmatched.set(digit, left - 1);
    }
  }
  return result;
}
