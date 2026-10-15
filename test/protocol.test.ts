import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_ROWS, Round, wordToHex } from "../src/game/index.ts";
import {
  handleWebviewMessage,
  parseHostMessage,
  parseWebviewMessage,
  type HostHandlers,
  type RoundFinishedMessage,
} from "../src/protocol.ts";
import { EMPTY_STATS, type Stats } from "../src/stats.ts";
import { WORDS, WORD_SET } from "./game/fixtures.ts";

/** A valid `roundFinished`; each case below changes one thing about it. */
function roundFinished(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "roundFinished", solved: true, rowsUsed: 3, answerTries: 2, hintsUsed: false, ...overrides };
}

function without(key: string): Record<string, unknown> {
  const message = roundFinished();
  delete message[key];
  return message;
}

/** Handlers that record every call, to prove an ignored message changed nothing. */
function recordingHandlers(stats: Stats = EMPTY_STATS): HostHandlers & { calls: RoundFinishedMessage[] } {
  const calls: RoundFinishedMessage[] = [];
  return { calls, roundFinished: (message) => calls.push(message), stats: () => stats };
}

/** Some played rounds, and their counts with the derived values. */
const SOME_STATS: Stats = { played: 4, solved: 3, solvedRowsTotal: 9, hintsUsedCount: 1 };
const SOME_STATS_VIEW = { ...SOME_STATS, averageRows: 3, hintsUsedRate: 0.25 };

/** The `init` a new player gets: zero counts, nothing to derive yet. */
const EMPTY_INIT = {
  type: "init",
  stats: { played: 0, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0, averageRows: null, hintsUsedRate: null },
};

/** A valid `init` with `SOME_STATS`, with the stats fields overridden. */
function init(statsOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "init", stats: { ...SOME_STATS_VIEW, ...statsOverrides } };
}

function initWithout(key: string): Record<string, unknown> {
  const stats: Record<string, unknown> = { ...SOME_STATS_VIEW };
  delete stats[key];
  return { type: "init", stats };
}

class Lookalike {
  readonly type = "ready";
}

/** Every message the host must ignore, one test each. */
const INVALID: readonly (readonly [string, unknown])[] = [
  // Unknown types
  ["an unknown type", { type: "deleteFiles" }],
  ["setTheme (Phase 3)", { type: "setTheme", theme: "dark" }],
  ["newRound (story #9)", { type: "newRound" }],
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
  ["roundFinished without answerTries", without("answerTries")],
  ["roundFinished without hintsUsed", without("hintsUsed")],
  // Extra fields
  ["ready with an extra field", { type: "ready", extra: 1 }],
  ["roundFinished with an extra field", roundFinished({ extra: 1 })],
  ["roundFinished with the hidden answer", roundFinished({ answer: "BYTE" })],
  ["roundFinished with an undefined extra field", roundFinished({ extra: undefined })],
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
  ["hintsUsed as 0", roundFinished({ hintsUsed: 0 })],
  ['rowsUsed as the string "3"', roundFinished({ rowsUsed: "3" })],
  ["rowsUsed as a Number object", roundFinished({ rowsUsed: new Number(3) })],
  ["rowsUsed as a bigint", roundFinished({ rowsUsed: 3n })],
  ['answerTries as the string "2"', roundFinished({ answerTries: "2" })],
  ["answerTries as null", roundFinished({ answerTries: null })],
  // Out of range
  ["rowsUsed: 7", roundFinished({ rowsUsed: 7 })],
  ["rowsUsed: 0", roundFinished({ rowsUsed: 0, answerTries: 0 })],
  ["rowsUsed: -1", roundFinished({ rowsUsed: -1 })],
  ["rowsUsed: 2.5", roundFinished({ rowsUsed: 2.5 })],
  ["rowsUsed: NaN", roundFinished({ rowsUsed: Number.NaN })],
  ["rowsUsed: Infinity", roundFinished({ rowsUsed: Number.POSITIVE_INFINITY })],
  ["answerTries: -1", roundFinished({ answerTries: -1 })],
  ["answerTries: 1.5", roundFinished({ answerTries: 1.5 })],
  ["answerTries: 7", roundFinished({ rowsUsed: 6, answerTries: 7 })],
  ["answerTries above rowsUsed", roundFinished({ rowsUsed: 3, answerTries: 4 })],
  ["a solved round with no answer tries", roundFinished({ solved: true, answerTries: 0 })],
  ["a failed round with rows left", roundFinished({ solved: false, rowsUsed: 5, answerTries: 5 })],
  ["a failed round without the forced final answer", roundFinished({ solved: false, rowsUsed: 6, answerTries: 0 })],
];

describe("parseWebviewMessage", () => {
  describe("accepts only ready and roundFinished", () => {
    it("accepts ready", () => {
      assert.deepEqual(parseWebviewMessage({ type: "ready" }), { type: "ready" });
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
      ["solved on the first row", { solved: true, rowsUsed: 1, answerTries: 1 }],
      ["solved on the last row with every try used", { solved: true, rowsUsed: MAX_ROWS, answerTries: MAX_ROWS }],
      ["solved with the forced final answer only", { solved: true, rowsUsed: MAX_ROWS, answerTries: 1 }],
      ["failed with only the forced final answer", { solved: false, rowsUsed: MAX_ROWS, answerTries: 1 }],
      ["failed with every try used", { solved: false, rowsUsed: MAX_ROWS, answerTries: MAX_ROWS }],
      ["hints used", { hintsUsed: true }],
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
      for (const result of realRoundResults()) {
        const { answer: _answer, ...fields } = result;
        assert.deepEqual(parseWebviewMessage({ type: "roundFinished", ...fields }), { type: "roundFinished", ...fields });
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

  it("returns a new stats object, not the one it was given", () => {
    const raw = init();
    const message = parseHostMessage(raw);
    assert.notEqual(message?.stats, raw.stats);
  });

  const invalid: readonly (readonly [string, unknown])[] = [
    ["an unknown type", { type: "setTheme" }],
    ["a webview message", { type: "ready" }],
    ["init without stats", { type: "init" }],
    ["init with an extra field", { ...init(), html: "<img src=x onerror=alert(1)>" }],
    ["init with stats as a string", { type: "init", stats: "Played 3" }],
    ["init with stats as null", { type: "init", stats: null }],
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

/** Plays real rounds to every kind of ending and returns their results. */
function realRoundResults() {
  const [answer, other] = WORDS;
  assert.ok(answer && other);
  const guess = wordToHex(other);
  const results = [];

  // Solved on the first row.
  let round = new Round(answer, WORD_SET);
  round.submitGuess(guess);
  round.submitAnswer(answer);
  results.push(round.result());

  // Every row skipped, then solved or failed with the forced final answer.
  for (const final of [answer, other]) {
    round = new Round(answer, WORD_SET);
    round.enableHints();
    for (let row = 1; row < MAX_ROWS; row++) {
      round.submitGuess(guess);
      round.skipAnswer();
    }
    round.submitGuess(guess);
    round.submitAnswer(final);
    results.push(round.result());
  }

  // Every try used and wrong, then failed with the forced final answer.
  round = new Round(answer, WORD_SET);
  for (let row = 1; row <= MAX_ROWS; row++) {
    round.submitGuess(guess);
    round.submitAnswer(other);
  }
  results.push(round.result());
  return results;
}
