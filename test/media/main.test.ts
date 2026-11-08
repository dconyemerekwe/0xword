// Scans the webview's DOM layer (media/main.ts) for the security and
// accessibility rules it must follow, and runs its bundle once against a fake
// DOM. Its behaviour is tested through the controller it drives
// (test/ui/game.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import * as esbuild from "esbuild";
import { wordToHex } from "../../src/game/hex.ts";
import { Session, type SessionState } from "../../src/game/session.ts";
import { EMPTY_STATS, toStatsView } from "../../src/stats.ts";
import { THEMES, THEME_ATTRIBUTE, THEME_BUTTON_LABEL, type Theme } from "../../src/theme.ts";
import { GameController, HEX_LOCKED_STATUS, HINT_UNKNOWN, MARK_NAMES, type Action } from "../../src/ui/game.ts";
import { HOW_TO_PLAY, cheatsheet } from "../../src/ui/howToPlay.ts";
import { WORDS } from "../game/fixtures.ts";

/** The source without comments, so they may mention what the code avoids. */
const source = readFileSync(new URL("../../media/main.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("media/main.ts", () => {
  it("never builds HTML from strings", () => {
    for (const pattern of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /DOMParser/, /createContextualFragment/]) {
      assert.doesNotMatch(source, pattern);
    }
  });

  it("sets no inline styles or inline event handlers", () => {
    assert.doesNotMatch(source, /\.style\b/);
    assert.doesNotMatch(source, /setAttribute\(\s*["'](style|on[a-z]+)["']/i);
    assert.doesNotMatch(source, /\.on[a-z]+\s*=/);
  });

  it("adds no motion of its own, so reduced motion is the stylesheet's alone (#63)", () => {
    for (const pattern of [/\.animate\(/, /scrollIntoView/, /\.scroll(To|By)?\(/, /smooth/, /transition/i, /animation(?!Frame)/i, /@keyframes/]) {
      assert.doesNotMatch(source, pattern);
    }
    // Its only frame callbacks re-set a live region's text, so it is read out again.
    const frames = [...source.matchAll(/requestAnimationFrame\(\(\) => \{([\s\S]*?)\n {4}\}\);/g)].map((match) => match[1] ?? "");
    assert.equal(frames.length, source.match(/requestAnimationFrame/g)?.length);
    for (const body of frames) {
      assert.match(body, /^\s*if \(token === \w+\) \{\s*ui\.(message|announcement)\.textContent = view\.(message|announcement);\s*\}\s*$/);
    }
  });

  it("wires events with addEventListener", () => {
    assert.match(source, /addEventListener\("click"/);
    assert.match(source, /addEventListener\("keydown"/);
    assert.match(source, /addEventListener\("submit"/);
  });

  it("makes every clickable key, and the Hints button, a real <button>", () => {
    // The only click handler is in `pressButton`, which makes every button
    // as a <button>: keypad keys, Hints and the rest through `actionButton`.
    assert.equal(source.match(/addEventListener\("click"/g)?.length, 1);
    assert.match(source, /function pressButton\(.*\): HTMLButtonElement \{\s*const button = element\("button"/);
    assert.match(source, /function actionButton\([^)]*\): HTMLButtonElement \{\s*return pressButton\(className, text, \(\) => controller\.dispatch\(action\)\);/);
    assert.match(source, /const hintsButton = actionButton\("hints-button", "", \{ type: "toggleHints" \}\)/);
  });

  it("draws the Hints button from the view: aria-pressed, and hidden once the round is over", () => {
    assert.match(source, /ui\.hintsButton\.setAttribute\("aria-pressed", String\(view\.hints\.on\)\)/);
    assert.match(source, /ui\.hintsButton\.hidden = !view\.hints\.available/);
    assert.match(source, /hintsButton\.append\(hintsBulb, hintsLock, element\("span", "", HINTS_BUTTON\)\)/);
  });

  it("locks the Hints button from the view: disabled, the lock in place of the bulb, described for screen readers (#46)", () => {
    assert.match(source, /ui\.hintsButton\.disabled = view\.hints\.locked/);
    assert.match(source, /ui\.hintsBulb\.toggleAttribute\("hidden", view\.hints\.locked\)/);
    assert.match(source, /ui\.hintsLock\.toggleAttribute\("hidden", !view\.hints\.locked\)/);
    assert.match(source, /ui\.hintsButton\.setAttribute\("aria-describedby", "hints-locked-note"\)/);
    assert.match(source, /ui\.hintsButton\.removeAttribute\("aria-describedby"\)/);
    assert.match(source, /const hintsLockedNote = element\("span", "", HINTS_LOCKED_NOTE\);\s*hintsLockedNote\.id = "hints-locked-note";\s*hintsLockedNote\.hidden = true;/);
  });

  it("locks the decode panel from the view: the lock shows over the faded body, with real text (#46)", () => {
    assert.match(source, /ui\.decode\.classList\.toggle\("decode-locked", view\.decodeLocked\)/);
    assert.match(source, /ui\.decodeLock\.hidden = !view\.decodeLocked/);
    assert.match(source, /element\("p", "lock-title", DECODE_LOCKED_TITLE\)/);
    assert.match(source, /element\("p", "lock-message", DECODE_LOCKED_MESSAGE\)/);
    assert.match(source, /lockBadge\.append\(lockIcon\("lock-badge-icon"\)\)/);
    assert.match(source, /decode\.append\(body, decodeLock\)/);
  });

  it("has no Tried list (#46)", () => {
    assert.doesNotMatch(source, /tried/i);
  });

  it("draws the hint strip from the view with textContent, with one line of text for screen readers", () => {
    assert.match(source, /ui\.hintStrip\.hidden = !view\.hints\.on/);
    assert.match(source, /cell\.textContent = model\?\.text \?\? ""/);
    assert.match(source, /cell\.setAttribute\("aria-hidden", "true"\)/);
    assert.match(source, /const hintLabel = element\("span", "sr-only"\)/);
    assert.match(source, /ui\.hintLabel\.textContent = view\.hints\.label/);
  });

  it("puts the hint strip between the grid and the legend, and Hints in the status bar", () => {
    assert.match(source, /game\.append\(header, statusBar, grid, hintStrip, legend,/);
    assert.match(source, /statusBar\.append\(status, hintsButton, hintsLockedNote\)/);
  });

  it("labels the decode box with a <label>, whose heading, placeholder and button come from the view's panel", () => {
    // The panel's text ("Decode the word" / "Final answer"…) is tested in test/ui/game.test.ts.
    assert.match(source, /const decodeLabel = element\("label"/);
    assert.match(source, /decodeLabel\.htmlFor = "decode-input"/);
    assert.match(source, /decodeInput\.id = "decode-input"/);
    assert.match(source, /ui\.decodeLabel\.textContent = view\.panel\.heading/);
    assert.match(source, /ui\.decodeBadge\.textContent = view\.panel\.badge/);
    assert.match(source, /ui\.decodeInput\.placeholder = view\.panel\.placeholder/);
    assert.match(source, /ui\.decodeButton\.textContent = view\.panel\.button/);
    assert.match(source, /ui\.tryNote\.textContent = view\.panel\.note/);
  });

  it("shows the final-answer card and locks the keypad from hexLocked, and the lock icon and dimmed grid from outOfRows", () => {
    assert.match(source, /ui\.decode\.classList\.toggle\("decode-final", view\.hexLocked\)/);
    assert.match(source, /ui\.keypad\.classList\.toggle\("keypad-locked", view\.hexLocked\)/);
    assert.match(source, /ui\.grid\.classList\.toggle\("grid-locked", view\.outOfRows\)/);
    assert.match(source, /ui\.statusIcon\.toggleAttribute\("hidden", !view\.outOfRows\)/);
  });

  it("disables the keypad, DEL and ENTER whenever the view says the keypad is off", () => {
    assert.match(source, /button\.disabled = !view\.keypadEnabled/);
    assert.match(source, /ui\.del\.disabled = !view\.keypadEnabled/);
    assert.match(source, /ui\.enter\.disabled = !view\.keypadEnabled/);
  });

  it("draws the lock icon as SVG elements with createElementNS, hidden from screen readers", () => {
    assert.match(source, /document\.createElementNS\(SVG_NS, tag\)/);
    assert.match(source, /const SVG_NS = "http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(source, /svgElement\("svg", \{[^}]*"aria-hidden": "true"/);
  });

  it("announces messages in an aria-live region", () => {
    assert.match(source, /message\.setAttribute\("aria-live", "polite"\)/);
  });

  it("reads scored rows out from a second, visually hidden aria-live region, written with textContent", () => {
    assert.match(source, /const announcement = element\("p", "sr-only"\);\s*announcement\.setAttribute\("role", "status"\);\s*announcement\.setAttribute\("aria-live", "polite"\)/);
    assert.match(source, /ui\.announcement\.textContent = view\.announcement/);
  });

  it("enables the decode box and its button from the view's decodeAvailable", () => {
    assert.match(source, /ui\.decodeInput\.disabled = !view\.decodeAvailable/);
    assert.match(source, /ui\.decodeButton\.disabled = !view\.decodeAvailable/);
  });

  it("moves focus to the decode box only once the hex is locked", () => {
    assert.match(source, /if \(!view\.howToPlayOpen && view\.hexLocked && document\.activeElement !== ui\.decodeInput\) \{\s*ui\.decodeInput\.focus\(\);/);
    assert.equal(source.match(/decodeInput\.focus\(\)/g)?.length, 2, "here and in the keydown handler");
  });

  it("gives DEL and ENTER accessible names that start with their visible labels (WCAG 2.5.3)", () => {
    assert.match(source, /actionButton\("[^"]*", "DEL",[\s\S]*?del\.setAttribute\("aria-label", "DEL, /);
    assert.match(source, /actionButton\("[^"]*", "ENTER",[\s\S]*?enter\.setAttribute\("aria-label", "ENTER, /);
  });

  it("focuses the decode box, without blocking the key, when shouldFocusDecodeBox says so", () => {
    assert.match(
      source,
      /if \(shouldFocusDecodeBox\(event, focus, controller\.view\(\)\.hexLocked\)\) \{\s*decodeInput\.focus\(\);\s*return;\s*\}/,
    );
  });

  it("sends every action through the controller's dispatch", () => {
    assert.match(source, /new GameController\(session, changed\)/);
    assert.doesNotMatch(source, /session\.(newRound|ensureRound|setDraft|submitDraft)\(/);
    assert.doesNotMatch(source, /\.(submitGuess|submitAnswer)\(/);
  });

  it("saves with setState in changed(), then posts the finished round it's given, then draws", () => {
    assert.match(
      source,
      /function changed\(finished: RoundFinishedMessage \| null\): void \{[\s\S]*?vscode\.setState\(state\)[\s\S]*?if \(finished\) \{\s*vscode\.postMessage\(finished\);\s*\}[\s\S]*?render\(/,
    );
  });

  it("posts roundFinished only from changed(): the controller decides when", () => {
    const posts = [...source.matchAll(/vscode\.postMessage\(([^)]*)\)/g)].map((match) => match[1]);
    assert.deepEqual(posts.sort(), ["finished", '{ type: "ready" }', '{ type: "setTheme", theme }']);
    assert.doesNotMatch(source, /"roundFinished"/);
    assert.doesNotMatch(source, /takeResult\(/);
  });

  it("makes New round a real <button> that dispatches newRound, the same action as the command", () => {
    assert.match(source, /const resultButton = actionButton\("result-button", NEW_ROUND_BUTTON, \{ type: "newRound" \}\)/);
  });

  it("builds no Copy result button and touches no clipboard", () => {
    assert.doesNotMatch(source, /copy|clipboard/i);
  });

  it("draws the result card's text from the view with textContent", () => {
    for (const pattern of [
      /ui\.resultOutcome\.textContent = result\?\.outcome \?\? ""/,
      /ui\.resultHeading\.textContent = result\?\.heading \?\? ""/,
      /ui\.resultLine\.textContent = result\?\.line \?\? ""/,
      /byte\.hex\.textContent = model\?\.hex \?\? ""/,
      /byte\.letter\.textContent = model\?\.letter \?\? ""/,
      /byte\.label\.textContent = model\?\.label \?\? ""/,
      /ui\.resultNote\.textContent = result\?\.note \?\? ""/,
    ]) {
      assert.match(source, pattern);
    }
  });

  it("shows the card in place of the legend, decode panel and keypad once the round is over", () => {
    assert.match(source, /ui\.result\.hidden = result === null/);
    assert.match(source, /ui\.legend\.hidden = result !== null/);
    assert.match(source, /ui\.decode\.hidden = result !== null/);
    assert.match(source, /ui\.keypad\.hidden = result !== null/);
    assert.match(source, /game\.append\([^)]*decode, result, resultNote, message, keypad\)/);
  });

  it("makes `?` and the back arrow real <button>s that dispatch through the controller", () => {
    assert.match(source, /const howToPlayButton = actionButton\("icon-button", "", \{ type: "openHowToPlay" \}\)/);
    assert.match(source, /const back = actionButton\("icon-button", "", \{ type: "closeHowToPlay" \}\)/);
    assert.match(source, /howToPlayButton\.setAttribute\("aria-label", HOW_TO_PLAY\)/);
    assert.match(source, /back\.setAttribute\("aria-label", BACK_TO_GAME\)/);
    assert.match(source, /headerButtons\.append\(howToPlayButton, themeButton\)/);
    assert.match(source, /header\.append\(title, headerButtons\)/);
  });

  it("locks `?` from the view with `disabled` only: no lock icon and no description (#53)", () => {
    assert.match(source, /ui\.howToPlayButton\.disabled = view\.howToPlayLocked/);
    assert.match(source, /howToPlayButton\.append\(questionIcon\(\)\);/);
    assert.doesNotMatch(source, /howToPlayButton\.(setAttribute|toggleAttribute)\("(aria-describedby|aria-disabled|title)"/);
    assert.doesNotMatch(source, /howToPlayButton\.append\([^)]*lockIcon/);
  });

  it("makes the theme button a real <button> outside the controller, in the header next to `?`", () => {
    assert.match(source, /const themeButton = pressButton\("icon-button", "", pressThemeButton\)/);
    assert.match(source, /themeButton\.append\(sunIcon\(\), moonIcon\(\)\)/);
    // Not a game action: no action type, no dispatch, no save.
    assert.doesNotMatch(source, /type: "(setTheme|toggleTheme|theme)"\s*\}\s*\)/);
    assert.doesNotMatch(source, /function pressThemeButton[^}]*(dispatch|changed|setState)/);
  });

  it("follows VS Code's theme from the stylesheet: no polling, no reading VS Code's <body> classes", () => {
    assert.doesNotMatch(source, /setInterval|setTimeout|MutationObserver|classList\.contains|vscode-(light|dark|high)/);
  });

  it("puts the game and How to play side by side in the app, one hidden at a time", () => {
    // The announcement region is outside both, so it's never hidden (#62).
    assert.match(source, /app\.replaceChildren\(game, howToPlay\.section, announcement\)/);
    assert.match(source, /ui\.game\.hidden = view\.howToPlayOpen/);
    assert.match(source, /ui\.howToPlay\.hidden = !view\.howToPlayOpen/);
  });

  it("handles keys for How to play before the grid and the decode box can see them", () => {
    assert.match(
      source,
      /if \(controller\.view\(\)\.howToPlayOpen\) \{\s*const action = howToPlayActionForKey\(event\);[\s\S]*?return;\s*\}\s*const focus = focusOf/,
    );
  });

  it("draws the rules and cheatsheet from the controller's data, with text nodes and textContent only", () => {
    assert.match(source, /for \(const rule of RULES\)/);
    assert.match(source, /appendStyled\(line, CHEATSHEET_LINE\)/);
    assert.match(source, /for \(const card of cheatsheet\(\)\)/);
    assert.match(source, /parent\.append\(document\.createTextNode\(run\)\)/);
    // No rule text is written in the DOM layer itself.
    assert.doesNotMatch(source, /hidden word|right spot|cheatsheet line|counts up/i);
  });
});

/** Where keyboard focus is in the fake DOM: `document.activeElement`, or null for the page. */
interface FocusTracker {
  active: unknown;
}

/**
 * A stand-in DOM node: any property reads as a value set on it, or else a
 * no-op function. `focus()` and `blur()` move `focus.active` and count the
 * node's `focusCalls`. `append` and `replaceChildren` record its `children`,
 * in document order, for `tabOrder`. `texts` records every `textContent`
 * write, so a test can count what a live region was given.
 */
function fakeNode(record: Record<string, unknown>, focus: FocusTracker = { active: null }): Record<string, unknown> {
  const attributes: Record<string, string> = {};
  const listeners: Record<string, (event: unknown) => void> = {};
  const children: unknown[] = [];
  const target: Record<string, unknown> = {
    ...record,
    attributes,
    listeners,
    children,
    focusCalls: 0,
    textWrites: 0,
    // Every value written to `textContent`, in order.
    texts: [],
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
    append: (...nodes: unknown[]) => {
      children.push(...nodes);
    },
    replaceChildren: (...nodes: unknown[]) => {
      children.splice(0, children.length, ...nodes);
    },
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute: (name: string, value: string) => {
      attributes[name] = value;
    },
    getAttribute: (name: string) => attributes[name] ?? null,
    removeAttribute: (name: string) => {
      delete attributes[name];
    },
    focus: () => {
      // A browser never focuses a disabled control.
      if (target["disabled"] === true) {
        return;
      }
      target["focusCalls"] = Number(target["focusCalls"]) + 1;
      focus.active = node;
    },
    blur: () => {
      if (focus.active === node) {
        focus.active = null;
      }
    },
    // Enough of `closest` for `focusOf`: a control matches itself.
    closest: () => (["button", "input"].includes(String(record["tag"])) ? node : null),
  };
  const node: Record<string, unknown> = new Proxy(target, {
    get: (t, key) => (typeof key === "string" && key in t ? t[key] : () => undefined),
    set: (t, key, value) => {
      if (typeof key === "string") {
        t[key] = value;
      }
      if (key === "textContent") {
        t["textWrites"] = Number(t["textWrites"] ?? 0) + 1;
        (t["texts"] as unknown[]).push(value);
      }
      return true;
    },
  });
  return node;
}

let bundled: string | null = null;

/** The webview bundle, built like scripts/build.ts does. Built once, then reused. */
function bundle(): string {
  if (bundled !== null) {
    return bundled;
  }
  const { outputFiles } = esbuild.buildSync({
    entryPoints: [fileURLToPath(new URL("../../media/main.ts", import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    target: "es2022",
    format: "iife",
    loader: { ".txt": "text" },
  });
  const file = outputFiles[0];
  assert.ok(file, "esbuild produced the bundle");
  bundled = file.text;
  return bundled;
}

interface WebviewRun {
  /** Every element `createElement` made, as recorded fake nodes. */
  readonly elements: readonly Record<string, unknown>[];
  /** Every `createElementNS` call. */
  readonly namespaces: readonly { readonly tag: string; readonly ns: unknown }[];
  /** What the webview posted to the host. */
  readonly posts: readonly unknown[];
  /** How many times the webview saved its state with `setState`. */
  readonly saves: () => number;
  /** The fake `<body>`, whose attributes hold the theme choice. */
  readonly body: Record<string, unknown>;
  /** The `#app` element the screen is built in. */
  readonly app: Record<string, unknown>;
  /** The focused element, or null for the page (`<body>`). */
  readonly focus: FocusTracker;
  /** Callbacks waiting for the next animation frame. */
  readonly frames: (() => void)[];
  /** Sends a message from the host, as JSON. */
  send(json: string): void;
  /** Presses a physical key wherever focus is. True if the webview blocked its default. */
  press(key: string, modifiers?: { readonly shiftKey?: boolean }): boolean;
}

/**
 * Runs the bundled webview against a fake DOM, restoring `saved` as its
 * state, with `bodyAttributes` on <body> as the host's HTML put them.
 */
function runWebview(saved: unknown, bodyAttributes: Readonly<Record<string, string>> = {}): WebviewRun {
  const elements: Record<string, unknown>[] = [];
  const namespaces: { tag: string; ns: unknown }[] = [];
  const posts: unknown[] = [];
  let saves = 0;
  const focus: FocusTracker = { active: null };
  const body = fakeNode({ tag: "body" }, focus);
  const app = fakeNode({ tag: "div" }, focus);
  for (const [name, value] of Object.entries(bodyAttributes)) {
    (body["setAttribute"] as (name: string, value: string) => void)(name, value);
  }
  const frames: (() => void)[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const listen = (type: string, listener: (event: unknown) => void): void => {
    listeners.set(type, listener);
  };
  const document = {
    body,
    getElementById: (id: string) => (id === "app" ? app : null),
    createElement: (tag: string) => {
      const node = fakeNode({ tag }, focus);
      elements.push(node);
      return node;
    },
    createElementNS: (ns: unknown, tag: string) => {
      namespaces.push({ tag, ns });
      return fakeNode({ tag }, focus);
    },
    createTextNode: (text: string) => fakeNode({ textContent: text }, focus),
    addEventListener: listen,
    get activeElement() {
      return focus.active;
    },
  };
  const context = createContext({
    document,
    window: { addEventListener: listen },
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    // So `instanceof` and `closest` see a focused fake <button> as a control.
    HTMLButtonElement: class {
      static [Symbol.hasInstance](value: unknown): boolean {
        return elements.includes(value as Record<string, unknown>) && (value as Record<string, unknown>)["tag"] === "button";
      }
    },
    HTMLInputElement: class {
      static [Symbol.hasInstance](value: unknown): boolean {
        return elements.includes(value as Record<string, unknown>) && (value as Record<string, unknown>)["tag"] === "input";
      }
    },
    Element: class {
      static [Symbol.hasInstance](value: unknown): boolean {
        return elements.includes(value as Record<string, unknown>);
      }
    },
    acquireVsCodeApi: () => ({
      // Copied across the realm boundary as JSON, as VS Code does: the saved
      // state must be a plain object of the webview's own realm to be restored.
      postMessage: (message: unknown) => posts.push(JSON.parse(JSON.stringify(message))),
      getState: () => (saved === undefined ? undefined : webviewJson.parse(JSON.stringify(saved))),
      setState() {
        saves++;
      },
    }),
  });
  const webviewJson = runInContext("JSON", context) as typeof JSON;
  runInContext(bundle(), context);
  const fire = (type: string, event: unknown): void => {
    const listener = listeners.get(type);
    assert.ok(listener, `a ${type} listener`);
    listener(event);
  };
  return {
    elements,
    namespaces,
    posts,
    saves: () => saves,
    body,
    app,
    focus,
    frames,
    send: (json) => fire("message", { data: webviewJson.parse(json) }),
    press: (key, modifiers = {}) => {
      let prevented = false;
      fire("keydown", {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: modifiers.shiftKey ?? false,
        isComposing: false,
        // The focused element, or the page's <body> when nothing is focused.
        target: focus.active ?? fakeNode({ tag: "body" }),
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

/** The one element with this class. */
function byClass(run: WebviewRun, className: string): Record<string, unknown> {
  const found = run.elements.filter((node) => node["className"] === className);
  assert.equal(found.length, 1, className);
  return found[0] ?? {};
}

/** The one element with this accessible name (`aria-label`). */
function byLabel(run: WebviewRun, label: string): Record<string, unknown> {
  const found = run.elements.filter((node) => (node["attributes"] as Record<string, string>)["aria-label"] === label);
  assert.equal(found.length, 1, label);
  return found[0] ?? {};
}

/** Every element with this class, in the order they were made. */
function allByClass(run: WebviewRun, className: string): Record<string, unknown>[] {
  return run.elements.filter((node) => node["className"] === className);
}

/**
 * A snapshot of the text, attributes, `hidden` and `disabled` of the
 * elements made so far. `render` makes new Tried list items on every draw,
 * so a later snapshot compares only the elements that existed at the first one.
 */
function snapshot(run: WebviewRun, count = run.elements.length): string {
  const fields = ["textContent", "placeholder", "value", "attributes", "hidden", "disabled", "className"];
  return JSON.stringify(run.elements.slice(0, count).map((node) => fields.map((field) => node[field])));
}

/** Clicks a fake button with the mouse: its mousedown, then a click with `detail` 1. */
function click(node: Record<string, unknown>): void {
  const listeners = node["listeners"] as Record<string, (event: unknown) => void>;
  listeners["mousedown"]?.({ preventDefault() {} });
  const onClick = listeners["click"];
  assert.ok(onClick, "a click listener");
  onClick({ detail: 1 });
}

/** Presses a fake button from the keyboard: it has focus, and its click has `detail` 0. */
function keyboardClick(node: Record<string, unknown>): void {
  (node["focus"] as () => void)();
  const onClick = (node["listeners"] as Record<string, (event: unknown) => void>)["click"];
  assert.ok(onClick, "a click listener");
  onClick({ detail: 0 });
}

/**
 * A screen reader activating a focused button: it fakes a mouse click
 * (`detail` 1) with no mousedown, so the button keeps focus.
 */
function screenReaderClick(node: Record<string, unknown>): void {
  (node["focus"] as () => void)();
  const onClick = (node["listeners"] as Record<string, (event: unknown) => void>)["click"];
  assert.ok(onClick, "a click listener");
  onClick({ detail: 1 });
}

/** All text and attributes the fake DOM holds, as one string. */
function domText(run: WebviewRun): string {
  return JSON.stringify(
    run.elements.map((node) => [node["textContent"], node["placeholder"], node["value"], node["attributes"]]),
  );
}

/** A random source that makes a session pick `word` as the answer. */
function answerIs(word: string): () => number {
  const index = WORDS.indexOf(word);
  assert.ok(index >= 0, word);
  return () => (index + 0.5) / WORDS.length;
}

/** The saved state after playing `actions` in a round whose answer is BYTE, as plain data. */
function savedAfter(...actions: Action[]): SessionState {
  const session = new Session(WORDS, answerIs("BYTE"));
  const controller = new GameController(session, () => {});
  for (const action of [{ type: "init" } as const, ...actions]) {
    controller.dispatch(action);
  }
  return JSON.parse(JSON.stringify(controller.savedState())) as SessionState;
}

/** A word's hex as ENTER-terminated digit actions. */
function guess(word: string): Action[] {
  return [...[...wordToHex(word)].map((digit) => ({ type: "digit", digit }) as const), { type: "enter" }];
}

const decode = (word: string): Action => ({ type: "decode", word });

describe("media/main.ts: the SVG icons, run as the bundled webview script", () => {
  // Regression test for #32: the bundle ran `buildScreen` before `SVG_NS` was
  // set, so the padlock was made with createElementNS(undefined, …) and never drawn.
  // The Hints light bulb (#23) and the result card's down arrows (#24) are
  // built the same way, so they're checked too, as are How to play's `?` and
  // back arrow (#25), the theme button's sun and moon (#26), and the locked
  // Hints button's and the decode lock badge's padlocks (#46).
  it("creates the icons' SVG elements in the SVG namespace: `?`, sun, moon, padlocks, light bulb, down arrows, back arrow", () => {
    const { namespaces } = runWebview(undefined);
    const padlock = ["svg", "rect", "path"];
    assert.deepEqual(
      namespaces.map((n) => n.tag),
      // The `?`, the sun, the moon, the status padlock, the light bulb, the
      // Hints padlock, the lock badge's padlock, one down arrow per byte,
      // then the back arrow.
      [
        "svg",
        "circle",
        "path",
        "svg",
        "circle",
        "path",
        "svg",
        "path",
        ...padlock,
        "svg",
        "path",
        "path",
        ...padlock,
        ...padlock,
        ...new Array<string[]>(4).fill(["svg", "path"]).flat(),
        "svg",
        "path",
      ],
    );
    for (const { tag, ns } of namespaces) {
      assert.equal(ns, "http://www.w3.org/2000/svg", `<${tag}> namespace`);
    }
  });
});

describe("media/main.ts: the result card, run as the bundled webview script", () => {
  it("keeps the answer out of the DOM while a round is in progress, hints on with every byte known", () => {
    // BITE gets B, T and E fully right in one row; LYNX gets Y. No row is fully right.
    const words = ["BITE", "TEAM", "BEAT", "BEST", "LYNX"];
    const saved = savedAfter(...words.flatMap((word) => guess(word)), { type: "toggleHints" });
    assert.equal(saved.round.phase, "guess");
    const run = runWebview(saved);
    // The round really was restored: the hint strip shows its letters.
    const cells = run.elements.filter((node) => node["className"] === "hint-cell").map((node) => node["textContent"]);
    assert.deepEqual(cells, ["B", "Y", "T", "E"]);
    assert.doesNotMatch(domText(run), /BYTE|42595445/);
    assert.equal(byClass(run, "result")["hidden"], true);
    assert.equal(byClass(run, "result-heading")["textContent"], "");
    assert.equal(byClass(run, "result-outcome")["textContent"], "");
    assert.doesNotMatch(domText(run), /Congrats|cracked|Unlucky/);
  });

  it("keeps the answer out of the DOM at the decode step after a solved grid, with Hints locked", () => {
    const run = runWebview(savedAfter({ type: "toggleHints" }, ...guess("TEAM"), { type: "toggleHints" }, ...guess("BYTE")));
    assert.doesNotMatch(domText(run), /BYTE|42595445/);
    assert.equal(byClass(run, "hint-strip")["hidden"], true);
    assert.ok(allByClass(run, "hint-cell").every((cell) => cell["textContent"] === ""));
    assert.equal(byClass(run, "result")["hidden"], true);
  });

  it("brings a restored solved round's card back, without posting roundFinished again", () => {
    const saved = savedAfter(...guess("TEAM"), ...guess("BYTE"), decode("BYTE"));
    assert.equal(saved.reported, true);
    const run = runWebview(saved);
    assert.equal(byClass(run, "result")["hidden"], false);
    assert.equal(byClass(run, "result-heading")["textContent"], "Decoded: BYTE");
    assert.equal(byClass(run, "result-outcome")["textContent"], "Congrats! You cracked it");
    assert.equal(byClass(run, "result-line")["textContent"], "2 of 6 rows attempted · 0 hints used");
    assert.equal(byClass(run, "result-note")["hidden"], false);
    for (const replaced of ["legend", "decode", "keypad"]) {
      assert.equal(byClass(run, replaced)["hidden"], true, replaced);
    }
    assert.deepEqual(run.posts, [{ type: "ready" }]);
  });

  it("shows the hint count on the result card (#38)", () => {
    const toggle = { type: "toggleHints" } as const;
    const run = runWebview(savedAfter(toggle, ...guess("TEAM"), toggle, ...guess("BYTE"), decode("BYTE")));
    assert.equal(byClass(run, "result-line")["textContent"], "2 of 6 rows attempted · 2 hints used");
  });

  it("brings a restored failed round's card back, without posting roundFinished again", () => {
    const words = ["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"];
    const run = runWebview(savedAfter(...words.flatMap((word) => guess(word)), decode("ABLE")));
    assert.equal(byClass(run, "result-heading")["textContent"], "The word was BYTE");
    assert.equal(byClass(run, "result-outcome")["textContent"], "Unlucky!");
    assert.equal(byClass(run, "result-line")["textContent"], "6 of 6 rows attempted · 0 hints used");
    assert.deepEqual(run.posts, [{ type: "ready" }]);
  });

  it("draws New round as a real <button> with its text set by textContent", () => {
    const run = runWebview(savedAfter(...guess("BYTE"), decode("BYTE")));
    const button = byClass(run, "result-button");
    assert.equal(button["tag"], "button");
    assert.equal(button["type"], "button");
    assert.equal(button["textContent"], "New round");
  });

  it("names the card with the outcome, then the heading, so screen readers hear the outcome first", () => {
    const run = runWebview(savedAfter(...guess("BYTE"), decode("BYTE")));
    const card = byClass(run, "result");
    assert.equal(card["tag"], "section");
    assert.deepEqual(card["attributes"], { "aria-labelledby": "result-outcome result-heading" });
    assert.equal(byClass(run, "result-outcome")["id"], "result-outcome");
    assert.equal(byClass(run, "result-heading")["id"], "result-heading");
    // Created first, it comes first in the card's reading order.
    const order = run.elements.map((node) => node["className"]);
    assert.ok(order.indexOf("result-outcome") < order.indexOf("result-heading"));
    assert.match(source, /resultHead\.append\(resultOutcome, resultHeading, resultLine\)/);
  });
});

/** Saved states of a finished round whose answer is BYTE. */
const FINISHED: readonly (readonly [string, () => SessionState])[] = [
  ["solved", () => savedAfter(...guess("TEAM"), ...guess("BYTE"), decode("BYTE"))],
  ["failed", () => savedAfter(...["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"].flatMap((w) => guess(w)), decode("ABLE"))],
  ["failed after a solved grid", () => savedAfter(...guess("TEAM"), ...guess("BYTE"), decode("BITE"))],
];

describe("media/main.ts: focus on the result card, run as the bundled webview script", () => {
  for (const [name, saved] of FINISHED) {
    it(`focuses New round once when a restored ${name} round's card appears`, () => {
      const run = runWebview(saved());
      const button = byClass(run, "result-button");
      assert.equal(button["focusCalls"], 1);
      assert.equal(run.focus.active, button);
    });
  }

  it("doesn't focus New round while a round is in progress", () => {
    const run = runWebview(savedAfter(...guess("TEAM"), ...guess("BEAT")));
    assert.equal(byClass(run, "result-button")["focusCalls"], 0);
    assert.equal(run.focus.active, null, "the page keeps the keyboard, for the next hex row");
  });

  it("doesn't focus New round again on later renders while the card is already showing", () => {
    const run = runWebview(FINISHED[0]?.[1]());
    // Ignored keys and a repeated init: each still ends with a render.
    run.press("4");
    run.press("Backspace");
    run.send(JSON.stringify({ type: "init", stats: toStatsView(EMPTY_STATS), theme: "system" }));
    assert.equal(byClass(run, "result-button")["focusCalls"], 1);
  });

  for (const [name, saved] of FINISHED) {
    it(`gives focus back to the page on New round, so hex typing and ENTER still work: ${name}`, () => {
      const run = runWebview(saved());
      const button = byClass(run, "result-button");
      assert.equal(run.focus.active, button);
      run.send('{"type":"newRound"}');
      assert.equal(byClass(run, "result")["hidden"], true);
      assert.equal(run.focus.active, null, "focus is on the page, not the hidden button");
      for (const digit of wordToHex("TEAM")) {
        run.press(digit);
      }
      assert.equal(run.elements.filter((node) => node["className"] === "tile tile-typed").length, 8);
      run.press("Enter");
      // The new round's answer is random, so check the row left the typed state rather than its marks.
      assert.equal(allByClass(run, "tile tile-typed").length, 0, "ENTER scored the row");
      assert.equal(allByClass(run, "tile tile-empty").length, 40, "only row 1 is filled");
      assert.equal(run.focus.active, null, "focus stays on the page for the next row");
    });
  }
});

describe("media/main.ts: open mode's agentOpen (#111), run as the bundled webview script", () => {
  const INIT = JSON.stringify({ type: "init", stats: toStatsView(EMPTY_STATS), theme: "system" });
  const AGENT_OPEN = '{"type":"agentOpen"}';

  /** What the visually hidden announcement region says now. */
  function announced(run: WebviewRun): unknown {
    const region = run.elements.find(
      (node) => node["tag"] === "p" && node["className"] === "sr-only" && (node["attributes"] as Record<string, string>)["aria-live"] === "polite",
    );
    return region?.["textContent"];
  }

  it("hands agentOpen to the controller, like the host's other messages", () => {
    assert.match(source, /case "agentOpen":\s*controller\.dispatch\(\{ type: "agentOpen" \}\);\s*break;/);
  });

  const inProgress: readonly (readonly [string, () => SessionState])[] = [
    ["a fresh round", () => savedAfter()],
    ["a half-typed row", () => savedAfter(...guess("TEAM"), { type: "digit", digit: "4" })],
    ["hints on", () => savedAfter(...guess("BITE"), { type: "toggleHints" })],
    ["the decode step after a solved grid", () => savedAfter(...guess("TEAM"), ...guess("BYTE"))],
    ["the decode step after row 6", () => savedAfter(...["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"].flatMap((w) => guess(w)))],
  ];
  for (const [name, saved] of inProgress) {
    it(`shows a restored round in progress untouched: ${name}`, () => {
      const run = runWebview(saved());
      run.send(INIT);
      const before = snapshot(run);
      const saves = run.saves();
      run.send(AGENT_OPEN);
      assert.equal(snapshot(run), before, "the screen is unchanged");
      assert.equal(run.saves(), saves + 1, "saved through changed(), as every action is");
      assert.deepEqual(run.posts, [{ type: "ready" }], "posts nothing back");
    });
  }

  for (const [name, saved] of FINISHED) {
    it(`starts a new round from the restored ${name} result card, saved through changed()`, () => {
      const run = runWebview(saved());
      run.send(INIT);
      assert.equal(byClass(run, "result")["hidden"], false);
      const saves = run.saves();
      run.send(AGENT_OPEN);
      assert.equal(byClass(run, "result")["hidden"], true);
      assert.equal(byClass(run, "keypad")["hidden"], false);
      assert.equal(allByClass(run, "tile tile-empty").length, 48, "an empty grid");
      assert.equal(run.saves(), saves + 1);
      assert.equal(announced(run), "New round");
      assert.deepEqual(run.posts, [{ type: "ready" }], "posts no roundFinished");
    });
  }

  it("starts one round, not two, on a fresh panel with no saved state", () => {
    const run = runWebview(undefined);
    run.send(INIT);
    run.press("4");
    run.send(AGENT_OPEN);
    assert.equal(allByClass(run, "tile tile-typed").length, 1, "the digit typed in init's round is still there");
    assert.equal(announced(run), "", "no new round was announced");
  });

  it("ignores an agentOpen with any extra field", () => {
    const [, saved] = FINISHED[0] ?? [];
    assert.ok(saved);
    const run = runWebview(saved());
    run.send(INIT);
    const saves = run.saves();
    for (const json of ['{"type":"agentOpen","x":1}', '{"type":"AgentOpen"}', '"agentOpen"']) {
      run.send(json);
    }
    assert.equal(byClass(run, "result")["hidden"], false, "the result card stays");
    assert.equal(run.saves(), saves, "no action ran");
  });
});

describe("media/main.ts: How to play (page 5), run as the bundled webview script", () => {
  const halfTyped: Action[] = [...guess("TEAM"), ...[..."4259"].map((digit) => ({ type: "digit", digit }) as const)];
  const firstFive = ["BITE", "TEAM", "BEAT", "BEST", "BUSY"].flatMap((w) => guess(w));
  /**
   * Every screen How to play opens from: its saved state (answer BYTE), or
   * undefined for a fresh panel. Not the decode step, where `?` is locked (#53).
   */
  const screens: readonly (readonly [string, () => SessionState | undefined])[] = [
    ["a fresh panel", () => undefined],
    ["a half-typed row", () => savedAfter(...halfTyped)],
    ["a scored row", () => savedAfter(...guess("TEAM"))],
    ["row 6", () => savedAfter(...firstFive)],
    ["the result card", () => FINISHED[0]?.[1]()],
  ];

  it('draws `?` and the back arrow as real <button>s named "How to play" and "Back to game"', () => {
    const run = runWebview(undefined);
    for (const name of ["How to play", "Back to game"]) {
      const button = byLabel(run, name);
      assert.equal(button["tag"], "button", name);
      assert.equal(button["type"], "button", name);
      assert.equal(button["className"], "icon-button", name);
    }
  });

  it('starts closed, with the heading "How to play" set by textContent', () => {
    const run = runWebview(undefined);
    assert.equal(byClass(run, "how-to-play")["hidden"], true);
    assert.equal(byClass(run, "game")["hidden"], false);
    const heading = byClass(run, "how-to-play-heading");
    assert.equal(heading["tag"], "h2");
    assert.equal(heading["textContent"], "How to play");
    assert.deepEqual(byClass(run, "how-to-play")["attributes"], { "aria-labelledby": "how-to-play-heading" });
  });

  it("draws the RULES and ASCII CHEATSHEET headings, the seven rules and the rule 3 chips", () => {
    const run = runWebview(undefined);
    assert.deepEqual(
      allByClass(run, "section-heading").map((node) => node["textContent"]),
      ["Rules", "ASCII cheatsheet"],
    );
    assert.equal(byClass(run, "rules")["tag"], "ol");
    assert.deepEqual(
      ["chip chip-right", "chip chip-wrong", "chip chip-absent"].map((name) => byClass(run, name)["textContent"]),
      ["blue", "orange", "grey"],
    );
    assert.deepEqual(allByClass(run, "code").map((node) => node["textContent"]), ["4_", "5_"]);
  });

  it("draws 26 cheatsheet cards, A 41 to Z 5A, with textContent and a label for screen readers", () => {
    const run = runWebview(undefined);
    assert.equal(allByClass(run, "cheat-card").length, 26);
    const letters = allByClass(run, "cheat-letter");
    const hexes = allByClass(run, "cheat-hex");
    assert.equal(letters.map((node) => node["textContent"]).join(""), "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    assert.deepEqual(
      hexes.map((node) => node["textContent"]),
      cheatsheet().map((card) => card.hex),
    );
    assert.equal(hexes[0]?.["textContent"], "41");
    assert.equal(hexes[25]?.["textContent"], "5A");
    for (const node of [...letters, ...hexes]) {
      assert.deepEqual(node["attributes"], { "aria-hidden": "true" });
    }
    const labels = run.elements
      .filter((node) => node["className"] === "sr-only" && / is [45]/.test(String(node["textContent"])))
      .map((node) => node["textContent"]);
    assert.deepEqual(
      labels,
      cheatsheet().map((card) => card.label),
    );
  });

  for (const [name, saved] of screens) {
    it(`opens from ${name} with ?, moving focus to the back arrow`, () => {
      const run = runWebview(saved());
      click(byLabel(run, "How to play"));
      assert.equal(byClass(run, "how-to-play")["hidden"], false);
      assert.equal(byClass(run, "game")["hidden"], true);
      assert.equal(run.focus.active, byLabel(run, "Back to game"));
    });

    it(`goes back to ${name} unchanged with the back arrow after a mouse open, focus off ?`, () => {
      const run = runWebview(saved());
      const count = run.elements.length;
      const before = snapshot(run);
      click(byLabel(run, "How to play"));
      click(byLabel(run, "Back to game"));
      assert.equal(byClass(run, "how-to-play")["hidden"], true);
      assert.equal(byClass(run, "game")["hidden"], false);
      assert.equal(snapshot(run, count), before);
      assert.equal(run.focus.active, null, "focus goes back to the page");
    });

    it(`goes back to ${name} unchanged with Escape after a mouse open, focus off ?`, () => {
      const run = runWebview(saved());
      const count = run.elements.length;
      const before = snapshot(run);
      click(byLabel(run, "How to play"));
      run.press("Escape");
      assert.equal(byClass(run, "how-to-play")["hidden"], true);
      assert.equal(snapshot(run, count), before);
      assert.equal(run.focus.active, null, "focus goes back to the page");
    });

    it(`goes back to ${name} unchanged with Escape after a keyboard open, focus on ?`, () => {
      const run = runWebview(saved());
      const count = run.elements.length;
      const before = snapshot(run);
      keyboardClick(byLabel(run, "How to play"));
      assert.equal(run.focus.active, byLabel(run, "Back to game"));
      run.press("Escape");
      assert.equal(byClass(run, "how-to-play")["hidden"], true);
      assert.equal(snapshot(run, count), before);
      assert.equal(run.focus.active, byLabel(run, "How to play"));
    });

    it(`goes back to ${name} with the back arrow from the keyboard after a keyboard open, focus on ?`, () => {
      const run = runWebview(saved());
      keyboardClick(byLabel(run, "How to play"));
      keyboardClick(byLabel(run, "Back to game"));
      assert.equal(byClass(run, "how-to-play")["hidden"], true);
      assert.equal(run.focus.active, byLabel(run, "How to play"));
    });

    it(`keeps typed keys from the grid and the decode box while open, from ${name}`, () => {
      const run = runWebview(saved());
      const count = run.elements.length;
      const before = snapshot(run);
      const decodeInput = byClass(run, "decode-input");
      click(byLabel(run, "How to play"));
      const focusCalls = decodeInput["focusCalls"];
      for (const key of [..."4259beatXYZ ", "Backspace", "Enter", "Delete"]) {
        run.press(key);
      }
      assert.equal(decodeInput["focusCalls"], focusCalls, "the decode box never took focus");
      assert.equal(run.focus.active, byLabel(run, "Back to game"));
      run.press("Escape");
      assert.equal(snapshot(run, count), before, "the grid and decode box are as they were");
    });
  }

  it("ignores Escape on the game screen", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    const count = run.elements.length;
    const before = snapshot(run);
    run.press("Escape");
    assert.equal(byClass(run, "how-to-play")["hidden"], true);
    assert.equal(snapshot(run, count), before);
  });

  it("doesn't focus New round again when going back to the result card", () => {
    const run = runWebview(FINISHED[0]?.[1]());
    const newRound = byClass(run, "result-button");
    assert.equal(newRound["focusCalls"], 1);
    click(byLabel(run, "How to play"));
    run.press("Escape");
    assert.equal(newRound["focusCalls"], 1);
  });

  it("shows the game, not How to play, after a reload", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    assert.equal(byClass(run, "how-to-play")["hidden"], true);
    assert.equal(run.focus.active, null);
  });

  // Regression tests: focus went back to `?` after every close, so the next
  // physical Enter or Space reopened How to play.
  it("lets ENTER score the row after a mouse open and Escape, instead of reopening How to play", () => {
    // TEAM, not the answer: a fully right row would move focus to the decode box.
    const run = runWebview(savedAfter());
    for (const digit of "5445") {
      run.press(digit);
    }
    click(byLabel(run, "How to play"));
    run.press("Escape");
    for (const digit of "414D") {
      run.press(digit);
    }
    assert.equal(allByClass(run, "tile tile-typed").length, 8);
    // A real browser would click a focused `?` on Enter; the page has focus instead.
    assert.equal(run.focus.active, null);
    run.press("Enter");
    assert.equal(byClass(run, "how-to-play")["hidden"], true);
    assert.equal(allByClass(run, "tile tile-typed").length, 0, "ENTER scored the row");
    assert.equal(run.focus.active, null);
  });

  it("counts a screen reader's click on a focused ? as a keyboard open: focus goes back to ?", () => {
    const closes = [
      (run: WebviewRun) => run.press("Escape"),
      (run: WebviewRun) => screenReaderClick(byLabel(run, "Back to game")),
    ];
    for (const close of closes) {
      const run = runWebview(savedAfter(...guess("TEAM")));
      screenReaderClick(byLabel(run, "How to play"));
      assert.equal(run.focus.active, byLabel(run, "Back to game"));
      close(run);
      assert.equal(byClass(run, "how-to-play")["hidden"], true);
      assert.equal(run.focus.active, byLabel(run, "How to play"));
    }
  });

});

describe("media/main.ts: How to play locked at the decode step (#53), run as the bundled webview script", () => {
  const firstFive = ["BITE", "TEAM", "BEAT", "BEST", "BUSY"].flatMap((w) => guess(w));

  /** Types `word`'s hex and presses Enter on the physical keyboard. */
  function score(run: WebviewRun, word: string): void {
    for (const key of [...wordToHex(word), "Enter"]) {
      run.press(key);
    }
  }

  /** The `?` button. */
  function help(run: WebviewRun): Record<string, unknown> {
    return byLabel(run, "How to play");
  }

  /** The decode steps, each reached by playing it in the panel. */
  const decodeSteps: readonly (readonly [string, (run: WebviewRun) => void])[] = [
    ["a solved grid", (run) => score(run, "BYTE")],
    ["row 6", (run) => score(run, "ABLE")],
  ];

  for (const [name, reach] of decodeSteps) {
    it(`disables ? after ${name}, keeping its name, its icon and no description`, () => {
      const run = runWebview(name === "row 6" ? savedAfter(...firstFive) : savedAfter(...guess("TEAM")));
      assert.equal(help(run)["disabled"], false);
      reach(run);
      const button = help(run);
      assert.equal(button["disabled"], true);
      assert.equal(button["className"], "icon-button");
      // Only the name: no aria-describedby, no aria-disabled, no title.
      assert.deepEqual(button["attributes"], { "aria-label": "How to play" });
    });

    it(`opens nothing after ${name}: no click, keyboard press or key reaches How to play`, () => {
      const run = runWebview(name === "row 6" ? savedAfter(...firstFive) : savedAfter());
      reach(run);
      const decodeInput = byClass(run, "decode-input");
      const count = run.elements.length;
      const before = snapshot(run);
      // A real browser never fires these on a disabled button; the controller ignores them anyway.
      click(help(run));
      keyboardClick(help(run));
      screenReaderClick(help(run));
      (decodeInput["focus"] as () => void)();
      for (const key of ["?", "F1", "h", "Enter", " ", "Escape"]) {
        run.press(key);
      }
      assert.equal(byClass(run, "how-to-play")["hidden"], true);
      assert.equal(byClass(run, "game")["hidden"], false);
      assert.equal(snapshot(run, count), before);
    });
  }

  it("moves focus from ? to the decode box when ? locks while focused", () => {
    const run = runWebview(savedAfter());
    // `?` has focus: hex digits typed there still reach the grid.
    (help(run)["focus"] as () => void)();
    for (const digit of wordToHex("BYTE")) {
      run.press(digit);
    }
    assert.equal(run.focus.active, help(run));
    // ENTER pressed without taking focus, as a touch or pointer might.
    const enter = byLabel(run, "ENTER, enter row");
    (enter["listeners"] as Record<string, (event: unknown) => void>)["click"]?.({ detail: 1 });
    assert.equal(help(run)["disabled"], true);
    assert.equal(run.focus.active, byClass(run, "decode-input"));
  });

  it("shows ? locked when a round saved at the decode step is restored", () => {
    for (const saved of [savedAfter(...guess("BYTE")), savedAfter(...firstFive, ...guess("ABLE"))]) {
      const run = runWebview(saved);
      assert.equal(help(run)["disabled"], true);
      assert.equal(run.focus.active, byClass(run, "decode-input"));
      click(help(run));
      assert.equal(byClass(run, "how-to-play")["hidden"], true);
    }
  });

  it("leaves ? enabled before the decode step", () => {
    for (const saved of [undefined, savedAfter(), savedAfter(...guess("TEAM")), savedAfter(...firstFive)]) {
      assert.equal(help(runWebview(saved))["disabled"], false);
    }
  });

  it("enables ? again once the round is solved or failed, and How to play opens", () => {
    for (const word of ["byte", "BITE"]) {
      const run = runWebview(savedAfter(...guess("BYTE")));
      assert.equal(help(run)["disabled"], true);
      byClass(run, "decode-input")["value"] = word;
      (byClass(run, "decode")["listeners"] as Record<string, (event: unknown) => void>)["submit"]?.({ preventDefault() {} });
      assert.equal(byClass(run, "result")["hidden"], false, word);
      assert.equal(help(run)["disabled"], false, word);
      click(help(run));
      assert.equal(byClass(run, "how-to-play")["hidden"], false, word);
    }
  });
});

describe("media/main.ts: announcing messages, run as the bundled webview script", () => {
  /** A fresh round (answer BYTE) with AAAA typed and entered: "AAAA isn't in the word list". */
  function withError(): WebviewRun {
    const run = runWebview(savedAfter());
    for (const key of [...wordToHex("AAAA"), "Enter"]) {
      run.press(key);
    }
    assert.equal(byClass(run, "message")["textContent"], "AAAA isn't in the word list");
    return run;
  }

  it("reads the same error out again when it happens again: cleared, then set on the next frame", () => {
    const run = withError();
    const message = byClass(run, "message");
    const frames = run.frames.length;
    run.press("Enter");
    assert.equal(message["textContent"], "");
    assert.equal(run.frames.length, frames + 1);
    run.frames.at(-1)?.();
    assert.equal(message["textContent"], "AAAA isn't in the word list");
  });

  // Regression test: a delayed re-announce must not bring back an error that
  // a later action has already cleared.
  for (const key of ["Backspace", "4"]) {
    it(`drops a queued re-announce once the message is cleared, here by ${key}`, () => {
      const run = withError();
      const message = byClass(run, "message");
      run.press("Enter");
      const queued = run.frames.at(-1);
      assert.ok(queued, "a delayed rewrite is queued");
      run.press(key);
      assert.equal(message["textContent"], "");
      queued();
      assert.equal(message["textContent"], "", "the stale error stays gone");
    });
  }

  it("reads a repeated hex row's message out again when the same repeat is entered twice (#34)", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    for (const key of [...wordToHex("TEAM"), "Enter"]) {
      run.press(key);
    }
    const message = byClass(run, "message");
    assert.equal(message["textContent"], "You've already tried 54 45 41 4D");
    run.press("Enter");
    assert.equal(message["textContent"], "", "cleared");
    run.frames.at(-1)?.();
    assert.equal(message["textContent"], "You've already tried 54 45 41 4D", "then set again");
  });

  it("draws a restored error once after a hide and show, with no re-announce, and keeps it through init (#34)", () => {
    const run = runWebview(savedAfter(...guess("TEAM"), ...guess("TEAM")));
    const message = byClass(run, "message");
    assert.equal(message["textContent"], "You've already tried 54 45 41 4D");
    assert.equal(message["textWrites"], 1, "one plain write, in the first render");
    assert.equal(run.frames.length, 0, "no clear-and-rewrite queued");
    run.send(JSON.stringify({ type: "init", stats: toStatsView(EMPTY_STATS), theme: "system" }));
    assert.equal(message["textContent"], "You've already tried 54 45 41 4D");
    assert.equal(message["textWrites"], 1, "init doesn't write it again");
    assert.equal(allByClass(run, "tile tile-typed").length, 8, "the typed digits are back too");
    // The same repeat again is a new notice, read out again.
    run.press("Enter");
    assert.equal(message["textContent"], "");
    run.frames.at(-1)?.();
    assert.equal(message["textContent"], "You've already tried 54 45 41 4D");
  });

  it("doesn't clear and rewrite a standing error when How to play opens and closes", () => {
    const closes = [(run: WebviewRun) => run.press("Escape"), (run: WebviewRun) => click(byLabel(run, "Back to game"))];
    for (const close of closes) {
      const run = withError();
      const message = byClass(run, "message");
      const writes = message["textWrites"];
      const frames = run.frames.length;
      click(byLabel(run, "How to play"));
      close(run);
      assert.equal(message["textWrites"], writes, "no write to the live region");
      assert.equal(run.frames.length, frames, "no delayed rewrite");
      assert.equal(message["textContent"], "AAAA isn't in the word list");
    }
  });
});

describe("media/main.ts: the decode lock (#46), run as the bundled webview script", () => {
  /** The visually hidden live region that reads scored rows out. */
  function announcement(run: WebviewRun): Record<string, unknown> {
    const found = run.elements.filter(
      (node) => node["tag"] === "p" && node["className"] === "sr-only" && (node["attributes"] as Record<string, string>)["aria-live"] === "polite",
    );
    assert.equal(found.length, 1, "one announcement region");
    return found[0] ?? {};
  }

  /** Types `word` in the decode box and submits the form, as Submit or Enter in the box does. */
  function submitWord(run: WebviewRun, word: string): void {
    byClass(run, "decode-input")["value"] = word;
    const onSubmit = (byClass(run, "decode")["listeners"] as Record<string, (event: unknown) => void>)["submit"];
    assert.ok(onSubmit, "a submit listener");
    onSubmit({ preventDefault() {} });
  }

  /** Types `word`'s hex and presses Enter on the physical keyboard. */
  function score(run: WebviewRun, word: string): void {
    for (const key of [...wordToHex(word), "Enter"]) {
      run.press(key);
    }
  }

  /** The lock over the decode panel: badge, title and message. */
  function lock(run: WebviewRun): Record<string, unknown> {
    return byClass(run, "decode-lock");
  }

  it("locks the decode panel from the start: the box and its button disabled, under the lock's real text", () => {
    const run = runWebview(savedAfter());
    assert.equal(byClass(run, "decode-input")["disabled"], true);
    assert.equal(byClass(run, "decode-button")["disabled"], true);
    assert.equal(lock(run)["hidden"], false);
    assert.equal(byClass(run, "lock-title")["textContent"], "Locked until you crack the hex row");
    assert.equal(byClass(run, "lock-message")["textContent"], "Get every tile blue to unlock Decode.");
    assert.equal(byClass(run, "lock-title")["tag"], "p");
    assert.equal(byClass(run, "lock-badge")["tag"], "span");
  });

  it("keeps the panel locked after a scored row that isn't fully right, with no message and focus left alone", () => {
    const run = runWebview(savedAfter());
    score(run, "TEAM");
    assert.equal(byClass(run, "message")["textContent"], "");
    assert.equal(announcement(run)["textContent"], "Row 1: 1 Right spot, 4 Wrong spot, 3 Not in word");
    assert.equal(run.focus.active, null);
    assert.ok(allByClass(run, "key").every((key) => key["disabled"] === false));
    assert.equal(byClass(run, "decode-input")["disabled"], true);
    assert.equal(lock(run)["hidden"], false);
  });

  it("doesn't let typed letters reach the locked box", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    const input = byClass(run, "decode-input");
    for (const key of [..."tomsbyte"]) {
      run.press(key);
    }
    assert.equal(input["focusCalls"], 0, "the box never took focus");
    assert.equal(input["value"], "");
    // Only the hex letters among them reached the grid: b, e.
    assert.equal(allByClass(run, "tile tile-typed").length, 2);
  });

  it("unlocks on a fully right row: the box and Submit enabled and focused, the lock gone, the keypad and Hints off", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    score(run, "BYTE");
    const input = byClass(run, "decode-input");
    assert.equal(input["disabled"], false);
    assert.equal(byClass(run, "decode-button")["disabled"], false);
    assert.equal(byClass(run, "decode-button")["textContent"], "Submit");
    assert.equal(lock(run)["hidden"], true);
    assert.equal(run.focus.active, input);
    assert.ok(allByClass(run, "key").every((key) => key["disabled"] === true));
    const hints = byClass(run, "hints-button");
    assert.equal(hints["disabled"], true);
    assert.equal((hints["attributes"] as Record<string, string>)["aria-describedby"], "hints-locked-note");
    assert.equal((hints["attributes"] as Record<string, string>)["aria-pressed"], "false");
    assert.match(String(announcement(run)["textContent"]), /^Row 2: 8 Right spot, 0 Wrong spot, 0 Not in word\. Hex solved/);
  });

  it("describes the locked Hints button with a hidden note, which isn't otherwise shown", () => {
    const run = runWebview(savedAfter(...guess("BYTE")));
    const note = run.elements.find((node) => node["id"] === "hints-locked-note");
    assert.ok(note);
    assert.equal(note["textContent"], "Locked for the rest of the round");
    assert.equal(note["hidden"], true);
  });

  it("unlocks after row 6 without a fully right row", () => {
    const run = runWebview(savedAfter(...["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"].flatMap((word) => guess(word))));
    assert.equal(byClass(run, "decode-input")["disabled"], false);
    assert.equal(lock(run)["hidden"], true);
    assert.equal(byClass(run, "hints-button")["disabled"], true);
  });

  it("sends letters typed outside the box to it once unlocked", () => {
    const run = runWebview(savedAfter(...guess("BYTE")));
    const input = byClass(run, "decode-input");
    (input["blur"] as () => void)();
    const calls = Number(input["focusCalls"]);
    run.press("t");
    assert.equal(input["focusCalls"], calls + 1);
  });

  it("keeps a rejected word in the box with a plain-text reason and its focus, staying unlocked", () => {
    const run = runWebview(savedAfter(...guess("BYTE")));
    const input = byClass(run, "decode-input");
    submitWord(run, "QXZJ");
    assert.equal(input["value"], "QXZJ");
    assert.equal(byClass(run, "message")["textContent"], "QXZJ isn't in the word list");
    assert.equal(run.focus.active, input);
    assert.equal(input["disabled"], false);
    assert.equal(byClass(run, "result")["hidden"], true);
  });

  it("solves the round from the box after a solved grid with rows left", () => {
    const run = runWebview(savedAfter(...guess("BYTE")));
    submitWord(run, "byte");
    assert.equal(byClass(run, "result")["hidden"], false);
    assert.equal(byClass(run, "result-line")["textContent"], "1 of 6 rows attempted · 0 hints used");
    assert.deepEqual(run.posts.at(-1), { type: "roundFinished", solved: true, rowsUsed: 1, answerTries: 1, hintsUsed: 0 });
  });

  it("ends the round on a wrong word after a solved grid, revealing the answer", () => {
    const run = runWebview(savedAfter(...guess("TEAM"), ...guess("BYTE")));
    submitWord(run, "BITE");
    assert.equal(byClass(run, "result")["hidden"], false);
    assert.equal(byClass(run, "result-heading")["textContent"], "The word was BYTE");
    assert.equal(byClass(run, "result-line")["textContent"], "2 of 6 rows attempted · 0 hints used");
    assert.deepEqual(run.posts.at(-1), { type: "roundFinished", solved: false, rowsUsed: 2, answerTries: 1, hintsUsed: 0 });
    assert.equal(run.focus.active, byClass(run, "result-button"));
  });

  it("brings the lock back after a hide and show, and the unlocked step too", () => {
    assert.equal(lock(runWebview(savedAfter(...guess("TEAM"))))["hidden"], false);
    const unlocked = runWebview(savedAfter(...guess("TEAM"), ...guess("BYTE")));
    assert.equal(lock(unlocked)["hidden"], true);
    assert.equal(byClass(unlocked, "decode-input")["disabled"], false);
    assert.equal(byClass(unlocked, "hints-button")["disabled"], true);
  });

  it("rejects a repeated hex guess typed in lowercase with a visible reason in uppercase byte pairs, keeping its digits", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    for (const key of [..."5445414d", "Enter"]) {
      run.press(key);
    }
    assert.equal(byClass(run, "message")["textContent"], "You've already tried 54 45 41 4D");
    assert.equal(allByClass(run, "tile tile-typed").length, 8);
  });

  it('shows no "1 try per row" and no Tried list anywhere', () => {
    for (const saved of [savedAfter(), savedAfter(...guess("TEAM")), savedAfter(...guess("BYTE")), savedAfter(...guess("BYTE"), decode("BITE"))]) {
      assert.doesNotMatch(domText(runWebview(saved)), /try per row|Tried/i);
    }
  });
});

describe("media/main.ts: the theme button (#26), run as the bundled webview script", () => {
  /** The theme button: the one button named by `THEME_BUTTON_LABEL`. */
  function themeButton(run: WebviewRun): Record<string, unknown> {
    const names: readonly string[] = Object.values(THEME_BUTTON_LABEL);
    const found = run.elements.filter((node) => names.includes(String(attributes(node)["aria-label"])));
    assert.equal(found.length, 1, "one theme button");
    return found[0] ?? {};
  }

  function attributes(node: Record<string, unknown>): Record<string, string> {
    return node["attributes"] as Record<string, string>;
  }

  /** The forced choice on <body>, or undefined for "system". */
  const forced = (run: WebviewRun): string | undefined => attributes(run.body)[THEME_ATTRIBUTE];

  const init = (theme: unknown): string => JSON.stringify({ type: "init", stats: toStatsView(EMPTY_STATS), theme });

  /** Every element but the theme button, for checking a press changed nothing else. */
  function everythingElse(run: WebviewRun): string {
    const button = themeButton(run);
    const fields = ["textContent", "placeholder", "value", "attributes", "hidden", "disabled", "className"];
    return JSON.stringify(run.elements.filter((node) => node !== button).map((node) => fields.map((field) => node[field])));
  }

  it("is a real <button> with the 44px icon-button class, named for what the next press does", () => {
    const run = runWebview(undefined);
    const button = themeButton(run);
    assert.equal(button["tag"], "button");
    assert.equal(button["type"], "button");
    assert.equal(button["className"], "icon-button");
    assert.equal(attributes(button)["aria-label"], "Switch to light theme");
    assert.equal(forced(run), undefined, "no saved choice: the panel follows VS Code");
  });

  for (const [name, press] of [
    ["the mouse", click],
    ["the keyboard", keyboardClick],
  ] as const) {
    it(`cycles system → light → dark → system with ${name}, sending setTheme each time`, () => {
      const run = runWebview(undefined);
      run.send(init("system"));
      const steps: readonly (readonly [Theme, string | undefined, string])[] = [
        ["light", "light", "Switch to dark theme"],
        ["dark", "dark", "Follow VS Code's theme"],
        ["system", undefined, "Switch to light theme"],
      ];
      for (const [theme, attribute, label] of steps) {
        press(themeButton(run));
        assert.equal(forced(run), attribute, theme);
        assert.equal(attributes(themeButton(run))["aria-label"], label, theme);
        assert.deepEqual(run.posts.at(-1), { type: "setTheme", theme });
      }
      assert.equal(run.posts.filter((post) => (post as { type: string }).type === "setTheme").length, 3);
    });
  }

  it("isn't a game action: it saves nothing and changes nothing else on the screen", () => {
    const halfTyped = [...guess("TEAM"), ...[..."4259"].map((digit) => ({ type: "digit", digit }) as const)];
    const run = runWebview(savedAfter(...halfTyped));
    run.send(init("system"));
    const saves = run.saves();
    const before = everythingElse(run);
    for (let i = 0; i < THEMES.length; i++) {
      click(themeButton(run));
      assert.equal(run.saves(), saves, "no setState");
      assert.equal(everythingElse(run), before);
    }
  });

  it("leaves the decode box's focus alone when pressed with the mouse", () => {
    const words = ["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"];
    const run = runWebview(savedAfter(...words.flatMap((word) => guess(word))));
    const input = byClass(run, "decode-input");
    assert.equal(run.focus.active, input);
    click(themeButton(run));
    assert.equal(run.focus.active, input);
  });

  for (const theme of THEMES) {
    it(`shows the ${theme} choice that init carries`, () => {
      const run = runWebview(undefined);
      run.send(init(theme));
      assert.equal(forced(run), theme === "system" ? undefined : theme);
      assert.equal(attributes(themeButton(run))["aria-label"], THEME_BUTTON_LABEL[theme]);
    });
  }

  it("opens in the forced choice the host put on <body>, before init arrives", () => {
    const run = runWebview(undefined, { [THEME_ATTRIBUTE]: "dark" });
    assert.equal(forced(run), "dark");
    assert.equal(attributes(themeButton(run))["aria-label"], "Follow VS Code's theme");
    click(themeButton(run));
    assert.equal(forced(run), undefined);
    assert.deepEqual(run.posts.at(-1), { type: "setTheme", theme: "system" });
  });

  it("treats an unknown choice on <body> as system, and removes it", () => {
    const run = runWebview(undefined, { [THEME_ATTRIBUTE]: "sepia" });
    assert.equal(forced(run), undefined);
    assert.equal(attributes(themeButton(run))["aria-label"], "Switch to light theme");
  });

  for (const [name, theme] of [
    ["an unknown theme", "sepia"],
    ["a theme in the wrong case", "Dark"],
    ["a theme as a number", 1],
    ["no theme", undefined],
  ] as const) {
    it(`ignores an init with ${name}`, () => {
      const run = runWebview(undefined, { [THEME_ATTRIBUTE]: "light" });
      run.send(init(theme));
      assert.equal(forced(run), "light");
      assert.equal(attributes(themeButton(run))["aria-label"], "Switch to dark theme");
    });
  }

  it("keeps a choice made before init arrives, rather than the stored one init carries", () => {
    const run = runWebview(undefined);
    click(themeButton(run));
    run.send(init("dark"));
    assert.equal(forced(run), "light");
    assert.deepEqual(run.posts, [{ type: "ready" }, { type: "setTheme", theme: "light" }]);
  });
});

/** A control's name in `tabOrder`: its text, else its `aria-label`, else its class. */
function controlName(node: Record<string, unknown>): string {
  const text = node["textContent"];
  const label = (node["attributes"] as Record<string, string>)["aria-label"];
  return typeof text === "string" && text !== "" ? text : (label ?? String(node["className"]));
}

/**
 * The controls Tab visits, in order: every <button> and <input> under #app in
 * document order, skipping disabled ones and anything inside a hidden
 * element. The webview sets no `tabindex`, so this is the browser's order,
 * and Shift+Tab visits it backwards.
 */
function tabOrder(run: WebviewRun): Record<string, unknown>[] {
  const order: Record<string, unknown>[] = [];
  const visit = (node: Record<string, unknown>): void => {
    if (node["hidden"] === true) {
      return;
    }
    if (["button", "input"].includes(String(node["tag"])) && node["disabled"] !== true) {
      order.push(node);
    }
    for (const child of node["children"] as Record<string, unknown>[]) {
      visit(child);
    }
  };
  visit(run.app);
  return order;
}

describe("media/main.ts: keyboard-only play (#61), run as the bundled webview script", () => {
  const firstFive = ["BITE", "TEAM", "BEAT", "BEST", "BUSY"].flatMap((w) => guess(w));
  const toggle = { type: "toggleHints" } as const;
  const theme = THEME_BUTTON_LABEL.system;
  const midGame = [HOW_TO_PLAY, theme, "hints-button", ..."0123456789ABCDEF", "DEL", "ENTER"];
  const decodeStep = [theme, "decode-input", "Submit"];

  /** Each screen, its saved state (answer BYTE), how to reach it, and the Tab order there. */
  const screens: readonly (readonly [string, () => SessionState, (run: WebviewRun) => void, readonly string[]])[] = [
    ["mid-game", () => savedAfter(...guess("TEAM")), () => {}, midGame],
    ["hints on", () => savedAfter(...guess("TEAM"), toggle), () => {}, midGame],
    ["the decode step after a solved grid", () => savedAfter(...guess("TEAM"), ...guess("BYTE")), () => {}, decodeStep],
    ["the decode step after row 6", () => savedAfter(...firstFive, ...guess("ABLE")), () => {}, decodeStep],
    ["the result card", () => savedAfter(...guess("BYTE"), decode("BYTE")), () => {}, [HOW_TO_PLAY, theme, "New round"]],
    ["How to play", () => savedAfter(...guess("TEAM")), (run) => keyboardClick(byLabel(run, HOW_TO_PLAY)), ["Back to game"]],
  ];

  /** Types `word`'s hex and presses Enter on the physical keyboard. */
  function score(run: WebviewRun, word: string): void {
    for (const key of [...wordToHex(word), "Enter"]) {
      run.press(key);
    }
  }

  /** Types `word` in the decode box and submits the form, as Enter in the box does. */
  function submitWord(run: WebviewRun, word: string): void {
    byClass(run, "decode-input")["value"] = word;
    (byClass(run, "decode")["listeners"] as Record<string, (event: unknown) => void>)["submit"]?.({ preventDefault() {} });
  }

  it("sets no tabindex, so Tab follows the document order", () => {
    assert.doesNotMatch(source, /tabindex|tabIndex/);
  });

  for (const [name, saved, reach, expected] of screens) {
    it(`visits every enabled control on ${name} in order with Tab, skipping disabled and hidden ones`, () => {
      const run = runWebview(saved());
      reach(run);
      const order = tabOrder(run);
      assert.deepEqual(order.map(controlName), expected);
      // Focus starts on one of them, or on the page.
      assert.ok(run.focus.active === null || order.includes(run.focus.active as Record<string, unknown>), "focus is on a reachable control");
    });

    it(`never blocks Tab or Shift+Tab on ${name}, from the page or any control, so focus is never trapped`, () => {
      const run = runWebview(saved());
      reach(run);
      const count = run.elements.length;
      const before = snapshot(run);
      for (const control of [null, ...tabOrder(run)]) {
        if (control) {
          (control["focus"] as () => void)();
        } else {
          run.focus.active = null;
        }
        assert.equal(run.press("Tab"), false, controlName(control ?? { attributes: {}, className: "page" }));
        assert.equal(run.press("Tab", { shiftKey: true }), false);
      }
      assert.equal(snapshot(run, count), before, "Tab changed nothing");
    });
  }

  it("moves focus to the decode box when ENTER, reached with Tab and pressed from the keyboard, unlocks it", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    for (const digit of wordToHex("BYTE")) {
      run.press(digit);
    }
    const enter = byLabel(run, "ENTER, enter row");
    keyboardClick(enter);
    assert.equal(enter["disabled"], true);
    assert.equal(run.focus.active, byClass(run, "decode-input"));
    assert.deepEqual(tabOrder(run).map(controlName), decodeStep, "the disabled ? is skipped");
  });

  it("moves focus to the decode box when the physical Enter scores row 6", () => {
    const run = runWebview(savedAfter(...firstFive));
    score(run, "ABLE");
    assert.equal(run.focus.active, byClass(run, "decode-input"));
    assert.equal(byLabel(run, HOW_TO_PLAY)["disabled"], true);
  });

  it("keeps 0–9, A–F, Backspace and Enter in the decode box at the decode step: the grid doesn't change", () => {
    const run = runWebview(savedAfter(...guess("TEAM"), ...guess("BYTE")));
    const input = byClass(run, "decode-input");
    assert.equal(run.focus.active, input);
    const count = run.elements.length;
    const before = snapshot(run);
    for (const key of [..."42bE09", "Backspace", "Enter"]) {
      // Not blocked: the box types it, or Enter submits the form.
      assert.equal(run.press(key), false, key);
    }
    assert.equal(snapshot(run, count), before, "the grid and the rest of the screen are unchanged");
    assert.equal(run.focus.active, input);
    assert.equal(allByClass(run, "tile tile-typed").length, 0);
  });

  it("changes nothing when hex keys, Backspace or Enter are pressed on the page after the round ends", () => {
    const run = runWebview(savedAfter(...guess("BYTE"), decode("BYTE")));
    run.focus.active = null;
    const count = run.elements.length;
    const before = snapshot(run);
    for (const key of [..."42aF", "Backspace", "Enter", "t"]) {
      run.press(key);
    }
    assert.equal(snapshot(run, count), before);
    assert.equal(run.focus.active, null, "the hidden decode box never takes focus");
  });

  it("plays a whole round from the keyboard: hex rows, the decode box, then New round", () => {
    const run = runWebview(savedAfter());
    score(run, "TEAM");
    assert.equal(run.focus.active, null, "the page keeps the keyboard between rows");
    score(run, "BYTE");
    assert.equal(run.focus.active, byClass(run, "decode-input"));
    submitWord(run, "byte");
    const newRound = byClass(run, "result-button");
    assert.equal(byClass(run, "result")["hidden"], false);
    assert.equal(run.focus.active, newRound, "New round, on the result card, takes focus");
    keyboardClick(newRound);
    assert.equal(byClass(run, "result")["hidden"], true);
    assert.equal(run.focus.active, null, "focus goes back to the page, not the hidden button");
    for (const digit of wordToHex("TEAM")) {
      run.press(digit);
    }
    assert.equal(allByClass(run, "tile tile-typed").length, 8, "physical keys drive the new round's grid");
  });

  // Regression tests: the New Round command at the decode step disabled the
  // focused decode box or Submit but left focus on it, so physical keys
  // went to a dead control instead of the new round's grid.
  for (const name of ["decode-input", "decode-button"]) {
    it(`gives focus back to the page when the New Round command replaces a round at the decode step, from ${name}`, () => {
      const run = runWebview(savedAfter(...guess("TEAM"), ...guess("BYTE")));
      const control = byClass(run, name);
      (control["focus"] as () => void)();
      run.send('{"type":"newRound"}');
      assert.equal(control["disabled"], true);
      assert.equal(run.focus.active, null, "focus isn't left on the disabled control");
      for (const digit of wordToHex("TEAM")) {
        run.press(digit);
      }
      assert.equal(allByClass(run, "tile tile-typed").length, 8);
      run.press("Enter");
      assert.equal(allByClass(run, "tile tile-typed").length, 0, "the physical Enter scored the row");
    });
  }

  // A hidden panel's webview is thrown away, so showing it again runs the
  // script afresh from the saved state; How to play isn't saved (#25).
  // Where focus lands on a fresh load: the page mid-game, the decode box at
  // the decode step, New round on the result card.
  const focusAfterShow: readonly (string | null)[] = [null, null, "decode-input", "decode-input", "result-button"];
  screens.slice(0, 5).forEach(([name, saved], i) => {
    const expected = focusAfterShow[i] ?? null;
    it(`puts focus on ${expected ?? "the page"} after a hide and show on ${name}`, () => {
      const run = runWebview(saved());
      assert.equal(run.focus.active, expected === null ? null : byClass(run, expected));
    });
  });
});

describe("media/main.ts: hostile text is drawn as plain text (security rule 2)", () => {
  const HOSTILE = "<img src=x onerror=alert(1)>";

  it("rejects a hostile typed word with plain message text, making no element and leaving the typed text in the box as a value", () => {
    const run = runWebview(savedAfter(...guess("BYTE")));
    const elementsBefore = run.elements.length;
    const input = byClass(run, "decode-input");
    input["value"] = HOSTILE;
    const onSubmit = (byClass(run, "decode")["listeners"] as Record<string, (event: unknown) => void>)["submit"];
    assert.ok(onSubmit, "a submit listener");
    onSubmit({ preventDefault() {} });
    const message = byClass(run, "message");
    // The host rejects it as a format error with fixed text, which is set as plain text.
    assert.equal(message["textContent"], "Type a 4-letter word, A to Z");
    assert.equal(typeof message["textContent"], "string");
    // Nothing was parsed into elements: no <img> or any other element appeared.
    assert.equal(run.elements.length, elementsBefore);
    assert.equal(run.elements.filter((node) => node["tag"] === "img").length, 0);
    assert.equal(input["value"], HOSTILE);
  });

  it("ignores non-hex characters typed on the grid, so they never reach the DOM", () => {
    const run = runWebview(savedAfter());
    const before = domText(run);
    for (const key of HOSTILE) {
      run.press(key);
    }
    // Only the hex digits in the string (b, e, a, 1, ...) can land; none of `<`, `>`, `=` or `(` ever do.
    assert.doesNotMatch(domText(run), /[<>=(]/);
    assert.doesNotMatch(before, /[<>=(]/);
  });
});

/**
 * What a screen reader reads for `node`: its `aria-label`, or else its own
 * text and its children's, skipping anything `aria-hidden`.
 */
function spokenText(node: Record<string, unknown>): string {
  const attributes = node["attributes"] as Record<string, string>;
  if (attributes["aria-hidden"] === "true") {
    return "";
  }
  const label = attributes["aria-label"];
  if (label) {
    return label;
  }
  const own = typeof node["textContent"] === "string" ? node["textContent"] : "";
  return own + (node["children"] as Record<string, unknown>[]).map(spokenText).join("");
}

describe("media/main.ts: screen-reader names and announcements (#62), run as the bundled webview script", () => {
  const toggle = { type: "toggleHints" } as const;
  const firstFive = ["BITE", "TEAM", "BEAT", "BEST", "BUSY"].flatMap((w) => guess(w));
  const initMessage = JSON.stringify({ type: "init", stats: toStatsView(EMPTY_STATS), theme: "system" });
  const LOCK_TEXT = ["Locked until you crack the hex row", "Get every tile blue to unlock Decode."];

  /** The message line: rejections, and how the round ended. */
  function messageRegion(run: WebviewRun): Record<string, unknown> {
    return byClass(run, "message");
  }

  /** The visually hidden region: scored rows, the decode step and a new round. */
  function announcementRegion(run: WebviewRun): Record<string, unknown> {
    const found = run.elements.filter(
      (node) => node["tag"] === "p" && node["className"] === "sr-only" && (node["attributes"] as Record<string, string>)["aria-live"] === "polite",
    );
    assert.equal(found.length, 1, "one announcement region");
    return found[0] ?? {};
  }

  /**
   * The elements from #app down to `node`, both included, or null if `node`
   * isn't on the page.
   */
  function pathTo(run: WebviewRun, node: Record<string, unknown>): Record<string, unknown>[] | null {
    const search = (current: Record<string, unknown>): Record<string, unknown>[] | null => {
      if (current === node) {
        return [current];
      }
      for (const child of current["children"] as Record<string, unknown>[]) {
        const path = search(child);
        if (path) {
          return [current, ...path];
        }
      }
      return null;
    };
    return search(run.app);
  }

  /** True if `node` is on the page with no `hidden` element above it, so a screen reader hears it. */
  function isShown(run: WebviewRun, node: Record<string, unknown>): boolean {
    const path = pathTo(run, node);
    return path !== null && path.every((element) => element["hidden"] !== true);
  }

  /**
   * The non-empty texts written to a live region, in order: each is one
   * announcement. None while the region, or anything above it, is hidden,
   * since a hidden region isn't read out.
   */
  function spoken(run: WebviewRun, region: Record<string, unknown>): string[] {
    if (!isShown(run, region)) {
      return [];
    }
    return (region["texts"] as unknown[]).filter((text): text is string => typeof text === "string" && text !== "");
  }

  /** Types `word`'s hex and presses Enter on the physical keyboard. */
  function score(run: WebviewRun, word: string): void {
    for (const key of [...wordToHex(word), "Enter"]) {
      run.press(key);
    }
  }

  /** Types `word` in the decode box and submits the form. */
  function submitWord(run: WebviewRun, word: string): void {
    byClass(run, "decode-input")["value"] = word;
    (byClass(run, "decode")["listeners"] as Record<string, (event: unknown) => void>)["submit"]?.({ preventDefault() {} });
  }

  // Criterion 1: names and states.

  const screens: readonly (readonly [string, () => SessionState])[] = [
    ["mid-game", () => savedAfter(...guess("TEAM"))],
    ["hints on", () => savedAfter(...guess("TEAM"), toggle)],
    ["the decode step", () => savedAfter(...guess("TEAM"), ...guess("BYTE"))],
    ["the result card", () => savedAfter(...guess("BYTE"), decode("BYTE"))],
  ];
  for (const [name, saved] of screens) {
    it(`gives every button an accessible name on ${name}, the disabled ones included`, () => {
      const run = runWebview(saved());
      const buttons = run.elements.filter((node) => node["tag"] === "button");
      // `?`, theme, Hints, 16 keys, DEL, ENTER, Decode, New round, back arrow.
      assert.equal(buttons.length, 24);
      for (const button of buttons) {
        assert.notEqual(spokenText(button).trim(), "", String(button["className"]));
      }
    });
  }

  it("names the disabled `?` at the decode step, and the locked Hints button keeps its name, state and description", () => {
    const run = runWebview(savedAfter(...guess("TEAM"), ...guess("BYTE")));
    assert.equal(byLabel(run, HOW_TO_PLAY)["disabled"], true);
    const hints = byClass(run, "hints-button");
    const attributes = hints["attributes"] as Record<string, string>;
    assert.equal(hints["disabled"], true);
    assert.equal(spokenText(hints), "Hints");
    assert.equal(attributes["aria-pressed"], "false");
    assert.equal(attributes["aria-describedby"], "hints-locked-note");
  });

  it("sets aria-pressed on Hints from its state: false, then true when pressed, then false after a scored row", () => {
    const run = runWebview(savedAfter());
    const hints = byClass(run, "hints-button");
    const pressed = (): string | undefined => (hints["attributes"] as Record<string, string>)["aria-pressed"];
    assert.equal(pressed(), "false");
    click(hints);
    assert.equal(pressed(), "true");
    score(run, "TEAM");
    assert.equal(pressed(), "false");
  });

  it("reads the hint strip as one line, with its cells hidden from screen readers", () => {
    // BITE gets B, T and E fully right in one row; byte 2 (49 against 59) only half.
    const run = runWebview(savedAfter(...guess("BITE"), toggle));
    const strip = byClass(run, "hint-strip");
    assert.equal(strip["hidden"], false);
    assert.deepEqual(
      allByClass(run, "hint-cell").map((cell) => cell["textContent"]),
      ["B", "?", "T", "E"],
    );
    assert.equal(spokenText(strip), "Hints: B, unknown, T, E");
  });

  it("names each scored tile's mark in words, and nothing for an empty tile", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    const tiles = allByClass(run, "grid-row").map((row) =>
      (row["children"] as Record<string, unknown>[]).flatMap((pair) =>
        (pair["children"] as Record<string, unknown>[]).map((tile) => spokenText(tile)),
      ),
    );
    // TEAM (54 45 41 4D) against BYTE (42 59 54 45).
    assert.deepEqual(tiles[0], [
      "5, Wrong spot",
      "4, Wrong spot",
      "4, Wrong spot",
      "5, Wrong spot",
      "4, Not in word",
      "1, Not in word",
      "4, Right spot",
      "D, Not in word",
    ]);
    assert.ok(tiles.slice(1).every((row) => row.every((tile) => tile === "")));
  });

  it("reads each byte on the result card as one phrase, e.g. 42 is B", () => {
    const run = runWebview(savedAfter(...guess("BYTE"), decode("BYTE")));
    assert.deepEqual(allByClass(run, "result-byte").map(spokenText), ["42 is B", "59 is Y", "54 is T", "45 is E"]);
  });

  it("makes both live regions polite status regions", () => {
    const run = runWebview(savedAfter());
    for (const region of [messageRegion(run), announcementRegion(run)]) {
      assert.equal((region["attributes"] as Record<string, string>)["role"], "status");
      assert.equal((region["attributes"] as Record<string, string>)["aria-live"], "polite");
    }
  });

  // Criterion 2: each event is announced once, through a live region.

  it("announces a scored row, a rejected row, the decode step, a rejected word and a new round once each", () => {
    const run = runWebview(savedAfter());
    score(run, "TEAM");
    score(run, "AAAA");
    for (let i = 0; i < 8; i++) {
      run.press("Backspace");
    }
    score(run, "BYTE");
    submitWord(run, "QXZJ");
    run.send('{"type":"newRound"}');
    run.press("4");
    assert.equal(run.frames.length, 0, "no delayed rewrite: nothing was repeated");
    assert.deepEqual(spoken(run, announcementRegion(run)), [
      "Row 1: 1 Right spot, 4 Wrong spot, 3 Not in word",
      "Row 2: 8 Right spot, 0 Wrong spot, 0 Not in word. Hex solved: decode the word, one try",
      "New round",
    ]);
    assert.deepEqual(spoken(run, messageRegion(run)), ["AAAA isn't in the word list", "QXZJ isn't in the word list"]);
  });

  it("announces the decode step after row 6 once, with row 6's marks", () => {
    const run = runWebview(savedAfter(...firstFive));
    score(run, "ABLE");
    const said = spoken(run, announcementRegion(run));
    assert.equal(said.length, 1);
    assert.match(said[0] ?? "", /^Row 6: .*\. Hex locked: one final answer$/);
    assert.deepEqual(spoken(run, messageRegion(run)), []);
  });

  it("announces how the round ended once, behind the result card", () => {
    const run = runWebview(savedAfter(...guess("BYTE")));
    submitWord(run, "BYTE");
    assert.deepEqual(spoken(run, messageRegion(run)), ["Solved"]);
  });

  const starts: readonly (readonly [string, (run: WebviewRun) => void])[] = [
    ["the command", (run) => run.send('{"type":"newRound"}')],
    ["the New round button", (run) => click(byClass(run, "result-button"))],
  ];
  for (const [name, start] of starts) {
    it(`announces a new round from ${name}, and reads it out again when the command follows at once`, () => {
      const run = runWebview(savedAfter(...guess("BYTE"), decode("BYTE")));
      const region = announcementRegion(run);
      start(run);
      assert.equal(region["textContent"], "New round");
      run.send('{"type":"newRound"}');
      assert.equal(region["textContent"], "", "cleared");
      run.frames.at(-1)?.();
      assert.equal(region["textContent"], "New round", "then set again on the next frame");
      assert.deepEqual(spoken(run, region), ["New round", "New round"]);
    });
  }

  it("drops a queued New round re-announce once the next key clears it", () => {
    const run = runWebview(savedAfter());
    const region = announcementRegion(run);
    run.send('{"type":"newRound"}');
    run.send('{"type":"newRound"}');
    const queued = run.frames.at(-1);
    assert.ok(queued, "a delayed rewrite is queued");
    run.press("4");
    queued();
    assert.equal(region["textContent"], "");
  });

  it("announces a New Round command that arrives while How to play hides the game", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    click(byLabel(run, HOW_TO_PLAY));
    assert.equal(byClass(run, "game")["hidden"], true);
    run.send('{"type":"newRound"}');
    const region = announcementRegion(run);
    assert.equal(byClass(run, "how-to-play")["hidden"], false, "How to play stays open");
    assert.ok(isShown(run, region), "the region has no hidden element above it");
    assert.equal(region["textContent"], "New round");
    assert.deepEqual(spoken(run, region), ["New round"]);
  });

  it("keeps the announcement region outside the game and How to play, so it's shown on every screen", () => {
    const run = runWebview(savedAfter());
    const children = run.app["children"] as Record<string, unknown>[];
    assert.deepEqual(
      children.map((child) => child["className"]),
      ["game", "how-to-play", "sr-only"],
    );
    assert.equal(children[2], announcementRegion(run));
  });

  it("doesn't announce the first round, which init starts as the panel opens", () => {
    const run = runWebview(undefined);
    run.send(initMessage);
    assert.equal(allByClass(run, "tile tile-empty").length, 48, "the round started");
    assert.deepEqual(spoken(run, announcementRegion(run)), []);
    assert.deepEqual(spoken(run, messageRegion(run)), []);
  });

  // Criterion 3: a hide and show doesn't announce a standing message again.

  const shown: readonly (readonly [string, () => SessionState, readonly string[]])[] = [
    ["a scored row", () => savedAfter(...guess("TEAM")), []],
    ["the decode step after a solved grid", () => savedAfter(...guess("TEAM"), ...guess("BYTE")), []],
    ["the decode step after row 6", () => savedAfter(...firstFive, ...guess("ABLE")), []],
    ["a new round", () => savedAfter(...guess("TEAM"), { type: "newRound" }), []],
    ["a rejected row", () => savedAfter(...guess("TEAM"), ...guess("TEAM")), ["You've already tried 54 45 41 4D"]],
    ["a rejected word", () => savedAfter(...guess("BYTE"), decode("QXZJ")), ["QXZJ isn't in the word list"]],
    ["a solved round", () => savedAfter(...guess("BYTE"), decode("BYTE")), ["Solved"]],
    ["a failed round", () => savedAfter(...firstFive, ...guess("ABLE"), decode("ABLE")), ["Out of rows"]],
  ];
  for (const [name, saved, standing] of shown) {
    it(`announces nothing new after a hide and show on ${name}: a standing message is drawn once, as page content`, () => {
      const run = runWebview(saved());
      run.send(initMessage);
      assert.deepEqual(spoken(run, announcementRegion(run)), [], "screen-reader-only announcements aren't saved");
      assert.deepEqual(spoken(run, messageRegion(run)), standing, "written once, by the first render");
      assert.equal(run.frames.length, 0, "no clear-and-rewrite queued");
    });
  }

  // Criterion 4: rows and bytes are described.

  it("groups the grid into rows named Row 1 to Row 6, each of four bytes named Byte 1 to Byte 4", () => {
    const run = runWebview(savedAfter());
    const rows = allByClass(run, "grid-row");
    assert.equal(rows.length, 6);
    rows.forEach((row, r) => {
      assert.deepEqual(row["attributes"], { role: "group", "aria-label": `Row ${r + 1}` });
      const pairs = row["children"] as Record<string, unknown>[];
      assert.equal(pairs.length, 4);
      pairs.forEach((pair, b) => {
        assert.equal(pair["className"], "pair");
        assert.deepEqual(pair["attributes"], { role: "group", "aria-label": `Byte ${b + 1}` });
        assert.equal((pair["children"] as unknown[]).length, 2, "two tiles per byte");
      });
    });
  });

  // Criterion 5: the lock message is real text, linked to the disabled box.

  /** The decode box's description: the text of each element its `aria-describedby` names, or null for none. */
  function description(run: WebviewRun): string[] | null {
    const ids = (byClass(run, "decode-input")["attributes"] as Record<string, string>)["aria-describedby"];
    if (ids === undefined) {
      return null;
    }
    return ids.split(" ").map((id) => {
      const found = run.elements.filter((node) => node["id"] === id);
      assert.equal(found.length, 1, `one element with id ${id}`);
      return String(found[0]?.["textContent"]);
    });
  }

  it("describes the locked, disabled decode box with the lock's two lines of real text", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    assert.equal(byClass(run, "decode-input")["disabled"], true);
    assert.deepEqual(description(run), LOCK_TEXT);
    assert.equal(byClass(run, "lock-title")["tag"], "p");
    assert.equal(byClass(run, "lock-message")["tag"], "p");
    assert.equal(byClass(run, "decode-lock")["hidden"], false);
  });

  it("drops the lock description once the box unlocks, and brings it back with a new round", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    score(run, "BYTE");
    assert.equal(byClass(run, "decode-input")["disabled"], false);
    assert.equal(description(run), null);
    run.send('{"type":"newRound"}');
    assert.deepEqual(description(run), LOCK_TEXT);
  });
});

describe("media/main.ts: colour is never the only cue (#64), run as the bundled webview script", () => {
  const MARKS = Object.keys(MARK_NAMES) as (keyof typeof MARK_NAMES)[];

  it("names each marked key's mark, so right-spot, wrong-spot and not-in-word keys differ by more than colour", () => {
    // TEAM (54 45 41 4D) against BYTE (42 59 54 45): 4 right, 5 wrong, 1 and D not in the word.
    const run = runWebview(savedAfter(...guess("TEAM")));
    for (const mark of MARKS) {
      const keys = allByClass(run, `key key-${mark}`);
      assert.ok(keys.length > 0, mark);
      for (const key of keys) {
        assert.equal(spokenText(key), `${String(key["textContent"])}, ${MARK_NAMES[mark]}`);
      }
    }
  });

  it("keeps each scored tile's mark in its name once the hex locks and the grid dims after row 6", () => {
    const rows = ["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"].flatMap((word) => guess(word));
    const run = runWebview(savedAfter(...rows));
    for (const mark of MARKS) {
      const tiles = allByClass(run, `tile tile-${mark}`);
      assert.ok(tiles.length > 0, mark);
      for (const tile of tiles) {
        assert.match(spokenText(tile), new RegExp(`^[0-9A-F], ${MARK_NAMES[mark]}$`));
      }
    }
  });

  it("says the hex is locked in words after row 6, and locks Hints with a description", () => {
    const rows = ["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"].flatMap((word) => guess(word));
    const run = runWebview(savedAfter(...rows));
    assert.ok(run.elements.some((node) => node["textContent"] === HEX_LOCKED_STATUS));
    const hints = byClass(run, "hints-button");
    assert.equal(hints["disabled"], true);
    assert.equal((hints["attributes"] as Record<string, string>)["aria-describedby"], "hints-locked-note");
  });

  it("shows a byte not yet decoded as `?` in the hint strip, not only in a muted colour", () => {
    // BITE gets B, T and E fully right in one row; byte 2 only half.
    const run = runWebview(savedAfter(...guess("BITE"), { type: "toggleHints" }));
    const cells = allByClass(run, "hint-cell").map((cell) => cell["textContent"]);
    assert.deepEqual(cells, ["B", HINT_UNKNOWN, "T", "E"]);
    assert.equal(HINT_UNKNOWN, "?");
  });

  it("names every legend swatch's mark in words beside it", () => {
    const run = runWebview(savedAfter());
    const items = byClass(run, "legend")["children"] as Record<string, unknown>[];
    assert.equal(items.length, MARKS.length);
    items.forEach((item, i) => {
      const mark = MARKS[i];
      assert.ok(mark);
      const [swatch, name] = item["children"] as Record<string, unknown>[];
      assert.equal(swatch?.["className"], `swatch swatch-${mark}`);
      assert.equal((swatch?.["attributes"] as Record<string, string>)["aria-hidden"], "true");
      assert.equal(name?.["textContent"], MARK_NAMES[mark]);
      assert.equal(spokenText(item), MARK_NAMES[mark]);
    });
  });
});

describe("media/main.ts: the faded locked decode body (#76), run as the bundled webview script", () => {
  /** The classes of `node`'s descendants, depth first. */
  function classesUnder(node: Record<string, unknown>): string[] {
    return (node["children"] as Record<string, unknown>[]).flatMap((child) => [
      typeof child["className"] === "string" ? child["className"] : "",
      ...classesUnder(child),
    ]);
  }

  it("holds only the heading, the empty badge, the disabled box and button, and the note, so the contrast audit's faded list is complete", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    const body = byClass(run, "decode-body");
    assert.deepEqual(classesUnder(body).filter((name) => name !== ""), [
      "decode-head",
      "decode-label",
      "decode-badge",
      "decode-row",
      "decode-input",
      "decode-button",
      "decode-foot",
    ]);
    assert.equal(byClass(run, "decode-badge")["textContent"], "");
    assert.equal(byClass(run, "decode-input")["disabled"], true);
    assert.equal(byClass(run, "decode-button")["disabled"], true);
  });
});
