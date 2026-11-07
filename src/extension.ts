import * as vscode from "vscode";
import { NoticeChange, RoundReadyNotice, readAgentSignal } from "./agentSignals.ts";
import { NewRoundRequests, answerWebview, sendNewRound, viewVisibilityChanged } from "./newRoundRequests.ts";
import type { PostMessage } from "./post.ts";
import type { HostHandlers, HostMessage } from "./protocol.ts";
import { StatsStore } from "./stats.ts";
import { ThemeStore } from "./theme.ts";
import { MEDIA_FOLDER, SCRIPT_PATH, STYLE_PATH, buildHtml, createNonce } from "./webview/html.ts";

/** The webview view's id, as contributed in package.json. */
const VIEW_ID = "0xword.game";

/** The "0xWORD: New Round" command, as contributed in package.json. */
const NEW_ROUND_COMMAND = "0xword.newRound";

/** The "0x Round ready" status-bar item's id. */
const ROUND_READY_ID = "0xword.roundReady";

/** The notice's tooltip, also read out as its accessible name. */
const ROUND_READY_LABEL = "0xWORD: a round is ready. Open the panel.";

export function activate(context: vscode.ExtensionContext): void {
  const handlers = hostHandlers(new StatsStore(context.globalState), new ThemeStore(context.globalState));
  const provider = new GameViewProvider(context.extensionUri, handlers);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand(NEW_ROUND_COMMAND, () => provider.newRound()),
    ...agentSignals(),
  );
}

export function deactivate(): void {}

/**
 * Shows "0x Round ready" in the status bar when an agent tool opens the
 * `agent-started` link, and hides it on `agent-finished`. The item never
 * takes focus. Clicking it runs the view's built-in focus command, which
 * opens the panel without touching the round in progress (unlike New Round).
 * The `onUri` activation event lets a link reach this handler before the
 * panel has ever been opened. Returns the disposables to push.
 */
function agentSignals(): vscode.Disposable[] {
  const item = vscode.window.createStatusBarItem(ROUND_READY_ID, vscode.StatusBarAlignment.Right);
  item.name = "0xWORD round ready";
  item.text = "0x Round ready";
  item.tooltip = ROUND_READY_LABEL;
  item.accessibilityInformation = { label: ROUND_READY_LABEL, role: "button" };
  item.command = { command: `${VIEW_ID}.focus`, title: "Open 0xWORD" };
  const notice = new RoundReadyNotice();
  const handler = vscode.window.registerUriHandler({
    // Only plain strings reach the reader; any other link is ignored silently.
    handleUri: (uri) => {
      const change = notice.apply(readAgentSignal({ path: uri.path, query: uri.query, fragment: uri.fragment }));
      if (change === NoticeChange.Show) {
        item.show();
      } else if (change === NoticeChange.Hide) {
        item.hide();
      }
    },
  });
  return [item, handler];
}

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
    // `answerWebview` posts the answer, in order: `init` (retried a few times
    // if it fails), then the rounds requested while the panel was closed. It
    // never rejects, so `void` leaves no unhandled rejection.
    const listener = webview.onDidReceiveMessage((raw: unknown) => {
      void answerWebview(
        raw,
        this.#handlers,
        this.#requests,
        id,
        (message) => post(webview, message),
        this.#postToView,
      );
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
