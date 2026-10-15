import { checkGuess, type GuessError } from "./guess.ts";
import { WORD_LENGTH, isWord, wordToHex } from "./hex.ts";
import { hasExactKeys, plainFields, plainItems } from "./plain.ts";
import { Mark, score } from "./score.ts";

/** Hex rows per round. */
export const MAX_ROWS = 6;

/**
 * Where the round is:
 * - `guess`: waiting for a hex row
 * - `answer`: a row was scored; the player must try the word once before the
 *   next row (a rejected answer doesn't use the try)
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
  readonly hintsUsed: boolean;
}

/**
 * A round saved as plain data, for `Round.toState` and `Round.fromState`. It
 * holds the hidden answer, so it must never be shown or sent to the host.
 */
export interface RoundState {
  readonly answer: string;
  readonly rows: readonly Row[];
  /**
   * The word tried for each row whose answer try is done. As long as `rows`,
   * or one shorter while the last row's try is still to come. Its length is
   * the number of answer tries; there is no separate count.
   */
  readonly answers: readonly string[];
  readonly phase: Phase;
  readonly hintsUsed: boolean;
}

const ROUND_STATE_KEYS = ["answer", "rows", "answers", "phase", "hintsUsed"] as const;
const ROW_KEYS = ["hex", "word", "marks"] as const;

/**
 * One game: a hidden answer, up to 6 hex rows, and one answer try after each
 * row. There is no skipping, so a finished round has as many tries as rows.
 */
export class Round {
  readonly #answer: string;
  readonly #answerHex: string;
  readonly #words: ReadonlySet<string>;
  readonly #rows: Row[] = [];
  /** The accepted answer tries, one per finished row. */
  readonly #answers: string[] = [];
  #phase: Phase = "guess";
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

  /** The accepted answer tries so far, uppercased, one per finished row. */
  get answers(): readonly string[] {
    return this.#answers;
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
   * Uses the answer try for this row: the only way past a scored row. A wrong
   * answer moves on to the next row, or ends the round if it was the forced
   * final answer.
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
    this.#answers.push(guess);
    const correct = guess === this.#answer;
    if (correct) {
      this.#phase = "solved";
    } else {
      this.#phase = this.#phase === "final" ? "failed" : "guess";
    }
    return { ok: true, correct };
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
      hintsUsed: this.#hintsUsed,
    };
  }

  /** The whole round as fresh plain data, ready for `fromState`. Includes the answer. */
  toState(): RoundState {
    return {
      answer: this.#answer,
      rows: this.#rows.map((row) => ({ hex: row.hex, word: row.word, marks: [...row.marks] })),
      answers: [...this.#answers],
      phase: this.#phase,
      hintsUsed: this.#hintsUsed,
    };
  }

  /**
   * Rebuilds a round from untrusted saved state, or returns null if the state
   * isn't exactly what `toState` gives for a real round. It replays the saved
   * guesses and answers through the public methods, so every rule is checked
   * again, then compares the result with the saved rows and phase.
   * Never throws.
   */
  static fromState(raw: unknown, words: ReadonlySet<string>): Round | null {
    try {
      return replay(raw, words);
    } catch {
      return null;
    }
  }

  #requirePhase(...allowed: Phase[]): void {
    if (!allowed.includes(this.#phase)) {
      throw new Error(`Not allowed in phase "${this.#phase}"`);
    }
  }
}

/** `Round.fromState` without the safety net: may throw on impossible state. */
function replay(raw: unknown, words: ReadonlySet<string>): Round | null {
  const fields = plainFields(raw);
  if (!fields || !hasExactKeys(fields, ROUND_STATE_KEYS)) {
    return null;
  }
  const answer = fields.get("answer");
  const rows = plainItems(fields.get("rows"), MAX_ROWS);
  const answers = plainItems(fields.get("answers"), MAX_ROWS);
  const hintsUsed = fields.get("hintsUsed");
  if (typeof answer !== "string" || !words.has(answer) || !rows || !answers || typeof hintsUsed !== "boolean") {
    return null;
  }
  // Every row but the last must have had its answer try: there are no skips.
  if (answers.length !== rows.length && answers.length !== rows.length - 1) {
    return null;
  }

  const round = new Round(answer, words);
  if (hintsUsed) {
    round.enableHints();
  }
  for (const [i, savedRow] of rows.entries()) {
    const row = plainFields(savedRow);
    const hex = row?.get("hex");
    if (!row || !hasExactKeys(row, ROW_KEYS) || typeof hex !== "string") {
      return null;
    }
    // The saved row must be exactly what scoring the guess gives now.
    const outcome = round.submitGuess(hex);
    if (!outcome.ok || outcome.row.hex !== hex || outcome.row.word !== row.get("word")) {
      return null;
    }
    const expected = outcome.row.marks;
    const marks = plainItems(row.get("marks"), expected.length);
    if (!marks || marks.length !== expected.length || marks.some((mark, j) => mark !== expected[j])) {
      return null;
    }
    if (i < answers.length) {
      const tried = answers[i];
      // Only accepted answers are saved, already uppercased. Anything else,
      // such as a skipped (null) try from saved-state version 1, is rejected.
      if (typeof tried !== "string" || !isWord(tried) || !round.submitAnswer(tried).ok) {
        return null;
      }
    }
  }
  if (round.phase !== fields.get("phase")) {
    return null;
  }
  return round;
}
