// Webview entry point, bundled to media/dist/main.js. Phase 2 placeholder:
// the game UI arrives in Phase 3.
import { parseHostMessage, type WebviewMessage } from "../src/protocol.ts";

/** The part of the VS Code webview API we use, typed to the protocol. */
interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

/** Provided by VS Code inside the webview. May be called only once per load. */
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const app = document.getElementById("app");

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = parseHostMessage(event.data);
  if (message?.type === "init" && app) {
    // Set from the script after the host replied, so seeing this text proves
    // the bundle ran and the message round trip works.
    app.textContent = "0xWORD is ready. The game is on its way.";
  }
});

// Listen first, then tell the host we're ready.
vscode.postMessage({ type: "ready" });
