import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const OWNER = "@dconyemerekwe";
const PROTECTED = [
  "/.github/",
  "/.claude/",
  "/package.json",
  "/package-lock.json",
  "/.npmrc",
  "/.vscodeignore",
  "/SECURITY.md",
  "/CLAUDE.md",
  "/.vscode/",
  "/scripts/",
];

const rules = readFileSync(new URL("../.github/CODEOWNERS", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => line.split(" "));

describe("CODEOWNERS", () => {
  it("gives the owner exactly the protected paths", () => {
    assert.deepEqual(rules, PROTECTED.map((path) => [path, OWNER]));
  });

  it("names only paths that exist, because GitHub ignores a mistyped path silently", () => {
    for (const path of PROTECTED) {
      assert.ok(existsSync(new URL(`..${path}`, import.meta.url)), `${path} doesn't exist`);
    }
  });
});
