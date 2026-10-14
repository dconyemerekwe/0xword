import { checkGuess, type GuessError } from "./guess.ts";
import { WORD_LENGTH, isWord, wordToHex } from "./hex.ts";
import { Mark, score } from "./score.ts";

/** Hex rows per round. */
export const MAX_ROWS = 6;

/**
 * Where the round is:
 * - `guess`: waiting for a hex row
 * - `answer`: a row was scored; the player may try the word once or skip
 * - `final`: all rows used; the player must give one last answer
 * - `solved` / `failed`: the round is over
 */
export type Phase = "guess" | "answer" | "final" | "solved" | "failed";

export interface Row {
  readonly hex: string;
  readonly word: string;
  readonly marks: readonly Mark[];
}

/** Why a plain-English answer was rejected. Rejected answers don't use up the try. */
export type AnswerError =
  | "format" // not four letters A–Z
  | "notWord"; // not in the word list

export type GuessOutcome = { ok: true; row: Row } | { ok: false; error: GuessError };
export type AnswerOutcome = { ok: true; correct: boolean } | { ok: false; error: AnswerError };

export interface RoundResult {
  readonly solved: boolean;
  readonly answer: string;
  readonly rowsUsed: number;
  readonly answerTries: number;
  readonly hintsUsed: boolean;
}

/** One game: a hidden answer, up to 6 hex rows, and the answer tries between them. */
export class Round {
  readonly #answer: string;
  readonly #answerHex: string;
  readonly #words: ReadonlySet<string>;
  readonly #rows: Row[] = [];
  #phase: Phase = "guess";
  #answerTries = 0;
  #hintsUsed = false;

  constructor(answer: string, words: ReadonlySet<string>) {
    if (!words.has(answer)) {
      throw new Error(`Answer "${answer}" is not in the word list`);
    }
    this.#answer = answer;
    this.#answerHex = wordToHex(answer);
    this.#words = words;
  }

  get phase(): Phase {
    return this.#phase;
  }

  get rows(): readonly Row[] {
    return this.#rows;
  }

  get hintsUsed(): boolean {
    return this.#hintsUsed;
  }

  get isOver(): boolean {
    return this.#phase === "solved" || this.#phase === "failed";
  }

  /** Scores a hex row. An invalid guess is rejected without using up a row. */
  submitGuess(input: string): GuessOutcome {
    this.#requirePhase("guess");
    const check = checkGuess(input, this.#words);
    if (!check.ok) {
      return check;
    }
    const row: Row = { hex: check.hex, word: check.word, marks: score(check.hex, this.#answerHex) };
    this.#rows.push(row);
    this.#phase = this.#rows.length === MAX_ROWS ? "final" : "answer";
    return { ok: true, row };
  }

  /**
   * Uses the answer try for this row. A wrong answer moves on to the next row,
   * or ends the round if it was the forced final answer.
   */
  submitAnswer(input: string): AnswerOutcome {
    this.#requirePhase("answer", "final");
    const guess = input.trim().toUpperCase();
    if (!isWord(guess)) {
      return { ok: false, error: "format" };
    }
    if (!this.#words.has(guess)) {
      return { ok: false, error: "notWord" };
    }
    this.#answerTries++;
    const correct = guess === this.#answer;
    if (correct) {
      this.#phase = "solved";
    } else {
      this.#phase = this.#phase === "final" ? "failed" : "guess";
    }
    return { ok: true, correct };
  }

  /** Skips this row's answer try. Not allowed for the forced final answer. */
  skipAnswer(): void {
    this.#requirePhase("answer");
    this.#phase = "guess";
  }

  /** Turns hints on. The result then records that hints were used. */
  enableHints(): void {
    if (this.isOver) {
      throw new Error("Round is over");
    }
    this.#hintsUsed = true;
  }

  /**
   * The letter of each byte whose two digits have both been in the right spot,
   * in any rows, or null if not yet known: e.g. `["B", null, "T", "E"]`.
   */
  hintLetters(): (string | null)[] {
    if (!this.#hintsUsed) {
      throw new Error("Hints are not enabled");
    }
    const known = new Array<boolean>(this.#answerHex.length).fill(false);
    for (const row of this.#rows) {
      row.marks.forEach((mark, i) => {
        if (mark === Mark.Right) {
          known[i] = true;
        }
      });
    }
    const letters: (string | null)[] = [];
    for (let byte = 0; byte < WORD_LENGTH; byte++) {
      letters.push(known[byte * 2] && known[byte * 2 + 1] ? this.#answer[byte]! : null);
    }
    return letters;
  }

  /** The final result. Only available once the round is over. */
  result(): RoundResult {
    if (!this.isOver) {
      throw new Error("Round is not over");
    }
    return {
      solved: this.#phase === "solved",
      answer: this.#answer,
      rowsUsed: this.#rows.length,
      answerTries: this.#answerTries,
      hintsUsed: this.#hintsUsed,
    };
  }

  #requirePhase(...allowed: Phase[]): void {
    if (!allowed.includes(this.#phase)) {
      throw new Error(`Not allowed in phase "${this.#phase}"`);
    }
  }
}
