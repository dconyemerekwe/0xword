import * as vscode from "vscode";
import { RoundReadyNotice, readAgentSignal } from "./agentSignals.ts";
import { NewRoundRequests, answerWebview, sendNewRound, viewVisibilityChanged } from "./newRoundRequests.ts";
import {
  SETTINGS_SECTION,
  readNoticeSettings,
  showPopup,
  visibleNotices,
  type NoticeSettings,
} from "./noticeSettings.ts";
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

/** The badge's tooltip on the 0xWORD icon, also read out as its accessible label. */
const BADGE_LABEL = "0xWORD: a round is ready";

/** The pop-up's message and its two buttons. */
const POPUP_MESSAGE = "0xWORD: a round is ready while your agent works.";
const POPUP_PLAY = "Play";
const POPUP_NOT_NOW = "Not now";

export function activate(context: vscode.ExtensionContext): void {
  const handlers = hostHandlers(new StatsStore(context.globalState), new ThemeStore(context.globalState));
  const provider = new GameViewProvider(context.extensionUri, handlers);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
    vscode.commands.registerCommand(NEW_ROUND_COMMAND, () => provider.newRound()),
    ...agentSignals(provider),
  );
}

export function deactivate(): void {}

/**
 * Shows the "round ready" notices the player has switched on in Settings
 * while an agent works: from the `agent-started` link until `agent-finished`.
 * None takes focus. Clicking the status-bar item, or Play on the pop-up, runs
 * the view's built-in focus command, which opens the panel without touching
 * the round in progress (unlike New Round). The `onUri` activation event lets
 * a link reach this handler before the panel has ever been opened.
 *
 * The settings are read again on every signal and every change, so a change
 * applies straight away, and are never stored. "Agent working" is tracked
 * even when the settings show nothing. Returns the disposables to push.
 */
function agentSignals(provider: GameViewProvider): vscode.Disposable[] {
  const item = vscode.window.createStatusBarItem(ROUND_READY_ID, vscode.StatusBarAlignment.Right);
  item.name = "0xWORD round ready";
  item.text = "0x Round ready";
  item.tooltip = ROUND_READY_LABEL;
  item.accessibilityInformation = { label: ROUND_READY_LABEL, role: "button" };
  item.command = { command: `${VIEW_ID}.focus`, title: "Open 0xWORD" };
  const notice = new RoundReadyNotice();
  /** Shows or hides the lasting notices to match the signals and settings. */
  const update = (settings: NoticeSettings): void => {
    const visible = visibleNotices(notice.showing, settings);
    if (visible.statusBar) {
      item.show();
    } else {
      item.hide();
    }
    provider.setBadge(visible.badge);
  };
  const handler = vscode.window.registerUriHandler({
    // Only plain strings reach the reader; any other link is ignored silently.
    // Nothing from the link reaches a notice: each one's text is fixed.
    handleUri: (uri) => {
      const change = notice.apply(readAgentSignal({ path: uri.path, query: uri.query, fragment: uri.fragment }));
      const settings = noticeSettings();
      update(settings);
      if (showPopup(change, settings)) {
        roundReadyPopup();
      }
    },
  });
  const settingsListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SETTINGS_SECTION)) {
      update(noticeSettings());
    }
  });
  // Clears the badge when the extension stops; the item clears itself.
  const badge = new vscode.Disposable(() => provider.setBadge(false));
  return [item, handler, settingsListener, badge];
}

/**
 * The notice settings, as VS Code merges them (a workspace value overrides
 * the user's), each checked and replaced by its default if invalid.
 */
function noticeSettings(): NoticeSettings {
  const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  return readNoticeSettings((key) => config.get<unknown>(key));
}

/**
 * Shows the "round ready" pop-up, which doesn't take focus. Play opens the
 * panel without touching the round in progress; Not now just closes it. It
 * isn't awaited, and any failure is ignored, so the link handler never waits
 * or throws. VS Code can't close a notification from code, so one still
 * showing when the agent finishes stays until the player closes it.
 */
function roundReadyPopup(): void {
  vscode.window
    .showInformationMessage(POPUP_MESSAGE, POPUP_PLAY, POPUP_NOT_NOW)
    .then((choice) => (choice === POPUP_PLAY ? vscode.commands.executeCommand(`${VIEW_ID}.focus`) : undefined))
    .then(undefined, () => undefined);
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
  /** Whether the badge should show; kept so a view resolved later gets it too. */
  #badge = false;

  constructor(extensionUri: vscode.Uri, handlers: HostHandlers) {
    this.#extensionUri = extensionUri;
    this.#handlers = handlers;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    // The agent may already be working when the panel is first opened.
    this.#applyBadge();
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

  /**
   * Shows or clears the badge on the 0xWORD icon. A badge needs a view, so
   * until the panel has been opened once this only remembers the choice.
   */
  setBadge(on: boolean): void {
    this.#badge = on;
    this.#applyBadge();
  }

  /** Puts the remembered badge choice on the current view, if there is one. */
  #applyBadge(): void {
    if (!this.#view) {
      return;
    }
    try {
      this.#view.badge = this.#badge ? { value: 1, tooltip: BADGE_LABEL } : undefined;
    } catch {
      // A view already disposed (as the extension stops) throws; it shows no badge anyway.
    }
  }

  /** Posts to the current view's webview; resolves false if there's no view. */
  readonly #postToView: PostMessage = (message) =>
    this.#view ? post(this.#view.webview, message) : Promise.resolve(false);
}

/** Posts a message to the webview. Typed, so only protocol messages can be sent. */
function post(webview: vscode.Webview, message: HostMessage): Thenable<boolean> {
  return webview.postMessage(message);
}
