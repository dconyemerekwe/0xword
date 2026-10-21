import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_ROWS } from "../src/game/index.ts";
import { handleWebviewMessage, type HostHandlers } from "../src/protocol.ts";
import {
  EMPTY_STATS,
  STATS_KEY,
  StatsStore,
  deriveStats,
  parseStats,
  parseStatsView,
  recordResult,
  toStatsView,
  type FinishedRound,
  type Stats,
  type StatsStorage,
} from "../src/stats.ts";

const ZEROS = { played: 0, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0 };

/** 4 rounds: 3 solved in 9 rows in total, 1 with hints. */
const SOME_STATS: Stats = { played: 4, solved: 3, solvedRowsTotal: 9, hintsUsedCount: 1 };

function stats(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...SOME_STATS, ...overrides };
}

function round(overrides: Partial<FinishedRound> = {}): FinishedRound {
  return { solved: true, rowsUsed: 3, hintsUsed: false, ...overrides };
}

/** A valid `roundFinished` message, as the webview would send it. */
function roundFinished(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "roundFinished", solved: true, rowsUsed: 3, answerTries: 2, hintsUsed: false, ...overrides };
}

/** An in-memory `globalState` that counts writes and can be made to fail. */
class FakeStorage implements StatsStorage {
  readonly values = new Map<string, unknown>();
  updates = 0;
  failUpdate: "reject" | "throw" | null = null;
  failGet = false;

  get(key: string): unknown {
    if (this.failGet) {
      throw new Error("storage unavailable");
    }
    return this.values.get(key);
  }

  update(key: string, value: unknown): PromiseLike<void> {
    this.updates++;
    if (this.failUpdate === "throw") {
      throw new Error("update threw");
    }
    if (this.failUpdate === "reject") {
      return Promise.reject(new Error("disk full"));
    }
    this.values.set(key, value);
    return Promise.resolve();
  }
}

/** The host's handlers wired to a store, the same way `extension.ts` wires them, with no theme chosen. */
function handlersFor(store: StatsStore): HostHandlers {
  return {
    roundFinished: (message) => void store.record(message),
    stats: () => store.current(),
    setTheme: () => {},
    theme: () => "system",
  };
}

/** Lets pending promise callbacks run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

class StatsLookalike {
  readonly played = 1;
  readonly solved = 1;
  readonly solvedRowsTotal = 1;
  readonly hintsUsedCount = 0;
}

/** Stored values that aren't valid stats, one test each. */
const CORRUPT: readonly (readonly [string, unknown])[] = [
  // Not a plain object
  ["a string", "played=4"],
  ["a JSON string of valid stats", JSON.stringify(SOME_STATS)],
  ["a number", 4],
  ["a boolean", true],
  ["null", null],
  ["an array", [4, 3, 9, 1]],
  ["a class instance", new StatsLookalike()],
  ["a getter for a count", Object.defineProperty(stats(), "played", { enumerable: true, get: () => 4 })],
  [
    "a getter that throws",
    Object.defineProperty(stats(), "played", {
      enumerable: true,
      get: () => {
        throw new Error("boom");
      },
    }),
  ],
  // Wrong keys
  ["an empty object", {}],
  ["stats without played", { solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0 }],
  ["stats with an extra field", stats({ streak: 2 })],
  ["stats with derived values stored too", { ...SOME_STATS, averageRows: 3, hintsUsedRate: 0.25 }],
  ["stats with a JSON-parsed __proto__ key", JSON.parse(`{${JSON.stringify(SOME_STATS).slice(1, -1)},"__proto__":{}}`)],
  // Wrong types
  ['a count as the string "4"', stats({ played: "4" })],
  ["a count as null", stats({ solved: null })],
  ["a count as a boolean", stats({ hintsUsedCount: true })],
  ["a count as a bigint", stats({ played: 4n })],
  // Bad numbers
  ["a negative played", stats({ played: -1 })],
  ["a negative solved", stats({ solved: -1 })],
  ["a negative hints count", stats({ hintsUsedCount: -1 })],
  ["a non-integer played", stats({ played: 4.5 })],
  ["a non-integer rows total", stats({ solvedRowsTotal: 9.5 })],
  ["NaN", stats({ played: Number.NaN })],
  ["Infinity", stats({ played: Number.POSITIVE_INFINITY })],
  ["a played above the largest safe integer", stats({ played: Number.MAX_SAFE_INTEGER + 1 })],
  // Broken invariants
  ["more solved than played", stats({ solved: 5 })],
  ["more hints-used rounds than played", stats({ hintsUsedCount: 5 })],
  ["fewer rows than solved rounds", stats({ solvedRowsTotal: 2 })],
  ["more than MAX_ROWS rows per solved round", stats({ solvedRowsTotal: 3 * MAX_ROWS + 1 })],
  ["rows with no solved rounds", stats({ solved: 0, solvedRowsTotal: 1 })],
];

describe("parseStats", () => {
  it("starts every count at 0 when nothing is stored", () => {
    assert.deepEqual(parseStats(undefined), ZEROS);
  });

  it("reads valid stored stats", () => {
    assert.deepEqual(parseStats(stats()), SOME_STATS);
  });

  it("reads zeros as zeros", () => {
    assert.deepEqual(parseStats(ZEROS), ZEROS);
  });

  it("returns a new object, not the stored one", () => {
    const raw = stats();
    assert.notEqual(parseStats(raw), raw);
  });

  it("accepts stats round-tripped through JSON, as globalState stores them", () => {
    assert.deepEqual(parseStats(JSON.parse(JSON.stringify(SOME_STATS))), SOME_STATS);
  });

  describe("valid edges", () => {
    const valid: readonly (readonly [string, Record<string, unknown>])[] = [
      ["every round solved in one row", { played: 3, solved: 3, solvedRowsTotal: 3, hintsUsedCount: 0 }],
      ["every round solved on the last row", { played: 3, solved: 3, solvedRowsTotal: 3 * MAX_ROWS, hintsUsedCount: 0 }],
      ["every round failed", { played: 3, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0 }],
      ["hints used in every round", { played: 3, solved: 1, solvedRowsTotal: 2, hintsUsedCount: 3 }],
      ["the largest safe played", { played: Number.MAX_SAFE_INTEGER, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0 }],
    ];
    for (const [name, raw] of valid) {
      it(`accepts ${name}`, () => {
        assert.deepEqual(parseStats(raw), raw);
      });
    }
  });

  describe("resets corrupted or wrongly shaped stats to zeros, without throwing", () => {
    for (const [name, raw] of CORRUPT) {
      it(`resets ${name}`, () => {
        assert.deepEqual(parseStats(raw), ZEROS);
      });
    }
  });
});

describe("recordResult", () => {
  it("counts a solved round: played, solved and its rows", () => {
    assert.deepEqual(recordResult(SOME_STATS, round({ rowsUsed: 4 })), {
      played: 5,
      solved: 4,
      solvedRowsTotal: 13,
      hintsUsedCount: 1,
    });
  });

  it("counts a failed round as played only, without adding its rows", () => {
    assert.deepEqual(recordResult(SOME_STATS, round({ solved: false, rowsUsed: MAX_ROWS })), {
      played: 5,
      solved: 3,
      solvedRowsTotal: 9,
      hintsUsedCount: 1,
    });
  });

  it("counts a round with hints used", () => {
    assert.equal(recordResult(SOME_STATS, round({ hintsUsed: true })).hintsUsedCount, 2);
  });

  it("counts hints in a failed round too", () => {
    assert.equal(recordResult(SOME_STATS, round({ solved: false, rowsUsed: MAX_ROWS, hintsUsed: true })).hintsUsedCount, 2);
  });

  it("doesn't count hints when none were used", () => {
    assert.equal(recordResult(SOME_STATS, round({ hintsUsed: false })).hintsUsedCount, 1);
  });

  it("counts a new player's first round from zeros", () => {
    assert.deepEqual(recordResult(EMPTY_STATS, round({ rowsUsed: 2, hintsUsed: true })), {
      played: 1,
      solved: 1,
      solvedRowsTotal: 2,
      hintsUsedCount: 1,
    });
  });

  it("adds 1 row for a round solved on the first row", () => {
    assert.equal(recordResult(EMPTY_STATS, round({ rowsUsed: 1 })).solvedRowsTotal, 1);
  });

  it("adds MAX_ROWS rows for a round solved on the last row", () => {
    assert.equal(recordResult(EMPTY_STATS, round({ rowsUsed: MAX_ROWS })).solvedRowsTotal, MAX_ROWS);
  });

  it("returns a new object and leaves the given stats unchanged", () => {
    const before = { ...SOME_STATS };
    const after = recordResult(SOME_STATS, round());
    assert.notEqual(after, SOME_STATS);
    assert.deepEqual(SOME_STATS, before);
  });

  it("always produces stats that parseStats accepts", () => {
    let current: Stats = EMPTY_STATS;
    for (const solved of [true, false]) {
      for (const hintsUsed of [true, false]) {
        for (let rowsUsed = 1; rowsUsed <= MAX_ROWS; rowsUsed++) {
          current = recordResult(current, { solved, hintsUsed, rowsUsed: solved ? rowsUsed : MAX_ROWS });
          assert.deepEqual(parseStats(current), current);
        }
      }
    }
  });

  it("stops counting at the largest safe played instead of producing invalid stats", () => {
    const full = { played: Number.MAX_SAFE_INTEGER, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0 };
    assert.deepEqual(recordResult(full, round()), full);
  });
});

describe("deriveStats", () => {
  it("gives null for both values when nothing has been played", () => {
    assert.deepEqual(deriveStats(EMPTY_STATS), { averageRows: null, hintsUsedRate: null });
  });

  it("gives a null average rows when nothing is solved yet, but a hints-used rate", () => {
    assert.deepEqual(deriveStats({ played: 2, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 1 }), {
      averageRows: null,
      hintsUsedRate: 0.5,
    });
  });

  it("divides the solved-rows total by solved, and hints used by played", () => {
    assert.deepEqual(deriveStats(SOME_STATS), { averageRows: 3, hintsUsedRate: 0.25 });
  });

  it("keeps a fractional average rows", () => {
    assert.equal(deriveStats({ played: 2, solved: 2, solvedRowsTotal: 7, hintsUsedCount: 0 }).averageRows, 3.5);
  });

  it("gives a hints-used rate of 0 when hints were never used", () => {
    assert.equal(deriveStats({ played: 3, solved: 1, solvedRowsTotal: 2, hintsUsedCount: 0 }).hintsUsedRate, 0);
  });

  it("gives a hints-used rate of 1 when hints were used every round", () => {
    assert.equal(deriveStats({ played: 3, solved: 1, solvedRowsTotal: 2, hintsUsedCount: 3 }).hintsUsedRate, 1);
  });

  it("gives an average of 1 and MAX_ROWS at the edges", () => {
    assert.equal(deriveStats({ played: 2, solved: 2, solvedRowsTotal: 2, hintsUsedCount: 0 }).averageRows, 1);
    assert.equal(deriveStats({ played: 2, solved: 2, solvedRowsTotal: 2 * MAX_ROWS, hintsUsedCount: 0 }).averageRows, MAX_ROWS);
  });
});

describe("toStatsView and parseStatsView", () => {
  it("puts the counts and the derived values in one flat object", () => {
    assert.deepEqual(toStatsView(SOME_STATS), { ...SOME_STATS, averageRows: 3, hintsUsedRate: 0.25 });
  });

  it("copies only the counts, not extra fields of the object it was given", () => {
    const withExtra = { ...SOME_STATS, extra: 1 };
    assert.deepEqual(Object.keys(toStatsView(withExtra)).sort(), [
      "averageRows",
      "hintsUsedCount",
      "hintsUsedRate",
      "played",
      "solved",
      "solvedRowsTotal",
    ]);
  });

  it("accepts what toStatsView makes, as a new object", () => {
    const view = toStatsView(SOME_STATS);
    const parsed = parseStatsView(view);
    assert.deepEqual(parsed, view);
    assert.notEqual(parsed, view);
  });

  it("accepts a view of zeros with null derived values", () => {
    assert.deepEqual(parseStatsView(toStatsView(EMPTY_STATS)), toStatsView(EMPTY_STATS));
  });

  it("rejects bare counts without the derived values", () => {
    assert.equal(parseStatsView(SOME_STATS), null);
  });
});

describe("StatsStore", () => {
  it("starts every count at 0 when nothing is stored", () => {
    assert.deepEqual(new StatsStore(new FakeStorage()).current(), ZEROS);
  });

  it("reads the stats from the versioned key", () => {
    const storage = new FakeStorage();
    storage.values.set(STATS_KEY, stats());
    assert.equal(STATS_KEY, "0xword.stats.v1");
    assert.deepEqual(new StatsStore(storage).current(), SOME_STATS);
  });

  it("reads corrupted stored stats as zeros", () => {
    const storage = new FakeStorage();
    storage.values.set(STATS_KEY, stats({ solved: 99 }));
    assert.deepEqual(new StatsStore(storage).current(), ZEROS);
  });

  it("reads zeros, without throwing, when the storage throws", () => {
    const storage = new FakeStorage();
    storage.failGet = true;
    assert.deepEqual(new StatsStore(storage).current(), ZEROS);
  });

  it("records a round by writing the updated stats to the key", async () => {
    const storage = new FakeStorage();
    storage.values.set(STATS_KEY, stats());
    await new StatsStore(storage).record(round({ rowsUsed: 2, hintsUsed: true }));
    assert.deepEqual(storage.values.get(STATS_KEY), { played: 5, solved: 4, solvedRowsTotal: 11, hintsUsedCount: 2 });
    assert.equal(storage.updates, 1);
  });

  it("records over corrupted stats by starting again from zeros", async () => {
    const storage = new FakeStorage();
    storage.values.set(STATS_KEY, "garbage");
    await new StatsStore(storage).record(round({ rowsUsed: 2 }));
    assert.deepEqual(storage.values.get(STATS_KEY), { played: 1, solved: 1, solvedRowsTotal: 2, hintsUsedCount: 0 });
  });

  it("counts two rounds recorded back to back without waiting", async () => {
    const storage = new FakeStorage();
    const store = new StatsStore(storage);
    await Promise.all([store.record(round()), store.record(round({ solved: false, rowsUsed: MAX_ROWS }))]);
    assert.deepEqual(store.current(), { played: 2, solved: 1, solvedRowsTotal: 3, hintsUsedCount: 0 });
  });

  it("resolves, and leaves the stored stats unchanged, when the write rejects", async () => {
    const storage = new FakeStorage();
    storage.values.set(STATS_KEY, stats());
    storage.failUpdate = "reject";
    await assert.doesNotReject(new StatsStore(storage).record(round()));
    assert.deepEqual(storage.values.get(STATS_KEY), SOME_STATS);
  });

  it("resolves, and leaves the stored stats unchanged, when the write throws", async () => {
    const storage = new FakeStorage();
    storage.values.set(STATS_KEY, stats());
    storage.failUpdate = "throw";
    await assert.doesNotReject(new StatsStore(storage).record(round()));
    assert.deepEqual(storage.values.get(STATS_KEY), SOME_STATS);
  });

  it("resolves when reading the storage throws", async () => {
    const storage = new FakeStorage();
    storage.failGet = true;
    await assert.doesNotReject(new StatsStore(storage).record(round()));
  });
});

describe("the host's message handling with a stats store", () => {
  it("updates the stored stats for a valid roundFinished", async () => {
    const storage = new FakeStorage();
    const store = new StatsStore(storage);
    assert.equal(handleWebviewMessage(roundFinished({ rowsUsed: 4, hintsUsed: true }), handlersFor(store)), null);
    await settle();
    assert.deepEqual(store.current(), { played: 1, solved: 1, solvedRowsTotal: 4, hintsUsedCount: 1 });
  });

  it("counts a failed roundFinished as played only", async () => {
    const store = new StatsStore(new FakeStorage());
    handleWebviewMessage(roundFinished({ solved: false, rowsUsed: MAX_ROWS }), handlersFor(store));
    await settle();
    assert.deepEqual(store.current(), { played: 1, solved: 0, solvedRowsTotal: 0, hintsUsedCount: 0 });
  });

  describe("leaves the stats unchanged for a malformed roundFinished", () => {
    const malformed: readonly (readonly [string, unknown])[] = [
      ["a missing field", { type: "roundFinished", solved: true, rowsUsed: 3, answerTries: 1 }],
      ["an extra field", roundFinished({ answer: "BYTE" })],
      ['solved as the string "true"', roundFinished({ solved: "true" })],
      ["hintsUsed as 1", roundFinished({ hintsUsed: 1 })],
      ["rowsUsed: 0", roundFinished({ rowsUsed: 0 })],
      ["rowsUsed above MAX_ROWS", roundFinished({ rowsUsed: MAX_ROWS + 1 })],
      ["a fractional rowsUsed", roundFinished({ rowsUsed: 2.5 })],
      ["a huge rowsUsed", roundFinished({ rowsUsed: 1e9 })],
      ["no answer tries", roundFinished({ answerTries: 0 })],
      ["a fractional answerTries", roundFinished({ answerTries: 1.5 })],
      ["a failed round with rows left", roundFinished({ solved: false, rowsUsed: 3 })],
      ["not an object", "roundFinished"],
    ];
    for (const [name, raw] of malformed) {
      it(`ignores ${name}`, async () => {
        const storage = new FakeStorage();
        storage.values.set(STATS_KEY, stats());
        assert.equal(handleWebviewMessage(raw, handlersFor(new StatsStore(storage))), null);
        await settle();
        assert.equal(storage.updates, 0);
        assert.deepEqual(storage.values.get(STATS_KEY), SOME_STATS);
      });
    }
  });

  it("doesn't throw from the listener when saving the stats fails", async () => {
    const storage = new FakeStorage();
    storage.values.set(STATS_KEY, stats());
    storage.failUpdate = "reject";
    assert.doesNotThrow(() => handleWebviewMessage(roundFinished(), handlersFor(new StatsStore(storage))));
    await settle();
    assert.deepEqual(storage.values.get(STATS_KEY), SOME_STATS);
  });

  it("doesn't throw from the listener when the storage throws", () => {
    const storage = new FakeStorage();
    storage.failGet = true;
    storage.failUpdate = "throw";
    const handlers = handlersFor(new StatsStore(storage));
    assert.doesNotThrow(() => handleWebviewMessage(roundFinished(), handlers));
    assert.doesNotThrow(() => handleWebviewMessage({ type: "ready" }, handlers));
  });

  it("replies init with zero stats for a new player", () => {
    const reply = handleWebviewMessage({ type: "ready" }, handlersFor(new StatsStore(new FakeStorage())));
    assert.deepEqual(reply, { type: "init", stats: { ...ZEROS, averageRows: null, hintsUsedRate: null }, theme: "system" });
  });

  it("replies init with the stats after rounds have been recorded", async () => {
    const store = new StatsStore(new FakeStorage());
    const handlers = handlersFor(store);
    handleWebviewMessage(roundFinished({ rowsUsed: 2 }), handlers);
    handleWebviewMessage(roundFinished({ rowsUsed: 5, hintsUsed: true }), handlers);
    handleWebviewMessage(roundFinished({ solved: false, rowsUsed: MAX_ROWS }), handlers);
    await settle();
    assert.deepEqual(handleWebviewMessage({ type: "ready" }, handlers), {
      type: "init",
      stats: { played: 3, solved: 2, solvedRowsTotal: 7, hintsUsedCount: 1, averageRows: 3.5, hintsUsedRate: 1 / 3 },
      theme: "system",
    });
  });

  it("replies init with zero stats when the stored stats are corrupted", () => {
    const storage = new FakeStorage();
    storage.values.set(STATS_KEY, { played: -3 });
    const reply = handleWebviewMessage({ type: "ready" }, handlersFor(new StatsStore(storage)));
    assert.deepEqual(reply, { type: "init", stats: { ...ZEROS, averageRows: null, hintsUsedRate: null }, theme: "system" });
  });
});
