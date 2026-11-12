// Checks the owner's Open VSX instructions (#98): each release is uploaded by
// hand on open-vsx.org, so the docs must hold every step, and nothing about
// Open VSX may creep into the workflows or package.json.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

/** Any mention of the Open VSX CLI or registry. */
const OPEN_VSX = /ovsx|open[- ]?vsx/i;

/** Security rule 3's dev-dependency allowlist. */
const ALLOWED_DEV_DEPENDENCIES = ["@types/node", "@types/vscode", "@vscode/vsce", "esbuild", "typescript"];

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

/** The text under a heading, up to the next heading of the same level or higher. */
function section(doc: string, heading: string, level = 2): string {
  const marks = "#".repeat(level);
  const body = doc.split(`\n${marks} ${heading}\n`)[1];
  assert.ok(body !== undefined, heading);
  const next = new RegExp(`\\n#{1,${level}} `);
  return body.split(next)[0] ?? "";
}

/** The numbered steps in a piece of Markdown, one line each. */
function steps(text: string): string[] {
  return text.match(/^\d+\. .+$/gm) ?? [];
}

const pipeline = read("docs/release-pipeline.md");
const openVsx = section(pipeline, "Open VSX");

describe("the one-time Open VSX setup in docs/release-pipeline.md", () => {
  const setup = steps(section(openVsx, "One-time setup", 3));

  it("has four steps", () => {
    assert.equal(setup.length, 4);
  });

  it("starts with an eclipse.org account with the GitHub Username field filled in", () => {
    assert.match(setup[0] ?? "", /eclipse\.org/);
    assert.match(setup[0] ?? "", /\*\*GitHub Username\*\* field/);
    assert.match(setup[0] ?? "", /`dconyemerekwe`/);
  });

  it("then logs in to open-vsx.org with GitHub", () => {
    assert.match(setup[1] ?? "", /Log in to \[open-vsx\.org\]\(https:\/\/open-vsx\.org\) with GitHub/);
  });

  it("then chooses Log in with Eclipse on the profile page", () => {
    assert.match(setup[2] ?? "", /profile page/);
    assert.match(setup[2] ?? "", /\*\*Log in with Eclipse\*\*/);
  });

  it("ends by signing the Publisher Agreement", () => {
    assert.match(setup[3] ?? "", /Sign the \*\*Publisher Agreement\*\*/);
  });
});

describe("the upload step for each release", () => {
  it("docs/release-pipeline.md downloads the .vsix from the GitHub Release, publishes it and waits for scanning", () => {
    const each = steps(section(openVsx, "Each release", 3));
    assert.equal(each.length, 3);
    assert.match(each[0] ?? "", /Download `0xword\.vsix` from the GitHub Release/);
    assert.match(each[1] ?? "", /\*\*Publish\*\* → \*\*Publish Extension\*\*/);
    assert.match(each[2] ?? "", /Wait for scanning to finish/);
  });

  it("docs/release-pipeline.md's release steps include it after approving publish and before syncing develop", () => {
    const making = steps(section(pipeline, "Making a release"));
    const upload = making.findIndex((step) => step.includes("**Upload it to Open VSX:**"));
    const approve = making.findIndex((step) => step.includes("**Approve it:**"));
    const sync = making.findIndex((step) => step.includes("**Sync `develop`:**"));
    assert.ok(upload > approve && approve >= 0, "upload comes after approve");
    assert.ok(sync > upload, "upload comes before sync");
    assert.match(making[upload] ?? "", /\[Each release\]\(#each-release\)/);
  });

  it("/release's closing steps include it after the GitHub Release exists", () => {
    const closing = steps(section(read(".claude/skills/release/SKILL.md"), "6. Tell the owner what happens next"));
    const upload = closing.find((step) => step.includes("upload to Open VSX")) ?? "";
    assert.match(upload, /Once the version is on the Marketplace/);
    assert.match(upload, /download `0xword\.vsix` from the `v<new>` GitHub Release/);
    assert.match(upload, /\*\*Publish\*\* → \*\*Publish Extension\*\*/);
    assert.match(upload, /wait for scanning to finish/);
    const approve = closing.findIndex((step) => step.includes("approve the `publish` job"));
    const sync = closing.findIndex((step) => step.includes("from `main` into `develop`"));
    assert.ok(approve >= 0, "the approve step is there");
    assert.ok(closing.indexOf(upload) > approve, "upload comes after approve");
    assert.ok(sync > closing.indexOf(upload), "upload comes before the develop sync");
  });
});

describe("when there's no GitHub Release for the tag", () => {
  const fallback = /If there's no GitHub Release for the tag, download and unzip the `0xword-vsix` artifact from the release run in the Actions tab instead, within CI's 14-day retention/i;

  it("docs/release-pipeline.md's upload step says to download the run's artifact instead", () => {
    const first = steps(section(openVsx, "Each release", 3))[0] ?? "";
    assert.match(first, fallback);
  });

  it("/release's upload step says the same", () => {
    const closing = steps(section(read(".claude/skills/release/SKILL.md"), "6. Tell the owner what happens next"));
    assert.match(closing.find((step) => step.includes("upload to Open VSX")) ?? "", fallback);
  });
});

describe("a failed Open VSX upload", () => {
  it("is under When something fails: the Marketplace release stands, retry the upload, re-run nothing", () => {
    const making = section(pipeline, "Making a release");
    const failing = making.split("### When something fails")[1] ?? "";
    const bullet = failing.split("\n").find((line) => line.startsWith("- **The Open VSX upload fails:**")) ?? "";
    assert.match(bullet, /the Marketplace release stands/);
    assert.match(bullet, /Try the upload again on open-vsx\.org/);
    assert.match(bullet, /nothing in the workflows needs re-running/);
  });
});

describe("the decision to upload by hand", () => {
  const plan = read("docs/PLAN.md");
  const phase6 = section(plan, "Phase 6: Publish");
  const notYet = section(pipeline, "Not included yet");

  it("docs/PLAN.md no longer lists ovsx as an open issue", () => {
    assert.doesNotMatch(plan, /Open issue:\*\* `ovsx`/);
    assert.doesNotMatch(plan, /npx ovsx/);
    assert.doesNotMatch(plan, /publish with `ovsx`/);
  });

  it("docs/PLAN.md records the owner's decision, with no ovsx dependency and no stored token", () => {
    assert.match(phase6, /\*\*Open VSX \(#98\):\*\* the owner uploads each release by hand on the open-vsx\.org website \(owner's decision\)/);
    assert.match(phase6, /no `ovsx` dependency/);
    assert.match(phase6, /no stored token/);
  });

  it("docs/release-pipeline.md's Not included yet matches: no pending ovsx decision, uploads by hand", () => {
    assert.doesNotMatch(notYet, /`ovsx` decision/);
    assert.doesNotMatch(notYet, /npx ovsx/);
    assert.match(notYet, /The owner uploads each release on the website/);
    assert.match(notYet, /no `ovsx` dependency and no stored token/);
  });

  it("docs/release-pipeline.md's Open VSX section says the same", () => {
    assert.match(openVsx, /There's no `ovsx` dependency, no Open VSX job in the workflows and no stored Open VSX token/);
  });

  it("docs/release-pipeline.md's What's built table no longer says Not built", () => {
    const row = section(pipeline, "What's built").split("\n").find((line) => line.startsWith("| Open VSX |")) ?? "";
    assert.doesNotMatch(row, /Not built/);
    assert.match(row, /#98/);
  });
});

describe("the Open VSX namespace", () => {
  const namespace = section(openVsx, "The namespace", 3);

  it("is created by the website, matching the GitHub ID, with contributor rights", () => {
    assert.match(namespace, /creates the namespace on the website, matching the GitHub ID \(`dconyemerekwe`/);
    assert.match(namespace, /contributor rights/);
  });

  it("needs a separate request for owner rights to remove the unverified-publisher warning", () => {
    assert.match(namespace, /unverified-publisher warning/);
    assert.match(namespace, /\*\*Removing the warning takes a separate request for owner rights\*\*/);
  });

  it("matches the publisher in package.json", () => {
    const manifest = JSON.parse(read("package.json")) as { publisher?: string };
    assert.equal(manifest.publisher, "dconyemerekwe");
  });
});

describe("nothing about Open VSX in the workflows or package.json", () => {
  const workflows = readdirSync(new URL(".github/workflows/", root)).filter((name) => /\.ya?ml$/.test(name));

  it("finds the workflows to check", () => {
    assert.ok(workflows.includes("ci.yml"));
    assert.ok(workflows.includes("release.yml"));
  });

  for (const name of workflows) {
    it(`.github/workflows/${name} doesn't mention Open VSX or ovsx`, () => {
      assert.doesNotMatch(read(`.github/workflows/${name}`), OPEN_VSX);
    });
  }

  it("package.json doesn't mention Open VSX or ovsx", () => {
    assert.doesNotMatch(read("package.json"), OPEN_VSX);
  });

  it("package-lock.json doesn't install ovsx", () => {
    assert.doesNotMatch(read("package-lock.json"), /node_modules\/ovsx"/);
  });

  it("package.json has no runtime dependencies and only the allowlisted dev dependencies", () => {
    const manifest = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.equal(manifest.dependencies, undefined);
    assert.deepEqual(Object.keys(manifest.devDependencies ?? {}).sort(), ALLOWED_DEV_DEPENDENCIES);
  });
});
