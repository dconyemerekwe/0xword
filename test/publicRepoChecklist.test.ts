// Proves test/publicRepo.test.ts fails when the "Making the repo public" checklist
// loses its first step or goes public before acting on the findings (#102).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const STEP_1 = "1. Act on the findings listed on #95: keep or remove each one.\n";
const STEP_2 = "2. Make the repo public: **Settings → General → Danger Zone → Change visibility**.\n";

/** Runs a copy of test/publicRepo.test.ts against an edited release doc. */
function publicRepoTestPasses(edit: (doc: string) => string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "0xword-public-"));
  try {
    mkdirSync(join(dir, "test"));
    mkdirSync(join(dir, "docs"));
    copyFileSync(join(root, "test/publicRepo.test.ts"), join(dir, "test/publicRepo.test.ts"));
    copyFileSync(join(root, "SECURITY.md"), join(dir, "SECURITY.md"));
    const doc = readFileSync(join(root, "docs/release-pipeline.md"), "utf8");
    writeFileSync(join(dir, "docs/release-pipeline.md"), edit(doc));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "."], { cwd: dir });
    // Under `node --test` the inherited NODE_TEST_CONTEXT makes a nested run skip its files and exit 0.
    const env = { ...process.env, NODE_TEST_CONTEXT: undefined };
    return spawnSync(process.execPath, ["--test", "test/publicRepo.test.ts"], { cwd: dir, env }).status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("test/publicRepo.test.ts guards the checklist", () => {
  it("control: passes on the unedited doc", () => {
    assert.equal(publicRepoTestPasses((doc) => doc), true);
  });

  it("fails if the step to act on the #95 findings is removed", () => {
    assert.equal(publicRepoTestPasses((doc) => doc.replace(STEP_1, "")), false);
  });

  it("fails if the repo goes public before the findings are acted on", () => {
    assert.equal(publicRepoTestPasses((doc) => doc.replace(STEP_1 + STEP_2, STEP_2 + STEP_1)), false);
  });
});
