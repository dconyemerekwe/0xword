// Checks the GitHub Actions workflows (#87, #93). There is no YAML parser here
// (security rule 3), and checking selected lines misses anything written
// another way, so each workflow is compared whole, line by line, with the exact
// lists below. Any added, removed, reordered or reworded line fails, however
// its YAML is written. test/workflows-mutations.test.ts proves that on copies.
//
// Changing a workflow on purpose? Update its list here in the same commit, so
// the change to what the release path does shows up in review. That includes
// rewording a comment at the end of a line, which is compared as written. Bumping
// a pinned action needs no change: its SHA and version comment aren't compared.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const WORKFLOW_FOLDER = ".github/workflows";

/** The local workflow release.yml calls, the one `uses:` without a SHA. */
const LOCAL_CI = "./.github/workflows/ci.yml";

/** An action from GitHub's own `actions` organisation, pinned to a full commit SHA. */
const PINNED_ACTION = /^actions\/[a-z0-9-]+@[0-9a-f]{40}$/;

/** A GitHub expression, which is pasted into a script before the shell runs it. */
const EXPRESSION = /\$\{\{/;

/** Any use of a secret: `secrets.X`, or a job's `secrets: inherit`. */
const SECRET = /\bsecrets\b/;

/** ci.yml as normalised() gives it. It also runs on workflow_call; nothing else changed for #87. */
const EXPECTED_CI: readonly string[] = [
  "name: CI",
  "on:",
  "  pull_request:",
  "    branches: [develop, main]",
  "  push:",
  "    branches: [develop, main]",
  "  workflow_dispatch:",
  "  workflow_call:",
  "permissions:",
  "  contents: read",
  "concurrency:",
  "  group: ci-${{ github.ref }}",
  "  cancel-in-progress: true",
  "jobs:",
  "  check:",
  "    name: Typecheck, test, build and package",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    steps:",
  "      - uses: actions/checkout@<sha>",
  "        with:",
  "          persist-credentials: false",
  "      - uses: actions/setup-node@<sha>",
  "        with:",
  "          node-version: 24",
  "          cache: npm",
  "      - run: npm ci",
  "      - run: npm audit signatures",
  "      - run: npm run typecheck",
  "      - run: npm test",
  "      - run: npm run build",
  '      - run: npm run package -- --out "$RUNNER_TEMP/0xword.vsix"',
  "      - uses: actions/upload-artifact@<sha>",
  "        with:",
  "          name: 0xword-vsix",
  "          path: ${{ runner.temp }}/0xword.vsix",
  "          retention-days: 14",
  "          if-no-files-found: error",
];

/**
 * release.yml as normalised() gives it: only v* tags start it; verify-tag, ci,
 * publish and github-release run in that order; publish alone has id-token and
 * the production environment; github-release alone can write. publish uses the
 * .vsix ci built, with no token and no rebuild.
 */
const EXPECTED_RELEASE: readonly string[] = [
  "name: Release",
  "on:",
  "  push:",
  "    tags: ['v*']   # only a pushed tag starting with \"v\" starts this",
  "permissions:",
  "  contents: read   # jobs below widen this only where needed",
  "concurrency:",
  "  group: release",
  "  cancel-in-progress: false",
  "jobs:",
  "  verify-tag:",
  "    name: Tag matches package.json and is on main",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    steps:",
  "      - uses: actions/checkout@<sha>",
  "        with:",
  "          fetch-depth: 0",
  "          persist-credentials: false",
  "      - name: Tag equals package.json version",
  "        run: |",
  `          expected="v$(node -p "require('./package.json').version")"`,
  '          if [ "$GITHUB_REF_NAME" != "$expected" ]; then',
  '            echo "::error::Tag $GITHUB_REF_NAME does not match package.json ($expected)"',
  "            exit 1",
  "          fi",
  "      - name: Tagged commit is on main",
  "        run: |",
  '          if ! git merge-base --is-ancestor "$GITHUB_SHA" origin/main; then',
  `            echo "::error::Tag $GITHUB_REF_NAME is on a commit that isn't on main"`,
  "            exit 1",
  "          fi",
  "  ci:",
  "    name: CI",
  "    needs: verify-tag",
  "    uses: ./.github/workflows/ci.yml   # the same checks as every PR",
  "  publish:",
  "    name: Publish to the VS Code Marketplace",
  "    needs: ci",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    environment: production   # waits for the owner's approval",
  "    permissions:",
  "      contents: read",
  "      id-token: write   # only this job can request a Marketplace credential",
  "    steps:",
  "      - uses: actions/checkout@<sha>",
  "        with:",
  "          persist-credentials: false",
  "      - uses: actions/setup-node@<sha>",
  "        with:",
  "          node-version: 24",
  "          cache: npm",
  "      - run: npm ci   # installs the vsce version locked in package-lock.json",
  "      - uses: actions/download-artifact@<sha>",
  "        with:",
  "          name: 0xword-vsix",
  "          path: ${{ runner.temp }}",
  '      - run: npx vsce publish --oidc --packagePath "$RUNNER_TEMP/0xword.vsix"',
  "  github-release:",
  "    name: GitHub Release",
  "    needs: publish   # no release unless the Marketplace took the version",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 5",
  "    permissions:",
  "      contents: write   # only this job can create a release",
  "    steps:",
  "      - uses: actions/download-artifact@<sha>",
  "        with:",
  "          name: 0xword-vsix",
  "          path: ${{ runner.temp }}",
  "      - name: Create the release with the .vsix attached",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
  "        run: |",
  '          gh release create "$GITHUB_REF_NAME" "$RUNNER_TEMP/0xword.vsix" \\',
  '            --repo "$GITHUB_REPOSITORY" --verify-tag --generate-notes',
];

function readWorkflow(file: string): string {
  return readFileSync(new URL(`${WORKFLOW_FOLDER}/${file}`, root), "utf8");
}

function indentOf(line: string): number {
  return line.length - line.replace(/^ +/, "").length;
}

/**
 * Printable ASCII and newlines only. YAML, the shell and JavaScript disagree
 * about no-break spaces, tabs and other line endings, so a file with any of
 * them could run something these line-by-line checks don't see.
 */
const PLAIN_TEXT = /^[\x20-\x7E\n]*$/;

/** The text as lines, without comments and blank lines. */
function codeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[ \t])#.*$/, "").trimEnd())
    .filter((line) => line !== "");
}

/**
 * The lines the exact lists are compared with. Only three things are left out:
 * blank lines and whole-line comments outside a script, and each full SHA pin
 * with its version comment, written as `@<sha>`. Everything else stays exactly
 * as written, including a comment at the end of a line. A `run: |` script keeps
 * all its lines, blank ones and comments too, because they can change what the
 * shell runs; only the blank lines after its end aren't part of it. A short SHA,
 * a tag or a pin with no version comment stays as written and fails the comparison.
 */
function normalised(text: string): string[] {
  const lines: string[] = [];
  let scriptKeyIndent: number | undefined;
  let blanks: string[] = [];
  for (const line of text.split("\n")) {
    const blank = /^ *$/.test(line);
    if (scriptKeyIndent !== undefined) {
      if (blank) {
        blanks.push(line);
        continue;
      }
      if (indentOf(line) > scriptKeyIndent) {
        lines.push(...blanks, line);
        blanks = [];
        continue;
      }
      scriptKeyIndent = undefined;
      blanks = [];
    }
    if (blank || /^ *#/.test(line)) {
      continue;
    }
    lines.push(line.replace(/^( *- uses: actions\/[a-z0-9-]+)@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, "$1@<sha>"));
    const script = /^( *(?:- )?)run: \|$/.exec(line);
    if (script !== null) {
      scriptKeyIndent = (script[1] ?? "").length;
    }
  }
  return lines;
}

/** Every `uses:` value in the text, however the step is laid out. */
function usesValues(text: string): string[] {
  return codeLines(text).flatMap((line) => {
    const value = /^\s*(?:- )?uses:\s*(.*)$/.exec(line)?.[1];
    return value === undefined ? [] : [value];
  });
}

/** The action or local workflow a `uses:` value names, without the SHA. */
function withoutSha(uses: string): string {
  return uses.replace(/@.*$/, "");
}

/** The shell text of every `run:`, one-line or block. */
function runScripts(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const scripts: string[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*(?:- )?)run:\s*(.*)$/.exec(line);
    if (match === null) {
      return;
    }
    const keyIndent = (match[1] ?? "").length;
    const script = [match[2] ?? ""];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== "" && indentOf(next) <= keyIndent) {
        break;
      }
      script.push(next);
    }
    scripts.push(script.join("\n"));
  });
  return scripts;
}

const workflowFiles = readdirSync(new URL(`${WORKFLOW_FOLDER}/`, root)).filter(
  (file) => file.endsWith(".yml") || file.endsWith(".yaml"),
);

describe("the workflows, line by line", () => {
  it("ci.yml is exactly the expected list: workflow_call added, everything else unchanged", () => {
    assert.deepEqual(normalised(readWorkflow("ci.yml")), EXPECTED_CI);
  });

  it("release.yml is exactly the expected list", () => {
    assert.deepEqual(normalised(readWorkflow("release.yml")), EXPECTED_RELEASE);
  });
});

describe("the line-by-line comparison", () => {
  const pin = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";

  it("ignores whole-line comments, blank lines, a pin's SHA and its version comment", () => {
    const text = `# A comment\n\nname: CI\n      # Another\n      - uses: ${pin} # v7.0.1\n`;
    assert.deepEqual(normalised(text), ["name: CI", "      - uses: actions/checkout@<sha>"]);
  });

  it("keeps a comment at the end of a line, so one can't hide text the shell runs", () => {
    assert.deepEqual(normalised("      - run: npm test #||exit 0\n"), ["      - run: npm test #||exit 0"]);
    assert.deepEqual(normalised("name: CI   # why\n"), ["name: CI   # why"]);
  });

  it("keeps a pin with no version comment, or another comment, as written", () => {
    for (const line of [`      - uses: ${pin}`, `      - uses: ${pin} # latest`, `      - uses: ${pin} # v7.0.1 ; x`]) {
      assert.deepEqual(normalised(`${line}\n`), [line]);
    }
  });

  for (const uses of [
    "actions/checkout@v7",
    "actions/checkout@3d3c42e",
    "actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1",
    "someone/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  ]) {
    it(`keeps a uses: that isn't a pinned GitHub action as written: ${uses}`, () => {
      assert.deepEqual(normalised(`      - uses: ${uses} # v7.0.1\n`), [`      - uses: ${uses} # v7.0.1`]);
    });
  }

  it("keeps a script's comments, blank lines and trailing spaces, which the shell can act on", () => {
    const script = [
      "        run: |",
      "          # a comment",
      "          gh release create \\ ",
      "",
      "            --repo a",
      "      - run: next",
    ];
    assert.deepEqual(normalised(script.join("\n")), script);
  });

  it("ends a script at the next key, without the blank lines before it", () => {
    const text = "      - run: |\n          echo a\n\n      # why\n\n  ci:\n";
    assert.deepEqual(normalised(text), ["      - run: |", "          echo a", "  ci:"]);
  });
});

describe("every workflow", () => {
  it("finds both workflows to scan, and no others", () => {
    assert.deepEqual([...workflowFiles].sort(), ["ci.yml", "release.yml"]);
  });

  for (const file of workflowFiles) {
    it(`${file} is printable ASCII and newlines only`, () => {
      assert.match(readWorkflow(file), PLAIN_TEXT);
    });
  }

  for (const file of workflowFiles) {
    const text = readWorkflow(file);

    it(`${file} pins every action to a full commit SHA, and only GitHub's own`, () => {
      const uses = usesValues(text);
      assert.ok(uses.length > 0);
      for (const value of uses) {
        assert.ok(value === LOCAL_CI || PINNED_ACTION.test(value), value);
      }
    });

    it(`${file} notes the version beside each pinned SHA`, () => {
      const pins = text.split(/\r?\n/).filter((line) => /uses:\s*actions\//.test(line));
      assert.ok(pins.length > 0);
      for (const line of pins) {
        assert.match(line, /@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      }
    });

    it(`${file} uses no secrets`, () => {
      assert.doesNotMatch(codeLines(text).join("\n"), SECRET);
    });

    it(`${file} has no expression inside a run script, only environment variables`, () => {
      const scripts = runScripts(text);
      assert.ok(scripts.length > 0);
      for (const script of scripts) {
        assert.doesNotMatch(script, EXPRESSION);
      }
    });
  }
});

describe("the workflow checks catch", () => {
  const unusual: readonly (readonly [string, string])[] = [
    ["a no-break space", "\u00A0"],
    ["an ideographic space", "\u3000"],
    ["a next-line character", "\u0085"],
    ["a line separator", "\u2028"],
    ["a carriage return", "\r"],
    ["a tab", "\t"],
  ];
  for (const [name, character] of unusual) {
    it(`${name} in a workflow`, () => {
      assert.doesNotMatch(`name: CI${character}# comment\n`, PLAIN_TEXT);
    });
  }

  it("but not plain text with newlines", () => {
    assert.match("name: CI # comment\njobs:\n", PLAIN_TEXT);
  });

  for (const uses of [
    "actions/checkout@v7",
    "actions/checkout@3d3c42e",
    "someone/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1",
  ]) {
    it(`an action that isn't pinned or isn't GitHub's: ${uses}`, () => {
      assert.ok(!PINNED_ACTION.test(uses));
    });
  }

  it("an expression in a one-line run", () => {
    const [script] = runScripts("    steps:\n      - run: echo ${{ github.ref_name }}\n");
    assert.match(script ?? "", EXPRESSION);
  });

  it("an expression in a block run, under a name", () => {
    const text = [
      "      - name: A step",
      "        run: |",
      "          echo first",
      "",
      '          echo "${{ github.head_ref }}"',
      "      - run: echo second",
    ].join("\n");
    const scripts = runScripts(text);
    assert.equal(scripts.length, 2);
    assert.match(scripts[0] ?? "", EXPRESSION);
    assert.doesNotMatch(scripts[1] ?? "", EXPRESSION);
  });

  it("but not an expression in the env beside a run", () => {
    const text = ["      - run: |", '          echo "$NAME"', "        env:", "          NAME: ${{ github.ref_name }}"];
    const [script] = runScripts(text.join("\n"));
    assert.doesNotMatch(script ?? "", EXPRESSION);
  });

  for (const line of ["TOKEN: ${{ secrets.VSCE_PAT }}", "secrets: inherit"]) {
    it(`a secret: ${line}`, () => {
      assert.match(line, SECRET);
    });
  }

  it("but not a comment that mentions a secret or a pin", () => {
    assert.deepEqual(codeLines("# secrets\nname: CI # uses: a/b@main\n"), ["name: CI"]);
  });
});

describe("docs/release-pipeline.md", () => {
  const doc = readFileSync(new URL("docs/release-pipeline.md", root), "utf8");

  // Not the same SHA as the workflows: a security update bumps only the
  // workflow, and a stale example in this doc shouldn't turn its PR red.
  it("pins each action it shows to a full SHA, with none left to fill in, and only actions the workflows use", () => {
    assert.doesNotMatch(doc, /<full-sha>/);
    const actions = new Set(workflowFiles.flatMap((file) => usesValues(readWorkflow(file)).map(withoutSha)));
    const inDoc = doc.match(/actions\/[a-z0-9-]+@\S+/g) ?? [];
    assert.ok(inDoc.length > 0);
    for (const uses of inDoc) {
      assert.ok(PINNED_ACTION.test(uses), uses);
      assert.ok(actions.has(withoutSha(uses)), uses);
    }
  });

  it("says what's built, and how to run the test-tag checks and clean up after them", () => {
    assert.match(doc, /^## What's built$/m);
    assert.match(doc, /^## Test-tag checks$/m);
    assert.ok(doc.includes("gh release delete v<x> --cleanup-tag --yes"));
    assert.ok(doc.includes("git tag -d v<x>"));
  });

  it("shows release.yml exactly as it is, apart from comments on their own line and pins", () => {
    const design = /^### `release\.yml`$[\s\S]*?^```yaml\n([\s\S]*?)^```$/m.exec(doc)?.[1];
    assert.ok(design !== undefined, "the design's release.yml block");
    assert.deepEqual(normalised(design), EXPECTED_RELEASE);
  });
});
