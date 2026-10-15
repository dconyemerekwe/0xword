// The messages the webview and the extension host exchange, and their
// validators. Pure: no `vscode` import, so it can be unit-tested with
// `node --test` and bundled into the webview too.
//
// Everything arriving through `postMessage` is untrusted (CLAUDE.md security
// rule 7): it is checked against a fixed allowlist, field by field, and only a
// freshly built copy of the allowed fields is ever used.
import { hasExactKeys, isIntegerInRange, plainFields } from "./game/plain.ts";
import { MAX_ROWS, type RoundResult } from "./game/round.ts";
import { parseStatsView, toStatsView, type Stats, type StatsView } from "./stats.ts";

// Webview -> host

/** The webview has loaded and is listening for messages. */
export interface ReadyMessage {
  readonly type: "ready";
}

/**
 * A round has ended. The engine's result without `answer`, so the hidden
 * word is never part of the protocol.
 */
export interface RoundFinishedMessage extends Omit<RoundResult, "answer"> {
  readonly type: "roundFinished";
}

export type WebviewMessage = ReadyMessage | RoundFinishedMessage;

// Host -> webview

/** The host's reply to `ready`, carrying the player's current stats. */
export interface InitMessage {
  readonly type: "init";
  readonly stats: StatsView;
}

/** Start a fresh round: sent once per run of the "0xWORD: New Round" command. */
export interface NewRoundMessage {
  readonly type: "newRound";
}

export type HostMessage = InitMessage | NewRoundMessage;

/**
 * Checks a message from the webview. Returns a new object holding exactly the
 * allowed fields, or null if the message isn't one the host accepts.
 */
export function parseWebviewMessage(raw: unknown): WebviewMessage | null {
  const fields = plainFields(raw);
  switch (fields?.get("type")) {
    case "ready":
      return hasExactKeys(fields, ["type"]) ? { type: "ready" } : null;
    case "roundFinished":
      return parseRoundFinished(fields);
    default:
      return null;
  }
}

/** Checks a message from the host, on the webview side. Null if unknown. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  const fields = plainFields(raw);
  if (fields?.get("type") === "init" && hasExactKeys(fields, ["type", "stats"])) {
    const stats = parseStatsView(fields.get("stats"));
    return stats ? { type: "init", stats } : null;
  }
  if (fields?.get("type") === "newRound" && hasExactKeys(fields, ["type"])) {
    return { type: "newRound" };
  }
  return null;
}

/** What the host does with a valid message. Kept outside so it can be faked in tests. */
export interface HostHandlers {
  /** Called with a validated `roundFinished`. Must not throw. */
  roundFinished(message: RoundFinishedMessage): void;
  /** The current stats, sent with `init`. Must not throw. */
  stats(): Stats;
}

/**
 * The host's dispatch: validates `raw`, acts on it, and returns the reply to
 * post back, or null for no reply. Invalid messages are ignored: no handler
 * runs, nothing is thrown and null is returned.
 */
export function handleWebviewMessage(raw: unknown, handlers: HostHandlers): HostMessage | null {
  const message = parseWebviewMessage(raw);
  switch (message?.type) {
    case "ready":
      return { type: "init", stats: toStatsView(handlers.stats()) };
    case "roundFinished":
      handlers.roundFinished(message);
      return null;
    default:
      return null;
  }
}

const ROUND_FINISHED_KEYS = ["type", "solved", "rowsUsed", "answerTries", "hintsUsed"] as const;

/**
 * Checks the fields against what a real round can produce (see `Round`):
 * - `rowsUsed` is 1 to `MAX_ROWS`
 * - `answerTries` equals `rowsUsed`: every scored row is followed by exactly
 *   one answer try, with no skipping
 * - a failed round used every row and the forced final answer
 */
function parseRoundFinished(fields: ReadonlyMap<string, unknown>): RoundFinishedMessage | null {
  if (!hasExactKeys(fields, ROUND_FINISHED_KEYS)) {
    return null;
  }
  const solved = fields.get("solved");
  const rowsUsed = fields.get("rowsUsed");
  const answerTries = fields.get("answerTries");
  const hintsUsed = fields.get("hintsUsed");
  if (typeof solved !== "boolean" || typeof hintsUsed !== "boolean") {
    return null;
  }
  if (!isIntegerInRange(rowsUsed, 1, MAX_ROWS) || !isIntegerInRange(answerTries, 1, MAX_ROWS)) {
    return null;
  }
  if (answerTries !== rowsUsed || (!solved && rowsUsed !== MAX_ROWS)) {
    return null;
  }
  return { type: "roundFinished", solved, rowsUsed, answerTries, hintsUsed };
}
