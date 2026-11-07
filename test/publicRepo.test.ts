// Checks that hold once the repo is public (#95): SECURITY.md tells reporters
// how to reach the owner privately, the release docs list the owner's steps for
// going public, and no tracked text gives away a local path.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** This file, which holds sample paths to prove the check catches them. */
const THIS_FILE = "test/publicRepo.test.ts";

const USER_PATH = /[A-Za-z]:[\\/]+[Uu]sers[\\/]|\/[A-Za-z]\/[Uu]sers\/|\/Users\/[A-Za-z]|\/home\/[A-Za-z]|\bAppData[\\/]/;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
}

describe("SECURITY.md", () => {
  const text = readFileSync(join(root, "SECURITY.md"), "utf8");
  const reporting = text.split("## Reporting a vulnerability")[1] ?? "";

  it("asks reporters not to open a public issue", () => {
    assert.match(reporting, /don't open a public issue/);
  });

  it("sends reporters to this repository's private vulnerability reporting", () => {
    assert.match(reporting, /private vulnerability reporting/);
    assert.ok(reporting.includes("https://github.com/dconyemerekwe/0xword/security/advisories/new"));
  });
});

describe("docs/release-pipeline.md", () => {
  const text = readFileSync(join(root, "docs/release-pipeline.md"), "utf8");
  const checklist = text.split("\n## Making the repo public\n")[1]?.split("\n## ")[0] ?? "";

  it("has the owner's checklist heading", () => {
    assert.notEqual(checklist, "");
  });

  it("lists the steps in order, acting on the findings before going public", () => {
    const steps = checklist.match(/^\d+\. .+$/gm) ?? [];
    const expected = [
      /Act on the findings listed on #95/,
      /Make the repo public/,
      /private vulnerability reporting/,
      /secret scanning with push protection/,
    ];
    assert.equal(steps.length, expected.length);
    expected.forEach((step, index) => assert.match(steps[index] ?? "", step));
  });

  it("covers making the repo public", () => {
    assert.match(checklist, /Make the repo public/);
  });

  it("covers private vulnerability reporting", () => {
    assert.match(checklist, /private vulnerability reporting/);
  });

  it("covers secret scanning with push protection", () => {
    assert.match(checklist, /secret scanning with push protection/);
  });
});

describe("tracked text files", () => {
  it("are listed, so an empty list can't pass the path check", () => {
    assert.ok(trackedFiles().includes("SECURITY.md"));
  });

  it("contain no absolute local user paths", () => {
    const found = trackedFiles().filter((file) => {
      if (file === THIS_FILE) return false;
      const path = join(root, file);
      if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return false;
      const bytes = readFileSync(path);
      return !bytes.includes(0) && USER_PATH.test(bytes.toString("utf8"));
    });
    assert.deepEqual(found, []);
  });

  it("the check catches Windows, Git Bash, macOS and Linux paths", () => {
    for (const path of [
      "C:\\Users\\someone\\project",
      "c:/Users/someone",
      "c:\\users\\someone",
      "/c/Users/someone",
      "/C/users/someone",
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
