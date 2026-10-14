import * as vscode from "vscode";
import { MEDIA_FOLDER, SCRIPT_PATH, buildHtml, createNonce } from "./webview/html.ts";

/** The webview view's id, as contributed in package.json. */
const VIEW_ID = "0xword.game";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new GameViewProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider));
}

export function deactivate(): void {}

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
    // A fresh nonce on every load.
    webview.html = buildHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, ...SCRIPT_PATH)).toString(),
    });
  }
}
