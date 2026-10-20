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
import { GameController, type Action } from "../../src/ui/game.ts";
import { cheatsheet } from "../../src/ui/howToPlay.ts";
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
    assert.match(source, /hintsButton\.append\(bulbIcon\(\), element\("span", "", HINTS_BUTTON\)\)/);
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
    assert.match(source, /statusBar\.append\(status, hintsButton\)/);
  });

  it("leaves focus on the Hints button while the final answer is due, so it can be toggled again", () => {
    assert.match(source, /document\.activeElement !== ui\.decodeInput && document\.activeElement !== ui\.hintsButton/);
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

  it("shows the final-answer card and locks the grid and keypad from the view's hexLocked", () => {
    assert.match(source, /ui\.decode\.classList\.toggle\("decode-final", view\.hexLocked\)/);
    assert.match(source, /ui\.grid\.classList\.toggle\("grid-locked", view\.hexLocked\)/);
    assert.match(source, /ui\.keypad\.classList\.toggle\("keypad-locked", view\.hexLocked\)/);
    assert.match(source, /ui\.statusIcon\.toggleAttribute\("hidden", !view\.hexLocked\)/);
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
    assert.match(source, /if \(!view\.howToPlayOpen && view\.hexLocked && keyboardFree\) \{\s*ui\.decodeInput\.focus\(\);/);
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
    assert.match(source, /game\.append\([^)]*decode, result, resultNote, message, announcement, keypad\)/);
  });

  it("makes `?` and the back arrow real <button>s that dispatch through the controller", () => {
    assert.match(source, /const howToPlayButton = actionButton\("icon-button", "", \{ type: "openHowToPlay" \}\)/);
    assert.match(source, /const back = actionButton\("icon-button", "", \{ type: "closeHowToPlay" \}\)/);
    assert.match(source, /howToPlayButton\.setAttribute\("aria-label", HOW_TO_PLAY\)/);
    assert.match(source, /back\.setAttribute\("aria-label", BACK_TO_GAME\)/);
    assert.match(source, /headerButtons\.append\(howToPlayButton, themeButton\)/);
    assert.match(source, /header\.append\(title, headerButtons\)/);
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
    assert.match(source, /app\.replaceChildren\(game, howToPlay\.section\)/);
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
 * node's `focusCalls`.
 */
function fakeNode(record: Record<string, unknown>, focus: FocusTracker = { active: null }): Record<string, unknown> {
  const attributes: Record<string, string> = {};
  const listeners: Record<string, (event: unknown) => void> = {};
  const target: Record<string, unknown> = {
    ...record,
    attributes,
    listeners,
    focusCalls: 0,
    textWrites: 0,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
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
  /** The focused element, or null for the page (`<body>`). */
  readonly focus: FocusTracker;
  /** Callbacks waiting for the next animation frame. */
  readonly frames: (() => void)[];
  /** Sends a message from the host, as JSON. */
  send(json: string): void;
  /** Presses a physical key wherever focus is. */
  press(key: string): void;
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
    getElementById: (id: string) => (id === "app" ? fakeNode({}, focus) : null),
    createElement: (tag: string) => {
      const node = fakeNode({ tag }, focus);
      elements.push(node);
      return node;
    },
    createElementNS: (ns: unknown, tag: string) => {
      namespaces.push({ tag, ns });
      return fakeNode({ tag }, focus);
    },
    createTextNode: () => fakeNode({}, focus),
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
    focus,
    frames,
    send: (json) => fire("message", { data: webviewJson.parse(json) }),
    press: (key) =>
      fire("keydown", {
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        isComposing: false,
        // The focused element, or the page's <body> when nothing is focused.
        target: focus.active ?? fakeNode({ tag: "body" }),
        preventDefault() {},
      }),
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
  // back arrow (#25), and the theme button's sun and moon (#26).
  it("creates the icons' SVG elements in the SVG namespace: `?`, sun, moon, padlock, light bulb, down arrows, back arrow", () => {
    const { namespaces } = runWebview(undefined);
    assert.deepEqual(
      namespaces.map((n) => n.tag),
      // The `?`, the sun, the moon, the padlock, the light bulb, one down arrow per byte, then the back arrow.
      [
        "svg",
        "circle",
        "path",
        "svg",
        "circle",
        "path",
        "svg",
        "path",
        "svg",
        "rect",
        "path",
        "svg",
        "path",
        "path",
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
  it("keeps the answer out of the DOM while a round is in progress, hints on at the final answer", () => {
    const words = ["BITE", "TEAM", "BEAT", "BEST", "BUSY"];
    const saved = savedAfter(
      { type: "toggleHints" },
      ...words.flatMap((word) => [...guess(word), decode(word)]),
      ...guess("ABLE"),
    );
    assert.equal(saved.round.phase, "final");
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

  it("brings a restored solved round's card back, without posting roundFinished again", () => {
    const saved = savedAfter(...guess("TEAM"), decode("TEAM"), ...guess("BYTE"), decode("BYTE"));
    assert.equal(saved.reported, true);
    const run = runWebview(saved);
    assert.equal(byClass(run, "result")["hidden"], false);
    assert.equal(byClass(run, "result-heading")["textContent"], "Decoded: BYTE");
    assert.equal(byClass(run, "result-outcome")["textContent"], "Congrats! You cracked it");
    assert.equal(byClass(run, "result-line")["textContent"], "2 of 6 rows · 2 answer tries · no hints");
    assert.equal(byClass(run, "result-note")["hidden"], false);
    for (const replaced of ["legend", "decode", "keypad"]) {
      assert.equal(byClass(run, replaced)["hidden"], true, replaced);
    }
    assert.deepEqual(run.posts, [{ type: "ready" }]);
  });

  it("brings a restored failed round's card back, without posting roundFinished again", () => {
    const words = ["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"];
    const run = runWebview(savedAfter(...words.flatMap((word) => [...guess(word), decode(word)])));
    assert.equal(byClass(run, "result-heading")["textContent"], "The word was BYTE");
    assert.equal(byClass(run, "result-outcome")["textContent"], "Unlucky!");
    assert.equal(byClass(run, "result-line")["textContent"], "6 of 6 rows · 6 answer tries · no hints");
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
  ["solved", () => savedAfter(...guess("TEAM"), decode("TEAM"), ...guess("BYTE"), decode("BYTE"))],
  ["failed", () => savedAfter(...["BITE", "TEAM", "BEAT", "BEST", "BUSY", "ABLE"].flatMap((w) => [...guess(w), decode(w)]))],
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
    const run = runWebview(savedAfter(...guess("TEAM"), decode("TEAM"), ...guess("BEAT")));
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

describe("media/main.ts: How to play (page 5), run as the bundled webview script", () => {
  const halfTyped: Action[] = [...guess("TEAM"), decode("BEAT"), ...[..."4259"].map((digit) => ({ type: "digit", digit }) as const)];
  const firstFive = ["BITE", "TEAM", "BEAT", "BEST", "BUSY"].flatMap((w) => [...guess(w), decode(w)]);
  /**
   * Every screen How to play opens from: its saved state (answer BYTE), or
   * undefined for a fresh panel, and whether the final answer is due there.
   */
  const screens: readonly (readonly [string, () => SessionState | undefined, boolean])[] = [
    ["a fresh panel", () => undefined, false],
    ["a half-typed row", () => savedAfter(...halfTyped), false],
    ["a scored row, no word tried", () => savedAfter(...guess("TEAM")), false],
    ["the final answer", () => savedAfter(...firstFive, ...guess("ABLE")), true],
    ["the result card", () => FINISHED[0]?.[1](), false],
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

  it("draws the RULES and ASCII CHEATSHEET headings, the six rules and the rule 3 chips", () => {
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

  for (const [name, saved, attempt] of screens) {
    /** Where focus goes after a mouse-opened How to play closes: the decode box, or the page. */
    const afterMouse = (run: WebviewRun): unknown => (attempt ? byClass(run, "decode-input") : null);

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
      assert.equal(run.focus.active, afterMouse(run));
    });

    it(`goes back to ${name} unchanged with Escape after a mouse open, focus off ?`, () => {
      const run = runWebview(saved());
      const count = run.elements.length;
      const before = snapshot(run);
      click(byLabel(run, "How to play"));
      run.press("Escape");
      assert.equal(byClass(run, "how-to-play")["hidden"], true);
      assert.equal(snapshot(run, count), before);
      assert.equal(run.focus.active, afterMouse(run));
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
    const run = runWebview(savedAfter());
    for (const digit of "4259") {
      run.press(digit);
    }
    click(byLabel(run, "How to play"));
    run.press("Escape");
    for (const digit of "5445") {
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

  it("gives the decode box focus back after a mouse open and close at the final answer", () => {
    const run = runWebview(savedAfter(...firstFive, ...guess("ABLE")));
    const decodeInput = byClass(run, "decode-input");
    click(byLabel(run, "How to play"));
    click(byLabel(run, "Back to game"));
    // So Space and letters go to the decode box, not to `?`.
    assert.equal(run.focus.active, decodeInput);
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

describe("media/main.ts: optional decoding (#30), run as the bundled webview script", () => {
  /** The visually hidden live region that reads scored rows and wrong words out. */
  function announcement(run: WebviewRun): Record<string, unknown> {
    const found = run.elements.filter(
      (node) => node["tag"] === "p" && node["className"] === "sr-only" && (node["attributes"] as Record<string, string>)["aria-live"] === "polite",
    );
    assert.equal(found.length, 1, "one announcement region");
    return found[0] ?? {};
  }

  /** Types `word` in the decode box and submits the form, as Decode or Enter in the box does. */
  function submitWord(run: WebviewRun, word: string): void {
    byClass(run, "decode-input")["value"] = word;
    const onSubmit = (byClass(run, "decode")["listeners"] as Record<string, (event: unknown) => void>)["submit"];
    assert.ok(onSubmit, "a submit listener");
    onSubmit({ preventDefault() {} });
  }

  /**
   * The struck-through Tried words ever drawn, in order. Every render makes
   * the list's items again, so after several renders compare only the end.
   */
  function triedWords(run: WebviewRun): unknown[] {
    return allByClass(run, "tried-word").map((node) => node["textContent"]);
  }

  /** Scores TEAM as the next row from the physical keyboard. */
  function scoreTeam(run: WebviewRun): void {
    for (const key of [...wordToHex("TEAM"), "Enter"]) {
      run.press(key);
    }
  }

  it("keeps the decode box and Decode disabled until a row is scored", () => {
    const run = runWebview(savedAfter());
    assert.equal(byClass(run, "decode-input")["disabled"], true);
    assert.equal(byClass(run, "decode-button")["disabled"], true);
  });

  it("scores a row with no visible message, reads its marks out, and leaves the keypad and focus as they were", () => {
    const run = runWebview(savedAfter());
    scoreTeam(run);
    assert.equal(byClass(run, "message")["textContent"], "");
    assert.equal(announcement(run)["textContent"], "Row 1: 1 Right spot, 4 Wrong spot, 3 Not in word");
    assert.equal(run.focus.active, null, "no forced move to the decode box");
    assert.ok(allByClass(run, "key").every((key) => key["disabled"] === false));
    assert.equal(byClass(run, "decode-input")["disabled"], false, "decoding is now available");
    assert.equal(byClass(run, "decode-button")["disabled"], false);
  });

  it("types the next row straight after a scored one, without a word attempt", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    for (const digit of "4259") {
      run.press(digit);
    }
    assert.equal(allByClass(run, "tile tile-typed").length, 4);
  });

  it("adds a wrong word to Tried and empties the box, keeping the keypad on", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    submitWord(run, "beat");
    assert.deepEqual(triedWords(run).slice(-1), ["BEAT"]);
    assert.equal(byClass(run, "decode-input")["value"], "");
    assert.equal(announcement(run)["textContent"], "BEAT isn't the word");
    assert.equal(byClass(run, "message")["textContent"], "");
    assert.equal(byClass(run, "tried")["hidden"], false);
    assert.ok(allByClass(run, "key").every((key) => key["disabled"] === false));
  });

  it("keeps a rejected word in the box with a plain-text reason, and adds nothing to Tried", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    submitWord(run, "QXZJ");
    assert.equal(byClass(run, "decode-input")["value"], "QXZJ");
    assert.equal(byClass(run, "message")["textContent"], "QXZJ isn't in the word list");
    assert.equal(byClass(run, "tried")["hidden"], true);
  });

  it("gives the keyboard back to the hex grid after a wrong word, so hex keys guess hex again", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    const input = byClass(run, "decode-input");
    (input["focus"] as () => void)();
    submitWord(run, "BEAT");
    assert.equal(run.focus.active, null, "focus is back on the page");
    for (const digit of "4259") {
      run.press(digit);
    }
    assert.equal(allByClass(run, "tile tile-typed").length, 4, "physical hex keys reach the grid");
  });

  it("keeps a repeated word's text and focus in the box, with a visible plain-text reason", () => {
    const run = runWebview(savedAfter(...guess("TEAM"), decode("BEAT")));
    const input = byClass(run, "decode-input");
    (input["focus"] as () => void)();
    submitWord(run, "beat");
    assert.equal(byClass(run, "message")["textContent"], "You've already tried BEAT");
    assert.equal(input["value"], "beat");
    assert.equal(run.focus.active, input);
    assert.deepEqual(triedWords(run).slice(-1), ["BEAT"]);
  });

  it("keeps a rejected word's focus in the box", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    const input = byClass(run, "decode-input");
    (input["focus"] as () => void)();
    submitWord(run, "QXZJ");
    assert.equal(run.focus.active, input);
  });

  it("rejects a repeated hex row from the keyboard with a visible reason, keeping its digits", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    for (const key of [...wordToHex("TEAM"), "Enter"]) {
      run.press(key);
    }
    assert.equal(byClass(run, "message")["textContent"], "You've already tried that row");
    assert.equal(allByClass(run, "tile tile-typed").length, 8);
  });

  it("solves the round from the decode box with hex rows left", () => {
    const run = runWebview(savedAfter(...guess("TEAM")));
    submitWord(run, "byte");
    assert.equal(byClass(run, "result")["hidden"], false);
    assert.equal(byClass(run, "result-line")["textContent"], "1 of 6 rows · 1 answer try · no hints");
    assert.deepEqual(run.posts.at(-1), { type: "roundFinished", solved: true, rowsUsed: 1, answerTries: 1, hintsUsed: false });
  });

  it("brings the Tried list back after the panel is hidden and shown", () => {
    const run = runWebview(savedAfter(...guess("TEAM"), decode("BEAT"), decode("BEST"), ...guess("BUSY"), decode("ABLE")));
    assert.deepEqual(triedWords(run), ["BEAT", "BEST", "ABLE"]);
    assert.equal(byClass(run, "tried")["hidden"], false);
    assert.equal(byClass(run, "decode-input")["disabled"], false);
  });

  it("shows no \"1 try per row\" text anywhere", () => {
    for (const saved of [savedAfter(), savedAfter(...guess("TEAM")), savedAfter(...guess("TEAM"), decode("BEAT"))]) {
      assert.doesNotMatch(domText(runWebview(saved)), /try per row/i);
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
    const halfTyped = [...guess("TEAM"), decode("BEAT"), ...[..."4259"].map((digit) => ({ type: "digit", digit }) as const)];
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
