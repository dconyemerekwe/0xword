// Reads the two agent links, `vscode://dconyemerekwe.0xword/agent-started`
// and `…/agent-finished`, and tracks the "0x Round ready" notice they show
// and hide. Pure: no `vscode` import, so it can be unit-tested with
// `node --test`.
//
// Links are untrusted (CLAUDE.md rule 7): any program or web page on the
// machine can open one. Only the two exact paths, case-sensitive, with no
// query and no fragment, do anything. Everything else is ignored without an
// error, and nothing in a link is ever used as data.
//
// The link's host part (`dconyemerekwe.0xword`) isn't read here: VS Code
// routes a link to an extension by its ID, without regard to letter case.
// So "a different letter case" is checked on the path only.

/** What an agent link asks for. */
export const AgentSignal = {
  Started: "started",
  Finished: "finished",
} as const;
export type AgentSignal = (typeof AgentSignal)[keyof typeof AgentSignal];

/** The only paths that do anything, each with the signal it sends. */
const PATHS: ReadonlyMap<string, AgentSignal> = new Map([
  ["/agent-started", AgentSignal.Started],
  ["/agent-finished", AgentSignal.Finished],
]);

/** The parts of a link the extension reads, as plain strings. */
export interface AgentLink {
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
}

/**
 * The signal a link sends, or null for any other link: another path, a
 * trailing slash, extra segments, another letter case, or any query or
 * fragment. Never throws.
 */
export function readAgentSignal(link: AgentLink): AgentSignal | null {
  if (link.query !== "" || link.fragment !== "") {
    return null;
  }
  return PATHS.get(link.path) ?? null;
}

/**
 * What the line under the result card says about the agent (#121): nothing,
 * "still working" or "finished". The host decides it from the last signal
 * and the mode (`agentStateFor` in noticeSettings.ts) and sends it to the
 * webview as `agentState`.
 */
export const AgentState = {
  /** No line: `off` mode, or no signal has arrived since VS Code started. */
  None: "none",
  /** The last signal was `started`. */
  Working: "working",
  /** The last signal was `finished`. */
  Finished: "finished",
} as const;
export type AgentState = (typeof AgentState)[keyof typeof AgentState];

/** The states a message may carry. */
const AGENT_STATES: ReadonlySet<unknown> = new Set(Object.values(AgentState));

/** True if `value` is one of the agent states, exactly. */
export function isAgentState(value: unknown): value is AgentState {
  return AGENT_STATES.has(value);
}

/** What to do to the status-bar notice after a signal. */
export const NoticeChange = {
  Show: "show",
  Hide: "hide",
} as const;
export type NoticeChange = (typeof NoticeChange)[keyof typeof NoticeChange];

/**
 * Whether a "round ready" notice is due, which is while the agent is working.
 * There is at most one: `started` shows it if it's hidden, `finished` hides
 * it if it's showing, and any other signal changes nothing. This is tracked
 * even in `off` mode, which shows nothing, so switching to `notify` mid-run
 * shows the notices straight away. Which notices show is decided in
 * noticeSettings.ts.
 */
export class RoundReadyNotice {
  #showing = false;
  #lastSignal: AgentSignal | null = null;

  /** True while the notice is due: from `started` until `finished`. */
  get showing(): boolean {
    return this.#showing;
  }

  /**
   * The last signal since the extension started, repeats included, or null
   * if none has arrived yet (#121). A link that isn't a signal doesn't count.
   * Kept in memory only, so it starts again at null when VS Code restarts.
   */
  get lastSignal(): AgentSignal | null {
    return this.#lastSignal;
  }

  /**
   * Records `signal` and returns the change to make to the status bar, or
   * null if the notice is already in the right state (or the link wasn't a
   * signal).
   */
  apply(signal: AgentSignal | null): NoticeChange | null {
    if (signal !== null) {
      this.#lastSignal = signal;
    }
    if (signal === AgentSignal.Started && !this.#showing) {
      this.#showing = true;
      return NoticeChange.Show;
    }
    if (signal === AgentSignal.Finished && this.#showing) {
      this.#showing = false;
      return NoticeChange.Hide;
    }
    return null;
  }
}
