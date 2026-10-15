// The player's running stats: counted from finished rounds and kept in one
// `globalState` key. Pure: no `vscode` import, so it can be unit-tested with
// `node --test` and bundled into the webview (which checks `init` with it).
//
// Stats never leave the machine (CLAUDE.md security rule 9): they are stored
// locally and only ever posted to the extension's own webview.
import { hasExactKeys, isIntegerInRange, plainFields } from "./fields.ts";
import { MAX_ROWS, type RoundResult } from "./game/round.ts";

/** The `globalState` key. Versioned, so a later shape can migrate from it. */
export const STATS_KEY = "0xword.stats.v1";

/** The stored counts. Every other number is derived from these. */
export interface Stats {
  /** Rounds finished, solved or not. */
  readonly played: number;
  /** Rounds solved. */
  readonly solved: number;
  /** Hex rows used, added up over solved rounds only. */
  readonly solvedRowsTotal: number;
  /** Rounds in which hints were turned on. */
  readonly hintsUsedCount: number;
}

/** Values worked out from `Stats`. Null where the division would be by zero. */
export interface DerivedStats {
  /** `solvedRowsTotal / solved`, or null before the first solved round. */
  readonly averageRows: number | null;
  /** `hintsUsedCount / played` (0 to 1), or null before the first round. */
  readonly hintsUsedRate: number | null;
}

/** The counts plus the derived values: what `init` carries to the webview. */
export type StatsView = Stats & DerivedStats;

/** The fields of a finished round that stats count. */
export type FinishedRound = Pick<RoundResult, "solved" | "rowsUsed" | "hintsUsed">;

export const EMPTY_STATS: Stats = { played: 0, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0 };

const STATS_KEYS = ["played", "solved", "solvedRowsTotal", "hintsUsedCount"] as const;
const STATS_VIEW_KEYS = [...STATS_KEYS, "averageRows", "hintsUsedRate"] as const;

/**
 * Reads stored stats. Anything that isn't a valid `Stats` (nothing stored, a
 * string, negative or fractional counts, more solved than played, ...) gives
 * zeros instead of throwing, so one bad value can't break the extension.
 */
export function parseStats(raw: unknown): Stats {
  return checkStats(raw) ?? EMPTY_STATS;
}

/**
 * Counts one finished round. Returns a new object; `stats` is unchanged. The
 * round must already be validated (see `parseWebviewMessage`). If `played` is
 * already at the largest safe integer, the stats are returned as they are.
 */
export function recordResult(stats: Stats, round: FinishedRound): Stats {
  if (stats.played >= Number.MAX_SAFE_INTEGER) {
    return stats;
  }
  return {
    played: stats.played + 1,
    solved: stats.solved + (round.solved ? 1 : 0),
    solvedRowsTotal: stats.solvedRowsTotal + (round.solved ? round.rowsUsed : 0),
    hintsUsedCount: stats.hintsUsedCount + (round.hintsUsed ? 1 : 0),
  };
}

/** Works out the average rows and the hints-used rate. */
export function deriveStats(stats: Stats): DerivedStats {
  return {
    averageRows: stats.solved === 0 ? null : stats.solvedRowsTotal / stats.solved,
    hintsUsedRate: stats.played === 0 ? null : stats.hintsUsedCount / stats.played,
  };
}

/** The counts and derived values together, as a new flat object. */
export function toStatsView(stats: Stats): StatsView {
  return { ...copyStats(stats), ...deriveStats(stats) };
}

/**
 * Checks a `StatsView` from the host, on the webview side. Strict: exactly the
 * view's fields, valid counts, and derived values that match the counts.
 * Returns a new object, or null if anything is off.
 */
export function parseStatsView(raw: unknown): StatsView | null {
  const fields = plainFields(raw);
  if (!fields || !hasExactKeys(fields, STATS_VIEW_KEYS)) {
    return null;
  }
  const stats = checkStats(Object.fromEntries(STATS_KEYS.map((key) => [key, fields.get(key)])));
  if (!stats) {
    return null;
  }
  const view = toStatsView(stats);
  const matches = fields.get("averageRows") === view.averageRows && fields.get("hintsUsedRate") === view.hintsUsedRate;
  return matches ? view : null;
}

/**
 * Where stats are kept. `vscode.Memento` (`context.globalState`) fits this
 * shape; tests pass a fake.
 */
export interface StatsStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/**
 * Reads and records stats in one storage key. Never throws or rejects:
 * stats are a nice-to-have and must not break the message listener.
 */
export class StatsStore {
  readonly #storage: StatsStorage;

  constructor(storage: StatsStorage) {
    this.#storage = storage;
  }

  /** The current stats; zeros if nothing valid is stored or reading fails. */
  current(): Stats {
    try {
      return parseStats(this.#storage.get(STATS_KEY));
    } catch {
      return EMPTY_STATS;
    }
  }

  /**
   * Counts a finished round and saves the result. The whole new object is
   * written to the one key in a single update, so a failed write leaves the
   * previous stats in place rather than a half-written mix. Resolves once
   * saved, and also if saving failed (the round is then simply not counted).
   */
  async record(round: FinishedRound): Promise<void> {
    try {
      await this.#storage.update(STATS_KEY, recordResult(this.current(), round));
    } catch {
      // Nothing to recover: the stored stats are unchanged.
    }
  }
}

/** The stats in `raw` as a new object, or null if `raw` isn't valid `Stats`. */
function checkStats(raw: unknown): Stats | null {
  const fields = plainFields(raw);
  if (!fields || !hasExactKeys(fields, STATS_KEYS)) {
    return null;
  }
  const played = fields.get("played");
  const solved = fields.get("solved");
  const solvedRowsTotal = fields.get("solvedRowsTotal");
  const hintsUsedCount = fields.get("hintsUsedCount");
  if (
    !isIntegerInRange(played, 0, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(solved, 0, played) ||
    !isIntegerInRange(hintsUsedCount, 0, played) ||
    // Each solved round used 1 to MAX_ROWS rows.
    !isIntegerInRange(solvedRowsTotal, solved, solved * MAX_ROWS)
  ) {
    return null;
  }
  return { played, solved, solvedRowsTotal, hintsUsedCount };
}

function copyStats({ played, solved, solvedRowsTotal, hintsUsedCount }: Stats): Stats {
  return { played, solved, solvedRowsTotal, hintsUsedCount };
}
