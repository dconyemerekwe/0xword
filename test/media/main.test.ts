// Scans the webview's DOM layer (media/main.ts) for the security and
// accessibility rules it must follow. Its behaviour is tested through the
// controller it drives (test/ui/game.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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

  it("makes every clickable key a real <button>", () => {
    // The only click handler is on keypad buttons, which `keypadButton` makes as <button>.
    assert.equal(source.match(/addEventListener\("click"/g)?.length, 1);
    assert.match(source, /function keypadButton[\s\S]*?element\("button"/);
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
    assert.match(source, /keypadButton\("[^"]*", "DEL",[\s\S]*?del\.setAttribute\("aria-label", "DEL, /);
    assert.match(source, /keypadButton\("[^"]*", "ENTER",[\s\S]*?enter\.setAttribute\("aria-label", "ENTER, /);
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
});
