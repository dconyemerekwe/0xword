import { checkGuess, type GuessError } from "./guess.ts";
import { WORD_LENGTH, isWord, wordToHex } from "./hex.ts";
import { hasExactKeys, plainFields, plainItems } from "./plain.ts";
import { Mark, score } from "./score.ts";

/** Hex rows per round. */
export const MAX_ROWS = 6;

/**
 * Where the round is:
 * - `guess`: waiting for a hex row. Once a row has been scored, the player
 *   may also try the word, as often as they like (see `canDecode`)
 * - `final`: all rows used; the player must give one last answer
 * - `solved` / `failed`: the round is over
 */
export type Phase = "guess" | "final" | "solved" | "failed";

export interface Row {
  readonly hex: string;
  readonly word: string;
  readonly marks: readonly Mark[];
}

/** Why a plain-English answer was rejected. Rejected answers aren't counted as tries. */
export type AnswerError =
  | "format" // not four letters A–Z
  | "notWord"; // not in the word list

export type GuessOutcome = { ok: true; row: Row } | { ok: false; error: GuessError };
export type AnswerOutcome = { ok: true; correct: boolean } | { ok: false; error: AnswerError };

export interface RoundResult {
  readonly solved: boolean;
  readonly answer: string;
  readonly rowsUsed: number;
  /** The accepted word attempts, the last one included. At least 1: every round ends with one. */
  readonly answerTries: number;
  /** Hints were turned on at some point in the round, even if turned off again. */
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
   * The accepted word attempts, in order, kept apart from `rows`: any number
   * of them once a row is scored, and all wrong but perhaps the last. Its
   * length is the number of answer tries; there is no separate count.
   */
  readonly answers: readonly string[];
  readonly phase: Phase;
  /** One-way: hints were turned on at some point. Recorded in the result. */
  readonly hintsUsed: boolean;
  /** The on/off toggle: hints are shown now. Never true unless `hintsUsed` is. */
  readonly hintsShown: boolean;
}

const ROUND_STATE_KEYS = ["answer", "rows", "answers", "phase", "hintsUsed", "hintsShown"] as const;
const ROW_KEYS = ["hex", "word", "marks"] as const;

/**
 * One game: a hidden answer and up to 6 hex rows. Once a row is scored, the
 * player may try the word whenever they like; a wrong try uses no row. After
 * row 6 the hex is locked and one final answer is forced.
 */
export class Round {
  readonly #answer: string;
  readonly #answerHex: string;
  readonly #words: ReadonlySet<string>;
  readonly #rows: Row[] = [];
  /** The accepted answer tries, in order. */
  readonly #answers: string[] = [];
  #phase: Phase = "guess";
  /** One-way: set the first time hints are turned on, and never cleared. */
  #hintsUsed = false;
  /** The player's on/off toggle. Unlimited: there is no count. */
  #hintsShown = false;

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

  /** The accepted answer tries so far, uppercased, in order. */
  get answers(): readonly string[] {
    return this.#answers;
  }

  /** True once hints have been turned on in this round, even if they're off again. */
  get hintsUsed(): boolean {
    return this.#hintsUsed;
  }

  /** True while hints are turned on. */
  get hintsShown(): boolean {
    return this.#hintsShown;
  }

  get isOver(): boolean {
    return this.#phase === "solved" || this.#phase === "failed";
  }

  /**
   * True while `submitAnswer` is allowed: the round is in progress and at
   * least one row is scored. Optional before row 6, forced after it.
   */
  get canDecode(): boolean {
    return !this.isOver && this.#rows.length > 0;
  }

  /**
   * Scores a hex row. An invalid guess is rejected without using up a row.
   * The word never has to be tried first.
   */
  submitGuess(input: string): GuessOutcome {
    if (this.#phase !== "guess") {
      throw new Error(`Not allowed in phase "${this.#phase}"`);
    }
    const check = checkGuess(input, this.#words);
    if (!check.ok) {
      return check;
    }
    const row: Row = { hex: check.hex, word: check.word, marks: score(check.hex, this.#answerHex) };
    this.#rows.push(row);
    if (this.#rows.length === MAX_ROWS) {
      this.#phase = "final";
    }
    return { ok: true, row };
  }

  /**
   * Tries the word. The right word solves the round, rows left or not. A
   * wrong word counts as a try but uses no row, and ends the round only if
   * it was the forced final answer. A rejected word changes nothing. Throws
   * unless `canDecode`.
   */
  submitAnswer(input: string): AnswerOutcome {
    if (!this.canDecode) {
      throw new Error(`Not allowed in phase "${this.#phase}" with ${this.#rows.length} rows`);
    }
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
    } else if (this.#phase === "final") {
      this.#phase = "failed";
    }
    return { ok: true, correct };
  }

  /**
   * Turns hints on. The result then records that hints were used, even if
   * they're turned off again. Allowed any number of times while the round is
   * in progress; throws once it's over.
   */
  enableHints(): void {
    this.#requireInProgress();
    this.#hintsShown = true;
    this.#hintsUsed = true;
  }

  /**
   * Turns hints off. The result still records that hints were used if they
   * were ever on. Throws once the round is over.
   */
  disableHints(): void {
    this.#requireInProgress();
    this.#hintsShown = false;
  }

  /**
   * The letter of each byte whose two digits have both been in the right spot,
   * in any rows, or null if not yet known: e.g. `["B", null, "T", "E"]`.
   * Throws unless hints are on.
   */
  hintLetters(): (string | null)[] {
    if (!this.#hintsShown) {
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
      answerTries: this.#answers.length,
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
      hintsShown: this.#hintsShown,
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

  #requireInProgress(): void {
    if (this.isOver) {
      throw new Error("Round is over");
    }
  }
}

/**
 * `Round.fromState` without the safety net: may throw on impossible state.
 *
 * The saved rows and answers are separate lists, so it replays them in an
 * order a real round could have taken: the first row, then the answers
 * (which need a scored row), then the other rows. Once the round is over,
 * its last answer is the one that ended it, so that one comes after every
 * row instead. Any other real order ends in the same state.
 */
function replay(raw: unknown, words: ReadonlySet<string>): Round | null {
  const fields = plainFields(raw);
  if (!fields || !hasExactKeys(fields, ROUND_STATE_KEYS)) {
    return null;
  }
  const answer = fields.get("answer");
  const phase = fields.get("phase");
  const rows = plainItems(fields.get("rows"), MAX_ROWS);
  // Answer tries are unlimited: the only bound is a safe-integer count.
  const answers = plainItems(fields.get("answers"), Number.MAX_SAFE_INTEGER);
  const hintsUsed = fields.get("hintsUsed");
  const hintsShown = fields.get("hintsShown");
  if (
    typeof answer !== "string" ||
    !words.has(answer) ||
    !rows ||
    !answers ||
    typeof hintsUsed !== "boolean" ||
    typeof hintsShown !== "boolean" ||
    (hintsShown && !hintsUsed)
  ) {
    return null;
  }

  const round = new Round(answer, words);
  // Set before the replay, while the round is still in progress. Hints turned
  // on and off again leave "used" set and "shown" off.
  if (hintsUsed) {
    round.enableHints();
    if (!hintsShown) {
      round.disableHints();
    }
  }
  const over = phase === "solved" || phase === "failed";
  const during = over ? answers.slice(0, -1) : answers;
  const ending = over ? answers.slice(-1) : [];
  const [firstRow, ...laterRows] = rows;
  if (
    (firstRow !== undefined && !replayRow(round, firstRow)) ||
    !during.every((tried) => replayAnswer(round, tried)) ||
    !laterRows.every((row) => replayRow(round, row)) ||
    !ending.every((tried) => replayAnswer(round, tried))
  ) {
    return null;
  }
  if (round.phase !== phase) {
    return null;
  }
  return round;
}

/** Scores a saved row again. False unless it's exactly what scoring the guess gives now. */
function replayRow(round: Round, savedRow: unknown): boolean {
  const row = plainFields(savedRow);
  const hex = row?.get("hex");
  if (!row || !hasExactKeys(row, ROW_KEYS) || typeof hex !== "string") {
    return false;
  }
  const outcome = round.submitGuess(hex);
  if (!outcome.ok || outcome.row.hex !== hex || outcome.row.word !== row.get("word")) {
    return false;
  }
  const expected = outcome.row.marks;
  const marks = plainItems(row.get("marks"), expected.length);
  return marks !== null && marks.length === expected.length && marks.every((mark, j) => mark === expected[j]);
}

/**
 * Tries a saved answer again. Only accepted answers are saved, already
 * uppercased, so anything else is false. Throws, like `submitAnswer`, if the
 * round can't take an answer now (no row yet, or already over).
 */
function replayAnswer(round: Round, tried: unknown): boolean {
  return typeof tried === "string" && isWord(tried) && round.submitAnswer(tried).ok;
}
