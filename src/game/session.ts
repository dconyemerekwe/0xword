import { hasExactKeys, isIntegerInRange, plainFields } from "./plain.ts";
import { Round, type RoundState } from "./round.ts";
import { pickAnswer } from "./words.ts";

/**
 * The saved-state format. Bump it when the format changes, and either migrate
 * older state in `fromState` or let it be dropped. Version 2 removed skipped
 * answer tries; version-1 state is dropped, so the panel starts fresh.
 */
export const SESSION_STATE_VERSION = 2;

/**
 * A session saved as plain data. It holds the hidden answer, so it must never
 * be shown or sent to the host (the webview keeps it in its own saved state).
 */
export interface SessionState {
  readonly version: typeof SESSION_STATE_VERSION;
  readonly roundNumber: number;
  readonly round: RoundState;
}

const SESSION_STATE_KEYS = ["version", "roundNumber", "round"] as const;

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

  /** Replaces the current round, finished or not, with a fresh one. */
  newRound(): Round {
    const round = new Round(pickAnswer(this.#words, this.#random), this.#wordSet);
    this.#round = round;
    this.#roundNumber++;
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
    return { version: SESSION_STATE_VERSION, roundNumber: this.#roundNumber, round: this.#round.toState() };
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
    if (!round) {
      return null;
    }
    session.#round = round;
    session.#roundNumber = roundNumber;
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
