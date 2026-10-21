// The messages the webview and the extension host exchange, and their
// validators. Pure: no `vscode` import, so it can be unit-tested with
// `node --test` and bundled into the webview too.
//
// Everything arriving through `postMessage` is untrusted (CLAUDE.md security
// rule 7): it is checked against a fixed allowlist, field by field, and only a
// freshly built copy of the allowed fields is ever used.
import { hasExactKeys, isIntegerInRange, plainFields } from "./game/plain.ts";
import { MAX_ROWS, type RoundResult } from "./game/round.ts";
import { WORD_LIST_SIZE } from "./game/words.ts";
import { parseStatsView, toStatsView, type Stats, type StatsView } from "./stats.ts";
import { isTheme, type Theme } from "./theme.ts";

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

/** The player pressed the theme button: remember this choice in every workspace. */
export interface SetThemeMessage {
  readonly type: "setTheme";
  readonly theme: Theme;
}

export type WebviewMessage = ReadyMessage | RoundFinishedMessage | SetThemeMessage;

// Host -> webview

/** The host's reply to `ready`, carrying the player's current stats and theme choice. */
export interface InitMessage {
  readonly type: "init";
  readonly stats: StatsView;
  readonly theme: Theme;
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
    case "setTheme": {
      const theme = fields.get("theme");
      return hasExactKeys(fields, ["type", "theme"]) && isTheme(theme) ? { type: "setTheme", theme } : null;
    }
    default:
      return null;
  }
}

/** Checks a message from the host, on the webview side. Null if unknown. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  const fields = plainFields(raw);
  if (fields?.get("type") === "init" && hasExactKeys(fields, ["type", "stats", "theme"])) {
    const stats = parseStatsView(fields.get("stats"));
    const theme = fields.get("theme");
    return stats && isTheme(theme) ? { type: "init", stats, theme } : null;
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
  /** Called with a validated `setTheme` choice. Must not throw. */
  setTheme(theme: Theme): void;
  /** The stored theme choice, sent with `init`. Must not throw. */
  theme(): Theme;
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
      return { type: "init", stats: toStatsView(handlers.stats()), theme: handlers.theme() };
    case "roundFinished":
      handlers.roundFinished(message);
      return null;
    case "setTheme":
      handlers.setTheme(message.theme);
      return null;
    default:
      return null;
  }
}

const ROUND_FINISHED_KEYS = ["type", "solved", "rowsUsed", "answerTries", "hintsUsed"] as const;

/**
 * Checks the fields against what a real round can produce (see `Round`):
 * - `rowsUsed` is 1 to `MAX_ROWS`
 * - a failed round used every row and the forced final answer
 * - `answerTries` is at least 1, since every round ends with a word attempt
 *   (the right word, or the wrong final answer)
 * - tries are unlimited, but a word already tried is rejected, so each
 *   listed word counts at most once. A solved round's tries are at most
 *   every word in the list (all the others wrong, then the answer); a failed
 *   one's at most every word but the answer. Both are reachable: the wrong
 *   words can all be tried after row 1.
 */
function parseRoundFinished(fields: ReadonlyMap<string, unknown>): RoundFinishedMessage | null {
  if (!hasExactKeys(fields, ROUND_FINISHED_KEYS)) {
    return null;
  }
  const solved = fields.get("solved");
  const rowsUsed = fields.get("rowsUsed");
  const answerTries = fields.get("answerTries");
  const hintsUsed = fields.get("hintsUsed");
  if (
    typeof solved !== "boolean" ||
    typeof hintsUsed !== "boolean" ||
    !isIntegerInRange(rowsUsed, 1, MAX_ROWS) ||
    !isIntegerInRange(answerTries, 1, solved ? WORD_LIST_SIZE : WORD_LIST_SIZE - 1)
  ) {
    return null;
  }
  if (!solved && rowsUsed !== MAX_ROWS) {
    return null;
  }
  return { type: "roundFinished", solved, rowsUsed, answerTries, hintsUsed };
}
