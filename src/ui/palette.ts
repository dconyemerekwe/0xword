// The dark and light colours of the game screen, and the contrast checks they
// must pass. Pure: no DOM or `vscode`, so it can be unit-tested.
// media/styles.css declares each token as a CSS custom property with the same
// value, the dark ones in :root and the light ones in the light-theme rule (a
// test checks they match), and uses only those properties for colour.

/** The dark palette (CLAUDE.md Design; pages 1–3 and 5). */
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
  /** Orange text: error messages and "Last try". The dark theme's is `wrong` itself. */
  wrongText: "#F0A04B",
  /** Not-in-word tiles. */
  absent: "#343944",
  onAbsent: "#B4B9C5",
  /** The faint outline of empty tiles: `absent` in the dark theme. */
  emptyBorder: "#343944",
  /** A keypad key whose digit hasn't been marked yet. */
  key: "#2A2E37",
  /** A keypad key whose digit is not in the word: darker than `key`. */
  keyAbsent: "#111318",
  // Page 3, while the hex is locked (docs/design/README.md colour table).
  /** The final-answer card's background. Its border, "Last try" and Submit are `wrong`. */
  finalCard: "#241B12",
  /** "Type with your keyboard" and Tried on the card. Estimated from page 3: the table has no value. */
  finalNote: "#D6C8B4",
  /** Right-spot tiles, dimmed. */
  lockedRight: "#2754A8",
  /** Wrong-spot tiles, dimmed; also locked wrong-spot keys (page 3 shows none). */
  lockedWrong: "#AE783F",
  /** Unmarked keys, DEL and ENTER. */
  lockedKey: "#1B1E24",
  /** Right-spot keys. */
  lockedKeyRight: "#1E3660",
  /** The dimmed digits of locked keys. Estimated from page 3: the table only says "dimmed". */
  lockedKeyText: "#6B7180",
  // Page 2, the Hints button and strip (docs/design/README.md colour table).
  /** The Hints button's border while off. */
  hintsBorder: "#3C3F48",
  /** The Hints button's text and icon while off. Its fill is `background`. */
  hintsText: "#CCCFD8",
  /** The Hints button's fill while on. Its border is `right`. */
  hintsOn: "#1E2A45",
  /** The Hints button's text and icon while on. */
  hintsOnText: "#7EA8FF",
  /** The hint strip's dashed cell outlines. Estimated from page 2: the table has no value. */
  stripBorder: "#4A4D55",
  /**
   * The muted `?` of a byte not yet decoded. Estimated from page 2 (measured
   * about #797E89, 4.45:1): the table has no value. Taken 2 units lighter,
   * within the image's JPEG error, so it meets 4.5:1.
   */
  stripUnknown: "#7B808B",
  // Pages L1 to L3, the decode lock (#46), measured from the lock-*.jpg
  // images (docs/design/README.md). The lock's title and icon are `text`, and
  // the faded panel contents are the usual ones at 10% opacity.
  /** The lock badge's fill: measured #2A2E37, the same as `key`. */
  lockBadge: "#2A2E37",
  /** The lock badge's thin outline: measured #3C404A, within the JPEG error of `hintsBorder`. */
  lockBadgeBorder: "#3C3F48",
  /** "Get every tile blue to unlock Decode.": measured as `hintsText` measures in the same image. */
  lockMessage: "#CCCFD8",
  /**
   * The locked Hints button's text and lock icon (page L3). Its fill is
   * `background`. Measured about #8B919E; the owner chose the design table's
   * absent-key text, #8A909C, instead of a new colour.
   */
  hintsLockedText: "#8A909C",
  /** The locked Hints button's outline (page L3): fainter than `hintsBorder`. */
  hintsLockedBorder: "#303239",
  // Page 4, the result card. Page 4 is drawn in the light theme, so these are
  // the dark theme's matches for its values, taken from existing dark tokens
  // (no new colours). The card itself is `panel` with a `right` border, and
  // New round is `right` with `onRight` text.
  /** The byte tiles' fill: the light theme's pale blue (`#EDF3FC`), as `hintsOn`. */
  byteTile: "#1E2A45",
  /** The byte tiles' hex: the light theme's blue text, as `hintsOnText` (also How to play's dark hex). */
  byteHex: "#7EA8FF",
  // Page 5, How to play (docs/design/README.md colour table). The cheatsheet
  // cards are `panel` with a `cardBorder` outline, their letters `text`. The
  // rule 3 chips are the tile colours: `right`/`onRight`, `wrong`/`onWrong`,
  // `absent`/`chipOnAbsent`.
  /** The cheatsheet cards' outline: `key` (estimated from page 5: the table has no border value). */
  cardBorder: "#2A2E37",
  /** The `?`, theme and back arrow icon buttons. */
  icon: "#CCCFD8",
  /** The cheatsheet cards' hex, and `4_` / `5_` in the line above them. */
  cheatHex: "#7EA8FF",
  /** The "grey" chip's text in rule 3: the table's not-in-word tile text. */
  chipOnAbsent: "#C9CFD8",
} as const;

export type PaletteToken = keyof typeof DARK_PALETTE;

/**
 * The light palette (page 4). The page 4 values come from the light colour
 * table in docs/design/README.md. Every other screen is drawn only in dark,
 * so its light values are derived from those page 4 values: another page 4
 * value, or a mix of two of them (`share` of the first over the second, per
 * sRGB channel), never a new hue. docs/design/README.md lists each one.
 */
export const LIGHT_PALETTE: Readonly<Record<PaletteToken, string>> = {
  // Page 4 (the light colour table).
  background: "#F6F6F9",
  /** The result card's white; also the decode panel and cheatsheet cards. */
  panel: "#FFFFFF",
  text: "#15181B",
  muted: "#5D636C",
  /** Derived: `right`, as the page 4 blue (4.8:1 on the page). */
  accent: "#2463EA",
  right: "#2463EA",
  onRight: "#FFFFFF",
  wrong: "#F3A524",
  onWrong: "#1A1206",
  /** Derived: 50% `onWrong` over `wrong`. The orange itself is 1.9:1 on the page, too light for text. */
  wrongText: "#875C15",
  absent: "#6C7281",
  onAbsent: "#FFFFFF",
  emptyBorder: "#CFD2D8",
  // Derived: keys (page 1 has them only in dark).
  /** 50% of the light outline `#CFD2D8` over `background`. */
  key: "#E3E4E9",
  /** `background`: like the dark theme's, an absent key sinks into the page. */
  keyAbsent: "#F6F6F9",
  // Derived: page 3, the hex locked.
  /** 10% `wrong` over `panel`: a pale orange card. */
  finalCard: "#FEF6E9",
  /** `muted`. */
  finalNote: "#5D636C",
  /** 40% `absent` over `right`: a greyed blue that keeps white text readable. */
  lockedRight: "#4169C0",
  /** 40% `absent` over `wrong`. */
  lockedWrong: "#BD9149",
  /** 25% of `#CFD2D8` over `background`: fainter than `key`. */
  lockedKey: "#ECEDF1",
  /** 15% `right` over `background`. */
  lockedKeyRight: "#D7E0F7",
  /** `muted`. */
  lockedKeyText: "#5D636C",
  // Derived: page 2, the Hints button and strip.
  /** The light outline `#CFD2D8`, as on page 4's Copy result. */
  hintsBorder: "#CFD2D8",
  /** `text`, as on page 4's Copy result. */
  hintsText: "#15181B",
  /** The byte tiles' pale blue, as in the dark theme (`hintsOn` = `byteTile`). */
  hintsOn: "#EDF3FC",
  /** The byte tiles' blue hex, as in the dark theme (`hintsOnText` = `byteHex`). */
  hintsOnText: "#2463EA",
  /** 50% `muted` over `#CFD2D8`: a little stronger than the empty-tile outline, as in dark. */
  stripBorder: "#969BA2",
  /** `muted`. */
  stripUnknown: "#5D636C",
  // Derived: pages L1 to L3, the decode lock (#46).
  /** `key`, as in the dark theme. */
  lockBadge: "#E3E4E9",
  /** The light outline `#CFD2D8`, as `hintsBorder`. */
  lockBadgeBorder: "#CFD2D8",
  /** `muted`: lighter than the `text` title, as in the dark theme. */
  lockMessage: "#5D636C",
  /** `muted`, as the locked keys' digits. */
  hintsLockedText: "#5D636C",
  /** 50% of `#CFD2D8` over `background` (as `key`): fainter than `hintsBorder`, as in the dark theme. */
  hintsLockedBorder: "#E3E4E9",
  // Page 4, the result card.
  byteTile: "#EDF3FC",
  byteHex: "#2463EA",
  // Derived: page 5, How to play.
  /** The light outline `#CFD2D8`. */
  cardBorder: "#CFD2D8",
  /** `text`: page 4's `?` and moon are drawn dark. */
  icon: "#15181B",
  /** The byte tiles' blue hex. */
  cheatHex: "#2463EA",
  /** `onAbsent`: page 4's not-in-word text. */
  chipOnAbsent: "#FFFFFF",
};

/** Both palettes, by the name media/styles.css and src/theme.ts use. */
export const PALETTES = { dark: DARK_PALETTE, light: LIGHT_PALETTE } as const;

/**
 * Every text colour the screen draws, with the background it sits on. Each
 * must have a contrast ratio of at least `MIN_TEXT_CONTRAST` in both palettes.
 */
export const TEXT_PAIRS: readonly (readonly [text: PaletteToken, background: PaletteToken])[] = [
  ["text", "background"], // headings, typed tiles, messages
  ["text", "panel"], // the decode panel and its text box
  ["text", "key"], // unmarked keypad keys, DEL and ENTER
  ["muted", "background"], // status line, legend
  ["muted", "panel"], // Tried words, placeholder, disabled decode box
  ["muted", "key"], // disabled unmarked keys
  ["muted", "keyAbsent"], // absent keypad keys, the disabled Decode button
  ["onRight", "right"], // right-spot tiles and keys, the Decode button
  ["onWrong", "wrong"], // wrong-spot tiles and keys
  ["onAbsent", "absent"], // not-in-word tiles
  ["wrongText", "background"], // error messages
  ["text", "finalCard"], // the "Final answer" heading
  ["wrongText", "finalCard"], // "Last try"
  ["finalNote", "finalCard"], // "Type with your keyboard", Tried words
  ["onRight", "lockedRight"], // dimmed right-spot tiles
  ["onWrong", "lockedWrong"], // dimmed wrong-spot tiles
  // Locked keys: see DIMMED_KEY_PAIRS.
  ["hintsText", "background"], // the Hints button, off
  ["hintsOnText", "hintsOn"], // the Hints button, on
  ["stripUnknown", "background"], // the hint strip's `?` (its letters are `text` on `background`)
  // The decode lock's title is `text` on `panel`: checked above.
  ["lockMessage", "panel"], // the decode lock's message
  ["hintsLockedText", "background"], // the locked Hints button (disabled, but checked anyway)
  // The result card's heading and line are `text` and `muted` on `panel`, and
  // the note under it `muted` on `background`: all checked above.
  ["byteHex", "byteTile"], // a result byte tile's hex
  ["text", "byteTile"], // a result byte tile's letter
  // How to play: the heading, rules and card letters are `text`, and the
  // section headings `muted`, on `background` or `panel`: checked above. The
  // "blue" and "orange" chips are `onRight`/`right` and `onWrong`/`wrong`.
  ["icon", "background"], // the `?` and back arrow buttons
  ["cheatHex", "panel"], // a cheatsheet card's hex
  ["cheatHex", "background"], // `4_` and `5_` above the cards
  ["chipOnAbsent", "absent"], // the "grey" chip in rule 3
];

/** WCAG AA for normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * The dimmed keys while the hex is locked (page 3), with their background.
 * They are `disabled`, so WCAG sets them no contrast minimum, but #26 asks
 * for `MIN_TEXT_CONTRAST` here too. Those that miss it are listed in
 * `BELOW_MIN_CONTRAST`.
 */
export const DIMMED_KEY_PAIRS: readonly (readonly [text: PaletteToken, background: PaletteToken])[] = [
  ["lockedKeyText", "lockedKey"], // unmarked keys, DEL and ENTER
  ["lockedKeyText", "lockedKeyRight"], // right-spot keys
  ["onWrong", "lockedWrong"], // wrong-spot keys
  ["lockedKeyText", "keyAbsent"], // not-in-word keys (struck through)
];

/**
 * Pairs knowingly under `MIN_TEXT_CONTRAST`, as `palette:text/background`.
 * Each is a design value the owner decides on: they're reported, never
 * changed to pass (CLAUDE.md Design: raise accessibility conflicts with the
 * owner). A test checks each one really is under the minimum, so the list
 * can't go stale.
 */
export const BELOW_MIN_CONTRAST: readonly string[] = [
  // Owner decision: page 3's dimmed dark keys, as built in #22 (3.42, 2.45 and 3.80:1).
  "dark:lockedKeyText/lockedKey",
  "dark:lockedKeyText/lockedKeyRight",
  "dark:lockedKeyText/keyAbsent",
];

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
