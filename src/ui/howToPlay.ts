// The How to play screen's content (page 5): the rules and the A–Z ASCII
// cheatsheet, as plain data for the DOM layer (media/main.ts) to draw with
// `textContent`. Pure: no DOM and no `vscode`. The rule wording lives here, so
// a rule change is a change to this file only.
import { HEX_LENGTH, WORD_LENGTH, letterToHex } from "../game/hex.ts";
import { MAX_ROWS } from "../game/round.ts";
import { Mark } from "../game/score.ts";
import { HINTS_BUTTON } from "./game.ts";

/**
 * How a run of text is drawn: plain, bold (`strong`), as hex in blue
 * monospace (`code`), or as a chip in a mark's colour (rule 3).
 */
export type TextStyle = "plain" | "strong" | "code" | Mark;

/** A run of text in one style. A rule or line is a list of these. */
export interface TextPart {
  readonly text: string;
  readonly style: TextStyle;
}

/** A line of text, made of runs in their styles. */
export type StyledText = readonly TextPart[];

function plain(text: string): TextPart {
  return { text, style: "plain" };
}

function strong(text: string): TextPart {
  return { text, style: "strong" };
}

function code(text: string): TextPart {
  return { text, style: "code" };
}

function chip(text: string, mark: Mark): TextPart {
  return { text, style: mark };
}

/** The `?` button's accessible name, and the screen's heading. */
export const HOW_TO_PLAY = "How to play";

/** The back arrow's accessible name. */
export const BACK_TO_GAME = "Back to game";

/** The section headings, drawn in capitals by the stylesheet. */
export const RULES_HEADING = "Rules";
export const CHEATSHEET_HEADING = "ASCII cheatsheet";

/** The six numbered rules: page 5's wording, with the owner's rules 4 and 5. */
export const RULES: readonly StyledText[] = [
  [plain(`The hidden word has ${WORD_LENGTH} letters, written as ASCII hex: 2 digits per letter.`)],
  [plain(`Guess ${HEX_LENGTH} hex digits that spell a real ${WORD_LENGTH}-letter word.`)],
  [
    plain("Each digit turns "),
    chip("blue", Mark.Right),
    plain(" right spot, "),
    chip("orange", Mark.Wrong),
    plain(" wrong spot, or "),
    chip("grey", Mark.Absent),
    plain(" not in the word."),
  ],
  // Rules 4 and 5 are the owner's revised wording, not page 5's. Rule 4
  // describes the optional decoding that #30 builds.
  [plain("You can decode the English word at any time. A wrong guess doesn't use up a row.")],
  [plain(`After ${MAX_ROWS} rows, the hex keypad locks and you get one final try to decode the English word.`)],
  [plain("Stuck? Turn on "), strong(HINTS_BUTTON), plain(" to see the letters you have fully decoded so far.")],
];

/** The line above the cheatsheet cards. */
export const CHEATSHEET_LINE: StyledText = [
  code("4_"),
  plain(" is A–O, "),
  code("5_"),
  plain(" is P–Z. The second digit counts up from there."),
];

/** One cheatsheet card: a letter and its hex, e.g. `A 41`. */
export interface CheatCard {
  readonly letter: string;
  readonly hex: string;
  /** Read out instead of the drawn card, e.g. "A is 41". */
  readonly label: string;
}

/** The 26 cards from `A 41` to `Z 5A`, in order. */
export function cheatsheet(): CheatCard[] {
  return Array.from({ length: 26 }, (_, i) => {
    const letter = String.fromCharCode(0x41 + i);
    const hex = letterToHex(letter);
    return { letter, hex, label: `${letter} is ${hex}` };
  });
}

/** A line's text as read, without its styles. */
export function plainText(text: StyledText): string {
  return text.map((part) => part.text).join("");
}
