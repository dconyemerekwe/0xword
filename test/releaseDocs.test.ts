// Checks that the owner's release instructions match the publish job (#97): a
// missing production environment would publish a tag with nothing stopping it,
// and the owner follows these docs literally.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

/** The last commit on develop before release.yml gained its publish job. */
const LAST_COMMIT_WITHOUT_PUBLISH = "3037813";

/** GitHub ignores an environment's rules once a repo goes private, so this must print PUBLIC. */
const VISIBILITY_CHECK = "gh repo view dconyemerekwe/0xword --json visibility --jq .visibility";

/** On one line, because a trailing backslash breaks in PowerShell, the project's main shell. */
const REVIEWER_CHECK =
  "gh api repos/dconyemerekwe/0xword/environments/production --jq '.protection_rules[] | select(.type == \"required_reviewers\") | .reviewers[].reviewer.login'";

/** Prints a count only if both refs exist, so a bad ref can't look like a pass. */
const GUARD_3037813 = `git rev-list --count origin/main..${LAST_COMMIT_WITHOUT_PUBLISH}`;

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

/** The text under a `## ` heading, up to the next one. */
function section(doc: string, heading: string): string {
  const body = doc.split(`\n## ${heading}\n`)[1];
  assert.ok(body !== undefined, heading);
  return body.split("\n## ")[0] ?? "";
}

/** The text from a bold check title up to the next one. */
function check(checks: string, title: string): string {
  const body = checks.split(`**Check ${title}:`)[1];
  assert.ok(body !== undefined, title);
  return body.split(/\n\*\*Check |\n### /)[0] ?? "";
}

describe("/release's closing steps", () => {
  const closing = section(read(".claude/skills/release/SKILL.md"), "6. Tell the owner what happens next");
  const steps = closing.match(/^\d+\. .+$/gm) ?? [];

  it("keep the five steps, with the Open VSX upload added by #98", () => {
    assert.equal(steps.length, 5);
  });

  it("say to approve the publish job in the Actions tab", () => {
    assert.match(steps[2] ?? "", /Actions tab/);
    assert.match(steps[2] ?? "", /approve the `publish` job/);
  });

  it("no longer say to publish by hand", () => {
    assert.doesNotMatch(closing, /by hand/);
    assert.doesNotMatch(closing, /Publish as/);
  });

  it("check the environment and that the repo is public before the tag is pushed", () => {
    assert.match(steps[1] ?? "", /`production` environment/);
    assert.ok((steps[1] ?? "").includes(VISIBILITY_CHECK));
    assert.match(steps[1] ?? "", /stop unless it prints `PUBLIC` and `dconyemerekwe`/);
  });

  it("say to merge with a merge commit, or the checks on main can't find develop's commits", () => {
    assert.match(steps[0] ?? "", /\*\*Create a merge commit\*\*/);
  });
});

describe("the production environment rule", () => {
  const pipeline = section(read("docs/release-pipeline.md"), "The `production` environment");
  const plan = read("docs/PLAN.md");

  for (const [name, text] of [
    ["docs/release-pipeline.md", pipeline],
    ["docs/PLAN.md", plan],
  ] as const) {
    it(`${name} says it must exist with the owner's approval before any tag is pushed`, () => {
      assert.match(text, /must exist, with the owner's approval on it, before any tag is pushed/);
    });

    it(`${name} says why: GitHub creates a missing one with no approval rule`, () => {
      assert.match(text, /GitHub creates a missing environment automatically,? with no approval rule/);
      assert.match(text, /publish with nothing stopping it/);
    });

    it(`${name} says the repo has to be public first`, () => {
      assert.match(text, /public first/);
    });
  }

  it("docs/release-pipeline.md gives a check for the public repo and the reviewer, each on one line", () => {
    const lines = pipeline.split("\n");
    assert.ok(lines.includes(VISIBILITY_CHECK));
    assert.ok(lines.includes(REVIEWER_CHECK));
  });

  it("docs/release-pipeline.md says what the check must print, and what to do if it doesn't", () => {
    assert.match(pipeline, /The first must print `PUBLIC`, and the second `dconyemerekwe`/);
    assert.match(pipeline, /\*\*don't push the tag\*\*/);
  });

  it("docs/release-pipeline.md says Start all waiting jobs would publish", () => {
    assert.match(pipeline, /\*\*Choosing that button, in check 3B or any other run, would publish\.\*\*/);
  });

  it("makes the release steps run that check before tagging, after a merge commit", () => {
    const making = section(read("docs/release-pipeline.md"), "Making a release");
    assert.match(making, /\*\*Tag it:\*\* first run \[the environment check\].*stop unless it prints `PUBLIC` and `dconyemerekwe`/);
    assert.match(making, /\*\*Create a merge commit\*\*/);
  });
});

describe("the test-tag checks", () => {
  const checks = section(read("docs/release-pipeline.md"), "Test-tag checks");

  it("warn that a later commit can publish, and name the last commit that can't", () => {
    assert.ok(checks.includes(`\`${LAST_COMMIT_WITHOUT_PUBLISH}\`, the last \`develop\` commit before #97`));
    assert.match(checks, /\*\*Don't tag one until \[the `production` environment\]/);
  });

  for (const title of ["1", "2", "3A"]) {
    it(`check ${title} tags the commit with no publish job`, () => {
      assert.match(check(checks, title), new RegExp(`git tag v\\S+ ${LAST_COMMIT_WITHOUT_PUBLISH}\\n`));
    });
  }

  it("check 2 stops first if that commit is already on main, or git fails", () => {
    const body = check(checks, "2");
    assert.ok(body.includes(GUARD_3037813));
    assert.ok(body.indexOf(GUARD_3037813) < body.indexOf("git tag"));
    assert.match(body, /Go on only if it prints a number above `0`/);
    assert.match(body, /`fatal:` line means stop/);
  });

  it("check 3A stops first if that commit isn't on main yet, or git fails", () => {
    const body = check(checks, "3A");
    assert.ok(body.includes(GUARD_3037813));
    assert.ok(body.indexOf(GUARD_3037813) < body.indexOf("git tag"));
    assert.match(body, /Go on only if it prints `0`/);
    assert.match(body, /`fatal:` line means stop/);
  });

  it("no guard can print an OK when git fails", () => {
    assert.doesNotMatch(checks, /\|\| echo "OK/);
  });

  it("check 3A cleans up the release it creates", () => {
    assert.ok(check(checks, "3A").includes("gh release delete v<x> --cleanup-tag --yes"));
  });

  it("check 3B runs the environment check first, rejects the run and never approves it", () => {
    const body = check(checks, "3B");
    assert.match(body, /First run the \[environment check\].*stop unless it prints `PUBLIC` and `dconyemerekwe`/);
    assert.ok(body.indexOf("environment check") < body.indexOf("git tag"));
    assert.match(body, /choose \*\*Reject\*\*/);
    assert.match(body, /\*\*Don't choose Approve and deploy or Start all waiting jobs:\*\*/);
    assert.match(body, /`github-release` must stay skipped, and no release must appear/);
    assert.doesNotMatch(body, /must then show as failed/);
  });

  it("no check tags the tip of main with a bare git tag", () => {
    assert.doesNotMatch(checks, /git checkout main/);
    assert.doesNotMatch(checks, /^git tag v\S+$/m);
  });

  it("repeating check 2 on a later commit stops first if develop is already on main", () => {
    const repeat = checks.split("### Repeating checks 1 and 2 on a later commit")[1] ?? "";
    assert.ok(repeat.includes("git rev-list --count origin/main..origin/develop"));
    assert.match(repeat, /`0` or a `fatal:` line means stop/);
  });
});
