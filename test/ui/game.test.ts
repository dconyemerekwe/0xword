import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wordToHex } from "../../src/game/hex.ts";
import { MAX_HINTS, MAX_ROWS } from "../../src/game/round.ts";
import { Mark } from "../../src/game/score.ts";
import { Session, restoreSession, type SessionState } from "../../src/game/session.ts";
import { parseWebviewMessage, type RoundFinishedMessage } from "../../src/protocol.ts";
import {
  AGENT_FINISHED_MESSAGE,
  DECODE_LOCKED_MESSAGE,
  DECODE_LOCKED_TITLE,
  DECODE_PANEL,
  FAILED_OUTCOME,
  APPLIES_WHILE_HOW_TO_PLAY_OPEN,
  FINAL_ANSWER_DUE,
  FINAL_PANEL,
  GameController,
  HEX_DIGITS,
  HEX_LOCKED_STATUS,
  HEX_SOLVED_DUE,
  HEX_SOLVED_STATUS,
  HINTS_BUTTON,
  HINTS_LOCKED_NOTE,
  HINT_UNKNOWN,
  NEW_ROUND_ANNOUNCEMENT,
  NEW_ROUND_BUTTON,
  NOT_DECODED_MESSAGE,
  OUT_OF_ROWS_MESSAGE,
  RESULT_NOTE,
  SOLVED_MESSAGE,
  SOLVED_OUTCOME,
  actionForKey,
  answerMessage,
  bytePairs,
  failedMessage,
  firstNonLetterByte,
  guessMessage,
  hintsUsedText,
  hintsView,
  howToPlayActionForKey,
  isHexLocked,
  keypad,
  resultView,
  scoredMessage,
  shouldFocusDecodeBox,
  statusLine,
  type Action,
  type ActionType,
  type HintsView,
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

const toggleHints: Action = { type: "toggleHints" };

/** DEL for each digit of a full row: clears the draft, such as a rejected row's digits. */
const CLEAR_ROW: readonly Action[] = Array.from({ length: 8 }, (): Action => ({ type: "delete" }));

/**
 * Six different listed words that aren't BYTE, one per row: a row can't be
 * scored twice in a round. None is fully right; BITE has 7 of 8 digits right.
 */
const ROW_WORDS = ["TEAM", "BEAT", "BEST", "BUSY", "ABLE", "BITE"];

/** The digits of one grid row as a string, e.g. "4259". */
function rowDigits(view: ScreenView, row: number): string {
  return (view.rows[row] ?? []).map((tile) => tile.digit).join("");
}

function rowStates(view: ScreenView, row: number): string[] {
  return (view.rows[row] ?? []).map((tile) => tile.state);
}

/** All six ROW_WORDS scored, none fully right: the decode step after row 6. */
function atRowSix(h = harness()): Harness {
  for (const word of ROW_WORDS) {
    h.play(...guess(word));
  }
  return h;
}

/** Row `row` (1 to 6) is BYTE, fully right, after `row - 1` of ROW_WORDS: the decode step after a solved grid. */
function solvedGridAt(row: number, h = harness()): Harness {
  for (const word of ROW_WORDS.slice(0, row - 1)) {
    h.play(...guess(word));
  }
  h.play(...guess("BYTE"));
  return h;
}

/** Misses `missed` rows (0 to 5), solves the grid on the next row and decodes BYTE. */
function solvedAfter(missed: number, h = harness()): Harness {
  solvedGridAt(missed + 1, h).play(decode("BYTE"));
  return h;
}

/** Plays every row and gets the final answer wrong. */
function failed(h = harness()): Harness {
  atRowSix(h).play(decode("BITE"));
  return h;
}

/** Reloads the webview from the last save, like media/main.ts, and sends `init`. */
function reloaded(h: Harness): Harness {
  return harness(restoreSession(h.saves.at(-1), WORDS), true);
}

/** The Hints view while the hex is locked: off, locked, no strip. */
const LOCKED_HINTS: HintsView = { available: true, locked: true, on: false, cells: [], label: "" };

/** The Hints view while off and unlocked. */
const OFF_HINTS: HintsView = { available: true, locked: false, on: false, cells: [], label: "" };

/** The Hints view once the round is over, or before it starts: hidden. */
const HIDDEN_HINTS: HintsView = { available: false, locked: false, on: false, cells: [], label: "" };

/** The hint strip as page 2 draws it, e.g. "B ? T E"; "" while hints are off. */
function strip(view: ScreenView): string {
  return view.hints.cells.map((cell) => cell.text).join(" ");
}

describe("GameController: the page 1 layout model", () => {
  it("has 6 rows of 8 empty tiles, 16 keys and row 1 of 6 at the start, with the decode panel locked", () => {
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
    assert.equal(view.decodeAvailable, false);
    assert.equal(view.decodeLocked, true);
    assert.equal(view.hexLocked, false);
    assert.equal(view.outOfRows, false);
    assert.deepEqual(view.panel, DECODE_PANEL);
    assert.equal(view.message, "");
    assert.equal(view.announcement, "");
  });

  it('has no "1 try per row" text in either panel', () => {
    for (const panel of [DECODE_PANEL, FINAL_PANEL]) {
      assert.doesNotMatch(JSON.stringify(panel), /try per row/i);
    }
    assert.equal(DECODE_PANEL.note, "");
  });

  it("shows nothing playable before init, with the decode panel locked", () => {
    const view = harness(undefined, false).controller.view();
    assert.equal(view.status, "4-letter word");
    assert.equal(view.keypadEnabled, false);
    assert.equal(view.decodeAvailable, false);
    assert.equal(view.decodeLocked, true);
  });

  it("never puts the answer in the model while the round is in progress, the decode step included", () => {
    const { play } = harness();
    const views = [play(), play(...guess("TEAM")), play(...type("4259")), play(...CLEAR_ROW, ...guess("BYTE"))];
    assert.equal(views.at(-1)?.hexLocked, true);
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

  it("shows no message for a scored row: the tile colours show the marks", () => {
    const view = harness().play(...guess("TEAM"));
    assert.equal(view.message, "");
    assert.equal(view.messageIsError, false);
  });

  it("announces the scored row's marks in words to screen readers only", () => {
    const view = harness().play(...guess("TEAM"));
    assert.equal(view.announcement, "Row 1: 1 Right spot, 4 Wrong spot, 3 Not in word");
  });

  it("numbers the announcement with the row just scored", () => {
    const view = harness().play(...guess("TEAM"), ...guess("BEAT"));
    assert.match(view.announcement, /^Row 2: /);
    assert.equal(view.message, "");
  });

  it("clears an earlier error once the next row is scored", () => {
    const { play } = harness();
    assert.equal(play(...type("4"), { type: "enter" }).message, "Not enough digits");
    const view = play({ type: "delete" }, ...guess("TEAM"));
    assert.equal(view.message, "");
    assert.equal(view.messageIsError, false);
  });

  it("marks every tile right for the answer's own hex", () => {
    const view = harness().play(...guess("BYTE"));
    assert.deepEqual(rowStates(view, 0), new Array(8).fill(Right));
  });

  describe("rejects an invalid row without using it, keeping its digits and the decode panel locked", () => {
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
        assert.equal(view.decodeAvailable, false);
        assert.equal(view.decodeLocked, true);
      });
    }
  });

  it('rejects a hex guess already scored with "You\'ve already tried 54 45 41 4D", keeping its digits and using no row', () => {
    const { play, session } = harness();
    const view = play(...guess("TEAM"), ...guess("TEAM"));
    assert.equal(view.message, "You've already tried 54 45 41 4D");
    assert.equal(view.messageIsError, true);
    assert.equal(session.round?.rows.length, 1);
    assert.equal(rowDigits(view, 1), wordToHex("TEAM"));
    assert.deepEqual(rowStates(view, 1), new Array(8).fill("typed"));
    assert.equal(view.keypadEnabled, true);
  });

  it("names a repeat typed in lowercase in uppercase byte pairs", () => {
    const { play, session } = harness();
    const view = play(...guess("TEAM"), ...type("5445414d"), { type: "enter" });
    assert.equal(view.message, "You've already tried 54 45 41 4D");
    assert.equal(session.round?.rows.length, 1);
  });
});

describe("GameController: the decode panel is locked until the hex locks (#46)", () => {
  it('locks it with "Locked until you crack the hex row" and "Get every tile blue to unlock Decode."', () => {
    assert.equal(DECODE_LOCKED_TITLE, "Locked until you crack the hex row");
    assert.equal(DECODE_LOCKED_MESSAGE, "Get every tile blue to unlock Decode.");
  });

  for (let rows = 0; rows < MAX_ROWS; rows++) {
    it(`is locked after ${rows} rows that aren't fully right, with the keypad still on`, () => {
      const { play } = harness();
      let view = play();
      for (const word of ROW_WORDS.slice(0, rows)) {
        view = play(...guess(word));
      }
      assert.equal(view.decodeLocked, true);
      assert.equal(view.decodeAvailable, false);
      assert.equal(view.keypadEnabled, true);
      assert.equal(view.hexLocked, false);
      assert.deepEqual(view.panel, DECODE_PANEL);
      assert.equal(view.status, `4-letter word · row ${rows + 1} of 6`);
    });
  }

  it("stays locked after a row with 7 of 8 tiles in the right spot", () => {
    // BITE = 42 49 54 45 against BYTE = 42 59 54 45.
    const view = harness().play(...guess("BITE"));
    assert.equal(view.decodeLocked, true);
    assert.equal(view.hexLocked, false);
  });

  it("ignores a word while locked, from the start and between rows, changing nothing but saving through changed()", () => {
    const { controller, play, session, saves } = harness();
    for (const setup of [[], guess("TEAM"), type("42")]) {
      play(...setup);
      const before = session.toState();
      const count = saves.length;
      const view = play(decode("BYTE"));
      assert.deepEqual(session.toState(), before);
      assert.equal(saves.length, count + 1);
      assert.equal(view.message, "");
      assert.equal(view.decodeLocked, true);
      assert.equal(session.round?.attempt, null);
    }
    assert.equal(controller.view().rows[1]?.[0]?.digit, "4", "the draft is kept");
  });

  it("scores the next row straight away: there's no word to try first", () => {
    const { play, session } = harness();
    const view = play(...guess("TEAM"), ...type("42597"), { type: "delete" });
    assert.equal(rowDigits(view, 1), "4259");
    play(...type("5445"), { type: "enter" });
    assert.equal(session.round?.rows.length, 2);
  });
});

describe("GameController: unlocking on a solved grid (#46, page L3)", () => {
  for (const row of [1, 3, 6]) {
    it(`locks the hex and unlocks the decode panel when row ${row} is fully right`, () => {
      const view = solvedGridAt(row).controller.view();
      assert.equal(view.hexLocked, true);
      assert.equal(view.keypadEnabled, false);
      assert.equal(view.decodeAvailable, true);
      assert.equal(view.decodeLocked, false);
      assert.deepEqual(view.panel, FINAL_PANEL, "the page 3 card is the highlight");
      assert.equal(view.status, "4-letter word · hex solved");
      assert.equal(view.status, HEX_SOLVED_STATUS);
      assert.equal(view.outOfRows, false, "no lock icon and no dimmed grid (page L3)");
    });
  }

  it("announces the unlock with the row's marks, since the card and the dimming aren't read out", () => {
    const view = solvedGridAt(3).controller.view();
    assert.equal(view.announcement, `Row 3: 8 Right spot, 0 Wrong spot, 0 Not in word. ${HEX_SOLVED_DUE}`);
    assert.equal(view.message, "");
  });

  it("keeps the solved row's tiles and the earlier rows' marks", () => {
    const view = solvedGridAt(2).controller.view();
    assert.deepEqual(rowStates(view, 1), new Array(8).fill(Right));
    assert.deepEqual(rowStates(view, 2), new Array(8).fill("empty"));
  });

  it("keeps typed hex, DEL and ENTER out of the locked grid", () => {
    const { play, session } = solvedGridAt(2);
    const before = session.toState();
    const view = play(...type("4259"), { type: "delete" }, { type: "enter" });
    assert.deepEqual(session.toState(), before);
    assert.equal(view.hexLocked, true);
  });

  it("saves the lock with the ENTER that scored the row, through changed()", () => {
    const { controller, play, saves } = harness();
    play(...type(wordToHex("BYTE")));
    const before = saves.length;
    controller.dispatch({ type: "enter" });
    assert.equal(saves.length, before + 1, "changed() ran exactly once");
    const saved = saves.at(-1) as SessionState;
    assert.equal(saved.round.phase, "decode");
    assert.equal(saved.draft, "");
  });
});

describe("GameController: unlocking after row 6 (page 3)", () => {
  it('locks the hex with "Hex locked · all 6 rows used", the lock icon and the dimmed grid', () => {
    const view = atRowSix().controller.view();
    assert.equal(view.hexLocked, true);
    assert.equal(view.outOfRows, true);
    assert.equal(view.status, HEX_LOCKED_STATUS);
    assert.equal(view.status, "Hex locked · all 6 rows used");
    assert.equal(view.keypadEnabled, false);
    assert.equal(view.decodeAvailable, true);
    assert.equal(view.decodeLocked, false);
    assert.deepEqual(view.panel, FINAL_PANEL);
  });

  it("disables the keypad, DEL and ENTER, keeping each key's mark for its colour", () => {
    const { controller, session } = atRowSix();
    const view = controller.view();
    assert.deepEqual(view.keys, keypad(session.round?.rows ?? []));
    assert.ok(view.keys.some((key) => key.mark === Right));
    assert.ok(view.keys.some((key) => key.mark === Absent));
  });

  it("announces the lock with row 6's marks", () => {
    const view = atRowSix().controller.view();
    assert.match(view.announcement, new RegExp(`^Row 6: \\d Right spot, \\d Wrong spot, \\d Not in word\\. ${FINAL_ANSWER_DUE}$`));
    assert.equal(view.message, "");
  });

  it("isn't locked after row 5, the row before the last", () => {
    const h = harness();
    for (const word of ROW_WORDS.slice(0, 5)) {
      h.play(...guess(word));
    }
    const view = h.controller.view();
    assert.equal(view.hexLocked, false);
    assert.equal(view.status, "4-letter word · row 6 of 6");
    assert.equal(view.decodeLocked, true);
  });

  it("treats a fully right row 6 as a solved grid, not as out of rows", () => {
    const view = solvedGridAt(6).controller.view();
    assert.equal(view.status, HEX_SOLVED_STATUS);
    assert.equal(view.outOfRows, false);
  });

  it("unlocks when the round ends, and isn't locked before the first round", () => {
    for (const word of ["BYTE", "BITE"]) {
      const view = atRowSix().play(decode(word));
      assert.equal(view.hexLocked, false, word);
      assert.equal(view.outOfRows, false, word);
      assert.equal(view.keypadEnabled, false, word);
    }
    assert.equal(harness(undefined, false).controller.view().hexLocked, false);
  });

  it("decides the lock in one place, so the status line, the card and the keypad always agree", () => {
    const views = [
      harness(undefined, false).controller.view(),
      harness().controller.view(),
      harness().play(...guess("TEAM")),
      solvedGridAt(2).controller.view(),
      atRowSix().controller.view(),
      atRowSix().play(decode("BITE")),
      solvedAfter(1).controller.view(),
    ];
    for (const view of views) {
      const locked = view.status === HEX_LOCKED_STATUS || view.status === HEX_SOLVED_STATUS;
      assert.equal(locked, view.hexLocked, view.status);
      assert.equal(view.panel === FINAL_PANEL, view.hexLocked, view.status);
      assert.equal(view.decodeAvailable, view.hexLocked, view.status);
      assert.equal(view.hints.locked, view.hexLocked, view.status);
    }
  });
});

describe("isHexLocked", () => {
  it("is true at the decode step only", () => {
    assert.equal(isHexLocked("decode"), true);
    for (const phase of ["guess", "solved", "failed", null] as const) {
      assert.equal(isHexLocked(phase), false, String(phase));
    }
  });
});

describe("GameController: the final-answer card (pages 3 and L3)", () => {
  it('is the "Final answer" card with "Last try", "Decode the bytes above", Submit and "Type with your keyboard"', () => {
    for (const h of [atRowSix(), solvedGridAt(4)]) {
      const { panel } = h.controller.view();
      assert.deepEqual(panel, FINAL_PANEL);
      assert.equal(panel.heading, "Final answer");
      assert.equal(panel.badge, "Last try");
      assert.equal(panel.placeholder, "Decode the bytes above");
      assert.equal(panel.button, "Submit");
      assert.equal(panel.note, "Type with your keyboard");
    }
  });

  it("keeps the placeholders unchanged, so the #33 cut-offs still hold", () => {
    assert.equal(DECODE_PANEL.placeholder, "Type the English word");
    assert.equal(FINAL_PANEL.placeholder, "Decode the bytes above");
  });
});

describe("GameController: one try at the decode step (#46)", () => {
  for (const word of ["BYTE", "byte", " Byte "]) {
    it(`solves the round for ${JSON.stringify(word)} after a solved grid, in any letter case`, () => {
      const view = solvedGridAt(2).play(decode(word));
      assert.equal(view.message, SOLVED_MESSAGE);
      assert.equal(view.messageIsError, false);
      assert.equal(view.status, "4-letter word · solved");
      assert.equal(view.keypadEnabled, false);
      assert.equal(view.decodeAvailable, false);
      assert.equal(view.result?.heading, "Decoded: BYTE");
    });
  }

  it("solves the round for the right word after row 6", () => {
    const view = atRowSix().play(decode("byte"));
    assert.equal(view.message, "Solved");
    assert.equal(view.result?.line, "6 of 6 rows attempted · 0 hints used");
  });

  it("fails the round for a wrong listed word after a solved grid, revealing the answer, with rows left", () => {
    const { play, session } = solvedGridAt(3);
    const view = play(decode("BITE"));
    assert.equal(session.round?.phase, "failed");
    assert.equal(view.message, NOT_DECODED_MESSAGE);
    assert.equal(NOT_DECODED_MESSAGE, "Not decoded");
    assert.equal(view.status, "4-letter word · not decoded");
    assert.equal(view.result?.outcome, FAILED_OUTCOME);
    assert.equal(view.result?.heading, "The word was BYTE");
    assert.equal(view.result?.line, "3 of 6 rows attempted · 0 hints used");
  });

  it('says "Not decoded" for a wrong word after a grid solved on row 6 too: the hex was solved', () => {
    const view = solvedGridAt(6).play(decode("CODE"));
    assert.equal(view.message, "Not decoded");
    assert.equal(view.status, "4-letter word · not decoded");
  });

  it('fails the round for a wrong listed word after row 6, saying "Out of rows"', () => {
    const view = atRowSix().play(decode("CODE"));
    assert.equal(view.message, OUT_OF_ROWS_MESSAGE);
    assert.equal(OUT_OF_ROWS_MESSAGE, "Out of rows");
    assert.equal(view.status, "4-letter word · out of rows");
    assert.equal(view.result?.heading, "The word was BYTE");
  });

  it("ignores every action but newRound once the try has ended the round", () => {
    const { play, session } = solvedGridAt(1);
    play(decode("BITE"));
    const before = session.toState();
    const view = play(...type("42"), { type: "delete" }, { type: "enter" }, decode("BYTE"), toggleHints, { type: "init" });
    assert.deepEqual(session.toState(), before);
    assert.equal(view.message, NOT_DECODED_MESSAGE);
  });
});

describe("GameController: rejected words at the decode step don't count (#46)", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["", "Type a 4-letter word, A to Z"],
    ["   ", "Type a 4-letter word, A to Z"],
    ["BYT", "Type a 4-letter word, A to Z"],
    ["BYTES", "Type a 4-letter word, A to Z"],
    ["B4TE", "Type a 4-letter word, A to Z"],
    ["<b>X</b>", "Type a 4-letter word, A to Z"],
    ["qxzj", "QXZJ isn't in the word list"],
  ];
  for (const [name, reach] of [
    ["after a solved grid", () => solvedGridAt(2)],
    ["after row 6", () => atRowSix()],
  ] as const) {
    for (const [word, message] of cases) {
      it(`${name}, ${JSON.stringify(word)}: "${message}", in plain text, staying at the decode step`, () => {
        const { play, session } = reach();
        const view = play(decode(word));
        assert.equal(view.message, message);
        assert.equal(view.messageIsError, true);
        assert.equal(session.round?.phase, "decode");
        assert.equal(session.round?.attempt, null);
        assert.equal(view.hexLocked, true);
        assert.equal(view.decodeAvailable, true);
        assert.deepEqual(view.panel, FINAL_PANEL);
        assert.equal(view.result, null);
        assert.equal(play(decode("BYTE")).message, "Solved", "the try is still there");
      });
    }
  }

  it("takes any number of rejected words before the try", () => {
    const { play, posts } = solvedGridAt(1);
    play(decode("QXZJ"), decode(""), decode("QXZJ"), decode("B4"));
    assert.deepEqual(posts, []);
    play(decode("CODE"));
    assert.deepEqual(posts, [{ type: "roundFinished", solved: false, rowsUsed: 1, answerTries: 1, hintsUsed: 0 }]);
  });

  it("has no repeat message for words: there's never a word before the try", () => {
    assert.doesNotMatch(answerMessage("format", ""), /already/);
    assert.doesNotMatch(answerMessage("notWord", "QXZJ"), /already/);
  });
});

describe("GameController: no Tried list (#46)", () => {
  it("has no Tried list in the view, in any phase", () => {
    const views = [
      harness().controller.view(),
      harness().play(...guess("TEAM")),
      solvedGridAt(2).controller.view(),
      solvedGridAt(2).play(decode("QXZJ")),
      atRowSix().controller.view(),
      failed().controller.view(),
      solvedAfter(2).controller.view(),
    ];
    for (const view of views) {
      assert.equal("tried" in view, false);
      assert.doesNotMatch(JSON.stringify(view), /Tried/);
    }
  });
});

describe("GameController: roundFinished is posted exactly once", () => {
  for (let rows = 1; rows <= MAX_ROWS; rows++) {
    it(`posts once when the round is solved after a solved grid on row ${rows}`, () => {
      const { posts } = solvedAfter(rows - 1);
      assert.deepEqual(posts, [{ type: "roundFinished", solved: true, rowsUsed: rows, answerTries: 1, hintsUsed: 0 }]);
    });
  }

  it("posts once when a wrong word fails a solved grid with rows left", () => {
    const { posts, play } = solvedGridAt(2);
    play(decode("CODE"));
    assert.deepEqual(posts, [{ type: "roundFinished", solved: false, rowsUsed: 2, answerTries: 1, hintsUsed: 0 }]);
  });

  it("posts once when the final answer is wrong after row 6", () => {
    const { posts, play } = atRowSix();
    assert.deepEqual(posts, []);
    play(decode("BITE"));
    assert.deepEqual(posts, [{ type: "roundFinished", solved: false, rowsUsed: MAX_ROWS, answerTries: 1, hintsUsed: 0 }]);
  });

  it("posts nothing while the round is still going, rejected answers included", () => {
    const { posts, play } = atRowSix();
    play(decode("QXZJ"), decode(""), ...type("42"), { type: "enter" }, { type: "init" });
    assert.deepEqual(posts, []);
  });

  it("never posts again for the same round, whatever comes after", () => {
    const { posts, play } = solvedAfter(1);
    play(decode("BYTE"), ...type("42"), { type: "delete" }, { type: "enter" }, { type: "init" });
    assert.equal(posts.length, 1);
  });

  it("sends exactly the fields the host accepts, and never the answer", () => {
    for (const h of [solvedAfter(2), failed(), (() => {
      const g = solvedGridAt(3);
      g.play(decode("CODE"));
      return g;
    })()]) {
      const [message] = h.posts;
      assert.ok(message);
      assert.deepEqual(parseWebviewMessage(JSON.parse(JSON.stringify(message))), message);
      assert.deepEqual(Object.keys(message).sort(), ["answerTries", "hintsUsed", "rowsUsed", "solved", "type"]);
      assert.doesNotMatch(JSON.stringify(h.posts), /BYTE/);
    }
  });

  it("posts once more for the next round, after New Round replaces a finished one", () => {
    const { posts, play } = solvedAfter(0);
    play({ type: "newRound" });
    assert.equal(posts.length, 1, "starting the new round posts nothing");
    play(...guess("BYTE"), decode("BYTE"));
    assert.equal(posts.length, 2);
  });

  it("is already marked as reported in the save that comes with the post", () => {
    const { saves } = solvedAfter(0);
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
    ["a scored row", () => {
      const h = harness();
      h.play(...guess("TEAM"));
      return h;
    }],
    ["the decode step after a solved grid", () => solvedGridAt(2)],
    ["the decode step after row 6", () => atRowSix()],
  ];
  for (const [name, make] of unfinished) {
    it(`posts no roundFinished: ${name}`, () => {
      const { posts, play } = make();
      play({ type: "newRound" }, { type: "newRound" });
      assert.deepEqual(posts, []);
    });
  }
});

describe("GameController: restoring a round after a hide or reload", () => {
  it("doesn't post roundFinished again for a solved round", () => {
    const before = solvedAfter(0);
    assert.equal(before.posts.length, 1);
    const after = reloaded(before);
    after.play(decode("BYTE"), { type: "init" });
    assert.deepEqual(after.posts, []);
    assert.equal(after.controller.view().message, "Solved");
  });

  it("doesn't post roundFinished again for a failed round, over several reloads", () => {
    let h = failed();
    for (let i = 0; i < 3; i++) {
      h = reloaded(h);
      assert.deepEqual(h.posts, [], `reload ${i + 1}`);
    }
  });

  for (const [name, reach, status] of [
    ["a solved grid", () => solvedGridAt(4), HEX_SOLVED_STATUS],
    ["row 6", () => atRowSix(), HEX_LOCKED_STATUS],
  ] as const) {
    it(`brings back the decode step after ${name}, with the Hints lock, and posts once when it's finished`, () => {
      const after = reloaded(reach());
      const view = after.controller.view();
      assert.equal(view.hexLocked, true);
      assert.equal(view.status, status);
      assert.deepEqual(view.hints, LOCKED_HINTS);
      assert.deepEqual(after.posts, []);
      after.play(decode("BYTE"));
      assert.equal(after.posts.length, 1);
      assert.deepEqual(reloaded(after).posts, []);
    });
  }

  it("posts a restored finished round that was saved as not yet reported, once", () => {
    // `dispatch` always saves `reported: true` with the post, so this state
    // only comes from outside. The round was never counted, so it's counted now.
    const before = solvedAfter(0);
    const saved = { ...(before.saves.at(-1) as SessionState), reported: false };
    const after = harness(restoreSession(saved, WORDS), true);
    assert.equal(after.posts.length, 1);
    after.play({ type: "init" });
    assert.equal(after.posts.length, 1);
  });
});

describe("GameController: new round", () => {
  it("starts an empty grid, locks the decode panel and clears the draft and the message", () => {
    const { play, session } = solvedGridAt(2);
    const view = play(decode("QXZJ"), { type: "newRound" });
    assert.equal(session.roundNumber, 2);
    assert.equal(view.message, "");
    assert.equal(view.decodeLocked, true);
    assert.equal(view.hexLocked, false);
    assert.deepEqual(view.hints, OFF_HINTS);
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

describe("GameController: open mode opening the panel (#111)", () => {
  const agentOpen: Action = { type: "agentOpen" };

  /** Rounds in progress, which `agentOpen` must leave exactly as they are. */
  const inProgress: readonly (readonly [string, () => Harness])[] = [
    ["a fresh round", () => harness()],
    ["a half-typed row", () => {
      const h = harness();
      h.play(...type("4259"));
      return h;
    }],
    ["a scored row", () => {
      const h = harness();
      h.play(...guess("TEAM"));
      return h;
    }],
    ["hints on", () => {
      const h = harness();
      h.play(...guess("BITE"), toggleHints);
      return h;
    }],
    ["a rejected row's message", () => {
      const h = harness();
      h.play(...type("41414141"), { type: "enter" });
      return h;
    }],
    ["the decode step after a solved grid", () => solvedGridAt(2)],
    ["the decode step after row 6", () => atRowSix()],
    ["a rejected word at the decode step", () => {
      const h = solvedGridAt(1);
      h.play(decode("QXZJ"));
      return h;
    }],
    ["a round restored after a reload", () => {
      const h = harness();
      h.play(...guess("TEAM"), ...type("42"));
      return reloaded(h);
    }],
    ["How to play open", () => {
      const h = harness();
      h.play(...guess("TEAM"), { type: "openHowToPlay" });
      return h;
    }],
  ];
  for (const [name, make] of inProgress) {
    it(`shows a round in progress untouched: ${name}`, () => {
      const h = make();
      const before = h.controller.view();
      const savedBefore = JSON.parse(JSON.stringify(h.controller.savedState()));
      const roundNumber = h.session.roundNumber;
      const view = h.play(agentOpen);
      assert.equal(h.session.roundNumber, roundNumber, "no new round");
      assert.deepEqual(h.saves.at(-1), savedBefore, "the same round, draft and message are saved");
      assert.deepEqual(view, before, "the screen is unchanged, message and announcement included");
      assert.deepEqual(h.posts, []);
    });
  }

  for (const [name, make] of [
    ["solved", () => solvedAfter(1)],
    ["failed", () => failed()],
    ["failed after a solved grid", () => {
      const h = solvedGridAt(2);
      h.play(decode("BITE"));
      return h;
    }],
    ["solved, restored after a reload", () => reloaded(solvedAfter(0))],
  ] as const) {
    it(`starts a new round from the ${name} result card, saved through changed()`, () => {
      const h = make();
      assert.notEqual(h.controller.view().result, null, "the result card shows");
      const posted = h.posts.length;
      const saves = h.saves.length;
      const roundNumber = h.session.roundNumber;
      const view = h.play(agentOpen);
      assert.equal(h.session.roundNumber, roundNumber + 1);
      assert.equal(view.result, null);
      assert.equal(view.status, "4-letter word · row 1 of 6");
      assert.ok(view.rows.every((row) => row.every((tile) => tile.state === "empty")));
      assert.equal(view.announcement, NEW_ROUND_ANNOUNCEMENT, "read out like New round");
      assert.equal(h.saves.length, saves + 1, "saved once, by changed()");
      const saved = h.saves.at(-1) as SessionState;
      assert.equal(saved.round.phase, "guess");
      assert.deepEqual(saved.round.rows, []);
      assert.equal(saved.reported, false);
      assert.equal(h.posts.length, posted, "posts no roundFinished");
    });
  }

  it("starts one new round from the result card, and leaves it alone on a second agentOpen", () => {
    const h = solvedAfter(0);
    h.play(agentOpen, ...type("42"), agentOpen);
    assert.equal(h.session.roundNumber, 2);
    assert.equal(h.session.draft, "42");
  });

  it("starts a new round behind How to play open over the result card", () => {
    const h = failed();
    const view = h.play({ type: "openHowToPlay" }, agentOpen);
    assert.equal(view.howToPlayOpen, true);
    assert.equal(view.result, null);
    assert.equal(h.session.roundNumber, 2);
  });

  it("starts the first round, unannounced, when no round has been played", () => {
    const h = harness(new Session(WORDS, answerIs("BYTE")), false);
    assert.equal(h.session.round, null);
    const view = h.play(agentOpen);
    assert.equal(h.session.roundNumber, 1);
    assert.equal(view.status, "4-letter word · row 1 of 6");
    assert.equal(view.announcement, "", "like init's first round");
    assert.equal((h.saves.at(-1) as SessionState).round.phase, "guess");
  });

  it("never starts a second round on a fresh panel: init then agentOpen", () => {
    const h = harness(new Session(WORDS, answerIs("BYTE")), false);
    h.play({ type: "init" }, agentOpen);
    assert.equal(h.session.roundNumber, 1);
  });

  it("never starts a second round on a fresh panel: agentOpen then init", () => {
    const h = harness(new Session(WORDS, answerIs("BYTE")), false);
    h.play(agentOpen, ...type("42"), { type: "init" });
    assert.equal(h.session.roundNumber, 1);
    assert.equal(h.session.draft, "42");
  });

  it("applies while How to play is open, like the host's other messages", () => {
    assert.equal(APPLIES_WHILE_HOW_TO_PLAY_OPEN.agentOpen, true);
  });
});

describe("GameController: the agent-finished message (#112)", () => {
  /** Rounds in progress: guessing, and both decode steps. */
  const inProgress: readonly (readonly [string, () => Harness])[] = [
    ["a fresh round", () => harness()],
    ["a half-typed row", () => {
      const h = harness();
      h.play(...guess("TEAM"), ...type("4259"));
      return h;
    }],
    ["hints on", () => {
      const h = harness();
      h.play(...guess("BITE"), toggleHints);
      return h;
    }],
    ["the last row to guess", () => {
      const h = harness();
      for (const word of ROW_WORDS.slice(0, MAX_ROWS - 1)) {
        h.play(...guess(word));
      }
      return h;
    }],
    ["the decode step after a solved grid", () => solvedGridAt(2)],
    ["the decode step after row 6", () => atRowSix()],
    ["a round restored after a reload", () => {
      const h = harness();
      h.play(...guess("TEAM"), ...type("42"));
      return reloaded(h);
    }],
  ];

  for (const [name, make] of inProgress) {
    it(`shows the message in its normal colour, with the round unchanged: ${name}`, () => {
      const h = make();
      const before = h.controller.view();
      const savedBefore = JSON.parse(JSON.stringify(h.controller.savedState()));
      const saves = h.saves.length;
      const roundNumber = h.session.roundNumber;
      const draft = h.session.draft;
      assert.equal(h.controller.agentFinished(), true);
      const view = h.controller.view();
      assert.equal(view.message, AGENT_FINISHED_MESSAGE);
      assert.equal(view.messageIsError, false, "not the error colour");
      assert.equal(view.announcement, "", "the message line itself is the polite live region");
      assert.equal(view.noticeId, before.noticeId + 1, "a new notice, so it's drawn");
      // Everything but the message line is as it was.
      assert.deepEqual(
        { ...view, message: "", messageIsError: false, announcement: "", noticeId: 0 },
        { ...before, message: "", messageIsError: false, announcement: "", noticeId: 0 },
      );
      assert.deepEqual(JSON.parse(JSON.stringify(h.controller.savedState())), savedBefore, "the session is unchanged");
      assert.equal(h.saves.length, saves, "not saved: changed() isn't called");
      assert.deepEqual(h.posts, [], "nothing posted");
      assert.equal(h.session.roundNumber, roundNumber);
      assert.equal(h.session.draft, draft);
    });
  }

  it("uses the owner's wording", () => {
    assert.equal(AGENT_FINISHED_MESSAGE, "Your agent has finished. Your round is still here.");
  });

  it("uses no row and counts no hint", () => {
    const h = harness();
    h.play(...guess("TEAM"), toggleHints);
    h.controller.agentFinished();
    const view = h.play(...guess("BYTE"), decode("BYTE"));
    assert.match(view.result?.line ?? "", /^2 of 6 rows attempted · 1 hint used$/);
  });

  for (const [name, make] of [
    ["solved", () => solvedAfter(1)],
    ["failed", () => failed()],
    ["failed after a solved grid", () => {
      const h = solvedGridAt(2);
      h.play(decode("BITE"));
      return h;
    }],
    ["solved, restored after a reload", () => reloaded(solvedAfter(0))],
  ] as const) {
    it(`shows nothing on the ${name} result card`, () => {
      const h = make();
      const before = h.controller.view();
      assert.notEqual(before.result, null, "the result card shows");
      assert.equal(h.controller.agentFinished(), false);
      assert.deepEqual(h.controller.view(), before);
    });
  }

  it("shows nothing before the first round (a fresh panel before init)", () => {
    const h = harness(new Session(WORDS, answerIs("BYTE")), false);
    const before = h.controller.view();
    assert.equal(h.controller.agentFinished(), false);
    assert.deepEqual(h.controller.view(), before);
    assert.equal(h.controller.savedState(), null, "no round was started");
    assert.equal(h.saves.length, 0);
  });

  it("replaces a rejected row's error, as a new error replaces an old one", () => {
    const h = harness();
    const rejected = h.play(...type("41414141"), { type: "enter" });
    assert.equal(rejected.messageIsError, true);
    h.controller.agentFinished();
    const view = h.controller.view();
    assert.equal(view.message, AGENT_FINISHED_MESSAGE);
    assert.equal(view.messageIsError, false);
    assert.equal(rejected.noticeId + 1, view.noticeId);
  });

  it("replaces a rejected word's error at the decode step", () => {
    const h = solvedGridAt(1);
    h.play(decode("QXZJ"));
    h.controller.agentFinished();
    assert.equal(h.controller.view().message, AGENT_FINISHED_MESSAGE);
    assert.equal(h.controller.view().messageIsError, false);
  });

  it("isn't saved: a reload drops it, and brings back the error it replaced", () => {
    const h = harness();
    h.play(...type("41414141"), { type: "enter" });
    const error = h.controller.view().message;
    h.controller.agentFinished();
    // A move that keeps the message, such as opening How to play, saves the session as it was.
    h.play({ type: "openHowToPlay" }, { type: "closeHowToPlay" });
    assert.equal(h.controller.view().message, AGENT_FINISHED_MESSAGE);
    const view = reloaded(h).controller.view();
    assert.equal(view.message, error);
    assert.equal(view.messageIsError, true);
  });

  it("isn't saved: a reload drops it from a round with no message", () => {
    const h = harness();
    h.play(...guess("TEAM"));
    h.controller.agentFinished();
    h.play({ type: "openHowToPlay" });
    assert.equal(reloaded(h).controller.view().message, "");
  });

  for (const [name, actions] of [
    ["a hex digit", type("4")],
    ["DEL", [{ type: "delete" }]],
    ["Hints", [toggleHints]],
  ] as const) {
    it(`clears on the next key, here ${name}, like other messages`, () => {
      const h = harness();
      h.play(...guess("TEAM"), ...type("42"));
      h.controller.agentFinished();
      const view = h.play(...actions);
      assert.equal(view.message, "");
      assert.equal(view.messageIsError, false);
    });
  }

  it("clears once a row is scored, which is read out as usual", () => {
    const h = harness();
    h.controller.agentFinished();
    const view = h.play(...guess("TEAM"));
    assert.equal(view.message, "");
    assert.match(view.announcement, /^Row 1: /);
  });

  it("gives way to a rejected row's error", () => {
    const h = harness();
    h.controller.agentFinished();
    const view = h.play(...type("41414141"), { type: "enter" });
    assert.equal(view.message, "AAAA isn't in the word list");
    assert.equal(view.messageIsError, true);
  });

  it("gives way to the decode step's announcement when the scored row solves the grid", () => {
    const h = harness();
    h.play(...guess("TEAM"));
    h.controller.agentFinished();
    const view = h.play(...guess("BYTE"));
    assert.equal(view.message, "");
    assert.match(view.announcement, new RegExp(`${HEX_SOLVED_DUE}$`));
  });

  it("gives way to the result once the one try ends the round", () => {
    const h = solvedGridAt(1);
    h.controller.agentFinished();
    const view = h.play(decode("BYTE"));
    assert.equal(view.message, SOLVED_MESSAGE);
    assert.notEqual(view.result, null);
  });

  it("stays through opening and closing How to play, and init on a round in progress", () => {
    const h = harness();
    h.play(...guess("TEAM"));
    h.controller.agentFinished();
    const noticeId = h.controller.view().noticeId;
    const view = h.play({ type: "openHowToPlay" }, { type: "closeHowToPlay" }, { type: "init" });
    assert.equal(view.message, AGENT_FINISHED_MESSAGE);
    assert.equal(view.noticeId, noticeId, "not a new notice, so it isn't read out again");
  });

  for (const [name, make] of [
    ["mid-guess", () => {
      const h = harness();
      h.play(...guess("TEAM"), ...type("42"));
      return h;
    }],
    ["at the decode step", () => solvedGridAt(2)],
  ] as const) {
    it(`is cleared by agentOpen, which otherwise leaves the round in progress as it is (#111): ${name}`, () => {
      const h = make();
      h.controller.agentFinished();
      const before = h.controller.view();
      const savedBefore = JSON.parse(JSON.stringify(h.controller.savedState()));
      const roundNumber = h.session.roundNumber;
      const view = h.play({ type: "agentOpen" });
      assert.equal(view.message, "", "never says finished while the agent works");
      assert.equal(view.announcement, "");
      assert.deepEqual(
        { ...view, message: "", noticeId: 0 },
        { ...before, message: "", noticeId: 0 },
      );
      assert.equal(h.session.roundNumber, roundNumber, "no new round");
      assert.deepEqual(h.saves.at(-1), savedBefore, "the same round and draft are saved");
      assert.deepEqual(h.posts, []);
    });
  }

  it("leaves an error alone on agentOpen, as #111 does", () => {
    const h = harness();
    const rejected = h.play(...type("41414141"), { type: "enter" });
    const view = h.play({ type: "agentOpen" });
    assert.equal(view.message, rejected.message);
    assert.equal(view.messageIsError, true);
  });

  it("while How to play is open, puts it on the line behind it and reads it out once in the announcement region", () => {
    const h = harness();
    h.play(...guess("TEAM"), { type: "openHowToPlay" });
    assert.equal(h.controller.agentFinished(), true);
    const open = h.controller.view();
    assert.equal(open.howToPlayOpen, true, "How to play stays open");
    assert.equal(open.message, AGENT_FINISHED_MESSAGE);
    assert.equal(open.announcement, AGENT_FINISHED_MESSAGE);
    const closed = h.play({ type: "closeHowToPlay" });
    assert.equal(closed.message, AGENT_FINISHED_MESSAGE, "seen on return");
    assert.equal(closed.noticeId, open.noticeId, "not read out again");
  });

  it("says it again, as a new notice, when a second run finishes", () => {
    const h = harness();
    h.controller.agentFinished();
    const first = h.controller.view().noticeId;
    assert.equal(h.controller.agentFinished(), true);
    assert.equal(h.controller.view().noticeId, first + 1);
    assert.equal(h.controller.view().message, AGENT_FINISHED_MESSAGE);
  });
});

describe("GameController: agentStarted clears the agent-finished message (#112)", () => {
  for (const [name, make] of [
    ["mid-guess", () => {
      const h = harness();
      h.play(...guess("TEAM"), ...type("42"));
      return h;
    }],
    ["at the decode step after a solved grid", () => solvedGridAt(2)],
    ["at the decode step after row 6", () => atRowSix()],
  ] as const) {
    it(`clears it with nothing read out, changing nothing else: ${name}`, () => {
      const h = make();
      const original = h.controller.view();
      h.controller.agentFinished();
      const finished = h.controller.view();
      const savedBefore = JSON.parse(JSON.stringify(h.controller.savedState()));
      const saves = h.saves.length;
      assert.equal(h.controller.agentStarted(), true);
      const view = h.controller.view();
      assert.equal(view.message, "");
      assert.equal(view.messageIsError, false);
      assert.equal(view.announcement, "", "nothing read out");
      assert.equal(view.noticeId, finished.noticeId + 1);
      assert.deepEqual(
        { ...view, announcement: "", noticeId: 0 },
        { ...original, message: "", messageIsError: false, announcement: "", noticeId: 0 },
        "the round is as it was",
      );
      assert.deepEqual(JSON.parse(JSON.stringify(h.controller.savedState())), savedBefore);
      assert.equal(h.saves.length, saves, "not saved");
      assert.deepEqual(h.posts, []);
    });
  }

  it("leaves an error alone", () => {
    const h = harness();
    const rejected = h.play(...type("41414141"), { type: "enter" });
    assert.equal(h.controller.agentStarted(), false);
    assert.deepEqual(h.controller.view(), rejected);
  });

  it("leaves a scored row's announcement and an empty line alone", () => {
    const h = harness();
    const scored = h.play(...guess("TEAM"));
    assert.equal(h.controller.agentStarted(), false);
    assert.deepEqual(h.controller.view(), scored);
  });

  it("does nothing on the result card or before the first round", () => {
    for (const h of [solvedAfter(0), failed(), harness(new Session(WORDS, answerIs("BYTE")), false)]) {
      const before = h.controller.view();
      const saves = h.saves.length;
      assert.equal(h.controller.agentStarted(), false);
      assert.deepEqual(h.controller.view(), before);
      assert.equal(h.saves.length, saves);
    }
  });

  it("makes the next run's finish a new notice with the text, so it's read out again: start, finish, start, finish", () => {
    const h = harness();
    h.play(...guess("TEAM"));
    const shown: string[] = [];
    let noticeId = h.controller.view().noticeId;
    for (const signal of ["started", "finished", "started", "finished"] as const) {
      const changed = signal === "started" ? h.controller.agentStarted() : h.controller.agentFinished();
      const view = h.controller.view();
      if (changed) {
        assert.equal(view.noticeId, noticeId + 1);
        noticeId = view.noticeId;
        shown.push(view.message);
      }
    }
    assert.deepEqual(shown, [AGENT_FINISHED_MESSAGE, "", AGENT_FINISHED_MESSAGE]);
  });

  it("clears it behind How to play, and from the announcement region, without closing How to play", () => {
    const h = harness();
    h.play(...guess("TEAM"), { type: "openHowToPlay" });
    h.controller.agentFinished();
    assert.equal(h.controller.agentStarted(), true);
    const view = h.controller.view();
    assert.equal(view.howToPlayOpen, true);
    assert.equal(view.message, "");
    assert.equal(view.announcement, "");
  });

  it("keeps a replaced error in the session, so the saved state is unchanged", () => {
    const h = harness();
    h.play(...type("41414141"), { type: "enter" });
    const rejection = h.session.rejection;
    h.controller.agentFinished();
    h.controller.agentStarted();
    assert.deepEqual(h.session.rejection, rejection);
  });
});

describe("GameController: announcing a new round (#62)", () => {
  const starts: readonly (readonly [string, () => Harness])[] = [
    ["mid-round", () => harness()],
    ["the decode step", () => solvedGridAt(2)],
    ["the result card", () => solvedAfter(1)],
  ];
  for (const [name, start] of starts) {
    it(`announces "New round" to screen readers only, from ${name}`, () => {
      const view = start().play({ type: "newRound" });
      assert.equal(NEW_ROUND_ANNOUNCEMENT, NEW_ROUND_BUTTON, "the button's own wording");
      assert.equal(view.announcement, "New round");
      assert.equal(view.message, "", "nothing shows on screen");
    });
  }

  it("doesn't announce the first round, which init starts as the panel opens", () => {
    const view = harness().controller.view();
    assert.equal(view.announcement, "");
    assert.equal(view.message, "");
  });

  it("counts New round twice in a row as a new notice each time, so it's read out again", () => {
    const { play } = harness();
    const first = play({ type: "newRound" });
    const second = play({ type: "newRound" });
    assert.equal(second.announcement, "New round");
    assert.equal(second.noticeId, first.noticeId + 1);
  });

  it("clears the announcement on the next move", () => {
    const { play } = harness();
    play({ type: "newRound" });
    assert.equal(play(...type("4")).announcement, "");
  });

  it("doesn't bring the announcement back after a hide and show", () => {
    const h = harness();
    h.play({ type: "newRound" });
    assert.equal(reloaded(h).controller.view().announcement, "");
  });

  it("still announces a New Round command that arrives while How to play is open", () => {
    const { play } = harness();
    const view = play({ type: "openHowToPlay" }, { type: "newRound" });
    assert.equal(view.howToPlayOpen, true);
    assert.equal(view.announcement, "New round");
  });
});

/** BYTE's byte tiles on the result card. */
const BYTE_TILES = [
  { hex: "42", letter: "B", label: "42 is B" },
  { hex: "59", letter: "Y", label: "59 is Y" },
  { hex: "54", letter: "T", label: "54 is T" },
  { hex: "45", letter: "E", label: "45 is E" },
];

describe("GameController: the result card for a solved round (page 4)", () => {
  it('shows "Congrats! You cracked it", "Decoded: BYTE", "3 of 6 rows attempted · 0 hints used", the byte tiles, New round and the note', () => {
    const { result } = solvedAfter(2).controller.view();
    assert.deepEqual(result, {
      outcome: "Congrats! You cracked it",
      heading: "Decoded: BYTE",
      line: "3 of 6 rows attempted · 0 hints used",
      bytes: BYTE_TILES,
      button: "New round",
      note: "Your agent is still working. Next round is ready when you are.",
    });
    assert.equal(NEW_ROUND_BUTTON, "New round");
    assert.equal(RESULT_NOTE, "Your agent is still working. Next round is ready when you are.");
  });

  it("counts the rows used, the solving row included", () => {
    for (let missed = 0; missed < MAX_ROWS; missed++) {
      assert.equal(solvedAfter(missed).controller.view().result?.line, `${missed + 1} of 6 rows attempted · 0 hints used`);
    }
    assert.equal(atRowSix().play(decode("BYTE")).result?.line, "6 of 6 rows attempted · 0 hints used");
  });

  it('reads "1 hint used" when Hints was turned on, even if turned off again', () => {
    const h = harness();
    h.play(toggleHints, toggleHints);
    assert.equal(solvedAfter(2, h).controller.view().result?.line, "3 of 6 rows attempted · 1 hint used");
  });

  it("shows the hint count, one per row with Hints on before it was scored", () => {
    const h = harness();
    h.play(toggleHints, ...guess("TEAM"), ...guess("BEAT"), toggleHints, ...guess("BYTE"), decode("BYTE"));
    assert.equal(h.controller.view().result?.line, "3 of 6 rows attempted · 2 hints used");
  });

  it("has no Copy result", () => {
    const { result } = solvedAfter(2).controller.view();
    assert.doesNotMatch(JSON.stringify(result), /copy/i);
    assert.deepEqual(Object.keys(result ?? {}).sort(), ["button", "bytes", "heading", "line", "note", "outcome"]);
  });

  it('replaces the decode panel and keypad: "4-letter word · solved", no Hints button, nothing to type', () => {
    const view = solvedAfter(2).controller.view();
    assert.equal(view.status, "4-letter word · solved");
    assert.deepEqual(view.hints, HIDDEN_HINTS);
    assert.equal(view.keypadEnabled, false);
    assert.equal(view.decodeAvailable, false);
    assert.equal(view.decodeLocked, false);
    assert.equal(view.hexLocked, false);
  });
});

describe("GameController: the result card for a failed round", () => {
  it('shows "Unlucky!", "The word was BYTE", "6 of 6 rows attempted · 0 hints used", the byte tiles and New round', () => {
    const { result } = failed().controller.view();
    assert.deepEqual(result, {
      outcome: "Unlucky!",
      heading: "The word was BYTE",
      line: "6 of 6 rows attempted · 0 hints used",
      bytes: BYTE_TILES,
      button: "New round",
      note: RESULT_NOTE,
    });
  });

  it('shows "4-letter word · out of rows" after row 6 and hides the Hints button', () => {
    const view = failed().controller.view();
    assert.equal(view.status, "4-letter word · out of rows");
    assert.deepEqual(view.hints, HIDDEN_HINTS);
    assert.equal(view.keypadEnabled, false);
    assert.equal(view.decodeAvailable, false);
  });

  it("appears straight after the wrong word, in the redraw of that same dispatch", () => {
    const h = solvedGridAt(2);
    const drawn: ScreenView["result"][] = [];
    // Draws like `changed()` in media/main.ts, which renders `view()` at the end of `dispatch`.
    const controller = new GameController(h.session, () => drawn.push(controller.view().result));
    assert.equal(controller.view().result, null);
    controller.dispatch(decode("BITE"));
    assert.equal(drawn.length, 1);
    assert.equal(drawn[0]?.heading, "The word was BYTE");
  });
});

describe("GameController: the outcome message on the result card", () => {
  it('says "Congrats! You cracked it" for a solved round, early or on the last row', () => {
    assert.equal(SOLVED_OUTCOME, "Congrats! You cracked it");
    for (const missed of [0, 2, 5]) {
      assert.equal(solvedAfter(missed).controller.view().result?.outcome, SOLVED_OUTCOME, `${missed} missed`);
    }
  });

  it('says "Unlucky!" for a failed round', () => {
    assert.equal(FAILED_OUTCOME, "Unlucky!");
    assert.equal(failed().controller.view().result?.outcome, FAILED_OUTCOME);
  });

  for (const [name, finish, outcome] of [
    ["solved", () => solvedAfter(2), "Congrats! You cracked it"],
    ["failed", () => failed(), "Unlucky!"],
  ] as const) {
    it(`comes back after a reload: ${name}`, () => {
      assert.equal(reloaded(finish()).controller.view().result?.outcome, outcome);
    });
  }

  it("is gone again once New round starts the next round", () => {
    assert.equal(solvedAfter(0).play({ type: "newRound" }).result, null);
  });
});

describe("GameController: the answer stays out of the view while the round is in progress", () => {
  it("has no result card and no answer in any in-progress view, hints and the decode step included", () => {
    const { play } = harness(undefined, false);
    const views = [
      play(),
      play({ type: "init" }),
      play(...type("4259")),
      play(...type("5446")),
      play({ type: "enter" }),
      play(...CLEAR_ROW, decode("BITE")),
      play(toggleHints),
      play(...guess("BITE")),
      play(toggleHints),
      play(...guess("TEAM"), ...guess("BEAT"), ...guess("BEST"), ...guess("BUSY"), ...guess("ABLE")),
      play(decode("QXZJ")),
    ];
    assert.equal(views.at(-1)?.panel, FINAL_PANEL, "reached the decode step");
    for (const [i, view] of views.entries()) {
      assert.equal(view.result, null, `view ${i}`);
      assert.doesNotMatch(JSON.stringify(view), /BYTE|42595445/, `view ${i}`);
      assert.doesNotMatch(JSON.stringify(view), /Congrats|cracked|Unlucky/, `view ${i}: no outcome`);
    }
  });

  it("adds the answer only once the round is over, solved or failed", () => {
    assert.match(JSON.stringify(solvedAfter(0).controller.view()), /BYTE/);
    assert.match(JSON.stringify(failed().controller.view()), /BYTE/);
  });
});

describe("GameController: New round on the result card", () => {
  for (const [name, finish] of [["solved", () => solvedAfter(2)], ["failed", () => failed()]] as const) {
    it(`starts a fresh round through changed(), with the next round number and no roundFinished: ${name}`, () => {
      const { play, session, saves, posts } = finish();
      assert.equal(posts.length, 1, "the finished round was reported once");
      const before = saves.length;
      const view = play({ type: "newRound" });
      assert.equal(saves.length, before + 1, "changed() ran exactly once");
      const saved = saves.at(-1) as SessionState;
      assert.equal(saved.roundNumber, 2);
      assert.equal(saved.reported, false);
      assert.deepEqual(saved.round.rows, []);
      assert.equal(session.roundNumber, 2);
      assert.equal(posts.length, 1, "no roundFinished for the new round");
      assert.equal(view.result, null);
      assert.equal(view.status, "4-letter word · row 1 of 6");
      assert.equal(view.keypadEnabled, true);
      assert.deepEqual(view.hints, OFF_HINTS);
    });
  }
});

describe("GameController: the result card after a hide or reload", () => {
  for (const [name, finish] of [["solved", () => solvedAfter(2)], ["failed", () => failed()]] as const) {
    it(`comes back without posting roundFinished again: ${name}`, () => {
      const before = finish();
      const card = before.controller.view().result;
      assert.ok(card);
      const after = reloaded(before);
      assert.deepEqual(after.controller.view().result, card);
      assert.deepEqual(after.posts, []);
      assert.deepEqual(reloaded(reloaded(after)).posts, [], "nor after more reloads");
    });
  }

  // Regression test for #43: the round was saved with a half-typed row, and
  // dropped on reload. A decode can no longer cut a half-typed row off: it's
  // ignored before the decode step, and the row that opens it clears the draft.
  it("comes back after a decode tried with the next hex row half typed, then the grid solved", () => {
    const before = harness();
    const ignored = before.play(...guess("TEAM"), ...type("42"), decode("BYTE"));
    assert.equal(ignored.result, null);
    assert.equal(before.session.draft, "42");
    const view = before.play(...type("595445"), { type: "enter" }, decode("BYTE"));
    assert.ok(view.result);
    assert.equal(before.session.draft, "");
    const after = reloaded(before);
    assert.equal(after.session.round?.phase, "solved", "the saved round, not a fresh one");
    assert.deepEqual(after.controller.view().result, view.result);
    assert.deepEqual(after.controller.view().rows, view.rows);
    assert.deepEqual(after.posts, []);
  });

  it("starts round 2 from a restored card with New round, still without posting", () => {
    const after = reloaded(failed());
    const view = after.play({ type: "newRound" });
    assert.equal(after.session.roundNumber, 2);
    assert.equal(view.result, null);
    assert.deepEqual(after.posts, []);
  });
});

describe("resultView", () => {
  it("decodes each byte of the answer to its letter, from A (41) to Z (5A)", () => {
    const view = resultView({ solved: true, answer: "AZOP", rowsUsed: 4, answerTries: 1, hintsUsed: 0 });
    assert.deepEqual(
      view.bytes.map((byte) => `${byte.hex}>${byte.letter}`),
      ["41>A", "5A>Z", "4F>O", "50>P"],
    );
    assert.equal(view.heading, "Decoded: AZOP");
    assert.equal(view.line, "4 of 6 rows attempted · 0 hints used");
  });

  it('writes "1 hint used" in the singular, and every other count, 0 included, in the plural', () => {
    const line = (hintsUsed: number): string =>
      resultView({ solved: true, answer: "BYTE", rowsUsed: 6, answerTries: 1, hintsUsed }).line;
    assert.equal(line(0), "6 of 6 rows attempted · 0 hints used");
    assert.equal(line(1), "6 of 6 rows attempted · 1 hint used");
    assert.equal(line(2), "6 of 6 rows attempted · 2 hints used");
    assert.equal(line(MAX_HINTS), "6 of 6 rows attempted · 6 hints used");
    assert.equal(hintsUsedText(0), "0 hints used");
    assert.equal(hintsUsedText(1), "1 hint used");
    assert.equal(hintsUsedText(3), "3 hints used");
  });

  it('matches the owner\'s example: "3 of 6 rows attempted · 2 hints used", for a failed round too', () => {
    for (const solved of [true, false]) {
      const view = resultView({ solved, answer: "BYTE", rowsUsed: 3, answerTries: 1, hintsUsed: 2 });
      assert.equal(view.line, "3 of 6 rows attempted · 2 hints used");
    }
  });
});

describe("GameController: Hints (page 2)", () => {
  it("is off in a new round: the button shows, not pressed, not locked, and no strip", () => {
    assert.deepEqual(harness().controller.view().hints, OFF_HINTS);
    assert.equal(HINTS_BUTTON, "Hints");
  });

  it("turns on when pressed: pressed, with one cell per byte, each a muted ? until decoded", () => {
    const { hints } = harness().play(toggleHints);
    assert.equal(hints.on, true);
    assert.equal(hints.locked, false);
    assert.deepEqual(hints.cells, new Array(4).fill({ text: HINT_UNKNOWN, unknown: true }));
    assert.equal(HINT_UNKNOWN, "?");
    assert.equal(hints.label, "Hints: unknown, unknown, unknown, unknown");
  });

  it("shows each fully decoded byte's letter, and ? for the rest (B ? T E)", () => {
    // BITE = 42 49 54 45 against BYTE = 42 59 54 45: bytes 1, 3 and 4 are exact.
    const view = harness().play(...guess("BITE"), toggleHints);
    assert.equal(strip(view), "B ? T E");
    assert.deepEqual(
      view.hints.cells.map((cell) => cell.unknown),
      [false, true, false, false],
    );
    assert.equal(view.hints.label, "Hints: B, unknown, T, E");
  });

  it("shows a byte's letter only once both its digits are in the right spot in the same row", () => {
    // BYTE's 2nd byte is 59. BUSY (55) finds the 5 and LIME (49) the 9, but
    // no row has both, so it stays ?; LYNX (59) then gets the whole byte.
    const { play } = harness();
    assert.equal(strip(play(...guess("BUSY"), toggleHints)), "B ? ? ?");
    assert.equal(strip(play(...guess("LIME"), toggleHints)), "B ? ? E");
    assert.equal(strip(play(...guess("LYNX"), toggleHints)), "B Y ? E");
  });

  it("turns off when pressed again: not pressed, and the strip is hidden", () => {
    assert.deepEqual(harness().play(...guess("BITE"), toggleHints, toggleHints).hints, OFF_HINTS);
  });

  it("toggles any number of times before the hex locks, never running out", () => {
    const { play } = harness();
    for (let i = 0; i < 50; i++) {
      assert.equal(play(toggleHints).hints.on, true, `on #${i + 1}`);
      assert.equal(play(toggleHints).hints.on, false, `off #${i + 1}`);
    }
    assert.equal(strip(play(...guess("BITE"), toggleHints)), "B ? T E");
  });

  it("toggles while a hex row is half typed, keeping its digits", () => {
    const { play, session } = harness();
    const view = play(...type("4259"), toggleHints);
    assert.equal(view.hints.on, true);
    assert.equal(session.draft, "4259");
  });

  it("hides the button and the strip once the round is over", () => {
    assert.deepEqual(solvedAfter(1).controller.view().hints, HIDDEN_HINTS);
    assert.deepEqual(failed().controller.view().hints, HIDDEN_HINTS);
  });

  it("ignores the toggle before the first round", () => {
    const { play, session } = harness(undefined, false);
    assert.equal(play(toggleHints).hints.available, false);
    assert.equal(session.round, null);
  });

  it("shows no count or limit anywhere while the round is in progress: only the button's state and the letters", () => {
    const { play, session } = harness();
    const views = [
      play(),
      play(toggleHints),
      play(...guess("BITE")),
      play(toggleHints),
      play(toggleHints),
      play(toggleHints, ...guess("TEAM")),
      play(toggleHints),
      play(...guess("BYTE")),
    ];
    assert.equal(session.round?.hintsUsed, 3, "hints were counted");
    for (const view of views) {
      assert.deepEqual(Object.keys(view.hints).sort(), ["available", "cells", "label", "locked", "on"]);
      assert.doesNotMatch(`${view.status} ${view.message}`, /hint/i);
      const text = [HINTS_BUTTON, view.hints.label, ...view.hints.cells.map((cell) => cell.text)].join(" ");
      assert.doesNotMatch(text, /\d|left|remaining|limit|available/i);
    }
  });
});

describe("GameController: Hints switches off after each scored row (#38)", () => {
  it("is off for the first hex row of every round", () => {
    const { play, saves } = harness();
    const view = play(...type("4259"));
    assert.equal(view.hints.on, false);
    assert.equal((saves.at(-1) as SessionState).round.hintsShown, false);
  });

  it("turns off when ENTER scores a row, hiding the strip", () => {
    const { play } = harness();
    assert.equal(play(toggleHints).hints.on, true);
    assert.deepEqual(play(...guess("TEAM")).hints, OFF_HINTS);
  });

  it("saves the automatic switch-off through changed(), with the ENTER that caused it", () => {
    const { controller, play, saves } = harness();
    play(toggleHints, ...type("5445414D"));
    const before = saves.length;
    controller.dispatch({ type: "enter" });
    assert.equal(saves.length, before + 1, "changed() ran exactly once");
    const saved = saves.at(-1) as SessionState;
    assert.equal(saved.round.rows.length, 1);
    assert.equal(saved.round.hintsShown, false);
    assert.equal(saved.round.hintsUsed, 1);
    assert.equal(saved.round.rowHinted, false);
  });

  const rejectedRows: readonly (readonly [string, readonly Action[]])[] = [
    ["too short", type("4259")],
    ["not letters", type("30313233")],
    ["not a listed word", type("5A5A5A5A")],
  ];
  for (const [name, digits] of rejectedRows) {
    it(`stays on, with the strip, after a rejected row (${name})`, () => {
      const view = harness().play(toggleHints, ...digits, { type: "enter" });
      assert.equal(view.messageIsError, true);
      assert.equal(view.hints.on, true);
      assert.equal(strip(view), "? ? ? ?");
    });
  }

  it("stays on after a repeated row", () => {
    const view = harness().play(...guess("TEAM"), toggleHints, ...guess("TEAM"));
    assert.equal(view.message, "You've already tried 54 45 41 4D");
    assert.equal(view.hints.on, true);
  });
});

describe("GameController: Hints locks with the hex (#46, page L3)", () => {
  for (const [name, reach] of [
    ["a solved grid", () => solvedGridAt(3)],
    ["row 6", () => atRowSix()],
  ] as const) {
    it(`locks after ${name}: off, no strip, the button disabled`, () => {
      assert.deepEqual(reach().controller.view().hints, LOCKED_HINTS);
    });

    it(`switches off and locks after ${name} scored with Hints on, counting that row once`, () => {
      const h = harness();
      // Hints on for the last row only: turn it on just before it.
      const last = name === "row 6" ? 6 : 3;
      for (let row = 1; row < last; row++) {
        h.play(...guess(ROW_WORDS[row - 1] ?? ""));
      }
      h.play(toggleHints);
      assert.equal(h.controller.view().hints.on, true);
      const view = h.play(...guess(name === "row 6" ? (ROW_WORDS[5] ?? "") : "BYTE"));
      assert.deepEqual(view.hints, LOCKED_HINTS);
      assert.equal(h.session.round?.hintsUsed, 1);
    });

    it(`ignores the toggle after ${name}, through changed(), and never shows the strip again`, () => {
      const { controller, session, saves } = reach();
      const before = session.toState();
      for (let i = 0; i < 3; i++) {
        const count = saves.length;
        controller.dispatch(toggleHints);
        assert.equal(saves.length, count + 1, "changed() ran exactly once");
        assert.deepEqual(controller.view().hints, LOCKED_HINTS);
      }
      assert.deepEqual(session.toState(), before);
    });

    it(`stays locked after ${name} through rejected words`, () => {
      const { play } = reach();
      assert.deepEqual(play(decode("QXZJ"), toggleHints).hints, LOCKED_HINTS);
    });
  }

  it("never spells the solved word in the strip: hints are off whenever the grid is solved", () => {
    const { play } = harness();
    play(...guess("BITE"), toggleHints);
    assert.equal(strip(play()), "B ? T E");
    const view = play(toggleHints, ...guess("BYTE"));
    assert.equal(strip(view), "");
    assert.doesNotMatch(JSON.stringify(view.hints), /Y/);
  });

  it('describes the locked button as "Locked for the rest of the round"', () => {
    assert.equal(HINTS_LOCKED_NOTE, "Locked for the rest of the round");
  });
});

describe("GameController: the hint count in the result (#38, #46)", () => {
  /** The `hintsUsed` posted when the round ends. */
  function posted(h: Harness): number | undefined {
    assert.equal(h.posts.length, 1);
    return h.posts[0]?.hintsUsed;
  }

  it("reports 1 for Hints on for the only row", () => {
    const h = harness();
    h.play(toggleHints, ...guess("BYTE"), decode("BYTE"));
    assert.deepEqual(h.posts, [{ type: "roundFinished", solved: true, rowsUsed: 1, answerTries: 1, hintsUsed: 1 }]);
  });

  it("reports 1 for a row whose Hints was turned on and off again before ENTER", () => {
    const h = harness();
    h.play(toggleHints, toggleHints, ...guess("TEAM"), ...guess("BYTE"), decode("BYTE"));
    assert.equal(posted(h), 1);
  });

  it("counts a row once however often Hints is pressed before ENTER", () => {
    const h = harness();
    h.play(toggleHints, toggleHints, toggleHints, toggleHints, toggleHints, ...guess("BYTE"), decode("BYTE"));
    assert.equal(posted(h), 1);
  });

  it("goes up by one when Hints is pressed again for the next row, and skips rows typed with Hints off", () => {
    const h = harness();
    h.play(toggleHints, ...guess("TEAM"), ...guess("BEAT"), toggleHints, ...guess("BEST"), ...guess("BYTE"), decode("BYTE"));
    assert.equal(posted(h), 2);
  });

  it("doesn't count again after a rejected row, which leaves Hints on", () => {
    const h = harness();
    h.play(toggleHints, ...guess("QXZJ"), toggleHints, toggleHints, ...CLEAR_ROW, ...guess("BYTE"), decode("BYTE"));
    assert.equal(posted(h), 1);
  });

  it("counts nothing after the last row: the toggle is ignored once the hex locks", () => {
    const h = atRowSix();
    h.play(toggleHints, toggleHints, toggleHints, decode("BITE"));
    assert.deepEqual(h.posts, [{ type: "roundFinished", solved: false, rowsUsed: MAX_ROWS, answerTries: 1, hintsUsed: 0 }]);
  });

  it("reports MAX_HINTS (6) for Hints on for every row, and the host accepts it", () => {
    const h = harness();
    for (const word of ROW_WORDS) {
      h.play(toggleHints, ...guess(word));
    }
    h.play(toggleHints, decode("BYTE"));
    assert.equal(posted(h), MAX_HINTS);
    assert.equal(MAX_HINTS, 6);
    assert.deepEqual(parseWebviewMessage(JSON.parse(JSON.stringify(h.posts[0]))), h.posts[0]);
    assert.equal(h.controller.view().result?.line, "6 of 6 rows attempted · 6 hints used");
  });

  it("reports at most rowsUsed when the grid is solved early", () => {
    const h = harness();
    h.play(toggleHints, ...guess("TEAM"), toggleHints, ...guess("BYTE"), toggleHints, decode("CODE"));
    assert.deepEqual(h.posts, [{ type: "roundFinished", solved: false, rowsUsed: 2, answerTries: 1, hintsUsed: 2 }]);
  });

  it("starts the next round with Hints off, unlocked, and the count at 0", () => {
    const { play, posts } = harness();
    const view = play(toggleHints, ...guess("BYTE"), decode("BYTE"), { type: "newRound" });
    assert.equal(posts.at(-1)?.hintsUsed, 1);
    assert.deepEqual(view.hints, OFF_HINTS);
    play(...guess("BYTE"), decode("BYTE"));
    assert.equal(posts.at(-1)?.hintsUsed, 0);
  });

  it("starts a new round with Hints unlocked, replacing one at the decode step", () => {
    const view = solvedGridAt(1).play({ type: "newRound" });
    assert.deepEqual(view.hints, OFF_HINTS);
    assert.equal(harness().play({ type: "newRound" }, toggleHints).hints.on, true);
  });
});

describe("GameController: hints across a hide and show", () => {
  it("brings back Hints on, and the strip with its letters", () => {
    const before = harness();
    const view = before.play(...guess("BITE"), toggleHints);
    assert.deepEqual(reloaded(before).controller.view().hints, view.hints);
    assert.equal(strip(reloaded(before).controller.view()), "B ? T E");
  });

  it("brings back Hints off after it was turned on and off for this row, still counted once", () => {
    const before = harness();
    before.play(toggleHints, ...guess("TEAM"), toggleHints, toggleHints);
    const after = reloaded(before);
    assert.equal(after.controller.view().hints.on, false);
    after.play(toggleHints, toggleHints, ...guess("BYTE"), decode("BYTE"));
    assert.equal(after.posts[0]?.hintsUsed, 2);
  });

  it("brings back Hints off after a scored row switched it off, and counts the next press", () => {
    const before = harness();
    before.play(toggleHints, ...guess("TEAM"));
    const after = reloaded(before);
    assert.equal(after.controller.view().hints.on, false);
    after.play(toggleHints, ...guess("BYTE"), decode("BYTE"));
    assert.equal(after.posts[0]?.hintsUsed, 2);
  });

  it("brings back Hints on after a rejected row, without counting it again", () => {
    const before = harness();
    before.play(toggleHints, ...guess("QXZJ"));
    const after = reloaded(before);
    assert.equal(after.controller.view().hints.on, true);
    after.play(toggleHints, toggleHints, ...CLEAR_ROW, ...guess("BYTE"), decode("BYTE"));
    assert.equal(after.posts[0]?.hintsUsed, 1);
  });

  it("brings back the Hints lock at the decode step, still ignoring the toggle", () => {
    const after = reloaded(solvedGridAt(2));
    assert.deepEqual(after.controller.view().hints, LOCKED_HINTS);
    assert.deepEqual(after.play(toggleHints).hints, LOCKED_HINTS);
  });
});

describe("hintsView", () => {
  it("hides the button with no round, or once the round is over", () => {
    assert.deepEqual(hintsView(null), HIDDEN_HINTS);
  });
});

describe("GameController: every action saves", () => {
  // A mapped type: the compiler fails here if an action type has no sample.
  const samples: { readonly [T in ActionType]: Extract<Action, { type: T }> } = {
    init: { type: "init" },
    newRound: { type: "newRound" },
    agentOpen: { type: "agentOpen" },
    digit: { type: "digit", digit: "4" },
    delete: { type: "delete" },
    enter: { type: "enter" },
    decode: { type: "decode", word: "BEAT" },
    toggleHints: { type: "toggleHints" },
    openHowToPlay: { type: "openHowToPlay" },
    closeHowToPlay: { type: "closeHowToPlay" },
  };

  for (const action of Object.values(samples)) {
    it(`"${action.type}" ends with changed(), which saves the state after it`, () => {
      // Set up a state where the action does something.
      const h = action.type === "decode" ? solvedGridAt(1) : harness();
      if (action.type === "delete" || action.type === "enter") {
        h.controller.dispatch({ type: "digit", digit: "4" });
      }
      const before = h.saves.length;
      h.controller.dispatch(action);
      assert.equal(h.saves.length, before + 1, "changed() ran exactly once");
      assert.deepEqual(h.saves.at(-1), JSON.parse(JSON.stringify(h.controller.savedState())));
    });
  }

  it("saves the move itself, so a reload sees it: digits, a row, the decode step, the try", () => {
    const { play, saves } = harness();
    play(...type("42"));
    assert.equal((saves.at(-1) as SessionState).draft, "42");
    play(...type("595445"), { type: "enter" });
    assert.equal((saves.at(-1) as SessionState).round.rows.length, 1);
    assert.equal((saves.at(-1) as SessionState).round.phase, "decode");
    play(decode("BEAT"));
    assert.equal((saves.at(-1) as SessionState).round.attempt, "BEAT");
  });

  it("saves every Hints toggle through changed() while the hex is unlocked", () => {
    const check = (h: Harness, where: string): void => {
      for (const on of [true, false, true, false]) {
        const before = h.saves.length;
        h.controller.dispatch(toggleHints);
        assert.equal(h.saves.length, before + 1, `${where}: changed() ran exactly once`);
        const saved = h.saves.at(-1) as SessionState;
        assert.equal(saved.round.hintsShown, on, `${where}: hintsShown saved`);
        assert.equal(saved.round.hintsUsed, 1, `${where}: hintsUsed saved, counted once`);
      }
    };
    check(harness(), "row 1");
    const between = harness();
    between.play(...guess("TEAM"));
    check(between, "between rows");
  });

  it("also ends with changed() for an action that was ignored or rejected", () => {
    const { controller, saves } = harness();
    for (const action of [{ type: "delete" }, { type: "enter" }, decode("BEAT"), { type: "digit", digit: "G" }] as const) {
      const before = saves.length;
      controller.dispatch(action);
      assert.equal(saves.length, before + 1, action.type);
    }
  });

  for (const [name, reach] of [
    ["after a solved grid", () => solvedGridAt(2)],
    ["after row 6", () => atRowSix()],
  ] as const) {
    describe(`every action at the decode step ${name} ends with changed()`, () => {
      const actions: readonly (readonly [string, Action])[] = [
        ["the right word", decode("BYTE")],
        ["a wrong word", decode("BITE")],
        ["an unlisted word", decode("QXZJ")],
        ["a malformed word", decode("B4")],
        ["a hex digit on the locked keypad", { type: "digit", digit: "4" }],
        ["DEL on the locked keypad", { type: "delete" }],
        ["ENTER on the locked keypad", { type: "enter" }],
        ["init", { type: "init" }],
        ["New Round", { type: "newRound" }],
        ["the locked Hints button", toggleHints],
        ["the locked ? button (#53)", { type: "openHowToPlay" }],
      ];
      for (const [actionName, action] of actions) {
        it(actionName, () => {
          const { controller, saves } = reach();
          const before = saves.length;
          controller.dispatch(action);
          assert.equal(saves.length, before + 1, "changed() ran exactly once");
          assert.deepEqual(saves.at(-1), JSON.parse(JSON.stringify(controller.savedState())));
        });
      }
    });
  }

  it("saves nothing before the first round, but still calls changed()", () => {
    const { controller, saves } = harness(undefined, false);
    controller.dispatch({ type: "digit", digit: "4" });
    assert.deepEqual(saves, [null]);
  });
});

describe("GameController: hiding and showing the panel", () => {
  /** A harness (answer BYTE) after `actions`. */
  function after(...actions: Action[]): Harness {
    const h = harness();
    h.play(...actions);
    return h;
  }

  /** The view without the screen-reader announcement and the notice count, which aren't saved. */
  function lasting(view: ScreenView): Omit<ScreenView, "announcement" | "noticeId"> {
    const { announcement: _announcement, noticeId: _noticeId, ...rest } = view;
    return rest;
  }

  const states: readonly (readonly [string, Action[]])[] = [
    ["a half-typed row", [...type("4259")]],
    ["a full row not yet entered", [...type("42595445")]],
    ["a scored row", [...guess("TEAM")]],
    ["scored rows and a half-typed row", [...guess("TEAM"), ...guess("BEST"), ...type("5")]],
    ["the decode step after a solved grid", [...guess("TEAM"), ...guess("BYTE")]],
    ["the decode step after six rows", [...ROW_WORDS.flatMap((w) => guess(w))]],
  ];
  for (const [name, actions] of states) {
    it(`brings back rows, marks, keys, the draft, the locks and the phase: ${name}`, () => {
      const before = harness();
      const view = before.play(...actions);
      assert.deepEqual(lasting(reloaded(before).controller.view()), lasting(view));
    });
  }

  it("brings back Solved, Out of rows and Not decoded, with their status lines, which come from the round", () => {
    assert.equal(reloaded(solvedAfter(1)).controller.view().message, "Solved");
    const outOfRows = reloaded(failed()).controller.view();
    assert.equal(outOfRows.message, "Out of rows");
    assert.equal(outOfRows.status, "4-letter word · out of rows");
    const finished = solvedGridAt(2);
    finished.play(decode("CODE"));
    const restored = reloaded(finished).controller.view();
    assert.equal(restored.message, "Not decoded");
    assert.equal(restored.status, "4-letter word · not decoded");
  });

  describe("brings back the message of a rejected move, as an error (#34)", () => {
    const cases: readonly (readonly [string, () => Harness, string])[] = [
      ["a repeated hex row", () => after(...guess("TEAM"), ...guess("TEAM")), "You've already tried 54 45 41 4D"],
      ["a repeated hex row typed in lowercase", () => after(...guess("TEAM"), ...type("5445414d"), { type: "enter" }), "You've already tried 54 45 41 4D"],
      ["an empty row", () => after({ type: "enter" }), "Not enough digits"],
      ["a short row", () => after(...type("42"), { type: "enter" }), "Not enough digits"],
      ["a byte that isn't a letter", () => after(...type("7B7B7B7B"), { type: "enter" }), "7B isn't a letter"],
      ["an unlisted word in hex", () => after(...guess("AAAA")), "AAAA isn't in the word list"],
      ["a malformed word at the decode step", () => after(...guess("BYTE"), decode("<b>X</b>")), "Type a 4-letter word, A to Z"],
      ["an unlisted word at the decode step", () => after(...guess("BYTE"), decode("qxzj")), "QXZJ isn't in the word list"],
      [
        "an unlisted word at the decode step after row 6",
        () => {
          const h = atRowSix();
          h.play(decode("qxzj"));
          return h;
        },
        "QXZJ isn't in the word list",
      ],
    ];
    for (const [name, make, message] of cases) {
      it(`${name}: "${message}"`, () => {
        const before = make();
        const view = before.controller.view();
        assert.equal(view.message, message);
        assert.equal(view.messageIsError, true);
        const restored = reloaded(before).controller.view();
        assert.equal(restored.message, message);
        assert.equal(restored.messageIsError, true);
        assert.equal(restored.announcement, "");
        assert.deepEqual(lasting(restored), lasting(view), "and the rest of the screen, typed digits included");
      });
    }
  });

  it("saves the rejected move as data, never the message text or what was typed in the decode box", () => {
    const saved = JSON.stringify(after(...guess("BYTE"), decode("<b>X</b>")).saves.at(-1));
    assert.match(saved, /"rejection":\{"kind":"word","error":"format","word":""\}/);
    assert.doesNotMatch(saved, /<b>|4-letter word/);
    const repeat = JSON.stringify(after(...guess("TEAM"), ...guess("TEAM")).saves.at(-1));
    assert.match(repeat, /"rejection":\{"kind":"row","error":"repeat","hex":"5445414D"\}/);
    assert.doesNotMatch(repeat, /already tried/);
  });

  it("doesn't bring back a screen-reader announcement: a scored row, or the unlock", () => {
    for (const h of [after(...guess("TEAM")), after(...guess("BYTE"))]) {
      assert.notEqual(h.controller.view().announcement, "");
      const view = reloaded(h).controller.view();
      assert.equal(view.announcement, "");
      assert.equal(view.message, "");
    }
  });

  it("keeps the restored message through init without counting it as new, so it isn't read out again", () => {
    const before = after(...guess("TEAM"), ...guess("TEAM"));
    const restored = harness(restoreSession(before.saves.at(-1), WORDS), false);
    const { noticeId } = restored.controller.view();
    const view = restored.play({ type: "init" });
    assert.equal(view.message, "You've already tried 54 45 41 4D");
    assert.equal(view.noticeId, noticeId);
    assert.equal(restored.play({ type: "enter" }).noticeId, noticeId + 1, "the same repeat again is new");
  });

  it("clears the restored message on the next move, as before a reload", () => {
    const restored = reloaded(after(...guess("BYTE"), decode("QXZJ")));
    const view = restored.play(decode(""));
    assert.equal(view.message, "Type a 4-letter word, A to Z");
    assert.equal(restored.play(toggleHints).message, "");
    assert.equal((restored.saves.at(-1) as SessionState).rejection, null);
  });
});

describe("GameController: repeated hex rows (#34)", () => {
  it("leaves the keypad exactly as it was for a repeated hex row", () => {
    const { play } = harness();
    const before = play(...guess("TEAM"));
    const view = play(...guess("TEAM"));
    assert.deepEqual(view.keys, before.keys);
    assert.equal(view.keypadEnabled, true);
  });

  it("checks for a repeat after the existing checks: the invalid guess's own message shows", () => {
    const { play } = harness();
    play(...guess("TEAM"));
    assert.equal(play(...type("5445414"), { type: "enter" }).message, "Not enough digits");
  });

  it("counts the same rejection twice in a row as a new notice each time, for hex rows and words", () => {
    const { play } = harness();
    play(...guess("TEAM"));
    const first = play(...type("5445414D"), { type: "enter" });
    assert.equal(first.message, "You've already tried 54 45 41 4D");
    const second = play({ type: "enter" });
    assert.equal(second.message, first.message);
    assert.equal(second.noticeId, first.noticeId + 1);
    play(...CLEAR_ROW, ...guess("BYTE"));
    const word = play(decode("QXZJ"));
    const again = play(decode("qxzj"));
    assert.equal(again.message, "QXZJ isn't in the word list");
    assert.equal(again.noticeId, word.noticeId + 1);
  });

  it("saves every rejected repeat through changed(), with its rejection and the typed digits", () => {
    const { play, saves } = harness();
    play(...guess("TEAM"), ...type("5445414D"));
    const before = saves.length;
    play({ type: "enter" });
    assert.equal(saves.length, before + 1, "changed() ran exactly once");
    const saved = saves.at(-1) as SessionState;
    assert.deepEqual(saved.rejection, { kind: "row", error: "repeat", hex: "5445414D" });
    assert.equal(saved.draft, "5445414D");
  });

  it("starts a new round with nothing tried: the last round's rows are accepted again", () => {
    const { play, session } = harness();
    play(...guess("TEAM"), { type: "newRound" });
    const view = play(...guess("TEAM"));
    assert.equal(session.roundNumber, 2);
    assert.equal(session.round?.rows.length, 1);
    assert.equal(view.message, "");
  });

  it("clears a standing repeat message on New round", () => {
    const { play, saves } = harness();
    const view = play(...guess("TEAM"), ...guess("TEAM"), { type: "newRound" });
    assert.equal(view.message, "");
    assert.equal(view.messageIsError, false);
    assert.equal((saves.at(-1) as SessionState).rejection, null);
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

/** A key press with no Ctrl, Cmd or Alt unless `modifiers` says so. */
function press(key: string, modifiers: Partial<KeyPress> = {}): KeyPress {
  return { key, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
}

describe("actionForKey", () => {
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

  it("ignores other keys, letters that aren't hex included, and shortcuts with Ctrl, Cmd or Alt", () => {
    for (const key of ["g", "G", "t", "z", " ", "Tab", "Delete", "Escape", "ArrowLeft", "F1", "10"]) {
      assert.equal(actionForKey(press(key), "page"), null, key);
    }
    assert.equal(actionForKey(press("c", { ctrlKey: true }), "page"), null);
    assert.equal(actionForKey(press("a", { metaKey: true }), "page"), null);
    assert.equal(actionForKey(press("Enter", { altKey: true }), "page"), null);
  });
});

describe("shouldFocusDecodeBox", () => {
  it("sends letters typed outside the box to it at the decode step, so `beat` isn't lost", () => {
    // `t`, `o`, `m`, `s` aren't hex, so without this they would be dropped.
    for (const key of [..."toms", ..."beat", "B", "4", "é", "-"]) {
      assert.equal(shouldFocusDecodeBox(press(key), "page", true), true, key);
      assert.equal(shouldFocusDecodeBox(press(key), "control", true), true, key);
    }
  });

  it("does nothing when the box already has focus", () => {
    assert.equal(shouldFocusDecodeBox(press("b"), "decodeBox", true), false);
  });

  it("does nothing while the decode panel is locked, so typed letters never reach the box", () => {
    for (const key of ["b", "t", "4", "z"]) {
      assert.equal(shouldFocusDecodeBox(press(key), "page", false), false, key);
      assert.equal(shouldFocusDecodeBox(press(key), "control", false), false, key);
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
    assert.equal(guessMessage("repeat", "4241524e"), "You've already tried 42 41 52 4E");
  });

  it("explains each kind of rejected word", () => {
    assert.equal(answerMessage("format", ""), "Type a 4-letter word, A to Z");
    assert.equal(answerMessage("notWord", "QXZJ"), "QXZJ isn't in the word list");
  });

  it("splits hex into uppercase byte pairs with single spaces", () => {
    assert.equal(bytePairs("4241524e"), "42 41 52 4E");
    assert.equal(bytePairs("5A"), "5A");
    assert.equal(bytePairs(""), "");
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
    assert.equal(statusLine("guess", 3), "4-letter word · row 4 of 6");
    assert.equal(statusLine("decode", 6), "Hex locked · all 6 rows used");
    assert.equal(statusLine("decode", 3, true), "4-letter word · hex solved");
    assert.equal(statusLine("decode", 6, true), "4-letter word · hex solved");
    assert.equal(statusLine("solved", 2, true), "4-letter word · solved");
    assert.equal(statusLine("failed", 2, true), "4-letter word · not decoded");
    assert.equal(statusLine("failed", 6, true), "4-letter word · not decoded");
    assert.equal(statusLine("failed", 6), "4-letter word · out of rows");
  });

  it('names a failed round "Not decoded" after a solved grid and "Out of rows" otherwise', () => {
    assert.equal(failedMessage(true), "Not decoded");
    assert.equal(failedMessage(false), "Out of rows");
  });
});

describe("GameController: How to play (page 5)", () => {
  const open: Action = { type: "openHowToPlay" };
  const close: Action = { type: "closeHowToPlay" };

  /** The view without `howToPlayOpen`: the game behind How to play. */
  function game(view: ScreenView): Omit<ScreenView, "howToPlayOpen"> {
    const { howToPlayOpen: _open, ...rest } = view;
    return rest;
  }

  /** A fresh harness after `actions`. */
  function after(...actions: Action[]): Harness {
    const h = harness();
    h.play(...actions);
    return h;
  }

  /** Every screen How to play can be opened from: all but the decode step (#53). */
  const screens: readonly (readonly [string, () => Harness])[] = [
    ["before the first round", () => harness(undefined, false)],
    ["row 1, nothing typed", () => harness()],
    ["a half-typed row", () => after(...guess("TEAM"), ...type("4259"))],
    ["a rejected row's error", () => after(...type("41414141"), { type: "enter" })],
    ["a scored row, hints on", () => after(toggleHints, ...guess("TEAM"), toggleHints)],
    ["row 6, typed but not entered", () => after(...ROW_WORDS.slice(0, 5).flatMap(guess), ...type(wordToHex("BYTE")))],
    ["the result card of a solved round", () => solvedAfter(0)],
    ["the result card of a failed round", () => failed()],
  ];

  it("is closed at the start", () => {
    assert.equal(harness().controller.view().howToPlayOpen, false);
  });

  for (const [name, setUp] of screens) {
    it(`opens from ${name}, leaving the game behind it unchanged`, () => {
      const h = setUp();
      const before = h.controller.view();
      const view = h.play(open);
      assert.equal(view.howToPlayOpen, true);
      assert.deepEqual(game(view), game(before));
    });

    it(`closes back to ${name} exactly as it was, message included`, () => {
      const h = setUp();
      const before = h.controller.view();
      const state = JSON.stringify(h.controller.savedState());
      const view = h.play(open, close);
      assert.equal(view.howToPlayOpen, false);
      assert.deepEqual(view, before);
      assert.equal(JSON.stringify(h.controller.savedState()), state);
    });

    it(`ignores every game move while open, from ${name}`, () => {
      const h = setUp();
      const before = h.controller.view();
      const state = JSON.stringify(h.controller.savedState());
      const posts = h.posts.length;
      h.play(open, ...type("4259"), { type: "delete" }, { type: "enter" }, decode("TEAM"), decode("BYTE"), toggleHints);
      assert.deepEqual(game(h.controller.view()), game(before));
      assert.equal(JSON.stringify(h.controller.savedState()), state);
      assert.equal(h.posts.length, posts, "no roundFinished");
    });
  }

  it("ignores exactly the player's game moves: init, New Round, open and close still apply", () => {
    const ignored = Object.entries(APPLIES_WHILE_HOW_TO_PLAY_OPEN)
      .filter(([, applies]) => !applies)
      .map(([type]) => type);
    assert.deepEqual(ignored.sort(), ["decode", "delete", "digit", "enter", "toggleHints"]);
  });

  it("stays open over a New Round from the command palette, which starts a round behind it", () => {
    const h = after(...guess("TEAM"), open);
    const view = h.play({ type: "newRound" });
    assert.equal(view.howToPlayOpen, true);
    assert.equal(view.status, "4-letter word · row 1 of 6");
    assert.equal(h.play(close).howToPlayOpen, false);
  });

  it("starts the first round behind it when init arrives while it's open", () => {
    const h = harness(undefined, false);
    h.play(open);
    const view = h.play({ type: "init" });
    assert.equal(view.howToPlayOpen, true);
    assert.equal(view.keypadEnabled, true);
  });

  it("opening twice or closing while closed changes nothing", () => {
    const h = harness();
    assert.equal(h.play(open, open).howToPlayOpen, true);
    assert.equal(h.play(close).howToPlayOpen, false);
    assert.equal(h.play(close).howToPlayOpen, false);
  });

  it("isn't saved, so a reload shows the game", () => {
    const h = after(...guess("TEAM"), open);
    const saved = h.saves.at(-1);
    assert.doesNotMatch(JSON.stringify(saved), /howToPlay/i);
    const view = harness(restoreSession(saved, WORDS), true).controller.view();
    assert.equal(view.howToPlayOpen, false);
    assert.equal(view.keypadEnabled, true, "the round in progress is restored");
    assert.equal(view.rows[0]?.[0]?.state, Wrong);
  });

  it("keeps the notice count when opened and closed, so a standing error isn't read out again", () => {
    const h = after(...type("41414141"), { type: "enter" });
    const { noticeId, message } = h.controller.view();
    const view = h.play(open, ...type("4"), close);
    assert.equal(view.noticeId, noticeId);
    assert.equal(view.message, message);
  });

  it("goes through changed() when opened and closed, saving the unchanged state", () => {
    const h = after(...type("42"));
    const before = h.saves.length;
    h.play(open, close);
    assert.equal(h.saves.length, before + 2);
    assert.deepEqual(h.saves.at(-1), h.saves.at(before - 1));
  });
});

describe("GameController: How to play locks at the decode step (#53)", () => {
  const open: Action = { type: "openHowToPlay" };
  const close: Action = { type: "closeHowToPlay" };

  /** The two ways into the decode step. */
  const decodeSteps: readonly (readonly [string, () => Harness])[] = [
    ["a solved grid at row 1", () => solvedGridAt(1)],
    ["a solved grid at row 6", () => solvedGridAt(6)],
    ["row 6 without a solved grid", () => atRowSix()],
  ];

  for (const [name, reach] of decodeSteps) {
    it(`locks the ? button after ${name}`, () => {
      const view = reach().controller.view();
      assert.equal(view.hexLocked, true);
      assert.equal(view.howToPlayLocked, true);
    });

    it(`ignores opening How to play after ${name}, through changed(), leaving the round as it was`, () => {
      const h = reach();
      const before = h.controller.view();
      const state = JSON.stringify(h.controller.savedState());
      for (let i = 0; i < 3; i++) {
        const count = h.saves.length;
        h.controller.dispatch(open);
        assert.equal(h.saves.length, count + 1, "changed() ran exactly once");
        assert.deepEqual(h.controller.view(), before);
      }
      assert.equal(h.controller.view().howToPlayOpen, false);
      assert.equal(JSON.stringify(h.controller.savedState()), state);
    });

    it(`stays locked after ${name} through rejected words, ignored moves and closing`, () => {
      const h = reach();
      const view = h.play(decode("QXZJ"), decode("B4"), ...type("42"), { type: "enter" }, toggleHints, close, open);
      assert.equal(view.howToPlayLocked, true);
      assert.equal(view.howToPlayOpen, false);
    });

    for (const [ending, word, outcome] of [
      ["solved", "BYTE", SOLVED_OUTCOME],
      ["failed", "BITE", FAILED_OUTCOME],
    ] as const) {
      it(`unlocks ? once the round after ${name} is ${ending}, and How to play opens`, () => {
        const h = reach();
        const view = h.play(decode(word));
        assert.equal(view.result?.outcome, outcome);
        assert.equal(view.howToPlayLocked, false);
        assert.equal(h.play(open).howToPlayOpen, true);
      });
    }

    it(`keeps ? locked when a round saved after ${name} is restored`, () => {
      const restored = reloaded(reach());
      const view = restored.controller.view();
      assert.equal(view.hexLocked, true);
      assert.equal(view.howToPlayLocked, true);
      assert.equal(restored.play(open).howToPlayOpen, false);
    });

    it(`unlocks ? when New Round replaces the round after ${name}`, () => {
      const view = reach().play({ type: "newRound" }, open);
      assert.equal(view.howToPlayLocked, false);
      assert.equal(view.howToPlayOpen, true);
    });
  }

  it("leaves ? unlocked before the decode step: before the first round, on every row 1 to 6, and with Hints on", () => {
    const h = harness(undefined, false);
    assert.equal(h.controller.view().howToPlayLocked, false, "before the first round");
    h.play({ type: "init" });
    for (const [row, word] of ROW_WORDS.entries()) {
      const view = h.controller.view();
      assert.equal(view.status, `4-letter word · row ${row + 1} of 6`);
      assert.equal(view.howToPlayLocked, false, `row ${row + 1}`);
      assert.equal(h.play(toggleHints, open).howToPlayOpen, true, `opens at row ${row + 1}`);
      h.play(close, toggleHints, ...guess(word));
    }
    assert.equal(h.controller.view().howToPlayLocked, true, "locked once row 6 is scored");
  });

  it("leaves ? unlocked after a rejected row before the decode step", () => {
    const view = harness().play(...type("41414141"), { type: "enter" });
    assert.equal(view.messageIsError, true);
    assert.equal(view.howToPlayLocked, false);
  });

  for (const [name, rowsBefore, last] of [
    ["a fully right row 1", [] as readonly string[], "BYTE"],
    ["a fully right row 6", ROW_WORDS.slice(0, 5), "BYTE"],
    ["row 6 without a solved grid", ROW_WORDS.slice(0, 5), "BITE"],
  ] as const) {
    it(`can't start the decode step with ${name} while How to play is open: ENTER is ignored`, () => {
      const h = harness();
      for (const word of rowsBefore) {
        h.play(...guess(word));
      }
      h.play(...type(wordToHex(last)));
      const state = JSON.stringify(h.controller.savedState());
      const posts = h.posts.length;
      const view = h.play(open, { type: "enter" });
      assert.equal(view.howToPlayOpen, true);
      assert.equal(view.hexLocked, false);
      assert.equal(view.howToPlayLocked, false);
      assert.equal(JSON.stringify(h.controller.savedState()), state, "the row wasn't scored");
      assert.equal(h.posts.length, posts);
      // Back on the game, the same ENTER scores the row and locks `?`.
      const after = h.play(close, { type: "enter" });
      assert.equal(after.hexLocked, true);
      assert.equal(after.howToPlayLocked, true);
    });
  }

  it("isn't saved: the saved state has no How to play field at the decode step", () => {
    const h = solvedGridAt(2);
    h.play(open);
    assert.doesNotMatch(JSON.stringify(h.saves.at(-1)), /howToPlay/i);
  });

  it("agrees with isHexLocked in every view: locked exactly at the decode step", () => {
    for (const h of [harness(undefined, false), harness(), solvedGridAt(3), atRowSix(), solvedAfter(1), failed()]) {
      const view = h.controller.view();
      assert.equal(view.howToPlayLocked, view.hexLocked);
      assert.equal(view.howToPlayLocked, isHexLocked(h.session.round?.phase ?? null));
    }
  });
});

describe("howToPlayActionForKey", () => {
  it("closes How to play on Escape", () => {
    assert.deepEqual(howToPlayActionForKey(press("Escape")), { type: "closeHowToPlay" });
  });

  it("leaves Escape with Ctrl, Cmd or Alt alone", () => {
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      assert.equal(howToPlayActionForKey(press("Escape", { [modifier]: true })), null, modifier);
    }
  });

  it("sends no other key to the game: hex digits, letters, Backspace, Enter, Space, Tab", () => {
    for (const key of [..."0123456789abcdefABCDEFxyzXYZ", "Backspace", "Enter", " ", "Tab", "Delete"]) {
      assert.equal(howToPlayActionForKey(press(key)), null, key);
    }
  });
});
