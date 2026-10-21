import { HEX_LENGTH } from "./hex.ts";
import { hasExactKeys, isIntegerInRange, plainFields } from "./plain.ts";
import { Round, type AnswerOutcome, type GuessOutcome, type Phase, type RoundResult, type RoundState } from "./round.ts";
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
 * Older state is dropped, so the panel starts fresh.
 */
export const SESSION_STATE_VERSION = 6;

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
}

/** A finished round's result as the host gets it: without the hidden answer. */
export type RoundReport = Omit<RoundResult, "answer">;

const SESSION_STATE_KEYS = ["version", "roundNumber", "round", "draft", "reported"] as const;

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
    };
  }

  /**
   * Rebuilds a session from untrusted saved state, or returns null if it isn't
   * exactly what `toState` gives (see `Round.fromState`). Never throws.
   */
  static fromState(raw: unknown, words: readonly string[], random: () => number = Math.random): Session | null {
    const fields = plainFields(raw);
    if (!fields || !hasExactKeys(fields, SESSION_STATE_KEYS) || fields.get("version") !== SESSION_STATE_VERSION) {
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
    session.#round = round;
    session.#roundNumber = roundNumber;
    session.#draft = draft;
    session.#reported = reported;
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
