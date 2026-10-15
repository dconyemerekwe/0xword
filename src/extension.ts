import * as vscode from "vscode";
import { NewRoundRequests, messagesAfter } from "./newRoundRequests.ts";
import type { HostHandlers, HostMessage } from "./protocol.ts";
import { StatsStore } from "./stats.ts";
import { MEDIA_FOLDER, SCRIPT_PATH, STYLE_PATH, buildHtml, createNonce } from "./webview/html.ts";

/** The webview view's id, as contributed in package.json. */
const VIEW_ID = "0xword.game";

/** The "0xWORD: New Round" command, as contributed in package.json. */
const NEW_ROUND_COMMAND = "0xword.newRound";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new GameViewProvider(context.extensionUri, statsHandlers(new StatsStore(context.globalState)));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand(NEW_ROUND_COMMAND, () => provider.newRound()),
  );
}

export function deactivate(): void {}

/** What the host does with valid messages: count finished rounds and report stats. */
function statsHandlers(store: StatsStore): HostHandlers {
  return {
    // `record` never rejects, so nothing escapes the message listener.
    roundFinished: (message) => void store.record(message),
    stats: () => store.current(),
  };
}

/** Fills the 0xWORD side panel with the bundled webview. */
class GameViewProvider implements vscode.WebviewViewProvider {
  readonly #extensionUri: vscode.Uri;
  readonly #handlers: HostHandlers;
  readonly #requests = new NewRoundRequests();
  #view: vscode.WebviewView | undefined;

  constructor(extensionUri: vscode.Uri, handlers: HostHandlers) {
    this.#extensionUri = extensionUri;
    this.#handlers = handlers;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    // A new webview isn't listening until it sends `ready`. Late events from
    // earlier views carry their old id and are ignored.
    const id = this.#requests.attach();
    const webview = view.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, MEDIA_FOLDER)],
    };
    // Listen before setting the HTML, so the webview's `ready` can't be missed.
    // Every message goes through the protocol's validator; invalid ones are ignored.
    // `messagesAfter` decides what to post back, in order: `init`, then the
    // rounds requested while the panel was closed.
    const listener = webview.onDidReceiveMessage((raw: unknown) => {
      for (const message of messagesAfter(raw, this.#handlers, this.#requests, id)) {
        if (message.type === "newRound") {
          this.#postNewRound(webview, this.#requests.generation);
        } else {
          void post(webview, message);
        }
      }
    });
    // A hidden view's webview is unloaded, and sends `ready` again when shown.
    const visibility = view.onDidChangeVisibility(() => {
      if (!view.visible) {
        this.#requests.reset(id);
      }
    });
    view.onDidDispose(() => {
      listener.dispose();
      visibility.dispose();
      // Only this view's id: a newer view that is already listening stays ready.
      this.#requests.reset(id);
      if (this.#view === view) {
        this.#view = undefined;
      }
    });
    // A fresh nonce on every load.
    webview.html = buildHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, ...SCRIPT_PATH)).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, ...STYLE_PATH)).toString(),
    });
  }

  /**
   * Runs "0xWORD: New Round": starts one new round now if the webview is
   * listening, or once it is ready, and opens the panel.
   */
  async newRound(): Promise<void> {
    this.#sendNewRound(this.#requests.request());
    // Opens the panel, resolving the view first if it was never opened.
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  /** Posts `newRound` to the current view under `generation`; null means it was queued. */
  #sendNewRound(generation: number | null): void {
    if (generation === null) {
      return;
    }
    if (this.#view) {
      this.#postNewRound(this.#view.webview, generation);
    } else {
      // No view to post to: queue it for the next `ready`.
      this.#sendNewRound(this.#requests.undelivered(generation));
    }
  }

  /** Posts `newRound`, and sends or queues it again if the webview didn't get it. */
  #postNewRound(webview: vscode.Webview, generation: number): void {
    const retry = (): void => this.#sendNewRound(this.#requests.undelivered(generation));
    post(webview, { type: "newRound" }).then((delivered) => {
      if (!delivered) {
        retry();
      }
    }, retry);
  }
}

/** Posts a message to the webview. Typed, so only protocol messages can be sent. */
function post(webview: vscode.Webview, message: HostMessage): Thenable<boolean> {
  return webview.postMessage(message);
}
