import * as vscode from "vscode";
import { NewRoundRequests, messagesAfter, sendNewRound, viewVisibilityChanged } from "./newRoundRequests.ts";
import { deliver, type PostMessage } from "./post.ts";
import type { HostHandlers, HostMessage } from "./protocol.ts";
import { StatsStore } from "./stats.ts";
import { ThemeStore } from "./theme.ts";
import { MEDIA_FOLDER, SCRIPT_PATH, STYLE_PATH, buildHtml, createNonce } from "./webview/html.ts";

/** The webview view's id, as contributed in package.json. */
const VIEW_ID = "0xword.game";

/** The "0xWORD: New Round" command, as contributed in package.json. */
const NEW_ROUND_COMMAND = "0xword.newRound";

export function activate(context: vscode.ExtensionContext): void {
  const handlers = hostHandlers(new StatsStore(context.globalState), new ThemeStore(context.globalState));
  const provider = new GameViewProvider(context.extensionUri, handlers);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand(NEW_ROUND_COMMAND, () => provider.newRound()),
  );
}

export function deactivate(): void {}

/**
 * What the host does with valid messages: count finished rounds, report
 * stats, and remember the theme choice. Both stores live in `globalState`, so
 * they apply in every workspace.
 */
function hostHandlers(stats: StatsStore, theme: ThemeStore): HostHandlers {
  return {
    // `record` and `save` never reject, so nothing escapes the message listener.
    roundFinished: (message) => void stats.record(message),
    stats: () => stats.current(),
    setTheme: (choice) => void theme.save(choice),
    theme: () => theme.current(),
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
    // rounds requested while the panel was closed. Neither `deliver` nor
    // `sendNewRound` ever rejects, so `void` leaves no unhandled rejection. An
    // `init` that fails is dropped: the webview asks again with its next `ready`.
    const listener = webview.onDidReceiveMessage((raw: unknown) => {
      for (const message of messagesAfter(raw, this.#handlers, this.#requests, id)) {
        if (message.type === "newRound") {
          void sendNewRound(this.#requests, this.#postToView, this.#requests.generation);
        } else {
          void deliver((reply) => post(webview, reply), message);
        }
      }
    });
    // A hidden view's webview is unloaded, and sends `ready` again when shown.
    // Its HTML is rebuilt while hidden, so the next show opens in the current
    // theme choice rather than the one in the HTML from the last load.
    const visibility = view.onDidChangeVisibility(() => {
      if (viewVisibilityChanged(this.#requests, id, view.visible)) {
        this.#setHtml(webview);
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
    this.#setHtml(webview);
  }

  /**
   * Sets the webview's HTML, with a fresh nonce on every load. The stored
   * theme goes in the HTML so a forced choice shows from the first paint;
   * `init` carries it too. Called on resolve and whenever the view is hidden,
   * never while it's shown (that would reload the panel).
   */
  #setHtml(webview: vscode.Webview): void {
    webview.html = buildHtml({
      cspSource: webview.cspSource,
      nonce: createNonce(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, ...SCRIPT_PATH)).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, ...STYLE_PATH)).toString(),
      theme: this.#handlers.theme(),
    });
  }

  /**
   * Runs "0xWORD: New Round": starts one new round now if the webview is
   * listening, or once it is ready, and opens the panel.
   */
  async newRound(): Promise<void> {
    // Posted now if the webview is listening (and posted again a few times if
    // that fails), otherwise queued for its next `ready`.
    void sendNewRound(this.#requests, this.#postToView, this.#requests.request());
    // Opens the panel, resolving the view first if it was never opened.
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  /** Posts to the current view's webview; resolves false if there's no view. */
  readonly #postToView: PostMessage = (message) =>
    this.#view ? post(this.#view.webview, message) : Promise.resolve(false);
}

/** Posts a message to the webview. Typed, so only protocol messages can be sent. */
function post(webview: vscode.Webview, message: HostMessage): Thenable<boolean> {
  return webview.postMessage(message);
}
