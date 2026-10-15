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

  it('labels the decode box "Decode the word", with the "Type the English word" placeholder', () => {
    assert.match(source, /element\("label", "[^"]*", "Decode the word"\)/);
    assert.match(source, /label\.htmlFor = "decode-input"/);
    assert.match(source, /decodeInput\.id = "decode-input"/);
    assert.match(source, /decodeInput\.placeholder = "Type the English word"/);
    assert.match(source, /element\("button", "[^"]*", "Decode"\)/);
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

  it("saves with setState in changed()", () => {
    assert.match(source, /function changed\(\): void \{[\s\S]*?vscode\.setState\(state\)[\s\S]*?render\(/);
  });
});
