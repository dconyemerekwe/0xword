// The dark-theme colours of the game screen, and the contrast check they must
// pass. Pure: no DOM or `vscode`, so it can be unit-tested. media/styles.css
// declares each token as a CSS custom property with the same value (a test
// checks they match), and uses only those properties for colour.

/** The dark palette (CLAUDE.md Design). The light palette arrives with the theme story. */
export const DARK_PALETTE = {
  background: "#14161B",
  panel: "#1D2027",
  text: "#E8EAF0",
  /** Secondary text (status line, legend, placeholders), and outlines of typed tiles and the decode box. */
  muted: "#A3A9B6",
  /** The keyboard focus ring. Not from the design: awaiting the owner's decision. */
  accent: "#6B98F0",
  right: "#2F6FE4",
  onRight: "#FFFFFF",
  wrong: "#F0A04B",
  onWrong: "#1A1206",
  /** Not-in-word tiles, and the faint outline of empty tiles. */
  absent: "#343944",
  onAbsent: "#B4B9C5",
  /** A keypad key whose digit hasn't been marked yet. */
  key: "#2A2E37",
  /** A keypad key whose digit is not in the word: darker than `key`. */
  keyAbsent: "#111318",
} as const;

export type PaletteToken = keyof typeof DARK_PALETTE;

/**
 * Every text colour the screen draws, with the background it sits on. Each
 * must have a contrast ratio of at least `MIN_TEXT_CONTRAST`.
 */
export const TEXT_PAIRS: readonly (readonly [text: PaletteToken, background: PaletteToken])[] = [
  ["text", "background"], // headings, typed tiles, messages
  ["text", "panel"], // the decode panel and its text box
  ["text", "key"], // unmarked keypad keys, DEL and ENTER
  ["muted", "background"], // status line, legend
  ["muted", "panel"], // "1 try per row", Tried words, placeholder, disabled decode box
  ["muted", "key"], // disabled unmarked keys
  ["muted", "keyAbsent"], // absent keypad keys, the disabled Decode button
  ["onRight", "right"], // right-spot tiles and keys, the Decode button
  ["onWrong", "wrong"], // wrong-spot tiles and keys
  ["onAbsent", "absent"], // not-in-word tiles
  ["wrong", "background"], // error messages
];

/** WCAG AA for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * Text colours drawn only as WCAG large text (at least 24px, or at least
 * 18.66px bold), with their background. Each must have a contrast ratio of
 * at least `MIN_LARGE_TEXT_CONTRAST`. A test checks the stylesheet really
 * draws them that large.
 */
export const LARGE_TEXT_PAIRS: readonly (readonly [text: PaletteToken, background: PaletteToken])[] = [
  ["right", "background"], // the `0x` title, in the design's blue
];

/** WCAG AA for large text. */
export const MIN_LARGE_TEXT_CONTRAST = 3;

/** WCAG's large text: at least 24px, or at least 18.66px (14pt) when bold (700 or more). */
export function isLargeText(sizePx: number, weight: number): boolean {
  return sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
}

/**
 * The WCAG 2 contrast ratio of two `#RRGGBB` colours, from 1 (the same) to
 * 21 (black on white). Throws on any other format.
 */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

/** The WCAG 2 relative luminance of a `#RRGGBB` colour: 0 for black, 1 for white. */
export function relativeLuminance(colour: string): number {
  if (!HEX_COLOUR.test(colour)) {
    throw new RangeError(`Expected a #RRGGBB colour, got "${colour}"`);
  }
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(colour.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
