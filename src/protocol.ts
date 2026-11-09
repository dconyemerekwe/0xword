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

/**
 * The agent has been working for the `open` mode's delay and the panel was
 * opened (#111): show the round in progress as it is, or start a new one if
 * the result card shows or no round was played. The webview decides, since
 * only it knows the round. Never carries anything from the link.
 */
export interface AgentOpenMessage {
  readonly type: "agentOpen";
}

/**
 * The agent has finished a run, in `notify` or `open` mode (#112): the
 * webview says so on its message line if a round is in progress. Sent only
 * to a webview that is listening right then, never kept for a later load.
 * Never carries anything from the link.
 */
export interface AgentFinishedMessage {
  readonly type: "agentFinished";
}

/**
 * The agent has started a run, in `notify` or `open` mode (#112): the webview
 * clears a "finished" message left from the last run, so the line never says
 * "finished" while the agent works. Delivered like `agentFinished`. Never
 * carries anything from the link.
 */
export interface AgentStartedMessage {
  readonly type: "agentStarted";
}

export type HostMessage =
  | InitMessage
  | NewRoundMessage
  | AgentOpenMessage
  | AgentFinishedMessage
  | AgentStartedMessage;

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
  if (fields?.get("type") === "agentOpen" && hasExactKeys(fields, ["type"])) {
    return { type: "agentOpen" };
  }
  if (fields?.get("type") === "agentFinished" && hasExactKeys(fields, ["type"])) {
    return { type: "agentFinished" };
  }
  if (fields?.get("type") === "agentStarted" && hasExactKeys(fields, ["type"])) {
    return { type: "agentStarted" };
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
 * Checks the fields against what a real round can produce (see `Round`).
 * Every round ends with its one try at the decode step, reached by a fully
 * right row (at any of rows 1 to 6) or by row 6:
 * - `rowsUsed` is 1 to `MAX_ROWS`, solved or failed: a wrong word after a
 *   solved grid fails the round with rows left
 * - `answerTries` is exactly 1. The counts sent before #46 (more than one
 *   try) are rejected
 * - `hintsUsed` counts one hint per row with hints on before it was scored,
 *   and none after the last row, since Hints locks with the hex: 0 to
 *   `rowsUsed`. The `rowsUsed + 1` sent before #46 is rejected, and so is
 *   the one-way boolean sent before #38.
 *
 * Every combination in those ranges is reachable.
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
    !isIntegerInRange(rowsUsed, 1, MAX_ROWS) ||
    answerTries !== 1 ||
    !isIntegerInRange(hintsUsed, 0, rowsUsed)
  ) {
    return null;
  }
  return { type: "roundFinished", solved, rowsUsed, answerTries, hintsUsed };
}
