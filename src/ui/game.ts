// The game screen's logic: the actions a player can take, what each one does
// to the session, the messages it shows, and a render model for the DOM layer
// (media/main.ts) to draw. Pure: no DOM and no `vscode`, so it can be
// unit-tested with `node --test`. While a round is in progress the model never
// contains the answer, only the letters of bytes the player has fully decoded,
// while hints are on. The answer joins it only once the round is over, in the
// result card (`result`).
import type { GuessError } from "../game/guess.ts";
import { HEX_LENGTH, WORD_LENGTH, hexToWord, wordToHex } from "../game/hex.ts";
import { MAX_ROWS, type Phase, type Round, type RoundResult, type Row } from "../game/round.ts";
import { Mark } from "../game/score.ts";
import type { Session, SessionState } from "../game/session.ts";
import type { RoundFinishedMessage } from "../protocol.ts";

/** Everything a player (or the host) can do to the game screen. */
export type Action =
  | { readonly type: "init" } // the host answered `ready`: start round 1 unless one was restored
  | { readonly type: "newRound" } // the host's `newRound`
  | { readonly type: "digit"; readonly digit: string } // one hex digit, from the keypad or keyboard
  | { readonly type: "delete" } // DEL or Backspace
  | { readonly type: "enter" } // ENTER: submit the typed hex row
  | { readonly type: "decode"; readonly word: string } // the word typed in the decode box
  | { readonly type: "toggleHints" }; // the Hints button: turn hints on or off

export type ActionType = Action["type"];

/** The keypad's digits, in order: `0 1 2 3` / `4 5 6 7` / `8 9 A B` / `C D E F`. */
export const HEX_DIGITS = [..."0123456789ABCDEF"];

/** How each mark is named in text, so colour is never the only cue. */
export const MARK_NAMES: Readonly<Record<Mark, string>> = {
  [Mark.Right]: "Right spot",
  [Mark.Wrong]: "Wrong spot",
  [Mark.Absent]: "Not in word",
};

/** A grid tile: empty, typed but not yet scored, or scored with a mark. */
export type TileState = "empty" | "typed" | Mark;

export interface Tile {
  /** The hex digit, or "" for an empty tile. */
  readonly digit: string;
  readonly state: TileState;
}

export interface Key {
  readonly digit: string;
  /** The best mark this digit has had in any row, or null if not played yet. */
  readonly mark: Mark | null;
  /** The key's accessible name, e.g. "7, not in word". */
  readonly label: string;
}

export interface TriedWord {
  readonly word: string;
  /** Read out instead of the struck-through word, e.g. "BEAT, wrong". */
  readonly label: string;
}

/** The decode panel's text: page 1's decode panel, or page 3's final-answer card. */
export interface DecodePanel {
  /** The heading, which is also the text box's label. */
  readonly heading: string;
  /** Top right of the panel, or "" for none. */
  readonly badge: string;
  readonly placeholder: string;
  readonly button: string;
  /** Under the text box, on the left. */
  readonly note: string;
}

/** The decode panel after rows 1–5 (page 1). */
export const DECODE_PANEL: DecodePanel = {
  heading: "Decode the word",
  badge: "",
  placeholder: "Type the English word",
  button: "Decode",
  note: "1 try per row",
};

/** The final-answer card once the hex is locked (page 3). */
export const FINAL_PANEL: DecodePanel = {
  heading: "Final answer",
  badge: "Last try",
  placeholder: "Decode the bytes above",
  button: "Submit",
  note: "Type with your keyboard",
};

/** The status line while the hex is locked (page 3), after the lock icon. */
export const HEX_LOCKED_STATUS = `Hex locked · all ${MAX_ROWS} rows used`;

/** Added to the row 6 announcement, since the lock icon and dimming aren't read out. */
export const FINAL_ANSWER_DUE = "Hex locked: one final answer";

/** The Hints button's text. */
export const HINTS_BUTTON = "Hints";

/** A hint cell whose byte isn't fully decoded yet. */
export const HINT_UNKNOWN = "?";

/** The result card's only button (page 4). Copy result is on hold (#24). */
export const NEW_ROUND_BUTTON = "New round";

/** Under the result card, in muted text (page 4). */
export const RESULT_NOTE = "Your agent is still working. Next round is ready when you are.";

/** One byte of the decoded word on the result card: `42`, a down arrow, `B`. */
export interface ResultByte {
  /** The byte's two hex digits, e.g. "42". */
  readonly hex: string;
  /** Its letter, e.g. "B". */
  readonly letter: string;
  /** Read out instead of the drawn tile, e.g. "42 is B". */
  readonly label: string;
}

/** The result card that replaces the decode panel and keypad once the round is over (page 4). */
export interface ResultView {
  /** "Decoded: BYTE" for a solved round, "The word was BYTE" for a failed one. */
  readonly heading: string;
  /** E.g. "3 of 6 rows attempted · no hints" or "6 of 6 rows attempted · hints used". */
  readonly line: string;
  /** One tile per byte of the answer, in order. */
  readonly bytes: readonly ResultByte[];
  readonly button: string;
  /** Under the card. */
  readonly note: string;
}

/** One cell of the hint strip: a byte's letter, or `HINT_UNKNOWN`. */
export interface HintCell {
  /** The letter, or `HINT_UNKNOWN` if the byte isn't fully decoded. */
  readonly text: string;
  /** True if the letter isn't known yet: drawn muted. */
  readonly unknown: boolean;
}

/**
 * The Hints button and the hint strip (page 2). Hints are unlimited and
 * purely the player's choice: there is no count or limit to show.
 */
export interface HintsView {
  /** The Hints button is shown: only while a round is in progress. */
  readonly available: boolean;
  /** Hints are on: the button is pressed (`aria-pressed`) and the strip shows. */
  readonly on: boolean;
  /** One cell per byte while hints are on; empty while they're off. */
  readonly cells: readonly HintCell[];
  /** The strip as read out, e.g. "Hints: B, unknown, T, E"; "" while off. */
  readonly label: string;
}

/** Everything the DOM layer needs to draw the screen. */
export interface ScreenView {
  /** E.g. "4-letter word · row 2 of 6". */
  readonly status: string;
  /** `MAX_ROWS` rows of `HEX_LENGTH` tiles. */
  readonly rows: readonly (readonly Tile[])[];
  /** The 16 keypad keys in `HEX_DIGITS` order. */
  readonly keys: readonly Key[];
  /** The keypad, DEL and ENTER take input: only while a hex row is being typed. */
  readonly keypadEnabled: boolean;
  /** A row was scored and its one word attempt is due: the decode box is open. */
  readonly wordAttemptDue: boolean;
  /**
   * All `MAX_ROWS` rows are scored and the round isn't over: the hex is
   * locked and the one final answer is due (page 3). The status line shows
   * the lock icon, and the grid and keypad are dimmed.
   */
  readonly hexLocked: boolean;
  /** The decode panel's text: the final-answer card while `hexLocked`. */
  readonly panel: DecodePanel;
  /** The Hints button and strip. */
  readonly hints: HintsView;
  /** The wrong words tried so far, one per finished row. */
  readonly tried: readonly TriedWord[];
  /**
   * The result card once the round is over, or null while it's in progress
   * and before the first round. The only part of the view that holds the
   * answer, so the answer is never drawn while it's still hidden.
   */
  readonly result: ResultView | null;
  /** Plain text: why the last action was rejected, what happened, or how the round ended. */
  readonly message: string;
  /** True if `message` says why an action was rejected. */
  readonly messageIsError: boolean;
}

/** A message for the player, and whether it reports a rejected action. */
interface Notice {
  readonly text: string;
  readonly error: boolean;
}

const NO_NOTICE: Notice = { text: "", error: false };

function rejected(text: string): Notice {
  return { text, error: true };
}

/**
 * Saves `savedState()`, posts `finished` to the host if it isn't null, and
 * draws `view()`: `changed()` in media/main.ts.
 */
export type Changed = (finished: RoundFinishedMessage | null) => void;

/**
 * Runs the game screen for one session. Every action goes through `dispatch`,
 * which ends by calling `changed` (save and redraw), so no move is lost when
 * the panel is hidden.
 */
export class GameController {
  readonly #session: Session;
  readonly #changed: Changed;
  /** The last action's message. Not saved: it's gone after a reload. */
  #notice = NO_NOTICE;

  constructor(session: Session, changed: Changed) {
    this.#session = session;
    this.#changed = changed;
  }

  /**
   * The one way to change the game. Always ends with `changed`, even if the
   * action was ignored. If the round has just ended, and hasn't been reported
   * yet, `changed` gets the `roundFinished` message to post: this happens
   * once per finished round, and the saved state already says it was sent.
   */
  dispatch(action: Action): void {
    this.#notice = this.#apply(action);
    const result = this.#session.takeResult();
    this.#changed(result ? { type: "roundFinished", ...result } : null);
  }

  /** What to save: the session with its round and draft, or null before the first round. */
  savedState(): SessionState | null {
    return this.#session.toState();
  }

  /** The screen as it is now. */
  view(): ScreenView {
    const round = this.#session.round;
    const phase: Phase | null = round?.phase ?? null;
    const rows = round?.rows ?? [];
    const answers = round?.answers ?? [];
    const hexLocked = isHexLocked(phase, rows.length);
    // The last answer of a solved round is the right one, not a tried word.
    const wrong = phase === "solved" ? answers.slice(0, -1) : answers;
    // Solved and out of rows come from the phase, so they survive a reload.
    const notice: Notice =
      phase === "solved"
        ? { text: "Solved", error: false }
        : phase === "failed"
          ? { text: "Out of rows", error: false }
          : this.#notice;
    return {
      status: statusLine(phase, rows.length),
      rows: gridTiles(rows, phase === "guess" ? this.#session.draft : ""),
      keys: keypad(rows),
      keypadEnabled: phase === "guess",
      wordAttemptDue: phase === "answer" || phase === "final",
      hexLocked,
      panel: hexLocked ? FINAL_PANEL : DECODE_PANEL,
      hints: hintsView(round && !round.isOver ? round : null),
      tried: wrong.map((word) => ({ word, label: `${word}, wrong` })),
      result: round?.isOver ? resultView(round.result()) : null,
      message: notice.text,
      messageIsError: notice.error,
    };
  }

  /** Does the action and returns the message to show. */
  #apply(action: Action): Notice {
    const session = this.#session;
    switch (action.type) {
      case "init":
        session.ensureRound();
        return NO_NOTICE;
      case "newRound":
        session.newRound();
        return NO_NOTICE;
      case "digit": {
        const digit = action.digit.toUpperCase();
        if (this.#typing() && /^[0-9A-F]$/.test(digit) && session.draft.length < HEX_LENGTH) {
          session.setDraft(session.draft + digit);
        }
        return NO_NOTICE;
      }
      case "delete":
        if (this.#typing()) {
          session.setDraft(session.draft.slice(0, -1));
        }
        return NO_NOTICE;
      case "enter": {
        if (!this.#typing()) {
          return NO_NOTICE;
        }
        const draft = session.draft;
        const outcome = session.submitDraft();
        if (!outcome.ok) {
          return rejected(guessMessage(outcome.error, draft));
        }
        // Read out by the live region, since focus moves to the decode box.
        const rowsUsed = session.round?.rows.length ?? 0;
        const scored = scoredMessage(rowsUsed, outcome.row.marks);
        return { text: rowsUsed === MAX_ROWS ? `${scored}. ${FINAL_ANSWER_DUE}` : scored, error: false };
      }
      case "decode":
        return this.#decode(action.word);
      case "toggleHints": {
        // Any number of times while the round is in progress, word attempt
        // and final answer included. Ignored before a round and once it's over.
        const round = session.round;
        if (round && !round.isOver) {
          if (round.hintsShown) {
            round.disableHints();
          } else {
            round.enableHints();
          }
        }
        return NO_NOTICE;
      }
    }
  }

  /** True while the round is waiting for a hex row. */
  #typing(): boolean {
    return this.#session.round?.phase === "guess";
  }

  #decode(input: string): Notice {
    const round = this.#session.round;
    if (!round || (round.phase !== "answer" && round.phase !== "final")) {
      return NO_NOTICE;
    }
    const outcome = round.submitAnswer(input);
    const word = input.trim().toUpperCase();
    if (!outcome.ok) {
      return rejected(
        outcome.error === "format" ? `Type a ${WORD_LENGTH}-letter word, A to Z` : `${word} isn't in the word list`,
      );
    }
    // Solved and out of rows are shown by `view` from the phase.
    if (round.isOver) {
      return NO_NOTICE;
    }
    return { text: `${word} isn't the word. On to row ${round.rows.length + 1}.`, error: false };
  }
}

/** Why a full hex row was rejected, in plain text. */
export function guessMessage(error: GuessError, hex: string): string {
  switch (error) {
    case "length":
      return "Not enough digits";
    case "notHex":
      return "Use only the digits 0–9 and A–F";
    case "notLetter": {
      const byte = firstNonLetterByte(hex);
      return byte ? `${byte} isn't a letter` : "Every byte must be a letter, 41 to 5A";
    }
    case "notWord": {
      const word = hexToWord(hex);
      return word ? `${word} isn't in the word list` : "That isn't in the word list";
    }
  }
}

/** A scored row in words, e.g. "Row 1: 1 right spot, 4 wrong spot, 3 not in word". */
export function scoredMessage(rowNumber: number, marks: readonly Mark[]): string {
  const counts = MARK_RANK.map((mark) => `${marks.filter((m) => m === mark).length} ${MARK_NAMES[mark]}`);
  return `Row ${rowNumber}: ${counts.join(", ")}`;
}

/** The first byte (two hex digits) that isn't a capital letter 41–5A, or null. */
export function firstNonLetterByte(hex: string): string | null {
  for (let i = 0; i + 2 <= hex.length; i += 2) {
    const byte = hex.slice(i, i + 2).toUpperCase();
    const code = Number.parseInt(byte, 16);
    if (!/^[0-9A-F]{2}$/.test(byte) || code < 0x41 || code > 0x5a) {
      return byte;
    }
  }
  return null;
}

/**
 * True once all `MAX_ROWS` rows are scored and the round isn't over: the hex
 * is locked and the final answer is due. The one place this rule lives, so
 * the status line, the card and the keypad always agree. Keyed off the rows,
 * not the phase name, so it holds however rows 1–5 end.
 */
export function isHexLocked(phase: Phase | null, rowsUsed: number): boolean {
  return phase !== null && phase !== "solved" && phase !== "failed" && rowsUsed === MAX_ROWS;
}

/** The status line under the title: see `isHexLocked` for the locked one. */
export function statusLine(phase: Phase | null, rowsUsed: number): string {
  if (isHexLocked(phase, rowsUsed)) {
    return HEX_LOCKED_STATUS;
  }
  switch (phase) {
    case null:
      return `${WORD_LENGTH}-letter word`;
    case "solved":
      return `${WORD_LENGTH}-letter word · solved`;
    case "failed":
      return `${WORD_LENGTH}-letter word · not solved`;
    case "guess":
      return `${WORD_LENGTH}-letter word · row ${rowsUsed + 1} of ${MAX_ROWS}`;
    case "answer":
    case "final":
      // The row just scored, whose word attempt is due.
      return `${WORD_LENGTH}-letter word · row ${rowsUsed} of ${MAX_ROWS}`;
  }
}

/**
 * The result card for a finished round (page 4): the word, the rows used and
 * whether hints were used, and each byte with its letter. There is no
 * answer-tries count: it always equals the rows used.
 */
export function resultView(result: RoundResult): ResultView {
  const word = result.answer;
  const hex = wordToHex(word);
  return {
    heading: result.solved ? `Decoded: ${word}` : `The word was ${word}`,
    line: `${result.rowsUsed} of ${MAX_ROWS} rows attempted · ${result.hintsUsed ? "hints used" : "no hints"}`,
    bytes: [...word].map((letter, i) => {
      const byte = hex.slice(i * 2, i * 2 + 2);
      return { hex: byte, letter, label: `${byte} is ${letter}` };
    }),
    button: NEW_ROUND_BUTTON,
    note: RESULT_NOTE,
  };
}

/**
 * The Hints button and strip for a round in progress, or for `null` (no
 * round yet, or the round is over), when the button is hidden.
 */
export function hintsView(round: Round | null): HintsView {
  if (!round) {
    return { available: false, on: false, cells: [], label: "" };
  }
  if (!round.hintsShown) {
    return { available: true, on: false, cells: [], label: "" };
  }
  const letters = round.hintLetters();
  return {
    available: true,
    on: true,
    cells: letters.map((letter) => ({ text: letter ?? HINT_UNKNOWN, unknown: letter === null })),
    label: `${HINTS_BUTTON}: ${letters.map((letter) => letter ?? "unknown").join(", ")}`,
  };
}

/** All `MAX_ROWS` grid rows: the scored rows, then the draft, then empty rows. */
export function gridTiles(rows: readonly Row[], draft: string): Tile[][] {
  const grid: Tile[][] = [];
  for (let r = 0; r < MAX_ROWS; r++) {
    const row = rows[r];
    const tiles: Tile[] = [];
    for (let i = 0; i < HEX_LENGTH; i++) {
      const mark = row?.marks[i];
      const typed = r === rows.length ? draft[i] : undefined;
      if (row && mark) {
        tiles.push({ digit: row.hex[i] ?? "", state: mark });
      } else if (typed) {
        tiles.push({ digit: typed, state: "typed" });
      } else {
        tiles.push({ digit: "", state: "empty" });
      }
    }
    grid.push(tiles);
  }
  return grid;
}

/** Marks from best to worst: a key shows the best one its digit has had. */
const MARK_RANK: readonly Mark[] = [Mark.Right, Mark.Wrong, Mark.Absent];

/** The 16 keypad keys, each with the best mark its digit has had in `rows`. */
export function keypad(rows: readonly Row[]): Key[] {
  const best = new Map<string, Mark>();
  for (const row of rows) {
    row.marks.forEach((mark, i) => {
      const digit = row.hex[i];
      const current = digit === undefined ? undefined : best.get(digit);
      if (digit !== undefined && (current === undefined || MARK_RANK.indexOf(mark) < MARK_RANK.indexOf(current))) {
        best.set(digit, mark);
      }
    });
  }
  return HEX_DIGITS.map((digit) => {
    const mark = best.get(digit) ?? null;
    return { digit, mark, label: mark ? `${digit}, ${MARK_NAMES[mark]}` : digit };
  });
}

/** Where keyboard focus is when a key is pressed. */
export type KeyFocus =
  | "decodeBox" // the decode text box: it gets every key
  | "control" // a button: Enter and Space press it
  | "page"; // anywhere else

/** The parts of a `KeyboardEvent` that decide what a key does. */
export interface KeyPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/**
 * The action for a physical key, or null to leave the key alone. Hex digits
 * (either case), Backspace and Enter drive the grid, but never while the
 * decode box has focus, and Enter is left to a focused button. Shortcuts with
 * Ctrl, Cmd or Alt are never taken. While a word attempt is due the
 * controller ignores grid actions, so typed hex never reaches the grid.
 */
export function actionForKey(press: KeyPress, focus: KeyFocus): Action | null {
  if (focus === "decodeBox" || press.ctrlKey || press.metaKey || press.altKey) {
    return null;
  }
  if (/^[0-9a-fA-F]$/.test(press.key)) {
    return { type: "digit", digit: press.key.toUpperCase() };
  }
  if (press.key === "Backspace") {
    return { type: "delete" };
  }
  if (press.key === "Enter" && focus === "page") {
    return { type: "enter" };
  }
  return null;
}

/**
 * True if a key typed while a word attempt is due should go to the decode
 * box, which then needs focus first: a single printable character, with no
 * Ctrl, Cmd or Alt, typed outside the box. A space on a focused button is
 * left to press that button. The caller focuses the box and lets the key's
 * default go ahead, so the character lands in the box instead of being lost.
 */
export function shouldFocusDecodeBox(press: KeyPress, focus: KeyFocus, wordAttemptDue: boolean): boolean {
  if (!wordAttemptDue || focus === "decodeBox" || press.ctrlKey || press.metaKey || press.altKey) {
    return false;
  }
  // Named keys ("Enter", "Tab", "F1"…) are longer than one character.
  if ([...press.key].length !== 1 || /\p{Cc}/u.test(press.key)) {
    return false;
  }
  return !(press.key === " " && focus === "control");
}
