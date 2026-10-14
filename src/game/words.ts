import { isWord } from "./hex.ts";

/**
 * Parses the bundled word list: one word per line, blank lines ignored.
 * Throws if any line isn't four uppercase letters or a word appears twice,
 * since either means the bundled file is broken.
 */
export function parseWordList(text: string): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim();
    if (word === "") {
      continue;
    }
    if (!isWord(word)) {
      throw new Error(`Invalid word in list: "${word}"`);
    }
    if (seen.has(word)) {
      throw new Error(`Duplicate word in list: "${word}"`);
    }
    seen.add(word);
    words.push(word);
  }
  if (words.length === 0) {
    throw new Error("Word list is empty");
  }
  return words;
}

/**
 * Picks a random answer. `random` returns a number in [0, 1) like
 * `Math.random`; tests pass a fixed one to get a known answer.
 */
export function pickAnswer(words: readonly string[], random: () => number = Math.random): string {
  if (words.length === 0) {
    throw new Error("Cannot pick from an empty word list");
  }
  const index = Math.min(Math.floor(random() * words.length), words.length - 1);
  return words[index]!;
}
