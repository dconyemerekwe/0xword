import { checkGuess, type GuessCheck, type GuessError } from "./guess.ts";
import { WORD_LENGTH, isWord, wordToHex } from "./hex.ts";
import { hasExactKeys, isIntegerInRange, plainFields, plainItems } from "./plain.ts";
import { Mark, score } from "./score.ts";

/** Hex rows per round. */
export const MAX_ROWS = 6;

/**
 * The most hints a round can count: one for each hex row. Hints lock with
 * the hex at the decode step, so nothing is counted after the last row. See
 * `Round.enableHints`.
 */
export const MAX_HINTS = MAX_ROWS;

/**
 * Where the round is:
 * - `guess`: waiting for a hex row. No word can be tried yet
 * - `decode`: the hex is locked, after a fully right row or after row 6, and
 *   the player gets one try at the word (see `canDecode`)
 * - `solved` / `failed`: the round is over
 */
export type Phase = "guess" | "decode" | "solved" | "failed";

export interface Row {
  readonly hex: string;
  readonly word: string;
  readonly marks: readonly Mark[];
}

/** Why a hex row was rejected: `checkGuess`'s reasons, or a row already scored in this round. */
export type RowError = GuessError | "repeat";

/** Why a plain-English answer was rejected. A rejected answer isn't the round's one try. */
export type AnswerError =
  | "format" // not four letters A–Z
  | "notWord"; // not in the word list

export type GuessOutcome = { ok: true; row: Row } | { ok: false; error: RowError };
export type AnswerOutcome = { ok: true; correct: boolean } | { ok: false; error: AnswerError };

export interface RoundResult {
  readonly solved: boolean;
  readonly answer: string;
  readonly rowsUsed: number;
  /** The accepted word attempts: always 1, the one try at the decode step that ended the round. */
  readonly answerTries: 1;
  /**
   * How many hints the round counted: 0 to `rowsUsed`, so at most
   * `MAX_HINTS`. See `Round.enableHints`.
   */
  readonly hintsUsed: number;
}

/**
 * A round saved as plain data, for `Round.toState` and `Round.fromState`. It
 * holds the hidden answer, so it must never be shown or sent to the host.
 */
export interface RoundState {
  readonly answer: string;
  /** The scored rows, all different. */
  readonly rows: readonly Row[];
  /** The one accepted word attempt, uppercased, or null before it. Set only once the round is over. */
  readonly attempt: string | null;
  /** `decode` records the decode step, and with it the Hints lock (see `Round.hintsLocked`). */
  readonly phase: Phase;
  /** The hint count so far, the current stretch included. Recorded in the result. */
  readonly hintsUsed: number;
  /** The on/off toggle: hints are shown now. Never true unless `rowHinted` is. */
  readonly hintsShown: boolean;
  /**
   * Hints have been turned on since the last scored row (or since the round
   * began), so this stretch is already counted in `hintsUsed`.
   */
  readonly rowHinted: boolean;
}

const ROUND_STATE_KEYS = ["answer", "rows", "attempt", "phase", "hintsUsed", "hintsShown", "rowHinted"] as const;
const ROW_KEYS = ["hex", "word", "marks"] as const;

/**
 * One game: a hidden answer and up to 6 hex rows. A fully right row, or row
 * 6, locks the hex and opens the decode step, where the player gets one try
 * at the word: right solves the round, wrong fails it.
 */
export class Round {
  readonly #answer: string;
  readonly #answerHex: string;
  readonly #words: ReadonlySet<string>;
  readonly #rows: Row[] = [];
  /** The one accepted word attempt, or null before it. */
  #attempt: string | null = null;
  #phase: Phase = "guess";
  /** The hint count: one per stretch in which hints were turned on. Only ever grows. */
  #hintsUsed = 0;
  /** The player's on/off toggle. Unlimited until the hex locks; a scored row turns it off. */
  #hintsShown = false;
  /** Hints were turned on in the current stretch: see `RoundState.rowHinted`. */
  #rowHinted = false;

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

  /** The one accepted word attempt, uppercased, or null before it. */
  get attempt(): string | null {
    return this.#attempt;
  }

  /**
   * The hint count so far: see `enableHints`. For the result only: the
   * screen never shows it while the round is in progress.
   */
  get hintsUsed(): number {
    return this.#hintsUsed;
  }

  /** True while hints are turned on. */
  get hintsShown(): boolean {
    return this.#hintsShown;
  }

  get isOver(): boolean {
    return this.#phase === "solved" || this.#phase === "failed";
  }

  /** True at the decode step: `submitAnswer` is allowed, once. */
  get canDecode(): boolean {
    return this.#phase === "decode";
  }

  /**
   * True once the hex is locked, at the decode step or after: Hints can't be
   * turned on again in this round. It locks with the hex because, with the
   * grid solved, the hint strip would spell the whole word.
   */
  get hintsLocked(): boolean {
    return this.#phase !== "guess";
  }

  /** True if a scored row has all 8 tiles in the right spot. Only the last row can be. */
  get hexSolved(): boolean {
    const last = this.#rows.at(-1);
    return last !== undefined && isAllRight(last);
  }

  /**
   * Scores a hex row. An invalid guess is rejected without using up a row,
   * and so is a row already scored in this round. A rejected row leaves
   * hints as they were; a scored one turns them off and starts a new stretch
   * for the hint count (see `enableHints`). A fully right row, or row 6,
   * locks the hex and moves the round to the decode step.
   */
  submitGuess(input: string): GuessOutcome {
    if (this.#phase !== "guess") {
      throw new Error(`Not allowed in phase "${this.#phase}"`);
    }
    const check = this.#checkRow(input);
    if (!check.ok) {
      return check;
    }
    const row: Row = { hex: check.hex, word: check.word, marks: score(check.hex, this.#answerHex) };
    this.#rows.push(row);
    this.#hintsShown = false;
    this.#rowHinted = false;
    if (isAllRight(row) || this.#rows.length === MAX_ROWS) {
      this.#phase = "decode";
    }
    return { ok: true, row };
  }

  /**
   * The round's one try at the word, at the decode step. The right word (in
   * any letter case) solves the round; a wrong listed word fails it, even
   * with the hex solved. A rejected word changes nothing and isn't the try.
   * Throws unless `canDecode`.
   */
  submitAnswer(input: string): AnswerOutcome {
    if (!this.canDecode) {
      throw new Error(`Not allowed in phase "${this.#phase}"`);
    }
    const error = this.answerError(input);
    if (error !== null) {
      return { ok: false, error };
    }
    const guess = input.trim().toUpperCase();
    this.#attempt = guess;
    const correct = guess === this.#answer;
    this.#phase = correct ? "solved" : "failed";
    return { ok: true, correct };
  }

  /**
   * Why `submitGuess(input)` would reject the row now, or null if it would
   * score it: the invalid-guess checks first, then the repeat check. Changes
   * nothing, and doesn't check the phase.
   */
  rowError(input: string): RowError | null {
    const check = this.#checkRow(input);
    return check.ok ? null : check.error;
  }

  /**
   * Why `submitAnswer(input)` would reject the word, or null if it would
   * take it as the try: the format check, then the word list. Changes
   * nothing, and doesn't check the phase. There is no repeat check: with one
   * try per round, no word can come before it (#34's word rule is gone).
   */
  answerError(input: string): AnswerError | null {
    const guess = input.trim().toUpperCase();
    if (!isWord(guess)) {
      return "format";
    }
    if (!this.#words.has(guess)) {
      return "notWord";
    }
    return null;
  }

  /**
   * Turns hints on, and counts a hint unless one is already counted for this
   * stretch. The round is split into stretches by its scored rows: one before
   * each row. A stretch counts once however often hints are turned on and off
   * in it, so a round counts at most one hint per row used. A rejected row
   * doesn't end a stretch. Allowed any number of times until the hex locks;
   * throws once `hintsLocked`.
   */
  enableHints(): void {
    this.#requireHintsUnlocked();
    this.#hintsShown = true;
    if (!this.#rowHinted) {
      this.#rowHinted = true;
      this.#hintsUsed++;
    }
  }

  /**
   * Turns hints off. A hint already counted for this stretch stays counted.
   * Throws once `hintsLocked`: hints are already off then.
   */
  disableHints(): void {
    this.#requireHintsUnlocked();
    this.#hintsShown = false;
  }

  /**
   * The letter of each byte that some scored row got fully right (both of its
   * digits in the right spot in that same row), or null if no row has yet:
   * e.g. `["B", null, "T", "E"]`. Digits right only in different rows don't
   * count (#50). Once shown, a letter stays, whatever later rows score.
   * Throws unless hints are on.
   */
  hintLetters(): (string | null)[] {
    if (!this.#hintsShown) {
      throw new Error("Hints are not enabled");
    }
    const letters: (string | null)[] = [];
    for (let byte = 0; byte < WORD_LENGTH; byte++) {
      const cracked = this.#rows.some(
        (row) => row.marks[byte * 2] === Mark.Right && row.marks[byte * 2 + 1] === Mark.Right,
      );
      letters.push(cracked ? (this.#answer[byte] ?? null) : null);
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
      answerTries: 1,
      hintsUsed: this.#hintsUsed,
    };
  }

  /** The whole round as fresh plain data, ready for `fromState`. Includes the answer. */
  toState(): RoundState {
    return {
      answer: this.#answer,
      rows: this.#rows.map((row) => ({ hex: row.hex, word: row.word, marks: [...row.marks] })),
      attempt: this.#attempt,
      phase: this.#phase,
      hintsUsed: this.#hintsUsed,
      hintsShown: this.#hintsShown,
      rowHinted: this.#rowHinted,
    };
  }

  /**
   * Rebuilds a round from untrusted saved state, or returns null if the state
   * isn't exactly what `toState` gives for a real round. It replays the saved
   * rows and attempt through the public methods, so every rule is checked
   * again, then compares the result with the saved phase and hints.
   * Never throws.
   */
  static fromState(raw: unknown, words: ReadonlySet<string>): Round | null {
    try {
      return replay(raw, words);
    } catch {
      return null;
    }
  }

  /** `checkGuess`, then the repeat check: a row already scored in this round. */
  #checkRow(input: string): GuessCheck | { ok: false; error: "repeat" } {
    const check = checkGuess(input, this.#words);
    if (check.ok && this.#rows.some((row) => row.hex === check.hex)) {
      return { ok: false, error: "repeat" };
    }
    return check;
  }

  #requireHintsUnlocked(): void {
    if (this.hintsLocked) {
      throw new Error(`Hints are locked in phase "${this.#phase}"`);
    }
  }
}

/** True if all 8 tiles of the row are in the right spot. */
function isAllRight(row: Row): boolean {
  return row.marks.every((mark) => mark === Mark.Right);
}

/**
 * `Round.fromState` without the safety net: may throw on impossible state.
 *
 * Only the hint count is saved, not which stretches had hints, so hints are
 * turned on before the first rows, one for each counted stretch a scored row
 * has ended, and then for the current stretch if `rowHinted`. The count and
 * the toggle come out the same as in any real order. Hints can't be turned on
 * once the hex is locked, so a `rowHinted` saved at the decode step or later
 * throws, which `fromState` turns into null.
 */
function replay(raw: unknown, words: ReadonlySet<string>): Round | null {
  const fields = plainFields(raw);
  if (!fields || !hasExactKeys(fields, ROUND_STATE_KEYS)) {
    return null;
  }
  const answer = fields.get("answer");
  const phase = fields.get("phase");
  const rows = plainItems(fields.get("rows"), MAX_ROWS);
  const attempt = fields.get("attempt");
  const hintsUsed = fields.get("hintsUsed");
  const hintsShown = fields.get("hintsShown");
  const rowHinted = fields.get("rowHinted");
  if (
    typeof answer !== "string" ||
    !words.has(answer) ||
    !rows ||
    !(attempt === null || (typeof attempt === "string" && isWord(attempt))) ||
    !isIntegerInRange(hintsUsed, 0, MAX_HINTS) ||
    typeof hintsShown !== "boolean" ||
    typeof rowHinted !== "boolean" ||
    (hintsShown && !rowHinted)
  ) {
    return null;
  }
  // The counted stretches that a scored row ended: at most one per row.
  const hintedRows = hintsUsed - (rowHinted ? 1 : 0);
  if (hintedRows < 0 || hintedRows > rows.length) {
    return null;
  }

  const round = new Round(answer, words);
  for (const [index, row] of rows.entries()) {
    if (index < hintedRows) {
      round.enableHints();
    }
    if (!replayRow(round, row)) {
      return null;
    }
  }
  if (rowHinted) {
    round.enableHints();
    if (!hintsShown) {
      round.disableHints();
    }
  }
  // Only accepted attempts are saved, already uppercased.
  if (attempt !== null && !round.submitAnswer(attempt).ok) {
    return null;
  }
  if (round.phase !== phase || round.hintsShown !== hintsShown || round.hintsUsed !== hintsUsed) {
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
