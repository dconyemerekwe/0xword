import * as vscode from "vscode";
import { handleWebviewMessage, type HostHandlers, type HostMessage } from "./protocol.ts";
import { MEDIA_FOLDER, SCRIPT_PATH, buildHtml, createNonce } from "./webview/html.ts";

/** The webview view's id, as contributed in package.json. */
const VIEW_ID = "0xword.game";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new GameViewProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider));
}

export function deactivate(): void {}

/** What the host does with valid messages. Nothing yet: stats arrive in story #8. */
const handlers: HostHandlers = {
  roundFinished: () => {},
};

/** Fills the 0xWORD side panel with the bundled webview. */
class GameViewProvider implements vscode.WebviewViewProvider {
  readonly #extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.#extensionUri = extensionUri;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    const webview = view.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, MEDIA_FOLDER)],
    };
    // Listen before setting the HTML, so the webview's `ready` can't be missed.
    // Every message goes through the protocol's validator; invalid ones are ignored.
    const listener = webview.onDidReceiveMessage((raw: unknown) => {
      const reply = handleWebviewMessage(raw, handlers);
      if (reply) {
        void post(webview, reply);
      }
    });
    view.onDidDispose(() => listener.dispose());
    // A fresh nonce on every load.
    webview.html = buildHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, ...SCRIPT_PATH)).toString(),
    });
  }
}

/** Posts a message to the webview. Typed, so only protocol messages can be sent. */
function post(webview: vscode.Webview, message: HostMessage): Thenable<boolean> {
  return webview.postMessage(message);
}
