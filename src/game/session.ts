import { Round } from "./round.ts";
import { pickAnswer } from "./words.ts";

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
}
