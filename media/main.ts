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
import { parseHostMessage, type RoundFinishedMessage, type WebviewMessage } from "../src/protocol.ts";
import {
  GameController,
  HEX_DIGITS,
  HINTS_BUTTON,
  MARK_NAMES,
  NEW_ROUND_BUTTON,
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

/** One byte tile on the result card: the hex, a down arrow, the letter. */
interface ResultByteElements {
  readonly hex: HTMLElement;
  readonly letter: HTMLElement;
  /** What a screen reader reads instead, e.g. "42 is B". */
  readonly label: HTMLElement;
}

/** The parts of the screen that change. Built once, then updated in place. */
interface Screen {
  readonly statusIcon: SVGSVGElement;
  readonly statusText: HTMLElement;
  readonly hintsButton: HTMLButtonElement;
  readonly grid: HTMLElement;
  readonly tiles: readonly (readonly TileElements[])[];
  readonly hintStrip: HTMLElement;
  readonly hintCells: readonly HTMLElement[];
  readonly hintLabel: HTMLElement;
  readonly legend: HTMLElement;
  readonly keypad: HTMLElement;
  readonly keys: readonly HTMLButtonElement[];
  readonly del: HTMLButtonElement;
  readonly enter: HTMLButtonElement;
  readonly decode: HTMLElement;
  readonly decodeLabel: HTMLLabelElement;
  readonly decodeBadge: HTMLElement;
  readonly decodeInput: HTMLInputElement;
  readonly decodeButton: HTMLButtonElement;
  readonly tryNote: HTMLElement;
  readonly tried: HTMLElement;
  readonly triedList: HTMLElement;
  readonly message: HTMLElement;
  readonly result: HTMLElement;
  readonly resultHeading: HTMLElement;
  readonly resultLine: HTMLElement;
  readonly resultBytes: readonly ResultByteElements[];
  readonly resultButton: HTMLButtonElement;
  readonly resultNote: HTMLElement;
}

// Constants used while the screen is built go above the start-up code below:
// esbuild turns `const` into `var`, so one declared further down would read
// as undefined instead of failing (#32).
const SVG_NS = "http://www.w3.org/2000/svg";

const vscode = acquireVsCodeApi();
// Restore before saying `ready`, so `init` knows whether a round is already
// in progress. Invalid saved state is dropped and a fresh session starts.
const session = restoreSession(vscode.getState(), parseWordList(wordList));
const controller = new GameController(session, changed);
/** How many times `render` has written the message line: see the re-announce in `render`. */
let messageWrites = 0;
const app = document.getElementById("app");
const ui = app ? buildScreen(app) : null;
render(controller.view());

/**
 * Saves the session, tells the host about a finished round, and redraws. The
 * controller calls this at the end of every action (`dispatch`), so no move
 * is lost the next time the panel is hidden and the webview reloads. The
 * saved state holds the answer: that's fine, because it stays in VS Code's
 * own storage for this webview. It is never put in a message to the host, and
 * goes in the DOM only on the result card, once the round is over.
 *
 * `finished` is set once per finished round, by the controller. It's posted
 * after the save, which already marks the round as reported, so a reload
 * never sends it twice.
 */
function changed(finished: RoundFinishedMessage | null): void {
  const state = controller.savedState();
  if (state) {
    vscode.setState(state);
  }
  if (finished) {
    vscode.postMessage(finished);
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

/** A new SVG element with its attributes. */
function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  return node;
}

/** The padlock before "Hex locked" (page 3). Decoration: the text says it. */
function lockIcon(): SVGSVGElement {
  const icon = svgElement("svg", { class: "status-icon", viewBox: "0 0 16 16", "aria-hidden": "true" });
  icon.append(
    svgElement("rect", { x: "3", y: "7", width: "10", height: "7.5", rx: "1.5" }),
    svgElement("path", { d: "M5.5 7V5a2.5 2.5 0 0 1 5 0v2" }),
  );
  return icon;
}

/** The light bulb before "Hints" (page 2). Decoration: the button's text says it. */
function bulbIcon(): SVGSVGElement {
  const icon = svgElement("svg", {
    class: "hints-icon",
    viewBox: "0 0 16 16",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  icon.append(
    svgElement("path", { d: "M6 12v-1.4a4.5 4.5 0 1 1 4 0V12z" }),
    svgElement("path", { d: "M6.5 14.25h3" }),
  );
  return icon;
}

/** The down arrow between a byte's hex and its letter (page 4). Decoration: the label says it. */
function arrowIcon(): SVGSVGElement {
  const icon = svgElement("svg", {
    class: "result-arrow",
    viewBox: "0 0 16 16",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  icon.append(svgElement("path", { d: "M8 3v10M4 9l4 4 4-4" }));
  return icon;
}

/**
 * A button (a keypad key, Hints or New round) that dispatches `action`
 * without taking focus from a mouse click.
 */
function actionButton(className: string, text: string, action: Action): HTMLButtonElement {
  const button = element("button", className, text);
  button.type = "button";
  // A clicked button takes no focus, and a button focused earlier with Tab
  // lets go of it, so a physical Enter afterwards submits the row instead of
  // pressing a button again. Tab still reaches every button.
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (document.activeElement instanceof HTMLButtonElement) {
      document.activeElement.blur();
    }
  });
  button.addEventListener("click", () => controller.dispatch(action));
  return button;
}

/** Builds the game screen (pages 1 to 4) inside `app` and wires its events. */
function buildScreen(app: HTMLElement): Screen {
  const header = element("header");
  const title = element("h1", "title");
  title.append(element("span", "title-hex", "0x"), element("span", "title-word", "WORD"));
  header.append(title);

  const status = element("p", "status");
  const statusIcon = lockIcon();
  const statusText = element("span");
  status.append(statusIcon, statusText);
  // Its pressed state (`aria-pressed`) and whether it shows come from the view.
  const hintsButton = actionButton("hints-button", "", { type: "toggleHints" });
  hintsButton.append(bulbIcon(), element("span", "", HINTS_BUTTON));
  const statusBar = element("div", "status-bar");
  statusBar.append(status, hintsButton);

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

  // One cell per byte, under the byte pairs. The cells are drawn for sight
  // only; screen readers get the whole strip as one line, `hintLabel`.
  const hintStrip = element("div", "hint-strip");
  const hintCells = Array.from({ length: WORD_LENGTH }, () => {
    const cell = element("span", "hint-cell");
    cell.setAttribute("aria-hidden", "true");
    return cell;
  });
  const hintLabel = element("span", "sr-only");
  hintStrip.append(...hintCells, hintLabel);

  const legend = element("ul", "legend");
  for (const [mark, name] of Object.entries(MARK_NAMES)) {
    const item = element("li");
    const swatch = element("span", `swatch swatch-${mark}`);
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(name));
    legend.append(item);
  }

  // The heading, placeholder, button and note come from the view (`panel`):
  // the decode panel, or the final-answer card once the hex is locked.
  const decode = element("form", "decode");
  const decodeLabel = element("label", "decode-label");
  decodeLabel.htmlFor = "decode-input";
  const decodeBadge = element("span", "decode-badge");
  const head = element("div", "decode-head");
  head.append(decodeLabel, decodeBadge);
  const decodeInput = element("input", "decode-input");
  decodeInput.id = "decode-input";
  decodeInput.type = "text";
  decodeInput.autocomplete = "off";
  decodeInput.spellcheck = false;
  const decodeButton = element("button", "decode-button");
  decodeButton.type = "submit";
  const decodeRow = element("div", "decode-row");
  decodeRow.append(decodeInput, decodeButton);
  const tryNote = element("span");
  const tried = element("div", "tried");
  const triedList = element("ul", "tried-list");
  tried.append(element("span", "", "Tried:"), triedList);
  const foot = element("div", "decode-foot");
  foot.append(tryNote, tried);
  decode.append(head, decodeRow, foot);
  decode.addEventListener("submit", (event) => {
    event.preventDefault();
    controller.dispatch({ type: "decode", word: decodeInput.value });
  });

  const message = element("p", "message");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");

  const keypad = element("div", "keypad");
  const keys = HEX_DIGITS.map((digit) => actionButton("key", digit, { type: "digit", digit }));
  const del = actionButton("key key-wide", "DEL", { type: "delete" });
  // Accessible names start with the visible label (WCAG 2.5.3).
  del.setAttribute("aria-label", "DEL, delete last digit");
  const enter = actionButton("key key-wide", "ENTER", { type: "enter" });
  enter.setAttribute("aria-label", "ENTER, enter row");
  keypad.append(...keys, del, enter);

  // The result card (page 4): it replaces the legend, the decode panel and
  // the keypad once the round is over. Its text, the answer included, is set
  // by `render` only then, so the answer is never in the DOM before.
  const result = element("section", "result");
  result.setAttribute("aria-labelledby", "result-heading");
  result.hidden = true;
  const resultHeading = element("h2", "result-heading");
  resultHeading.id = "result-heading";
  const resultLine = element("p", "result-line");
  const resultList = element("ul", "result-bytes");
  const resultBytes = Array.from({ length: WORD_LENGTH }, () => {
    const byte = {
      hex: element("span", "result-hex"),
      letter: element("span", "result-letter"),
      label: element("span", "sr-only"),
    };
    // The tile is drawn for sight; screen readers get `label` instead.
    byte.hex.setAttribute("aria-hidden", "true");
    byte.letter.setAttribute("aria-hidden", "true");
    const item = element("li", "result-byte");
    item.append(byte.hex, arrowIcon(), byte.letter, byte.label);
    resultList.append(item);
    return byte;
  });
  const resultButton = actionButton("result-button", NEW_ROUND_BUTTON, { type: "newRound" });
  const resultHead = element("div", "result-head");
  resultHead.append(resultHeading, resultLine);
  result.append(resultHead, resultList, resultButton);
  const resultNote = element("p", "result-note");
  resultNote.hidden = true;

  app.replaceChildren(header, statusBar, grid, hintStrip, legend, decode, result, resultNote, message, keypad);

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

  return {
    statusIcon,
    statusText,
    hintsButton,
    grid,
    tiles,
    hintStrip,
    hintCells,
    hintLabel,
    legend,
    keypad,
    keys,
    del,
    enter,
    decode,
    decodeLabel,
    decodeBadge,
    decodeInput,
    decodeButton,
    tryNote,
    tried,
    triedList,
    message,
    result,
    resultHeading,
    resultLine,
    resultBytes,
    resultButton,
    resultNote,
  };
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

/**
 * Draws `view`. All text goes in with `textContent`. The answer is only in
 * the view's result card, once the round is over; until then the card's text
 * is empty.
 */
function render(view: ScreenView): void {
  if (!ui) {
    return;
  }
  ui.statusText.textContent = view.status;
  ui.statusIcon.toggleAttribute("hidden", !view.hexLocked);
  ui.grid.classList.toggle("grid-locked", view.hexLocked);
  ui.keypad.classList.toggle("keypad-locked", view.hexLocked);

  ui.hintsButton.hidden = !view.hints.available;
  ui.hintsButton.setAttribute("aria-pressed", String(view.hints.on));
  ui.hintStrip.hidden = !view.hints.on;
  ui.hintCells.forEach((cell, i) => {
    const model = view.hints.cells[i];
    cell.textContent = model?.text ?? "";
    cell.classList.toggle("hint-unknown", model?.unknown ?? false);
  });
  ui.hintLabel.textContent = view.hints.label;

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
  ui.decode.classList.toggle("decode-final", view.hexLocked);
  ui.decodeLabel.textContent = view.panel.heading;
  ui.decodeBadge.textContent = view.panel.badge;
  ui.decodeBadge.hidden = view.panel.badge === "";
  ui.decodeInput.placeholder = view.panel.placeholder;
  ui.decodeButton.textContent = view.panel.button;
  ui.tryNote.textContent = view.panel.note;
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

  drawResult(view.result);

  ui.message.classList.toggle("message-error", view.messageIsError);
  // Every message write takes a new number, so a delayed write only lands if
  // nothing was written after it.
  const token = ++messageWrites;
  if (view.messageIsError && ui.message.textContent === view.message) {
    // The same error again: clear it, then set it on the next frame, so the
    // live region reads it out again.
    ui.message.textContent = "";
    requestAnimationFrame(() => {
      if (token === messageWrites) {
        ui.message.textContent = view.message;
      }
    });
  } else {
    ui.message.textContent = view.message;
  }

  // A scored row's word attempt is due: the decode box takes the keyboard,
  // unless the Hints button has it, so it can be toggled again from the keyboard.
  if (view.wordAttemptDue && document.activeElement !== ui.decodeInput && document.activeElement !== ui.hintsButton) {
    ui.decodeInput.focus();
  }
}

/**
 * Shows the result card in place of the legend, decode panel and keypad once
 * the round is over, or hides it and clears its text while the round is in
 * progress. When the card first appears, New round takes focus, since the
 * decode box that had it is gone.
 */
function drawResult(result: ScreenView["result"]): void {
  if (!ui) {
    return;
  }
  const appearing = result !== null && ui.result.hidden;
  ui.result.hidden = result === null;
  ui.resultNote.hidden = result === null;
  ui.legend.hidden = result !== null;
  ui.decode.hidden = result !== null;
  ui.keypad.hidden = result !== null;
  // "Solved" and "Out of rows" are still read out, but the card shows the result.
  ui.message.classList.toggle("sr-only", result !== null);

  ui.resultHeading.textContent = result?.heading ?? "";
  ui.resultLine.textContent = result?.line ?? "";
  ui.resultBytes.forEach((byte, i) => {
    const model = result?.bytes[i];
    byte.hex.textContent = model?.hex ?? "";
    byte.letter.textContent = model?.letter ?? "";
    byte.label.textContent = model?.label ?? "";
  });
  ui.resultButton.textContent = result?.button ?? NEW_ROUND_BUTTON;
  ui.resultNote.textContent = result?.note ?? "";
  if (appearing) {
    ui.resultButton.focus();
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
