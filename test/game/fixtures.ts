// Test-only: loads the real bundled word list from disk.
import { readFileSync } from "node:fs";
import { parseWordList } from "../../src/game/words.ts";

export const WORDS = parseWordList(readFileSync(new URL("../../src/game/words.txt", import.meta.url), "utf8"));
export const WORD_SET: ReadonlySet<string> = new Set(WORDS);
