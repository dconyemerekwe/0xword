// Checks that the owner's release instructions match the publish job (#97): a
// missing production environment would publish a tag with nothing stopping it,
// and the owner follows these docs literally.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

/** The last commit on develop before release.yml gained its publish job. */
const LAST_COMMIT_WITHOUT_PUBLISH = "3037813";

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

  it("keep the four steps", () => {
    assert.equal(steps.length, 4);
  });

  it("say to approve the publish job in the Actions tab", () => {
    assert.match(steps[2] ?? "", /Actions tab/);
    assert.match(steps[2] ?? "", /approve the `publish` job/);
  });

  it("no longer say to publish by hand", () => {
    assert.doesNotMatch(closing, /by hand/);
    assert.doesNotMatch(closing, /Publish as/);
  });

  it("check the environment before the tag is pushed", () => {
    assert.match(steps[1] ?? "", /`production` environment/);
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

  it("docs/release-pipeline.md gives a check for the reviewer, and says what to do if it fails", () => {
    assert.ok(pipeline.includes("gh api repos/dconyemerekwe/0xword/environments/production"));
    assert.ok(pipeline.includes('select(.type == "required_reviewers")'));
    assert.match(pipeline, /\*\*don't push the tag\*\*/);
  });

  it("makes the release steps run that check before tagging", () => {
    const making = section(read("docs/release-pipeline.md"), "Making a release");
    assert.match(making, /\*\*Tag it:\*\* first run \[the environment check\]/);
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

  it("check 2 stops first if that commit is already on main", () => {
    const body = check(checks, "2");
    assert.ok(body.includes(`git merge-base --is-ancestor ${LAST_COMMIT_WITHOUT_PUBLISH} origin/main`));
    assert.ok(body.indexOf("merge-base") < body.indexOf("git tag"));
  });

  it("check 3A cleans up the release it creates", () => {
    assert.ok(check(checks, "3A").includes("gh release delete v<x> --cleanup-tag --yes"));
  });

  it("check 3B runs the environment check first, rejects the run and never approves it", () => {
    const body = check(checks, "3B");
    assert.match(body, /First run the \[environment check\]/);
    assert.ok(body.indexOf("environment check") < body.indexOf("git tag"));
    assert.match(body, /choose \*\*Reject\*\*/);
    assert.match(body, /\*\*Don't choose Approve and deploy or Start all waiting jobs:\*\*/);
    assert.match(body, /`github-release` as skipped/);
  });

  it("no check tags the tip of main with a bare git tag", () => {
    assert.doesNotMatch(checks, /git checkout main/);
    assert.doesNotMatch(checks, /^git tag v\S+$/m);
  });

  it("repeating check 2 on a later commit stops first if develop is already on main", () => {
    const repeat = checks.split("### Repeating checks 1 and 2 on a later commit")[1] ?? "";
    assert.ok(repeat.includes("git merge-base --is-ancestor origin/develop origin/main"));
  });
});
