// The game screen's logic: the actions a player can take, what each one does
// to the session, the messages it shows, and a render model for the DOM layer
// (media/main.ts) to draw. Pure: no DOM and no `vscode`, so it can be
// unit-tested with `node --test`. While a round is in progress the model never
// contains the answer, only the letters of bytes the player has fully decoded,
// while hints are on. The answer joins it only once the round is over, in the
// result card (`result`).
import { HEX_LENGTH, WORD_LENGTH, hexToWord, wordToHex } from "../game/hex.ts";
import {
  MAX_ROWS,
  type AnswerError,
  type Phase,
  type Round,
  type RoundResult,
  type Row,
  type RowError,
} from "../game/round.ts";
import { Mark } from "../game/score.ts";
import type { Rejection, Session, SessionState } from "../game/session.ts";
import type { RoundFinishedMessage } from "../protocol.ts";

/** Everything a player (or the host) can do to the game screen. */
export type Action =
  | { readonly type: "init" } // the host answered `ready`: start round 1 unless one was restored
  | { readonly type: "newRound" } // the host's `newRound`
  | { readonly type: "digit"; readonly digit: string } // one hex digit, from the keypad or keyboard
  | { readonly type: "delete" } // DEL or Backspace
  | { readonly type: "enter" } // ENTER: submit the typed hex row
  | { readonly type: "decode"; readonly word: string } // the word typed in the decode box
  | { readonly type: "toggleHints" } // the Hints button: turn hints on or off
  | { readonly type: "openHowToPlay" } // the `?` button: show How to play over the game
  | { readonly type: "closeHowToPlay" }; // the back arrow or Escape: back to the game

export type ActionType = Action["type"];

/**
 * Whether each action applies while How to play is open. The player's moves
 * in the round are ignored; the host's `init` and `newRound` still apply, so
 * New Round from the command palette starts a round behind How to play.
 * `satisfies` makes every new action type declare its entry here.
 */
export const APPLIES_WHILE_HOW_TO_PLAY_OPEN = {
  init: true,
  newRound: true,
  digit: false,
  delete: false,
  enter: false,
  decode: false,
  toggleHints: false,
  openHowToPlay: true,
  closeHowToPlay: true,
} as const satisfies Readonly<Record<ActionType, boolean>>;

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

/**
 * The decode panel before the decode step (page 1), drawn faded and disabled
 * under the lock (pages L1 and L2). Page 1's note "1 try per row" is left
 * out: there is one try per round (#46).
 */
export const DECODE_PANEL: DecodePanel = {
  heading: "Decode the word",
  badge: "",
  placeholder: "Type the English word",
  button: "Decode",
  note: "",
};

/** The final-answer card at the decode step (page 3, and page L3 after a solved grid). */
export const FINAL_PANEL: DecodePanel = {
  heading: "Final answer",
  badge: "Last try",
  placeholder: "Decode the bytes above",
  button: "Submit",
  note: "Type with your keyboard",
};

/** The lock over the decode panel before the decode step (pages L1 and L2): its title. */
export const DECODE_LOCKED_TITLE = "Locked until you crack the hex row";

/** The lock's message, under its title (the owner's wording: "tile", not the draft's "digit"). */
export const DECODE_LOCKED_MESSAGE = "Get every tile blue to unlock Decode.";

/** The status line at the decode step after row 6 without a solved grid (page 3), after the lock icon. */
export const HEX_LOCKED_STATUS = `Hex locked · all ${MAX_ROWS} rows used`;

/** The status line at the decode step after a fully right row (page L3). */
export const HEX_SOLVED_STATUS = `${WORD_LENGTH}-letter word · hex solved`;

/** Added to the announcement of row 6 when it isn't fully right, since the lock icon and dimming aren't read out. */
export const FINAL_ANSWER_DUE = "Hex locked: one final answer";

/** Added to a fully right row's announcement: the hex locks and the decode panel unlocks. */
export const HEX_SOLVED_DUE = "Hex solved: decode the word, one try";

/** The Hints button's text. */
export const HINTS_BUTTON = "Hints";

/** The locked Hints button's accessible description (page L3). */
export const HINTS_LOCKED_NOTE = "Locked for the rest of the round";

/** A hint cell whose byte isn't fully decoded yet. */
export const HINT_UNKNOWN = "?";

/** The result card's only button (page 4). Copy result is on hold (#24). */
export const NEW_ROUND_BUTTON = "New round";

/** Under the result card, in muted text (page 4). */
export const RESULT_NOTE = "Your agent is still working. Next round is ready when you are.";

/** The message for a solved round: read out, since the result card replaces the message line. */
export const SOLVED_MESSAGE = "Solved";

/** The message for a failed round, likewise. */
export const FAILED_MESSAGE = "Not solved";

/** The line above the result card's heading for a solved round (the owner's wording). */
export const SOLVED_OUTCOME = "Congrats! You cracked it";

/** The line above the result card's heading for a failed round (the owner's wording). */
export const FAILED_OUTCOME = "Unlucky!";

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
  /** Above the heading: `SOLVED_OUTCOME` or `FAILED_OUTCOME`. Not on page 4. */
  readonly outcome: string;
  /** "Decoded: BYTE" for a solved round, "The word was BYTE" for a failed one. */
  readonly heading: string;
  /** E.g. "3 of 6 rows attempted · 2 hints used", "1 hint used" or "0 hints used". */
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
 * purely the player's choice until the hex locks. The round counts them for
 * the result, but there is no count or limit to show while it's in
 * progress (#38).
 */
export interface HintsView {
  /** The Hints button is shown: only while a round is in progress. */
  readonly available: boolean;
  /**
   * The hex is locked (the decode step), so Hints is off and can't be turned
   * on again this round: the button is disabled, with a lock icon (page L3).
   */
  readonly locked: boolean;
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
  /** The keypad, DEL and ENTER take input: while the round waits for a hex row, so until the decode step. */
  readonly keypadEnabled: boolean;
  /** The decode box and its button take input: at the decode step only. */
  readonly decodeAvailable: boolean;
  /**
   * The decode panel is locked: before the decode step, from the very start
   * of the round (and before the first round). It's drawn faded and
   * disabled, under a lock badge, `DECODE_LOCKED_TITLE` and
   * `DECODE_LOCKED_MESSAGE` (pages L1 and L2).
   */
  readonly decodeLocked: boolean;
  /**
   * The decode step: the hex is locked and the one try is due. The keypad is
   * dimmed, the decode panel is the final-answer card, and it takes focus
   * (pages 3 and L3).
   */
  readonly hexLocked: boolean;
  /**
   * The decode step after row 6 without a solved grid (page 3): the status
   * line shows the lock icon and the grid is dimmed too. After a solved grid
   * (page L3) neither is.
   */
  readonly outOfRows: boolean;
  /** The decode panel's text: the final-answer card while `hexLocked`. */
  readonly panel: DecodePanel;
  /** The Hints button and strip. */
  readonly hints: HintsView;
  /**
   * The result card once the round is over, or null while it's in progress
   * and before the first round. The only part of the view that holds the
   * answer, so the answer is never drawn while it's still hidden.
   */
  readonly result: ResultView | null;
  /**
   * Plain text: why the last action was rejected, or how the round ended.
   * Both come back after the panel is hidden and shown: a rejection is
   * rebuilt from the session's saved `rejection`, the ending from the phase.
   */
  readonly message: string;
  /**
   * Plain text for screen readers only, in a visually hidden live region:
   * the scored row's marks ("Row 2: 4 Right spot, …"), and the decode step
   * when that row opens it. The tile colours show these on screen (owner's
   * decision, #30).
   */
  readonly announcement: string;
  /** True if `message` says why an action was rejected. */
  readonly messageIsError: boolean;
  /**
   * Goes up each time an action sets a new message, even one with the same
   * text, such as the same error twice. It stays the same for actions that
   * leave the message alone, such as opening and closing How to play. The
   * DOM layer reads an unchanged error out again only when this changed.
   */
  readonly noticeId: number;
  /**
   * How to play (page 5) is open in place of the game, which is left as it
   * was. While it's open the controller ignores every game move.
   */
  readonly howToPlayOpen: boolean;
}

/**
 * A message for the player, whether it reports a rejected action, and what
 * only screen readers hear. The only on-screen text a notice holds is a
 * rejection's message, so `rejection` is all of it that needs saving.
 */
interface Notice {
  readonly text: string;
  readonly error: boolean;
  readonly announcement: string;
  /** The rejected move the text describes, saved with the session; null for none. */
  readonly rejection: Rejection | null;
}

const NO_NOTICE: Notice = { text: "", error: false, announcement: "", rejection: null };

/** The error message for a rejected move, rebuilt from its data alone. */
function rejected(rejection: Rejection): Notice {
  return { text: rejectionMessage(rejection), error: true, announcement: "", rejection };
}

/** Nothing on screen: `announcement` is read out only. */
function announced(announcement: string): Notice {
  return { text: "", error: false, announcement, rejection: null };
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
  /**
   * The last action's message. Its rejection is saved with the session, so
   * an error message comes back after a reload; a screen-reader-only
   * announcement doesn't.
   */
  #notice: Notice;
  /** Counts the actions that set a new notice: see `ScreenView.noticeId`. */
  #noticeId = 0;
  /** How to play is open. Not saved: a reload shows the game. */
  #howToPlayOpen = false;

  constructor(session: Session, changed: Changed) {
    this.#session = session;
    this.#changed = changed;
    // A restored session brings back the message of its last rejected move.
    this.#notice = session.rejection ? rejected(session.rejection) : NO_NOTICE;
  }

  /**
   * The one way to change the game. Always ends with `changed`, even if the
   * action was ignored. If the round has just ended, and hasn't been reported
   * yet, `changed` gets the `roundFinished` message to post: this happens
   * once per finished round, and the saved state already says it was sent.
   */
  dispatch(action: Action): void {
    const notice = this.#apply(action);
    // An action that leaves the message alone returns the same notice.
    if (notice !== this.#notice) {
      this.#noticeId++;
    }
    this.#notice = notice;
    // Saved by `changed`, so the message survives the panel being hidden.
    // `setRejection` throws only for a rejection the round doesn't reject
    // now, which can't happen here: a new rejection comes straight from the
    // move the round just rejected, and an action that keeps the old notice
    // changes nothing in the session (every session method that does clears
    // the rejection, and those actions always return a new notice).
    this.#session.setRejection(notice.rejection);
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
    const hexLocked = isHexLocked(phase);
    const hexSolved = round?.hexSolved ?? false;
    // Solved and not solved come from the phase, so they survive a reload. A
    // failed round may have rows left (a wrong word after a solved grid), so
    // it says "Not solved" rather than that the rows ran out.
    const notice: Notice =
      phase === "solved"
        ? { text: SOLVED_MESSAGE, error: false, announcement: "", rejection: null }
        : phase === "failed"
          ? { text: FAILED_MESSAGE, error: false, announcement: "", rejection: null }
          : this.#notice;
    return {
      status: statusLine(phase, rows.length, hexSolved),
      rows: gridTiles(rows, phase === "guess" ? this.#session.draft : ""),
      keys: keypad(rows),
      keypadEnabled: phase === "guess",
      decodeAvailable: round?.canDecode ?? false,
      decodeLocked: phase === null || phase === "guess",
      hexLocked,
      outOfRows: hexLocked && !hexSolved,
      panel: hexLocked ? FINAL_PANEL : DECODE_PANEL,
      hints: hintsView(round && !round.isOver ? round : null),
      result: round?.isOver ? resultView(round.result()) : null,
      message: notice.text,
      messageIsError: notice.error,
      announcement: notice.announcement,
      noticeId: this.#noticeId,
      howToPlayOpen: this.#howToPlayOpen,
    };
  }

  /** Does the action and returns the message to show. */
  #apply(action: Action): Notice {
    const session = this.#session;
    // While How to play is open, game moves are ignored and the last message
    // stays, so the game comes back exactly as it was left.
    if (this.#howToPlayOpen && !APPLIES_WHILE_HOW_TO_PLAY_OPEN[action.type]) {
      return this.#notice;
    }
    switch (action.type) {
      case "openHowToPlay":
        this.#howToPlayOpen = true;
        return this.#notice;
      case "closeHowToPlay":
        this.#howToPlayOpen = false;
        return this.#notice;
      case "init":
        // A restored round keeps its restored message, which isn't new.
        return session.ensureRound() ? NO_NOTICE : this.#notice;
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
          // The digits stay typed, so the draft is the rejected row.
          return rejected({ kind: "row", error: outcome.error, hex: draft });
        }
        // Read out only: on screen, the tile colours show the marks. A fully
        // right row or row 6 also locked the hex, and Hints with it, in the
        // round itself, so that is saved by this same `changed()`.
        const round = session.round;
        const scored = scoredMessage(round?.rows.length ?? 0, outcome.row.marks);
        if (!round?.canDecode) {
          return announced(scored);
        }
        return announced(`${scored}. ${round.hexSolved ? HEX_SOLVED_DUE : FINAL_ANSWER_DUE}`);
      }
      case "decode":
        return this.#decode(action.word);
      case "toggleHints": {
        // Any number of times until the hex locks. Ignored before a round,
        // and from the decode step on (`hintsLocked`). The automatic
        // switch-off comes with a scored row (`enter`).
        const round = session.round;
        if (round && !round.hintsLocked) {
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
    // Only at the decode step; ignored before it (the panel is locked) and
    // once the round is over.
    if (!this.#session.round?.canDecode) {
      return NO_NOTICE;
    }
    const outcome = this.#session.submitAnswer(input);
    if (!outcome.ok) {
      // The format message doesn't name the input, so none of it is kept.
      const word = outcome.error === "format" ? "" : input.trim().toUpperCase();
      return rejected({ kind: "word", error: outcome.error, word });
    }
    // The one try ended the round: solved or failed is shown by `view` from the phase.
    return NO_NOTICE;
  }
}

/** A rejected move's message, in plain text. */
export function rejectionMessage(rejection: Rejection): string {
  return rejection.kind === "row" ? guessMessage(rejection.error, rejection.hex) : answerMessage(rejection.error, rejection.word);
}

/** Why a full hex row was rejected, in plain text. */
export function guessMessage(error: RowError, hex: string): string {
  switch (error) {
    case "repeat":
      // The guess in byte pairs, as the grid groups them: "42 41 52 4E".
      return `You've already tried ${bytePairs(hex)}`;
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

/** Hex digits uppercased and split into byte pairs with single spaces: "4241524e" → "42 41 52 4E". */
export function bytePairs(hex: string): string {
  const pairs: string[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    pairs.push(hex.slice(i, i + 2).toUpperCase());
  }
  return pairs.join(" ");
}

/** Why a typed word was rejected, in plain text. `word` is the input trimmed and uppercased. */
export function answerMessage(error: AnswerError, word: string): string {
  switch (error) {
    case "format":
      return `Type a ${WORD_LENGTH}-letter word, A to Z`;
    case "notWord":
      return `${word} isn't in the word list`;
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
 * True at the decode step: the hex is locked and the one try is due. The one
 * place this rule lives, so the status line, the card, the keypad and Hints
 * always agree.
 */
export function isHexLocked(phase: Phase | null): boolean {
  return phase === "decode";
}

/**
 * The status line under the title. At the decode step it says why the hex
 * locked: "hex solved" after a fully right row (page L3), or the page 3 line
 * after row 6 without one.
 */
export function statusLine(phase: Phase | null, rowsUsed: number, hexSolved = false): string {
  switch (phase) {
    case null:
      return `${WORD_LENGTH}-letter word`;
    case "solved":
      return `${WORD_LENGTH}-letter word · solved`;
    case "failed":
      return `${WORD_LENGTH}-letter word · not solved`;
    case "guess":
      return `${WORD_LENGTH}-letter word · row ${rowsUsed + 1} of ${MAX_ROWS}`;
    case "decode":
      return hexSolved ? HEX_SOLVED_STATUS : HEX_LOCKED_STATUS;
  }
}

/**
 * The result card for a finished round (page 4): the outcome, the word, the
 * rows used and the hint count, and each byte with its letter. Answer tries
 * stay in the result and `roundFinished` but aren't shown (owner's decision, #38).
 */
export function resultView(result: RoundResult): ResultView {
  const word = result.answer;
  const hex = wordToHex(word);
  return {
    outcome: result.solved ? SOLVED_OUTCOME : FAILED_OUTCOME,
    heading: result.solved ? `Decoded: ${word}` : `The word was ${word}`,
    line: `${result.rowsUsed} of ${MAX_ROWS} rows attempted · ${hintsUsedText(result.hintsUsed)}`,
    bytes: [...word].map((letter, i) => {
      const byte = hex.slice(i * 2, i * 2 + 2);
      return { hex: byte, letter, label: `${byte} is ${letter}` };
    }),
    button: NEW_ROUND_BUTTON,
    note: RESULT_NOTE,
  };
}

/** "1 hint used", or "0 hints used", "2 hints used" and so on (owner's wording, #38). */
export function hintsUsedText(hints: number): string {
  return hints === 1 ? "1 hint used" : `${hints} hints used`;
}

/**
 * The Hints button and strip for a round in progress, or for `null` (no
 * round yet, or the round is over), when the button is hidden. At the decode
 * step the button is locked, and hints are always off then.
 */
export function hintsView(round: Round | null): HintsView {
  if (!round) {
    return { available: false, locked: false, on: false, cells: [], label: "" };
  }
  if (!round.hintsShown) {
    return { available: true, locked: round.hintsLocked, on: false, cells: [], label: "" };
  }
  const letters = round.hintLetters();
  return {
    available: true,
    locked: false,
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
 * Ctrl, Cmd or Alt are never taken. Once the hex is locked the controller
 * ignores grid actions, so typed hex never reaches the grid.
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
 * The action for a physical key while How to play is open, or null to leave
 * the key alone: Escape (without Ctrl, Cmd or Alt) goes back to the game.
 * No other key reaches the game, so typing can't change the grid or the
 * decode box behind it. Enter and Space still press the focused back arrow.
 */
export function howToPlayActionForKey(press: KeyPress): Action | null {
  if (press.key === "Escape" && !press.ctrlKey && !press.metaKey && !press.altKey) {
    return { type: "closeHowToPlay" };
  }
  return null;
}

/**
 * True if a key typed at the decode step (the hex is locked) should go to
 * the decode box, which then needs focus first: a single printable
 * character, with no Ctrl, Cmd or Alt, typed outside the box. A space on a
 * focused button is left to press that button. The caller focuses the box
 * and lets the key's default go ahead, so the character lands in the box
 * instead of being lost. Before the decode step the box is locked, so keys
 * typed outside it stay with the grid, and letters that aren't hex digits
 * do nothing (#46).
 */
export function shouldFocusDecodeBox(press: KeyPress, focus: KeyFocus, hexLocked: boolean): boolean {
  if (!hexLocked || focus === "decodeBox" || press.ctrlKey || press.metaKey || press.altKey) {
    return false;
  }
  // Named keys ("Enter", "Tab", "F1"…) are longer than one character.
  if ([...press.key].length !== 1 || /\p{Cc}/u.test(press.key)) {
    return false;
  }
  return !(press.key === " " && focus === "control");
}
