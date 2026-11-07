// Reads the two agent links, `vscode://dconyemerekwe.0xword/agent-started`
// and `…/agent-finished`, and tracks the "0x Round ready" notice they show
// and hide. Pure: no `vscode` import, so it can be unit-tested with
// `node --test`.
//
// Links are untrusted (CLAUDE.md rule 7): any program or web page on the
// machine can open one. Only the two exact paths, case-sensitive, with no
// query and no fragment, do anything. Everything else is ignored without an
// error, and nothing in a link is ever used as data.

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

/** What to do to the status-bar notice after a signal. */
export const NoticeChange = {
  Show: "show",
  Hide: "hide",
} as const;
export type NoticeChange = (typeof NoticeChange)[keyof typeof NoticeChange];

/**
 * Whether the "0x Round ready" notice is showing. There is at most one:
 * `started` shows it if it's hidden, `finished` hides it if it's showing,
 * and any other signal changes nothing.
 */
export class RoundReadyNotice {
  #showing = false;

  /** True while the notice is showing. */
  get showing(): boolean {
    return this.#showing;
  }

  /**
   * Records `signal` and returns the change to make to the status bar, or
   * null if the notice is already in the right state (or the link wasn't a
   * signal).
   */
  apply(signal: AgentSignal | null): NoticeChange | null {
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
