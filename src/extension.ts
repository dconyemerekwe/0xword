import * as vscode from "vscode";
import { NewRoundRequests } from "./newRoundRequests.ts";
import { handleWebviewMessage, type HostHandlers, type HostMessage } from "./protocol.ts";
import { MEDIA_FOLDER, SCRIPT_PATH, buildHtml, createNonce } from "./webview/html.ts";

/** The webview view's id, as contributed in package.json. */
const VIEW_ID = "0xword.game";

/** The "0xWORD: New Round" command, as contributed in package.json. */
const NEW_ROUND_COMMAND = "0xword.newRound";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new GameViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand(NEW_ROUND_COMMAND, () => provider.newRound()),
  );
}

export function deactivate(): void {}

/** What the host does with valid messages. Nothing yet: stats arrive in story #8. */
const handlers: HostHandlers = {
  roundFinished: () => {},
};

/** Fills the 0xWORD side panel with the bundled webview. */
class GameViewProvider implements vscode.WebviewViewProvider {
  readonly #extensionUri: vscode.Uri;
  readonly #requests = new NewRoundRequests();
  #view: vscode.WebviewView | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.#extensionUri = extensionUri;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    // A new or reloaded webview isn't listening until it sends `ready`.
    this.#requests.reset();
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
      // `init` answers `ready`: send the rounds requested while the panel was closed.
      if (reply?.type === "init") {
        for (let i = this.#requests.ready(); i > 0; i--) {
          this.#postNewRound(webview);
        }
      }
    });
    // A hidden view's webview is unloaded, and sends `ready` again when shown.
    const visibility = view.onDidChangeVisibility(() => {
      if (!view.visible) {
        this.#requests.reset();
      }
    });
    view.onDidDispose(() => {
      listener.dispose();
      visibility.dispose();
      this.#requests.reset();
      if (this.#view === view) {
        this.#view = undefined;
      }
    });
    // A fresh nonce on every load.
    webview.html = buildHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, ...SCRIPT_PATH)).toString(),
    });
  }

  /**
   * Runs "0xWORD: New Round": starts one new round now if the webview is
   * listening, or once it is ready, and opens the panel.
   */
  async newRound(): Promise<void> {
    if (this.#requests.request() && this.#view) {
      this.#postNewRound(this.#view.webview);
    }
    // Opens the panel, resolving the view first if it was never opened.
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  /** Posts `newRound`, and queues it again if the webview didn't get it. */
  #postNewRound(webview: vscode.Webview): void {
    post(webview, { type: "newRound" }).then(
      (delivered) => {
        if (!delivered) {
          this.#requests.undelivered();
        }
      },
      () => this.#requests.undelivered(),
    );
  }
}

/** Posts a message to the webview. Typed, so only protocol messages can be sent. */
function post(webview: vscode.Webview, message: HostMessage): Thenable<boolean> {
  return webview.postMessage(message);
}
