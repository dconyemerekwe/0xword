// Checks that hold once the repo is public (#95): SECURITY.md tells reporters
// how to reach the owner privately, and no tracked text gives away a local path.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

/** This file, which holds sample paths to prove the check catches them. */
const THIS_FILE = "test/publicRepo.test.ts";

const USER_PATH = /[A-Za-z]:[\\/]+Users[\\/]|\/[a-z]\/Users\/|\/Users\/[A-Za-z]|\/home\/[A-Za-z]|\bAppData[\\/]/;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
}

describe("SECURITY.md", () => {
  const text = readFileSync(new URL("SECURITY.md", root), "utf8");
  const reporting = text.split("## Reporting a vulnerability")[1] ?? "";

  it("asks reporters not to open a public issue", () => {
    assert.match(reporting, /don't open a public issue/);
  });

  it("sends reporters to this repository's private vulnerability reporting", () => {
    assert.match(reporting, /private vulnerability reporting/);
    assert.ok(reporting.includes("https://github.com/dconyemerekwe/0xword/security/advisories/new"));
  });
});

describe("tracked text files", () => {
  it("contain no absolute local user paths", () => {
    const found = trackedFiles().filter((file) => {
      if (file === THIS_FILE) return false;
      const bytes = readFileSync(new URL(file, root));
      return !bytes.includes(0) && USER_PATH.test(bytes.toString("utf8"));
    });
    assert.deepEqual(found, []);
  });

  it("the check catches Windows, Git Bash, macOS and Linux paths", () => {
    for (const path of [
      "C:\\Users\\someone\\project",
      "c:/Users/someone",
      "/c/Users/someone",
      "/Users/someone/project",
      "/home/someone/project",
      "AppData\\Local\\Temp",
    ]) {
      assert.match(path, USER_PATH);
    }
  });

  it("the check leaves repo-relative paths and URLs alone", () => {
    for (const path of ["docs/release-pipeline.md", "https://github.com/dconyemerekwe/0xword", "$RUNNER_TEMP/0xword.vsix"]) {
      assert.doesNotMatch(path, USER_PATH);
    }
  });
});
