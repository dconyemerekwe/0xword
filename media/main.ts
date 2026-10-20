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
  howToPlayActionForKey,
  shouldFocusDecodeBox,
  type Action,
  type KeyFocus,
  type ScreenView,
} from "../src/ui/game.ts";
import {
  BACK_TO_GAME,
  CHEATSHEET_HEADING,
  CHEATSHEET_LINE,
  HOW_TO_PLAY,
  RULES,
  RULES_HEADING,
  cheatsheet,
  type StyledText,
} from "../src/ui/howToPlay.ts";
import { THEME_ATTRIBUTE, THEME_BUTTON_LABEL, nextTheme, parseTheme, type Theme } from "../src/theme.ts";
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
  /** Everything but How to play: hidden while How to play is open. */
  readonly game: HTMLElement;
  /** The `?` button in the header. */
  readonly howToPlayButton: HTMLButtonElement;
  /** The sun/moon button in the header, next to `?`. */
  readonly themeButton: HTMLButtonElement;
  /** The How to play screen (page 5). */
  readonly howToPlay: HTMLElement;
  /** Its back arrow. */
  readonly backButton: HTMLButtonElement;
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
  /** A visually hidden live region: what only screen readers hear (`ScreenView.announcement`). */
  readonly announcement: HTMLElement;
  readonly result: HTMLElement;
  readonly resultOutcome: HTMLElement;
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
/** The view's `noticeId` when `render` last drew the message line. */
let drawnNoticeId = -1;
/** The text the message line shows, or will once a delayed re-announce lands; null before the first draw. */
let drawnMessage: string | null = null;
/** Like `drawnMessage`, for the hidden announcement region. */
let drawnAnnouncement: string | null = null;
/**
 * How to play was opened from the keyboard (Enter or Space on `?`), so
 * closing it gives focus back to `?`. Opened with the mouse, focus goes back
 * to the page instead, so a later Enter or Space can't reopen it.
 */
let howToPlayOpenedByKeyboard = false;
/** The last button click came from the keyboard: a click event's `detail` is 0. */
let lastClickByKeyboard = false;
/**
 * The player's theme choice. The host puts a forced one on <body> in the
 * HTML (read here, untrusted like any input), and sends it again in `init`.
 * Not a game action: it isn't saved with the round, and doesn't go through
 * `changed()`.
 */
let theme: Theme = parseTheme(document.body.getAttribute(THEME_ATTRIBUTE));
/** The player pressed the theme button before `init` arrived: keep that choice. */
let themeChosenHere = false;
const app = document.getElementById("app");
const ui = app ? buildScreen(app) : null;
applyTheme(theme);
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

/**
 * Shows `choice`: a forced one goes on <body> as `THEME_ATTRIBUTE`, and
 * "system" removes it, so the stylesheet follows VS Code's <body> class. The
 * theme button's name says what its next press does; its icon comes from
 * the stylesheet, since under "system" it changes with VS Code's theme.
 */
function applyTheme(choice: Theme): void {
  theme = choice;
  if (choice === "system") {
    document.body.removeAttribute(THEME_ATTRIBUTE);
  } else {
    document.body.setAttribute(THEME_ATTRIBUTE, choice);
  }
  ui?.themeButton.setAttribute("aria-label", THEME_BUTTON_LABEL[choice]);
}

/** The theme button: the next choice, shown at once and remembered by the host. */
function pressThemeButton(): void {
  themeChosenHere = true;
  applyTheme(nextTheme(theme));
  vscode.postMessage({ type: "setTheme", theme });
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

/** The circled question mark on the How to play button (page 1). Decoration: the button is named. */
function questionIcon(): SVGSVGElement {
  const icon = svgElement("svg", {
    class: "icon",
    viewBox: "0 0 16 16",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  icon.append(
    svgElement("circle", { cx: "8", cy: "8", r: "6.5" }),
    svgElement("path", { d: "M6.25 6.25a1.75 1.75 0 1 1 2.45 1.6c-.45.2-.7.6-.7 1.1v.3M8 11.25v.01" }),
  );
  return icon;
}

/** The sun on the theme button while the dark palette shows (page 1). Decoration: the button is named. */
function sunIcon(): SVGSVGElement {
  const icon = svgElement("svg", {
    class: "icon theme-sun",
    viewBox: "0 0 16 16",
    "stroke-linecap": "round",
    "aria-hidden": "true",
  });
  icon.append(
    svgElement("circle", { cx: "8", cy: "8", r: "2.75" }),
    svgElement("path", {
      d: "M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06",
    }),
  );
  return icon;
}

/** The moon on the theme button while the light palette shows (page 4). Decoration: the button is named. */
function moonIcon(): SVGSVGElement {
  const icon = svgElement("svg", {
    class: "icon theme-moon",
    viewBox: "0 0 16 16",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  icon.append(svgElement("path", { d: "M13.5 9.5A5.75 5.75 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z" }));
  return icon;
}

/** The back arrow `<` on How to play (page 5). Decoration: the button is named. */
function backIcon(): SVGSVGElement {
  const icon = svgElement("svg", {
    class: "icon",
    viewBox: "0 0 16 16",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  icon.append(svgElement("path", { d: "M10 3.5 5.5 8l4.5 4.5" }));
  return icon;
}

/**
 * `text`'s runs in `parent`, each in its style: plain text nodes, <strong>,
 * hex in a `code` span, or a chip in a mark's colour. All text is plain text.
 */
function appendStyled(parent: HTMLElement, text: StyledText): void {
  for (const { text: run, style } of text) {
    if (style === "plain") {
      parent.append(document.createTextNode(run));
    } else if (style === "strong") {
      parent.append(element("strong", "", run));
    } else if (style === "code") {
      parent.append(element("span", "code", run));
    } else {
      parent.append(element("span", `chip chip-${style}`, run));
    }
  }
}

/**
 * Builds How to play (page 5): a back arrow and heading, the six rules, and
 * the A–Z cheatsheet. Its text never changes, so it's all set here.
 */
function buildHowToPlay(): { readonly section: HTMLElement; readonly back: HTMLButtonElement } {
  const section = element("section", "how-to-play");
  section.setAttribute("aria-labelledby", "how-to-play-heading");
  section.hidden = true;

  const back = actionButton("icon-button", "", { type: "closeHowToPlay" });
  back.setAttribute("aria-label", BACK_TO_GAME);
  back.append(backIcon());
  const heading = element("h2", "how-to-play-heading", HOW_TO_PLAY);
  heading.id = "how-to-play-heading";
  const head = element("div", "how-to-play-head");
  head.append(back, heading);

  const rules = element("ol", "rules");
  for (const rule of RULES) {
    const item = element("li");
    appendStyled(item, rule);
    rules.append(item);
  }

  const line = element("p", "cheatsheet-line");
  appendStyled(line, CHEATSHEET_LINE);
  const cards = element("ul", "cheatsheet");
  for (const card of cheatsheet()) {
    const letter = element("span", "cheat-letter", card.letter);
    const hex = element("span", "cheat-hex", card.hex);
    // The card is drawn for sight; screen readers get "A is 41" instead.
    letter.setAttribute("aria-hidden", "true");
    hex.setAttribute("aria-hidden", "true");
    const item = element("li", "cheat-card");
    item.append(letter, hex, element("span", "sr-only", card.label));
    cards.append(item);
  }

  section.append(
    head,
    element("h3", "section-heading", RULES_HEADING),
    rules,
    element("h3", "section-heading", CHEATSHEET_HEADING),
    line,
    cards,
  );
  return { section, back };
}

/**
 * A button (a keypad key, Hints or New round) that dispatches `action`
 * without taking focus from a mouse click.
 */
function actionButton(className: string, text: string, action: Action): HTMLButtonElement {
  return pressButton(className, text, () => controller.dispatch(action));
}

/**
 * A button that runs `onPress` without taking focus from a mouse click. Game
 * actions use `actionButton`; only the theme button, which isn't one, calls
 * this directly.
 */
function pressButton(className: string, text: string, onPress: () => void): HTMLButtonElement {
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
  button.addEventListener("click", (event) => {
    // Enter or Space on a button fires a click with no mouse presses:
    // `detail` 0. A real mouse click never finds the button focused (the
    // mousedown above prevents it), so a focused button means the keyboard
    // too, even when a screen reader fakes a mouse click.
    lastClickByKeyboard = event.detail === 0 || document.activeElement === button;
    onPress();
  });
  return button;
}

/** Builds the game screen (pages 1 to 4) and How to play (page 5) inside `app`, and wires their events. */
function buildScreen(app: HTMLElement): Screen {
  const header = element("header", "header");
  const title = element("h1", "title");
  title.append(element("span", "title-hex", "0x"), element("span", "title-word", "WORD"));
  // On every screen, on the right of the header (page 1).
  const howToPlayButton = actionButton("icon-button", "", { type: "openHowToPlay" });
  howToPlayButton.setAttribute("aria-label", HOW_TO_PLAY);
  howToPlayButton.append(questionIcon());
  // Next to `?`. Not a game action, so it doesn't go through the controller.
  // Its name is set by `applyTheme`.
  const themeButton = pressButton("icon-button", "", pressThemeButton);
  themeButton.append(sunIcon(), moonIcon());
  const headerButtons = element("div", "header-buttons");
  headerButtons.append(howToPlayButton, themeButton);
  header.append(title, headerButtons);

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
    const triedBefore = controller.view().tried.length;
    controller.dispatch({ type: "decode", word: decodeInput.value });
    // A wrong word was taken as a try and joined Tried: empty the box, and
    // give the keyboard back to the page, where hex keys drive the grid
    // (`actionForKey`), so the player carries on guessing hex. At the final
    // answer a wrong word ends the round, and New round takes focus instead.
    // A rejected word keeps the box's focus and text, so it can be corrected.
    if (controller.view().tried.length !== triedBefore) {
      decodeInput.value = "";
      if (document.activeElement === decodeInput) {
        decodeInput.blur();
      }
    }
  });

  const message = element("p", "message");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  // Nothing shows on screen: scored rows and wrong words are read out here.
  const announcement = element("p", "sr-only");
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");

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
  // Named "Congrats! You cracked it, Decoded: BYTE": read out when New round
  // takes focus inside the card, and first when reading the card in order.
  result.setAttribute("aria-labelledby", "result-outcome result-heading");
  result.hidden = true;
  const resultOutcome = element("p", "result-outcome");
  resultOutcome.id = "result-outcome";
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
  resultHead.append(resultOutcome, resultHeading, resultLine);
  result.append(resultHead, resultList, resultButton);
  const resultNote = element("p", "result-note");
  resultNote.hidden = true;

  const game = element("div", "game");
  game.append(header, statusBar, grid, hintStrip, legend, decode, result, resultNote, message, announcement, keypad);
  const howToPlay = buildHowToPlay();
  app.replaceChildren(game, howToPlay.section);

  document.addEventListener("keydown", (event) => {
    if (event.isComposing) {
      return;
    }
    // While How to play is open, no key reaches the grid or the decode box.
    if (controller.view().howToPlayOpen) {
      const action = howToPlayActionForKey(event);
      if (action) {
        event.preventDefault();
        controller.dispatch(action);
      }
      return;
    }
    const focus = focusOf(event.target, decodeInput);
    if (shouldFocusDecodeBox(event, focus, controller.view().hexLocked)) {
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
    game,
    howToPlayButton,
    themeButton,
    howToPlay: howToPlay.section,
    backButton: howToPlay.back,
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
    announcement,
    result,
    resultOutcome,
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
  // How to play covers the game, which is still drawn behind it as it is.
  const howToPlayWasOpen = !ui.howToPlay.hidden;
  ui.game.hidden = view.howToPlayOpen;
  ui.howToPlay.hidden = !view.howToPlayOpen;

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

  ui.decodeInput.disabled = !view.decodeAvailable;
  ui.decodeButton.disabled = !view.decodeAvailable;
  if (!view.decodeAvailable) {
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
  // A new notice from this dispatch, rather than a redraw that left it alone
  // (opening or closing How to play, say).
  const freshNotice = view.noticeId !== drawnNoticeId;
  drawnNoticeId = view.noticeId;
  // Every message write takes a new number, so a delayed write only lands if
  // nothing was written after it.
  if (freshNotice && view.messageIsError && view.message === drawnMessage) {
    // The same error again: clear it, then set it on the next frame, so the
    // live region reads it out again.
    const token = ++messageWrites;
    ui.message.textContent = "";
    requestAnimationFrame(() => {
      if (token === messageWrites) {
        ui.message.textContent = view.message;
      }
    });
  } else if (view.message !== drawnMessage) {
    ++messageWrites;
    ui.message.textContent = view.message;
  }
  drawnMessage = view.message;

  // Each announcement names a new row or a new word (repeats are rejected),
  // and every other action clears it, so a plain write is always read out.
  if (view.announcement !== drawnAnnouncement) {
    ui.announcement.textContent = view.announcement;
  }
  drawnAnnouncement = view.announcement;

  const opening = view.howToPlayOpen && !howToPlayWasOpen;
  const closing = !view.howToPlayOpen && howToPlayWasOpen;
  if (opening) {
    // Focus moves to the back arrow.
    howToPlayOpenedByKeyboard = lastClickByKeyboard;
    ui.backButton.focus();
  } else if (closing && howToPlayOpenedByKeyboard) {
    // Opened from the keyboard: focus goes back to the `?` that opened it.
    ui.howToPlayButton.focus();
  } else {
    if (closing) {
      // Opened with the mouse: focus goes back to the page, as after any
      // clicked button, so Enter enters the row instead of reopening it.
      ui.backButton.blur();
    }
    // The hex is locked and the final answer is due: the decode box takes the
    // keyboard, unless the Hints button has it, so it can be toggled again
    // from the keyboard. Before that, decoding is optional and focus stays put.
    const keyboardFree = document.activeElement !== ui.decodeInput && document.activeElement !== ui.hintsButton;
    if (!view.howToPlayOpen && view.hexLocked && keyboardFree) {
      ui.decodeInput.focus();
    }
  }
}

/**
 * Shows the result card in place of the legend, decode panel and keypad once
 * the round is over, or hides it and clears its text while the round is in
 * progress. When the card first appears, New round takes focus, since the
 * decode box that had it is gone. When New round hides the card, focus goes
 * back to the page rather than staying on the hidden button: from the page,
 * hex digits and ENTER drive the grid (`actionForKey`). A focused keypad key
 * would take digits too, but ENTER would press that key instead of entering
 * the row.
 */
function drawResult(result: ScreenView["result"]): void {
  if (!ui) {
    return;
  }
  const appearing = result !== null && ui.result.hidden;
  if (result === null && document.activeElement === ui.resultButton) {
    ui.resultButton.blur();
  }
  ui.result.hidden = result === null;
  ui.resultNote.hidden = result === null;
  ui.legend.hidden = result !== null;
  ui.decode.hidden = result !== null;
  ui.keypad.hidden = result !== null;
  // "Solved" and "Out of rows" are still read out, but the card shows the result.
  ui.message.classList.toggle("sr-only", result !== null);

  ui.resultOutcome.textContent = result?.outcome ?? "";
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
      // The stored theme, unless the player already pressed the theme button
      // since this load (that choice is on its way to the host).
      if (!themeChosenHere) {
        applyTheme(message.theme);
      }
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
