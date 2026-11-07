/** Letters in the hidden word. */
export const WORD_LENGTH = 4;

/** Hex digits in a guess: two per letter. */
export const HEX_LENGTH = WORD_LENGTH * 2;

const WORD_PATTERN = /^[A-Z]{4}$/;
const HEX_PATTERN = /^[0-9A-F]{8}$/i;

/** True if `word` is exactly four uppercase letters A–Z. */
export function isWord(word: string): boolean {
  return WORD_PATTERN.test(word);
}

/** True if `hex` is exactly eight hex digits (either case). */
export function isHex(hex: string): boolean {
  return HEX_PATTERN.test(hex);
}

/** Converts one uppercase letter to its two ASCII hex digits: `letterToHex("B")` is `"42"`. */
export function letterToHex(letter: string): string {
  if (!/^[A-Z]$/.test(letter)) {
    throw new RangeError(`Expected one uppercase letter, got "${letter}"`);
  }
  return letter.charCodeAt(0).toString(16).toUpperCase();
}

/** Converts a word to uppercase ASCII hex: `wordToHex("BYTE")` is `"42595445"`. */
export function wordToHex(word: string): string {
  if (!isWord(word)) {
    throw new RangeError(`Expected four uppercase letters, got "${word}"`);
  }
  return [...word].map(letterToHex).join("");
}

/**
 * Converts eight hex digits back to a word, or returns null if the input isn't
 * eight hex digits or any byte isn't a capital letter (`41`–`5A`).
 */
export function hexToWord(hex: string): string | null {
  if (!isHex(hex)) {
    return null;
  }
  let word = "";
  for (let i = 0; i < HEX_LENGTH; i += 2) {
    const code = Number.parseInt(hex.slice(i, i + 2), 16);
    if (code < 0x41 || code > 0x5a) {
      return null;
    }
    word += String.fromCharCode(code);
  }
  return word;
}
