// Webview entry point, bundled to media/dist/main.js. Phase 2 placeholder:
// the game UI arrives in Phase 3.
import { Session } from "../src/game/session.ts";
import { parseWordList } from "../src/game/words.ts";
import { parseHostMessage, type WebviewMessage } from "../src/protocol.ts";
// Inlined into the bundle as a string by esbuild's text loader.
import wordList from "../src/game/words.txt";

/** The part of the VS Code webview API we use, typed to the protocol. */
interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

/** Provided by VS Code inside the webview. May be called only once per load. */
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");
const session = new Session(parseWordList(wordList));

/** Starts a fresh engine round and shows its number. Never shows the answer. */
function startRound(): void {
  session.newRound();
  if (app) {
    app.textContent = `Round ${session.roundNumber}`;
  }
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = parseHostMessage(event.data);
  switch (message?.type) {
    case "init":
      // The first round starts as soon as the host has answered `ready`.
      if (!session.round) {
        startRound();
      }
      break;
    case "newRound":
      startRound();
      break;
  }
});

// Listen first, then tell the host we're ready.
vscode.postMessage({ type: "ready" });
