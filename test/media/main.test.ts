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
import { GameController, type Action } from "../../src/ui/game.ts";
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
    // The only click handler is in `actionButton`, which makes keypad keys and Hints as <button>.
    assert.equal(source.match(/addEventListener\("click"/g)?.length, 1);
    assert.match(source, /function actionButton[\s\S]*?element\("button"/);
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
    assert.match(source, /app\.replaceChildren\(header, statusBar, grid, hintStrip, legend,/);
    assert.match(source, /statusBar\.append\(status, hintsButton\)/);
  });

  it("leaves focus on the Hints button while a word attempt is due, so it can be toggled again", () => {
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

  it("gives DEL and ENTER accessible names that start with their visible labels (WCAG 2.5.3)", () => {
    assert.match(source, /actionButton\("[^"]*", "DEL",[\s\S]*?del\.setAttribute\("aria-label", "DEL, /);
    assert.match(source, /actionButton\("[^"]*", "ENTER",[\s\S]*?enter\.setAttribute\("aria-label", "ENTER, /);
  });

  it("focuses the decode box, without blocking the key, when shouldFocusDecodeBox says so", () => {
    assert.match(
      source,
      /if \(shouldFocusDecodeBox\(event, focus, controller\.view\(\)\.wordAttemptDue\)\) \{\s*decodeInput\.focus\(\);\s*return;\s*\}/,
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
    assert.deepEqual(posts.sort(), ["finished", '{ type: "ready" }']);
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
    assert.match(source, /app\.replaceChildren\([^)]*decode, result, resultNote, message, keypad\)/);
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
  const target: Record<string, unknown> = {
    ...record,
    attributes,
    focusCalls: 0,
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute: (name: string, value: string) => {
      attributes[name] = value;
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
  /** The focused element, or null for the page (`<body>`). */
  readonly focus: FocusTracker;
  /** Sends a message from the host, as JSON. */
  send(json: string): void;
  /** Presses a physical key wherever focus is. */
  press(key: string): void;
}

/** Runs the bundled webview against a fake DOM, restoring `saved` as its state. */
function runWebview(saved: unknown): WebviewRun {
  const elements: Record<string, unknown>[] = [];
  const namespaces: { tag: string; ns: unknown }[] = [];
  const posts: unknown[] = [];
  const focus: FocusTracker = { active: null };
  const listeners = new Map<string, (event: unknown) => void>();
  const listen = (type: string, listener: (event: unknown) => void): void => {
    listeners.set(type, listener);
  };
  const document = {
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
    requestAnimationFrame() {},
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
      setState() {},
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
    focus,
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
  // built the same way, so they're checked too.
  it("creates the padlock's, the light bulb's and the down arrows' SVG elements in the SVG namespace", () => {
    const { namespaces } = runWebview(undefined);
    assert.deepEqual(
      namespaces.map((n) => n.tag),
      // The padlock, the light bulb, then one down arrow per byte.
      ["svg", "rect", "path", "svg", "path", "path", ...new Array<string[]>(4).fill(["svg", "path"]).flat()],
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
  });

  it("brings a restored solved round's card back, without posting roundFinished again", () => {
    const saved = savedAfter(...guess("TEAM"), decode("TEAM"), ...guess("BYTE"), decode("BYTE"));
    assert.equal(saved.reported, true);
    const run = runWebview(saved);
    assert.equal(byClass(run, "result")["hidden"], false);
    assert.equal(byClass(run, "result-heading")["textContent"], "Decoded: BYTE");
    assert.equal(byClass(run, "result-line")["textContent"], "2 of 6 rows · no hints");
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
    assert.equal(byClass(run, "result-line")["textContent"], "6 of 6 rows · no hints");
    assert.deepEqual(run.posts, [{ type: "ready" }]);
  });

  it("draws New round as a real <button> with its text set by textContent", () => {
    const run = runWebview(savedAfter(...guess("BYTE"), decode("BYTE")));
    const button = byClass(run, "result-button");
    assert.equal(button["tag"], "button");
    assert.equal(button["type"], "button");
    assert.equal(button["textContent"], "New round");
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
    assert.equal(run.focus.active, byClass(run, "decode-input"), "the word attempt has the keyboard");
  });

  it("doesn't focus New round again on later renders while the card is already showing", () => {
    const run = runWebview(FINISHED[0]?.[1]());
    // Ignored keys and a repeated init: each still ends with a render.
    run.press("4");
    run.press("Backspace");
    run.send(JSON.stringify({ type: "init", stats: toStatsView(EMPTY_STATS) }));
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
      assert.equal(run.focus.active, byClass(run, "decode-input"), "ENTER scored the row and opened the decode box");
    });
  }
});
