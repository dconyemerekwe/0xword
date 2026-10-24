import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_HINTS, MAX_ROWS, Round, WORD_LIST_SIZE, wordToHex } from "../src/game/index.ts";
import {
  handleWebviewMessage,
  parseHostMessage,
  parseWebviewMessage,
  type HostHandlers,
  type RoundFinishedMessage,
} from "../src/protocol.ts";
import { EMPTY_STATS, type Stats } from "../src/stats.ts";
import { THEMES, type Theme } from "../src/theme.ts";
import { WORDS, WORD_SET } from "./game/fixtures.ts";

/** A valid `roundFinished`; each case below changes one thing about it. */
function roundFinished(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "roundFinished", solved: true, rowsUsed: 3, answerTries: 1, hintsUsed: 0, ...overrides };
}

function without(key: string): Record<string, unknown> {
  const message = roundFinished();
  delete message[key];
  return message;
}

/** Handlers that record every call, to prove an ignored message changed nothing. */
function recordingHandlers(
  stats: Stats = EMPTY_STATS,
  theme: Theme = "system",
): HostHandlers & { calls: RoundFinishedMessage[]; themes: Theme[] } {
  const calls: RoundFinishedMessage[] = [];
  const themes: Theme[] = [];
  return {
    calls,
    themes,
    roundFinished: (message) => calls.push(message),
    stats: () => stats,
    setTheme: (choice) => themes.push(choice),
    theme: () => theme,
  };
}

/** A `setTheme` with `theme`, plus any extra fields. */
function setTheme(theme: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "setTheme", theme, ...extra };
}

/** Some played rounds, and their counts with the derived values. */
const SOME_STATS: Stats = { played: 4, solved: 3, solvedRowsTotal: 9, hintsUsedCount: 1 };
const SOME_STATS_VIEW = { ...SOME_STATS, averageRows: 3, hintsUsedRate: 0.25 };

/** The `init` a new player gets: zero counts, nothing to derive yet. */
const EMPTY_INIT = {
  type: "init",
  stats: { played: 0, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0, averageRows: null, hintsUsedRate: null },
  theme: "system",
};

/** A valid `init` with `SOME_STATS` and the system theme, with the stats fields overridden. */
function init(statsOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "init", stats: { ...SOME_STATS_VIEW, ...statsOverrides }, theme: "system" };
}

function initWithout(key: string): Record<string, unknown> {
  const stats: Record<string, unknown> = { ...SOME_STATS_VIEW };
  delete stats[key];
  return { type: "init", stats, theme: "system" };
}

class Lookalike {
  readonly type = "ready";
}

/** Every message the host must ignore, one test each. */
const INVALID: readonly (readonly [string, unknown])[] = [
  // Unknown types
  ["an unknown type", { type: "deleteFiles" }],
  ["setTheme in the wrong case", { type: "SetTheme", theme: "dark" }],
  ["newRound, which only the host sends", { type: "newRound" }],
  ["init, which only the host sends", { type: "init" }],
  ["a type in the wrong case", { type: "Ready" }],
  ["a non-string type", { type: 1 }],
  ["no type at all", {}],
  // Not an object
  ["null", null],
  ["undefined", undefined],
  ["a string", "ready"],
  ["a JSON string", '{"type":"ready"}'],
  ["a number", 42],
  ["a boolean", true],
  ["an array", [{ type: "ready" }]],
  ["an array with a type property", Object.assign([], { type: "ready" })],
  ["a function", () => ({ type: "ready" })],
  ["a class instance", new Lookalike()],
  ["an object inheriting its type", Object.create({ type: "ready" })],
  ["a Map", new Map([["type", "ready"]])],
  // Missing fields
  ["roundFinished without solved", without("solved")],
  ["roundFinished without rowsUsed", without("rowsUsed")],
  ["roundFinished without hintsUsed", without("hintsUsed")],
  ["roundFinished without answerTries (before #30)", without("answerTries")],
  // Extra fields
  ["ready with an extra field", { type: "ready", extra: 1 }],
  ["roundFinished with an extra field", roundFinished({ extra: 1 })],
  ["roundFinished with the hidden answer", roundFinished({ answer: "BYTE" })],
  ["roundFinished with an undefined extra field", roundFinished({ extra: undefined })],
  // One try per round since #46: answerTries is exactly 1
  ["roundFinished with answerTries: 0", roundFinished({ answerTries: 0 })],
  ["a failed round with answerTries: 0", roundFinished({ solved: false, rowsUsed: MAX_ROWS, answerTries: 0 })],
  ["a solved round with 2 tries (sent before #46)", roundFinished({ answerTries: 2 })],
  ["a failed round with a try per row (sent before #46)", roundFinished({ solved: false, rowsUsed: MAX_ROWS, answerTries: MAX_ROWS })],
  ["a solved round with a try for every listed word (sent before #46)", roundFinished({ answerTries: WORD_LIST_SIZE })],
  ["roundFinished with answerTries: -1", roundFinished({ answerTries: -1 })],
  ["roundFinished with answerTries: 1.5", roundFinished({ answerTries: 1.5 })],
  ["roundFinished with answerTries: 0.9999999999999999", roundFinished({ answerTries: 0.9999999999999999 })],
  ["roundFinished with answerTries: NaN", roundFinished({ answerTries: Number.NaN })],
  ["roundFinished with answerTries: Infinity", roundFinished({ answerTries: Number.POSITIVE_INFINITY })],
  ["roundFinished with answerTries as a string", roundFinished({ answerTries: "1" })],
  ["roundFinished with answerTries as true", roundFinished({ answerTries: true })],
  ["roundFinished with answerTries as a Number object", roundFinished({ answerTries: new Number(1) })],
  ["roundFinished with answerTries as null", roundFinished({ answerTries: null })],
  ["roundFinished with an undefined answerTries", roundFinished({ answerTries: undefined })],
  ["roundFinished with answerTries as a bigint", roundFinished({ answerTries: 1n })],
  ["ready with a JSON-parsed __proto__ key", JSON.parse('{"type":"ready","__proto__":{"polluted":true}}')],
  [
    "roundFinished with a JSON-parsed __proto__ key",
    JSON.parse(`{${JSON.stringify(roundFinished()).slice(1, -1)},"__proto__":{"isAdmin":true}}`),
  ],
  ["ready with a JSON-parsed constructor key", JSON.parse('{"type":"ready","constructor":{"prototype":{}}}')],
  ["ready with a symbol key", { type: "ready", [Symbol("extra")]: 1 }],
  [
    "ready with a getter for its type",
    Object.defineProperty({}, "type", { enumerable: true, get: () => "ready" }),
  ],
  // Wrong field types
  ['solved as the string "true"', roundFinished({ solved: "true" })],
  ["solved as 1", roundFinished({ solved: 1 })],
  ["solved as null", roundFinished({ solved: null })],
  ['hintsUsed as the string "false"', roundFinished({ hintsUsed: "false" })],
  ['hintsUsed as the string "1"', roundFinished({ hintsUsed: "1" })],
  ["hintsUsed as false (the flag sent before #38)", roundFinished({ hintsUsed: false })],
  ["hintsUsed as true (the flag sent before #38)", roundFinished({ hintsUsed: true })],
  ["hintsUsed as null", roundFinished({ hintsUsed: null })],
  ["hintsUsed as a bigint", roundFinished({ hintsUsed: 1n })],
  ["hintsUsed as a Number object", roundFinished({ hintsUsed: new Number(1) })],
  // The hint count: 0 to rowsUsed, so at most MAX_HINTS (#38, #46)
  ["hintsUsed: -1", roundFinished({ hintsUsed: -1 })],
  ["hintsUsed: 1.5", roundFinished({ hintsUsed: 1.5 })],
  ["hintsUsed: NaN", roundFinished({ hintsUsed: Number.NaN })],
  ["hintsUsed: Infinity", roundFinished({ hintsUsed: Number.POSITIVE_INFINITY })],
  ["hintsUsed above MAX_HINTS", roundFinished({ solved: false, rowsUsed: MAX_ROWS, hintsUsed: MAX_HINTS + 1 })],
  ["a hint after the last row: rowsUsed + 1 (sent before #46)", roundFinished({ rowsUsed: 3, hintsUsed: 4 })],
  ["a failed round with MAX_ROWS + 1 hints (sent before #46)", roundFinished({ solved: false, rowsUsed: MAX_ROWS, hintsUsed: MAX_ROWS + 1 })],
  ["2 hints after one row", roundFinished({ rowsUsed: 1, hintsUsed: 2 })],
  ["more hints than rowsUsed + 1", roundFinished({ rowsUsed: 3, hintsUsed: 5 })],
  ['rowsUsed as the string "3"', roundFinished({ rowsUsed: "3" })],
  ["rowsUsed as a Number object", roundFinished({ rowsUsed: new Number(3) })],
  ["rowsUsed as a bigint", roundFinished({ rowsUsed: 3n })],
  // Out of range
  ["rowsUsed: 7", roundFinished({ rowsUsed: 7 })],
  ["rowsUsed: 0", roundFinished({ rowsUsed: 0 })],
  ["rowsUsed: -1", roundFinished({ rowsUsed: -1 })],
  ["rowsUsed: 2.5", roundFinished({ rowsUsed: 2.5 })],
  ["rowsUsed: NaN", roundFinished({ rowsUsed: Number.NaN })],
  ["rowsUsed: Infinity", roundFinished({ rowsUsed: Number.POSITIVE_INFINITY })],
  // setTheme: any other value
  ['setTheme with "sepia"', setTheme("sepia")],
  ['setTheme with "Dark" in the wrong case', setTheme("Dark")],
  ['setTheme with " dark " padded', setTheme(" dark ")],
  ["setTheme with an empty theme", setTheme("")],
  ['setTheme with "auto"', setTheme("auto")],
  // setTheme: an extra field
  ["setTheme with an extra field", setTheme("dark", { extra: 1 })],
  ["setTheme with an undefined extra field", setTheme("light", { scope: undefined })],
  ["setTheme with a path", setTheme("dark", { path: "../../settings.json" })],
  ["setTheme with a JSON-parsed __proto__ key", JSON.parse('{"type":"setTheme","theme":"dark","__proto__":{"polluted":true}}')],
  // setTheme: a wrong type, or no theme
  ["setTheme with theme as a number", setTheme(1)],
  ["setTheme with theme as a boolean", setTheme(true)],
  ["setTheme with theme as null", setTheme(null)],
  ["setTheme with theme as an array", setTheme(["dark"])],
  ["setTheme with theme as an object", setTheme({ name: "dark" })],
  ["setTheme with theme as a String object", setTheme(new String("dark"))],
  ["setTheme without a theme", { type: "setTheme" }],
  ["setTheme with a getter for its theme", Object.defineProperty({ type: "setTheme" }, "theme", { enumerable: true, get: () => "dark" })],
];

describe("parseWebviewMessage", () => {
  describe("accepts only ready, roundFinished and setTheme", () => {
    it("accepts ready", () => {
      assert.deepEqual(parseWebviewMessage({ type: "ready" }), { type: "ready" });
    });

    for (const theme of THEMES) {
      it(`accepts setTheme with ${theme}`, () => {
        assert.deepEqual(parseWebviewMessage(setTheme(theme)), { type: "setTheme", theme });
      });
    }

    it("returns a new setTheme object, not the one it was given", () => {
      const raw = setTheme("dark");
      assert.notEqual(parseWebviewMessage(raw), raw);
    });

    it("accepts a valid roundFinished", () => {
      assert.deepEqual(parseWebviewMessage(roundFinished()), roundFinished());
    });

    it("accepts an object with a null prototype", () => {
      const message = Object.assign(Object.create(null) as object, { type: "ready" });
      assert.deepEqual(parseWebviewMessage(message), { type: "ready" });
    });
  });

  describe("rejects", () => {
    for (const [name, raw] of INVALID) {
      it(`returns null for ${name}`, () => {
        assert.equal(parseWebviewMessage(raw), null);
      });
    }
  });

  describe("roundFinished limits, valid edges", () => {
    const valid: readonly (readonly [string, Record<string, unknown>])[] = [
      ["solved on the first row", { solved: true, rowsUsed: 1 }],
      ["solved on the last row", { solved: true, rowsUsed: MAX_ROWS }],
      ["failed after row 6", { solved: false, rowsUsed: MAX_ROWS }],
      ["failed with rows left: a wrong word after a solved grid", { solved: false, rowsUsed: MAX_ROWS - 1 }],
      ["failed on the first row: a solved grid, then a wrong word", { solved: false, rowsUsed: 1 }],
      ["no hints", { hintsUsed: 0 }],
      ["one hint", { hintsUsed: 1 }],
      ["a hint for every row (rowsUsed)", { rowsUsed: 3, hintsUsed: 3 }],
      ["solved on the first row with 1 hint", { rowsUsed: 1, hintsUsed: 1 }],
      ["failed with rows left and hints", { solved: false, rowsUsed: 3, hintsUsed: 2 }],
      ["failed with the most hints, MAX_HINTS", { solved: false, rowsUsed: MAX_ROWS, hintsUsed: MAX_HINTS }],
      ["solved with the most hints, MAX_HINTS", { solved: true, rowsUsed: MAX_ROWS, hintsUsed: MAX_HINTS }],
    ];
    for (const [name, overrides] of valid) {
      it(`accepts ${name}`, () => {
        assert.deepEqual(parseWebviewMessage(roundFinished(overrides)), roundFinished(overrides));
      });
    }
  });

  describe("returns a typed message with exactly the allowed fields", () => {
    it("returns exactly type, solved, rowsUsed, answerTries and hintsUsed", () => {
      const message = parseWebviewMessage(roundFinished());
      assert.ok(message);
      assert.deepEqual(Object.keys(message).sort(), ["answerTries", "hintsUsed", "rowsUsed", "solved", "type"]);
    });

    it("returns a new plain object, not the one it was given", () => {
      const raw = roundFinished();
      const message = parseWebviewMessage(raw);
      assert.notEqual(message, raw);
      assert.equal(Object.getPrototypeOf(message), Object.prototype);
    });

    it("isn't affected by later changes to the input", () => {
      const raw = roundFinished();
      const message = parseWebviewMessage(raw);
      raw.rowsUsed = 99;
      assert.equal(message?.type === "roundFinished" && message.rowsUsed, 3);
    });

    it("accepts the result of every way a real round can end", () => {
      const messages = realRoundFinishedMessages();
      assert.equal(new Set(messages.map((message) => JSON.stringify(message))).size, REAL_ENDINGS);
      for (const message of messages) {
        assert.deepEqual(parseWebviewMessage(message), message);
      }
    });

    it("accepts a solved × rowsUsed × answerTries × hintsUsed combination exactly when a real round can end that way", () => {
      const real = new Set(realRoundFinishedMessages().map((message) => JSON.stringify(message)));
      let accepted = 0;
      for (const solved of [false, true]) {
        for (let rowsUsed = -1; rowsUsed <= MAX_ROWS + 2; rowsUsed++) {
          for (let answerTries = -1; answerTries <= 3; answerTries++) {
            for (let hintsUsed = -1; hintsUsed <= MAX_HINTS + 1; hintsUsed++) {
              const message = { type: "roundFinished", solved, rowsUsed, answerTries, hintsUsed };
              const isReal = real.has(JSON.stringify(message));
              assert.deepEqual(parseWebviewMessage(message), isReal ? message : null, JSON.stringify(message));
              accepted += isReal ? 1 : 0;
            }
          }
        }
      }
      assert.equal(accepted, REAL_ENDINGS);
    });

    it("accepts answerTries 1 only: every real round ends with exactly one try (#46)", () => {
      const tries = new Set(realRoundFinishedMessages().map((message) => message.answerTries));
      assert.deepEqual([...tries], [1]);
    });

    it("accepts a failed round with fewer than 6 rows, as a real round gives it (#46)", () => {
      const failedEarly = realRoundFinishedMessages().filter(
        (message) => message.solved === false && message.rowsUsed !== MAX_ROWS,
      );
      assert.ok(failedEarly.length > 0);
      for (const message of failedEarly) {
        assert.deepEqual(parseWebviewMessage(message), message);
      }
    });
  });
});

describe("handleWebviewMessage", () => {
  it("replies init to ready, with zero stats for a new player", () => {
    assert.deepEqual(handleWebviewMessage({ type: "ready" }, recordingHandlers()), EMPTY_INIT);
  });

  it("replies init carrying the current stats and their derived values", () => {
    assert.deepEqual(handleWebviewMessage({ type: "ready" }, recordingHandlers(SOME_STATS)), init());
  });

  it("sends an init that the webview's parseHostMessage accepts", () => {
    const reply = handleWebviewMessage({ type: "ready" }, recordingHandlers(SOME_STATS));
    assert.deepEqual(parseHostMessage(reply), reply);
  });

  it("passes a valid roundFinished to its handler, without a reply", () => {
    const handlers = recordingHandlers();
    assert.equal(handleWebviewMessage(roundFinished(), handlers), null);
    assert.deepEqual(handlers.calls, [roundFinished()]);
  });

  it("replies init carrying the stored theme", () => {
    for (const theme of THEMES) {
      const reply = handleWebviewMessage({ type: "ready" }, recordingHandlers(EMPTY_STATS, theme));
      assert.deepEqual(reply, { ...EMPTY_INIT, theme });
      assert.deepEqual(parseHostMessage(reply), reply);
    }
  });

  for (const theme of THEMES) {
    it(`passes a valid setTheme with ${theme} to its handler, without a reply`, () => {
      const handlers = recordingHandlers();
      assert.equal(handleWebviewMessage(setTheme(theme), handlers), null);
      assert.deepEqual(handlers.themes, [theme]);
      assert.deepEqual(handlers.calls, []);
    });
  }

  it("passes the handler a validated copy, not the raw message", () => {
    const handlers = recordingHandlers();
    const raw = roundFinished();
    handleWebviewMessage(raw, handlers);
    assert.notEqual(handlers.calls[0], raw);
  });

  describe("ignores invalid messages: no reply, no handler call, no exception", () => {
    for (const [name, raw] of INVALID) {
      it(`ignores ${name}`, () => {
        const handlers = recordingHandlers();
        assert.equal(handleWebviewMessage(raw, handlers), null);
        assert.deepEqual(handlers.calls, []);
        assert.deepEqual(handlers.themes, []);
      });
    }
  });

  describe("never uses message fields as paths, commands or code", () => {
    const hostile: readonly (readonly [string, unknown])[] = [
      ["a path", { type: "ready", path: "../../.ssh/id_rsa" }],
      ["a command", { type: "ready", command: "workbench.action.terminal.new", args: ["rm -rf ~"] }],
      ["code", { type: "ready", code: "require('child_process').exec('calc')" }],
      ["a path as the type", { type: "/etc/passwd" }],
      ["a command as the type", { type: "workbench.action.files.save" }],
      ["code in a field", roundFinished({ solved: "process.exit()" })],
    ];
    for (const [name, raw] of hostile) {
      it(`ignores a message carrying ${name}`, () => {
        const handlers = recordingHandlers();
        assert.equal(handleWebviewMessage(raw, handlers), null);
        assert.deepEqual(handlers.calls, []);
        assert.deepEqual(handlers.themes, []);
      });
    }

    it("only ever hands booleans and integers to the host, besides the fixed type", () => {
      const handlers = recordingHandlers();
      handleWebviewMessage(roundFinished(), handlers);
      const [{ type, ...fields }] = handlers.calls as [RoundFinishedMessage];
      assert.equal(type, "roundFinished");
      for (const value of Object.values(fields)) {
        assert.ok(typeof value === "boolean" || Number.isInteger(value), String(value));
      }
    });

    it("replies with a fixed init that copies nothing from the message", () => {
      const reply = handleWebviewMessage({ type: "ready" }, recordingHandlers());
      assert.deepEqual(reply, EMPTY_INIT);
    });
  });
});

describe("parseHostMessage", () => {
  it("accepts init with stats", () => {
    assert.deepEqual(parseHostMessage(init()), init());
  });

  it("accepts init with zero stats and null derived values", () => {
    assert.deepEqual(parseHostMessage(EMPTY_INIT), EMPTY_INIT);
  });

  for (const theme of THEMES) {
    it(`accepts init with the ${theme} theme`, () => {
      const raw = { ...init(), theme };
      assert.deepEqual(parseHostMessage(raw), raw);
    });
  }

  it("returns a new stats object, not the one it was given", () => {
    const raw = init();
    const message = parseHostMessage(raw);
    assert.ok(message?.type === "init");
    assert.notEqual(message.stats, raw.stats);
  });

  it("accepts newRound", () => {
    assert.deepEqual(parseHostMessage({ type: "newRound" }), { type: "newRound" });
  });

  it("returns a new newRound object, not the one it was given", () => {
    const raw = { type: "newRound" };
    assert.notEqual(parseHostMessage(raw), raw);
  });

  const invalid: readonly (readonly [string, unknown])[] = [
    ["an unknown type", { type: "setTheme" }],
    ["a webview message", { type: "ready" }],
    ["newRound with an extra field", { type: "newRound", answer: "BYTE" }],
    ["newRound with an undefined extra field", { type: "newRound", round: undefined }],
    ["newRound in the wrong case", { type: "NewRound" }],
    ["newRound with a JSON-parsed __proto__ key", JSON.parse('{"type":"newRound","__proto__":{"polluted":true}}')],
    ["newRound inherited from a prototype", Object.create({ type: "newRound" })],
    ["a string newRound", "newRound"],
    ["init without stats", { type: "init", theme: "system" }],
    ["init without a theme", { type: "init", stats: SOME_STATS_VIEW }],
    ['init with the theme "sepia"', { ...init(), theme: "sepia" }],
    ["init with the theme in the wrong case", { ...init(), theme: "Light" }],
    ["init with the theme as a number", { ...init(), theme: 1 }],
    ["init with the theme as null", { ...init(), theme: null }],
    ["setTheme, which only the webview sends", { type: "setTheme", theme: "dark" }],
    ["init with an extra field", { ...init(), html: "<img src=x onerror=alert(1)>" }],
    ["init with stats as a string", { type: "init", stats: "Played 3", theme: "system" }],
    ["init with stats as null", { type: "init", stats: null, theme: "system" }],
    ["stats with an extra field", init({ streak: 2 })],
    ["stats with HTML in an extra field", init({ html: "<img src=x onerror=alert(1)>" })],
    ["stats without played", initWithout("played")],
    ["stats without averageRows", initWithout("averageRows")],
    ["stats without hintsUsedRate", initWithout("hintsUsedRate")],
    ["a negative count", init({ played: -1 })],
    ["a fractional count", init({ solved: 2.5 })],
    ["a count as a string", init({ played: "4" })],
    ["more solved than played", init({ solved: 5 })],
    ["an averageRows that doesn't match the counts", init({ averageRows: 2 })],
    ["an averageRows as a string", init({ averageRows: "3" })],
    ["a null averageRows with solved rounds", init({ averageRows: null })],
    ["a hintsUsedRate that doesn't match the counts", init({ hintsUsedRate: 0.5 })],
    ["a null hintsUsedRate with played rounds", init({ hintsUsedRate: null })],
    ["null", null],
    ["a string", "init"],
    ["an array", [init()]],
  ];
  for (const [name, raw] of invalid) {
    it(`returns null for ${name}`, () => {
      assert.equal(parseHostMessage(raw), null);
    });
  }
});

/**
 * How many different endings `realRoundFinishedMessages` gives: solved or
 * failed, after rows 1 to 6, with 0 to `rowsUsed` hints. For each outcome
 * that's 2 + 3 + … + 7 = 27.
 */
const REAL_ENDINGS = 2 * 27;

/**
 * Plays real rounds to every kind of ending and returns their results as
 * `roundFinished` messages: the decode step reached by a fully right row at
 * each of rows 1 to 6, or by row 6 without one; then the right word or a
 * wrong one (after a rejected word, which doesn't count), with every hint
 * count the round can reach. A count of `hints` turns Hints on before each of
 * the first `hints` rows. Hints locks with the hex, so there's none after.
 */
function realRoundFinishedMessages(): Record<string, unknown>[] {
  // Rows can't repeat in a round, so each row uses a word of its own.
  const [answer, ...others] = WORDS;
  assert.ok(answer);
  const wrongWord = others.at(-1) ?? "";
  const messages = [];
  for (let rowsUsed = 1; rowsUsed <= MAX_ROWS; rowsUsed++) {
    // A solved grid on the last row; at row 6, also a last row that isn't.
    for (const solvedGrid of rowsUsed === MAX_ROWS ? [true, false] : [true]) {
      for (const right of [true, false]) {
        for (let hints = 0; hints <= rowsUsed; hints++) {
          const round: Round = new Round(answer, WORD_SET);
          for (let row = 1; row <= rowsUsed; row++) {
            if (row <= hints) {
              round.enableHints();
            }
            const last = row === rowsUsed && solvedGrid;
            round.submitGuess(wordToHex(last ? answer : (others[row - 1] ?? "")));
          }
          assert.equal(round.submitAnswer("ZZZZ").ok, false);
          round.submitAnswer(right ? answer : wrongWord);
          assert.ok(round.isOver);
          const { answer: _answer, ...fields } = round.result();
          messages.push({ type: "roundFinished", ...fields });
        }
      }
    }
  }
  return messages;
}
