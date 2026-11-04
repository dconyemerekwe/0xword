// Checks the GitHub Actions workflows (#87): what starts them, what they may
// write, and what they run. There is no YAML parser here (security rule 3), so
// the workflows are read as indented lines, which is enough for the plain
// block style they're written in. Anything written another way, such as
// `permissions: write-all` or a quoted `uses:`, fails these checks.
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

function readWorkflow(file: string): string {
  return readFileSync(new URL(`${WORKFLOW_FOLDER}/${file}`, root), "utf8");
}

/** The text as lines, without comments and blank lines. */
function codeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, "").trimEnd())
    .filter((line) => line !== "");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The lines nested under `key:` at this indent, or undefined if there's no such block. */
function block(lines: readonly string[], key: string, indent = 0): string[] | undefined {
  const start = lines.indexOf(`${" ".repeat(indent)}${key}:`);
  if (start < 0) {
    return undefined;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => indentOf(line) <= indent);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The same lines, without their indentation. */
function trimmed(lines: readonly string[] | undefined): string[] | undefined {
  return lines?.map((line) => line.trim());
}

/** Each job's lines by its id, in file order. */
function jobsOf(text: string): Map<string, string[]> {
  const jobs = new Map<string, string[]>();
  const lines = block(codeLines(text), "jobs") ?? [];
  for (const line of lines) {
    const id = /^ {2}([\w-]+):$/.exec(line)?.[1];
    if (id !== undefined) {
      jobs.set(id, block(lines, id, 2) ?? []);
    }
  }
  return jobs;
}

/** A nested `key:` block of a job from jobsOf, without its indentation. */
function jobBlock(job: readonly string[], key: string): string[] | undefined {
  return trimmed(block(job, key, 4));
}

/** The value of a job's one-line `key: value`. */
function jobValue(job: readonly string[], key: string): string | undefined {
  const prefix = `    ${key}: `;
  return job.find((line) => line.startsWith(prefix))?.slice(prefix.length);
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
const ciText = readWorkflow("ci.yml");
const releaseText = readWorkflow("release.yml");
const ciLines = codeLines(ciText);
const releaseLines = codeLines(releaseText);
const releaseJobs = jobsOf(releaseText);

function releaseJob(id: string): string[] {
  const job = releaseJobs.get(id);
  assert.ok(job, `release.yml has no job ${id}`);
  return job;
}

describe("ci.yml", () => {
  it("also runs on workflow_call and keeps every other trigger", () => {
    assert.deepEqual(trimmed(block(ciLines, "on")), [
      "pull_request:",
      "branches: [develop, main]",
      "push:",
      "branches: [develop, main]",
      "workflow_dispatch:",
      "workflow_call:",
    ]);
  });

  it("keeps every step, in order", () => {
    const steps = (jobsOf(ciText).get("check") ?? []).flatMap((line) => {
      const step = /^\s*- (?:run|uses): (.*)$/.exec(line)?.[1];
      return step === undefined ? [] : [withoutSha(step)];
    });
    assert.deepEqual(steps, [
      "actions/checkout",
      "actions/setup-node",
      "npm ci",
      "npm audit signatures",
      "npm run typecheck",
      "npm test",
      "npm run build",
      'npm run package -- --out "$RUNNER_TEMP/0xword.vsix"',
      "actions/upload-artifact",
    ]);
  });

  it("stays read-only, so it never asks for more than release.yml gives it", () => {
    assert.deepEqual(trimmed(block(ciLines, "permissions")), ["contents: read"]);
    assert.doesNotMatch(ciLines.join("\n"), /\bwrite\b/);
  });

  it("keeps a concurrency group apart from release.yml's, so it can't cancel the release run", () => {
    const group = block(ciLines, "concurrency")?.find((line) => line.includes("group:"));
    assert.equal(group?.trim(), "group: ci-${{ github.ref }}");
  });
});

describe("release.yml triggers and permissions", () => {
  it("is triggered only by a pushed v* tag", () => {
    assert.deepEqual(trimmed(block(releaseLines, "on")), ["push:", "tags: ['v*']"]);
  });

  it("is read-only by default", () => {
    assert.deepEqual(trimmed(block(releaseLines, "permissions")), ["contents: read"]);
  });

  it("gives contents: write to github-release only", () => {
    assert.deepEqual(jobBlock(releaseJob("github-release"), "permissions"), ["contents: write"]);
    for (const [id, job] of releaseJobs) {
      if (id !== "github-release") {
        assert.equal(jobBlock(job, "permissions"), undefined, id);
        assert.doesNotMatch(job.join("\n"), /\bwrite\b/, id);
      }
    }
  });

  it("never cancels a release in progress", () => {
    assert.deepEqual(trimmed(block(releaseLines, "concurrency")), [
      "group: release",
      "cancel-in-progress: false",
    ]);
  });
});

describe("release.yml jobs", () => {
  it("has verify-tag, ci and github-release, and no publish job before Phase 6", () => {
    assert.deepEqual([...releaseJobs.keys()], ["verify-tag", "ci", "github-release"]);
  });

  it("chains the jobs verify-tag, then ci, then github-release", () => {
    assert.equal(jobValue(releaseJob("verify-tag"), "needs"), undefined);
    assert.equal(jobValue(releaseJob("ci"), "needs"), "verify-tag");
    assert.equal(jobValue(releaseJob("github-release"), "needs"), "ci");
  });

  it("has no job condition that could run a job after an earlier one failed", () => {
    for (const [id, job] of releaseJobs) {
      assert.equal(jobValue(job, "if"), undefined, id);
    }
  });

  it("has no step or job that carries on after a failure", () => {
    assert.doesNotMatch(releaseLines.join("\n"), /continue-on-error/);
  });

  it("runs ci.yml itself rather than copying its checks", () => {
    const job = releaseJob("ci");
    assert.equal(jobValue(job, "uses"), LOCAL_CI);
    assert.equal(jobBlock(job, "steps"), undefined);
  });
});

describe("release.yml verify-tag", () => {
  const job = releaseJob("verify-tag");
  const scripts = runScripts(job.join("\n")).join("\n");

  it("fetches all of history, which is what makes actions/checkout fetch origin/main", () => {
    const steps = jobBlock(job, "steps") ?? [];
    assert.ok(steps.includes("fetch-depth: 0"), steps.join("\n"));
    assert.ok(steps.includes("persist-credentials: false"), steps.join("\n"));
  });

  it("fails if the tag isn't v plus the version in package.json", () => {
    assert.ok(scripts.includes(`expected="v$(node -p "require('./package.json').version")"`), scripts);
    assert.ok(scripts.includes('if [ "$GITHUB_REF_NAME" != "$expected" ]; then'), scripts);
    assert.match(scripts, /does not match package\.json[^\n]*\n\s*exit 1/);
  });

  it("fails if the tagged commit isn't on main", () => {
    assert.ok(scripts.includes('if ! git merge-base --is-ancestor "$GITHUB_SHA" origin/main; then'), scripts);
    assert.match(scripts, /isn't on main[^\n]*\n\s*exit 1/);
  });
});

describe("release.yml github-release", () => {
  const job = releaseJob("github-release");

  it("downloads the artifact ci.yml uploads, to the folder the release reads it from", () => {
    const upload = trimmed(ciLines.slice(ciLines.findIndex((line) => line.includes("actions/upload-artifact")))) ?? [];
    assert.ok(upload.includes("name: 0xword-vsix"), upload.join("\n"));
    assert.ok(upload.includes("path: ${{ runner.temp }}/0xword.vsix"), upload.join("\n"));

    const steps = jobBlock(job, "steps") ?? [];
    assert.ok(steps.includes("name: 0xword-vsix"), steps.join("\n"));
    assert.ok(steps.includes("path: ${{ runner.temp }}"), steps.join("\n"));
  });

  it("creates the release for the existing tag, with generated notes and the .vsix attached", () => {
    const script = runScripts(job.join("\n")).join("\n");
    assert.ok(script.includes('gh release create "$GITHUB_REF_NAME" "$RUNNER_TEMP/0xword.vsix"'), script);
    for (const flag of ['--repo "$GITHUB_REPOSITORY"', "--verify-tag", "--generate-notes"]) {
      assert.ok(script.includes(flag), flag);
    }
  });

  it("has no checkout, so no repo code runs next to the write token", () => {
    assert.deepEqual(usesValues(job.join("\n")).map(withoutSha), ["actions/download-artifact"]);
  });

  it("authenticates only with the automatic token", () => {
    assert.ok(job.some((line) => line.trim() === "GH_TOKEN: ${{ github.token }}"), job.join("\n"));
  });
});

describe("every workflow", () => {
  it("finds both workflows to scan", () => {
    assert.deepEqual([...workflowFiles].sort(), ["ci.yml", "release.yml"]);
  });

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

  it("a job granted write access, read from its permissions block", () => {
    const text = "jobs:\n  a:\n    permissions:\n      contents: write\n    runs-on: ubuntu-latest\n";
    assert.deepEqual(jobBlock(jobsOf(text).get("a") ?? [], "permissions"), ["contents: write"]);
  });

  it("but not a comment that mentions a secret or a pin", () => {
    assert.deepEqual(codeLines("# secrets\nname: CI # uses: a/b@main\n"), ["name: CI"]);
  });
});

describe("docs/release-pipeline.md", () => {
  const doc = readFileSync(new URL("docs/release-pipeline.md", root), "utf8");

  it("shows the same action pins as the workflows, with none left to fill in", () => {
    assert.doesNotMatch(doc, /<full-sha>/);
    const pinned = new Set(workflowFiles.flatMap((file) => usesValues(readWorkflow(file))));
    const inDoc = doc.match(/actions\/[a-z0-9-]+@\S+/g) ?? [];
    assert.ok(inDoc.length > 0);
    for (const uses of inDoc) {
      assert.ok(pinned.has(uses), uses);
    }
  });

  it("says what's built, and how to run the test-tag checks and clean up after them", () => {
    assert.match(doc, /^## What's built$/m);
    assert.match(doc, /^## Test-tag checks$/m);
    assert.ok(doc.includes("gh release delete v<x> --cleanup-tag --yes"));
    assert.ok(doc.includes("git tag -d v<x>"));
  });
});
