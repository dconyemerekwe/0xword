import { HEX_LENGTH, isWord } from "./hex.ts";
import { hasExactKeys, isIntegerInRange, plainFields } from "./plain.ts";
import {
  Round,
  type AnswerError,
  type AnswerOutcome,
  type GuessOutcome,
  type Phase,
  type RoundResult,
  type RoundState,
  type RowError,
} from "./round.ts";
import { pickAnswer } from "./words.ts";

/**
 * The saved-state format. Bump it when the format changes, and either migrate
 * older state in `fromState` or let it be dropped. Version 2 removed skipped
 * answer tries and the round's `answerTries` count. Version 3 added the
 * half-typed hex row (`draft`). Version 4 added `reported`, so a finished
 * round is reported to the host only once. Version 5 added the round's
 * `hintsShown`, the Hints on/off toggle, next to the one-way `hintsUsed`.
 * Version 6 made word attempts optional (#30): the round's `answers` no
 * longer follow its rows one for one, and the `answer` phase is gone.
 * Version 7 added `rejection`, so the message for a rejected move survives a
 * hide and show (#34). Version 8 counts hints (#38): the round's `hintsUsed`
 * is a number instead of a one-way flag, and `rowHinted` says whether the
 * current stretch is already counted. Older state is dropped, so the panel
 * starts fresh: its one-way flag can't say how many hints were used.
 */
export const SESSION_STATE_VERSION = 8;

/**
 * The player's last rejected move, as data rather than text: the error, and
 * what the message names. The screen rebuilds the message from it, so a
 * restored message is never text read back from saved state.
 * - `row`: the hex row ENTER rejected. The rejected digits stay typed, so
 *   `hex` is always the session's draft (empty, short or full).
 * - `word`: the word the decode box rejected, trimmed and uppercased, or ""
 *   for a `format` error, whose message doesn't name it.
 */
export type Rejection =
  | { readonly kind: "row"; readonly error: RowError; readonly hex: string }
  | { readonly kind: "word"; readonly error: AnswerError; readonly word: string };

/**
 * A session saved as plain data. It holds the hidden answer, so it must never
 * be shown or sent to the host (the webview keeps it in its own saved state).
 */
export interface SessionState {
  readonly version: typeof SESSION_STATE_VERSION;
  readonly roundNumber: number;
  readonly round: RoundState;
  /** The hex row being typed: see `isDraft`. */
  readonly draft: string;
  /** The round's result has been handed out by `takeResult`: see `isReported`. */
  readonly reported: boolean;
  /** The last move's rejection, or null if the last move wasn't rejected: see `readRejection`. */
  readonly rejection: Rejection | null;
}

/** A finished round's result as the host gets it: without the hidden answer. */
export type RoundReport = Omit<RoundResult, "answer">;

const SESSION_STATE_KEYS = ["version", "roundNumber", "round", "draft", "reported", "rejection"] as const;
const ROW_REJECTION_KEYS = ["kind", "error", "hex"] as const;
const WORD_REJECTION_KEYS = ["kind", "error", "word"] as const;

/** Up to 8 uppercase hex digits. */
const DRAFT_PATTERN = new RegExp(`^[0-9A-F]{0,${HEX_LENGTH}}$`);

/**
 * True if `draft` can be the half-typed hex row of a round in `phase`: up to
 * 8 uppercase hex digits, and empty unless the round is waiting for a hex row
 * (so never once the hex is locked or the round is over).
 */
export function isDraft(draft: unknown, phase: Phase): draft is string {
  return typeof draft === "string" && DRAFT_PATTERN.test(draft) && (phase === "guess" || draft === "");
}

/**
 * True if `reported` can be the "already reported" flag of `round`: a
 * boolean, and true only once the round is over (an unfinished round has no
 * result to report).
 */
export function isReported(reported: unknown, round: Round): reported is boolean {
  return reported === false || (reported === true && round.isOver);
}

/** Every `RowError`: the compiler fails here if one is missing or unknown. */
const ROW_ERRORS: Readonly<Record<RowError, true>> = { length: true, notHex: true, notLetter: true, notWord: true, repeat: true };

/** Every `AnswerError`, likewise. */
const ANSWER_ERRORS: Readonly<Record<AnswerError, true>> = { format: true, notWord: true, repeat: true };

function isRowError(error: unknown): error is RowError {
  return typeof error === "string" && Object.hasOwn(ROW_ERRORS, error);
}

function isAnswerError(error: unknown): error is AnswerError {
  return typeof error === "string" && Object.hasOwn(ANSWER_ERRORS, error);
}

/**
 * `raw` as a fresh `Rejection` if it's well formed for the round with `draft`
 * typed, or else null. Well formed means: exactly the keys of its kind, a
 * known error code, and, for a row, the round waiting for a hex row with
 * `hex` equal to the draft; for a word, the round able to take a word
 * (`canDecode`) and the word four letters A–Z, or "" exactly when the error
 * is `format`. It doesn't ask whether the round still rejects that input
 * with that error: see `stillApplies`.
 */
export function readRejection(raw: unknown, round: Round, draft: string): Rejection | null {
  const fields = plainFields(raw);
  const kind = fields?.get("kind");
  const error = fields?.get("error");
  if (kind === "row" && fields && hasExactKeys(fields, ROW_REJECTION_KEYS) && isRowError(error)) {
    if (round.phase === "guess" && fields.get("hex") === draft) {
      return { kind, error, hex: draft };
    }
  }
  if (kind === "word" && fields && hasExactKeys(fields, WORD_REJECTION_KEYS) && isAnswerError(error)) {
    const word = fields.get("word");
    if (round.canDecode && typeof word === "string" && (word === "" ? error === "format" : isWord(word) && error !== "format")) {
      return { kind, error, word };
    }
  }
  return null;
}

/**
 * True if the round still rejects the rejection's input with its error,
 * worked out again by the round rather than taken on trust. A well-formed
 * saved rejection can stop applying without any tampering, for example when
 * a later release adds the rejected word to the word list.
 */
export function stillApplies(rejection: Rejection, round: Round): boolean {
  const error = rejection.kind === "row" ? round.rowError(rejection.hex) : round.answerError(rejection.word);
  return error === rejection.error;
}

/**
 * A run of rounds in one panel: starts each new round with a fresh random
 * answer and counts them. The answer stays inside the `Round`.
 */
export class Session {
  readonly #words: readonly string[];
  readonly #wordSet: ReadonlySet<string>;
  readonly #random: () => number;
  #round: Round | null = null;
  #roundNumber = 0;
  #draft = "";
  #reported = false;
  #rejection: Rejection | null = null;

  /** `random` works like `Math.random`; tests pass a fixed one. */
  constructor(words: readonly string[], random: () => number = Math.random) {
    if (words.length === 0) {
      throw new Error("Cannot start rounds without words");
    }
    this.#words = words;
    this.#wordSet = new Set(words);
    this.#random = random;
  }

  /** The round being played, or null before the first `newRound`. */
  get round(): Round | null {
    return this.#round;
  }

  /** 1 for the first round, 2 for the next, and so on. 0 before any round. */
  get roundNumber(): number {
    return this.#roundNumber;
  }

  /** The hex row being typed, saved with the session so it survives a reload. */
  get draft(): string {
    return this.#draft;
  }

  /** True once the current round's result has been handed out by `takeResult`. */
  get reported(): boolean {
    return this.#reported;
  }

  /**
   * The last move's rejection, saved with the session so its message survives
   * a reload, or null. Every other change to the session clears it.
   */
  get rejection(): Rejection | null {
    return this.#rejection;
  }

  /**
   * Records the last move's rejection, or clears it with null. Throws if it
   * isn't well formed or isn't what the round rejects now (see
   * `readRejection` and `stillApplies`): the caller sets it straight after
   * the rejected move.
   */
  setRejection(rejection: Rejection | null): void {
    if (rejection === null) {
      this.#rejection = null;
      return;
    }
    const checked = this.#round ? readRejection(rejection, this.#round, this.#draft) : null;
    if (!checked || !this.#round || !stillApplies(checked, this.#round)) {
      throw new RangeError(`Not a rejection now: ${JSON.stringify(rejection)}`);
    }
    this.#rejection = checked;
  }

  /**
   * The current round's result the first time it's asked for after the round
   * ends, and null every other time: before the round ends, and once it has
   * been taken. The webview sends it to the host as `roundFinished`, so each
   * finished round is counted exactly once. The flag is saved with the
   * session, so a restored round that was already reported stays reported.
   */
  takeResult(): RoundReport | null {
    const round = this.#round;
    if (!round?.isOver || this.#reported) {
      return null;
    }
    this.#reported = true;
    const { solved, rowsUsed, answerTries, hintsUsed } = round.result();
    return { solved, rowsUsed, answerTries, hintsUsed };
  }

  /**
   * Replaces the half-typed hex row. Throws if there is no round or `draft`
   * isn't valid for it (see `isDraft`): the caller checks the phase first.
   */
  setDraft(draft: string): void {
    if (!this.#round || !isDraft(draft, this.#round.phase)) {
      throw new RangeError(`Not a valid draft now: "${draft}"`);
    }
    this.#draft = draft;
    this.#rejection = null;
  }

  /**
   * Submits the draft as the round's next hex row, and clears it if the row
   * was scored. A rejected row keeps its digits. Throws if there is no round
   * or it isn't waiting for a hex row, like `Round.submitGuess`.
   */
  submitDraft(): GuessOutcome {
    if (!this.#round) {
      throw new Error("No round to guess in");
    }
    const outcome = this.#round.submitGuess(this.#draft);
    this.#rejection = null;
    if (outcome.ok) {
      this.#draft = "";
    }
    return outcome;
  }

  /**
   * Tries the word in the round, like `Round.submitAnswer`, and clears the
   * half-typed hex row if that ended the round: a finished round has no
   * draft (see `isDraft`), or its saved state couldn't be restored (#43).
   * A wrong or rejected word before row 6 keeps the draft, since the player
   * carries on typing hex. Throws if there is no round, or the round can't
   * take an answer now.
   */
  submitAnswer(input: string): AnswerOutcome {
    if (!this.#round) {
      throw new Error("No round to answer in");
    }
    const outcome = this.#round.submitAnswer(input);
    this.#rejection = null;
    if (this.#round.isOver) {
      this.#draft = "";
    }
    return outcome;
  }

  /**
   * Replaces the current round, finished or not, with a fresh one. An
   * unfinished round is dropped with no result, so it's never reported.
   */
  newRound(): Round {
    const round = new Round(pickAnswer(this.#words, this.#random), this.#wordSet);
    this.#round = round;
    this.#roundNumber++;
    this.#draft = "";
    this.#reported = false;
    this.#rejection = null;
    return round;
  }

  /**
   * Starts the first round unless one is already there (restored from saved
   * state). Returns true if it started one.
   */
  ensureRound(): boolean {
    if (this.#round) {
      return false;
    }
    this.newRound();
    return true;
  }

  /** The session as fresh plain data, or null before the first round. */
  toState(): SessionState | null {
    if (!this.#round) {
      return null;
    }
    return {
      version: SESSION_STATE_VERSION,
      roundNumber: this.#roundNumber,
      round: this.#round.toState(),
      draft: this.#draft,
      reported: this.#reported,
      rejection: this.#rejection && { ...this.#rejection },
    };
  }

  /**
   * Rebuilds a session from untrusted saved state, or returns null if it isn't
   * exactly what `toState` gives (see `Round.fromState`). A malformed
   * `rejection` drops the state; a well-formed one the round no longer
   * rejects is restored as none. Never throws.
   */
  static fromState(raw: unknown, words: readonly string[], random: () => number = Math.random): Session | null {
    const fields = plainFields(raw);
    if (!fields || fields.get("version") !== SESSION_STATE_VERSION || !hasExactKeys(fields, SESSION_STATE_KEYS)) {
      return null;
    }
    const roundNumber = fields.get("roundNumber");
    if (!isIntegerInRange(roundNumber, 1, Number.MAX_SAFE_INTEGER - 1) || words.length === 0) {
      return null;
    }
    const session = new Session(words, random);
    const round = Round.fromState(fields.get("round"), session.#wordSet);
    const draft = fields.get("draft");
    const reported = fields.get("reported");
    if (!round || !isDraft(draft, round.phase) || !isReported(reported, round)) {
      return null;
    }
    const savedRejection = fields.get("rejection");
    const parsed = savedRejection === null ? null : readRejection(savedRejection, round, draft);
    if (savedRejection !== null && parsed === null) {
      // Malformed: the state was tampered with or corrupted, so drop it all.
      return null;
    }
    // Well formed but no longer true (the word list changed, say): the round
    // is fine, so keep it, with no message.
    const rejection = parsed && stillApplies(parsed, round) ? parsed : null;
    session.#round = round;
    session.#roundNumber = roundNumber;
    session.#draft = draft;
    session.#reported = reported;
    session.#rejection = rejection;
    return session;
  }
}

/**
 * The webview's start-up: the saved session if `saved` is valid, or else a
 * fresh session with no round yet (the first one starts on `init`).
 */
export function restoreSession(saved: unknown, words: readonly string[], random: () => number = Math.random): Session {
  return Session.fromState(saved, words, random) ?? new Session(words, random);
}
