// Checks the vsce the release path depends on (#96): the exact version, that
// its `publish` command offers `--oidc`, and that every runner's Node meets its
// `engines`. Nothing here publishes or uses the network: `publish --help` prints
// and exits before vsce's update check, which only runs for a command's action.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const VSCE_FOLDER = join(root, "node_modules/@vscode/vsce");
const WORKFLOW_FOLDER = join(root, ".github/workflows");

/**
 * The vsce version the checks below were last made against. A bump fails here
 * on purpose. Before changing this, re-check what the repo relies on and vsce
 * doesn't promise: DESCRIPTION_TAG_WORDS in test/manifest.test.ts, the internal
 * `pack` in test/package.test.ts, and how `--oidc` behaves in out/oidc.js and
 * out/publish.js (docs/release-pipeline.md#trusted-publishing).
 */
const VSCE_VERSION = "4.1.0";

/** What a failed pin check tells whoever bumped vsce. */
const RECHECK = "vsce changed: re-check the list above VSCE_VERSION in test/vsce.test.ts, then update it";

/** The oldest Node 4.1.0's `engines` allows. */
const VSCE_MINIMUM_NODE = 22;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Whether a command's help lists a flag as an option, not just mentions it. */
function listsOption(help: string, flag: string): boolean {
  return help.split("\n").some((line) => {
    // The flags column ends at the first gap of two spaces, where the description starts.
    const flags = line.trimStart().split(/\s{2,}/)[0] ?? "";
    return flags.startsWith("-") && flags.split(/[\s,]+/).includes(flag);
  });
}

/** The Node versions a workflow or doc asks setup-node for, as written. */
function nodeVersions(text: string): string[] {
  return [...text.matchAll(/^\s*node-version:\s*(\S+)/gm)].map((match) => match[1] ?? "");
}

function workflows(): { readonly file: string; readonly text: string }[] {
  return readdirSync(WORKFLOW_FOLDER).map((file) => ({
    file,
    text: readFileSync(join(WORKFLOW_FOLDER, file), "utf8"),
  }));
}

describe("the vsce version", () => {
  it("is pinned exactly in package.json", () => {
    const manifest = readJson(join(root, "package.json")) as { devDependencies?: Record<string, string> };
    assert.equal(manifest.devDependencies?.["@vscode/vsce"], VSCE_VERSION, RECHECK);
  });

  it("is locked exactly in package-lock.json, from the npm registry", () => {
    const lock = readJson(join(root, "package-lock.json")) as {
      packages?: Record<string, { version?: string; resolved?: string; devDependencies?: Record<string, string> }>;
    };
    assert.equal(lock.packages?.[""]?.devDependencies?.["@vscode/vsce"], VSCE_VERSION, RECHECK);
    const locked = lock.packages?.["node_modules/@vscode/vsce"];
    assert.equal(locked?.version, VSCE_VERSION, RECHECK);
    assert.equal(locked?.resolved, `https://registry.npmjs.org/@vscode/vsce/-/vsce-${VSCE_VERSION}.tgz`, RECHECK);
  });

  it("is the one installed, so the checks below read the right code", () => {
    const installed = readJson(join(VSCE_FOLDER, "package.json")) as { version?: string };
    assert.equal(installed.version, VSCE_VERSION, RECHECK);
  });
});

describe("vsce publish --help", () => {
  let help = "";

  before(() => {
    // Run rather than searched for: 4.0.0's source has the option too, but hidden from its help.
    help = execFileSync(process.execPath, [join(VSCE_FOLDER, "vsce"), "publish", "--help"], { encoding: "utf8" });
  });

  it("lists --oidc", () => {
    assert.ok(listsOption(help, "--oidc"), help);
  });

  it("lists --packagePath, which the publish job passes with it", () => {
    assert.ok(listsOption(help, "--packagePath"), help);
  });

  it("the check catches a help text that only mentions the flag, or lacks it", () => {
    const flag = "  --oidc                 Use OpenID Connect";
    assert.ok(listsOption(flag, "--oidc"));
    assert.ok(listsOption("  -i, --packagePath <paths...>  Publish", "--packagePath"));
    assert.ok(!listsOption("  --pat <token>  Can't be used with --oidc", "--oidc"));
    assert.ok(!listsOption("Usage: vsce publish [options] [version]", "--oidc"));
    assert.ok(!listsOption("", "--oidc"));
  });
});

describe("Node for vsce's engines", () => {
  it(`is what vsce asks for: Node ${VSCE_MINIMUM_NODE} or later`, () => {
    const installed = readJson(join(VSCE_FOLDER, "package.json")) as { engines?: { node?: string } };
    assert.match(installed.engines?.node ?? "", new RegExp(`^>=\\s*${VSCE_MINIMUM_NODE}$`));
  });

  it("is set up by every workflow that runs npm or vsce", () => {
    const running = workflows().filter(({ text }) => /\b(npm|npx|vsce)\s/.test(text));
    assert.ok(running.some(({ file }) => file === "ci.yml"));
    for (const { file, text } of running) {
      assert.notDeepEqual(nodeVersions(text), [], file);
    }
  });

  it("is new enough in every workflow", () => {
    for (const { file, text } of workflows()) {
      for (const version of nodeVersions(text)) {
        assert.ok(Number(version) >= VSCE_MINIMUM_NODE, `${file} uses Node ${version}`);
      }
    }
  });

  it("is new enough in the publish job designed in docs/release-pipeline.md", () => {
    const versions = nodeVersions(readFileSync(join(root, "docs/release-pipeline.md"), "utf8"));
    assert.notDeepEqual(versions, []);
    for (const version of versions) {
      assert.ok(Number(version) >= VSCE_MINIMUM_NODE, `the doc uses Node ${version}`);
    }
  });
});
