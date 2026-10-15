// Webview entry point, bundled to media/dist/main.js. A thin DOM layer: it
// builds the game screen once with `createElement`, redraws it from the
// controller's view (src/ui/game.ts) with `textContent`, classes and
// `disabled`, and turns clicks and keys into actions. The controller makes
// every game decision. No HTML strings and no inline styles: all styling is
// in media/styles.css.
import { WORD_LENGTH } from "../src/game/hex.ts";
import { MAX_ROWS } from "../src/game/round.ts";
import { restoreSession, type SessionState } from "../src/game/session.ts";
import { parseWordList } from "../src/game/words.ts";
import { parseHostMessage, type WebviewMessage } from "../src/protocol.ts";
import {
  GameController,
  HEX_DIGITS,
  MARK_NAMES,
  actionForKey,
  shouldFocusDecodeBox,
  type Action,
  type KeyFocus,
  type ScreenView,
} from "../src/ui/game.ts";
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

/** One grid tile: the digit, and its mark spelled out for screen readers. */
interface TileElements {
  readonly box: HTMLElement;
  readonly digit: HTMLElement;
  readonly mark: HTMLElement;
}

/** The parts of the screen that change. Built once, then updated in place. */
interface Screen {
  readonly status: HTMLElement;
  readonly tiles: readonly (readonly TileElements[])[];
  readonly keys: readonly HTMLButtonElement[];
  readonly del: HTMLButtonElement;
  readonly enter: HTMLButtonElement;
  readonly decodeInput: HTMLInputElement;
  readonly decodeButton: HTMLButtonElement;
  readonly tryNote: HTMLElement;
  readonly tried: HTMLElement;
  readonly triedList: HTMLElement;
  readonly message: HTMLElement;
}

const vscode = acquireVsCodeApi();
// Restore before saying `ready`, so `init` knows whether a round is already
// in progress. Invalid saved state is dropped and a fresh session starts.
const session = restoreSession(vscode.getState(), parseWordList(wordList));
const controller = new GameController(session, changed);
const app = document.getElementById("app");
const ui = app ? buildScreen(app) : null;
render(controller.view());

/**
 * Saves the session and redraws. The controller calls this at the end of
 * every action (`dispatch`), so no move is lost the next time the panel is
 * hidden and the webview reloads. The saved state holds the answer: that's
 * fine, because it stays in VS Code's own storage for this webview. It is
 * never put in the DOM or in a message to the host.
 */
function changed(): void {
  const state = controller.savedState();
  if (state) {
    vscode.setState(state);
  }
  render(controller.view());
}

/** A new element with an optional class and plain text. */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text) {
    node.textContent = text;
  }
  return node;
}

/** A keypad button that types or acts without taking focus from a mouse click. */
function keypadButton(className: string, text: string, action: Action): HTMLButtonElement {
  const button = element("button", className, text);
  button.type = "button";
  // A clicked key takes no focus, and a key focused earlier with Tab lets go
  // of it, so a physical Enter afterwards submits the row instead of pressing
  // a key again. Tab still reaches every key.
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (document.activeElement instanceof HTMLButtonElement) {
      document.activeElement.blur();
    }
  });
  button.addEventListener("click", () => controller.dispatch(action));
  return button;
}

/** Builds the page 1 layout inside `app` and wires its events. */
function buildScreen(app: HTMLElement): Screen {
  const header = element("header");
  const title = element("h1", "title");
  title.append(element("span", "title-hex", "0x"), element("span", "title-word", "WORD"));
  header.append(title);

  const status = element("p", "status");

  const grid = element("div", "grid");
  const tiles = Array.from({ length: MAX_ROWS }, (_, r) => {
    const row = element("div", "grid-row");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", `Row ${r + 1}`);
    const rowTiles: TileElements[] = [];
    for (let pair = 0; pair < WORD_LENGTH; pair++) {
      const pairBox = element("div", "pair");
      for (let half = 0; half < 2; half++) {
        const tile = { box: element("span", "tile"), digit: element("span"), mark: element("span", "sr-only") };
        tile.box.append(tile.digit, tile.mark);
        pairBox.append(tile.box);
        rowTiles.push(tile);
      }
      row.append(pairBox);
    }
    grid.append(row);
    return rowTiles;
  });

  const legend = element("ul", "legend");
  for (const [mark, name] of Object.entries(MARK_NAMES)) {
    const item = element("li");
    const swatch = element("span", `swatch swatch-${mark}`);
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(name));
    legend.append(item);
  }

  const decode = element("form", "decode");
  const label = element("label", "decode-label", "Decode the word");
  label.htmlFor = "decode-input";
  const decodeInput = element("input", "decode-input");
  decodeInput.id = "decode-input";
  decodeInput.type = "text";
  decodeInput.placeholder = "Type the English word";
  decodeInput.autocomplete = "off";
  decodeInput.spellcheck = false;
  const decodeButton = element("button", "decode-button", "Decode");
  decodeButton.type = "submit";
  const decodeRow = element("div", "decode-row");
  decodeRow.append(decodeInput, decodeButton);
  const tryNote = element("span");
  const tried = element("div", "tried");
  const triedList = element("ul", "tried-list");
  tried.append(element("span", "", "Tried:"), triedList);
  const foot = element("div", "decode-foot");
  foot.append(tryNote, tried);
  decode.append(label, decodeRow, foot);
  decode.addEventListener("submit", (event) => {
    event.preventDefault();
    controller.dispatch({ type: "decode", word: decodeInput.value });
  });

  const message = element("p", "message");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");

  const keypad = element("div", "keypad");
  const keys = HEX_DIGITS.map((digit) => keypadButton("key", digit, { type: "digit", digit }));
  const del = keypadButton("key key-wide", "DEL", { type: "delete" });
  // Accessible names start with the visible label (WCAG 2.5.3).
  del.setAttribute("aria-label", "DEL, delete last digit");
  const enter = keypadButton("key key-wide", "ENTER", { type: "enter" });
  enter.setAttribute("aria-label", "ENTER, enter row");
  keypad.append(...keys, del, enter);

  app.replaceChildren(header, status, grid, legend, decode, message, keypad);

  document.addEventListener("keydown", (event) => {
    if (event.isComposing) {
      return;
    }
    const focus = focusOf(event.target, decodeInput);
    if (shouldFocusDecodeBox(event, focus, controller.view().wordAttemptDue)) {
      // No preventDefault: the character goes on to the newly focused box.
      decodeInput.focus();
      return;
    }
    const action = actionForKey(event, focus);
    if (action) {
      event.preventDefault();
      controller.dispatch(action);
    }
  });

  return { status, tiles, keys, del, enter, decodeInput, decodeButton, tryNote, tried, triedList, message };
}

/** Where a key press lands: the decode box, another control, or the page. */
function focusOf(target: EventTarget | null, decodeInput: HTMLInputElement): KeyFocus {
  if (target === decodeInput) {
    return "decodeBox";
  }
  if (target instanceof Element && target.closest("button, input, textarea, select, a[href]")) {
    return "control";
  }
  return "page";
}

/** Draws `view`. All text goes in with `textContent`; the answer is never in the view. */
function render(view: ScreenView): void {
  if (!ui) {
    return;
  }
  ui.status.textContent = view.status;

  ui.tiles.forEach((row, r) => {
    row.forEach((tile, i) => {
      const model = view.rows[r]?.[i];
      const state = model?.state ?? "empty";
      tile.box.className = `tile tile-${state}`;
      tile.digit.textContent = model?.digit ?? "";
      tile.mark.textContent = state === "empty" || state === "typed" ? "" : `, ${MARK_NAMES[state]}`;
    });
  });

  ui.keys.forEach((button, i) => {
    const key = view.keys[i];
    button.className = key?.mark ? `key key-${key.mark}` : "key";
    if (key?.mark) {
      button.setAttribute("aria-label", key.label);
    } else {
      button.removeAttribute("aria-label");
    }
    button.disabled = !view.keypadEnabled;
  });
  ui.del.disabled = !view.keypadEnabled;
  ui.enter.disabled = !view.keypadEnabled;

  ui.decodeInput.disabled = !view.wordAttemptDue;
  ui.decodeButton.disabled = !view.wordAttemptDue;
  if (!view.wordAttemptDue) {
    ui.decodeInput.value = "";
  }
  ui.tryNote.textContent = view.tryNote;
  ui.tried.hidden = view.tried.length === 0;
  ui.triedList.replaceChildren(
    ...view.tried.map(({ word, label }) => {
      const item = element("li");
      const struck = element("s", "tried-word", word);
      struck.setAttribute("aria-hidden", "true");
      item.append(struck, element("span", "sr-only", label));
      return item;
    }),
  );

  ui.message.classList.toggle("message-error", view.messageIsError);
  if (view.messageIsError && ui.message.textContent === view.message) {
    // The same error again: clear it, then set it on the next frame, so the
    // live region reads it out again.
    ui.message.textContent = "";
    requestAnimationFrame(() => {
      if (ui.message.textContent === "") {
        ui.message.textContent = view.message;
      }
    });
  } else {
    ui.message.textContent = view.message;
  }

  // A scored row's word attempt is due: the decode box takes the keyboard.
  if (view.wordAttemptDue && document.activeElement !== ui.decodeInput) {
    ui.decodeInput.focus();
  }
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = parseHostMessage(event.data);
  switch (message?.type) {
    case "init":
      // The first round starts once the host has answered `ready`, unless
      // one was restored. The stats it carries are shown in a later story.
      controller.dispatch({ type: "init" });
      break;
    case "newRound":
      controller.dispatch({ type: "newRound" });
      break;
  }
});

// Listen first, then tell the host we're ready.
vscode.postMessage({ type: "ready" });
