import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wordToHex } from "../../src/game/hex.ts";
import { MAX_ROWS } from "../../src/game/round.ts";
import { Mark } from "../../src/game/score.ts";
import { Session, restoreSession, type SessionState } from "../../src/game/session.ts";
import { parseWebviewMessage, type RoundFinishedMessage } from "../../src/protocol.ts";
import {
  DECODE_PANEL,
  FINAL_PANEL,
  GameController,
  HEX_DIGITS,
  HEX_LOCKED_STATUS,
  actionForKey,
  firstNonLetterByte,
  guessMessage,
  isHexLocked,
  keypad,
  scoredMessage,
  shouldFocusDecodeBox,
  statusLine,
  type Action,
  type ActionType,
  type KeyPress,
  type ScreenView,
} from "../../src/ui/game.ts";
import { WORDS } from "../game/fixtures.ts";

const { Right, Wrong, Absent } = Mark;

/** A random source that makes the session pick `word` as the answer. */
function answerIs(word: string): () => number {
  const index = WORDS.indexOf(word);
  assert.ok(index >= 0, word);
  return () => (index + 0.5) / WORDS.length;
}

interface Harness {
  readonly controller: GameController;
  readonly session: Session;
  /** What `changed` saved, one entry per call, as JSON-parsed plain data. */
  readonly saves: unknown[];
  /** The `roundFinished` messages `changed` was told to post, in order. */
  readonly posts: RoundFinishedMessage[];
  /** Dispatches each action in turn. */
  play(...actions: Action[]): ScreenView;
}

/** A controller over a fresh session whose answer is BYTE (42 59 54 45), started with `init`. */
function harness(session = new Session(WORDS, answerIs("BYTE")), start = true): Harness {
  const saves: unknown[] = [];
  const posts: RoundFinishedMessage[] = [];
  // Saves, then posts, like `changed()` in media/main.ts.
  const controller: GameController = new GameController(session, (finished) => {
    saves.push(JSON.parse(JSON.stringify(controller.savedState())));
    if (finished) {
      posts.push(finished);
    }
  });
  const play = (...actions: Action[]): ScreenView => {
    for (const action of actions) {
      controller.dispatch(action);
    }
    return controller.view();
  };
  if (start) {
    play({ type: "init" });
  }
  return { controller, session, saves, posts, play };
}

/** Digit actions for each character of `hex`. */
function type(hex: string): Action[] {
  return [...hex].map((digit) => ({ type: "digit", digit }));
}

/** Types a word's hex and presses ENTER. */
function guess(word: string): Action[] {
  return [...type(wordToHex(word)), { type: "enter" }];
}

const decode = (word: string): Action => ({ type: "decode", word });

/** The digits of one grid row as a string, e.g. "4259". */
function rowDigits(view: ScreenView, row: number): string {
  return (view.rows[row] ?? []).map((tile) => tile.digit).join("");
}

function rowStates(view: ScreenView, row: number): string[] {
  return (view.rows[row] ?? []).map((tile) => tile.state);
}

describe("GameController: the page 1 layout model", () => {
  it("has 6 rows of 8 empty tiles, 16 keys and row 1 of 6 at the start", () => {
    const view = harness().controller.view();
    assert.equal(view.rows.length, MAX_ROWS);
    for (const row of view.rows) {
      assert.deepEqual(
        row.map((tile) => tile.state),
        new Array(8).fill("empty"),
      );
    }
    assert.deepEqual(
      view.keys.map((key) => key.digit),
      [..."0123456789ABCDEF"],
    );
    assert.equal(view.status, "4-letter word · row 1 of 6");
    assert.equal(view.keypadEnabled, true);
    assert.equal(view.wordAttemptDue, false);
    assert.equal(view.hexLocked, false);
    assert.deepEqual(view.panel, DECODE_PANEL);
    assert.equal(view.panel.note, "1 try per row");
    assert.deepEqual(view.tried, []);
    assert.equal(view.message, "");
  });

  it("shows nothing playable before init", () => {
    const view = harness(undefined, false).controller.view();
    assert.equal(view.status, "4-letter word");
    assert.equal(view.keypadEnabled, false);
    assert.equal(view.wordAttemptDue, false);
  });

  it("never puts the answer in the model", () => {
    const { play } = harness();
    const views = [play(), play(...guess("TEAM")), play(decode("TEAM")), play(...type("4259"))];
    for (const view of views) {
      assert.doesNotMatch(JSON.stringify(view), /BYTE|42595445/);
    }
  });
});

describe("GameController: typing a hex row", () => {
  it("fills the row left to right, shown uppercase in typed tiles", () => {
    const view = harness().play(...type("4a5"));
    assert.equal(rowDigits(view, 0), "4A5");
    assert.deepEqual(rowStates(view, 0), ["typed", "typed", "typed", "empty", "empty", "empty", "empty", "empty"]);
  });

  it("takes every hex digit, 0–9 and A–F in either case", () => {
    const { play } = harness();
    assert.equal(rowDigits(play(...type("09afAF")), 0), "09AFAF");
  });

  it("stops at 8 digits", () => {
    const view = harness().play(...type("425954451234"));
    assert.equal(rowDigits(view, 0), "42595445");
  });

  it("ignores anything that isn't one hex digit", () => {
    const view = harness().play(...type("4"), ...["G", "", "42", " ", "-"].map((digit) => ({ type: "digit", digit }) as const));
    assert.equal(rowDigits(view, 0), "4");
  });

  it("removes the last digit with DEL, and does nothing on an empty row", () => {
    const { play } = harness();
    assert.equal(rowDigits(play(...type("425"), { type: "delete" }), 0), "42");
    assert.equal(rowDigits(play({ type: "delete" }, { type: "delete" }, { type: "delete" }), 0), "");
  });

  it("clears an error message on the next key", () => {
    const { play } = harness();
    assert.equal(play(...type("4"), { type: "enter" }).message, "Not enough digits");
    assert.equal(play(...type("2")).message, "");
  });
});

describe("GameController: scoring a row with ENTER", () => {
  it("locks a listed word's row and marks each tile", () => {
    // Answer BYTE 42 59 54 45, guess TEAM 54 45 41 4D (see Phase 1 in PLAN.md).
    const view = harness().play(...guess("TEAM"));
    assert.equal(rowDigits(view, 0), "5445414D");
    assert.deepEqual(rowStates(view, 0), [Wrong, Wrong, Wrong, Wrong, Absent, Absent, Right, Absent]);
  });

  it("announces the scored row's marks in words, as a non-error message", () => {
    const view = harness().play(...guess("TEAM"));
    assert.equal(view.message, "Row 1: 1 Right spot, 4 Wrong spot, 3 Not in word");
    assert.equal(view.messageIsError, false);
  });

  it("numbers the announcement with the row just scored", () => {
    const view = harness().play(...guess("TEAM"), decode("BEAT"), ...guess("BYTE"));
    assert.equal(view.message, "Row 2: 8 Right spot, 0 Wrong spot, 0 Not in word");
  });

  it("marks every tile right for the answer's own hex", () => {
    const view = harness().play(...guess("BYTE"));
    assert.deepEqual(rowStates(view, 0), new Array(8).fill(Right));
  });

  describe("rejects an invalid row without using it, keeping its digits", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ["no digits", "", "Not enough digits"],
      ["7 digits", "4259544", "Not enough digits"],
      ["a byte that isn't a letter", "42597B45", "7B isn't a letter"],
      ["a byte just below A", "40595445", "40 isn't a letter"],
      ["a byte just above Z", "425B5445", "5B isn't a letter"],
      ["a word not in the list", wordToHex("QXZJ"), "QXZJ isn't in the word list"],
    ];
    for (const [name, hex, message] of cases) {
      it(`${name}: "${message}"`, () => {
        const view = harness().play(...type(hex), { type: "enter" });
        assert.equal(view.message, message);
        assert.equal(view.messageIsError, true);
        assert.equal(rowDigits(view, 0), hex);
        assert.ok(rowStates(view, 0).every((state) => state === "typed" || state === "empty"));
        assert.equal(view.status, "4-letter word · row 1 of 6");
        assert.equal(view.keypadEnabled, true);
        assert.equal(view.wordAttemptDue, false);
      });
    }
  });
});

describe("GameController: while a word attempt is due", () => {
  it("disables the keypad, DEL and ENTER and opens the decode box", () => {
    const view = harness().play(...guess("TEAM"));
    assert.equal(view.keypadEnabled, false);
    assert.equal(view.wordAttemptDue, true);
    assert.equal(view.status, "4-letter word · row 1 of 6");
  });

  it("keeps typed hex, DEL and ENTER out of the grid", () => {
    const { play, session } = harness();
    play(...guess("TEAM"));
    const view = play(...type("4259"), { type: "delete" }, { type: "enter" });
    assert.equal(session.draft, "");
    assert.equal(session.round?.rows.length, 1);
    assert.deepEqual(rowStates(view, 1), new Array(8).fill("empty"));
    assert.equal(view.wordAttemptDue, true);
  });

  it("ignores a decode while a hex row is being typed", () => {
    const { play, session } = harness();
    const view = play(...type("42"), decode("BYTE"));
    assert.equal(session.round?.phase, "guess");
    assert.equal(view.message, "");
    assert.deepEqual(view.tried, []);
  });
});

describe("GameController: decoding the word", () => {
  for (const word of ["BYTE", "byte", " Byte "]) {
    it(`solves the round for ${JSON.stringify(word)}, in any letter case`, () => {
      const view = harness().play(...guess("TEAM"), decode(word));
      assert.equal(view.message, "Solved");
      assert.equal(view.messageIsError, false);
      assert.equal(view.status, "4-letter word · solved");
      assert.equal(view.keypadEnabled, false);
      assert.equal(view.wordAttemptDue, false);
      assert.deepEqual(view.tried, [], "the right word isn't a tried word");
    });
  }

  it("adds a wrong listed word to Tried, struck through with accessible text, and opens the next row", () => {
    const view = harness().play(...guess("TEAM"), decode("beat"));
    assert.deepEqual(view.tried, [{ word: "BEAT", label: "BEAT, wrong" }]);
    assert.equal(view.keypadEnabled, true);
    assert.equal(view.wordAttemptDue, false);
    assert.equal(view.status, "4-letter word · row 2 of 6");
    assert.equal(view.message, "BEAT isn't the word. On to row 2.");
    assert.equal(view.messageIsError, false);
  });

  it("keeps one Tried word per finished row, in order", () => {
    const view = harness().play(...guess("TEAM"), decode("BEAT"), ...guess("BEST"), decode("BUSY"));
    assert.deepEqual(
      view.tried.map((tried) => tried.word),
      ["BEAT", "BUSY"],
    );
  });

  describe("rejects a malformed or unlisted word without using the try", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["", "Type a 4-letter word, A to Z"],
      ["BYT", "Type a 4-letter word, A to Z"],
      ["BYTES", "Type a 4-letter word, A to Z"],
      ["B4TE", "Type a 4-letter word, A to Z"],
      ["qxzj", "QXZJ isn't in the word list"],
    ];
    for (const [word, message] of cases) {
      it(`${JSON.stringify(word)}: "${message}"`, () => {
        const { play } = harness();
        const view = play(...guess("TEAM"), decode(word));
        assert.equal(view.message, message);
        assert.equal(view.messageIsError, true);
        assert.equal(view.wordAttemptDue, true);
        assert.deepEqual(view.tried, []);
        assert.equal(play(decode("BYTE")).message, "Solved", "the try is still there");
      });
    }
  });
});

/** The five wrong words played before row 6 by `atRowSix`. */
const FIRST_FIVE = ["TEAM", "BEAT", "BEST", "BUSY", "ABLE"];

/** Five rows guessed and missed, then row 6 scored: the final answer is due. */
function atRowSix(h = harness()): Harness {
  for (const word of FIRST_FIVE) {
    h.play(...guess(word), decode(word));
  }
  h.play(...guess("BITE"));
  return h;
}

describe("GameController: after row 6", () => {
  it("takes one last answer in the final-answer card", () => {
    const view = atRowSix().controller.view();
    assert.equal(view.wordAttemptDue, true);
    assert.equal(view.keypadEnabled, false);
    assert.equal(view.panel.badge, "Last try");
    assert.equal(view.status, HEX_LOCKED_STATUS);
    assert.equal(view.tried.length, 5);
  });

  it("ends the round on a wrong last answer with \"Out of rows\"", () => {
    const view = atRowSix().play(decode("BITE"));
    assert.equal(view.message, "Out of rows");
    assert.equal(view.messageIsError, false);
    assert.equal(view.status, "4-letter word · out of rows");
    assert.equal(view.wordAttemptDue, false);
    assert.equal(view.keypadEnabled, false);
    assert.equal(view.tried.length, 6);
  });

  it("still rejects an unlisted last answer without using it", () => {
    const view = atRowSix().play(decode("QXZJ"));
    assert.equal(view.message, "QXZJ isn't in the word list");
    assert.equal(view.wordAttemptDue, true);
  });

  it("solves on a right last answer", () => {
    assert.equal(atRowSix().play(decode("BYTE")).message, "Solved");
  });

  it("ignores every action but newRound once the round is over", () => {
    const { play, session } = atRowSix();
    play(decode("BITE"));
    const before = session.toState();
    const view = play(...type("42"), { type: "delete" }, { type: "enter" }, decode("BYTE"), { type: "init" });
    assert.deepEqual(session.toState(), before);
    assert.equal(view.message, "Out of rows");
  });
});

describe("GameController: the hex locks after row 6 (page 3)", () => {
  it('shows the lock status "Hex locked · all 6 rows used" once row 6 is scored', () => {
    const view = atRowSix().controller.view();
    assert.equal(view.hexLocked, true);
    assert.equal(view.status, "Hex locked · all 6 rows used");
  });

  it("disables the keypad, DEL and ENTER, keeping each key's mark for its colour", () => {
    const { controller, session } = atRowSix();
    const view = controller.view();
    assert.equal(view.keypadEnabled, false);
    assert.deepEqual(view.keys, keypad(session.round?.rows ?? []));
    assert.ok(view.keys.some((key) => key.mark === Right));
    assert.ok(view.keys.some((key) => key.mark === Absent));
  });

  it("keeps the scored tiles' marks while locked", () => {
    const view = atRowSix().controller.view();
    assert.ok(view.rows.every((row) => row.every((tile) => tile.state !== "empty" && tile.state !== "typed")));
  });

  it("isn't locked after row 5, the row before the last", () => {
    const h = harness();
    for (const word of FIRST_FIVE.slice(0, 4)) {
      h.play(...guess(word), decode(word));
    }
    const view = h.play(...guess("ABLE"));
    assert.equal(view.hexLocked, false);
    assert.equal(view.status, "4-letter word · row 5 of 6");
    assert.deepEqual(view.panel, DECODE_PANEL);
  });

  it("keeps typed hex, DEL and ENTER out of the locked grid", () => {
    const { play, session } = atRowSix();
    const before = session.toState();
    const view = play(...type("4259"), { type: "delete" }, { type: "enter" });
    assert.deepEqual(session.toState(), before);
    assert.equal(view.hexLocked, true);
  });

  it("announces the lock with row 6's marks, since the icon isn't read out", () => {
    const view = atRowSix().controller.view();
    assert.match(view.message, /^Row 6: \d right spot, \d wrong spot, \d not in word\. Hex locked: one final answer$/);
    assert.equal(view.messageIsError, false);
  });

  it("unlocks when the round ends", () => {
    for (const word of ["BYTE", "BITE"]) {
      const view = atRowSix().play(decode(word));
      assert.equal(view.hexLocked, false, word);
      assert.equal(view.keypadEnabled, false, word);
    }
  });

  it("isn't locked before the first round", () => {
    assert.equal(harness(undefined, false).controller.view().hexLocked, false);
  });

  it("decides the lock in one place, so the status line and the card always agree", () => {
    const views = [
      harness(undefined, false).controller.view(),
      harness().controller.view(),
      harness().play(...guess("TEAM")),
      atRowSix().controller.view(),
      atRowSix().play(decode("BITE")),
      atRowSix().play(decode("BYTE")),
    ];
    for (const view of views) {
      assert.equal(view.status === HEX_LOCKED_STATUS, view.hexLocked, view.status);
      assert.equal(view.panel === FINAL_PANEL, view.hexLocked, view.status);
    }
  });
});

describe("isHexLocked", () => {
  it("is true with all 6 rows used in any phase of an unfinished round", () => {
    for (const phase of ["guess", "answer", "final"] as const) {
      assert.equal(isHexLocked(phase, MAX_ROWS), true, phase);
    }
  });

  it("is false once the round is over, before any round, and with rows left", () => {
    assert.equal(isHexLocked("solved", MAX_ROWS), false);
    assert.equal(isHexLocked("failed", MAX_ROWS), false);
    assert.equal(isHexLocked(null, MAX_ROWS), false);
    assert.equal(isHexLocked("answer", MAX_ROWS - 1), false);
    assert.equal(isHexLocked("guess", 0), false);
  });
});

describe("GameController: the final-answer card (page 3)", () => {
  it('becomes the "Final answer" card with "Last try", "Decode the bytes above", Submit and "Type with your keyboard"', () => {
    const { panel } = atRowSix().controller.view();
    assert.deepEqual(panel, FINAL_PANEL);
    assert.equal(panel.heading, "Final answer");
    assert.equal(panel.badge, "Last try");
    assert.equal(panel.placeholder, "Decode the bytes above");
    assert.equal(panel.button, "Submit");
    assert.equal(panel.note, "Type with your keyboard");
  });

  it("lists the five tried words underneath, in order", () => {
    const view = atRowSix().controller.view();
    assert.deepEqual(
      view.tried.map((tried) => tried.word),
      FIRST_FIVE,
    );
  });

  it("is the page 1 decode panel on rows 1 to 5", () => {
    const { play } = harness();
    assert.deepEqual(play(...guess("TEAM")).panel, DECODE_PANEL);
    assert.equal(DECODE_PANEL.badge, "");
  });

  it("solves the round for the right final answer", () => {
    const { play, session } = atRowSix();
    const view = play(decode("byte"));
    assert.equal(session.round?.phase, "solved");
    assert.equal(view.message, "Solved");
    assert.equal(view.status, "4-letter word · solved");
    assert.deepEqual(view.tried.map((tried) => tried.word), FIRST_FIVE);
  });

  it("fails the round for a wrong listed final answer", () => {
    const { play, session } = atRowSix();
    const view = play(decode("BITE"));
    assert.equal(session.round?.phase, "failed");
    assert.equal(view.message, "Out of rows");
    assert.equal(view.tried.at(-1)?.word, "BITE");
  });

  describe("rejects a malformed or unlisted final answer in plain text, without using the last try", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["", "Type a 4-letter word, A to Z"],
      ["   ", "Type a 4-letter word, A to Z"],
      ["BYT", "Type a 4-letter word, A to Z"],
      ["BYTES", "Type a 4-letter word, A to Z"],
      ["B4TE", "Type a 4-letter word, A to Z"],
      ["<b>X</b>", "Type a 4-letter word, A to Z"],
      ["qxzj", "QXZJ isn't in the word list"],
    ];
    for (const [word, message] of cases) {
      it(`${JSON.stringify(word)}: "${message}"`, () => {
        const { play, session } = atRowSix();
        const view = play(decode(word));
        assert.equal(view.message, message);
        assert.equal(view.messageIsError, true);
        assert.equal(session.round?.phase, "final");
        assert.equal(session.round?.answers.length, FIRST_FIVE.length);
        assert.equal(view.hexLocked, true);
        assert.deepEqual(view.panel, FINAL_PANEL);
        assert.equal(view.tried.length, FIRST_FIVE.length);
        assert.equal(play(decode("BYTE")).message, "Solved", "the last try is still there");
      });
    }
  });
});

describe("GameController: roundFinished is posted exactly once", () => {
  /** A harness whose round is solved on row `rows` (1 to 6), the earlier rows missed. */
  function solvedOnRow(rows: number): Harness {
    const h = harness();
    for (const word of FIRST_FIVE.slice(0, rows - 1)) {
      h.play(...guess(word), decode(word));
    }
    h.play(...guess("BITE"), decode("BYTE"));
    return h;
  }

  for (let rows = 1; rows <= MAX_ROWS; rows++) {
    it(`posts once when the round is solved on row ${rows}`, () => {
      const { posts } = solvedOnRow(rows);
      assert.deepEqual(posts, [{ type: "roundFinished", solved: true, rowsUsed: rows, hintsUsed: false }]);
    });
  }

  it("posts once when the final answer is wrong and the round fails", () => {
    const { posts, play } = atRowSix();
    assert.deepEqual(posts, []);
    play(decode("BITE"));
    assert.deepEqual(posts, [{ type: "roundFinished", solved: false, rowsUsed: MAX_ROWS, hintsUsed: false }]);
  });

  it("posts nothing while the round is still going, rejected answers included", () => {
    const { posts, play } = atRowSix();
    play(decode("QXZJ"), decode(""), ...type("42"), { type: "enter" }, { type: "init" });
    assert.deepEqual(posts, []);
  });

  it("never posts again for the same round, whatever comes after", () => {
    const { posts, play } = solvedOnRow(2);
    play(decode("BYTE"), ...type("42"), { type: "delete" }, { type: "enter" }, { type: "init" });
    assert.equal(posts.length, 1);
  });

  it("records hints used", () => {
    const h = harness();
    h.session.round?.enableHints();
    h.play(...guess("BYTE"), decode("BYTE"));
    assert.deepEqual(h.posts, [{ type: "roundFinished", solved: true, rowsUsed: 1, hintsUsed: true }]);
  });

  it("sends exactly the fields the host accepts, and never the answer", () => {
    const { posts } = solvedOnRow(3);
    const [message] = posts;
    assert.ok(message);
    assert.deepEqual(parseWebviewMessage(JSON.parse(JSON.stringify(message))), message);
    assert.deepEqual(Object.keys(message).sort(), ["hintsUsed", "rowsUsed", "solved", "type"]);
    assert.doesNotMatch(JSON.stringify(posts), /BYTE/);
  });

  it("posts once more for the next round, after New Round replaces a finished one", () => {
    const { posts, play } = solvedOnRow(1);
    play({ type: "newRound" });
    assert.equal(posts.length, 1, "starting the new round posts nothing");
    play(...guess("BYTE"), decode("BYTE"));
    assert.equal(posts.length, 2);
  });

  it("is already marked as reported in the save that comes with the post", () => {
    const { saves } = solvedOnRow(1);
    assert.equal((saves.at(-1) as SessionState).reported, true);
    assert.equal((saves.at(-2) as SessionState).reported, false);
  });
});

describe("GameController: New Round replacing an unfinished round", () => {
  const unfinished: readonly (readonly [string, () => Harness])[] = [
    ["a fresh round", () => harness()],
    ["a half-typed row", () => {
      const h = harness();
      h.play(...type("4259"));
      return h;
    }],
    ["a word attempt due", () => {
      const h = harness();
      h.play(...guess("TEAM"));
      return h;
    }],
    ["the final answer due", () => atRowSix()],
  ];
  for (const [name, make] of unfinished) {
    it(`posts no roundFinished: ${name}`, () => {
      const { posts, play } = make();
      play({ type: "newRound" }, { type: "newRound" });
      assert.deepEqual(posts, []);
    });
  }
});

describe("GameController: restoring a finished round after a hide or reload", () => {
  /** Reloads the webview from the last save, like media/main.ts, and sends `init`. */
  function reload(h: Harness): Harness {
    return harness(restoreSession(h.saves.at(-1), WORDS), true);
  }

  it("doesn't post roundFinished again for a solved round", () => {
    const before = harness();
    before.play(...guess("BYTE"), decode("BYTE"));
    assert.equal(before.posts.length, 1);
    const after = reload(before);
    after.play(decode("BYTE"), { type: "init" });
    assert.deepEqual(after.posts, []);
    assert.equal(after.controller.view().message, "Solved");
  });

  it("doesn't post roundFinished again for a failed round, over several reloads", () => {
    const before = atRowSix();
    before.play(decode("BITE"));
    let h = before;
    for (let i = 0; i < 3; i++) {
      h = reload(h);
      assert.deepEqual(h.posts, [], `reload ${i + 1}`);
    }
  });

  it("posts once when a round restored at the final answer is finished", () => {
    const after = reload(atRowSix());
    assert.equal(after.controller.view().hexLocked, true);
    assert.deepEqual(after.posts, []);
    after.play(decode("BYTE"));
    assert.deepEqual(after.posts, [{ type: "roundFinished", solved: true, rowsUsed: MAX_ROWS, hintsUsed: false }]);
    assert.deepEqual(reload(after).posts, []);
  });

  it("posts a restored finished round that was saved as not yet reported, once", () => {
    // `dispatch` always saves `reported: true` with the post, so this state
    // only comes from outside. The round was never counted, so it's counted now.
    const before = harness();
    before.play(...guess("BYTE"), decode("BYTE"));
    const saved = { ...(before.saves.at(-1) as SessionState), reported: false };
    const after = harness(restoreSession(saved, WORDS), true);
    assert.equal(after.posts.length, 1);
    after.play({ type: "init" });
    assert.equal(after.posts.length, 1);
  });
});

describe("GameController: new round", () => {
  it("starts an empty grid and clears the draft, Tried and the message", () => {
    const { play, session } = harness();
    const view = play(...guess("TEAM"), decode("BEAT"), ...type("4"), { type: "enter" }, { type: "newRound" });
    assert.equal(session.roundNumber, 2);
    assert.equal(view.message, "");
    assert.deepEqual(view.tried, []);
    assert.ok(view.rows.every((row) => row.every((tile) => tile.state === "empty")));
    assert.ok(view.keys.every((key) => key.mark === null));
  });

  it("init keeps a round that is already there", () => {
    const { play, session } = harness();
    play(...type("42"), { type: "init" });
    assert.equal(session.roundNumber, 1);
    assert.equal(session.draft, "42");
  });
});

describe("GameController: every action saves", () => {
  // A mapped type: the compiler fails here if an action type has no sample.
  const samples: { readonly [T in ActionType]: Extract<Action, { type: T }> } = {
    init: { type: "init" },
    newRound: { type: "newRound" },
    digit: { type: "digit", digit: "4" },
    delete: { type: "delete" },
    enter: { type: "enter" },
    decode: { type: "decode", word: "BEAT" },
  };

  for (const action of Object.values(samples)) {
    it(`"${action.type}" ends with changed(), which saves the state after it`, () => {
      const { controller, saves } = harness();
      // Set up a state where the action does something.
      if (action.type === "delete" || action.type === "enter") {
        controller.dispatch({ type: "digit", digit: "4" });
      }
      if (action.type === "decode") {
        for (const setup of guess("TEAM")) {
          controller.dispatch(setup);
        }
      }
      const before = saves.length;
      controller.dispatch(action);
      assert.equal(saves.length, before + 1, "changed() ran exactly once");
      assert.deepEqual(saves.at(-1), JSON.parse(JSON.stringify(controller.savedState())));
    });
  }

  it("saves the move itself, so a reload sees it", () => {
    const { play, saves } = harness();
    play(...type("42"));
    assert.equal((saves.at(-1) as SessionState).draft, "42");
    play(...type("595445"), { type: "enter" });
    assert.equal((saves.at(-1) as SessionState).round.rows.length, 1);
    play(decode("BEAT"));
    assert.deepEqual((saves.at(-1) as SessionState).round.answers, ["BEAT"]);
  });

  it("also ends with changed() for an action that was ignored or rejected", () => {
    const { controller, saves } = harness();
    for (const action of [{ type: "delete" }, { type: "enter" }, decode("BEAT"), { type: "digit", digit: "G" }] as const) {
      const before = saves.length;
      controller.dispatch(action);
      assert.equal(saves.length, before + 1, action.type);
    }
  });

  describe("every final-answer action ends with changed()", () => {
    const actions: readonly (readonly [string, Action])[] = [
      ["the right final answer", decode("BYTE")],
      ["a wrong final answer", decode("BITE")],
      ["an unlisted final answer", decode("QXZJ")],
      ["a malformed final answer", decode("B4")],
      ["a hex digit on the locked keypad", { type: "digit", digit: "4" }],
      ["DEL on the locked keypad", { type: "delete" }],
      ["ENTER on the locked keypad", { type: "enter" }],
      ["init", { type: "init" }],
      ["New Round", { type: "newRound" }],
    ];
    for (const [name, action] of actions) {
      it(name, () => {
        const { controller, saves } = atRowSix();
        const before = saves.length;
        controller.dispatch(action);
        assert.equal(saves.length, before + 1, "changed() ran exactly once");
        assert.deepEqual(saves.at(-1), JSON.parse(JSON.stringify(controller.savedState())));
      });
    }
  });

  it("saves nothing before the first round, but still calls changed()", () => {
    const { controller, saves } = harness(undefined, false);
    controller.dispatch({ type: "digit", digit: "4" });
    assert.deepEqual(saves, [null]);
  });
});

describe("GameController: hiding and showing the panel", () => {
  /** Saves like media/main.ts, then reloads the webview from what was saved. */
  function reload(h: Harness): Harness {
    const saved = h.saves.at(-1);
    return harness(restoreSession(saved, WORDS), true);
  }

  /** The view without the transient message, which isn't saved. */
  function lasting(view: ScreenView): Omit<ScreenView, "message"> {
    const { message: _message, ...rest } = view;
    return rest;
  }

  const states: readonly (readonly [string, Action[]])[] = [
    ["a half-typed row", [...type("4259")]],
    ["a full row not yet entered", [...type("42595445")]],
    ["a word attempt due", [...guess("TEAM")]],
    ["Tried words and a half-typed row", [...guess("TEAM"), decode("BEAT"), ...guess("BEST"), decode("BUSY"), ...type("5")]],
    ["the last try due", [...["TEAM", "BEAT", "BEST", "BUSY", "ABLE"].flatMap((w) => [...guess(w), decode(w)]), ...guess("BITE")]],
  ];
  for (const [name, actions] of states) {
    it(`brings back rows, marks, keys, Tried, the draft and the phase: ${name}`, () => {
      const before = harness();
      const view = before.play(...actions);
      assert.deepEqual(lasting(reload(before).controller.view()), lasting(view));
    });
  }

  it("brings back Solved and Out of rows, which come from the phase", () => {
    const solved = harness();
    solved.play(...guess("TEAM"), decode("BYTE"));
    assert.equal(reload(solved).controller.view().message, "Solved");
  });
});

describe("keypad", () => {
  it("leaves keys unmarked before any row", () => {
    assert.ok(keypad([]).every((key) => key.mark === null && key.label === key.digit));
  });

  it("shows each digit's best mark: right, then wrong spot, then absent", () => {
    const rows = [
      // Digit 4 is absent here, wrong in row 2 and right in row 3: it ends right.
      { hex: "4A", word: "", marks: [Absent, Absent] },
      { hex: "B4", word: "", marks: [Wrong, Wrong] },
      { hex: "4C", word: "", marks: [Right, Absent] },
      // C was absent first, then wrong: it ends wrong, never back to absent.
      { hex: "CA", word: "", marks: [Wrong, Absent] },
    ];
    const keys = new Map(keypad(rows).map((key) => [key.digit, key]));
    assert.equal(keys.get("4")?.mark, Right);
    assert.equal(keys.get("B")?.mark, Wrong);
    assert.equal(keys.get("C")?.mark, Wrong);
    assert.equal(keys.get("A")?.mark, Absent);
    assert.equal(keys.get("0")?.mark, null);
  });

  it("names each key's mark in its accessible label", () => {
    const keys = new Map(keypad([{ hex: "123", word: "", marks: [Right, Wrong, Absent] }]).map((key) => [key.digit, key]));
    assert.equal(keys.get("1")?.label, "1, Right spot");
    assert.equal(keys.get("2")?.label, "2, Wrong spot");
    assert.equal(keys.get("3")?.label, "3, Not in word");
    assert.equal(keys.get("4")?.label, "4");
  });

  it("marks keys from a real scored row", () => {
    const view = harness().play(...guess("TEAM"));
    const marks = new Map(view.keys.map((key) => [key.digit, key.mark]));
    // TEAM 54 45 41 4D against BYTE 42 59 54 45.
    assert.equal(marks.get("5"), Wrong);
    assert.equal(marks.get("4"), Right);
    assert.equal(marks.get("1"), Absent);
    assert.equal(marks.get("D"), Absent);
    assert.equal(marks.get("0"), null);
    assert.equal(HEX_DIGITS.length, 16);
  });
});

describe("actionForKey", () => {
  const press = (key: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  });

  it("maps 0–9, a–f and A–F to uppercase digits", () => {
    for (const key of [..."0123456789abcdefABCDEF"]) {
      assert.deepEqual(actionForKey(press(key), "page"), { type: "digit", digit: key.toUpperCase() });
    }
  });

  it("maps Backspace to DEL and Enter to ENTER", () => {
    assert.deepEqual(actionForKey(press("Backspace"), "page"), { type: "delete" });
    assert.deepEqual(actionForKey(press("Enter"), "page"), { type: "enter" });
  });

  it("leaves every key to the decode box while it has focus", () => {
    for (const key of ["4", "a", "Backspace", "Enter"]) {
      assert.equal(actionForKey(press(key), "decodeBox"), null, key);
    }
  });

  it("leaves Enter to a focused button, but still takes digits and Backspace", () => {
    assert.equal(actionForKey(press("Enter"), "control"), null);
    assert.deepEqual(actionForKey(press("Backspace"), "control"), { type: "delete" });
    assert.deepEqual(actionForKey(press("7"), "control"), { type: "digit", digit: "7" });
  });

  it("ignores other keys and shortcuts with Ctrl, Cmd or Alt", () => {
    for (const key of ["g", "G", " ", "Tab", "Delete", "Escape", "ArrowLeft", "F1", "10"]) {
      assert.equal(actionForKey(press(key), "page"), null, key);
    }
    assert.equal(actionForKey(press("c", { ctrlKey: true }), "page"), null);
    assert.equal(actionForKey(press("a", { metaKey: true }), "page"), null);
    assert.equal(actionForKey(press("Enter", { altKey: true }), "page"), null);
  });
});

describe("shouldFocusDecodeBox", () => {
  const press = (key: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  });

  it("sends letters typed outside the box to it while a word attempt is due, so `beat` isn't lost", () => {
    // `t`, `o`, `m`, `s` aren't hex, so without this they would be dropped.
    for (const key of [..."toms", ..."beat", "B", "4", "é", "-"]) {
      assert.equal(shouldFocusDecodeBox(press(key), "page", true), true, key);
      assert.equal(shouldFocusDecodeBox(press(key), "control", true), true, key);
    }
  });

  it("does nothing when the box already has focus", () => {
    assert.equal(shouldFocusDecodeBox(press("b"), "decodeBox", true), false);
  });

  it("does nothing while a hex row is being typed", () => {
    for (const key of ["b", "t", "4"]) {
      assert.equal(shouldFocusDecodeBox(press(key), "page", false), false, key);
    }
  });

  it("leaves named keys and shortcuts alone", () => {
    for (const key of ["Enter", "Tab", "Backspace", "Escape", "ArrowLeft", "F5", "Shift", "Dead"]) {
      assert.equal(shouldFocusDecodeBox(press(key), "page", true), false, key);
    }
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      assert.equal(shouldFocusDecodeBox(press("c", { [modifier]: true }), "page", true), false, modifier);
    }
  });

  it("leaves a space to a focused button, but takes it from the page", () => {
    assert.equal(shouldFocusDecodeBox(press(" "), "control", true), false);
    assert.equal(shouldFocusDecodeBox(press(" "), "page", true), true);
  });
});

describe("messages", () => {
  it("explains each kind of rejected hex row", () => {
    assert.equal(guessMessage("length", "42"), "Not enough digits");
    assert.equal(guessMessage("notHex", "4259544G"), "Use only the digits 0–9 and A–F");
    assert.equal(guessMessage("notLetter", "4259547B"), "7B isn't a letter");
    assert.equal(guessMessage("notWord", wordToHex("QXZJ")), "QXZJ isn't in the word list");
  });

  it("counts every mark in a scored row, zeros included", () => {
    assert.equal(scoredMessage(1, new Array(8).fill(Absent)), "Row 1: 0 Right spot, 0 Wrong spot, 8 Not in word");
    assert.equal(
      scoredMessage(6, [Right, Wrong, Absent, Right, Wrong, Absent, Right, Right]),
      "Row 6: 4 Right spot, 2 Wrong spot, 2 Not in word",
    );
  });

  it("finds the first byte that isn't a capital letter", () => {
    assert.equal(firstNonLetterByte("00595445"), "00");
    assert.equal(firstNonLetterByte("4159545B"), "5B");
    assert.equal(firstNonLetterByte("41"), null);
    assert.equal(firstNonLetterByte("415A"), null);
    assert.equal(firstNonLetterByte("4G"), "4G");
  });

  it("shows the status line for each phase", () => {
    assert.equal(statusLine(null, 0), "4-letter word");
    assert.equal(statusLine("guess", 0), "4-letter word · row 1 of 6");
    assert.equal(statusLine("guess", 5), "4-letter word · row 6 of 6");
    assert.equal(statusLine("answer", 3), "4-letter word · row 3 of 6");
    assert.equal(statusLine("final", 6), "Hex locked · all 6 rows used");
    assert.equal(statusLine("solved", 2), "4-letter word · solved");
    assert.equal(statusLine("failed", 6), "4-letter word · out of rows");
  });

  it("keys the locked status line off all 6 rows used and the round not over, not the phase name", () => {
    // So it still holds if a later story lets row 6 end in another phase.
    for (const phase of ["guess", "answer", "final"] as const) {
      assert.equal(statusLine(phase, MAX_ROWS), HEX_LOCKED_STATUS, phase);
    }
    assert.equal(statusLine("solved", MAX_ROWS), "4-letter word · solved");
  });
});
