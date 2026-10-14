import { HEX_LENGTH, hexToWord, isHex } from "./hex.ts";

/** Why a hex guess was rejected. */
export type GuessError =
  | "length" // not exactly 8 characters
  | "notHex" // contains something other than 0–9 and A–F
  | "notLetter" // a byte is outside 41–5A, so it isn't a capital letter
  | "notWord"; // decodes to letters, but not to a word in the list

export type GuessCheck =
  | { ok: true; hex: string; word: string }
  | { ok: false; error: GuessError };

/** Checks a hex guess and returns it uppercased with its decoded word. */
export function checkGuess(input: string, words: ReadonlySet<string>): GuessCheck {
  if (input.length !== HEX_LENGTH) {
    return { ok: false, error: "length" };
  }
  if (!isHex(input)) {
    return { ok: false, error: "notHex" };
  }
  const hex = input.toUpperCase();
  const word = hexToWord(hex);
  if (word === null) {
    return { ok: false, error: "notLetter" };
  }
  if (!words.has(word)) {
    return { ok: false, error: "notWord" };
  }
  return { ok: true, hex, word };
}
