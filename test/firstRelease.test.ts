// Checks the owner's first-release checklist (#99): publishing can't be undone,
// so the steps must stay in order, every link must lead somewhere, and the
// fallback for a refused `--oidc` must say exactly which file to upload.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

/** The text under a heading, up to the next heading of the same level or higher. */
function section(doc: string, heading: string, level = 2): string {
  const marks = "#".repeat(level);
  const body = doc.split(`\n${marks} ${heading}\n`)[1];
  assert.ok(body !== undefined, heading);
  return body.split(new RegExp(`\\n#{1,${level}} `))[0] ?? "";
}

/** Each top-level numbered step, with its indented lines, up to any subheading. */
function steps(text: string): string[] {
  const list = text.split("\n### ")[0] ?? "";
  return list.split(/^(?=\d+\. )/m).filter((chunk) => /^\d+\. /.test(chunk));
}

/** GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every heading anchor in a Markdown file, skipping fenced code; repeats get -1, -2, … as on GitHub. */
function anchors(doc: string): Set<string> {
  const found = new Set<string>();
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of doc.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = /^#{1,6} (.+)$/.exec(line)?.[1];
    if (fenced || heading === undefined) continue;
    const base = slug(heading);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    found.add(count === 0 ? base : `${base}-${count}`);
  }
  return found;
}

/** The targets of every same-file link, such as `[x](#install-check)`. */
function localLinks(text: string): string[] {
  return [...text.matchAll(/\]\(#([^)\s]+)\)/g)].map((match) => match[1] ?? "");
}

const pipeline = read("docs/release-pipeline.md");
const plan = read("docs/PLAN.md");
const firstRelease = section(pipeline, "First release");
const checklist = steps(firstRelease);

describe("the anchor helpers", () => {
  it("turn a heading with code and punctuation into GitHub's anchor", () => {
    assert.equal(slug("The `production` environment"), "the-production-environment");
    assert.equal(slug("If the Marketplace refuses `--oidc`"), "if-the-marketplace-refuses---oidc");
    assert.equal(slug("What's built"), "whats-built");
  });

  it("skip headings inside fenced code and number repeats", () => {
    const found = anchors("## A\n```yaml\n# not a heading\n```\n## A\n");
    assert.deepEqual([...found], ["a", "a-1"]);
  });
});

describe("the first-release checklist in docs/release-pipeline.md", () => {
  const order = [
    /\*\*Phase 5 checks:\*\*.*\[install check\].*\[test-tag checks\]/,
    /\*\*Make the repo public:\*\*/,
    /\*\*The `production` environment:\*\*.*required reviewer/,
    /\*\*Recreate the Trusted Publishing policy\*\* just before tagging/,
    /\*\*`\/release minor`, then merge, tag and approve:\*\*/,
    /\*\*The Open VSX upload:\*\*/,
    /\*\*The sync PR back to `develop`:\*\*/,
  ];

  it("has the seven release steps in the required order, then the post-release checks", () => {
    assert.equal(checklist.length, order.length + 3);
    order.forEach((step, index) => assert.match(checklist[index] ?? "", step, `step ${index + 1}`));
  });

  it("links every release step to the section with its details", () => {
    checklist.slice(0, order.length).forEach((step, index) => {
      assert.ok(localLinks(step).length > 0, `step ${index + 1} has a link`);
    });
  });

  it("only links to anchors that exist in the file", () => {
    const known = anchors(pipeline);
    const links = localLinks(firstRelease);
    assert.ok(links.length >= order.length);
    for (const link of links) assert.ok(known.has(link), `#${link}`);
  });

  it("every same-file link in docs/release-pipeline.md resolves", () => {
    const known = anchors(pipeline);
    for (const link of localLinks(pipeline)) assert.ok(known.has(link), `#${link}`);
  });

  it("says publishing can't be undone, because a version number can't be used again", () => {
    assert.match(firstRelease, /\*\*Publishing can't be undone:\*\*/);
    assert.match(firstRelease, /never accepts the same version number twice/);
  });

  it("says why the repo goes public: README images load from main", () => {
    assert.match(checklist[1] ?? "", /\[Making the repo public\]\(#making-the-repo-public\)/);
    assert.match(checklist[1] ?? "", /images from `main`/);
  });

  it("recreates the policy within 48 hours of the tag", () => {
    assert.match(checklist[3] ?? "", /\[Trusted Publishing\]\(#trusted-publishing\)/);
    assert.match(checklist[3] ?? "", /within 48 hours/);
  });

  it("points the Open VSX upload at the one-time setup first, then Each release", () => {
    const upload = checklist[5] ?? "";
    assert.ok(upload.indexOf("(#one-time-setup)") >= 0);
    assert.ok(upload.indexOf("(#one-time-setup)") < upload.indexOf("(#each-release)"));
  });

  it("re-checks that the ID is free on both stores just before the tag", () => {
    const release = checklist[4] ?? "";
    assert.match(release, /re-check that the ID `dconyemerekwe\.0xword` is still free on both stores/);
    assert.match(release, /isn't reserved until its first publish/);
    assert.ok(release.includes("https://marketplace.visualstudio.com/items?itemName=dconyemerekwe.0xword"));
    assert.ok(release.includes("https://open-vsx.org/api/dconyemerekwe/0xword"));
    assert.ok(release.indexOf("re-check") < release.indexOf("If `publish` fails"));
  });

  it("checks the Marketplace page after the release", () => {
    assert.match(checklist[7] ?? "", /\*\*Check the Marketplace page:\*\*.*the icon, the wordmark, the screenshots and the README/);
  });

  it("installs from the Marketplace in a clean profile and plays a round", () => {
    const install = checklist[8] ?? "";
    assert.match(install, /\*\*Install from the Marketplace in a clean profile:\*\*/);
    assert.match(install, /code --profile/);
    assert.match(install, /play a round/);
  });

  it("ends by marking Phases 5 and 6 done in a follow-up commit", () => {
    assert.match(checklist[9] ?? "", /\*\*Mark Phases 5 and 6 done\*\* in `docs\/PLAN\.md`, in a follow-up commit/);
  });

  it("has a place to record what happened on the first release, with the ID check", () => {
    const happened = section(firstRelease.slice(firstRelease.indexOf("\n### ")), "What happened on the first release", 3);
    assert.match(happened, /whether `--oidc` worked, or the `\.vsix` was uploaded by hand/);
    assert.match(happened, /2026-11-12/);
  });
});

describe("the fallback when the Marketplace refuses --oidc", () => {
  const fallback = section(section(pipeline, "Trusted Publishing"), "If the Marketplace refuses `--oidc`", 3);

  it("the checklist sends a refused --oidc there, on a first publish or with --packagePath", () => {
    const release = checklist[4] ?? "";
    assert.match(release, /refuses `--oidc`, on a first publish or with `--packagePath`/);
    assert.match(release, /\(#if-the-marketplace-refuses---oidc\)/);
    assert.match(release, /upload the same CI-built `\.vsix` by hand on the manage page/);
    assert.match(release, /record what happened/);
  });

  it("uploads the same CI-built .vsix by hand on the manage page", () => {
    assert.match(fallback, /on a first publish or with `--packagePath`/);
    assert.match(fallback, /upload the same CI-built `\.vsix` by hand/);
    assert.match(fallback, /\[manage page\]\(https:\/\/marketplace\.visualstudio\.com\/manage\)/);
  });

  it("checks the version didn't go out before uploading", () => {
    assert.match(fallback, /If the version is already there, it went out: don't upload it again/);
  });

  it("unzips the 0xword-vsix artifact within the retention and uploads the .vsix inside", () => {
    assert.match(fallback, /`0xword-vsix` artifact/);
    assert.match(fallback, /within CI's 14-day retention/);
    assert.match(fallback, /downloads as a zip: unzip it and take the `0xword\.vsix` inside/);
    assert.match(fallback, /not the zip/);
  });

  it("records what happened in docs/release-pipeline.md", () => {
    assert.match(fallback, /Record what happened in \[What happened on the first release\]\(#what-happened-on-the-first-release\)/);
  });
});

describe("the 48-hour Trusted Publishing rule", () => {
  for (const [name, text] of [
    ["docs/release-pipeline.md", pipeline],
    ["docs/PLAN.md", plan],
  ] as const) {
    it(`${name} applies it to every new policy, with no "while the repo is private"`, () => {
      assert.match(text, /A new policy has to be used within 48 hours,? or it stays inactive/);
      const sentences = text.split(/(?<=[.:])\s/).filter((sentence) => sentence.includes("48 hours"));
      assert.ok(sentences.length > 0);
      for (const sentence of sentences) assert.doesNotMatch(sentence, /private/i, sentence);
    });

    it(`${name} still says to recreate it just before the first release tag`, () => {
      assert.match(text, /recreates it (with these values )?just before the first release tag/);
    });
  }
});

describe("docs/PLAN.md before the first release", () => {
  const row = (phase: string): string => plan.split("\n").find((line) => line.startsWith(`| ${phase} |`)) ?? "";

  it("doesn't mark Phases 5 and 6 done yet", () => {
    for (const phase of ["5", "6"]) {
      assert.notEqual(row(phase), "", `phase ${phase} row`);
      assert.doesNotMatch(row(phase), /\| Done/, `phase ${phase}`);
    }
  });

  it("says the checklist is written and the first release is pending", () => {
    assert.match(row("6"), /first-release checklist is written \(#99\)/);
    assert.match(row("6"), /the first release is pending/);
  });

  it("links Phase 6 to the checklist", () => {
    assert.match(section(plan, "Phase 6: Publish"), /\(release-pipeline\.md#first-release\)/);
  });
});
