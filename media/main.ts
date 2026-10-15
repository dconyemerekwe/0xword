// Webview entry point, bundled to media/dist/main.js. Phase 2 placeholder:
// the game UI arrives in Phase 3.
import { restoreSession, type SessionState } from "../src/game/session.ts";
import { parseWordList } from "../src/game/words.ts";
import { parseHostMessage, type WebviewMessage } from "../src/protocol.ts";
import type { StatsView } from "../src/stats.ts";
// Inlined into the bundle as a string by esbuild's text loader.
import wordList from "../src/game/words.txt";

/** The part of the VS Code webview API we use, typed to the protocol. */
interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  /** This webview's saved state: kept while hidden and across restarts. Untrusted. */
  getState(): unknown;
  setState(state: SessionState): void;
}

/** Provided by VS Code inside the webview. May be called only once per load. */
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");
// Restore before saying `ready`, so `init` knows whether a round is already
// in progress. Invalid saved state is dropped and a fresh session starts.
const session = restoreSession(vscode.getState(), parseWordList(wordList));
/** The stats from the latest `init`; null until the host has replied. */
let stats: StatsView | null = null;
render();

/**
 * Saves the session and redraws. Every game action (new round, guess, answer,
 * hints) must end with this call, or the move is lost the next time the panel
 * is hidden and the webview reloads. The saved state holds the answer:
 * that's fine, because it stays in VS Code's own storage for this webview.
 * It is never put in the DOM or in a message to the host.
 */
function changed(): void {
  const state = session.toState();
  if (state) {
    vscode.setState(state);
  }
  render();
}

/**
 * Shows the round number and a plain-text preview of the stats `init`
 * carries; Phase 3 shows them properly. Never shows the answer.
 */
function render(): void {
  if (!app) {
    return;
  }
  const lines: string[] = [];
  if (session.round) {
    lines.push(`Round ${session.roundNumber}`);
  }
  if (stats) {
    lines.push(`Played ${stats.played}, solved ${stats.solved}.`);
  }
  app.replaceChildren(
    ...lines.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }),
  );
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = parseHostMessage(event.data);
  switch (message?.type) {
    case "init":
      stats = message.stats;
      // The first round starts once the host has answered `ready`, unless
      // one was restored.
      if (session.ensureRound()) {
        changed();
      } else {
        render();
      }
      break;
    case "newRound":
      session.newRound();
      changed();
      break;
  }
});

// Listen first, then tell the host we're ready.
vscode.postMessage({ type: "ready" });
