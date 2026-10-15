import { HEX_LENGTH } from "./hex.ts";
import { hasExactKeys, isIntegerInRange, plainFields } from "./plain.ts";
import { Round, type GuessOutcome, type Phase, type RoundState } from "./round.ts";
import { pickAnswer } from "./words.ts";

/**
 * The saved-state format. Bump it when the format changes, and either migrate
 * older state in `fromState` or let it be dropped. Version 2 removed skipped
 * answer tries and the round's `answerTries` count. Version 3 added the
 * half-typed hex row (`draft`). Older state is dropped, so the panel starts
 * fresh.
 */
export const SESSION_STATE_VERSION = 3;

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
}

const SESSION_STATE_KEYS = ["version", "roundNumber", "round", "draft"] as const;

/** Up to 8 uppercase hex digits. */
const DRAFT_PATTERN = new RegExp(`^[0-9A-F]{0,${HEX_LENGTH}}$`);

/**
 * True if `draft` can be the half-typed hex row of a round in `phase`: up to
 * 8 uppercase hex digits, and empty unless the round is waiting for a hex row
 * (so never while a word attempt is due, or once the round is over).
 */
export function isDraft(draft: unknown, phase: Phase): draft is string {
  return typeof draft === "string" && DRAFT_PATTERN.test(draft) && (phase === "guess" || draft === "");
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

  /** Replaces the current round, finished or not, with a fresh one. */
  newRound(): Round {
    const round = new Round(pickAnswer(this.#words, this.#random), this.#wordSet);
    this.#round = round;
    this.#roundNumber++;
    this.#draft = "";
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
    if (!round || !isDraft(draft, round.phase)) {
      return null;
    }
    session.#round = round;
    session.#roundNumber = roundNumber;
    session.#draft = draft;
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
